const { google } = require('googleapis');

function getGmailClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
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
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else {
      body = Buffer.from(msgRes.data.payload.body.data, 'base64').toString('utf-8');
    }
    res.json({ email: { id: msgId, from, subject, body } });
  } catch (e) {
    res.status(500).json({ error: 'Gmail API 오류', detail: e.message });
  }
}; 