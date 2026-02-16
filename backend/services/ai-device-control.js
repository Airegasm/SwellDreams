/**
 * AI Device Control - Parses device commands from LLM output
 *
 * Allows the AI model to control devices by including simple tags in responses:
 *
 * Basic On/Off:
 *   [pump on]  [pump off]
 *   [vibe on]  [vibe off]
 *   [tens on]  [tens off]
 *
 * Pulse Mode (quick on/off bursts):
 *   [pump:pulse:3]   - 3 quick pulses (0.5s on, 0.5s off)
 *   [vibe:pulse:5]   - 5 quick pulses
 *
 * Timed Mode (run for X seconds then auto-off):
 *   [pump:timed:30]  - Run for 30 seconds then turn off
 *   [vibe:timed:60]  - Run for 60 seconds then turn off
 *
 * Cycle Mode (repeated on/off cycles):
 *   [pump:cycle:5:10:3]   - 5s on, 10s off, repeat 3 times
 *   [vibe:cycle:3:8:0]    - 3s on, 8s off, repeat infinitely (0 = infinite)
 *   Format: [device:cycle:onDuration:interval:cycles]
 *
 * The commands are parsed out, executed, and stripped from the displayed message.
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('AIDeviceControl');

// Command patterns
// Case-insensitive (i flag), allows flexible whitespace inside brackets
const DEVICE_COMMAND_PATTERN = /\[\s*(pump|vibe|tens)\s+(on|off)\s*\]/gi;
const PULSE_COMMAND_PATTERN = /\[\s*(pump|vibe|tens):pulse:(\d+)\s*\]/gi;
const TIMED_COMMAND_PATTERN = /\[\s*(pump|vibe|tens):timed:(\d+)\s*\]/gi;
const CYCLE_COMMAND_PATTERN = /\[\s*(pump|vibe|tens):cycle:(\d+):(\d+):(\d+)\s*\]/gi;

// Phrases that indicate the LLM is describing pump activity (used for reinforcement)
// These patterns use word boundaries and flexible matching with wildcards
const PUMP_ACTIVITY_PHRASES = [
  // Direct pump references (word boundaries added to prevent "machine" matching "machinery")
  /\b(turn|turns|turned|turning)\s+(on|up)\s+\w*\s*(pump|compressor|machine)\b/i,
  /\b(start|starts|started|starting)\s+\w*\s*(pump|compressor|machine)\b/i,
  /\b(activate|activates|activated|activating)\s+\w*\s*(pump|compressor|machine)\b/i,
  /\b(engage|engages|engaged|engaging)\s+\w*\s*(pump|compressor|machine)\b/i,

  // Pump state/activity (removed "approaches device" patterns - too aggressive)
  /\bpump\s+(begins?|starts?|activates?|continues?|runs?|running|hums?|humming|whirs?|whirring)\b/i,
  /\bpump\s+is\s+(on|running|active|going)\b/i,
  /\b(the\s+)?(pump|machine)\b\s+(kicks|springs?|whirs?|hums?|roars?|comes?)\s*(in|into|to\s+life|alive|on)/i,

  // Flow/pressure references (pump-related)
  /\b(increase|increases|increased|increasing)\s+\w*\s*(flow|pressure|airflow)/i,
  /\b(increase|increases|increased|increasing)\s+the\s+(air\s*)?flow\s+(steadily|gradually|slowly|quickly)?\s*(once\s+more|again|further)?/i,
  /\b(adjust|adjusts|adjusted|adjusting)\s+.*?(flow|dial|dials|setting|settings|pressure|knob|knobs)/i,
  /\b(adjust|adjusts|adjusted|adjusting)\s+(the\s+)?(pump|compressor|machine|motor)\b\s+settings?/i,
  /\b(adjust|adjusts|adjusting)\s+(a|the)\s+(dial|knob|valve|control)\s+(with|slowly|carefully|deliberately)?/i,
  /\b(adjust|adjusts|adjusted|adjusting)\s*.*?\s*(dial|knob|valve|control|setting|lever)/i,
  /\b(turn|turns|turned|turning)\s+up\s+\w*\s*(flow|dial|pressure)/i,
  /\b(crank|cranks|cranked|cranking)\s+\w*\s*(up|higher|max)/i,
  /\b(crank|cranks|cranked|cranking)\s+\w*\s*(pressure|dial|flow|pump)/i,
  /\bpressure\s+(up\s+)?(to\s+)?(max|maximum|full|high)/i,
  /\bflow\s+(begins?|starts?|increases?|continues?)/i,
  /\b(start|starts|started|starting|restart|restarts|restarted|restarting)\s+(the\s+)?flow/i,
  /\bflow\s+of\s+(air|fluid|liquid|water)/i,
  /\b(air|liquid|fluid)\s+\w*\s*(flow|flowing|flows|pump|pumping|fill|filling|rush|rushing|surge|surging|hiss|hissing|pulsing|pulses)/i,
  /\b(air|fluid)\s+surg(e|es|ing)\s+(into|through|inside)/i,
  /\b(air|fluid|liquid)\s+flow(s|ing)?\s+(into|through|inside)/i,
  /\bpulsing\s+(air|fluid|liquid)\s+(into|through)/i,

  // Dial/control/button references - flexible article matching
  /\b(flip|flips|flipped|flipping|flick|flicks|flicked|flicking)\s+.*?\s*(switch|lever|dial|knob|control)/i,
  /\b(press|presses|pressed|pressing)\s+\w*\s*(button|remote)/i,
  /\b(push|pushes|pushed|pushing)\s+\w*\s*button/i,
  /\b(hit|hits|hitting)\s+\w*\s*button/i,

  // Wrist/hand gestures with controls
  /\b(flick|twist|turn|movement)\s+of\s+(her|his|their)\s+(wrist|hand).*?(turn|turns|flip|flips|adjust|adjusts|press|presses)/i,
  /\bwith\s+a\s+(quick|flick|twist|turn)\s+of\s+(her|his|their)\s+(wrist|hand)/i,

  // Switch/button/remote press followed by device activation
  /\b(press|presses|pressed|push|pushes|pushed|hit|hits|flip|flips|flipping)\s+.*?(button|switch|remote|lever).*?(pump|compressor|machine)\s+(springs?|kicks?|comes?|whirs?|hums?|roars?)\s+(to\s+life|on|alive)/i,
  /\b(button|switch|remote|lever).*?(pump|compressor|machine)\s+(springs?|kicks?|comes?|whirs?|hums?|roars?)\s+(to\s+life|on|alive)/i,
  /\b(flip|flips|flipped|flipping)\s+(a|the)\s+switch.*?(machine|pump|compressor)\s+(whirs?|kicks?|springs?|comes?|hums?)\s+(to\s+life|on)/i,
  /\b(reach|reaches|reached|reaching)\s+(for|toward)\s+\w*\s*(dial|controls?|switch|button|pump|panel)/i,
  /\b(hand|hands|finger|fingers?)\s+\w*\s*(move|moves|on|to|toward|press|presses|hit|hits)\s+\w*\s*(dial|controls?|button|panel)/i,
  /\b(grasp|grasps|grasped|grasping|grab|grabs|grabbed|grabbing|grip|grips|gripped|gripping)\s+.*?(dial|knob|control|handle|lever|valve)/i,
  /\b(turn|turns|turned|turning)\s+(it|the\s+dial|the\s+knob|the\s+valve)\s*(to|and)?\s*(start|begin|increase|restart)?/i,
  /\b(turn|turns|turned|turning)\s+the\s+(dial|knob|valve)/i,
  /\b(turn|turns|turned|turning)\s*.*?\s*(dial|knob|valve|control|lever)/i,
  /\b(open|opens|opened|opening)\s+(the\s+)?(valve|release)/i,

  // Machine/device coming to life or running
  /\b(machine|device|pump|compressor|motor)\b\s+(whirs?|hums?|roars?|buzzes?|comes?|springs?|kicks?)\s*(to\s+life|alive|into\s+action|on)/i,
  /\b(pump|machine|compressor|motor)\b\s+(roar|roars|roaring|whir|whirs|whirring|hum|hums|humming)/i,
  /\b(motor|pump|compressor)\b\s+(hum|hums|humming)\s+(loud|louder|loudly)/i,
  /\b(motor|pump|compressor|machine)\b\s+(hum|hums|humming)\s+at\s+(a\s+)?(higher|lower|faster|slower|steady|constant)\s+(pitch|speed|rate|pace)/i,
  /\b(air\s+)?pump\b\s+kicks\s+on/i,
  /\b(air\s+)?(pump|compressor)\b\s+springs\s+to\s+life/i,
  /\b(the\s+)?(machine|pump|compressor|device)\b\s+whirs\s+to\s+life/i,
  /\bkicks\s+(on|in|into\s+life)/i,
  /\bwhir(s|ring)?\s+to\s+life/i,
  /\bhum(s|ming)?\s+to\s+life/i,
  /\broar(s|ing)?\s+like\s+a/i,

  // Air/hissing sounds - strong pump indicators
  /\b(air|gas)\s+(hiss|hisses|hissing)\s*(through|into|from)/i,
  /\bhiss(es|ing)?\s+(of\s+)?(air|gas)/i,
  /\bhiss(es|ing)?\s+through\s+\w*\s*(tub|hose|line|pipe)/i,
  /\b(tub|hose|line|pipe)\w*\s+(hiss|hisses|hissing|fills?|swells?)/i,

  // Inflation/filling references (contextual pump activity)
  /\b(begin|begins|began|beginning)\s+(to\s+)?(inflate|inflating|fill|filling|pump|pumping|expand|expanding|swell|swelling)/i,
  /\b(start|starts|started|starting)\s+(to\s+)?(inflate|inflating|fill|filling|pump|pumping|expand|expanding|swell|swelling)/i,
  /\bair\s+to\s+begin\s+pump/i,
  /\binflation\s+(begins?|starts?|continues?|resumes?)/i,
  /\b(filling|inflation|pumping)\s+(process|sequence|cycle)\s+(begins?|starts?|continues?)/i,
  /\b(belly|stomach|abdomen)\s+(begins?|starts?)\s+(to\s+)?(fill|inflate|expand|swell|grow)/i,

  // Character action phrases
  /\b(sends?|sending)\s+(more\s+)?(air|liquid|fluid)\s+(into|through)/i,
  /\b(pumps?|pumping)\s+(more\s+)?(air|liquid|fluid)/i,
  /\b(resume|resumes|resumed|resuming)\s+\w*\s*(pumping|inflation|filling)/i,

  // Passive voice - "air being pumped", "fluid being pushed", etc.
  /\b(air|liquid|fluid|gas|water)\s+(being|getting|is|was)\s+(pump|pumped|pushed|forced|sent)/i,
  /\b(air|liquid|fluid|gas|water)\s+\w*\s*(pump|pumped|pushing|forced|forcing|flowing)\s+(into|through|inside)/i,
  /\b(force|forces|forced|forcing)\s+\w*\s*(air|liquid|fluid|gas|water)\s+(into|through)/i,
  /\btorrent\s+of\s+(air|liquid|fluid|water)/i,
  /\b(flood|rush|torrent|stream|gush|trickle)\s+(of\s+)?(air|fluid)/i,
  /\b(slow|steady|gentle)\s+trickle/i,

  // Control panel interactions
  /\bcontrol\s+panel\b.*\b(press|push|hit|flip|activate|adjust)/i,
  /\b(press|push|hit|flip|activate|adjust)\w*.*\bcontrol\s+panel/i,

  // Remote control interactions
  /\b(press|presses|pressed|push|pushes|pushed|click|clicks|clicked|tap|taps|tapped)\s+.*?\b(on\s+the\s+)?remote/i,
  /\b(use|uses|used|using|pick|picks|picked|grab|grabs|grabbed)\s+.*?\bremote/i,
  /\bremote.*?\b(press|push|click|tap|activate)/i,

  // Squeeze/bulb pump references
  /\bsqueeze(s|d|ing)?\s+(the\s+)?(bulb|pump|handle)/i,
  /\b(grip|grips|gripped|gripping)\s+.*?\bbulb\b/i,
  /\b(pump|squeeze)\s+bulb\b/i,

  // Gauge/dial movement (pump running indicators)
  /\b(dial|gauge|needle|meter)\s+(creep|creeps|crept|creeping|climb|climbs|climbing|rise|rises|rising|move|moves|moving)\s*(up|upward|higher)?/i,
  /\b(analog|pressure|psi)\s+(dial|gauge|needle|meter)\b/i,

  // Pump cycle/rhythm references
  /\bpump'?s?\s+(cycle|rhythm|pace|speed|rate)/i,
  /\bpump\s+\w+\s+(its|the|a)?\s*\w*\s*(rhythm|cycle|pace)/i,
  /\b(cycle|rhythm|pace)\s+(changes?|shifts?|increases?|decreases?|quickens?|slows?|continues?)/i,
  /\b(merciless|relentless|steady|constant|rhythmic)\s+(rhythm|pace|pumping|cycle)/i,

  // Pitch/speed changes (device working harder or changing state)
  /\b(motor|pump|compressor|machine)\s+(speed|pitch|tone|rpm)\s+(changes?|shifts?|increases?|rises?)/i,
  /\b(settl|settling|settled)\s+(into|to)\s+(a|an)?\s*(higher|lower|faster|slower)\s+(pitch|speed|tone|pace)/i,
  /\b(higher|lower|faster|slower)\s+(pitch|speed|tone|rpm)/i,
  /\bsurge(s|ing)?\s+(of\s+)?(air|fluid|liquid|pressure)/i,
  /\b(air|fluid|pressure)\s+surg(e|es|ing)/i,
  /\bpulse(s|ing)?\s+(of\s+)?(air|fluid|liquid|pressure)/i,
  /\b(air|fluid)\s+puls(e|es|ing)/i,
  /\b(steady|rhythmic|pulsing|constant)\s+(flow|stream|pump|hiss|surge)/i
];

// Phrases that indicate turning pump OFF (must contain "off" keyword)
const PUMP_OFF_PHRASES = [
  // Direct off commands
  /\b(turn|turns|turned|turning)\s+.*?\s*(pump|compressor|machine|motor)\s+off/i,
  /\b(turn|turns|turned|turning)\s+off\s+.*?\s*(pump|compressor|machine|motor)/i,
  /\b(shut|shuts|shutdown|shutting)\s+.*?\s*(down|off)\s+.*?\s*(pump|compressor|machine|motor)/i,
  /\b(stop|stops|stopped|stopping)\s+.*?\s*(pump|compressor|machine|motor)/i,
  /\b(disable|disables|disabled|disabling|deactivate|deactivates|deactivated|deactivating)\s+.*?\s*(pump|compressor|machine|motor)/i,

  // Control actions with "off"
  /\b(flip|flips|flipped|flipping)\s+.*?\s*(switch|lever)\s+off/i,
  /\b(flip|flips|flipped|flipping)\s+.*?\s*off.*?\s*(switch|lever)/i,
  /\b(press|presses|pressed|pressing|push|pushes|pushed|pushing)\s+.*?\s*off.*?\s*(button|switch)/i,
  /\b(press|presses|pressed|pressing|push|pushes|pushed|pushing)\s+.*?\s*(button|switch)\s+.*?\s*off/i,
  /\b(turn|turns|turned|turning)\s+.*?\s*(dial|knob|valve)\s+off/i,
  /\b(turn|turns|turned|turning)\s+.*?\s*off.*?\s*(dial|knob|valve)/i,

  // Kill/end/cease
  /\b(kill|kills|killed|killing|end|ends|ended|ending|cease|ceases|ceased|ceasing)\s+.*?\s*(pump|inflation|flow|pressure)/i,
  /\b(cut|cuts|cutting)\s+.*?\s*(power|pump|flow|pressure)/i,

  // Machine stopping
  /\b(pump|compressor|machine|motor)\s+.*?\s*(stop|stops|stopped|stopping|shut|shuts|wind|winds|power|powers)\s+(down|off)/i,
  /\b(pump|compressor|machine|motor)\s+.*?\s*(dies?|dying|sputters?|sputtering)/i,
];

// Track active LLM device timers for auto-off
const llmDeviceTimers = new Map();

/**
 * Parse device commands from text
 * @param {string} text - LLM output text
 * @returns {Array<{device: string, action: string, match: string, duration?: number}>}
 */
function parseDeviceCommands(text) {
  if (!text) return [];

  const commands = [];
  let match;

  // Reset regex state
  DEVICE_COMMAND_PATTERN.lastIndex = 0;

  // Parse standard on/off commands
  while ((match = DEVICE_COMMAND_PATTERN.exec(text)) !== null) {
    commands.push({
      device: match[1].toLowerCase(),  // pump, vibe, or tens
      action: match[2].toLowerCase(),  // on or off
      match: match[0]                  // full match for stripping
    });
  }

  // Reset regex state for pulse commands
  PULSE_COMMAND_PATTERN.lastIndex = 0;

  // Parse pulse commands [pump:pulse:#]
  while ((match = PULSE_COMMAND_PATTERN.exec(text)) !== null) {
    commands.push({
      device: match[1].toLowerCase(),  // pump, vibe, or tens
      action: 'pulse',                 // pulse action
      pulses: parseInt(match[2]),      // number of pulses
      match: match[0]                  // full match for stripping
    });
  }

  // Reset regex state for timed commands
  TIMED_COMMAND_PATTERN.lastIndex = 0;

  // Parse timed commands [pump:timed:#]
  while ((match = TIMED_COMMAND_PATTERN.exec(text)) !== null) {
    commands.push({
      device: match[1].toLowerCase(),  // pump, vibe, or tens
      action: 'timed',                 // timed action
      duration: parseInt(match[2]),    // duration in seconds
      match: match[0]                  // full match for stripping
    });
  }

  // Reset regex state for cycle commands
  CYCLE_COMMAND_PATTERN.lastIndex = 0;

  // Parse cycle commands [pump:cycle:duration:interval:cycles]
  while ((match = CYCLE_COMMAND_PATTERN.exec(text)) !== null) {
    commands.push({
      device: match[1].toLowerCase(),       // pump, vibe, or tens
      action: 'cycle',                      // cycle action
      cycleDuration: parseInt(match[2]),    // on duration in seconds
      cycleInterval: parseInt(match[3]),    // off interval in seconds
      cycles: parseInt(match[4]),           // number of cycles (0 = infinite)
      match: match[0]                       // full match for stripping
    });
  }

  // Debug: If no commands found but text contains device keywords, log for diagnosis
  if (commands.length === 0 && text.length > 0) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('[pump') || lowerText.includes('[vibe') || lowerText.includes('[tens')) {
      // Find the context around the bracket
      const bracketIndex = lowerText.search(/\[(pump|vibe|tens)/i);
      if (bracketIndex >= 0) {
        const context = text.substring(Math.max(0, bracketIndex - 5), Math.min(text.length, bracketIndex + 30));
        log.warn(`Near-miss device tag detected but not matched: "...${context}..."`);
        log.warn(`Check for formatting issues. Expected formats:`);
        log.warn(`  [pump on], [vibe off]`);
        log.warn(`  [pump:pulse:3] - 3 pulses`);
        log.warn(`  [pump:timed:30] - 30 seconds`);
        log.warn(`  [pump:cycle:5:10:3] - 5s on, 10s off, 3 cycles`);
      }
    }
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

  // Reset regex lastIndex to ensure patterns work correctly
  DEVICE_COMMAND_PATTERN.lastIndex = 0;
  PULSE_COMMAND_PATTERN.lastIndex = 0;
  TIMED_COMMAND_PATTERN.lastIndex = 0;
  CYCLE_COMMAND_PATTERN.lastIndex = 0;

  return text
    .replace(DEVICE_COMMAND_PATTERN, '')
    .replace(PULSE_COMMAND_PATTERN, '')
    .replace(TIMED_COMMAND_PATTERN, '')
    .replace(CYCLE_COMMAND_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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

  // Deduplicate: if same device has multiple commands, only execute the LAST one
  // This handles cases where LLM outputs both [pump on] and [pump off] in same message
  const deduped = new Map();
  for (const cmd of commands) {
    deduped.set(cmd.device, cmd);
  }
  const dedupedCommands = Array.from(deduped.values());

  if (dedupedCommands.length < commands.length) {
    log.info(`Deduplicated ${commands.length} commands to ${dedupedCommands.length} (keeping last command per device)`);
  }

  for (const cmd of dedupedCommands) {
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
    if ((cmd.action === 'on' || cmd.action === 'pulse' || cmd.action === 'timed' || cmd.action === 'cycle') && cmd.device === 'pump') {
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

      } else if (cmd.action === 'pulse') {
        // Pulse mode: quick on/off bursts
        const pulses = cmd.pulses || settings?.globalCharacterControls?.llmDeviceControlPulses || 3;

        // Clear any existing timer for this device
        if (llmDeviceTimers.has(timerKey)) {
          clearTimeout(llmDeviceTimers.get(timerKey));
          log.info(`Cleared existing timer for ${cmd.device}`);
        }

        result = await deviceService.pulsePump(deviceId, pulses, device);
        log.info(`AI PULSE ${device.label || device.name || cmd.device} x${pulses}`);

        if (broadcast) {
          broadcast('ai_device_control', {
            device: cmd.device,
            action: 'pulse',
            pulses: pulses,
            deviceName: device.label || device.name || cmd.device
          });
        }

      } else if (cmd.action === 'timed') {
        // Timed mode: run for X seconds then auto-off
        const duration = cmd.duration || maxSeconds;

        result = await deviceService.turnOn(deviceId, device);
        log.info(`AI TIMED ${device.label || device.name || cmd.device} for ${duration}s`);

        // Clear any existing timer for this device
        if (llmDeviceTimers.has(timerKey)) {
          clearTimeout(llmDeviceTimers.get(timerKey));
          log.info(`Cleared existing timer for ${cmd.device}`);
        }

        // Set timed auto-off timer
        const timer = setTimeout(async () => {
          try {
            await deviceService.turnOff(deviceId, device);
            log.info(`AI timed complete: turned OFF ${device.label || device.name || cmd.device} after ${duration}s`);
            llmDeviceTimers.delete(timerKey);

            if (broadcast) {
              broadcast('ai_device_control', {
                device: cmd.device,
                action: 'off',
                deviceName: device.label || device.name || cmd.device,
                autoOff: true,
                reason: `Timed mode complete after ${duration}s`
              });
            }
          } catch (err) {
            log.error(`AI timed auto-off failed for ${cmd.device}:`, err.message);
          }
        }, duration * 1000);

        llmDeviceTimers.set(timerKey, timer);

        if (broadcast) {
          broadcast('ai_device_control', {
            device: cmd.device,
            action: 'timed',
            duration: duration,
            deviceName: device.label || device.name || cmd.device
          });
        }

      } else if (cmd.action === 'cycle') {
        // Cycle mode: repeated on/off cycles
        const cycleDuration = cmd.cycleDuration || 5;
        const cycleInterval = cmd.cycleInterval || 10;
        const cycles = cmd.cycles || 0; // 0 = infinite

        // Clear any existing timer/cycle for this device
        if (llmDeviceTimers.has(timerKey)) {
          clearTimeout(llmDeviceTimers.get(timerKey));
          log.info(`Cleared existing timer for ${cmd.device}`);
        }

        // Stop any existing cycle
        await deviceService.stopCycle(deviceId, device);

        result = await deviceService.startCycle(deviceId, {
          duration: cycleDuration,
          interval: cycleInterval,
          cycles: cycles,
          repeat: cycles === 0
        }, device);

        log.info(`AI CYCLE ${device.label || device.name || cmd.device}: ${cycleDuration}s on, ${cycleInterval}s off, ${cycles || '∞'} cycles`);

        if (broadcast) {
          broadcast('ai_device_control', {
            device: cmd.device,
            action: 'cycle',
            cycleDuration,
            cycleInterval,
            cycles,
            deviceName: device.label || device.name || cmd.device
          });
        }

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
 * Detect if text contains phrases suggesting pump activity
 * @param {string} text - Text to analyze
 * @returns {{detected: boolean, matchedPhrase: string|null}}
 */
function detectPumpActivityPhrases(text) {
  if (!text) return { detected: false, matchedPhrase: null };

  const lowerText = text.toLowerCase();

  for (const pattern of PUMP_ACTIVITY_PHRASES) {
    const match = text.match(pattern);
    if (match) {
      return { detected: true, matchedPhrase: match[0] };
    }
  }

  return { detected: false, matchedPhrase: null };
}

/**
 * Check if any pump device is currently running
 * @param {Object} sessionState - Session state with executionHistory
 * @param {Array} devices - List of registered devices
 * @returns {boolean}
 */
function isPumpCurrentlyRunning(sessionState, devices) {
  if (!sessionState?.executionHistory?.deviceActions) return false;
  if (!devices || !Array.isArray(devices)) return false;

  // Get all pump devices
  const pumpDevices = devices.filter(d => d.deviceType === 'PUMP');

  for (const pump of pumpDevices) {
    // Construct the state key the same way event-engine does
    const deviceId = pump.brand === 'govee' || pump.brand === 'tuya' || pump.brand === 'wyze'
      ? pump.deviceId
      : pump.ip;
    const stateKey = `${deviceId}-PUMP`;

    const deviceState = sessionState.executionHistory.deviceActions[stateKey];
    if (deviceState && (deviceState.state === 'on' || deviceState.cycling)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if text already contains a [pump on] or [pump:pulse:#] tag
 * @param {string} text - Text to check
 * @returns {boolean}
 */
function hasPumpOnTag(text) {
  if (!text) return false;
  return /\[\s*pump\s+(on|off)\s*\]/i.test(text)
    || /\[\s*pump:pulse:\d+\s*\]/i.test(text)
    || /\[\s*pump:timed:\d+\s*\]/i.test(text)
    || /\[\s*pump:cycle:\d+:\d+:\d+\s*\]/i.test(text);
}

/**
 * Patterns that specifically indicate pulsing/rhythmic pump activity
 */
const PULSE_SPECIFIC_PHRASES = [
  // Direct pulse references
  /\bpulse(s|d)?\b/i,
  /\bpulsing\b/i,
  /\bpulsat(e|es|ing)\b/i,

  // Pulse + substance
  /\bpulse(s|ing|d)?\s+(of\s+)?(air|fluid|liquid|pressure)/i,
  /\b(air|fluid|pressure)\s+puls(e|es|ing|ed)/i,

  // Rhythmic/burst patterns
  /\bpulsing\s+(flow|rhythm|stream|sensation)/i,
  /\b(short|brief|quick)\s+(burst|pulse|pump)/i,
  /\bburst(s)?\s+(of\s+)?(air|fluid|pressure)/i,
  /\b(rhythmic|pulsing|pulsating)\s+(burst|pump|flow|waves?)/i,

  // Throbbing (similar to pulsing)
  /\bthrob(s|bing|bed)?\b/i,
  /\b(air|fluid|pressure)\s+throb/i,

  // Pulsing vibration/sensation
  /\bpulsing\s+vibration/i,
  /\bpulsating\s+vibration/i,
  /\b(low|deep|steady)\s*,?\s*pulsing/i,

  // Wave patterns (rhythmic like pulses)
  /\bwaves?\s+of\s+(air|pressure|fluid|sensation)/i,
  /\b(air|pressure)\s+waves?\b/i,

  // Beat patterns
  /\b(steady|rhythmic|regular)\s+beat/i,
  /\bbeat(s|ing)?\s+of\s+(air|pressure)/i,

  // Interval/rhythm references
  /\b(each|every|another|the\s+next)\s+(pulse|burst|wave|beat)/i,
  /\bpulse\s+after\s+pulse/i,
  /\b(steady|slow|quick|fast|random|erratic|irregular)\s+pulses?/i,
  /\bin\s+(pulses|bursts|waves)/i,

  // Random/erratic patterns
  /\brandom\s+pulse/i,
  /\berratic\s*(,|\s)?\s*(pulsing|rhythm|pattern|pumping)/i,
  /\b(rhythm|pattern)\s+(becoming|turns?|goes?)\s+(erratic|random|irregular)/i,
  /\birregular\s+(pulse|burst|rhythm|pattern)/i,

  // Squeeze patterns (manual pump / bulb pump)
  /\bsqueeze(s|d)?\b/i,
  /\bsqueezing\b/i,
  /\bsqueeze\s+interval/i,
  /\b(steady|rhythmic|slow|quick)\s+squeeze/i,
  /\bgrip.*\bbulb\b/i,
  /\b(pump|squeeze)\s+bulb\b/i
];

/**
 * Check if text contains pulse-specific phrases
 * @param {string} text - Text to check
 * @returns {boolean}
 */
function containsPulsePhrase(text) {
  if (!text) return false;
  for (const pattern of PULSE_SPECIFIC_PHRASES) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Reinforce LLM device control by detecting pump-related phrases and auto-appending [pump on]
 * or [pump:pulse:#] if the LLM mentioned pump activity but didn't include the tag
 * @param {string} text - LLM output text
 * @param {Array} devices - List of registered devices
 * @param {Object} sessionState - Session state
 * @param {Object} settings - App settings (to check if LLM device control is enabled)
 * @returns {{text: string, reinforced: boolean, matchedPhrase: string|null, isPulse: boolean}}
 */
function reinforcePumpControl(text, devices, sessionState, settings) {
  // Only reinforce if LLM device control is enabled
  if (!settings?.globalCharacterControls?.allowLlmDeviceControl) {
    return { text, reinforced: false, matchedPhrase: null, isPulse: false };
  }

  // Check if text already has [pump on] or [pump:pulse:#] tag
  if (hasPumpOnTag(text)) {
    log.info('[Reinforce] Text already contains pump tag - no reinforcement needed');
    return { text, reinforced: false, matchedPhrase: null, isPulse: false };
  }

  // Check for OFF phrases first (only trigger if "off" is in the sentence)
  for (const pattern of PUMP_OFF_PHRASES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      const match = text.match(pattern);
      log.info(`[Reinforce] Detected OFF phrase: "${match[0]}" - auto-appending [pump off]`);
      const reinforcedText = text.trimEnd() + ' [pump off]';
      return { text: reinforcedText, reinforced: true, matchedPhrase: match[0], isOff: true };
    }
  }

  // Detect pump activity phrases
  const { detected, matchedPhrase } = detectPumpActivityPhrases(text);

  if (detected) {
    // Only skip for clearly hypothetical/imaginary text — minimal guard
    const hypotheticalMarkers = [
      /\b(imagine|picture|think\s+about|remember\s+when|describe|talk\s+about|discuss)\b/i,
      /\b(would|could|might)\s+(start|begin|pump|inflate)/i,
      /\b(if\s+(I|we)\s+(were|could)|what\s+if)\b.*\b(pump|inflate)/i,
    ];

    for (const marker of hypotheticalMarkers) {
      if (marker.test(text)) {
        log.info(`[Reinforce] Hypothetical marker - skipping: "${matchedPhrase}"`);
        return { text, reinforced: false, matchedPhrase: null, isPulse: false };
      }
    }

    // Check for specific mode indicators in the text
    const isPulse = containsPulsePhrase(text);
    const isCycle = /\b(cycle|cycles|cycling|rhythm|rhythmic|pattern|patterns|repeat|repeats|repeating|intervals?)\b/i.test(text);
    const isTimed = /\b(for\s+\d+\s*(seconds?|minutes?|secs?|mins?)|timed|duration|temporary|briefly|momentarily)\b/i.test(text);

    // Weighted random selection if no specific mode indicated
    // 35% on, ~22% pulse, ~22% cycle, ~21% timed
    const rand = Math.random();
    let mode, tag;

    if (isPulse || (!isCycle && !isTimed && rand < 0.22)) {
      // PULSE mode (22% random, or if pulse keyword detected)
      // Random pulses between 20-30
      const pulses = Math.floor(Math.random() * 11) + 20; // 20-30
      tag = `[pump:pulse:${pulses}]`;
      mode = 'pulse';
    } else if (isCycle || (!isPulse && !isTimed && rand >= 0.22 && rand < 0.44)) {
      // CYCLE mode (22% random, or if "cycle" mentioned)
      // Duration: 3-10 seconds, Interval: 2-5 seconds, Cycles: 5-10
      const cycleDuration = Math.floor(Math.random() * 8) + 3; // 3-10 secs
      const cycleInterval = Math.floor(Math.random() * 4) + 2; // 2-5 secs
      const cycles = Math.floor(Math.random() * 6) + 5; // 5-10 cycles
      tag = `[pump:cycle:${cycleDuration}:${cycleInterval}:${cycles}]`;
      mode = 'cycle';
    } else if (isTimed || (!isPulse && !isCycle && rand >= 0.44 && rand < 0.65)) {
      // TIMED mode (21% random, or if duration mentioned)
      // Min: global setting, Max: 2x global setting
      const baseDuration = settings?.globalCharacterControls?.llmDeviceControlMaxSeconds || 30;
      const duration = Math.floor(Math.random() * baseDuration) + baseDuration; // baseDuration to 2x
      tag = `[pump:timed:${duration}]`;
      mode = 'timed';
    } else {
      // Simple ON (35% of the time when no specific mode)
      tag = '[pump on]';
      mode = 'on';
    }

    log.info(`[Reinforce] Detected pump activity: "${matchedPhrase}" - using ${mode} mode: ${tag}`);
    const reinforcedText = text.trimEnd() + ` ${tag}`;
    return { text: reinforcedText, reinforced: true, matchedPhrase, mode };
  }

  return { text, reinforced: false, matchedPhrase: null, isPulse: false };
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
  log.info(`Processing text for device commands (${text?.length || 0} chars): "${text?.substring(0, 100)}..."`);
  const commands = parseDeviceCommands(text);
  log.info(`Parsed ${commands.length} command(s):`, commands);

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
  clearAllLlmTimers,
  detectPumpActivityPhrases,
  isPumpCurrentlyRunning,
  hasPumpOnTag,
  containsPulsePhrase,
  reinforcePumpControl
};
