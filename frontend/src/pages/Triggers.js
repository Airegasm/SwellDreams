import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import TriggerRow from '../components/common/TriggerRow';
import TreeEditor from '../components/common/TreeEditor';
import './Settings.css';

function Triggers() {
  const navigate = useNavigate();
  const { api } = useApp();
  const [animationState, setAnimationState] = useState('entering');
  const isExiting = useRef(false);

  const [sets, setSets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  // Per-id debounce timers so switching sets within the debounce window
  // never silently drops a pending save for the previously edited set.
  const saveTimers = useRef(new Map());
  // Latest pending payload per id, used to flush on demand (unmount/save now).
  const pendingPayloads = useRef(new Map());

  const selectedSet = sets.find(s => s.id === selectedId) || null;

  // --- Trigger Library (global nested-block trees) ---
  const [mode, setMode] = useState('sets'); // 'sets' | 'library'
  const [trees, setTrees] = useState([]);
  const [selectedTreeId, setSelectedTreeId] = useState(null);
  const [treeFilter, setTreeFilter] = useState('');
  const treeSaveTimers = useRef(new Map());
  const selectedTree = trees.find(t => t.id === selectedTreeId) || null;

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

  // Immediately flush a pending debounced save for a given id (or all ids).
  const flushPending = useCallback((id) => {
    const ids = id != null ? [id] : Array.from(saveTimers.current.keys());
    ids.forEach((key) => {
      const timer = saveTimers.current.get(key);
      if (timer) {
        clearTimeout(timer);
        saveTimers.current.delete(key);
      }
      const payload = pendingPayloads.current.get(key);
      if (payload) {
        pendingPayloads.current.delete(key);
        api.updateTriggerSet(key, payload).catch(err => console.error('Failed to save trigger set', err));
      }
    });
  }, [api]);

  const handleClose = () => {
    if (isExiting.current) return;
    isExiting.current = true;
    flushPending();
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

  // Flush any pending debounced autosave when the component unmounts so edits
  // are never lost if the page is closed during the debounce window.
  const flushRef = useRef(null);
  flushRef.current = flushPending;
  useEffect(() => {
    return () => { if (flushRef.current) flushRef.current(); };
  }, []);

  // Debounced persist of a specific set, keyed per-id so concurrent edits to
  // different sets each get their own timer (no cross-set save loss).
  const persist = useCallback((id, payload) => {
    pendingPayloads.current.set(id, payload);
    const existing = saveTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      saveTimers.current.delete(id);
      pendingPayloads.current.delete(id);
      api.updateTriggerSet(id, payload).catch(err => console.error('Failed to save trigger set', err));
    }, 600);
    saveTimers.current.set(id, timer);
  }, [api]);

  // Apply a local update to a set, then persist OUTSIDE the setSets updater so
  // the updater stays pure (safe under StrictMode double-invocation).
  const mutateSet = (id, updater) => {
    let updatedSet = null;
    setSets(prev => prev.map(s => {
      if (s.id !== id) return s;
      updatedSet = updater(s);
      return updatedSet;
    }));
    if (updatedSet) {
      persist(id, { name: updatedSet.name, triggers: updatedSet.triggers });
    }
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
    // Guard against a NaN / out-of-range drag payload that would splice an
    // undefined trigger into the list.
    const count = (selectedSet?.triggers || []).length;
    if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx >= count) return;
    mutateSet(selectedId, s => {
      const triggers = [...(s.triggers || [])];
      const [moved] = triggers.splice(fromIdx, 1);
      triggers.splice(toIdx, 0, moved);
      return { ...s, triggers };
    });
  };

  const handleSaveNow = () => {
    if (!selectedSet) return;
    // Cancel any pending debounce for this set and write the current state now.
    const timer = saveTimers.current.get(selectedSet.id);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(selectedSet.id);
    pendingPayloads.current.delete(selectedSet.id);
    api.updateTriggerSet(selectedSet.id, { name: selectedSet.name, triggers: selectedSet.triggers })
      .catch(err => console.error('Failed to save trigger set', err));
  };

  const handleTestFire = () => {
    if (!selectedSet) return;
    api.fireTriggerSet(selectedSet.id).catch(err => console.error('Failed to fire trigger set', err));
  };

  // --- Library handlers ---
  const loadTrees = useCallback(async (selectAfter) => {
    try {
      const data = await api.getTriggerTrees();
      const arr = data?.trees || [];
      setTrees(arr);
      if (selectAfter) setSelectedTreeId(selectAfter);
      else setSelectedTreeId(prev => (prev && arr.some(t => t.id === prev) ? prev : (arr[0]?.id || null)));
    } catch (err) { console.error('Failed to load trigger trees', err); setTrees([]); }
  }, [api]);

  useEffect(() => { loadTrees(); }, [loadTrees]);

  const persistTree = useCallback((id, patch) => {
    const existing = treeSaveTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      treeSaveTimers.current.delete(id);
      api.updateTriggerTree(id, patch).catch(err => console.error('Failed to save tree', err));
    }, 600);
    treeSaveTimers.current.set(id, timer);
  }, [api]);

  const mutateTree = (id, updater) => {
    let updated = null;
    setTrees(prev => prev.map(t => { if (t.id !== id) return t; updated = updater(t); return updated; }));
    if (updated && !updated.builtIn) persistTree(id, { name: updated.name, nodes: updated.nodes, tag: updated.tag, source: updated.source });
  };

  const handleNewTree = async () => {
    try { const created = await api.createTriggerTree('New Trigger Tree', [], '', ''); await loadTrees(created?.id); }
    catch (err) { console.error('Failed to create tree', err); }
  };
  const handleDeleteTree = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this library tree?')) return;
    try { await api.deleteTriggerTree(id); if (selectedTreeId === id) setSelectedTreeId(null); await loadTrees(); }
    catch (err) { console.error('Failed to delete tree', err); }
  };

  const handleExportTree = async (id) => {
    try {
      const env = await api.exportTriggerTree(id);
      const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(trees.find(t => t.id === id)?.name || 'tree').replace(/[^a-z0-9]+/gi, '_')}.tree.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Export failed', err); }
  };
  const handleImportTree = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const env = JSON.parse(await file.text());
      const res = await api.importTriggerTree(env);
      await loadTrees(res?.rootId || undefined);
      if (res?.missingBuiltIns?.length) window.alert(`Imported (${res.added} new, ${res.reused} reused). Missing built-in trees: ${res.missingBuiltIns.join(', ')}`);
    } catch (err) { console.error('Import failed', err); window.alert('Import failed: ' + (err.message || err)); }
    e.target.value = '';
  };

  const filteredTrees = trees.filter(t => {
    if (!treeFilter.trim()) return true;
    const q = treeFilter.toLowerCase();
    return [t.name, t.tag, t.source].some(v => (v || '').toLowerCase().includes(q));
  });

  return (
    <>
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>
      <div className={`settings-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>Triggers</h1>
          <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
            <button type="button" className={`btn btn-sm ${mode === 'sets' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('sets')}>Trigger Sets</button>
            <button type="button" className={`btn btn-sm ${mode === 'library' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('library')}>Trigger Library</button>
          </div>
          <button className="header-close-btn" onClick={handleClose} title="Back to Chat" style={{ marginLeft: 'auto' }}>
            &times;
          </button>
        </div>
        <div className="tab-content">
          {mode === 'library' && (
            <div className="triggers-layout">
              <div className="triggers-list-col">
                <button type="button" className="btn btn-primary" onClick={handleNewTree} style={{ width: '100%' }}>+ New Tree</button>
                <label className="btn btn-sm btn-secondary" style={{ width: '100%', textAlign: 'center', cursor: 'pointer', marginTop: 4 }}>
                  Import Tree…
                  <input type="file" accept="application/json,.json" onChange={handleImportTree} style={{ display: 'none' }} />
                </label>
                <input type="text" value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} placeholder="filter by name / tag / source" style={{ width: '100%', margin: '6px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {filteredTrees.length === 0 && <div style={{ opacity: 0.6, fontSize: '0.85rem', padding: '8px' }}>No library trees{treeFilter ? ' match' : ' yet'}.</div>}
                  {filteredTrees.map(t => (
                    <div key={t.id} onClick={() => setSelectedTreeId(t.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', background: t.id === selectedTreeId ? 'rgba(100,149,237,0.2)' : 'var(--bg-tertiary, #2a2d31)', border: '1px solid var(--border-color, #3a3d45)' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{t.name || 'Untitled'}{t.builtIn ? ' 🔒' : ''}{t.tag ? ` · ${t.tag}` : ''}</span>
                      {!t.builtIn && <button type="button" className="btn-remove" title="Delete tree" onClick={(e) => handleDeleteTree(t.id, e)}>−</button>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="triggers-editor-col">
                {!selectedTree && <div style={{ opacity: 0.6, padding: '20px', fontSize: '0.9rem' }}>Select a library tree, or create one. Library trees are card-agnostic — reference them from a character's scope sections (Assign from Library).</div>}
                {selectedTree && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedTree.builtIn && <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>🔒 Built-in tree — read-only.</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleExportTree(selectedTree.id)} title="Export this tree + its fire_tree closure">Export…</button>
                    </div>
                    <div className="form-group" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input type="text" value={selectedTree.name || ''} disabled={selectedTree.builtIn} onChange={(e) => mutateTree(selectedTree.id, t => ({ ...t, name: e.target.value }))} placeholder="tree name" style={{ flex: 2, minWidth: 160 }} />
                      <input type="text" value={selectedTree.tag || ''} disabled={selectedTree.builtIn} onChange={(e) => mutateTree(selectedTree.id, t => ({ ...t, tag: e.target.value }))} placeholder="tag / folder" style={{ flex: 1, minWidth: 100 }} />
                      <input type="text" value={selectedTree.source || ''} disabled={selectedTree.builtIn} onChange={(e) => mutateTree(selectedTree.id, t => ({ ...t, source: e.target.value }))} placeholder="source (e.g. from card: X)" style={{ flex: 1, minWidth: 120 }} />
                    </div>
                    {/* Agnostic editor: NO card-specific rowProps (no profiles/members) — enforces portability. */}
                    <TreeEditor value={selectedTree.nodes || []} onChange={(nodes) => mutateTree(selectedTree.id, t => ({ ...t, nodes }))} />
                  </div>
                )}
              </div>
            </div>
          )}
          {mode === 'sets' && (
          <div className="triggers-layout">
            {/* Left: list of trigger sets */}
            <div className="triggers-list-col">
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
            <div className="triggers-editor-col">
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
                      // Trigger sets are reusable and character-agnostic — they
                      // aren't bound to a specific character at edit time, so all
                      // trigger options are intentionally available (isPumpable
                      // forced true) and per-character reminder lists are empty.
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
          )}
        </div>
      </div>
    </>
  );
}

export default Triggers;
