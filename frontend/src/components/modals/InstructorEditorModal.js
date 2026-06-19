import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import TriggerRow from '../common/TriggerRow';
import MediaCropModal from './MediaCropModal';
import './CharacterEditorModal.css';

const CHECKPOINT_RANGES = [
  { key: '0', label: '0% — Pre-Inflation', hint: 'Requirements that must be met before inflation begins. The instructor will not activate the pump until these are satisfied.' },
  { key: '1-10', label: '1–10%' },
  { key: '11-20', label: '11–20%' },
  { key: '21-30', label: '21–30%' },
  { key: '31-40', label: '31–40%' },
  { key: '41-50', label: '41–50%' },
  { key: '51-60', label: '51–60%' },
  { key: '61-70', label: '61–70%' },
  { key: '71-80', label: '71–80%' },
  { key: '81-90', label: '81–90%' },
  { key: '91-100', label: '91–100%' },
  { key: '100+', label: '100%+ — Over-Inflation' },
];

const GENDERS = ['', 'female', 'male', 'non-binary', 'androgynous', 'unspecified'];

const newWelcomeId = () => `wm-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const newTriggerId = () => `trg-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function buildInitialData(character) {
  const story = character?.stories?.[0];
  const welcomeMessages = story?.welcomeMessages?.length
    ? story.welcomeMessages
    : (character?.welcomeMessages?.length ? character.welcomeMessages : [{ id: newWelcomeId(), text: '', llmEnhanced: false }]);
  return {
    name: character?.name || '',
    gender: character?.gender || '',
    mission: character?.mission || '',
    avatar: character?.avatar || '',
    instructorProfileId: character?.instructorProfileId || '',
    instructorLibraryGroupIds: character?.instructorLibraryGroupIds || [],
    story: {
      id: story?.id || 'story-1',
      name: story?.name || 'Mission',
      welcomeMessages,
      activeWelcomeMessageId: story?.activeWelcomeMessageId || welcomeMessages[0]?.id,
      checkpoints: story?.checkpoints || {},
      checkpointTriggers: story?.checkpointTriggers || {},
      allowLlmDeviceAccess: story?.allowLlmDeviceAccess ?? character?.allowLlmDeviceAccess ?? false,
    },
  };
}

function InstructorEditorModal({ isOpen, onClose, onSave, character }) {
  const { api } = useApp();
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState(() => buildInitialData(character));
  const [profiles, setProfiles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [visibleCheckpoints, setVisibleCheckpoints] = useState({});
  const fileInputRef = useRef(null);

  // Re-seed form whenever the modal is (re)opened for a different card.
  useEffect(() => {
    if (isOpen) {
      setFormData(buildInitialData(character));
      setActiveTab('basic');
    }
  }, [isOpen, character]);

  const loadAssignables = useCallback(async () => {
    try {
      const [p, g] = await Promise.all([api.getInstructorProfiles(), api.getInstructorLibrary()]);
      setProfiles(p?.profiles || []);
      setGroups(g?.groups || []);
    } catch (e) {
      // Non-fatal; dropdowns just stay empty.
    }
  }, [api]);

  useEffect(() => {
    if (isOpen) loadAssignables();
  }, [isOpen, loadAssignables]);

  if (!isOpen) return null;

  const updateStory = (field, value) => {
    setFormData(prev => ({ ...prev, story: { ...prev.story, [field]: value } }));
  };

  // ---- Avatar ----
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please upload an image file'); return; }
    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedImage(event.target.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropSave = (croppedImageData) => {
    setFormData(prev => ({ ...prev, avatar: croppedImageData }));
    setShowCropModal(false);
    setUploadedImage(null);
  };

  // ---- Library group multi-select ----
  const toggleGroup = (id) => {
    setFormData(prev => {
      const has = prev.instructorLibraryGroupIds.includes(id);
      return {
        ...prev,
        instructorLibraryGroupIds: has
          ? prev.instructorLibraryGroupIds.filter(g => g !== id)
          : [...prev.instructorLibraryGroupIds, id],
      };
    });
  };

  // ---- Welcome messages ----
  const updateWelcome = (id, text) => {
    updateStory('welcomeMessages', formData.story.welcomeMessages.map(w => (w.id === id ? { ...w, text } : w)));
  };
  const addWelcome = () => {
    const w = { id: newWelcomeId(), text: '', llmEnhanced: false };
    updateStory('welcomeMessages', [...formData.story.welcomeMessages, w]);
  };
  const removeWelcome = (id) => {
    const remaining = formData.story.welcomeMessages.filter(w => w.id !== id);
    setFormData(prev => ({
      ...prev,
      story: {
        ...prev.story,
        welcomeMessages: remaining,
        activeWelcomeMessageId: prev.story.activeWelcomeMessageId === id
          ? (remaining[0]?.id || null)
          : prev.story.activeWelcomeMessageId,
      },
    }));
  };

  // ---- Checkpoint triggers ----
  const triggersFor = (key) => formData.story.checkpointTriggers?.[`player-${key}`] || [];
  const setTriggers = (key, items) => {
    updateStory('checkpointTriggers', { ...(formData.story.checkpointTriggers || {}), [`player-${key}`]: items });
  };
  const addTrigger = (key) => setTriggers(key, [...triggersFor(key), { id: newTriggerId(), type: '', value: '' }]);
  const updateTrigger = (key, idx, updated) => {
    const items = [...triggersFor(key)]; items[idx] = updated; setTriggers(key, items);
  };
  const removeTrigger = (key, idx) => setTriggers(key, triggersFor(key).filter((_, i) => i !== idx));

  // ---- Save ----
  const handleSave = () => {
    if (!formData.name.trim()) { alert('Name is required'); return; }
    const story = { ...formData.story };
    const saveData = {
      ...(character || {}),
      instructor: { enabled: true },
      name: formData.name.trim(),
      gender: formData.gender,
      mission: formData.mission,
      avatar: formData.avatar,
      description: '',
      personality: '',
      instructorProfileId: formData.instructorProfileId,
      instructorLibraryGroupIds: formData.instructorLibraryGroupIds,
      allowLlmDeviceAccess: story.allowLlmDeviceAccess,
      stories: [story],
      activeStoryId: story.id,
    };
    onSave(saveData);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal character-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{character ? 'Edit Instructor' : 'New Instructor'}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-tabs character-modal-tabs">
          <button className={`modal-tab ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')}>Basic</button>
          <button className={`modal-tab ${activeTab === 'welcome' ? 'active' : ''}`} onClick={() => setActiveTab('welcome')}>Welcome</button>
          <button className={`modal-tab ${activeTab === 'checkpoints' ? 'active' : ''}`} onClick={() => setActiveTab('checkpoints')}>Checkpoints</button>
        </div>

        {/* ===== Basic ===== */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'basic' ? 'block' : 'none' }}>
          <div className="form-group">
            <label>Portrait</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {formData.avatar ? (
                <img src={formData.avatar} alt="portrait" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
              ) : (
                <div className="card-avatar-placeholder" style={{ width: 64, height: 64 }}>
                  {formData.name?.charAt(0)?.toUpperCase() || 'I'}
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
              <button className="btn btn-sm btn-secondary" onClick={() => fileInputRef.current?.click()}>Upload</button>
              {formData.avatar && (
                <button className="btn btn-sm btn-secondary" onClick={() => setFormData(prev => ({ ...prev, avatar: '' }))}>Remove</button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>Name</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Operator Vance" />
          </div>

          <div className="form-group">
            <label>Gender</label>
            <select value={formData.gender} onChange={(e) => setFormData(prev => ({ ...prev, gender: e.target.value }))}>
              {GENDERS.map(g => <option key={g || 'none'} value={g}>{g ? g.charAt(0).toUpperCase() + g.slice(1) : '— Unspecified —'}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Mission</label>
            <textarea rows={3} value={formData.mission} onChange={(e) => setFormData(prev => ({ ...prev, mission: e.target.value }))}
              placeholder="The objective this instructor is driving toward. Stated plainly." />
          </div>

          <div className="form-group">
            <label>Instructor Profile</label>
            <select value={formData.instructorProfileId} onChange={(e) => setFormData(prev => ({ ...prev, instructorProfileId: e.target.value }))}>
              <option value="">— None —</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="section-hint">Defines how the instructor behaves and performs. Manage profiles in the Instructor Settings tab.</p>
          </div>

          <div className="form-group">
            <label>Library Term Groups</label>
            {groups.length === 0 ? (
              <p className="section-hint">No term groups yet. Create them in the Instructor Settings tab.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {groups.map(g => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={formData.instructorLibraryGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                    <span>{g.name} <span className="text-muted">({(g.terms || []).length} terms)</span></span>
                  </label>
                ))}
              </div>
            )}
            <p className="section-hint">Assigned terms are injected only when the player uses them (keyword-triggered).</p>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!formData.story.allowLlmDeviceAccess} onChange={(e) => updateStory('allowLlmDeviceAccess', e.target.checked)} />
              Allow this instructor to issue device commands
            </label>
          </div>
        </div>

        {/* ===== Welcome ===== */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'welcome' ? 'block' : 'none' }}>
          <p className="section-hint">The opening instruction(s) delivered when a session starts. Keep them direct and on-mission.</p>
          {formData.story.welcomeMessages.map((w, idx) => (
            <div key={w.id} className="form-group checkpoint-field">
              <div className="checkpoint-header">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="radio"
                    name="activeWelcome"
                    checked={formData.story.activeWelcomeMessageId === w.id}
                    onChange={() => updateStory('activeWelcomeMessageId', w.id)}
                  />
                  Message {idx + 1}{formData.story.activeWelcomeMessageId === w.id ? ' (active)' : ''}
                </label>
                {formData.story.welcomeMessages.length > 1 && (
                  <button className="btn btn-sm btn-danger" onClick={() => removeWelcome(w.id)}>Remove</button>
                )}
              </div>
              <textarea rows={3} value={w.text} onChange={(e) => updateWelcome(w.id, e.target.value)} placeholder="Opening instruction…" />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                <input
                  type="checkbox"
                  checked={!!w.llmEnhanced}
                  onChange={(e) => updateStory('welcomeMessages', formData.story.welcomeMessages.map(m => (m.id === w.id ? { ...m, llmEnhanced: e.target.checked } : m)))}
                />
                Enhance with AI on session start
              </label>
            </div>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={addWelcome}>+ Add Message</button>
        </div>

        {/* ===== Checkpoints ===== */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'checkpoints' ? 'block' : 'none' }}>
          <h4>Capacity Checkpoints</h4>
          <p className="section-hint">Per-range instructions and triggers as the player's capacity rises. Triggers can fire device actions, flows, and more.</p>
          {CHECKPOINT_RANGES.map(({ key, label, hint }) => (
            <div className="form-group checkpoint-field" key={key}>
              <div className="checkpoint-header">
                <label>{label}</label>
                <button
                  type="button"
                  className="checkpoint-spoiler-toggle"
                  onClick={() => setVisibleCheckpoints(prev => ({ ...prev, [key]: !prev[key] }))}
                >
                  <span className="spoiler-label">{visibleCheckpoints[key] ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              {hint && <p className="section-hint">{hint}</p>}
              <div className={`checkpoint-spoiler-wrap ${visibleCheckpoints[key] ? 'revealed' : ''}`}>
                <textarea
                  value={formData.story.checkpoints?.[key] || ''}
                  onChange={(e) => updateStory('checkpoints', { ...(formData.story.checkpoints || {}), [key]: e.target.value })}
                  placeholder="Instruction the AI should follow at this capacity range…"
                  rows={2}
                />
                <div className="checkpoint-triggers">
                  {triggersFor(key).map((trigger, tIdx) => (
                    <TriggerRow
                      key={trigger.id || tIdx}
                      trigger={trigger}
                      isPumpable={false}
                      onChange={(updated) => updateTrigger(key, tIdx, updated)}
                      onRemove={() => removeTrigger(key, tIdx)}
                    />
                  ))}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => addTrigger(key)}>+ Add Trigger</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Instructor</button>
        </div>
      </div>

      {showCropModal && (
        <MediaCropModal
          image={uploadedImage}
          orientation="portrait"
          onSave={handleCropSave}
          onCancel={() => { setShowCropModal(false); setUploadedImage(null); }}
        />
      )}
    </div>
  );
}

export default InstructorEditorModal;
