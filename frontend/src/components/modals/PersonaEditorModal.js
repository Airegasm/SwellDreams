import React, { useState, useEffect } from 'react';
import './PersonaEditorModal.css';

function PersonaEditorModal({ isOpen, onClose, onSave, persona }) {
  const [formData, setFormData] = useState({
    displayName: '',
    pronouns: 'they/them',
    appearance: '',
    personality: '',
    relationshipWithInflation: '',
    avatar: ''
  });

  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const fileInputRef = React.useRef(null);

  // Initialize form when persona changes
  useEffect(() => {
    if (isOpen && persona) {
      setFormData({
        displayName: persona.displayName || '',
        pronouns: persona.pronouns || 'they/them',
        appearance: persona.appearance || '',
        personality: persona.personality || '',
        relationshipWithInflation: persona.relationshipWithInflation || '',
        avatar: persona.avatar || ''
      });
    } else if (isOpen && !persona) {
      // New persona
      setFormData({
        displayName: '',
        pronouns: 'they/them',
        appearance: '',
        personality: '',
        relationshipWithInflation: '',
        avatar: ''
      });
    }
  }, [isOpen, persona]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.displayName.trim()) {
      alert('Display name is required');
      return;
    }

    onSave(formData);
  };

  const handleCancel = () => {
    onClose();
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      // Always show resize modal to fit to 3:4 portrait aspect ratio
      setUploadedImage(event.target.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropSave = (croppedImageData) => {
    setFormData({ ...formData, avatar: croppedImageData });
    setShowCropModal(false);
    setUploadedImage(null);
  };

  const handleCropCancel = () => {
    setShowCropModal(false);
    setUploadedImage(null);
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal persona-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{persona ? 'Edit Persona' : 'New Persona'}</h3>
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="editor-layout">
              {/* Left Column - Basic Info */}
              <div className="editor-left">
                <div className="form-group">
                  <label>Display Name *</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                    placeholder="Your character name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Pronouns</label>
                  <select
                    value={formData.pronouns}
                    onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
                  >
                    <option value="he/him">he/him</option>
                    <option value="she/her">she/her</option>
                    <option value="they/them">they/them</option>
                    <option value="it/its">it/its</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Physical Appearance</label>
                  <textarea
                    value={formData.appearance}
                    onChange={(e) => setFormData({ ...formData, appearance: e.target.value })}
                    placeholder="Describe your character's appearance..."
                    rows={4}
                  />
                </div>

                <div className="form-group">
                  <label>Personality</label>
                  <textarea
                    value={formData.personality}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    placeholder="Describe your character's personality..."
                    rows={4}
                  />
                </div>

                <div className="form-group">
                  <label>Relationship with Inflation</label>
                  <textarea
                    value={formData.relationshipWithInflation}
                    onChange={(e) => setFormData({ ...formData, relationshipWithInflation: e.target.value })}
                    placeholder="Describe their knowledge, experience, or lack thereof regarding the inflation process..."
                    rows={4}
                  />
                </div>
              </div>

              {/* Right Column - Avatar Upload */}
              <div className="editor-right">
                <label>Persona Avatar</label>
                <div
                  className="avatar-upload-area"
                  onClick={handleImageClick}
                >
                  {formData.avatar ? (
                    <img src={formData.avatar} alt="Persona avatar" className="avatar-preview" />
                  ) : (
                    <div className="avatar-placeholder">
                      <span className="upload-icon">📷</span>
                      <span className="upload-text">Click to upload</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                {formData.avatar && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, avatar: '' });
                    }}
                    style={{ marginTop: '0.5rem', width: '100%' }}
                  >
                    Remove Avatar
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {persona ? 'Update' : 'Create'} Persona
            </button>
          </div>
        </form>
      </div>

      {/* Image Crop Modal */}
      {showCropModal && (
        <ImageCropModal
          image={uploadedImage}
          onSave={handleCropSave}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}

// Interactive Crop Modal Component (3:4 aspect ratio)
function ImageCropModal({ image, onSave, onCancel }) {
  const containerRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imageObj, setImageObj] = React.useState(null);
  const [displayScale, setDisplayScale] = React.useState(1);
  const [crop, setCrop] = React.useState({ x: 0, y: 0, width: 100, height: 133 });
  const [dragging, setDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

  // Output dimensions: 3:4 portrait aspect ratio
  const OUTPUT_WIDTH = 512;
  const OUTPUT_HEIGHT = 683;
  const ASPECT_RATIO = 3 / 4;

  // Load image
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);

      // Calculate display scale to fit in modal (max 500px wide)
      const maxDisplayWidth = 500;
      const scale = img.width > maxDisplayWidth ? maxDisplayWidth / img.width : 1;
      setDisplayScale(scale);

      // Initialize crop box - as large as possible while maintaining aspect ratio
      const maxCropWidth = img.width;
      const maxCropHeight = img.height;
      let cropWidth, cropHeight;

      if (maxCropWidth / maxCropHeight > ASPECT_RATIO) {
        // Image is wider - constrain by height
        cropHeight = maxCropHeight;
        cropWidth = cropHeight * ASPECT_RATIO;
      } else {
        // Image is taller - constrain by width
        cropWidth = maxCropWidth;
        cropHeight = cropWidth / ASPECT_RATIO;
      }

      // Center the crop
      setCrop({
        x: (img.width - cropWidth) / 2,
        y: (img.height - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight
      });
    };
    img.src = image;
  }, [image]);

  // Handle mouse down on crop box
  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(true);
    setDragStart({
      x: e.clientX - rect.left - crop.x * displayScale,
      y: e.clientY - rect.top - crop.y * displayScale
    });
  };

  // Handle mouse move
  React.useEffect(() => {
    if (!dragging || !imageObj) return;

    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      let newX = (e.clientX - rect.left - dragStart.x) / displayScale;
      let newY = (e.clientY - rect.top - dragStart.y) / displayScale;

      // Constrain to image bounds
      newX = Math.max(0, Math.min(newX, imageObj.width - crop.width));
      newY = Math.max(0, Math.min(newY, imageObj.height - crop.height));

      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStart, displayScale, imageObj, crop.width, crop.height]);

  const handleSave = () => {
    if (!imageObj) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;

    // Draw cropped portion scaled to output size
    ctx.drawImage(
      imageObj,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT
    );

    const croppedData = canvas.toDataURL('image/jpeg', 0.9);
    onSave(croppedData);
  };

  if (!imageObj) return null;

  const displayWidth = imageObj.width * displayScale;
  const displayHeight = imageObj.height * displayScale;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Crop Avatar</h3>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="text-muted" style={{ marginBottom: '1rem' }}>Drag the crop area to select portion</p>
          <div
            ref={containerRef}
            className="crop-container"
            style={{
              width: displayWidth,
              height: displayHeight,
              position: 'relative',
              margin: '0 auto',
              overflow: 'hidden'
            }}
          >
            {/* Base image */}
            <img
              src={image}
              alt="Crop source"
              style={{
                width: displayWidth,
                height: displayHeight,
                display: 'block'
              }}
            />
            {/* Darkened overlay */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              pointerEvents: 'none'
            }} />
            {/* Crop window (shows through) */}
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                left: crop.x * displayScale,
                top: crop.y * displayScale,
                width: crop.width * displayScale,
                height: crop.height * displayScale,
                border: '2px solid #4CAF50',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                cursor: dragging ? 'grabbing' : 'grab',
                backgroundImage: `url(${image})`,
                backgroundSize: `${displayWidth}px ${displayHeight}px`,
                backgroundPosition: `-${crop.x * displayScale}px -${crop.y * displayScale}px`
              }}
            />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default PersonaEditorModal;
