/**
 * Event Engine — shared engine state for the Trigger Tree system.
 * The flow-execution machinery was removed (E3, 2026-07-29). What remains is the live plumbing
 * trees and the server depend on: variable store + substitution ([Flow:]/[System:]/expressions),
 * state-change monitors feeding treeEventSink, message/idle bookkeeping, emergency stop, and the
 * broadcast bridge the server wraps (setBroadcast) for engine-emitted ai/player messages.
 */

const fs = require('fs');
const path = require('path');

// Data file paths
const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  personas: path.join(DATA_DIR, 'personas.json'),
  characters: path.join(DATA_DIR, 'characters.json'),
  devices: path.join(DATA_DIR, 'devices.json')
};

function loadData(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e);
  }
  return null;
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`Error saving ${file}:`, e);
    return false;
  }
}

/**
 * Resolve device aliases like "primary_pump" to actual device IPs
 * Persistence priority: isPrimary flag > first matching deviceType
 * @param {string} deviceRef - Device reference (IP, alias, or name)
 * @returns {string|null} - Resolved device IP or null if not found
 */
function resolveDeviceAlias(deviceRef) {
  const device = resolveDeviceObject(deviceRef);
  if (!device) return null;
  // Return IP for TPLink, deviceId for Govee/Tuya
  return device.brand === 'govee' || device.brand === 'tuya' ? device.deviceId : device.ip;
}

/**
 * Resolve device aliases to full device objects (includes childId, brand, sku, etc.)
 * This is needed for proper device control including power strip outlets and Govee devices
 * @param {string} deviceRef - Device reference (IP, alias, or name)
 * @returns {Object|null} - Full device object or null if not found
 */
function resolveDeviceObject(deviceRef) {
  if (!deviceRef) return null;

  // Load devices to resolve alias
  const devices = loadData(DATA_FILES.devices) || [];

  // Check for ip:childId format (power strip outlets)
  const ipChildIdMatch = deviceRef.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
  if (ipChildIdMatch) {
    const [, ip, childIdStr] = ipChildIdMatch;
    const childId = parseInt(childIdStr, 10);
    // Find device matching both IP and childId
    const device = devices.find(d => d.ip === ip && d.childId === childId);
    if (device) {
      console.log(`[DeviceAlias] Resolved ${deviceRef} to power strip outlet childId=${childId}`);
      return device;
    }
    // If no device found but valid format, return minimal object with childId
    console.log(`[DeviceAlias] No device found for ${deviceRef}, using minimal object`);
    return { ip, childId, brand: 'tplink' };
  }

  // If it's already an IP address (no childId), find the matching device
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(deviceRef)) {
    // For plain IP, prefer devices without childId (non-power-strip devices)
    const device = devices.find(d => d.ip === deviceRef && (d.childId === undefined || d.childId === null));
    if (device) return device;
    // Fallback: any device with that IP (first match)
    const anyMatch = devices.find(d => d.ip === deviceRef);
    if (anyMatch) return anyMatch;
    // If no device found but it's a valid IP, return a minimal object
    return { ip: deviceRef, brand: 'tplink' };
  }

  // Handle primary_pump alias
  if (deviceRef === 'primary_pump') {
    // First priority: device explicitly marked as isPrimaryPump
    const explicitPrimary = devices.find(d => d.isPrimaryPump === true && d.deviceType === 'PUMP');
    if (explicitPrimary) {
      console.log(`[DeviceAlias] Resolved primary_pump to ${explicitPrimary.ip || explicitPrimary.deviceId} (explicit isPrimaryPump)`);
      return explicitPrimary;
    }
    // Second priority: first device with deviceType === 'PUMP'
    const pump = devices.find(d => d.deviceType === 'PUMP');
    if (pump) {
      console.log(`[DeviceAlias] Resolved primary_pump to ${pump.ip || pump.deviceId} (first PUMP device)`);
      return pump;
    }
    console.log('[DeviceAlias] No PUMP device found for primary_pump alias');
    return null;
  }

  // Handle primary_vibe alias
  if (deviceRef === 'primary_vibe') {
    // First priority: device explicitly marked as isPrimaryVibe
    const explicitPrimary = devices.find(d => d.isPrimaryVibe === true && d.deviceType === 'VIBE');
    if (explicitPrimary) {
      console.log(`[DeviceAlias] Resolved primary_vibe to ${explicitPrimary.ip || explicitPrimary.deviceId} (explicit isPrimaryVibe)`);
      return explicitPrimary;
    }
    // Second priority: first device with deviceType === 'VIBE'
    const vibe = devices.find(d => d.deviceType === 'VIBE');
    if (vibe) {
      console.log(`[DeviceAlias] Resolved primary_vibe to ${vibe.ip || vibe.deviceId} (first VIBE device)`);
      return vibe;
    }
    console.log('[DeviceAlias] No VIBE device found for primary_vibe alias');
    return null;
  }

  // Try to match by device UUID/id
  const byId = devices.find(d => d.id === deviceRef);
  if (byId) {
    console.log(`[DeviceAlias] Resolved "${deviceRef}" to ${byId.name || byId.label} by UUID`);
    return byId;
  }

  // Try to match by device name or label
  const byName = devices.find(d =>
    d.name?.toLowerCase() === deviceRef.toLowerCase() ||
    d.label?.toLowerCase() === deviceRef.toLowerCase()
  );
  if (byName) {
    console.log(`[DeviceAlias] Resolved "${deviceRef}" to ${byName.ip || byName.deviceId} by name/label`);
    return byName;
  }

  console.log(`[DeviceAlias] Could not resolve device reference: ${deviceRef}`);
  return null;
}

/**
 * Match text against a pattern with wildcards (*) and word alternatives [word/word/word]
 * Example: *how*much*[pump/put/force]*me* matches "How much more are you going to pump into me?"
 * Simple keywords without wildcards use word-boundary matching to avoid substring false positives
 * @param {string} text - The text to match against
 * @param {string} pattern - The pattern with wildcards and alternatives
 * @returns {boolean} - Whether the text matches the pattern
 */
function matchPattern(text, pattern) {
  if (!pattern) return true;
  if (!text) return false;

  // Check if this is a simple keyword (no wildcards or alternatives)
  const isSimpleKeyword = !pattern.includes('*') && !pattern.includes('[');

  // Convert pattern to regex
  // 1. Escape special regex characters (except * and [ ] /)
  // 2. Convert * to .*
  // 3. Convert [word/word/word] to (word|word|word)

  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      // Wildcard - match any characters
      regexStr += '.*';
      i++;
    } else if (char === '[') {
      // Start of alternatives group
      const endBracket = pattern.indexOf(']', i);
      if (endBracket === -1) {
        // No closing bracket, treat as literal
        regexStr += '\\[';
        i++;
      } else {
        // Extract alternatives and convert to regex group
        const alternatives = pattern.substring(i + 1, endBracket);
        const words = alternatives.split('/').map(w => w.trim().replace(/[.*+?^${}()|\\]/g, '\\$&'));
        regexStr += '(' + words.join('|') + ')';
        i = endBracket + 1;
      }
    } else {
      // Regular character - escape if it's a regex special char
      regexStr += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  // For simple keywords, add word boundaries to prevent matching inside other words
  // e.g., "no" should NOT match "knowing" or "nervous"
  // Only add \b where the pattern has word characters (letters/digits/underscore)
  // so "no!" still matches (boundary before 'n', but not after '!')
  if (isSimpleKeyword && pattern.length > 0) {
    const firstChar = pattern[0];
    const lastChar = pattern[pattern.length - 1];
    const isWordChar = (c) => /\w/.test(c);

    if (isWordChar(firstChar)) {
      regexStr = '\\b' + regexStr;
    }
    if (isWordChar(lastChar)) {
      regexStr = regexStr + '\\b';
    }
  }

  try {
    const regex = new RegExp(regexStr, 'i'); // Case-insensitive
    return regex.test(text);
  } catch (e) {
    console.error('[EventEngine] Invalid pattern regex:', e);
    // Fallback to simple includes
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

class EventEngine {
  constructor(deviceService, llmService) {
    this.deviceService = deviceService;
    this.llmService = llmService;
    this.activeFlows = new Map();
    this.flowStates = new Map();
    this.flowVariables = new Map();
    this.variables = {};
    this.executionHistory = [];
    this.timers = new Map();
    this.idleTimer = null;
    this.lastActivity = Date.now();
    this.broadcastFn = null;
    this.sessionState = null;
    this.deviceMonitors = new Map(); // Track device "until" conditions
    this.pendingPlayerChoice = null; // Track pending player choice for flow continuation
    this.pendingChallenge = null; // Track pending challenge for flow continuation
    this.pendingInput = null; // Track pending input for flow continuation
    this.pendingCycleCompletions = new Map(); // Track pending cycle completions: device -> { flowId, nodeId, isInfinite }
    this.pendingDeviceOnCompletions = new Map(); // Track pending device_on completions: device -> { flowId, nodeId, isInfinite }
    this.pendingPauseResume = new Map(); // Track pending pause/resume nodes: pauseId -> { flowId, nodeId, context, messagesRemaining, ... }
    this.flowActivatedDevices = new Map(); // Track devices activated by flows: device -> { flowId, deviceObj }
    this.previousPlayerState = { // Track player state for change detection
      capacity: 0,
      pain: 0, // 0-10 numeric pain scale
      emotion: 'neutral'
    };
    this.previousCharacterCapacity = 0; // Track character capacity for change detection
    this.executedOnceConditions = new Set(); // Track conditions that have fired with onlyOnce
    this.simulationMode = false; // When true, device actions are simulated (not executed)
    this.aborted = false; // Emergency stop flag - when true, all flow execution halts immediately
    this.abortEpoch = 0; // Incremented on each abort - async ops check if epoch changed to detect abort

    // Test mode state - for flow testing from specific nodes
    this.testMode = false;
    this.testResults = [];
    this.testState = {}; // Mock state values for testing
    this.testStepCallback = null; // Callback for streaming test steps

    // Flow pause/resume state
    this.isPaused = false;
    this.pausedExecution = null; // { flowId, nodeId, content, type } - for resuming after LLM generation interrupt
    this.currentGenerationAborted = false; // Flag to discard in-progress LLM generation on pause

    // Flow execution state for UI status panel - track multiple active flows
    this.activeExecutions = new Map(); // flowId -> { flowId, flowName, triggerType, triggerLabel, currentNodeLabel, startTime }
    this.executionDepths = new Map(); // flowId -> depth count
    this.maxTrackedExecutions = 10; // Limit to prevent memory issues

    // Priority-based flow interruption
    this.runningFlowPriority = null; // Current running flow's trigger priority (1-5, null if no priority or no flow running)

    // Alternate welcome message from new_session triggers
    this.alternateWelcome = null; // { text, suppressLlmEnhancement }
  }

  /**
   * Set simulation mode - when true, device actions are logged but not executed
   */
  setSimulationMode(enabled) {
    this.simulationMode = enabled;
    console.log(`[EventEngine] Simulation mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Get and consume alternate welcome message from new_session trigger
   * Returns null if no alternate welcome was set, otherwise returns { text, suppressLlmEnhancement }
   * The alternate welcome is cleared after retrieval (one-time use)
   */
  getAlternateWelcome() {
    const welcome = this.alternateWelcome;
    this.alternateWelcome = null;
    return welcome;
  }

  /**
   * Emit a test step - pushes to results array and calls streaming callback if set
   * @param {Object} step - The step object to emit
   */
  setBroadcast(fn) {
    this.broadcastFn = fn;
  }

  /**
   * Set session state reference for conflict tracking
   */
  setSessionState(state) {
    this.sessionState = state;
  }

  /**
   * Set storage helpers for per-char/per-flow storage access
   * Injected from server.js to avoid circular dependency
   */
  setStorageHelpers(helpers) {
    this.storageHelpers = helpers;
  }

  /**
   * Broadcast message to clients
   * Returns a promise that resolves when the broadcast handler completes
   */
  async broadcast(type, data) {
    // Block flow-related broadcasts when aborted (except status updates)
    if (this.aborted) {
      const blockedTypes = ['ai_message', 'player_message', 'challenge', 'player_choice', 'choose_multi', 'simple_ab', 'flow_message'];
      if (blockedTypes.includes(type)) {
        console.log(`[EventEngine] Broadcast blocked (aborted): ${type}`);
        return;
      }
    }

    if (this.broadcastFn) {
      console.log(`[EventEngine] Calling broadcastFn for type: ${type}`);
      await this.broadcastFn(type, data);
    } else {
      console.log('[EventEngine] WARNING: No broadcastFn registered!');
    }
  }

  /**
   * Broadcast a flow error to clients for display as toast
   */
  async broadcastError(message, error = null, context = {}) {
    const errorMsg = error ? `${message}: ${error}` : message;
    console.error(`[EventEngine] Flow Error: ${errorMsg}`, context);
    await this.broadcast('error', {
      message: message,
      error: error?.toString() || null,
      context: context
    });
  }

  /**
   * Pause flow execution - call when user navigates away from Chat or switches tabs
   * If LLM generation is in progress, it will be aborted and queued for re-execution
   * @param {string} reason - Reason for pausing (e.g., "Player defocused chat.", "LLM is busy.")
   */
  async handleEvent(eventType, eventData) {
    this.lastActivity = Date.now();

    // Initialize cooldown tracking if needed
    if (!this.triggerCooldowns) {
      this.triggerCooldowns = {};
    }
    if (typeof this.messageCount !== 'number') {
      this.messageCount = 0;
    }

    // Reset message count and cooldowns on new session
    if (eventType === 'new_session') {
      this.messageCount = 0;
      this.triggerCooldowns = {};
      console.log(`[EventEngine] New session - reset messageCount and cooldowns`);
    }

    // Increment message count for player/ai speech events
    if (eventType === 'player_speaks' || eventType === 'ai_speaks') {
      this.messageCount++;
      console.log(`[EventEngine] Message count incremented to ${this.messageCount}`);

    }

    // Flow trigger dispatch removed (E3) — this method now only maintains the shared
    // bookkeeping (lastActivity / messageCount / cooldown reset) that trees and monitors read.
  }

  /**
   * Abort the currently running flow for priority interruption
   */
  async handleMediaBlockingComplete() {
    // Flow media-resume machinery removed (E3). The live [Video:blocking] gate is handled
    // server-side (sessionState.mediaBlocking); nothing to resume here anymore.
    }

  /**
   * Execute a pause_resume node - pause flow and resume after N messages
   */
  compareValues(current, operator, target) {
    // Convert to numbers if both are numeric strings
    const numCurrent = parseFloat(current);
    const numTarget = parseFloat(target);
    const isNumeric = !isNaN(numCurrent) && !isNaN(numTarget);

    switch (operator) {
      case '==':
        return isNumeric ? numCurrent === numTarget : String(current) === String(target);
      case '!=':
        return isNumeric ? numCurrent !== numTarget : String(current) !== String(target);
      case '>':
        return isNumeric ? numCurrent > numTarget : false;
      case '<':
        return isNumeric ? numCurrent < numTarget : false;
      case '>=':
        return isNumeric ? numCurrent >= numTarget : false;
      case '<=':
        return isNumeric ? numCurrent <= numTarget : false;
      case 'contains':
        return String(current).toLowerCase().includes(String(target).toLowerCase());
      default:
        return false;
    }
  }

  /**
   * Check pending pause/resume nodes and resume flows that have waited enough messages
   */
  evaluateCondition(data) {
    let value;

    switch (data.variable) {
      case 'capacity':
        value = this.variables.capacity || 0;
        break;
      case 'feeling':
        value = this.variables.feeling || 'normal';
        break;
      case 'emotion':
        value = this.variables.emotion || 'neutral';
        break;
      case 'device_state':
        // Check specific device state from execution history
        const deviceId = data.device || 'primary_pump';
        if (this.sessionState?.executionHistory?.deviceActions) {
          const deviceState = this.sessionState.executionHistory.deviceActions[deviceId];
          value = deviceState?.state || 'off';
        } else {
          value = 'off';
        }
        break;
      case 'custom':
        value = this.variables[data.customVariable] ?? '';
        break;
      default:
        value = this.variables[data.variable];
    }

    const compareValue = isNaN(data.value) ? data.value : parseFloat(data.value);

    switch (data.operator) {
      case '==':
        return value == compareValue;
      case '!=':
        return value != compareValue;
      case '>':
        return parseFloat(value) > parseFloat(compareValue);
      case '<':
        return parseFloat(value) < parseFloat(compareValue);
      case '>=':
        return parseFloat(value) >= parseFloat(compareValue);
      case '<=':
        return parseFloat(value) <= parseFloat(compareValue);
      case 'contains':
        return String(value).toLowerCase().includes(String(compareValue).toLowerCase());
      default:
        return false;
    }
  }

  /**
   * Evaluate multi-condition node
   * Returns: { result: boolean, conditionIndex: number }
   */
  evaluateConditions(data, flowId, nodeId) {
    // Support both new conditions array and legacy single condition
    const conditions = data.conditions || [data];

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      // Check onlyOnce flag
      const onceKey = `${flowId}-${nodeId}-condition-${i}`;
      if (condition.onlyOnce && this.executedOnceConditions.has(onceKey)) {
        console.log(`[EventEngine] Skipping condition ${i} - already fired once`);
        continue;
      }

      let value;
      switch (condition.variable) {
        case 'capacity':
          value = this.sessionState?.capacity ?? this.variables.capacity ?? 0;
          break;
        case 'pain':
          // Support new numeric pain scale (0-10)
          value = this.sessionState?.pain ?? this.variables.pain ?? 0;
          break;
        case 'feeling':
          // Legacy support - map to pain
          value = this.sessionState?.pain ?? this.variables.pain ?? 0;
          break;
        case 'emotion':
          value = this.sessionState?.emotion ?? this.variables.emotion ?? 'neutral';
          break;
        case 'characterCapacity':
          value = this.sessionState?.characterCapacity ?? 0;
          break;
        case 'device_state':
          // Check specific device state from execution history
          const condDeviceId = condition.device || 'primary_pump';
          if (this.sessionState?.executionHistory?.deviceActions) {
            const condDeviceState = this.sessionState.executionHistory.deviceActions[condDeviceId];
            value = condDeviceState?.state || 'off';
          } else {
            value = 'off';
          }
          break;
        case 'custom':
          // For custom variables, use the customVariable field
          value = this.variables[condition.customVariable] ?? '';
          break;
        default:
          value = this.variables[condition.variable];
      }

      const compareValue = isNaN(condition.value) ? condition.value : parseFloat(condition.value);
      let result = false;

      switch (condition.operator) {
        case '==':
          result = value == compareValue;
          break;
        case '!=':
          result = value != compareValue;
          break;
        case '>':
          result = parseFloat(value) > parseFloat(compareValue);
          break;
        case '<':
          result = parseFloat(value) < parseFloat(compareValue);
          break;
        case '>=':
          result = parseFloat(value) >= parseFloat(compareValue);
          break;
        case '<=':
          result = parseFloat(value) <= parseFloat(compareValue);
          break;
        case 'range':
          const min = parseFloat(condition.value);
          const max = parseFloat(condition.value2);
          const numValue = parseFloat(value);
          result = numValue >= min && numValue <= max;
          break;
        case 'contains':
          result = String(value).toLowerCase().includes(String(compareValue).toLowerCase());
          break;
      }

      if (result) {
        // Mark as executed if onlyOnce
        if (condition.onlyOnce) {
          this.executedOnceConditions.add(onceKey);
          console.log(`[EventEngine] Condition ${i} marked as fired once`);
        }
        console.log(`[EventEngine] Condition ${i} matched: ${condition.variable} ${condition.operator} ${condition.value}`);
        return { result: true, conditionIndex: i };
      }
    }

    console.log(`[EventEngine] No conditions matched, returning FALSE`);
    return { result: false, conditionIndex: -1 };
  }

  /**
   * Evaluate a branch node
   */
  evaluateBranch(data) {
    if (data.branchType === 'random') {
      // Weighted random selection
      const branches = data.branches || [];
      const totalWeight = branches.reduce((sum, b) => sum + (b.weight || 0), 0);

      if (totalWeight <= 0) {
        return Math.floor(Math.random() * branches.length);
      }

      let random = Math.random() * totalWeight;
      for (let i = 0; i < branches.length; i++) {
        random -= branches[i].weight || 0;
        if (random <= 0) return i;
      }

      return branches.length - 1;
    }

    // Sequential - just return 0 (first branch)
    return 0;
  }

  /**
   * Execute delay node
   */
  applySetVariable(varType, rawVariable, operation, rawValue, flowId = null, rawSource = null) {
    operation = operation || 'set';
    varType = varType || 'custom';

    // Resolve nested references in the target name (e.g. "[Choice]",
    // "score_[Choice]", "[Flow:[Choice]]") and in the value.
    const variable = this.substituteVariables(String(rawVariable ?? '')).trim();
    const value = this.evaluateExpression(this.substituteVariables(String(rawValue ?? '')));
    // Optional LEFT-OPERAND override ("set X = Y op value"): a source CharVar name — itself
    // substitutable, so a dynamically-built name works. Empty/null → classic behavior (the
    // target variable's own current value is the left operand).
    const sourceName = rawSource != null ? this.substituteVariables(String(rawSource)).trim() : '';

    if (!variable) {
      console.log('[EventEngine] applySetVariable: No variable specified');
      return false;
    }

    // For math ops both operands are coerced to numbers; "set" returns the
    // incoming value as-is so strings pass through unchanged.
    const applyOperation = (current, incoming) => {
      if (operation === 'set') return incoming;
      const curNum = parseFloat(current);
      const valNum = parseFloat(incoming);
      const a = isNaN(curNum) ? 0 : curNum;
      const b = isNaN(valNum) ? 0 : valNum;
      switch (operation) {
        case 'inc': return a + b;
        case 'dec': return a - b;
        case 'mult': return a * b;
        case 'div': return b !== 0 ? a / b : a;
        default: return incoming;
      }
    };

    if (varType === 'custom') {
      // With a source var: 'set' copies it (value ignored); math ops use it as the left operand
      // (X = Y op value) — enabling X-from-two-other-vars in one action.
      const base = sourceName !== '' ? this.variables[sourceName] : this.variables[variable];
      this.variables[variable] = (operation === 'set' && sourceName !== '')
        ? (this.variables[sourceName] !== undefined ? this.variables[sourceName] : value)
        : applyOperation(base, value);
      // Mirror into the flow-scoped map so switch/loop(until)/sessionTimer
      // (which read this.flowVariables) see the same value.
      if (flowId) {
        this.flowVariables.set(`${flowId}:${variable}`, this.variables[variable]);
      }
      if (this.sessionState) {
        this.sessionState.flowVariables = this.sessionState.flowVariables || {};
        this.sessionState.flowVariables[variable] = this.variables[variable];
      }
      console.log(`[EventEngine] Set flow variable [Flow:${variable}] = ${this.variables[variable]} (${operation})`);
      return true;
    }

    // System variable - update sessionState and broadcast
    if (variable === 'capacity') {
      const current = this.sessionState?.capacity ?? 0;
      // capacity is an integer 0-100 field. Compute in float (so mult/div keep
      // precision like the custom-var path), guard non-finite results, then
      // round for storage. Math.round preserves a real computed 0 (unlike `|| 0`).
      const computed = applyOperation(current, value);
      const numValue = Number.isFinite(computed) ? Math.round(computed) : current;
      const clampedValue = Math.max(0, Math.min(100, numValue));
      if (this.sessionState) {
        this.sessionState.capacity = clampedValue;
        this.broadcast('capacity_update', { capacity: clampedValue });
      }
      console.log(`[EventEngine] Set system variable [Capacity] = ${clampedValue} (${operation})`);
      return true;
    } else if (variable === 'pain' || variable === 'feeling') {
      const current = this.sessionState?.pain ?? 0;
      // pain is an integer 0-10 field. Same handling as capacity: float math,
      // finite guard, round for storage (Math.round keeps a real 0).
      const computed = applyOperation(current, value);
      const numValue = Number.isFinite(computed) ? Math.round(computed) : current;
      const clampedValue = Math.max(0, Math.min(10, numValue));
      if (this.sessionState) {
        this.sessionState.pain = clampedValue;
        this.broadcast('pain_update', { pain: clampedValue });
      }
      console.log(`[EventEngine] Set system variable [Pain] = ${clampedValue} (${operation})`);
      return true;
    } else if (variable === 'emotion') {
      if (this.sessionState) {
        this.sessionState.emotion = value;
        this.broadcast('emotion_update', { emotion: value });
      }
      console.log(`[EventEngine] Set system variable [Emotion] = ${value}`);
      return true;
    }

    console.log(`[EventEngine] applySetVariable: Unknown system variable "${variable}"`);
    return false;
  }

  substituteVariables(text) {
    if (!text) return text;

    // Resolve repeatedly so nested references collapse from the inside out,
    // e.g. [Flow:[Choice]] -> [Flow:red] -> <value of red>, or
    // [Flow:[Choice]_score] -> [Flow:red_score] -> <value>. Capped to avoid
    // infinite loops from self-referential variables.
    let result = String(text);
    // Resolve settings-backed system config variables (e.g. [BulbMax], [BikeMax])
    // once up front — their values are plain and contain no nested references.
    result = this._substituteSystemConfigVariables(result);
    let prev;
    let iterations = 0;
    do {
      prev = result;
      result = this._substituteVariablesPass(result);
    } while (result !== prev && ++iterations < 10);

    return result;
  }

  // settings.systemVariables (e.g. BulbMax / BikeMax) — resolvable as [System:Name] and [Name].
  _substituteSystemConfigVariables(text) {
    let sysVars;
    try {
      sysVars = (loadData(DATA_FILES.settings) || {}).systemVariables || {};
    } catch (e) {
      sysVars = {};
    }
    let result = text;
    result = result.replace(/\[System:(\w+)\]/gi, (match, name) => {
      const key = Object.keys(sysVars).find(k => k.toLowerCase() === name.toLowerCase());
      return key && sysVars[key] !== '' && sysVars[key] != null ? sysVars[key] : match;
    });
    for (const [k, v] of Object.entries(sysVars)) {
      if (v === '' || v == null || !/^\w+$/.test(k)) continue;
      result = result.replace(new RegExp(`\\[${k}\\]`, 'gi'), v);
    }
    return result;
  }

  _substituteVariablesPass(text) {
    let result = text;

    // System variables from session state
    if (this.sessionState) {
      result = result.replace(/\[Player\]/gi, this.sessionState.playerName || 'Player');
      result = result.replace(/\{\{user\}\}/gi, this.sessionState.playerName || 'Player');
      result = result.replace(/\[Char\]/gi, this.sessionState.characterName || 'Character');
      result = result.replace(/\{\{char\}\}/gi, this.sessionState.characterName || 'Character');
      result = result.replace(/\[Capacity\]/gi, this.sessionState.capacity ?? 0);
      // Tree Select Member pick; null resolves to the base character (parity with server.js).
      result = result.replace(/\[SelectedChar\]/gi, this.sessionState.selectedChar || this.sessionState.characterName || 'Character');
      // [Group] — natural member list, via the server-injected resolver (parity with server.js).
      result = result.replace(/\[Group\]/gi, () => (typeof this.resolveGroupList === 'function' && this.resolveGroupList()) || this.sessionState.characterName || 'Character');
      // Player Input popup values (parity with server.js) — [PlayerInput:Row#], 1-based.
      result = result.replace(/\[PlayerInput:(\d+)\]/gi, (match, n) => {
        const v = this.sessionState.playerInputs?.[n];
        return v !== undefined ? v : match;
      });
      // [Secs2Pct:N] — capacity % that N pump-seconds adds, via the server-injected resolver
      // (the pump-rate math lives server-side). Nested forms like [Secs2Pct:[CharVar:TotalSecs]]
      // work because substituteVariables re-passes until stable: the inner tag collapses in pass 1
      // (the [^\[\]]+ matcher skips it while brackets remain), this resolves in pass 2.
      // Unresolvable (no calibrated pump / non-numeric seconds) → tag left visible.
      result = result.replace(/\[Secs2Pct:([^\[\]]+)\]/gi, (match, secs) => {
        const v = typeof this.resolveSecs2Pct === 'function' ? this.resolveSecs2Pct(secs) : null;
        return v == null ? match : v;
      });
      // [CharCapacity] = base char; [CharCapacity:Name-or-id] = a group member, resolved via the
      // server-injected resolver (this engine has no per-char storage access of its own).
      result = result.replace(/\[CharCapacity(?::([^\]\r\n]+))?\]/gi, (match, memberKey) => {
        if (!memberKey) return this.sessionState.characterCapacity ?? 0;
        const cap = typeof this.resolveMemberCapacity === 'function' ? this.resolveMemberCapacity(memberKey) : null;
        return cap == null ? match : cap;
      });
      result = result.replace(/\{\{charCapacity\}\}/gi, this.sessionState.characterCapacity ?? 0);
      // Convert pain number to descriptive label
      const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
      const painValue = this.sessionState.pain ?? 0;
      const painLabel = painLabels[painValue] || `Level ${painValue}`;
      result = result.replace(/\[Pain\]/gi, painLabel);
      result = result.replace(/\[Feeling\]/gi, painLabel); // Legacy support
      result = result.replace(/\[Emotion\]/gi, this.sessionState.emotion ?? 'neutral');
      // Instructor pump session variables
      result = result.replace(/\[BulbCurrent\]/gi, this.sessionState.bulbCurrent ?? 0);
      result = result.replace(/\[BikeCurrent\]/gi, this.sessionState.bikeCurrent ?? 0);
      result = result.replace(/\[PumpType\]/gi, this.sessionState.pumpType || 'electric');
      result = result.replace(/\[PumpInit\]/gi, this.sessionState.pumpInit || 'auto');
    }

    // Most-recent Player Choice label (persists until the next choice is made).
    // Resolved before [Flow:...] so [Flow:[Choice]] uses it as a variable name.
    result = result.replace(/\[Choice\]/gi, this.variables['Choice'] ?? '');

    // Challenge result variables (persist until next challenge of same type)
    result = result.replace(/\[Segments\]/gi, this.variables['Segments'] || '');  // All wheel segment labels
    result = result.replace(/\[Segment\]/gi, this.variables['Segment'] || '');    // Winning segment label
    result = result.replace(/\[Roll\]/gi, this.variables['Roll'] || '');          // Dice total rolled
    result = result.replace(/\[Slots\]/gi, this.variables['Slots'] || '');        // Slot machine symbols

    // Character variables — [CharVar:varname] is the DOCUMENTED syntax (flows are retired, so the
    // old [Flow:...] name only confuses); [Flow:varname] stays a silent legacy alias for old cards.
    // The name may contain spaces or be built dynamically by an inner substitution on a prior pass
    // (e.g. a choice label like "Big Red"); brackets are excluded so it stops cleanly.
    result = result.replace(/\[(?:CharVar|Flow):([^[\]]+)\]/gi, (match, varName) => {
      const key = varName.trim();
      return this.variables[key] !== undefined ? this.variables[key] : match;
    });

    // Legacy {varname} pattern (backwards compatibility)
    result = result.replace(/\{(\w+)\}/g, (match, varName) => {
      return this.variables[varName] !== undefined ? this.variables[varName] : match;
    });

    return result;
  }

  /**
   * Evaluate expression (simple)
   * Supports: numbers, [Flow:varname] syntax, and legacy {varname} syntax
   */
  evaluateExpression(expr) {
    if (typeof expr !== 'string') return expr;

    // Check if it's a number (but not empty string)
    if (expr.trim() !== '' && !isNaN(expr)) {
      return parseFloat(expr);
    }

    // Check for [CharVar:varname] syntax ([Flow:...] = legacy alias)
    const flowMatch = expr.match(/^\[(?:CharVar|Flow):(\w+)\]$/i);
    if (flowMatch) {
      const varName = flowMatch[1];
      const value = this.variables[varName];
      console.log(`[EventEngine] evaluateExpression: [CharVar:${varName}] = ${value}`);
      return value !== undefined ? value : expr;
    }

    // Check for legacy {varname} pattern
    if (expr.startsWith('{') && expr.endsWith('}')) {
      const varName = expr.slice(1, -1);
      return this.variables[varName];
    }

    // Arithmetic: by this point substituteVariables has collapsed [CharVar:x]/[Capacity]/
    // [CharCapacity:Member]/[System:...] etc. to numbers, so "7 + 10 * 2" or "(33 + 7) / 2"
    // should COMPUTE, not store as a literal string. Strict character whitelist keeps this a
    // calculator (digits + - * / % ( ) . only), never an eval of anything else.
    const arith = expr.trim();
    if (/^[\d\s+\-*/%().]+$/.test(arith) && /\d/.test(arith)) {
      try {
        const n = Function(`"use strict"; return (${arith});`)();
        if (typeof n === 'number' && isFinite(n)) return Math.round(n * 1000) / 1000;
      } catch (e) { /* not a valid expression — fall through to the plain string */ }
    }

    return expr;
  }

  /**
   * Update variable from external source
   */
  setVariable(name, value) {
    this.variables[name] = value;
  }

  /**
   * Start idle checking
   */
  startIdleCheck(threshold = 300) {
    // Flow idle triggers removed (E3) — the live idle machinery is the server-side tree idle
    // checker (startTreeIdleCheck), which reads this.lastActivity directly. Nothing to poll here.
    this.stopIdleCheck();
    }

  /**
   * Stop idle checking
   */
  stopIdleCheck() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Check device monitors and stop devices when conditions are met
   * Should be called when session state changes (capacity, sensation, emotion)
   */
  async checkDeviceMonitors() {
    // Until-condition device monitors were armed only by flow device actions (removed, E3).
    // Tree pump limit-switches live server-side. Kept as a no-op for the existing call sites.
    }

  /**
   * Handle cycle completion - execute completion chain
   */
  async handleCycleComplete(deviceIp) {
    // Flow cycle-completion edges removed (E3); device cycle completions need no engine action.
    }

  /**
   * Handle device_on completion - executes completion edges
   * Called when a device_on action's "until" condition is met
   */
  cleanup() {
    console.log('[EventEngine] Cleanup - resetting engine state');
    this.stopIdleCheck();
    this.variables = {};
    this.flowVariables.clear();
    this.timers.clear();
    this.previousPlayerState = { capacity: 0, pain: 0, emotion: 'neutral' };
    this.previousCharacterCapacity = 0;
    this.alternateWelcome = null;
    }

  /**
   * Emergency Stop - Halt all flow execution and reset states
   * Keeps flows active but resets their execution state so they can trigger again
   */
  emergencyStop() {
    console.log('[EventEngine] EMERGENCY STOP');
    this.aborted = true;
    this.abortEpoch++; // async operations check the epoch to notice the stop

    for (const [, timerData] of this.timers) {
      if (timerData.interval) clearInterval(timerData.interval);
      else if (timerData.timeout) clearTimeout(timerData.timeout);
    }
    this.timers.clear();
    this.stopIdleCheck();
    this.variables = {};
    this.flowVariables.clear();

    // All devices are off after an emergency stop — reflect that in the shared state map.
    if (this.sessionState?.executionHistory?.deviceActions) {
      for (const deviceId of Object.keys(this.sessionState.executionHistory.deviceActions)) {
        this.sessionState.executionHistory.deviceActions[deviceId].state = 'off';
      }
      console.log('[EventEngine] Reset all device states to off');
    }
    // Sync state-change trackers to current values so the stop doesn't fire false change events.
    if (this.sessionState) {
      this.previousPlayerState = {
        capacity: this.sessionState.capacity || 0,
        pain: this.sessionState.pain || 0,
        emotion: this.sessionState.emotion || 'neutral'
      };
      this.previousCharacterCapacity = this.sessionState.characterCapacity || 0;
    }

    // Reset abort flag after in-progress executions have had a chance to exit.
    setTimeout(() => { this.aborted = false; }, 100);
    console.log('[EventEngine] Emergency stop complete');
    return { flowsReset: 0, devicesToStop: [] };
    }

  /**
   * Check for player state changes and fire triggers
   * Called when sessionState is updated
   */
  async checkPlayerStateChanges(newState) {
    const changes = [];

    // Check capacity change
    if (newState.capacity !== this.previousPlayerState.capacity) {
      changes.push({
        stateType: 'capacity',
        oldValue: this.previousPlayerState.capacity,
        newValue: newState.capacity
      });
    }

    // Check pain change (numeric 0-10 scale)
    if (newState.pain !== this.previousPlayerState.pain) {
      changes.push({
        stateType: 'pain',
        oldValue: this.previousPlayerState.pain,
        newValue: newState.pain
      });
    }

    // Check emotion change
    if (newState.emotion !== this.previousPlayerState.emotion) {
      changes.push({
        stateType: 'emotion',
        oldValue: this.previousPlayerState.emotion,
        newValue: newState.emotion
      });
    }

    // Update previous state
    this.previousPlayerState = {
      capacity: newState.capacity,
      pain: newState.pain,
      emotion: newState.emotion
    };

    // Fire triggers for each change
    for (const change of changes) {
      console.log(`[EventEngine] Player state changed: ${change.stateType} from ${change.oldValue} to ${change.newValue}`);
      await this.handleEvent('player_state_change', change);
      if (this.treeEventSink) { try { await this.treeEventSink('player_state_change', change); } catch (e) { console.error('[EventEngine] treeEventSink (player) failed:', e?.message || e); } }
    }
  }
  async checkCharacterStateChanges(newState) {
    if (newState.characterCapacity !== this.previousCharacterCapacity) {
      console.log(`[EventEngine] Character capacity changed: ${this.previousCharacterCapacity} -> ${newState.characterCapacity}`);
      const change = {
        stateType: 'characterCapacity',
        oldValue: this.previousCharacterCapacity,
        newValue: newState.characterCapacity
      };
      this.previousCharacterCapacity = newState.characterCapacity;
      await this.handleEvent('char_state_change', change);
      if (this.treeEventSink) { try { await this.treeEventSink('char_state_change', change); } catch (e) { console.error('[EventEngine] treeEventSink (char) failed:', e?.message || e); } }
    }
  }

  // Phase 3 (Flow→Trigger): a sink the server registers so per-card event-bound Trigger Trees
  // fire on the same state-change detections that drive flows. sink(eventType, eventData).
  setTreeEventSink(fn) { this.treeEventSink = fn; }
}

module.exports = EventEngine;
