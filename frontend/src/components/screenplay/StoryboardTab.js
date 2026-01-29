import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import { API_BASE } from '../../config';
import PageCard from './PageCard';
import './ScreenPlayTabs.css';

const PARAGRAPH_TYPES = [
  { type: 'narration', label: 'Narration', icon: '📖', desc: 'Story text' },
  { type: 'dialogue', label: 'Dialogue', icon: '💬', desc: 'NPC speaks' },
  { type: 'player_dialogue', label: 'Player Dialogue', icon: '🗣️', desc: 'Player speaks' },
  { type: 'choice', label: 'Choice', icon: '❓', desc: 'Branch options' },
  { type: 'inline_choice', label: 'Inline Choice', icon: '💭', desc: 'Questions' },
  { type: 'goto_page', label: 'Go to Page', icon: '➡️', desc: 'Jump to page' },
  { type: 'condition', label: 'Condition', icon: '⚡', desc: 'If/then logic' },
  { type: 'set_variable', label: 'Set Variable', icon: '📝', desc: 'Store value' },
  { type: 'set_npc_actor_avatar', label: 'Set NPC Avatar', icon: '🎭', desc: 'Change avatar' },
  { type: 'delay', label: 'Delay', icon: '⏱️', desc: 'Wait time' },
  { type: 'pump', label: 'Pump (Real)', icon: '⛽', desc: 'Device control' },
  { type: 'mock_pump', label: 'Mock Pump', icon: '🎈', desc: 'Simulate pump' },
  { type: 'end', label: 'End', icon: '🏁', desc: 'Finish play' }
];

function StoryboardTab({ editingPlayId, setEditingPlayId, onCreateNew }) {
  const { plays, actors, api, settings } = useApp();
  const [currentPlay, setCurrentPlay] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [mediaImages, setMediaImages] = useState([]);

  // Load play when editingPlayId changes
  useEffect(() => {
    if (editingPlayId) {
      const play = plays.find(p => p.id === editingPlayId);
      if (play) {
        setCurrentPlay(JSON.parse(JSON.stringify(play))); // Deep clone
        setHasUnsavedChanges(false);
      }
    } else {
      setCurrentPlay(null);
    }
  }, [editingPlayId, plays]);

  // Load media images for avatar selection
  useEffect(() => {
    const loadImages = async () => {
      try {
        const images = await api.getMediaImages();
        setMediaImages(images || []);
      } catch (err) {
        console.error('Failed to load media images:', err);
      }
    };
    loadImages();
  }, [api]);

  const handleSave = async () => {
    if (!currentPlay) return;
    try {
      await api.updatePlay(currentPlay.id, currentPlay);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Failed to save play:', err);
    }
  };

  const handlePlayChange = (updates) => {
    setCurrentPlay(prev => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  };

  const handleAddPage = () => {
    if (!currentPlay) return;

    const pageIds = Object.keys(currentPlay.pages || {});
    const newPageNum = pageIds.length + 1;
    const newPageId = `page-${Date.now()}`;

    const newPage = {
      id: newPageId,
      title: `Page ${newPageNum}`,
      paragraphs: []
    };

    handlePlayChange({
      pages: {
        ...currentPlay.pages,
        [newPageId]: newPage
      }
    });
  };

  const handlePageUpdate = (pageId, updates) => {
    if (!currentPlay) return;

    handlePlayChange({
      pages: {
        ...currentPlay.pages,
        [pageId]: {
          ...currentPlay.pages[pageId],
          ...updates
        }
      }
    });
  };

  const handleDeletePage = (pageId) => {
    if (!currentPlay) return;
    if (Object.keys(currentPlay.pages).length <= 1) {
      alert('Cannot delete the last page');
      return;
    }

    const { [pageId]: removed, ...remainingPages } = currentPlay.pages;

    // Update startPageId if we're deleting the start page
    let newStartPageId = currentPlay.startPageId;
    if (currentPlay.startPageId === pageId) {
      newStartPageId = Object.keys(remainingPages)[0];
    }

    handlePlayChange({
      pages: remainingPages,
      startPageId: newStartPageId
    });
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Discard them?')) {
        return;
      }
    }
    setEditingPlayId(null);
    setCurrentPlay(null);
  };

  // Handle drag start from palette
  const handleDragStart = (e, type) => {
    e.dataTransfer.setData('paragraphType', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Handle LLM enhance for text in storyboard editor
  const handleEnhanceText = useCallback(async (text, type, actorId) => {
    if (!text || !currentPlay) return text;

    try {
      const actor = actorId ? actors.find(a => a.id === actorId) : null;

      const response = await fetch(`${API_BASE}/api/screenplay/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          type,
          actorName: actor?.name,
          actorPersonality: actor?.personality,
          authorMode: currentPlay?.authorMode || '2nd-person',
          maxTokens: 150,
          definitions: settings?.screenplayDefinitions || '',
          scenario: currentPlay?.description || '',
          location: currentPlay?.location || '',
          actorRelationships: currentPlay?.actorRelationships || '',
          previousText: ''
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.text) {
          return result.text;
        }
      }
    } catch (error) {
      console.error('Enhancement failed:', error);
    }

    return text;
  }, [currentPlay, actors, settings?.screenplayDefinitions]);

  // No play selected - show play selector with Create New option
  if (!currentPlay) {
    return (
      <div className="storyboard-tab">
        <div className="storyboard-empty">
          <h3>Storyboard Editor</h3>
          <p>Select a play to edit or create a new one:</p>

          <button
            className="btn btn-primary btn-lg create-new-btn"
            onClick={onCreateNew}
          >
            + Create New Play
          </button>

          {plays.length > 0 && (
            <>
              <div className="divider-text">or edit existing</div>
              <div className="play-select-list">
                {plays.map(play => (
                  <button
                    key={play.id}
                    className="play-select-btn"
                    onClick={() => setEditingPlayId(play.id)}
                  >
                    {play.name}
                    <span className="play-meta">{Object.keys(play.pages || {}).length} pages</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const pages = currentPlay.pages || {};
  const pageOrder = Object.keys(pages);

  // Render the draggable palette (portaled to overlap filmstrip)
  const renderPalette = () => createPortal(
    <div className="storyboard-palette">
      <div className="palette-header">Events</div>
      <div className="palette-items">
        {PARAGRAPH_TYPES.map(({ type, label, icon, desc }) => (
          <div
            key={type}
            className="palette-item"
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
          >
            <span className="palette-icon">{icon}</span>
            <div className="palette-text">
              <span className="palette-label">{label}</span>
              <span className="palette-desc">{desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );

  return (
    <div className="storyboard-tab storyboard-editing">
      {renderPalette()}
      <div className="storyboard-header">
        <div className="storyboard-title">
          <button className="btn btn-secondary btn-sm" onClick={handleClose}>
            ← Back
          </button>
          <input
            type="text"
            className="play-name-input"
            value={currentPlay.name}
            onChange={(e) => handlePlayChange({ name: e.target.value })}
            placeholder="Play name..."
          />
          {hasUnsavedChanges && <span className="unsaved-indicator">*</span>}
        </div>
        <div className="storyboard-actions">
          <select
            className="author-mode-select"
            value={currentPlay.authorMode || 'auto'}
            onChange={(e) => handlePlayChange({ authorMode: e.target.value })}
          >
            <option value="auto">Author Mode: Auto</option>
            <option value="2nd-person">Author Mode: 2nd Person</option>
            <option value="3rd-person">Author Mode: 3rd Person</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
          >
            Save
          </button>
        </div>
      </div>

      <div className="storyboard-actors">
        <span className="actors-label">Actors in Play:</span>
        <div className="actors-chips">
          {(currentPlay.actors || []).map(actorId => {
            const actor = actors.find(a => a.id === actorId);
            return actor ? (
              <span key={actorId} className="actor-chip">
                {actor.name}
                <button
                  className="chip-remove"
                  onClick={() => handlePlayChange({
                    actors: currentPlay.actors.filter(id => id !== actorId)
                  })}
                >
                  ×
                </button>
              </span>
            ) : null;
          })}
          <select
            className="add-actor-select"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                handlePlayChange({
                  actors: [...(currentPlay.actors || []), e.target.value]
                });
              }
            }}
          >
            <option value="">+ Add Actor</option>
            {actors
              .filter(a => !(currentPlay.actors || []).includes(a.id))
              .map(actor => (
                <option key={actor.id} value={actor.id}>{actor.name}</option>
              ))
            }
          </select>
        </div>
      </div>

      <div className="storyboard-pages">
        {pageOrder.map((pageId, index) => (
          <PageCard
            key={pageId}
            page={pages[pageId]}
            pageIndex={index}
            isStartPage={currentPlay.startPageId === pageId}
            allPages={pages}
            actors={actors.filter(a => (currentPlay.actors || []).includes(a.id))}
            mediaImages={mediaImages}
            onUpdate={(updates) => handlePageUpdate(pageId, updates)}
            onDelete={() => handleDeletePage(pageId)}
            onSetStart={() => handlePlayChange({ startPageId: pageId })}
            onEnhanceText={handleEnhanceText}
          />
        ))}

        <button className="add-page-btn" onClick={handleAddPage}>
          + Add Page
        </button>
      </div>
    </div>
  );
}

export default StoryboardTab;
