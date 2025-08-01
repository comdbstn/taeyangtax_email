import React, { useEffect, useState, useMemo, useRef } from 'react';

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
    <header className="brand"><span className="brand-main">taeyang</span><span className="brand-x">X</span><span className="brand-sub">iMate</span></header>
    <form onSubmit={onSubmit} className="auth-form">
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter Access Code" className="auth-input"/>
      <button type="submit" className="auth-button">Enter</button>
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

const ResponseCard = ({ response, onUpdate, onSend, isSending }) => (
    <div className="response-card">
      <div className="response-card-header">
        {response.type && <span className="response-type-tag">{response.type}</span>}
      </div>
      <input
        type="text"
        className="response-subject-input"
        value={response.subject}
        onChange={(e) => onUpdate('subject', e.target.value)}
        disabled={isSending}
        placeholder="Email Subject"
      />
      <textarea
        className="response-textarea"
        value={response.body}
        onChange={(e) => onUpdate('body', e.target.value)}
        disabled={isSending}
        placeholder="Email Body"
      />
      <button className="send-btn" onClick={onSend} disabled={isSending}>{isSending ? 'Sending...' : 'Send this response'}</button>
    </div>
);

const AttachmentManager = ({ attachments, onClose, onUploadSuccess, onDeleteSuccess, showToast }) => {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef(null);
    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setIsUploading(true);
        const formData = new FormData();
        formData.append('attachment', file);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();
            showToast(`'${data.filename}' uploaded.`);
            onUploadSuccess();
        } catch (err) { showToast('Error uploading file.'); } 
        finally { setIsUploading(false); if(fileInputRef.current) fileInputRef.current.value = ""; }
    };
    const handleDelete = async (filename) => {
        if (!window.confirm(`Delete '${filename}'?`)) return;
        try {
            const res = await fetch(`/api/attachments/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            showToast(`'${filename}' deleted.`);
            onDeleteSuccess();
        } catch (err) { showToast('Error deleting file.'); }
    };
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>Manage Attachments</h2>
                <div className="upload-section">
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{display: 'none'}} id="file-upload" />
                    <button onClick={() => fileInputRef.current.click()} disabled={isUploading} className="modal-button">{isUploading ? 'Uploading...' : 'Upload New File'}</button>
                </div>
                <div className="attachment-list-manager">
                    {attachments.length > 0 ? attachments.map(file => (
                        <div key={file} className="attachment-manager-item">
                            <span>{file}</span>
                            <button onClick={() => handleDelete(file)} className="delete-btn">Delete</button>
                        </div>
                    )) : <p className='empty-list-text'>No attachments found.</p>}
                </div>
                <button onClick={onClose} className="modal-close-button">Close</button>
            </div>
        </div>
    );
};

const EmailDetail = ({ email, attachments, onSendSuccess, showToast, signature }) => {
  const [responses, setResponses] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [selectedAttachments, setSelectedAttachments] = useState({});
  
  useEffect(() => {
    if (email && email.aiResponses) {
      setResponses(email.aiResponses);
      setSelectedAttachments({}); 
    }
  }, [email]);

  const handleAttachmentChange = (fileName) => setSelectedAttachments(prev => ({ ...prev, [fileName]: !prev[fileName] }));
  
  const handleResponseUpdate = (index, field, value) => {
    const newResponses = [...responses];
    newResponses[index] = { ...newResponses[index], [field]: value };
    setResponses(newResponses);
  };

  const handleSend = async (index) => {
    if (!email || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: email.threadId, messageId: email.messageId,
          response: responses[index],
          attachments: Object.keys(selectedAttachments).filter(key => selectedAttachments[key])
        })
      });
      if (!res.ok) throw new Error('Server returned an error');
      showToast('Response sent successfully!');
      onSendSuccess(email.threadId);
    } catch (err) { showToast('Failed to send response.'); } 
    finally { setIsSending(false); }
  };

  if (!email) return <div className="detail-container placeholder">Select an email to view details.</div>;
  
  // A simple way to check if the sender is "me" (Taeyang Tax)
  const isFromMe = (from) => /taeyang/i.test(from) || /info@/i.test(from);

  return (
    <div className="detail-container">
      <div className="detail-header">
        <h2>{email.subject}</h2>
        <p>From: {email.from}</p>
      </div>
      <div className="message-history">
        {email.messages.map((msg, index) => {
            const fromMe = isFromMe(msg.from);
            return (
                <div key={index} className={`message-container ${fromMe ? 'sent' : 'received'}`}>
                    <div className="message-bubble">
                        <div className="message-from">{msg.from.split('<')[0].trim()}</div>
                        <p>{msg.body}</p>
                    </div>
                </div>
            )
        })}
      </div>
      <div className="responses-section">
        <h3>AI-Generated Response(s)</h3>
        {responses.length > 0 ? responses.map((res, idx) => (
          <ResponseCard key={idx} response={res} onUpdate={(field, value) => handleResponseUpdate(idx, field, value)} onSend={() => handleSend(idx)} isSending={isSending}/>
        )) : <p className="error-text">Could not generate AI response for this email.</p>}
      </div>
      <div className="attachments-section">
        <h3>Common Attachments</h3>
        {attachments.length > 0 ? (
          <div className="attachments-grid">
            {attachments.map(file => (
              <div key={file} className="attachment-item">
                <input type="checkbox" id={`att-${file}`} checked={!!selectedAttachments[file]} onChange={() => handleAttachmentChange(file)} disabled={isSending}/>
                <label htmlFor={`att-${file}`}>{file}</label>
              </div>
            ))}
          </div>
        ) : <p className="empty-list-text">No common attachments found.</p>}
      </div>
       <div className="signature-preview-section">
            <h3>Signature Preview</h3>
            <div className="signature-box" dangerouslySetInnerHTML={{ __html: signature }} />
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
  const [attachments, setAttachments] = useState([]);
  const [signature, setSignature] = useState('');
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState({ show: false, message: '' });
  const [isAttachmentManagerOpen, setAttachmentManagerOpen] = useState(false);
  const [showAllReplied, setShowAllReplied] = useState(false);


  const showToast = (message) => setToast({ show: true, message });

  useEffect(() => {
    if (isAuthenticated) {
      fetchThreads();
      fetchAttachments();
      fetchSignature();
    }
  }, [isAuthenticated]);

  const fetchThreads = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/threads');
      const data = await res.json();
      setUnreplied(data.unreplied || []);
      setReplied(data.replied || []);
      if (data.unreplied?.length > 0) setActiveThreadId(data.unreplied[0].threadId);
      else if (data.replied?.length > 0) setActiveThreadId(data.replied[0].threadId);
      else setActiveThreadId(null);
    } catch (err) { setError('Failed to load email threads.'); } 
    finally { setLoading(false); }
  };

  const fetchAttachments = async () => {
    try {
        const res = await fetch('/api/attachments');
        setAttachments(await res.json());
    } catch(err) { showToast('Could not load attachments.'); }
  }

  const fetchSignature = async () => {
    try {
        const res = await fetch('/api/signature');
        const data = await res.json();
        setSignature(data.signature);
    } catch(err) { showToast('Could not load signature.'); }
  }

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (password === 'Taeyangtax1!!!') setIsAuthenticated(true);
    else { setAuthError('Incorrect password.'); setPassword(''); }
  };
  
  const handleSendSuccess = (sentThreadId) => {
    setUnreplied(prevUnreplied => {
      const newUnreplied = prevUnreplied.filter(t => t.threadId !== sentThreadId);
      const sentEmail = unreplied.find(t => t.threadId === sentThreadId);

      if (sentEmail) {
        sentEmail.replied = true;
        setReplied(prevReplied => [sentEmail, ...prevReplied]);
      }

      if (newUnreplied.length > 0) {
        setActiveThreadId(newUnreplied[0].threadId);
      } else {
        setActiveThreadId(sentEmail ? sentEmail.threadId : null);
      }
      
      return newUnreplied;
    });
  };
  
  const filteredUnreplied = useMemo(() => unreplied.filter(e => e.subject.toLowerCase().includes(searchTerm.toLowerCase()) || e.from.toLowerCase().includes(searchTerm.toLowerCase())), [unreplied, searchTerm]);
  const filteredReplied = useMemo(() => replied.filter(e => e.subject.toLowerCase().includes(searchTerm.toLowerCase()) || e.from.toLowerCase().includes(searchTerm.toLowerCase())), [replied, searchTerm]);
  const activeEmail = unreplied.find(t => t.threadId === activeThreadId) || replied.find(t => t.threadId === activeThreadId);

  const displayedReplied = showAllReplied ? filteredReplied : filteredReplied.slice(0, 5);

  if (!isAuthenticated) return <PasswordScreen onSubmit={handlePasswordSubmit} password={password} setPassword={setPassword} error={authError} />;

  return (
    <>
      <div className="app-container">
        <aside className="sidebar">
          <div className="sidebar-header">
             <header className="brand"><span className="brand-main">taeyang</span><span className="brand-x">X</span><span className="brand-sub">iMate</span></header>
             <div className="search-bar"><input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
            </div>
          <div className="sidebar-scroll-area">
            <nav className="email-list">
               <h3>Unreplied ({filteredUnreplied.length})</h3>
               {loading ? <p>Loading...</p> : filteredUnreplied.map(email => (<EmailListItem key={email.threadId} email={email} active={email.threadId === activeThreadId} onClick={() => setActiveThreadId(email.threadId)}/>))}
               {error && <p className="error-text">{error}</p>}
               {!loading && filteredUnreplied.length === 0 && <p className="empty-list-text">No unreplied emails.</p>}
            </nav>
            <details className="replied-accordion" open>
              <summary><h3>Replied ({filteredReplied.length})</h3></summary>
              <nav className="email-list replied-list">
                {displayedReplied.map(email => (<EmailListItem key={email.threadId} email={email} active={email.threadId === activeThreadId} onClick={() => setActiveThreadId(email.threadId)}/>))}
              </nav>
              {filteredReplied.length > 5 && !showAllReplied && (
                <button className="show-more-btn" onClick={() => setShowAllReplied(true)}>Show More</button>
              )}
            </details>
        </div>
          <div className="sidebar-footer"><button className="manage-attachments-btn" onClick={() => setAttachmentManagerOpen(true)}>Manage Files</button></div>
        </aside>
        <main className="main-content"><EmailDetail email={activeEmail} attachments={attachments} onSendSuccess={handleSendSuccess} showToast={showToast} signature={signature} /></main>
    </div>
      {isAttachmentManagerOpen && <AttachmentManager attachments={attachments} onClose={() => setAttachmentManagerOpen(false)} onUploadSuccess={fetchAttachments} onDeleteSuccess={fetchAttachments} showToast={showToast} />}
      <Toast message={toast.message} show={toast.show} onDismiss={() => setToast({ ...toast, show: false })} />
      <GlobalStyles />
    </>
  );
}

// --- Styles ---
const GlobalStyles = () => (
  <style>{`
    :root { --bg-dark: #1a1a2e; --bg-light: #16213e; --primary: #0f3460; --secondary: #e94560; --text-main: #ffffff; --text-muted: #a7a9be; --border-color: #3d405b; --gradient: linear-gradient(120deg, #e94560, #0f3460); }
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
    .brand { font-size: 1.8rem; font-weight: 700; text-align: center; }
    .brand-main { color: var(--secondary); }
    .brand-x { color: var(--text-muted); margin: 0 4px; }
    .brand-sub { color: #5372f0; }
    .email-list h3 { margin: 0 0 1rem; font-size: 1rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; padding-top: 1rem; }
    .replied-accordion summary { cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .empty-list-text { color: var(--text-muted); font-style: italic; text-align: center; font-size: 0.9rem; padding: 1rem 0; }
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
    .message-history { margin-top: 2rem; border-top: 1px solid var(--border-color); padding-top: 2rem; }
    
    .message-container { display: flex; margin-bottom: 1rem; }
    .message-container.sent { justify-content: flex-end; }
    .message-container.received { justify-content: flex-start; }
    .message-bubble { max-width: 70%; padding: 1rem 1.5rem; border-radius: 12px; }
    .message-container.received .message-bubble { background-color: var(--primary); }
    .message-container.sent .message-bubble { background-color: #2c3e50; }
    
    .message-from { font-weight: bold; margin-bottom: 0.5rem; color: var(--secondary); }
    .message-bubble p { margin: 0; line-height: 1.6; white-space: pre-wrap; }
    .responses-section, .attachments-section, .signature-preview-section { margin-top: 2rem; border-top: 1px solid var(--border-color); padding-top: 2rem; }
    .responses-section h3, .attachments-section h3, .signature-preview-section h3 { margin: 0 0 1.5rem; }
    .attachments-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .attachment-item { display: flex; align-items: center; gap: 10px; background-color: var(--primary); padding: 10px; border-radius: 6px; }
    .attachment-item label { cursor: pointer; }
    .signature-box { border: 1px solid var(--border-color); padding: 1rem; border-radius: 8px; background-color: var(--bg-light); }
    .response-card { background-color: var(--bg-light); border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 1.5rem; overflow: hidden; }
    .response-card-header { padding: 0.75rem 1.5rem; background-color: rgba(0,0,0,0.2); }
    .response-type-tag { font-size: 0.8rem; font-weight: 500; background-color: var(--secondary); color: white; padding: 4px 8px; border-radius: 4px; }
    .response-subject-input { width: 100%; background: transparent; border: none; border-bottom: 1px solid var(--border-color); padding: 1.2rem 1.5rem; color: var(--text-main); font-size: 1.1rem; font-weight: 500; }
    .response-textarea { width: 100%; height: 200px; background: transparent; border: none; padding: 1.5rem; color: var(--text-main); font-size: 1rem; line-height: 1.6; resize: vertical; }
    .send-btn { display: block; width: fit-content; margin: 0 1.5rem 1.5rem auto; background: var(--gradient); border: none; color: white; padding: 10px 20px; border-radius: 8px; font-weight: 500; cursor: pointer; }
    .send-btn:disabled { background: #555; cursor: not-allowed; }
    .error-text { color: var(--secondary); }
    .toast { position: fixed; bottom: 80px; right: 20px; background-color: #333; color: white; padding: 15px 25px; border-radius: 8px; transform: translateY(120%); transition: transform 0.3s ease-in-out; z-index: 2000; }
    .toast.show { transform: translateY(0); }
    .sidebar-header, .sidebar-footer { flex-shrink: 0; }
    .sidebar-scroll-area { flex-grow: 1; overflow-y: auto; padding: 0 1.5rem 1.5rem; }
    .sidebar-footer { padding: 1rem 1.5rem; border-top: 1px solid var(--border-color); }
    .manage-attachments-btn { width: 100%; padding: 12px; background-color: var(--primary); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 8px; cursor: pointer; text-align: center; font-weight: 500; }
    .manage-attachments-btn:hover { background-color: #0f3460; }
    .show-more-btn { background: none; border: 1px solid var(--border-color); color: var(--text-muted); display: block; width: calc(100% - 2rem); margin: 1rem auto 0; padding: 8px; border-radius: 6px; cursor: pointer; text-align: center; }
    .show-more-btn:hover { background-color: var(--primary); color: var(--text-main); }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-content { background-color: var(--bg-light); padding: 2rem; border-radius: 12px; width: 90%; max-width: 500px; border: 1px solid var(--border-color); }
    .modal-content h2 { margin-top: 0; }
    .attachment-list-manager { margin-top: 1.5rem; max-height: 300px; overflow-y: auto; padding-right: 10px; }
    .attachment-manager-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background-color: var(--primary); border-radius: 6px; margin-bottom: 0.5rem; }
    .delete-btn { background-color: var(--secondary); color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
    .modal-button, .modal-close-button { width: 100%; padding: 12px; border-radius: 8px; border: none; font-weight: 500; cursor: pointer; margin-top: 1rem; }
    .modal-button { background: var(--gradient); color: white; }
    .modal-close-button { background-color: #555; color: white; }
    @media (max-width: 768px) { .app-container { grid-template-columns: 1fr; } .sidebar { height: 50vh; } .toast { bottom: 20px; } }
  `}</style>
);

export default App;
