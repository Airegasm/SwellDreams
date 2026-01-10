import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import FlowAssignmentModal from '../modals/FlowAssignmentModal';
import CharacterEditorModal from '../modals/CharacterEditorModal';
import './SettingsTabs.css';

function CharacterTab() {
  const { characters, flows, settings, sessionState, api, sendWsMessage } = useApp();
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);

  const handleNew = () => {
    setEditingCharacter(null);
    setShowEditorModal(true);
  };

  const handleEdit = (character) => {
    setEditingCharacter(character);
    setShowEditorModal(true);
  };

  const handleSaveCharacter = async (characterData) => {
    try {
      if (editingCharacter) {
        await api.updateCharacter(editingCharacter.id, characterData);
      } else {
        await api.createCharacter(characterData);
      }
      setShowEditorModal(false);
      setEditingCharacter(null);
    } catch (error) {
      console.error('Failed to save character:', error);
      alert('Failed to save character. Please try again.');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this character?')) {
      try {
        await api.deleteCharacter(id);
      } catch (error) {
        console.error('Failed to delete character:', error);
      }
    }
  };

  const handleSetActive = async (id) => {
    try {
      await api.updateSettings({ activeCharacterId: id });
    } catch (error) {
      console.error('Failed to set active character:', error);
    }
  };

  const getCharacterFlows = (characterId) => {
    return sessionState.flowAssignments?.characters?.[characterId] || [];
  };

  const handleOpenFlowModal = (characterId) => {
    setSelectedCharacterId(characterId);
    setShowFlowModal(true);
  };

  const handleSaveFlows = (flowIds) => {
    sendWsMessage('update_character_flows', {
      characterId: selectedCharacterId,
      flows: flowIds
    });
  };

  const getFlowNames = (characterId) => {
    const flowIds = getCharacterFlows(characterId);
    return flowIds.map(id => {
      const flow = flows.find(f => f.id === id);
      return flow ? flow.name : null;
    }).filter(Boolean);
  };

  return (
    <div className="settings-tab">
      <div className="tab-header">
        <h3>AI Characters</h3>
        <button
          className="btn btn-primary"
          onClick={handleNew}
        >
          + New Character
        </button>
      </div>

      <div className="list">
        {characters.length === 0 ? (
          <p className="text-muted">No characters yet. Create one to get started!</p>
        ) : (
          characters.map((character) => (
            <div
              key={character.id}
              className={`list-item card-style ${settings.activeCharacterId === character.id ? 'active' : ''}`}
            >
              <div className="card-header">
                <div className="card-info">
                  <div className="list-item-name">
                    {character.name}
                    {settings.activeCharacterId === character.id && (
                      <span className="active-badge">Active</span>
                    )}
                  </div>
                  <div className="list-item-meta">{character.description}</div>
                </div>
                <div className="list-item-actions">
                  {settings.activeCharacterId !== character.id && (
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => handleSetActive(character.id)}
                    >
                      Use
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleEdit(character)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(character.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="card-footer">
                <div className="flow-line">
                  <span className="flow-line-label">Flows:</span>
                  <span className="flow-line-content">
                    {getFlowNames(character.id).join(', ') || 'None'}
                  </span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleOpenFlowModal(character.id)}
                  >
                    Flows
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <CharacterEditorModal
        isOpen={showEditorModal}
        onClose={() => setShowEditorModal(false)}
        onSave={handleSaveCharacter}
        character={editingCharacter}
      />

      <FlowAssignmentModal
        isOpen={showFlowModal}
        onClose={() => setShowFlowModal(false)}
        onSave={handleSaveFlows}
        flows={flows}
        assignedFlowIds={selectedCharacterId ? getCharacterFlows(selectedCharacterId) : []}
        category="character"
        title="Assign Character Flows"
      />
    </div>
  );
}

export default CharacterTab;
