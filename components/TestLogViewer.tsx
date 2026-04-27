/**
 * Test Log Viewer - Display and manage AI/Dev conversation logs
 */
import React, { useState, useEffect } from 'react';
import { 
  useTestLogStore, 
  TestLogEntry, 
  TestLogSession,
  formatSessionAsText,
  copyToClipboard 
} from '@/lib/test-log-store';
import { getAuth } from 'firebase/auth';

interface TestLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const getEntryIcon = (type: TestLogEntry['type']) => {
  switch (type) {
    case 'user': return 'ph-user';
    case 'ai': return 'ph-robot';
    case 'dev': return 'ph-code';
    case 'system': return 'ph-gear';
    case 'error': return 'ph-warning';
    default: return 'ph-circle';
  }
};

const getEntryColor = (type: TestLogEntry['type']) => {
  switch (type) {
    case 'user': return '#3b82f6';
    case 'ai': return '#d946ef';
    case 'dev': return '#10b981';
    case 'system': return '#6b7280';
    case 'error': return '#ef4444';
    default: return '#9ca3af';
  }
};

export default function TestLogViewer({ isOpen, onClose }: TestLogViewerProps) {
  const [activeSession, setActiveSession] = useState<TestLogSession | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { 
    sessions, 
    currentSession, 
    isLogging,
    startSession, 
    endSession, 
    addEntry,
    saveToFirebase, 
    loadSessions,
    clearSessions 
  } = useTestLogStore();

  const user = getAuth().currentUser;

  // Load sessions when opened
  useEffect(() => {
    if (isOpen && user) {
      void loadSessions(user.uid);
    }
  }, [isOpen, user, loadSessions]);

  const handleCopySession = async (session: TestLogSession) => {
    const text = formatSessionAsText(session);
    const success = await copyToClipboard(text);
    setCopySuccess(success);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleCopyEntry = async (entry: TestLogEntry) => {
    const text = `[${entry.type.toUpperCase()}] ${entry.content}`;
    const success = await copyToClipboard(text);
    setCopySuccess(success);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleSaveToFirebase = async () => {
    if (!user) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveToFirebase(user.uid);
      await loadSessions(user.uid);
    } catch (err) {
      setSaveError('Failed to save logs');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyAll = async () => {
    const allSessions = [...sessions];
    if (currentSession) allSessions.push(currentSession);
    
    if (allSessions.length === 0) return;
    
    const text = allSessions.map(formatSessionAsText).join('\n\n' + '='.repeat(50) + '\n\n');
    const success = await copyToClipboard(text);
    setCopySuccess(success);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (!isOpen) return null;

  const displaySessions = currentSession 
    ? [...sessions, currentSession]
    : sessions;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.container} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Test Log Viewer</h2>
          <div style={styles.headerActions}>
            {isLogging && (
              <span style={styles.recordingBadge}>
                <span style={styles.recordingDot} /> Recording
              </span>
            )}
            <button 
              style={styles.headerBtn}
              onClick={handleCopyAll}
              disabled={displaySessions.length === 0}
              title="Copy all logs"
            >
              <i className="ph ph-copy" style={styles.icon}></i>
            </button>
            <button 
              style={styles.headerBtn}
              onClick={handleSaveToFirebase}
              disabled={isSaving || displaySessions.length === 0}
              title="Save to Firebase"
            >
              <i className={isSaving ? "ph ph-spinner animate-spin" : "ph ph-cloud-arrow-up"} style={styles.icon}></i>
            </button>
            <button style={styles.headerBtn} onClick={onClose}>
              <i className="ph ph-x" style={styles.icon}></i>
            </button>
          </div>
        </div>

        {/* Controls */}
        <div style={styles.controls}>
          {!isLogging ? (
            <button style={styles.primaryBtn} onClick={() => startSession()}>
              <i className="ph ph-record" style={styles.btnIcon}></i>
              Start Recording
            </button>
          ) : (
            <button style={styles.dangerBtn} onClick={endSession}>
              <i className="ph ph-stop" style={styles.btnIcon}></i>
              Stop Recording
            </button>
          )}
          <button style={styles.secondaryBtn} onClick={clearSessions}>
            <i className="ph ph-trash" style={styles.btnIcon}></i>
            Clear All
          </button>
          {copySuccess && <span style={styles.successMsg}>Copied!</span>}
        </div>

        {saveError && <div style={styles.errorBanner}>{saveError}</div>}

        {/* Session List */}
        <div style={styles.sessionList}>
          {displaySessions.length === 0 ? (
            <div style={styles.emptyState}>
              <i className="ph ph-clipboard-text" style={styles.emptyIcon}></i>
              <p>No test logs yet. Start a recording session to capture AI conversations.</p>
            </div>
          ) : (
            displaySessions.map(session => (
              <div 
                key={session.id} 
                style={{
                  ...styles.sessionCard,
                  ...(activeSession?.id === session.id ? styles.sessionCardActive : {})
                }}
                onClick={() => setActiveSession(activeSession?.id === session.id ? null : session)}
              >
                <div style={styles.sessionHeader}>
                  <div>
                    <h3 style={styles.sessionTitle}>{session.title}</h3>
                    <p style={styles.sessionMeta}>
                      {session.entries.length} entries • {session.createdAt.toLocaleString()}
                    </p>
                  </div>
                  <button 
                    style={styles.copyBtn}
                    onClick={e => {
                      e.stopPropagation();
                      void handleCopySession(session);
                    }}
                    title="Copy session"
                  >
                    <i className="ph ph-copy" style={styles.smallIcon}></i>
                  </button>
                </div>

                {/* Entries Preview */}
                {activeSession?.id === session.id && (
                  <div style={styles.entriesList}>
                    {session.entries.map((entry, idx) => (
                      <div key={idx} style={styles.entry}>
                        <div style={styles.entryHeader}>
                          <div style={{
                            ...styles.entryIcon,
                            backgroundColor: `${getEntryColor(entry.type)}20`,
                            color: getEntryColor(entry.type),
                          }}>
                            <i className={`ph-fill ${getEntryIcon(entry.type)}`}></i>
                          </div>
                          <span style={styles.entryType}>{entry.type.toUpperCase()}</span>
                          <span style={styles.entryTime}>
                            {entry.timestamp?.toLocaleTimeString()}
                          </span>
                          <button 
                            style={styles.entryCopyBtn}
                            onClick={() => void handleCopyEntry(entry)}
                            title="Copy entry"
                          >
                            <i className="ph ph-copy" style={styles.smallIcon}></i>
                          </button>
                        </div>
                        <div style={styles.entryContent}>{entry.content}</div>
                        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                          <div style={styles.entryMeta}>
                            {JSON.stringify(entry.metadata)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    backdropFilter: 'blur(10px)',
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
  },
  container: {
    width: '100%',
    maxWidth: '800px',
    maxHeight: '90vh',
    backgroundColor: '#0a0a0a',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '24px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  title: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  headerBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#ffffff',
    transition: 'all 0.2s ease',
  },
  recordingBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: '999px',
    fontSize: '12px',
    color: '#ef4444',
    fontWeight: 500,
  },
  recordingDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#ef4444',
    animation: 'pulse 1.5s infinite',
  },
  controls: {
    display: 'flex',
    gap: '12px',
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#d946ef',
    color: '#ffffff',
    border: 'none',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  dangerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#9ca3af',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  btnIcon: {
    fontSize: '18px',
  },
  icon: {
    fontSize: '20px',
  },
  smallIcon: {
    fontSize: '14px',
  },
  successMsg: {
    fontSize: '13px',
    color: '#10b981',
    fontWeight: 500,
  },
  errorBanner: {
    padding: '10px 24px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444',
    fontSize: '14px',
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    color: '#6b7280',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
    opacity: 0.5,
  },
  sessionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px',
    padding: '16px 20px',
    marginBottom: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  sessionCardActive: {
    backgroundColor: 'rgba(217, 70, 239, 0.1)',
    borderColor: 'rgba(217, 70, 239, 0.3)',
  },
  sessionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sessionTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#ffffff',
    margin: '0 0 4px 0',
  },
  sessionMeta: {
    fontSize: '12px',
    color: '#6b7280',
    margin: 0,
  },
  copyBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#9ca3af',
    transition: 'all 0.2s ease',
  },
  entriesList: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  entry: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
    padding: '12px 16px',
  },
  entryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  entryIcon: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
  },
  entryType: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#9ca3af',
    letterSpacing: '0.5px',
  },
  entryTime: {
    fontSize: '11px',
    color: '#6b7280',
    marginLeft: 'auto',
  },
  entryCopyBtn: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#9ca3af',
    marginLeft: '8px',
  },
  entryContent: {
    fontSize: '14px',
    color: '#e5e7eb',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  entryMeta: {
    fontSize: '11px',
    color: '#6b7280',
    marginTop: '8px',
    padding: '6px 10px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
};
