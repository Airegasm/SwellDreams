import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import CharacterEditorModal from '../modals/CharacterEditorModal';
import './SettingsTabs.css';

function CharacterTab() {
  const { characters, settings, api } = useApp();
  const { showError, showSuccess } = useError();
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
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

  const getActiveStoryName = (character) => {
    if (!character.stories || character.stories.length === 0) return 'None';
    const activeStory = character.stories.find(s => s.id === character.activeStoryId);
    return activeStory?.name || character.stories[0]?.name || 'Story 1';
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

  const handleCopy = async (character) => {
    try {
      // Create a copy without the id (server will generate new one)
      const { id, _isDefault, createdAt, updatedAt, ...charData } = character;
      const copyData = {
        ...charData,
        name: `${character.name} (Copy)`
      };
      await api.createCharacter(copyData);
      showSuccess?.(`Created copy of "${character.name}"`);
    } catch (error) {
      console.error('Failed to copy character:', error);
      showError?.('Failed to copy character');
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
                {character.avatar ? (
                  <img
                    src={character.avatar}
                    alt={character.name}
                    className="card-avatar"
                  />
                ) : (
                  <div className="card-avatar-placeholder">
                    {character.name?.charAt(0)?.toUpperCase() || 'C'}
                  </div>
                )}
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
                    onClick={() => handleCopy(character)}
                    title="Create a copy of this character"
                  >
                    Copy
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
                  <span className="flow-line-label">Active Story:</span>
                  <span className="flow-line-content">
                    {getActiveStoryName(character)}
                  </span>
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
    </div>
  );
}

export default CharacterTab;
