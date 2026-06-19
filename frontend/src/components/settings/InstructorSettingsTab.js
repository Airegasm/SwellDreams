import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import './SettingsTabs.css';

// Generate a lightweight client-side id for new term rows (server keeps its own group ids).
const termId = () => `t-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function InstructorSettingsTab() {
  const { api } = useApp();
  const { showError, showSuccess } = useError();

  // --- Instructor Profiles ---
  const [profiles, setProfiles] = useState([]);
  const [editingProfileId, setEditingProfileId] = useState(null); // id | 'new' | null
  const [profileForm, setProfileForm] = useState({ name: '', prompt: '' });

  // --- Instructor Library (term groups) ---
  const [groups, setGroups] = useState([]);
  const [editingGroupId, setEditingGroupId] = useState(null); // id | 'new' | null
  const [groupForm, setGroupForm] = useState({ name: '', terms: [] });

  const loadProfiles = useCallback(async () => {
    try {
      const data = await api.getInstructorProfiles();
      setProfiles(data?.profiles || []);
    } catch (e) {
      showError('Failed to load instructor profiles');
    }
  }, [api, showError]);

  const loadGroups = useCallback(async () => {
    try {
      const data = await api.getInstructorLibrary();
      setGroups(data?.groups || []);
    } catch (e) {
      showError('Failed to load instructor library');
    }
  }, [api, showError]);

  useEffect(() => {
    loadProfiles();
    loadGroups();
  }, [loadProfiles, loadGroups]);

  // ===== Profiles handlers =====
  const startNewProfile = () => {
    setProfileForm({ name: '', prompt: '' });
    setEditingProfileId('new');
  };

  const startEditProfile = (p) => {
    setProfileForm({ name: p.name || '', prompt: p.prompt || '' });
    setEditingProfileId(p.id);
  };

  const cancelProfile = () => {
    setEditingProfileId(null);
    setProfileForm({ name: '', prompt: '' });
  };

  const saveProfile = async () => {
    const name = profileForm.name.trim();
    if (!name) { showError('Profile name is required'); return; }
    try {
      if (editingProfileId === 'new') {
        await api.createInstructorProfile(name, profileForm.prompt);
      } else {
        await api.updateInstructorProfile(editingProfileId, name, profileForm.prompt);
      }
      await loadProfiles();
      showSuccess('Instructor profile saved');
      cancelProfile();
    } catch (e) {
      showError('Failed to save instructor profile');
    }
  };

  const deleteProfile = async (p) => {
    if (!window.confirm(`Delete instructor profile "${p.name}"?`)) return;
    try {
      await api.deleteInstructorProfile(p.id);
      await loadProfiles();
      showSuccess('Instructor profile deleted');
    } catch (e) {
      showError('Failed to delete instructor profile');
    }
  };

  // ===== Library handlers =====
  const startNewGroup = () => {
    setGroupForm({ name: '', terms: [] });
    setEditingGroupId('new');
  };

  const startEditGroup = (g) => {
    setGroupForm({
      name: g.name || '',
      terms: (g.terms || []).map(t => ({
        id: t.id || termId(),
        term: t.term || '',
        keys: Array.isArray(t.keys) ? t.keys.join(', ') : (t.keys || ''),
        definition: t.definition || '',
        caseSensitive: !!t.caseSensitive,
      })),
    });
    setEditingGroupId(g.id);
  };

  const cancelGroup = () => {
    setEditingGroupId(null);
    setGroupForm({ name: '', terms: [] });
  };

  const addTermRow = () => {
    setGroupForm(prev => ({
      ...prev,
      terms: [...prev.terms, { id: termId(), term: '', keys: '', definition: '', caseSensitive: false }],
    }));
  };

  const updateTermRow = (id, field, value) => {
    setGroupForm(prev => ({
      ...prev,
      terms: prev.terms.map(t => (t.id === id ? { ...t, [field]: value } : t)),
    }));
  };

  const removeTermRow = (id) => {
    setGroupForm(prev => ({ ...prev, terms: prev.terms.filter(t => t.id !== id) }));
  };

  const saveGroup = async () => {
    const name = groupForm.name.trim();
    if (!name) { showError('Term group name is required'); return; }
    // Normalize terms: drop empty rows, split keys CSV into an array.
    const terms = groupForm.terms
      .filter(t => t.term.trim() && t.definition.trim())
      .map(t => ({
        id: t.id,
        term: t.term.trim(),
        keys: t.keys.split(',').map(k => k.trim()).filter(Boolean),
        definition: t.definition.trim(),
        caseSensitive: !!t.caseSensitive,
      }));
    try {
      if (editingGroupId === 'new') {
        await api.createInstructorTermGroup(name, terms);
      } else {
        await api.updateInstructorTermGroup(editingGroupId, name, terms);
      }
      await loadGroups();
      showSuccess('Term group saved');
      cancelGroup();
    } catch (e) {
      showError('Failed to save term group');
    }
  };

  const deleteGroup = async (g) => {
    if (!window.confirm(`Delete term group "${g.name}"?`)) return;
    try {
      await api.deleteInstructorTermGroup(g.id);
      await loadGroups();
      showSuccess('Term group deleted');
    } catch (e) {
      showError('Failed to delete term group');
    }
  };

  return (
    <div className="instructor-settings">
      {/* ===== Instructor Profiles ===== */}
      <div className="settings-section">
        <div className="tab-header">
          <h3>Instructor Profiles</h3>
          <div className="tab-header-actions">
            <button className="btn btn-primary btn-sm" onClick={startNewProfile}>+ New Profile</button>
          </div>
        </div>
        <p className="text-muted">
          System-prompt briefs that tell an Instructor how to behave and perform. Assign one profile per Instructor card.
        </p>

        {editingProfileId && (
          <div className="card-style" style={{ padding: '16px', marginBottom: '16px' }}>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={profileForm.name}
                onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Clinical Handler"
              />
            </div>
            <div className="form-group">
              <label>System Prompt</label>
              <textarea
                rows={6}
                value={profileForm.prompt}
                onChange={(e) => setProfileForm(prev => ({ ...prev, prompt: e.target.value }))}
                placeholder="Describe how this instructor speaks and operates. Keep it direct and mission-focused."
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={cancelProfile}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveProfile}>Save Profile</button>
            </div>
          </div>
        )}

        {profiles.length === 0 && !editingProfileId ? (
          <p className="text-muted">No instructor profiles yet.</p>
        ) : (
          <div className="list">
            {profiles.map(p => (
              <div key={p.id} className="list-item card-style" style={{ alignItems: 'center' }}>
                <div className="card-info" style={{ flex: 1 }}>
                  <div className="list-item-name">{p.name}</div>
                  {p.prompt ? <div className="list-item-meta">{p.prompt.slice(0, 120)}{p.prompt.length > 120 ? '…' : ''}</div> : null}
                </div>
                <div className="list-item-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEditProfile(p)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteProfile(p)} disabled={p.builtIn}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Instructor Library ===== */}
      <div className="settings-section" style={{ marginTop: '28px' }}>
        <div className="tab-header">
          <h3>Instructor Library</h3>
          <div className="tab-header-actions">
            <button className="btn btn-primary btn-sm" onClick={startNewGroup}>+ New Term Group</button>
          </div>
        </div>
        <p className="text-muted">
          A dictionary of terms an Instructor should recognize. Each term's definition is injected only when the player uses
          that term (keyword-triggered). Assign one or more groups to an Instructor card.
        </p>

        {editingGroupId && (
          <div className="card-style" style={{ padding: '16px', marginBottom: '16px' }}>
            <div className="form-group">
              <label>Group Name</label>
              <input
                type="text"
                value={groupForm.name}
                onChange={(e) => setGroupForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Medical Terms"
              />
            </div>

            <label>Terms</label>
            {groupForm.terms.length === 0 && <p className="text-muted">No terms yet. Add one below.</p>}
            {groupForm.terms.map(t => (
              <div key={t.id} className="card-style" style={{ padding: '12px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 160px', marginBottom: '8px' }}>
                    <label>Term</label>
                    <input
                      type="text"
                      value={t.term}
                      onChange={(e) => updateTermRow(t.id, 'term', e.target.value)}
                      placeholder="valve"
                    />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 200px', marginBottom: '8px' }}>
                    <label>Extra keys (comma-separated, optional)</label>
                    <input
                      type="text"
                      value={t.keys}
                      onChange={(e) => updateTermRow(t.id, 'keys', e.target.value)}
                      placeholder="stopcock, shutoff"
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: '8px' }}>
                  <label>Definition</label>
                  <textarea
                    rows={2}
                    value={t.definition}
                    onChange={(e) => updateTermRow(t.id, 'definition', e.target.value)}
                    placeholder="What the instructor needs to know when the player says this term."
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={t.caseSensitive}
                      onChange={(e) => updateTermRow(t.id, 'caseSensitive', e.target.checked)}
                    />
                    Case sensitive
                  </label>
                  <button className="btn btn-sm btn-danger" onClick={() => removeTermRow(t.id)}>Remove</button>
                </div>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={addTermRow}>+ Add Term</button>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button className="btn btn-secondary btn-sm" onClick={cancelGroup}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveGroup}>Save Group</button>
            </div>
          </div>
        )}

        {groups.length === 0 && !editingGroupId ? (
          <p className="text-muted">No term groups yet.</p>
        ) : (
          <div className="list">
            {groups.map(g => (
              <div key={g.id} className="list-item card-style" style={{ alignItems: 'center' }}>
                <div className="card-info" style={{ flex: 1 }}>
                  <div className="list-item-name">{g.name}</div>
                  <div className="list-item-meta">{(g.terms || []).length} term{(g.terms || []).length === 1 ? '' : 's'}</div>
                </div>
                <div className="list-item-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => startEditGroup(g)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteGroup(g)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default InstructorSettingsTab;
