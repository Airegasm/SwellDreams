import React, { useRef, useEffect } from 'react';
import { EMOTIONS, PAIN_SCALE } from '../constants/stateValues';
import './StatusBadges.css';

function StatusBadges({
  selectedEmotion,
  onEmotionChange,
  selectedPainLevel,
  onPainLevelChange,
  capacity,
  personaName,
  useAutoCapacity,
}) {
  const emotionRef = useRef(null);
  const painRef = useRef(null);
  const [showEmotionPopup, setShowEmotionPopup] = React.useState(false);
  const [showPainPopup, setShowPainPopup] = React.useState(false);

  // Click-outside handlers
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showEmotionPopup && emotionRef.current && !emotionRef.current.contains(e.target)) {
        setShowEmotionPopup(false);
      }
      if (showPainPopup && painRef.current && !painRef.current.contains(e.target)) {
        setShowPainPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmotionPopup, showPainPopup]);

  const currentEmotion = EMOTIONS.find(e => e.key === selectedEmotion) || EMOTIONS[0];
  const currentPain = PAIN_SCALE[selectedPainLevel] || PAIN_SCALE[0];

  return (
    <div className="status-badges-overlay">
      {/* Metallic frame around portrait */}
      <div className="metallic-frame">
        <div className="frame-left"></div>
        <div className="frame-right"></div>
        <div className="frame-top">
          {personaName && <span className="frame-name persona-name">{personaName}</span>}
        </div>
      </div>

      {/* Background bar behind faces */}
      <div className="faces-background-bar"></div>

      {/* Capacity Gauge Circle */}
      <div className="badge-capacity-circle">
        <div className="capacity-gauge-mini">
          <div className="gauge-background-mini"></div>
          <div
            className="gauge-needle-mini"
            style={{ '--capacity': Math.min(capacity, 100) }}
          ></div>
          <div className="gauge-center-mini"></div>
          <span className="gauge-value-mini">{capacity}%</span>
        </div>
      </div>

      {/* Emotion + Pain badges and mode indicator */}
      <div className="badges-row-container">
        <div className="badges-left-stack">
          {/* Emotion Badge */}
          <div
            className={`status-badge-mini ${useAutoCapacity ? 'disabled' : ''}`}
            ref={emotionRef}
            onClick={useAutoCapacity ? undefined : () => setShowEmotionPopup(!showEmotionPopup)}
          >
            <span className="badge-emoji-mini">{currentEmotion.emoji}</span>
            {showEmotionPopup && !useAutoCapacity && (
              <div className="badge-popup emotion-popup">
                <div className="emotion-grid">
                  {EMOTIONS.map(emotion => (
                    <button
                      key={emotion.key}
                      className={`emotion-option ${selectedEmotion === emotion.key ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEmotionChange(emotion.key);
                        setShowEmotionPopup(false);
                      }}
                      title={emotion.label}
                    >
                      {emotion.emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pain Badge */}
          <div
            className={`status-badge-mini ${useAutoCapacity ? 'disabled' : ''}`}
            ref={painRef}
            onClick={useAutoCapacity ? undefined : () => setShowPainPopup(!showPainPopup)}
          >
            <span className="badge-emoji-mini">{currentPain.emoji}</span>
            {showPainPopup && !useAutoCapacity && (
              <div className="badge-popup pain-popup">
                <div className="pain-scale-grid">
                  {PAIN_SCALE.map((pain) => (
                    <button
                      key={pain.value}
                      className={`pain-option ${selectedPainLevel === pain.value ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPainLevelChange(pain.value);
                        setShowPainPopup(false);
                      }}
                      title={pain.label}
                    >
                      {pain.emoji}
                      <span className="pain-number">{pain.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default StatusBadges;
