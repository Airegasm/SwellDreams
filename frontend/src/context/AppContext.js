import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch, ApiError } from '../utils/api';
import { API_BASE, WS_URL, CONFIG } from '../config';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // WebSocket connection
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);

  // Settings
  const [settings, setSettings] = useState({
    llm: {
      llmUrl: '',
      maxTokens: 150,
      contextTokens: 8192,
      streaming: false,
      temperature: 0.92,
      topK: 0,
      topP: 0.92,
      typicalP: 1,
      minP: 0.08,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.05,
      repPenRange: 2048,
      repPenSlope: 1,
      frequencyPenalty: 0.58,
      presencePenalty: 0.2,
      neutralizeSamplers: false,
      samplerOrder: []
    },
    activePersonaId: null,
    activeCharacterId: null,
    activeFlowIds: []
  });

  // Data
  const [personas, setPersonas] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [devices, setDevices] = useState([]);
  const [flows, setFlows] = useState([]);

  // Session state
  const [sessionState, setSessionState] = useState({
    capacity: 0,
    pain: 0, // 0-10 numeric pain scale
    emotion: 'neutral',
    chatHistory: [],
    flowVariables: {},
    deviceStates: {},
    flowAssignments: {
      personas: {},
      characters: {},
      global: []
    }
  });

  // Chat messages (separate for UI updates)
  const [messages, setMessages] = useState([]);

  // Session loading state (for new session spinner)
  const [sessionLoading, setSessionLoading] = useState(false);

  // Player choice state
  const [playerChoiceData, setPlayerChoiceData] = useState(null);

  // Simple A/B choice state
  const [simpleABData, setSimpleABData] = useState(null);

  // Challenge modal state
  const [challengeData, setChallengeData] = useState(null);

  // Infinite cycle tracking
  const [infiniteCycles, setInfiniteCycles] = useState({}); // { deviceIp: true }

  // Simulation mode state - default based on devices array (empty = simulation required)
  const [simulationRequired, setSimulationRequired] = useState(false);
  const [simulationReason, setSimulationReason] = useState(null);

  // Control mode - shared between Chat and App header
  const [controlMode, setControlModeInternal] = useState('interactive'); // 'interactive' or 'simulated'

  // Flow pause state - tracks whether flows are paused due to navigation or tab visibility
  const [flowsPaused, setFlowsPaused] = useState(false);
  const flowsPausedRef = useRef(false); // Ref for use in effects to avoid stale closures
  const isOnChatPageRef = useRef(true); // Track if user is on Chat page

  // Flow execution state for UI status panel - now tracks multiple active flows
  // Each execution: { flowId, flowName, triggerType, triggerLabel, currentNodeLabel, startTime }
  const [flowExecutions, setFlowExecutions] = useState([]);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
    };

    ws.current.onclose = () => {
      console.log('[WS] Disconnected');
      setConnected(false);
      // Reconnect after delay
      setTimeout(connectWebSocket, CONFIG.WS_RECONNECT_DELAY_MS);
    };

    ws.current.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    ws.current.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        handleWsMessage(type, data);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };
  }, []);

  // Handle WebSocket messages
  const handleWsMessage = useCallback((type, data) => {
    switch (type) {
      case 'init':
        if (data.sessionState) setSessionState(data.sessionState);
        if (data.settings) setSettings(data.settings);
        if (data.devices) setDevices(data.devices);
        if (data.sessionState?.chatHistory) {
          setMessages(data.sessionState.chatHistory);
        }
        break;

      case 'chat_message':
      case 'ai_message':
      case 'system_message':
        setMessages(prev => {
          // Prevent duplicates
          if (prev.some(m => m.id === data.id)) return prev;
          return [...prev, data];
        });
        break;

      case 'settings_update':
        setSettings(data);
        break;

      case 'reminder_updated':
        // Refresh settings or characters when a reminder is toggled by a flow
        if (data.isGlobal) {
          // Refresh settings to get updated global reminders
          apiFetch(`${API_BASE}/api/settings`)
            .then(setSettings)
            .catch(err => console.error('[WS] Failed to refresh settings:', err.message));
        } else {
          // Refresh characters to get updated character reminders
          apiFetch(`${API_BASE}/api/characters`)
            .then(setCharacters)
            .catch(err => console.error('[WS] Failed to refresh characters:', err.message));
        }
        break;

      case 'personas_update':
        setPersonas(data);
        break;

      case 'characters_update':
        setCharacters(data);
        break;

      case 'devices_update':
        setDevices(data);
        break;

      case 'flows_update':
        setFlows(data);
        break;

      case 'capacity_update':
        setSessionState(prev => ({ ...prev, capacity: data.capacity }));
        break;

      case 'pain_update':
        setSessionState(prev => ({ ...prev, pain: data.pain }));
        break;

      case 'sensation_update':
        // Legacy support - convert sensation string to pain number
        const sensationToPain = {
          'normal': 0, 'slightly tight': 2, 'comfortably full': 3,
          'stretched': 5, 'very tight': 7, 'painfully tight': 9
        };
        const painValue = typeof data.sensation === 'number' ? data.sensation : (sensationToPain[data.sensation] ?? 0);
        setSessionState(prev => ({ ...prev, pain: painValue }));
        break;

      case 'emotion_update':
        setSessionState(prev => ({ ...prev, emotion: data.emotion }));
        break;

      case 'session_reset':
        setSessionState(data);
        setMessages([]);
        setSessionLoading(false);
        break;

      case 'session_loaded':
        setSessionState(data);
        setMessages(data.chatHistory || []);
        break;

      case 'flow_assignments_update':
        setSessionState(prev => ({ ...prev, flowAssignments: data }));
        break;

      case 'player_choice':
        setPlayerChoiceData(data);
        break;

      case 'simple_ab':
        setSimpleABData(data);
        break;

      case 'challenge':
        setChallengeData(data);
        break;

      case 'message_updated':
        setMessages(prev => prev.map(m => m.id === data.id ? data : m));
        break;

      case 'message_deleted':
        setMessages(prev => prev.filter(m => m.id !== data.id));
        break;

      case 'stream_token':
        // Update message content with streaming text
        setMessages(prev => prev.map(m =>
          m.id === data.messageId
            ? { ...m, content: data.fullText, streaming: true }
            : m
        ));
        break;

      case 'stream_complete':
        // Finalize streaming message
        setMessages(prev => prev.map(m =>
          m.id === data.messageId
            ? { ...m, content: data.content, streaming: false }
            : m
        ));
        break;

      case 'generating_start':
        setSessionState(prev => ({
          ...prev,
          isGenerating: true,
          generatingFor: data.characterName,
          isPlayerVoice: data.isPlayerVoice || false
        }));
        break;

      case 'generating_stop':
        setSessionState(prev => ({ ...prev, isGenerating: false, generatingFor: null, isPlayerVoice: false }));
        break;

      case 'auto_reply_update':
        setSessionState(prev => ({ ...prev, autoReply: data.enabled }));
        break;

      case 'infinite_cycle_start':
        setInfiniteCycles(prev => ({ ...prev, [data.device]: true }));
        break;

      case 'infinite_cycle_end':
        setInfiniteCycles(prev => {
          const next = { ...prev };
          delete next[data.device];
          return next;
        });
        break;

      case 'impersonate_result':
        // Broadcast impersonate result to any listeners
        window.dispatchEvent(new CustomEvent('impersonate_result', { detail: data }));
        break;

      case 'error':
        console.error('[WS] Server error:', data.message, data.error);
        // Dispatch event for UI to display the error
        window.dispatchEvent(new CustomEvent('llm_error', {
          detail: { message: data.message, error: data.error }
        }));
        break;

      case 'test_result':
        // Dispatch test result event for FlowEditor to display
        window.dispatchEvent(new CustomEvent('test_result', { detail: data }));
        break;

      case 'server_error':
        console.error('[Express Error]', data.method, data.path, '-', data.message);
        if (data.stack) console.error(data.stack);
        break;

      case 'server_log': {
        // Backend console output piped to browser DevTools
        const prefix = '%c[Backend]';
        const style = data.level === 'error' ? 'color: #ff6b6b; font-weight: bold'
                    : data.level === 'warn' ? 'color: #ffa500; font-weight: bold'
                    : 'color: #4ecdc4';
        if (data.level === 'error') {
          console.error(prefix, style, data.message);
        } else if (data.level === 'warn') {
          console.warn(prefix, style, data.message);
        } else {
          console.log(prefix, style, data.message);
        }
        break;
      }

      case 'device_on':
      case 'device_off':
      case 'cycle_on':
      case 'cycle_off':
      case 'cycle_complete':
        // Device events - update UI as needed
        console.log('[WS] Device event:', type, data);
        break;

      case 'emergency_stop':
        console.warn('[WS] Emergency stop triggered:', data);
        // Clear any active challenges, choices, or modals to unblock the page
        setChallengeData(null);
        setPlayerChoiceData(null);
        setSimpleABData(null);
        // Notify user if this was an automatic failsafe trigger
        if (data.automatic) {
          window.dispatchEvent(new CustomEvent('emergency_stop_alert', {
            detail: {
              reason: data.reason,
              timestamp: data.timestamp
            }
          }));
        }
        break;

      case 'flow_paused':
        setFlowsPaused(data.paused);
        flowsPausedRef.current = data.paused;
        console.log(`[WS] Flows ${data.paused ? 'PAUSED' : 'RESUMED'}`);
        break;

      case 'flow_executions_update':
        // Update the array of active flow executions
        setFlowExecutions(data.executions || []);
        console.log(`[WS] Flow executions update: ${(data.executions || []).length} active`);
        break;

      case 'flow_toast':
        // Dispatch event for toast notification
        window.dispatchEvent(new CustomEvent('flow_toast', { detail: data }));
        break;

      default:
        console.log('[WS] Unknown message:', type, data);
    }
  }, []);

  // Send WebSocket message
  const sendWsMessage = useCallback((type, data) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  // Send chat message
  const sendChatMessage = useCallback((content) => {
    sendWsMessage('chat_message', { content, sender: 'player' });
  }, [sendWsMessage]);

  // Start new session - clears UI immediately, shows loading while backend resets
  const startNewSession = useCallback(async () => {
    // Immediately clear messages and show loading
    setMessages([]);
    setSessionLoading(true);
    // Reset states instantly
    setSessionState(prev => ({
      ...prev,
      capacity: 0,
      pain: 0,
      chatHistory: []
    }));
    // Call API - backend will send session_reset when done
    try {
      await apiFetch(`${API_BASE}/api/session/reset`, { method: 'POST' });
    } catch (error) {
      console.error('Session reset failed:', error);
      setSessionLoading(false);
    }
  }, []);

  // Handle player choice response
  const handlePlayerChoice = useCallback((choice) => {
    if (!playerChoiceData) return;

    sendWsMessage('player_choice_response', {
      nodeId: playerChoiceData.nodeId,
      choiceId: choice.id,
      choiceLabel: choice.label
    });

    setPlayerChoiceData(null);
  }, [playerChoiceData, sendWsMessage]);

  // Handle simple A/B choice response
  const handleSimpleAB = useCallback((choiceId) => {
    if (!simpleABData) return;

    sendWsMessage('player_choice_response', {
      nodeId: simpleABData.nodeId,
      choiceId: choiceId,
      choiceLabel: choiceId === 'a' ? simpleABData.labelA : simpleABData.labelB
    });

    setSimpleABData(null);
  }, [simpleABData, sendWsMessage]);

  // Handle challenge result - sends back the output ID that determines flow path
  const handleChallengeResult = useCallback((outputId) => {
    if (!challengeData) return;

    sendWsMessage('challenge_result', {
      nodeId: challengeData.nodeId,
      outputId: outputId
    });

    setChallengeData(null);
  }, [challengeData, sendWsMessage]);

  // Handle challenge cancellation - user skips/backs out of challenge
  const handleChallengeCancel = useCallback(() => {
    if (!challengeData) return;

    sendWsMessage('challenge_cancelled', {
      nodeId: challengeData.nodeId
    });

    setChallengeData(null);
  }, [challengeData, sendWsMessage]);

  // API calls - all using apiFetch with proper error handling and timeouts
  // Wrapped in useMemo to maintain stable reference and prevent useEffect loops
  const api = useMemo(() => ({
    // Settings
    getSettings: () => apiFetch(`${API_BASE}/api/settings`),

    updateSettings: (data) => apiFetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateLlmSettings: (data) => apiFetch(`${API_BASE}/api/settings/llm`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    // LLM - longer timeout for generation
    testLlm: (settings) => apiFetch(`${API_BASE}/api/llm/test`, {
      method: 'POST',
      body: JSON.stringify(settings),
      timeout: CONFIG.LLM_TIMEOUT_MS
    }),

    // Connection Profiles
    getConnectionProfiles: () => apiFetch(`${API_BASE}/api/connection-profiles`),

    createConnectionProfile: (data) => apiFetch(`${API_BASE}/api/connection-profiles`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateConnectionProfile: (id, data) => apiFetch(`${API_BASE}/api/connection-profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteConnectionProfile: (id) => apiFetch(`${API_BASE}/api/connection-profiles/${id}`, {
      method: 'DELETE'
    }),

    activateConnectionProfile: (id) => apiFetch(`${API_BASE}/api/connection-profiles/${id}/activate`, {
      method: 'POST'
    }),

    // Personas
    getPersonas: () => apiFetch(`${API_BASE}/api/personas`),

    createPersona: (data) => apiFetch(`${API_BASE}/api/personas`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updatePersona: (id, data) => apiFetch(`${API_BASE}/api/personas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deletePersona: (id) => apiFetch(`${API_BASE}/api/personas/${id}`, {
      method: 'DELETE'
    }),

    // Characters
    getCharacters: () => apiFetch(`${API_BASE}/api/characters`),

    createCharacter: (data) => apiFetch(`${API_BASE}/api/characters`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateCharacter: (id, data) => apiFetch(`${API_BASE}/api/characters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteCharacter: (id) => apiFetch(`${API_BASE}/api/characters/${id}`, {
      method: 'DELETE'
    }),

    // Devices
    getDevices: () => apiFetch(`${API_BASE}/api/devices`),

    scanDevices: (timeout = 10) => apiFetch(`${API_BASE}/api/devices/scan`, {
      method: 'POST',
      body: JSON.stringify({ timeout }),
      timeout: CONFIG.DEVICE_SCAN_TIMEOUT_MS
    }),

    addDevice: (data) => apiFetch(`${API_BASE}/api/devices`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateDevice: (id, data) => apiFetch(`${API_BASE}/api/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteDevice: (id) => apiFetch(`${API_BASE}/api/devices/${id}`, {
      method: 'DELETE'
    }),

    // deviceOn/deviceOff now accept a device object with: ip/deviceId, childId, brand, sku
    deviceOn: (deviceIdOrIp, options = {}) => {
      const { childId, brand, sku } = options;
      const body = {};
      if (childId) body.childId = childId;
      if (brand) body.brand = brand;
      if (sku) body.sku = sku;
      return apiFetch(`${API_BASE}/api/devices/${encodeURIComponent(deviceIdOrIp)}/on`, {
        method: 'POST',
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
      });
    },

    deviceOff: (deviceIdOrIp, options = {}) => {
      const { childId, brand, sku } = options;
      const body = {};
      if (childId) body.childId = childId;
      if (brand) body.brand = brand;
      if (sku) body.sku = sku;
      return apiFetch(`${API_BASE}/api/devices/${encodeURIComponent(deviceIdOrIp)}/off`, {
        method: 'POST',
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
      });
    },

    getDeviceChildren: (ip) => apiFetch(`${API_BASE}/api/devices/${encodeURIComponent(ip)}/children`),

    startCycle: (ip, options) => apiFetch(`${API_BASE}/api/devices/${encodeURIComponent(ip)}/cycle/start`, {
      method: 'POST',
      body: JSON.stringify(options)
    }),

    stopCycle: (ip) => apiFetch(`${API_BASE}/api/devices/${encodeURIComponent(ip)}/cycle/stop`, {
      method: 'POST'
    }),

    emergencyStop: () => apiFetch(`${API_BASE}/api/emergency-stop`, {
      method: 'POST'
    }),

    // Govee devices
    connectGovee: (apiKey) => apiFetch(`${API_BASE}/api/govee/connect`, {
      method: 'POST',
      body: JSON.stringify({ apiKey })
    }),

    getGoveeStatus: () => apiFetch(`${API_BASE}/api/govee/status`),

    scanGoveeDevices: () => apiFetch(`${API_BASE}/api/govee/devices`),

    goveeDeviceOn: (deviceId, sku) => apiFetch(`${API_BASE}/api/govee/devices/${encodeURIComponent(deviceId)}/on`, {
      method: 'POST',
      body: JSON.stringify({ sku })
    }),

    goveeDeviceOff: (deviceId, sku) => apiFetch(`${API_BASE}/api/govee/devices/${encodeURIComponent(deviceId)}/off`, {
      method: 'POST',
      body: JSON.stringify({ sku })
    }),

    getGoveeDeviceState: (deviceId, sku) => apiFetch(
      `${API_BASE}/api/govee/devices/${encodeURIComponent(deviceId)}/state?sku=${encodeURIComponent(sku)}`
    ),

    // Tuya devices (Smart Life, Treatlife, Gosund, etc.)
    connectTuya: (accessId, accessSecret, region = 'us') => apiFetch(`${API_BASE}/api/tuya/connect`, {
      method: 'POST',
      body: JSON.stringify({ accessId, accessSecret, region })
    }),

    getTuyaStatus: () => apiFetch(`${API_BASE}/api/tuya/status`),

    disconnectTuya: () => apiFetch(`${API_BASE}/api/tuya/disconnect`, {
      method: 'POST'
    }),

    scanTuyaDevices: (deviceIds) => {
      const url = deviceIds
        ? `${API_BASE}/api/tuya/devices?device_ids=${encodeURIComponent(deviceIds)}`
        : `${API_BASE}/api/tuya/devices`;
      return apiFetch(url);
    },

    tuyaDeviceOn: (deviceId) => apiFetch(`${API_BASE}/api/tuya/devices/${encodeURIComponent(deviceId)}/on`, {
      method: 'POST'
    }),

    tuyaDeviceOff: (deviceId) => apiFetch(`${API_BASE}/api/tuya/devices/${encodeURIComponent(deviceId)}/off`, {
      method: 'POST'
    }),

    getTuyaDeviceState: (deviceId) => apiFetch(
      `${API_BASE}/api/tuya/devices/${encodeURIComponent(deviceId)}/state`
    ),

    // Simulation status
    getSimulationStatus: () => apiFetch(`${API_BASE}/api/simulation-status`),

    // Flows
    getFlows: () => apiFetch(`${API_BASE}/api/flows`),

    createFlow: (data) => apiFetch(`${API_BASE}/api/flows`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateFlow: (id, data) => apiFetch(`${API_BASE}/api/flows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteFlow: (id) => apiFetch(`${API_BASE}/api/flows/${id}`, {
      method: 'DELETE'
    }),

    // Session
    resetSession: () => apiFetch(`${API_BASE}/api/session/reset`, {
      method: 'POST'
    }),

    saveSession: (data) => apiFetch(`${API_BASE}/api/sessions/save`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    listSessions: (personaId, characterId) => {
      const params = new URLSearchParams();
      if (personaId) params.append('personaId', personaId);
      if (characterId) params.append('characterId', characterId);
      return apiFetch(`${API_BASE}/api/sessions/list?${params}`);
    },

    loadSession: (id) => apiFetch(`${API_BASE}/api/sessions/${id}/load`, {
      method: 'POST'
    }),

    deleteSession: (id) => apiFetch(`${API_BASE}/api/sessions/${id}`, {
      method: 'DELETE'
    }),

    // Remote Settings
    getRemoteSettings: () => apiFetch(`${API_BASE}/api/remote-settings`),

    updateRemoteSettings: (data) => apiFetch(`${API_BASE}/api/remote-settings`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    addWhitelistedIp: (ip) => apiFetch(`${API_BASE}/api/remote-settings/whitelist`, {
      method: 'POST',
      body: JSON.stringify({ ip })
    }),

    removeWhitelistedIp: (ip) => apiFetch(`${API_BASE}/api/remote-settings/whitelist/${encodeURIComponent(ip)}`, {
      method: 'DELETE'
    })
  }), []);

  // Fetch simulation status
  const fetchSimulationStatus = useCallback(async () => {
    try {
      const status = await api.getSimulationStatus();
      console.log('[AppContext] Simulation status:', status);
      setSimulationRequired(status.simulationRequired);
      setSimulationReason(status.reason);
    } catch (error) {
      console.error('[AppContext] Failed to get simulation status:', error);
    }
  }, []);

  // Initialize
  useEffect(() => {
    connectWebSocket();

    // Load initial data
    api.getSettings().then(setSettings).catch(console.error);
    api.getPersonas().then(setPersonas).catch(console.error);
    api.getCharacters().then(setCharacters).catch(console.error);
    api.getDevices().then(setDevices).catch(console.error);
    api.getFlows().then(setFlows).catch(console.error);
    fetchSimulationStatus();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connectWebSocket, fetchSimulationStatus]);

  // Re-check simulation status when devices change
  useEffect(() => {
    fetchSimulationStatus();
  }, [devices, fetchSimulationStatus]);

  // Auto-connect to OpenRouter when app loads if configured
  useEffect(() => {
    const autoConnectOpenRouter = async () => {
      if (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) {
        try {
          // First check if we have cached models
          const cachedData = await apiFetch(`${API_BASE}/api/openrouter/models`);
          if (cachedData.models && cachedData.models.length > 0) {
            console.log('[AppContext] OpenRouter models already cached');
            return;
          }
          // If not cached, connect to OpenRouter
          console.log('[AppContext] Auto-connecting to OpenRouter...');
          const data = await apiFetch(`${API_BASE}/api/openrouter/connect`, {
            method: 'POST',
            body: JSON.stringify({ apiKey: settings.llm.openRouterApiKey })
          });
          if (data.success) {
            console.log(`[AppContext] OpenRouter connected, ${data.models.length} models available`);
          }
        } catch (e) {
          console.error('[AppContext] Failed to auto-connect to OpenRouter:', e.message);
        }
      }
    };
    autoConnectOpenRouter();
  }, [settings?.llm?.endpointStandard, settings?.llm?.openRouterApiKey]);

  // Wrapper for setControlMode that also notifies backend
  const setControlMode = useCallback((mode) => {
    setControlModeInternal(mode);
    // Notify backend of mode change
    sendWsMessage('set_control_mode', { mode });
  }, [sendWsMessage]);

  // Sync controlMode with simulation requirement
  useEffect(() => {
    if (simulationRequired && controlMode !== 'simulated') {
      setControlModeInternal('simulated');
      sendWsMessage('set_control_mode', { mode: 'simulated' });
    } else if (!simulationRequired && controlMode === 'simulated') {
      // Default to interactive when simulation is not required
      setControlModeInternal('interactive');
      sendWsMessage('set_control_mode', { mode: 'interactive' });
    }
  }, [simulationRequired, sendWsMessage]);

  // Refs to track challenge/choice state without causing re-renders
  const hasPendingChallengeRef = useRef(false);
  const hasPendingChoiceRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    hasPendingChallengeRef.current = !!challengeData;
  }, [challengeData]);

  useEffect(() => {
    hasPendingChoiceRef.current = !!playerChoiceData;
  }, [playerChoiceData]);

  // Helper to check if flows should be paused based on current state
  // Only pause when user actually navigates away from Chat page
  // Tab visibility changes are too unreliable (modals trigger them incorrectly)
  const checkAndUpdateFlowPause = useCallback((source = 'unknown') => {
    const isOnChat = isOnChatPageRef.current;

    // Only pause/resume based on Chat page navigation, ignore visibility changes
    // Visibility changes are too unreliable with modals
    if (source === 'visibility') {
      console.log(`[AppContext] Ignoring visibility change - modals cause false triggers`);
      return;
    }

    if (!isOnChat && !flowsPausedRef.current) {
      console.log(`[AppContext] Pausing flows - left Chat page`);
      sendWsMessage('flow_pause', {});
    } else if (isOnChat && flowsPausedRef.current) {
      console.log(`[AppContext] Resuming flows - returned to Chat page`);
      sendWsMessage('flow_resume', {});
    }
  }, [sendWsMessage]);

  // Track browser tab visibility changes (ignored for pause/resume - too unreliable)
  useEffect(() => {
    const handleVisibilityChange = () => {
      console.log(`[AppContext] Tab visibility changed: ${document.visibilityState}`);
      checkAndUpdateFlowPause('visibility');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkAndUpdateFlowPause]);

  // Function to notify context when entering/leaving Chat page
  const setOnChatPage = useCallback((isOnChat) => {
    isOnChatPageRef.current = isOnChat;
    console.log(`[AppContext] Chat page: ${isOnChat ? 'ENTERED' : 'LEFT'}`);
    checkAndUpdateFlowPause('navigation');
  }, [checkAndUpdateFlowPause]);

  const value = {
    // Connection
    connected,

    // Settings
    settings,
    setSettings,

    // Data
    personas,
    setPersonas,
    characters,
    setCharacters,
    devices,
    setDevices,
    flows,
    setFlows,

    // Session
    sessionState,
    setSessionState,
    messages,
    setMessages,
    sessionLoading,
    startNewSession,

    // Player Choice
    playerChoiceData,
    handlePlayerChoice,

    // Simple A/B Choice
    simpleABData,
    handleSimpleAB,

    // Challenge Modal
    challengeData,
    handleChallengeResult,
    handleChallengeCancel,

    // Infinite Cycles
    infiniteCycles,

    // Simulation Mode
    simulationRequired,
    simulationReason,
    controlMode,
    setControlMode,

    // Flow Pause State
    flowsPaused,
    setOnChatPage,

    // Flow Executions (array of active flows for UI status panel)
    flowExecutions,

    // Actions
    sendChatMessage,
    sendWsMessage,

    // API
    api
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
