import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import PersonaEditorModal from '../modals/PersonaEditorModal';
import './SettingsTabs.css';

function PersonaTab() {
  const { personas, settings, api } = useApp();
  const { showError, showSuccess } = useError();
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const listRef = useRef(null);

  const toggleFavorite = async (persona) => {
    try {
      await api.updatePersona(persona.id, { ...persona, isFavorite: !persona.isFavorite });
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  // Filter and sort personas
  const sortedPersonas = [...personas]
    .filter(p => !searchQuery || p.displayName?.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (a.id === settings.activePersonaId) return -1;
      if (b.id === settings.activePersonaId) return 1;
      switch (sortBy) {
        case 'az': return (a.displayName || '').localeCompare(b.displayName || '');
        case 'za': return (b.displayName || '').localeCompare(a.displayName || '');
        case 'recent': return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        case 'oldest': return (a.createdAt || 0) - (b.createdAt || 0);
        case 'favorites': return (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
        default: return 0;
      }
    });

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
      // Scroll to top after setting active
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
    } catch (error) {
      console.error('Failed to set active persona:', error);
    }
  };

  const handleExport = async (persona) => {
    try {
      const response = await apiFetch(`${API_BASE}/api/export/persona/${persona.id}`);
      const filename = `${(persona.displayName || persona.name).replace(/[^a-z0-9]/gi, '_')}_persona.json`;
      const blob = new Blob([JSON.stringify(response, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess?.(`Exported "${persona.displayName || persona.name}"`);
    } catch (error) {
      showError(error.message || 'Failed to export persona');
    }
  };

  const handleCopy = async (persona) => {
    try {
      // Create a copy without the id (server will generate new one)
      const { id, _isDefault, createdAt, updatedAt, ...personaData } = persona;
      const copyData = {
        ...personaData,
        displayName: `${persona.displayName} (Copy)`
      };
      await api.createPersona(copyData);
      showSuccess?.(`Created copy of "${persona.displayName}"`);
    } catch (error) {
      console.error('Failed to copy persona:', error);
      showError?.('Failed to copy persona');
    }
  };

  return (
    <div className="settings-tab">
      <div className="tab-header-actions">
        <button
          className="btn btn-primary"
          onClick={handleNew}
        >
          + New Persona
        </button>
      </div>

      <div className="list-toolbar">
        <input
          type="text"
          className="list-search"
          placeholder="Search personas..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select className="list-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="recent">Most Recent</option>
          <option value="oldest">Oldest First</option>
          <option value="az">A → Z</option>
          <option value="za">Z → A</option>
          <option value="favorites">Favorites</option>
        </select>
      </div>

      <div className="list" ref={listRef}>
        {sortedPersonas.length === 0 ? (
          <p className="text-muted">{searchQuery ? 'No personas match your search.' : 'No personas yet. Create one to get started!'}</p>
        ) : (
          sortedPersonas.map((persona) => (
            <div
              key={persona.id}
              className={`list-item card-style ${settings.activePersonaId === persona.id ? 'active' : ''}`}
            >
              <div className="card-header">
                <button
                  className={`favorite-star ${persona.isFavorite ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(persona); }}
                  title={persona.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {persona.isFavorite ? '★' : '☆'}
                </button>
                {persona.avatar ? (
                  <img
                    src={persona.avatar}
                    alt={persona.displayName}
                    className="card-avatar"
                  />
                ) : (
                  <div className="card-avatar-placeholder">
                    {persona.displayName?.charAt(0)?.toUpperCase() || 'P'}
                  </div>
                )}
                <div className="card-info">
                  <div className="name-row">
                    <div className="list-item-name">
                      {persona.displayName}
                    </div>
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
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleCopy(persona)}
                    title="Create a copy of this persona"
                  >
                    Copy
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleExport(persona)}
                    title="Export persona as JSON"
                  >
                    Export
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(persona.id)}
                  >
                    Delete
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
    </div>
  );
}

export default PersonaTab;
