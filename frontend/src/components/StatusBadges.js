import React, { useRef, useEffect } from 'react';
import './StatusBadges.css';

const EMOTION_OPTIONS = [
  { key: 'neutral', emoji: '\u{1F610}', label: 'Neutral' },
  { key: 'happy', emoji: '\u{1F60A}', label: 'Happy' },
  { key: 'excited', emoji: '\u{1F929}', label: 'Excited' },
  { key: 'aroused', emoji: '\u{1F60F}', label: 'Aroused' },
  { key: 'horny', emoji: '\u{1F525}', label: 'Horny' },
  { key: 'loving', emoji: '\u{1F970}', label: 'Loving' },
  { key: 'submissive', emoji: '\u{1F633}', label: 'Submissive' },
  { key: 'dominant', emoji: '\u{1F608}', label: 'Dominant' },
  { key: 'shy', emoji: '\u{1FAE3}', label: 'Shy' },
  { key: 'embarrassed', emoji: '\u{1F972}', label: 'Embarrassed' },
  { key: 'confused', emoji: '\u{1F615}', label: 'Confused' },
  { key: 'curious', emoji: '\u{1F914}', label: 'Curious' },
  { key: 'frightened', emoji: '\u{1F628}', label: 'Frightened' },
  { key: 'anxious', emoji: '\u{1F630}', label: 'Anxious' },
  { key: 'sad', emoji: '\u{1F622}', label: 'Sad' },
  { key: 'angry', emoji: '\u{1F620}', label: 'Angry' },
  { key: 'drunk', emoji: '\u{1F974}', label: 'Drunk' },
  { key: 'dazed', emoji: '\u{1F635}', label: 'Dazed' },
  { key: 'exhausted', emoji: '\u{1F62E}\u{200D}\u{1F4A8}', label: 'Exhausted' },
  { key: 'blissful', emoji: '\u{1F60D}', label: 'Blissful' },
];

// Pain faces mapped to 0-10 scale (Wong-Baker FACES Pain Rating Scale style)
const PAIN_FACES = [
  '\u{1F60A}', // 0 - No hurt
  '\u{1F642}', // 1
  '\u{1F610}', // 2 - Hurts little bit
  '\u{1F615}', // 3
  '\u{1F61F}', // 4 - Hurts little more
  '\u{1F623}', // 5
  '\u{1F62B}', // 6 - Hurts even more
  '\u{1F616}', // 7
  '\u{1F62D}', // 8 - Hurts whole lot
  '\u{1F92E}', // 9
  '\u{1F635}', // 10 - Hurts worst
];

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

  const currentEmotion = EMOTION_OPTIONS.find(e => e.key === selectedEmotion) || EMOTION_OPTIONS[0];

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
              {EMOTION_OPTIONS.map(emotion => (
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
        <span className="badge-pain-face">{PAIN_FACES[selectedPainLevel]}</span>
        {showPainPopup && (
          <div className="badge-popup pain-popup">
            <div className="pain-scale-grid">
              {PAIN_FACES.map((face, index) => (
                <button
                  key={index}
                  className={`pain-option ${selectedPainLevel === index ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPainLevelChange(index);
                    setShowPainPopup(false);
                  }}
                >
                  {face}
                  <span className="pain-number">{index}</span>
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
