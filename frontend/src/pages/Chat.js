import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useError } from '../context/ErrorContext';
import { API_BASE, CONFIG } from '../config';
import ConstantReminderModal from '../components/modals/ConstantReminderModal';
import { ChallengeModal } from '../components/modals/ChallengeModals';
import PlayerChoiceModal from '../components/modals/PlayerChoiceModal';
import InputModal from '../components/modals/InputModal';
import { substituteVariables } from '../utils/variableSubstitution';
import { getPortraitForCapacity } from '../utils/stagedPortraits';
import StatusBadges from '../components/StatusBadges';
import './Chat.css';

function Chat() {
  const { messages, sendChatMessage, sendWsMessage, characters, setCharacters, personas, settings, setSettings, sessionState, setSessionState, api, playerChoiceData, handlePlayerChoice, simpleABData, handleSimpleAB, challengeData, handleChallengeResult, handleChallengeCancel, handleChallengePenalty, inputData, handleInputResponse, devices, infiniteCycles, controlMode, setOnChatPage, sessionLoading, flowExecutions, connectionProfiles } = useApp();
  const { showError, showInfo, showWarning, showSuccess } = useError();
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [messageHistory, setMessageHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentDraft, setCurrentDraft] = useState('');
  const [rightColumnTab, setRightColumnTab] = useState('events');
  const [stopping, setStopping] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [devicesExpanded, setDevicesExpanded] = useState(false);
  const [actionPage, setActionPage] = useState(0);
  const ACTIONS_PER_PAGE = 8;

  // Persona button menu pagination
  const [personaActionPage, setPersonaActionPage] = useState(0);
  const PERSONA_ACTIONS_PER_PAGE = 6; // 2 columns x 3 rows

  // Mobile drawer state
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showMobileSessionModal, setShowMobileSessionModal] = useState(false);

  // Portrait visibility state (persisted to localStorage)
  const [personaHidden, setPersonaHidden] = useState(() => {
    return localStorage.getItem('swelldreams_persona_hidden') === 'true';
  });
  const [characterHidden, setCharacterHidden] = useState(() => {
    return localStorage.getItem('swelldreams_character_hidden') === 'true';
  });
  const closeDrawers = () => { setLeftDrawerOpen(false); setRightDrawerOpen(false); };
  const mobileMenuRef = useRef(null);
  const navigate = useNavigate();

  // Quick text state
  const [quickTexts, setQuickTexts] = useState([]);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [showQuickManageModal, setShowQuickManageModal] = useState(false);
  const [newQuickText, setNewQuickText] = useState('');
  const [editingQuickText, setEditingQuickText] = useState(null);
  const quickMenuRef = useRef(null);

  // Control panel state
  const [polledDeviceStates, setPolledDeviceStates] = useState({}); // { deviceKey: { state, relayState, lastUpdate } }
  const recentActionsRef = useRef({}); // { deviceKey: timestamp } - skip polling for recently actioned devices
  const pollingInProgressRef = useRef(false); // Guard against concurrent polling
  const devicesRef = useRef([]); // Stable reference to devices for polling

  // Helper to get unique device key (ip for TPLink singles, ip:childId for outlets, deviceId for Govee/Tuya)
  const getDeviceKey = (device) => {
    if (device.childId) {
      return `${device.ip}:${device.childId}`;
    }
    // Use deviceId for Govee/Tuya, ip for TPLink
    return device.deviceId || device.ip;
  };

  // Mark device as recently actioned (skip polling for 10 seconds)
  const markRecentAction = (deviceKey) => {
    recentActionsRef.current[deviceKey] = Date.now();
  };

  // Emergency stop alert state
  const [emergencyStopAlert, setEmergencyStopAlert] = useState(null);


  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const randomPopThresholdRef = useRef(null); // Stores random pop threshold for session

  // Check if LLM is configured
  const isLlmConfigured = () => {
    const llm = settings?.llm;
    if (!llm) return false;
    // Check for standard LLM URL or OpenRouter
    return llm.llmUrl || (llm.endpointStandard === 'openrouter' && llm.openRouterApiKey);
  };

  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  // Calculate effective pop threshold based on auto-pop settings
  const effectivePopThreshold = useMemo(() => {
    const globalControls = settings?.globalCharacterControls || {};

    // If over-inflation is disabled, POP at 100%
    if (!globalControls.allowOverInflation) {
      return 100;
    }

    // If auto-pop roleplay is disabled, use default (101 = never pop unless > 100)
    if (!globalControls.enableAutoPopRoleplay) {
      return 101;
    }

    // Fixed mode - use configured percentage
    if (globalControls.autoPopMode === 'fixed') {
      return globalControls.autoPopFixedPercent || 110;
    }

    // Random mode - generate once per session
    if (globalControls.autoPopMode === 'random') {
      if (randomPopThresholdRef.current === null) {
        const min = globalControls.autoPopRandomMin || 100;
        const max = globalControls.autoPopRandomMax || 150;
        randomPopThresholdRef.current = Math.floor(Math.random() * (max - min + 1)) + min;
      }
      return randomPopThresholdRef.current;
    }

    return 101; // Default fallback
  }, [settings?.globalCharacterControls]);

  // Memoized persona portrait based on capacity - changes automatically with staged portraits
  const personaPortrait = useMemo(() => {
    return getPortraitForCapacity(activePersona, sessionState.capacity || 0, effectivePopThreshold);
  }, [activePersona, sessionState.capacity, effectivePopThreshold]);

  // Reset action page when character changes
  useEffect(() => {
    setActionPage(0);
  }, [activeCharacter?.id]);

  // Reset persona action page when persona changes
  useEffect(() => {
    setPersonaActionPage(0);
  }, [activePersona?.id]);

  // Panel blocking - disable interactions when slide panel is open
  const isPanelBlocking = !!(playerChoiceData || challengeData);

  // Flow in progress - disable action buttons and guided buttons while flow is executing
  const flowInProgress = flowExecutions && flowExecutions.length > 0;

  // Portrait visibility toggles (persist to localStorage)
  const togglePersonaHidden = () => {
    setPersonaHidden(prev => {
      const newValue = !prev;
      localStorage.setItem('swelldreams_persona_hidden', String(newValue));
      return newValue;
    });
  };

  const toggleCharacterHidden = () => {
    setCharacterHidden(prev => {
      const newValue = !prev;
      localStorage.setItem('swelldreams_character_hidden', String(newValue));
      return newValue;
    });
  };

  // Variable substitution context
  const subContext = useMemo(() => ({
    playerName: activePersona?.displayName,
    characterName: activeCharacter?.name,
    sessionState
  }), [activePersona?.displayName, activeCharacter?.name, sessionState]);

  // Helper to get active welcome message
  const getActiveWelcomeMessage = (character) => {
    if (!character) return null;
    if (character.welcomeMessages && character.welcomeMessages.length > 0) {
      const activeId = character.activeWelcomeMessageId || character.welcomeMessages[0].id;
      const activeWelcome = character.welcomeMessages.find(w => w.id === activeId);
      return activeWelcome || character.welcomeMessages[0];
    }
    // Fallback for old format
    if (character.firstMessage) {
      return { text: character.firstMessage, llmEnhanced: false };
    }
    return null;
  };

  // Notify context that we're on the Chat page (for flow pause/resume)
  useEffect(() => {
    setOnChatPage(true);
    return () => {
      setOnChatPage(false);
    };
  }, [setOnChatPage]);

  // Load message input history from session state
  useEffect(() => {
    if (sessionState.messageInputHistory) {
      setMessageHistory(sessionState.messageInputHistory);
    }
  }, [sessionState.messageInputHistory]);

  // Load quick texts from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('quickTexts');
    if (saved) {
      try {
        setQuickTexts(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load quick texts:', e);
      }
    }
  }, []);

  // Save quick texts to localStorage
  useEffect(() => {
    localStorage.setItem('quickTexts', JSON.stringify(quickTexts));
  }, [quickTexts]);

  // Listen for automatic emergency stop alerts
  useEffect(() => {
    const handleEmergencyStopAlert = (event) => {
      const { reason, timestamp } = event.detail;
      setEmergencyStopAlert({ reason, timestamp });
      // Auto-dismiss after 30 seconds
      setTimeout(() => setEmergencyStopAlert(null), 30000);
    };

    window.addEventListener('emergency_stop_alert', handleEmergencyStopAlert);
    return () => window.removeEventListener('emergency_stop_alert', handleEmergencyStopAlert);
  }, []);

  // Listen for LLM errors and display as toast
  useEffect(() => {
    const handleLlmError = (event) => {
      const { message, error } = event.detail;
      const errorMsg = error ? `${message}: ${error}` : message;
      showError(errorMsg, 8000);
    };

    window.addEventListener('llm_error', handleLlmError);
    return () => window.removeEventListener('llm_error', handleLlmError);
  }, [showError]);

  // Listen for flow toast events
  useEffect(() => {
    const handleFlowToast = (event) => {
      const { event: flowEvent, message, currentStep, totalSteps } = event.detail;
      const stepInfo = totalSteps > 0 ? ` (${currentStep}/${totalSteps})` : '';

      switch (flowEvent) {
        case 'start':
          showInfo(`${message}${stepInfo}`, 3000);
          break;
        case 'progress':
          showInfo(`${message}${stepInfo}`, 2500);
          break;
        case 'complete':
          showSuccess(message, 3000);
          break;
        case 'blocked':
          showWarning(message, 4000);
          break;
        case 'takeover':
          showWarning(message, 4000);
          break;
        default:
          break;
      }
    };

    window.addEventListener('flow_toast', handleFlowToast);
    return () => window.removeEventListener('flow_toast', handleFlowToast);
  }, [showInfo, showSuccess, showWarning]);

  // Listen for AI device control events
  useEffect(() => {
    const handleAiDeviceControl = (event) => {
      const { deviceName, action } = event.detail;
      const actionText = action === 'on' ? 'turned ON' : 'turned OFF';
      showSuccess(`AI ${actionText} ${deviceName}`, 3000);
    };

    window.addEventListener('ai_device_control', handleAiDeviceControl);
    return () => window.removeEventListener('ai_device_control', handleAiDeviceControl);
  }, [showSuccess]);

  // Check device reachability on startup
  useEffect(() => {
    const checkDevices = async () => {
      try {
        const result = await api.checkDeviceReachability();

        if (result.unreachableDevices && result.unreachableDevices.length > 0) {
          // Show warning for unreachable devices (but they're still configured)
          const deviceNames = result.unreachableDevices.map(d => d.name).join(', ');
          showWarning(`Device(s) not responding: ${deviceNames}`, 8000);

          // If simulation mode was forced due to no reachable pumps
          if (result.simulationRequired && result.simulationReason === 'No primary pump set') {
            showWarning('No pump devices responding - restricted to simulation mode', 8000);
          }
        }
      } catch (error) {
        console.error('[Chat] Device reachability check failed:', error);
      }
    };

    // Run check after a delay to allow devices time to come online
    const timer = setTimeout(checkDevices, 15000);
    return () => clearTimeout(timer);
  }, [api, showWarning, showInfo]);

  // Close quick menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (quickMenuRef.current && !quickMenuRef.current.contains(e.target)) {
        setShowQuickMenu(false);
      }
    };
    if (showQuickMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showQuickMenu]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
        setShowMobileMenu(false);
      }
    };
    if (showMobileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMobileMenu]);

  // Send message history updates to backend
  useEffect(() => {
    if (messageHistory.length > 0) {
      sendWsMessage('update_message_history', { history: messageHistory });
    }
  }, [messageHistory, sendWsMessage]);

  // Scroll to bottom helper
  const scrollToBottom = (smooth = true) => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  };

  useEffect(() => {
    if (messages.length > 0 && !sessionLoading && !isPanelBlocking) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
  }, [messages, sessionState.isGenerating, sessionLoading, isPanelBlocking]);

  // Keyboard shortcuts for capacity control
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if user is typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Disable capacity shortcuts when auto-capacity is enabled
      if (settings?.globalCharacterControls?.useAutoCapacity) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const increment = e.shiftKey ? 5 : 1;
        const newCapacity = Math.min(100, (sessionState.capacity || 0) + increment);
        sendWsMessage('update_capacity', { capacity: newCapacity });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const decrement = e.shiftKey ? 5 : 1;
        const newCapacity = Math.max(0, (sessionState.capacity || 0) - decrement);
        sendWsMessage('update_capacity', { capacity: newCapacity });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessionState.capacity, sendWsMessage, settings?.globalCharacterControls?.useAutoCapacity]);

  // Keep devices ref updated (separate from polling interval)
  useEffect(() => {
    devicesRef.current = devices || [];
  }, [devices]);

  // Periodic device state polling - uses ref to avoid re-triggering on devices changes
  useEffect(() => {
    const pollDeviceStates = async () => {
      const currentDevices = devicesRef.current;
      if (!currentDevices || currentDevices.length === 0) return;

      // Prevent concurrent polling
      if (pollingInProgressRef.current) {
        return;
      }
      pollingInProgressRef.current = true;

      try {
        const now = Date.now();
        const RECENT_ACTION_COOLDOWN = 10000; // 10 seconds

        const statePromises = currentDevices.map(async (device) => {
          const deviceKey = device.childId
            ? `${device.ip}:${device.childId}`
            : (device.deviceId || device.ip);

          // Skip polling for devices with recent manual actions
          const lastAction = recentActionsRef.current[deviceKey];
          if (lastAction && (now - lastAction) < RECENT_ACTION_COOLDOWN) {
            // Return existing state instead of polling
            return null;
          }

          try {
            // Use deviceId for Govee/Tuya, ip for TPLink
            const deviceIdentifier = device.deviceId || device.ip;
            // Build URL with optional childId for power strip outlets and brand for Govee/Tuya
            let url = `${API_BASE}/api/devices/${encodeURIComponent(deviceIdentifier)}/state`;
            const params = new URLSearchParams();
            if (device.childId) {
              params.append('childId', device.childId);
            }
            if (device.brand && device.brand !== 'tplink') {
              params.append('brand', device.brand);
              if (device.sku) params.append('sku', device.sku);
            }
            if (params.toString()) {
              url += `?${params.toString()}`;
            }
            const response = await fetch(url);
            const result = await response.json();
            return {
              key: deviceKey,
              state: result.error ? 'unknown' : result.state,
              relayState: result.relay_state,
              lastUpdate: Date.now()
            };
          } catch (error) {
            console.error(`[Polling] Failed to get state for ${device.deviceId || device.ip}:`, error);
            return {
              key: deviceKey,
              state: 'unknown',
              lastUpdate: Date.now()
            };
          }
        });

        const states = await Promise.all(statePromises);
        const resultsTime = Date.now();
        setPolledDeviceStates(prev => {
          const newStates = { ...prev };
          states.forEach(s => {
            // Skip null entries (devices with recent actions keep their current state)
            if (s) {
              // Double-check: also skip if a manual action happened WHILE this poll was in flight
              const lastAction = recentActionsRef.current[s.key];
              if (lastAction && (resultsTime - lastAction) < RECENT_ACTION_COOLDOWN) {
                // A manual action happened after this poll started - keep optimistic state
                return;
              }
              newStates[s.key] = s;
            }
          });
          return newStates;
        });
      } finally {
        pollingInProgressRef.current = false;
      }
    };

    // Initial poll after a short delay to let devices load
    const initialTimeout = setTimeout(pollDeviceStates, 500);

    // Set up interval using config constant
    const pollInterval = setInterval(pollDeviceStates, CONFIG.POLL_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(pollInterval);
    };
  }, []); // Empty dependency - polling runs once and uses refs

  // Sync local isGenerating with sessionState.isGenerating
  useEffect(() => {
    if (!sessionState.isGenerating && isGenerating) {
      setIsGenerating(false);
    }
  }, [sessionState.isGenerating, isGenerating]);

  // Listen for impersonate results
  useEffect(() => {
    const handleImpersonateResult = (event) => {
      const { text } = event.detail;
      if (text) {
        // Clear first, then set new value
        setInputValue('');
        setTimeout(() => {
          setInputValue(text);
          setIsGenerating(false);
        }, 0);
      }
    };

    window.addEventListener('impersonate_result', handleImpersonateResult);
    return () => window.removeEventListener('impersonate_result', handleImpersonateResult);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isGenerating) return;

    // Check if LLM is configured when auto-reply is on
    if (activeCharacter?.autoReplyEnabled && !isLlmConfigured()) {
      showError('LLM not configured. Go to Settings → Model to set up your connection.', 8000);
      return;
    }

    const messageText = inputValue.trim();

    setIsGenerating(true);
    sendChatMessage(messageText);

    // Add to history
    setMessageHistory(prev => [...prev, messageText]);
    setHistoryIndex(-1);
    setCurrentDraft('');
    setInputValue('');

    setTimeout(() => setIsGenerating(false), 100);
  };

  const handleSendAsCharacter = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isGenerating) return;

    const messageText = inputValue.trim();

    setIsGenerating(true);
    sendWsMessage('ai_message', { content: messageText, suppressLlm: true });

    // Add to history
    setMessageHistory(prev => [...prev, messageText]);
    setHistoryIndex(-1);
    setCurrentDraft('');
    setInputValue('');

    setTimeout(() => setIsGenerating(false), 100);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (messageHistory.length === 0) return;

      if (historyIndex === -1) {
        // Save current draft before entering history
        setCurrentDraft(inputValue);
        setHistoryIndex(messageHistory.length - 1);
        setInputValue(messageHistory[messageHistory.length - 1]);
      } else if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        setInputValue(messageHistory[historyIndex - 1]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;

      if (historyIndex < messageHistory.length - 1) {
        setHistoryIndex(historyIndex + 1);
        setInputValue(messageHistory[historyIndex + 1]);
      } else {
        // Return to draft
        setHistoryIndex(-1);
        setInputValue(currentDraft);
      }
    }
  };

  const handleGuidedGenerate = async (mode) => {
    if (isGenerating) return;

    // Check if LLM is configured
    if (!isLlmConfigured()) {
      showError('LLM not configured. Go to Settings → Model to set up your connection.', 8000);
      return;
    }

    setIsGenerating(true);

    // For impersonate mode, we want the text back to edit before sending
    if (mode === 'guided_impersonate') {
      sendWsMessage('impersonate_request', {
        guidedText: inputValue.trim() || null
      });
      // Don't clear input yet - we'll populate it with the result
    } else {
      sendWsMessage('special_generate', {
        mode,
        guidedText: inputValue.trim() || null
      });
      // Keep the guidance text in the input for reuse
    }
    // Local isGenerating will be reset by useEffect when sessionState.isGenerating becomes false
  };

  const handleEditMessage = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.content);
    // Scroll to the message being edited after a brief delay
    setTimeout(() => {
      const messageElement = document.getElementById(`msg-${msg.id}`);
      messageElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  };

  const handleSaveEdit = (msgId) => {
    sendWsMessage('edit_message', { id: msgId, content: editText });
    setEditingId(null);
    setEditText('');
    setTimeout(() => scrollToBottom(), 100);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setTimeout(() => scrollToBottom(), 100);
  };

  const handleSwipeMessage = (msg) => {
    // Check if LLM is configured
    if (!isLlmConfigured()) {
      showError('LLM not configured. Go to Settings → Model to set up your connection.', 8000);
      return;
    }

    sendWsMessage('swipe_message', {
      id: msg.id,
      guidanceText: inputValue.trim() || null
    });
    // Keep the guidance text in the input for reuse
  };

  const handleDeleteMessage = (msgId) => {
    sendWsMessage('delete_message', { id: msgId });
  };

  // Constant reminder handlers
  const handleAddReminder = () => {
    setEditingReminder(null);
    setShowReminderModal(true);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminder(reminder);
    setShowReminderModal(true);
  };

  const handleSaveReminder = async (reminderData) => {
    if (!activeCharacter) return;

    try {
      const reminders = activeCharacter.constantReminders || [];
      let updatedReminders;

      if (editingReminder) {
        // Edit existing
        updatedReminders = reminders.map(r =>
          r.id === editingReminder.id ? { ...reminderData, id: r.id } : r
        );
      } else {
        // Add new
        const newReminder = {
          id: `reminder-${Date.now()}`,
          ...reminderData
        };
        updatedReminders = [...reminders, newReminder];
      }

      await api.updateCharacter(activeCharacter.id, {
        constantReminders: updatedReminders
      });

      setShowReminderModal(false);
      setEditingReminder(null);
    } catch (error) {
      console.error('Failed to save reminder:', error);
      showError('Failed to save reminder. Please try again.');
    }
  };

  const handleDeleteReminder = async (reminderId) => {
    if (!activeCharacter) return;
    if (!window.confirm('Delete this reminder?')) return;

    try {
      const reminders = activeCharacter.constantReminders || [];
      const updatedReminders = reminders.filter(r => r.id !== reminderId);

      await api.updateCharacter(activeCharacter.id, {
        constantReminders: updatedReminders
      });
    } catch (error) {
      console.error('Failed to delete reminder:', error);
      showError('Failed to delete reminder. Please try again.');
    }
  };

  const handleToggleReminder = async (reminderId, enabled) => {
    if (!activeCharacter) return;

    try {
      const reminders = activeCharacter.constantReminders || [];
      const updatedReminders = reminders.map(r =>
        r.id === reminderId ? { ...r, enabled } : r
      );

      // Optimistically update local state
      setCharacters(prev => prev.map(c =>
        c.id === activeCharacter.id
          ? { ...c, constantReminders: updatedReminders }
          : c
      ));

      await api.updateCharacter(activeCharacter.id, {
        constantReminders: updatedReminders
      });
    } catch (error) {
      console.error('Failed to toggle reminder:', error);
      // Revert on error
      setCharacters(prev => prev.map(c =>
        c.id === activeCharacter.id
          ? { ...c, constantReminders: activeCharacter.constantReminders }
          : c
      ));
    }
  };

  const handleToggleGlobalReminder = async (reminderId, enabled) => {
    try {
      const reminders = settings.globalReminders || [];
      const updatedReminders = reminders.map(r =>
        r.id === reminderId ? { ...r, enabled } : r
      );

      // Optimistically update local state
      setSettings(prev => ({
        ...prev,
        globalReminders: updatedReminders
      }));

      await api.updateSettings({
        globalReminders: updatedReminders
      });
    } catch (error) {
      console.error('Failed to toggle global reminder:', error);
      // Revert on error
      setSettings(prev => ({
        ...prev,
        globalReminders: settings.globalReminders
      }));
    }
  };

  // Emergency stop handler
  const handleEmergencyStop = async () => {
    setStopping(true);
    try {
      await api.emergencyStop();
    } catch (error) {
      console.error('Emergency stop failed:', error);
      showError('Emergency stop failed - check device connections!');
    }
    setTimeout(() => setStopping(false), 1000);
  };

  // Event execution handler
  const handleExecuteButton = (button) => {
    if (!button || !button.actions) return;
    sendWsMessage('execute_button', {
      buttonId: button.buttonId || button.id,
      characterId: activeCharacter.id,
      actions: button.actions
    });
  };

  // Persona button execution handler
  const handleExecutePersonaButton = (button) => {
    if (!button || !button.actions) return;
    sendWsMessage('execute_button', {
      buttonId: button.buttonId || button.id,
      personaId: activePersona.id,
      actions: button.actions
    });
  };

  // Quick text handlers
  const handleAddQuickText = () => {
    if (!newQuickText.trim()) return;
    const newItem = {
      id: `qt-${Date.now()}`,
      text: newQuickText.trim()
    };
    setQuickTexts(prev => [...prev, newItem]);
    setNewQuickText('');
    setShowQuickAddModal(false);
  };

  const handleQuickTextClick = (text) => {
    setInputValue(prev => prev + text);
    setShowQuickMenu(false);
  };

  const handleDeleteQuickText = (id) => {
    setQuickTexts(prev => prev.filter(qt => qt.id !== id));
  };

  const handleEditQuickText = (qt) => {
    setEditingQuickText(qt);
    setNewQuickText(qt.text);
  };

  const handleSaveEditQuickText = () => {
    if (!newQuickText.trim() || !editingQuickText) return;
    setQuickTexts(prev => prev.map(qt =>
      qt.id === editingQuickText.id ? { ...qt, text: newQuickText.trim() } : qt
    ));
    setEditingQuickText(null);
    setNewQuickText('');
  };

  const handleCancelEditQuickText = () => {
    setEditingQuickText(null);
    setNewQuickText('');
  };

  // Device control handlers
  const handleManualDeviceOn = async (device) => {
    const deviceKey = getDeviceKey(device);
    // Optimistic UI update
    setPolledDeviceStates(prev => ({
      ...prev,
      [deviceKey]: { state: 'on', relayState: 1, lastUpdate: Date.now() }
    }));
    // Mark as recently actioned to skip polling
    markRecentAction(deviceKey);

    if (controlMode === 'simulated') {
      console.log('[ControlPanel] Simulated ON for:', device.name);
      return;
    }

    try {
      // Use deviceId for Govee/Tuya, ip for TPLink
      const deviceIdOrIp = device.deviceId || device.ip;
      await api.deviceOn(deviceIdOrIp, {
        childId: device.childId,
        brand: device.brand,
        sku: device.sku
      });
      console.log('[ControlPanel] Turned ON:', device.name);
    } catch (error) {
      console.error('[ControlPanel] Failed to turn on device:', error);
      // Revert on error
      setPolledDeviceStates(prev => ({
        ...prev,
        [deviceKey]: { state: 'off', relayState: 0, lastUpdate: Date.now() }
      }));
      showError(`Failed to turn on ${device.name}`);
    }
  };

  const handleManualDeviceOff = async (device) => {
    const deviceKey = getDeviceKey(device);
    // Optimistic UI update
    setPolledDeviceStates(prev => ({
      ...prev,
      [deviceKey]: { state: 'off', relayState: 0, lastUpdate: Date.now() }
    }));
    // Mark as recently actioned to skip polling
    markRecentAction(deviceKey);

    if (controlMode === 'simulated') {
      console.log('[ControlPanel] Simulated OFF for:', device.name);
      return;
    }

    try {
      // Use deviceId for Govee/Tuya, ip for TPLink
      const deviceIdOrIp = device.deviceId || device.ip;
      await api.deviceOff(deviceIdOrIp, {
        childId: device.childId,
        brand: device.brand,
        sku: device.sku
      });
      console.log('[ControlPanel] Turned OFF:', device.name);
    } catch (error) {
      console.error('[ControlPanel] Failed to turn off device:', error);
      // Revert on error
      setPolledDeviceStates(prev => ({
        ...prev,
        [deviceKey]: { state: 'on', relayState: 1, lastUpdate: Date.now() }
      }));
      showError(`Failed to turn off ${device.name}`);
    }
  };

  // Cycle device (turn on, wait 5s, turn off)
  const handleCycleDevice = async (device) => {
    await handleManualDeviceOn(device);
    setTimeout(() => handleManualDeviceOff(device), 5000);
  };

  return (
    <div className="chat-page">
      {/* Mobile drawer overlay */}
      <div
        className={`drawer-overlay ${leftDrawerOpen || rightDrawerOpen ? 'visible' : ''}`}
        onClick={closeDrawers}
      />

      {/* Blocking overlay for slide panel interactions */}
      <div
        className={`chat-blocking-overlay ${playerChoiceData || challengeData || inputData ? 'visible' : ''}`}
      />

      {/* Mobile Header Badges - StatusBadges in header area on mobile */}
      <div className="mobile-header-badges mobile-only">
        <StatusBadges
          selectedEmotion={sessionState.emotion || 'neutral'}
          onEmotionChange={(emotion) => {
            setSessionState(prev => ({ ...prev, emotion }));
            sendWsMessage('update_emotion', { emotion });
          }}
          selectedPainLevel={typeof sessionState.pain === 'number' ? sessionState.pain : 0}
          onPainLevelChange={(level) => {
            setSessionState(prev => ({ ...prev, pain: level }));
            sendWsMessage('update_pain', { pain: level });
          }}
          capacity={sessionState.capacity || 0}
          personaName={activePersona?.displayName}
          useAutoCapacity={settings?.globalCharacterControls?.useAutoCapacity}
        />
      </div>

      {/* Left Sidebar - Persona */}
      <div className={`chat-sidebar ${leftDrawerOpen ? 'drawer-open' : ''} ${isPanelBlocking ? 'panel-active' : ''}`}>
        {/* Persona Portrait with Status Badges Overlay */}
        <div className={`entity-portrait-large ${personaHidden ? 'portrait-hidden' : ''}`}>
          {personaPortrait ? (
            <img src={personaPortrait} alt={activePersona?.displayName} />
          ) : (
            <div className="portrait-placeholder">?</div>
          )}
          {/* Visibility toggle */}
          <button
            className={`portrait-visibility-toggle ${personaHidden ? 'hidden' : ''}`}
            onClick={togglePersonaHidden}
            title={personaHidden ? 'Show portrait' : 'Hide portrait'}
          >
            {personaHidden ? '👁' : '👁'}
          </button>
          {/* Status Badges overlaid on portrait */}
          <StatusBadges
            selectedEmotion={sessionState.emotion || 'neutral'}
            onEmotionChange={(emotion) => {
              setSessionState(prev => ({ ...prev, emotion }));
              sendWsMessage('update_emotion', { emotion });
            }}
            selectedPainLevel={typeof sessionState.pain === 'number' ? sessionState.pain : 0}
            onPainLevelChange={(level) => {
              setSessionState(prev => ({ ...prev, pain: level }));
              sendWsMessage('update_pain', { pain: level });
            }}
            capacity={sessionState.capacity || 0}
            personaName={activePersona?.displayName}
            useAutoCapacity={settings?.globalCharacterControls?.useAutoCapacity}
          />
        </div>

        {/* Persona Button Menu - Static section below portrait */}
        <div className="persona-button-menu">
          {(() => {
            // Filter buttons to only show those with actions linked to assigned flows
            const assignedFlows = sessionState?.flowAssignments?.personas?.[activePersona?.id] || activePersona?.assignedFlows || [];
            const filteredButtons = (activePersona?.buttons || []).filter(button => {
              // Only show enabled buttons
              if (button.enabled === false) return false;
              // If button has no actions, show it
              if (!button.actions || button.actions.length === 0) return true;
              // Check if any action references a flow - if so, only show if that flow is assigned
              const flowActions = button.actions.filter(a =>
                (a.type === 'trigger_flow' || a.type === 'link_to_flow') && a.config?.flowId
              );
              if (flowActions.length === 0) return true;
              return flowActions.some(a => assignedFlows.includes(a.config.flowId));
            });

            const isDisabled = sessionLoading || isGenerating;
            const totalPages = Math.ceil(filteredButtons.length / PERSONA_ACTIONS_PER_PAGE);
            const currentPageButtons = filteredButtons.slice(
              personaActionPage * PERSONA_ACTIONS_PER_PAGE,
              (personaActionPage + 1) * PERSONA_ACTIONS_PER_PAGE
            );

            return filteredButtons.length > 0 ? (
              <>
                <div className="persona-actions-grid">
                  {currentPageButtons.map((button, idx) => (
                    <button
                      key={idx}
                      className={`persona-action-btn ${isDisabled ? 'disabled' : ''}`}
                      onClick={() => !isDisabled && handleExecutePersonaButton(button)}
                      disabled={isDisabled}
                      title={sessionLoading ? 'Session starting...' : button.name}
                    >
                      {button.name}
                    </button>
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="persona-pagination">
                    <button
                      className="pagination-arrow"
                      onClick={() => setPersonaActionPage(p => Math.max(0, p - 1))}
                      disabled={personaActionPage === 0}
                    >
                      ◀
                    </button>
                    <span className="pagination-info">{personaActionPage + 1} / {totalPages}</span>
                    <button
                      className="pagination-arrow"
                      onClick={() => setPersonaActionPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={personaActionPage >= totalPages - 1}
                    >
                      ▶
                    </button>
                  </div>
                )}
              </>
            ) : null;
          })()}
        </div>

        {/* Simple A/B Choice Popup - compact version near portrait */}
        {simpleABData && (
          <div className="simple-ab-popup">
            <div className="simple-ab-popup-header">
              <span>Choose</span>
            </div>
            {simpleABData.description && (
              <p className="ab-popup-description">{substituteVariables(simpleABData.description, subContext)}</p>
            )}
            <div className="ab-popup-buttons">
              <button
                className="btn-ab-compact btn-ab-a"
                onClick={() => handleSimpleAB('a')}
              >
                <span className="ab-label">{simpleABData.labelA}</span>
                {simpleABData.descriptionA && (
                  <span className="ab-desc">{substituteVariables(simpleABData.descriptionA, subContext)}</span>
                )}
              </button>
              <button
                className="btn-ab-compact btn-ab-b"
                onClick={() => handleSimpleAB('b')}
              >
                <span className="ab-label">{simpleABData.labelB}</span>
                {simpleABData.descriptionB && (
                  <span className="ab-desc">{substituteVariables(simpleABData.descriptionB, subContext)}</span>
                )}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Main Chat Area */}
      <div className="chat-main">
        {/* Emergency Stop Alert Banner */}
        {emergencyStopAlert && (
          <div className="emergency-stop-alert">
            <div className="emergency-stop-content">
              <span className="emergency-icon">!</span>
              <div className="emergency-text">
                <strong>EMERGENCY STOP TRIGGERED</strong>
                <p>{emergencyStopAlert.reason}</p>
              </div>
              <button
                className="emergency-dismiss"
                onClick={() => setEmergencyStopAlert(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Interactive overlay - slides down from top for challenges, choices, etc */}
        <div className={`challenge-overlay ${(challengeData || playerChoiceData) ? 'open' : ''}`}>
          {challengeData && (
            <ChallengeModal
              challengeData={challengeData}
              onResult={handleChallengeResult}
              onCancel={handleChallengeCancel}
              onPenalty={handleChallengePenalty}
              compact={false}
            />
          )}
          {playerChoiceData && (
            <PlayerChoiceModal
              choiceData={playerChoiceData}
              onChoice={handlePlayerChoice}
              subContext={subContext}
              compact={false}
            />
          )}
          {inputData && (
            <InputModal
              inputData={inputData}
              onSubmit={handleInputResponse}
              subContext={subContext}
              compact={false}
            />
          )}
        </div>

        <div className="chat-messages" ref={messagesContainerRef}>
          {sessionLoading ? (
            <div className="chat-loading">
              <div className="loading-spinner"></div>
              <p>Starting new session...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              {activeCharacter ? (
                <>
                  <p>Start a conversation with {activeCharacter.name}!</p>
                  {(() => {
                    const welcomeMsg = getActiveWelcomeMessage(activeCharacter);
                    const welcomeText = welcomeMsg?.text ? substituteVariables(welcomeMsg.text, subContext) : '';
                    return welcomeText && (
                      <div className="first-message-hint">
                        <em>
                          {welcomeMsg.llmEnhanced && '🤖 '}
                          First message: "{welcomeText.substring(0, 100)}{welcomeText.length > 100 ? '...' : ''}"
                        </em>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <p>Select a character in Settings to start chatting.</p>
              )}
            </div>
          ) : (
            messages.filter(msg => msg.content !== '...').map((msg, index, filteredMsgs) => {
            // Highlight the last character message when player choice is active
            const isLastCharacterMsg = playerChoiceData &&
              msg.sender !== 'player' &&
              index === filteredMsgs.length - 1;

            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`message ${msg.sender === 'player' ? 'message-player' : 'message-character'}${isLastCharacterMsg ? ' message-highlighted' : ''}`}
              >
                <div className="message-header">
                  <span className="message-sender">
                    {msg.sender === 'player' ? `${activePersona?.displayName || 'Player'} (You)` : msg.characterName || 'Character'}
                  </span>
                  <div className="message-controls">
                    <button
                      className="msg-btn"
                      onClick={() => handleEditMessage(msg)}
                      title="Edit message"
                    >✏️</button>
                    <button
                      className="msg-btn"
                      onClick={() => handleSwipeMessage(msg)}
                      title="Swipe (regenerate)"
                    >➡️</button>
                    <button
                      className="msg-btn"
                      onClick={() => handleDeleteMessage(msg.id)}
                      title="Delete message"
                    >🗑️</button>
                  </div>
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {editingId === msg.id ? (
                  <div className="message-edit">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={4}
                    />
                    <div className="edit-buttons">
                      <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(msg.id)}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={handleCancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className={`message-content ${msg.streaming ? 'streaming' : ''}`}>
                    {substituteVariables(msg.content, subContext)}
                    {msg.streaming && <span className="streaming-cursor">▌</span>}
                  </div>
                )}
              </div>
            );
          })
          )}
          {sessionState.isGenerating && (
            <div className={`message ${sessionState.isPlayerVoice ? 'message-player' : 'message-character'} typing-indicator`}>
              <div className="message-header">
                <span className="message-sender">{sessionState.generatingFor || 'AI'}</span>
              </div>
              <div className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-input-form" onSubmit={handleSubmit}>
          <div className="input-buttons-row">
            <div className="chat-buttons">
              {/* Mobile Navigation Cluster - only visible on mobile */}
              <div className="mobile-nav-cluster mobile-only">
                <button
                  type="button"
                  className="mobile-nav-btn persona-toggle"
                  onClick={() => setLeftDrawerOpen(!leftDrawerOpen)}
                  aria-label="Toggle persona panel"
                  title="Persona"
                >🎈</button>
                <button
                  type="button"
                  className="mobile-nav-btn character-toggle"
                  onClick={() => setRightDrawerOpen(!rightDrawerOpen)}
                  aria-label="Toggle character panel"
                  title="Character"
                >😈</button>
              </div>

              {/* Mobile E-STOP button - centered */}
              <button
                type="button"
                className={`mobile-estop-btn mobile-only ${controlMode === 'simulated' ? 'simulated' : flowExecutions?.length > 0 ? 'abort' : 'active'}`}
                onClick={() => api.emergencyStop()}
                disabled={controlMode === 'simulated'}
                title={controlMode === 'simulated' ? 'Simulation mode active' : 'Emergency stop'}
              >
                {controlMode === 'simulated' ? 'SIM' : flowExecutions?.length > 0 ? 'ABORT' : 'E-STOP'}
              </button>

            </div>
          </div>
          <div className="chat-input-row">
            <div className="input-arrow-buttons">
              <button
                type="button"
                className="arrow-btn"
                onClick={() => {
                  if (messageHistory.length === 0) return;
                  if (historyIndex === -1) {
                    setCurrentDraft(inputValue);
                    setHistoryIndex(messageHistory.length - 1);
                    setInputValue(messageHistory[messageHistory.length - 1]);
                  } else if (historyIndex > 0) {
                    setHistoryIndex(historyIndex - 1);
                    setInputValue(messageHistory[historyIndex - 1]);
                  }
                }}
                disabled={!activeCharacter || messageHistory.length === 0}
                title="Previous message"
              >&#9650;</button>
              <button
                type="button"
                className="arrow-btn"
                onClick={() => {
                  if (historyIndex === -1) {
                    setInputValue('');
                    setCurrentDraft('');
                  } else if (historyIndex < messageHistory.length - 1) {
                    setHistoryIndex(historyIndex + 1);
                    setInputValue(messageHistory[historyIndex + 1]);
                  } else {
                    setHistoryIndex(-1);
                    setInputValue(currentDraft);
                  }
                }}
                disabled={!activeCharacter}
                title="Next message / Clear"
              >&#9660;</button>
            </div>
            <textarea
              className="chat-input-textarea"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={activeCharacter ? `Message ${activeCharacter.name}...` : 'Select a character to chat...'}
              disabled={!activeCharacter || isGenerating || isPanelBlocking || sessionLoading}
              rows={3}
            />
            {/* Action Buttons Stack */}
            <div className="input-action-stack">
              <div className="action-stack-top">
                <button
                  type="button"
                  className={`action-btn impersonate-action-btn ${isGenerating ? 'generating' : ''}`}
                  disabled={!activeCharacter || isGenerating || isPanelBlocking || sessionLoading}
                  onClick={() => handleGuidedGenerate('guided_impersonate')}
                  title={sessionLoading ? "Session starting..." : "Guided Impersonate (continue as you)"}
                >🤖</button>
                <button
                  type="button"
                  className={`action-btn response-action-btn ${isGenerating ? 'generating' : ''}`}
                  disabled={!activeCharacter || isGenerating || isPanelBlocking || sessionLoading}
                  onClick={() => handleGuidedGenerate('guided')}
                  title={sessionLoading ? "Session starting..." : "Guided Response (AI continues)"}
                >🤖</button>
              </div>
              <div className="action-stack-bottom">
                <button
                  type="submit"
                  className="action-btn send-persona-btn"
                  disabled={!activeCharacter || !inputValue.trim() || isGenerating || isPanelBlocking || sessionLoading}
                  title="Send as Persona"
                >↖</button>
                <button
                  type="button"
                  className="action-btn send-character-btn"
                  disabled={!activeCharacter || !inputValue.trim() || isGenerating || isPanelBlocking || sessionLoading}
                  onClick={handleSendAsCharacter}
                  title="Send as Character"
                >↖</button>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Right Sidebar - Character */}
      <div className={`chat-sidebar chat-sidebar-right ${rightDrawerOpen ? 'drawer-open' : ''}`}>
        {/* Character Portrait */}
        <div className={`entity-portrait-large ${characterHidden ? 'portrait-hidden' : ''}`}>
          {activeCharacter?.avatar ? (
            <img src={activeCharacter.avatar} alt={activeCharacter.name} />
          ) : (
            <div className="portrait-placeholder">?</div>
          )}
          {/* Visibility toggle */}
          <button
            className={`portrait-visibility-toggle ${characterHidden ? 'hidden' : ''}`}
            onClick={toggleCharacterHidden}
            title={characterHidden ? 'Show portrait' : 'Hide portrait'}
          >
            {characterHidden ? '👁' : '👁'}
          </button>
          {/* Frame overlay to match persona portrait */}
          <div className="status-badges-overlay">
            <div className="metallic-frame">
              <div className="frame-left"></div>
              <div className="frame-right"></div>
              <div className="frame-top">
                {activeCharacter?.name && <span className="frame-name character-name">{activeCharacter.name}</span>}
              </div>
            </div>
            {/* Session Info Panel */}
            <div className="session-info-panel">
              <div className="session-info-item story-name">
                Story: {activeCharacter?.stories?.find(s => s.id === activeCharacter?.activeStoryId)?.name || 'Default'}
              </div>
              <ul className="session-info-list">
                <li>{controlMode === 'interactive' ? 'Interactive Mode' : 'Simulated Mode'}</li>
                {isLlmConfigured() && (() => {
                  const activeProfile = connectionProfiles?.find(p => p.id === settings?.llm?.activeProfileId);
                  const profileName = activeProfile?.name || (settings?.llm?.endpointStandard === 'openrouter' ? 'OpenRouter' : 'Connected');
                  return <li>LLM: {profileName}</li>;
                })()}
                {!activeCharacter?.autoReplyEnabled && <li>Auto-Reply Off</li>}
                {(() => {
                  const charFlows = sessionState?.flowAssignments?.characters?.[activeCharacter?.id]?.length || 0;
                  const personaFlows = sessionState?.flowAssignments?.personas?.[activePersona?.id]?.length || 0;
                  const globalFlows = sessionState?.flowAssignments?.global?.length || 0;
                  const totalFlows = charFlows + personaFlows + globalFlows;
                  return totalFlows > 0 ? <li>{totalFlows} Flows Active</li> : null;
                })()}
                <li>Auto-Capacity {settings?.globalCharacterControls?.useAutoCapacity ? 'ON' : 'OFF'}</li>
                {settings?.globalCharacterControls?.allowOverInflation && <li>Over-Inflate Allowed</li>}
                {(!settings?.globalCharacterControls?.allowOverInflation || settings?.globalCharacterControls?.enableAutoPopRoleplay) && (
                  <li>Auto-Pop @ {effectivePopThreshold}%</li>
                )}
                <li>LLM Device Control {settings?.globalCharacterControls?.allowLlmDeviceControl ? 'ON' : 'OFF'}</li>
              </ul>
            </div>
            <div className="character-bottom-bar">
              <button
                className={`frame-btn ${devicesExpanded ? 'active' : ''}`}
                onClick={() => {
                  if (devicesExpanded) {
                    setDevicesExpanded(false);
                  } else {
                    setActionsExpanded(false);
                    setDevicesExpanded(true);
                  }
                }}
              >
                Devices
              </button>
              <button
                className={`frame-btn ${actionsExpanded ? 'active' : ''}`}
                onClick={() => {
                  if (actionsExpanded) {
                    setActionsExpanded(false);
                  } else {
                    setDevicesExpanded(false);
                    setActionsExpanded(true);
                  }
                }}
              >
                Actions
              </button>
            </div>

            {/* Sliding panels */}
            <div className={`character-panel devices-panel ${devicesExpanded ? 'expanded' : ''}`}>
              <div className="panel-content">
                {devices && devices.length > 0 ? (
                  <div className="panel-device-list">
                    {devices.map((device, idx) => {
                      const deviceKey = device.childId ? `${device.ip}:${device.childId}` : (device.deviceId || device.ip);
                      const deviceState = polledDeviceStates[deviceKey];
                      return (
                        <div key={idx} className="panel-device-item">
                          <span className={`panel-device-indicator ${deviceState?.state || 'unknown'}`}></span>
                          <span className="panel-device-name">{device.label || device.name}</span>
                          <div className="panel-device-controls">
                            <button className="device-ctrl-btn" onClick={() => handleManualDeviceOn(device)}>On</button>
                            <button className="device-ctrl-btn" onClick={() => handleManualDeviceOff(device)}>Off</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="panel-empty">No devices configured</p>
                )}
              </div>
            </div>

            <div className={`character-panel actions-panel ${actionsExpanded ? 'expanded' : ''}`}>
              <div className="panel-content">
                {(() => {
                  // Filter buttons to only show those with actions linked to assigned flows
                  // Use sessionState.flowAssignments which is updated in real-time via WebSocket
                  const assignedFlows = sessionState?.flowAssignments?.characters?.[activeCharacter?.id] || activeCharacter?.assignedFlows || [];
                  const filteredButtons = (activeCharacter?.buttons || []).filter(button => {
                    // If button has no actions, show it
                    if (!button.actions || button.actions.length === 0) return true;
                    // Check if any action references a flow - if so, only show if that flow is assigned
                    // Action types: 'trigger_flow' or 'link_to_flow'
                    const flowActions = button.actions.filter(a =>
                      (a.type === 'trigger_flow' || a.type === 'link_to_flow') && a.config?.flowId
                    );
                    if (flowActions.length === 0) return true; // No flow actions, show button
                    // Only show if at least one flow action references an assigned flow
                    return flowActions.some(a => assignedFlows.includes(a.config.flowId));
                  });

                  const isDisabled = flowInProgress || sessionLoading || isGenerating;
                  const totalPages = Math.ceil(filteredButtons.length / ACTIONS_PER_PAGE);
                  const currentPageButtons = filteredButtons.slice(
                    actionPage * ACTIONS_PER_PAGE,
                    (actionPage + 1) * ACTIONS_PER_PAGE
                  );

                  return filteredButtons.length > 0 ? (
                    <>
                      <div className="panel-actions-grid">
                        {currentPageButtons.map((button, idx) => (
                          <button
                            key={idx}
                            className={`panel-action-btn ${isDisabled ? 'disabled' : ''}`}
                            onClick={() => !isDisabled && handleExecuteButton(button)}
                            disabled={isDisabled}
                            title={sessionLoading ? 'Session starting...' : flowInProgress ? 'Flow in progress...' : button.name}
                          >
                            {button.name}
                          </button>
                        ))}
                      </div>
                      {totalPages > 1 && (
                        <div className="actions-pagination">
                          <button
                            className="pagination-arrow pagination-prev"
                            onClick={() => setActionPage(p => Math.max(0, p - 1))}
                            disabled={actionPage === 0}
                          >
                            ◀
                          </button>
                          <span className="pagination-info">{actionPage + 1} / {totalPages}</span>
                          <button
                            className="pagination-arrow pagination-next"
                            onClick={() => setActionPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={actionPage >= totalPages - 1}
                          >
                            ▶
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="panel-empty">No actions configured</p>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Mobile drawer toggle buttons (hidden on desktop via CSS) */}
      <div className="mobile-drawer-toggles">
        <button
          className="mobile-drawer-toggle left-toggle"
          onClick={() => setLeftDrawerOpen(!leftDrawerOpen)}
          aria-label="Toggle player panel"
        >
          ☰
        </button>
        <button
          className="mobile-drawer-toggle right-toggle"
          onClick={() => setRightDrawerOpen(!rightDrawerOpen)}
          aria-label="Toggle control panel"
        >
          ⚙
        </button>
      </div>

      {/* Constant Reminder Modal */}
      <ConstantReminderModal
        isOpen={showReminderModal}
        onClose={() => setShowReminderModal(false)}
        onSave={handleSaveReminder}
        reminder={editingReminder}
      />

      {/* Quick Text Add Modal */}
      {showQuickAddModal && (
        <div className="modal-overlay" onClick={() => setShowQuickAddModal(false)}>
          <div className="modal quick-text-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Quick Text</h3>
              <button className="modal-close" onClick={() => setShowQuickAddModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                value={newQuickText}
                onChange={(e) => setNewQuickText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddQuickText()}
                placeholder="Enter quick text..."
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowQuickAddModal(false); setNewQuickText(''); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAddQuickText} disabled={!newQuickText.trim()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Text Manage Modal */}
      {showQuickManageModal && (
        <div className="modal-overlay" onClick={() => { setShowQuickManageModal(false); setEditingQuickText(null); setNewQuickText(''); }}>
          <div className="modal quick-text-manage-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manage Quick Texts</h3>
              <button className="modal-close" onClick={() => { setShowQuickManageModal(false); setEditingQuickText(null); setNewQuickText(''); }}>×</button>
            </div>
            <div className="modal-body">
              {quickTexts.length === 0 ? (
                <p className="text-muted">No quick texts yet. Add one to get started.</p>
              ) : (
                <div className="quick-text-list">
                  {quickTexts.map(qt => (
                    <div key={qt.id} className="quick-text-item">
                      {editingQuickText?.id === qt.id ? (
                        <div className="quick-text-edit-row">
                          <input
                            type="text"
                            value={newQuickText}
                            onChange={(e) => setNewQuickText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveEditQuickText()}
                            autoFocus
                          />
                          <button className="btn btn-sm btn-primary" onClick={handleSaveEditQuickText}>Save</button>
                          <button className="btn btn-sm btn-secondary" onClick={handleCancelEditQuickText}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          <span className="quick-text-content">{qt.text}</span>
                          <div className="quick-text-actions">
                            <button className="btn-icon-small" onClick={() => handleEditQuickText(qt)} title="Edit">✏️</button>
                            <button className="btn-icon-small" onClick={() => handleDeleteQuickText(qt.id)} title="Delete">🗑️</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => { setShowQuickManageModal(false); setShowQuickAddModal(true); }}
              >
                + Add New
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowQuickManageModal(false); setEditingQuickText(null); setNewQuickText(''); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Session Modal */}
      {showMobileSessionModal && (
        <div className="modal-overlay" onClick={() => setShowMobileSessionModal(false)}>
          <div className="modal mobile-session-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Session</h3>
              <button className="modal-close" onClick={() => setShowMobileSessionModal(false)}>×</button>
            </div>
            <div className="modal-body mobile-session-buttons">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowMobileSessionModal(false); window.dispatchEvent(new Event('mobile-new-session')); }}
              >
                New
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { setShowMobileSessionModal(false); window.dispatchEvent(new Event('mobile-load-session')); }}
              >
                Load
              </button>
              <button
                className="btn btn-primary"
                onClick={() => { setShowMobileSessionModal(false); window.dispatchEvent(new Event('mobile-save-session')); }}
              >
                Save
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowMobileSessionModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Chat;
