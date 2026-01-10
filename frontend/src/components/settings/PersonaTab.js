import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import FlowAssignmentModal from '../modals/FlowAssignmentModal';
import PersonaEditorModal from '../modals/PersonaEditorModal';
import './SettingsTabs.css';

function PersonaTab() {
  const { personas, flows, settings, sessionState, api, sendWsMessage } = useApp();
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState(null);
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState(null);

  const handleNew = () => {
    setEditingPersona(null);
    setShowEditorModal(true);
  };

  const handleEdit = (persona) => {
    setEditingPersona(persona);
    setShowEditorModal(true);
  };

  const handleSavePersona = async (personaData) => {
    try {
      if (editingPersona) {
        await api.updatePersona(editingPersona.id, personaData);
      } else {
        await api.createPersona(personaData);
      }
      setShowEditorModal(false);
      setEditingPersona(null);
    } catch (error) {
      console.error('Failed to save persona:', error);
      alert('Failed to save persona. Please try again.');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this persona?')) {
      try {
        await api.deletePersona(id);
      } catch (error) {
        console.error('Failed to delete persona:', error);
      }
    }
  };

  const handleSetActive = async (id) => {
    try {
      await api.updateSettings({ activePersonaId: id });
    } catch (error) {
      console.error('Failed to set active persona:', error);
    }
  };

  const getPersonaFlows = (personaId) => {
    return sessionState.flowAssignments?.personas?.[personaId] || [];
  };

  const handleOpenFlowModal = (personaId) => {
    setSelectedPersonaId(personaId);
    setShowFlowModal(true);
  };

  const handleSaveFlows = (flowIds) => {
    sendWsMessage('update_persona_flows', {
      personaId: selectedPersonaId,
      flows: flowIds
    });
  };

  const getFlowNames = (personaId) => {
    const flowIds = getPersonaFlows(personaId);
    return flowIds.map(id => {
      const flow = flows.find(f => f.id === id);
      return flow ? flow.name : null;
    }).filter(Boolean);
  };

  return (
    <div className="settings-tab">
      <div className="tab-header">
        <h3>Your Personas</h3>
        <button
          className="btn btn-primary"
          onClick={handleNew}
        >
          + New Persona
        </button>
      </div>

      <div className="list">
        {personas.length === 0 ? (
          <p className="text-muted">No personas yet. Create one to get started!</p>
        ) : (
          personas.map((persona) => (
            <div
              key={persona.id}
              className={`list-item card-style ${settings.activePersonaId === persona.id ? 'active' : ''}`}
            >
              <div className="card-header">
                <div className="card-info">
                  <div className="list-item-name">
                    {persona.displayName}
                    {settings.activePersonaId === persona.id && (
                      <span className="active-badge">Active</span>
                    )}
                  </div>
                  <div className="list-item-meta">
                    {persona.pronouns}
                    {persona.personality && ` • ${persona.personality.substring(0, 50)}...`}
                  </div>
                </div>
                <div className="list-item-actions">
                  {settings.activePersonaId !== persona.id && (
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => handleSetActive(persona.id)}
                    >
                      Use
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleEdit(persona)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(persona.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="card-footer">
                <div className="flow-line">
                  <span className="flow-line-label">Flows:</span>
                  <span className="flow-line-content">
                    {getFlowNames(persona.id).join(', ') || 'None'}
                  </span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleOpenFlowModal(persona.id)}
                  >
                    Flows
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <PersonaEditorModal
        isOpen={showEditorModal}
        onClose={() => setShowEditorModal(false)}
        onSave={handleSavePersona}
        persona={editingPersona}
      />

      <FlowAssignmentModal
        isOpen={showFlowModal}
        onClose={() => setShowFlowModal(false)}
        onSave={handleSaveFlows}
        flows={flows}
        assignedFlowIds={selectedPersonaId ? getPersonaFlows(selectedPersonaId) : []}
        category="persona"
        title="Assign Persona Flows"
      />
    </div>
  );
}

export default PersonaTab;
