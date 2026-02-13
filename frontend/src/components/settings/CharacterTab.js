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
  const [importing, setImporting] = useState(false);
  const [importingV2V3, setImportingV2V3] = useState(false);
  const [showImportGuidance, setShowImportGuidance] = useState(false);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const v2v3FileInputRef = useRef(null);

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

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate file type
      if (data.type !== 'swelldreams-character') {
        throw new Error('Invalid file: Expected a SwellDreams character export file.');
      }

      const result = await apiFetch(`${API_BASE}/api/import/character`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      showSuccess?.(`Imported "${result.character?.name || 'character'}" successfully`);
    } catch (error) {
      console.error('Failed to import character:', error);
      showError?.(error.message || 'Failed to import character');
    } finally {
      setImporting(false);
      // Reset file input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleV2V3Import = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingV2V3(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/api/import/character-card`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import character card');
      }

      const result = await response.json();
      showSuccess?.(result.message || `Imported "${result.character?.name || 'character'}" successfully`);

      // Show setup guidance modal for converted characters
      setTimeout(() => {
        setShowImportGuidance(true);
      }, 500); // Delay to show after success toast
    } catch (error) {
      console.error('Failed to import V2/V3 character card:', error);
      showError?.(error.message || 'Failed to import character card');
    } finally {
      setImportingV2V3(false);
      // Reset file input
      if (v2v3FileInputRef.current) {
        v2v3FileInputRef.current.value = '';
      }
    }
  };

  const handleV2V3ImportClick = () => {
    v2v3FileInputRef.current?.click();
  };

  return (
    <div className="settings-tab">
      <div className="tab-header-actions">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImport}
          accept=".json"
          style={{ display: 'none' }}
        />
        <input
          type="file"
          ref={v2v3FileInputRef}
          onChange={handleV2V3Import}
          accept=".json,.png"
          style={{ display: 'none' }}
        />
        <button
          className="btn btn-primary"
          onClick={handleNew}
        >
          + New Character
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleImportClick}
          disabled={importing}
          title="Import SwellDreams character from JSON file"
        >
          {importing ? 'Importing...' : 'Import'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleV2V3ImportClick}
          disabled={importingV2V3}
          title="Import V2/V3 character card (JSON or PNG)"
        >
          {importingV2V3 ? 'Converting...' : 'Convert V2/V3'}
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
                <div className="use-button-column">
                  {settings.activeCharacterId !== character.id && (
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => handleSetActive(character.id)}
                    >
                      Use
                    </button>
                  )}
                </div>
                <div className="list-item-actions">
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

      {/* V2/V3 Import Guidance Modal */}
      {showImportGuidance && (
        <div className="modal-overlay" onClick={() => setShowImportGuidance(false)}>
          <div className="modal import-guidance-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠️ V2/V3 Character Import - Important Information</h3>
            </div>
            <div className="modal-body import-guidance-content">
              <p className="guidance-intro">
                <strong>SwellDreams is built around welcome messages and scenarios that hint at, set up, or mention inflation.</strong>
              </p>

              <p className="guidance-warning">
                Your imported welcome message and scenario may not play out the same way as they do in other LLM frontends without tweaking those fields.
              </p>

              <div className="guidance-section">
                <h4>📝 Strongly Recommended:</h4>
                <ul>
                  <li>
                    <strong>Add plenty of inflation-specific Constant Reminders</strong> in the Character Editor that mention or relate to inflation.
                  </li>
                  <li>
                    These reminders help the LLM stay on track with inflation-themed content throughout the conversation.
                  </li>
                </ul>
              </div>

              <div className="guidance-section">
                <h4>🔧 Advanced Options:</h4>
                <ul>
                  <li>
                    If you look into the <strong>Flow Engine Scripting</strong>, these issues can be almost completely circumvented.
                  </li>
                  <li>
                    Flows allow you to script complex interactions and guide the narrative precisely.
                  </li>
                </ul>
              </div>

              <div className="guidance-section">
                <h4>🔌 LLM Device Access:</h4>
                <ul>
                  <li>
                    If you are using LLM Device Access, add <strong>[pump tags]</strong> into the character's example dialogue where they describe turning on a pump.
                  </li>
                  <li>
                    Example: <code>"[pump on] Time to get bigger! *turns on the pump*"</code>
                  </li>
                  <li>
                    Tags like [pump on], [pump off], [pump cycle], etc. trigger device control but are stripped from the displayed text.
                  </li>
                </ul>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => setShowImportGuidance(false)}
              >
                OK, Got It!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CharacterTab;
