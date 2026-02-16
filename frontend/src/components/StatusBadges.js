import React, { useRef, useEffect } from 'react';
import { EMOTIONS, PAIN_SCALE } from '../constants/stateValues';
import './StatusBadges.css';

function StatusBadges({
  selectedEmotion,
  onEmotionChange,
  selectedPainLevel,
  onPainLevelChange,
  capacity,
  onCapacityChange,
  personaName,
  useAutoCapacity,
}) {
  const emotionRef = useRef(null);
  const painRef = useRef(null);
  const capacityRef = useRef(null);
  const [showEmotionPopup, setShowEmotionPopup] = React.useState(false);
  const [showPainPopup, setShowPainPopup] = React.useState(false);
  const [showCapacitySlider, setShowCapacitySlider] = React.useState(false);
  const [sliderValue, setSliderValue] = React.useState(0);

  // Click-outside handlers
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showEmotionPopup && emotionRef.current && !emotionRef.current.contains(e.target)) {
        setShowEmotionPopup(false);
      }
      if (showPainPopup && painRef.current && !painRef.current.contains(e.target)) {
        setShowPainPopup(false);
      }
      if (showCapacitySlider && capacityRef.current && !capacityRef.current.contains(e.target)) {
        setShowCapacitySlider(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmotionPopup, showPainPopup, showCapacitySlider]);

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
      <div
        className="badge-capacity-circle"
        ref={capacityRef}
        onClick={() => {
          if (!onCapacityChange) return;
          if (!showCapacitySlider) setSliderValue(Math.max(0, Math.min(100, capacity)));
          setShowCapacitySlider(!showCapacitySlider);
        }}
      >
        <div className="capacity-gauge-mini">
          <div className="gauge-background-mini"></div>
          <div
            className="gauge-needle-mini"
            style={{ '--capacity': Math.min(capacity, 100) }}
          ></div>
          <div className="gauge-center-mini"></div>
          <span className="gauge-value-mini">{capacity}%</span>
        </div>
        {showCapacitySlider && onCapacityChange && (
          <div className="capacity-slider-popup" onClick={(e) => e.stopPropagation()}>
            <span className="capacity-slider-label">{sliderValue}%</span>
            <div
              className="capacity-slider-track"
              onMouseDown={(e) => {
                const track = e.currentTarget;
                const update = (ev) => {
                  const rect = track.getBoundingClientRect();
                  const pct = Math.round(Math.max(0, Math.min(100, ((rect.bottom - ev.clientY) / rect.height) * 100)));
                  setSliderValue(pct);
                  onCapacityChange(pct);
                };
                update(e);
                const onMove = (ev) => update(ev);
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
              onTouchStart={(e) => {
                const track = e.currentTarget;
                const update = (ev) => {
                  const touch = ev.touches[0];
                  const rect = track.getBoundingClientRect();
                  const pct = Math.round(Math.max(0, Math.min(100, ((rect.bottom - touch.clientY) / rect.height) * 100)));
                  setSliderValue(pct);
                  onCapacityChange(pct);
                };
                update(e);
                const onMove = (ev) => { ev.preventDefault(); update(ev); };
                const onEnd = () => {
                  document.removeEventListener('touchmove', onMove);
                  document.removeEventListener('touchend', onEnd);
                };
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('touchend', onEnd);
              }}
            >
              <div className="capacity-slider-fill" style={{ height: `${sliderValue}%` }} />
              <div className="capacity-slider-thumb" style={{ bottom: `${sliderValue}%` }} />
            </div>
            <span className="capacity-slider-min">0</span>
          </div>
        )}
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
