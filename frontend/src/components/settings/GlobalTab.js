import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import FlowAssignmentModal from '../modals/FlowAssignmentModal';
import './SettingsTabs.css';

function GlobalTab() {
  const { flows, sessionState, sendWsMessage, settings, api } = useApp();
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
      {/* Global Prompt / Author Note Section */}
      <div className="global-prompt-section">
        <div className="section-header-with-draft">
          <h3>Author Note / System Instructions</h3>
          {hasDraft && (
            <span className="draft-indicator" title="Unsaved changes restored from previous session">
              Draft restored
            </span>
          )}
        </div>
        <p className="text-muted">
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

      {/* Global Reminders Section */}
      <div className="global-reminders-section">
        <h3>Global Reminders</h3>
        <p className="text-muted">
          These reminders apply to all characters and are included in every prompt.
          Names are automatically prefixed with "Global-" in the UI.
        </p>

        <div className="reminders-list">
          {globalReminders.length === 0 ? (
            <p className="text-muted empty-message">No global reminders yet. Add one below.</p>
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
                  <button className="btn btn-sm" onClick={() => handleEditReminder(reminder)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDeleteReminder(reminder.id)}>Delete</button>
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

      <div className="global-flows-section">
        <h3>Global Flows</h3>
        <p className="text-muted">
          These flows are active regardless of the current character or persona.
          They are bound to this chat session and will be saved/loaded with it.
        </p>

        <div className="global-flows-card">
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
            <p className="text-muted">
              {getGlobalFlows().length} global flow{getGlobalFlows().length !== 1 ? 's' : ''} assigned
            </p>
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
