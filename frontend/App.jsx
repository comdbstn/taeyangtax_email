import React, { useEffect, useState, useMemo, useRef } from 'react';

// --- Constants ---
const SIGNATURE = `
<br/><br/>
...
`; // (Signature content is omitted for brevity)

// --- Components ---

const Toast = ({ message, show, onDismiss }) => {
  // ... (Component remains the same)
};

const PasswordScreen = ({ onSubmit, password, setPassword, error }) => (
  // ... (Component remains the same)
);

const EmailListItem = ({ email, active, onClick }) => (
  // ... (Component remains the same)
);

const ResponseCard = ({ response, onUpdate, onSend, isSending }) => {
  // ... (Component remains the same)
};

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
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();
            showToast(`'${data.filename}' uploaded successfully.`);
            onUploadSuccess();
        } catch (err) {
            console.error(err);
            showToast('Error uploading file.');
        } finally {
            setIsUploading(false);
            // Reset file input
            if(fileInputRef.current) fileInputRef.current.value = "";
        }
    };
    
    const handleDelete = async (filename) => {
        if (!window.confirm(`Are you sure you want to delete '${filename}'?`)) return;

        try {
            const res = await fetch(`/api/attachments/${filename}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Delete failed');
            showToast(`'${filename}' deleted successfully.`);
            onDeleteSuccess();
        } catch (err) {
            console.error(err);
            showToast('Error deleting file.');
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>Manage Attachments</h2>
                <div className="upload-section">
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{display: 'none'}} id="file-upload" />
                    <button onClick={() => fileInputRef.current.click()} disabled={isUploading} className="modal-button">
                        {isUploading ? 'Uploading...' : 'Upload New File'}
                    </button>
                </div>
                <div className="attachment-list-manager">
                    {attachments.length > 0 ? attachments.map(file => (
                        <div key={file} className="attachment-manager-item">
                            <span>{file}</span>
                            <button onClick={() => handleDelete(file)} className="delete-btn">Delete</button>
                        </div>
                    )) : <p>No attachments found.</p>}
                </div>
                <button onClick={onClose} className="modal-close-button">Close</button>
            </div>
        </div>
    );
};


const EmailDetail = ({ email, attachments, onSendSuccess, showToast }) => {
  // ... (Component remains the same)
};


// --- Main App ---

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [unreplied, setUnreplied] = useState([]);
  const [replied, setReplied] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [toast, setToast] = useState({ show: false, message: '' });
  const [isAttachmentManagerOpen, setAttachmentManagerOpen] = useState(false);

  const showToast = (message) => setToast({ show: true, message });

  useEffect(() => {
    if (isAuthenticated) {
      fetchThreads();
      fetchAttachments();
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

  const fetchAttachments = async () => {
    try {
        const res = await fetch('/api/attachments');
        if(!res.ok) throw new Error('Failed to fetch attachments');
        const data = await res.json();
        setAttachments(data);
    } catch(err) {
        console.error(err);
        showToast('Could not load attachments.');
    }
  }

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
    // ... (Function remains the same)
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
          {/* Header and Search */}
          <div className="sidebar-header">
             <header className="brand">
                <span className="brand-main">taeyang</span>
                <span className="brand-x">X</span>
                <span className="brand-sub">iMate</span>
              </header>
               <div className="search-bar">
                <input type="text" placeholder="Search emails..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
          </div>
          {/* Scrollable Email List */}
          <div className="sidebar-scroll-area">
            {/* Unreplied and Replied Lists */}
          </div>
          {/* Sidebar Footer */}
          <div className="sidebar-footer">
            <button className="manage-attachments-btn" onClick={() => setAttachmentManagerOpen(true)}>
                Manage Files
            </button>
          </div>
        </aside>
        <main className="main-content">
          <EmailDetail email={activeEmail} attachments={attachments} onSendSuccess={handleSendSuccess} showToast={showToast} />
        </main>
      </div>

      {isAttachmentManagerOpen && (
        <AttachmentManager 
            attachments={attachments}
            onClose={() => setAttachmentManagerOpen(false)}
            onUploadSuccess={fetchAttachments}
            onDeleteSuccess={fetchAttachments}
            showToast={showToast}
        />
      )}

      <Toast message={toast.message} show={toast.show} onDismiss={() => setToast({ ...toast, show: false })} />
      <GlobalStyles />
    </>
  );
}

// --- Styles ---

const GlobalStyles = () => (
  <style>{`
    /* ... (Existing styles are omitted for brevity, but we add new modal styles) */
    
    .sidebar {
        display: flex;
        flex-direction: column;
        /* ... existing styles */
    }
    .sidebar-header {
        flex-shrink: 0;
    }
    .sidebar-scroll-area {
        flex-grow: 1;
        overflow-y: auto;
        /* ... existing styles */
    }
    .sidebar-footer {
        flex-shrink: 0;
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--border-color);
    }
    .manage-attachments-btn {
        width: 100%;
        padding: 12px;
        background-color: var(--primary);
        border: 1px solid var(--border-color);
        color: var(--text-main);
        border-radius: 8px;
        cursor: pointer;
        text-align: center;
        font-weight: 500;
    }
    .manage-attachments-btn:hover {
        background-color: #0f3460;
    }

    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    .modal-content {
        background-color: var(--bg-light);
        padding: 2rem;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        border: 1px solid var(--border-color);
    }
    .modal-content h2 {
        margin-top: 0;
    }
    .attachment-list-manager {
        margin-top: 1.5rem;
        max-height: 300px;
        overflow-y: auto;
        padding-right: 10px;
    }
    .attachment-manager-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem;
        background-color: var(--primary);
        border-radius: 6px;
        margin-bottom: 0.5rem;
    }
    .delete-btn {
        background-color: var(--secondary);
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
    }
    .modal-button, .modal-close-button {
        width: 100%;
        padding: 12px;
        border-radius: 8px;
        border: none;
        font-weight: 500;
        cursor: pointer;
        margin-top: 1rem;
    }
    .modal-button {
        background: var(--gradient);
        color: white;
    }
    .modal-close-button {
        background-color: #555;
        color: white;
    }
    
  `}</style>
);

export default App;
// NOTE: I have omitted some repeated component code for brevity (Toast, PasswordScreen, etc.)
// and some repeated style definitions. The new styles for the modal and sidebar footer are included.
// The structure of the main App component is shown with the new additions.
