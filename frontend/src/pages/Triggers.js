import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import TriggerRow from '../components/common/TriggerRow';
import './Settings.css';

function Triggers() {
  const navigate = useNavigate();
  const { api } = useApp();
  const [animationState, setAnimationState] = useState('entering');
  const isExiting = useRef(false);

  const [sets, setSets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef(null);

  const selectedSet = sets.find(s => s.id === selectedId) || null;

  // Entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setAnimationState('entered'), 50);
    return () => clearTimeout(timer);
  }, []);

  // Exit-modal event (from HamburgerMenu)
  useEffect(() => {
    const handleExitModal = (event) => {
      if (isExiting.current) return;
      isExiting.current = true;
      const targetPath = event.detail?.path || '/';
      setAnimationState('exiting');
      setTimeout(() => navigate(targetPath), 500);
    };
    window.addEventListener('exit-modal', handleExitModal);
    return () => window.removeEventListener('exit-modal', handleExitModal);
  }, [navigate]);

  const handleClose = () => {
    if (isExiting.current) return;
    isExiting.current = true;
    setAnimationState('exiting');
    setTimeout(() => navigate('/'), 500);
  };

  // Load trigger sets
  const loadSets = useCallback(async (selectAfter) => {
    try {
      const data = await api.getTriggerSets();
      const arr = Array.isArray(data) ? data : [];
      setSets(arr);
      if (selectAfter) {
        setSelectedId(selectAfter);
      } else {
        setSelectedId(prev => (prev && arr.some(s => s.id === prev) ? prev : (arr[0]?.id || null)));
      }
    } catch (err) {
      console.error('Failed to load trigger sets', err);
      setSets([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  // Debounced persist of the currently selected set
  const persist = useCallback((id, payload) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.updateTriggerSet(id, payload).catch(err => console.error('Failed to save trigger set', err));
    }, 600);
  }, [api]);

  // Apply a local update to a set and persist it
  const mutateSet = (id, updater) => {
    setSets(prev => {
      const next = prev.map(s => {
        if (s.id !== id) return s;
        const updated = updater(s);
        persist(id, { name: updated.name, triggers: updated.triggers });
        return updated;
      });
      return next;
    });
  };

  const handleNewSet = async () => {
    try {
      const created = await api.createTriggerSet({ name: 'New Trigger Set', triggers: [] });
      const newId = created?.id;
      await loadSets(newId);
    } catch (err) {
      console.error('Failed to create trigger set', err);
    }
  };

  const handleDeleteSet = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this trigger set?')) return;
    try {
      await api.deleteTriggerSet(id);
      if (selectedId === id) setSelectedId(null);
      await loadSets();
    } catch (err) {
      console.error('Failed to delete trigger set', err);
    }
  };

  const handleNameChange = (value) => {
    mutateSet(selectedId, s => ({ ...s, name: value }));
  };

  const handleAddTrigger = () => {
    mutateSet(selectedId, s => ({
      ...s,
      triggers: [...(s.triggers || []), { type: 'system_message', id: Date.now().toString() }]
    }));
  };

  const handleTriggerChange = (idx, updated) => {
    mutateSet(selectedId, s => {
      const triggers = [...(s.triggers || [])];
      triggers[idx] = updated;
      return { ...s, triggers };
    });
  };

  const handleTriggerRemove = (idx) => {
    mutateSet(selectedId, s => ({
      ...s,
      triggers: (s.triggers || []).filter((_, i) => i !== idx)
    }));
  };

  const handleTriggerDrop = (toIdx, fromIdx) => {
    if (fromIdx === toIdx) return;
    mutateSet(selectedId, s => {
      const triggers = [...(s.triggers || [])];
      const [moved] = triggers.splice(fromIdx, 1);
      triggers.splice(toIdx, 0, moved);
      return { ...s, triggers };
    });
  };

  const handleSaveNow = () => {
    if (!selectedSet) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    api.updateTriggerSet(selectedSet.id, { name: selectedSet.name, triggers: selectedSet.triggers })
      .catch(err => console.error('Failed to save trigger set', err));
  };

  const handleTestFire = () => {
    if (!selectedSet) return;
    api.fireTriggerSet(selectedSet.id).catch(err => console.error('Failed to fire trigger set', err));
  };

  return (
    <>
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>
      <div className={`settings-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>Triggers - Reusable Trigger Sets</h1>
          <button className="header-close-btn" onClick={handleClose} title="Back to Chat">
            &times;
          </button>
        </div>
        <div className="tab-content">
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            {/* Left: list of trigger sets */}
            <div style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button type="button" className="btn btn-primary" onClick={handleNewSet} style={{ width: '100%' }}>
                + New Set
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {loading && <div style={{ opacity: 0.6, fontSize: '0.85rem', padding: '8px' }}>Loading...</div>}
                {!loading && sets.length === 0 && (
                  <div style={{ opacity: 0.6, fontSize: '0.85rem', padding: '8px' }}>
                    No trigger sets yet. Create one to get started.
                  </div>
                )}
                {sets.map(s => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: s.id === selectedId ? 'rgba(100,149,237,0.2)' : 'var(--bg-tertiary, #2a2d31)',
                      border: '1px solid var(--border-color, #3a3d45)'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                      {s.name || 'Untitled'}
                    </span>
                    <button
                      type="button"
                      className="btn-remove"
                      title="Delete set"
                      onClick={(e) => handleDeleteSet(s.id, e)}
                    >
                      −
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: editor */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {!selectedSet && (
                <div style={{ opacity: 0.6, padding: '20px', fontSize: '0.9rem' }}>
                  Select a trigger set on the left, or create a new one.
                </div>
              )}
              {selectedSet && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="form-group">
                    <label>Set Name</label>
                    <input
                      type="text"
                      value={selectedSet.name || ''}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="Trigger set name"
                    />
                  </div>

                  <div className="checkpoint-triggers">
                    <div className="checkpoint-triggers-header">
                      <span className="checkpoint-triggers-label">Triggers</span>
                      <button type="button" className="btn-icon btn-add" onClick={handleAddTrigger} title="Add trigger">+</button>
                    </div>
                    {(selectedSet.triggers || []).length === 0 && (
                      <div style={{ opacity: 0.6, fontSize: '0.85rem', padding: '8px 0' }}>
                        No triggers yet. Click + to add one.
                      </div>
                    )}
                    {(selectedSet.triggers || []).map((trigger, tIdx) => (
                      <TriggerRow
                        key={trigger.id || tIdx}
                        trigger={trigger}
                        isPumpable={true}
                        reminders={[]}
                        globalReminders={[]}
                        onChange={(updated) => handleTriggerChange(tIdx, updated)}
                        onRemove={() => handleTriggerRemove(tIdx)}
                        dragProps={{
                          draggable: true,
                          onDragStart: (e) => e.dataTransfer.setData('text/plain', tIdx.toString()),
                          onDragOver: (e) => e.preventDefault(),
                          onDrop: (e) => {
                            e.preventDefault();
                            const from = parseInt(e.dataTransfer.getData('text/plain'));
                            handleTriggerDrop(tIdx, from);
                          }
                        }}
                      />
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="btn btn-primary" onClick={handleSaveNow}>Save</button>
                    <button type="button" className="btn btn-secondary" onClick={handleTestFire}>Test Fire</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default Triggers;
