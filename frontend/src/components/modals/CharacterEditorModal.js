import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useDraft, getDraftKey } from '../../hooks/useDraft';
import './CharacterEditorModal.css';

function CharacterEditorModal({ isOpen, onClose, onSave, character }) {
  const { flows, devices } = useApp();

  // Calculate initial data from character prop
  const initialData = useMemo(() => {
    if (character) {
      const welcomeMessages = character.welcomeMessages || (character.firstMessage ? [
        { id: 'wm-1', text: character.firstMessage, llmEnhanced: false }
      ] : []);
      const scenarios = character.scenarios || (character.scenario ? [
        { id: 'sc-1', text: character.scenario }
      ] : []);

      return {
        name: character.name || '',
        avatar: character.avatar || '',
        description: character.description || '',
        personality: character.personality || '',
        startingEmotion: character.startingEmotion || 'neutral',
        autoReplyEnabled: character.autoReplyEnabled || false,
        welcomeMessages,
        scenarios,
        activeWelcomeMessageId: character.activeWelcomeMessageId || (welcomeMessages[0]?.id || null),
        activeScenarioId: character.activeScenarioId || (scenarios[0]?.id || null),
        exampleDialogues: character.exampleDialogues || [],
        buttons: character.buttons || character.events || [],
        constantReminders: character.constantReminders || []
      };
    }

    // New character defaults
    const initialWelcome = { id: 'wm-1', text: '', llmEnhanced: false };
    const initialScenario = { id: 'sc-1', text: '' };
    return {
      name: '',
      avatar: '',
      description: '',
      personality: '',
      startingEmotion: 'neutral',
      autoReplyEnabled: false,
      welcomeMessages: [initialWelcome],
      scenarios: [initialScenario],
      activeWelcomeMessageId: 'wm-1',
      activeScenarioId: 'sc-1',
      exampleDialogues: [],
      buttons: [],
      constantReminders: []
    };
  }, [character]);

  // Use draft persistence - survives accidental modal dismissal
  const draftKey = getDraftKey('character', character?.id);
  const { formData, setFormData, clearDraft, hasDraft } = useDraft(draftKey, initialData, isOpen);

  const [selectedWelcomeId, setSelectedWelcomeId] = useState(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [newDialogue, setNewDialogue] = useState({ user: '', character: '' });
  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [showButtonForm, setShowButtonForm] = useState(false);
  const [editingButtonId, setEditingButtonId] = useState(null);
  const [buttonForm, setButtonForm] = useState({ name: '', buttonId: null, actions: [] });
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState(null);
  const [reminderForm, setReminderForm] = useState({ name: '', text: '' });
  const fileInputRef = React.useRef(null);

  // Sync selected IDs when formData changes (handles draft restoration)
  useEffect(() => {
    if (isOpen && formData.welcomeMessages?.length > 0) {
      setSelectedWelcomeId(formData.activeWelcomeMessageId || formData.welcomeMessages[0]?.id || null);
    }
    if (isOpen && formData.scenarios?.length > 0) {
      setSelectedScenarioId(formData.activeScenarioId || formData.scenarios[0]?.id || null);
    }
  }, [isOpen, formData.activeWelcomeMessageId, formData.activeScenarioId, formData.welcomeMessages, formData.scenarios]);

  if (!isOpen) return null;

  const getActiveWelcome = () => {
    return formData.welcomeMessages.find(w => w.id === selectedWelcomeId) || formData.welcomeMessages[0];
  };

  const getActiveScenario = () => {
    return formData.scenarios.find(s => s.id === selectedScenarioId) || formData.scenarios[0];
  };

  const handleAddWelcomeMessage = () => {
    const newId = `wm-${Date.now()}`;
    const newWelcome = { id: newId, text: '', llmEnhanced: false };
    setFormData({
      ...formData,
      welcomeMessages: [...formData.welcomeMessages, newWelcome]
    });
    setSelectedWelcomeId(newId);
  };

  const handleDeleteWelcomeMessage = () => {
    if (formData.welcomeMessages.length <= 1) {
      alert('Cannot delete the last welcome message');
      return;
    }
    const filtered = formData.welcomeMessages.filter(w => w.id !== selectedWelcomeId);
    const newSelected = filtered[0]?.id || null;
    setFormData({
      ...formData,
      welcomeMessages: filtered,
      activeWelcomeMessageId: newSelected
    });
    setSelectedWelcomeId(newSelected);
  };

  const handleToggleLLMEnhancement = () => {
    setFormData({
      ...formData,
      welcomeMessages: formData.welcomeMessages.map(w =>
        w.id === selectedWelcomeId ? { ...w, llmEnhanced: !w.llmEnhanced } : w
      )
    });
  };

  const handleUpdateWelcomeText = (text) => {
    setFormData({
      ...formData,
      welcomeMessages: formData.welcomeMessages.map(w =>
        w.id === selectedWelcomeId ? { ...w, text } : w
      )
    });
  };

  const handleAddScenario = () => {
    const newId = `sc-${Date.now()}`;
    const newScenario = { id: newId, text: '' };
    setFormData({
      ...formData,
      scenarios: [...formData.scenarios, newScenario]
    });
    setSelectedScenarioId(newId);
  };

  const handleDeleteScenario = () => {
    if (formData.scenarios.length <= 1) {
      alert('Cannot delete the last scenario');
      return;
    }
    const filtered = formData.scenarios.filter(s => s.id !== selectedScenarioId);
    const newSelected = filtered[0]?.id || null;
    setFormData({
      ...formData,
      scenarios: filtered,
      activeScenarioId: newSelected
    });
    setSelectedScenarioId(newSelected);
  };

  const handleUpdateScenarioText = (text) => {
    setFormData({
      ...formData,
      scenarios: formData.scenarios.map(s =>
        s.id === selectedScenarioId ? { ...s, text } : s
      )
    });
  };

  const handleAddDialogue = () => {
    if (newDialogue.user.trim() && newDialogue.character.trim()) {
      setFormData({
        ...formData,
        exampleDialogues: [...formData.exampleDialogues, newDialogue]
      });
      setNewDialogue({ user: '', character: '' });
    }
  };

  const handleRemoveDialogue = (index) => {
    setFormData({
      ...formData,
      exampleDialogues: formData.exampleDialogues.filter((_, i) => i !== index)
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Character name is required');
      return;
    }

    // Set active IDs to selected ones
    const saveData = {
      ...formData,
      activeWelcomeMessageId: selectedWelcomeId,
      activeScenarioId: selectedScenarioId
    };

    // Clear draft on successful save
    clearDraft();
    onSave(saveData);
  };

  const handleCancel = () => {
    onClose();
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      // Always show resize modal to fit to 3:4 portrait aspect ratio
      setUploadedImage(event.target.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropSave = (croppedImageData) => {
    setFormData({ ...formData, avatar: croppedImageData });
    setShowCropModal(false);
    setUploadedImage(null);
  };

  const handleCropCancel = () => {
    setShowCropModal(false);
    setUploadedImage(null);
  };

  // Button management functions
  const getNextButtonId = () => {
    const existingIds = formData.buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
    return existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
  };

  const handleAddButton = () => {
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: getNextButtonId(), actions: [], enabled: true });
    setShowButtonForm(true);
  };

  const handleToggleButton = (buttonId, enabled) => {
    const updatedButtons = formData.buttons.map(b =>
      b.buttonId === buttonId ? { ...b, enabled } : b
    );
    setFormData({ ...formData, buttons: updatedButtons });
  };

  const handleEditButton = (button) => {
    setEditingButtonId(button.buttonId);
    setButtonForm({ ...button });
    setShowButtonForm(true);
  };

  const handleDeleteButton = (buttonId) => {
    if (window.confirm('Delete this button?')) {
      const updatedButtons = formData.buttons.filter(b => b.buttonId !== buttonId);
      setFormData({ ...formData, buttons: updatedButtons });
    }
  };

  const handleSaveButton = () => {
    if (!buttonForm.name.trim()) {
      alert('Button name is required');
      return;
    }

    if (editingButtonId !== null) {
      // Update existing
      const updatedButtons = formData.buttons.map(b =>
        b.buttonId === editingButtonId ? buttonForm : b
      );
      setFormData({ ...formData, buttons: updatedButtons });
    } else {
      // Add new
      setFormData({ ...formData, buttons: [...formData.buttons, buttonForm] });
    }

    setShowButtonForm(false);
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: null, actions: [] });
  };

  const handleCancelButtonEdit = () => {
    setShowButtonForm(false);
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: null, actions: [] });
  };

  const handleAddAction = () => {
    setButtonForm({
      ...buttonForm,
      actions: [...buttonForm.actions, { type: 'message', config: {} }]
    });
  };

  const handleUpdateAction = (index, field, value) => {
    const updatedActions = [...buttonForm.actions];
    if (field === 'type') {
      updatedActions[index] = { type: value, config: {} };
    } else {
      updatedActions[index].config[field] = value;
    }
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleDeleteAction = (index) => {
    const updatedActions = buttonForm.actions.filter((_, i) => i !== index);
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleMoveAction = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === buttonForm.actions.length - 1) return;

    const updatedActions = [...buttonForm.actions];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [updatedActions[index], updatedActions[newIndex]] = [updatedActions[newIndex], updatedActions[index]];
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  // Reminder functions
  const handleAddReminder = () => {
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '' });
    setShowReminderForm(true);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminderId(reminder.id);
    setReminderForm({ name: reminder.name, text: reminder.text });
    setShowReminderForm(true);
  };

  const handleDeleteReminder = (reminderId) => {
    if (window.confirm('Delete this reminder?')) {
      const updatedReminders = formData.constantReminders.filter(r => r.id !== reminderId);
      setFormData({ ...formData, constantReminders: updatedReminders });
    }
  };

  const handleToggleReminder = (reminderId, enabled) => {
    const updatedReminders = formData.constantReminders.map(r =>
      r.id === reminderId ? { ...r, enabled } : r
    );
    setFormData({ ...formData, constantReminders: updatedReminders });
  };

  const handleSaveReminder = () => {
    if (!reminderForm.name.trim() || !reminderForm.text.trim()) {
      alert('Reminder name and text are required');
      return;
    }

    if (editingReminderId) {
      // Update existing
      const updatedReminders = formData.constantReminders.map(r =>
        r.id === editingReminderId ? { ...r, name: reminderForm.name, text: reminderForm.text } : r
      );
      setFormData({ ...formData, constantReminders: updatedReminders });
    } else {
      // Add new
      const newReminder = {
        id: `reminder-${Date.now()}`,
        name: reminderForm.name,
        text: reminderForm.text,
        enabled: true
      };
      setFormData({ ...formData, constantReminders: [...formData.constantReminders, newReminder] });
    }

    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '' });
  };

  const handleCancelReminderEdit = () => {
    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '' });
  };

  const activeWelcome = getActiveWelcome();
  const activeScenario = getActiveScenario();

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal character-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{character ? 'Edit Character' : 'New Character'}</h3>
          {hasDraft && (
            <span className="draft-indicator" title="Unsaved changes restored from previous session">
              Draft restored
            </span>
          )}
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            Basic
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'reminders' ? 'active' : ''}`}
            onClick={() => setActiveTab('reminders')}
          >
            Constant Reminders
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Custom Buttons
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: activeTab === 'basic' ? 'block' : 'none' }}>
            <div className="editor-layout">
              {/* Left Column - Basic Info */}
              <div className="editor-left">
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Character name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief character description..."
                    rows={4}
                  />
                </div>

                <div className="form-group">
                  <label>Personality</label>
                  <textarea
                    value={formData.personality}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    placeholder="Detailed personality traits..."
                    rows={5}
                  />
                </div>

                <div className="form-group">
                  <label>Starting Persona Emotion</label>
                  <select
                    value={formData.startingEmotion}
                    onChange={(e) => setFormData({ ...formData, startingEmotion: e.target.value })}
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

                <div className="form-group auto-reply-group">
                  <label className="toggle-label">
                    <span>Auto Reply</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={formData.autoReplyEnabled}
                        onChange={(e) => setFormData({ ...formData, autoReplyEnabled: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </label>
                  <p className="form-help">Automatically send character response after player message</p>
                </div>
              </div>

              {/* Right Column - Avatar Upload */}
              <div className="editor-right">
                <label>Character Avatar</label>
                <div
                  className="avatar-upload-area"
                  onClick={handleImageClick}
                >
                  {formData.avatar ? (
                    <img src={formData.avatar} alt="Character avatar" className="avatar-preview" />
                  ) : (
                    <div className="avatar-placeholder">
                      <span className="upload-icon">📷</span>
                      <span className="upload-text">Click to upload</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                {formData.avatar && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, avatar: '' });
                    }}
                    style={{ marginTop: '0.5rem', width: '100%' }}
                  >
                    Remove Avatar
                  </button>
                )}
              </div>
            </div>

            {/* Welcome Message Section */}
            <div className="form-group version-group">
              <div className="version-header">
                <label>Welcome Message</label>
                <div className="version-controls">
                  <button
                    type="button"
                    className="btn-icon btn-add"
                    onClick={handleAddWelcomeMessage}
                    title="Add new welcome message"
                  >+</button>
                  <button
                    type="button"
                    className="btn-icon btn-delete"
                    onClick={handleDeleteWelcomeMessage}
                    title="Delete current welcome message"
                    disabled={formData.welcomeMessages.length <= 1}
                  >🗑️</button>
                  <button
                    type="button"
                    className={`btn-icon btn-llm ${activeWelcome?.llmEnhanced ? 'active' : ''}`}
                    onClick={handleToggleLLMEnhancement}
                    title="Toggle LLM Enhancement"
                  >🤖</button>
                  <select
                    value={selectedWelcomeId || ''}
                    onChange={(e) => setSelectedWelcomeId(e.target.value)}
                    className="version-select"
                  >
                    {formData.welcomeMessages.map((w, i) => (
                      <option key={w.id} value={w.id}>
                        Version {i + 1} {w.llmEnhanced ? '🤖' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea
                value={activeWelcome?.text || ''}
                onChange={(e) => handleUpdateWelcomeText(e.target.value)}
                placeholder="The first message the character sends when starting a new conversation..."
                rows={4}
              />
            </div>

            {/* Scenario Section */}
            <div className="form-group version-group">
              <div className="version-header">
                <label>Scenario</label>
                <div className="version-controls">
                  <button
                    type="button"
                    className="btn-icon btn-add"
                    onClick={handleAddScenario}
                    title="Add new scenario"
                  >+</button>
                  <button
                    type="button"
                    className="btn-icon btn-delete"
                    onClick={handleDeleteScenario}
                    title="Delete current scenario"
                    disabled={formData.scenarios.length <= 1}
                  >🗑️</button>
                  <select
                    value={selectedScenarioId || ''}
                    onChange={(e) => setSelectedScenarioId(e.target.value)}
                    className="version-select"
                  >
                    {formData.scenarios.map((s, i) => (
                      <option key={s.id} value={s.id}>
                        Version {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea
                value={activeScenario?.text || ''}
                onChange={(e) => handleUpdateScenarioText(e.target.value)}
                placeholder="Current situation/scenario..."
                rows={3}
              />
            </div>

            {/* Example Dialogues */}
            <div className="form-group">
              <label>Example Dialogues</label>
              <div className="dialogues-list">
                {formData.exampleDialogues.map((dialogue, i) => (
                  <div key={i} className="dialogue-item">
                    <div className="dialogue-content">
                      <p><strong>User:</strong> {dialogue.user}</p>
                      <p><strong>{formData.name || 'Character'}:</strong> {dialogue.character}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => handleRemoveDialogue(i)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="add-dialogue">
                <input
                  type="text"
                  placeholder="User says..."
                  value={newDialogue.user}
                  onChange={(e) => setNewDialogue({ ...newDialogue, user: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Character responds..."
                  value={newDialogue.character}
                  onChange={(e) => setNewDialogue({ ...newDialogue, character: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleAddDialogue}
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Constant Reminders Tab */}
          <div className="modal-body" style={{ display: activeTab === 'reminders' ? 'block' : 'none' }}>
            <div className="reminders-editor">
              {!showReminderForm ? (
                <>
                  <div className="events-header">
                    <h4>Constant Reminders</h4>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleAddReminder}
                    >
                      + Add Reminder
                    </button>
                  </div>

                  <div className="events-list-editor">
                    {formData.constantReminders.length === 0 ? (
                      <p className="text-muted">No constant reminders yet. Reminders are always included in the AI's context.</p>
                    ) : (
                      formData.constantReminders.map((reminder) => (
                        <div key={reminder.id} className={`event-item ${reminder.enabled === false ? 'disabled' : ''}`}>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={reminder.enabled !== false}
                              onChange={(e) => handleToggleReminder(reminder.id, e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="event-info">
                            <div className={`event-name ${reminder.enabled === false ? 'strikethrough' : ''}`}>{reminder.name}</div>
                            <div className="event-meta">{reminder.text.substring(0, 60)}{reminder.text.length > 60 ? '...' : ''}</div>
                          </div>
                          <div className="event-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handleEditReminder(reminder)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteReminder(reminder.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="event-form">
                  <h4>{editingReminderId ? 'Edit' : 'Add'} Constant Reminder</h4>

                  <div className="form-group">
                    <label>Reminder Name *</label>
                    <input
                      type="text"
                      value={reminderForm.name}
                      onChange={(e) => setReminderForm({ ...reminderForm, name: e.target.value })}
                      placeholder="Brief identifier..."
                    />
                  </div>

                  <div className="form-group">
                    <label>Reminder Text *</label>
                    <textarea
                      value={reminderForm.text}
                      onChange={(e) => setReminderForm({ ...reminderForm, text: e.target.value })}
                      placeholder="What the AI should always remember..."
                      rows={4}
                    />
                  </div>

                  <div className="event-form-buttons">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCancelReminderEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveReminder}
                    >
                      {editingReminderId ? 'Update' : 'Create'} Reminder
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Events Tab */}
          <div className="modal-body" style={{ display: activeTab === 'events' ? 'block' : 'none' }}>
            <div className="events-editor">
              {!showButtonForm ? (
                <>
                  <div className="events-header">
                    <h4>Character Buttons</h4>
                    <div className="events-header-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleAddButton}
                        disabled={formData.buttons.length >= 12}
                      >
                        + Add Button
                      </button>
                      {formData.buttons.length >= 12 && (
                        <span className="limit-warning">Maximum 12 buttons</span>
                      )}
                    </div>
                  </div>

                  <div className="events-list-editor">
                    {formData.buttons.length === 0 ? (
                      <p className="text-muted">No buttons yet. Buttons execute actions like cycling pumps or sending messages.</p>
                    ) : (
                      formData.buttons.map((button) => (
                        <div key={button.buttonId} className={`event-item ${button.enabled === false ? 'disabled' : ''}`}>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={button.enabled !== false}
                              onChange={(e) => handleToggleButton(button.buttonId, e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="event-info">
                            <div className={`event-name ${button.enabled === false ? 'strikethrough' : ''}`}>{button.name} <span style={{color: '#888'}}>#{button.buttonId}</span></div>
                            <div className="event-meta">{button.actions.length} action(s)</div>
                          </div>
                          <div className="event-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handleEditButton(button)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteButton(button.buttonId)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="event-form">
                  <h4>{editingButtonId !== null ? `Edit Button #${editingButtonId}` : `New Button #${buttonForm.buttonId}`}</h4>

                  <div className="form-group">
                    <label>Button Name *</label>
                    <input
                      type="text"
                      value={buttonForm.name}
                      onChange={(e) => setButtonForm({ ...buttonForm, name: e.target.value })}
                      placeholder="e.g., 'Quick Inflate'"
                    />
                  </div>

                  <div className="form-group">
                    <div className="actions-header">
                      <label>Actions (execute in order)</label>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={handleAddAction}
                      >
                        + Add Action
                      </button>
                    </div>

                    <div className="actions-list">
                      {buttonForm.actions.length === 0 ? (
                        <p className="text-muted">No actions yet. Add actions to define what this button does.</p>
                      ) : (
                        buttonForm.actions.map((action, index) => (
                          <div key={index} className="action-item">
                            <div className="action-reorder">
                              <button
                                type="button"
                                className="btn-icon-small"
                                onClick={() => handleMoveAction(index, 'up')}
                                disabled={index === 0}
                                title="Move up"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                className="btn-icon-small"
                                onClick={() => handleMoveAction(index, 'down')}
                                disabled={index === buttonForm.actions.length - 1}
                                title="Move down"
                              >
                                ▼
                              </button>
                            </div>

                            <div className="action-config">
                              <select
                                value={action.type}
                                onChange={(e) => handleUpdateAction(index, 'type', e.target.value)}
                              >
                                <option value="message">Send Message</option>
                                <option value="turn_on">Turn On Device</option>
                                <option value="cycle">Cycle Device</option>
                                <option value="link_to_flow">Link to Flow</option>
                              </select>

                              {action.type === 'message' && (
                                <>
                                  <textarea
                                    value={action.config.text || ''}
                                    onChange={(e) => handleUpdateAction(index, 'text', e.target.value)}
                                    placeholder="Instruction for AI to generate message..."
                                    rows={2}
                                  />
                                  <p className="node-hint" style={{fontSize: '0.75rem', color: '#888', margin: '0.25rem 0 0 0'}}>
                                    Tip: Use [Player] for persona name. Example: "Greet [Player] warmly and ask how they're feeling"
                                  </p>
                                </>
                              )}

                              {(action.type === 'turn_on' || action.type === 'cycle') && (
                                <select
                                  value={action.config.device || ''}
                                  onChange={(e) => handleUpdateAction(index, 'device', e.target.value)}
                                >
                                  <option value="">Select Device...</option>
                                  <option value="primary_pump">Primary Pump</option>
                                  {devices && devices.length > 0 && (
                                    <>
                                      <option disabled>──────────</option>
                                      {devices.map((device) => {
                                        const deviceKey = device.brand === 'govee'
                                          ? `govee:${device.deviceId}`
                                          : device.brand === 'tuya'
                                            ? `tuya:${device.deviceId}`
                                            : device.childId
                                              ? `${device.ip}:${device.childId}`
                                              : device.ip;
                                        const deviceLabel = device.name || device.alias || device.ip || device.deviceId;
                                        return (
                                          <option key={deviceKey} value={deviceKey}>
                                            {deviceLabel}
                                          </option>
                                        );
                                      })}
                                    </>
                                  )}
                                </select>
                              )}

                              {action.type === 'cycle' && (
                                <>
                                  <input
                                    type="number"
                                    value={action.config.duration || 5}
                                    onChange={(e) => handleUpdateAction(index, 'duration', parseInt(e.target.value))}
                                    placeholder="Duration (s)"
                                    min="1"
                                  />
                                  <input
                                    type="number"
                                    value={action.config.interval || 2}
                                    onChange={(e) => handleUpdateAction(index, 'interval', parseInt(e.target.value))}
                                    placeholder="Interval (s)"
                                    min="1"
                                  />
                                </>
                              )}

                              {action.type === 'link_to_flow' && (
                                <>
                                  <select
                                    value={action.config.flowId || ''}
                                    onChange={(e) => {
                                      handleUpdateAction(index, 'flowId', e.target.value);
                                      handleUpdateAction(index, 'flowActionLabel', ''); // Reset label when flow changes
                                    }}
                                  >
                                    <option value="">Select Flow...</option>
                                    {flows && flows.length > 0 ? (
                                      <>
                                        {formData.assignedFlows && formData.assignedFlows.length > 0 && (
                                          <optgroup label="Assigned to this Character">
                                            {flows.filter(f => formData.assignedFlows.includes(f.id)).map(flow => (
                                              <option key={flow.id} value={flow.id}>{flow.name}</option>
                                            ))}
                                          </optgroup>
                                        )}
                                        <optgroup label="All Flows">
                                          {flows.map(flow => (
                                            <option key={flow.id} value={flow.id}>{flow.name}</option>
                                          ))}
                                        </optgroup>
                                      </>
                                    ) : (
                                      <option disabled>No flows available</option>
                                    )}
                                  </select>

                                  {action.config.flowId && (() => {
                                    const selectedFlow = flows?.find(f => f.id === action.config.flowId);
                                    const flowActions = selectedFlow?.nodes?.filter(n => n.type === 'button_press') || [];
                                    return flowActions.length > 0 ? (
                                      <select
                                        value={action.config.flowActionLabel || ''}
                                        onChange={(e) => handleUpdateAction(index, 'flowActionLabel', e.target.value)}
                                        style={{marginTop: '0.5rem'}}
                                      >
                                        <option value="">Select FlowAction...</option>
                                        {flowActions.map((node, idx) => {
                                          const label = node.data.label || `Unnamed FlowAction ${idx + 1}`;
                                          return (
                                            <option key={`${action.config.flowId}-${node.id}-${idx}`} value={label}>
                                              {label}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    ) : (
                                      <p className="node-hint" style={{fontSize: '0.75rem', color: '#f66', margin: '0.25rem 0 0 0'}}>
                                        No Button Press FlowActions found in this flow. Add a Button Press trigger node first.
                                      </p>
                                    );
                                  })()}

                                  <p className="node-hint" style={{fontSize: '0.75rem', color: '#888', margin: '0.25rem 0 0 0'}}>
                                    Select which FlowAction (Button Press section) to trigger in the flow
                                  </p>
                                </>
                              )}
                            </div>

                            <button
                              type="button"
                              className="btn-icon-small"
                              onClick={() => handleDeleteAction(index)}
                              title="Delete action"
                            >
                              🗑️
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="event-form-buttons">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCancelButtonEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveButton}
                    >
                      {editingButtonId !== null ? 'Update' : 'Create'} Button
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {character ? 'Update' : 'Create'} Character
            </button>
          </div>
        </form>
      </div>

      {/* Image Crop Modal */}
      {showCropModal && (
        <ImageCropModal
          image={uploadedImage}
          onSave={handleCropSave}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}

// Interactive Crop Modal Component (3:4 aspect ratio)
function ImageCropModal({ image, onSave, onCancel }) {
  const containerRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imageObj, setImageObj] = React.useState(null);
  const [displayScale, setDisplayScale] = React.useState(1);
  const [crop, setCrop] = React.useState({ x: 0, y: 0, width: 100, height: 133 });
  const [dragging, setDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

  // Output dimensions: 3:4 portrait aspect ratio
  const OUTPUT_WIDTH = 512;
  const OUTPUT_HEIGHT = 683;
  const ASPECT_RATIO = 3 / 4;

  // Load image
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);

      // Calculate display scale to fit in modal (max 500px wide)
      const maxDisplayWidth = 500;
      const scale = img.width > maxDisplayWidth ? maxDisplayWidth / img.width : 1;
      setDisplayScale(scale);

      // Initialize crop box - as large as possible while maintaining aspect ratio
      const maxCropWidth = img.width;
      const maxCropHeight = img.height;
      let cropWidth, cropHeight;

      if (maxCropWidth / maxCropHeight > ASPECT_RATIO) {
        // Image is wider - constrain by height
        cropHeight = maxCropHeight;
        cropWidth = cropHeight * ASPECT_RATIO;
      } else {
        // Image is taller - constrain by width
        cropWidth = maxCropWidth;
        cropHeight = cropWidth / ASPECT_RATIO;
      }

      // Center the crop
      setCrop({
        x: (img.width - cropWidth) / 2,
        y: (img.height - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight
      });
    };
    img.src = image;
  }, [image]);

  // Handle mouse down on crop box
  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(true);
    setDragStart({
      x: e.clientX - rect.left - crop.x * displayScale,
      y: e.clientY - rect.top - crop.y * displayScale
    });
  };

  // Handle mouse move
  React.useEffect(() => {
    if (!dragging || !imageObj) return;

    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      let newX = (e.clientX - rect.left - dragStart.x) / displayScale;
      let newY = (e.clientY - rect.top - dragStart.y) / displayScale;

      // Constrain to image bounds
      newX = Math.max(0, Math.min(newX, imageObj.width - crop.width));
      newY = Math.max(0, Math.min(newY, imageObj.height - crop.height));

      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStart, displayScale, imageObj, crop.width, crop.height]);

  const handleSave = () => {
    if (!imageObj) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;

    // Draw cropped portion scaled to output size
    ctx.drawImage(
      imageObj,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT
    );

    const croppedData = canvas.toDataURL('image/jpeg', 0.9);
    onSave(croppedData);
  };

  if (!imageObj) return null;

  const displayWidth = imageObj.width * displayScale;
  const displayHeight = imageObj.height * displayScale;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Crop Avatar</h3>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="text-muted" style={{ marginBottom: '1rem' }}>Drag the crop area to select portion</p>
          <div
            ref={containerRef}
            className="crop-container"
            style={{
              width: displayWidth,
              height: displayHeight,
              position: 'relative',
              margin: '0 auto',
              overflow: 'hidden'
            }}
          >
            {/* Base image */}
            <img
              src={image}
              alt="Crop source"
              style={{
                width: displayWidth,
                height: displayHeight,
                display: 'block'
              }}
            />
            {/* Darkened overlay */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              pointerEvents: 'none'
            }} />
            {/* Crop window (shows through) */}
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                left: crop.x * displayScale,
                top: crop.y * displayScale,
                width: crop.width * displayScale,
                height: crop.height * displayScale,
                border: '2px solid #4CAF50',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                cursor: dragging ? 'grabbing' : 'grab',
                backgroundImage: `url(${image})`,
                backgroundSize: `${displayWidth}px ${displayHeight}px`,
                backgroundPosition: `-${crop.x * displayScale}px -${crop.y * displayScale}px`
              }}
            />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default CharacterEditorModal;
