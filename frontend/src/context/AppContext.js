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
  const [connectionProfiles, setConnectionProfiles] = useState([]);

  // ScreenPlay data
  const [actors, setActors] = useState([]);
  const [plays, setPlays] = useState([]);

  // Session state
  const [sessionState, setSessionState] = useState({
    capacity: 0,
    pain: 0, // 0-10 numeric pain scale
    emotion: 'neutral',
    characterCapacity: 0, // AI character's simulated inflation capacity
    characterInflating: false, // Whether the AI pump is active
    characterInflateElapsed: 0, // Seconds elapsed since pump activated
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

  // Choose Multi (multi-select) state
  const [chooseMultiData, setChooseMultiData] = useState(null);

  // Checkpoint injection player-choice state
  const [checkpointChoiceData, setCheckpointChoiceData] = useState(null);

  // Simple A/B choice state
  const [simpleABData, setSimpleABData] = useState(null);

  // Challenge modal state
  const [challengeData, setChallengeData] = useState(null);

  // Input modal state
  const [inputData, setInputData] = useState(null);

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

  // Pump status tracking - tracks active pump operations
  // { deviceIp: { type: 'cycle'|'duration', currentCycle, totalCycles, duration, startTime, endTime } }
  const [pumpStatus, setPumpStatus] = useState({});

  // Reconnect timer id (so it can be cleared on unmount to avoid orphaned sockets)
  const reconnectTimerRef = useRef(null);

  // Outbound message queue — buffers messages sent while the socket is not OPEN
  // so optimistic UI actions (e.g. character_inflate_stop) aren't silently dropped.
  const outboundQueueRef = useRef([]);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    // Short-circuit if a socket is already connecting or open
    if (ws.current && (ws.current.readyState === WebSocket.CONNECTING || ws.current.readyState === WebSocket.OPEN)) {
      return;
    }

    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
      // Flush any messages buffered while disconnected/reconnecting
      if (outboundQueueRef.current.length > 0) {
        console.log(`[WS] Flushing ${outboundQueueRef.current.length} buffered message(s)`);
        const queued = outboundQueueRef.current;
        outboundQueueRef.current = [];
        for (const msg of queued) {
          try {
            ws.current.send(JSON.stringify(msg));
          } catch (e) {
            console.error('[WS] Failed to flush buffered message:', e);
          }
        }
      }
    };

    ws.current.onclose = () => {
      console.log('[WS] Disconnected');
      setConnected(false);
      // Reconnect after delay; store the timer id so cleanup can cancel it
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(connectWebSocket, CONFIG.WS_RECONNECT_DELAY_MS);
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
        // Clear stale drafts if server session changed (new boot)
        if (data.serverSessionId) {
          const storedSessionId = sessionStorage.getItem('swelldreams-server-session');
          if (storedSessionId && storedSessionId !== data.serverSessionId) {
            // Server restarted - clear all drafts
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key && key.startsWith('swelldreams-draft-')) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(key => sessionStorage.removeItem(key));
            console.log('[Session] Server restarted - cleared', keysToRemove.length, 'draft(s)');
          }
          sessionStorage.setItem('swelldreams-server-session', data.serverSessionId);
        }
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

      case 'actors_update':
        setActors(data);
        break;

      case 'plays_update':
        setPlays(data);
        break;

      case 'device_warning':
        // Store warning for UI to display (e.g., unreachable devices)
        console.log('[AppContext] Device warning:', data.message);
        setSessionState(prev => ({
          ...prev,
          deviceWarning: data
        }));
        break;

      case 'ai_device_control':
        // AI controlled a device - dispatch event for toast notification
        window.dispatchEvent(new CustomEvent('ai_device_control', { detail: data }));
        break;

      case 'attribute_rolls':
        // Attribute roll results - dispatch event for toast notification
        window.dispatchEvent(new CustomEvent('attribute_rolls', { detail: data }));
        break;

      case 'flows_update':
        setFlows(data);
        break;

      case 'capacity_update':
        setSessionState(prev => ({
          ...prev,
          capacity: data.capacity,
          preInflationGateMet: data.preInflationGateMet ?? prev.preInflationGateMet
        }));
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

      case 'pump_mode_update':
        setSessionState(prev => ({ ...prev, pumpType: data.pumpType, pumpInit: data.pumpInit }));
        break;

      case 'pump_vars_update':
        setSessionState(prev => ({ ...prev, bulbCurrent: data.bulbCurrent, bikeCurrent: data.bikeCurrent }));
        break;

      case 'auto_capacity_update':
        setSessionState(prev => ({
          ...prev,
          capacity: data.capacity,
          pain: data.pain,
          isOverInflating: data.isOverInflating,
          preInflationGateMet: data.preInflationGateMet ?? prev.preInflationGateMet
        }));
        break;

      case 'character_capacity_update':
        setSessionState(prev => ({
          ...prev,
          characterCapacity: data.characterCapacity,
          characterInflating: data.inflating ?? prev.characterInflating,
          characterInflateElapsed: data.elapsed ?? prev.characterInflateElapsed
        }));
        break;

      case 'character_inflate_state':
        setSessionState(prev => ({
          ...prev,
          characterInflating: data.active,
          characterInflateElapsed: data.elapsed || 0,
          characterCapacity: data.characterCapacity ?? prev.characterCapacity
        }));
        window.dispatchEvent(new CustomEvent('character_inflate_state', { detail: data }));
        break;

      case 'character_burst':
        setSessionState(prev => ({
          ...prev,
          characterCapacity: data.characterCapacity,
          characterInflating: false,
          characterInflateElapsed: 0
        }));
        break;

      case 'capacity_modifier_update':
        setSessionState(prev => ({ ...prev, capacityModifier: data.capacityModifier }));
        setSettings(prev => ({
          ...prev,
          globalCharacterControls: {
            ...prev?.globalCharacterControls,
            autoCapacityMultiplier: data.capacityModifier
          }
        }));
        break;

      case 'pump_runtime':
        // Informational - actual capacity comes via auto_capacity_update
        break;

      case 'session_reset':
        setSessionState(data);
        setMessages([]);
        setSessionLoading(false);
        // Clear all flow modals/popups on session reset
        setPlayerChoiceData(null);
        setChooseMultiData(null);
        setCheckpointChoiceData(null);
        setSimpleABData(null);
        setChallengeData(null);
        setInputData(null);
        break;

      case 'session_loaded':
        setSessionState(data);
        setMessages(data.chatHistory || []);
        // Clear all flow modals/popups on new session
        setPlayerChoiceData(null);
        setChooseMultiData(null);
        setCheckpointChoiceData(null);
        setSimpleABData(null);
        setChallengeData(null);
        setInputData(null);
        break;

      case 'flow_assignments_update':
        setSessionState(prev => ({ ...prev, flowAssignments: data }));
        break;

      case 'player_choice':
        setPlayerChoiceData(data);
        break;

      case 'choose_multi':
        setChooseMultiData(data);
        break;

      case 'checkpoint_choice':
        setCheckpointChoiceData(data);
        break;

      case 'checkpoint_choice_clear':
        setCheckpointChoiceData(null);
        break;

      case 'member_mute_update':
        setSessionState(prev => ({ ...prev, mutedMembers: data.mutedMembers || [] }));
        break;

      case 'simple_ab':
        setSimpleABData(data);
        break;

      case 'challenge':
        setChallengeData(data);
        break;

      case 'input_request':
        setInputData(data);
        break;

      case 'message_updated':
        setMessages(prev => prev.map(m => m.id === data.id ? data : m));
        break;

      case 'message_deleted':
        setMessages(prev => prev.filter(m => m.id !== data.id));
        break;

      case 'skin_changed': {
        const skin = data.skin;
        if (skin) {
          const root = document.documentElement;
          // Default skin: strip all variables so original CSS takes over
          if (skin.id === 'swelldreams-default' || data.skinId === 'swelldreams-default') {
            ['--skin-player-outline','--skin-player-bg','--skin-player-text','--skin-player-font','--skin-player-font-size',
             '--skin-char-outline','--skin-char-bg','--skin-char-text','--skin-char-font','--skin-char-font-size',
             '--skin-system-outline','--skin-system-bg','--skin-system-text','--skin-system-font','--skin-system-font-size',
             '--skin-header','--skin-tab','--skin-ui-font','--skin-chat-bg','--skin-modal-bg',
             '--skin-input-bg','--skin-input-font','--skin-input-text','--skin-input-font-size',
             '--skin-btn-face','--skin-arrow-color',
             '--skin-frame-btn-face','--skin-frame-btn-text',
             '--skin-char-action-menu-bg','--skin-char-action-btn-face','--skin-char-action-btn-text',
             '--skin-persona-action-menu-bg','--skin-persona-action-btn-face','--skin-persona-action-btn-text',
             '--skin-left-sidebar-bg','--skin-left-sidebar-img','--skin-right-sidebar-bg','--skin-right-sidebar-img',
             '--skin-scene-details-bg','--skin-scene-details-text','--skin-scene-details-font','--skin-scene-details-font-size',
             '--skin-pumpable-color','--skin-trim-topper','--skin-trim-center','--skin-trim-footer','--skin-name-backing',
             '--skin-header-text','--skin-section-header','--skin-section-bg','--skin-section-font',
             '--skin-central-menu-bg','--skin-selector-desc','--skin-bubble-opacity','--skin-action-text'
            ].forEach(v => root.style.removeProperty(v));
            break;
          }
          root.style.setProperty('--skin-player-outline', skin.playerOutlineColor || '#00ff88');
          root.style.setProperty('--skin-player-bg', skin.playerBubbleBg || 'rgba(31, 41, 55, 0.75)');
          root.style.setProperty('--skin-player-text', skin.playerTextColor || '#f3f4f6');
          root.style.setProperty('--skin-player-font', skin.playerFont || 'inherit');
          root.style.setProperty('--skin-char-outline', skin.charOutlineColor || '#ff6b6b');
          root.style.setProperty('--skin-char-bg', skin.charBubbleBg || 'rgba(22, 33, 62, 0.75)');
          root.style.setProperty('--skin-char-text', skin.charTextColor || '#ffffff');
          root.style.setProperty('--skin-char-font', skin.charFont || 'inherit');
          root.style.setProperty('--skin-system-outline', skin.systemOutlineColor || 'rgba(100, 149, 237, 0.5)');
          root.style.setProperty('--skin-system-bg', skin.systemBubbleBg || 'rgba(30, 60, 114, 0.85)');
          root.style.setProperty('--skin-system-text', skin.systemTextColor || 'rgba(200, 220, 255, 0.95)');
          root.style.setProperty('--skin-system-font', skin.systemFont || 'inherit');
          root.style.setProperty('--skin-header', skin.uiHeaderColor || 'linear-gradient(180deg, #1e2a4a 0%, #16213e 40%, #0d1526 100%)');
          root.style.setProperty('--skin-tab', skin.uiTabColor || 'linear-gradient(180deg, #2a2d31 0%, #1a1c1f 100%)');
          if (skin.backgroundImage) root.style.setProperty('--skin-chat-bg', `url("${skin.backgroundImage}")`);
          if (skin.uiModalBgImage) root.style.setProperty('--skin-modal-bg', `url("${skin.uiModalBgImage}")`);
          if (skin.inputBoxBg) root.style.setProperty('--skin-input-bg', skin.inputBoxBg);
          if (skin.inputBoxFont) root.style.setProperty('--skin-input-font', skin.inputBoxFont);
          if (skin.inputBoxTextColor) root.style.setProperty('--skin-input-text', skin.inputBoxTextColor);
          if (skin.inputBoxFontSize) root.style.setProperty('--skin-input-font-size', skin.inputBoxFontSize + 'px');
          if (skin.inputButtonFaceColor) root.style.setProperty('--skin-btn-face', skin.inputButtonFaceColor);
          if (skin.historyArrowColor) root.style.setProperty('--skin-arrow-color', skin.historyArrowColor);
          if (skin.frameBtnFaceColor) root.style.setProperty('--skin-frame-btn-face', skin.frameBtnFaceColor);
          if (skin.frameBtnTextColor) root.style.setProperty('--skin-frame-btn-text', skin.frameBtnTextColor);
          if (skin.charActionMenuBg) root.style.setProperty('--skin-char-action-menu-bg', skin.charActionMenuBg);
          if (skin.charActionBtnFace) root.style.setProperty('--skin-char-action-btn-face', skin.charActionBtnFace);
          if (skin.charActionBtnText) root.style.setProperty('--skin-char-action-btn-text', skin.charActionBtnText);
          if (skin.personaActionMenuBg) root.style.setProperty('--skin-persona-action-menu-bg', skin.personaActionMenuBg);
          if (skin.personaActionBtnFace) root.style.setProperty('--skin-persona-action-btn-face', skin.personaActionBtnFace);
          if (skin.personaActionBtnText) root.style.setProperty('--skin-persona-action-btn-text', skin.personaActionBtnText);
          if (skin.leftSidebarBg) root.style.setProperty('--skin-left-sidebar-bg', skin.leftSidebarBg);
          root.style.setProperty('--skin-left-sidebar-img', skin.leftSidebarBgImage ? `url("${skin.leftSidebarBgImage}")` : 'none');
          if (skin.rightSidebarBg) root.style.setProperty('--skin-right-sidebar-bg', skin.rightSidebarBg);
          root.style.setProperty('--skin-right-sidebar-img', skin.rightSidebarBgImage ? `url("${skin.rightSidebarBgImage}")` : 'none');
          if (skin.sceneDetailsBg) root.style.setProperty('--skin-scene-details-bg', skin.sceneDetailsBg);
          if (skin.sceneDetailsText) root.style.setProperty('--skin-scene-details-text', skin.sceneDetailsText);
          if (skin.sceneDetailsFont) root.style.setProperty('--skin-scene-details-font', skin.sceneDetailsFont);
          if (skin.sceneDetailsFontSize) root.style.setProperty('--skin-scene-details-font-size', skin.sceneDetailsFontSize + 'px');
          if (skin.pumpableColor) root.style.setProperty('--skin-pumpable-color', skin.pumpableColor);
          if (skin.trimTopperColor) root.style.setProperty('--skin-trim-topper', skin.trimTopperColor);
          if (skin.trimCenterColor) root.style.setProperty('--skin-trim-center', skin.trimCenterColor);
          if (skin.trimFooterColor) root.style.setProperty('--skin-trim-footer', skin.trimFooterColor);
          if (!skin.nameBackingTransparent && skin.nameBackingColor) root.style.setProperty('--skin-name-backing', skin.nameBackingColor);
          if (skin.uiHeaderTextColor) root.style.setProperty('--skin-header-text', skin.uiHeaderTextColor);
          if (skin.uiSectionHeaderColor) root.style.setProperty('--skin-section-header', skin.uiSectionHeaderColor);
          if (skin.uiSectionBgColor) root.style.setProperty('--skin-section-bg', skin.uiSectionBgColor);
          if (skin.uiSectionFontColor) root.style.setProperty('--skin-section-font', skin.uiSectionFontColor);
          if (!skin.uiCentralMenuTransparent && skin.uiCentralMenuBg) root.style.setProperty('--skin-central-menu-bg', skin.uiCentralMenuBg);
          if (skin.uiSelectorDescFontColor) root.style.setProperty('--skin-selector-desc', skin.uiSelectorDescFontColor);
          if (skin.actionTextColor) root.style.setProperty('--skin-action-text', skin.actionTextColor);
          if (skin.bubbleOpacity !== undefined && skin.bubbleOpacity !== null) {
            root.style.setProperty('--skin-bubble-opacity', skin.bubbleOpacity);
          } else {
            root.style.removeProperty('--skin-bubble-opacity');
          }
        }
        break;
      }

      case 'chat_cleared':
        if (data.screenOnly) {
          // Screen-only clear: hide messages visually but keep state
          setMessages([]);
        } else {
          // Replace messages with whatever the server sent (may include summary bubble)
          setMessages(data.messages || []);
        }
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

      case 'chat_validation_error':
        // Dispatch event for Chat.js to show error toast
        window.dispatchEvent(new CustomEvent('chat_validation_error', {
          detail: {
            reason: data.reason,
            message: data.message
          }
        }));
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

      case 'story_progression_generating':
        window.dispatchEvent(new CustomEvent('story_progression_generating', { detail: data }));
        break;

      case 'story_progression_generating_done':
        window.dispatchEvent(new CustomEvent('story_progression_generating_done', {}));
        break;

      case 'story_progression_suggestions':
        window.dispatchEvent(new CustomEvent('story_progression_suggestions', { detail: data }));
        break;

      case 'error':
        console.error('[WS] Server error:', data.message, data.error);
        // Dispatch event for UI to display the error
        window.dispatchEvent(new CustomEvent('llm_error', {
          detail: { message: data.message, error: data.error }
        }));
        break;

      case 'test_step':
        // Dispatch individual test step for real-time console streaming
        window.dispatchEvent(new CustomEvent('test_step', { detail: data }));
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
        // Track device turning on (duration-based)
        setPumpStatus(prev => {
          const existingStatus = prev[data.ip];

          // Don't overwrite if this is part of a cycle - cycle_on will update it
          if (existingStatus && existingStatus.type === 'cycle') {
            return prev; // Keep the cycle status
          }

          const statusEntry = {
            type: 'duration',
            startTime: Date.now(),
            device: data.device
          };

          // If timer-based, calculate endTime for countdown
          if (data.durationInfo?.untilType === 'timer' && data.durationInfo?.untilValue > 0) {
            statusEntry.endTime = Date.now() + (data.durationInfo.untilValue * 1000);
          }

          return {
            ...prev,
            [data.ip]: statusEntry
          };
        });
        console.log('[WS] Device ON:', data);
        break;

      case 'device_off':
        // Clear pump status when device turns off (unless it's part of an active cycle or pulse)
        setPumpStatus(prev => {
          const status = prev[data.ip];
          // Don't clear if this is part of a cycle or pulse - their _off handlers will handle it
          if (status && (status.type === 'cycle' || status.type === 'pulse')) {
            return prev; // Keep the cycle/pulse status visible
          }
          // For non-cycle/pulse operations, clear the status
          const next = { ...prev };
          delete next[data.ip];
          return next;
        });
        console.log('[WS] Device OFF:', data);
        break;

      case 'cycle_on':
        // Track cycle start
        setPumpStatus(prev => ({
          ...prev,
          [data.ip]: {
            type: 'cycle',
            currentCycle: data.cycle,
            totalCycles: data.totalCycles,
            duration: data.duration,
            startTime: Date.now(),
            endTime: Date.now() + (data.duration * 1000),
            device: data.device
          }
        }));
        console.log('[WS] Cycle ON:', data);
        break;

      case 'cycle_off':
        // Cycle turned off - clear the duration timer but keep cycle info
        setPumpStatus(prev => {
          const status = prev[data.ip];
          if (status) {
            return {
              ...prev,
              [data.ip]: {
                ...status,
                endTime: null
              }
            };
          }
          return prev;
        });
        console.log('[WS] Cycle OFF:', data);
        break;

      case 'cycle_complete':
        // Clear pump status when cycle completes
        setPumpStatus(prev => {
          const next = { ...prev };
          delete next[data.ip];
          return next;
        });
        console.log('[WS] Cycle complete:', data);
        break;

      case 'pulse_on':
        // Track pulse start - update currentPulse
        setPumpStatus(prev => ({
          ...prev,
          [data.ip]: {
            type: 'pulse',
            currentPulse: data.pulse,
            totalPulses: data.totalPulses,
            device: data.device
          }
        }));
        console.log('[WS] Pulse ON:', data);
        break;

      case 'pulse_off':
        // Pulse turned off - keep status visible with updated count
        console.log('[WS] Pulse OFF:', data);
        break;

      case 'pulse_complete':
        // Clear pump status when all pulses complete
        setPumpStatus(prev => {
          const next = { ...prev };
          delete next[data.ip];
          return next;
        });
        console.log('[WS] Pulse complete:', data);
        break;

      case 'emergency_stop':
        console.warn('[WS] Emergency stop triggered:', data);
        // Clear any active challenges, choices, or modals to unblock the page
        setChallengeData(null);
        setPlayerChoiceData(null);
        setChooseMultiData(null);
        setCheckpointChoiceData(null);
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

  // Send WebSocket message. If the socket is not OPEN, buffer the message and
  // flush it on reconnect so optimistic UI updates don't silently desync.
  const sendWsMessage = useCallback((type, data) => {
    const message = { type, data };
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
      return true;
    }
    console.warn(`[WS] Not connected — buffering message "${type}" to flush on reconnect`);
    outboundQueueRef.current.push(message);
    return false;
  }, []);

  // Send chat message
  const sendChatMessage = useCallback((content) => {
    sendWsMessage('chat_message', { content, sender: 'player' });
  }, [sendWsMessage]);

  // Start new session - clears UI immediately, shows loading while backend resets
  // Accepts optional initialValues: { capacity, pain, emotion, capacityModifier }
  const startNewSession = useCallback(async (initialValues = {}) => {
    const { capacity = 0, pain = 0, emotion = 'neutral', capacityModifier = 1.0 } = initialValues;

    // Immediately clear messages and show loading
    setMessages([]);
    setSessionLoading(true);
    // Reset states with initial values
    setSessionState(prev => ({
      ...prev,
      capacity,
      pain,
      emotion,
      capacityModifier,
      chatHistory: []
    }));
    // Call API - backend will send session_reset when done
    // Pass initial values to backend so it knows the starting state
    try {
      await apiFetch(`${API_BASE}/api/session/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialValues: { capacity, pain, emotion, capacityModifier } })
      });
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

  // Handle Choose Multi response — send all selected choice IDs; the backend
  // fires every selected branch in parallel.
  const handleChooseMulti = useCallback((selectedChoices) => {
    if (!chooseMultiData) return;

    sendWsMessage('choose_multi_response', {
      nodeId: chooseMultiData.nodeId,
      selectedIds: (selectedChoices || []).map(c => c.id)
    });

    setChooseMultiData(null);
  }, [chooseMultiData, sendWsMessage]);

  // Respond to a checkpoint injection player choice
  const respondCheckpointChoice = useCallback((choice) => {
    sendWsMessage('checkpoint_choice_response', { choiceId: choice.id });
    setCheckpointChoiceData(null);
  }, [sendWsMessage]);

  // Toggle whether a multichar member can speak this session
  const toggleMemberMute = useCallback((memberId, muted) => {
    sendWsMessage('toggle_member_mute', { memberId, muted });
  }, [sendWsMessage]);

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

  // Handle challenge result - sends back the result that determines flow path
  // Accepts either string (legacy: outputId) or object ({ outputId, rollTotal?, reels?, ... })
  const handleChallengeResult = useCallback((resultData) => {
    if (!challengeData) return;

    // Support both legacy string format and new object format
    const result = typeof resultData === 'object' ? resultData : { outputId: resultData };

    sendWsMessage('challenge_result', {
      nodeId: challengeData.nodeId,
      ...result  // Spread all result data (outputId, rollTotal, reels, segmentLabel, etc.)
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

  // Handle mid-game penalty/reward trigger - sends device action without ending challenge
  const handleChallengePenalty = useCallback((deviceId, duration, actionType) => {
    if (!deviceId) return;

    sendWsMessage('challenge_penalty', {
      deviceId,
      duration,
      actionType
    });
  }, [sendWsMessage]);

  // Handle input response - sends the value back to continue flow
  const handleInputResponse = useCallback((value) => {
    if (!inputData) return;

    sendWsMessage('input_response', {
      nodeId: inputData.nodeId,
      value: value
    });

    setInputData(null);
  }, [inputData, sendWsMessage]);

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

    generateText: (options) => apiFetch(`${API_BASE}/api/llm/generate`, {
      method: 'POST',
      body: JSON.stringify(options),
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

    // Trigger Sets
    getTriggerSets: () => apiFetch(`${API_BASE}/api/trigger-sets`),
    createTriggerSet: (data) => apiFetch(`${API_BASE}/api/trigger-sets`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    updateTriggerSet: (id, data) => apiFetch(`${API_BASE}/api/trigger-sets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
    deleteTriggerSet: (id) => apiFetch(`${API_BASE}/api/trigger-sets/${id}`, {
      method: 'DELETE'
    }),
    fireTriggerSet: (id) => apiFetch(`${API_BASE}/api/trigger-sets/${id}/fire`, {
      method: 'POST'
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

    // Actors (ScreenPlay)
    getActors: () => apiFetch(`${API_BASE}/api/actors`),

    getActor: (id) => apiFetch(`${API_BASE}/api/actors/${id}`),

    createActor: (data) => apiFetch(`${API_BASE}/api/actors`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateActor: (id, data) => apiFetch(`${API_BASE}/api/actors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteActor: (id) => apiFetch(`${API_BASE}/api/actors/${id}`, {
      method: 'DELETE'
    }),

    // Plays (ScreenPlay)
    getPlays: () => apiFetch(`${API_BASE}/api/plays`),

    getPlay: (id) => apiFetch(`${API_BASE}/api/plays/${id}`),

    createPlay: (data) => apiFetch(`${API_BASE}/api/plays`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updatePlay: (id, data) => apiFetch(`${API_BASE}/api/plays/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deletePlay: (id) => apiFetch(`${API_BASE}/api/plays/${id}`, {
      method: 'DELETE'
    }),

    // Media Images
    getMediaImages: () => apiFetch(`${API_BASE}/api/media/images`),

    createMediaImage: (data) => apiFetch(`${API_BASE}/api/media/images`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

    updateMediaImage: (id, data) => apiFetch(`${API_BASE}/api/media/images/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteMediaImage: (id) => apiFetch(`${API_BASE}/api/media/images/${id}`, {
      method: 'DELETE'
    }),

    // Image folders
    getImageFolders: () => apiFetch(`${API_BASE}/api/media/images/folders`),
    createImageFolder: (path) => apiFetch(`${API_BASE}/api/media/images/folders`, {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
    renameImageFolder: (oldPath, newPath) => apiFetch(`${API_BASE}/api/media/images/folders`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newPath })
    }),
    deleteImageFolder: (path) => apiFetch(`${API_BASE}/api/media/images/folders/${encodeURIComponent(path)}`, {
      method: 'DELETE'
    }),

    // Media Videos (uses FormData for file upload)
    getMediaVideos: () => apiFetch(`${API_BASE}/api/media/videos`),

    uploadMediaVideo: async (file, tag, description, folder = null) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tag', tag);
      formData.append('description', description);
      if (folder) formData.append('folder', folder);
      const response = await fetch(`${API_BASE}/api/media/videos`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
      return response.json();
    },

    updateMediaVideo: (id, data) => apiFetch(`${API_BASE}/api/media/videos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteMediaVideo: (id) => apiFetch(`${API_BASE}/api/media/videos/${id}`, {
      method: 'DELETE'
    }),

    // Video folders
    getVideoFolders: () => apiFetch(`${API_BASE}/api/media/videos/folders`),
    createVideoFolder: (path) => apiFetch(`${API_BASE}/api/media/videos/folders`, {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
    renameVideoFolder: (oldPath, newPath) => apiFetch(`${API_BASE}/api/media/videos/folders`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newPath })
    }),
    deleteVideoFolder: (path) => apiFetch(`${API_BASE}/api/media/videos/folders/${encodeURIComponent(path)}`, {
      method: 'DELETE'
    }),

    // Media Audio (uses FormData for file upload)
    getMediaAudio: () => apiFetch(`${API_BASE}/api/media/audios`),

    uploadMediaAudio: async (file, tag, description, folder = null) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tag', tag);
      formData.append('description', description);
      if (folder) formData.append('folder', folder);
      const response = await fetch(`${API_BASE}/api/media/audios`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
      return response.json();
    },

    updateMediaAudio: (id, data) => apiFetch(`${API_BASE}/api/media/audios/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),

    deleteMediaAudio: (id) => apiFetch(`${API_BASE}/api/media/audios/${id}`, {
      method: 'DELETE'
    }),

    // Audio folders
    getAudioFolders: () => apiFetch(`${API_BASE}/api/media/audios/folders`),
    createAudioFolder: (path) => apiFetch(`${API_BASE}/api/media/audios/folders`, {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
    renameAudioFolder: (oldPath, newPath) => apiFetch(`${API_BASE}/api/media/audios/folders`, {
      method: 'PUT',
      body: JSON.stringify({ oldPath, newPath })
    }),
    deleteAudioFolder: (path) => apiFetch(`${API_BASE}/api/media/audios/folders/${encodeURIComponent(path)}`, {
      method: 'DELETE'
    }),

    // Media lookup by tag (for chat media variables)
    lookupMediaByTag: (type, tag) => apiFetch(
      `${API_BASE}/api/media/lookup?type=${encodeURIComponent(type)}&tag=${encodeURIComponent(tag)}`
    ),

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

    checkDeviceReachability: () => apiFetch(`${API_BASE}/api/devices/check-reachability`, {
      method: 'POST',
      timeout: 60000 // Allow up to 60s for checking all devices
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

    // Wyze devices
    connectWyze: (email, password, keyId, apiKey, totpKey = null) => apiFetch(`${API_BASE}/api/wyze/connect`, {
      method: 'POST',
      body: JSON.stringify({ email, password, keyId, apiKey, totpKey })
    }),

    getWyzeStatus: () => apiFetch(`${API_BASE}/api/wyze/status`),

    disconnectWyze: () => apiFetch(`${API_BASE}/api/wyze/disconnect`, {
      method: 'POST'
    }),

    scanWyzeDevices: () => apiFetch(`${API_BASE}/api/wyze/devices`),

    wyzeDeviceOn: (deviceId, model) => apiFetch(`${API_BASE}/api/wyze/devices/${encodeURIComponent(deviceId)}/on`, {
      method: 'POST',
      body: JSON.stringify({ model })
    }),

    wyzeDeviceOff: (deviceId, model) => apiFetch(`${API_BASE}/api/wyze/devices/${encodeURIComponent(deviceId)}/off`, {
      method: 'POST',
      body: JSON.stringify({ model })
    }),

    getWyzeDeviceState: (deviceId) => apiFetch(
      `${API_BASE}/api/wyze/devices/${encodeURIComponent(deviceId)}/state`
    ),

    // Tapo devices (TP-Link Tapo smart plugs)
    connectTapo: (email, password) => apiFetch(`${API_BASE}/api/tapo/connect`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

    getTapoStatus: () => apiFetch(`${API_BASE}/api/tapo/status`),

    disconnectTapo: () => apiFetch(`${API_BASE}/api/tapo/disconnect`, {
      method: 'POST'
    }),

    scanTapoDevices: () => apiFetch(`${API_BASE}/api/tapo/devices`),

    tapoDeviceOn: (ip) => apiFetch(`${API_BASE}/api/tapo/devices/${encodeURIComponent(ip)}/on`, {
      method: 'POST'
    }),

    tapoDeviceOff: (ip) => apiFetch(`${API_BASE}/api/tapo/devices/${encodeURIComponent(ip)}/off`, {
      method: 'POST'
    }),

    getTapoDeviceState: (ip) => apiFetch(
      `${API_BASE}/api/tapo/devices/${encodeURIComponent(ip)}/state`
    ),

    getTapoDeviceInfo: (ip) => apiFetch(
      `${API_BASE}/api/tapo/devices/${encodeURIComponent(ip)}/info`
    ),

    // Kasa 1.1.x+ devices (TP-Link Kasa on KLAP firmware 1.1.x and newer)
    connectKasaKlap: (email, password) => apiFetch(`${API_BASE}/api/kasa-klap/connect`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

    getKasaKlapStatus: () => apiFetch(`${API_BASE}/api/kasa-klap/status`),

    disconnectKasaKlap: () => apiFetch(`${API_BASE}/api/kasa-klap/disconnect`, {
      method: 'POST'
    }),

    scanKasaKlapDevices: (timeout = 5) => apiFetch(
      `${API_BASE}/api/kasa-klap/devices?timeout=${encodeURIComponent(timeout)}`
    ),

    kasaKlapDeviceOn: (ip) => apiFetch(`${API_BASE}/api/kasa-klap/devices/${encodeURIComponent(ip)}/on`, {
      method: 'POST'
    }),

    kasaKlapDeviceOff: (ip) => apiFetch(`${API_BASE}/api/kasa-klap/devices/${encodeURIComponent(ip)}/off`, {
      method: 'POST'
    }),

    getKasaKlapDeviceState: (ip) => apiFetch(
      `${API_BASE}/api/kasa-klap/devices/${encodeURIComponent(ip)}/state`
    ),

    getKasaKlapDeviceInfo: (ip) => apiFetch(
      `${API_BASE}/api/kasa-klap/devices/${encodeURIComponent(ip)}/info`
    ),

    // Checkpoint profiles
    getCheckpointProfiles: () => apiFetch(`${API_BASE}/api/checkpoint-profiles`),
    createCheckpointProfile: (type, name, checkpoints, checkpointTriggers) => apiFetch(`${API_BASE}/api/checkpoint-profiles`, {
      method: 'POST', body: JSON.stringify({ type, name, checkpoints, checkpointTriggers })
    }),
    updateCheckpointProfile: (id, type, name, checkpoints, checkpointTriggers) => apiFetch(`${API_BASE}/api/checkpoint-profiles/${id}`, {
      method: 'PUT', body: JSON.stringify({ type, name, checkpoints, checkpointTriggers })
    }),
    deleteCheckpointProfile: (id, type) => apiFetch(`${API_BASE}/api/checkpoint-profiles/${id}?type=${type}`, {
      method: 'DELETE'
    }),
    // Persona checkpoint profiles (separate from character)
    getPersonaCheckpointProfiles: () => apiFetch(`${API_BASE}/api/persona-checkpoint-profiles`),
    createPersonaCheckpointProfile: (type, name, checkpoints, checkpointTriggers) => apiFetch(`${API_BASE}/api/persona-checkpoint-profiles`, {
      method: 'POST', body: JSON.stringify({ type, name, checkpoints, checkpointTriggers })
    }),
    updatePersonaCheckpointProfile: (id, type, name, checkpoints, checkpointTriggers) => apiFetch(`${API_BASE}/api/persona-checkpoint-profiles/${id}`, {
      method: 'PUT', body: JSON.stringify({ type, name, checkpoints, checkpointTriggers })
    }),
    deletePersonaCheckpointProfile: (id, type) => apiFetch(`${API_BASE}/api/persona-checkpoint-profiles/${id}?type=${type}`, {
      method: 'DELETE'
    }),

    // Trigger Trees (global nested-block library; assignable/forkable into card scope refs)
    getTriggerTrees: () => apiFetch(`${API_BASE}/api/trigger-trees`),
    createTriggerTree: (name, nodes, tag, source) => apiFetch(`${API_BASE}/api/trigger-trees`, {
      method: 'POST', body: JSON.stringify({ name, nodes, tag, source })
    }),
    updateTriggerTree: (id, patch) => apiFetch(`${API_BASE}/api/trigger-trees/${id}`, {
      method: 'PUT', body: JSON.stringify(patch)
    }),
    deleteTriggerTree: (id) => apiFetch(`${API_BASE}/api/trigger-trees/${id}`, {
      method: 'DELETE'
    }),
    exportTriggerTree: (id) => apiFetch(`${API_BASE}/api/trigger-trees/${id}/export`),
    importTriggerTree: (envelope) => apiFetch(`${API_BASE}/api/trigger-trees/import`, {
      method: 'POST', body: JSON.stringify(envelope)
    }),

    // Instructor profiles (named system-prompt briefs assignable to Instructor cards)
    getInstructorProfiles: () => apiFetch(`${API_BASE}/api/instructor-profiles`),
    createInstructorProfile: (name, prompt) => apiFetch(`${API_BASE}/api/instructor-profiles`, {
      method: 'POST', body: JSON.stringify({ name, prompt })
    }),
    updateInstructorProfile: (id, name, prompt) => apiFetch(`${API_BASE}/api/instructor-profiles/${id}`, {
      method: 'PUT', body: JSON.stringify({ name, prompt })
    }),
    deleteInstructorProfile: (id) => apiFetch(`${API_BASE}/api/instructor-profiles/${id}`, {
      method: 'DELETE'
    }),

    // Instructor library (keyword-triggered term groups assignable to Instructor cards)
    getInstructorLibrary: () => apiFetch(`${API_BASE}/api/instructor-library`),
    createInstructorTermGroup: (name, terms) => apiFetch(`${API_BASE}/api/instructor-library`, {
      method: 'POST', body: JSON.stringify({ name, terms })
    }),
    updateInstructorTermGroup: (id, name, terms) => apiFetch(`${API_BASE}/api/instructor-library/${id}`, {
      method: 'PUT', body: JSON.stringify({ name, terms })
    }),
    deleteInstructorTermGroup: (id) => apiFetch(`${API_BASE}/api/instructor-library/${id}`, {
      method: 'DELETE'
    }),

    // Global dictionary (always-on, global term definitions)
    getDictionary: () => apiFetch(`${API_BASE}/api/dictionary`),
    createDictionaryGroup: (name, terms, enabled) => apiFetch(`${API_BASE}/api/dictionary`, {
      method: 'POST', body: JSON.stringify({ name, terms, enabled })
    }),
    updateDictionaryGroup: (id, payload) => apiFetch(`${API_BASE}/api/dictionary/${id}`, {
      method: 'PUT', body: JSON.stringify(payload)
    }),
    deleteDictionaryGroup: (id) => apiFetch(`${API_BASE}/api/dictionary/${id}`, {
      method: 'DELETE'
    }),

    // Home Assistant devices (bridge for Tapo and other HA-managed devices)
    connectHomeAssistant: (url, token) => apiFetch(`${API_BASE}/api/homeassistant/connect`, {
      method: 'POST',
      body: JSON.stringify({ url, token })
    }),

    getHomeAssistantStatus: () => apiFetch(`${API_BASE}/api/homeassistant/status`),

    disconnectHomeAssistant: () => apiFetch(`${API_BASE}/api/homeassistant/disconnect`, {
      method: 'POST'
    }),

    scanHomeAssistantDevices: () => apiFetch(`${API_BASE}/api/homeassistant/devices`),

    haDeviceOn: (entityId) => apiFetch(`${API_BASE}/api/homeassistant/devices/${encodeURIComponent(entityId)}/on`, {
      method: 'POST'
    }),

    haDeviceOff: (entityId) => apiFetch(`${API_BASE}/api/homeassistant/devices/${encodeURIComponent(entityId)}/off`, {
      method: 'POST'
    }),

    getHaDeviceState: (entityId) => apiFetch(
      `${API_BASE}/api/homeassistant/devices/${encodeURIComponent(entityId)}/state`
    ),

    getHaDeviceInfo: (entityId) => apiFetch(
      `${API_BASE}/api/homeassistant/devices/${encodeURIComponent(entityId)}/info`
    ),

    // Matter devices (universal smart home protocol)
    commissionMatterDevice: (pairingCode, deviceName = null) => apiFetch(
      `${API_BASE}/api/matter/commission`,
      {
        method: 'POST',
        body: JSON.stringify({ pairingCode, deviceName })
      }
    ),

    getMatterDevices: () => apiFetch(`${API_BASE}/api/matter/devices`),

    matterDeviceOn: (deviceId) => apiFetch(
      `${API_BASE}/api/matter/devices/${encodeURIComponent(deviceId)}/on`,
      { method: 'POST' }
    ),

    matterDeviceOff: (deviceId) => apiFetch(
      `${API_BASE}/api/matter/devices/${encodeURIComponent(deviceId)}/off`,
      { method: 'POST' }
    ),

    getMatterDeviceState: (deviceId) => apiFetch(
      `${API_BASE}/api/matter/devices/${encodeURIComponent(deviceId)}/state`
    ),

    getMatterStatus: () => apiFetch(`${API_BASE}/api/matter/status`),

    initializeMatter: () => apiFetch(
      `${API_BASE}/api/matter/initialize`,
      { method: 'POST' }
    ),

    startMatterServer: () => apiFetch(
      `${API_BASE}/api/matter/server/start`,
      { method: 'POST' }
    ),

    stopMatterServer: () => apiFetch(
      `${API_BASE}/api/matter/server/stop`,
      { method: 'POST' }
    ),

    setMatterAutoStart: (enabled) => apiFetch(
      `${API_BASE}/api/matter/server/autostart`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled })
      }
    ),

    // Simulation status
    getSimulationStatus: () => apiFetch(`${API_BASE}/api/simulation-status`),

    // Flows
    getFlows: () => apiFetch(`${API_BASE}/api/flows`),

    getFlow: (id) => apiFetch(`${API_BASE}/api/flows/${id}`),

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
    api.getConnectionProfiles().then(setConnectionProfiles).catch(console.error);
    api.getActors().then(setActors).catch(console.error);
    api.getPlays().then(setPlays).catch(console.error);
    fetchSimulationStatus();

    return () => {
      // Cancel any pending reconnect timer to avoid orphaned sockets
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (ws.current) {
        ws.current.onclose = null; // prevent reconnect during cleanup
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
          let models = [];

          // First check if we have cached models
          const cachedData = await apiFetch(`${API_BASE}/api/openrouter/models`);
          if (cachedData.models && cachedData.models.length > 0) {
            console.log('[AppContext] OpenRouter models already cached');
            models = cachedData.models;
          } else {
            // If not cached, connect to OpenRouter
            console.log('[AppContext] Auto-connecting to OpenRouter...');
            const data = await apiFetch(`${API_BASE}/api/openrouter/connect`, {
              method: 'POST',
              body: JSON.stringify({ apiKey: settings.llm.openRouterApiKey })
            });
            if (data.success) {
              console.log(`[AppContext] OpenRouter connected, ${data.models.length} models available`);
              models = data.models;
            }
          }

          // Validate that the user's selected model is still available
          const selectedModel = settings?.llm?.openRouterModel;
          if (selectedModel && models.length > 0) {
            const modelExists = models.some(m => m.id === selectedModel);
            if (!modelExists) {
              console.warn(`[AppContext] Selected OpenRouter model "${selectedModel}" is no longer available!`);

              // Clear the model from settings
              try {
                await apiFetch(`${API_BASE}/api/settings/llm`, {
                  method: 'PUT',
                  body: JSON.stringify({ openRouterModel: '' })
                });
                console.log('[AppContext] Cleared unavailable model from settings');
              } catch (clearErr) {
                console.error('[AppContext] Failed to clear model from settings:', clearErr);
              }

              // Alert the user
              window.dispatchEvent(new CustomEvent('model_unavailable', {
                detail: {
                  modelId: selectedModel,
                  message: `The model "${selectedModel}" is no longer available on OpenRouter. Please select a new model in Settings > Model.`
                }
              }));
            }
          }
        } catch (e) {
          console.error('[AppContext] Failed to auto-connect to OpenRouter:', e.message);
        }
      }
    };
    autoConnectOpenRouter();
  }, [settings?.llm?.endpointStandard, settings?.llm?.openRouterApiKey, settings?.llm?.openRouterModel]);

  // Auto-connect to AI Horde when app loads if configured. Uses the reconnect
  // endpoint (stored key / anonymous) so the plaintext key isn't required here.
  useEffect(() => {
    const autoConnectHorde = async () => {
      if (settings?.llm?.endpointStandard !== 'aihorde') return;
      try {
        let models = [];
        const cachedData = await apiFetch(`${API_BASE}/api/horde/models`);
        if (cachedData.models && cachedData.models.length > 0) {
          models = cachedData.models;
        } else {
          const data = await apiFetch(`${API_BASE}/api/horde/reconnect`, { method: 'POST', body: '{}' });
          if (data.success) {
            console.log(`[AppContext] AI Horde connected, ${data.models.length} models available`);
            models = data.models;
          }
        }

        // Horde's model list only includes models with active workers and churns
        // constantly, so a momentarily-absent selection is NOT an error — the job
        // just queues until a worker picks it up (or the user chose "Any"). Log it,
        // but never raise the model_unavailable toast (that's for OpenRouter, where a
        // missing model is permanent). Raising it here read as "Horde disconnected".
        const selectedModel = settings?.llm?.hordeModel;
        if (selectedModel && models.length > 0 && !models.some(m => m.id === selectedModel)) {
          console.warn(`[AppContext] AI Horde model "${selectedModel}" has no workers online right now; it will queue or fall back to any worker.`);
        }
      } catch (e) {
        console.error('[AppContext] Failed to auto-connect to AI Horde:', e.message);
      }
    };
    autoConnectHorde();
  }, [settings?.llm?.endpointStandard, settings?.llm?.hordeModel]);

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
  }, [simulationRequired, controlMode, sendWsMessage]);

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
    connectionProfiles,

    // ScreenPlay data
    actors,
    setActors,
    plays,
    setPlays,

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
    chooseMultiData,
    handleChooseMulti,
    checkpointChoiceData,
    respondCheckpointChoice,
    toggleMemberMute,

    // Simple A/B Choice
    simpleABData,
    handleSimpleAB,

    // Challenge Modal
    challengeData,
    handleChallengeResult,
    handleChallengeCancel,
    handleChallengePenalty,

    // Input Modal
    inputData,
    handleInputResponse,

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

    // Pump Status (active pump operations)
    pumpStatus,

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
