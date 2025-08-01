import React, { useEffect, useState, useMemo } from 'react';

// --- Components ---

const Toast = ({ message, show, onDismiss }) => {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(onDismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [show, onDismiss]);

  return <div className={`toast ${show ? 'show' : ''}`}>{message}</div>;
};

const PasswordScreen = ({ onSubmit, password, setPassword, error }) => (
  <div className="auth-container">
    <header className="brand">
      <span className="brand-main">taeyang</span>
      <span className="brand-x">X</span>
      <span className="brand-sub">iMate</span>
    </header>
    <form onSubmit={onSubmit} className="auth-form">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter Access Code"
        className="auth-input"
      />
      <button type="submit" className="auth-button">
        Enter
      </button>
    </form>
    {error && <p className="auth-error">{error}</p>}
  </div>
);

const EmailListItem = ({ email, active, onClick }) => (
  <div className={`email-item ${active ? 'active' : ''}`} onClick={onClick}>
    <div className="email-item-from">{email.from.split('<')[0].trim()}</div>
    <div className="email-item-subject">{email.subject}</div>
    <div className="email-item-snippet">{email.snippet}</div>
    {!email.replied && <div className="unread-dot"></div>}
  </div>
);

const ResponseCard = ({ response, onUpdate, onSend, isSending }) => {
  return (
    <div className="response-card">
      <textarea
        className="response-textarea"
        value={response.text}
        onChange={(e) => onUpdate(e.target.value)}
        disabled={isSending}
      />
      <button className="send-btn" onClick={onSend} disabled={isSending}>
        {isSending ? 'Sending...' : 'Send this response'}
      </button>
    </div>
  );
};

const EmailDetail = ({ email, onSendSuccess, showToast }) => {
  const [responses, setResponses] = useState([]);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (email) {
      setResponses(email.aiResponses.map(text => ({ text })));
    }
  }, [email]);

  const handleResponseUpdate = (index, newText) => {
    const newResponses = [...responses];
    newResponses[index].text = newText;
    setResponses(newResponses);
  };

  const handleSend = async (index) => {
    if (!email || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            threadId: email.threadId, 
            messageId: email.messageId, 
            response: responses[index].text 
        })
      });
      if (!res.ok) throw new Error(`Server Error: ${res.status}`);
      showToast('Response sent successfully!');
      onSendSuccess(email.threadId);
    } catch (err) {
      console.error('Failed to send:', err);
      showToast('Failed to send response.');
    } finally {
      setIsSending(false);
    }
  };

  if (!email) {
    return <div className="detail-container placeholder">Select an email to view details.</div>;
  }

  return (
    <div className="detail-container">
      <div className="detail-header">
        <h2>{email.subject}</h2>
        <p>From: {email.from}</p>
      </div>
      <div className="message-history">
        {email.messages.map((msg, index) => (
          <div key={index} className="message-bubble">
             <div className="message-from">{msg.from.split('<')[0].trim()}</div>
             <p>{msg.body}</p>
          </div>
        ))}
      </div>
      <div className="responses-section">
        <h3>AI-Generated Responses</h3>
        {responses.length > 0 ? responses.map((res, idx) => (
          <ResponseCard
            key={idx}
            response={res}
            onUpdate={(newText) => handleResponseUpdate(idx, newText)}
            onSend={() => handleSend(idx)}
            isSending={isSending}
          />
        )) : <p className="error-text">Could not generate AI responses for this email.</p>}
      </div>
    </div>
  );
};

// --- Main App ---

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [unreplied, setUnreplied] = useState([]);
  const [replied, setReplied] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [toast, setToast] = useState({ show: false, message: '' });

  const showToast = (message) => setToast({ show: true, message });

  useEffect(() => {
    if (isAuthenticated) {
      fetchThreads();
    }
  }, [isAuthenticated]);

  const fetchThreads = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/threads');
      if (!res.ok) throw new Error(`Server Error: ${res.status}`);
      const data = await res.json();
      setUnreplied(data.unreplied || []);
      setReplied(data.replied || []);
      if (data.unreplied?.length > 0) {
        setActiveThreadId(data.unreplied[0].threadId);
      } else if (data.replied?.length > 0) {
        setActiveThreadId(data.replied[0].threadId);
      } else {
        setActiveThreadId(null);
      }
    } catch (err) {
      setError('Failed to load email threads. Check server logs.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (password === 'Taeyangtax1!!!') {
      setIsAuthenticated(true);
    } else {
      setAuthError('Incorrect password.');
      setPassword('');
    }
  };
  
  const handleSendSuccess = (sentThreadId) => {
    const sentEmail = unreplied.find(t => t.threadId === sentThreadId);
    if (sentEmail) {
        sentEmail.replied = true;
        setUnreplied(unreplied.filter(t => t.threadId !== sentThreadId));
        setReplied([sentEmail, ...replied]);

        const nextUnreplied = unreplied.filter(t => t.threadId !== sentThreadId);
        if(nextUnreplied.length > 0) {
            setActiveThreadId(nextUnreplied[0].threadId);
        } else if (replied.length > 0) {
            setActiveThreadId(replied[0].threadId);
        } else {
            setActiveThreadId(null);
        }
    }
  };
  
  const filteredUnreplied = useMemo(() => unreplied.filter(e => e.subject.toLowerCase().includes(searchTerm.toLowerCase()) || e.from.toLowerCase().includes(searchTerm.toLowerCase())), [unreplied, searchTerm]);
  const filteredReplied = useMemo(() => replied.filter(e => e.subject.toLowerCase().includes(searchTerm.toLowerCase()) || e.from.toLowerCase().includes(searchTerm.toLowerCase())), [replied, searchTerm]);

  const activeEmail = unreplied.find(t => t.threadId === activeThreadId) || replied.find(t => t.threadId === activeThreadId);

  if (!isAuthenticated) {
    return <PasswordScreen onSubmit={handlePasswordSubmit} password={password} setPassword={setPassword} error={authError} />;
  }
  
  return (
    <>
      <div className="app-container">
        <aside className="sidebar">
          <header className="brand">
            <span className="brand-main">taeyang</span>
            <span className="brand-x">X</span>
            <span className="brand-sub">iMate</span>
          </header>
           <div className="search-bar">
            <input type="text" placeholder="Search emails..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <div className="sidebar-scroll-area">
            <nav className="email-list">
               <h3>Unreplied ({filteredUnreplied.length})</h3>
               {loading ? <p>Loading...</p> : filteredUnreplied.map(email => (
                  <EmailListItem 
                      key={email.threadId} 
                      email={email} 
                      active={email.threadId === activeThreadId}
                      onClick={() => setActiveThreadId(email.threadId)}
                  />
               ))}
               {error && <p className="error-text">{error}</p>}
               { !loading && filteredUnreplied.length === 0 && <p className="empty-list-text">No unreplied emails.</p>}
            </nav>

            <details className="replied-accordion">
              <summary><h3>Replied ({filteredReplied.length})</h3></summary>
              <nav className="email-list replied-list">
                 {filteredReplied.map(email => (
                    <EmailListItem 
                        key={email.threadId} 
                        email={email} 
                        active={email.threadId === activeThreadId}
                        onClick={() => setActiveThreadId(email.threadId)}
                    />
                 ))}
              </nav>
            </details>
          </div>
        </aside>
        <main className="main-content">
          <EmailDetail email={activeEmail} onSendSuccess={handleSendSuccess} showToast={showToast} />
        </main>
      </div>
      <Toast message={toast.message} show={toast.show} onDismiss={() => setToast({ ...toast, show: false })} />
      <GlobalStyles />
    </>
  );
}

// --- Styles ---

const GlobalStyles = () => (
  <style>{`
    :root {
      --bg-dark: #1a1a2e; --bg-light: #16213e; --primary: #0f3460; --secondary: #e94560;
      --text-main: #ffffff; --text-muted: #a7a9be; --border-color: #3d405b;
      --gradient: linear-gradient(120deg, #e94560, #0f3460);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background-color: var(--bg-dark); color: var(--text-main); font-family: 'Inter', sans-serif; }

    .auth-container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
    .auth-form { display: flex; gap: 10px; margin-top: 2rem; }
    .auth-input { background: var(--bg-light); border: 1px solid var(--border-color); color: var(--text-main); padding: 12px 15px; border-radius: 8px; font-size: 1rem; }
    .auth-button { background: var(--gradient); border: none; color: white; padding: 12px 25px; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    .auth-error { color: var(--secondary); margin-top: 1rem; }

    .app-container { display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
    .sidebar { background-color: var(--bg-light); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; height: 100vh; }
    .main-content { overflow-y: auto; }
    .sidebar .brand { padding: 1.5rem; flex-shrink: 0; }
    .search-bar { padding: 0 1.5rem 1rem; }
    .search-bar input { width: 100%; background: var(--primary); border: 1px solid var(--border-color); color: var(--text-main); padding: 10px 12px; border-radius: 6px; }
    .sidebar-scroll-area { overflow-y: auto; flex-grow: 1; padding: 0 1.5rem 1.5rem; }
    .brand { font-size: 1.8rem; font-weight: 700; text-align: center; }
    .brand-main { color: var(--secondary); }
    .brand-x { color: var(--text-muted); margin: 0 4px; }
    .brand-sub { color: #5372f0; }

    .email-list h3 { margin: 0 0 1rem; font-size: 1rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; padding-top: 1rem; }
    .replied-accordion summary { cursor: pointer; }
    .replied-list { margin-top: 1rem; }
    .empty-list-text { color: var(--text-muted); font-style: italic; text-align: center; font-size: 0.9rem; }
    
    .email-item { padding: 1rem; border-radius: 8px; cursor: pointer; border-left: 3px solid transparent; position: relative; }
    .email-item:hover { background-color: var(--primary); }
    .email-item.active { background-color: var(--primary); border-left-color: var(--secondary); }
    .email-item-from, .email-item-subject, .email-item-snippet { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .email-item-from { font-weight: 600; font-size: 0.95rem; color: var(--text-main); }
    .email-item-subject { font-size: 0.9rem; color: var(--text-muted); margin: 4px 0; font-weight: 500;}
    .email-item-snippet { font-size: 0.85rem; color: var(--text-muted); }
    .unread-dot { position: absolute; top: 1rem; right: 1rem; width: 8px; height: 8px; background-color: var(--secondary); border-radius: 50%; }

    .detail-container { padding: 2rem 3rem; }
    .detail-container.placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); }
    .detail-header h2 { margin: 0 0 0.5rem; font-size: 1.5rem; }
    .detail-header p { margin: 0; color: var(--text-muted); }
    
    .message-history { margin-top: 2rem; border-top: 1px solid var(--border-color); padding-top: 2rem; }
    .message-bubble { background-color: var(--primary); padding: 1rem 1.5rem; border-radius: 12px; margin-bottom: 1rem; }
    .message-from { font-weight: bold; margin-bottom: 0.5rem; color: var(--secondary); }
    .message-bubble p { margin: 0; line-height: 1.6; white-space: pre-wrap; }

    .responses-section { margin-top: 2rem; border-top: 1px solid var(--border-color); padding-top: 2rem; }
    .responses-section h3 { margin: 0 0 1.5rem; }

    .response-card { background-color: var(--bg-light); border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 1.5rem; overflow: hidden; }
    .response-textarea { width: 100%; height: 200px; background: transparent; border: none; padding: 1.5rem; color: var(--text-main); font-size: 1rem; line-height: 1.6; resize: vertical; }
    .send-btn { display: block; width: fit-content; margin: 0 1.5rem 1.5rem auto; background: var(--gradient); border: none; color: white; padding: 10px 20px; border-radius: 8px; font-weight: 500; cursor: pointer; }
    .send-btn:disabled { background: #555; cursor: not-allowed; }
    
    .error-text { color: var(--secondary); }

    .toast { position: fixed; bottom: 20px; right: 20px; background-color: #333; color: white; padding: 15px 25px; border-radius: 8px; transform: translateY(120%); transition: transform 0.3s ease-in-out; }
    .toast.show { transform: translateY(0); }

    @media (max-width: 768px) {
      .app-container { grid-template-columns: 1fr; }
      .sidebar { border-right: none; border-bottom: 1px solid var(--border-color); height: 50vh; }
      .main-content { overflow-y: visible; }
      .detail-container { padding: 1.5rem; }
    }
  `}</style>
);

export default App;
