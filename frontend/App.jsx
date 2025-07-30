import React, { useEffect, useState } from 'react';

function App() {
  const [email, setEmail] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sentIdx, setSentIdx] = useState(null);

  useEffect(() => {
    fetch('/api/emails')
      .then(res => res.json())
      .then(data => setEmail(data.email));
  }, []);

  const generateResponses = () => {
    setLoading(true);
    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email,
        examples: [
          "ITIN 신청은 IRS(미국 국세청)에서 발급하는 개인 납세자 식별번호입니다. 필요 서류는 W-7 양식, 신분증명서류, 세금보고 필요성을 증명하는 서류입니다. 처리기간은 약 7-11주 소요되며, 수수료는 없습니다.",
          "안녕하세요. ITIN 관련 문의 감사합니다. ITIN은 사회보장번호가 없는 분들이 세금보고를 위해 발급받는 번호입니다. 신청 절차와 필요서류에 대해 자세히 안내해드리겠습니다.",
          "고객님, ITIN 신청 절차는 다음과 같습니다. 1) W-7 양식 작성 2) 신분증명서류 준비 3) 세금보고 필요성 증명서류 첨부 4) IRS 제출. 자세한 상담을 원하시면 언제든 연락주세요."
        ]
      })
    })
      .then(res => res.json())
      .then(data => {
        setResponses(data.responses);
        setLoading(false);
      });
  };

  const sendResponse = (idx) => {
    fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailId: email.id, response: responses[idx] })
    })
      .then(res => res.json())
      .then(() => setSentIdx(idx));
  };

  return (
    <div className="container">
      <header className="brand">
        <span className="brand-main">taeyang</span>
        <span className="brand-x"> X </span>
        <span className="brand-sub">iMate</span>
      </header>
      <main>
        <h2>고객 이메일 본문</h2>
        <section className="email-card">
          {email ? email.body : '로딩 중...'}
        </section>
        <button className="main-btn" onClick={generateResponses} disabled={loading || !email}>
          {loading ? '생성 중...' : 'AI 답변 3개 생성'}
        </button>
        <div className="responses">
          {responses.map((resp, idx) => (
            <div key={idx} className="response-card">
              <div className="response-text">{resp}</div>
              <button className="send-btn" onClick={() => sendResponse(idx)} disabled={sentIdx === idx}>
                {sentIdx === idx ? '전송 완료' : '전송'}
              </button>
            </div>
          ))}
        </div>
      </main>
      <style>{`
        .container {
          max-width: 480px;
          margin: 0 auto;
          padding: 24px 12px 48px 12px;
          font-family: 'Pretendard', 'Noto Sans KR', Arial, sans-serif;
          background: #f8fafc;
          min-height: 100vh;
        }
        .brand {
          display: flex;
          justify-content: center;
          align-items: center;
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 32px;
          letter-spacing: 1px;
        }
        .brand-main {
          color: #ffb300;
        }
        .brand-x {
          color: #888;
          margin: 0 8px;
        }
        .brand-sub {
          color: #1976d2;
        }
        h2 {
          font-size: 1.1rem;
          color: #222;
          margin-bottom: 10px;
        }
        .email-card {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          padding: 20px 16px;
          margin-bottom: 24px;
          font-size: 1rem;
          color: #333;
          word-break: break-all;
        }
        .main-btn {
          width: 100%;
          background: linear-gradient(90deg, #ffb300 0%, #1976d2 100%);
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 14px 0;
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 24px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .main-btn:disabled {
          background: #eee;
          color: #aaa;
          cursor: not-allowed;
        }
        .responses {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .response-card {
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.03);
          padding: 16px 12px 12px 12px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .response-text {
          font-size: 0.98rem;
          color: #222;
          margin-bottom: 10px;
          line-height: 1.6;
        }
        .send-btn {
          align-self: flex-end;
          background: #1976d2;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 7px 18px;
          font-size: 0.98rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }
        .send-btn:disabled {
          background: #bbb;
          color: #eee;
          cursor: not-allowed;
        }
        @media (max-width: 600px) {
          .container {
            max-width: 100vw;
            padding: 12px 2vw 32px 2vw;
          }
          .brand {
            font-size: 1.3rem;
            margin-bottom: 20px;
          }
          .email-card, .response-card {
            padding: 12px 7px;
            font-size: 0.97rem;
          }
          .main-btn {
            font-size: 1rem;
            padding: 10px 0;
          }
        }
      `}</style>
    </div>
  );
}

export default App; 