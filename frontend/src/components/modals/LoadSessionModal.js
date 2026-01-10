import React, { useState, useEffect } from 'react';
import './SessionModals.css';

function LoadSessionModal({
  isOpen,
  onClose,
  onLoad,
  onSaveFirst,
  sessions,
  hasUnsavedChanges,
  defaultSaveName
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [saveName, setSaveName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelectedId(null);
      setShowSavePrompt(false);
      setSaveName(defaultSaveName || '');
    }
  }, [isOpen, defaultSaveName]);

  if (!isOpen) return null;

  const handleContinue = () => {
    if (!selectedId) return;

    if (hasUnsavedChanges) {
      setShowSavePrompt(true);
    } else {
      onLoad(selectedId);
    }
  };

  const handleSaveAndLoad = () => {
    onSaveFirst(saveName.trim() || defaultSaveName);
    onLoad(selectedId);
  };

  const handleSkipSave = () => {
    onLoad(selectedId);
  };

  const handleCancel = () => {
    setSelectedId(null);
    setShowSavePrompt(false);
    onClose();
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  // Save prompt view
  if (showSavePrompt) {
    return (
      <div className="modal-overlay" onClick={handleCancel}>
        <div className="modal session-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Save Current Session?</h3>
            <button className="modal-close" onClick={handleCancel}>&times;</button>
          </div>
          <div className="modal-body">
            <p>Would you like to save the current chat before loading?</p>
            <div className="form-group">
              <label>Session Name</label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={defaultSaveName}
                autoFocus
              />
            </div>
          </div>
          <div className="modal-footer save-prompt-footer">
            <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button className="btn btn-secondary" onClick={handleSkipSave}>No</button>
            <button className="btn btn-primary" onClick={handleSaveAndLoad}>Yes</button>
          </div>
        </div>
      </div>
    );
  }

  // Main session list view
  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal session-modal load-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Load Session</h3>
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>
        <div className="modal-body">
          {sessions.length === 0 ? (
            <p className="text-muted">No saved sessions found for this character.</p>
          ) : (
            <div className="session-list">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className={`session-item ${selectedId === session.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(session.id)}
                >
                  <div className="session-item-name">{session.name}</div>
                  <div className="session-item-meta">
                    {formatDate(session.createdAt)} &bull; {session.chatHistory?.length || 0} messages
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleContinue}
            disabled={!selectedId}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoadSessionModal;
