import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import PlayViewer from './PlayViewer';
import './ScreenPlayTabs.css';

function PlaysTab({ onEditPlay, triggerCreate }) {
  const { plays, actors, api } = useApp();
  const [isCreating, setIsCreating] = useState(false);

  // Handle triggerCreate from StoryboardTab
  useEffect(() => {
    if (triggerCreate) {
      setIsCreating(true);
      setSelectedPlayId(null);
    }
  }, [triggerCreate]);
  const [newPlayName, setNewPlayName] = useState('');
  const [newPlayDescription, setNewPlayDescription] = useState('');
  const [newPlayLocation, setNewPlayLocation] = useState('');
  const [newPlayRelationships, setNewPlayRelationships] = useState('');
  const [newPlayActors, setNewPlayActors] = useState([]);
  const [playingPlayId, setPlayingPlayId] = useState(null);
  const [selectedPlayId, setSelectedPlayId] = useState(null);
  const [editedScenario, setEditedScenario] = useState('');
  const [editedLocation, setEditedLocation] = useState('');
  const [editedRelationships, setEditedRelationships] = useState('');
  const [editedActors, setEditedActors] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Inflatee settings
  const [inflatee1Capacity, setInflatee1Capacity] = useState(0);
  const [inflatee2Enabled, setInflatee2Enabled] = useState(false);
  const [inflatee2ActorId, setInflatee2ActorId] = useState('');
  const [inflatee2Capacity, setInflatee2Capacity] = useState(0);
  const [maxPainAtFull, setMaxPainAtFull] = useState(10);

  // Get the selected play
  const selectedPlay = plays.find(p => p.id === selectedPlayId);

  // Get player-assignable actor from play's actors
  const playerAssignableActor = useMemo(() => {
    if (!editedActors.length) return null;
    return actors.find(a => editedActors.includes(a.id) && a.isPlayerAssignable);
  }, [editedActors, actors]);

  // Get non-player actors for Inflatee 2 dropdown
  const availableInflatee2Actors = useMemo(() => {
    if (!editedActors.length) return [];
    return actors.filter(a =>
      editedActors.includes(a.id) &&
      (!playerAssignableActor || a.id !== playerAssignableActor.id)
    );
  }, [editedActors, actors, playerAssignableActor]);

  // Update local state only when selecting a DIFFERENT play
  useEffect(() => {
    if (selectedPlay) {
      setEditedScenario(selectedPlay.description || '');
      setEditedLocation(selectedPlay.location || '');
      setEditedRelationships(selectedPlay.actorRelationships || '');
      setEditedActors(selectedPlay.actors || []);
      // Load inflatee settings
      setInflatee1Capacity(selectedPlay.inflatee1Capacity || 0);
      setInflatee2Enabled(selectedPlay.inflatee2Enabled || false);
      setInflatee2ActorId(selectedPlay.inflatee2ActorId || '');
      setInflatee2Capacity(selectedPlay.inflatee2Capacity || 0);
      setMaxPainAtFull(selectedPlay.maxPainAtFull ?? 10);
      setHasChanges(false);
    }
  }, [selectedPlayId]); // Only trigger on play selection change, not on data updates

  const handleCreatePlay = async () => {
    if (!newPlayName.trim()) return;

    try {
      const newPlay = {
        name: newPlayName.trim(),
        description: newPlayDescription.trim(),
        location: newPlayLocation.trim(),
        actorRelationships: newPlayRelationships.trim(),
        actors: newPlayActors,
        playerActorId: null,
        authorMode: '2nd-person',
        startPageId: 'page-1',
        pages: {
          'page-1': {
            id: 'page-1',
            title: 'Page 1',
            paragraphs: []
          }
        }
      };

      const created = await api.createPlay(newPlay);
      setNewPlayName('');
      setNewPlayDescription('');
      setNewPlayLocation('');
      setNewPlayRelationships('');
      setNewPlayActors([]);
      setIsCreating(false);
      // Select the newly created play
      if (created?.id) {
        setSelectedPlayId(created.id);
      }
    } catch (err) {
      console.error('Failed to create play:', err);
    }
  };

  const handleDeletePlay = async (playId) => {
    if (!window.confirm('Are you sure you want to delete this play?')) return;
    try {
      await api.deletePlay(playId);
      if (selectedPlayId === playId) {
        setSelectedPlayId(null);
      }
    } catch (err) {
      console.error('Failed to delete play:', err);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedPlay) return;

    try {
      await api.updatePlay(selectedPlayId, {
        ...selectedPlay,
        description: editedScenario,
        location: editedLocation,
        actorRelationships: editedRelationships,
        actors: editedActors,
        inflatee1Capacity,
        inflatee2Enabled,
        inflatee2ActorId: inflatee2Enabled ? inflatee2ActorId : '',
        inflatee2Capacity: inflatee2Enabled ? inflatee2Capacity : 0,
        maxPainAtFull
      });
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save play:', err);
    }
  };

  const handleScenarioChange = (value) => {
    setEditedScenario(value);
    setHasChanges(true);
  };

  const handleLocationChange = (value) => {
    setEditedLocation(value);
    setHasChanges(true);
  };

  const handleRelationshipsChange = (value) => {
    setEditedRelationships(value);
    setHasChanges(true);
  };

  const handleAddActor = (actorId) => {
    if (!editedActors.includes(actorId)) {
      setEditedActors([...editedActors, actorId]);
      setHasChanges(true);
    }
  };

  const handleRemoveActor = (actorId) => {
    setEditedActors(editedActors.filter(id => id !== actorId));
    // Clear inflatee2 if that actor is removed
    if (actorId === inflatee2ActorId) {
      setInflatee2ActorId('');
      setInflatee2Enabled(false);
    }
    setHasChanges(true);
  };

  const handleInflatee1CapacityChange = (value) => {
    setInflatee1Capacity(Math.max(0, Math.min(100, parseInt(value) || 0)));
    setHasChanges(true);
  };

  const handleInflatee2Toggle = (enabled) => {
    setInflatee2Enabled(enabled);
    if (!enabled) {
      setInflatee2ActorId('');
      setInflatee2Capacity(0);
    }
    setHasChanges(true);
  };

  const handleInflatee2ActorChange = (actorId) => {
    setInflatee2ActorId(actorId);
    setHasChanges(true);
  };

  const handleInflatee2CapacityChange = (value) => {
    setInflatee2Capacity(Math.max(0, Math.min(100, parseInt(value) || 0)));
    setHasChanges(true);
  };

  const handleAddActorToNew = (actorId) => {
    if (!newPlayActors.includes(actorId)) {
      setNewPlayActors([...newPlayActors, actorId]);
    }
  };

  const handleRemoveActorFromNew = (actorId) => {
    setNewPlayActors(newPlayActors.filter(id => id !== actorId));
  };

  const getActorNames = (actorIds) => {
    if (!actorIds || actorIds.length === 0) return 'No actors';
    return actorIds
      .map(id => actors.find(a => a.id === id)?.name || 'Unknown')
      .join(', ');
  };

  const availableActors = actors.filter(a => !editedActors.includes(a.id));
  const availableActorsForNew = actors.filter(a => !newPlayActors.includes(a.id));

  return (
    <div className="plays-tab">
      <div className="alpha-warning">
        <strong>SCREENPLAY IS IN EARLY ALPHA - EXPECT BUGS</strong>
      </div>
      <div className="plays-layout">
        {/* Left side - Play list */}
        <div className="plays-list-panel">
          <div className="tab-header">
            <h2>Plays</h2>
            <button
              className="btn btn-primary"
              onClick={() => {
                setIsCreating(true);
                setSelectedPlayId(null);
              }}
            >
              + New
            </button>
          </div>

          <div className="plays-list">
            {plays.length === 0 ? (
              <div className="empty-state">
                <p>No plays yet</p>
              </div>
            ) : (
              plays.map(play => (
                <div
                  key={play.id}
                  className={`play-list-item ${selectedPlayId === play.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedPlayId(play.id);
                    setIsCreating(false);
                  }}
                >
                  <div className="play-list-info">
                    <h4>{play.name}</h4>
                    <span className="play-list-meta">
                      {play.actors?.length || 0} actors · {play.pages ? Object.keys(play.pages).length : 0} pages
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right side - Play details or create form */}
        <div className="plays-detail-panel">
          {isCreating ? (
            <div className="play-detail-form">
              <h3>Create New Play</h3>

              <div className="form-group">
                <label>Play Name</label>
                <input
                  type="text"
                  value={newPlayName}
                  onChange={(e) => setNewPlayName(e.target.value)}
                  placeholder="Enter play name..."
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Scenario</label>
                <textarea
                  value={newPlayDescription}
                  onChange={(e) => setNewPlayDescription(e.target.value)}
                  placeholder="Overall context and setup for the play..."
                  rows={4}
                />
              </div>

              <div className="form-group">
                <label>Location</label>
                <textarea
                  value={newPlayLocation}
                  onChange={(e) => setNewPlayLocation(e.target.value)}
                  placeholder="Where does this play take place? Describe the setting..."
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Actor Relationships</label>
                <textarea
                  value={newPlayRelationships}
                  onChange={(e) => setNewPlayRelationships(e.target.value)}
                  placeholder="Describe relationships between actors..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Actors</label>
                <div className="actors-manager">
                  <div className="selected-actors">
                    {newPlayActors.length === 0 ? (
                      <span className="no-actors">No actors added</span>
                    ) : (
                      newPlayActors.map(actorId => {
                        const actor = actors.find(a => a.id === actorId);
                        return (
                          <div key={actorId} className="actor-chip">
                            <span>{actor?.name || 'Unknown'}</span>
                            <button
                              className="remove-actor-btn"
                              onClick={() => handleRemoveActorFromNew(actorId)}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {availableActorsForNew.length > 0 && (
                    <select
                      className="add-actor-select"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleAddActorToNew(e.target.value);
                      }}
                    >
                      <option value="">+ Add actor...</option>
                      {availableActorsForNew.map(actor => (
                        <option key={actor.id} value={actor.id}>
                          {actor.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="form-actions">
                <button className="btn btn-secondary" onClick={() => setIsCreating(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreatePlay}
                  disabled={!newPlayName.trim()}
                >
                  Create Play
                </button>
              </div>
            </div>
          ) : selectedPlay ? (
            <div className="play-detail-form">
              <div className="play-detail-header">
                <h3>{selectedPlay.name}</h3>
                <div className="play-detail-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => setPlayingPlayId(selectedPlay.id)}
                  >
                    ▶ Play
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => onEditPlay(selectedPlay.id)}
                  >
                    ✎ Storyboard
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDeletePlay(selectedPlay.id)}
                  >
                    ✕ Delete
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Scenario</label>
                <textarea
                  value={editedScenario}
                  onChange={(e) => handleScenarioChange(e.target.value)}
                  placeholder="Overall context and setup for the play..."
                  rows={4}
                />
                <span className="form-hint">
                  This context is provided to the LLM when enhancing dialogue and narration.
                </span>
              </div>

              <div className="form-group">
                <label>Location</label>
                <textarea
                  value={editedLocation}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  placeholder="Where does this play take place? Describe the setting..."
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label>Actor Relationships</label>
                <textarea
                  value={editedRelationships}
                  onChange={(e) => handleRelationshipsChange(e.target.value)}
                  placeholder="Describe relationships between actors (e.g., 'Sophie and Mia are college roommates')..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>Actors ({editedActors.length})</label>
                <div className="actors-manager">
                  <div className="selected-actors">
                    {editedActors.length === 0 ? (
                      <span className="no-actors">No actors in this play</span>
                    ) : (
                      editedActors.map(actorId => {
                        const actor = actors.find(a => a.id === actorId);
                        return (
                          <div key={actorId} className="actor-chip">
                            {actor?.avatar && (
                              <img src={actor.avatar} alt="" className="actor-chip-avatar" />
                            )}
                            <span>{actor?.name || 'Unknown'}</span>
                            <button
                              className="remove-actor-btn"
                              onClick={() => handleRemoveActor(actorId)}
                              title="Remove from play"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {availableActors.length > 0 && (
                    <select
                      className="add-actor-select"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleAddActor(e.target.value);
                      }}
                    >
                      <option value="">+ Add actor...</option>
                      {availableActors.map(actor => (
                        <option key={actor.id} value={actor.id}>
                          {actor.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Inflatees Section */}
              <div className="form-group">
                <label>Inflatees</label>
                <div className="inflatees-section">
                  {/* Inflatee 1 - Player */}
                  <div className="inflatee-row">
                    <div className="inflatee-header">
                      <span className="inflatee-label">Inflatee 1 (Player):</span>
                      <span className="inflatee-actor">
                        {playerAssignableActor?.name || '(No player-assignable actor)'}
                      </span>
                    </div>
                    <div className="inflatee-capacity">
                      <label>Starting Capacity:</label>
                      <input
                        type="number"
                        value={inflatee1Capacity}
                        onChange={(e) => handleInflatee1CapacityChange(e.target.value)}
                        min={0}
                        max={100}
                        disabled={!playerAssignableActor}
                      />
                      <span className="capacity-unit">%</span>
                    </div>
                  </div>

                  {/* Inflatee 2 - Optional NPC */}
                  <div className="inflatee-row">
                    <div className="inflatee-header">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={inflatee2Enabled}
                          onChange={(e) => handleInflatee2Toggle(e.target.checked)}
                          disabled={availableInflatee2Actors.length === 0}
                        />
                        Inflatee 2 (Optional):
                      </label>
                      {inflatee2Enabled && (
                        <select
                          value={inflatee2ActorId}
                          onChange={(e) => handleInflatee2ActorChange(e.target.value)}
                          className="inflatee2-actor-select"
                        >
                          <option value="">Select actor...</option>
                          {availableInflatee2Actors.map(actor => (
                            <option key={actor.id} value={actor.id}>
                              {actor.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {inflatee2Enabled && (
                      <div className="inflatee-capacity">
                        <label>Starting Capacity:</label>
                        <input
                          type="number"
                          value={inflatee2Capacity}
                          onChange={(e) => handleInflatee2CapacityChange(e.target.value)}
                          min={0}
                          max={100}
                        />
                        <span className="capacity-unit">%</span>
                      </div>
                    )}
                  </div>

                  {/* Pain Scale Settings */}
                  <div className="inflatee-row pain-scale-row">
                    <div className="inflatee-capacity">
                      <label>Max Pain at 100%:</label>
                      <input
                        type="number"
                        value={maxPainAtFull}
                        onChange={(e) => {
                          setMaxPainAtFull(Math.max(0, Math.min(10, parseInt(e.target.value) || 10)));
                          setHasChanges(true);
                        }}
                        min={0}
                        max={10}
                      />
                      <span className="capacity-unit">(0-10)</span>
                    </div>
                    <div className="pain-scale-hint">
                      Used for [Feeling] and [Feeling_mock] variables
                    </div>
                  </div>
                </div>
                <span className="form-hint">
                  Inflatee 2 can be controlled via mock_pump events in the Storyboard.
                </span>
              </div>

              {hasChanges && (
                <div className="form-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditedScenario(selectedPlay.description || '');
                      setEditedLocation(selectedPlay.location || '');
                      setEditedRelationships(selectedPlay.actorRelationships || '');
                      setEditedActors(selectedPlay.actors || []);
                      setHasChanges(false);
                    }}
                  >
                    Discard Changes
                  </button>
                  <button className="btn btn-primary" onClick={handleSaveChanges}>
                    Save Changes
                  </button>
                </div>
              )}

              <div className="play-stats">
                <div className="stat">
                  <span className="stat-value">{Object.keys(selectedPlay.pages || {}).length}</span>
                  <span className="stat-label">Pages</span>
                </div>
                <div className="stat">
                  <span className="stat-value">
                    {Object.values(selectedPlay.pages || {}).reduce(
                      (sum, page) => sum + (page.paragraphs?.length || 0), 0
                    )}
                  </span>
                  <span className="stat-label">Paragraphs</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-detail">
              <p>Select a play or create a new one</p>
            </div>
          )}
        </div>
      </div>

      {/* Play Viewer Modal */}
      {playingPlayId && (
        <PlayViewer
          playId={playingPlayId}
          onClose={() => setPlayingPlayId(null)}
        />
      )}
    </div>
  );
}

export default PlaysTab;
