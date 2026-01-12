import React, { useRef, useEffect } from 'react';
import { EMOTIONS, PAIN_SCALE } from '../constants/stateValues';
import './StatusBadges.css';

function StatusBadges({
  selectedEmotion,
  onEmotionChange,
  selectedPainLevel,
  onPainLevelChange,
  capacity,
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
    <div className="status-badges-container">
      {/* Emotion Badge */}
      <div
        className="status-badge"
        ref={emotionRef}
        onClick={() => setShowEmotionPopup(!showEmotionPopup)}
      >
        <span className="badge-emoji">{currentEmotion.emoji}</span>
        {showEmotionPopup && (
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
        className="status-badge"
        ref={painRef}
        onClick={() => setShowPainPopup(!showPainPopup)}
      >
        <span className="badge-pain-face">{currentPain.emoji}</span>
        {showPainPopup && (
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

      {/* Pressure Gauge Badge */}
      <div className="status-badge gauge-badge">
        <div className="pressure-gauge">
          <div className="gauge-background"></div>
          <div
            className="gauge-needle"
            style={{ '--capacity': capacity }}
          ></div>
          <div className="gauge-center"></div>
          <span className="gauge-value">{capacity}%</span>
        </div>
      </div>
    </div>
  );
}

export default StatusBadges;
