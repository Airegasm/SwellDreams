import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';

// Lightweight client-side id for new term rows.
const termId = () => `dt-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

// Always-on global dictionary: groups of { term, definition } injected into every prompt.
// Same group/term structure as the Instructor Library, but never keyword-gated and global.
function DictionaryManager() {
  const { api } = useApp();
  const { showError, showSuccess } = useError();

  const [groups, setGroups] = useState([]);
  const [editingId, setEditingId] = useState(null); // id | 'new' | null
  const [form, setForm] = useState({ name: '', terms: [] });

  const loadGroups = useCallback(async () => {
    try {
      const data = await api.getDictionary();
      setGroups(data?.groups || []);
    } catch (e) {
      showError('Failed to load dictionary');
    }
  }, [api, showError]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const startNew = () => {
    setForm({ name: '', terms: [] });
    setEditingId('new');
  };

  const startEdit = (g) => {
    setForm({
      name: g.name || '',
      terms: (g.terms || []).map(t => ({ id: t.id || termId(), term: t.term || '', definition: t.definition || '', enabled: t.enabled !== false, keys: Array.isArray(t.keys) ? t.keys.join(', ') : (t.keys || '') })),
    });
    setEditingId(g.id);
  };

  const cancel = () => {
    setEditingId(null);
    setForm({ name: '', terms: [] });
  };

  const addTermRow = () => {
    setForm(prev => ({ ...prev, terms: [...prev.terms, { id: termId(), term: '', definition: '', enabled: true, keys: '' }] }));
  };
  const updateTermRow = (id, field, value) => {
    setForm(prev => ({ ...prev, terms: prev.terms.map(t => (t.id === id ? { ...t, [field]: value } : t)) }));
  };
  const removeTermRow = (id) => {
    setForm(prev => ({ ...prev, terms: prev.terms.filter(t => t.id !== id) }));
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) { showError('Group name is required'); return; }
    const terms = form.terms
      .filter(t => t.term.trim() && t.definition.trim())
      .map(t => ({ id: t.id, term: t.term.trim(), definition: t.definition.trim(), enabled: t.enabled !== false, keys: (t.keys || '').split(',').map(k => k.trim()).filter(Boolean) }));
    try {
      if (editingId === 'new') {
        await api.createDictionaryGroup(name, terms, true);
      } else {
        await api.updateDictionaryGroup(editingId, { name, terms });
      }
      await loadGroups();
      showSuccess('Dictionary group saved');
      cancel();
    } catch (e) {
      showError('Failed to save dictionary group');
    }
  };

  const toggleEnabled = async (g) => {
    try {
      await api.updateDictionaryGroup(g.id, { enabled: g.enabled === false });
      await loadGroups();
    } catch (e) {
      showError('Failed to update dictionary group');
    }
  };

  const remove = async (g) => {
    if (!window.confirm(`Delete dictionary group "${g.name}"?`)) return;
    try {
      await api.deleteDictionaryGroup(g.id);
      await loadGroups();
      showSuccess('Dictionary group deleted');
    } catch (e) {
      showError('Failed to delete dictionary group');
    }
  };

  return (
    <div>
      <p className="section-description">
        Global definitions injected into every character's prompt (no keyword trigger required). Toggle whole groups
        or individual terms on/off — only enabled terms in enabled groups are sent to the AI.
      </p>

      {editingId && (
        <div className="reminder-form" style={{ border: '1px solid var(--border-color, #444)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
          <div className="form-group">
            <label>Group Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Setting Terms"
            />
          </div>

          <label>Terms</label>
          {form.terms.length === 0 && <p className="section-hint">No terms yet. Add one below.</p>}
          {form.terms.map(t => (
            <div key={t.id} className={`dict-term ${t.enabled === false ? 'disabled' : ''}`}>
              <div className="dict-term-head">
                <label className="dict-term-enable" title={t.enabled === false ? 'Disabled — not sent to the AI' : 'Enabled'}>
                  <input
                    type="checkbox"
                    checked={t.enabled !== false}
                    onChange={(e) => updateTermRow(t.id, 'enabled', e.target.checked)}
                  />
                </label>
                <input
                  type="text"
                  className="dict-term-name"
                  value={t.term}
                  onChange={(e) => updateTermRow(t.id, 'term', e.target.value)}
                  placeholder="Term (e.g. bike pump)"
                />
                <button className="btn btn-sm btn-danger dict-term-del" onClick={() => removeTermRow(t.id)} title="Remove term">×</button>
              </div>
              <input
                type="text"
                className="dict-term-keys"
                value={t.keys || ''}
                onChange={(e) => updateTermRow(t.id, 'keys', e.target.value)}
                placeholder="Trigger words, comma-separated (blank = always-on)"
                title="Comma-separated trigger words/phrases. Leave blank for always-on. Any match injects this term; multiple matches inject multiple terms."
              />
              <textarea
                className="dict-term-def"
                rows={2}
                value={t.definition}
                onChange={(e) => updateTermRow(t.id, 'definition', e.target.value)}
                placeholder="Definition"
              />
            </div>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={addTermRow}>+ Add Term</button>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button className="btn btn-sm btn-secondary" onClick={cancel}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={save}>Save Group</button>
          </div>
        </div>
      )}

      <div className="reminders-list">
        {groups.length === 0 && !editingId ? (
          <p className="empty-message">No dictionary groups yet.</p>
        ) : (
          groups.map(g => (
            <div key={g.id} className={`reminder-item ${g.enabled === false ? 'disabled' : ''}`}>
              <label className="toggle-switch">
                <input type="checkbox" checked={g.enabled !== false} onChange={() => toggleEnabled(g)} />
                <span className="toggle-slider"></span>
              </label>
              <span className="reminder-name" style={{ flex: 1 }}>
                <strong>{g.name}</strong> — {(g.terms || []).length} term{(g.terms || []).length === 1 ? '' : 's'}
              </span>
              <div className="reminder-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => startEdit(g)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(g)}>Del</button>
              </div>
            </div>
          ))
        )}
      </div>

      <button className="btn btn-sm btn-primary" style={{ marginTop: '8px' }} onClick={startNew}>+ Add Term Group</button>
    </div>
  );
}

export default DictionaryManager;
