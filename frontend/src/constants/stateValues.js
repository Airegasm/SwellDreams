/**
 * Shared state value constants for emotions and pain scale.
 * Used by StatusBadges, flow nodes, and backend.
 */

// 20 emoji-based emotions
export const EMOTIONS = [
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
  { key: 'blissful', emoji: '\u{1F60D}', label: 'Blissful' }
];

// Helper to get emotion by key
export const getEmotionByKey = (key) => EMOTIONS.find(e => e.key === key);

// Helper to get emotion display string (emoji + label)
export const getEmotionDisplay = (key) => {
  const emotion = getEmotionByKey(key);
  return emotion ? `${emotion.emoji} ${emotion.label}` : key;
};

// 0-10 pain scale with labels and emojis
export const PAIN_SCALE = [
  { value: 0, label: 'None', emoji: '\u{1F60A}' },
  { value: 1, label: 'Minimal', emoji: '\u{1F642}' },
  { value: 2, label: 'Mild', emoji: '\u{1F610}' },
  { value: 3, label: 'Uncomfortable', emoji: '\u{1F615}' },
  { value: 4, label: 'Moderate', emoji: '\u{1F61F}' },
  { value: 5, label: 'Distracting', emoji: '\u{1F623}' },
  { value: 6, label: 'Distressing', emoji: '\u{1F62B}' },
  { value: 7, label: 'Intense', emoji: '\u{1F616}' },
  { value: 8, label: 'Severe', emoji: '\u{1F62D}' },
  { value: 9, label: 'Agonizing', emoji: '\u{1F92E}' },
  { value: 10, label: 'Excruciating', emoji: '\u{1F635}' }
];

// Helper to get pain level by value
export const getPainByValue = (value) => PAIN_SCALE.find(p => p.value === value);

// Helper to get pain display string (emoji + value + label)
export const getPainDisplay = (value) => {
  const pain = getPainByValue(value);
  return pain ? `${pain.emoji} ${value} - ${pain.label}` : `${value}`;
};

// Helper to get pain label only
export const getPainLabel = (value) => {
  const pain = getPainByValue(value);
  return pain ? pain.label : `Level ${value}`;
};

// Migration mappings for old emotion values
export const EMOTION_MIGRATION = {
  'nervous': 'anxious',
  'scared': 'frightened',
  'humiliated': 'embarrassed',
  'resigned': 'sad',
  'defiant': 'angry',
  'overwhelmed': 'exhausted'
};

// Migration mappings for old sensation values to pain scale
export const SENSATION_TO_PAIN = {
  'normal': 0,
  'slightly tight': 2,
  'comfortably full': 3,
  'stretched': 5,
  'very tight': 7,
  'painfully tight': 9
};

// Migrate old emotion value to new
export const migrateEmotion = (value) => {
  if (EMOTION_MIGRATION[value]) {
    return EMOTION_MIGRATION[value];
  }
  // Check if it's already a valid new emotion
  if (EMOTIONS.find(e => e.key === value)) {
    return value;
  }
  return 'neutral'; // Default fallback
};

// Migrate old sensation string to pain number
export const migrateSensation = (value) => {
  if (typeof value === 'number') {
    return Math.max(0, Math.min(10, value));
  }
  if (SENSATION_TO_PAIN[value] !== undefined) {
    return SENSATION_TO_PAIN[value];
  }
  return 0; // Default fallback
};

// Comparison operators for conditions
export const COMPARISON_OPERATORS = [
  { value: '==', label: '= (equals)' },
  { value: '!=', label: '!= (not equals)' },
  { value: '>', label: '> (greater than)' },
  { value: '<', label: '< (less than)' },
  { value: '>=', label: '>= (greater or equal)' },
  { value: '<=', label: '<= (less or equal)' },
  { value: 'range', label: 'range (between)' }
];
