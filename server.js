const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Serve Public Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/attachments', express.static(path.join(__dirname, 'public/attachments')));


// --- Constants ---
const SIGNATURE = `
<br/><br/>
--
<br/>
<p style="font-size: 12px; color: #888;">
  <strong>TAEYANG TAX SERVICE</strong><br/>
  780 Roosevelt, #209, Irvine, CA 92620<br/>
  <strong>Office</strong>: 949 546 7979 / <strong>Fax</strong>: 949 296 4030<br/>
  <strong>카카오톡 ID</strong>: taeyangtax<br/>
  <strong>Email</strong>: info@taeyangtax.com<br/>
  <img src="cid:logo" alt="Taeyang Tax Service Logo" style="width: 150px; margin-top: 10px;"/>
</p>
<p style="font-size: 11px; color: #aaa;">
  Payroll / Sales Tax / QuickBooks<br/>
  개인 및 비지니스 절세 및 세금보고<br/>
  FATCA, FBAR 해외금융자산신고<br/>
  회사설립, 미국 진출 자문 & 컨설팅
</p>
`;


// --- Cache ---
let emailCache = {
  unreplied: [],
  replied: [],
};
let isCacheUpdating = false;

// --- Load Email Samples for RAG ---
let emailSamples = [];
try {
  const samplesData = fs.readFileSync(path.join(__dirname, 'email_samples.json'), 'utf-8');
  emailSamples = JSON.parse(samplesData);
  console.log(`Successfully loaded ${emailSamples.length} email samples.`);
} catch (error) {
  console.error('Could not read or parse email_samples.json. Proceeding without samples.', error);
}

app.use(cors());
app.use(express.json());

// --- Helper Functions (omitted for brevity, they are the same) ---
function getGmailClient() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail API environment variables are not set.');
  }
  const oAuth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

function parseEmailBody(parts) {
    if (!parts) return '';
    let body = '';
    const findTextPart = (arr) => {
        for (const part of arr) {
            if (part.mimeType === 'text/plain' && part.body.data) {
                return Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
            if (part.parts) {
                const nestedBody = findTextPart(part.parts);
                if (nestedBody) return nestedBody;
            }
        }
        return null;
    };

    let textBody = findTextPart(parts);

    if (textBody) {
        return textBody;
    }

    const nonMultipart = parts[0];
    if (nonMultipart && nonMultipart.body && nonMultipart.body.data) {
        return Buffer.from(nonMultipart.body.data, 'base64').toString('utf-8');
    }

    return '';
}

function getSimilarSamples(question) {
    if (emailSamples.length === 0) return [];
    const questionWords = new Set(question.toLowerCase().split(/\s+/));
    const scoredSamples = emailSamples.map(sample => {
        const sampleWords = new Set(sample.question.toLowerCase().split(/\s+/));
        const intersection = new Set([...questionWords].filter(x => sampleWords.has(x)));
        return { ...sample, score: intersection.size };
    });
    return scoredSamples.sort((a, b) => b.score - a.score).slice(0, 2);
}

async function generateAiResponses(body) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key is not set.');
  if (!body) return [];
  
  try {
    const similarSamples = getSimilarSamples(body);
    let ragContext = "There are no specific past examples to reference.";
    if(similarSamples.length > 0) {
        ragContext = "Please refer to the following successful past response examples to compose your new answer. Emulate the tone and style closely:\n\n" +
        similarSamples.map(s => `Example Question: "${s.question}"\nExample Answer: "${s.answer}"`).join("\n\n---\n\n");
    }

    const prompt = `You are a professional and courteous US tax accountant named iMate, an AI assistant for Taeyang Tax. Your task is to draft three distinct, polite, and natural-sounding responses in Korean to the customer's question below.

**Context from past successful responses:**
${ragContext}

**New Customer Question:**
"${body}"

Based on the provided context and the new question, generate three complete and ready-to-send responses.
Response 1 (Friendly and direct style):
Response 2 (Formal and detailed style):
Response 3 (Concise and reassuring style):`;

    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const text = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text.split(/Response \d+\s\(.+\):/).map(s => s.trim()).filter(Boolean);
  } catch(e) {
    console.error('Gemini API Error:', e.response ? e.response.data.error : e.message);
    return ["AI 응답 생성에 실패했습니다.", "API 키 또는 모델 설정을 확인하세요.", "서버 로그를 확인해주세요."];
  }
}

async function fetchAndCacheEmails() {
    if (isCacheUpdating) {
        console.log('Cache update already in progress. Skipping.');
        return;
    }
    isCacheUpdating = true;
    console.log('Starting background email cache update...');

    try {
        const gmail = getGmailClient();
        const listRes = await gmail.users.threads.list({ userId: 'me', labelIds: ['INBOX'], q: 'is:unread', maxResults: 10 });

        if (!listRes.data.threads || listRes.data.threads.length === 0) {
            console.log('No unread threads found. Clearing unreplied cache.');
            emailCache.unreplied = [];
            isCacheUpdating = false;
            return;
        }

        const newUnreplied = [];
        for (const threadHeader of listRes.data.threads) {
            const existingThread = emailCache.unreplied.find(t => t.threadId === threadHeader.id);
            if (existingThread && existingThread.aiResponses && existingThread.aiResponses.length > 0) {
                newUnreplied.push(existingThread);
                continue;
            }

            const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadHeader.id, format: 'full' });
            const messages = threadRes.data.messages || [];
            const lastMessage = messages[messages.length - 1];
            const headers = lastMessage.payload.headers;
            
            const from = headers.find(h => h.name === 'From')?.value || '';
            const subject = headers.find(h => h.name === 'Subject')?.value || '';
            const body = parseEmailBody(lastMessage.payload.parts || [lastMessage.payload]);
            const hasSentMail = messages.some(m => m.labelIds.includes('SENT'));

             if (hasSentMail) continue;

            const threadData = {
                threadId: threadHeader.id,
                messageId: lastMessage.id,
                from,
                subject,
                snippet: lastMessage.snippet,
                historyId: lastMessage.historyId,
                messages: messages.map(m => ({
                    id: m.id,
                    from: m.payload.headers.find(h => h.name === 'From')?.value || '',
                    body: parseEmailBody(m.payload.parts || [m.payload])
                })),
                aiResponses: [],
                replied: false,
            };

            if (body) {
                threadData.aiResponses = await generateAiResponses(body);
            }
            newUnreplied.push(threadData);
        }

        emailCache.unreplied = newUnreplied;
        console.log(`Cache updated successfully. ${emailCache.unreplied.length} unreplied threads cached.`);

    } catch (e) {
        console.error('Error during background cache update:', e);
    } finally {
        isCacheUpdating = false;
    }
}


// --- API Routes ---

app.get('/api/threads', (req, res) => {
  res.json(emailCache);
});

app.get('/api/attachments', (req, res) => {
    const directoryPath = path.join(__dirname, 'public/attachments');
    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            console.error("Could not list the directory.", err);
            return res.status(500).send('Unable to scan attachments directory.');
        }
        res.json(files.filter(file => file !== '.gitkeep')); // Filter out placeholder files
    });
});

app.post('/api/send', async (req, res) => {
  try {
    const { threadId, messageId, response, attachments = [] } = req.body;
    const gmail = getGmailClient();
    
    const originalMsg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Message-ID'] });
    
    const from = originalMsg.data.payload.headers.find(h => h.name === 'From')?.value;
    const subject = originalMsg.data.payload.headers.find(h => h.name === 'Subject')?.value;
    const originalMessageId = originalMsg.data.payload.headers.find(h => h.name === 'Message-ID')?.value;

    const mailOptions = {
        to: from,
        subject: `Re: ${subject}`,
        html: `${response.replace(/\n/g, '<br/>')}${SIGNATURE}`,
        inReplyTo: originalMessageId,
        references: originalMessageId,
        attachments: attachments.map(fileName => ({
            filename: fileName,
            path: path.join(__dirname, 'public/attachments', fileName)
        }))
    };
    
    // Add logo as an embedded image
    mailOptions.attachments.push({
        filename: 'logo.png',
        path: path.join(__dirname, 'public', 'logo.png'),
        cid: 'logo' // same cid value as in the html img src
    });

    const mailComposer = nodemailer.createTransport({}).mail.compile(mailOptions);
    const rawMessage = await mailComposer.build();

    const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage, threadId }
    });
    
    await gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: { removeLabelIds: ['UNREAD'] }
    });

    emailCache.unreplied = emailCache.unreplied.filter(t => t.threadId !== threadId);
    fetchAndCacheEmails();

    res.json({ success: true });
  } catch (e) {
    console.error('Error sending email:', e);
    console.error('Detailed error:', e.message, e.stack);
    res.status(500).json({ error: 'Failed to send email', detail: e.message });
  }
});

// --- Frontend Serving ---
const buildPath = path.join(__dirname, 'frontend/dist');
app.use(express.static(buildPath));
app.get('*', (req, res) => {
  const indexPath = path.join(buildPath, 'index.html');
  fs.readFile(indexPath, 'utf8', (err, htmlData) => {
    if (err) {
      console.error('Could not read index.html:', err);
      return res.status(404).send('Application not found.');
    }
    res.send(htmlData);
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  fetchAndCacheEmails(); 
  setInterval(fetchAndCacheEmails, 60 * 1000); 
});
