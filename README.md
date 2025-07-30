# 초간단 이메일 자동응답 웹앱 (MVP)

## 📦 구조

- backend/ : Node.js Express API 서버
- frontend/ : React (Vite) 단일 페이지 앱

## ⚡ 빠른 시작

### 1. 백엔드 실행
```bash
cd backend
cp .env.example .env # 환경변수 입력
npm install
node app.js
```

### 2. 프론트엔드 실행
```bash
cd frontend
npm install
npm run dev
```

### 3. 필요한 정보 입력
- backend/.env : Gmail, Gemini API 키/토큰 입력
- 기존 답변 예시: Gemini 프롬프트에 삽입 (코드 내 주석 참고)

## 🧠 Gemini 프롬프트 예시

```
당신은 미국 세무사입니다. 아래 고객 질문에 대해 가능한 자연스럽고 정중한 답변을 3가지 스타일로 작성해주세요.

질문:
"안녕하세요, ITIN 발급과 관련해 절차와 비용이 궁금합니다."

이전에 이런 질문에 다음과 같이 답변했습니다:
1. ...
2. ...
3. ...

응답 1:
응답 2:
응답 3:
```

## ✨ 실제 연동 시
- app.js 내 Gemini/Gmail 연동 부분에 API 키/토큰 입력
- 프론트엔드/백엔드 포트 및 proxy 설정 확인

---
문의/키 입력 후 실제 연동 가이드 필요시 언제든 요청! 