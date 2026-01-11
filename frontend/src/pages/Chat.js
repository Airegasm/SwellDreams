import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { useError } from '../context/ErrorContext';
import { API_BASE, CONFIG } from '../config';
import SaveSessionModal from '../components/modals/SaveSessionModal';
import LoadSessionModal from '../components/modals/LoadSessionModal';
import PlayerChoiceModal from '../components/modals/PlayerChoiceModal';
import ConstantReminderModal from '../components/modals/ConstantReminderModal';
import { substituteVariables } from '../utils/variableSubstitution';
import './Chat.css';

function Chat() {
  const { messages, sendChatMessage, sendWsMessage, characters, setCharacters, personas, settings, setSettings, sessionState, api, playerChoiceData, handlePlayerChoice, simpleABData, handleSimpleAB, devices, infiniteCycles, simulationRequired, simulationReason, controlMode, setControlMode } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedSessions, setSavedSessions] = useState([]);
  const [activeTab, setActiveTab] = useState('player');
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [messageHistory, setMessageHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentDraft, setCurrentDraft] = useState('');
  const [rightColumnTab, setRightColumnTab] = useState('events');

  // Quick text state
  const [quickTexts, setQuickTexts] = useState([]);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [showQuickManageModal, setShowQuickManageModal] = useState(false);
  const [newQuickText, setNewQuickText] = useState('');
  const [editingQuickText, setEditingQuickText] = useState(null);
  const quickMenuRef = useRef(null);

  // Control panel state
  const [polledDeviceStates, setPolledDeviceStates] = useState({}); // { ip: { state, relayState, lastUpdate } }

  // Auto reply state - when false, AI only responds via Guided Response/Events/Flows
  const [autoReply, setAutoReply] = useState(false);

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
  }, [messages]);

  // Periodic device state polling
  useEffect(() => {
    if (!devices || devices.length === 0) return;

    const pollDeviceStates = async () => {
      const statePromises = devices.map(async (device) => {
        try {
          const response = await fetch(`${API_BASE}/api/devices/${device.ip}/state`);
          const result = await response.json();
          return {
            ip: device.ip,
            state: result.error ? 'unknown' : result.state,
            relayState: result.relay_state,
            lastUpdate: Date.now()
          };
        } catch (error) {
          console.error(`[Polling] Failed to get state for ${device.ip}:`, error);
          return {
            ip: device.ip,
            state: 'unknown',
            lastUpdate: Date.now()
          };
        }
      });

      const states = await Promise.all(statePromises);
      const statesMap = {};
      states.forEach(s => {
        statesMap[s.ip] = s;
      });
      setPolledDeviceStates(statesMap);
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
    if (autoReply && !isLlmConfigured()) {
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

  const handleNewSession = async () => {
    if (window.confirm('Start a new session? This will clear chat history.')) {
      await api.resetSession();
    }
  };

  // Generate default session name
  const getDefaultSessionName = () => {
    const personaName = activePersona?.displayName || 'Player';
    const charName = activeCharacter?.name || 'Character';
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${personaName}-${charName}-${timestamp}`;
  };

  // Check if there are messages beyond welcome message
  const hasUnsavedChanges = messages.length > 1;

  // Save session handler
  const handleSaveSession = async (name) => {
    try {
      await api.saveSession({
        name,
        personaId: settings?.activePersonaId,
        characterId: settings?.activeCharacterId
      });
      setShowSaveModal(false);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  };

  // Load sessions list
  const handleOpenLoadModal = async () => {
    try {
      const sessions = await api.listSessions(
        settings?.activePersonaId,
        settings?.activeCharacterId
      );
      setSavedSessions(sessions);
      setShowLoadModal(true);
    } catch (error) {
      console.error('Failed to list sessions:', error);
    }
  };

  // Load session handler
  const handleLoadSession = async (sessionId) => {
    try {
      await api.loadSession(sessionId);
      setShowLoadModal(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
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

  // Control panel handlers
  const handleModeChange = (mode) => {
    setControlMode(mode);
    console.log('[ControlPanel] Mode changed to:', mode);
  };

  const handleManualDeviceOn = async (device) => {
    // Optimistic UI update
    setPolledDeviceStates(prev => ({
      ...prev,
      [device.ip]: { state: 'on', relayState: 1, lastUpdate: Date.now() }
    }));

    if (controlMode === 'simulated') {
      console.log('[ControlPanel] Simulated ON for:', device.name);
      return;
    }

    try {
      await api.deviceOn(device.ip);
      console.log('[ControlPanel] Turned ON:', device.name);
    } catch (error) {
      console.error('[ControlPanel] Failed to turn on device:', error);
      // Revert on error
      setPolledDeviceStates(prev => ({
        ...prev,
        [device.ip]: { state: 'off', relayState: 0, lastUpdate: Date.now() }
      }));
      alert(`Failed to turn on ${device.name}`);
    }
  };

  const handleManualDeviceOff = async (device) => {
    // Optimistic UI update
    setPolledDeviceStates(prev => ({
      ...prev,
      [device.ip]: { state: 'off', relayState: 0, lastUpdate: Date.now() }
    }));

    if (controlMode === 'simulated') {
      console.log('[ControlPanel] Simulated OFF for:', device.name);
      return;
    }

    try {
      await api.deviceOff(device.ip);
      console.log('[ControlPanel] Turned OFF:', device.name);
    } catch (error) {
      console.error('[ControlPanel] Failed to turn off device:', error);
      // Revert on error
      setPolledDeviceStates(prev => ({
        ...prev,
        [device.ip]: { state: 'on', relayState: 1, lastUpdate: Date.now() }
      }));
      alert(`Failed to turn off ${device.name}`);
    }
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

      {/* Sidebar */}
      <div className="chat-sidebar">
        <div className="sidebar-section">
          <h3>Session</h3>
          <div className="session-buttons">
            <button className="btn btn-secondary session-btn" onClick={handleNewSession}>New</button>
            <button className="btn btn-secondary session-btn" onClick={() => setShowSaveModal(true)}>Save</button>
            <button className="btn btn-secondary session-btn" onClick={handleOpenLoadModal}>Load</button>
          </div>
        </div>

        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${activeTab === 'player' ? 'active' : ''}`}
            onClick={() => setActiveTab('player')}
          >
            Player
          </button>
          <button
            className={`sidebar-tab ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI
            {sessionState.isGenerating && (
              <span className="ai-generating-indicator"></span>
            )}
          </button>
        </div>

        {activeTab === 'player' && (
          <div className="sidebar-tab-content">
            <div className="entity-card">
              {activePersona ? (
                <>
                  <div className="entity-avatar">
                    <span>{activePersona.displayName[0]}</span>
                  </div>
                  <div className="entity-info">
                    <span className="entity-name">{activePersona.displayName}</span>
                    {activePersona.appearance && (
                      <span className="entity-meta">{activePersona.appearance.substring(0, 100)}...</span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-muted">No persona selected. Go to Settings to create one.</p>
              )}
            </div>

            <div className="status-section">
              <div className="status-control">
                <div className="capacity-header">
                  <label>Capacity: {sessionState.capacity}%</label>
                  <div className="capacity-buttons">
                    <button
                      className="capacity-btn"
                      onClick={() => {
                        const newCapacity = Math.max(0, sessionState.capacity - 5);
                        sendWsMessage('update_capacity', { capacity: newCapacity });
                      }}
                    >−</button>
                    <button
                      className="capacity-btn"
                      onClick={() => {
                        const newCapacity = Math.min(100, sessionState.capacity + 5);
                        sendWsMessage('update_capacity', { capacity: newCapacity });
                      }}
                    >+</button>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sessionState.capacity}
                  onChange={(e) => sendWsMessage('update_capacity', { capacity: parseInt(e.target.value) })}
                />
                <div className="capacity-bar">
                  <div
                    className="capacity-fill"
                    style={{ width: `${sessionState.capacity}%` }}
                  />
                </div>
              </div>
              <div className="status-control">
                <label>Sensation</label>
                <select
                  value={sessionState.sensation}
                  onChange={(e) => sendWsMessage('update_sensation', { sensation: e.target.value })}
                >
                  <option value="normal">Normal</option>
                  <option value="slight fullness">Slight Fullness</option>
                  <option value="full">Full</option>
                  <option value="very full">Very Full</option>
                  <option value="bloated">Bloated</option>
                  <option value="tight">Tight</option>
                  <option value="stretched">Stretched</option>
                  <option value="cramping">Cramping</option>
                  <option value="pressure">Pressure</option>
                  <option value="stuffed">Stuffed</option>
                  <option value="bursting">Bursting</option>
                </select>
              </div>
              <div className="status-control">
                <label>Emotion</label>
                <select
                  value={sessionState.emotion}
                  onChange={(e) => sendWsMessage('update_emotion', { emotion: e.target.value })}
                >
                  <option value="neutral">Neutral</option>
                  <option value="relaxed">Relaxed</option>
                  <option value="curious">Curious</option>
                  <option value="nervous">Nervous</option>
                  <option value="excited">Excited</option>
                  <option value="aroused">Aroused</option>
                  <option value="embarrassed">Embarrassed</option>
                  <option value="anxious">Anxious</option>
                  <option value="submissive">Submissive</option>
                  <option value="defiant">Defiant</option>
                  <option value="overwhelmed">Overwhelmed</option>
                  <option value="blissful">Blissful</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="sidebar-tab-content">
            {activeCharacter ? (
              <div className="character-portrait">
                {activeCharacter.avatar ? (
                  <img src={activeCharacter.avatar} alt={activeCharacter.name} />
                ) : (
                  <div className="character-portrait-placeholder">
                    <span>{activeCharacter.name[0]}</span>
                  </div>
                )}
                <div className="character-portrait-name">{activeCharacter.name}</div>
              </div>
            ) : (
              <p className="text-muted">No character selected. Go to Settings to select one.</p>
            )}

            {/* Auto Reply Toggle */}
            {activeCharacter && (
              <div className="auto-reply-section">
                <label className="auto-reply-toggle">
                  <input
                    type="checkbox"
                    checked={autoReply}
                    onChange={(e) => {
                      setAutoReply(e.target.checked);
                      sendWsMessage('set_auto_reply', { enabled: e.target.checked });
                    }}
                  />
                  <span>Auto Reply</span>
                </label>
              </div>
            )}

            {activeCharacter && (
              <div className="reminders-section">
                <div className="reminders-header">
                  <h4>Constant Reminders</h4>
                  <button
                    className="btn-icon"
                    onClick={handleAddReminder}
                    title="Add reminder"
                  >+</button>
                </div>
                <div className="reminders-list">
                  {(activeCharacter.constantReminders || []).length === 0 ? (
                    <p className="text-muted">No reminders yet.</p>
                  ) : (
                    (activeCharacter.constantReminders || []).map(reminder => (
                      <div key={reminder.id} className={`reminder-item ${reminder.enabled === false ? 'disabled' : ''}`}>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={reminder.enabled !== false}
                            onChange={(e) => handleToggleReminder(reminder.id, e.target.checked)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                        <div className="reminder-content">
                          <div className={`reminder-name ${reminder.enabled === false ? 'strikethrough' : ''}`}>{reminder.name}</div>
                          <div className="reminder-text">{substituteVariables(reminder.text, subContext).substring(0, 60)}{reminder.text.length > 60 ? '...' : ''}</div>
                        </div>
                        <div className="reminder-actions">
                          <button
                            className="btn-icon-small"
                            onClick={() => handleEditReminder(reminder)}
                            title="Edit"
                          >✏️</button>
                          <button
                            className="btn-icon-small"
                            onClick={() => handleDeleteReminder(reminder.id)}
                            title="Delete"
                          >🗑️</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Global Reminders */}
            {settings?.globalReminders && settings.globalReminders.length > 0 && (
              <div className="reminders-section global-reminders-section">
                <div className="reminders-header">
                  <h4>Global Reminders</h4>
                </div>
                <div className="reminders-list">
                  {settings.globalReminders.map(reminder => (
                    <div key={reminder.id} className={`reminder-item ${reminder.enabled === false ? 'disabled' : ''}`}>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={reminder.enabled !== false}
                          onChange={(e) => handleToggleGlobalReminder(reminder.id, e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                      <div className="reminder-content">
                        <div className={`reminder-name ${reminder.enabled === false ? 'strikethrough' : ''}`}>{reminder.name || 'Global'}</div>
                        <div className="reminder-text">{substituteVariables(reminder.text, subContext).substring(0, 60)}{reminder.text?.length > 60 ? '...' : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
                    {msg.sender === 'player' ? 'You' : msg.characterName || 'Character'}
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
          <div className="input-with-history">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={activeCharacter ? `Message ${activeCharacter.name}...` : 'Select a character to chat...'}
              disabled={!activeCharacter || isGenerating}
            />
            <div className="history-arrows">
              <button
                type="button"
                className="history-arrow"
                onClick={() => handleInputKeyDown({ key: 'ArrowUp', preventDefault: () => {} })}
                disabled={messageHistory.length === 0}
                title="Previous message"
              >▲</button>
              <button
                type="button"
                className="history-arrow"
                onClick={() => handleInputKeyDown({ key: 'ArrowDown', preventDefault: () => {} })}
                disabled={historyIndex === -1}
                title="Next message"
              >▼</button>
            </div>
          </div>
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
        </form>
      </div>

      {/* Session Modals */}
      <SaveSessionModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSaveSession}
        defaultName={getDefaultSessionName()}
      />

      <LoadSessionModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onLoad={handleLoadSession}
        onSaveFirst={handleSaveSession}
        sessions={savedSessions}
        hasUnsavedChanges={hasUnsavedChanges}
        defaultSaveName={getDefaultSessionName()}
      />

      {/* Right Sidebar */}
      <div className="chat-sidebar chat-sidebar-right">
        {/* Control Panel Section - ABOVE tabs */}
        <div className="sidebar-section control-panel-section">
          <h3>Control Panel</h3>

          {/* Mode Selection */}
          <div className="control-panel-row">
            <div className="status-control">
              <label>
                Mode
                <span
                  className="info-icon"
                  title="Interactive: Commands execute on real devices. Simulated: Commands are logged but not executed (for testing)."
                >?</span>
                {simulationRequired && <span className="mode-locked-indicator">(Locked)</span>}
              </label>
              <select
                value={controlMode}
                onChange={(e) => handleModeChange(e.target.value)}
                className={`control-panel-select ${simulationRequired ? 'locked' : ''}`}
                disabled={simulationRequired}
                title={simulationRequired ? `Locked: ${simulationReason}` : ''}
              >
                <option value="interactive">Interactive</option>
                <option value="simulated">Simulated</option>
              </select>
            </div>
          </div>

          {/* Device States List */}
          <div className="device-states-section">
            <h4>Device States</h4>
            {devices.length === 0 ? (
              <p className="text-muted">No devices configured</p>
            ) : (
              <div className="device-states-list">
                {devices.map(device => {
                  const deviceState = polledDeviceStates[device.ip];
                  const isOn = deviceState?.state === 'on' || deviceState?.relayState === 1;
                  const isUnknown = deviceState?.state === 'unknown';
                  const isInfiniteCycle = infiniteCycles && infiniteCycles[device.ip];

                  return (
                    <div key={device.id} className={`device-state-item ${isInfiniteCycle ? 'expanded' : ''}`}>
                      <div className="device-state-row">
                        <span className={`device-state-dot ${isUnknown ? 'unknown' : isOn ? 'on' : 'off'}`}></span>
                        <span className="device-state-name">
                          {device.label || device.name}
                        </span>
                        <div className="device-state-controls">
                          <button
                            className="device-control-btn on-btn"
                            onClick={() => handleManualDeviceOn(device)}
                            disabled={controlMode === 'simulated' ? false : isOn}
                            title="Turn ON"
                          >
                            ON
                          </button>
                          <button
                            className="device-control-btn off-btn"
                            onClick={() => handleManualDeviceOff(device)}
                            disabled={controlMode === 'simulated' ? false : !isOn}
                            title="Turn OFF"
                          >
                            OFF
                          </button>
                        </div>
                      </div>
                      {isInfiniteCycle && (
                        <div className="device-state-row infinite-cycle-row">
                          <span className="infinite-cycle-label">Infinite Cycle</span>
                          <button
                            className="device-control-btn end-btn"
                            onClick={() => sendWsMessage('end_infinite_cycle', { deviceIp: device.ip })}
                            title="End Cycle"
                          >
                            END
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Character Buttons - Direct display */}
        <div className="events-section">
          <h4>Character Events</h4>
          {activeCharacter && (activeCharacter.buttons || activeCharacter.events) && (activeCharacter.buttons?.length > 0 || activeCharacter.events?.length > 0) ? (
            <div className="events-list">
              {(activeCharacter.buttons || activeCharacter.events).map(button => (
                <button
                  key={button.buttonId || button.id}
                  className={`event-button ${button.enabled === false ? 'disabled' : ''}`}
                  onClick={() => button.enabled !== false && handleExecuteButton(button)}
                  disabled={button.enabled === false}
                >
                  {button.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted">No buttons configured for this character.</p>
          )}
        </div>
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
