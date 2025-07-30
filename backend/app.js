// app.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Mock 이메일 데이터
let mockEmail = {
  id: 'email_1',
  from: 'customer@example.com',
  subject: 'ITIN 신청 문의',
  body: '안녕하세요, ITIN 신청 관련해서 문의드립니다.'
};

// Gmail OAuth2 클라이언트 생성 함수
function getGmailClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

// 1. 최신 미응답 메일 1건 반환 (실제 Gmail API)
app.get('/emails', async (req, res) => {
  try {
    const gmail = getGmailClient();
    // 미응답 메일(예: INBOX, is:unread) 1건 조회
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
    // 본문 추출(간단화)
    const headers = msgRes.data.payload.headers;
    const from = headers.find(h => h.name === 'From')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    let body = '';
    if (msgRes.data.payload.parts) {
      const part = msgRes.data.payload.parts.find(p => p.mimeType === 'text/plain');
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else {
      body = Buffer.from(msgRes.data.payload.body.data, 'base64').toString('utf-8');
    }
    res.json({ email: { id: msgId, from, subject, body } });
  } catch (e) {
    res.status(500).json({ error: 'Gmail API 오류', detail: e.message });
  }
});

// 2. Gemini로 응답 3개 생성 (실제 API)
app.post('/generate', async (req, res) => {
  try {
    const { email, examples } = req.body;
    // 프롬프트 생성
    const prompt = `당신은 미국 세무사입니다. 아래 고객 질문에 대해 가능한 자연스럽고 정중한 답변을 3가지 스타일로 작성해주세요.\n\n질문:\n"${email.body}"\n\n이전에 이런 질문에 다음과 같이 답변했습니다:\n1. ${examples?.[0] || ''}\n2. ${examples?.[1] || ''}\n3. ${examples?.[2] || ''}\n\n응답 1:\n응답 2:\n응답 3:`;
    // Gemini API 호출
    const geminiRes = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      },
      {
        params: { key: process.env.GEMINI_API_KEY },
        headers: { 'Content-Type': 'application/json' }
      }
    );
    // Gemini 응답 파싱(3개 분리)
    const text = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const responses = text.split(/응답 \d:/).map(s => s.trim()).filter(Boolean);
    res.json({ responses });
  } catch (e) {
    res.status(500).json({ error: 'Gemini API 오류', detail: e.message });
  }
});

// 3. 선택한 응답을 해당 메일에 회신 (Gmail API)
app.post('/send', async (req, res) => {
  try {
    const { emailId, response } = req.body;
    const gmail = getGmailClient();
    // 원본 메일 정보 조회
    const msgRes = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const from = msgRes.data.payload.headers.find(h => h.name === 'From')?.value;
    const subject = msgRes.data.payload.headers.find(h => h.name === 'Subject')?.value;
    // 회신 메시지 생성
    const raw = Buffer.from(
      `To: ${from}\r\n` +
      `Subject: Re: ${subject}\r\n` +
      `In-Reply-To: ${emailId}\r\n` +
      `References: ${emailId}\r\n` +
      `\r\n${response}`
    ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Gmail 전송 오류', detail: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 