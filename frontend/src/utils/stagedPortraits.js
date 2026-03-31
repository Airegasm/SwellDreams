/**
 * Staged Portraits & Video Portrait Utility
 *
 * Manages capacity-based portrait selection for personas and characters.
 * Supports images, looping idle videos, and transition videos between ranges.
 * Portraits change automatically as capacity increases/decreases.
 */

// Capacity ranges for staged portraits
export const STAGED_PORTRAIT_RANGES = [
  { id: 'range_5_10', label: '5-10%', min: 5, max: 10 },
  { id: 'range_11_20', label: '11-20%', min: 11, max: 20 },
  { id: 'range_21_30', label: '21-30%', min: 21, max: 30 },
  { id: 'range_31_40', label: '31-40%', min: 31, max: 40 },
  { id: 'range_41_50', label: '41-50%', min: 41, max: 50 },
  { id: 'range_51_60', label: '51-60%', min: 51, max: 60 },
  { id: 'range_61_70', label: '61-70%', min: 61, max: 70 },
  { id: 'range_71_80', label: '71-80%', min: 71, max: 80 },
  { id: 'range_81_90', label: '81-90%', min: 81, max: 90 },
  { id: 'range_91_100', label: '91-100%', min: 91, max: 100 },
  { id: 'range_pop', label: 'POP!', min: 101, max: Infinity, isPop: true }
];

/**
 * Check if a URL points to a video file
 */
function isVideoUrl(url) {
  return url && /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url);
}

/**
 * Find the range index for a given capacity
 */
function getRangeIndex(capacity) {
  return STAGED_PORTRAIT_RANGES.findIndex(range =>
    capacity >= range.min && capacity <= range.max
  );
}

/**
 * Get the appropriate portrait for the current capacity level.
 * Returns a string URL for backward compatibility with existing code.
 *
 * @param {Object} source - Object with avatar and stagedPortraits (legacy) or portraitMedia (new)
 * @param {number} capacity - Current capacity percentage (0-100+)
 * @param {number} popThreshold - Capacity threshold for POP portrait (default 101)
 * @returns {string|null} The portrait URL to display, or null if no portrait
 */
export function getPortraitForCapacity(source, capacity, popThreshold = 101) {
  if (!source) return null;

  const defaultAvatar = source.avatar || null;

  // Try new portraitMedia format first, then fall back to legacy stagedPortraits
  const portraitMedia = source.portraitMedia || source.charPortraitMedia;
  const legacyPortraits = source.stagedPortraits || source.charStagedPortraits;

  // Determine which data source to use
  const hasNewMedia = portraitMedia && Object.keys(portraitMedia).length > 0;
  const hasLegacy = legacyPortraits && Object.keys(legacyPortraits).length > 0;

  if (!hasNewMedia && !hasLegacy) return defaultAvatar;
  if (capacity < 5) return defaultAvatar;

  if (hasNewMedia) {
    // New format: portraitMedia[rangeId] = { idle, idleType, trans }
    // Check burst — use idle if available, otherwise fall through to highest range
    if (capacity >= popThreshold && portraitMedia.burst?.idle) {
      return portraitMedia.burst.idle;
    }

    // For capacity >= popThreshold without burst idle, or any capacity > 100,
    // search backward from the highest range
    const rangeIndex = getRangeIndex(capacity);
    const searchFrom = rangeIndex >= 0 ? rangeIndex : STAGED_PORTRAIT_RANGES.length - 1;

    // Check current range (skip range_pop if no media)
    const range = STAGED_PORTRAIT_RANGES[searchFrom];
    if (range && !range.isPop && portraitMedia[range.id]?.idle) return portraitMedia[range.id].idle;

    // Fallback through lower ranges
    for (let i = (range?.isPop ? STAGED_PORTRAIT_RANGES.length - 2 : searchFrom - 1); i >= 0; i--) {
      const r = STAGED_PORTRAIT_RANGES[i];
      if (portraitMedia[r.id]?.idle) return portraitMedia[r.id].idle;
    }
    return defaultAvatar;
  }

  // Legacy format: stagedPortraits[rangeId] = url string
  if (capacity >= popThreshold && legacyPortraits.range_pop) {
    return legacyPortraits.range_pop;
  }

  const rangeIndex = getRangeIndex(capacity);
  const legacySearchFrom = rangeIndex >= 0 ? rangeIndex : STAGED_PORTRAIT_RANGES.length - 1;

  const range = STAGED_PORTRAIT_RANGES[legacySearchFrom];
  if (range && !range.isPop && legacyPortraits[range.id]) return legacyPortraits[range.id];

  for (let i = (range?.isPop ? STAGED_PORTRAIT_RANGES.length - 2 : legacySearchFrom - 1); i >= 0; i--) {
    const r = STAGED_PORTRAIT_RANGES[i];
    if (legacyPortraits[r.id]) return legacyPortraits[r.id];
  }
  return defaultAvatar;
}

/**
 * Get rich portrait data including media type and transition info.
 * Used by the PortraitDisplay component for video/transition support.
 *
 * @param {Object} source - Object with avatar, portraitMedia/charPortraitMedia, portraitCrop/charPortraitCrop
 * @param {number} prevCapacity - Previous capacity (for transition detection)
 * @param {number} newCapacity - Current capacity
 * @param {number} popThreshold - Burst threshold (default 101)
 * @returns {Object} { idle, idleType, transition, transitionDirection, crop }
 */
export function getPortraitTransition(source, prevCapacity, newCapacity, popThreshold = 101) {
  const defaultAvatar = source?.avatar || null;
  const portraitMedia = source?.portraitMedia || source?.charPortraitMedia;
  const crop = source?.portraitCrop || source?.charPortraitCrop || null;

  const result = {
    idle: defaultAvatar,
    idleType: 'image',
    transition: null,
    transitionDirection: 'forward',
    crop
  };

  if (!portraitMedia || Object.keys(portraitMedia).length === 0) {
    // Fall back to legacy string-based selection
    const legacyUrl = getPortraitForCapacity(source, newCapacity, popThreshold);
    result.idle = legacyUrl;
    result.idleType = legacyUrl && isVideoUrl(legacyUrl) ? 'video' : 'image';
    return result;
  }

  if (newCapacity < 5) {
    result.idle = defaultAvatar;
    result.idleType = 'image';
    return result;
  }

  // Determine new range
  const isBurst = newCapacity >= popThreshold;
  let newRangeId = null;
  let newRangeIndex = -1;

  if (isBurst && portraitMedia.burst) {
    newRangeId = 'burst';
  } else {
    newRangeIndex = getRangeIndex(newCapacity);
    if (newRangeIndex >= 0) {
      newRangeId = STAGED_PORTRAIT_RANGES[newRangeIndex].id;
    }
  }

  // Find idle for new range (with fallback through lower ranges)
  if (newRangeId === 'burst' && portraitMedia.burst?.idle) {
    result.idle = portraitMedia.burst.idle;
    result.idleType = portraitMedia.burst.idleType || (isVideoUrl(portraitMedia.burst.idle) ? 'video' : 'image');
  } else {
    // Search from current range (or highest non-pop range if burst/over 100%) backward
    const searchStart = newRangeIndex >= 0 ? newRangeIndex : STAGED_PORTRAIT_RANGES.length - 2; // -2 to skip range_pop
    let found = false;
    for (let i = searchStart; i >= 0; i--) {
      const r = STAGED_PORTRAIT_RANGES[i];
      if (r.isPop) continue;
      if (portraitMedia[r.id]?.idle) {
        result.idle = portraitMedia[r.id].idle;
        result.idleType = portraitMedia[r.id].idleType || (isVideoUrl(portraitMedia[r.id].idle) ? 'video' : 'image');
        found = true;
        break;
      }
    }
    if (!found) {
      result.idle = defaultAvatar;
      result.idleType = 'image';
    }
  }

  // Detect range boundary crossing for transitions
  const prevRangeIndex = prevCapacity < 5 ? -1 : getRangeIndex(prevCapacity);
  const prevIsBurst = prevCapacity >= popThreshold;

  const rangeChanged = (isBurst !== prevIsBurst) || (newRangeIndex !== prevRangeIndex);

  if (rangeChanged) {
    const goingUp = newCapacity > prevCapacity;

    if (isBurst && portraitMedia.burst?.trans) {
      // Crossing into burst
      result.transition = portraitMedia.burst.trans;
      result.transitionDirection = goingUp ? 'forward' : 'reverse';
    } else if (newRangeIndex >= 0 && portraitMedia[STAGED_PORTRAIT_RANGES[newRangeIndex].id]?.trans) {
      // Crossing into a normal range that has a transition video
      result.transition = portraitMedia[STAGED_PORTRAIT_RANGES[newRangeIndex].id].trans;
      result.transitionDirection = goingUp ? 'forward' : 'reverse';
    } else if (!goingUp && prevRangeIndex >= 0 && portraitMedia[STAGED_PORTRAIT_RANGES[prevRangeIndex].id]?.trans) {
      // Deflating out of a range — play that range's transition in reverse
      result.transition = portraitMedia[STAGED_PORTRAIT_RANGES[prevRangeIndex].id].trans;
      result.transitionDirection = 'reverse';
    }
  }

  return result;
}

export default getPortraitForCapacity;
