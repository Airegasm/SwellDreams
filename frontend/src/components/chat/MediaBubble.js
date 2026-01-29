import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { API_BASE } from '../../config';
import './MediaBubble.css';

/**
 * MediaBubble - Displays media (image/video/audio) in chat
 * @param {string} type - 'image', 'video', or 'audio'
 * @param {string} tag - Media tag to lookup
 * @param {boolean} loop - For videos: whether to loop (default false)
 * @param {boolean} blocking - For videos: block flows/LLM until video ends (default false)
 * @param {boolean} autoplay - Whether to autoplay video/audio (default true, false for historical messages)
 * @param {function} onLoad - Callback when media finishes loading (for scroll adjustment)
 */
function MediaBubble({ type, tag, loop = false, blocking = false, autoplay = true, onLoad }) {
  const { api, sendWsMessage } = useApp();
  const [mediaData, setMediaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isBlocking, setIsBlocking] = useState(false);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  // Fetch media metadata on mount
  useEffect(() => {
    const fetchMedia = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.lookupMediaByTag(type, tag);
        console.log('[MediaBubble] Loaded:', type, tag, data);
        setMediaData(data);
      } catch (err) {
        console.error(`[MediaBubble] Failed to load ${type} "${tag}":`, err);
        setError(`Media not found: ${tag}`);
      } finally {
        setLoading(false);
      }
    };

    fetchMedia();
  }, [api, type, tag]);

  // Autoplay video/audio when loaded (only if autoplay prop is true), and start blocking if needed
  useEffect(() => {
    if (mediaData && autoplay) {
      if (type === 'video' && videoRef.current) {
        videoRef.current.play().catch(e => console.log('Autoplay blocked:', e));
        // Start blocking if this is a blocking video
        if (blocking && !loop) {
          setIsBlocking(true);
          sendWsMessage('media_blocking', { blocking: true, tag });
          console.log('[MediaBubble] Started blocking for video:', tag);
        }
      }
      if (type === 'audio' && audioRef.current) {
        audioRef.current.play().catch(e => console.log('Autoplay blocked:', e));
      }
    }
  }, [mediaData, type, blocking, loop, sendWsMessage, tag, autoplay]);

  // Cleanup blocking state on unmount
  useEffect(() => {
    return () => {
      if (isBlocking) {
        sendWsMessage('media_blocking', { blocking: false, tag });
        console.log('[MediaBubble] Cleanup - stopped blocking for video:', tag);
      }
    };
  }, [isBlocking, sendWsMessage, tag]);

  // Handle video end - stop blocking
  const handleVideoEnded = () => {
    if (isBlocking) {
      setIsBlocking(false);
      sendWsMessage('media_blocking', { blocking: false, tag });
      console.log('[MediaBubble] Video ended - stopped blocking:', tag);
    }
  };

  // Handle video pause/stop - stop blocking
  const handleVideoPause = () => {
    if (isBlocking) {
      setIsBlocking(false);
      sendWsMessage('media_blocking', { blocking: false, tag });
      console.log('[MediaBubble] Video paused - stopped blocking:', tag);
    }
  };

  const getTypeLabel = () => {
    switch (type) {
      case 'image': return 'Image';
      case 'video': return 'Video';
      case 'audio': return 'Audio';
      default: return 'Media';
    }
  };

  if (loading) {
    return (
      <div className="media-bubble media-bubble-loading">
        <div className="media-bubble-header">
          <span>{getTypeLabel()} Media: {tag}</span>
        </div>
        <div className="media-bubble-content">
          <div className="media-loading-spinner"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-bubble media-bubble-error">
        <div className="media-bubble-header">
          <span>{getTypeLabel()} Media: {tag}</span>
        </div>
        <div className="media-bubble-content">
          <p className="media-error-text">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="media-bubble">
      <div className="media-bubble-header">
        <span>{getTypeLabel()} Media: {tag} - {mediaData.description}</span>
      </div>
      <div className="media-bubble-content">
        {type === 'image' && (
          <img
            src={`${API_BASE}${mediaData.fileUrl}`}
            alt={mediaData.description}
            className={`media-bubble-image ${mediaData.orientation || 'landscape'}`}
            onLoad={onLoad}
            onError={(e) => console.error('[MediaBubble] Image load error:', e.target.src)}
          />
        )}

        {type === 'video' && (
          <video
            ref={videoRef}
            src={`${API_BASE}${mediaData.fileUrl}`}
            controls
            loop={loop}
            playsInline
            className={`media-bubble-video ${isBlocking ? 'blocking' : ''}`}
            onLoadedMetadata={onLoad}
            onEnded={handleVideoEnded}
            onPause={handleVideoPause}
          />
        )}

        {type === 'audio' && (
          <div className="media-bubble-audio-container">
            <audio
              ref={audioRef}
              src={`${API_BASE}${mediaData.fileUrl}`}
              controls
              className="media-bubble-audio"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default MediaBubble;
