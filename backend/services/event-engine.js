/**
 * Event Engine - Server-side flow execution
 * Handles trigger evaluation, condition checking, and action execution
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
 * @param {string} text - The text to match against
 * @param {string} pattern - The pattern with wildcards and alternatives
 * @returns {boolean} - Whether the text matches the pattern
 */
function matchPattern(text, pattern) {
  if (!pattern) return true;
  if (!text) return false;

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
    this.pendingCycleCompletions = new Map(); // Track pending cycle completions: device -> { flowId, nodeId, isInfinite }
    this.pendingDeviceOnCompletions = new Map(); // Track pending device_on completions: device -> { flowId, nodeId, isInfinite }
    this.previousPlayerState = { // Track player state for change detection
      capacity: 0,
      pain: 0, // 0-10 numeric pain scale
      emotion: 'neutral'
    };
    this.executedOnceConditions = new Set(); // Track conditions that have fired with onlyOnce
    this.simulationMode = false; // When true, device actions are simulated (not executed)

    // Flow pause/resume state
    this.isPaused = false;
    this.pausedExecution = null; // { flowId, nodeId, content, type } - for resuming after LLM generation interrupt
    this.currentGenerationAborted = false; // Flag to discard in-progress LLM generation on pause

    // Flow execution state for UI status panel - track multiple active flows
    this.activeExecutions = new Map(); // flowId -> { flowId, flowName, triggerType, triggerLabel, currentNodeLabel, startTime }
    this.executionDepths = new Map(); // flowId -> depth count
    this.maxTrackedExecutions = 10; // Limit to prevent memory issues
  }

  /**
   * Set simulation mode - when true, device actions are logged but not executed
   */
  setSimulationMode(enabled) {
    this.simulationMode = enabled;
    console.log(`[EventEngine] Simulation mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Set broadcast function for sending messages
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
   * Broadcast message to clients
   * Returns a promise that resolves when the broadcast handler completes
   */
  async broadcast(type, data) {
    if (this.broadcastFn) {
      console.log(`[EventEngine] Calling broadcastFn for type: ${type}`);
      await this.broadcastFn(type, data);
    } else {
      console.log('[EventEngine] WARNING: No broadcastFn registered!');
    }
  }

  /**
   * Pause flow execution - call when user navigates away from Chat or switches tabs
   * If LLM generation is in progress, it will be aborted and queued for re-execution
   * @param {string} reason - Reason for pausing (e.g., "Player defocused chat.", "LLM is busy.")
   */
  pauseFlows(reason = 'Player defocused chat.') {
    if (this.isPaused) return;

    this.isPaused = true;
    this.pauseReason = reason;
    this.currentGenerationAborted = true; // Signal to abort any in-progress generation
    console.log(`[EventEngine] Flows PAUSED - ${reason}`);

    // Broadcast pause state to frontend with current node info
    if (this.broadcastFn) {
      this.broadcastFn('flow_paused', {
        paused: true,
        reason,
        currentNodeLabel: this.currentExecution?.currentNodeLabel || null
      });
    }
  }

  /**
   * Resume flow execution - call when user returns to Chat
   * Will re-execute any queued flow action that was interrupted
   */
  async resumeFlows() {
    if (!this.isPaused) return;

    this.isPaused = false;
    this.pauseReason = null;
    this.currentGenerationAborted = false;
    console.log('[EventEngine] Flows RESUMED - user returned to Chat');

    // Determine what node we're resuming at
    const resumingAt = this.pausedExecution?.nodeId
      ? this.currentExecution?.currentNodeLabel
      : null;

    // Broadcast resume state to frontend
    if (this.broadcastFn) {
      this.broadcastFn('flow_paused', { paused: false, resumingAt });
    }

    // If there's a queued execution from an interrupted LLM generation, resume it
    if (this.pausedExecution) {
      const { flowId, nodeId, content, type } = this.pausedExecution;
      console.log(`[EventEngine] Resuming interrupted ${type} generation for node ${nodeId}`);
      this.pausedExecution = null;

      // Find the flow and re-execute from the paused node
      const activeFlow = this.activeFlows.get(flowId);
      if (activeFlow) {
        // Re-broadcast the message to trigger LLM generation again
        if (type === 'ai_message') {
          await this.broadcast('ai_message', { content, flowId, nodeId });
        } else if (type === 'player_message') {
          await this.broadcast('player_message', { content, flowId, nodeId });
        }

        // Continue execution from the next node after the message node
        const flow = activeFlow.flow;
        const edges = flow.edges.filter(e => e.source === nodeId);
        for (const edge of edges) {
          await this.executeFromNode(flow, edge.target, null, true);
        }
      }
    }
  }

  /**
   * Check if flows are paused
   */
  isFlowsPaused() {
    return this.isPaused;
  }

  /**
   * Queue an interrupted LLM generation for resumption
   */
  queuePausedExecution(flowId, nodeId, content, type) {
    this.pausedExecution = { flowId, nodeId, content, type };
    console.log(`[EventEngine] Queued interrupted ${type} for resumption: node ${nodeId}`);
  }

  /**
   * Check if current generation should be aborted
   */
  shouldAbortGeneration() {
    return this.currentGenerationAborted;
  }

  /**
   * Activate a flow for execution
   * @param {Object} flow - The flow to activate
   * @param {number} priority - Priority level (0 = highest/global, 1 = character, 2 = persona)
   */
  activateFlow(flow, priority = 2) {
    this.activeFlows.set(flow.id, { flow, priority });
    this.flowStates.set(flow.id, {
      triggeredNodes: new Set(),
      executedOnceNodes: new Set(),
      timers: []
    });

    // Set up timer triggers
    this.setupTimerTriggers(flow);

    console.log(`[EventEngine] Activated flow: ${flow.name} (priority: ${priority})`);
  }

  /**
   * Check if a flow is active
   */
  isFlowActive(flowId) {
    return this.activeFlows.has(flowId);
  }

  /**
   * Deactivate a flow
   */
  deactivateFlow(flowId) {
    const state = this.flowStates.get(flowId);
    if (state) {
      // Clear all timers (both timeout and interval)
      state.timers.forEach(timer => {
        clearTimeout(timer);
        clearInterval(timer);
      });
      // Clear the array to release references
      state.timers.length = 0;
    }

    this.activeFlows.delete(flowId);
    this.flowStates.delete(flowId);

    console.log(`[EventEngine] Deactivated flow: ${flowId}`);
  }

  /**
   * Set up timer triggers in a flow
   */
  setupTimerTriggers(flow) {
    const timerNodes = flow.nodes.filter(n =>
      n.type === 'trigger' && n.data.triggerType === 'timer'
    );

    timerNodes.forEach(node => {
      const delay = (node.data.delay || 60) * 1000;
      const repeat = node.data.repeat || false;

      const executeTimer = () => {
        if (this.shouldExecuteNode(flow.id, node)) {
          this.executeFromNode(flow, node.id);
        }

        if (repeat && this.activeFlows.has(flow.id)) {
          const timer = setTimeout(executeTimer, delay);
          const state = this.flowStates.get(flow.id);
          if (state) {
            state.timers.push(timer);
          }
        }
      };

      const timer = setTimeout(executeTimer, delay);
      const state = this.flowStates.get(flow.id);
      if (state) {
        state.timers.push(timer);
      }
    });
  }

  /**
   * Handle incoming event
   */
  async handleEvent(eventType, eventData) {
    this.lastActivity = Date.now();
    console.log(`[EventEngine] handleEvent called: ${eventType}`, eventData);
    console.log(`[EventEngine] Active flows: ${this.activeFlows.size}`);

    // Sort flows by priority (0 = highest, 2 = lowest)
    const sortedFlows = Array.from(this.activeFlows.entries())
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [flowId, { flow }] of sortedFlows) {
      console.log(`[EventEngine] Checking flow: ${flow.name} (${flowId})`);
      const triggers = this.findTriggerNodes(flow, eventType, eventData);
      console.log(`[EventEngine] Found ${triggers.length} matching triggers`);

      // Sort triggers by priority (if they have priority enabled)
      // Priority 1 = highest, 10 = lowest, no priority = 99 (last)
      const sortedTriggers = triggers.sort((a, b) => {
        const aPriority = a.data.hasPriority ? (a.data.priority || 5) : 99;
        const bPriority = b.data.hasPriority ? (b.data.priority || 5) : 99;
        return aPriority - bPriority;
      });

      for (const trigger of sortedTriggers) {
        if (this.shouldExecuteNode(flowId, trigger)) {
          console.log(`[EventEngine] Executing trigger ${trigger.id} (priority: ${trigger.data.hasPriority ? trigger.data.priority : 'none'})`);
          await this.executeFromNode(flow, trigger.id);
        }
      }
    }
  }

  /**
   * Find trigger nodes matching an event
   */
  findTriggerNodes(flow, eventType, eventData) {
    return flow.nodes.filter(node => {
      if (node.type !== 'trigger') return false;

      switch (eventType) {
        case 'first_message':
          return node.data.triggerType === 'first_message';

        case 'device_on':
          if (node.data.triggerType !== 'device_on') return false;
          return !node.data.device || node.data.device === eventData.ip;

        case 'device_off':
          if (node.data.triggerType !== 'device_off') return false;
          return !node.data.device || node.data.device === eventData.ip;

        case 'player_speaks':
          if (node.data.triggerType !== 'player_speaks') return false;
          // Support both keywords array and legacy single keyword
          const playerKeywords = node.data.keywords || (node.data.keyword ? [node.data.keyword] : []);
          console.log(`[EventEngine] player_speaks trigger found, keywords:`, playerKeywords, `content: "${eventData.content}"`);
          if (playerKeywords.length > 0 && playerKeywords.some(k => k)) {
            // Match if ANY keyword pattern matches
            const matched = playerKeywords.some(keyword => keyword && matchPattern(eventData.content, keyword));
            console.log(`[EventEngine] Pattern match result: ${matched}`);
            return matched;
          }
          console.log(`[EventEngine] No keywords, returning true (wildcard)`);
          return true;

        case 'ai_speaks':
          if (node.data.triggerType !== 'ai_speaks') return false;
          // Support both keywords array and legacy single keyword
          const aiKeywords = node.data.keywords || (node.data.keyword ? [node.data.keyword] : []);
          if (aiKeywords.length > 0 && aiKeywords.some(k => k)) {
            // Match if ANY keyword pattern matches
            return aiKeywords.some(keyword => keyword && matchPattern(eventData.content, keyword));
          }
          return true;

        case 'random':
          if (node.data.triggerType !== 'random') return false;
          return Math.random() * 100 < (node.data.probability || 50);

        case 'idle':
          return node.data.triggerType === 'idle';

        case 'new_session':
          return node.data.triggerType === 'new_session';

        case 'player_state_change':
          if (node.data.triggerType !== 'player_state_change') return false;
          // Check if this trigger's state type matches the change
          if (node.data.stateType !== eventData.stateType) return false;

          // Both capacity and pain are numeric, emotion is string
          const isNumeric = node.data.stateType === 'capacity' || node.data.stateType === 'pain';
          const targetValue = isNumeric ? Number(node.data.targetValue) : node.data.targetValue;
          const targetValue2 = isNumeric ? Number(node.data.targetValue2) : node.data.targetValue2;
          const newValue = isNumeric ? Number(eventData.newValue) : eventData.newValue;
          const comparison = node.data.comparison || 'meet';

          console.log(`[EventEngine] player_state_change check: stateType=${node.data.stateType}, comparison=${comparison}, newValue=${newValue}, targetValue=${targetValue}, targetValue2=${targetValue2}`);

          if (isNumeric) {
            // Numeric comparison for capacity and pain
            switch (comparison) {
              case 'meet':
                return newValue === targetValue;
              case 'meet_or_exceed':
                return newValue >= targetValue;
              case 'greater':
                return newValue > targetValue;
              case 'less':
                return newValue < targetValue;
              case 'less_or_equal':
                return newValue <= targetValue;
              case 'range': {
                const min = Math.min(targetValue, isNaN(targetValue2) ? (node.data.stateType === 'capacity' ? 100 : 10) : targetValue2);
                const max = Math.max(targetValue, isNaN(targetValue2) ? (node.data.stateType === 'capacity' ? 100 : 10) : targetValue2);
                return newValue >= min && newValue <= max;
              }
              default:
                return newValue === targetValue;
            }
          } else {
            // String comparison (emotion) - supports equals and not_equal
            if (comparison === 'not_equal') {
              return newValue !== targetValue;
            }
            return newValue === targetValue;
          }

        default:
          return false;
      }
    });
  }

  /**
   * Check if a node should execute
   */
  shouldExecuteNode(flowId, node) {
    const state = this.flowStates.get(flowId);
    if (!state) {
      console.log(`[EventEngine] shouldExecuteNode: No state for flow ${flowId}`);
      return false;
    }

    // Check "execute once" or "fire only once" flag
    // For trigger nodes, fireOnlyOnce defaults to true if undefined (matches frontend checkbox display)
    const fireOnlyOnce = node.type === 'trigger' ? (node.data.fireOnlyOnce !== false) : node.data.fireOnlyOnce;
    const hasOnceFlag = node.data.executeOnce || fireOnlyOnce;
    const alreadyExecuted = state.executedOnceNodes.has(node.id);
    console.log(`[EventEngine] shouldExecuteNode: node=${node.id}, fireOnlyOnce=${fireOnlyOnce}, executeOnce=${node.data.executeOnce}, hasOnceFlag=${hasOnceFlag}, alreadyExecuted=${alreadyExecuted}, executedOnceNodes=[${Array.from(state.executedOnceNodes).join(',')}]`);

    if (hasOnceFlag && alreadyExecuted) {
      console.log(`[EventEngine] Skipping node ${node.id} - already executed once`);
      return false;
    }

    // Check probability
    if (node.data.probability !== undefined && node.data.probability < 100) {
      if (Math.random() * 100 >= node.data.probability) {
        return false;
      }
    }

    return true;
  }

  /**
   * Execute flow starting from a node
   */
  async executeFromNode(flow, nodeId, fromHandle = null, skipTriggers = false) {
    const node = flow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Skip trigger and button_press nodes during flow traversal (they should only execute at entry points)
    if (skipTriggers && (node.type === 'trigger' || node.type === 'button_press')) {
      console.log(`[EventEngine] Skipping ${node.type} node "${node.data.label}" during flow traversal`);
      return;
    }

    // Track execution depth per flow for completion detection
    const currentDepth = this.executionDepths.get(flow.id) || 0;
    const isEntryPoint = currentDepth === 0;
    this.executionDepths.set(flow.id, currentDepth + 1);

    // Track new flow execution when entering from a trigger node
    if (isEntryPoint && (node.type === 'trigger' || node.type === 'button_press')) {
      const triggerType = node.data.triggerType || node.type;

      // Add to active executions (or update if already exists)
      this.activeExecutions.set(flow.id, {
        flowId: flow.id,
        flowName: flow.name,
        triggerType: triggerType,
        triggerLabel: node.data.label,
        currentNodeLabel: node.data.label,
        startTime: Date.now()
      });

      // Trim old executions if we have too many
      if (this.activeExecutions.size > this.maxTrackedExecutions) {
        // Remove oldest execution
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [key, exec] of this.activeExecutions) {
          if (exec.startTime < oldestTime) {
            oldestTime = exec.startTime;
            oldestKey = key;
          }
        }
        if (oldestKey) this.activeExecutions.delete(oldestKey);
      }

      // Broadcast updated executions list
      await this.broadcastExecutionsUpdate();
    }

    const state = this.flowStates.get(flow.id);
    // For trigger nodes, fireOnlyOnce defaults to true if undefined (matches frontend checkbox display)
    const fireOnlyOnce = node.type === 'trigger' ? (node.data.fireOnlyOnce !== false) : node.data.fireOnlyOnce;
    if (state && (node.data.executeOnce || fireOnlyOnce)) {
      state.executedOnceNodes.add(node.id);
      console.log(`[EventEngine] Marked node ${node.id} as executed once (fireOnlyOnce=${fireOnlyOnce}, executeOnce=${node.data.executeOnce})`);
    }

    // Execute current node
    const result = await this.executeNode(node, flow);

    // If result is 'wait', stop chain execution here (will resume when condition is met)
    if (result === 'wait') {
      console.log(`[EventEngine] Chain paused at node "${node.data.label}" - waiting for condition`);
      // Decrement depth for this flow (not global)
      const waitDepth = (this.executionDepths.get(flow.id) || 1) - 1;
      if (waitDepth <= 0) {
        this.executionDepths.delete(flow.id);
      } else {
        this.executionDepths.set(flow.id, waitDepth);
      }
      // Don't broadcast completion - we're waiting for async continuation
      return;
    }

    // Find outgoing edges
    let edges = flow.edges.filter(e => e.source === nodeId);

    // For condition/branch nodes, filter by result
    if (node.type === 'condition') {
      // result is { result: boolean, conditionIndex: number }
      if (result && result.result) {
        const handleId = `true-${result.conditionIndex}`;
        edges = edges.filter(e => e.sourceHandle === handleId);
      } else {
        edges = edges.filter(e => e.sourceHandle === 'false');
      }
    } else if (node.type === 'branch') {
      if (result !== null && result !== undefined) {
        edges = edges.filter(e => e.sourceHandle === `branch-${result}`);
      }
    } else if (result === 'start_cycle') {
      // For start_cycle, only execute 'immediate' edges now
      // 'completion' edges will be executed when cycle completes
      const immediateEdges = edges.filter(e => e.sourceHandle === 'immediate');
      const completionEdges = edges.filter(e => e.sourceHandle === 'completion');
      console.log(`[EventEngine] Start Cycle dual output - immediate: ${immediateEdges.length}, completion: ${completionEdges.length} (deferred)`);
      edges = immediateEdges;
    } else if (result === 'device_on') {
      // For device_on, only execute 'immediate' edges now
      // 'completion' edges will be executed when device turns off (until condition met)
      const immediateEdges = edges.filter(e => e.sourceHandle === 'immediate');
      const completionEdges = edges.filter(e => e.sourceHandle === 'completion');
      console.log(`[EventEngine] Device On dual output - immediate: ${immediateEdges.length}, completion: ${completionEdges.length} (deferred)`);
      edges = immediateEdges;
    }

    // Execute next nodes (skip triggers during traversal to prevent loops)
    for (const edge of edges) {
      await this.executeFromNode(flow, edge.target, null, true);
    }

    // Decrement execution depth for this flow
    const newDepth = (this.executionDepths.get(flow.id) || 1) - 1;
    if (newDepth <= 0) {
      this.executionDepths.delete(flow.id);
    } else {
      this.executionDepths.set(flow.id, newDepth);
    }

    // Check if this flow's execution is complete
    if (newDepth <= 0) {
      // Check for pending async operations for THIS flow
      const hasPendingCycle = Array.from(this.pendingCycleCompletions.values()).some(p => p.flowId === flow.id);
      const hasPendingDeviceOn = Array.from(this.pendingDeviceOnCompletions.values()).some(p => p.flowId === flow.id);
      const hasPendingChoice = this.pendingPlayerChoice?.flowId === flow.id;
      const hasPendingChallenge = this.pendingChallenge?.flowId === flow.id;

      const hasPendingOps = hasPendingCycle || hasPendingDeviceOn || hasPendingChoice || hasPendingChallenge;

      if (!hasPendingOps && this.activeExecutions.has(flow.id)) {
        // Flow complete - remove from active executions
        this.activeExecutions.delete(flow.id);
        await this.broadcastExecutionsUpdate();
      } else if (hasPendingOps) {
        console.log(`[EventEngine] Flow ${flow.id} paused - waiting for async ops`);
      }
    }
  }

  /**
   * Broadcast current active executions to frontend
   */
  async broadcastExecutionsUpdate() {
    const executions = Array.from(this.activeExecutions.values());
    await this.broadcast('flow_executions_update', { executions });
  }

  /**
   * Execute individual node
   */
  async executeNode(node, flow) {
    console.log(`[EventEngine] Executing node: ${node.type} - ${node.data.label}`);

    // Update current node label in active execution
    const execution = this.activeExecutions.get(flow.id);
    if (execution) {
      execution.currentNodeLabel = node.data.label;
      // Only broadcast updates for significant nodes (not every tiny step)
      const significantTypes = ['action', 'condition', 'branch', 'delay', 'player_choice', 'simple_ab',
        'prize_wheel', 'dice_roll', 'coin_flip', 'rps', 'timer_challenge', 'number_guess', 'slot_machine', 'card_draw'];
      if (significantTypes.includes(node.type)) {
        await this.broadcastExecutionsUpdate();
      }
    }

    switch (node.type) {
      case 'trigger':
      case 'button_press':
        // Triggers just start execution, no action needed
        return true;

      case 'action':
        return await this.executeAction(node.data, flow, node.id);

      case 'condition':
        // Returns { result: boolean, conditionIndex: number }
        return this.evaluateConditions(node.data, flow.id, node.id);

      case 'branch':
        return this.evaluateBranch(node.data);

      case 'delay':
        await this.executeDelay(node.data);
        return true;

      case 'player_choice':
        return await this.executePlayerChoice(node, flow);

      case 'simple_ab':
        return await this.executeSimpleAB(node, flow);

      // Challenge nodes - interactive game elements
      case 'prize_wheel':
      case 'dice_roll':
      case 'coin_flip':
      case 'rps':
      case 'timer_challenge':
      case 'number_guess':
      case 'slot_machine':
      case 'card_draw':
        return await this.executeChallenge(node, flow);

      default:
        return true;
    }
  }

  /**
   * Execute a player_choice node - show modal and wait for user response
   */
  async executePlayerChoice(node, flow) {
    const data = node.data;

    // If there's a prompt and sendMessageFirst is not disabled, generate an AI message using it as instruction
    const sendMessageFirst = data.sendMessageFirst !== false; // Default to true
    if (data.prompt && sendMessageFirst) {
      console.log(`[EventEngine] Player choice has prompt, generating AI message with instruction`);
      await this.broadcast('ai_message', {
        content: data.prompt,  // This will be used as instruction for LLM
        sender: 'flow'
      });
    } else if (!sendMessageFirst) {
      console.log(`[EventEngine] Player choice skipping AI message (sendMessageFirst disabled)`);
    }

    // Store pending choice info so we can resume the correct branch
    this.pendingPlayerChoice = {
      nodeId: node.id,
      flowId: flow.id,
      choices: data.choices || []
    };

    // Broadcast player choice modal to frontend
    console.log(`[EventEngine] Broadcasting player_choice modal with ${(data.choices || []).length} choices`);
    await this.broadcast('player_choice', {
      nodeId: node.id,
      description: this.substituteVariables(data.description || ''),
      choices: data.choices || []
    });

    console.log('[EventEngine] Player choice presented, chain paused waiting for user response');
    return 'wait';  // Pause chain execution until user responds
  }

  /**
   * Execute a simple_ab node - show A/B popup and wait for user response
   */
  async executeSimpleAB(node, flow) {
    const data = node.data;

    // Store pending choice info so we can resume the correct branch
    this.pendingPlayerChoice = {
      nodeId: node.id,
      flowId: flow.id,
      isSimpleAB: true,
      choices: [
        { id: 'a', label: data.labelA || 'Option A', description: data.descriptionA || '' },
        { id: 'b', label: data.labelB || 'Option B', description: data.descriptionB || '' }
      ]
    };

    // Broadcast simple_ab modal to frontend
    console.log(`[EventEngine] Broadcasting simple_ab modal`);
    await this.broadcast('simple_ab', {
      nodeId: node.id,
      description: this.substituteVariables(data.description || ''),
      labelA: data.labelA || 'Option A',
      descriptionA: this.substituteVariables(data.descriptionA || ''),
      labelB: data.labelB || 'Option B',
      descriptionB: this.substituteVariables(data.descriptionB || '')
    });

    console.log('[EventEngine] Simple A/B presented, chain paused waiting for user response');
    return 'wait';  // Pause chain execution until user responds
  }

  /**
   * Execute a challenge node - show interactive challenge modal and wait for result
   */
  async executeChallenge(node, flow) {
    const data = node.data;

    // Store pending challenge info so we can resume with the correct branch
    this.pendingChallenge = {
      nodeId: node.id,
      flowId: flow.id,
      challengeType: node.type,
      challengeData: data
    };

    // Broadcast challenge modal to frontend
    console.log(`[EventEngine] Broadcasting challenge modal: ${node.type}`);
    await this.broadcast('challenge', {
      nodeId: node.id,
      challengeType: node.type,
      ...data  // Include all challenge-specific data (segments, diceCount, etc.)
    });

    console.log('[EventEngine] Challenge presented, chain paused waiting for result');
    return 'wait';  // Pause chain execution until challenge completes
  }

  /**
   * Handle challenge result - continue flow based on which output was selected
   */
  async handleChallengeResult(nodeId, outputId) {
    console.log(`[EventEngine] Challenge result: output "${outputId}" for node ${nodeId}`);

    if (!this.pendingChallenge) {
      console.log('[EventEngine] No pending challenge to continue');
      return;
    }

    const { nodeId: pendingNodeId, flowId } = this.pendingChallenge;

    // Verify nodeId matches
    if (pendingNodeId !== nodeId) {
      console.log(`[EventEngine] Node ID mismatch: expected ${pendingNodeId}, got ${nodeId}`);
      return;
    }

    const flowData = this.activeFlows.get(flowId);
    if (!flowData) {
      console.log(`[EventEngine] Flow ${flowId} not found for challenge continuation`);
      return;
    }

    const flow = flowData.flow;

    // Find the edge that matches the output (sourceHandle = outputId)
    const edges = flow.edges.filter(e => e.source === nodeId);
    console.log(`[EventEngine] Looking for edge with sourceHandle "${outputId}"`);
    console.log(`[EventEngine] Available edges from ${nodeId}:`, edges.map(e => ({ target: e.target, sourceHandle: e.sourceHandle })));
    const matchingEdge = edges.find(e => e.sourceHandle === outputId);

    if (!matchingEdge) {
      console.log(`[EventEngine] No edge found for output "${outputId}"`);
      this.pendingChallenge = null;
      return;
    }

    console.log(`[EventEngine] Continuing flow to node ${matchingEdge.target} via output "${outputId}"`);

    // Clear pending challenge before continuing
    this.pendingChallenge = null;

    // Continue execution from the matched edge's target
    await this.executeFromNode(flow, matchingEdge.target, null, true);
  }

  /**
   * Clear pending challenge without continuing flow (user cancelled/skipped)
   */
  clearPendingChallenge(nodeId) {
    if (!this.pendingChallenge) {
      console.log('[EventEngine] No pending challenge to clear');
      return;
    }

    if (this.pendingChallenge.nodeId !== nodeId) {
      console.log(`[EventEngine] Node ID mismatch for clear: expected ${this.pendingChallenge.nodeId}, got ${nodeId}`);
      return;
    }

    console.log(`[EventEngine] Challenge cancelled for node ${nodeId} - flow will not continue from this branch`);
    this.pendingChallenge = null;
  }

  /**
   * Execute an action node
   */
  async executeAction(data, flow, nodeId) {
    const crypto = require('crypto');

    switch (data.actionType) {
      case 'send_message': {
        // AI message - optionally suppress LLM enhancement
        const broadcastData = {
          content: this.substituteVariables(data.message),
          sender: 'flow',
          suppressLlm: data.suppressLlm || false,
          flowId: flow.id,
          nodeId: nodeId
        };

        console.log(`[EventEngine] Broadcasting ai_message:`, broadcastData.content?.substring(0, 50), data.suppressLlm ? '(verbatim)' : '(LLM enhanced)');
        await this.broadcast('ai_message', broadcastData);

        // Post-delay after LLM generation completes (prevents LLM confusion in rapid flows)
        const postDelay = data.postDelay ?? 3;
        if (postDelay > 0) {
          console.log(`[EventEngine] Post-delay: waiting ${postDelay}s after AI message`);
          await new Promise(resolve => setTimeout(resolve, postDelay * 1000));
        }
        return true;
      }

      case 'send_player_message': {
        // Player message - optionally suppress LLM enhancement
        const broadcastData = {
          content: this.substituteVariables(data.message),
          sender: 'flow',
          suppressLlm: data.suppressLlm || false,
          flowId: flow.id,
          nodeId: nodeId
        };

        console.log(`[EventEngine] Broadcasting player_message:`, broadcastData.content?.substring(0, 50), data.suppressLlm ? '(verbatim)' : '(LLM enhanced)');
        await this.broadcast('player_message', broadcastData);

        // Post-delay after LLM generation completes (prevents LLM confusion in rapid flows)
        const postDelay = data.postDelay ?? 3;
        if (postDelay > 0) {
          console.log(`[EventEngine] Post-delay: waiting ${postDelay}s after player message`);
          await new Promise(resolve => setTimeout(resolve, postDelay * 1000));
        }
        return true;
      }

      case 'system_message': {
        const broadcastData = { content: this.substituteVariables(data.message) };

        console.log(`[EventEngine] Broadcasting system_message:`, broadcastData.content?.substring(0, 50));
        await this.broadcast('system_message', broadcastData);
        return true;
      }

      case 'device_on': {
        if (!data.device) return false;

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          console.log(`[SIMULATION] Device ${resolvedDevice || data.device} would turn ON`);
          // Still update state tracking for flow continuity
          if (this.sessionState?.executionHistory) {
            const deviceKey = resolvedDevice || data.device;
            if (!this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey] = {};
            }
            this.sessionState.executionHistory.deviceActions[deviceKey].state = 'on';
          }
          return 'device_on'; // Continue flow execution
        }

        if (!deviceObj || !resolvedDevice) {
          console.log(`[EventEngine] Device alias "${data.device}" could not be resolved`);
          return false;
        }

        // Check device state to prevent conflicts
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (deviceState && deviceState.state === 'on') {
            console.log(`[EventEngine] Device ${resolvedDevice} is already on, skipping`);
            return false;
          }
        }

        await this.deviceService.turnOn(resolvedDevice, deviceObj);

        // Update device state tracking
        if (this.sessionState && this.sessionState.executionHistory) {
          if (!this.sessionState.executionHistory.deviceActions[resolvedDevice]) {
            this.sessionState.executionHistory.deviceActions[resolvedDevice] = {};
          }
          this.sessionState.executionHistory.deviceActions[resolvedDevice].state = 'on';
        }

        // Determine if this is infinite (no until condition)
        const isInfinite = !data.untilType || data.untilType === 'forever';

        // Track for completion callback (like start_cycle)
        this.pendingDeviceOnCompletions = this.pendingDeviceOnCompletions || new Map();
        this.pendingDeviceOnCompletions.set(resolvedDevice, {
          flowId: flow.id,
          nodeId: nodeId,
          isInfinite,
          deviceObj // Store for debugging/future use
        });
        console.log(`[EventEngine] Tracking device_on completion for device ${resolvedDevice}, infinite: ${isInfinite}`);

        // Set up "until" monitoring if specified
        if (data.untilType && data.untilType !== 'forever') {
          this.deviceMonitors.set(resolvedDevice, {
            type: data.untilType,
            operator: data.untilOperator || '>',
            value: data.untilValue,
            deviceObj: deviceObj, // Store full device object for turnOff
            flowId: flow.id,
            monitorType: 'device_on'
          });
          console.log(`[EventEngine] Monitoring device ${resolvedDevice} until ${data.untilType} ${data.untilOperator || '>'} ${data.untilValue}`);
        }

        return 'device_on'; // Special return to handle dual outputs (immediate/completion)
      }

      case 'device_off': {
        if (!data.device) return false;

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          console.log(`[SIMULATION] Device ${resolvedDevice || data.device} would turn OFF`);
          if (this.sessionState?.executionHistory) {
            const deviceKey = resolvedDevice || data.device;
            if (!this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey] = {};
            }
            this.sessionState.executionHistory.deviceActions[deviceKey].state = 'off';
          }
          return true; // Continue flow execution
        }

        if (!deviceObj || !resolvedDevice) {
          console.log(`[EventEngine] Device alias "${data.device}" could not be resolved`);
          return false;
        }

        // Check device state to prevent conflicts
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (deviceState && deviceState.state === 'off') {
            console.log(`[EventEngine] Device ${resolvedDevice} is already off, skipping`);
            return false;
          }
        }

        await this.deviceService.turnOff(resolvedDevice, deviceObj);

        // Update device state tracking
        if (this.sessionState && this.sessionState.executionHistory) {
          if (!this.sessionState.executionHistory.deviceActions[resolvedDevice]) {
            this.sessionState.executionHistory.deviceActions[resolvedDevice] = {};
          }
          this.sessionState.executionHistory.deviceActions[resolvedDevice].state = 'off';
        }

        return true;
      }

      case 'start_cycle': {
        console.log(`[EventEngine] Start Cycle action - device: ${data.device}, duration: ${data.duration}, interval: ${data.interval}, cycles: ${data.cycles}`);
        if (!data.device) {
          console.log(`[EventEngine] Start Cycle - no device specified!`);
          return false;
        }

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          console.log(`[SIMULATION] Device ${resolvedDevice || data.device} would START CYCLE (duration: ${data.duration || 5}s, interval: ${data.interval || 10}s, cycles: ${data.cycles || 0})`);
          if (this.sessionState?.executionHistory) {
            const deviceKey = resolvedDevice || data.device;
            if (!this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey] = {};
            }
            this.sessionState.executionHistory.deviceActions[deviceKey].cycling = true;
            this.sessionState.executionHistory.deviceActions[deviceKey].state = 'on';
          }
          return 'start_cycle'; // Continue flow execution
        }

        if (!deviceObj || !resolvedDevice) {
          console.log(`[EventEngine] Device alias "${data.device}" could not be resolved`);
          return false;
        }

        // Check if device is already cycling
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (deviceState && deviceState.cycling) {
            console.log(`[EventEngine] Device ${resolvedDevice} is already cycling, skipping`);
            return false;
          }
        }

        console.log(`[EventEngine] Calling deviceService.startCycle for ${resolvedDevice}`);
        await this.deviceService.startCycle(resolvedDevice, {
          duration: data.duration || 5,
          interval: data.interval || 10,
          cycles: data.cycles || 0
        }, deviceObj);

        // Update device state tracking
        if (this.sessionState && this.sessionState.executionHistory) {
          if (!this.sessionState.executionHistory.deviceActions[resolvedDevice]) {
            this.sessionState.executionHistory.deviceActions[resolvedDevice] = {};
          }
          this.sessionState.executionHistory.deviceActions[resolvedDevice].cycling = true;
          this.sessionState.executionHistory.deviceActions[resolvedDevice].state = 'on';
        }

        // Determine if this is an infinite cycle (cycles=0 AND no until condition)
        const isInfinite = (!data.cycles || data.cycles === 0) &&
                           (!data.untilType || data.untilType === 'forever');

        // Track for completion callback
        this.pendingCycleCompletions.set(resolvedDevice, {
          flowId: flow.id,
          nodeId: nodeId,
          isInfinite,
          deviceObj // Store for debugging/future use
        });
        console.log(`[EventEngine] Tracking cycle completion for device ${resolvedDevice}, infinite: ${isInfinite}`);

        // Broadcast infinite cycle state to frontend
        if (isInfinite) {
          // Use deviceKey format (ip:childId for power strip outlets)
          const deviceKey = deviceObj.childId ? `${deviceObj.ip}:${deviceObj.childId}` : resolvedDevice;
          await this.broadcast('infinite_cycle_start', {
            device: deviceKey,
            flowId: flow.id,
            nodeId: nodeId
          });
        }

        // Set up "until" monitoring if specified
        if (data.untilType && data.untilType !== 'forever') {
          this.deviceMonitors.set(resolvedDevice, {
            type: data.untilType,
            value: data.untilValue,
            deviceObj: deviceObj, // Store full device object for stopCycle
            monitorType: 'cycle'
          });
          console.log(`[EventEngine] Monitoring device ${resolvedDevice} until ${data.untilType} ${data.untilType === 'capacity' ? '>=' : '='} ${data.untilValue}`);
        }

        return 'start_cycle'; // Special return to handle dual outputs (immediate/completion)
      }

      case 'stop_cycle': {
        if (!data.device) return false;

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          console.log(`[SIMULATION] Device ${resolvedDevice || data.device} would STOP CYCLE`);
          if (this.sessionState?.executionHistory) {
            const deviceKey = resolvedDevice || data.device;
            if (this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey].cycling = false;
            }
          }
          return true; // Continue flow execution
        }

        if (!deviceObj || !resolvedDevice) {
          console.log(`[EventEngine] Device alias "${data.device}" could not be resolved`);
          return false;
        }

        // Check if device is actually cycling
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (!deviceState || !deviceState.cycling) {
            console.log(`[EventEngine] Device ${resolvedDevice} is not cycling, skipping stop`);
            return false;
          }
        }

        this.deviceService.stopCycle(resolvedDevice, deviceObj);

        // Clear monitor for this device
        this.deviceMonitors.delete(resolvedDevice);

        // Update device state tracking
        if (this.sessionState && this.sessionState.executionHistory) {
          if (this.sessionState.executionHistory.deviceActions[resolvedDevice]) {
            this.sessionState.executionHistory.deviceActions[resolvedDevice].cycling = false;
          }
        }

        return true;
      }

      case 'declare_variable':
        // Declare/initialize a flow variable
        if (data.name) {
          this.variables[data.name] = this.evaluateExpression(data.value);
          // Sync to sessionState for frontend access
          if (this.sessionState) {
            this.sessionState.flowVariables = this.sessionState.flowVariables || {};
            this.sessionState.flowVariables[data.name] = this.variables[data.name];
          }
          console.log(`[EventEngine] Declared variable [Flow:${data.name}] = ${this.variables[data.name]}`);
        }
        return true;

      case 'set_variable': {
        // Set either a system variable or a custom flow variable
        const varType = data.varType || 'system';
        const variable = data.variable;
        const value = data.value;

        if (!variable) {
          console.log('[EventEngine] set_variable: No variable specified');
          return false;
        }

        if (varType === 'custom') {
          // Set a custom flow variable
          this.variables[variable] = this.evaluateExpression(value);
          // Sync to sessionState for frontend access
          if (this.sessionState) {
            this.sessionState.flowVariables = this.sessionState.flowVariables || {};
            this.sessionState.flowVariables[variable] = this.variables[variable];
          }
          console.log(`[EventEngine] Set flow variable [Flow:${variable}] = ${this.variables[variable]}`);
        } else {
          // Set a system variable - update sessionState and broadcast
          if (variable === 'capacity') {
            const numValue = parseInt(value) || 0;
            const clampedValue = Math.max(0, Math.min(100, numValue));
            if (this.sessionState) {
              this.sessionState.capacity = clampedValue;
              this.broadcast('capacity_update', { capacity: clampedValue });
              console.log(`[EventEngine] Set system variable [Capacity] = ${clampedValue}`);
            }
          } else if (variable === 'pain' || variable === 'feeling') {
            // Handle both new 'pain' and legacy 'feeling' variable names
            const numValue = parseInt(value) || 0;
            const clampedValue = Math.max(0, Math.min(10, numValue));
            if (this.sessionState) {
              this.sessionState.pain = clampedValue;
              this.broadcast('pain_update', { pain: clampedValue });
              console.log(`[EventEngine] Set system variable [Pain] = ${clampedValue}`);
            }
          } else if (variable === 'emotion') {
            if (this.sessionState) {
              this.sessionState.emotion = value;
              this.broadcast('emotion_update', { emotion: value });
              console.log(`[EventEngine] Set system variable [Emotion] = ${value}`);
            }
          } else {
            console.log(`[EventEngine] set_variable: Unknown system variable "${variable}"`);
            return false;
          }
        }
        return true;
      }

      case 'toggle_reminder': {
        if (!data.reminderId) {
          console.log('[EventEngine] toggle_reminder: No reminderId specified');
          return false;
        }

        // Use explicit reminderType if provided, otherwise fall back to ID prefix check
        const isGlobal = data.reminderType === 'global' || (!data.reminderType && data.reminderId.startsWith('global-reminder-'));
        console.log(`[EventEngine] toggle_reminder: ${data.action} reminder ${data.reminderId} (global: ${isGlobal}, type: ${data.reminderType || 'auto'})`);

        if (isGlobal) {
          // Update global reminder in settings
          const settings = loadData(DATA_FILES.settings);
          if (!settings || !settings.globalReminders) {
            console.log('[EventEngine] toggle_reminder: No global reminders found');
            return false;
          }

          const reminder = settings.globalReminders.find(r => r.id === data.reminderId);
          if (!reminder) {
            console.log(`[EventEngine] toggle_reminder: Global reminder ${data.reminderId} not found`);
            return false;
          }

          if (data.action === 'enable') {
            reminder.enabled = true;
          } else if (data.action === 'disable') {
            reminder.enabled = false;
          } else if (data.action === 'update_text' && data.newText) {
            reminder.text = this.substituteVariables(data.newText);
          }

          saveData(DATA_FILES.settings, settings);
        } else {
          // Update character reminder
          const characters = loadData(DATA_FILES.characters);
          const activeCharId = this.sessionState?.activeCharacterId;

          if (!characters || !activeCharId) {
            console.log('[EventEngine] toggle_reminder: No characters or active character');
            return false;
          }

          const character = characters.find(c => c.id === activeCharId);
          if (!character || !character.constantReminders) {
            console.log(`[EventEngine] toggle_reminder: Character ${activeCharId} not found or has no reminders`);
            return false;
          }

          const reminder = character.constantReminders.find(r => r.id === data.reminderId);
          if (!reminder) {
            console.log(`[EventEngine] toggle_reminder: Reminder ${data.reminderId} not found in character`);
            return false;
          }

          if (data.action === 'enable') {
            reminder.enabled = true;
          } else if (data.action === 'disable') {
            reminder.enabled = false;
          } else if (data.action === 'update_text' && data.newText) {
            reminder.text = this.substituteVariables(data.newText);
          }

          saveData(DATA_FILES.characters, characters);
        }

        // Broadcast update so frontend can refresh
        this.broadcast('reminder_updated', {
          reminderId: data.reminderId,
          action: data.action,
          isGlobal
        });

        return true;
      }

      case 'toggle_button': {
        if (!data.buttonId) {
          console.log('[EventEngine] toggle_button: No buttonId specified');
          return false;
        }

        const characters = loadData(DATA_FILES.characters);
        const settings = loadData(DATA_FILES.settings);
        const activeCharId = settings?.activeCharacterId;

        if (!characters || !activeCharId) {
          console.log('[EventEngine] toggle_button: No characters or active character');
          return false;
        }

        const character = characters.find(c => c.id === activeCharId);
        if (!character || !character.buttons) {
          console.log(`[EventEngine] toggle_button: Character ${activeCharId} not found or has no buttons`);
          return false;
        }

        const button = character.buttons.find(b => String(b.buttonId) === String(data.buttonId));
        if (!button) {
          console.log(`[EventEngine] toggle_button: Button ${data.buttonId} not found in character`);
          return false;
        }

        if (data.action === 'enable') {
          button.enabled = true;
          console.log(`[EventEngine] toggle_button: Enabled button "${button.name}" (#${button.buttonId})`);
        } else if (data.action === 'disable') {
          button.enabled = false;
          console.log(`[EventEngine] toggle_button: Disabled button "${button.name}" (#${button.buttonId})`);
        }

        saveData(DATA_FILES.characters, characters);

        // Broadcast update so frontend can refresh
        this.broadcast('characters_update', characters);

        return true;
      }

      default:
        return true;
    }
  }

  /**
   * Handle player choice response - generates persona message and continues flow
   */
  async handlePlayerChoice(nodeId, choiceId, choiceLabel) {
    console.log(`[EventEngine] Player chose: "${choiceLabel}" (${choiceId}) for node ${nodeId}`);

    // Skip message generation for Simple A/B choices - they're silent
    const isSimpleAB = this.pendingPlayerChoice?.isSimpleAB === true;
    if (isSimpleAB) {
      console.log(`[EventEngine] Simple A/B choice - skipping message generation`);
    }

    // Generate persona message for the choice (only for Player Choice, not Simple A/B)
    if (!isSimpleAB) try {
      const settings = loadData(DATA_FILES.settings);
      const personas = loadData(DATA_FILES.personas) || [];
      const characters = loadData(DATA_FILES.characters) || [];
      const activePersona = personas.find(p => p.id === settings?.activePersonaId);
      const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);

      if (activeCharacter && settings?.llm?.llmUrl) {
        const playerName = activePersona?.displayName || 'The player';

        // Broadcast generating start
        await this.broadcast('generating_start', { characterName: playerName });

        let systemPrompt = `You are writing as ${playerName}, a player character in a roleplay scenario.\n`;
        if (activePersona) {
          if (activePersona.personality) systemPrompt += `Personality: ${activePersona.personality}\n`;
          if (activePersona.appearance) systemPrompt += `Appearance: ${activePersona.appearance}\n`;
        }
        systemPrompt += `\nYou are interacting with ${activeCharacter.name}: ${activeCharacter.description}\n`;

        // Find the choice description for more context
        const choiceInfo = this.pendingPlayerChoice?.choices?.find(c => c.id === choiceId);
        const choiceDesc = choiceInfo?.description || '';

        systemPrompt += `\n=== CRITICAL: YOUR RESPONSE MUST DO THIS ===\n`;
        systemPrompt += `You chose: "${choiceLabel}"${choiceDesc ? ` - ${choiceDesc}` : ''}\n`;
        systemPrompt += `Your response MUST express this choice directly. You are ${choiceLabel.toLowerCase()}. Say exactly what this choice implies.\n`;
        systemPrompt += `Do NOT be vague or uncertain. Commit fully to this choice in your response.\n`;
        systemPrompt += `=== END CRITICAL ===`;

        // Build prompt from recent history
        const recentMessages = this.sessionState?.chatHistory?.slice(-5) || [];
        let prompt = '';
        recentMessages.forEach(msg => {
          if (msg.sender === 'player') {
            prompt += `${playerName}: ${msg.content}\n`;
          } else {
            prompt += `${activeCharacter.name}: ${msg.content}\n`;
          }
        });

        // Add instruction at the end of prompt for emphasis
        prompt += `\n[${playerName.toUpperCase()} NOW ${choiceLabel.toUpperCase()}${choiceDesc ? ': ' + choiceDesc : ''}]\n${playerName}:`;

        const playerResult = await this.llmService.generate({
          prompt,
          systemPrompt,
          settings: settings.llm
        });

        // Add player message to chat (use special type to avoid triggering AI response)
        const playerMessage = {
          id: require('uuid').v4(),
          content: playerResult.text,
          sender: 'player',
          timestamp: Date.now(),
          generated: true,
          fromChoice: true  // Flag to indicate this came from a choice, not manual input
        };

        // Add to session history
        if (this.sessionState?.chatHistory) {
          this.sessionState.chatHistory.push(playerMessage);
        }

        // Broadcast to clients
        await this.broadcast('chat_message', playerMessage);
        await this.broadcast('generating_stop', {});
      }
    } catch (error) {
      console.error('[EventEngine] Error generating choice persona message:', error);
      await this.broadcast('generating_stop', {});
    }

    // Continue flow execution from the chosen path
    console.log(`[EventEngine] pendingPlayerChoice:`, JSON.stringify(this.pendingPlayerChoice));

    if (!this.pendingPlayerChoice) {
      console.log('[EventEngine] No pending player choice to continue');
      return;
    }

    const { nodeId: pendingNodeId, flowId } = this.pendingPlayerChoice;

    // Verify nodeId matches
    if (pendingNodeId !== nodeId) {
      console.log(`[EventEngine] Node ID mismatch: expected ${pendingNodeId}, got ${nodeId}`);
      return;
    }

    const flowData = this.activeFlows.get(flowId);
    if (!flowData) {
      console.log(`[EventEngine] Flow ${flowId} not found for choice continuation`);
      return;
    }

    const flow = flowData.flow;

    // Find the edge that matches the chosen option (sourceHandle = choiceId directly)
    const edges = flow.edges.filter(e => e.source === nodeId);
    console.log(`[EventEngine] Looking for edge with sourceHandle "${choiceId}"`);
    console.log(`[EventEngine] Available edges from ${nodeId}:`, edges.map(e => ({ target: e.target, sourceHandle: e.sourceHandle })));
    const matchingEdge = edges.find(e => e.sourceHandle === choiceId);

    if (!matchingEdge) {
      console.log(`[EventEngine] No edge found for choice ${choiceId} from node ${nodeId}`);
      console.log(`[EventEngine] Available edges: ${edges.map(e => e.sourceHandle).join(', ')}`);
      return;
    }

    console.log(`[EventEngine] Continuing flow from choice "${choiceLabel}" to node ${matchingEdge.target}`);

    // Clear pending choice
    this.pendingPlayerChoice = null;

    // Continue flow execution from the chosen branch
    await this.executeFromNode(flow, matchingEdge.target, null, true);
  }

  /**
   * Trigger a FlowAction (Button Press section) within a flow by label
   */
  async triggerButtonPressByLabel(flowId, flowActionLabel, characterId) {
    console.log(`[EventEngine] Triggering FlowAction "${flowActionLabel}" in flow: ${flowId}`);

    // Find the flow
    const flowData = this.activeFlows.get(flowId);
    if (!flowData) {
      console.log(`[EventEngine] Flow ${flowId} not found or not active`);
      return;
    }

    const flow = flowData.flow;

    // Find button_press trigger nodes in this flow
    const buttonTriggers = flow.nodes.filter(n => n.type === 'button_press');

    if (buttonTriggers.length === 0) {
      console.log(`[EventEngine] No Button Press FlowActions found in flow ${flowId}`);
      return;
    }

    // Find matching button press node by label
    const matchingTrigger = buttonTriggers.find(n => n.data.label === flowActionLabel);

    if (!matchingTrigger) {
      console.log(`[EventEngine] No Button Press FlowAction found with label "${flowActionLabel}" in flow ${flowId}`);
      console.log(`[EventEngine] Available FlowActions: ${buttonTriggers.map(n => n.data.label || '(unlabeled)').join(', ')}`);
      return;
    }

    console.log(`[EventEngine] Found matching FlowAction: "${flowActionLabel}"`);

    // Execute from the matched button press trigger
    console.log(`[EventEngine] Executing FlowAction from Button Press node: ${matchingTrigger.id}`);
    await this.executeFromNode(flow, matchingTrigger.id);
  }

  /**
   * Legacy method - Trigger by button ID (deprecated, use triggerButtonPressByLabel)
   */
  async triggerButtonPress(flowId, buttonId, characterId) {
    console.log(`[EventEngine] Button #${buttonId} triggering flow: ${flowId} (legacy method)`);

    // Find the flow
    const flow = this.activeFlows.get(flowId);
    if (!flow) {
      console.log(`[EventEngine] Flow ${flowId} not found or not active`);
      return;
    }

    // Find button_press trigger nodes in this flow
    const buttonTriggers = flow.nodes.filter(n => n.type === 'button_press');

    if (buttonTriggers.length === 0) {
      console.log(`[EventEngine] No Button Press FlowActions found in flow ${flowId}`);
      return;
    }

    // Find matching button press node by buttonId
    let matchingTrigger = buttonTriggers.find(n => n.data.buttonId === buttonId);

    // If no match found, look for a Button Press node with no buttonId (wildcard)
    if (!matchingTrigger) {
      matchingTrigger = buttonTriggers.find(n => !n.data.buttonId || n.data.buttonId === null);
      if (matchingTrigger) {
        console.log(`[EventEngine] No specific match for button #${buttonId}, using wildcard Button Press FlowAction`);
      } else {
        console.log(`[EventEngine] No Button Press FlowAction found for button #${buttonId} in flow ${flowId}`);
        return;
      }
    } else {
      console.log(`[EventEngine] Found matching Button Press FlowAction for button #${buttonId}`);
    }

    // Execute from the matched button press trigger
    console.log(`[EventEngine] Executing FlowAction from Button Press node: ${matchingTrigger.id}`);
    await this.executeFromNode(flow, matchingTrigger.id);
  }

  /**
   * Evaluate a condition node
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
        value = this.variables.deviceState || 'off';
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
        case 'device_state':
          value = this.variables.deviceState || 'off';
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
  async executeDelay(data) {
    const duration = data.duration || 5;
    const multiplier = data.unit === 'minutes' ? 60000 : 1000;
    await new Promise(resolve => setTimeout(resolve, duration * multiplier));
  }

  /**
   * Substitute variables in text
   * Supports: [Player], [Char], [Capacity], [Feeling], [Emotion], [Flow:varname], and legacy {varname}
   */
  substituteVariables(text) {
    if (!text) return text;

    let result = text;

    // System variables from session state
    if (this.sessionState) {
      result = result.replace(/\[Player\]/gi, this.sessionState.playerName || 'Player');
      result = result.replace(/\[Char\]/gi, this.sessionState.characterName || 'Character');
      result = result.replace(/\[Capacity\]/gi, this.sessionState.capacity ?? 0);
      // Convert pain number to descriptive label
      const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
      const painValue = this.sessionState.pain ?? 0;
      const painLabel = painLabels[painValue] || `Level ${painValue}`;
      result = result.replace(/\[Pain\]/gi, painLabel);
      result = result.replace(/\[Feeling\]/gi, painLabel); // Legacy support
      result = result.replace(/\[Emotion\]/gi, this.sessionState.emotion ?? 'neutral');
    }

    // Flow variables - [Flow:varname] syntax
    result = result.replace(/\[Flow:(\w+)\]/gi, (match, varName) => {
      return this.variables[varName] !== undefined ? this.variables[varName] : match;
    });

    // Legacy {varname} pattern (backwards compatibility)
    result = result.replace(/\{(\w+)\}/g, (match, varName) => {
      return this.variables[varName] !== undefined ? this.variables[varName] : match;
    });

    return result;
  }

  /**
   * Evaluate expression (simple)
   */
  evaluateExpression(expr) {
    if (typeof expr !== 'string') return expr;

    // Check if it's a number
    if (!isNaN(expr)) {
      return parseFloat(expr);
    }

    // Check for variable reference
    if (expr.startsWith('{') && expr.endsWith('}')) {
      const varName = expr.slice(1, -1);
      return this.variables[varName];
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
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
    }

    this.idleTimer = setInterval(() => {
      const idleTime = (Date.now() - this.lastActivity) / 1000;

      // Check all flows for idle triggers (sorted by priority)
      const sortedFlows = Array.from(this.activeFlows.entries())
        .sort((a, b) => a[1].priority - b[1].priority);

      for (const [flowId, { flow }] of sortedFlows) {
        const idleTriggers = flow.nodes.filter(n =>
          n.type === 'trigger' &&
          n.data.triggerType === 'idle' &&
          idleTime >= (n.data.threshold || 300)
        );

        for (const trigger of idleTriggers) {
          if (this.shouldExecuteNode(flowId, trigger)) {
            this.executeFromNode(flow, trigger.id);
          }
        }
      }
    }, 10000); // Check every 10 seconds
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
    if (!this.sessionState) return;

    for (const [deviceIp, monitor] of this.deviceMonitors.entries()) {
      let conditionMet = false;

      switch (monitor.type) {
        case 'capacity': {
          const operator = monitor.operator || '>=';
          const value = monitor.value;
          const current = this.sessionState.capacity;

          // Skip if value is not a valid number
          if (value === null || value === undefined || isNaN(value)) {
            console.log(`[EventEngine] Skipping capacity check - invalid value: ${value}`);
            break;
          }

          const numValue = parseFloat(value);

          if (operator === '>') {
            conditionMet = current > numValue;
          } else if (operator === '>=') {
            conditionMet = current >= numValue;
          } else if (operator === '=') {
            conditionMet = current === numValue;
          }

          if (conditionMet) {
            console.log(`[EventEngine] Capacity ${operator} ${numValue}% reached (${current}%), stopping device ${deviceIp}`);
          }
          break;
        }

        case 'pain': {
          // Numeric pain scale (0-10) with operator support
          const operator = monitor.operator || '>=';
          const targetPain = parseFloat(monitor.value);
          const currentPain = this.sessionState.pain ?? 0;

          switch (operator) {
            case '==':
            case '=':
              conditionMet = currentPain === targetPain;
              break;
            case '>=':
              conditionMet = currentPain >= targetPain;
              break;
            case '>':
              conditionMet = currentPain > targetPain;
              break;
            case '<':
              conditionMet = currentPain < targetPain;
              break;
            case '<=':
              conditionMet = currentPain <= targetPain;
              break;
          }

          if (conditionMet) {
            console.log(`[EventEngine] Pain ${operator} ${targetPain} reached (current: ${currentPain}), stopping device ${deviceIp}`);
          }
          break;
        }

        case 'sensation': {
          // Legacy support - treat as pain comparison
          const operator = monitor.operator || '=';
          const currentPain = this.sessionState.pain ?? 0;
          // Legacy sensation values map roughly to pain levels
          const sensationToPain = {
            'normal': 0, 'slightly tight': 2, 'comfortably full': 3,
            'stretched': 5, 'very tight': 7, 'painfully tight': 9
          };
          const targetPain = sensationToPain[monitor.value] ?? 5;
          if (operator === '=' && currentPain >= targetPain) {
            conditionMet = true;
            console.log(`[EventEngine] Legacy sensation "${monitor.value}" (pain >= ${targetPain}) reached, stopping device ${deviceIp}`);
          }
          break;
        }

        case 'emotion': {
          const operator = monitor.operator || '=';
          if (operator === '=' && this.sessionState.emotion === monitor.value) {
            conditionMet = true;
            console.log(`[EventEngine] Emotion reached "${this.sessionState.emotion}", stopping device ${deviceIp}`);
          }
          break;
        }
      }

      if (conditionMet) {
        // Get the full device object from the monitor
        const deviceObj = monitor.deviceObj;

        // Turn off the device
        if (monitor.monitorType === 'device_on') {
          await this.deviceService.turnOff(deviceIp, deviceObj);

          // Update device state tracking
          if (this.sessionState.executionHistory && this.sessionState.executionHistory.deviceActions[deviceIp]) {
            this.sessionState.executionHistory.deviceActions[deviceIp].state = 'off';
          }

          // Execute completion edges
          const pending = this.pendingDeviceOnCompletions?.get(deviceIp);
          if (pending) {
            const flowData = this.activeFlows.get(pending.flowId);
            if (flowData) {
              const flow = flowData.flow;
              const completionEdges = flow.edges.filter(e => e.source === pending.nodeId && e.sourceHandle === 'completion');
              console.log(`[EventEngine] Device On completion for ${deviceIp} - executing ${completionEdges.length} completion edges`);
              for (const edge of completionEdges) {
                await this.executeFromNode(flow, edge.target, null, true);
              }
            }
            this.pendingDeviceOnCompletions.delete(deviceIp);
          }
        } else {
          // Stop cycle (pass device object for proper brand/childId support)
          this.deviceService.stopCycle(deviceIp, deviceObj);

          // Update device state tracking
          if (this.sessionState.executionHistory && this.sessionState.executionHistory.deviceActions[deviceIp]) {
            this.sessionState.executionHistory.deviceActions[deviceIp].cycling = false;
          }
        }

        // Clear monitor
        this.deviceMonitors.delete(deviceIp);
      }
    }
  }

  /**
   * Handle cycle completion - execute completion chain
   */
  async handleCycleComplete(deviceIp) {
    const pending = this.pendingCycleCompletions.get(deviceIp);
    if (!pending) {
      console.log(`[EventEngine] Cycle complete for device ${deviceIp}, but no pending completion tracked`);
      return;
    }

    console.log(`[EventEngine] Cycle complete for device ${deviceIp}, executing completion chain`);
    this.pendingCycleCompletions.delete(deviceIp);

    // Broadcast to frontend that infinite cycle ended
    if (pending.isInfinite) {
      // Use deviceKey format (ip:childId for power strip outlets)
      const deviceKey = pending.deviceObj?.childId
        ? `${pending.deviceObj.ip}:${pending.deviceObj.childId}`
        : deviceIp;
      await this.broadcast('infinite_cycle_end', { device: deviceKey });
    }

    // Update device state tracking
    if (this.sessionState?.executionHistory?.deviceActions?.[deviceIp]) {
      this.sessionState.executionHistory.deviceActions[deviceIp].cycling = false;
    }

    // Find the flow and node
    const flowData = this.activeFlows.get(pending.flowId);
    if (!flowData) {
      console.log(`[EventEngine] Flow ${pending.flowId} no longer active, cannot execute completion chain`);
      return;
    }

    // Find and execute completion edges
    const completionEdges = flowData.flow.edges.filter(
      e => e.source === pending.nodeId && e.sourceHandle === 'completion'
    );

    console.log(`[EventEngine] Found ${completionEdges.length} completion edges to execute`);

    for (const edge of completionEdges) {
      await this.executeFromNode(flowData.flow, edge.target, null, true);
    }

    // Check if flow execution is now complete (no more pending ops for this flow)
    const flowId = pending.flowId;
    const hasPendingCycle = Array.from(this.pendingCycleCompletions.values()).some(p => p.flowId === flowId);
    const hasPendingDeviceOn = Array.from(this.pendingDeviceOnCompletions.values()).some(p => p.flowId === flowId);
    const hasPendingChoice = this.pendingPlayerChoice?.flowId === flowId;
    const hasPendingChallenge = this.pendingChallenge?.flowId === flowId;
    const depthRemaining = this.executionDepths.get(flowId) || 0;

    if (!hasPendingCycle && !hasPendingDeviceOn && !hasPendingChoice && !hasPendingChallenge && depthRemaining <= 0) {
      if (this.activeExecutions.has(flowId)) {
        console.log(`[EventEngine] Flow ${flowId} complete after cycle - removing from activeExecutions`);
        this.activeExecutions.delete(flowId);
        await this.broadcastExecutionsUpdate();
      }
    }
  }

  /**
   * Clean up - FULL RESET of all flow state
   */
  cleanup() {
    console.log('[EventEngine] Full cleanup - resetting all flow state');

    this.stopIdleCheck();

    // Deactivate all flows first
    for (const [flowId] of this.activeFlows) {
      this.deactivateFlow(flowId);
    }

    // Clear ALL maps and state
    this.activeFlows.clear();
    this.flowStates.clear();
    this.timers.clear();
    this.variables = {};
    this.executionHistory = [];
    this.deviceMonitors.clear();
    this.pendingCycleCompletions.clear();
    this.pendingDeviceOnCompletions.clear();
    this.previousPlayerState = {
      capacity: 0,
      pain: 0,
      emotion: 'neutral'
    };
    this.executedOnceConditions.clear();

    console.log('[EventEngine] Cleanup complete - all state cleared');
  }

  /**
   * Emergency Stop - Halt all flow execution and reset states
   * Keeps flows active but resets their execution state so they can trigger again
   */
  emergencyStop() {
    console.log('[EventEngine] EMERGENCY STOP - Halting all flow execution');

    // Clear all timers
    for (const [timerId, timerData] of this.timers) {
      if (timerData.interval) {
        clearInterval(timerData.interval);
      } else if (timerData.timeout) {
        clearTimeout(timerData.timeout);
      }
    }
    this.timers.clear();

    // Stop idle check
    this.stopIdleCheck();

    // Clear pending completions
    this.pendingCycleCompletions.clear();
    this.pendingDeviceOnCompletions.clear();
    this.pendingPlayerChoice = null;

    // Clear device monitors
    this.deviceMonitors.clear();

    // Reset flow states and clear any accumulated timers
    for (const [flowId, state] of this.flowStates) {
      // Clear any timers stored in flow state
      if (state.timers && state.timers.length > 0) {
        state.timers.forEach(timer => {
          clearTimeout(timer);
          clearInterval(timer);
        });
        state.timers.length = 0;
      }
      state.executedOnceNodes.clear();
      state.triggeredNodes.clear();
    }

    // Clear executed once conditions
    this.executedOnceConditions.clear();

    // Clear variables
    this.variables = {};

    // Clear execution history
    this.executionHistory = [];

    // Reset player state tracking
    this.previousPlayerState = {
      capacity: 0,
      pain: 0,
      emotion: 'neutral'
    };

    // Re-setup timer triggers for all active flows
    for (const [flowId, flowData] of this.activeFlows) {
      this.setupTimerTriggers(flowData.flow);
    }

    console.log('[EventEngine] Emergency stop complete - flow states reset, ready for new triggers');
    return { flowsReset: this.activeFlows.size };
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
    }
  }
}

module.exports = EventEngine;
