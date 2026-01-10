import React, { useState, useEffect } from 'react';
import './SessionModals.css';

function ConstantReminderModal({ isOpen, onClose, onSave, reminder }) {
  const [formData, setFormData] = useState({
    name: '',
    text: ''
  });

  useEffect(() => {
    if (isOpen && reminder) {
      setFormData({
        name: reminder.name || '',
        text: reminder.text || ''
      });
    } else if (isOpen && !reminder) {
      setFormData({
        name: '',
        text: ''
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
                placeholder="Text to include with every prompt..."
                rows={5}
                required
              />
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
