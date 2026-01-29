import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import MediaCropModal from '../modals/MediaCropModal';
import MediaPreviewPanel from './MediaPreviewPanel';
import FolderBreadcrumb from './FolderBreadcrumb';
import MoveToFolderModal from './MoveToFolderModal';
import NewFolderModal from './NewFolderModal';
import './MediaGallery.css';

function ImagesTab() {
  const { api } = useApp();
  const [images, setImages] = useState([]);
  const [folders, setFolders] = useState(['/']);
  const [currentFolder, setCurrentFolder] = useState('/');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [previewItem, setPreviewItem] = useState(null);

  // Upload flow states
  const [showOrientationPicker, setShowOrientationPicker] = useState(false);
  const [selectedOrientation, setSelectedOrientation] = useState(null);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [croppedImage, setCroppedImage] = useState(null);
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [formData, setFormData] = useState({ tag: '', description: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit states
  const [editingImage, setEditingImage] = useState(null);
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
      const [imagesData, foldersData] = await Promise.all([
        api.getMediaImages(),
        api.getImageFolders()
      ]);
      setImages(imagesData);
      setFolders(foldersData || ['/']);
    } catch (error) {
      console.error('Failed to load images:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter items by current folder
  const getItemsInCurrentFolder = () => {
    return images.filter(img => {
      const imgFolder = img.folder || '/';
      return imgFolder === currentFolder;
    });
  };

  // Get subfolders of current folder
  const getSubfolders = () => {
    const prefix = currentFolder === '/' ? '/' : currentFolder + '/';
    const subfolders = [];

    for (const folder of folders) {
      if (folder === '/' || folder === currentFolder) continue;

      // Check if this folder is a direct child of current folder
      if (currentFolder === '/') {
        // Root level - look for folders without additional slashes
        if (!folder.slice(1).includes('/')) {
          subfolders.push(folder);
        }
      } else {
        // Nested - look for folders that start with current path + /
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
    setShowOrientationPicker(true);
  };

  const handleOrientationSelect = (orientation) => {
    setSelectedOrientation(orientation);
    setShowOrientationPicker(false);
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropSave = (croppedDataUrl) => {
    setCroppedImage(croppedDataUrl);
    setShowCropModal(false);
    setUploadedImage(null);
    setShowMetadataForm(true);
    setFormData({ tag: '', description: '' });
    setFormError('');
  };

  const handleCropCancel = () => {
    setShowCropModal(false);
    setUploadedImage(null);
    setSelectedOrientation(null);
  };

  const handleMetadataSave = async () => {
    if (!formData.tag.trim() || !formData.description.trim()) {
      setFormError('Tag and description are required');
      return;
    }

    try {
      setSaving(true);
      setFormError('');
      await api.createMediaImage({
        imageData: croppedImage,
        orientation: selectedOrientation,
        tag: formData.tag.trim(),
        description: formData.description.trim(),
        folder: currentFolder === '/' ? null : currentFolder
      });
      setShowMetadataForm(false);
      setCroppedImage(null);
      setSelectedOrientation(null);
      loadData();
    } catch (error) {
      setFormError(error.message || 'Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  const handleMetadataCancel = () => {
    setShowMetadataForm(false);
    setCroppedImage(null);
    setSelectedOrientation(null);
  };

  // Edit flow
  const handleEdit = (image) => {
    setEditingImage(image);
    setFormData({ tag: image.tag, description: image.description });
    setFormError('');
    setShowEditModal(true);
  };

  const handleEditSave = async () => {
    if (!formData.tag.trim() || !formData.description.trim()) {
      setFormError('Tag and description are required');
      return;
    }

    try {
      setSaving(true);
      setFormError('');
      await api.updateMediaImage(editingImage.id, {
        tag: formData.tag.trim(),
        description: formData.description.trim(),
        folder: editingImage.folder
      });
      setShowEditModal(false);
      setEditingImage(null);
      loadData();
    } catch (error) {
      setFormError(error.message || 'Failed to update image');
    } finally {
      setSaving(false);
    }
  };

  const handleEditCancel = () => {
    setShowEditModal(false);
    setEditingImage(null);
  };

  // Delete
  const handleDelete = async (image) => {
    if (!window.confirm(`Delete image "${image.tag}"?`)) return;

    try {
      await api.deleteMediaImage(image.id);
      loadData();
    } catch (error) {
      console.error('Failed to delete image:', error);
      alert(error.message || 'Failed to delete image');
    }
  };

  // Move to folder
  const handleMoveClick = (image) => {
    setItemToMove(image);
    setShowMoveModal(true);
  };

  const handleMove = async (newFolder) => {
    if (!itemToMove) return;

    try {
      await api.updateMediaImage(itemToMove.id, {
        tag: itemToMove.tag,
        description: itemToMove.description,
        folder: newFolder
      });
      setShowMoveModal(false);
      setItemToMove(null);
      loadData();
    } catch (error) {
      console.error('Failed to move image:', error);
      alert(error.message || 'Failed to move image');
    }
  };

  // Folder operations
  const handleCreateFolder = async (folderPath) => {
    await api.createImageFolder(folderPath);
    loadData();
  };

  const handleDeleteFolder = async (folderPath) => {
    // Check if folder has items
    const hasItems = images.some(img => (img.folder || '/') === folderPath);
    if (hasItems) {
      alert('Cannot delete folder that contains items. Move or delete items first.');
      return;
    }

    if (!window.confirm(`Delete folder "${getFolderName(folderPath)}"?`)) return;

    try {
      await api.deleteImageFolder(folderPath);
      loadData();
    } catch (error) {
      console.error('Failed to delete folder:', error);
      alert(error.message || 'Failed to delete folder');
    }
  };

  // Preview
  const handlePreview = (image) => {
    setPreviewItem(image);
  };

  const getImageUrl = (image) => {
    return `/api/media/images/${image.id}/file`;
  };

  const currentItems = getItemsInCurrentFolder();
  const subfolders = getSubfolders();

  if (loading) {
    return <div className="media-loading">Loading images...</div>;
  }

  return (
    <div className="media-tab">
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/*"
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
              ? 'No images yet. Click "+ Upload" to add your first one.'
              : 'This folder is empty.'}
          </p>
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

          {/* Render images */}
          {currentItems.map((image) => (
            <div key={image.id} className={`media-item ${viewMode}`}>
              <div
                className="media-thumbnail"
                onClick={() => handlePreview(image)}
              >
                <img src={getImageUrl(image)} alt={image.tag} />
                <span className={`orientation-badge ${image.orientation}`}>
                  {image.orientation === 'portrait' ? '3:4' : '4:3'}
                </span>
              </div>
              <div className="media-info">
                <div className="media-tag">{image.tag}</div>
                <div className="media-description">{image.description}</div>
              </div>
              <div className="media-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleEdit(image)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleMoveClick(image)}
                >
                  Move
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(image)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Orientation Picker Modal */}
      {showOrientationPicker && (
        <div className="modal-overlay" onClick={() => setShowOrientationPicker(false)}>
          <div className="modal orientation-picker-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Select Orientation</h3>
              <button className="modal-close" onClick={() => setShowOrientationPicker(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="orientation-options">
                <button
                  className="orientation-option portrait"
                  onClick={() => handleOrientationSelect('portrait')}
                >
                  <div className="orientation-preview portrait-preview"></div>
                  <span>Portrait (3:4)</span>
                </button>
                <button
                  className="orientation-option landscape"
                  onClick={() => handleOrientationSelect('landscape')}
                >
                  <div className="orientation-preview landscape-preview"></div>
                  <span>Landscape (4:3)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Crop Modal */}
      {showCropModal && uploadedImage && selectedOrientation && (
        <MediaCropModal
          image={uploadedImage}
          orientation={selectedOrientation}
          onSave={handleCropSave}
          onCancel={handleCropCancel}
        />
      )}

      {/* Metadata Form Modal */}
      {showMetadataForm && (
        <div className="modal-overlay" onClick={handleMetadataCancel}>
          <div className="modal metadata-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Image Details</h3>
              <button className="modal-close" onClick={handleMetadataCancel}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              {croppedImage && (
                <div className="metadata-preview">
                  <img src={croppedImage} alt="Preview" />
                </div>
              )}
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-group">
                <label>Tag (required)</label>
                <input
                  type="text"
                  value={formData.tag}
                  onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                  placeholder="e.g., img-rachel1"
                />
              </div>
              <div className="form-group">
                <label>Description (required)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this image..."
                  rows={3}
                />
              </div>
              <div className="folder-path-preview">
                Will be saved to: {currentFolder === '/' ? 'Root' : currentFolder}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleMetadataCancel}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleMetadataSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingImage && (
        <div className="modal-overlay" onClick={handleEditCancel}>
          <div className="modal metadata-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Image</h3>
              <button className="modal-close" onClick={handleEditCancel}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="metadata-preview">
                <img src={getImageUrl(editingImage)} alt="Preview" />
              </div>
              {formError && <div className="form-error">{formError}</div>}
              <div className="form-group">
                <label>Tag (required)</label>
                <input
                  type="text"
                  value={formData.tag}
                  onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                  placeholder="e.g., img-rachel1"
                />
              </div>
              <div className="form-group">
                <label>Description (required)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this image..."
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
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
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
          type="image"
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
}

export default ImagesTab;
