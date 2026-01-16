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
  autoCapacityMultiplier = 1.0,
  onAutoCapacityMultiplierChange,
}) {
  const emotionRef = useRef(null);
  const painRef = useRef(null);
  const multiplierRef = useRef(null);
  const [showEmotionPopup, setShowEmotionPopup] = React.useState(false);
  const [showPainPopup, setShowPainPopup] = React.useState(false);
  const [showMultiplierPopup, setShowMultiplierPopup] = React.useState(false);

  // Click-outside handlers
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showEmotionPopup && emotionRef.current && !emotionRef.current.contains(e.target)) {
        setShowEmotionPopup(false);
      }
      if (showPainPopup && painRef.current && !painRef.current.contains(e.target)) {
        setShowPainPopup(false);
      }
      if (showMultiplierPopup && multiplierRef.current && !multiplierRef.current.contains(e.target)) {
        setShowMultiplierPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmotionPopup, showPainPopup, showMultiplierPopup]);

  // Multiplier values: 0.25 to 2.0 in 0.25 increments
  const multiplierValues = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

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

        {/* Over-inflation warning */}
        {capacity > 100 && useAutoCapacity && (
          <span className="overinflating-warning">OVERINFLATING</span>
        )}

        {/* Capacity Mode Indicator */}
        <div
          className={`capacity-mode-indicator ${useAutoCapacity ? 'auto clickable' : 'manual'}`}
          ref={multiplierRef}
          onClick={useAutoCapacity ? () => setShowMultiplierPopup(!showMultiplierPopup) : undefined}
        >
          {useAutoCapacity ? 'Automatic' : 'Manual'}
          {showMultiplierPopup && useAutoCapacity && (
            <div className="multiplier-popup">
              <div className="multiplier-value">{autoCapacityMultiplier.toFixed(2)}x</div>
              <div className="multiplier-slider-container">
                {multiplierValues.slice().reverse().map(value => (
                  <button
                    key={value}
                    className={`multiplier-tick ${autoCapacityMultiplier === value ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAutoCapacityMultiplierChange?.(value);
                    }}
                  >
                    <span className="tick-mark"></span>
                    <span className="tick-label">{value.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StatusBadges;
