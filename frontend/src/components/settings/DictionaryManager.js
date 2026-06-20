import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import LoreEntryEditor from '../common/LoreEntryEditor';

// Lightweight client-side id for new term rows.
const termId = () => `dt-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const splitCSV = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const asArr = (v) => (Array.isArray(v) ? v : splitCSV(v)); // tolerate legacy CSV-string keys

// Global lorebook ("Dictionary"). One entry format / one engine shared with the Library.
// Default view shows Term · Keys · Definition; everything advanced is tucked behind a toggle.
function DictionaryManager() {
  const { api } = useApp();
  const { showError, showSuccess } = useError();

  const [groups, setGroups] = useState([]);
  const [editingId, setEditingId] = useState(null); // id | 'new' | null
  const [form, setForm] = useState({ name: '', terms: [] });
  const fileRef = useRef(null);

  const loadGroups = useCallback(async () => {
    try {
      const data = await api.getDictionary();
      setGroups(data?.groups || []);
    } catch (e) {
      showError('Failed to load dictionary');
    }
  }, [api, showError]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Form terms are held in the shared canonical lore shape (title/content/keys[]/…); mapped to the
  // group's {term, definition, …} storage on save.
  const blankTerm = () => ({ id: termId(), title: '', content: '', keys: [], secondaryKeys: [], logic: 'and_any', probability: 100, group: '', recurse: true, caseSensitive: false, scanDepth: 10, priority: 100, target: 'character', enabled: true });

  const startNew = () => { setForm({ name: '', terms: [] }); setEditingId('new'); };

  const startEdit = (g) => {
    setForm({
      name: g.name || '',
      terms: (g.terms || []).map(t => ({
        id: t.id || termId(),
        title: t.term || t.title || '',
        content: t.definition || t.content || '',
        enabled: t.enabled !== false,
        keys: asArr(t.keys),
        secondaryKeys: asArr(t.secondaryKeys),
        logic: t.logic || 'and_any',
        probability: t.probability == null ? 100 : t.probability,
        group: t.group || '',
        recurse: t.recurse !== false,
        caseSensitive: !!t.caseSensitive,
        scanDepth: t.scanDepth ?? 10,
        priority: t.priority ?? 100,
        target: t.target || 'character',
      })),
    });
    setEditingId(g.id);
  };

  const cancel = () => { setEditingId(null); setForm({ name: '', terms: [] }); };

  const addTermRow = () => setForm(prev => ({ ...prev, terms: [...prev.terms, blankTerm()] }));
  const setTerm = (id, canonical) => setForm(prev => ({ ...prev, terms: prev.terms.map(t => (t.id === id ? { ...canonical, id } : t)) }));
  const removeTermRow = (id) => setForm(prev => ({ ...prev, terms: prev.terms.filter(t => t.id !== id) }));

  const save = async () => {
    const name = form.name.trim();
    if (!name) { showError('Group name is required'); return; }
    const terms = form.terms
      .filter(t => (t.title || '').trim() && (t.content || '').trim())
      .map(t => ({
        id: t.id,
        term: t.title.trim(),
        definition: t.content.trim(),
        enabled: t.enabled !== false,
        keys: asArr(t.keys),
        secondaryKeys: asArr(t.secondaryKeys),
        logic: t.logic || 'and_any',
        probability: t.probability === '' || t.probability == null ? 100 : Number(t.probability),
        group: (t.group || '').trim(),
        recurse: t.recurse !== false,
        caseSensitive: !!t.caseSensitive,
        scanDepth: t.scanDepth ?? 10,
        priority: t.priority ?? 100,
        target: t.target || 'character',
      }));
    try {
      if (editingId === 'new') await api.createDictionaryGroup(name, terms, true);
      else await api.updateDictionaryGroup(editingId, { name, terms });
      await loadGroups();
      showSuccess('Dictionary group saved');
      cancel();
    } catch (e) {
      showError('Failed to save dictionary group');
    }
  };

  const toggleEnabled = async (g) => {
    try { await api.updateDictionaryGroup(g.id, { enabled: g.enabled === false }); await loadGroups(); }
    catch (e) { showError('Failed to update dictionary group'); }
  };

  const remove = async (g) => {
    if (!window.confirm(`Delete dictionary group "${g.name}"?`)) return;
    try { await api.deleteDictionaryGroup(g.id); await loadGroups(); showSuccess('Dictionary group deleted'); }
    catch (e) { showError('Failed to delete dictionary group'); }
  };

  // Import a SillyTavern World Info / character_book JSON as a new book.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const name = file.name.replace(/\.(json|txt)$/i, '');
      const res = await apiFetch(`${API_BASE}/api/dictionary/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: text, name }),
      });
      await loadGroups();
      showSuccess(`Imported ${res?.count ?? ''} entr${res?.count === 1 ? 'y' : 'ies'} from "${name}"`);
    } catch (err) {
      showError(`Import failed: ${err?.message || 'invalid lorebook'}`);
    }
  };

  return (
    <div>
      <p className="section-description">
        Global lorebook injected into prompts. Entries with no trigger words are always-on; entries with trigger words
        activate on keyword. Assign per-card via the Library, or keep books here as shared global reference.
      </p>

      {editingId && (
        <div className="reminder-form" style={{ border: '1px solid var(--border-color, #444)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
          <div className="form-group">
            <label>Book Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Setting Terms" />
          </div>

          <label>Entries</label>
          {form.terms.length === 0 && <p className="section-hint">No entries yet. Add one below.</p>}
          {form.terms.map(t => (
            <div key={t.id} className="dict-entry-wrap" style={{ marginBottom: 8 }}>
              <LoreEntryEditor entry={t} onChange={(c) => setTerm(t.id, c)} showEnabled />
              <button className="btn btn-sm btn-danger" onClick={() => removeTermRow(t.id)} style={{ marginTop: 4 }}>Remove entry</button>
            </div>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={addTermRow}>+ Add Entry</button>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button className="btn btn-sm btn-secondary" onClick={cancel}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save}>Save Book</button>
          </div>
        </div>
      )}

      <div className="reminders-list">
        {groups.length === 0 && !editingId ? (
          <p className="empty-message">No lorebooks yet.</p>
        ) : (
          groups.map(g => (
            <div key={g.id} className={`reminder-item ${g.enabled === false ? 'disabled' : ''}`}>
              <label className="toggle-switch">
                <input type="checkbox" checked={g.enabled !== false} onChange={() => toggleEnabled(g)} />
                <span className="toggle-slider"></span>
              </label>
              <span className="reminder-name" style={{ flex: 1 }}>
                <strong>{g.name}</strong> — {(g.terms || []).length} entr{(g.terms || []).length === 1 ? 'y' : 'ies'}
              </span>
              <div className="reminder-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => startEdit(g)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(g)}>Del</button>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button className="btn btn-sm btn-primary" onClick={startNew}>+ Add Book</button>
        <button className="btn btn-sm btn-secondary" onClick={() => fileRef.current?.click()}>Import SillyTavern Lorebook</button>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json" style={{ display: 'none' }} onChange={handleImportFile} />
      </div>
    </div>
  );
}

export default DictionaryManager;
