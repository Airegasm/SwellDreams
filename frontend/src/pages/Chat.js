import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { useError } from '../context/ErrorContext';
import { API_BASE, CONFIG } from '../config';
import PlayerChoiceModal from '../components/modals/PlayerChoiceModal';
import ConstantReminderModal from '../components/modals/ConstantReminderModal';
import { substituteVariables } from '../utils/variableSubstitution';
import StatusBadges from '../components/StatusBadges';
import './Chat.css';

function Chat() {
  const { messages, sendChatMessage, sendWsMessage, characters, setCharacters, personas, settings, setSettings, sessionState, setSessionState, api, playerChoiceData, handlePlayerChoice, simpleABData, handleSimpleAB, devices, infiniteCycles, controlMode } = useApp();
  const { showError } = useError();
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

  // Mobile drawer state
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const closeDrawers = () => { setLeftDrawerOpen(false); setRightDrawerOpen(false); };

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

  // LLM not configured error popup
  const [showLlmError, setShowLlmError] = useState(false);

  const messagesEndRef = useRef(null);

  // Check if LLM is configured
  const isLlmConfigured = () => {
    const llm = settings?.llm;
    if (!llm) return false;
    // Check for standard LLM URL or OpenRouter
    return llm.llmUrl || (llm.endpointStandard === 'openrouter' && llm.openRouterApiKey);
  };

  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

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

  // Send message history updates to backend
  useEffect(() => {
    if (messageHistory.length > 0) {
      sendWsMessage('update_message_history', { history: messageHistory });
    }
  }, [messageHistory, sendWsMessage]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sessionState.isGenerating]);

  // Keyboard shortcuts for capacity control
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if user is typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
  }, [sessionState.capacity, sendWsMessage]);

  // Periodic device state polling
  useEffect(() => {
    if (!devices || devices.length === 0) return;

    const pollDeviceStates = async () => {
      const now = Date.now();
      const RECENT_ACTION_COOLDOWN = 10000; // 10 seconds

      const statePromises = devices.map(async (device) => {
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
    };

    // Initial poll
    pollDeviceStates();

    // Set up interval using config constant
    const pollInterval = setInterval(pollDeviceStates, CONFIG.POLL_INTERVAL_MS);

    return () => clearInterval(pollInterval);
  }, [devices]);

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
      setShowLlmError(true);
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
      setShowLlmError(true);
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
      setInputValue('');
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
    // Scroll to bottom after a brief delay to let DOM update
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
    // Scroll to bottom after a brief delay to let DOM update
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleSwipeMessage = (msg) => {
    // Check if LLM is configured
    if (!isLlmConfigured()) {
      setShowLlmError(true);
      return;
    }

    sendWsMessage('swipe_message', {
      id: msg.id,
      guidanceText: inputValue.trim() || null
    });
    // Clear input after using it for guidance
    setInputValue('');
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
      alert('Failed to save reminder. Please try again.');
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
      alert('Failed to delete reminder. Please try again.');
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
      alert(`Failed to turn on ${device.name}`);
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
      alert(`Failed to turn off ${device.name}`);
    }
  };

  // Cycle device (turn on, wait 5s, turn off)
  const handleCycleDevice = async (device) => {
    await handleManualDeviceOn(device);
    setTimeout(() => handleManualDeviceOff(device), 5000);
  };

  return (
    <div className="chat-page">
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

      {/* Mobile drawer overlay */}
      <div
        className={`drawer-overlay ${leftDrawerOpen || rightDrawerOpen ? 'visible' : ''}`}
        onClick={closeDrawers}
      />

      {/* Left Sidebar - Persona */}
      <div className={`chat-sidebar ${leftDrawerOpen ? 'drawer-open' : ''}`}>
        {/* Persona Name */}
        <div className="sidebar-entity-header">
          <span className="entity-name-display">
            {activePersona?.displayName || 'None'}
          </span>
        </div>

        {/* Persona Portrait */}
        <div className="entity-portrait-large">
          {activePersona?.avatar ? (
            <img src={activePersona.avatar} alt={activePersona.displayName} />
          ) : (
            <div className="portrait-placeholder">?</div>
          )}
        </div>

        {/* Status Badges */}
        <StatusBadges
          selectedEmotion={sessionState.emotion || 'neutral'}
          onEmotionChange={(emotion) => setSessionState(prev => ({ ...prev, emotion }))}
          selectedPainLevel={typeof sessionState.sensation === 'number' ? sessionState.sensation : 0}
          onPainLevelChange={(level) => setSessionState(prev => ({ ...prev, sensation: level }))}
          capacity={sessionState.capacity || 0}
        />

      </div>

      {/* Main Chat Area */}
      <div className="chat-main">
        <div className="chat-messages">
          {messages.length === 0 ? (
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
              <button
                type="submit"
                className="chat-btn send-btn"
                disabled={!activeCharacter || !inputValue.trim() || isGenerating}
                title="Send message"
              >➤</button>
              <button
                type="button"
                className="chat-btn impersonate-btn"
                disabled={!activeCharacter || isGenerating}
                onClick={() => handleGuidedGenerate('guided_impersonate')}
                title="Guided Impersonate (continue as you)"
              >👤</button>
              <div className="quick-text-container" ref={quickMenuRef}>
                <button
                  type="button"
                  className="chat-btn quick-btn"
                  onClick={() => setShowQuickMenu(!showQuickMenu)}
                  title="Quick Texts"
                >Q</button>
                {showQuickMenu && (
                  <div className="quick-text-menu">
                    {quickTexts.map(qt => (
                      <button
                        key={qt.id}
                        className="quick-menu-item"
                        onClick={() => handleQuickTextClick(qt.text)}
                      >
                        {qt.text.length > 30 ? qt.text.substring(0, 30) + '...' : qt.text}
                      </button>
                    ))}
                    <div className="quick-menu-divider" />
                    <button
                      className="quick-menu-item quick-menu-action"
                      onClick={() => { setShowQuickMenu(false); setShowQuickAddModal(true); }}
                    >
                      + Add New Quick Text
                    </button>
                    <button
                      className="quick-menu-item quick-menu-action"
                      onClick={() => { setShowQuickMenu(false); setShowQuickManageModal(true); }}
                    >
                      Manage Quick Texts
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="chat-btn guided-btn"
                disabled={!activeCharacter || isGenerating}
                onClick={() => handleGuidedGenerate('guided')}
                title="Guided Response (AI continues)"
              >↩</button>
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
              disabled={!activeCharacter || isGenerating}
              rows={3}
            />
          </div>
        </form>
      </div>

      {/* Right Sidebar - Character */}
      <div className={`chat-sidebar chat-sidebar-right ${rightDrawerOpen ? 'drawer-open' : ''}`}>
        {/* Character Name */}
        <div className="sidebar-entity-header">
          <span className="entity-name-display">
            {activeCharacter?.name || 'None'}
          </span>
        </div>

        {/* Character Portrait */}
        <div className="entity-portrait-large">
          {activeCharacter?.avatar ? (
            <img src={activeCharacter.avatar} alt={activeCharacter.name} />
          ) : (
            <div className="portrait-placeholder">?</div>
          )}
        </div>

        {/* Actions Section - Collapsible */}
        <div className={`collapsible-section actions-section ${actionsExpanded ? 'expanded' : ''}`}>
          <button
            className="collapsible-header"
            onClick={() => {
              setActionsExpanded(!actionsExpanded);
              if (!actionsExpanded) setDevicesExpanded(false);
            }}
          >
            <span className={`collapsible-chevron ${actionsExpanded ? 'expanded' : ''}`}>›</span>
            Actions
          </button>
          {actionsExpanded && (
            <div className="collapsible-overlay actions-overlay">
              {activeCharacter?.buttons?.length > 0 ? (
                <div className="actions-grid">
                  {activeCharacter.buttons.filter(b => b.enabled !== false).map(button => (
                    <button
                      key={button.buttonId || button.id}
                      className="action-overlay-btn"
                      onClick={() => handleExecuteButton(button)}
                    >
                      {button.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-muted">No buttons configured</p>
              )}
            </div>
          )}
        </div>

        {/* Devices Section - Collapsible */}
        <div className={`collapsible-section devices-section ${devicesExpanded ? 'expanded' : ''}`}>
          <div className="collapsible-header devices-header">
            <span
              className={`collapsible-chevron ${devicesExpanded ? 'expanded' : ''}`}
              onClick={() => {
                setDevicesExpanded(!devicesExpanded);
                if (!devicesExpanded) setActionsExpanded(false);
              }}
            >›</span>
            <span
              className="collapsible-label"
              onClick={() => {
                setDevicesExpanded(!devicesExpanded);
                if (!devicesExpanded) setActionsExpanded(false);
              }}
            >Devices</span>
            {controlMode !== 'simulated' && (
              <button
                className="e-stop-btn mini"
                onClick={handleEmergencyStop}
                disabled={stopping}
              >
                {stopping ? 'STOP' : 'E-STOP'}
              </button>
            )}
          </div>
          {/* Sub-card with indicators (only when collapsed) */}
          {!devicesExpanded && (
            <div className="devices-subcard">
              <div className="indicator-grid">
                {[0,1,2,3,4].map(i => {
                  const device = devices[i];
                  if (!device) {
                    return <span key={i} className="indicator-light empty"></span>;
                  }
                  const deviceKey = getDeviceKey(device);
                  const deviceState = polledDeviceStates[deviceKey];
                  const isOn = deviceState?.state === 'on' || deviceState?.relayState === 1;
                  const isUnknown = !deviceState || deviceState?.state === 'unknown';
                  const statusClass = isUnknown ? 'unavailable' : isOn ? 'on' : 'off';
                  return <span key={i} className={`indicator-light ${statusClass}`}></span>;
                })}
              </div>
            </div>
          )}
          {devicesExpanded && (
            <div className="collapsible-overlay devices-overlay">
              {devices.length === 0 ? (
                <p className="text-muted">No devices configured</p>
              ) : (
                devices.map((device, index) => {
                  const deviceKey = getDeviceKey(device);
                  const deviceState = polledDeviceStates[deviceKey];
                  const isOn = deviceState?.state === 'on' || deviceState?.relayState === 1;
                  const isUnknown = !deviceState || deviceState?.state === 'unknown';
                  const statusClass = isUnknown ? 'unavailable' : isOn ? 'on' : 'off';
                  const isPrimary = index === 0;

                  return (
                    <div key={device.id} className="device-overlay-item">
                      <div className="device-overlay-row">
                        <span className={`device-indicator ${statusClass}`}></span>
                        <span className="device-overlay-name">{device.label || device.name}</span>
                        {isPrimary && <span className="primary-star">★</span>}
                      </div>
                      <div className="device-overlay-controls">
                        <button onClick={() => isOn ? handleManualDeviceOff(device) : handleManualDeviceOn(device)}>
                          {isOn ? 'Off' : 'On'}
                        </button>
                        <button onClick={() => handleCycleDevice(device)}>Cycle</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
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

      {/* Player Choice Modal */}
      {playerChoiceData && (
        <PlayerChoiceModal
          choiceData={playerChoiceData}
          onChoice={handlePlayerChoice}
          subContext={subContext}
        />
      )}

      {/* Simple A/B Choice Modal */}
      {simpleABData && (
        <div className="modal-overlay">
          <div className="modal simple-ab-modal">
            <div className="modal-header">
              <h3>Choose</h3>
            </div>
            <div className="modal-body">
              {simpleABData.description && (
                <p className="ab-description">{substituteVariables(simpleABData.description, subContext)}</p>
              )}
              <div className="ab-buttons">
                <button
                  className="btn-ab btn-ab-a"
                  onClick={() => handleSimpleAB('a')}
                >
                  <span className="ab-label">{simpleABData.labelA}</span>
                  {simpleABData.descriptionA && (
                    <span className="ab-desc">{substituteVariables(simpleABData.descriptionA, subContext)}</span>
                  )}
                </button>
                <button
                  className="btn-ab btn-ab-b"
                  onClick={() => handleSimpleAB('b')}
                >
                  <span className="ab-label">{simpleABData.labelB}</span>
                  {simpleABData.descriptionB && (
                    <span className="ab-desc">{substituteVariables(simpleABData.descriptionB, subContext)}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* LLM Not Configured Error Modal */}
      {showLlmError && (
        <div className="modal-overlay" onClick={() => setShowLlmError(false)}>
          <div className="modal error-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header error">
              <h3>LLM Not Connected</h3>
              <button className="modal-close" onClick={() => setShowLlmError(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>No LLM server is configured. Please go to <strong>Settings → Model</strong> to configure your LLM connection.</p>
              <p className="error-hint">You can connect to a local LLM (KoboldCPP, LM Studio) or use OpenRouter for cloud models.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowLlmError(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
