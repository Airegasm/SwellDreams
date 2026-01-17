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
  emitTestStep(step) {
    this.testResults.push(step);
    if (this.testStepCallback) {
      try {
        this.testStepCallback(step);
      } catch (err) {
        console.error('[EventEngine] TEST - Step callback error:', err);
      }
    }
  }

  /**
   * Test execution from a specific node
   * Returns step-by-step results instead of broadcasting to frontend
   * All LLM is suppressed, devices are simulated, challenges/choices auto-resolve
   * @param {Object} flow - The flow to test
   * @param {string} nodeId - The node to start execution from
   * @param {Function} stepCallback - Optional callback for streaming steps in real-time
   * @returns {Object} - { success: boolean, steps: Array, error?: string }
   */
  async testFromNode(flow, nodeId, stepCallback = null) {
    console.log(`[EventEngine] TEST MODE - Starting test from node ${nodeId} in flow "${flow.name}"`);

    // Set up test mode
    this.testMode = true;
    this.testResults = [];
    this.testStepCallback = stepCallback; // Store callback for streaming
    this.testState = {
      capacity: 0,
      pain: 0,
      emotion: 'neutral'
    };

    // Store original state
    const originalSimulationMode = this.simulationMode;
    const originalSessionState = this.sessionState ? { ...this.sessionState } : null;

    // Enable simulation mode for devices
    this.simulationMode = true;

    // Create a mock session state for testing
    if (!this.sessionState) {
      this.sessionState = {
        capacity: 0,
        pain: 0,
        emotion: 'neutral',
        executionHistory: { deviceActions: {} }
      };
    }

    try {
      // Log test start
      const startNode = flow.nodes.find(n => n.id === nodeId);
      this.emitTestStep({
        type: 'test_start',
        label: `Test started from: ${startNode?.data?.label || nodeId}`,
        nodeId: nodeId,
        nodeType: startNode?.type || 'unknown'
      });

      // Execute the flow from the specified node
      await this.executeTestFromNode(flow, nodeId);

      // Log test completion
      this.emitTestStep({
        type: 'test_complete',
        label: 'Test completed',
        totalSteps: this.testResults.length
      });

      return { success: true, steps: this.testResults };
    } catch (error) {
      console.error(`[EventEngine] TEST MODE - Error:`, error);
      this.emitTestStep({
        type: 'error',
        label: 'Test error',
        details: error.message
      });
      return { success: false, error: error.message, steps: this.testResults };
    } finally {
      // Restore original state
      this.testMode = false;
      this.simulationMode = originalSimulationMode;
      this.testStepCallback = null; // Clear callback
      if (originalSessionState) {
        this.sessionState = originalSessionState;
      }
      this.testResults = [];
      this.testState = {};
      console.log('[EventEngine] TEST MODE - Completed, state restored');
    }
  }

  /**
   * Execute flow from a node in test mode
   * Similar to executeFromNode but captures results instead of broadcasting
   */
  async executeTestFromNode(flow, nodeId) {
    const node = flow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Execute current node
    const result = await this.executeTestNode(node, flow);

    // Find outgoing edges
    let edges = flow.edges.filter(e => e.source === nodeId);

    // For condition/branch nodes, filter by result
    if (node.type === 'condition') {
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
    } else if (result === 'start_cycle' || result === 'device_on') {
      // For cycle/device_on, execute immediate edges
      const immediateEdges = edges.filter(e => e.sourceHandle === 'immediate');
      const completionEdges = edges.filter(e => e.sourceHandle === 'completion');
      edges = immediateEdges;
      // Log completion edges as pending
      if (completionEdges.length > 0) {
        this.emitTestStep({
          type: 'pending_completion',
          label: `${completionEdges.length} completion edge(s) would execute when device turns off`,
          details: completionEdges.map(e => e.target).join(', ')
        });
      }
    } else if (typeof result === 'object' && result?.skipEdges) {
      // Challenge/choice nodes: execute based on the result
      if (result.outputId) {
        edges = edges.filter(e => e.sourceHandle === result.outputId);
      }
    } else if (node.type === 'capacity_ai_message' || node.type === 'capacity_player_message') {
      // For capacity message nodes, route to matched range output or global
      const outputHandle = result || 'global';
      const matchingEdges = edges.filter(e => e.sourceHandle === outputHandle);
      const globalEdges = edges.filter(e => e.sourceHandle === 'global' || !e.sourceHandle);
      edges = matchingEdges.length > 0 ? matchingEdges : globalEdges;
    }

    // Execute next nodes
    for (const edge of edges) {
      await this.executeTestFromNode(flow, edge.target);
    }
  }

  /**
   * Execute a single node in test mode
   */
  async executeTestNode(node, flow) {
    console.log(`[EventEngine] TEST - Executing node: ${node.type} - ${node.data.label}`);

    // Log node execution
    const nodeStep = {
      type: 'node',
      label: node.data.label || node.type,
      nodeId: node.id,
      nodeType: node.type,
      details: ''
    };

    switch (node.type) {
      case 'trigger':
      case 'button_press':
        nodeStep.details = `Trigger: ${node.data.triggerType || 'button_press'}`;
        this.emitTestStep(nodeStep);
        return true;

      case 'action':
        return await this.executeTestAction(node.data, flow, node.id, nodeStep);

      case 'condition':
        return this.evaluateTestCondition(node.data, flow.id, node.id, nodeStep);

      case 'branch':
        const branchResult = this.evaluateBranch(node.data);
        nodeStep.details = `Branch selected: ${branchResult}`;
        this.emitTestStep(nodeStep);
        return branchResult;

      case 'delay':
        nodeStep.details = `Delay: ${node.data.delay || 1}s (skipped in test)`;
        this.emitTestStep(nodeStep);
        return true;

      case 'player_choice':
        return this.executeTestPlayerChoice(node, flow, nodeStep);

      case 'simple_ab':
        return this.executeTestSimpleAB(node, flow, nodeStep);

      case 'input':
        return this.executeTestInput(node, flow, nodeStep);

      case 'random_number':
        return this.executeTestRandomNumber(node, flow, nodeStep);

      case 'capacity_ai_message':
      case 'capacity_player_message':
        return this.executeTestCapacityMessage(node, flow, nodeStep);

      // Challenge nodes
      case 'prize_wheel':
      case 'dice_roll':
      case 'coin_flip':
      case 'rps':
      case 'timer_challenge':
      case 'number_guess':
      case 'slot_machine':
      case 'card_draw':
      case 'simon_challenge':
      case 'reflex_challenge':
        return this.executeTestChallenge(node, flow, nodeStep);

      case 'pause_resume':
        nodeStep.details = `Pause/Resume: ${node.data.resumeAfterValue || 4} ${node.data.resumeAfterType || 'messages'}`;
        this.emitTestStep(nodeStep);
        return true;  // In test mode, execute both PAUSE and RESUME branches

      default:
        nodeStep.details = 'Unknown node type';
        this.emitTestStep(nodeStep);
        return true;
    }
  }

  /**
   * Execute action node in test mode
   */
  async executeTestAction(data, flow, nodeId, nodeStep) {
    switch (data.actionType) {
      case 'send_message':
        nodeStep.details = `AI Message: "${(data.message || '').substring(0, 50)}${(data.message || '').length > 50 ? '...' : ''}"`;
        nodeStep.suppressLlm = true; // Always suppress in test
        this.emitTestStep(nodeStep);
        this.emitTestStep({
          type: 'broadcast',
          label: 'AI Message (suppressed)',
          details: data.message || '',
          broadcastType: 'ai_message'
        });
        return true;

      case 'send_player_message':
        nodeStep.details = `Player Message: "${(data.message || '').substring(0, 50)}${(data.message || '').length > 50 ? '...' : ''}"`;
        this.emitTestStep(nodeStep);
        this.emitTestStep({
          type: 'broadcast',
          label: 'Player Message (suppressed)',
          details: data.message || '',
          broadcastType: 'player_message'
        });
        return true;

      case 'system_message':
        nodeStep.details = `System Message: "${(data.message || '').substring(0, 50)}..."`;
        this.emitTestStep(nodeStep);
        return true;

      case 'device_on':
        nodeStep.details = `Device ON: ${data.device} (simulated)`;
        this.emitTestStep(nodeStep);
        this.emitTestStep({
          type: 'device',
          label: `Device "${data.device}" turned ON`,
          details: data.untilType ? `Until: ${data.untilType} ${data.untilOperator || '>'} ${data.untilValue}` : 'Forever',
          action: 'on'
        });
        return 'device_on';

      case 'device_off':
        nodeStep.details = `Device OFF: ${data.device} (simulated)`;
        this.emitTestStep(nodeStep);
        this.emitTestStep({
          type: 'device',
          label: `Device "${data.device}" turned OFF`,
          action: 'off'
        });
        return true;

      case 'start_cycle':
        nodeStep.details = `Start Cycle: ${data.device} (duration: ${data.duration || 5}s, interval: ${data.interval || 10}s, cycles: ${data.cycles || 'infinite'})`;
        this.emitTestStep(nodeStep);
        this.emitTestStep({
          type: 'device',
          label: `Device "${data.device}" cycling`,
          details: `Duration: ${data.duration || 5}s, Interval: ${data.interval || 10}s, Cycles: ${data.cycles || 'infinite'}`,
          action: 'cycle'
        });
        return 'start_cycle';

      case 'stop_cycle':
        nodeStep.details = `Stop Cycle: ${data.device} (simulated)`;
        this.emitTestStep(nodeStep);
        return true;

      case 'pulse_pump':
        nodeStep.details = `Pulse Pump: ${data.device} (${data.pulses || 3} pulses, 1s on/1s off)`;
        this.emitTestStep(nodeStep);
        this.emitTestStep({
          type: 'device',
          label: `Device "${data.device}" pulsing`,
          details: `${data.pulses || 3} pulses (1s on/1s off each)`,
          action: 'pulse'
        });
        return true;

      case 'set_variable':
        nodeStep.details = `Set Variable: ${data.variableName} = ${data.variableValue}`;
        this.emitTestStep(nodeStep);
        return true;

      default:
        nodeStep.details = `Action: ${data.actionType}`;
        this.emitTestStep(nodeStep);
        return true;
    }
  }

  /**
   * Evaluate condition in test mode - automatically adjust test state to meet conditions
   */
  evaluateTestCondition(data, flowId, nodeId, nodeStep) {
    const conditions = data.conditions || [data];

    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      const variable = condition.variable;
      const operator = condition.operator;
      const targetValue = parseFloat(condition.value) || condition.value;

      // Get current test state value
      let currentValue = this.testState[variable] ?? 0;

      // For numeric conditions, adjust test state to meet the condition
      if (['capacity', 'pain'].includes(variable) && typeof targetValue === 'number') {
        let newValue = currentValue;

        switch (operator) {
          case '>':
            newValue = targetValue + 1;
            break;
          case '>=':
            newValue = targetValue;
            break;
          case '==':
          case '=':
            newValue = targetValue;
            break;
          case '<':
            newValue = targetValue - 1;
            break;
          case '<=':
            newValue = targetValue;
            break;
          case 'range':
            const min = parseFloat(condition.value);
            const max = parseFloat(condition.value2);
            newValue = (min + max) / 2;
            break;
        }

        // Record state change
        if (newValue !== currentValue) {
          this.emitTestStep({
            type: 'state_change',
            label: `${variable} adjusted for condition`,
            stateChange: {
              [variable]: { from: currentValue, to: newValue }
            },
            details: `${variable}: ${currentValue} → ${newValue} (to meet ${operator} ${targetValue})`
          });
          this.testState[variable] = newValue;
        }

        nodeStep.details = `Condition: ${variable} ${operator} ${targetValue} → TRUE (adjusted)`;
        this.emitTestStep(nodeStep);

        return { result: true, conditionIndex: i };
      } else if (variable === 'emotion') {
        // For emotion, set to target value
        if (this.testState.emotion !== targetValue) {
          this.emitTestStep({
            type: 'state_change',
            label: 'emotion adjusted for condition',
            stateChange: {
              emotion: { from: this.testState.emotion || 'neutral', to: targetValue }
            },
            details: `emotion: ${this.testState.emotion || 'neutral'} → ${targetValue}`
          });
          this.testState.emotion = targetValue;
        }

        nodeStep.details = `Condition: emotion ${operator} "${targetValue}" → TRUE (adjusted)`;
        this.emitTestStep(nodeStep);

        return { result: true, conditionIndex: i };
      }
    }

    // No conditions could be met
    nodeStep.details = 'No conditions matched → FALSE';
    this.emitTestStep(nodeStep);
    return { result: false, conditionIndex: -1 };
  }

  /**
   * Execute player choice in test mode - auto-select first option
   */
  executeTestPlayerChoice(node, flow, nodeStep) {
    const choices = node.data.choices || [];
    const firstChoice = choices[0];

    nodeStep.details = `Player Choice: ${choices.length} options`;
    this.emitTestStep(nodeStep);

    this.emitTestStep({
      type: 'choice',
      label: 'Player Choice presented',
      details: choices.map(c => c.label || c.id).join(', '),
      choices: choices
    });

    if (firstChoice) {
      this.emitTestStep({
        type: 'choice_selected',
        label: `Auto-selected: "${firstChoice.label || firstChoice.id}"`,
        selectedChoice: firstChoice
      });

      // Return the output to follow
      return { skipEdges: true, outputId: firstChoice.id };
    }

    return { skipEdges: true, outputId: null };
  }

  /**
   * Execute simple A/B in test mode - auto-select option A
   */
  executeTestSimpleAB(node, flow, nodeStep) {
    const data = node.data;

    nodeStep.details = `Simple A/B: "${data.labelA || 'A'}" vs "${data.labelB || 'B'}"`;
    this.emitTestStep(nodeStep);

    this.emitTestStep({
      type: 'choice',
      label: 'Simple A/B presented',
      details: `A: ${data.labelA || 'Option A'}, B: ${data.labelB || 'Option B'}`,
      choices: [
        { id: 'a', label: data.labelA || 'Option A' },
        { id: 'b', label: data.labelB || 'Option B' }
      ]
    });

    this.emitTestStep({
      type: 'choice_selected',
      label: `Auto-selected: "${data.labelA || 'Option A'}"`,
      selectedChoice: { id: 'a', label: data.labelA || 'Option A' }
    });

    return { skipEdges: true, outputId: 'a' };
  }

  /**
   * Execute input in test mode - auto-fill with test value
   */
  executeTestInput(node, flow, nodeStep) {
    const data = node.data;
    const variableName = data.variableName || 'Input';
    const testValue = data.inputType === 'number' ? 5 : 'test_value';

    nodeStep.details = `Input: "${data.prompt?.substring(0, 40) || 'Enter value'}..." → [Flow:${variableName}]`;
    this.emitTestStep(nodeStep);

    this.emitTestStep({
      type: 'input',
      label: 'Input requested',
      details: `Type: ${data.inputType || 'text'}, Variable: [Flow:${variableName}]`,
      inputType: data.inputType || 'text',
      variableName
    });

    // Auto-fill with test value
    this.variables[variableName] = testValue;
    if (this.sessionState) {
      this.sessionState.flowVariables = this.sessionState.flowVariables || {};
      this.sessionState.flowVariables[variableName] = testValue;
    }

    this.emitTestStep({
      type: 'input_filled',
      label: `Auto-filled: [Flow:${variableName}] = ${testValue}`,
      value: testValue
    });

    return true; // Continue to next node
  }

  /**
   * Execute random_number in test mode - generate and store random number
   */
  executeTestRandomNumber(node, flow, nodeStep) {
    const data = node.data;
    const minValue = data.minValue ?? 1;
    const maxValue = data.maxValue ?? 100;
    const variableName = data.variableName || 'RandomNum';

    // Generate random integer between min and max (inclusive)
    const randomValue = Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;

    nodeStep.details = `Random: ${minValue}-${maxValue} → [Flow:${variableName}] = ${randomValue}`;
    this.emitTestStep(nodeStep);

    // Store as flow variable
    this.variables[variableName] = randomValue;
    if (this.sessionState) {
      this.sessionState.flowVariables = this.sessionState.flowVariables || {};
      this.sessionState.flowVariables[variableName] = randomValue;
    }

    return true; // Continue to next node
  }

  /**
   * Execute challenge in test mode - simulate result
   */
  executeTestChallenge(node, flow, nodeStep) {
    const challengeType = node.type;
    const data = node.data;

    let resultDetails = '';
    let outputId = 'player-wins'; // Default to player wins

    switch (challengeType) {
      case 'prize_wheel':
        const segments = data.segments || [];
        const randomSegment = segments[Math.floor(Math.random() * segments.length)];
        resultDetails = `Wheel landed on: "${randomSegment?.label || 'Unknown'}"`;
        outputId = randomSegment?.id || 'segment-0';
        break;

      case 'dice_roll':
        const diceCount = data.diceCount || 1;
        const rolls = Array(diceCount).fill(0).map(() => Math.floor(Math.random() * 6) + 1);
        const total = rolls.reduce((a, b) => a + b, 0);
        resultDetails = `Rolled: ${rolls.join(', ')} (total: ${total})`;
        // Check win condition
        const winCondition = data.winCondition || 'higher';
        const threshold = data.winThreshold || 4;
        if (winCondition === 'higher' && total > threshold) outputId = 'player-wins';
        else if (winCondition === 'lower' && total < threshold) outputId = 'player-wins';
        else if (winCondition === 'equal' && total === threshold) outputId = 'player-wins';
        else outputId = 'character-wins';
        break;

      case 'coin_flip':
        const flip = Math.random() > 0.5 ? 'heads' : 'tails';
        resultDetails = `Coin landed: ${flip}`;
        outputId = flip;
        break;

      case 'rps':
        const moves = ['rock', 'paper', 'scissors'];
        const playerMove = moves[Math.floor(Math.random() * 3)];
        const aiMove = moves[Math.floor(Math.random() * 3)];
        resultDetails = `Player: ${playerMove}, AI: ${aiMove}`;
        if (playerMove === aiMove) outputId = 'draw';
        else if ((playerMove === 'rock' && aiMove === 'scissors') ||
                 (playerMove === 'paper' && aiMove === 'rock') ||
                 (playerMove === 'scissors' && aiMove === 'paper')) outputId = 'player-wins';
        else outputId = 'character-wins';
        break;

      case 'timer_challenge':
        resultDetails = `Timer challenge: auto-completed successfully`;
        outputId = 'success';
        break;

      case 'number_guess':
        const secretNumber = Math.floor(Math.random() * (data.maxNumber || 10)) + 1;
        resultDetails = `Secret number: ${secretNumber}, auto-guessed correctly`;
        outputId = 'correct';
        break;

      case 'slot_machine':
        const slotSymbols = data.symbols || ['🍒', '🍋', '🔔', '⭐', '7️⃣'];
        const reels = [0, 1, 2].map(() => slotSymbols[Math.floor(Math.random() * slotSymbols.length)]);
        resultDetails = `Reels: ${reels.join(' | ')}`;
        if (reels[0] === reels[1] && reels[1] === reels[2]) {
          resultDetails += ' - JACKPOT!';
          outputId = 'jackpot';
        } else {
          outputId = 'no-match';
        }
        break;

      case 'card_draw':
        const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const playerCard = `${values[Math.floor(Math.random() * values.length)]} of ${suits[Math.floor(Math.random() * suits.length)]}`;
        const aiCard = `${values[Math.floor(Math.random() * values.length)]} of ${suits[Math.floor(Math.random() * suits.length)]}`;
        resultDetails = `Player: ${playerCard}, AI: ${aiCard}`;
        outputId = Math.random() > 0.5 ? 'player-wins' : 'character-wins';
        break;

      default:
        resultDetails = `Unknown challenge type: ${challengeType}`;
    }

    nodeStep.details = `Challenge: ${challengeType}`;
    this.emitTestStep(nodeStep);

    this.emitTestStep({
      type: 'challenge',
      label: `${challengeType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Challenge`,
      details: resultDetails,
      challengeType: challengeType,
      result: outputId
    });

    return { skipEdges: true, outputId };
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
      const blockedTypes = ['ai_message', 'player_message', 'challenge', 'player_choice', 'simple_ab', 'flow_message'];
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

        // Inherit flags from activeExecutions
        const execution = this.activeExecutions.get(flow.id);
        const inheritedPriority = execution?.triggerPriority || null;
        const inheritedNotify = execution?.shouldNotify || false;

        for (const edge of edges) {
          await this.executeFromNode(flow, edge.target, null, true, inheritedPriority, inheritedNotify);
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
      executedOnceNodes: new Set()
    });

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
    this.activeFlows.delete(flowId);
    this.flowStates.delete(flowId);

    console.log(`[EventEngine] Deactivated flow: ${flowId}`);
  }

  /**
   * Deactivate all currently active flows
   */
  deactivateAllFlows() {
    const flowIds = Array.from(this.activeFlows.keys());
    for (const flowId of flowIds) {
      this.activeFlows.delete(flowId);
      this.flowStates.delete(flowId);
    }
    console.log(`[EventEngine] Deactivated all flows (${flowIds.length} total)`);
  }

  /**
   * Handle incoming event
   * Only ONE trigger fires per event - selected by priority, then random among ties
   */
  async handleEvent(eventType, eventData) {
    this.lastActivity = Date.now();
    console.log(`[EventEngine] handleEvent called: ${eventType}`, eventData);
    console.log(`[EventEngine] Active flows: ${this.activeFlows.size}`);

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

      // Check pending pause/resume nodes - resume flows that have waited enough messages
      this.checkPendingPauses();
    }

    // Collect ALL matching triggers across ALL flows
    const allCandidates = [];

    for (const [flowId, { flow, priority: flowPriority }] of this.activeFlows.entries()) {
      const triggers = this.findTriggerNodes(flow, eventType, eventData);

      for (const trigger of triggers) {
        if (this.shouldExecuteNode(flowId, trigger)) {
          const triggerPriority = trigger.data.hasPriority ? (trigger.data.priority || 3) : 99;
          const isUnblockable = trigger.data.unblockable || false;

          allCandidates.push({
            flowId,
            flow,
            trigger,
            flowPriority,
            triggerPriority,
            // Combined priority: flow priority * 100 + trigger priority (lower = higher priority)
            combinedPriority: (flowPriority * 100) + triggerPriority,
            isUnblockable,
            shouldNotify: trigger.data.notify || false,
            triggerLabel: trigger.data.label || trigger.data.triggerType || 'Flow'
          });
        }
      }
    }

    if (allCandidates.length === 0) {
      console.log(`[EventEngine] No matching triggers found`);
      return;
    }

    console.log(`[EventEngine] Found ${allCandidates.length} candidate trigger(s)`);

    // Separate unblockable triggers (they always run)
    const unblockableTriggers = allCandidates.filter(c => c.isUnblockable);
    const normalTriggers = allCandidates.filter(c => !c.isUnblockable);

    // Execute all unblockable triggers (these are exceptions)
    for (const candidate of unblockableTriggers) {
      console.log(`[EventEngine] Executing unblockable trigger ${candidate.trigger.id} from flow ${candidate.flow.name}`);
      await this.executeFromNode(candidate.flow, candidate.trigger.id, null, false, null, candidate.shouldNotify);
      // Update cooldown tracking for player_speaks/ai_speaks triggers
      if (eventType === 'player_speaks' || eventType === 'ai_speaks') {
        this.triggerCooldowns[candidate.trigger.id] = this.messageCount;
      }
    }

    // For normal triggers, pick ONE based on priority then random
    if (normalTriggers.length > 0) {
      // Sort by combined priority (ascending - lower is higher priority)
      normalTriggers.sort((a, b) => a.combinedPriority - b.combinedPriority);

      // Find highest priority value
      const highestPriority = normalTriggers[0].combinedPriority;

      // Get all triggers with the highest priority
      const topPriorityTriggers = normalTriggers.filter(c => c.combinedPriority === highestPriority);

      // Pick one randomly from ties
      const selected = topPriorityTriggers[Math.floor(Math.random() * topPriorityTriggers.length)];

      console.log(`[EventEngine] Selected trigger: ${selected.trigger.id} from flow ${selected.flow.name} (priority: ${selected.combinedPriority}, chosen from ${topPriorityTriggers.length} candidates)`);

      const triggerPriority = selected.trigger.data.hasPriority ? (selected.trigger.data.priority || 3) : null;

      // Priority-based interruption logic
      if (triggerPriority !== null) {
        if (this.runningFlowPriority !== null) {
          if (triggerPriority < this.runningFlowPriority) {
            console.log(`[EventEngine] Priority interrupt: new trigger (priority ${triggerPriority}) overrides running flow (priority ${this.runningFlowPriority})`);
            if (selected.shouldNotify) {
              await this.broadcast('flow_toast', {
                event: 'takeover',
                message: `${selected.triggerLabel} (priority ${triggerPriority}) taking over`,
                flowName: selected.flow.name,
                priority: triggerPriority
              });
            }
            this.abortCurrentFlow();
          } else {
            console.log(`[EventEngine] Priority skip: trigger (priority ${triggerPriority}) ignored - running flow has priority ${this.runningFlowPriority}`);
            if (selected.shouldNotify) {
              await this.broadcast('flow_toast', {
                event: 'blocked',
                message: `${selected.triggerLabel} blocked (priority ${triggerPriority} <= ${this.runningFlowPriority})`,
                flowName: selected.flow.name,
                priority: triggerPriority
              });
            }
            return;
          }
        }
        this.runningFlowPriority = triggerPriority;
      }

      // Execute the ONE selected trigger
      console.log(`[EventEngine] Executing trigger ${selected.trigger.id} (priority: ${triggerPriority !== null ? triggerPriority : 'none'})`);
      await this.executeFromNode(selected.flow, selected.trigger.id, null, false, triggerPriority, selected.shouldNotify);

      // Update cooldown tracking for player_speaks/ai_speaks triggers
      if (eventType === 'player_speaks' || eventType === 'ai_speaks') {
        this.triggerCooldowns[selected.trigger.id] = this.messageCount;
      }

      // Clear running priority when flow completes
      if (triggerPriority !== null) {
        this.runningFlowPriority = null;
      }
    }
  }

  /**
   * Abort the currently running flow for priority interruption
   */
  abortCurrentFlow() {
    console.log('[EventEngine] Aborting current flow for priority interruption');
    this.aborted = true;
    this.abortEpoch++;

    // Clear all pending completions and monitors
    this.pendingCycleCompletions.clear();
    this.pendingDeviceOnCompletions.clear();
    this.deviceMonitors.clear();

    // Clear execution tracking
    this.activeExecutions.clear();
    this.executionDepths.clear();

    // Broadcast update
    this.broadcastExecutionsUpdate();

    // Reset abort flag after a tick to allow new flow to start
    setImmediate(() => {
      this.aborted = false;
    });
  }

  /**
   * Find trigger nodes matching an event
   */
  findTriggerNodes(flow, eventType, eventData) {
    return flow.nodes.filter(node => {
      if (node.type !== 'trigger') return false;

      switch (eventType) {
        case 'device_on':
          if (node.data.triggerType !== 'device_on') return false;
          return !node.data.device || node.data.device === eventData.ip;

        case 'device_off':
          if (node.data.triggerType !== 'device_off') return false;
          return !node.data.device || node.data.device === eventData.ip;

        case 'player_speaks':
          // Handle first_message trigger type - fires only on first player message
          if (node.data.triggerType === 'first_message') {
            // messageCount is incremented before trigger matching, so first message = 1
            const isFirst = this.messageCount === 1;
            console.log(`[EventEngine] first_message trigger check: messageCount=${this.messageCount}, isFirst=${isFirst}`);
            return isFirst;
          }

          if (node.data.triggerType !== 'player_speaks') return false;
          // Check cooldown (default 5 messages)
          const playerCooldown = node.data.cooldown ?? 5;
          const playerLastFired = this.triggerCooldowns?.[node.id] || 0;
          const playerMessagesSince = this.messageCount - playerLastFired;
          if (playerLastFired > 0 && playerMessagesSince < playerCooldown) {
            console.log(`[EventEngine] player_speaks trigger ${node.id} on cooldown (${playerMessagesSince}/${playerCooldown} messages)`);
            return false;
          }
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
          // Check cooldown (default 5 messages)
          const aiCooldown = node.data.cooldown ?? 5;
          const aiLastFired = this.triggerCooldowns?.[node.id] || 0;
          const aiMessagesSince = this.messageCount - aiLastFired;
          if (aiLastFired > 0 && aiMessagesSince < aiCooldown) {
            console.log(`[EventEngine] ai_speaks trigger ${node.id} on cooldown (${aiMessagesSince}/${aiCooldown} messages)`);
            return false;
          }
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
   * Count significant nodes in a flow path starting from a node
   */
  countFlowSteps(flow, startNodeId) {
    const significantTypes = ['action', 'condition', 'branch', 'delay', 'player_choice', 'simple_ab',
      'capacity_ai_message', 'capacity_player_message',
      'prize_wheel', 'dice_roll', 'coin_flip', 'rps', 'timer_challenge', 'number_guess', 'slot_machine', 'card_draw', 'simon_challenge', 'reflex_challenge'];
    const visited = new Set();
    let count = 0;

    const traverse = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = flow.nodes.find(n => n.id === nodeId);
      if (!node) return;

      if (significantTypes.includes(node.type)) {
        count++;
      }

      // Find outgoing edges and traverse
      const edges = flow.edges.filter(e => e.source === nodeId);
      for (const edge of edges) {
        traverse(edge.target);
      }
    };

    traverse(startNodeId);
    return count;
  }

  /**
   * Execute flow starting from a node
   */
  async executeFromNode(flow, nodeId, fromHandle = null, skipTriggers = false, triggerPriority = null, shouldNotify = false) {
    // Check abort flag at the start of each node execution
    if (this.aborted) {
      console.log(`[EventEngine] Execution aborted - stopping flow "${flow.name}"`);
      return;
    }

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
      const triggerLabel = node.data.label || triggerType;

      // Initialize variables from new_session trigger's initialVariables
      if (triggerType === 'new_session' && node.data.initialVariables) {
        for (const varDef of node.data.initialVariables) {
          if (varDef.name) {
            const value = this.evaluateExpression(varDef.value || '');
            this.variables[varDef.name] = value;
            // Sync to sessionState for frontend access
            if (this.sessionState) {
              this.sessionState.flowVariables = this.sessionState.flowVariables || {};
              this.sessionState.flowVariables[varDef.name] = value;
            }
            console.log(`[EventEngine] Initialized variable from new_session: [Flow:${varDef.name}] = ${value}`);
          }
        }
      }

      // Store alternate welcome message from new_session trigger
      if (triggerType === 'new_session' && node.data.alternateWelcomeEnabled && node.data.alternateWelcome) {
        this.alternateWelcome = {
          text: node.data.alternateWelcome,
          suppressLlmEnhancement: node.data.suppressWelcomeEnhancement || false
        };
        console.log(`[EventEngine] Alternate welcome set from new_session trigger: "${node.data.alternateWelcome.substring(0, 50)}...", suppress LLM: ${this.alternateWelcome.suppressLlmEnhancement}`);
      }

      // Apply initial reminder states from new_session trigger
      if (triggerType === 'new_session' && node.data.initialReminderStates) {
        const settings = loadData(DATA_FILES.settings);
        const characters = this.storageHelpers?.loadCharacters() || loadData(DATA_FILES.characters);
        const activeCharId = settings?.activeCharacterId;
        const character = characters?.find(c => c.id === activeCharId);
        let settingsChanged = false;
        let characterChanged = false;

        for (const [reminderId, action] of Object.entries(node.data.initialReminderStates)) {
          const enabled = action === 'enable';

          // Check global reminders first
          const globalReminder = (settings?.globalReminders || []).find(r => r.id === reminderId);
          if (globalReminder) {
            globalReminder.enabled = enabled;
            settingsChanged = true;
            console.log(`[EventEngine] Initial state: Global reminder "${globalReminder.name}" set to ${enabled ? 'enabled' : 'disabled'}`);
            continue;
          }

          // Check character reminders
          if (character?.constantReminders) {
            const charReminder = character.constantReminders.find(r => r.id === reminderId);
            if (charReminder) {
              charReminder.enabled = enabled;
              characterChanged = true;
              console.log(`[EventEngine] Initial state: Character reminder "${charReminder.name}" set to ${enabled ? 'enabled' : 'disabled'}`);
            }
          }
        }

        if (settingsChanged) {
          saveData(DATA_FILES.settings, settings);
        }
        if (characterChanged && character) {
          if (this.storageHelpers?.saveCharacter) {
            this.storageHelpers.saveCharacter(character);
          } else {
            saveData(DATA_FILES.characters, characters);
          }
        }
      }

      // Apply initial button states from new_session trigger
      if (triggerType === 'new_session' && node.data.initialButtonStates) {
        const characters = this.storageHelpers?.loadCharacters() || loadData(DATA_FILES.characters);
        const settings = loadData(DATA_FILES.settings);
        const activeCharId = settings?.activeCharacterId;
        const character = characters?.find(c => c.id === activeCharId);

        if (character?.buttons) {
          let changed = false;
          for (const [buttonId, action] of Object.entries(node.data.initialButtonStates)) {
            const button = character.buttons.find(b => String(b.buttonId) === String(buttonId));
            if (button) {
              button.enabled = action === 'enable';
              changed = true;
              console.log(`[EventEngine] Initial state: Button "${button.name}" set to ${button.enabled ? 'enabled' : 'disabled'}`);
            }
          }

          if (changed) {
            if (this.storageHelpers?.saveCharacter) {
              this.storageHelpers.saveCharacter(character);
            } else {
              saveData(DATA_FILES.characters, characters);
            }
            // Broadcast update so frontend can refresh
            const updatedChars = this.storageHelpers?.loadCharacters() || characters;
            this.broadcast('characters_update', updatedChars);
          }
        }
      }

      // Count total significant steps in this flow
      const totalSteps = this.countFlowSteps(flow, nodeId);

      // Add to active executions (or update if already exists)
      this.activeExecutions.set(flow.id, {
        flowId: flow.id,
        flowName: flow.name,
        triggerType: triggerType,
        triggerLabel: triggerLabel,
        currentNodeLabel: node.data.label,
        startTime: Date.now(),
        currentStep: 0,
        totalSteps: totalSteps,
        triggerPriority: triggerPriority,
        shouldNotify: shouldNotify
      });

      // Broadcast flow start toast (only if notify is enabled)
      if (shouldNotify) {
        await this.broadcast('flow_toast', {
          event: 'start',
          message: `${triggerLabel} started`,
          flowName: flow.name,
          currentStep: 1,
          totalSteps: totalSteps
        });
      }

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

    // Check abort after node execution (may have been stopped during async operations)
    if (this.aborted || result === 'aborted') {
      console.log(`[EventEngine] Execution aborted after node "${node.data.label}" - stopping chain`);
      // Decrement depth and exit
      const abortDepth = (this.executionDepths.get(flow.id) || 1) - 1;
      if (abortDepth <= 0) {
        this.executionDepths.delete(flow.id);
        this.activeExecutions.delete(flow.id);
      } else {
        this.executionDepths.set(flow.id, abortDepth);
      }
      return;
    }

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
    } else if (node.type === 'capacity_ai_message' || node.type === 'capacity_player_message') {
      // For capacity message nodes, route to matched range output or global
      const outputHandle = result || 'global';
      const matchingEdges = edges.filter(e => e.sourceHandle === outputHandle);
      const globalEdges = edges.filter(e => e.sourceHandle === 'global' || !e.sourceHandle);
      // Use matching range edges if available, otherwise fall back to global
      if (matchingEdges.length > 0) {
        console.log(`[EventEngine] Capacity message routing to ${outputHandle} (${matchingEdges.length} edges)`);
        edges = matchingEdges;
      } else if (globalEdges.length > 0) {
        console.log(`[EventEngine] Capacity message routing to global fallback (${globalEdges.length} edges)`);
        edges = globalEdges;
      }
    }

    // Execute next nodes (skip triggers during traversal to prevent loops)
    // Pass through the trigger flags for chain continuations
    for (const edge of edges) {
      await this.executeFromNode(flow, edge.target, null, true, triggerPriority, shouldNotify);
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
      const hasPendingInput = this.pendingInput?.flowId === flow.id;

      const hasPendingOps = hasPendingCycle || hasPendingDeviceOn || hasPendingChoice || hasPendingChallenge || hasPendingInput;

      if (!hasPendingOps && this.activeExecutions.has(flow.id)) {
        // Flow complete - broadcast completion toast and remove from active executions
        const completedExecution = this.activeExecutions.get(flow.id);
        if (completedExecution) {
          // Only broadcast completion toast if notify is enabled
          if (completedExecution.shouldNotify) {
            await this.broadcast('flow_toast', {
              event: 'complete',
              message: `${completedExecution.triggerLabel} complete`,
              flowName: flow.name,
              totalSteps: completedExecution.totalSteps
            });
          }
        }
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
    // Check abort flag
    if (this.aborted) {
      return false;
    }

    console.log(`[EventEngine] Executing node: ${node.type} - ${node.data.label}`);

    // Update current node label in active execution
    const execution = this.activeExecutions.get(flow.id);
    if (execution) {
      execution.currentNodeLabel = node.data.label;
      // Only broadcast updates for significant nodes (not every tiny step)
      const significantTypes = ['action', 'condition', 'branch', 'delay', 'player_choice', 'simple_ab',
        'capacity_ai_message', 'capacity_player_message',
        'prize_wheel', 'dice_roll', 'coin_flip', 'rps', 'timer_challenge', 'number_guess', 'slot_machine', 'card_draw', 'simon_challenge', 'reflex_challenge'];
      if (significantTypes.includes(node.type)) {
        // Track executed nodes to prevent duplicate progress toasts
        if (!execution.executedNodes) execution.executedNodes = new Set();
        if (!execution.executedNodes.has(node.id)) {
          execution.executedNodes.add(node.id);
          execution.currentStep = (execution.currentStep || 0) + 1;
          // Broadcast step progress toast (only if notify is enabled)
          if (execution.shouldNotify) {
            await this.broadcast('flow_toast', {
              event: 'progress',
              message: `${execution.triggerLabel}: ${node.data.label || node.type}`,
              flowName: flow.name,
              currentStep: execution.currentStep,
              totalSteps: execution.totalSteps
            });
          }
        }
        await this.broadcastExecutionsUpdate();
      }
    }

    try {
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

        case 'delay': {
          const epochBeforeDelay = this.abortEpoch;
          await this.executeDelay(node.data);
          // Check abort after delay completes - use epoch to detect abort even if flag reset
          if (this.abortEpoch !== epochBeforeDelay) {
            console.log('[EventEngine] Execution aborted after delay');
            return 'aborted';
          }
          return true;
        }

        case 'player_choice':
          return await this.executePlayerChoice(node, flow);

        case 'simple_ab':
          return await this.executeSimpleAB(node, flow);

        case 'input':
          return await this.executeInput(node, flow);

        case 'random_number':
          return await this.executeRandomNumber(node, flow);

        case 'capacity_ai_message':
        case 'capacity_player_message':
          return await this.executeCapacityMessage(node, flow);

        // Challenge nodes - interactive game elements
        case 'prize_wheel':
        case 'dice_roll':
        case 'coin_flip':
        case 'rps':
        case 'timer_challenge':
        case 'number_guess':
        case 'slot_machine':
        case 'card_draw':
        case 'simon_challenge':
        case 'reflex_challenge':
          return await this.executeChallenge(node, flow);

        case 'pause_resume':
          return await this.executePauseResume(node, flow);

        default:
          return true;
      }
    } catch (error) {
      await this.broadcastError(
        `Flow "${flow.name}" failed at "${node.data.label || node.type}"`,
        error.message,
        { flowId: flow.id, nodeId: node.id, nodeType: node.type }
      );
      return false; // Continue flow execution but mark this node as failed
    }
  }

  /**
   * Execute a player_choice node - show modal and wait for user response
   */
  async executePlayerChoice(node, flow) {
    // Check abort flag before showing player choice
    if (this.aborted) {
      console.log('[EventEngine] Player choice aborted before display');
      return false;
    }

    const data = node.data;
    const choices = data.choices || [];

    // Build [Choices] substitution - numbered list of choice labels
    const choicesList = choices.map((c, i) => `${i + 1}. ${c.label}`).join('\n');

    // If aiMessageIntroEnabled, send the AI message first (optionally LLM enhanced)
    if (data.aiMessageIntroEnabled && data.aiMessageIntro) {
      let introMessage = this.substituteVariables(data.aiMessageIntro);
      // Replace [Choices] with the actual list
      introMessage = introMessage.replace(/\[Choices\]/gi, choicesList);

      console.log(`[EventEngine] Player choice sending AI Message Intro (suppressLlm: ${data.aiMessageIntroSuppressLlm || false})`);
      await this.broadcast('ai_message', {
        content: introMessage,
        sender: 'flow',
        suppressLlm: data.aiMessageIntroSuppressLlm || false,
        choiceContext: {
          type: 'player_choice',
          event: 'intro'
        }
      });
    }

    // If there's a prompt and sendMessageFirst is not disabled, generate an AI message using it as instruction
    const sendMessageFirst = data.sendMessageFirst !== false; // Default to true
    if (data.prompt && sendMessageFirst) {
      console.log(`[EventEngine] Player choice has prompt, generating AI message with instruction`);
      await this.broadcast('ai_message', {
        content: data.prompt,  // This will be used as instruction for LLM
        sender: 'flow'
      });
    } else if (!sendMessageFirst) {
      console.log(`[EventEngine] Player choice skipping LLM message (sendMessageFirst disabled)`);
    }

    // Store pending choice info so we can resume the correct branch
    this.pendingPlayerChoice = {
      nodeId: node.id,
      flowId: flow.id,
      choices: choices
    };

    // Broadcast player choice modal to frontend
    console.log(`[EventEngine] Broadcasting player_choice modal with ${choices.length} choices`);
    await this.broadcast('player_choice', {
      nodeId: node.id,
      description: this.substituteVariables(data.description || ''),
      choices: choices
    });

    console.log('[EventEngine] Player choice presented, chain paused waiting for user response');
    return 'wait';  // Pause chain execution until user responds
  }

  /**
   * Execute a simple_ab node - show A/B popup and wait for user response
   */
  async executeSimpleAB(node, flow) {
    // Check abort flag before showing simple A/B
    if (this.aborted) {
      console.log('[EventEngine] Simple A/B aborted before display');
      return false;
    }

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
   * Execute an input node - show input modal and wait for user response
   */
  async executeInput(node, flow) {
    // Check abort flag before showing input
    if (this.aborted) {
      console.log('[EventEngine] Input aborted before display');
      return false;
    }

    const data = node.data;

    // Store pending input info so we can resume after user responds
    this.pendingInput = {
      nodeId: node.id,
      flowId: flow.id,
      variableName: data.variableName || 'Input',
      inputType: data.inputType || 'text'
    };

    // Broadcast input modal to frontend
    console.log(`[EventEngine] Broadcasting input modal (type: ${data.inputType || 'text'}, variable: ${data.variableName || 'Input'})`);
    await this.broadcast('input_request', {
      nodeId: node.id,
      prompt: this.substituteVariables(data.prompt || ''),
      placeholder: data.placeholder || '',
      inputType: data.inputType || 'text',
      minValue: data.minValue,
      maxValue: data.maxValue,
      required: data.required !== false,
      variableName: data.variableName || 'Input'
    });

    console.log('[EventEngine] Input request presented, chain paused waiting for user response');
    return 'wait';  // Pause chain execution until user responds
  }

  /**
   * Handle input response - store value and continue flow
   */
  async handleInputResponse(nodeId, value) {
    console.log(`[EventEngine] Input response: value "${value}" for node ${nodeId}`);

    if (!this.pendingInput) {
      console.log('[EventEngine] No pending input to continue');
      return;
    }

    const { nodeId: pendingNodeId, flowId, variableName, inputType } = this.pendingInput;

    // Verify nodeId matches
    if (pendingNodeId !== nodeId) {
      console.log(`[EventEngine] Node ID mismatch: expected ${pendingNodeId}, got ${nodeId}`);
      return;
    }

    // Store the input value as a flow variable
    const finalValue = inputType === 'number' ? parseFloat(value) : String(value);
    this.variables[variableName] = finalValue;

    // Sync to sessionState for frontend access
    if (this.sessionState) {
      this.sessionState.flowVariables = this.sessionState.flowVariables || {};
      this.sessionState.flowVariables[variableName] = finalValue;
    }

    console.log(`[EventEngine] Set input variable [Flow:${variableName}] = ${finalValue}`);

    // Find the flow
    const flowData = this.activeFlows.get(flowId);
    if (!flowData) {
      console.log(`[EventEngine] Flow ${flowId} not found for input continuation`);
      this.pendingInput = null;
      return;
    }

    const flow = flowData.flow;

    // Find outgoing edges from this node
    const edges = flow.edges.filter(e => e.source === nodeId);

    if (edges.length === 0) {
      console.log(`[EventEngine] No outgoing edges from input node ${nodeId}`);
      this.pendingInput = null;
      return;
    }

    console.log(`[EventEngine] Continuing flow from input node to ${edges[0].target}`);

    // Inherit flags from activeExecutions
    const execution = this.activeExecutions.get(flowId);
    const inheritedPriority = execution?.triggerPriority || null;
    const inheritedNotify = execution?.shouldNotify || false;

    // Clear pending input
    this.pendingInput = null;

    // Continue flow execution from the next node
    for (const edge of edges) {
      await this.executeFromNode(flow, edge.target, null, true, inheritedPriority, inheritedNotify);
    }
  }

  /**
   * Execute a random_number node - generate random number and store in flow variable
   */
  async executeRandomNumber(node, flow) {
    const data = node.data;
    const minValue = data.minValue ?? 1;
    const maxValue = data.maxValue ?? 100;
    const variableName = data.variableName || 'RandomNum';

    // Generate random integer between min and max (inclusive)
    const randomValue = Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;

    // Store as flow variable
    this.variables[variableName] = randomValue;

    // Sync to sessionState for frontend access
    if (this.sessionState) {
      this.sessionState.flowVariables = this.sessionState.flowVariables || {};
      this.sessionState.flowVariables[variableName] = randomValue;
    }

    console.log(`[EventEngine] Random number: [Flow:${variableName}] = ${randomValue} (range: ${minValue}-${maxValue})`);

    return true; // Continue to next node
  }

  /**
   * Execute a capacity message node in test mode
   */
  executeTestCapacityMessage(node, flow, nodeStep) {
    const data = node.data;
    const isPlayerMessage = data.messageType === 'player';
    const currentCapacity = this.sessionState?.capacity ?? 0;

    // Find matching range based on current capacity
    const matchedRange = this.findCapacityRange(currentCapacity, data.ranges);
    const rangeLabel = matchedRange ? matchedRange.label : 'none';
    const message = matchedRange?.message || '(no message)';

    nodeStep.details = `${isPlayerMessage ? 'Player' : 'AI'} Capacity Message (${currentCapacity}% → ${rangeLabel}): "${message.substring(0, 40)}${message.length > 40 ? '...' : ''}"`;
    this.emitTestStep(nodeStep);

    // Add broadcast result
    this.emitTestStep({
      type: 'broadcast',
      label: `${isPlayerMessage ? 'Player' : 'AI'} Message (suppressed)`,
      details: message,
      broadcastType: isPlayerMessage ? 'player_message' : 'ai_message'
    });

    // Return the matched range ID for output routing
    return matchedRange?.id || 'global';
  }

  /**
   * Execute a capacity message node - selects message based on current capacity
   */
  async executeCapacityMessage(node, flow) {
    if (this.aborted) {
      console.log('[EventEngine] Capacity message aborted');
      return 'aborted';
    }

    const data = node.data;
    const isPlayerMessage = data.messageType === 'player';
    const currentCapacity = this.sessionState?.capacity ?? 0;

    // Find matching range based on current capacity
    const matchedRange = this.findCapacityRange(currentCapacity, data.ranges);

    if (!matchedRange || !matchedRange.message) {
      console.log(`[EventEngine] Capacity message: no message for ${currentCapacity}% capacity (range: ${matchedRange?.label || 'none'})`);
      return 'global'; // Use global output if no specific message
    }

    console.log(`[EventEngine] Capacity message: ${currentCapacity}% → ${matchedRange.label}`);

    // Build broadcast data with forced perspective
    const broadcastData = {
      content: this.substituteVariables(matchedRange.message),
      sender: 'flow',
      suppressLlm: data.suppressLlm || false,
      flowId: flow.id,
      nodeId: node.id,
      // Force perspective: player messages MUST be from persona, AI messages MUST be from character
      forcePersonaPerspective: isPlayerMessage,
      forceCharacterPerspective: !isPlayerMessage,
      isCapacityMessage: true
    };

    const broadcastType = isPlayerMessage ? 'player_message' : 'ai_message';
    console.log(`[EventEngine] Broadcasting ${broadcastType}:`, broadcastData.content?.substring(0, 50), data.suppressLlm ? '(verbatim)' : '(LLM enhanced)');

    const epochBeforeBroadcast = this.abortEpoch;
    await this.broadcast(broadcastType, broadcastData);

    // Check if aborted during broadcast (LLM generation)
    if (this.abortEpoch !== epochBeforeBroadcast) {
      console.log('[EventEngine] Execution aborted during capacity message broadcast');
      return 'aborted';
    }

    // Post-delay after LLM generation completes
    const postDelay = data.postDelay ?? 3;
    if (postDelay > 0) {
      console.log(`[EventEngine] Post-delay: waiting ${postDelay}s after capacity message`);
      const epochBeforeDelay = this.abortEpoch;
      await new Promise(resolve => setTimeout(resolve, postDelay * 1000));
      if (this.abortEpoch !== epochBeforeDelay) {
        console.log('[EventEngine] Execution aborted during capacity message post-delay');
        return 'aborted';
      }
    }

    // Return the range ID for output routing - if the range has enableOutput, use that; otherwise 'global'
    return matchedRange.enableOutput ? matchedRange.id : 'global';
  }

  /**
   * Find the capacity range that matches the current capacity value
   */
  findCapacityRange(capacity, ranges) {
    if (!ranges) return null;

    // Capacity ranges - order matters for proper matching
    const rangeDefinitions = [
      { id: 'range_0_10', label: '0-10%', min: 0, max: 10 },
      { id: 'range_11_20', label: '11-20%', min: 11, max: 20 },
      { id: 'range_21_30', label: '21-30%', min: 21, max: 30 },
      { id: 'range_31_40', label: '31-40%', min: 31, max: 40 },
      { id: 'range_41_50', label: '41-50%', min: 41, max: 50 },
      { id: 'range_51_60', label: '51-60%', min: 51, max: 60 },
      { id: 'range_61_70', label: '61-70%', min: 61, max: 70 },
      { id: 'range_71_80', label: '71-80%', min: 71, max: 80 },
      { id: 'range_81_90', label: '81-90%', min: 81, max: 90 },
      { id: 'range_91_100', label: '91-100%', min: 91, max: 100 },
      { id: 'range_over_100', label: '>100%', min: 101, max: Infinity }
    ];

    // Find the range that contains the current capacity
    for (const rangeDef of rangeDefinitions) {
      if (capacity >= rangeDef.min && capacity <= rangeDef.max) {
        const rangeData = ranges[rangeDef.id];
        if (rangeData) {
          return {
            id: rangeDef.id,
            label: rangeDef.label,
            message: rangeData.message,
            enableOutput: rangeData.enableOutput
          };
        }
        break;
      }
    }

    return null;
  }

  /**
   * Execute a challenge node - show interactive challenge modal and wait for result
   */
  async executeChallenge(node, flow) {
    // Check abort flag before showing challenge
    if (this.aborted) {
      console.log('[EventEngine] Challenge aborted before display');
      return false;
    }

    const data = node.data;

    // Store pending challenge info so we can resume with the correct branch
    this.pendingChallenge = {
      nodeId: node.id,
      flowId: flow.id,
      challengeType: node.type,
      challengeData: data
    };

    // Pre-message wrapper (replaces old aiMessageStart)
    // IMPORTANT: This is BEFORE the challenge - do NOT reveal results
    if (data.preMessageEnabled && data.preMessage) {
      console.log(`[EventEngine] Challenge has pre-message, sending (NO RESULTS YET)`);
      const result = await this.sendWrapperMessage(
        data.preMessage,
        data.preMessageSuppressLlm,
        data.preMessageTarget,
        flow,
        node.id,
        {
          isChallengePreMessage: true,
          challengeType: node.type,
          // List possible outcomes so LLM knows what NOT to reveal
          possibleOutcomes: data.segments?.map(s => s.label) || data.outcomes?.map(o => o.label) || [],
          // Limit tokens on pre-messages to keep them short and prevent off-rails
          maxTokensOverride: 80
        }
      );
      if (result === 'aborted') return 'aborted';
    }

    // Pre-delay
    if (data.preDelay > 0) {
      console.log(`[EventEngine] Challenge pre-delay: waiting ${data.preDelay}s`);
      const epochBefore = this.abortEpoch;
      await new Promise(resolve => setTimeout(resolve, data.preDelay * 1000));
      if (this.abortEpoch !== epochBefore) {
        console.log('[EventEngine] Execution aborted during challenge pre-delay');
        return 'aborted';
      }
    }

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
  async handleChallengeResult(nodeId, resultData) {
    // Support both legacy string format and new object format
    const outputId = typeof resultData === 'object' ? resultData.outputId : resultData;
    const resultDetails = typeof resultData === 'object' ? resultData : {};

    console.log(`[EventEngine] Challenge result: output "${outputId}" for node ${nodeId}`, resultDetails);

    if (!this.pendingChallenge) {
      console.log('[EventEngine] No pending challenge to continue');
      return;
    }

    const { nodeId: pendingNodeId, flowId, challengeType, challengeData } = this.pendingChallenge;

    // Store challenge result in session state so AI knows the outcome
    if (this.sessionState) {
      // Map output IDs to human-readable results
      const resultDescriptions = {
        // Generic outcomes
        'win': 'won the challenge',
        'lose': 'lost the challenge',
        'draw': 'tied',
        'success': 'succeeded',
        'timeout': 'ran out of time',
        'correct': 'guessed correctly',
        'close': 'was close but not exact',
        'wrong': 'guessed wrong',
        // Coin flip
        'heads': 'got heads',
        'tails': 'got tails',
        'player': 'won (player)',
        'character': 'lost (character won)',
        // Generic for slots, cards, etc
        'no_match': 'no match',
        'jackpot': 'hit the jackpot'
      };

      const friendlyResult = resultDescriptions[outputId] || outputId;
      const challengeNames = {
        'prize_wheel': 'Prize Wheel',
        'dice_roll': 'Dice Roll',
        'coin_flip': 'Coin Flip',
        'rps': 'Rock Paper Scissors',
        'timer_challenge': 'Timer Challenge',
        'number_guess': 'Number Guess',
        'slot_machine': 'Slot Machine',
        'card_draw': 'Card Draw',
        'simon_challenge': 'Simon Says',
        'reflex_challenge': 'Reflex Challenge'
      };

      this.sessionState.lastChallengeResult = {
        type: challengeType,
        typeName: challengeNames[challengeType] || challengeType,
        outcome: outputId,
        description: friendlyResult,
        timestamp: Date.now()
      };

      console.log(`[EventEngine] Stored challenge result: ${challengeNames[challengeType] || challengeType} - ${friendlyResult}`);
    }

    // Store challenge-specific variables for use in subsequent nodes
    if (challengeType === 'prize_wheel') {
      // Use frontend-provided data or fall back to looking up from node data
      const allSegments = resultDetails.allSegments?.join(', ')
        || challengeData.segments?.map(s => s.label).join(', ') || '';
      const segmentLabel = resultDetails.segmentLabel
        || challengeData.segments?.find(s => s.id === outputId)?.label || outputId;
      this.setVariable('Segments', allSegments);  // "Prize 1, Prize 2, Prize 3"
      this.setVariable('Segment', segmentLabel);  // "Prize 2"
      console.log(`[EventEngine] Set [Segments]="${allSegments}", [Segment]="${segmentLabel}"`);
    }

    if (challengeType === 'dice_roll') {
      // Store roll total from frontend result details
      const rollTotal = resultDetails.rollTotal ?? '';
      this.setVariable('Roll', String(rollTotal));
      console.log(`[EventEngine] Set [Roll]="${rollTotal}"`);
    }

    if (challengeType === 'slot_machine') {
      // Store slot symbols from frontend result details
      const slotsStr = resultDetails.slots?.join(' ') || '';
      this.setVariable('Slots', slotsStr);
      console.log(`[EventEngine] Set [Slots]="${slotsStr}"`);
    }

    // Determine if this is a character win or character lose outcome
    // Character wins (player loses): character-wins, timeout, wrong, no-match, no_match
    // Player wins (character loses): player-wins, success, correct, jackpot
    const characterWinOutcomes = ['character-wins', 'timeout', 'wrong', 'no-match', 'no_match'];
    const playerWinOutcomes = ['player-wins', 'success', 'correct', 'jackpot'];

    const isCharacterWin = characterWinOutcomes.includes(outputId);
    const isPlayerWin = playerWinOutcomes.includes(outputId);

    // Generate AI message for win/lose if enabled (with optional LLM suppression)
    if (isCharacterWin && challengeData.aiMessageWinEnabled && challengeData.aiMessageWin) {
      console.log(`[EventEngine] Challenge character wins, generating AI message`);
      await this.broadcast('ai_message', {
        content: this.substituteVariables(challengeData.aiMessageWin),
        sender: 'flow',
        suppressLlm: challengeData.aiMessageWinSuppressLlm || false,
        challengeContext: {
          type: challengeType,
          event: 'win',
          outcome: outputId
        }
      });
    } else if (isPlayerWin && challengeData.aiMessageLoseEnabled && challengeData.aiMessageLose) {
      console.log(`[EventEngine] Challenge character loses, generating AI message`);
      await this.broadcast('ai_message', {
        content: this.substituteVariables(challengeData.aiMessageLose),
        sender: 'flow',
        suppressLlm: challengeData.aiMessageLoseSuppressLlm || false,
        challengeContext: {
          type: challengeType,
          event: 'lose',
          outcome: outputId
        }
      });
    }

    // Generate AI message for result if enabled (e.g., announcing wheel prize)
    if (challengeData.aiMessageResultEnabled && challengeData.aiMessageResult) {
      // Get the result label based on challenge type
      let resultLabel = outputId;
      if (challengeType === 'prize_wheel' && challengeData.segments) {
        const segment = challengeData.segments.find(s => s.id === outputId);
        resultLabel = segment?.label || outputId;
      } else if (challengeType === 'dice_roll' && challengeData.ranges) {
        const range = challengeData.ranges.find(r => r.id === outputId);
        resultLabel = range?.label || outputId;
      }

      // Substitute [Result] with the actual result
      let resultMessage = this.substituteVariables(challengeData.aiMessageResult);
      resultMessage = resultMessage.replace(/\[Result\]/gi, resultLabel);

      console.log(`[EventEngine] Challenge result message: "${resultLabel}"`);
      await this.broadcast('ai_message', {
        content: resultMessage,
        sender: 'flow',
        suppressLlm: challengeData.aiMessageResultSuppressLlm || false,
        challengeContext: {
          type: challengeType,
          event: 'result',
          outcome: outputId,
          resultLabel: resultLabel
        }
      });
    }

    // Post-message wrapper (after challenge completes and win/lose messages)
    // IMPORTANT: This is AFTER the challenge - result IS known and should be used
    if (challengeData.postMessageEnabled && challengeData.postMessage) {
      console.log(`[EventEngine] Challenge has post-message, sending WITH RESULT`);
      // We need flow object - get it now
      const flowDataForPost = this.activeFlows.get(flowId);
      if (flowDataForPost) {
        // Build the actual result label based on challenge type
        let resultLabel = outputId;
        if (challengeType === 'prize_wheel' && challengeData.segments) {
          resultLabel = challengeData.segments.find(s => s.id === outputId)?.label || outputId;
        } else if (challengeType === 'dice_roll') {
          resultLabel = `rolled ${resultDetails.rollTotal || 'unknown'}`;
        } else if (challengeType === 'coin_flip') {
          resultLabel = outputId === 'heads' ? 'Heads' : 'Tails';
        }

        await this.sendWrapperMessage(
          challengeData.postMessage,
          challengeData.postMessageSuppressLlm,
          challengeData.postMessageTarget,
          flowDataForPost.flow,
          pendingNodeId,
          {
            isChallengePostMessage: true,
            challengeType: challengeType,
            challengeResult: resultLabel,
            challengeOutcome: outputId,
            // Include all set variables so LLM can use them
            challengeVariables: {
              Segment: this.variables['Segment'] || '',
              Segments: this.variables['Segments'] || '',
              Roll: this.variables['Roll'] || '',
              Slots: this.variables['Slots'] || ''
            }
          }
        );
      }
    }

    // Post-delay
    if (challengeData.postDelay > 0) {
      console.log(`[EventEngine] Challenge post-delay: waiting ${challengeData.postDelay}s`);
      await new Promise(resolve => setTimeout(resolve, challengeData.postDelay * 1000));
    }

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

    // Inherit flags from activeExecutions
    const execution = this.activeExecutions.get(flowId);
    const inheritedPriority = execution?.triggerPriority || null;
    const inheritedNotify = execution?.shouldNotify || false;

    // Clear pending challenge before continuing
    this.pendingChallenge = null;

    // Continue execution from the matched edge's target
    await this.executeFromNode(flow, matchingEdge.target, null, true, inheritedPriority, inheritedNotify);
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
   * Execute a pause_resume node - pause flow and resume after N messages
   */
  async executePauseResume(node, flow) {
    const data = node.data;
    const resumeAfterType = data.resumeAfterType || 'messages';
    const resumeAfterValue = parseInt(data.resumeAfterValue) || 4;

    console.log(`[EventEngine] Pause/Resume node: will resume after ${resumeAfterValue} ${resumeAfterType}`);

    // Execute PAUSE output immediately (for pre-pause actions like turning off devices)
    const pauseEdges = flow.edges.filter(e => e.source === node.id && e.sourceHandle === 'source-pause');
    console.log(`[EventEngine] Found ${pauseEdges.length} PAUSE edge(s) to execute`);

    for (const edge of pauseEdges) {
      const nextNode = flow.nodes.find(n => n.id === edge.target);
      if (nextNode) {
        console.log(`[EventEngine] Executing PAUSE branch to node ${nextNode.id} (${nextNode.type})`);
        await this.executeNode(nextNode, flow);
      }
    }

    // Set up pending pause/resume state for message counting
    const pauseId = `${flow.id}-${node.id}-${Date.now()}`;
    this.pendingPauseResume.set(pauseId, {
      flowId: flow.id,
      nodeId: node.id,
      resumeAfterType,
      messagesRemaining: resumeAfterValue
    });

    console.log(`[EventEngine] Pause registered: ${pauseId}, waiting for ${resumeAfterValue} messages`);

    // Return 'wait' to stop chain execution - RESUME will fire after message count
    return 'wait';
  }

  /**
   * Check pending pause/resume nodes and resume flows that have waited enough messages
   */
  async checkPendingPauses() {
    if (this.pendingPauseResume.size === 0) return;

    const toResume = [];

    for (const [pauseId, pauseState] of this.pendingPauseResume.entries()) {
      if (pauseState.resumeAfterType === 'messages') {
        pauseState.messagesRemaining--;
        console.log(`[EventEngine] Pause ${pauseId}: ${pauseState.messagesRemaining} messages remaining`);

        if (pauseState.messagesRemaining <= 0) {
          toResume.push({ pauseId, pauseState });
        }
      }
    }

    // Resume flows outside the iteration to avoid modifying map while iterating
    for (const { pauseId, pauseState } of toResume) {
      this.pendingPauseResume.delete(pauseId);
      await this.resumePausedFlow(pauseId, pauseState);
    }
  }

  /**
   * Resume a paused flow from the RESUME output
   */
  async resumePausedFlow(pauseId, pauseState) {
    const { flowId, nodeId } = pauseState;

    console.log(`[EventEngine] Resuming flow from pause: ${pauseId}`);

    const flowData = this.activeFlows.get(flowId);
    if (!flowData) {
      console.log(`[EventEngine] Flow ${flowId} not found for pause/resume continuation`);
      return;
    }

    const flow = flowData.flow;

    // Find RESUME edges (sourceHandle === 'source-resume')
    const resumeEdges = flow.edges.filter(e => e.source === nodeId && e.sourceHandle === 'source-resume');
    console.log(`[EventEngine] Found ${resumeEdges.length} RESUME edge(s) to execute`);

    // Inherit flags from activeExecutions
    const execution = this.activeExecutions.get(flowId);
    const inheritedPriority = execution?.triggerPriority || null;
    const inheritedNotify = execution?.shouldNotify || false;

    for (const edge of resumeEdges) {
      const nextNode = flow.nodes.find(n => n.id === edge.target);
      if (nextNode) {
        console.log(`[EventEngine] Executing RESUME branch to node ${nextNode.id} (${nextNode.type})`);
        await this.executeFromNode(flow, edge.target, null, true, inheritedPriority, inheritedNotify);
      }
    }
  }

  /**
   * Clear all pending pause/resume states (e.g., on emergency stop or session reset)
   */
  clearPendingPauses() {
    if (this.pendingPauseResume.size === 0) return;

    for (const [pauseId] of this.pendingPauseResume.entries()) {
      console.log(`[EventEngine] Cleared pending pause: ${pauseId}`);
    }
    this.pendingPauseResume.clear();
  }

  /**
   * Execute a mid-game penalty/reward device action
   * Does NOT affect flow execution or pending challenge state
   * @param {string} deviceId - Device alias, name, or IP
   * @param {number} duration - Duration in seconds (0 = stay on indefinitely)
   * @param {string} actionType - 'penalty' or 'reward' (for logging)
   */
  /**
   * Send wrapper message (pre or post action/challenge message)
   * @param {string} message - The message text
   * @param {boolean} suppressLlm - Whether to suppress LLM enhancement
   * @param {string} target - 'character' or 'persona'
   * @param {Object} flow - The flow object
   * @param {string} nodeId - The node ID
   * @param {Object} context - Optional context (e.g., { isChallengePreMessage: true, challengeType: 'prize_wheel' })
   */
  async sendWrapperMessage(message, suppressLlm, target, flow, nodeId, context = {}) {
    if (!message) return;

    const broadcastData = {
      content: this.substituteVariables(message),
      sender: 'flow',
      suppressLlm: suppressLlm || false,
      flowId: flow.id,
      nodeId: nodeId,
      messageTarget: target || 'character',  // Used by frontend to route appropriately
      ...context  // Pass through challenge context for LLM instructions
    };

    // Route based on target
    const eventType = target === 'persona' ? 'player_message' : 'ai_message';
    console.log(`[EventEngine] Sending wrapper message (${target}):`, broadcastData.content?.substring(0, 50), suppressLlm ? '(verbatim)' : '(LLM enhanced)');

    const epochBefore = this.abortEpoch;
    await this.broadcast(eventType, broadcastData);

    // Check if aborted during broadcast
    if (this.abortEpoch !== epochBefore) {
      console.log('[EventEngine] Execution aborted during wrapper message broadcast');
      return 'aborted';
    }

    return true;
  }

  async executePenaltyAction(deviceId, duration, actionType = 'penalty') {
    if (!deviceId) {
      console.log(`[EventEngine] No device specified for ${actionType}`);
      return false;
    }

    const deviceObj = resolveDeviceObject(deviceId);
    const resolvedDevice = deviceObj
      ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
      : null;

    if (!deviceObj || !resolvedDevice) {
      console.log(`[EventEngine] ${actionType} device "${deviceId}" not found`);
      return false;
    }

    console.log(`[EventEngine] Executing ${actionType}: ${deviceObj.name || deviceId} for ${duration}s`);

    try {
      await this.deviceService.turnOn(resolvedDevice, deviceObj);

      // Schedule auto-off after duration
      if (duration > 0) {
        setTimeout(async () => {
          try {
            await this.deviceService.turnOff(resolvedDevice, deviceObj);
            console.log(`[EventEngine] ${actionType} device ${deviceObj.name || deviceId} turned off after ${duration}s`);
          } catch (e) {
            console.error(`[EventEngine] Failed to turn off ${actionType} device:`, e.message);
          }
        }, duration * 1000);
      }

      return true;
    } catch (e) {
      console.error(`[EventEngine] Failed to execute ${actionType}:`, e.message);
      return false;
    }
  }

  /**
   * Execute an action node
   */
  async executeAction(data, flow, nodeId) {
    // Check abort flag before executing action
    if (this.aborted) {
      console.log('[EventEngine] Action aborted');
      return false;
    }

    // Pre-message wrapper
    if (data.preMessageEnabled && data.preMessage) {
      console.log(`[EventEngine] Action has pre-message, sending`);
      const preResult = await this.sendWrapperMessage(
        data.preMessage,
        data.preMessageSuppressLlm,
        data.preMessageTarget,
        flow,
        nodeId
      );
      if (preResult === 'aborted') return 'aborted';
    }

    // Pre-delay
    if (data.preDelay > 0) {
      console.log(`[EventEngine] Action pre-delay: waiting ${data.preDelay}s`);
      const epochBefore = this.abortEpoch;
      await new Promise(resolve => setTimeout(resolve, data.preDelay * 1000));
      if (this.abortEpoch !== epochBefore) {
        console.log('[EventEngine] Execution aborted during action pre-delay');
        return 'aborted';
      }
    }

    const crypto = require('crypto');
    let actionResult = true;  // Track result for post-message handling

    switch (data.actionType) {
      case 'send_message': {
        // Check abort again before sending message (LLM generation point)
        if (this.aborted) { actionResult = false; break; }
        // AI message - optionally suppress LLM enhancement
        const broadcastData = {
          content: this.substituteVariables(data.message),
          sender: 'flow',
          suppressLlm: data.suppressLlm || false,
          flowId: flow.id,
          nodeId: nodeId
        };

        console.log(`[EventEngine] Broadcasting ai_message:`, broadcastData.content?.substring(0, 50), data.suppressLlm ? '(verbatim)' : '(LLM enhanced)');
        const epochBeforeBroadcast = this.abortEpoch;
        await this.broadcast('ai_message', broadcastData);

        // Check if aborted during broadcast (LLM generation)
        if (this.abortEpoch !== epochBeforeBroadcast) {
          console.log('[EventEngine] Execution aborted during AI message broadcast');
          actionResult = 'aborted';
          break;
        }
        // Post-delay now handled by wrapper postDelay
        actionResult = true;
        break;
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
        const epochBeforeBroadcast = this.abortEpoch;
        await this.broadcast('player_message', broadcastData);

        // Check if aborted during broadcast (LLM generation)
        if (this.abortEpoch !== epochBeforeBroadcast) {
          console.log('[EventEngine] Execution aborted during player message broadcast');
          actionResult = 'aborted';
          break;
        }
        // Post-delay now handled by wrapper postDelay
        actionResult = true;
        break;
      }

      case 'system_message': {
        const broadcastData = { content: this.substituteVariables(data.message) };

        console.log(`[EventEngine] Broadcasting system_message:`, broadcastData.content?.substring(0, 50));
        await this.broadcast('system_message', broadcastData);
        actionResult = true;
        break;
      }

      case 'device_on': {
        if (!data.device) { actionResult = false; break; }

        // Resolve untilValue if it contains a variable reference (e.g., [Flow:Duration])
        if (data.untilValue !== undefined && data.untilValue !== null) {
          const resolvedUntil = this.substituteVariables(String(data.untilValue));
          data.untilValue = parseFloat(resolvedUntil) || data.untilValue;
        }

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          const deviceKey = resolvedDevice || data.device;
          console.log(`[SIMULATION] Device ${deviceKey} would turn ON`);

          // Update state tracking for flow continuity
          if (this.sessionState?.executionHistory) {
            if (!this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey] = {};
            }
            this.sessionState.executionHistory.deviceActions[deviceKey].state = 'on';
          }

          // Determine if this is infinite (no until condition)
          const isInfinite = !data.untilType || data.untilType === 'forever';

          // Track pending completion even in simulation mode
          this.pendingDeviceOnCompletions = this.pendingDeviceOnCompletions || new Map();
          this.pendingDeviceOnCompletions.set(deviceKey, {
            flowId: flow.id,
            nodeId: nodeId,
            isInfinite,
            deviceObj: deviceObj || { ip: deviceKey }
          });
          console.log(`[SIMULATION] Tracking device_on completion for device ${deviceKey}, infinite: ${isInfinite}`);

          // Set up "until" monitoring if specified (works for simulation too)
          if (data.untilType && data.untilType !== 'forever') {
            this.deviceMonitors.set(deviceKey, {
              type: data.untilType,
              operator: data.untilOperator || '>',
              value: data.untilValue,
              deviceObj: deviceObj || { ip: deviceKey },
              flowId: flow.id,
              monitorType: 'device_on'
            });
            console.log(`[SIMULATION] Monitoring device ${deviceKey} until ${data.untilType} ${data.untilOperator || '>'} ${data.untilValue}`);

            // For timer-based until, schedule simulated completion
            if (data.untilType === 'timer' && data.untilValue > 0) {
              const timerMs = data.untilValue * 1000;
              console.log(`[SIMULATION] Scheduling device_on completion in ${timerMs}ms (timer until)`);
              setTimeout(() => {
                console.log(`[SIMULATION] Timer complete for device ${deviceKey}`);
                if (this.sessionState?.executionHistory?.deviceActions[deviceKey]) {
                  this.sessionState.executionHistory.deviceActions[deviceKey].state = 'off';
                }
                this.deviceMonitors.delete(deviceKey);
                this.handleDeviceOnComplete(deviceKey);
              }, timerMs);
            }
          }

          actionResult = 'device_on'; // Continue flow execution with dual outputs
          break;
        }

        if (!deviceObj || !resolvedDevice) {
          await this.broadcastError(`Device "${data.device}" not found`, 'Check device configuration in Settings');
          actionResult = false;
          break;
        }

        // Check device state to prevent conflicts
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (deviceState && deviceState.state === 'on') {
            console.log(`[EventEngine] Device ${resolvedDevice} is already on, skipping`);
            actionResult = false;
            break;
          }
        }

        // Safety check: Block pump activation at 100% capacity (unless allowOverInflation is enabled)
        const isPump = deviceObj.deviceType === 'PUMP' || deviceObj.isPrimaryPump;
        if (isPump) {
          const settings = loadData(DATA_FILES.settings);
          const allowOverInflation = settings?.globalCharacterControls?.allowOverInflation;
          const currentCapacity = this.sessionState?.capacity ?? 0;

          if (!allowOverInflation && currentCapacity >= 100) {
            console.log(`[EventEngine] Pump blocked by safety - capacity at ${currentCapacity}%`);
            await this.broadcast('pump_safety_block', {
              reason: 'capacity_limit',
              capacity: currentCapacity,
              device: deviceObj.label || deviceObj.name || resolvedDevice,
              source: 'flow'
            });
            // Skip device activation but continue flow execution
            actionResult = false;
            break;
          }
        }

        try {
          await this.deviceService.turnOn(resolvedDevice, deviceObj);
        } catch (deviceError) {
          await this.broadcastError(`Failed to turn on "${deviceObj.name || data.device}"`, deviceError.message);
          actionResult = false;
          break;
        }

        // Track this device as flow-activated (for selective emergency stop)
        this.flowActivatedDevices.set(resolvedDevice, { flowId: flow.id, deviceObj });

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

          // For timer-based until, schedule automatic turn off
          if (data.untilType === 'timer' && data.untilValue > 0) {
            const timerMs = data.untilValue * 1000;
            console.log(`[EventEngine] Scheduling device auto-off in ${timerMs}ms (timer until)`);
            setTimeout(async () => {
              // Check if monitor still exists (might have been manually stopped)
              if (this.deviceMonitors.has(resolvedDevice)) {
                console.log(`[EventEngine] Timer complete for device ${resolvedDevice}, turning off`);
                try {
                  await this.deviceService.turnOff(resolvedDevice, deviceObj);
                } catch (err) {
                  console.error(`[EventEngine] Failed to turn off device ${resolvedDevice}:`, err.message);
                }
                this.deviceMonitors.delete(resolvedDevice);

                // Update device state tracking
                if (this.sessionState?.executionHistory?.deviceActions?.[resolvedDevice]) {
                  this.sessionState.executionHistory.deviceActions[resolvedDevice].state = 'off';
                }

                // Trigger completion chain
                this.handleDeviceOnComplete(resolvedDevice);
              }
            }, timerMs);
          }
        }

        actionResult = 'device_on'; // Special return to handle dual outputs (immediate/completion)
        break;
      }

      case 'device_off': {
        if (!data.device) { actionResult = false; break; }

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          const deviceKey = resolvedDevice || data.device;
          console.log(`[SIMULATION] Device ${deviceKey} would turn OFF`);

          if (this.sessionState?.executionHistory) {
            if (!this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey] = {};
            }
            this.sessionState.executionHistory.deviceActions[deviceKey].state = 'off';
          }

          // Clear any monitor for this device
          this.deviceMonitors.delete(deviceKey);

          // Trigger device_on completion to execute completion edges (if any pending)
          if (this.pendingDeviceOnCompletions?.has(deviceKey)) {
            this.handleDeviceOnComplete(deviceKey);
          }

          actionResult = true; // Continue flow execution
          break;
        }

        if (!deviceObj || !resolvedDevice) {
          await this.broadcastError(`Device "${data.device}" not found`, 'Check device configuration in Settings');
          actionResult = false;
          break;
        }

        // Check device state to prevent conflicts
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (deviceState && deviceState.state === 'off') {
            console.log(`[EventEngine] Device ${resolvedDevice} is already off, skipping`);
            actionResult = false;
            break;
          }
        }

        try {
          await this.deviceService.turnOff(resolvedDevice, deviceObj);
        } catch (deviceError) {
          await this.broadcastError(`Failed to turn off "${deviceObj.name || data.device}"`, deviceError.message);
          actionResult = false;
          break;
        }

        // Remove from flow-activated devices tracking
        this.flowActivatedDevices.delete(resolvedDevice);

        // Update device state tracking
        if (this.sessionState && this.sessionState.executionHistory) {
          if (!this.sessionState.executionHistory.deviceActions[resolvedDevice]) {
            this.sessionState.executionHistory.deviceActions[resolvedDevice] = {};
          }
          this.sessionState.executionHistory.deviceActions[resolvedDevice].state = 'off';
        }

        // Clear any monitor for this device
        this.deviceMonitors.delete(resolvedDevice);

        // Trigger device_on completion to execute completion edges (if any pending)
        if (this.pendingDeviceOnCompletions?.has(resolvedDevice)) {
          this.handleDeviceOnComplete(resolvedDevice);
        }

        actionResult = true;
        break;
      }

      case 'start_cycle': {
        // Resolve numeric fields if they contain variable references
        if (data.duration !== undefined) {
          const resolved = this.substituteVariables(String(data.duration));
          data.duration = parseFloat(resolved) || data.duration;
        }
        if (data.interval !== undefined) {
          const resolved = this.substituteVariables(String(data.interval));
          data.interval = parseFloat(resolved) || data.interval;
        }
        if (data.cycles !== undefined) {
          const resolved = this.substituteVariables(String(data.cycles));
          data.cycles = parseInt(resolved) || data.cycles;
        }
        if (data.untilValue !== undefined && data.untilValue !== null) {
          const resolved = this.substituteVariables(String(data.untilValue));
          data.untilValue = parseFloat(resolved) || data.untilValue;
        }

        console.log(`[EventEngine] Start Cycle action - device: ${data.device}, duration: ${data.duration}, interval: ${data.interval}, cycles: ${data.cycles}`);
        if (!data.device) {
          console.log(`[EventEngine] Start Cycle - no device specified!`);
          actionResult = false;
          break;
        }

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          const deviceKey = resolvedDevice || data.device;
          console.log(`[SIMULATION] Device ${deviceKey} would START CYCLE (duration: ${data.duration || 5}s, interval: ${data.interval || 10}s, cycles: ${data.cycles || 0})`);

          if (this.sessionState?.executionHistory) {
            if (!this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey] = {};
            }
            this.sessionState.executionHistory.deviceActions[deviceKey].cycling = true;
            this.sessionState.executionHistory.deviceActions[deviceKey].state = 'on';
          }

          // Determine if this is an infinite cycle
          const isInfinite = (!data.cycles || data.cycles === 0) &&
                             (!data.untilType || data.untilType === 'forever');

          // Track pending completion even in simulation mode
          this.pendingCycleCompletions.set(deviceKey, {
            flowId: flow.id,
            nodeId: nodeId,
            isInfinite,
            deviceObj: deviceObj || { ip: deviceKey }
          });
          console.log(`[SIMULATION] Tracking cycle completion for device ${deviceKey}, infinite: ${isInfinite}`);

          // For finite cycles, schedule simulated completion
          if (!isInfinite && data.cycles > 0) {
            const cycleDuration = (data.duration || 5) * 1000;
            const cycleInterval = (data.interval || 10) * 1000;
            const totalTime = data.cycles * (cycleDuration + cycleInterval);
            console.log(`[SIMULATION] Scheduling cycle completion in ${totalTime}ms (${data.cycles} cycles)`);

            setTimeout(() => {
              console.log(`[SIMULATION] Cycle complete for ${deviceKey}`);
              if (this.sessionState?.executionHistory?.deviceActions[deviceKey]) {
                this.sessionState.executionHistory.deviceActions[deviceKey].cycling = false;
                this.sessionState.executionHistory.deviceActions[deviceKey].state = 'off';
              }
              this.handleCycleComplete(deviceKey);
            }, totalTime);
          }

          actionResult = 'start_cycle'; // Continue flow execution with dual outputs
          break;
        }

        if (!deviceObj || !resolvedDevice) {
          await this.broadcastError(`Device "${data.device}" not found`, 'Check device configuration in Settings');
          actionResult = false;
          break;
        }

        // Check if device is already cycling
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];

          if (deviceState && deviceState.cycling) {
            console.log(`[EventEngine] Device ${resolvedDevice} is already cycling, skipping`);
            actionResult = false;
            break;
          }
        }

        console.log(`[EventEngine] Calling deviceService.startCycle for ${resolvedDevice}`);
        try {
          await this.deviceService.startCycle(resolvedDevice, {
            duration: data.duration || 5,
            interval: data.interval || 10,
            cycles: data.cycles || 0
          }, deviceObj);
        } catch (deviceError) {
          await this.broadcastError(`Failed to start cycle on "${deviceObj.name || data.device}"`, deviceError.message);
          actionResult = false;
          break;
        }

        // Track this device as flow-activated (for selective emergency stop)
        this.flowActivatedDevices.set(resolvedDevice, { flowId: flow.id, deviceObj });

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

        actionResult = 'start_cycle'; // Special return to handle dual outputs (immediate/completion)
        break;
      }

      case 'stop_cycle': {
        if (!data.device) { actionResult = false; break; }

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          const deviceKey = resolvedDevice || data.device;
          console.log(`[SIMULATION] Device ${deviceKey} would STOP CYCLE`);

          if (this.sessionState?.executionHistory) {
            if (this.sessionState.executionHistory.deviceActions[deviceKey]) {
              this.sessionState.executionHistory.deviceActions[deviceKey].cycling = false;
            }
          }

          // Clear monitor for this device
          this.deviceMonitors.delete(deviceKey);

          // Trigger cycle completion to execute completion edges
          this.handleCycleComplete(deviceKey);

          actionResult = true; // Continue flow execution
          break;
        }

        if (!deviceObj || !resolvedDevice) {
          await this.broadcastError(`Device "${data.device}" not found`, 'Check device configuration in Settings');
          actionResult = false;
          break;
        }

        // Check if device is marked as cycling (for logging only)
        let wasCycling = false;
        if (this.sessionState && this.sessionState.executionHistory) {
          const deviceState = this.sessionState.executionHistory.deviceActions[resolvedDevice];
          wasCycling = deviceState?.cycling === true;
          if (!wasCycling) {
            console.log(`[EventEngine] Device ${resolvedDevice} is not marked as cycling - will still attempt stop for safety`);
          }
        }

        try {
          // First try stopCycle (stops cycle timers and turns off)
          const cycleResult = this.deviceService.stopCycle(resolvedDevice, deviceObj);

          // If no active cycle, ensure device is off by calling turnOff directly
          if (!cycleResult || !cycleResult.success) {
            console.log(`[EventEngine] No active cycle for ${resolvedDevice}, calling turnOff directly as safety measure`);
            await this.deviceService.turnOff(resolvedDevice, deviceObj);
          }
        } catch (deviceError) {
          await this.broadcastError(`Failed to stop cycle on "${deviceObj.name || data.device}"`, deviceError.message);
          actionResult = false;
          break;
        }

        // Clear monitor for this device
        this.deviceMonitors.delete(resolvedDevice);

        // Update device state tracking
        if (this.sessionState && this.sessionState.executionHistory) {
          if (this.sessionState.executionHistory.deviceActions[resolvedDevice]) {
            this.sessionState.executionHistory.deviceActions[resolvedDevice].cycling = false;
          }
        }

        actionResult = true;
        break;
      }

      case 'pulse_pump': {
        console.log(`[EventEngine] Pulse Pump action - device: ${data.device}, pulses: ${data.pulses}`);
        if (!data.device) {
          console.log(`[EventEngine] Pulse Pump - no device specified!`);
          actionResult = false;
          break;
        }

        // Support variable substitution for pulse count (e.g., [Flow:PulseCount])
        const pulseCount = this.evaluateExpression(data.pulses) || 3;

        // Resolve device alias to full device object (includes childId, brand, sku)
        const deviceObj = resolveDeviceObject(data.device);
        const resolvedDevice = deviceObj
          ? (deviceObj.brand === 'govee' || deviceObj.brand === 'tuya' ? deviceObj.deviceId : deviceObj.ip)
          : null;

        // In simulation mode, skip actual device calls but continue flow
        if (this.simulationMode) {
          const deviceKey = resolvedDevice || data.device;
          console.log(`[SIMULATION] Device ${deviceKey} would PULSE ${pulseCount} times (1s on/1s off each)`);

          // Simulate the time it would take
          const totalTime = pulseCount * 2000; // 1s on + 1s off per pulse
          await new Promise(resolve => setTimeout(resolve, totalTime));

          console.log(`[SIMULATION] Pulse pump complete for ${deviceKey}`);
          actionResult = true;
          break;
        }

        if (!deviceObj || !resolvedDevice) {
          await this.broadcastError(`Device "${data.device}" not found`, 'Check device configuration in Settings');
          actionResult = false;
          break;
        }

        console.log(`[EventEngine] Starting ${pulseCount} pulses for ${resolvedDevice}`);

        try {
          for (let i = 0; i < pulseCount; i++) {
            console.log(`[EventEngine] Pulse ${i + 1}/${pulseCount} - turning ON`);
            await this.deviceService.turnOn(resolvedDevice, deviceObj);

            // 1 second on
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log(`[EventEngine] Pulse ${i + 1}/${pulseCount} - turning OFF`);
            await this.deviceService.turnOff(resolvedDevice, deviceObj);

            // 1 second off (except after last pulse)
            if (i < pulseCount - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          console.log(`[EventEngine] Pulse pump complete for ${resolvedDevice}`);
        } catch (deviceError) {
          await this.broadcastError(`Failed to pulse pump "${deviceObj.name || data.device}"`, deviceError.message);
          // Try to ensure device is off on error
          try {
            await this.deviceService.turnOff(resolvedDevice, deviceObj);
          } catch (e) {
            console.error(`[EventEngine] Failed to turn off device after pulse error:`, e);
          }
          actionResult = false;
          break;
        }

        actionResult = true;
        break;
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
        actionResult = true;
        break;

      case 'set_variable': {
        // Set either a system variable or a custom flow variable
        const varType = data.varType || 'system';
        const variable = data.variable;
        const value = data.value;

        if (!variable) {
          console.log('[EventEngine] set_variable: No variable specified');
          actionResult = false;
          break;
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
            actionResult = false;
            break;
          }
        }
        actionResult = true;
        break;
      }

      case 'toggle_reminder': {
        if (!data.reminderId) {
          console.log('[EventEngine] toggle_reminder: No reminderId specified');
          actionResult = false;
          break;
        }

        // Use explicit reminderType if provided, otherwise fall back to ID prefix check
        const isGlobal = data.reminderType === 'global' || (!data.reminderType && data.reminderId.startsWith('global-reminder-'));
        console.log(`[EventEngine] toggle_reminder: ${data.action} reminder ${data.reminderId} (global: ${isGlobal}, type: ${data.reminderType || 'auto'})`);

        if (isGlobal) {
          // Update global reminder in settings
          const settings = loadData(DATA_FILES.settings);
          if (!settings || !settings.globalReminders) {
            console.log('[EventEngine] toggle_reminder: No global reminders found');
            actionResult = false;
            break;
          }

          const reminder = settings.globalReminders.find(r => r.id === data.reminderId);
          if (!reminder) {
            console.log(`[EventEngine] toggle_reminder: Global reminder ${data.reminderId} not found`);
            actionResult = false;
            break;
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
          // Use storage helpers if available for per-char storage support
          const characters = this.storageHelpers?.loadCharacters() || loadData(DATA_FILES.characters);
          const activeCharId = this.sessionState?.activeCharacterId;

          if (!characters || !activeCharId) {
            console.log('[EventEngine] toggle_reminder: No characters or active character');
            actionResult = false;
            break;
          }

          const character = characters.find(c => c.id === activeCharId);
          if (!character || !character.constantReminders) {
            console.log(`[EventEngine] toggle_reminder: Character ${activeCharId} not found or has no reminders`);
            actionResult = false;
            break;
          }

          const reminder = character.constantReminders.find(r => r.id === data.reminderId);
          if (!reminder) {
            console.log(`[EventEngine] toggle_reminder: Reminder ${data.reminderId} not found in character`);
            actionResult = false;
            break;
          }

          if (data.action === 'enable') {
            reminder.enabled = true;
          } else if (data.action === 'disable') {
            reminder.enabled = false;
          } else if (data.action === 'update_text' && data.newText) {
            reminder.text = this.substituteVariables(data.newText);
          }

          // Save using per-char storage if available
          if (this.storageHelpers?.saveCharacter) {
            this.storageHelpers.saveCharacter(character);
          } else {
            saveData(DATA_FILES.characters, characters);
          }
        }

        // Broadcast update so frontend can refresh
        this.broadcast('reminder_updated', {
          reminderId: data.reminderId,
          action: data.action,
          isGlobal
        });

        actionResult = true;
        break;
      }

      case 'toggle_button': {
        if (!data.buttonId) {
          console.log('[EventEngine] toggle_button: No buttonId specified');
          actionResult = false;
          break;
        }

        // Use storage helpers if available for per-char storage support
        const characters = this.storageHelpers?.loadCharacters() || loadData(DATA_FILES.characters);
        const settings = loadData(DATA_FILES.settings);
        const activeCharId = settings?.activeCharacterId;

        if (!characters || !activeCharId) {
          console.log('[EventEngine] toggle_button: No characters or active character');
          actionResult = false;
          break;
        }

        const character = characters.find(c => c.id === activeCharId);
        if (!character || !character.buttons) {
          console.log(`[EventEngine] toggle_button: Character ${activeCharId} not found or has no buttons`);
          actionResult = false;
          break;
        }

        const button = character.buttons.find(b => String(b.buttonId) === String(data.buttonId));
        if (!button) {
          console.log(`[EventEngine] toggle_button: Button ${data.buttonId} not found in character`);
          actionResult = false;
          break;
        }

        if (data.action === 'enable') {
          button.enabled = true;
          console.log(`[EventEngine] toggle_button: Enabled button "${button.name}" (#${button.buttonId})`);
        } else if (data.action === 'disable') {
          button.enabled = false;
          console.log(`[EventEngine] toggle_button: Disabled button "${button.name}" (#${button.buttonId})`);
        }

        // Save using per-char storage if available
        if (this.storageHelpers?.saveCharacter) {
          this.storageHelpers.saveCharacter(character);
        } else {
          saveData(DATA_FILES.characters, characters);
        }

        // Broadcast update so frontend can refresh (reload for accurate data)
        const updatedChars = this.storageHelpers?.loadCharacters() || characters;
        this.broadcast('characters_update', updatedChars);

        actionResult = true;
        break;
      }

      default:
        actionResult = true;
        break;
    }

    // Post-message wrapper (only for non-abort results)
    if (actionResult !== 'aborted' && data.postMessageEnabled && data.postMessage) {
      console.log(`[EventEngine] Action has post-message, sending`);
      const postResult = await this.sendWrapperMessage(
        data.postMessage,
        data.postMessageSuppressLlm,
        data.postMessageTarget,
        flow,
        nodeId
      );
      if (postResult === 'aborted') return 'aborted';
    }

    // Post-delay (only for non-abort results)
    if (actionResult !== 'aborted' && data.postDelay > 0) {
      console.log(`[EventEngine] Action post-delay: waiting ${data.postDelay}s`);
      const epochBefore = this.abortEpoch;
      await new Promise(resolve => setTimeout(resolve, data.postDelay * 1000));
      if (this.abortEpoch !== epochBefore) {
        console.log('[EventEngine] Execution aborted during action post-delay');
        return 'aborted';
      }
    }

    return actionResult;
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

    // Find the choice info first (we need it for playerResponse check and description)
    const choiceInfo = this.pendingPlayerChoice?.choices?.find(c => c.id === choiceId);
    const choiceDesc = choiceInfo?.description || '';
    const playerResponse = choiceInfo?.playerResponse || '';
    const playerResponseEnabled = choiceInfo?.playerResponseEnabled === true;
    const playerResponseSuppressLlm = choiceInfo?.playerResponseSuppressLlm === true;

    // Generate persona message for the choice (only for Player Choice, not Simple A/B)
    // Skip if playerResponseEnabled is false
    if (!isSimpleAB && playerResponseEnabled) try {
      const settings = loadData(DATA_FILES.settings);
      const personas = loadData(DATA_FILES.personas) || [];
      // Use storage helpers if available for per-char storage support
      const characters = this.storageHelpers?.loadCharacters() || loadData(DATA_FILES.characters) || [];
      const activePersona = personas.find(p => p.id === settings?.activePersonaId);
      const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
      const playerName = activePersona?.displayName || 'The player';

      // Check if there's a predefined player response with LLM suppression
      if (playerResponse && playerResponseSuppressLlm) {
        // Use predefined response directly with [Choice] variable substitution
        const finalResponse = this.substituteVariables(playerResponse.replace(/\[Choice\]/gi, choiceLabel));
        console.log(`[EventEngine] Using predefined player response (no LLM): "${finalResponse.substring(0, 50)}..."`);

        const playerMessage = {
          id: require('uuid').v4(),
          content: finalResponse,
          sender: 'player',
          timestamp: Date.now(),
          generated: true,
          fromChoice: true
        };

        // Add to session history
        if (this.sessionState?.chatHistory) {
          this.sessionState.chatHistory.push(playerMessage);
        }

        // Broadcast to clients
        await this.broadcast('chat_message', playerMessage);
      } else if (playerResponse && activeCharacter && settings?.llm?.llmUrl) {
        // Have a predefined response, but enhance it with LLM
        const baseResponse = this.substituteVariables(playerResponse.replace(/\[Choice\]/gi, choiceLabel));
        console.log(`[EventEngine] Enhancing player response with LLM: "${baseResponse.substring(0, 50)}..."`);

        await this.broadcast('generating_start', { characterName: playerName });

        let systemPrompt = `You are writing as ${playerName}, a player character in a roleplay scenario.\n`;
        if (activePersona) {
          if (activePersona.personality) systemPrompt += `Personality: ${activePersona.personality}\n`;
          if (activePersona.appearance) systemPrompt += `Appearance: ${activePersona.appearance}\n`;
        }
        systemPrompt += `\nYou are interacting with ${activeCharacter.name}: ${activeCharacter.description}\n`;
        systemPrompt += `\nExpand and enhance the following player response while keeping its core meaning:\n"${baseResponse}"\n`;
        systemPrompt += `Keep the same intent but make it more natural and in-character.`;

        const recentMessages = this.sessionState?.chatHistory?.slice(-3) || [];
        let prompt = '';
        recentMessages.forEach(msg => {
          if (msg.sender === 'player') {
            prompt += `${playerName}: ${msg.content}\n`;
          } else {
            prompt += `${activeCharacter.name}: ${msg.content}\n`;
          }
        });
        prompt += `\n${playerName}:`;

        const playerResult = await this.llmService.generate({
          prompt,
          systemPrompt,
          settings: settings.llm
        });

        const playerMessage = {
          id: require('uuid').v4(),
          content: playerResult.text,
          sender: 'player',
          timestamp: Date.now(),
          generated: true,
          fromChoice: true
        };

        if (this.sessionState?.chatHistory) {
          this.sessionState.chatHistory.push(playerMessage);
        }

        await this.broadcast('chat_message', playerMessage);
        await this.broadcast('generating_stop', {});
      } else if (activeCharacter && settings?.llm?.llmUrl) {
        // No predefined response - generate via LLM
        // Broadcast generating start
        await this.broadcast('generating_start', { characterName: playerName });

        let systemPrompt = `You are writing as ${playerName}, a player character in a roleplay scenario.\n`;
        if (activePersona) {
          if (activePersona.personality) systemPrompt += `Personality: ${activePersona.personality}\n`;
          if (activePersona.appearance) systemPrompt += `Appearance: ${activePersona.appearance}\n`;
        }
        systemPrompt += `\nYou are interacting with ${activeCharacter.name}: ${activeCharacter.description}\n`;

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

    // Inherit flags from activeExecutions
    const execution = this.activeExecutions.get(flowId);
    const inheritedPriority = execution?.triggerPriority || null;
    const inheritedNotify = execution?.shouldNotify || false;

    // Clear pending choice
    this.pendingPlayerChoice = null;

    // Continue flow execution from the chosen branch
    await this.executeFromNode(flow, matchingEdge.target, null, true, inheritedPriority, inheritedNotify);
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

    // Get trigger options from the button press node
    const triggerPriority = matchingTrigger.data.hasPriority ? (matchingTrigger.data.priority || 3) : null;
    const shouldNotify = matchingTrigger.data.notify || false;

    // Execute from the matched button press trigger
    console.log(`[EventEngine] Executing FlowAction from Button Press node: ${matchingTrigger.id} (notify: ${shouldNotify})`);
    await this.executeFromNode(flow, matchingTrigger.id, null, false, triggerPriority, shouldNotify);
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

    // Get trigger options from the button press node
    const triggerPriority = matchingTrigger.data.hasPriority ? (matchingTrigger.data.priority || 3) : null;
    const shouldNotify = matchingTrigger.data.notify || false;

    // Execute from the matched button press trigger
    console.log(`[EventEngine] Executing FlowAction from Button Press node: ${matchingTrigger.id} (notify: ${shouldNotify})`);
    await this.executeFromNode(flow.flow, matchingTrigger.id, null, false, triggerPriority, shouldNotify);
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
  async executeDelay(data) {
    // Support variable substitution for duration (e.g., [Flow:PumpDuration])
    const duration = this.evaluateExpression(data.duration) || 5;
    const multiplier = data.unit === 'minutes' ? 60000 : 1000;
    console.log(`[EventEngine] Executing delay: ${duration} ${data.unit || 'seconds'}`);
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

    // Challenge result variables (persist until next challenge of same type)
    result = result.replace(/\[Segments\]/gi, this.variables['Segments'] || '');  // All wheel segment labels
    result = result.replace(/\[Segment\]/gi, this.variables['Segment'] || '');    // Winning segment label
    result = result.replace(/\[Roll\]/gi, this.variables['Roll'] || '');          // Dice total rolled
    result = result.replace(/\[Slots\]/gi, this.variables['Slots'] || '');        // Slot machine symbols

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
            const triggerPriority = trigger.data.hasPriority ? (trigger.data.priority || 3) : null;
            const shouldNotify = trigger.data.notify || false;
            const isUnblockable = trigger.data.unblockable || false;

            // Skip if blocked by priority (unless unblockable)
            if (!isUnblockable && triggerPriority !== null && this.runningFlowPriority !== null) {
              if (triggerPriority >= this.runningFlowPriority) {
                continue; // Lower or same priority, skip
              }
            }

            this.executeFromNode(flow, trigger.id, null, false, triggerPriority, shouldNotify);
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

        // Turn off the device (skip in simulation mode)
        if (monitor.monitorType === 'device_on') {
          if (this.simulationMode) {
            console.log(`[SIMULATION] Device ${deviceIp} would turn OFF (until condition met)`);
          } else {
            await this.deviceService.turnOff(deviceIp, deviceObj);
          }

          // Remove from flow-activated devices tracking
          this.flowActivatedDevices.delete(deviceIp);

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

              // Inherit flags from activeExecutions
              const execution = this.activeExecutions.get(pending.flowId);
              const inheritedPriority = execution?.triggerPriority || null;
              const inheritedNotify = execution?.shouldNotify || false;

              for (const edge of completionEdges) {
                await this.executeFromNode(flow, edge.target, null, true, inheritedPriority, inheritedNotify);
              }
            }
            this.pendingDeviceOnCompletions.delete(deviceIp);
          }
        } else {
          // Stop cycle (skip actual device call in simulation mode)
          if (this.simulationMode) {
            console.log(`[SIMULATION] Device ${deviceIp} would STOP CYCLE (until condition met)`);
          } else {
            // Stop cycle (pass device object for proper brand/childId support)
            this.deviceService.stopCycle(deviceIp, deviceObj);
          }

          // Update device state tracking
          if (this.sessionState.executionHistory && this.sessionState.executionHistory.deviceActions[deviceIp]) {
            this.sessionState.executionHistory.deviceActions[deviceIp].cycling = false;
          }

          // Trigger cycle completion in simulation mode (completion edges are handled by handleCycleComplete)
          if (this.simulationMode) {
            this.handleCycleComplete(deviceIp);
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

    // Inherit flags from activeExecutions
    const execution = this.activeExecutions.get(pending.flowId);
    const inheritedPriority = execution?.triggerPriority || null;
    const inheritedNotify = execution?.shouldNotify || false;

    for (const edge of completionEdges) {
      await this.executeFromNode(flowData.flow, edge.target, null, true, inheritedPriority, inheritedNotify);
    }

    // Check if flow execution is now complete (no more pending ops for this flow)
    const flowId = pending.flowId;
    const hasPendingCycle = Array.from(this.pendingCycleCompletions.values()).some(p => p.flowId === flowId);
    const hasPendingDeviceOn = Array.from(this.pendingDeviceOnCompletions.values()).some(p => p.flowId === flowId);
    const hasPendingChoice = this.pendingPlayerChoice?.flowId === flowId;
    const hasPendingChallenge = this.pendingChallenge?.flowId === flowId;
    const hasPendingInput = this.pendingInput?.flowId === flowId;
    const depthRemaining = this.executionDepths.get(flowId) || 0;

    if (!hasPendingCycle && !hasPendingDeviceOn && !hasPendingChoice && !hasPendingChallenge && !hasPendingInput && depthRemaining <= 0) {
      if (this.activeExecutions.has(flowId)) {
        console.log(`[EventEngine] Flow ${flowId} complete after cycle - removing from activeExecutions`);
        this.activeExecutions.delete(flowId);
        await this.broadcastExecutionsUpdate();
      }
    }
  }

  /**
   * Handle device_on completion - executes completion edges
   * Called when a device_on action's "until" condition is met
   */
  async handleDeviceOnComplete(deviceIp) {
    const pending = this.pendingDeviceOnCompletions?.get(deviceIp);
    if (!pending) {
      console.log(`[EventEngine] Device on complete for ${deviceIp}, but no pending completion tracked`);
      return;
    }

    console.log(`[EventEngine] Device on complete for ${deviceIp}, executing completion chain`);
    this.pendingDeviceOnCompletions.delete(deviceIp);

    // Update device state tracking
    if (this.sessionState?.executionHistory?.deviceActions?.[deviceIp]) {
      this.sessionState.executionHistory.deviceActions[deviceIp].state = 'off';
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

    console.log(`[EventEngine] Found ${completionEdges.length} device_on completion edges to execute`);

    // Inherit flags from activeExecutions
    const execution = this.activeExecutions.get(pending.flowId);
    const inheritedPriority = execution?.triggerPriority || null;
    const inheritedNotify = execution?.shouldNotify || false;

    for (const edge of completionEdges) {
      await this.executeFromNode(flowData.flow, edge.target, null, true, inheritedPriority, inheritedNotify);
    }

    // Check if flow execution is now complete (no more pending ops for this flow)
    const flowId = pending.flowId;
    const hasPendingCycle = Array.from(this.pendingCycleCompletions.values()).some(p => p.flowId === flowId);
    const hasPendingDeviceOn = Array.from(this.pendingDeviceOnCompletions.values()).some(p => p.flowId === flowId);
    const hasPendingChoice = this.pendingPlayerChoice?.flowId === flowId;
    const hasPendingChallenge = this.pendingChallenge?.flowId === flowId;
    const hasPendingInput = this.pendingInput?.flowId === flowId;
    const depthRemaining = this.executionDepths.get(flowId) || 0;

    if (!hasPendingCycle && !hasPendingDeviceOn && !hasPendingChoice && !hasPendingChallenge && !hasPendingInput && depthRemaining <= 0) {
      if (this.activeExecutions.has(flowId)) {
        console.log(`[EventEngine] Flow ${flowId} complete after device_on - removing from activeExecutions`);
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
    this.flowActivatedDevices.clear();
    this.previousPlayerState = {
      capacity: 0,
      pain: 0,
      emotion: 'neutral'
    };
    this.executedOnceConditions.clear();
    this.alternateWelcome = null;

    console.log('[EventEngine] Cleanup complete - all state cleared');
  }

  /**
   * Emergency Stop - Halt all flow execution and reset states
   * Keeps flows active but resets their execution state so they can trigger again
   */
  emergencyStop() {
    console.log('[EventEngine] EMERGENCY STOP - Halting all flow execution');

    // Set abort flag to immediately halt any in-progress flow execution
    this.aborted = true;
    this.abortEpoch++; // Increment epoch so async operations know abort happened

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
    this.pendingChallenge = null;
    this.pendingInput = null;
    this.clearPendingPauses(); // Clear pending pause/resume nodes

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

    // Sync player state tracking to current session values (don't reset to 0)
    // This prevents false "state change" events after emergency stop
    if (this.sessionState) {
      this.previousPlayerState = {
        capacity: this.sessionState.capacity || 0,
        pain: this.sessionState.pain || 0,
        emotion: this.sessionState.emotion || 'neutral'
      };
    }
    // If no session state, keep existing previousPlayerState values

    // Clear pending challenge
    this.pendingChallenge = null;

    // Clear active execution tracking (UI status)
    this.activeExecutions.clear();
    this.executionDepths.clear();

    // Broadcast empty flow executions to update UI
    if (this.broadcastFn) {
      this.broadcastFn('flow_executions_update', []);
    }

    // Collect flow-activated devices to stop, then clear the tracking
    const devicesToStop = Array.from(this.flowActivatedDevices.entries()).map(([deviceId, info]) => ({
      deviceId,
      flowId: info.flowId,
      deviceObj: info.deviceObj
    }));
    this.flowActivatedDevices.clear();

    // Reset abort flag after a short delay to allow in-progress executions to exit
    setTimeout(() => {
      this.aborted = false;
      console.log('[EventEngine] Abort flag reset - ready for new flow triggers');
    }, 100);

    console.log('[EventEngine] Emergency stop complete - flow states reset, ready for new triggers');
    return { flowsReset: this.activeFlows.size, devicesToStop };
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
