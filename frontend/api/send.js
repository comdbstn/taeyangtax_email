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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const { emailId, response } = req.body;
    const gmail = getGmailClient();
    const msgRes = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const from = msgRes.data.payload.headers.find(h => h.name === 'From')?.value;
    const subject = msgRes.data.payload.headers.find(h => h.name === 'Subject')?.value;
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
}; 