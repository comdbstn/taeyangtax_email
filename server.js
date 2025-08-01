const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const axios = require('axios');
const MailComposer = require('nodemailer/lib/mail-composer');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Base64 Image & Signature ---
let logoBase64 = '';
try {
    const logoBuffer = fs.readFileSync(path.join(__dirname, 'public', 'logo.png'));
    logoBase64 = logoBuffer.toString('base64');
} catch (error) {
    console.error("Could not read logo.png for Base64 encoding", error);
}

const SIGNATURE = `
<br/><br/>
<div style="color: #FFFFFF; font-family: sans-serif; font-size: 12px;">
  <strong>TAEYANG TAX SERVICE</strong><br/>
  780 Roosevelt, #209, Irvine, CA 92620<br/>
  <strong>Office</strong>: 949 546 7979 / <strong>Fax</strong>: 949 296 4030<br/>
  <strong>카카오톡 ID</strong>: taeyangtax<br/>
  <strong>Email</strong>: info@taeyangtax.com<br/><br/>
  ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Taeyang Tax Service Logo" style="width: 150px;"/>` : ''}
  <p style="font-size: 11px; color: #DDDDDD;">
    Payroll / Sales Tax / QuickBooks<br/>
    개인 및 비지니스 절세 및 세금보고<br/>
    FATCA, FBAR 해외금융자산신고<br/>
    회사설립, 미국 진출 자문 & 컨설팅
  </p>
</div>
`;

// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/attachments/'),
    filename: (req, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf-8'))
});
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/attachments', express.static(path.join(__dirname, 'public/attachments')));

let emailCache = { unreplied: [], replied: [] };
let isCacheUpdating = false;
let emailSamples = [];
try {
  emailSamples = JSON.parse(fs.readFileSync(path.join(__dirname, 'email_samples.json'), 'utf-8'));
  console.log(`Successfully loaded ${emailSamples.length} email samples.`);
} catch (error) {
  console.error('Could not read email_samples.json.', error);
}

app.use(cors());
app.use(express.json());

// --- Helper Functions ---
function getGmailClient() {
  const oAuth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

// --- REVISED AND ROBUST parseEmailBody function ---
function parseEmailBody(payload) {
    if (!payload) return '';

    const findTextPart = (partsArr) => {
        let body = '';
        if (!Array.isArray(partsArr)) return body;

        for (const part of partsArr) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                return body;
            }
            if (part.parts) {
                const nestedBody = findTextPart(part.parts);
                if (nestedBody) return nestedBody;
            }
        }
        return body;
    };

    if (payload.parts && Array.isArray(payload.parts)) {
        const body = findTextPart(payload.parts);
        if (body) return body;
    }

    if (payload.body && payload.body.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
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

async function generateAiResponses(conversationHistory, originalSubject) {
  if (!process.env.GEMINI_API_KEY || !conversationHistory) return [];
  
  try {
    const similarSamples = getSimilarSamples(conversationHistory);
    let ragContext = "No past examples to reference.";
    if(similarSamples.length > 0) {
        ragContext = "Reference these successful past responses:\n" +
        similarSamples.map(s => `Q: "${s.question}"\nA: "${s.answer}"`).join("\n---\n");
    }

    const prompt = `You are iMate, a professional US tax accountant AI for Taeyang Tax. Analyze the entire email conversation and the original subject ("${originalSubject}"). Your task is to generate three distinct and professional response options in JSON format.

**JSON Structure:**
Each response must be a JSON object with three keys: "type", "subject", and "body".
- "type": A short Korean phrase summarizing the response category. Use one of the following: "직접적인 답변", "대안/추가 정보 제시", "추가 정보 요청", "유료 상담 제안".
- "subject": A concise and professional email subject in Korean. It should start with "Re: " followed by a summary of the response.
- "body": The email body in Korean.

**Directives:**
1.  **Complexity Assessment:**
    - If the query is complex or a new client inquiry, generate a **single JSON object** for a paid consultation. The "type" must be "유료 상담 제안". The body must be this exact text:
      "안녕하세요.\\n세무회계태양 입니다.\\n\\n보내주신 이메일 확인했습니다.\\n죄송하지만 말씀드릴 내용이 많습니다.\\n그리고 이번에 부터 보고하셔야 할 2024년 세금보고는 작년과 달리 매우 복잡하게 됩니다.\\n질문주신 하나하나가 모두 설명 드릴 것이 많아서요.\\n\\n괜찮으시다면 유료 상담으로 진행을 하시면 어떨까 여쭙고자 합니다.\\n비용은 100불이며, Zelle로 받습니다.\\nZelle : taxtaeyang@gmail.com ( Taeyang Tax Service)\\n비용 납부해주시고 MA에 계신것으로 알아서 통화시간 맞춰서 통화를 하면 좋겠습니다.\\n\\n바뀌시는것이 너무 많고 중요한것들이기에 상담을 추천드려요. 꼭 필요한"
    - If the query is simple, proceed to the next directive.

2.  **Three Response Options (for simple queries):**
    Generate an array of **three separate JSON objects**. The difference must be in the solution/answer, not just the tone.
    - **Response 1 (Direct Answer):** "type" should be "직접적인 답변".
    - **Response 2 (Alternative/Broader Perspective):** "type" should be "대안/추가 정보 제시".
    - **Response 3 (Information Request):** "type" should be "추가 정보 요청".
    - **Attachment Hint:** If a document is relevant, mention it in the body (e.g., "관련 서류를 첨부해 드립니다.").

**Reference Styles:**
${ragContext}

**Full Email Conversation History:**
---
${conversationHistory}
---

**IMPORTANT:** Respond with a valid JSON array containing the response objects. Do not include any text outside the JSON structure. For a single response, wrap the object in an array.`;

    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { 
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const rawText = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    try {
      // The response is expected to be a JSON array of objects
      const responses = JSON.parse(rawText);
      return Array.isArray(responses) ? responses : [responses]; // Ensure it's always an array
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Raw Gemini Response:', rawText);
      return [{ subject: "Error", body: "AI 응답을 파싱하는 데 실패했습니다. 원본 텍스트를 확인하세요:\n" + rawText }];
    }
  } catch(e) {
    console.error('Gemini API Error:', e.response ? JSON.stringify(e.response.data.error) : e.message);
    return [{ subject: "API Error", body: "AI 응답 생성에 실패했습니다. 서버 로그를 확인해주세요." }];
  }
}

async function fetchAndCacheEmails() {
    if (isCacheUpdating) return;
    isCacheUpdating = true;
    console.log('Starting background email cache update...');
    try {
        const gmail = getGmailClient();
        const listRes = await gmail.users.threads.list({ userId: 'me', labelIds: ['INBOX'], q: '', maxResults: 10 });

        if (!listRes.data.threads || listRes.data.threads.length === 0) {
            emailCache.unreplied = [];
            console.log('No unread threads found.');
            return;
        }

        const newUnreplied = [];
        for (const threadHeader of listRes.data.threads) {
            const existingThread = emailCache.unreplied.find(t => t.threadId === threadHeader.id);
            if (existingThread && existingThread.aiResponses.length > 0) {
                newUnreplied.push(existingThread);
                continue;
            }

            const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadHeader.id, format: 'full' });
            const messages = threadRes.data.messages || [];
            if (messages.length === 0 || messages.some(m => m.labelIds && m.labelIds.includes('SENT'))) continue;

            // Pass the entire payload to the robust parser
            const conversationHistory = messages.map(msg => `From: ${msg.payload.headers.find(h => h.name === 'From')?.value || 'Unknown'}\n\n${parseEmailBody(msg.payload)}`).join('\n\n--- Next Message ---\n\n');
            const lastMessage = messages[messages.length - 1];
            const threadData = {
                threadId: threadHeader.id, messageId: lastMessage.id,
                from: lastMessage.payload.headers.find(h => h.name === 'From')?.value || '',
                subject: lastMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
                snippet: lastMessage.snippet, historyId: lastMessage.historyId,
                messages: messages.map(m => ({ id: m.id, from: m.payload.headers.find(h => h.name === 'From')?.value || '', body: parseEmailBody(m.payload) })),
                aiResponses: await generateAiResponses(conversationHistory, lastMessage.payload.headers.find(h => h.name === 'Subject')?.value || ''), replied: false,
            };
            newUnreplied.push(threadData);
        }
        emailCache.unreplied = newUnreplied;
        console.log(`Cache updated: ${emailCache.unreplied.length} unreplied threads.`);
    } catch (e) { console.error('Error during cache update:', e); } finally { isCacheUpdating = false; }
}

// --- API Routes ---
app.get('/api/signature', (req, res) => res.json({ signature: SIGNATURE }));
app.get('/api/threads', (req, res) => res.json(emailCache));
app.get('/api/attachments', (req, res) => {
    fs.readdir(path.join(__dirname, 'public/attachments'), (err, files) => {
        if (err) return res.status(500).send('Unable to scan directory.');
        res.json(files.filter(file => file !== '.gitkeep'));
    });
});
app.post('/api/upload', upload.single('attachment'), (req, res) => res.status(200).json({ filename: req.file.filename }));
app.delete('/api/attachments/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    if (filename.includes('..')) return res.status(400).send('Invalid filename.');
    fs.unlink(path.join(__dirname, 'public/attachments', filename), (err) => {
        if (err) return res.status(500).send('Failed to delete file.');
        res.status(200).json({ message: 'File deleted' });
    });
});
app.post('/api/send', async (req, res) => {
  try {
    const { threadId, messageId, response, attachments = [] } = req.body;
    if (!response || !response.subject || !response.body) {
      return res.status(400).json({ error: 'Response must include a subject and body.' });
    }

    const gmail = getGmailClient();
    const originalMsg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['From', 'Message-ID'] });

    const payload = originalMsg.data.payload;
    if (!payload || !payload.headers) {
      console.error('Failed to get original message payload for messageId:', messageId);
      return res.status(404).json({ error: 'Original message payload not found.' });
    }

    const from = payload.headers.find(h => h.name === 'From')?.value;
    const originalMessageId = payload.headers.find(h => h.name === 'Message-ID')?.value;
    
    const mailOptions = {
        to: from, 
        subject: response.subject,
        html: `${response.body.replace(/\n/g, '<br/>')}${SIGNATURE}`,
        inReplyTo: originalMessageId, 
        references: originalMessageId,
        attachments: attachments.map(fileName => ({ filename: fileName, path: path.join(__dirname, 'public/attachments', fileName) }))
    };
    
    const mailComposer = new MailComposer(mailOptions);
    const rawMessage = await mailComposer.compile().build();
    const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage, threadId } });
    await gmail.users.threads.modify({ userId: 'me', id: threadId, requestBody: { removeLabelIds: ['UNREAD'] } });

    const sentThreadIndex = emailCache.unreplied.findIndex(t => t.threadId === threadId);
    if (sentThreadIndex > -1) {
        const [sentThread] = emailCache.unreplied.splice(sentThreadIndex, 1);
        sentThread.replied = true;
        emailCache.replied.unshift(sentThread);
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error('Error sending email:', e);
    res.status(500).json({ error: 'Failed to send email', detail: e.message });
  }
});

// --- Server Start & Frontend Serving ---
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  fetchAndCacheEmails(); 
  setInterval(fetchAndCacheEmails, 60 * 1000); 
});
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'frontend/dist/index.html')));
