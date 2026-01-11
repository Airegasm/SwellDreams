/**
 * Input Validation Utilities for SwellDreams Backend
 */

/**
 * Validate IPv4 address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid IPv4 format
 */
function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;

  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  return parts.every(p => {
    // Must be numeric and match its parsed value (no leading zeros except "0")
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && p === num.toString();
  });
}

/**
 * Validate string meets length requirements
 * @param {string} str - String to validate
 * @param {number} minLen - Minimum length (default 1)
 * @param {number} maxLen - Maximum length (default 100)
 * @returns {boolean} True if valid
 */
function isValidString(str, minLen = 1, maxLen = 100) {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  return trimmed.length >= minLen && trimmed.length <= maxLen;
}

/**
 * Validate device brand
 * @param {string} brand - Device brand to validate
 * @returns {boolean} True if valid brand
 */
function isValidDeviceBrand(brand) {
  const validBrands = ['tplink', 'govee', 'tuya', 'simulated'];
  return validBrands.includes(brand);
}

/**
 * Validate device object
 * @param {Object} device - Device to validate
 * @returns {Array|null} Array of error objects, or null if valid
 */
function validateDevice(device) {
  const errors = [];

  if (!device || typeof device !== 'object') {
    return [{ field: 'device', message: 'Device object is required' }];
  }

  // Name is always required
  if (!isValidString(device.name, 1, 100)) {
    errors.push({ field: 'name', message: 'Device name is required (1-100 characters)' });
  }

  // Brand validation
  if (!device.brand) {
    errors.push({ field: 'brand', message: 'Device brand is required' });
  } else if (!isValidDeviceBrand(device.brand)) {
    errors.push({ field: 'brand', message: 'Invalid device brand' });
  }

  // IP validation for TP-Link devices
  if (device.brand === 'tplink') {
    if (!device.ip) {
      errors.push({ field: 'ip', message: 'IP address is required for TP-Link devices' });
    } else if (!isValidIPv4(device.ip)) {
      errors.push({ field: 'ip', message: 'Invalid IP address format (expected: x.x.x.x where x is 0-255)' });
    }
  }

  // Device ID validation for cloud-based devices
  if (device.brand === 'govee' || device.brand === 'tuya') {
    if (!device.deviceId && !device.id) {
      errors.push({ field: 'deviceId', message: `Device ID is required for ${device.brand} devices` });
    }
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validate character object
 * @param {Object} char - Character to validate
 * @returns {Array|null} Array of error objects, or null if valid
 */
function validateCharacter(char) {
  const errors = [];

  if (!char || typeof char !== 'object') {
    return [{ field: 'character', message: 'Character object is required' }];
  }

  // Name is required
  if (!isValidString(char.name, 1, 100)) {
    errors.push({ field: 'name', message: 'Character name is required (1-100 characters)' });
  }

  // Persona length limit
  if (char.persona && typeof char.persona === 'string' && char.persona.length > 50000) {
    errors.push({ field: 'persona', message: 'Persona text is too long (max 50,000 characters)' });
  }

  // Scenario length limit
  if (char.scenario && typeof char.scenario === 'string' && char.scenario.length > 20000) {
    errors.push({ field: 'scenario', message: 'Scenario text is too long (max 20,000 characters)' });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validate persona object
 * @param {Object} persona - Persona to validate
 * @returns {Array|null} Array of error objects, or null if valid
 */
function validatePersona(persona) {
  const errors = [];

  if (!persona || typeof persona !== 'object') {
    return [{ field: 'persona', message: 'Persona object is required' }];
  }

  // Name is required
  if (!isValidString(persona.name, 1, 100)) {
    errors.push({ field: 'name', message: 'Persona name is required (1-100 characters)' });
  }

  // Content length limit
  if (persona.content && typeof persona.content === 'string' && persona.content.length > 50000) {
    errors.push({ field: 'content', message: 'Persona content is too long (max 50,000 characters)' });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validate flow object
 * @param {Object} flow - Flow to validate
 * @returns {Array|null} Array of error objects, or null if valid
 */
function validateFlow(flow) {
  const errors = [];

  if (!flow || typeof flow !== 'object') {
    return [{ field: 'flow', message: 'Flow object is required' }];
  }

  // Name is required
  if (!isValidString(flow.name, 1, 200)) {
    errors.push({ field: 'name', message: 'Flow name is required (1-200 characters)' });
  }

  // Nodes must be an array
  if (!Array.isArray(flow.nodes)) {
    errors.push({ field: 'nodes', message: 'Flow nodes must be an array' });
  }

  // Edges must be an array
  if (!Array.isArray(flow.edges)) {
    errors.push({ field: 'edges', message: 'Flow edges must be an array' });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validate session state update
 * @param {Object} state - State update to validate
 * @returns {Array|null} Array of error objects, or null if valid
 */
function validateSessionState(state) {
  const errors = [];

  if (!state || typeof state !== 'object') {
    return [{ field: 'state', message: 'State object is required' }];
  }

  // Capacity must be a number if provided
  if (state.capacity !== undefined) {
    const cap = Number(state.capacity);
    if (isNaN(cap) || cap < 0 || cap > 100) {
      errors.push({ field: 'capacity', message: 'Capacity must be a number between 0 and 100' });
    }
  }

  // Sensation must be a valid value if provided
  if (state.sensation !== undefined) {
    const validSensations = ['normal', 'mild', 'moderate', 'intense', 'overwhelming'];
    if (!validSensations.includes(state.sensation)) {
      errors.push({ field: 'sensation', message: 'Invalid sensation value' });
    }
  }

  // Emotion must be a string if provided
  if (state.emotion !== undefined && typeof state.emotion !== 'string') {
    errors.push({ field: 'emotion', message: 'Emotion must be a string' });
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Sanitize string by trimming and limiting length
 * @param {*} value - Value to sanitize
 * @param {number} maxLen - Maximum length
 * @returns {string} Sanitized string
 */
function sanitizeString(value, maxLen = 10000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().substring(0, maxLen);
}

module.exports = {
  isValidIPv4,
  isValidString,
  isValidDeviceBrand,
  validateDevice,
  validateCharacter,
  validatePersona,
  validateFlow,
  validateSessionState,
  sanitizeString
};
