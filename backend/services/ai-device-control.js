/**
 * AI Device Control - Parses device commands from LLM output
 *
 * Allows the AI model to control devices by including simple tags in responses:
 *   [pump on]  [pump off]
 *   [vibe on]  [vibe off]
 *   [tens on]  [tens off]
 *
 * The commands are parsed out, executed, and stripped from the displayed message.
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('AIDeviceControl');

// Command pattern: [device action] where device is pump/vibe/tens and action is on/off
const DEVICE_COMMAND_PATTERN = /\[(pump|vibe|tens)\s+(on|off)\]/gi;

/**
 * Parse device commands from text
 * @param {string} text - LLM output text
 * @returns {Array<{device: string, action: string, match: string}>}
 */
function parseDeviceCommands(text) {
  if (!text) return [];

  const commands = [];
  let match;

  // Reset regex state
  DEVICE_COMMAND_PATTERN.lastIndex = 0;

  while ((match = DEVICE_COMMAND_PATTERN.exec(text)) !== null) {
    commands.push({
      device: match[1].toLowerCase(),  // pump, vibe, or tens
      action: match[2].toLowerCase(),  // on or off
      match: match[0]                  // full match for stripping
    });
  }

  return commands;
}

/**
 * Strip device commands from text for display
 * @param {string} text - Text containing device commands
 * @returns {string} - Text with commands removed
 */
function stripDeviceCommands(text) {
  if (!text) return text;
  return text.replace(DEVICE_COMMAND_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Find a device by type from the devices list
 * @param {Array} devices - List of registered devices
 * @param {string} deviceType - Type to find: 'pump', 'vibe', or 'tens'
 * @returns {Object|null} - Device object or null
 */
function findDeviceByType(devices, deviceType) {
  if (!devices || !Array.isArray(devices)) return null;

  // Map command names to device types
  const typeMap = {
    'pump': 'PUMP',
    'vibe': 'VIBE',
    'tens': 'TENS'
  };

  const targetType = typeMap[deviceType.toLowerCase()];
  if (!targetType) return null;

  // For PUMP, prefer the primary pump if set
  if (targetType === 'PUMP') {
    const primaryPump = devices.find(d => d.deviceType === 'PUMP' && d.isPrimaryPump);
    if (primaryPump) return primaryPump;
  }

  // Otherwise find first device of the type
  return devices.find(d => d.deviceType === targetType);
}

/**
 * Execute device commands parsed from LLM output
 * @param {Array} commands - Parsed commands from parseDeviceCommands
 * @param {Array} devices - List of registered devices
 * @param {Object} deviceService - DeviceService instance
 * @param {Object} options - Optional settings and sessionState for safety checks
 * @returns {Promise<Array>} - Results of each command execution
 */
async function executeDeviceCommands(commands, devices, deviceService, options = {}) {
  const results = [];
  const { settings, sessionState, broadcast } = options;

  for (const cmd of commands) {
    const device = findDeviceByType(devices, cmd.device);

    if (!device) {
      log.warn(`AI tried to control ${cmd.device} but no ${cmd.device.toUpperCase()} device is configured`);
      results.push({ command: cmd, success: false, error: `No ${cmd.device} device configured` });
      continue;
    }

    // Get the device identifier (ip for Kasa, deviceId for cloud devices)
    const deviceId = device.brand === 'govee' || device.brand === 'tuya' || device.brand === 'wyze'
      ? device.deviceId
      : device.ip;

    // Safety check: Block pump activation at 100% capacity (unless allowOverInflation is enabled)
    if (cmd.action === 'on' && cmd.device === 'pump') {
      const allowOverInflation = settings?.globalCharacterControls?.allowOverInflation;
      const currentCapacity = sessionState?.capacity ?? 0;

      if (!allowOverInflation && currentCapacity >= 100) {
        log.warn(`AI pump command blocked by safety - capacity at ${currentCapacity}%`);
        if (broadcast) {
          broadcast('pump_safety_block', {
            reason: 'capacity_limit',
            capacity: currentCapacity,
            device: device.label || device.name || 'Pump',
            source: 'llm'
          });
        }
        results.push({ command: cmd, success: false, blocked: true, error: 'Capacity at maximum - pump blocked for safety' });
        continue;
      }
    }

    try {
      let result;
      if (cmd.action === 'on') {
        result = await deviceService.turnOn(deviceId, device);
        log.info(`AI turned ON ${device.label || device.name || cmd.device}`);
      } else {
        result = await deviceService.turnOff(deviceId, device);
        log.info(`AI turned OFF ${device.label || device.name || cmd.device}`);
      }

      results.push({ command: cmd, success: !result.error, result, device });
    } catch (error) {
      log.error(`AI device control failed for ${cmd.device}:`, error.message);
      results.push({ command: cmd, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Process LLM output - parse commands, execute them, return cleaned text
 * @param {string} text - Raw LLM output
 * @param {Array} devices - List of registered devices
 * @param {Object} deviceService - DeviceService instance
 * @param {Object} options - Optional settings and sessionState for safety checks
 * @returns {Promise<{text: string, commands: Array, results: Array}>}
 */
async function processLlmOutput(text, devices, deviceService, options = {}) {
  const commands = parseDeviceCommands(text);

  if (commands.length === 0) {
    return { text, commands: [], results: [] };
  }

  log.info(`Found ${commands.length} device command(s) in LLM output`);

  // Execute commands (with safety checks if options provided)
  const results = await executeDeviceCommands(commands, devices, deviceService, options);

  // Strip commands from display text (always strip, even if blocked)
  const cleanedText = stripDeviceCommands(text);

  return { text: cleanedText, commands, results };
}

module.exports = {
  parseDeviceCommands,
  stripDeviceCommands,
  findDeviceByType,
  executeDeviceCommands,
  processLlmOutput
};
