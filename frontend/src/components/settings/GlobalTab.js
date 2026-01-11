import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import FlowAssignmentModal from '../modals/FlowAssignmentModal';
import './SettingsTabs.css';

function GlobalTab() {
  const { flows, sessionState, sendWsMessage, settings, api, controlMode, setControlMode, simulationRequired, simulationReason } = useApp();
  const { showError } = useError();
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const draftInitialized = useRef(false);

  // Global Reminders state
  const [globalReminders, setGlobalReminders] = useState([]);
  const [reminderForm, setReminderForm] = useState({ name: '', text: '' });
  const [editingReminder, setEditingReminder] = useState(null);
  const [isSavingReminders, setIsSavingReminders] = useState(false);

  // Remote Settings state
  const [remoteSettings, setRemoteSettings] = useState({ allowRemote: false, whitelistedIps: [], isLocalRequest: false });
  const [newIp, setNewIp] = useState('');
  const [isLoadingRemote, setIsLoadingRemote] = useState(true);

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    controlMode: true,
    authorNote: false,
    reminders: false,
    flows: false,
    remote: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Load global prompt from settings or restore draft
  useEffect(() => {
    const savedDraft = sessionStorage.getItem('global-prompt-draft');
    if (savedDraft && !draftInitialized.current) {
      setGlobalPrompt(savedDraft);
      setHasDraft(true);
      draftInitialized.current = true;
    } else if (settings?.globalPrompt !== undefined && !draftInitialized.current) {
      setGlobalPrompt(settings.globalPrompt);
      draftInitialized.current = true;
    }
  }, [settings?.globalPrompt]);

  // Auto-save global prompt draft
  useEffect(() => {
    if (!draftInitialized.current) return;
    const timeoutId = setTimeout(() => {
      sessionStorage.setItem('global-prompt-draft', globalPrompt);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [globalPrompt]);

  // Load global reminders from settings
  useEffect(() => {
    if (settings?.globalReminders) {
      setGlobalReminders(settings.globalReminders);
    }
  }, [settings?.globalReminders]);

  // Load remote settings
  useEffect(() => {
    const loadRemoteSettings = async () => {
      try {
        const data = await api.getRemoteSettings();
        setRemoteSettings(data);
      } catch (error) {
        console.error('Failed to load remote settings:', error);
      }
      setIsLoadingRemote(false);
    };
    loadRemoteSettings();
  }, [api]);

  // Remote settings handlers
  const handleToggleAllowRemote = async (enabled) => {
    try {
      const data = await api.updateRemoteSettings({ allowRemote: enabled });
      setRemoteSettings(data);
    } catch (error) {
      showError(error.message || 'Failed to update remote settings');
    }
  };

  const handleAddIp = async () => {
    const ip = newIp.trim();
    if (!ip) return;

    // Basic IPv4 validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) {
      showError('Invalid IPv4 address format');
      return;
    }

    try {
      const data = await api.addWhitelistedIp(ip);
      setRemoteSettings(data);
      setNewIp('');
    } catch (error) {
      showError(error.message || 'Failed to add IP');
    }
  };

  const handleRemoveIp = async (ip) => {
    try {
      const data = await api.removeWhitelistedIp(ip);
      setRemoteSettings(data);
    } catch (error) {
      showError(error.message || 'Failed to remove IP');
    }
  };

  const handleSaveGlobalPrompt = async () => {
    setIsSaving(true);
    try {
      await api.updateSettings({ globalPrompt });
      // Clear draft on successful save
      sessionStorage.removeItem('global-prompt-draft');
      setHasDraft(false);
    } catch (error) {
      console.error('Failed to save global prompt:', error);
    }
    setIsSaving(false);
  };

  // Global Reminders handlers
  const handleToggleReminder = (id, enabled) => {
    const updated = globalReminders.map(r =>
      r.id === id ? { ...r, enabled } : r
    );
    setGlobalReminders(updated);
    // Auto-save on toggle
    saveReminders(updated);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminder(reminder);
    setReminderForm({ name: reminder.name, text: reminder.text });
  };

  const handleDeleteReminder = (id) => {
    const updated = globalReminders.filter(r => r.id !== id);
    setGlobalReminders(updated);
    saveReminders(updated);
  };

  const handleSaveReminder = () => {
    if (!reminderForm.name.trim() || !reminderForm.text.trim()) return;

    let updated;
    if (editingReminder) {
      // Update existing
      updated = globalReminders.map(r =>
        r.id === editingReminder.id
          ? { ...r, name: reminderForm.name, text: reminderForm.text }
          : r
      );
    } else {
      // Add new
      const newReminder = {
        id: `global-reminder-${Date.now()}`,
        name: reminderForm.name,
        text: reminderForm.text,
        enabled: true
      };
      updated = [...globalReminders, newReminder];
    }

    setGlobalReminders(updated);
    setReminderForm({ name: '', text: '' });
    setEditingReminder(null);
    saveReminders(updated);
  };

  const handleCancelEdit = () => {
    setEditingReminder(null);
    setReminderForm({ name: '', text: '' });
  };

  const saveReminders = async (reminders) => {
    setIsSavingReminders(true);
    try {
      await api.updateSettings({ globalReminders: reminders });
    } catch (error) {
      console.error('Failed to save global reminders:', error);
    }
    setIsSavingReminders(false);
  };

  const getGlobalFlows = () => {
    return sessionState.flowAssignments?.global || [];
  };

  const handleSaveFlows = (flowIds) => {
    sendWsMessage('update_global_flows', {
      flows: flowIds
    });
  };

  const getFlowNames = () => {
    const flowIds = getGlobalFlows();
    return flowIds.map(id => {
      const flow = flows.find(f => f.id === id);
      return flow ? flow.name : null;
    }).filter(Boolean);
  };

  return (
    <div className="settings-tab">
      <h2 className="settings-title">Cross Character Persistence</h2>

      {/* Control Mode Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('controlMode')}>
          <span>Control Mode</span>
          <span className="collapse-icon">{expandedSections.controlMode ? '▼' : '▶'}</span>
        </div>
        {expandedSections.controlMode && (
        <div className="settings-section-content">
          <p className="section-description">
            Choose how device commands are executed. Interactive mode sends real commands to devices.
            Simulated mode logs actions without executing them (for testing).
          </p>
          <div className="form-group">
            <label>
              Mode
              {simulationRequired && (
                <span className="mode-locked-indicator" title={simulationReason}> (Locked)</span>
              )}
            </label>
            <select
              value={controlMode}
              onChange={(e) => setControlMode(e.target.value)}
              disabled={simulationRequired}
              title={simulationRequired ? `Locked: ${simulationReason}` : ''}
              className={simulationRequired ? 'locked' : ''}
            >
              <option value="interactive">Interactive</option>
              <option value="simulated">Simulated</option>
            </select>
          </div>
        </div>
        )}
      </div>

      {/* Global Prompt / Author Note Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('authorNote')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
            <span>Author Note / System Instructions</span>
            {hasDraft && (
              <span className="draft-indicator" title="Unsaved changes restored from previous session">
                Draft
              </span>
            )}
          </div>
          <span className="collapse-icon">{expandedSections.authorNote ? '▼' : '▶'}</span>
        </div>
        {expandedSections.authorNote && (
        <div className="settings-section-content">
          <p className="section-description">
            This text is injected into every AI prompt at a high priority position. Use it for persistent instructions,
            writing style guidance, or scenario rules that should always be followed.
          </p>

          <div className="form-group">
            <textarea
              className="global-prompt-textarea"
              value={globalPrompt}
              onChange={(e) => setGlobalPrompt(e.target.value)}
              placeholder="Enter global system instructions here...&#10;&#10;Example:&#10;- Always write in third person&#10;- Include sensory descriptions&#10;- Keep responses under 500 words"
              rows={8}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={handleSaveGlobalPrompt}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Global Prompt'}
          </button>
        </div>
        )}
      </div>

      {/* Global Reminders Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('reminders')}>
          <span>Global Reminders</span>
          <span className="collapse-icon">{expandedSections.reminders ? '▼' : '▶'}</span>
        </div>
        {expandedSections.reminders && (
        <div className="settings-section-content">
          <p className="section-description">
            These reminders apply to all characters and are included in every prompt.
            Names are automatically prefixed with "Global-" in the UI.
          </p>

          <div className="reminders-list">
            {globalReminders.length === 0 ? (
              <p className="empty-message">No global reminders yet. Add one below.</p>
            ) : (
              globalReminders.map(reminder => (
                <div key={reminder.id} className={`reminder-item ${reminder.enabled === false ? 'disabled' : ''}`}>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={reminder.enabled !== false}
                      onChange={(e) => handleToggleReminder(reminder.id, e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="reminder-name">Global-{reminder.name}</span>
                  <div className="reminder-actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => handleEditReminder(reminder)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDeleteReminder(reminder.id)}>Del</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="reminder-form">
            <div className="form-group">
              <label>Reminder Name</label>
              <div className="input-with-prefix">
                <span className="input-prefix">Global-</span>
                <input
                  type="text"
                  value={reminderForm.name}
                  onChange={(e) => setReminderForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Safety, Tone, Boundaries"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Reminder Text</label>
              <textarea
                value={reminderForm.text}
                onChange={(e) => setReminderForm(prev => ({ ...prev, text: e.target.value }))}
                placeholder="Enter the reminder text that will be included in prompts..."
                rows={3}
              />
            </div>
            <div className="reminder-form-actions">
              {editingReminder && (
                <button className="btn btn-secondary" onClick={handleCancelEdit}>Cancel</button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSaveReminder}
                disabled={!reminderForm.name.trim() || !reminderForm.text.trim() || isSavingReminders}
              >
                {isSavingReminders ? 'Saving...' : editingReminder ? 'Update Reminder' : 'Add Reminder'}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Global Flows Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('flows')}>
          <span>Global Flows</span>
          <span className="collapse-icon">{expandedSections.flows ? '▼' : '▶'}</span>
        </div>
        {expandedSections.flows && (
        <div className="settings-section-content">
          <p className="section-description">
            These flows are active regardless of the current character or persona.
            They are bound to this chat session and will be saved/loaded with it.
          </p>

          <div className="global-flows-card-inner">
            <div className="flow-line">
              <span className="flow-line-label">Active Flows:</span>
              <span className="flow-line-content">
                {getFlowNames().join(', ') || 'None'}
              </span>
              <button
                className="btn btn-primary"
                onClick={() => setShowFlowModal(true)}
              >
                Manage Flows
              </button>
            </div>
          </div>

          {getGlobalFlows().length > 0 && (
            <div className="flow-info">
              <p>
                {getGlobalFlows().length} global flow{getGlobalFlows().length !== 1 ? 's' : ''} assigned
              </p>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Remote Connections Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('remote')}>
          <span>Remote Connections</span>
          <span className="collapse-icon">{expandedSections.remote ? '▼' : '▶'}</span>
        </div>
        {expandedSections.remote && (
        <div className="settings-section-content">
          <p className="section-description">
            Control access to this SwellDreams instance from other devices on your network or via Tailscale.
            {!remoteSettings.isLocalRequest && (
              <strong className="remote-warning"> You are viewing from a remote device - settings cannot be modified.</strong>
            )}
          </p>

          {isLoadingRemote ? (
            <p>Loading remote settings...</p>
          ) : (
            <>
              <div className="remote-toggle-row">
                <label className={`toggle-switch ${!remoteSettings.isLocalRequest ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={remoteSettings.allowRemote}
                    onChange={(e) => handleToggleAllowRemote(e.target.checked)}
                    disabled={!remoteSettings.isLocalRequest}
                  />
                  <span className="toggle-slider"></span>
                </label>
                <span className="toggle-label">Allow Remote Connections</span>
              </div>

              {remoteSettings.allowRemote && (
                <div className="ip-whitelist-section">
                  <h4>IP Whitelist</h4>
                  <p className="section-hint">
                    Only whitelisted IPs can access this instance remotely. Add your Tailscale or local network IPs.
                  </p>

                  {remoteSettings.isLocalRequest && (
                    <div className="add-ip-form">
                      <input
                        type="text"
                        value={newIp}
                        onChange={(e) => setNewIp(e.target.value)}
                        placeholder="e.g., 100.64.0.1"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddIp()}
                      />
                      <button className="btn btn-primary" onClick={handleAddIp}>
                        Add IP
                      </button>
                    </div>
                  )}

                  <div className="ip-whitelist">
                    {remoteSettings.whitelistedIps.length === 0 ? (
                      <p className="empty-message">No IPs whitelisted. Remote access is effectively disabled.</p>
                    ) : (
                      remoteSettings.whitelistedIps.map((ip) => (
                        <div key={ip} className="ip-item">
                          <span className="ip-address">{ip}</span>
                          {remoteSettings.isLocalRequest && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleRemoveIp(ip)}
                              title="Remove IP"
                            >
                              Del
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </div>

      <FlowAssignmentModal
        isOpen={showFlowModal}
        onClose={() => setShowFlowModal(false)}
        onSave={handleSaveFlows}
        flows={flows}
        assignedFlowIds={getGlobalFlows()}
        category="global"
        title="Assign Global Flows"
      />
    </div>
  );
}

export default GlobalTab;
