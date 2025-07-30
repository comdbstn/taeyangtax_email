const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 정적 파일 제공 (빌드된 React 앱)
app.use(express.static(path.join(__dirname, 'dist')));

// API 라우트 가져오기
const emailsApi = require('./api/emails');
const generateApi = require('./api/generate');
const sendApi = require('./api/send');

// API 라우트 등록
app.get('/api/emails', emailsApi);
app.post('/api/generate', generateApi);
app.post('/api/send', sendApi);

// React 라우팅을 위한 catch-all handler
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});