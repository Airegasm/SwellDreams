import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import FlowAssignmentModal from '../modals/FlowAssignmentModal';
import CharacterEditorModal from '../modals/CharacterEditorModal';
import './SettingsTabs.css';

function CharacterTab() {
  const { characters, flows, settings, sessionState, api, sendWsMessage } = useApp();
  const { showError, showSuccess } = useError();
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const listRef = useRef(null);

  // Sort characters with active one first
  const sortedCharacters = [...characters].sort((a, b) => {
    if (a.id === settings.activeCharacterId) return -1;
    if (b.id === settings.activeCharacterId) return 1;
    return 0;
  });

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
      // Scroll to top after setting active
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
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

  const handleExport = async (character) => {
    try {
      const response = await apiFetch(`${API_BASE}/api/export/character/${character.id}`);
      const filename = `${character.name.replace(/[^a-z0-9]/gi, '_')}_character.json`;
      const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess?.(`Exported "${character.name}"`);
    } catch (error) {
      showError(error.message || 'Failed to export character');
    }
  };

  return (
    <div className="settings-tab">
      <div className="tab-header-actions">
        <button
          className="btn btn-primary"
          onClick={handleNew}
        >
          + New Character
        </button>
      </div>

      <div className="list" ref={listRef}>
        {characters.length === 0 ? (
          <p className="text-muted">No characters yet. Create one to get started!</p>
        ) : (
          sortedCharacters.map((character) => (
            <div
              key={character.id}
              className={`list-item card-style ${settings.activeCharacterId === character.id ? 'active' : ''}`}
            >
              <div className="card-header">
                <div className="card-info">
                  <div className="name-row">
                    <div className="list-item-name">
                      {character.name}
                    </div>
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
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleExport(character)}
                    title="Export character as JSON"
                  >
                    Export
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
