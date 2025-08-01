const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const axios = require('axios');
const nodemailer = require('nodemailer');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/attachments/')
    },
    filename: function (req, file, cb) {
        // Use originalname to keep the uploaded file's name
        cb(null, file.originalname)
    }
});
const upload = multer({ storage: storage });


// --- Serve Public Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/attachments', express.static(path.join(__dirname, 'public/attachments')));

// --- Constants (Signature) ---
const SIGNATURE = `
<br/><br/>
...
`; // (Signature content is omitted for brevity)

// --- Cache ---
let emailCache = { unreplied: [], replied: [] };
let isCacheUpdating = false;

// --- Load Email Samples for RAG ---
let emailSamples = [];
// (Loading logic is omitted for brevity)

app.use(cors());
app.use(express.json());

// --- Helper Functions (getGmailClient, parseEmailBody, getSimilarSamples, generateAiResponses) ---
// (Helper functions are omitted for brevity, they remain the same)
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

async function generateAiResponses(conversationHistory) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key is not set.');
  if (!conversationHistory) return [];
  
  try {
    const similarSamples = getSimilarSamples(conversationHistory);
    let ragContext = "There are no specific past examples to reference.";
    if(similarSamples.length > 0) {
        ragContext = "Please refer to the following successful past response examples to compose your new answer. Emulate the tone and style closely:\n\n" +
        similarSamples.map(s => `Example Question: "${s.question}"\nExample Answer: "${s.answer}"`).join("\n\n---\n\n");
    }

    const prompt = `You are a professional and courteous US tax accountant named iMate, an AI assistant for Taeyang Tax. Your task is to analyze an entire email conversation and then draft three distinct, polite, and natural-sounding responses in Korean to the last message in the thread.

**Key Instructions:**
1.  **Full Context Analysis:** Read the entire conversation history to understand the full context, previous questions, and provided answers.
2.  **Smart Attachment Recommendation:** If the conversation suggests a file is needed (e.g., the user is asking for a form, or a process requires a document like a '위임장' or '신청서'), mention in your response that the relevant file is attached. For example, write "요청하신 업무에 필요한 위임장 파일을 함께 첨부해 드립니다."
3.  **Tone and Style:** Generate three options: Friendly & direct, Formal & detailed, and Concise & reassuring.

**Past Successful Response Examples (for style reference):**
${ragContext}

**Full Email Conversation History (from oldest to newest):**
---
${conversationHistory}
---

Based on the **full conversation**, generate three complete, ready-to-send Korean responses to the **last message** of the thread.

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
// --- Background Caching Logic (fetchAndCacheEmails) ---
// (Caching logic is omitted for brevity, it remains the same)
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
            if (messages.length === 0) continue;

            const hasSentMail = messages.some(m => m.labelIds.includes('SENT'));
            if (hasSentMail) continue;

            const conversationHistory = messages.map(msg => {
                const fromHeader = msg.payload.headers.find(h => h.name === 'From')?.value || 'Unknown';
                const body = parseEmailBody(msg.payload.parts || [msg.payload]);
                return `From: ${fromHeader}\n\n${body}`;
            }).join('\n\n--- End of Message ---\n\n');

            const lastMessage = messages[messages.length - 1];

            const threadData = {
                threadId: threadHeader.id,
                messageId: lastMessage.id,
                from: lastMessage.payload.headers.find(h => h.name === 'From')?.value || '',
                subject: lastMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
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

            if (conversationHistory) {
                threadData.aiResponses = await generateAiResponses(conversationHistory);
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
        res.json(files.filter(file => file !== '.gitkeep'));
    });
});

app.post('/api/upload', upload.single('attachment'), (req, res) => {
    res.status(200).json({ message: 'File uploaded successfully', filename: req.file.filename });
});

app.delete('/api/attachments/:filename', (req, res) => {
    const filename = req.params.filename;
    // Basic security check to prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).send('Invalid filename.');
    }
    const filePath = path.join(__dirname, 'public/attachments', filename);

    fs.unlink(filePath, (err) => {
        if (err) {
            console.error("Error deleting file:", err);
            return res.status(500).send('Failed to delete file.');
        }
        res.status(200).json({ message: 'File deleted successfully' });
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
    
    mailOptions.attachments.push({
        filename: 'logo.png',
        path: path.join(__dirname, 'public', 'logo.png'),
        cid: 'logo'
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

// --- Frontend Serving & Server Start ---
// (This part is omitted for brevity, it remains the same)
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
