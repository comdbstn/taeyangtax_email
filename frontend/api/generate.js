const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const { email, examples } = req.body;
    const prompt = `당신은 미국 세무사입니다. 아래 고객 질문에 대해 가능한 자연스럽고 정중한 답변을 3가지 스타일로 작성해주세요.\n\n질문:\n"${email.body}"\n\n이전에 이런 질문에 다음과 같이 답변했습니다:\n1. ${examples?.[0] || ''}\n2. ${examples?.[1] || ''}\n3. ${examples?.[2] || ''}\n\n응답 1:\n응답 2:\n응답 3:`;
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
    const text = geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const responses = text.split(/응답 \d:/).map(s => s.trim()).filter(Boolean);
    res.json({ responses });
  } catch (e) {
    res.status(500).json({ error: 'Gemini API 오류', detail: e.message });
  }
}; 