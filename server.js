const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// --- Helper Functions ---

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
  const findTextPart = (arr) => {
    let body = '';
    for (const part of arr) {
      if (part.mimeType === 'text/plain' && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        body = findTextPart(part.parts);
        if (body) return body;
      }
    }
    return '';
  };
  return findTextPart(parts);
}

// Simple text similarity function (for RAG)
function getSimilarSamples(question) {
    if (emailSamples.length === 0) return [];
    // A more sophisticated similarity search (e.g., using vector embeddings) would be ideal for a larger dataset.
    // For now, we use a simple keyword matching approach.
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

// --- API Routes ---

app.get('/api/threads', async (req, res) => {
  try {
    const gmail = getGmailClient();
    const listRes = await gmail.users.threads.list({ userId: 'me', labelIds: ['INBOX'], q: 'is:unread', maxResults: 10 });
    
    if (!listRes.data.threads || listRes.data.threads.length === 0) {
      return res.json({ unreplied: [], replied: [] });
    }

    const threadPromises = listRes.data.threads.map(async (threadHeader) => {
      const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadHeader.id, format: 'full' });
      const messages = threadRes.data.messages || [];
      const lastMessage = messages[messages.length - 1];
      const headers = lastMessage.payload.headers;
      
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const messageId = headers.find(h => h.name === 'Message-ID')?.value || '';
      const body = parseEmailBody(lastMessage.payload.parts || [lastMessage.payload]);

      const hasSentMail = messages.some(m => m.labelIds.includes('SENT'));

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
        replied: hasSentMail
      };

      if (!hasSentMail && body) {
          threadData.aiResponses = await generateAiResponses(body);
      }
      
      return threadData;
    });

    const results = await Promise.all(threadPromises);
    const unreplied = results.filter(r => !r.replied);
    const replied = results.filter(r => r.replied);

    res.json({ unreplied, replied });

  } catch (e) {
    console.error('Error fetching threads:', e);
    res.status(500).json({ error: 'Failed to fetch email threads', detail: e.message });
  }
});

app.post('/api/send', async (req, res) => {
  try {
    const { threadId, messageId, response } = req.body;
    const gmail = getGmailClient();
    
    const originalMsg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Message-ID'] });
    
    const from = originalMsg.data.payload.headers.find(h => h.name === 'From')?.value;
    const subject = originalMsg.data.payload.headers.find(h => h.name === 'Subject')?.value;
    const originalMessageId = originalMsg.data.payload.headers.find(h => h.name === 'Message-ID')?.value;

    const raw = Buffer.from(
      `To: ${from}\r\n` +
      `Subject: Re: ${subject}\r\n` +
      `In-Reply-To: ${originalMessageId}\r\n` +
      `References: ${originalMessageId}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
      response
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId }
    });
    
    await gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: {
            removeLabelIds: ['UNREAD']
        }
    })

    res.json({ success: true });
  } catch (e) {
    console.error('Error sending email:', e.message);
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
});
