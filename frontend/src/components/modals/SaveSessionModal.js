import React, { useState, useEffect } from 'react';
import './SessionModals.css';

function SaveSessionModal({ isOpen, onClose, onSave, defaultName }) {
  const [sessionName, setSessionName] = useState('');

  useEffect(() => {
    if (isOpen && defaultName) {
      setSessionName(defaultName);
    }
  }, [isOpen, defaultName]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(sessionName.trim() || defaultName);
    setSessionName('');
  };

  const handleCancel = () => {
    setSessionName('');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal session-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Save Session</h3>
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Session Name</label>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder={defaultName}
              autoFocus
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default SaveSessionModal;
