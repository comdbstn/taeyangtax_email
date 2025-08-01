const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

async function generateAiResponses(body) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key is not set.');
  if (!body) return [];
  
  try {
    const prompt = `You are a US tax accountant. Please write three natural and polite responses in Korean to the customer's question below.\n\nQuestion:\n"${body}"\n\nResponse 1:\nResponse 2:\nResponse 3:`;
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const text = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text.split(/응답 \d:/).map(s => s.trim()).filter(Boolean);
  } catch(e) {
    console.error('Gemini API Error:', e.response ? e.response.data.error : e.message);
    // Return empty array on failure so the app can still display the email
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

      // Check if we have replied to this thread already
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
      };

      if (!hasSentMail && body) {
          threadData.aiResponses = await generateAiResponses(body);
      }
      
      return { data: threadData, replied: hasSentMail };
    });

    const results = await Promise.all(threadPromises);

    const unreplied = results.filter(r => !r.replied).map(r => r.data);
    const replied = results.filter(r => r.replied).map(r => r.data);

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
    
    // Mark the message/thread as read
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
