import React, { useState } from 'react';

function NewFolderModal({ currentFolder, onSave, onClose }) {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const name = folderName.trim();

    if (!name) {
      setError('Folder name is required');
      return;
    }

    if (name.includes('/')) {
      setError('Folder name cannot contain "/"');
      return;
    }

    try {
      setSaving(true);
      setError('');

      // Build full path
      const basePath = currentFolder === '/' ? '' : currentFolder;
      const newPath = basePath + '/' + name;

      await onSave(newPath);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create folder');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal new-folder-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Folder</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          <div className="form-group">
            <label>Folder Name</label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="My Folder"
              autoFocus
            />
          </div>
          <div className="folder-path-preview">
            Will be created in: {currentFolder === '/' ? 'Root' : currentFolder}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewFolderModal;
