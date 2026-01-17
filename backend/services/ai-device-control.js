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

// Track active LLM device timers for auto-off
const llmDeviceTimers = new Map();

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

  // Get max seconds for LLM device control (default 30)
  const maxSeconds = settings?.globalCharacterControls?.llmDeviceControlMaxSeconds || 30;

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

    // Create a unique key for this device's timer
    const timerKey = `${cmd.device}-${deviceId}`;

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
        log.info(`AI turned ON ${device.label || device.name || cmd.device} (auto-off in ${maxSeconds}s)`);

        // Clear any existing timer for this device
        if (llmDeviceTimers.has(timerKey)) {
          clearTimeout(llmDeviceTimers.get(timerKey));
          log.info(`Cleared existing auto-off timer for ${cmd.device}`);
        }

        // Set auto-off timer
        const timer = setTimeout(async () => {
          try {
            await deviceService.turnOff(deviceId, device);
            log.info(`AI auto-off: turned OFF ${device.label || device.name || cmd.device} after ${maxSeconds}s`);
            llmDeviceTimers.delete(timerKey);

            // Inject context into chat history so LLM believes they turned it off
            if (options.injectContext) {
              options.injectContext(`[pump off]`);
            }

            if (broadcast) {
              broadcast('ai_device_control', {
                device: cmd.device,
                action: 'off',
                deviceName: device.label || device.name || cmd.device,
                autoOff: true,
                reason: `Auto-off after ${maxSeconds}s`
              });
            }
          } catch (err) {
            log.error(`AI auto-off failed for ${cmd.device}:`, err.message);
          }
        }, maxSeconds * 1000);

        llmDeviceTimers.set(timerKey, timer);

      } else {
        // Manual off command - clear any pending auto-off timer
        if (llmDeviceTimers.has(timerKey)) {
          clearTimeout(llmDeviceTimers.get(timerKey));
          llmDeviceTimers.delete(timerKey);
          log.info(`Cleared auto-off timer for ${cmd.device} due to manual off`);
        }

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
 * Clear all LLM device timers (e.g., on emergency stop)
 */
function clearAllLlmTimers() {
  for (const [key, timer] of llmDeviceTimers.entries()) {
    clearTimeout(timer);
    log.info(`Cleared LLM device timer: ${key}`);
  }
  llmDeviceTimers.clear();
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
  processLlmOutput,
  clearAllLlmTimers
};
