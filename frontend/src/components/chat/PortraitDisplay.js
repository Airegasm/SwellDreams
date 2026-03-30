import React, { useRef, useState, useEffect, useCallback } from 'react';
import './PortraitDisplay.css';

/**
 * PortraitDisplay - Renders portrait media (image or video) with transition support.
 *
 * Props:
 *   portrait: { idle, idleType, transition, transitionDirection, crop }
 *   alt: Alt text for images
 *   className: Additional CSS class
 */
function PortraitDisplay({ portrait, alt = '', className = '' }) {
  const transitionVideoRef = useRef(null);
  const idleVideoRef = useRef(null);
  const [showTransition, setShowTransition] = useState(false);
  const [transitionReady, setTransitionReady] = useState(false);
  const prevIdleRef = useRef(null);

  const { idle, idleType, transition, transitionDirection, crop } = portrait || {};

  // Compute crop/position CSS
  const mediaStyle = crop ? {
    transform: `scale(${crop.scale || 1}) translate(${crop.offsetX || 0}px, ${crop.offsetY || 0}px)`,
    transformOrigin: 'center center'
  } : {};

  // Handle transition video playback
  useEffect(() => {
    if (!transition || !transitionVideoRef.current) {
      setShowTransition(false);
      return;
    }

    // Only trigger transition when idle actually changes
    if (prevIdleRef.current === idle && !transition) return;
    prevIdleRef.current = idle;

    const video = transitionVideoRef.current;
    setShowTransition(true);
    setTransitionReady(false);

    const startPlayback = () => {
      if (transitionDirection === 'reverse') {
        // Seek to end and play backwards
        video.currentTime = video.duration;
        video.playbackRate = -1;
      } else {
        video.currentTime = 0;
        video.playbackRate = 1;
      }
      setTransitionReady(true);
      video.play().catch(() => {
        // Reverse playback failed (codec limitation) — skip transition
        setShowTransition(false);
      });
    };

    if (video.readyState >= 2) {
      startPlayback();
    } else {
      video.addEventListener('loadeddata', startPlayback, { once: true });
    }
  }, [transition, transitionDirection, idle]);

  // When transition ends, hide it
  const handleTransitionEnd = useCallback(() => {
    setShowTransition(false);
  }, []);

  // Handle reverse playback end (timeupdate-based since 'ended' doesn't fire for reverse)
  useEffect(() => {
    if (!showTransition || transitionDirection !== 'reverse' || !transitionVideoRef.current) return;

    const video = transitionVideoRef.current;
    const checkEnd = () => {
      if (video.currentTime <= 0.05) {
        video.pause();
        setShowTransition(false);
      }
    };
    video.addEventListener('timeupdate', checkEnd);
    return () => video.removeEventListener('timeupdate', checkEnd);
  }, [showTransition, transitionDirection]);

  // Update idle ref on change
  useEffect(() => {
    prevIdleRef.current = idle;
  }, [idle]);

  if (!idle) {
    return <div className={`portrait-display ${className}`}>
      <div className="portrait-placeholder">?</div>
    </div>;
  }

  return (
    <div className={`portrait-display ${className}`}>
      {/* Idle layer (bottom) */}
      <div className="portrait-idle-layer">
        {idleType === 'video' ? (
          <video
            ref={idleVideoRef}
            src={idle}
            autoPlay
            loop
            muted
            playsInline
            style={mediaStyle}
          />
        ) : (
          <img src={idle} alt={alt} style={mediaStyle} />
        )}
      </div>

      {/* Transition layer (top) — plays once, then hides */}
      {transition && (
        <div className={`portrait-transition-layer ${showTransition && transitionReady ? 'visible' : ''}`}>
          <video
            ref={transitionVideoRef}
            src={transition}
            muted
            playsInline
            onEnded={handleTransitionEnd}
            style={mediaStyle}
          />
        </div>
      )}
    </div>
  );
}

export default PortraitDisplay;
