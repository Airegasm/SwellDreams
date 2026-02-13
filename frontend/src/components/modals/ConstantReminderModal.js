import React, { useState, useEffect } from 'react';
import './SessionModals.css';

function ConstantReminderModal({ isOpen, onClose, onSave, reminder }) {
  const [formData, setFormData] = useState({
    name: '',
    text: '',
    constant: true,
    keys: [],
    caseSensitive: false,
    priority: 100,
    scanDepth: 10
  });
  const [keyInput, setKeyInput] = useState('');

  useEffect(() => {
    if (isOpen && reminder) {
      setFormData({
        name: reminder.name || '',
        text: reminder.text || '',
        constant: reminder.constant !== undefined ? reminder.constant : true,
        keys: reminder.keys || [],
        caseSensitive: reminder.caseSensitive || false,
        priority: reminder.priority !== undefined ? reminder.priority : 100,
        scanDepth: reminder.scanDepth !== undefined ? reminder.scanDepth : 10
      });
    } else if (isOpen && !reminder) {
      setFormData({
        name: '',
        text: '',
        constant: true,
        keys: [],
        caseSensitive: false,
        priority: 100,
        scanDepth: 10
      });
    }
  }, [isOpen, reminder]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.text.trim()) {
      alert('Name and text are required');
      return;
    }
    onSave(formData);
  };

  const handleAddKey = () => {
    if (!keyInput.trim()) return;
    if (!formData.keys.includes(keyInput.trim())) {
      setFormData({ ...formData, keys: [...formData.keys, keyInput.trim()] });
    }
    setKeyInput('');
  };

  const handleRemoveKey = (key) => {
    setFormData({ ...formData, keys: formData.keys.filter(k => k !== key) });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{reminder ? 'Edit Constant Reminder' : 'New Constant Reminder'}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Brief name for this reminder"
                required
              />
            </div>

            <div className="form-group">
              <label>Prompt Text *</label>
              <textarea
                value={formData.text}
                onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                placeholder="Text to include in prompts when active..."
                rows={4}
                required
              />
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.constant}
                  onChange={(e) => setFormData({ ...formData, constant: e.target.checked })}
                />
                <span>Always Active (ignore keywords)</span>
              </label>
              <p className="field-hint">When unchecked, only activates when keywords are found in recent messages</p>
            </div>

            {!formData.constant && (
              <>
                <div className="form-group">
                  <label>Activation Keywords</label>
                  <div className="keyword-input-row">
                    <input
                      type="text"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddKey())}
                      placeholder="Enter keyword and press Enter"
                    />
                    <button type="button" className="btn btn-sm btn-secondary" onClick={handleAddKey}>Add</button>
                  </div>
                  <div className="keywords-list">
                    {formData.keys.map((key, idx) => (
                      <span key={idx} className="keyword-tag">
                        {key}
                        <button type="button" onClick={() => handleRemoveKey(key)}>&times;</button>
                      </span>
                    ))}
                  </div>
                  <p className="field-hint">Reminder activates when ANY keyword is found</p>
                </div>

                <div className="form-group">
                  <label>Scan Depth (messages to check)</label>
                  <input
                    type="number"
                    value={formData.scanDepth}
                    onChange={(e) => setFormData({ ...formData, scanDepth: parseInt(e.target.value, 10) || 0 })}
                    min="0"
                    max="100"
                  />
                  <p className="field-hint">0 = scan all messages, 10 = scan last 10 messages</p>
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.caseSensitive}
                      onChange={(e) => setFormData({ ...formData, caseSensitive: e.target.checked })}
                    />
                    <span>Case-Sensitive Matching</span>
                  </label>
                </div>
              </>
            )}

            <div className="form-group">
              <label>Priority (higher = injected first)</label>
              <input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 100 })}
                min="0"
                max="1000"
              />
              <p className="field-hint">Default: 100. Higher priority reminders appear first in prompt.</p>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {reminder ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ConstantReminderModal;
