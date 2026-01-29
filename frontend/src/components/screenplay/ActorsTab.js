import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import './ScreenPlayTabs.css';

function ActorsTab() {
  const { actors, api } = useApp();
  const [isCreating, setIsCreating] = useState(false);
  const [editingActor, setEditingActor] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    personality: '',
    avatar: '',
    isPlayerAssignable: true
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      personality: '',
      avatar: '',
      isPlayerAssignable: true
    });
  };

  const handleCreateActor = async () => {
    if (!formData.name.trim()) return;

    try {
      await api.createActor({
        name: formData.name.trim(),
        description: formData.description.trim(),
        personality: formData.personality.trim(),
        avatar: formData.avatar,
        isPlayerAssignable: formData.isPlayerAssignable
      });
      resetForm();
      setIsCreating(false);
    } catch (err) {
      console.error('Failed to create actor:', err);
    }
  };

  const handleUpdateActor = async () => {
    if (!formData.name.trim() || !editingActor) return;

    try {
      await api.updateActor(editingActor.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        personality: formData.personality.trim(),
        avatar: formData.avatar,
        isPlayerAssignable: formData.isPlayerAssignable
      });
      resetForm();
      setEditingActor(null);
    } catch (err) {
      console.error('Failed to update actor:', err);
    }
  };

  const handleDeleteActor = async (actorId) => {
    if (!window.confirm('Are you sure you want to delete this actor?')) return;
    try {
      await api.deleteActor(actorId);
    } catch (err) {
      console.error('Failed to delete actor:', err);
    }
  };

  const handleEditClick = (actor) => {
    setEditingActor(actor);
    setFormData({
      name: actor.name || '',
      description: actor.description || '',
      personality: actor.personality || '',
      avatar: actor.avatar || '',
      isPlayerAssignable: actor.isPlayerAssignable !== false
    });
    setIsCreating(false);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFormData(prev => ({ ...prev, avatar: e.target.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsCreating(false);
    setEditingActor(null);
  };

  const isEditing = isCreating || editingActor;

  return (
    <div className="actors-tab">
      <div className="tab-header">
        <h2>Actors</h2>
        {!isEditing && (
          <button
            className="btn btn-primary"
            onClick={() => setIsCreating(true)}
          >
            + New Actor
          </button>
        )}
      </div>

      {isEditing && (
        <div className="actor-form">
          <h3>{editingActor ? 'Edit Actor' : 'Create Actor'}</h3>

          <div className="form-row">
            <div className="avatar-upload">
              <div
                className="avatar-preview"
                style={{ backgroundImage: formData.avatar ? `url(${formData.avatar})` : 'none' }}
              >
                {!formData.avatar && <span>No Avatar</span>}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                id="avatar-input"
                hidden
              />
              <label htmlFor="avatar-input" className="btn btn-secondary btn-sm">
                Upload Avatar
              </label>
            </div>

            <div className="form-fields">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Actor name..."
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of the actor..."
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Personality</label>
                <textarea
                  value={formData.personality}
                  onChange={(e) => setFormData(prev => ({ ...prev, personality: e.target.value }))}
                  placeholder="Personality traits, speaking style..."
                  rows={3}
                />
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.isPlayerAssignable}
                    onChange={(e) => setFormData(prev => ({ ...prev, isPlayerAssignable: e.target.checked }))}
                  />
                  Player can play as this actor
                </label>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={editingActor ? handleUpdateActor : handleCreateActor}
            >
              {editingActor ? 'Save Changes' : 'Create Actor'}
            </button>
          </div>
        </div>
      )}

      <div className="actors-list">
        {actors.length === 0 ? (
          <div className="empty-state">
            <p>No actors yet. Create actors to use in your plays!</p>
          </div>
        ) : (
          actors.map(actor => (
            <div key={actor.id} className="actor-card">
              <div
                className="actor-avatar"
                style={{ backgroundImage: actor.avatar ? `url(${actor.avatar})` : 'none' }}
              >
                {!actor.avatar && <span>?</span>}
              </div>
              <div className="actor-info">
                <h3>{actor.name}</h3>
                <p className="actor-description">{actor.description || 'No description'}</p>
                {actor.isPlayerAssignable && (
                  <span className="player-badge">Player Assignable</span>
                )}
              </div>
              <div className="actor-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleEditClick(actor)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDeleteActor(actor.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ActorsTab;
