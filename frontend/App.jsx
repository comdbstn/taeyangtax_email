import React, { useEffect, useState } from 'react';

function App() {
  const [email, setEmail] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sentIdx, setSentIdx] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (password === 'Taeyangtax1!!!') {
      setIsAuthenticated(true);
      setAuthError('');
    } else {
      setAuthError('비밀번호가 올바르지 않습니다.');
    }
  };

  // 이메일 불러오기 함수
  const fetchEmail = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/emails');
      if (!res.ok) {
        throw new Error(`서버 오류: ${res.status}`);
      }
      const data = await res.json();
      if (data.email) {
        setEmail(data.email);
      } else {
        setError('새로운 이메일이 없습니다.');
      }
    } catch (err) {
      console.error('이메일 로딩 실패:', err);
      setError('이메일을 불러오는 데 실패했습니다. 서버 로그를 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  // 앱 시작 시 이메일 1회 불러오기
  useEffect(() => {
    if (isAuthenticated) {
      fetchEmail();
    }
  }, [isAuthenticated]);

  // AI 답변 생성 함수
  const generateResponses = async () => {
    if (!email) {
      setError('답변을 생성할 이메일이 없습니다.');
      return;
    }
    setLoading(true);
    setError('');
    setResponses([]); // 이전 답변 초기화
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          examples: [
            "ITIN 신청은 IRS(미국 국세청)에서 발급하는 개인 납세자 식별번호입니다...",
            "안녕하세요. ITIN 관련 문의 감사합니다...",
            "고객님, ITIN 신청 절차는 다음과 같습니다..."
          ]
        })
      });
      if (!res.ok) {
        throw new Error(`서버 오류: ${res.status}`);
      }
      const data = await res.json();
      setResponses(data.responses || []);
    } catch (err) {
      console.error('답변 생성 실패:', err);
      setError('AI 답변을 생성하는 데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 답변 전송 함수
  const sendResponse = async (idx) => {
    if (!email) return;
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId: email.id, response: responses[idx] })
      });
      if (!res.ok) {
        throw new Error(`서버 오류: ${res.status}`);
      }
      setSentIdx(idx);
    } catch (err) {
      console.error('전송 실패:', err);
      setError('답변을 전송하는 데 실패했습니다.');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <header className="brand">
          <span className="brand-main">taeyang</span>
          <span className="brand-x"> X </span>
          <span className="brand-sub">iMate</span>
        </header>
        <form onSubmit={handlePasswordSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호를 입력하세요"
            style={{ padding: '10px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #ccc', marginRight: '10px' }}
          />
          <button type="submit" className="main-btn" style={{ width: 'auto', padding: '10px 20px' }}>
            입장
          </button>
        </form>
        {authError && <p style={{ color: 'red', marginTop: '10px' }}>{authError}</p>}
        <style>{`
          body { margin: 0; background: #f8fafc; }
          .container { max-width: 700px; margin: 0 auto; padding: 24px 12px 48px 12px; font-family: 'Pretendard', sans-serif; min-height: 100vh; }
          .brand { display: flex; justify-content: center; align-items: center; font-size: 2rem; font-weight: 700; margin-bottom: 32px; letter-spacing: 1px; }
          .brand-main { color: #ffb300; }
          .brand-x { color: #888; margin: 0 8px; }
          .brand-sub { color: #1976d2; }
          .main-btn { background: linear-gradient(90deg, #ffb300 0%, #1976d2 100%); color: #fff; border: none; border-radius: 8px; font-size: 1.1rem; font-weight: 600; cursor: pointer; }
        `}</style>
      </div>
    );
  }

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
          {loading && !email && '이메일 로딩 중...'}
          {email && `[${email.from}] ${email.subject}`}
          <p style={{ marginTop: '10px', whiteSpace: 'pre-wrap' }}>{email?.body}</p>
        </section>

        {error && <div className="error-card">{error}</div>}

        <button className="main-btn" onClick={generateResponses} disabled={loading || !email}>
          {loading && responses.length === 0 ? '생성 중...' : 'AI 답변 3개 생성'}
        </button>

        <div className="responses">
          {responses.map((resp, idx) => (
            <div key={idx} className="response-card">
              <div className="response-text" style={{ whiteSpace: 'pre-wrap' }}>{resp}</div>
              <button className="send-btn" onClick={() => sendResponse(idx)} disabled={sentIdx === idx}>
                {sentIdx === idx ? '전송 완료' : '전송'}
              </button>
            </div>
          ))}
        </div>
      </main>
      <style>{`
        /* ... 기존 스타일 유지 ... */
        body { margin: 0; background: #f8fafc; }
        .container { max-width: 700px; margin: 0 auto; padding: 24px 12px 48px 12px; font-family: 'Pretendard', sans-serif; min-height: 100vh; }
        .brand { display: flex; justify-content: center; align-items: center; font-size: 2rem; font-weight: 700; margin-bottom: 32px; letter-spacing: 1px; }
        .brand-main { color: #ffb300; }
        .brand-x { color: #888; margin: 0 8px; }
        .brand-sub { color: #1976d2; }
        h2 { font-size: 1.1rem; color: #222; margin-bottom: 10px; }
        p { margin: 0; }
        .email-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 20px 16px; margin-bottom: 24px; font-size: 1rem; color: #333; word-break: break-all; line-height: 1.6; }
        .error-card { background: #ffebee; color: #c62828; border-radius: 12px; padding: 20px 16px; margin-bottom: 24px; }
        .main-btn { width: 100%; background: linear-gradient(90deg, #ffb300 0%, #1976d2 100%); color: #fff; border: none; border-radius: 8px; padding: 14px 0; font-size: 1.1rem; font-weight: 600; margin-bottom: 24px; cursor: pointer; transition: background 0.2s; }
        .main-btn:disabled { background: #eee; color: #aaa; cursor: not-allowed; }
        .responses { display: flex; flex-direction: column; gap: 16px; }
        .response-card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.03); padding: 16px 12px 12px 12px; display: flex; flex-direction: column; align-items: flex-start; }
        .response-text { font-size: 0.98rem; color: #222; margin-bottom: 10px; line-height: 1.6; width: 100%; }
        .send-btn { align-self: flex-end; background: #1976d2; color: #fff; border: none; border-radius: 6px; padding: 7px 18px; font-size: 0.98rem; font-weight: 500; cursor: pointer; transition: background 0.2s; }
        .send-btn:disabled { background: #bbb; color: #eee; cursor: not-allowed; }
        @media (max-width: 600px) { .container { padding: 12px 2vw 32px 2vw; } .brand { font-size: 1.3rem; margin-bottom: 20px; } .email-card, .response-card { padding: 12px 7px; font-size: 0.97rem; } .main-btn { font-size: 1rem; padding: 10px 0; } }
      `}</style>
    </div>
  );
}

export default App;
