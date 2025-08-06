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
  780 Roosevelt, #209, Irvine, CA 2620<br/>
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

app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: 'Password is required.' });
    }
    if (password === "Taeyangtax1!!!") {
        // In a real app, you'd issue a token (e.g., JWT)
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Incorrect password.' });
    }
});

// --- Gmail & AI Helper Functions ---

function getGmailClient() {
    const oAuth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
    oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth: oAuth2Client });
}

async function getCleanBody(payload) {
    let body = '';
    
    // Find the best available content part from the email
    function findBestPart(p) {
        if (!p) return null;
        if (p.mimeType === 'text/html' && p.body && p.body.data) return p;
        if (p.mimeType === 'text/plain' && p.body && p.body.data) return p;
        if (p.mimeType === 'multipart/alternative' && p.parts) {
            return findBestPart(p.parts.find(sub => sub.mimeType === 'text/html')) || findBestPart(p.parts.find(sub => sub.mimeType === 'text/plain'));
        }
        if (p.mimeType.startsWith('multipart/') && p.parts) {
            for (const subPart of p.parts) {
                const found = findBestPart(subPart);
                if (found) return found;
            }
        }
        return null;
    }

    const part = findBestPart(payload);
    if (!part) return '';

    const rawBody = Buffer.from(part.body.data, 'base64').toString('utf-8');

    // If Gemini API key is not available, use fallback
    if (!process.env.GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY not found. Using basic fallback for body cleaning.");
        const turndown = require('turndown');
        const turndownService = new turndown();
        const textBody = part.mimeType === 'text/html' ? turndownService.turndown(rawBody) : rawBody;
        return textBody.replace(/\n\s*\n+/g, '\n\n').trim();
    }

    // Use Gemini to clean the email body
    try {
        const prompt = `You are an AI assistant that cleans email content. Your task is to extract only the core message from the provided email body.
        - Remove all quoted replies (lines starting with '>').
        - Remove previous conversation history (e.g., "On [Date], [Name] wrote:").
        - Remove all signatures, legal disclaimers, and promotional footers.
        - Preserve the original formatting (line breaks, paragraphs) of the core message.
        - If the email is very short and seems to be only a signature or disclaimer, return an empty string.
        - Respond ONLY with the cleaned plain text content. Do not add any commentary.
        
        Email Body to Clean:
        ---
        ${rawBody}
        ---`;

        const geminiRes = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.0,
                }
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        
        const cleanedText = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return cleanedText.trim();

    } catch (error) {
        console.error("Gemini cleaning failed. Falling back to basic cleaning.", error.response ? error.response.data : error.message);
        // Fallback to simpler cleaning if API fails
        const turndown = require('turndown');
        const turndownService = new turndown();
        const textBody = part.mimeType === 'text/html' ? turndownService.turndown(rawBody) : rawBody;
        return textBody.replace(/\n\s*\n+/g, '\n\n').trim();
    }
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
- "subject": A concise and professional email subject in Korean. It should start with "Re: " followed by a summary of the response. DO NOT include any codes or IDs like 'FX...'.
- "body": The email body in Korean.

**Directives:**
1.  **Analyze Context:** Base your response *only* on the provided "Full Email Conversation History". DO NOT use information from the "Reference Styles" examples, such as names (e.g., 이은주) or specific codes.
2.  **Complexity Assessment:**
    - If the query is complex or a new client inquiry, generate a **single JSON object** for a paid consultation. The "type" must be "유료 상담 제안".
    - If the query is simple, proceed to the next directive.
3.  **Three Response Options (for simple queries):**
    Generate an array of **three separate JSON objects**. The difference must be in the solution/answer, not just the tone.
    - **Response 1 (Direct Answer):** "type" should be "직접적인 답변".
    - **Response 2 (Alternative/Broader Perspective):** "type" should be "대안/추가 정보 제시".
    - **Response 3 (Information Request):** "type" should be "추가 정보 요청".
    - **Attachment Hint:** If a document is relevant, mention it in the body (e.g., "관련 서류를 첨부해 드립니다.").

**Reference Styles (For style and tone only):**
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
      const responses = JSON.parse(rawText);
      return Array.isArray(responses) ? responses : [responses];
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError, 'Raw Text:', rawText);
      return [{ subject: "Error", body: "AI 응답을 파싱하는 데 실패했습니다." }];
    }
  } catch(e) {
    console.error('Gemini API Error:', e.response ? JSON.stringify(e.response.data.error) : e.message);
    return [{ subject: "API Error", body: "AI 응답 생성에 실패했습니다." }];
  }
}

// --- Main Email Processing Logic ---

const parseEmailAddress = (fromHeader) => {
    if (!fromHeader) return null;
    const match = fromHeader.match(/<([^>]+)>/);
    return match ? match[1] : fromHeader.trim();
};

async function processThread(threadHeader, gmail, myEmailAddress) {
    try {
        const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadHeader.id, format: 'full' });
        const messages = (threadRes.data.messages || []).sort((a, b) => parseInt(a.internalDate) - parseInt(b.internalDate));

        if (messages.length === 0) return null;

        const lastMessage = messages[messages.length - 1];
        const fromHeader = lastMessage.payload.headers.find(h => h.name === 'From')?.value || '';
        const senderEmail = parseEmailAddress(fromHeader);
        const isReplied = messages.some(m => m.payload.headers.find(h => h.name === 'From')?.value.includes(myEmailAddress));
        
        const processedMessages = await Promise.all(messages.map(async (msg) => {
            const from = msg.payload.headers.find(h => h.name === 'From')?.value || 'Unknown';
            const body = await getCleanBody(msg.payload);
            return {
                id: msg.id,
                from: from,
                isFromMe: from.includes(myEmailAddress),
                body: body,
                date: new Date(parseInt(msg.internalDate)).toISOString(),
            };
        }));

        const validMessages = processedMessages.filter(m => m.body);
        if (validMessages.length === 0) return null;

        let aiResponses = [];
        if (!isReplied) {
            const conversationForAI = validMessages.map(msg => `From: ${msg.from}\n\n${msg.body}`).join('\n\n--- Next Message ---\n\n');
            const subjectHeader = lastMessage.payload.headers.find(h => h.name === 'Subject')?.value || '';
            aiResponses = await generateAiResponses(conversationForAI, subjectHeader);
        }

        return {
            threadId: threadHeader.id,
            from: fromHeader,
            senderEmail: senderEmail,
            subject: lastMessage.payload.headers.find(h => h.name === 'Subject')?.value || '',
            snippet: lastMessage.snippet,
            replied: isReplied,
            messages: validMessages,
            aiResponses,
        };
    } catch (error) {
        console.error(`Failed to process thread ${threadHeader.id}:`, error);
        return null;
    }
}

async function fetchAndCacheEmails() {
    if (isCacheUpdating) return;
    isCacheUpdating = true;
    console.log('Starting email cache update...');

    try {
        const gmail = getGmailClient();
        const profileRes = await gmail.users.getProfile({ userId: 'me' });
        const myEmailAddress = profileRes.data.emailAddress;

        const listRes = await gmail.users.threads.list({
            userId: 'me',
            labelIds: ['INBOX'],
            q: 'in:inbox',
            maxResults: 30, 
        });

        const allThreads = listRes.data.threads || [];

        const uniqueThreads = Array.from(new Map(allThreads.map(t => [t.id, t])).values());

        const processedThreads = (await Promise.all(uniqueThreads.map(header => processThread(header, gmail, myEmailAddress)))).filter(Boolean);
        
        emailCache.unreplied = processedThreads.filter(t => !t.replied);
        emailCache.replied = processedThreads.filter(t => t.replied);

        console.log(`Cache updated: ${emailCache.unreplied.length} unreplied, ${emailCache.replied.length} replied.`);

    } catch (e) {
        console.error('Error during email fetching loop:', e);
    } finally {
        isCacheUpdating = false;
    }
}


// --- API Routes ---
app.get('/api/signature', (req, res) => res.json({ signature: SIGNATURE }));

app.get('/api/threads', (req, res) => res.json(emailCache));

app.get('/api/history', async (req, res) => {
    const { sender, currentThreadId } = req.query;
    if (!sender) {
        return res.status(400).json({ error: 'Sender email is required.' });
    }

    try {
        const gmail = getGmailClient();
        const profileRes = await gmail.users.getProfile({ userId: 'me' });
        const myEmailAddress = profileRes.data.emailAddress;

        const listRes = await gmail.users.threads.list({
            userId: 'me',
            q: `from:${sender}`,
            maxResults: 10, // Fetch up to 10 recent threads for history
        });

        if (!listRes.data.threads || listRes.data.threads.length === 0) {
            return res.json([]);
        }

        // Filter out the current thread from the history list
        const historyThreadHeaders = listRes.data.threads.filter(t => t.id !== currentThreadId);

        const historyThreads = (await Promise.all(
            historyThreadHeaders.map(header => processThread(header, gmail, myEmailAddress))
        )).filter(Boolean); // process and filter out nulls

        res.json(historyThreads);

    } catch (error) {
        console.error(`Error fetching history for ${sender}:`, error);
        res.status(500).json({ error: 'Failed to fetch conversation history.' });
    }
});

app.post('/api/send', async (req, res) => {
  try {
    const { threadId, response, attachments = [] } = req.body;
    if (!response || !response.subject || !response.body) {
      return res.status(400).json({ error: 'Response must include a subject and body.' });
    }

    const gmail = getGmailClient();
    
    // Find the thread in the cache to get the latest message ID for replying
    const threadToReply = emailCache.unreplied.find(t => t.threadId === threadId);
    if (!threadToReply || threadToReply.messages.length === 0) {
        return res.status(404).json({ error: 'Thread not found or has no messages.'});
    }
    const lastMessage = threadToReply.messages[threadToReply.messages.length - 1];
    
    const originalMsg = await gmail.users.messages.get({ userId: 'me', id: lastMessage.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Message-ID'] });
    const originalMessageId = originalMsg.data.payload.headers.find(h => h.name === 'Message-ID')?.value;
    const to = originalMsg.data.payload.headers.find(h => h.name === 'From')?.value;

    const mailOptions = {
        to: to, 
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

    // Update cache immediately for instant UI feedback
    const sentThreadIndex = emailCache.unreplied.findIndex(t => t.threadId === threadId);
    if (sentThreadIndex > -1) {
        const [sentThread] = emailCache.unreplied.splice(sentThreadIndex, 1);
        sentThread.replied = true;
        // Manually add the sent message to the history for immediate display
        sentThread.messages.push({
            id: 'sent_temp_' + Date.now(), // temporary ID
            from: 'me',
            isFromMe: true,
            body: response.body,
            date: new Date().toISOString()
        });
        emailCache.replied.unshift(sentThread);
    }
    
    res.json({ success: true, updatedThread: emailCache.replied[0] });
  } catch (e) {
    console.error('Error sending email:', e);
    res.status(500).json({ error: 'Failed to send email', detail: e.message });
  }
});

app.get('/api/attachments', (req, res) => {
    const attachmentsDir = path.join(__dirname, 'public/attachments');
    fs.readdir(attachmentsDir, (err, files) => {
        if (err) {
            console.error("Could not list attachments:", err);
            return res.status(500).json({ error: "Could not list attachments" });
        }
        res.json(files.filter(file => file !== '.gitkeep')); // Exclude placeholder
    });
});

app.post('/api/upload', upload.single('attachment'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    res.json({ success: true, filename: req.file.filename });
});

app.delete('/api/attachments/:filename', (req, res) => {
    const filename = req.params.filename;
    // Basic security check to prevent directory traversal
    if (filename.includes('..') || path.isAbsolute(filename)) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    const filePath = path.join(__dirname, 'public/attachments', filename);
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error(`Failed to delete ${filename}:`, err);
            return res.status(500).json({ error: `Failed to delete file.`});
        }
        res.json({ success: true, message: `${filename} deleted.` });
    });
});


// --- Server Start & Other Routes ---
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'frontend/dist/index.html')));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  fetchAndCacheEmails(); 
  setInterval(fetchAndCacheEmails, 90 * 1000); // Increased interval
});
