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

  // Continue mode settings
  const [continueMode, setContinueMode] = useState('manual');
  const [autoContinueDelay, setAutoContinueDelay] = useState(5);
  const [dialogAllowance, setDialogAllowance] = useState(3);
  const [enhancementAllowance, setEnhancementAllowance] = useState(5);

  // Get the selected play
  const selectedPlay = plays.find(p => p.id === selectedPlayId);

  // Get player-assignable actor from play's actors (for editing)
  const playerAssignableActor = useMemo(() => {
    if (!editedActors.length) return null;
    return actors.find(a => editedActors.includes(a.id) && a.isPlayerAssignable);
  }, [editedActors, actors]);

  // Get player-assignable actor from new play's actors (for creating)
  const newPlayPlayerActor = useMemo(() => {
    if (!newPlayActors.length) return null;
    return actors.find(a => newPlayActors.includes(a.id) && a.isPlayerAssignable);
  }, [newPlayActors, actors]);

  // Check if selected play has a player-assignable actor
  const selectedPlayHasPlayerActor = useMemo(() => {
    if (!selectedPlay?.actors?.length) return false;
    return actors.some(a => selectedPlay.actors.includes(a.id) && a.isPlayerAssignable);
  }, [selectedPlay, actors]);

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
      // Load continue mode settings
      setContinueMode(selectedPlay.continueMode || 'manual');
      setAutoContinueDelay(selectedPlay.autoContinueDelay || 5);
      setDialogAllowance(selectedPlay.dialogAllowance ?? 3);
      setEnhancementAllowance(selectedPlay.enhancementAllowance ?? 5);
      setHasChanges(false);
    }
  }, [selectedPlayId]); // Only trigger on play selection change, not on data updates

  const handleCreatePlay = async () => {
    if (!newPlayName.trim() || !newPlayPlayerActor) return;

    try {
      const newPlay = {
        name: newPlayName.trim(),
        description: newPlayDescription.trim(),
        location: newPlayLocation.trim(),
        actorRelationships: newPlayRelationships.trim(),
        actors: newPlayActors,
        playerActorId: newPlayPlayerActor.id, // Auto-set to player-assignable actor
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
        maxPainAtFull,
        continueMode,
        autoContinueDelay,
        dialogAllowance,
        enhancementAllowance
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
      <div className="plays-layout">
        {/* Play list section */}
        <div className="play-section">
          <div className="play-section-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <span>Plays ({plays.length})</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setIsCreating(true);
                setSelectedPlayId(null);
              }}
            >
              + New
            </button>
          </div>
          <div className="play-section-content">
            <div className="plays-list">
              {plays.length === 0 ? (
                <div className="empty-state">
                  <p>No plays yet</p>
                </div>
              ) : (
                plays.map(play => {
                  const pageCount = Object.keys(play.pages || {}).length;
                  const eventCount = Object.values(play.pages || {}).reduce(
                    (sum, page) => sum + (page.paragraphs?.length || 0), 0
                  );
                  const actorCount = play.actors?.length || 0;
                  return (
                    <div
                      key={play.id}
                      className={`play-list-item ${selectedPlayId === play.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedPlayId(play.id);
                        setIsCreating(false);
                      }}
                    >
                      <span className="play-list-name">{play.name}</span>
                      <span className="play-list-stat">{pageCount} pages</span>
                      <span className="play-list-stat">{eventCount} events</span>
                      <span className="play-list-stat">{actorCount} actors</span>
                    </div>
                  );
                })
              )}
            </div>
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
                <label>Actors {!newPlayPlayerActor && newPlayActors.length > 0 && <span className="warning-text">(needs player-assignable actor)</span>}</label>
                <div className="actors-manager">
                  <div className="selected-actors">
                    {newPlayActors.length === 0 ? (
                      <span className="no-actors">Add at least one player-assignable actor</span>
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
                  disabled={!newPlayName.trim() || !newPlayPlayerActor}
                  title={!newPlayPlayerActor ? 'Add at least one player-assignable actor' : ''}
                >
                  Create Play
                </button>
              </div>
            </div>
          ) : selectedPlay ? (
            <div className="play-detail-form">
              {/* Play Title & Actions Section */}
              <div className="play-section">
                <div className="play-section-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px'}}>
                  <span style={{fontSize: '1.1rem'}}>
                    {selectedPlay.name} {hasChanges && <span style={{color: '#f59e0b'}}>*</span>}
                  </span>
                  <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                    {hasChanges && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={handleSaveChanges}>
                          Save
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditedScenario(selectedPlay.description || '');
                            setEditedLocation(selectedPlay.location || '');
                            setEditedRelationships(selectedPlay.actorRelationships || '');
                            setEditedActors(selectedPlay.actors || []);
                            setInflatee1Capacity(selectedPlay.inflatee1Capacity || 0);
                            setInflatee2Enabled(selectedPlay.inflatee2Enabled || false);
                            setInflatee2ActorId(selectedPlay.inflatee2ActorId || '');
                            setInflatee2Capacity(selectedPlay.inflatee2Capacity || 0);
                            setMaxPainAtFull(selectedPlay.maxPainAtFull ?? 10);
                            setContinueMode(selectedPlay.continueMode || 'manual');
                            setAutoContinueDelay(selectedPlay.autoContinueDelay || 5);
                            setDialogAllowance(selectedPlay.dialogAllowance ?? 3);
                            setEnhancementAllowance(selectedPlay.enhancementAllowance ?? 5);
                            setHasChanges(false);
                          }}
                        >
                          Discard
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setPlayingPlayId(selectedPlay.id)}
                      disabled={!selectedPlayHasPlayerActor}
                      title={!selectedPlayHasPlayerActor ? 'Add a player-assignable actor to play' : ''}
                    >
                      ▶ Play
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onEditPlay(selectedPlay.id)}
                    >
                      ✎ Storyboard
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeletePlay(selectedPlay.id)}
                    >
                      ✕ Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Story Section */}
              <div className="play-section">
                <div className="play-section-header">Story</div>
                <div className="play-section-content">
                  <div className="play-form-row" style={{flexDirection: 'column', alignItems: 'stretch'}}>
                    <label>Scenario</label>
                    <textarea
                      value={editedScenario}
                      onChange={(e) => handleScenarioChange(e.target.value)}
                      placeholder="Overall context and setup for the play..."
                      rows={2}
                    />
                  </div>
                  <div className="play-form-row" style={{flexDirection: 'column', alignItems: 'stretch', marginTop: 'var(--spacing-xs)'}}>
                    <label>Location</label>
                    <textarea
                      value={editedLocation}
                      onChange={(e) => handleLocationChange(e.target.value)}
                      placeholder="Where does this play take place?"
                      rows={1}
                    />
                  </div>
                  <div className="play-form-row" style={{flexDirection: 'column', alignItems: 'stretch', marginTop: 'var(--spacing-xs)'}}>
                    <label>Relationships</label>
                    <textarea
                      value={editedRelationships}
                      onChange={(e) => handleRelationshipsChange(e.target.value)}
                      placeholder="Actor relationships (e.g., 'Sophie and Mia are roommates')..."
                      rows={1}
                    />
                  </div>
                </div>
              </div>

              {/* Actors Section */}
              <div className="play-section">
                <div className="play-section-header">
                  Actors ({editedActors.length}) {!playerAssignableActor && <span style={{color: '#f59e0b', fontWeight: 400}}> - needs player actor</span>}
                </div>
                <div className="play-section-content">
                  <div className="actors-manager">
                    <div className="selected-actors">
                      {editedActors.length === 0 ? (
                        <span className="no-actors">Add at least one player-assignable actor</span>
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
              </div>

              {/* Inflatees Section */}
              <div className="play-section">
                <div className="play-section-header">Inflatees</div>
                <div className="play-section-content">
                  <div className="play-form-row">
                    <label>Inflatee 1 (Player)</label>
                    <span style={{minWidth: '80px'}}>{playerAssignableActor?.name || '(None)'}</span>
                    <input
                      type="number"
                      value={inflatee1Capacity}
                      onChange={(e) => handleInflatee1CapacityChange(e.target.value)}
                      min={0}
                      max={100}
                      disabled={!playerAssignableActor}
                    />
                    <span className="unit">%</span>
                  </div>
                  <div className="play-form-row">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={inflatee2Enabled}
                        onChange={(e) => handleInflatee2Toggle(e.target.checked)}
                        disabled={availableInflatee2Actors.length === 0}
                      />
                      Inflatee 2
                    </label>
                    {inflatee2Enabled ? (
                      <>
                        <select
                          value={inflatee2ActorId}
                          onChange={(e) => handleInflatee2ActorChange(e.target.value)}
                        >
                          <option value="">Select...</option>
                          {availableInflatee2Actors.map(actor => (
                            <option key={actor.id} value={actor.id}>
                              {actor.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={inflatee2Capacity}
                          onChange={(e) => handleInflatee2CapacityChange(e.target.value)}
                          min={0}
                          max={100}
                        />
                        <span className="unit">%</span>
                      </>
                    ) : (
                      <span style={{color: '#666'}}>Disabled</span>
                    )}
                  </div>
                  <div className="play-form-row">
                    <label>Max Pain at 100%</label>
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
                    <span className="unit">/10</span>
                    <span style={{color: '#666', fontSize: '0.8em'}}>for [Feeling] vars</span>
                  </div>
                </div>
              </div>

              {/* Playback Section */}
              <div className="play-section">
                <div className="play-section-header">Playback</div>
                <div className="play-section-content">
                  <div className="play-form-row">
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="continueMode"
                        value="manual"
                        checked={continueMode === 'manual'}
                        onChange={() => {
                          setContinueMode('manual');
                          setHasChanges(true);
                        }}
                      />
                      Manual
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="continueMode"
                        value="auto"
                        checked={continueMode === 'auto'}
                        onChange={() => {
                          setContinueMode('auto');
                          setHasChanges(true);
                        }}
                      />
                      Auto
                    </label>
                  </div>
                  {continueMode === 'auto' && (
                    <div className="play-form-row" style={{marginTop: 'var(--spacing-xs)'}}>
                      <label>Timing</label>
                      <input
                        type="number"
                        value={autoContinueDelay}
                        onChange={(e) => {
                          setAutoContinueDelay(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)));
                          setHasChanges(true);
                        }}
                        min={1}
                        max={20}
                      />
                      <span className="unit">base</span>
                      <span>+</span>
                      <input
                        type="number"
                        value={dialogAllowance}
                        onChange={(e) => {
                          setDialogAllowance(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)));
                          setHasChanges(true);
                        }}
                        min={0}
                        max={20}
                      />
                      <span className="unit">text</span>
                      <span>+</span>
                      <input
                        type="number"
                        value={enhancementAllowance}
                        onChange={(e) => {
                          setEnhancementAllowance(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)));
                          setHasChanges(true);
                        }}
                        min={0}
                        max={20}
                      />
                      <span className="unit">enh.</span>
                    </div>
                  )}
                </div>
              </div>

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
