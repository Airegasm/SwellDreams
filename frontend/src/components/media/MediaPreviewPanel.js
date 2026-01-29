import React, { useEffect, useRef } from 'react';
import './MediaPreviewPanel.css';

/**
 * Preview panel that slides up from the bottom to show media
 * @param {Object} item - The media item (image, video, or audio)
 * @param {string} type - 'image', 'video', or 'audio'
 * @param {function} onClose - Callback when panel is closed
 */
function MediaPreviewPanel({ item, type, onClose }) {
  const panelRef = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Stop playback when closing
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getFileUrl = () => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/api/media/${type}s/${item.id}/file`;
  };

  return (
    <div className="media-preview-overlay" onClick={handleOverlayClick}>
      <div className="media-preview-panel" ref={panelRef}>
        <button className="media-preview-close" onClick={onClose} title="Close">
          &times;
        </button>

        <div className="media-preview-content">
          {type === 'image' && (
            <img
              src={getFileUrl()}
              alt={item.tag}
              className="media-preview-image"
            />
          )}

          {type === 'video' && (
            <video
              ref={videoRef}
              src={getFileUrl()}
              controls
              autoPlay
              className="media-preview-video"
            />
          )}

          {type === 'audio' && (
            <div className="media-preview-audio-container">
              <div className="media-preview-audio-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="64" height="64">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <audio
                ref={audioRef}
                src={getFileUrl()}
                controls
                autoPlay
                className="media-preview-audio"
              />
            </div>
          )}
        </div>

        <div className="media-preview-info">
          <div className="media-preview-tag">{item.tag}</div>
          <div className="media-preview-description">{item.description}</div>
        </div>
      </div>
    </div>
  );
}

export default MediaPreviewPanel;
