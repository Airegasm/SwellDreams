import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import MediaPreviewPanel from './MediaPreviewPanel';
import FolderBreadcrumb from './FolderBreadcrumb';
import MoveToFolderModal from './MoveToFolderModal';
import NewFolderModal from './NewFolderModal';
import './MediaGallery.css';

const ALLOWED_FORMATS = ['mp4', 'webm', 'mov'];
const MAX_SIZE_MB = 500;

function VideosTab() {
  const { api } = useApp();
  const [videos, setVideos] = useState([]);
  const [folders, setFolders] = useState(['/']);
  const [currentFolder, setCurrentFolder] = useState('/');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [previewItem, setPreviewItem] = useState(null);

  // Upload states
  const [selectedFile, setSelectedFile] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [formData, setFormData] = useState({ tag: '', description: '' });
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState(false);

  // Edit states
  const [editingVideo, setEditingVideo] = useState(null);
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
      const [videosData, foldersData] = await Promise.all([
        api.getMediaVideos(),
        api.getVideoFolders()
      ]);
      setVideos(videosData);
      setFolders(foldersData || ['/']);
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter items by current folder
  const getItemsInCurrentFolder = () => {
    return videos.filter(vid => {
      const vidFolder = vid.folder || '/';
      return vidFolder === currentFolder;
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

    setSelectedFile(file);
    setFormData({ tag: '', description: '' });
    setFormError('');
    setShowUploadModal(true);
    e.target.value = '';
  };

  const handleUploadSave = async () => {
    if (!formData.tag.trim() || !formData.description.trim()) {
      setFormError('Tag and description are required');
      return;
    }

    try {
      setUploading(true);
      setFormError('');
      await api.uploadMediaVideo(
        selectedFile,
        formData.tag.trim(),
        formData.description.trim(),
        currentFolder === '/' ? null : currentFolder
      );
      setShowUploadModal(false);
      setSelectedFile(null);
      loadData();
    } catch (error) {
      setFormError(error.message || 'Failed to upload video');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadCancel = () => {
    setShowUploadModal(false);
    setSelectedFile(null);
  };

  // Edit flow
  const handleEdit = (video) => {
    setEditingVideo(video);
    setFormData({ tag: video.tag, description: video.description });
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
      await api.updateMediaVideo(editingVideo.id, {
        tag: formData.tag.trim(),
        description: formData.description.trim(),
        folder: editingVideo.folder
      });
      setShowEditModal(false);
      setEditingVideo(null);
      loadData();
    } catch (error) {
      setFormError(error.message || 'Failed to update video');
    } finally {
      setUploading(false);
    }
  };

  const handleEditCancel = () => {
    setShowEditModal(false);
    setEditingVideo(null);
  };

  // Delete
  const handleDelete = async (video) => {
    if (!window.confirm(`Delete video "${video.tag}"?`)) return;

    try {
      await api.deleteMediaVideo(video.id);
      loadData();
    } catch (error) {
      console.error('Failed to delete video:', error);
      alert(error.message || 'Failed to delete video');
    }
  };

  // Move to folder
  const handleMoveClick = (video) => {
    setItemToMove(video);
    setShowMoveModal(true);
  };

  const handleMove = async (newFolder) => {
    if (!itemToMove) return;

    try {
      await api.updateMediaVideo(itemToMove.id, {
        tag: itemToMove.tag,
        description: itemToMove.description,
        folder: newFolder
      });
      setShowMoveModal(false);
      setItemToMove(null);
      loadData();
    } catch (error) {
      console.error('Failed to move video:', error);
      alert(error.message || 'Failed to move video');
    }
  };

  // Folder operations
  const handleCreateFolder = async (folderPath) => {
    await api.createVideoFolder(folderPath);
    loadData();
  };

  const handleDeleteFolder = async (folderPath) => {
    const hasItems = videos.some(vid => (vid.folder || '/') === folderPath);
    if (hasItems) {
      alert('Cannot delete folder that contains items. Move or delete items first.');
      return;
    }

    if (!window.confirm(`Delete folder "${getFolderName(folderPath)}"?`)) return;

    try {
      await api.deleteVideoFolder(folderPath);
      loadData();
    } catch (error) {
      console.error('Failed to delete folder:', error);
      alert(error.message || 'Failed to delete folder');
    }
  };

  // Preview
  const handlePreview = (video) => {
    setPreviewItem(video);
  };

  const getVideoUrl = (video) => {
    return `/api/media/videos/${video.id}/file`;
  };

  const currentItems = getItemsInCurrentFolder();
  const subfolders = getSubfolders();

  if (loading) {
    return <div className="media-loading">Loading videos...</div>;
  }

  return (
    <div className="media-tab">
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
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
              ? 'No videos yet. Click "+ Upload" to add your first one.'
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

          {/* Render videos */}
          {currentItems.map((video) => (
            <div key={video.id} className={`media-item ${viewMode}`}>
              <div
                className="media-thumbnail video-thumbnail"
                onClick={() => handlePreview(video)}
              >
                <div className="video-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
              <div className="media-info">
                <div className="media-tag">{video.tag}</div>
                <div className="media-description">{video.description}</div>
              </div>
              <div className="media-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleEdit(video)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleMoveClick(video)}
                >
                  Move
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(video)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && selectedFile && (
        <div className="modal-overlay" onClick={handleUploadCancel}>
          <div className="modal metadata-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Video Details</h3>
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
                  placeholder="e.g., vid-intro1"
                />
              </div>
              <div className="form-group">
                <label>Description (required)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this video..."
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
      {showEditModal && editingVideo && (
        <div className="modal-overlay" onClick={handleEditCancel}>
          <div className="modal metadata-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Video</h3>
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
                  placeholder="e.g., vid-intro1"
                />
              </div>
              <div className="form-group">
                <label>Description (required)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this video..."
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
          type="video"
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
}

export default VideosTab;
