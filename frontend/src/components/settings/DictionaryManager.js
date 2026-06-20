import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';

// Lightweight client-side id for new term rows.
const termId = () => `dt-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const splitCSV = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const joinCSV = (v) => Array.isArray(v) ? v.join(', ') : (v || '');

// Global lorebook ("Dictionary"). One entry format / one engine shared with the Library.
// Default view shows Term · Keys · Definition; everything advanced is tucked behind a toggle.
function DictionaryManager() {
  const { api } = useApp();
  const { showError, showSuccess } = useError();

  const [groups, setGroups] = useState([]);
  const [editingId, setEditingId] = useState(null); // id | 'new' | null
  const [form, setForm] = useState({ name: '', terms: [] });
  const [expanded, setExpanded] = useState({}); // termId -> bool (show advanced)
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

  const blankTerm = () => ({ id: termId(), term: '', definition: '', enabled: true, keys: '', secondaryKeys: '', logic: 'and_any', probability: 100, group: '', recurse: true });

  const startNew = () => { setForm({ name: '', terms: [] }); setEditingId('new'); };

  const startEdit = (g) => {
    setForm({
      name: g.name || '',
      terms: (g.terms || []).map(t => ({
        id: t.id || termId(),
        term: t.term || t.title || '',
        definition: t.definition || t.content || '',
        enabled: t.enabled !== false,
        keys: joinCSV(t.keys),
        secondaryKeys: joinCSV(t.secondaryKeys),
        logic: t.logic || 'and_any',
        probability: t.probability == null ? 100 : t.probability,
        group: t.group || '',
        recurse: t.recurse !== false,
      })),
    });
    setEditingId(g.id);
  };

  const cancel = () => { setEditingId(null); setForm({ name: '', terms: [] }); };

  const addTermRow = () => setForm(prev => ({ ...prev, terms: [...prev.terms, blankTerm()] }));
  const updateTermRow = (id, field, value) => setForm(prev => ({ ...prev, terms: prev.terms.map(t => (t.id === id ? { ...t, [field]: value } : t)) }));
  const removeTermRow = (id) => setForm(prev => ({ ...prev, terms: prev.terms.filter(t => t.id !== id) }));

  const save = async () => {
    const name = form.name.trim();
    if (!name) { showError('Group name is required'); return; }
    const terms = form.terms
      .filter(t => t.term.trim() && t.definition.trim())
      .map(t => ({
        id: t.id,
        term: t.term.trim(),
        definition: t.definition.trim(),
        enabled: t.enabled !== false,
        keys: splitCSV(t.keys),
        secondaryKeys: splitCSV(t.secondaryKeys),
        logic: t.logic || 'and_any',
        probability: t.probability === '' || t.probability == null ? 100 : Number(t.probability),
        group: (t.group || '').trim(),
        recurse: t.recurse !== false,
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
            <div key={t.id} className={`dict-term ${t.enabled === false ? 'disabled' : ''}`}>
              <div className="dict-term-head">
                <label className="dict-term-enable" title={t.enabled === false ? 'Disabled' : 'Enabled'}>
                  <input type="checkbox" checked={t.enabled !== false} onChange={(e) => updateTermRow(t.id, 'enabled', e.target.checked)} />
                </label>
                <input type="text" className="dict-term-name" value={t.term} onChange={(e) => updateTermRow(t.id, 'term', e.target.value)} placeholder="Title (e.g. Bike Pump)" />
                <button className="btn btn-sm btn-danger dict-term-del" onClick={() => removeTermRow(t.id)} title="Remove">×</button>
              </div>
              <input type="text" className="dict-term-keys" value={t.keys || ''} onChange={(e) => updateTermRow(t.id, 'keys', e.target.value)}
                placeholder="Trigger words, comma-separated (blank = always-on)"
                title="Keyword triggers. Blank = always-on. Any match activates this entry." />
              <textarea className="dict-term-def" rows={2} value={t.definition} onChange={(e) => updateTermRow(t.id, 'definition', e.target.value)} placeholder="Content" />

              <button type="button" className="dict-adv-toggle" onClick={() => setExpanded(p => ({ ...p, [t.id]: !p[t.id] }))}>
                {expanded[t.id] ? '▾ Advanced' : '▸ Advanced'}
              </button>
              {expanded[t.id] && (
                <div className="dict-adv">
                  <div className="dict-adv-row">
                    <input type="text" value={t.secondaryKeys || ''} onChange={(e) => updateTermRow(t.id, 'secondaryKeys', e.target.value)}
                      placeholder="Secondary keys (comma)" title="Combined with the trigger words using the logic at right." />
                    <select value={t.logic || 'and_any'} onChange={(e) => updateTermRow(t.id, 'logic', e.target.value)} title="How secondary keys combine with the triggers">
                      <option value="and_any">trigger AND any secondary</option>
                      <option value="and_all">trigger AND all secondary</option>
                      <option value="not_any">trigger AND no secondary</option>
                      <option value="not_all">trigger AND not all secondary</option>
                    </select>
                  </div>
                  <div className="dict-adv-row">
                    <label className="dict-adv-field" title="Chance to activate when matched">% chance
                      <input type="number" min={0} max={100} value={t.probability ?? 100} onChange={(e) => updateTermRow(t.id, 'probability', e.target.value)} />
                    </label>
                    <label className="dict-adv-field" title="Inclusion group — only one entry from a group activates per turn">Group
                      <input type="text" value={t.group || ''} onChange={(e) => updateTermRow(t.id, 'group', e.target.value)} placeholder="(none)" />
                    </label>
                    <label className="dict-adv-check" title="Recursion: let this entry's content trigger other entries' keywords (chained activation)">
                      <input type="checkbox" checked={t.recurse !== false} onChange={(e) => updateTermRow(t.id, 'recurse', e.target.checked)} />
                      <span>recursion</span>
                    </label>
                  </div>
                </div>
              )}
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
