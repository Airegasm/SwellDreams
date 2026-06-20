import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import CheckpointProfiles from '../common/CheckpointProfiles';
import CardLoreSection from '../common/CardLoreSection';
import CollapsibleSection from '../common/CollapsibleSection';
import LoreEntryEditor from '../common/LoreEntryEditor';
import LibraryTreeSelect from '../common/LibraryTreeSelect';
import TriggerBlockComposer from '../common/TriggerBlockComposer';
import MediaCropModal from './MediaCropModal';
import './CharacterEditorModal.css';

/*
 * ============================================================================
 *  UnifiedCharacterEditor — Stage 3 (tab bodies filled)
 * ============================================================================
 *  One card to rule them all. Collapses the three legacy editors
 *  (CharacterEditorModal / MultiCharEditorModal / InstructorEditorModal) into a
 *  single "SwellD" card whose shape is driven by two flags already on the data
 *  model — `multiChar.enabled` (1 member = single, N = group) and
 *  `instructor.enabled` (Instructor Mode) — plus per-card Author's Note and a
 *  Character Versioning layer.
 *
 *  DATA MODEL (additions to the existing character):
 *    character.authorsNote          string   — per-card, seeded from the global default on create
 *    character.standardStash        object   — snapshot of Standard-mode fields, restored on un-Instructor
 *    character.instructorStash      object   — snapshot of Instructor-mode fields, restored on re-Instructor
 *    character.versions             [{ id, name, savedAt, config }]  — saved full-card snapshots
 *    character.activeVersionId      string
 *  Existing flags reused as MODE: character.instructor.enabled, character.multiChar.enabled/characters[]
 *
 *  NON-DESTRUCTIVE SWITCHOVER:
 *    Ticking Instructor Mode  → stash the Standard-only fields, restore prior instructor state.
 *    Unticking                → reverse: stash instructor fields, restore standardStash verbatim.
 *  So the card always round-trips to exactly the Standard state it left.
 * ============================================================================
 */

const GENDERS = ['', 'female', 'male', 'non-binary', 'androgynous', 'unspecified'];
const MEMBER_GENDERS = [
  { value: '', label: 'Unspecified (they/them)' },
  { value: 'male', label: 'Male (he/him)' },
  { value: 'female', label: 'Female (she/her)' },
  { value: 'nonbinary', label: 'Non-binary (they/them)' },
];

// Top-level standard-mode fields that must survive an Instructor round-trip.
// (Story-nested data is stashed separately as a whole-story snapshot — see stashStory.)
const STANDARD_KEYS = [
  'multiChar', 'authorsNote', 'libraryGroupIds', 'checkpointProfiles', 'defaultCheckpointProfileId',
  'description', 'personality', 'buttons', 'exampleDialogues', 'individualResponseTokens',
  'isPumpable', 'autoReplyEnabled', 'allowLlmDeviceAccess', 'globalReminders', 'constantReminders',
];
// Top-level instructor-mode fields.
const INSTRUCTOR_KEYS = [
  'instructorProfileId', 'instructorDisposition', 'instructorLibraryGroupIds', 'mission',
  'ignoreDictionary', 'ignoreTokenSwapping', 'gender', 'immutable',
];

const pick = (obj, keys) => keys.reduce((a, k) => (k in (obj || {}) ? (a[k] = obj[k], a) : a), {});

function UnifiedCharacterEditor({ isOpen, onClose, onSave, character, defaultAuthorsNote = '' }) {
  const { api, settings } = useApp();
  const [activeTab, setActiveTab] = useState('main');
  const [formData, setFormData] = useState(() => buildInitial(character, defaultAuthorsNote));

  // Assignables for the Instructor Settings tab.
  const [profiles, setProfiles] = useState([]);
  const [groups, setGroups] = useState([]);

  // Custom Buttons editor state (ported from CharacterEditorModal).
  const [devices, setDevices] = useState([]);
  const [flows, setFlows] = useState([]);
  const [triggerSets, setTriggerSets] = useState([]);
  const [showButtonForm, setShowButtonForm] = useState(false);
  const [editingButtonId, setEditingButtonId] = useState(null);
  const [buttonForm, setButtonForm] = useState({ name: '', buttonId: null, actions: [], enabled: true });

  // Instructor Card Library entry editor state (ported from InstructorEditorModal).
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState(null);
  const emptyReminderForm = () => ({ name: '', text: '', target: 'character', keys: [], secondaryKeys: [], logic: 'and_any', probability: 100, group: '', recurse: true, caseSensitive: false, priority: 100, scanDepth: 10 });
  const [reminderForm, setReminderForm] = useState(emptyReminderForm());

  // Member portrait crop.
  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const cropTargetRef = useRef(null); // member index whose portrait is being cropped
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(0);

  useEffect(() => { if (isOpen) { setFormData(buildInitial(character, defaultAuthorsNote)); setActiveTab('main'); setSelectedMemberIndex(0); } }, [isOpen, character, defaultAuthorsNote]);

  useEffect(() => {
    if (!isOpen) return;
    Promise.all([api.getInstructorProfiles?.(), api.getInstructorLibrary?.(), api.getTriggerSets?.()])
      .then(([p, g, ts]) => {
        setProfiles(p?.profiles || []);
        setGroups(g?.groups || []);
        setTriggerSets(Array.isArray(ts) ? ts : (ts?.triggerSets || []));
      })
      .catch(() => {});
    api.getDevices?.().then(d => setDevices(Array.isArray(d) ? d : [])).catch(() => {});
    api.getFlows?.().then(f => setFlows(Array.isArray(f) ? f : (f?.flows || []))).catch(() => {});
  }, [isOpen, api]);

  const isInstructorMode = !!formData?.instructor?.enabled;
  const members = formData?.multiChar?.characters || [];
  const isGroup = !!formData?.multiChar?.enabled && members.length > 1;

  const set = useCallback((patch) => setFormData(prev => ({ ...prev, ...patch })), []);

  const activeStory = formData.stories?.find(s => s.id === formData.activeStoryId) || formData.stories?.[0];
  const updateStoryField = (field, value) => setFormData(prev => ({
    ...prev,
    stories: (prev.stories || []).map(s => (s.id === activeStory?.id ? { ...s, [field]: value } : s)),
  }));

  // ---- Instructor Mode toggle: non-destructive stash/restore ----
  // Story-nested data lives on the active story; we snapshot the whole story object
  // (not fake "story.x" dot-paths) so prereqs/preFill/treeRefs/checkpoints survive.
  const toggleInstructorMode = (on) => {
    setFormData(prev => {
      const activeId = prev.activeStoryId || prev.stories?.[0]?.id;
      const curStory = (prev.stories || []).find(s => s.id === activeId) || prev.stories?.[0] || null;
      if (on) {
        // Entering instructor mode: snapshot the standard top-level fields + the active story.
        const standardStash = { ...pick(prev, STANDARD_KEYS), __story: curStory };
        const restored = prev.instructorStash || { mission: prev.mission || '', instructorDisposition: 'knowledgeable' };
        const restoredStory = prev.instructorStash?.__story;
        const stories = restoredStory
          ? (prev.stories || []).map(s => (s.id === activeId ? restoredStory : s))
          : prev.stories;
        const { __story: _is, ...restoredTop } = restored;
        return {
          ...prev,
          ...restoredTop,
          stories,
          instructor: { ...(prev.instructor || {}), enabled: true },
          multiChar: { enabled: false, characters: [] }, // instructors are single-voice; members hidden, not lost (in stash)
          standardStash,
        };
      }
      // Leaving instructor mode: snapshot the instructor top-level fields + active story; restore the exact standard state.
      const instructorStash = { ...pick(prev, INSTRUCTOR_KEYS), __story: curStory };
      const restored = prev.standardStash || {};
      const { __story: restoredStory, ...restoredTop } = restored;
      const stories = restoredStory
        ? (prev.stories || []).map(s => (s.id === activeId ? restoredStory : s))
        : prev.stories;
      return {
        ...prev,
        ...restoredTop,
        stories,
        instructor: { ...(prev.instructor || {}), enabled: false },
        instructorStash,
      };
    });
  };

  // ---- Members (standard → group) ----
  const setMembers = (next) => setFormData(prev => ({
    ...prev,
    multiChar: { ...(prev.multiChar || {}), enabled: next.length > 1, characters: next },
  }));
  const addMember = () => {
    const next = [...members, { id: `m-${Date.now()}`, name: '' }];
    setMembers(next);
    setSelectedMemberIndex(next.length - 1);
  };
  const updateMember = (i, patch) => setMembers(members.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const removeMember = (i) => {
    const next = members.filter((_, idx) => idx !== i);
    setMembers(next);
    setSelectedMemberIndex(Math.max(0, Math.min(selectedMemberIndex, next.length - 1)));
  };

  // Import an existing single-card as a new member (identity + persona prose + example dialogues).
  const importCard = async () => {
    let list = [];
    try {
      const res = await api.getCharacters?.();
      list = Array.isArray(res) ? res : (res?.characters || []);
    } catch (e) { /* non-fatal */ }
    const singles = (list || []).filter(c => c.id !== formData.id && !c.multiChar?.enabled && !c.instructor?.enabled);
    if (!singles.length) { alert('No single-character cards available to import.'); return; }
    const name = window.prompt(`Import which card as a member?\n\n${singles.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}\n\nEnter a number:`);
    const idx = parseInt(name, 10) - 1;
    const src = singles[idx];
    if (!src) return;
    const srcStory = src.stories?.find(s => s.id === src.activeStoryId) || src.stories?.[0];
    const newMember = {
      id: `m-${Date.now()}`,
      name: src.name || '',
      description: src.description || '',
      personality: src.personality || '',
      gender: src.gender || '',
      portrait: src.avatar || '',
      exampleDialogues: (srcStory?.exampleDialogues || src.exampleDialogues || []).map(e => ({ user: e.user || '', character: e.character || '' })),
    };
    const next = [...members, newMember];
    setMembers(next);
    setSelectedMemberIndex(next.length - 1);
  };

  // Extract a member into its own standalone single-character card.
  const saveMemberAsCard = async (i) => {
    const m = members[i];
    if (!m) return;
    if (!m.name?.trim()) { alert('Give the member a name first.'); return; }
    const card = {
      name: m.name.trim(),
      avatar: m.portrait || '',
      gender: m.gender || '',
      description: m.description || '',
      personality: m.personality || '',
      multiChar: { enabled: false, characters: [] },
      instructor: { enabled: false },
      stories: [{ id: 'story-1', name: 'Story', exampleDialogues: m.exampleDialogues || [], checkpointProfiles: [] }],
      activeStoryId: 'story-1',
    };
    try {
      await api.createCharacter?.(card);
      alert(`Saved "${m.name}" as its own card.`);
    } catch (e) {
      alert('Could not save member as card: ' + (e?.message || 'unknown error'));
    }
  };

  const handleMemberPortrait = (i, file) => {
    if (!file || !file.type.startsWith('image/')) { alert('Please upload an image file'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { cropTargetRef.current = i; setUploadedImage(ev.target.result); setShowCropModal(true); };
    reader.readAsDataURL(file);
  };
  const handleCropSave = (cropped) => {
    const i = cropTargetRef.current;
    if (i != null) updateMember(i, { portrait: cropped });
    setShowCropModal(false); setUploadedImage(null); cropTargetRef.current = null;
  };

  // ---- Instructor Card Library entries (constantReminders/globalReminders) ----
  const ownEntries = formData.globalReminders || formData.constantReminders || [];
  const setOwnEntries = (next) => setFormData(prev => ({ ...prev, globalReminders: next, constantReminders: next }));
  const handleAddReminder = () => { setEditingReminderId(null); setReminderForm(emptyReminderForm()); setShowReminderForm(true); };
  const handleEditReminder = (r) => {
    setEditingReminderId(r.id);
    setReminderForm({
      name: r.name, text: r.text, target: r.target || 'character', keys: r.keys || [], secondaryKeys: r.secondaryKeys || [],
      logic: r.logic || 'and_any', probability: r.probability == null ? 100 : r.probability, group: r.group || '',
      recurse: r.recurse !== false, caseSensitive: r.caseSensitive || false,
      priority: r.priority !== undefined ? r.priority : 100, scanDepth: r.scanDepth !== undefined ? r.scanDepth : 10,
    });
    setShowReminderForm(true);
  };
  const handleDeleteReminder = (id) => { if (window.confirm('Delete this entry?')) setOwnEntries(ownEntries.filter(r => r.id !== id)); };
  const handleToggleReminder = (id, enabled) => setOwnEntries(ownEntries.map(r => (r.id === id ? { ...r, enabled } : r)));
  const handleSaveReminder = () => {
    if (!reminderForm.name.trim() || !reminderForm.text.trim()) { alert('Title and content are required'); return; }
    const keys = reminderForm.keys || [];
    const fields = {
      name: reminderForm.name, text: reminderForm.text, target: reminderForm.target, keys,
      secondaryKeys: reminderForm.secondaryKeys || [], logic: reminderForm.logic || 'and_any',
      probability: reminderForm.probability === '' || reminderForm.probability == null ? 100 : Number(reminderForm.probability),
      group: (reminderForm.group || '').trim(), recurse: reminderForm.recurse !== false,
      caseSensitive: reminderForm.caseSensitive || false,
      priority: reminderForm.priority !== undefined ? reminderForm.priority : 100,
      scanDepth: reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10,
      constant: keys.length === 0,
    };
    if (editingReminderId) setOwnEntries(ownEntries.map(r => (r.id === editingReminderId ? { ...r, ...fields } : r)));
    else setOwnEntries([...ownEntries, { id: `reminder-${Date.now()}`, enabled: true, ...fields }]);
    setShowReminderForm(false); setEditingReminderId(null); setReminderForm(emptyReminderForm());
  };
  const handleCancelReminderEdit = () => { setShowReminderForm(false); setEditingReminderId(null); setReminderForm(emptyReminderForm()); };

  const toggleInstructorGroup = (id) => setFormData(prev => {
    const cur = prev.instructorLibraryGroupIds || [];
    const has = cur.includes(id);
    return { ...prev, instructorLibraryGroupIds: has ? cur.filter(g => g !== id) : [...cur, id] };
  });

  // ---- Custom Buttons editor (ported from CharacterEditorModal) ----
  const buttons = useMemo(() => formData.buttons || [], [formData.buttons]);
  const getNextButtonId = () => {
    const existingIds = buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
    return existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
  };
  const handleAddButton = () => { setEditingButtonId(null); setButtonForm({ name: '', buttonId: getNextButtonId(), actions: [], enabled: true }); setShowButtonForm(true); };
  const handleToggleButton = (buttonId, enabled) => setFormData(prev => ({ ...prev, buttons: (prev.buttons || []).map(b => (b.buttonId === buttonId ? { ...b, enabled } : b)) }));
  const handleEditButton = (button) => { setEditingButtonId(button.buttonId); setButtonForm(JSON.parse(JSON.stringify(button))); setShowButtonForm(true); };
  const handleDeleteButton = (buttonId) => { if (window.confirm('Delete this button?')) setFormData(prev => ({ ...prev, buttons: (prev.buttons || []).filter(b => b.buttonId !== buttonId) })); };
  const handleSaveButton = () => {
    if (!buttonForm.name.trim()) { alert('Button name is required'); return; }
    setFormData(prev => {
      const cur = prev.buttons || [];
      return editingButtonId !== null
        ? { ...prev, buttons: cur.map(b => (b.buttonId === editingButtonId ? buttonForm : b)) }
        : { ...prev, buttons: [...cur, buttonForm] };
    });
    setShowButtonForm(false); setEditingButtonId(null); setButtonForm({ name: '', buttonId: null, actions: [] });
  };
  const handleCancelButtonEdit = () => { setShowButtonForm(false); setEditingButtonId(null); setButtonForm({ name: '', buttonId: null, actions: [] }); };
  const handleAddAction = () => setButtonForm({ ...buttonForm, actions: [...buttonForm.actions, { type: 'message', config: {} }] });
  const handleUpdateAction = (index, field, value) => {
    const updated = [...buttonForm.actions];
    if (field === 'type') updated[index] = { type: value, config: {} };
    else { const cur = updated[index]; updated[index] = { ...cur, config: { ...(cur.config || {}), [field]: value } }; }
    setButtonForm({ ...buttonForm, actions: updated });
  };
  const handleDeleteAction = (index) => setButtonForm({ ...buttonForm, actions: buttonForm.actions.filter((_, i) => i !== index) });
  const handleMoveAction = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === buttonForm.actions.length - 1) return;
    const updated = [...buttonForm.actions];
    const ni = direction === 'up' ? index - 1 : index + 1;
    [updated[index], updated[ni]] = [updated[ni], updated[index]];
    setButtonForm({ ...buttonForm, actions: updated });
  };

  // ---- Persona-fy: one-way identity-only snapshot into a NEW persona ----
  const personafy = async () => {
    if (!formData.name?.trim()) { alert('Give the card a name first.'); return; }
    try {
      // name is REQUIRED by the backend validator; displayName mirrors it. Identity-only —
      // do NOT forward personality/mission/exampleDialogues or any AI fields into the persona.
      await api.createPersona({
        name: formData.name,
        displayName: formData.name,
        avatar: formData.avatar || '',
        appearance: formData.description || '',
      });
      alert(`Created a new persona "${formData.name}" (identity snapshot).\nNote: the character description was copied verbatim into the persona's appearance and may need trimming.`);
    } catch (e) {
      alert('Could not create persona: ' + (e?.message || 'unknown error'));
    }
  };

  // ---- Versioning CRUD (saved full-card snapshots) ----
  const versions = formData.versions || [];
  const saveVersion = () => {
    const id = `v-${Date.now()}`;
    const { versions: _v, activeVersionId: _a, ...config } = formData;
    set({ versions: [...versions, { id, name: `Version ${versions.length + 1}`, savedAt: Date.now(), config }], activeVersionId: id });
  };
  const loadVersion = (id) => {
    const v = versions.find(x => x.id === id);
    if (v) setFormData(prev => ({ ...v.config, versions: prev.versions, activeVersionId: id }));
  };
  const deleteVersion = (id) => set({ versions: versions.filter(v => v.id !== id) });

  const handleSave = () => onSave?.(formData);

  // Tabs depend on mode (the "face" change). Standard and Instructor get SEPARATE Library/Checkpoint tabs.
  const tabs = useMemo(() => ([
    { id: 'main', label: 'Main' },
    ...(isInstructorMode ? [] : [{ id: 'members', label: isGroup ? 'Members' : 'Member' }]),
    { id: 'checkpoints', label: 'Checkpoints' },
    { id: 'library', label: 'Library' },
    ...(isInstructorMode ? [{ id: 'instructor', label: 'Instructor Settings' }] : []),
    { id: 'events', label: 'Custom Buttons' },
  ]), [isInstructorMode, isGroup]);

  if (!isOpen) return null;
  const member = members[selectedMemberIndex] || members[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal character-editor-modal" onClick={(e) => e.stopPropagation()}>
        {/* ---- Header: name + Instructor Mode + Version CRUD ---- */}
        <div className="character-modal-header">
          <h3>{character ? 'Edit Character' : 'New Character'} <span className="section-hint">(SwellD unified)</span></h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="character-modal-subbar" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 16px' }}>
          <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
            <input type="checkbox" checked={isInstructorMode} onChange={(e) => toggleInstructorMode(e.target.checked)} />
            Instructor Mode
          </label>
          <div style={{ flex: 1 }} />
          <div className="checkpoint-profile-bar" style={{ margin: 0 }}>
            <span className="section-hint">Version:</span>
            <select value={formData.activeVersionId || ''} onChange={(e) => loadVersion(e.target.value)}>
              <option value="">(current — unsaved)</option>
              {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-secondary" onClick={saveVersion}>Save as Version</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => formData.activeVersionId && deleteVersion(formData.activeVersionId)} disabled={!formData.activeVersionId}>Delete</button>
          </div>
        </div>

        {/* ---- Tabs ---- */}
        <div className="modal-tabs character-modal-tabs">
          {tabs.map(t => (
            <button key={t.id} type="button" className={`modal-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {/* ---- Main tab (face changes by mode) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'main' ? 'block' : 'none' }}>
          <div className="form-group">
            <label>Name *</label>
            <input type="text" value={formData.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="Character name" />
          </div>

          {isInstructorMode ? (
            <div className="form-group">
              <label>Mission (instructor prompt)</label>
              <textarea value={formData.mission || ''} onChange={(e) => set({ mission: e.target.value })} rows={3}
                placeholder="The objective this instructor drives toward." />
              <p className="section-hint">In Instructor Mode the Author's Note is swapped for the instructor prompt; invalid standard parameters are hidden.</p>
            </div>
          ) : (
            <div className="form-group">
              <label>Author's Note <span className="section-hint">(per-card; seeded from the global default)</span></label>
              <textarea value={formData.authorsNote ?? ''} onChange={(e) => set({ authorsNote: e.target.value })} rows={3}
                placeholder="Injected near the end of context. Lives on the card now, not in Settings." />
            </div>
          )}

          <div className="form-group">
            <button type="button" className="btn btn-sm btn-secondary" onClick={personafy}>Persona-fy</button>
            <p className="section-hint">Snapshot this card's identity (name + avatar + description) into a new, independent Persona. One-way — no live link.</p>
          </div>
        </div>

        {/* ---- Members tab (standard → group; hidden in instructor mode) ---- */}
        {!isInstructorMode && (
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'members' ? 'block' : 'none' }}>
            <p className="section-hint">This card's characters. One member = single card; add more to make it a group. The <strong>Base</strong> (first) member owns the scenario, story, checkpoints, and Author's Note; added members expose only their per-character fields.</p>

            <div className="form-group">
              <label>Members</label>
              <div className="multi-char-names">
                {members.map((m, i) => (
                  <div key={m.id || i} className="multi-char-name-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="multi-char-label">{i === 0 ? 'Base' : `Char ${i + 1}`}</span>
                    <input type="text" value={m.name || ''} placeholder={i === 0 ? 'Base character' : `Member ${i + 1}`}
                      onChange={(e) => updateMember(i, { name: e.target.value })} style={{ flex: 1 }} />
                    {i > 0 && <button type="button" className="btn-icon btn-delete-small" onClick={() => removeMember(i)} title="Remove member">X</button>}
                    {i > 0 && <button type="button" className="btn btn-sm btn-secondary" onClick={() => saveMemberAsCard(i)}>Save as own card</button>}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={addMember}>+ Add Character</button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={importCard}>Import SwellD card…</button>
                </div>
              </div>
            </div>

            {/* Per-member fields, selected via dropdown */}
            <div className="form-group">
              <label>Edit member</label>
              <select className="multi-char-selector" value={selectedMemberIndex} onChange={(e) => setSelectedMemberIndex(parseInt(e.target.value, 10))}>
                {members.map((m, i) => <option key={m.id || i} value={i}>{m.name || (i === 0 ? 'Base character' : `Character ${i + 1}`)}</option>)}
              </select>
            </div>

            {member && (
              <>
                <div className="form-group" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: '0 0 auto' }}>
                    <label>Gender</label>
                    <select value={member.gender || ''} onChange={(e) => updateMember(selectedMemberIndex, { gender: e.target.value })}>
                      {MEMBER_GENDERS.map(g => <option key={g.value || 'none'} value={g.value}>{g.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Portrait</label>
                    <input type="file" accept="image/*" onChange={(e) => { handleMemberPortrait(selectedMemberIndex, e.target.files?.[0]); e.target.value = ''; }} />
                    {member.portrait && <img src={member.portrait} alt="portrait" style={{ height: 48, marginTop: 4, borderRadius: 4 }} />}
                  </div>
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea value={member.description || ''} onChange={(e) => updateMember(selectedMemberIndex, { description: e.target.value })}
                    placeholder={`Description for ${member.name || 'this character'}…`} />
                </div>
                <div className="form-group">
                  <label>Personality</label>
                  <textarea value={member.personality || ''} onChange={(e) => updateMember(selectedMemberIndex, { personality: e.target.value })}
                    placeholder={`Personality traits for ${member.name || 'this character'}…`} />
                </div>

                <div className="form-group">
                  <label>Example Dialogues <span className="section-hint">(this member's voice)</span></label>
                  {(member.exampleDialogues || []).map((d, i) => {
                    const list = member.exampleDialogues || [];
                    const upd = (patch) => updateMember(selectedMemberIndex, { exampleDialogues: list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) });
                    const rm = () => updateMember(selectedMemberIndex, { exampleDialogues: list.filter((_, idx) => idx !== i) });
                    return (
                      <div key={i} className="instr-example-row">
                        <input type="text" value={d.user || ''} onChange={(e) => upd({ user: e.target.value })} placeholder="Player says…" />
                        <input type="text" value={d.character || ''} onChange={(e) => upd({ character: e.target.value })} placeholder="Character responds…" />
                        <button type="button" className="prereq-del-sm" onClick={rm} title="Remove">×</button>
                      </div>
                    );
                  })}
                  <button type="button" className="prereq-add-sm" onClick={() => updateMember(selectedMemberIndex, { exampleDialogues: [...(member.exampleDialogues || []), { user: '', character: '' }] })}>+ Example</button>
                </div>
              </>
            )}

            <div className="form-group">
              <label>Individual Response Tokens</label>
              <input type="text" inputMode="numeric" value={formData.individualResponseTokens ?? ''}
                onChange={(e) => set({ individualResponseTokens: e.target.value.replace(/[^0-9]/g, '') })} placeholder="150" style={{ maxWidth: 220 }} />
              <p className="section-hint">Max tokens per individual reply when members respond one at a time. One value for the whole card. Default 150.</p>
            </div>
          </div>
        )}

        {/* ---- Checkpoints (shared component; instructor vs standard data kept separate via the stash) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'checkpoints' ? 'block' : 'none' }}>
          {activeStory
            ? <CheckpointProfiles story={activeStory} updateStory={updateStoryField} defaultPumpType={formData.defaultPumpType}
                cardName={formData.name || 'card'} triggerSets={triggerSets} rowProps={{ isPumpable: !!formData.isPumpable }} />
            : <p className="section-hint">No story yet.</p>}
        </div>

        {/* ---- Library (shared component; separate instructor/standard groups via the stash) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'library' ? 'block' : 'none' }}>
          {activeStory ? <CardLoreSection activeStory={activeStory} updateStoryField={updateStoryField} /> : <p className="section-hint">No story yet.</p>}
        </div>

        {/* ---- Instructor Settings (own tab; instructor mode only) ---- */}
        {isInstructorMode && (
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'instructor' ? 'block' : 'none' }}>
            <div className="form-group">
              <label>Gender</label>
              <select value={formData.gender || ''} onChange={(e) => set({ gender: e.target.value })}>
                {GENDERS.map(g => <option key={g || 'none'} value={g}>{g ? g.charAt(0).toUpperCase() + g.slice(1) : '— Unspecified —'}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Mission</label>
              <textarea rows={3} value={formData.mission || ''} onChange={(e) => set({ mission: e.target.value })}
                placeholder="The objective this instructor is driving toward. Stated plainly." />
            </div>

            <div className="form-group">
              <label>Instructor Profile</label>
              <select value={formData.instructorProfileId || ''} onChange={(e) => set({ instructorProfileId: e.target.value })}>
                <option value="">— None —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="section-hint">Defines how the instructor behaves and performs. Manage profiles in the Instructor Settings page.</p>
            </div>

            <div className="form-group">
              <label>Disposition toward the player</label>
              <select value={formData.instructorDisposition || 'knowledgeable'} onChange={(e) => set({ instructorDisposition: e.target.value })}>
                <option value="knowledgeable">Knowledgeable — a true expert; technically precise and fully in control</option>
                <option value="sadistic">Sadistic — deliberately pushes limits and takes pleasure in the player's discomfort</option>
                <option value="careful">Careful — safety-first; paces cautiously and checks in often</option>
                <option value="scientific">Scientific — clinical and detached; runs the session like an experiment</option>
              </select>
              <p className="section-hint">Shapes how this instructor approaches inflating the player.</p>
            </div>

            <div className="form-group">
              <label>Library Term Groups</label>
              {groups.length === 0 ? (
                <p className="section-hint">No term groups yet. Create them in the Instructor Settings page.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {groups.map(g => (
                    <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={(formData.instructorLibraryGroupIds || []).includes(g.id)} onChange={() => toggleInstructorGroup(g.id)} />
                      <span>{g.name} <span className="text-muted">({(g.terms || []).length} terms)</span></span>
                    </label>
                  ))}
                </div>
              )}
              <p className="section-hint">Assigned terms are injected only when the player uses them (keyword-triggered).</p>
            </div>

            <div className="form-group">
              <label>Card Library <span className="text-muted">— this instructor's own entries</span></label>
              {!showReminderForm ? (
                <>
                  {ownEntries.length === 0 ? (
                    <p className="section-hint">No entries yet. Same lorebook format as the Dictionary — blank keywords = always-on.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {ownEntries.map(r => (
                        <div key={r.id} className="reminder-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input type="checkbox" checked={r.enabled !== false} onChange={(e) => handleToggleReminder(r.id, e.target.checked)} title="Enabled" />
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.name || '(untitled)'} <span className="text-muted">· {(r.keys?.length || 0) === 0 ? 'always-on' : `${r.keys.length} keys`}</span>
                          </span>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleEditReminder(r)}>Edit</button>
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteReminder(r.id)}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: 6 }} onClick={handleAddReminder}>+ Add Entry</button>
                </>
              ) : (
                <div className="event-form">
                  <h4>{editingReminderId ? 'Edit' : 'Add'} Library Entry</h4>
                  <LoreEntryEditor
                    entry={{ ...reminderForm, title: reminderForm.name, content: reminderForm.text }}
                    onChange={(c) => setReminderForm({ ...reminderForm, ...c, name: c.title, text: c.content })}
                  />
                  <div className="event-form-buttons" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" className="btn btn-secondary" onClick={handleCancelReminderEdit}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={handleSaveReminder}>{editingReminderId ? 'Update' : 'Create'}</button>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group instr-toggles">
              <label>Options</label>
              <label className="instr-toggle">
                <input type="checkbox" checked={!!formData.ignoreDictionary} onChange={(e) => set({ ignoreDictionary: e.target.checked })} />
                <span>Ignore main Dictionary <span className="instr-toggle-hint">— use card Library only</span></span>
              </label>
              <label className="instr-toggle">
                <input type="checkbox" checked={!!formData.ignoreTokenSwapping} onChange={(e) => set({ ignoreTokenSwapping: e.target.checked })} />
                <span>Ignore token swapping <span className="instr-toggle-hint">— skip global word-replacement rules</span></span>
              </label>
            </div>

            {/* Initial Setup Variables — story-nested (prereqInitVars). */}
            <CollapsibleSection title="Initial Setup Variables" subtitle="Flow/system vars seeded once at session start" badge={(activeStory?.prereqInitVars || []).length || ''}>
              <p className="section-hint">Reference them anywhere with [Flow:Name]. System: only <strong>capacity</strong> is settable.</p>
              {(activeStory?.prereqInitVars || []).map((v, i) => {
                const list = activeStory?.prereqInitVars || [];
                const upd = (patch) => updateStoryField('prereqInitVars', list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
                const rm = () => updateStoryField('prereqInitVars', list.filter((_, idx) => idx !== i));
                return (
                  <div className="prereq-initvar-row" key={v.id || i}>
                    <select value={v.varType || 'custom'} onChange={(e) => upd({ varType: e.target.value })} title="Variable type">
                      <option value="custom">Flow</option>
                      <option value="system">System</option>
                    </select>
                    <input type="text" value={v.variable || ''} onChange={(e) => upd({ variable: e.target.value })} placeholder={v.varType === 'system' ? 'capacity' : 'variable'} />
                    <select value={v.operation || 'set'} onChange={(e) => upd({ operation: e.target.value })}>
                      <option value="set">Set</option><option value="inc">+</option><option value="dec">−</option><option value="mult">×</option><option value="div">÷</option>
                    </select>
                    <input type="text" value={v.value || ''} onChange={(e) => upd({ value: e.target.value })} placeholder="value" />
                    <button type="button" className="prereq-del-sm" onClick={rm} title="Remove">×</button>
                  </div>
                );
              })}
              <button type="button" className="prereq-add-sm" onClick={() => updateStoryField('prereqInitVars', [...(activeStory?.prereqInitVars || []), { id: `iv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, varType: 'custom', variable: '', operation: 'set', value: '' }])}>+ Setup Variable</button>
            </CollapsibleSection>
          </div>
        )}

        {/* ---- Custom Buttons (shared events/buttons editor) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'events' ? 'block' : 'none' }}>
          <div className="events-editor">
            {!showButtonForm ? (
              <>
                <div className="events-header">
                  <h4>Custom Buttons</h4>
                  <div className="events-header-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleAddButton} disabled={buttons.length >= 12}>+ Add Button</button>
                    {buttons.length >= 12 && <span className="limit-warning">Maximum 12 buttons</span>}
                  </div>
                </div>
                <p className="section-hint">Create buttons here, then assign them to specific stories.</p>
                <div className="events-list-editor">
                  {buttons.length === 0 ? (
                    <p className="empty-message">No buttons yet.</p>
                  ) : (
                    buttons.map((button) => (
                      <div key={button.buttonId} className={`event-item ${button.enabled === false ? 'disabled' : ''} ${button.autoGenerated ? 'auto-generated' : ''}`}>
                        <label className="toggle-switch">
                          <input type="checkbox" checked={button.enabled !== false} onChange={(e) => handleToggleButton(button.buttonId, e.target.checked)} />
                          <span className="toggle-slider"></span>
                        </label>
                        <div className="event-info">
                          <div className={`event-name ${button.enabled === false ? 'strikethrough' : ''}`}>
                            {button.name} <span style={{ color: '#666' }}>#{button.buttonId}</span>
                            {button.autoGenerated && <span className="auto-badge">Auto</span>}
                          </div>
                          <div className="event-meta">{button.autoGenerated ? 'Linked to flow' : `${button.actions?.length || 0} action(s)`}</div>
                        </div>
                        <div className="event-actions">
                          {!button.autoGenerated ? (
                            <>
                              <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleEditButton(button)}>Edit</button>
                              <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteButton(button.buttonId)}>Delete</button>
                            </>
                          ) : (
                            <span className="auto-managed-hint">Managed by flow</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="event-form">
                <h4>{editingButtonId !== null ? `Edit Button #${editingButtonId}` : `New Button #${buttonForm.buttonId}`}</h4>
                <div className="form-group">
                  <label>Button Name *</label>
                  <input type="text" value={buttonForm.name} onChange={(e) => setButtonForm({ ...buttonForm, name: e.target.value })} placeholder="e.g., 'Quick Inflate'" />
                </div>
                <div className="form-group">
                  <div className="actions-header">
                    <label>Actions (execute in order)</label>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={handleAddAction}>+ Add Action</button>
                  </div>
                  <div className="actions-list">
                    {buttonForm.actions.length === 0 ? (
                      <p className="empty-message">No actions yet.</p>
                    ) : (
                      buttonForm.actions.map((action, index) => (
                        <div key={index} className="action-item">
                          <div className="action-reorder">
                            <button type="button" className="btn-icon-small" onClick={() => handleMoveAction(index, 'up')} disabled={index === 0}>▲</button>
                            <button type="button" className="btn-icon-small" onClick={() => handleMoveAction(index, 'down')} disabled={index === buttonForm.actions.length - 1}>▼</button>
                          </div>
                          <div className="action-config">
                            <select value={action.type} onChange={(e) => handleUpdateAction(index, 'type', e.target.value)}>
                              <option value="message">Send Message</option>
                              <option value="turn_on">Turn On Device</option>
                              <option value="cycle">Cycle Device</option>
                              <option value="link_to_flow">Link to Flow</option>
                              <option value="run_trigger_set">Run Trigger Set</option>
                              <option value="trigger_blocks">Trigger Blocks</option>
                              <option value="run_tree">Run Trigger Tree</option>
                            </select>
                            {action.type === 'message' && (
                              <textarea value={action.config.text || ''} onChange={(e) => handleUpdateAction(index, 'text', e.target.value)} placeholder="Instruction for AI..." rows={2} />
                            )}
                            {(action.type === 'turn_on' || action.type === 'cycle') && (
                              <select value={action.config.device || ''} onChange={(e) => handleUpdateAction(index, 'device', e.target.value)}>
                                <option value="">Select Device...</option>
                                <option value="primary_pump">Primary Pump</option>
                                {devices?.map(d => (
                                  <option key={d.ip || d.deviceId} value={d.brand === 'govee' ? `govee:${d.deviceId}` : d.brand === 'tuya' ? `tuya:${d.deviceId}` : d.childId ? `${d.ip}:${d.childId}` : d.ip}>
                                    {d.name || d.alias || d.ip || d.deviceId}
                                  </option>
                                ))}
                              </select>
                            )}
                            {action.type === 'cycle' && (
                              <div className="cycle-inputs">
                                <input type="number" value={action.config.duration || 5} onChange={(e) => handleUpdateAction(index, 'duration', parseInt(e.target.value))} placeholder="Duration (s)" min="1" />
                                <input type="number" value={action.config.interval || 2} onChange={(e) => handleUpdateAction(index, 'interval', parseInt(e.target.value))} placeholder="Interval (s)" min="1" />
                              </div>
                            )}
                            {action.type === 'link_to_flow' && (
                              <select value={action.config.flowId || ''} onChange={(e) => handleUpdateAction(index, 'flowId', e.target.value)}>
                                <option value="">Select Flow...</option>
                                {flows?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                            )}
                            {action.type === 'run_trigger_set' && (
                              <select value={action.config.triggerSetId || ''} onChange={(e) => handleUpdateAction(index, 'triggerSetId', e.target.value)}>
                                <option value="">Select Trigger Set...</option>
                                {triggerSets.map(ts => <option key={ts.id} value={ts.id}>{ts.name}</option>)}
                              </select>
                            )}
                            {action.type === 'run_tree' && (
                              <LibraryTreeSelect value={action.config.treeId} onChange={(treeId) => handleUpdateAction(index, 'treeId', treeId)} />
                            )}
                            {action.type === 'trigger_blocks' && (
                              <TriggerBlockComposer value={action.config.blocks || []} onChange={(v) => handleUpdateAction(index, 'blocks', v)} triggerSets={triggerSets} />
                            )}
                          </div>
                          <button type="button" className="btn-icon-small" onClick={() => handleDeleteAction(index)} title="Delete">🗑️</button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="event-form-buttons">
                  <button type="button" className="btn btn-secondary" onClick={handleCancelButtonEdit}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleSaveButton}>{editingButtonId !== null ? 'Update' : 'Create'}</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="character-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      {showCropModal && (
        <MediaCropModal
          image={uploadedImage}
          orientation="portrait"
          onSave={handleCropSave}
          onCancel={() => { setShowCropModal(false); setUploadedImage(null); cropTargetRef.current = null; }}
        />
      )}
    </div>
  );
}

// Seed a unified card from an existing character (any legacy type) or a blank one.
// CRITICAL: spread the source FIRST so no top-level field is dropped on load — the
// explicit keys below only fill DEFAULTS for absent fields. formData is then a true
// superset of the card and the load/save round-trip is loss-free.
function buildInitial(character, defaultAuthorsNote) {
  const c = character || {};
  return {
    ...c,
    id: c.id,
    name: c.name || '',
    avatar: c.avatar || '',
    instructor: c.instructor || { enabled: false },
    multiChar: c.multiChar || { enabled: false, characters: [{ id: `m-${Date.now()}`, name: c.name || '' }] },
    // Author's Note migrates onto the card; legacy cards seed from the global default.
    authorsNote: c.authorsNote ?? defaultAuthorsNote ?? '',
    mission: c.mission || '',
    instructorProfileId: c.instructorProfileId || '',
    instructorDisposition: c.instructorDisposition || 'knowledgeable',
    instructorLibraryGroupIds: c.instructorLibraryGroupIds || [],
    isPumpable: c.isPumpable || false,
    defaultPumpType: c.defaultPumpType || 'electric',
    buttons: c.buttons || c.events || [],
    stories: c.stories || [{ id: 'story-1', name: 'Story', checkpointProfiles: [] }],
    activeStoryId: c.activeStoryId || c.stories?.[0]?.id || 'story-1',
    versions: c.versions || [],
    activeVersionId: c.activeVersionId || null,
    standardStash: c.standardStash || null,
    instructorStash: c.instructorStash || null,
  };
}

export default UnifiedCharacterEditor;
