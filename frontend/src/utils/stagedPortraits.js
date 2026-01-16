/**
 * Staged Portraits Utility
 *
 * Manages capacity-based portrait selection for personas.
 * Portraits change automatically as capacity increases.
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
 * Get the appropriate portrait for the current capacity level.
 *
 * Selection logic:
 * 1. If capacity < 5%: return default avatar
 * 2. Find matching range for current capacity
 * 3. If staged portrait exists for that range: return it
 * 4. Else: search backward through lower ranges for the nearest uploaded portrait
 * 5. Final fallback: return default avatar
 *
 * @param {Object} persona - The persona object with avatar and stagedPortraits
 * @param {number} capacity - Current capacity percentage (0-100+)
 * @returns {string|null} The portrait URL to display, or null if no portrait
 */
export function getPortraitForCapacity(persona, capacity) {
  // No persona or no default avatar
  if (!persona) return null;

  const defaultAvatar = persona.avatar || null;
  const stagedPortraits = persona.stagedPortraits || {};

  // If no staged portraits configured, always use default
  if (Object.keys(stagedPortraits).length === 0) {
    return defaultAvatar;
  }

  // Capacity below 5% uses default avatar
  if (capacity < 5) {
    return defaultAvatar;
  }

  // Find the matching range for current capacity
  const matchingRangeIndex = STAGED_PORTRAIT_RANGES.findIndex(range =>
    capacity >= range.min && capacity <= range.max
  );

  // If no matching range found (shouldn't happen), return default
  if (matchingRangeIndex === -1) {
    return defaultAvatar;
  }

  // Check if there's a portrait for the matching range
  const matchingRange = STAGED_PORTRAIT_RANGES[matchingRangeIndex];
  if (stagedPortraits[matchingRange.id]) {
    return stagedPortraits[matchingRange.id];
  }

  // Search backward through lower ranges for the nearest uploaded portrait
  for (let i = matchingRangeIndex - 1; i >= 0; i--) {
    const range = STAGED_PORTRAIT_RANGES[i];
    if (stagedPortraits[range.id]) {
      return stagedPortraits[range.id];
    }
  }

  // Final fallback: return default avatar
  return defaultAvatar;
}
