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
import { STAGED_PORTRAIT_RANGES } from '../../utils/stagedPortraits';
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
  const [availableSkins, setAvailableSkins] = useState([]);

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

  // Lorebook import (standard/group Library tab) — ported from CharacterEditorModal.
  const lorebookFileInputRef = useRef(null);
  const [importingLorebook, setImportingLorebook] = useState(false);

  // Member portrait crop.
  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const cropTargetRef = useRef(null); // member index whose portrait is being cropped
  const [selectedMemberIndex, setSelectedMemberIndex] = useState(0);

  // Member import flows: SwellD two-pane picker + V2/V3 file import.
  const [showSwellDPicker, setShowSwellDPicker] = useState(false);
  const [swellDList, setSwellDList] = useState([]);
  const [selectedSwellDId, setSelectedSwellDId] = useState(null);
  const [importingV2V3, setImportingV2V3] = useState(false);
  const v2v3FileInputRef = useRef(null);

  // ---- Main-tab story content (ported from CharacterEditorModal basic tab) ----
  const [personas, setPersonas] = useState([]);
  const [enhancingWelcomeMessage, setEnhancingWelcomeMessage] = useState(false);
  const [enhancingScenario, setEnhancingScenario] = useState(false);
  const cancelledRef = useRef({ welcomeMessage: false, scenario: false });
  // Manual pump maxes (global, shared with Smart Devices › Manual Devices) — settings, NOT formData.
  const [bulbMaxField, setBulbMaxField] = useState('');
  const [bikeMaxField, setBikeMaxField] = useState('');
  // Story selector inline-rename scratch state (ported from CharacterEditorModal).
  const [editingStoryName, setEditingStoryName] = useState(false);
  const [storyNameInput, setStoryNameInput] = useState('');
  // Story-level example dialogue add/edit scratch state.
  const [newDialogue, setNewDialogue] = useState({ user: '', character: '' });
  const [editDialogue, setEditDialogue] = useState({ user: '', character: '' });
  const [editingDialogueIndex, setEditingDialogueIndex] = useState(null);
  // Staged Portrait media file-input refs (per range, idle + transition).
  const charMediaIdleRefs = useRef({});
  const charMediaTransRefs = useRef({});

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
    apiFetch(`${API_BASE}/api/display-settings`).then(d => setAvailableSkins(d?.skins || [])).catch(() => {});
    api.getPersonas?.().then(p => setPersonas(Array.isArray(p) ? p : (p?.personas || []))).catch(() => {});
  }, [isOpen, api]);

  // Keep the local manual-pump-max fields in sync with global settings.
  useEffect(() => {
    const sv = settings?.systemVariables || {};
    setBulbMaxField(sv.BulbMax ?? '');
    setBikeMaxField(sv.BikeMax ?? '');
  }, [settings?.systemVariables]);

  const isInstructorMode = !!formData?.instructor?.enabled;
  const members = formData?.multiChar?.characters || [];
  const isGroup = !!formData?.multiChar?.enabled && members.length > 1;
  // Button sets are isolated by card mode (single / multi / instructor), NOT by version or story.
  const cardMode = isInstructorMode ? 'instructor' : (isGroup ? 'multi' : 'single');
  // Card-level pump UI gate: base-only uses the card flag; group mode uses any member's per-member flag.
  const anyMemberPumpable = members.some(m => m?.isPumpable);
  const pumpUiActive = isGroup ? anyMemberPumpable : !!formData.isPumpable;

  const set = useCallback((patch) => setFormData(prev => ({ ...prev, ...patch })), []);

  const activeStory = formData.stories?.find(s => s.id === formData.activeStoryId) || formData.stories?.[0];
  const updateStoryField = (field, value) => setFormData(prev => ({
    ...prev,
    stories: (prev.stories || []).map(s => (s.id === activeStory?.id ? { ...s, [field]: value } : s)),
  }));
  // Patch the active story object in one pass (used by version add/delete that touch two keys).
  const patchActiveStory = (patch) => setFormData(prev => ({
    ...prev,
    stories: (prev.stories || []).map(s => (s.id === activeStory?.id ? { ...s, ...patch } : s)),
  }));

  // ---- Per-member attribute store (group mode) ----
  // The backend reads activeStory.memberAttributes[memberId] for each member's attribute roll
  // chances (dominant/sadistic/…) and inflation dispositions (desireToInflateOthers/PopOthers),
  // falling back to the shared story.attributes when a member has none. Single-char cards keep
  // using story.attributes + card-level disposition fields.
  const memberAttrs = (mid) => (activeStory?.memberAttributes?.[mid]) || {};
  const setMemberAttr = (mid, patch) => updateStoryField('memberAttributes', {
    ...(activeStory?.memberAttributes || {}),
    [mid]: { ...memberAttrs(mid), ...patch },
  });

  // ---- Per-member checkpoint store (group mode "Primary" picker) ----
  // The Base character's checkpoints live on the active story (backward compatible). Non-base
  // members keep their own story-shaped checkpointStore (checkpointProfiles / defaultCheckpointProfileId
  // / checkpoints / checkpointTriggers / treeRefs / checkpointsEnabled). character.primaryCheckpointMemberId
  // names which member's checkpoints the backend reads (default = Base).
  const updateMemberCheckpoint = (i, field, value) => setMembers(members.map((m, idx) => (
    idx === i ? { ...m, checkpointStore: { ...(m.checkpointStore || {}), [field]: value } } : m
  )));

  // ---- Story selector + add/rename/delete ("versions of versions" of a character) ----
  // Ported from CharacterEditorModal. activeStoryId is the single source of truth here.
  const stories = formData.stories || [];
  const handleStoryChange = (storyId) => set({ activeStoryId: storyId });
  const handleAddStory = () => {
    const newId = `story-${Date.now()}`;
    const newStory = {
      id: newId,
      name: `Story ${stories.length + 1}`,
      welcomeMessages: [{ id: `wm-${Date.now()}`, text: '', llmEnhanced: false }],
      activeWelcomeMessageId: `wm-${Date.now()}`,
      scenarios: [{ id: `sc-${Date.now()}`, text: '' }],
      activeScenarioId: `sc-${Date.now()}`,
      exampleDialogues: [],
      autoReplyEnabled: false,
      allowLlmDeviceAccess: false,
      assignedFlows: [],
      assignedButtons: [],
      constantReminderIds: [],
      globalReminderIds: [],
      startingEmotion: 'neutral',
      storyProgressionEnabled: false,
      storyProgressionMaxOptions: 3,
      checkpoints: {},
      attributes: {},
    };
    set({ stories: [...stories, newStory], activeStoryId: newId });
  };
  const handleDeleteStory = () => {
    if (stories.length <= 1) { alert('Cannot delete the last story'); return; }
    if (!window.confirm('Delete this story?')) return;
    const storyId = activeStory?.id;
    const filtered = stories.filter(s => s.id !== storyId);
    set({ stories: filtered, activeStoryId: filtered[0]?.id || null });
  };
  const handleRenameStory = () => { setStoryNameInput(activeStory?.name || ''); setEditingStoryName(true); };
  const handleSaveStoryName = () => {
    if (!storyNameInput.trim()) { alert('Story name cannot be empty'); return; }
    updateStoryField('name', storyNameInput.trim());
    setEditingStoryName(false);
  };
  const handleCancelStoryName = () => { setEditingStoryName(false); setStoryNameInput(''); };

  // ---- Manual pump maxes (global settings, NOT formData) ----
  const saveMaxField = (which, raw) => {
    const clean = String(raw).replace(/[^0-9]/g, '');
    const sv = { ...(settings?.systemVariables || {}) };
    if (which === 'bulb') sv.BulbMax = clean === '' ? '' : Number(clean);
    else sv.BikeMax = clean === '' ? '' : Number(clean);
    api.updateSettings?.({ systemVariables: sv }).catch(() => {});
  };

  // ---- Pumpable: player primary-pump calibration (for the sync-with-player option) ----
  const playerPumpCalibration = useMemo(() => {
    const pump = devices?.find(d => d.isPrimaryPump || d.deviceType === 'PUMP');
    return pump?.calibrationTime || null;
  }, [devices]);

  // ---- Staged Portraits: media upload + crop handlers (ported from CharacterEditorModal) ----
  const uploadPortraitMedia = async (file, slot) => {
    if (!character?.id) return null;
    const folder = character._isDefault ? 'default' : 'custom';
    const form = new FormData();
    form.append('file', file);
    form.append('slot', slot);
    try {
      const res = await fetch(`${window.location.protocol}//${window.location.hostname}:${window.location.port || 3001}/api/portrait-media/chars/${folder}/${character.id}`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Upload failed');
      return await res.json();
    } catch (err) {
      console.error('[PortraitMedia] Upload error:', err);
      return null;
    }
  };

  const handleIdleUpload = async (e, rangeId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return;
    if (isImage) {
      // Images go through base64; stored in legacy charStagedPortraits too.
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target.result;
        setFormData(prev => ({
          ...prev,
          charStagedPortraits: { ...prev.charStagedPortraits, [rangeId]: url },
          charPortraitMedia: {
            ...prev.charPortraitMedia,
            [rangeId]: { ...(prev.charPortraitMedia?.[rangeId] || {}), idle: url, idleType: 'image' },
          },
        }));
      };
      reader.readAsDataURL(file);
    } else {
      const result = await uploadPortraitMedia(file, `idle-${rangeId}`);
      if (result?.url) {
        setFormData(prev => ({
          ...prev,
          charPortraitMedia: {
            ...prev.charPortraitMedia,
            [rangeId]: { ...(prev.charPortraitMedia?.[rangeId] || {}), idle: result.url, idleType: 'video' },
          },
        }));
      }
    }
  };

  const handleTransUpload = async (e, rangeId) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    e.target.value = '';
    const result = await uploadPortraitMedia(file, `trans-${rangeId}`);
    if (result?.url) {
      setFormData(prev => ({
        ...prev,
        charPortraitMedia: {
          ...prev.charPortraitMedia,
          [rangeId]: { ...(prev.charPortraitMedia?.[rangeId] || {}), trans: result.url },
        },
      }));
    }
  };

  const handleRemoveIdle = (rangeId) => {
    const updated = { ...formData.charPortraitMedia };
    if (updated[rangeId]) {
      delete updated[rangeId].idle;
      delete updated[rangeId].idleType;
      if (!updated[rangeId].trans) delete updated[rangeId];
    }
    const legacyUpdated = { ...formData.charStagedPortraits };
    delete legacyUpdated[rangeId];
    setFormData(prev => ({ ...prev, charPortraitMedia: updated, charStagedPortraits: legacyUpdated }));
  };

  const handleRemoveTrans = (rangeId) => {
    const updated = { ...formData.charPortraitMedia };
    if (updated[rangeId]) {
      delete updated[rangeId].trans;
      if (!updated[rangeId].idle) delete updated[rangeId];
    }
    setFormData(prev => ({ ...prev, charPortraitMedia: updated }));
  };

  const handleCropChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      charPortraitCrop: { ...(prev.charPortraitCrop || { scale: 1, offsetX: 0, offsetY: 0 }), [field]: value },
    }));
  };

  // ---- POV derived from the active persona (used to steer LLM enhancement) ----
  const activePersona = personas?.find(p => p.id === settings?.activePersonaId);
  const playerName = activePersona?.displayName || 'The player';
  const personaPronouns = activePersona?.pronouns || 'they/them';
  const activePOV = personaPronouns === 'she/her' ? 'FEMPOV' : personaPronouns === 'he/him' ? 'MALEPOV' : 'ANYPOV';
  const getPovInstruction = () => {
    const genderNote = activePOV === 'FEMPOV' ? `${playerName} is female (she/her).`
      : activePOV === 'MALEPOV' ? `${playerName} is male (he/him).`
      : `${playerName} is unspecified gender (they/them).`;
    return `- ${genderNote} When referring to the player with pronouns, ALWAYS use the [Gender] variable instead of writing literal pronouns. Examples: "looks at [Gender]", "[Gender] eyes", "[Gender] smiles". The [Gender] tag auto-resolves to the correct pronoun form at runtime.`;
  };

  // ---- Welcome message versioning ----
  const getActiveWelcomeMessage = () => {
    const list = activeStory?.welcomeMessages || [];
    if (!list.length) return null;
    return list.find(wm => wm.id === activeStory?.activeWelcomeMessageId) || list[0];
  };
  const handleWelcomeMessageChange = (wmId) => updateStoryField('activeWelcomeMessageId', wmId);
  const handleAddWelcomeMessage = () => {
    const list = activeStory?.welcomeMessages || [];
    const newId = `wm-${Date.now()}`;
    patchActiveStory({ welcomeMessages: [...list, { id: newId, text: '', llmEnhanced: false }], activeWelcomeMessageId: newId });
  };
  const handleDeleteWelcomeMessage = (wmId) => {
    const list = activeStory?.welcomeMessages || [];
    if (list.length <= 1) { alert('Cannot delete the last welcome message'); return; }
    if (!window.confirm('Delete this welcome message version?')) return;
    const filtered = list.filter(wm => wm.id !== wmId);
    const newActiveId = activeStory?.activeWelcomeMessageId === wmId ? filtered[0]?.id : activeStory?.activeWelcomeMessageId;
    patchActiveStory({ welcomeMessages: filtered, activeWelcomeMessageId: newActiveId });
  };
  const handleUpdateWelcomeMessageText = (text) => {
    const list = activeStory?.welcomeMessages || [];
    const id = activeStory?.activeWelcomeMessageId;
    updateStoryField('welcomeMessages', list.map(wm => (wm.id === id ? { ...wm, text } : wm)));
  };
  const handleToggleWelcomeMessageLlm = () => {
    const list = activeStory?.welcomeMessages || [];
    const id = activeStory?.activeWelcomeMessageId;
    const cur = list.find(wm => wm.id === id);
    updateStoryField('welcomeMessages', list.map(wm => (wm.id === id ? { ...wm, llmEnhanced: !cur?.llmEnhanced } : wm)));
  };
  const handleEnhanceWelcomeMessage = async () => {
    if (enhancingWelcomeMessage) { cancelledRef.current.welcomeMessage = true; setEnhancingWelcomeMessage(false); return; }
    const activeWm = getActiveWelcomeMessage();
    const currentText = activeWm?.text || '';
    const description = formData.description || '';
    const personality = formData.personality || '';
    const exampleDialogues = activeStory?.exampleDialogues || [];
    let dialogExamplesSection = '';
    if (exampleDialogues.length > 0) {
      dialogExamplesSection = '\n\nDialog Examples (showing how this character speaks):\n';
      exampleDialogues.forEach((d, idx) => { dialogExamplesSection += `\nExample ${idx + 1}:\n[Player]: ${d.user}\n${formData.name || 'Character'}: ${d.character}\n`; });
    }
    const povInstructions = getPovInstruction();
    const prompt = `You are a creative writing assistant helping to craft an immersive character greeting message.

Character Name: ${formData.name || 'Character'}
${description ? `Description: ${description}` : ''}
${personality ? `Personality: ${personality}` : ''}${dialogExamplesSection}

IMPORTANT INSTRUCTIONS:
- Write the greeting AS THE CHARACTER in first-person perspective
- Use roleplay format: *actions in asterisks* mixed with "dialog in quotes"
- Use [Player] for the player's name and [Gender] for their pronouns (both auto-resolve at runtime)
${povInstructions}
- The greeting should show what the character is doing and saying in the moment
- Make it engaging, sensory, and in-character
- Keep language natural and grounded - avoid purple prose or overly flowery descriptions
${exampleDialogues.length > 0 ? '- Match the speaking style and tone shown in the dialog examples above' : ''}

${currentText ? `Current greeting:\n${currentText}\n\nPlease rewrite and enhance this greeting following the format above. Keep the same general intent but improve the prose, add sensory details, and ensure proper roleplay formatting.` : 'Write a compelling first greeting message from this character\'s perspective. Use the roleplay format with *actions* and "dialog", include [Player] variable where appropriate.'}

Write only the greeting message itself, no explanations or meta-commentary.`;
    try {
      cancelledRef.current.welcomeMessage = false;
      setEnhancingWelcomeMessage(true);
      const response = await api.generateText({ prompt, maxTokens: 500 });
      if (cancelledRef.current.welcomeMessage) return;
      if (response && response.text) handleUpdateWelcomeMessageText(response.text.trim());
    } catch (error) {
      if (cancelledRef.current.welcomeMessage) return;
      alert(`Failed to enhance welcome message: ${error.message}`);
    } finally { setEnhancingWelcomeMessage(false); }
  };

  // ---- Scenario versioning ----
  const getActiveScenario = () => {
    const list = activeStory?.scenarios || [];
    if (!list.length) return null;
    return list.find(sc => sc.id === activeStory?.activeScenarioId) || list[0];
  };
  const handleScenarioChange = (scId) => updateStoryField('activeScenarioId', scId);
  const handleAddScenario = () => {
    const list = activeStory?.scenarios || [];
    const newId = `sc-${Date.now()}`;
    patchActiveStory({ scenarios: [...list, { id: newId, text: '' }], activeScenarioId: newId });
  };
  const handleDeleteScenario = (scId) => {
    const list = activeStory?.scenarios || [];
    if (list.length <= 1) { alert('Cannot delete the last scenario'); return; }
    if (!window.confirm('Delete this scenario version?')) return;
    const filtered = list.filter(sc => sc.id !== scId);
    const newActiveId = activeStory?.activeScenarioId === scId ? filtered[0]?.id : activeStory?.activeScenarioId;
    patchActiveStory({ scenarios: filtered, activeScenarioId: newActiveId });
  };
  const handleUpdateScenarioText = (text) => {
    const list = activeStory?.scenarios || [];
    const id = activeStory?.activeScenarioId;
    updateStoryField('scenarios', list.map(sc => (sc.id === id ? { ...sc, text } : sc)));
  };
  const handleEnhanceScenario = async () => {
    if (enhancingScenario) { cancelledRef.current.scenario = true; setEnhancingScenario(false); return; }
    const activeScenario = getActiveScenario();
    const currentText = activeScenario?.text || '';
    const description = formData.description || '';
    const personality = formData.personality || '';
    const exampleDialogues = activeStory?.exampleDialogues || [];
    let dialogExamplesSection = '';
    if (exampleDialogues.length > 0) {
      dialogExamplesSection = '\n\nDialog Examples (showing character context):\n';
      exampleDialogues.forEach((d, idx) => { dialogExamplesSection += `\nExample ${idx + 1}:\n[Player]: ${d.user}\n${formData.name || 'Character'}: ${d.character}\n`; });
    }
    const povInstructions = getPovInstruction();
    const prompt = `You are a creative writing assistant helping to craft a concise scenario description.

Character Name: ${formData.name || 'Character'}
${description ? `Description: ${description}` : ''}
${personality ? `Personality: ${personality}` : ''}${dialogExamplesSection}

IMPORTANT INSTRUCTIONS:
- Write a simple, descriptive scenario in 1-2 sentences
- Use third-person perspective (describe the situation objectively)
- Use [Player] for the player's name and [Gender] for their pronouns
${povInstructions}
- Focus on setting and situation, not actions or dialog
- Keep it concise and atmospheric
- Use natural, grounded language - avoid purple prose or excessive flowery descriptions
${exampleDialogues.length > 0 ? '- Consider the context and relationship shown in the dialog examples' : ''}

${currentText ? `Current scenario:\n${currentText}\n\nPlease rewrite this scenario following the guidelines above. Keep it brief (1-2 sentences) but vivid.` : 'Write a brief scenario description (1-2 sentences) that sets the scene for this character.'}

Write only the scenario description itself, no explanations.`;
    try {
      cancelledRef.current.scenario = false;
      setEnhancingScenario(true);
      const response = await api.generateText({ prompt, maxTokens: 100 });
      if (cancelledRef.current.scenario) return;
      if (response && response.text) handleUpdateScenarioText(response.text.trim());
    } catch (error) {
      if (cancelledRef.current.scenario) return;
      alert(`Failed to enhance scenario: ${error.message}`);
    } finally { setEnhancingScenario(false); }
  };

  // ---- Story-level example dialogues ----
  const handleAddDialogue = () => {
    if (newDialogue.user.trim() && newDialogue.character.trim()) {
      updateStoryField('exampleDialogues', [...(activeStory?.exampleDialogues || []), newDialogue]);
      setNewDialogue({ user: '', character: '' });
    }
  };
  const handleRemoveDialogue = (index) => {
    updateStoryField('exampleDialogues', (activeStory?.exampleDialogues || []).filter((_, i) => i !== index));
    if (editingDialogueIndex === index) setEditingDialogueIndex(null);
  };
  const handleStartEditDialogue = (index) => {
    const d = activeStory?.exampleDialogues?.[index];
    if (d) { setEditDialogue({ user: d.user, character: d.character }); setEditingDialogueIndex(index); }
  };
  const handleSaveEditDialogue = () => {
    if (editDialogue.user.trim() && editDialogue.character.trim()) {
      updateStoryField('exampleDialogues', (activeStory?.exampleDialogues || []).map((d, i) => (i === editingDialogueIndex ? editDialogue : d)));
      setEditingDialogueIndex(null);
      setEditDialogue({ user: '', character: '' });
    }
  };
  const handleCancelEditDialogue = () => { setEditingDialogueIndex(null); setEditDialogue({ user: '', character: '' }); };

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
    // >1 member: preserve the explicit Single/Group choice (default group when unset). 1 member: never group.
    multiChar: { ...(prev.multiChar || {}), enabled: next.length > 1 ? (prev.multiChar?.enabled ?? true) : false, characters: next },
  }));
  const addMember = () => {
    // Seed new members from the base card's description/personality/portrait (editable per-member) instead of blank.
    const next = [...members, { id: `m-${Date.now()}`, name: '', description: formData.description || '', personality: formData.personality || '', portrait: formData.avatar || '' }];
    setMembers(next);
    setSelectedMemberIndex(next.length - 1);
  };
  const updateMember = (i, patch) => setMembers(members.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const removeMember = (i) => {
    const next = members.filter((_, idx) => idx !== i);
    setMembers(next);
    setSelectedMemberIndex(Math.max(0, Math.min(selectedMemberIndex, next.length - 1)));
  };

  // Map any SwellD-shaped character into a new member (identity + persona prose + example dialogues).
  const memberFromCharacter = (src) => {
    const srcStory = src.stories?.find(s => s.id === src.activeStoryId) || src.stories?.[0];
    return {
      id: `m-${Date.now()}`,
      name: src.name || '',
      description: src.description || '',
      personality: src.personality || '',
      gender: src.gender || '',
      portrait: src.avatar || '',
      exampleDialogues: (srcStory?.exampleDialogues || src.exampleDialogues || []).map(e => ({ user: e.user || '', character: e.character || '' })),
    };
  };
  const addMemberFrom = (src) => {
    const next = [...members, memberFromCharacter(src)];
    setMembers(next);
    setSelectedMemberIndex(next.length - 1);
  };

  // ---- Import SwellD card → member: two-pane picker (list | portrait + description) ----
  const openSwellDPicker = async () => {
    let list = [];
    try {
      const res = await api.getCharacters?.();
      list = Array.isArray(res) ? res : (res?.characters || []);
    } catch (e) { /* non-fatal */ }
    const singles = (list || []).filter(c => c.id !== formData.id && !c.multiChar?.enabled && !c.instructor?.enabled);
    if (!singles.length) { alert('No single-character cards available to import.'); return; }
    setSwellDList(singles);
    setSelectedSwellDId(singles[0].id);
    setShowSwellDPicker(true);
  };
  const confirmSwellDImport = () => {
    const src = swellDList.find(c => c.id === selectedSwellDId);
    if (src) addMemberFrom(src);
    setShowSwellDPicker(false);
  };

  // ---- Import V2/V3 card file (.png/.json) → member (no-persist server conversion) ----
  const handleV2V3Import = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportingV2V3(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/convert/character-card`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data?.character) throw new Error(data?.error || 'Conversion failed');
      addMemberFrom(data.character);
    } catch (err) {
      alert(`Could not import card: ${err.message || 'unknown error'}`);
    } finally {
      setImportingV2V3(false);
    }
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
    if (i === 'avatar') {
      set({ avatar: cropped });
    } else if (i != null) {
      updateMember(i, { portrait: cropped });
    }
    setShowCropModal(false); setUploadedImage(null); cropTargetRef.current = null;
  };

  // ---- Base-character avatar (top-level formData.avatar) ----
  const avatarFileInputRef = useRef(null);
  const handleAvatarClick = () => avatarFileInputRef.current?.click();
  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please upload an image file'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { cropTargetRef.current = 'avatar'; setUploadedImage(ev.target.result); setShowCropModal(true); };
    reader.readAsDataURL(file);
    e.target.value = '';
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

  // ---- Lorebook import (V2/V3 character_book + SillyTavern world info) ----
  const handleLorebookImportClick = () => { lorebookFileInputRef.current?.click(); };
  const handleLorebookImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportingLorebook(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Support multiple formats:
      // 1. V2/V3 character_book with array entries
      // 2. SillyTavern world info with object entries
      // 3. Direct array of entries
      let entries = [];
      if (data.character_book?.entries && Array.isArray(data.character_book.entries)) {
        entries = data.character_book.entries;
      } else if (data.character_book?.entries && typeof data.character_book.entries === 'object') {
        entries = Object.values(data.character_book.entries);
      } else if (data.data?.character_book?.entries && Array.isArray(data.data.character_book.entries)) {
        entries = data.data.character_book.entries;
      } else if (data.data?.character_book?.entries && typeof data.data.character_book.entries === 'object') {
        entries = Object.values(data.data.character_book.entries);
      } else if (data.entries && Array.isArray(data.entries)) {
        entries = data.entries;
      } else if (data.entries && typeof data.entries === 'object') {
        entries = Object.values(data.entries);
      } else if (Array.isArray(data)) {
        entries = data;
      } else {
        throw new Error('Invalid lorebook format. Expected character_book.entries or entries object/array.');
      }
      if (!Array.isArray(entries)) throw new Error('Lorebook entries must be an array.');
      const newReminders = entries
        .filter(entry => entry.enabled !== false && entry.disable !== true)
        .map(entry => ({
          id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entry.name || entry.comment || 'Lorebook Entry',
          text: entry.content || entry.value || '',
          target: 'character',
          enabled: true,
          constant: entry.constant === true || (entry.selective !== undefined && !entry.selective),
          keys: entry.keys || entry.key || [],
          caseSensitive: entry.caseSensitive || entry.case_sensitive || false,
          priority: entry.priority !== undefined ? entry.priority : (entry.insertion_order || entry.order || 100),
          scanDepth: entry.extensions?.scan_depth || entry.scanDepth || entry.depth || 10,
        }));
      if (newReminders.length === 0) throw new Error('No valid lorebook entries found in file.');
      setOwnEntries([...ownEntries, ...newReminders]);
      alert(`Successfully imported ${newReminders.length} lorebook entries as Library.`);
    } catch (error) {
      console.error('Failed to import lorebook:', error);
      alert(error.message || 'Failed to import lorebook file');
    } finally {
      setImportingLorebook(false);
      if (lorebookFileInputRef.current) lorebookFileInputRef.current.value = '';
    }
  };

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

  // ---- Button Sets (swap whole sets of custom buttons; isolated by card mode) ----
  // The working buttons live in formData.buttons (backend + existing CRUD use them). A set is a
  // named snapshot tagged with a mode; loading copies its buttons into formData.buttons. Saving on
  // the card syncs the active set's buttons so edits to a loaded set persist.
  const buttonSets = formData.buttonSets || [];
  const modeButtonSets = buttonSets.filter(s => (s.mode || 'single') === cardMode);
  const activeButtonSet = buttonSets.find(s => s.id === formData.activeButtonSetId && (s.mode || 'single') === cardMode) || null;
  const saveButtonSet = () => {
    const name = window.prompt('Name this button set:', `Set ${modeButtonSets.length + 1}`);
    if (name === null) return;
    const id = `bs-${Date.now()}`;
    const newSet = { id, name: name.trim() || `Set ${modeButtonSets.length + 1}`, mode: cardMode, buttons: JSON.parse(JSON.stringify(formData.buttons || [])) };
    set({ buttonSets: [...buttonSets, newSet], activeButtonSetId: id });
  };
  const loadButtonSet = (id) => {
    if (!id) { set({ activeButtonSetId: '' }); return; }
    const bs = buttonSets.find(s => s.id === id);
    if (bs) set({ buttons: JSON.parse(JSON.stringify(bs.buttons || [])), activeButtonSetId: id });
  };
  const updateButtonSet = () => {
    if (!activeButtonSet) return;
    set({ buttonSets: buttonSets.map(s => (s.id === activeButtonSet.id ? { ...s, buttons: JSON.parse(JSON.stringify(formData.buttons || [])) } : s)) });
  };
  const renameButtonSet = () => {
    if (!activeButtonSet) return;
    const name = window.prompt('Rename button set:', activeButtonSet.name);
    if (!name) return;
    set({ buttonSets: buttonSets.map(s => (s.id === activeButtonSet.id ? { ...s, name: name.trim() } : s)) });
  };
  const deleteButtonSet = () => {
    if (!activeButtonSet) return;
    if (!window.confirm('Delete this button set? The buttons currently loaded stay until you change them.')) return;
    set({ buttonSets: buttonSets.filter(s => s.id !== activeButtonSet.id), activeButtonSetId: '' });
  };

  const handleSave = () => {
    // Sync the active set's buttons with the working buttons so edits to a loaded set persist.
    const data = activeButtonSet
      ? { ...formData, buttonSets: buttonSets.map(s => (s.id === activeButtonSet.id ? { ...s, buttons: formData.buttons || [] } : s)) }
      : formData;
    onSave?.(data);
  };

  // Tabs depend on mode (the "face" change). Standard and Instructor get SEPARATE Library/Checkpoint tabs.
  // In group Individual-Responses mode, attributes are set PER MEMBER (in the Members tab), so the
  // shared Attributes tab is hidden.
  const individualGroupMode = isGroup && (formData?.multiChar?.responseMode === 'individual');
  const tabs = useMemo(() => ([
    { id: 'main', label: 'Main' },
    ...(isInstructorMode ? [] : [{ id: 'members', label: isGroup ? 'Members' : 'Member' }]),
    ...(individualGroupMode ? [] : [{ id: 'attributes', label: 'Attributes' }]),
    ...((!isInstructorMode && pumpUiActive) ? [{ id: 'charPortraits', label: 'Staged Portraits' }] : []),
    { id: 'checkpoints', label: 'Checkpoints' },
    { id: 'library', label: 'Library' },
    ...(isInstructorMode ? [{ id: 'instructor', label: 'Instructor Settings' }] : []),
    { id: 'events', label: 'Custom Buttons' },
  ]), [isInstructorMode, isGroup, pumpUiActive, individualGroupMode]);

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
          {/* Single Char / Group Mode toggle — only meaningful when the card has >1 member. Flips
              multiChar.enabled: OFF = standard single layout (functions as a single char), ON = group. */}
          {members.length > 1 && (
            <div className="form-group">
              <label>Card Mode</label>
              <div className="ab-toggle" style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color, #444)' }}>
                <button type="button" onClick={() => setFormData(prev => ({ ...prev, multiChar: { ...(prev.multiChar || {}), enabled: false } }))}
                  style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontWeight: 600, background: !formData.multiChar?.enabled ? 'var(--accent-color, #6a4caf)' : 'transparent', color: !formData.multiChar?.enabled ? '#fff' : 'inherit' }}>
                  Single Char
                </button>
                <button type="button" onClick={() => setFormData(prev => ({ ...prev, multiChar: { ...(prev.multiChar || {}), enabled: true } }))}
                  style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontWeight: 600, background: formData.multiChar?.enabled ? 'var(--accent-color, #6a4caf)' : 'transparent', color: formData.multiChar?.enabled ? '#fff' : 'inherit' }}>
                  Group Mode
                </button>
              </div>
            </div>
          )}

          {/* Group Name — the name shown on the group's chat bubble ONLY. Does NOT change [Char]. */}
          {isGroup && (
            <div className="form-group">
              <label>Group Name <span className="section-hint">(shown on the group's chat bubble — does not replace [Char])</span></label>
              <input type="text" value={formData.multiChar?.groupName || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, multiChar: { ...(prev.multiChar || {}), groupName: e.target.value } }))}
                placeholder="e.g. The Girls" />
            </div>
          )}

          <div className="form-group">
            <label>Name *</label>
            <input type="text" value={formData.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="Character name" />
          </div>

          <div className="form-group">
            <label>Short Description <span className="section-hint">(shown only in the character list — never sent to the AI)</span></label>
            <input type="text" value={formData.shortDescription || ''} onChange={(e) => set({ shortDescription: e.target.value })}
              placeholder="e.g. Group Member Test" />
          </div>

          <div className="form-group">
            <label>{isGroup ? 'Group Avatar' : 'Character Avatar'}</label>
            <div className={`avatar-upload-area ${formData.avatar ? 'has-avatar' : ''}`} onClick={handleAvatarClick}>
              {formData.avatar ? (
                <img src={formData.avatar} alt="Avatar" className="avatar-preview" />
              ) : (
                <div className="avatar-placeholder">
                  <span className="upload-icon">📷</span>
                  <span className="upload-text">Click to upload</span>
                </div>
              )}
            </div>
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              style={{ display: 'none' }}
            />
            {formData.avatar && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => { e.stopPropagation(); set({ avatar: '' }); }}
                style={{ marginTop: '0.5rem' }}
              >
                Remove Avatar
              </button>
            )}
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

          {/* ---- Base-character fields + story content (standard mode only) ---- */}
          {!isInstructorMode && (
            <>
              {/* Gender is a per-member field in group mode (lives on the Members tab). */}
              {!isGroup && (
                <div className="form-group">
                  <label>Gender</label>
                  <select value={formData.gender || ''} onChange={(e) => set({ gender: e.target.value })}>
                    {MEMBER_GENDERS.map(g => <option key={g.value || 'none'} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>{isGroup ? 'Group Response Tokens (collective reply, overrides global)' : 'Individual Response Tokens (overrides global)'}</label>
                <input type="text" inputMode="numeric"
                  value={formData.responseTokens ?? ''}
                  onChange={(e) => set({ responseTokens: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="Leave blank to use the global setting" />
              </div>

              <div className="form-group">
                <label>Chat History Depth (overrides global)</label>
                <input type="text" inputMode="numeric" value={formData.historyDepth ?? ''}
                  onChange={(e) => set({ historyDepth: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="Leave blank to use the global setting" />
                <p className="section-hint">Prior messages this character sees. Leave blank for full scene memory; lower only if you want a tighter, less history-driven character.</p>
              </div>

              {/* Description & Personality are per-member in group mode (Members tab). */}
              {!isGroup && (
                <div className="form-group">
                  <label>Description</label>
                  <textarea value={formData.description || ''} onChange={(e) => set({ description: e.target.value })}
                    placeholder="Brief character description..." />
                </div>
              )}

              {!isGroup && (
                <div className="form-group">
                  <label>Personality</label>
                  <textarea value={formData.personality || ''} onChange={(e) => set({ personality: e.target.value })}
                    placeholder="Detailed personality traits..." />
                </div>
              )}

              {/* ---- Story selector (versions of versions): add / rename / delete ----
                  Rendered in BOTH single and group mode. In group mode the story IS the group's
                  shared narrative; the backend reads activeStory.welcomeMessages/scenarios/
                  exampleDialogues regardless of mode, so the same versioned editors below drive
                  the group greeting/scenario/dialogue. (The old flat group* keys were write-only
                  dead ends and have been removed; their content is migrated into the story on load.) */}
              <div className="story-field">
                <label>{isGroup ? 'Group Story' : 'Story'}</label>
                <div className="story-controls">
                  {editingStoryName ? (
                    <div className="story-name-edit">
                      <input
                        type="text"
                        value={storyNameInput}
                        onChange={(e) => setStoryNameInput(e.target.value)}
                        className="story-name-input"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveStoryName();
                          if (e.key === 'Escape') handleCancelStoryName();
                        }}
                      />
                      <button type="button" className="btn-icon btn-save" onClick={handleSaveStoryName} title="Save">💾</button>
                      <button type="button" className="btn-icon btn-cancel" onClick={handleCancelStoryName} title="Cancel">✕</button>
                    </div>
                  ) : (
                    <>
                      <select
                        value={activeStory?.id || ''}
                        onChange={(e) => handleStoryChange(e.target.value)}
                        className="story-select"
                      >
                        {stories.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add" onClick={handleAddStory} title="Add story">+</button>
                      <button type="button" className="btn-icon btn-edit" onClick={handleRenameStory} title="Rename">✏️</button>
                      <button type="button" className="btn-icon btn-delete" onClick={handleDeleteStory} title="Delete" disabled={stories.length <= 1}>🗑️</button>
                    </>
                  )}
                </div>
              </div>

              {/* ---- Story content: scenario + welcome message versions + example dialogues ----
                  Rendered in BOTH modes. The backend reads activeStory.welcomeMessages/scenarios/
                  exampleDialogues for single AND group cards, so these versioned editors are what
                  actually drive the group greeting/scenario/dialogue. CardLoreSection / Auto Reply /
                  AI Pump Control stay card/group level and render in both modes. ---- */}
              {activeStory && (
                <>
                  <>
                  {/* Welcome Message */}
                  <div className="story-field">
                    <div className="story-field-header">
                      <label>{isGroup ? 'Group Greeting' : 'Welcome Message'}{enhancingWelcomeMessage && <span className="spinner-inline"> ⏳</span>}</label>
                      <div className="version-controls">
                        <button type="button" className={`btn-icon btn-llm ${getActiveWelcomeMessage()?.llmEnhanced ? 'active' : ''}`}
                          onClick={handleToggleWelcomeMessageLlm} title="Toggle LLM Enhancement">🤖</button>
                        <button type="button" className={`btn-icon btn-random-version ${activeStory?.randomWelcomeVersion ? 'active' : ''}`}
                          onClick={() => updateStoryField('randomWelcomeVersion', !activeStory?.randomWelcomeVersion)}
                          title={activeStory?.randomWelcomeVersion ? 'Random version on session start (ON)' : 'Random version on session start (OFF)'}>R</button>
                        <select value={activeStory?.activeWelcomeMessageId || ''} onChange={(e) => handleWelcomeMessageChange(e.target.value)} className="version-select">
                          {(activeStory?.welcomeMessages || []).map((wm, idx) => <option key={wm.id} value={wm.id}>Ver {idx + 1}</option>)}
                        </select>
                        <button type="button" className="btn-icon btn-add" onClick={handleAddWelcomeMessage} title="Add version">+</button>
                        <button type="button" className="btn-icon btn-delete" onClick={() => handleDeleteWelcomeMessage(activeStory?.activeWelcomeMessageId)}
                          disabled={(activeStory?.welcomeMessages || []).length <= 1} title="Delete version">🗑️</button>
                        <button type="button" className={`btn-icon btn-magic ${enhancingWelcomeMessage ? 'active enhancing' : ''}`}
                          onClick={handleEnhanceWelcomeMessage} title={enhancingWelcomeMessage ? 'Click to abort' : 'Enhance with LLM'}>🪄</button>
                      </div>
                    </div>
                    <textarea value={getActiveWelcomeMessage()?.text || ''} onChange={(e) => handleUpdateWelcomeMessageText(e.target.value)}
                      placeholder="The first message the character sends..." rows={9} />
                  </div>

                  {/* Scenario */}
                  <div className="story-field">
                    <div className="story-field-header">
                      <label>{isGroup ? 'Group Scenario' : 'Scenario'}{enhancingScenario && <span className="spinner-inline"> ⏳</span>}</label>
                      <div className="version-controls">
                        <div className="version-controls-spacer"></div>
                        <select value={activeStory?.activeScenarioId || ''} onChange={(e) => handleScenarioChange(e.target.value)} className="version-select">
                          {(activeStory?.scenarios || []).map((sc, idx) => <option key={sc.id} value={sc.id}>Ver {idx + 1}</option>)}
                        </select>
                        <button type="button" className="btn-icon btn-add" onClick={handleAddScenario} title="Add version">+</button>
                        <button type="button" className="btn-icon btn-delete" onClick={() => handleDeleteScenario(activeStory?.activeScenarioId)}
                          disabled={(activeStory?.scenarios || []).length <= 1} title="Delete version">🗑️</button>
                        <button type="button" className={`btn-icon btn-magic ${enhancingScenario ? 'active enhancing' : ''}`}
                          onClick={handleEnhanceScenario} title={enhancingScenario ? 'Click to abort' : 'Enhance with LLM'}>🪄</button>
                      </div>
                    </div>
                    <textarea value={getActiveScenario()?.text || ''} onChange={(e) => handleUpdateScenarioText(e.target.value)}
                      placeholder="Current situation/scenario..." rows={2} />
                  </div>

                  {/* Example Dialogues — group cards author the reply as ONE blended block where
                      every member speaks (dialog in "quotes", actions in *asterisks*), no name fields. */}
                  <div className="story-field">
                    <label>{isGroup ? 'Group Dialogues' : 'Example Dialogues'}</label>
                    {isGroup && (
                      <p className="section-hint">Each example shows one player line and one <strong>blended group reply</strong> where any/all members speak — write dialog in "quotes" and actions in *asterisks*, attributing lines by name.</p>
                    )}
                    <div className="dialogues-list">
                      {(activeStory?.exampleDialogues || []).map((dialogue, i) => (
                        <div key={i} className="dialogue-item">
                          {editingDialogueIndex === i ? (
                            <div className="dialogue-edit-form">
                              <input type="text" placeholder="Player says..." value={editDialogue.user}
                                onChange={(e) => setEditDialogue({ ...editDialogue, user: e.target.value })} />
                              {isGroup ? (
                                <textarea placeholder={'The group responds — blend everyone:\nLana: *smiles* "Hey, baby."\nScarlett: *arches a brow* "Sit."'}
                                  rows={5} value={editDialogue.character}
                                  onChange={(e) => setEditDialogue({ ...editDialogue, character: e.target.value })} />
                              ) : (
                                <input type="text" placeholder="Character responds..." value={editDialogue.character}
                                  onChange={(e) => setEditDialogue({ ...editDialogue, character: e.target.value })} />
                              )}
                              <div className="dialogue-edit-actions">
                                <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveEditDialogue}>Save</button>
                                <button type="button" className="btn btn-sm btn-secondary" onClick={handleCancelEditDialogue}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="dialogue-content">
                                <p><strong>Player:</strong> {dialogue.user}</p>
                                {isGroup
                                  ? <p style={{ whiteSpace: 'pre-wrap' }}><strong>Group:</strong> {dialogue.character}</p>
                                  : <p><strong>{formData.name || 'Character'}:</strong> {dialogue.character}</p>}
                              </div>
                              <div className="dialogue-actions">
                                <button type="button" className="btn-icon btn-edit-small" onClick={() => handleStartEditDialogue(i)} title="Edit">✏️</button>
                                <button type="button" className="btn-icon btn-delete-small" onClick={() => handleRemoveDialogue(i)} title="Delete">🗑️</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="add-dialogue">
                      <input type="text" placeholder="Player says..." value={newDialogue.user}
                        onChange={(e) => setNewDialogue({ ...newDialogue, user: e.target.value })} />
                      {isGroup ? (
                        <textarea placeholder={'The group responds — blend everyone:\nLana: *smiles* "Hey, baby."\nScarlett: *arches a brow* "Sit."'}
                          rows={5} value={newDialogue.character}
                          onChange={(e) => setNewDialogue({ ...newDialogue, character: e.target.value })} />
                      ) : (
                        <input type="text" placeholder="Character responds..." value={newDialogue.character}
                          onChange={(e) => setNewDialogue({ ...newDialogue, character: e.target.value })} />
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddDialogue}>Add</button>
                    </div>
                  </div>
                  </>

                  {/* Story Details — Card lore: Dictionary group selection + shared Library groups.
                      (Matches the release single-char Main tab; the Library tab holds only the entry editor.) */}
                  <div className="story-subsection">
                    <label className="subsection-label">Story Details</label>
                    <CardLoreSection activeStory={activeStory} updateStoryField={updateStoryField} />
                  </div>

                  {/* Auto Reply */}
                  <div className="story-field auto-reply-field">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={activeStory?.autoReplyEnabled || false}
                        onChange={(e) => updateStoryField('autoReplyEnabled', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <div className="auto-reply-text">
                      <span className="auto-reply-label">Auto Reply</span>
                      <span className="auto-reply-hint">Automatically send character response after player message</span>
                    </div>
                  </div>

                  {/* Group response mode — Respond as Group (blended reply) vs Individual Responses
                      (each member replies in their own named bubble, round-robin). Group layout only. */}
                  {isGroup && (
                    <div className="story-field" style={{ margin: '8px 0' }}>
                      <label className="subsection-label" style={{ display: 'block', marginBottom: 4 }}>Response Mode</label>
                      <div className="ab-toggle" style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color, #444)' }}>
                        {[['group', 'Respond as Group'], ['individual', 'Individual Responses']].map(([val, lbl]) => {
                          const active = (formData.multiChar?.responseMode || 'group') === val;
                          return (
                            <button key={val} type="button"
                              onClick={() => setFormData(prev => ({ ...prev, multiChar: { ...(prev.multiChar || {}), responseMode: val } }))}
                              style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontWeight: 600, background: active ? 'var(--accent-color, #6a4caf)' : 'transparent', color: active ? '#fff' : 'inherit' }}>
                              {lbl}
                            </button>
                          );
                        })}
                      </div>
                      <span className="auto-reply-hint" style={{ display: 'block', marginTop: 4 }}>
                        {(formData.multiChar?.responseMode || 'group') === 'individual'
                          ? 'Each non-muted member replies in their own named bubble (mentioned members first, then round-robin), using their own Response Tokens.'
                          : 'One blended reply where members speak together, shown under the Group Name.'}
                      </span>
                    </div>
                  )}

                  {/* AI Pump Control (formerly "Allow LLM Device Access") */}
                  <div className="story-field auto-reply-field">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={activeStory?.allowLlmDeviceAccess || false}
                        onChange={(e) => updateStoryField('allowLlmDeviceAccess', e.target.checked)}
                        disabled={!settings?.globalCharacterControls?.allowLlmDeviceControl}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <div className="auto-reply-text">
                      <span className="auto-reply-label">AI Pump Control</span>
                      <span className="auto-reply-hint">
                        {settings?.globalCharacterControls?.allowLlmDeviceControl
                          ? 'Allow this character to trigger device commands via LLM responses'
                          : 'Enable "Allow LLM Device Control" in Settings → Global first'}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* ---- Pumpable toggle + Default Pump Type + Manual Pump Maxes ----
                  In group mode the valid-inflation-target flag is per-member (Members tab); the
                  card-level pump settings below stay shared. ---- */}
              {!isGroup && (
                <div className="story-field auto-reply-field">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={formData.isPumpable || false} onChange={(e) => set({ isPumpable: e.target.checked })} />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">Is this character a valid inflation target?</span>
                    <span className="auto-reply-hint">Enables a capacity gauge on this character's portrait and allows flow nodes to inflate them</span>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Default Pump Type</label>
                <select value={formData.defaultPumpType || 'electric'} onChange={(e) => set({ defaultPumpType: e.target.value })}>
                  <option value="electric">Auto / Electric (E-STOP)</option>
                  <option value="bulb">Manual / Bulb (PUMP)</option>
                  <option value="bike">Manual / Bike (PUMP)</option>
                </select>
                <p className="section-hint">Session default when no checkpoint profile is loaded; a profile's Pump Type overrides it.</p>
              </div>

              {/* ---- Character inflation settings (gated on the card/group pump state) ---- */}
              {pumpUiActive && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="form-group">
                    <label>Calibration Time (seconds)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="number"
                        min={5}
                        max={600}
                        value={formData.charSyncCalibrationWithPlayer ? (playerPumpCalibration || formData.characterCalibrationTime || 60) : (formData.characterCalibrationTime || 60)}
                        onChange={(e) => set({ characterCalibrationTime: Math.min(600, Math.max(5, parseInt(e.target.value) || 60)) })}
                        disabled={formData.charSyncCalibrationWithPlayer}
                        style={{ width: '100px', opacity: formData.charSyncCalibrationWithPlayer ? 0.5 : 1 }}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={formData.charSyncCalibrationWithPlayer || false}
                          onChange={(e) => set({ charSyncCalibrationWithPlayer: e.target.checked })}
                        />
                        Synchronize with Player Primary Pump
                      </label>
                    </div>
                    <div className="form-hint">
                      How many seconds of simulated inflation to reach 100% capacity. This is purely visual — no real devices are triggered.
                      {formData.charSyncCalibrationWithPlayer
                        ? (playerPumpCalibration ? ` Synced to player pump: ${playerPumpCalibration}s.` : ' No primary pump configured yet.')
                        : ' Use "AI Pump" flow nodes to start and stop inflation.'}
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '0.5rem' }}>
                    <label>Burst Threshold (%)</label>
                    <input
                      type="number"
                      min={50}
                      max={200}
                      value={formData.charBurstPercent || 100}
                      onChange={(e) => set({ charBurstPercent: Math.min(200, Math.max(50, parseInt(e.target.value) || 100)) })}
                      style={{ width: '100px' }}
                    />
                    <div className="form-hint">
                      The capacity % at which this character pops. Inflation stops automatically at this threshold.
                      Values over 100% allow over-inflation before popping.
                    </div>
                    <div className="auto-reply-field" style={{ marginTop: '0.5rem' }}>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={formData.hideCharBurstFromDetails ?? true}
                          onChange={(e) => set({ hideCharBurstFromDetails: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                      <div className="auto-reply-text">
                        <span className="auto-reply-label">Hide from Details Panel</span>
                        <span className="auto-reply-hint">Hide character Auto-Pop threshold from the info panel in chat</span>
                      </div>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '1rem' }}>
                    <label>Character's Knowledge of Inflation</label>
                    <select value={formData.charInflateKnowledge || 'unaware'} onChange={(e) => set({ charInflateKnowledge: e.target.value })}>
                      <option value="unaware">Unaware — doesn't know what's happening</option>
                      <option value="confused">Confused — notices something but doesn't understand</option>
                      <option value="partial">Partial — understands the basics but not the full picture</option>
                      <option value="informed">Informed — knows exactly what inflation is and what's happening</option>
                      <option value="expert">Expert — deeply knowledgeable, may have experience</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginTop: '0.5rem' }}>
                    <label>Character's Desire to be Inflated</label>
                    <select value={formData.charInflateDesire || 'neutral'} onChange={(e) => set({ charInflateDesire: e.target.value })}>
                      <option value="terrified">Terrified — desperately does not want this</option>
                      <option value="reluctant">Reluctant — would prefer not to but may comply</option>
                      <option value="nervous">Nervous — anxious but not fully opposed</option>
                      <option value="neutral">Neutral — neither wants nor resists</option>
                      <option value="curious">Curious — intrigued and willing to try</option>
                      <option value="eager">Eager — actively wants to be inflated</option>
                      <option value="obsessed">Obsessed — craves inflation intensely</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginTop: '0.5rem' }}>
                    <label>Desire to be Popped</label>
                    <select value={formData.charPopDesire || 'terrified'} onChange={(e) => set({ charPopDesire: e.target.value })}>
                      <option value="terrified">Terrified — will do anything to avoid popping</option>
                      <option value="dreading">Dreading — deeply fears it but feels it coming</option>
                      <option value="anxious">Anxious — worried about the possibility</option>
                      <option value="resigned">Resigned — accepts it may happen</option>
                      <option value="indifferent">Indifferent — doesn't care either way</option>
                      <option value="curious">Curious — wonders what it would feel like</option>
                      <option value="willing">Willing — okay with popping if it happens</option>
                      <option value="eager">Eager — wants to pop</option>
                    </select>
                    <div className="form-hint">Affects AI behavior when character capacity reaches 60% or higher.</div>
                  </div>

                  <details style={{ marginTop: '1rem', padding: '10px', background: 'var(--bg-input, rgba(0,0,0,0.2))', borderRadius: 'var(--border-radius)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600 }}>System Variables</summary>
                    <div style={{ marginTop: '6px', lineHeight: 1.6 }}>
                      <code>[CharCapacity]</code> or <code>{'{{charCapacity}}'}</code> — Current character inflation % (0-100)<br/>
                      <code>[Capacity]</code> — Player inflation % (for reference)
                    </div>
                  </details>
                </div>
              )}
              {/* Bulb/Bike Pump Max moved to Settings → Pump Data → "Manual Pumps (NEW)" (#29). */}
            </>
          )}

          {/* ---- Session Defaults: skin / starting capacity / auto-capacity speed ---- */}
          <h4 style={{ margin: '8px 0 4px' }}>Session Defaults</h4>
          <p className="section-hint" style={{ marginTop: 0 }}>Starting values when beginning a new session with this story.</p>
          <div className="form-group">
            <label>Session Skin</label>
            <select value={activeStory?.skinId || ''} onChange={(e) => updateStoryField('skinId', e.target.value || '')}>
              <option value="">SwellDreams (Default)</option>
              {availableSkins.filter(s => s.id !== 'swelldreams-default').map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.builtIn ? ' (Built-in)' : ''}</option>
              ))}
            </select>
            <p className="section-hint">Auto-switch to this skin when a session starts with this story.</p>
          </div>
          <div className="form-group">
            <label>Starting Capacity — {activeStory?.startingCapacity || 0}%</label>
            <input type="range" min="0" max="100" step="5" value={activeStory?.startingCapacity || 0}
              onChange={(e) => updateStoryField('startingCapacity', parseInt(e.target.value, 10))} />
          </div>
          <div className="form-group">
            <label>Auto-Capacity Speed — {(activeStory?.startingCapacityModifier || 1.0).toFixed(2)}x</label>
            <input type="range" min="0.25" max="2" step="0.25" value={activeStory?.startingCapacityModifier || 1.0}
              onChange={(e) => updateStoryField('startingCapacityModifier', parseFloat(e.target.value))} />
            <p className="section-hint">How fast capacity rises in auto-mode.</p>
          </div>

          {formData.extensions?.v2v3Import && (
            <details className="form-group">
              <summary style={{ cursor: 'pointer', fontWeight: 600, margin: '8px 0 4px' }}>Original Imported Content (Reference)</summary>
              <p className="section-hint" style={{ color: 'var(--warning-color)' }}>Read-only originals from the imported card — write inflation-appropriate versions above.</p>
              {formData.extensions.v2v3Import.originalGreeting && (
                <><label>Original Welcome Message</label>
                  <textarea value={formData.extensions.v2v3Import.originalGreeting} readOnly rows={3} style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed' }} /></>
              )}
              {formData.extensions.v2v3Import.originalAlternateGreetings?.length > 0 && (
                <><label>Original Alternate Greetings ({formData.extensions.v2v3Import.originalAlternateGreetings.length})</label>
                  {formData.extensions.v2v3Import.originalAlternateGreetings.map((g, idx) => (
                    <textarea key={idx} value={g} readOnly rows={2} style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed', marginBottom: 6 }} />
                  ))}</>
              )}
              {formData.extensions.v2v3Import.originalScenario && (
                <><label>Original Scenario</label>
                  <textarea value={formData.extensions.v2v3Import.originalScenario} readOnly rows={2} style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed' }} /></>
              )}
            </details>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={addMember}>+ Add Character</button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={openSwellDPicker}>Import SwellD card…</button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => v2v3FileInputRef.current?.click()} disabled={importingV2V3}>
                    {importingV2V3 ? 'Importing…' : 'Import V2/V3…'}
                  </button>
                  <input ref={v2v3FileInputRef} type="file" accept=".png,.json,image/png,application/json" onChange={handleV2V3Import} style={{ display: 'none' }} />
                </div>
              </div>
            </div>

            {/* Per-member parameter fields only exist once the card is a group (>1 member).
                Base-only cards show just the member list + Add above; their identity fields
                live on the Main tab. */}
            {members.length > 1 && (<>
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

                {isGroup && (
                  <div className="form-group">
                    <label>Response Tokens <span className="section-hint">(this member's Individual-Responses reply; blank = card's Individual Response Tokens, then global)</span></label>
                    <input type="text" inputMode="numeric" value={member.responseTokens ?? ''}
                      onChange={(e) => updateMember(selectedMemberIndex, { responseTokens: e.target.value.replace(/[^0-9]/g, '') })}
                      placeholder="Leave blank to fall back to the card / global setting" style={{ maxWidth: 300 }} />
                  </div>
                )}

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

                {/* Per-member valid-inflation-target toggle (relocated from the Main tab).
                    The card/group-level inflation settings stay on the Main tab. */}
                <div className="story-field auto-reply-field">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={member.isPumpable || false}
                      onChange={(e) => updateMember(selectedMemberIndex, { isPumpable: e.target.checked })} />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">Is this character a valid inflation target?</span>
                    <span className="auto-reply-hint">Enables a capacity gauge on this member's portrait and allows flow nodes to inflate them</span>
                  </div>
                </div>

                {/* Per-member Attributes (memberAttributes[id]) — drives this member's Individual
                    Responses reply, and overrides the shared card attributes in group replies. */}
                {isGroup && (
                  <details className="form-group" style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Attributes <span className="section-hint">(this member — used in Individual Responses; overrides the shared card set)</span></summary>
                    <div style={{ marginTop: 8 }}>
                      <p className="section-hint">Each has a per-message activation chance for {member.name || 'this member'}. Leave all at 0 to fall back to the card's shared attributes.</p>
                      {[
                        { key: 'dominant', label: 'Dominant' }, { key: 'sadistic', label: 'Sadistic' },
                        { key: 'psychopathic', label: 'Psychopathic' }, { key: 'sensual', label: 'Sensual' }, { key: 'sexual', label: 'Sexual' },
                      ].map(({ key, label }) => (
                        <div className="form-group" key={key}>
                          <label>{label}: {(memberAttrs(member.id)[key]) || 0}%</label>
                          <input type="range" min="0" max="100" step="5" value={(memberAttrs(member.id)[key]) || 0}
                            onChange={(e) => setMemberAttr(member.id, { [key]: parseInt(e.target.value) })} style={{ width: '100%' }} />
                        </div>
                      ))}
                      <div className="form-group">
                        <label>Desire to Inflate Others</label>
                        <select value={memberAttrs(member.id).desireToInflateOthers ?? 'none'}
                          onChange={(e) => setMemberAttr(member.id, { desireToInflateOthers: e.target.value })}>
                          <option value="none">None</option><option value="reluctant">Reluctant</option><option value="indifferent">Indifferent</option><option value="willing">Willing</option><option value="eager">Eager</option><option value="obsessed">Obsessed</option><option value="sadistic">Sadistic</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Desire to Pop Others</label>
                        <select value={memberAttrs(member.id).desireToPopOthers ?? 'none'}
                          onChange={(e) => setMemberAttr(member.id, { desireToPopOthers: e.target.value })}>
                          <option value="none">None</option><option value="avoidant">Avoidant</option><option value="careless">Careless</option><option value="curious">Curious</option><option value="willing">Willing</option><option value="eager">Eager</option><option value="sadistic">Sadistic</option>
                        </select>
                      </div>
                    </div>
                  </details>
                )}
              </>
            )}

            <div className="form-group">
              <label>Individual Response Tokens</label>
              <input type="text" inputMode="numeric" value={formData.individualResponseTokens ?? ''}
                onChange={(e) => set({ individualResponseTokens: e.target.value.replace(/[^0-9]/g, '') })} placeholder="150" style={{ maxWidth: 220 }} />
              <p className="section-hint">Max tokens per individual reply when members respond one at a time. One value for the whole card. Default 150.</p>
            </div>
            </>)}
          </div>
        )}

        {/* ---- Checkpoints (shared component; instructor vs standard data kept separate via the stash) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'checkpoints' ? 'block' : 'none' }}>
          {(() => {
            // Group mode: pick which member's Checkpoint tab you're editing. The Base character (index 0)
            // edits the active story directly; non-base members edit their own checkpointStore. A single
            // "Primary" member's checkpoints drive the chat context (default = Base).
            const editingBase = !isGroup || selectedMemberIndex === 0;
            const ckptStory = editingBase ? activeStory : (member?.checkpointStore || {});
            const ckptUpdate = editingBase ? updateStoryField : ((field, value) => updateMemberCheckpoint(selectedMemberIndex, field, value));
            const primaryId = formData.primaryCheckpointMemberId || members[0]?.id;
            const primaryMember = members.find(m => m.id === primaryId) || members[0];
            return (
              <>
                {isGroup && (
                  <>
                    <div className="form-group">
                      <label>Edit checkpoints for</label>
                      <select className="multi-char-selector" value={selectedMemberIndex} onChange={(e) => setSelectedMemberIndex(parseInt(e.target.value, 10))}>
                        {members.map((m, i) => <option key={m.id || i} value={i}>{i === 0 ? `${m.name || 'Base character'} (Base)` : (m.name || `Character ${i + 1}`)}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <input type="checkbox" checked={primaryId === member?.id} disabled={primaryId === member?.id}
                          onChange={() => set({ primaryCheckpointMemberId: member?.id })} />
                        Primary — this member's checkpoints drive the chat context
                      </label>
                      <p className="section-hint">By default the Base character governs and no other members are read. Tick another member to hand the wheel to their checkpoints (capacity-driven story events). Currently primary: <strong>{primaryMember?.name || 'Base character'}</strong>.</p>
                    </div>
                  </>
                )}
                {ckptStory
                  ? <CheckpointProfiles story={ckptStory} updateStory={ckptUpdate} defaultPumpType={formData.defaultPumpType}
                      cardName={(isGroup && !editingBase ? member?.name : formData.name) || 'card'} triggerSets={triggerSets} rowProps={{ isPumpable: pumpUiActive }} />
                  : <p className="section-hint">No story yet.</p>}
              </>
            );
          })()}
        </div>

        {/* ---- Library (matches the release single-char Library tab: the lorebook-format
                entry editor only; Dictionary/shared groups live on the Main tab via CardLoreSection) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'library' ? 'block' : 'none' }}>
          {/* ---- Per-card lore entries (standard/group): author globalReminders via LoreEntryEditor ---- */}
          {!isInstructorMode && (
            <div className="reminders-editor">
              {!showReminderForm ? (
                <>
                  <div className="events-header">
                    <h4>Library</h4>
                    <div className="events-header-actions">
                      <input
                        type="file"
                        ref={lorebookFileInputRef}
                        onChange={handleLorebookImport}
                        accept=".json"
                        style={{ display: 'none' }}
                      />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleLorebookImportClick} disabled={importingLorebook}>
                        {importingLorebook ? 'Importing...' : '📚 Import Lorebook'}
                      </button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleAddReminder}>+ Add Entry</button>
                    </div>
                  </div>
                  <p className="section-hint">Character-specific Library entries. Blank keywords = always-on; add keywords to make an entry keyword-triggered.</p>

                  {/* V2/V3 Import Notice */}
                  {formData.extensions?.v2v3Import && ownEntries.length > 0 && (
                    <div style={{
                      padding: '12px',
                      marginBottom: '1rem',
                      backgroundColor: 'var(--info-bg)',
                      border: '1px solid var(--info-color)',
                      borderRadius: '4px',
                      fontSize: '0.9em'
                    }}>
                      <strong>📚 Imported Lorebook</strong>
                      <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)' }}>
                        These reminders were imported from the character's lorebook (character_book).
                        Keyword-triggered entries will only activate when their keywords appear in the conversation.
                      </p>
                    </div>
                  )}

                  <div className="events-list-editor">
                    {ownEntries.length === 0 ? (
                      <p className="empty-message">No Library entries yet.</p>
                    ) : (
                      ownEntries.map((reminder) => (
                        <div key={reminder.id} className={`event-item ${reminder.enabled === false ? 'disabled' : ''}`}>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={reminder.enabled !== false}
                              onChange={(e) => handleToggleReminder(reminder.id, e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="event-info">
                            <div className={`event-name ${reminder.enabled === false ? 'strikethrough' : ''}`}>
                              {reminder.name}
                              <span className={`target-badge ${reminder.target || 'character'}`}>
                                {reminder.target === 'player' ? 'Player' : 'Character'}
                              </span>
                              {reminder.constant === false && (
                                <span className="keyword-badge" title={`Triggers: ${(reminder.keys || []).join(', ')}`}>
                                  🔑 {reminder.keys?.length || 0} keys
                                </span>
                              )}
                              {(reminder.priority !== undefined && reminder.priority !== 100) && (
                                <span className="priority-badge" title="Priority">
                                  P{reminder.priority}
                                </span>
                              )}
                            </div>
                            <div className="event-meta">{(reminder.text || '').substring(0, 60)}{(reminder.text || '').length > 60 ? '...' : ''}</div>
                          </div>
                          <div className="event-actions">
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleEditReminder(reminder)}>Edit</button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteReminder(reminder.id)}>Delete</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="event-form">
                  <h4>{editingReminderId ? 'Edit' : 'Add'} Library Entry</h4>
                  <LoreEntryEditor
                    entry={{ ...reminderForm, title: reminderForm.name, content: reminderForm.text }}
                    onChange={(c) => setReminderForm({ ...reminderForm, ...c, name: c.title, text: c.content })}
                  />
                  <div className="event-form-buttons">
                    <button type="button" className="btn btn-secondary" onClick={handleCancelReminderEdit}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={handleSaveReminder}>{editingReminderId ? 'Update' : 'Create'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
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
                {/* Button Sets: swap whole sets of buttons on the fly. Isolated by card mode. */}
                <div className="checkpoint-profile-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <span className="section-hint">Button Set <em>({cardMode})</em>:</span>
                  <select value={formData.activeButtonSetId || ''} onChange={(e) => loadButtonSet(e.target.value)}>
                    <option value="">(current — unsaved)</option>
                    {modeButtonSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={saveButtonSet}>Save as Set</button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={updateButtonSet} disabled={!activeButtonSet}>Update</button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={renameButtonSet} disabled={!activeButtonSet}>Rename</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={deleteButtonSet} disabled={!activeButtonSet}>Delete</button>
                </div>
                <p className="section-hint" style={{ marginTop: 0 }}>Load a set to swap this card's buttons on the fly. Sets are separate for single, group, and instructor modes; they are not tied to a version or story.</p>

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
                              <>
                                {isGroup && (
                                  <select value={action.config.memberId || ''} onChange={(e) => handleUpdateAction(index, 'memberId', e.target.value)} title="Which member sends this message">
                                    <option value="">Whole group (any member)</option>
                                    {members.map((m, mi) => <option key={m.id || mi} value={m.id}>{m.name || (mi === 0 ? 'Base character' : `Character ${mi + 1}`)}</option>)}
                                  </select>
                                )}
                                <textarea value={action.config.text || ''} onChange={(e) => handleUpdateAction(index, 'text', e.target.value)} placeholder="Instruction for AI..." rows={2} />
                              </>
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

        {/* ---- Attributes tab (per-character in group mode; card/story level otherwise) ---- */}
        <div className="modal-body character-modal-body" style={{ display: activeTab === 'attributes' ? 'block' : 'none' }}>
          {(() => {
            // Groups edit the SHARED card attributes here — they apply to the whole group / blended
            // reply. Per-member attributes + dispositions live in the Members tab. Single cards keep
            // attributes + dispositions at the card/story level, exactly as before.
            const getAttr = (key) => (activeStory?.attributes?.[key]) || 0;
            const setAttr = (key, v) => updateStoryField('attributes', { ...(activeStory?.attributes || {}), [key]: v });
            const getDisp = (field, dflt) => (formData[field] ?? dflt);
            const setDisp = (field, v) => setFormData(prev => ({ ...prev, [field]: v }));
            return (
          <div className="session-defaults-editor">
            {isGroup && (
              <p className="section-hint" style={{ marginBottom: 12 }}>These attributes apply to the <strong>entire card</strong> — all members roll from this shared set into the group's blended reply. To give a member its own attributes, use the <strong>Attributes</strong> section in the Members tab (and switch to Individual Responses mode).</p>
            )}
            <h4>Personality Attributes</h4>
            <p className="section-hint">Each attribute has a chance to activate per message. When active, it injects personality-driving instructions for that response. Multiple attributes can fire simultaneously.</p>

            {[
              { key: 'dominant', label: 'Dominant', hint: 'Take control of the situation. Be assertive, commanding, and decisive.' },
              { key: 'sadistic', label: 'Sadistic', hint: 'Be cruel, teasing, and take pleasure in discomfort.' },
              { key: 'psychopathic', label: 'Psychopathic', hint: 'Be unhinged, unpredictable, and unsettling.' },
              { key: 'sensual', label: 'Sensual', hint: 'Be caring, tender, and amorous. Focus on intimacy and connection.' },
              { key: 'sexual', label: 'Sexual', hint: 'Be overtly aroused and flirtatious. Express desire openly.' }
            ].map(({ key, label, hint }) => (
              <div className="form-group" key={key}>
                <label>{label}: {getAttr(key)}%</label>
                <p className="section-hint">{hint}</p>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={getAttr(key)}
                  onChange={(e) => setAttr(key, parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            ))}

            {!isGroup && (<>
            <h4 style={{ marginTop: '1.5rem' }}>Inflation Disposition</h4>
            <p className="section-hint">These are always active and affect every AI response. They define this character's baseline attitude toward inflating and popping others.</p>

            <div className="form-group">
              <label>Desire to Inflate Others</label>
              <select
                value={getDisp('desireToInflateOthers', 'none')}
                onChange={(e) => setDisp('desireToInflateOthers', e.target.value)}
              >
                <option value="none">None — no interest in inflating others</option>
                <option value="reluctant">Reluctant — would only inflate others if forced</option>
                <option value="indifferent">Indifferent — doesn't care either way</option>
                <option value="willing">Willing — happy to inflate others if asked</option>
                <option value="eager">Eager — actively wants to inflate others</option>
                <option value="obsessed">Obsessed — driven to inflate others at every opportunity</option>
                <option value="sadistic">Sadistic — inflates others specifically to cause discomfort</option>
              </select>
            </div>

            <div className="form-group">
              <label>Desire to Pop Others</label>
              <select
                value={getDisp('desireToPopOthers', 'none')}
                onChange={(e) => setDisp('desireToPopOthers', e.target.value)}
              >
                <option value="none">None — would never intentionally pop someone</option>
                <option value="avoidant">Avoidant — actively tries to prevent popping</option>
                <option value="careless">Careless — doesn't worry about it happening</option>
                <option value="curious">Curious — wonders what would happen</option>
                <option value="willing">Willing — okay with it if it happens</option>
                <option value="eager">Eager — actively tries to push others to pop</option>
                <option value="sadistic">Sadistic — wants to make others pop and enjoys it</option>
              </select>
            </div>
            </>)}
          </div>
            );
          })()}
        </div>

        {/* ---- Staged Portraits tab (ported from old charPortraits; gated on isPumpable) ---- */}
        {!isInstructorMode && formData.isPumpable && (
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'charPortraits' ? 'block' : 'none' }}>
            <div className="staged-portraits-section">
              <p className="section-hint">
                Upload portraits (images or videos) for capacity ranges. Videos loop as idle animations.
                Transition videos play once when crossing into a range. Empty slots inherit from the nearest lower range.
                {!character?.id && <strong> Save the character first to enable video uploads.</strong>}
              </p>

              {/* Export/Import Buttons */}
              {character?.id && (
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const folder = character._isDefault ? 'default' : 'custom';
                      window.open(`/api/export/portrait-media/chars/${folder}/${character.id}`, '_blank');
                    }}
                  >
                    Export Portraits (Zip)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => document.getElementById('portrait-zip-import')?.click()}
                  >
                    Import Portraits (Zip)
                  </button>
                  <input
                    id="portrait-zip-import"
                    type="file"
                    accept=".zip"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = '';
                      const folder = character._isDefault ? 'default' : 'custom';
                      const form = new FormData();
                      form.append('file', file);
                      try {
                        const res = await fetch(`/api/import/portrait-media/chars/${folder}/${character.id}`, {
                          method: 'POST',
                          body: form,
                        });
                        const result = await res.json();
                        if (result.success) {
                          alert(`Imported ${result.filesImported} portrait files. Reload the character to see changes.`);
                        } else {
                          alert('Import failed: ' + (result.error || 'Unknown error'));
                        }
                      } catch (err) {
                        alert('Import failed: ' + err.message);
                      }
                    }}
                  />
                </div>
              )}

              {/* Batch Crop/Position */}
              <div className="portrait-crop-editor">
                <h4>Batch Crop / Position</h4>
                <p className="section-hint">These values apply to ALL portrait media uniformly.</p>
                <div className="crop-controls">
                  <label>
                    Scale: {(formData.charPortraitCrop?.scale || 1).toFixed(2)}x
                    <input type="range" min="0.5" max="2" step="0.05"
                      value={formData.charPortraitCrop?.scale || 1}
                      onChange={(e) => handleCropChange('scale', parseFloat(e.target.value))}
                    />
                  </label>
                  <label>
                    Offset X: {formData.charPortraitCrop?.offsetX || 0}px
                    <input type="range" min="-100" max="100" step="1"
                      value={formData.charPortraitCrop?.offsetX || 0}
                      onChange={(e) => handleCropChange('offsetX', parseInt(e.target.value))}
                    />
                  </label>
                  <label>
                    Offset Y: {formData.charPortraitCrop?.offsetY || 0}px
                    <input type="range" min="-100" max="100" step="1"
                      value={formData.charPortraitCrop?.offsetY || 0}
                      onChange={(e) => handleCropChange('offsetY', parseInt(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              {/* Range Grid */}
              <div className="staged-portraits-grid">
                {[...STAGED_PORTRAIT_RANGES.filter(r => !r.isPop), { id: 'burst', label: 'BURST', isPop: true }].map((range) => {
                  const media = formData.charPortraitMedia?.[range.id];
                  const legacyImg = formData.charStagedPortraits?.[range.id];
                  const idleUrl = media?.idle || legacyImg;
                  const idleType = media?.idleType || (idleUrl ? 'image' : null);
                  const transUrl = media?.trans;

                  return (
                    <div key={range.id} className={`staged-portrait-card ${range.isPop ? 'pop-range' : ''}`}>
                      <div className="staged-portrait-label">{range.label}</div>

                      {/* Idle slot */}
                      <div className="media-slot">
                        <div className="media-slot-label">Idle {idleType === 'video' ? '(video)' : idleType === 'image' ? '(image)' : ''}</div>
                        <div
                          className="staged-portrait-upload"
                          onClick={() => charMediaIdleRefs.current[range.id]?.click()}
                        >
                          {idleUrl ? (
                            idleType === 'video' ? (
                              <video src={idleUrl} className="staged-portrait-preview" muted loop autoPlay playsInline />
                            ) : (
                              <img src={idleUrl} alt={`Idle for ${range.label}`} className="staged-portrait-preview" />
                            )
                          ) : (
                            <div className="staged-portrait-placeholder">
                              <span className="upload-icon">+</span>
                            </div>
                          )}
                        </div>
                        <input
                          ref={(el) => { charMediaIdleRefs.current[range.id] = el; }}
                          type="file"
                          accept="image/*,video/mp4,video/webm"
                          onChange={(e) => handleIdleUpload(e, range.id)}
                          style={{ display: 'none' }}
                        />
                        {idleUrl && (
                          <button type="button" className="btn btn-secondary btn-sm staged-portrait-remove"
                            onClick={(e) => { e.stopPropagation(); handleRemoveIdle(range.id); }}>
                            Remove
                          </button>
                        )}
                      </div>

                      {/* Transition slot */}
                      <div className="media-slot">
                        <div className="media-slot-label">Transition {transUrl ? '(video)' : ''}</div>
                        <div
                          className="staged-portrait-upload transition-slot"
                          onClick={() => character?.id && charMediaTransRefs.current[range.id]?.click()}
                          style={{ opacity: character?.id ? 1 : 0.4 }}
                        >
                          {transUrl ? (
                            <video src={transUrl} className="staged-portrait-preview" muted playsInline />
                          ) : (
                            <div className="staged-portrait-placeholder">
                              <span className="upload-icon">+</span>
                              <span className="upload-hint">video</span>
                            </div>
                          )}
                        </div>
                        <input
                          ref={(el) => { charMediaTransRefs.current[range.id] = el; }}
                          type="file"
                          accept="video/mp4,video/webm"
                          onChange={(e) => handleTransUpload(e, range.id)}
                          style={{ display: 'none' }}
                        />
                        {transUrl && (
                          <button type="button" className="btn btn-secondary btn-sm staged-portrait-remove"
                            onClick={(e) => { e.stopPropagation(); handleRemoveTrans(range.id); }}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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

      {/* ---- Import SwellD card → member: two-pane picker (list | portrait + description) ---- */}
      {showSwellDPicker && (() => {
        const sel = swellDList.find(c => c.id === selectedSwellDId);
        const selStory = sel?.stories?.find(s => s.id === sel.activeStoryId) || sel?.stories?.[0];
        const selDesc = sel?.description || selStory?.description || '';
        return (
          <div className="modal-overlay" onClick={() => setShowSwellDPicker(false)}>
            <div className="modal" style={{ maxWidth: 640, width: '90%' }} onClick={(e) => e.stopPropagation()}>
              <div className="character-modal-header">
                <h3>Import SwellD card as member</h3>
                <button className="modal-close" onClick={() => setShowSwellDPicker(false)}>×</button>
              </div>
              <div className="modal-body" style={{ display: 'flex', gap: 16, minHeight: 280 }}>
                <div style={{ flex: '0 0 200px', borderRight: '1px solid var(--border-color, rgba(255,255,255,0.1))', paddingRight: 12, overflowY: 'auto', maxHeight: 360 }}>
                  {swellDList.map(c => (
                    <div key={c.id}
                      onClick={() => setSelectedSwellDId(c.id)}
                      className={`tree-check ${selectedSwellDId === c.id ? 'active' : ''}`}
                      style={{ padding: '6px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: selectedSwellDId === c.id ? 700 : 400, background: selectedSwellDId === c.id ? 'var(--bg-input, rgba(255,255,255,0.08))' : 'transparent' }}>
                      {c.name || '(unnamed)'}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sel ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        {sel.avatar
                          ? <img src={sel.avatar} alt={sel.name} style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 8, objectFit: 'cover' }} />
                          : <div className="avatar-placeholder" style={{ height: 160, width: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}>No portrait</div>}
                      </div>
                      <h4 style={{ margin: '4px 0' }}>{sel.name || '(unnamed)'}</h4>
                      <p className="section-hint" style={{ whiteSpace: 'pre-wrap', overflowY: 'auto', maxHeight: 120 }}>{selDesc || 'No description.'}</p>
                    </>
                  ) : <p className="section-hint">Select a card on the left.</p>}
                </div>
              </div>
              <div className="character-modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSwellDPicker(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={confirmSwellDImport} disabled={!sel}>Import</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Ensure a story carries v2 welcomeMessages[]/scenarios[] arrays, migrating legacy
// single-string welcomeMessage/scenario fields. Non-destructive: the source story is
// spread first, so only the version arrays + active ids are normalized/filled.
function migrateStoryToV2(story, character) {
  let welcomeMessages = story.welcomeMessages;
  let activeWelcomeMessageId = story.activeWelcomeMessageId;
  const wmEmpty = !Array.isArray(welcomeMessages) || welcomeMessages.length === 0 ||
    (welcomeMessages.length === 1 && !welcomeMessages[0]?.text);
  if (wmEmpty) {
    if (story.welcomeMessage) welcomeMessages = [{ id: 'wm-1', text: story.welcomeMessage, llmEnhanced: story.llmEnhanced || false }];
    else if (character?.welcomeMessages?.length > 0 && character.welcomeMessages[0]?.text) welcomeMessages = character.welcomeMessages;
    else welcomeMessages = [{ id: 'wm-1', text: '', llmEnhanced: false }];
    activeWelcomeMessageId = welcomeMessages[0]?.id || null;
  }
  let scenarios = story.scenarios;
  let activeScenarioId = story.activeScenarioId;
  const scEmpty = !Array.isArray(scenarios) || scenarios.length === 0 ||
    (scenarios.length === 1 && !scenarios[0]?.text);
  if (scEmpty) {
    if (story.scenario) scenarios = [{ id: 'sc-1', text: story.scenario }];
    else if (character?.scenarios?.length > 0 && character.scenarios[0]?.text) scenarios = character.scenarios;
    else scenarios = [{ id: 'sc-1', text: '' }];
    activeScenarioId = scenarios[0]?.id || null;
  }
  const finalWmId = welcomeMessages.find(wm => wm.id === activeWelcomeMessageId)?.id || welcomeMessages[0]?.id;
  const finalScId = scenarios.find(sc => sc.id === activeScenarioId)?.id || scenarios[0]?.id;
  return {
    ...story,
    welcomeMessages,
    activeWelcomeMessageId: finalWmId,
    scenarios,
    activeScenarioId: finalScId,
    exampleDialogues: story.exampleDialogues || [],
  };
}

// Seed a unified card from an existing character (any legacy type) or a blank one.
// CRITICAL: spread the source FIRST so no top-level field is dropped on load — the
// explicit keys below only fill DEFAULTS for absent fields. formData is then a true
// superset of the card and the load/save round-trip is loss-free.
function buildInitial(character, defaultAuthorsNote) {
  const c = character || {};
  const stories = (c.stories || [{ id: 'story-1', name: 'Story', checkpointProfiles: [] }]).map(s => migrateStoryToV2(s, c));

  // ---- One-time migration: fold the retired flat group* keys into the active story ----
  // The old group-mode editor wrote greeting/scenario/dialogue to flat groupGreeting/
  // groupScenario/groupDialog/groupStory keys the backend never read (write-only dead ends).
  // Move any content the user already typed into the story arrays the backend DOES read, then
  // drop the dead keys so cards stop carrying them. Only seeds where the story slot is empty,
  // so it never clobbers real story content.
  const activeId = c.activeStoryId || stories[0]?.id || 'story-1';
  const aIdx = Math.max(0, stories.findIndex(s => s.id === activeId));
  const aStory = stories[aIdx];
  if (aStory) {
    if (c.groupGreeting && (aStory.welcomeMessages || []).every(w => !w?.text)) {
      aStory.welcomeMessages = [{ id: `wm-${Date.now()}`, text: c.groupGreeting, llmEnhanced: false }];
      aStory.activeWelcomeMessageId = aStory.welcomeMessages[0].id;
    }
    if (c.groupScenario && (aStory.scenarios || []).every(s => !s?.text)) {
      aStory.scenarios = [{ id: `sc-${Date.now()}`, text: c.groupScenario }];
      aStory.activeScenarioId = aStory.scenarios[0].id;
    }
    if (Array.isArray(c.groupDialog) && c.groupDialog.length && !(aStory.exampleDialogues || []).length) {
      aStory.exampleDialogues = c.groupDialog.map(d => ({ user: d.user || '', character: d.character || '' }));
    }
    if (c.groupStory && (aStory.name === 'Story' || !aStory.name)) aStory.name = c.groupStory;
    // New cards: tick the built-in "Inflation Tools" dictionary group by default.
    if (!character && !Array.isArray(aStory.dictionaryGroupIds)) {
      aStory.dictionaryGroupIds = ['dict-builtin-inflation-tools'];
    }
    stories[aIdx] = aStory;
  }
  // Drop the retired flat keys from the spread so the saved card no longer carries them.
  const { groupStory: _gs, groupGreeting: _gg, groupScenario: _gsc, groupResponseTokens: _grt, groupDialog: _gd, ...rest } = c;

  return {
    ...rest,
    id: c.id,
    name: c.name || '',
    // List-only label; never sent to the AI (no prompt builder reads it).
    shortDescription: c.shortDescription || '',
    avatar: c.avatar || '',
    gender: c.gender || '',
    description: c.description || '',
    personality: c.personality || '',
    responseTokens: c.responseTokens ?? '',
    historyDepth: c.historyDepth ?? '',
    instructor: c.instructor || { enabled: false },
    multiChar: (() => {
      const mc = c.multiChar || { enabled: false, characters: [{ id: `m-${Date.now()}`, name: c.name || '' }] };
      // Backfill the BASE member's description/personality/portrait from the card ONLY when absent
      // (undefined), so a deliberately-cleared ('') value is preserved across reopens.
      const chars = (mc.characters || []).map((m, i) => i === 0
        ? { ...m,
            description: m.description === undefined ? (c.description || '') : m.description,
            personality: m.personality === undefined ? (c.personality || '') : m.personality,
            portrait: m.portrait === undefined ? (c.avatar || '') : m.portrait }
        : m);
      return { ...mc, characters: chars };
    })(),
    // Author's Note migrates onto the card; legacy cards seed from the global default.
    authorsNote: c.authorsNote ?? defaultAuthorsNote ?? '',
    mission: c.mission || '',
    instructorProfileId: c.instructorProfileId || '',
    instructorDisposition: c.instructorDisposition || 'knowledgeable',
    instructorLibraryGroupIds: c.instructorLibraryGroupIds || [],
    isPumpable: c.isPumpable || false,
    defaultPumpType: c.defaultPumpType || 'electric',
    // Character inflation settings (gated on isPumpable in the UI).
    characterCalibrationTime: c.characterCalibrationTime || 60,
    charBurstPercent: c.charBurstPercent || 100,
    hideCharBurstFromDetails: c.hideCharBurstFromDetails ?? true,
    charSyncCalibrationWithPlayer: c.charSyncCalibrationWithPlayer || false,
    charInflateKnowledge: c.charInflateKnowledge || 'unaware',
    charInflateDesire: c.charInflateDesire || 'neutral',
    charPopDesire: c.charPopDesire || 'terrified',
    // Staged portrait media.
    charStagedPortraits: c.charStagedPortraits || {},
    charPortraitMedia: c.charPortraitMedia || {},
    charPortraitCrop: c.charPortraitCrop || { scale: 1, offsetX: 0, offsetY: 0 },
    buttons: c.buttons || c.events || [],
    buttonSets: Array.isArray(c.buttonSets) ? c.buttonSets : [],
    activeButtonSetId: c.activeButtonSetId || '',
    stories,
    activeStoryId: c.activeStoryId || stories[0]?.id || 'story-1',
    versions: c.versions || [],
    activeVersionId: c.activeVersionId || null,
    standardStash: c.standardStash || null,
    instructorStash: c.instructorStash || null,
  };
}

export default UnifiedCharacterEditor;
