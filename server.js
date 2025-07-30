const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const buildPath = path.join(__dirname, 'frontend/dist');
const indexPath = path.join(buildPath, 'index.html');

app.use(cors());
app.use(express.json());


// --- API Routes ---
// (기존 API 로직들은 여기에 그대로 위치합니다)
function getGmailClient() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail API 환경변수가 설정되지 않았습니다.');
  }
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

app.get('/api/emails', async (req, res) => {
  try {
    const gmail = getGmailClient();
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      q: 'is:unread',
      maxResults: 1
    });
    if (!listRes.data.messages || listRes.data.messages.length === 0) {
      return res.json({ email: null });
    }
    const msgId = listRes.data.messages[0].id;
    const msgRes = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
    const headers = msgRes.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    let body = '';
    if (msgRes.data.payload.parts) {
      const part = msgRes.data.payload.parts.find(p => p.mimeType === 'text/plain');
      if (part && part.body.data) {
        body = Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    } else if (msgRes.data.payload.body.data) {
      body = Buffer.from(msgRes.data.payload.body.data, 'base64').toString('utf-8');
    }
    res.json({ email: { id: msgId, from, subject, body } });
  } catch (e) {
    console.error('Gmail API 오류:', e.message);
    res.status(500).json({ error: 'Gmail API 오류', detail: e.message });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Gemini API 키가 설정되지 않았습니다.');
    }
    const { email, examples } = req.body;
    const prompt = `당신은 미국 세무사입니다. 아래 고객 질문에 대해 가능한 자연스럽고 정중한 답변을 3가지 스타일로 작성해주세요.

질문:
"${email.body}"

이전에 이런 질문에 다음과 같이 답변했습니다:
1. ${examples?.[0] || ''}
2. ${examples?.[1] || ''}
3. ${examples?.[2] || ''}

응답 1:
응답 2:
응답 3:`;

    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    const text = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const responses = text.split(/응답 \d:/).map(s => s.trim()).filter(Boolean);
    res.json({ responses });
  } catch (e) {
    console.error('Gemini API 오류:', e.response ? e.response.data : e.message);
    res.status(500).json({ error: 'Gemini API 오류', detail: e.response ? e.response.data : e.message });
  }
});

app.post('/api/send', async (req, res) => {
  try {
    const { emailId, response } = req.body;
    const gmail = getGmailClient();
    const msgRes = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Message-ID']
    });
    const from = msgRes.data.payload.headers.find(h => h.name === 'From')?.value;
    const subject = msgRes.data.payload.headers.find(h => h.name === 'Subject')?.value;
    const messageId = msgRes.data.payload.headers.find(h => h.name === 'Message-ID')?.value;

    const raw = Buffer.from(
      `To: ${from}\r\n` +
      `Subject: Re: ${subject}\r\n` +
      `In-Reply-To: ${messageId}\r\n` +
      `References: ${messageId}\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      `${response}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: msgRes.data.threadId }
    });
    res.json({ success: true });
  } catch (e) {
    console.error('Gmail 전송 오류:', e.message);
    res.status(500).json({ error: 'Gmail 전송 오류', detail: e.message });
  }
});

// --- Frontend Serving ---
app.use(express.static(buildPath));

// 루트 경로("/") 요청에 대해 명시적으로 index.html 제공
app.get('/', (req, res) => {
  res.sendFile(indexPath);
});

// API가 아닌 다른 모든 GET 요청도 React 앱으로 라우팅
app.get('*', (req, res) => {
  res.sendFile(indexPath);
});


app.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});
