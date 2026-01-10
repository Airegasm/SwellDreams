import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AppContext = createContext(null);

// API base URL - in production, frontend runs on different port than backend
const API_BASE = `http://${window.location.hostname}:8889`;

export function AppProvider({ children }) {
  // WebSocket connection
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);

  // Settings
  const [settings, setSettings] = useState({
    llm: {
      llmUrl: '',
      maxTokens: 300,
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
    sensation: 'normal',
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

  // Player choice state
  const [playerChoiceData, setPlayerChoiceData] = useState(null);

  // Simple A/B choice state
  const [simpleABData, setSimpleABData] = useState(null);

  // Infinite cycle tracking
  const [infiniteCycles, setInfiniteCycles] = useState({}); // { deviceIp: true }

  // Simulation mode state - default based on devices array (empty = simulation required)
  const [simulationRequired, setSimulationRequired] = useState(false);
  const [simulationReason, setSimulationReason] = useState(null);

  // Control mode - shared between Chat and App header
  const [controlMode, setControlModeInternal] = useState('interactive'); // 'interactive' or 'simulated'

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8889`;

    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
    };

    ws.current.onclose = () => {
      console.log('[WS] Disconnected');
      setConnected(false);
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
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
          fetch(`http://${window.location.hostname}:8889/api/settings`)
            .then(res => res.json())
            .then(setSettings)
            .catch(console.error);
        } else {
          // Refresh characters to get updated character reminders
          fetch(`http://${window.location.hostname}:8889/api/characters`)
            .then(res => res.json())
            .then(setCharacters)
            .catch(console.error);
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

      case 'sensation_update':
        setSessionState(prev => ({ ...prev, sensation: data.sensation }));
        break;

      case 'emotion_update':
        setSessionState(prev => ({ ...prev, emotion: data.emotion }));
        break;

      case 'session_reset':
        setSessionState(data);
        setMessages([]);
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
        break;

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

  // API calls
  const api = {
    // Settings
    async getSettings() {
      const res = await fetch(`${API_BASE}/api/settings`);
      return res.json();
    },
    async updateSettings(data) {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async updateLlmSettings(data) {
      const res = await fetch(`${API_BASE}/api/settings/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },

    // LLM
    async testLlm(settings) {
      const res = await fetch(`${API_BASE}/api/llm/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      return res.json();
    },

    // Connection Profiles
    async getConnectionProfiles() {
      const res = await fetch(`${API_BASE}/api/connection-profiles`);
      return res.json();
    },
    async createConnectionProfile(data) {
      const res = await fetch(`${API_BASE}/api/connection-profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async updateConnectionProfile(id, data) {
      const res = await fetch(`${API_BASE}/api/connection-profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async deleteConnectionProfile(id) {
      const res = await fetch(`${API_BASE}/api/connection-profiles/${id}`, { method: 'DELETE' });
      return res.json();
    },
    async activateConnectionProfile(id) {
      const res = await fetch(`${API_BASE}/api/connection-profiles/${id}/activate`, { method: 'POST' });
      return res.json();
    },

    // Personas
    async getPersonas() {
      const res = await fetch(`${API_BASE}/api/personas`);
      return res.json();
    },
    async createPersona(data) {
      const res = await fetch(`${API_BASE}/api/personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async updatePersona(id, data) {
      const res = await fetch(`${API_BASE}/api/personas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async deletePersona(id) {
      const res = await fetch(`${API_BASE}/api/personas/${id}`, { method: 'DELETE' });
      return res.json();
    },

    // Characters
    async getCharacters() {
      const res = await fetch(`${API_BASE}/api/characters`);
      return res.json();
    },
    async createCharacter(data) {
      const res = await fetch(`${API_BASE}/api/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async updateCharacter(id, data) {
      const res = await fetch(`${API_BASE}/api/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async deleteCharacter(id) {
      const res = await fetch(`${API_BASE}/api/characters/${id}`, { method: 'DELETE' });
      return res.json();
    },

    // Devices
    async getDevices() {
      const res = await fetch(`${API_BASE}/api/devices`);
      return res.json();
    },
    async scanDevices(timeout = 10) {
      const res = await fetch(`${API_BASE}/api/devices/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout })
      });
      return res.json();
    },
    async addDevice(data) {
      const res = await fetch(`${API_BASE}/api/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async updateDevice(id, data) {
      const res = await fetch(`${API_BASE}/api/devices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async deleteDevice(id) {
      const res = await fetch(`${API_BASE}/api/devices/${id}`, { method: 'DELETE' });
      return res.json();
    },
    async deviceOn(ip) {
      const res = await fetch(`${API_BASE}/api/devices/${ip}/on`, { method: 'POST' });
      return res.json();
    },
    async deviceOff(ip) {
      const res = await fetch(`${API_BASE}/api/devices/${ip}/off`, { method: 'POST' });
      return res.json();
    },
    async startCycle(ip, options) {
      const res = await fetch(`${API_BASE}/api/devices/${ip}/cycle/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
      });
      return res.json();
    },
    async stopCycle(ip) {
      const res = await fetch(`${API_BASE}/api/devices/${ip}/cycle/stop`, { method: 'POST' });
      return res.json();
    },
    async emergencyStop() {
      const res = await fetch(`${API_BASE}/api/emergency-stop`, { method: 'POST' });
      return res.json();
    },

    // Govee devices
    async connectGovee(apiKey) {
      const res = await fetch(`${API_BASE}/api/govee/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      return res.json();
    },
    async getGoveeStatus() {
      const res = await fetch(`${API_BASE}/api/govee/status`);
      return res.json();
    },
    async scanGoveeDevices() {
      const res = await fetch(`${API_BASE}/api/govee/devices`);
      return res.json();
    },
    async goveeDeviceOn(deviceId, sku) {
      const res = await fetch(`${API_BASE}/api/govee/devices/${deviceId}/on`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku })
      });
      return res.json();
    },
    async goveeDeviceOff(deviceId, sku) {
      const res = await fetch(`${API_BASE}/api/govee/devices/${deviceId}/off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku })
      });
      return res.json();
    },
    async getGoveeDeviceState(deviceId, sku) {
      const res = await fetch(`${API_BASE}/api/govee/devices/${deviceId}/state?sku=${encodeURIComponent(sku)}`);
      return res.json();
    },

    // Tuya devices (Smart Life, Treatlife, Gosund, etc.)
    async connectTuya(accessId, accessSecret, region = 'us') {
      const res = await fetch(`${API_BASE}/api/tuya/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessId, accessSecret, region })
      });
      return res.json();
    },
    async getTuyaStatus() {
      const res = await fetch(`${API_BASE}/api/tuya/status`);
      return res.json();
    },
    async scanTuyaDevices() {
      const res = await fetch(`${API_BASE}/api/tuya/devices`);
      return res.json();
    },
    async tuyaDeviceOn(deviceId) {
      const res = await fetch(`${API_BASE}/api/tuya/devices/${deviceId}/on`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return res.json();
    },
    async tuyaDeviceOff(deviceId) {
      const res = await fetch(`${API_BASE}/api/tuya/devices/${deviceId}/off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return res.json();
    },
    async getTuyaDeviceState(deviceId) {
      const res = await fetch(`${API_BASE}/api/tuya/devices/${deviceId}/state`);
      return res.json();
    },

    // Simulation status
    async getSimulationStatus() {
      const res = await fetch(`${API_BASE}/api/simulation-status`);
      return res.json();
    },

    // Flows
    async getFlows() {
      const res = await fetch(`${API_BASE}/api/flows`);
      return res.json();
    },
    async createFlow(data) {
      const res = await fetch(`${API_BASE}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async updateFlow(id, data) {
      const res = await fetch(`${API_BASE}/api/flows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async deleteFlow(id) {
      const res = await fetch(`${API_BASE}/api/flows/${id}`, { method: 'DELETE' });
      return res.json();
    },

    // Session
    async resetSession() {
      const res = await fetch(`${API_BASE}/api/session/reset`, { method: 'POST' });
      return res.json();
    },
    async saveSession(data) {
      const res = await fetch(`${API_BASE}/api/sessions/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    },
    async listSessions(personaId, characterId) {
      const params = new URLSearchParams();
      if (personaId) params.append('personaId', personaId);
      if (characterId) params.append('characterId', characterId);
      const res = await fetch(`${API_BASE}/api/sessions/list?${params}`);
      return res.json();
    },
    async loadSession(id) {
      const res = await fetch(`${API_BASE}/api/sessions/${id}/load`, { method: 'POST' });
      return res.json();
    },
    async deleteSession(id) {
      const res = await fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' });
      return res.json();
    }
  };

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
          const cachedRes = await fetch(`${API_BASE}/api/openrouter/models`);
          const cachedData = await cachedRes.json();
          if (cachedData.models && cachedData.models.length > 0) {
            console.log('[AppContext] OpenRouter models already cached');
            return;
          }
          // If not cached, connect to OpenRouter
          console.log('[AppContext] Auto-connecting to OpenRouter...');
          const res = await fetch(`${API_BASE}/api/openrouter/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: settings.llm.openRouterApiKey })
          });
          const data = await res.json();
          if (data.success) {
            console.log(`[AppContext] OpenRouter connected, ${data.models.length} models available`);
          }
        } catch (e) {
          console.error('[AppContext] Failed to auto-connect to OpenRouter:', e);
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

    // Player Choice
    playerChoiceData,
    handlePlayerChoice,

    // Simple A/B Choice
    simpleABData,
    handleSimpleAB,

    // Infinite Cycles
    infiniteCycles,

    // Simulation Mode
    simulationRequired,
    simulationReason,
    controlMode,
    setControlMode,

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
