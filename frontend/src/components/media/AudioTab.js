import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import MediaPreviewPanel from './MediaPreviewPanel';
import AudioWaveformEditor from './AudioWaveformEditor';
import FolderBreadcrumb from './FolderBreadcrumb';
import MoveToFolderModal from './MoveToFolderModal';
import NewFolderModal from './NewFolderModal';
import './MediaGallery.css';

const ALLOWED_FORMATS = ['mp3', 'wav', 'ogg', 'm4a'];
const MAX_SIZE_MB = 100;

function AudioTab() {
  const { api } = useApp();
  const [audioList, setAudioList] = useState([]);
  const [folders, setFolders] = useState(['/']);
  const [currentFolder, setCurrentFolder] = useState('/');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [previewItem, setPreviewItem] = useState(null);

  // Upload states
  const [rawFile, setRawFile] = useState(null);
  const [showWaveformEditor, setShowWaveformEditor] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [formData, setFormData] = useState({ tag: '', description: '' });
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState(false);

  // Edit states
  const [editingAudio, setEditingAudio] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Folder modals
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [itemToMove, setItemToMove] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [audioData, foldersData] = await Promise.all([
        api.getMediaAudio(),
        api.getAudioFolders()
      ]);
      setAudioList(audioData);
      setFolders(foldersData || ['/']);
    } catch (error) {
      console.error('Failed to load audio:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter items by current folder
  const getItemsInCurrentFolder = () => {
    return audioList.filter(aud => {
      const audFolder = aud.folder || '/';
      return audFolder === currentFolder;
    });
  };

  // Get subfolders of current folder
  const getSubfolders = () => {
    const prefix = currentFolder === '/' ? '/' : currentFolder + '/';
    const subfolders = [];

    for (const folder of folders) {
      if (folder === '/' || folder === currentFolder) continue;

      if (currentFolder === '/') {
        if (!folder.slice(1).includes('/')) {
          subfolders.push(folder);
        }
      } else {
        if (folder.startsWith(prefix)) {
          const remainder = folder.slice(prefix.length);
          if (!remainder.includes('/')) {
            subfolders.push(folder);
          }
        }
      }
    }

    return subfolders.sort();
  };

  const getFolderName = (folderPath) => {
    const parts = folderPath.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Root';
  };

  // Upload flow
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_FORMATS.includes(ext)) {
      alert(`Invalid format. Allowed: ${ALLOWED_FORMATS.join(', ')}`);
      e.target.value = '';
      return;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`File too large. Maximum size is ${MAX_SIZE_MB}MB`);
      e.target.value = '';
      return;
    }

    setRawFile(file);
    setShowWaveformEditor(true);
    e.target.value = '';
  };

  const handleWaveformSave = (editedFile) => {
    setShowWaveformEditor(false);
    setRawFile(null);
    setSelectedFile(editedFile);
    setFormData({ tag: '', description: '' });
    setFormError('');
    setShowUploadModal(true);
  };

  const handleWaveformCancel = () => {
    setShowWaveformEditor(false);
    setRawFile(null);
  };

  const handleUploadSave = async () => {
    if (!formData.tag.trim() || !formData.description.trim()) {
      setFormError('Tag and description are required');
      return;
    }

    try {
      setUploading(true);
      setFormError('');
      await api.uploadMediaAudio(
        selectedFile,
        formData.tag.trim(),
        formData.description.trim(),
        currentFolder === '/' ? null : currentFolder
      );
      setShowUploadModal(false);
      setSelectedFile(null);
      loadData();
    } catch (error) {
      setFormError(error.message || 'Failed to upload audio');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadCancel = () => {
    setShowUploadModal(false);
    setSelectedFile(null);
  };

  // Edit flow
  const handleEdit = (audio) => {
    setEditingAudio(audio);
    setFormData({ tag: audio.tag, description: audio.description });
    setFormError('');
    setShowEditModal(true);
  };

  const handleEditSave = async () => {
    if (!formData.tag.trim() || !formData.description.trim()) {
      setFormError('Tag and description are required');
      return;
    }

    try {
      setUploading(true);
      setFormError('');
      await api.updateMediaAudio(editingAudio.id, {
        tag: formData.tag.trim(),
        description: formData.description.trim(),
        folder: editingAudio.folder
      });
      setShowEditModal(false);
      setEditingAudio(null);
      loadData();
    } catch (error) {
      setFormError(error.message || 'Failed to update audio');
    } finally {
      setUploading(false);
    }
  };

  const handleEditCancel = () => {
    setShowEditModal(false);
    setEditingAudio(null);
  };

  // Delete
  const handleDelete = async (audio) => {
    if (!window.confirm(`Delete audio "${audio.tag}"?`)) return;

    try {
      await api.deleteMediaAudio(audio.id);
      loadData();
    } catch (error) {
      console.error('Failed to delete audio:', error);
      alert(error.message || 'Failed to delete audio');
    }
  };

  // Move to folder
  const handleMoveClick = (audio) => {
    setItemToMove(audio);
    setShowMoveModal(true);
  };

  const handleMove = async (newFolder) => {
    if (!itemToMove) return;

    try {
      await api.updateMediaAudio(itemToMove.id, {
        tag: itemToMove.tag,
        description: itemToMove.description,
        folder: newFolder
      });
      setShowMoveModal(false);
      setItemToMove(null);
      loadData();
    } catch (error) {
      console.error('Failed to move audio:', error);
      alert(error.message || 'Failed to move audio');
    }
  };

  // Folder operations
  const handleCreateFolder = async (folderPath) => {
    await api.createAudioFolder(folderPath);
    loadData();
  };

  const handleDeleteFolder = async (folderPath) => {
    const hasItems = audioList.some(aud => (aud.folder || '/') === folderPath);
    if (hasItems) {
      alert('Cannot delete folder that contains items. Move or delete items first.');
      return;
    }

    if (!window.confirm(`Delete folder "${getFolderName(folderPath)}"?`)) return;

    try {
      await api.deleteAudioFolder(folderPath);
      loadData();
    } catch (error) {
      console.error('Failed to delete folder:', error);
      alert(error.message || 'Failed to delete folder');
    }
  };

  // Preview
  const handlePreview = (audio) => {
    setPreviewItem(audio);
  };

  const currentItems = getItemsInCurrentFolder();
  const subfolders = getSubfolders();

  if (loading) {
    return <div className="media-loading">Loading audio...</div>;
  }

  return (
    <div className="media-tab">
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
        onChange={handleFileSelect}
      />

      <div className="media-tab-header-row">
        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
          >
            Grid
          </button>
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>
        <div className="media-tab-header-buttons">
          <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(true)}>
            + Folder
          </button>
          <button className="btn btn-primary" onClick={handleUploadClick}>
            + Upload
          </button>
        </div>
      </div>

      <FolderBreadcrumb
        currentFolder={currentFolder}
        onNavigate={setCurrentFolder}
      />

      {subfolders.length === 0 && currentItems.length === 0 ? (
        <div className="media-empty">
          <p>
            {currentFolder === '/'
              ? 'No audio files yet. Click "+ Upload" to add your first one.'
              : 'This folder is empty.'}
          </p>
          {currentFolder === '/' && (
            <p className="media-empty-hint">
              Supported formats: {ALLOWED_FORMATS.join(', ')} (max {MAX_SIZE_MB}MB)
            </p>
          )}
        </div>
      ) : (
        <div className={`media-gallery ${viewMode}`}>
          {/* Render subfolders first */}
          {subfolders.map((folderPath) => (
            <div
              key={folderPath}
              className={`folder-item ${viewMode}`}
              onClick={() => setCurrentFolder(folderPath)}
            >
              <div className="folder-icon-container">
                📁
              </div>
              <div className="folder-name">{getFolderName(folderPath)}</div>
              {viewMode === 'list' && (
                <div className="folder-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteFolder(folderPath)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Render audio items */}
          {currentItems.map((audio) => (
            <div key={audio.id} className={`media-item ${viewMode}`}>
              <div
                className="media-thumbnail audio-thumbnail"
                onClick={() => handlePreview(audio)}
              >
                <div className="audio-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                </div>
              </div>
              <div className="media-info">
                <div className="media-tag">{audio.tag}</div>
                <div className="media-description">{audio.description}</div>
              </div>
              <div className="media-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleEdit(audio)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleMoveClick(audio)}
                >
                  Move
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(audio)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Waveform Editor */}
      {showWaveformEditor && rawFile && (
        <AudioWaveformEditor
          file={rawFile}
          onSave={handleWaveformSave}
          onCancel={handleWaveformCancel}
        />
      )}

      {/* Upload Modal */}
      {showUploadModal && selectedFile && (
        <div className="modal-overlay" onClick={handleUploadCancel}>
          <div className="modal metadata-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Audio Details</h3>
              <button className="modal-close" onClick={handleUploadCancel}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="file-info">
                <span className="file-name">{selectedFile.name}</span>
                <span className="file-size">
                  ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
                </span>
              </div>
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-group">
                <label>Tag (required)</label>
                <input
                  type="text"
                  value={formData.tag}
                  onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                  placeholder="e.g., aud-ambient1"
                />
              </div>
              <div className="form-group">
                <label>Description (required)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this audio..."
                  rows={3}
                />
              </div>
              <div className="folder-path-preview">
                Will be saved to: {currentFolder === '/' ? 'Root' : currentFolder}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleUploadCancel}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleUploadSave}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingAudio && (
        <div className="modal-overlay" onClick={handleEditCancel}>
          <div className="modal metadata-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Audio</h3>
              <button className="modal-close" onClick={handleEditCancel}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-group">
                <label>Tag (required)</label>
                <input
                  type="text"
                  value={formData.tag}
                  onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                  placeholder="e.g., aud-ambient1"
                />
              </div>
              <div className="form-group">
                <label>Description (required)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this audio..."
                  rows={3}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleEditCancel}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleEditSave}
                disabled={uploading}
              >
                {uploading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <NewFolderModal
          currentFolder={currentFolder}
          onSave={handleCreateFolder}
          onClose={() => setShowNewFolderModal(false)}
        />
      )}

      {/* Move to Folder Modal */}
      {showMoveModal && itemToMove && (
        <MoveToFolderModal
          folders={folders}
          currentItemFolder={itemToMove.folder}
          itemName={itemToMove.tag}
          onMove={handleMove}
          onClose={() => {
            setShowMoveModal(false);
            setItemToMove(null);
          }}
        />
      )}

      {/* Preview Panel */}
      {previewItem && (
        <MediaPreviewPanel
          item={previewItem}
          type="audio"
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
}

export default AudioTab;
