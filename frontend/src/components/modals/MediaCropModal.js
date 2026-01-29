import React, { useRef, useState, useEffect } from 'react';
import './MediaCropModal.css';

/**
 * Media Crop Modal - Supports portrait (3:4) and landscape (4:3) orientations
 * @param {string} image - The image data URL to crop
 * @param {string} orientation - 'portrait' or 'landscape'
 * @param {function} onSave - Callback with cropped image data URL
 * @param {function} onCancel - Callback when cancelled
 */
function MediaCropModal({ image, orientation, onSave, onCancel }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [imageObj, setImageObj] = useState(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 100, height: 133 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Dimensions based on orientation
  const isPortrait = orientation === 'portrait';
  const ASPECT_RATIO = isPortrait ? 3 / 4 : 4 / 3;
  const OUTPUT_WIDTH = isPortrait ? 512 : 683;
  const OUTPUT_HEIGHT = isPortrait ? 683 : 512;

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);
      const maxDisplayWidth = 500;
      const scale = img.width > maxDisplayWidth ? maxDisplayWidth / img.width : 1;
      setDisplayScale(scale);

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

      setCrop({
        x: (img.width - cropWidth) / 2,
        y: (img.height - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight
      });
    };
    img.src = image;
  }, [image, ASPECT_RATIO]);

  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(true);
    setDragStart({
      x: e.clientX - rect.left - crop.x * displayScale,
      y: e.clientY - rect.top - crop.y * displayScale
    });
  };

  useEffect(() => {
    if (!dragging || !imageObj) return;

    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      let newX = (e.clientX - rect.left - dragStart.x) / displayScale;
      let newY = (e.clientY - rect.top - dragStart.y) / displayScale;
      newX = Math.max(0, Math.min(newX, imageObj.width - crop.width));
      newY = Math.max(0, Math.min(newY, imageObj.height - crop.height));
      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    };

    const handleMouseUp = () => setDragging(false);

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
    ctx.drawImage(imageObj, crop.x, crop.y, crop.width, crop.height, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    onSave(canvas.toDataURL('image/jpeg', 0.9));
  };

  if (!imageObj) return null;

  const displayWidth = imageObj.width * displayScale;
  const displayHeight = imageObj.height * displayScale;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal media-crop-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Crop Image ({isPortrait ? 'Portrait 3:4' : 'Landscape 4:3'})</h3>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="text-muted" style={{ marginBottom: '1rem' }}>
            Drag the crop area to select the portion you want
          </p>
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
            <img
              src={image}
              alt="Crop source"
              style={{ width: displayWidth, height: displayHeight, display: 'block' }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.6)',
                pointerEvents: 'none'
              }}
            />
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

export default MediaCropModal;
