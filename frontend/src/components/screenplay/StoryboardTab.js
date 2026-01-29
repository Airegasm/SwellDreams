import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import PageCard from './PageCard';
import './ScreenPlayTabs.css';

function StoryboardTab({ editingPlayId, setEditingPlayId }) {
  const { plays, actors, api } = useApp();
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

  // No play selected - show play selector
  if (!currentPlay) {
    return (
      <div className="storyboard-tab">
        <div className="storyboard-empty">
          <h3>Select a Play to Edit</h3>
          <p>Go to the Plays tab and click "Edit" on a play, or select one below:</p>
          <div className="play-select-list">
            {plays.length === 0 ? (
              <p className="no-plays">No plays available. Create one in the Plays tab.</p>
            ) : (
              plays.map(play => (
                <button
                  key={play.id}
                  className="play-select-btn"
                  onClick={() => setEditingPlayId(play.id)}
                >
                  {play.name}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  const pages = currentPlay.pages || {};
  const pageOrder = Object.keys(pages);

  return (
    <div className="storyboard-tab">
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
