import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useDraft, getDraftKey } from '../../hooks/useDraft';
import { STAGED_PORTRAIT_RANGES } from '../../utils/stagedPortraits';
import KeywordInput from '../common/KeywordInput';
import TriggerRow from '../common/TriggerRow';
import { EMOTIONS } from '../../constants/stateValues';
import './CharacterEditorModal.css';

// Migration function to ensure story data has v2 format (welcomeMessages[] and scenarios[] arrays)
function migrateStoryToV2(story, character) {
  let welcomeMessages = story.welcomeMessages;
  let activeWelcomeMessageId = story.activeWelcomeMessageId;

  // Check if welcomeMessages is missing, empty, or only has empty entries
  const wmEmpty = !Array.isArray(welcomeMessages) ||
    welcomeMessages.length === 0 ||
    (welcomeMessages.length === 1 && !welcomeMessages[0]?.text);

  // Convert v1 single welcomeMessage to v2 welcomeMessages array
  if (wmEmpty) {
    if (story.welcomeMessage) {
      welcomeMessages = [{ id: 'wm-1', text: story.welcomeMessage, llmEnhanced: story.llmEnhanced || false }];
    } else if (character?.welcomeMessages?.length > 0 && character.welcomeMessages[0]?.text) {
      // Pull from character top-level if available and has content
      welcomeMessages = character.welcomeMessages;
    } else {
      welcomeMessages = [{ id: 'wm-1', text: '', llmEnhanced: false }];
    }
    activeWelcomeMessageId = welcomeMessages[0]?.id || null;
  }

  let scenarios = story.scenarios;
  let activeScenarioId = story.activeScenarioId;

  // Check if scenarios is missing, empty, or only has empty entries
  const scEmpty = !Array.isArray(scenarios) ||
    scenarios.length === 0 ||
    (scenarios.length === 1 && !scenarios[0]?.text);

  // Convert v1 single scenario to v2 scenarios array
  if (scEmpty) {
    if (story.scenario) {
      scenarios = [{ id: 'sc-1', text: story.scenario }];
    } else if (character?.scenarios?.length > 0 && character.scenarios[0]?.text) {
      // Pull from character top-level if available and has content
      scenarios = character.scenarios;
    } else {
      scenarios = [{ id: 'sc-1', text: '' }];
    }
    activeScenarioId = scenarios[0]?.id || null;
  }

  // Ensure activeIds point to existing messages
  const finalWmId = welcomeMessages.find(wm => wm.id === activeWelcomeMessageId)?.id ||
    welcomeMessages.find(wm => wm.id === story.activeWelcomeMessageId)?.id ||
    welcomeMessages[0]?.id;
  const finalScId = scenarios.find(sc => sc.id === activeScenarioId)?.id ||
    scenarios.find(sc => sc.id === story.activeScenarioId)?.id ||
    scenarios[0]?.id;

  return {
    ...story,
    welcomeMessages,
    activeWelcomeMessageId: finalWmId,
    scenarios,
    activeScenarioId: finalScId,
    exampleDialogues: story.exampleDialogues || [],
    autoReplyEnabled: story.autoReplyEnabled ?? character?.autoReplyEnabled ?? false,
    allowLlmDeviceAccess: story.allowLlmDeviceAccess ?? character?.allowLlmDeviceAccess ?? false,
    assignedFlows: story.assignedFlows || character?.assignedFlows || [],
    assignedButtons: story.assignedButtons || [],
    constantReminderIds: story.constantReminderIds || [],
    globalReminderIds: story.globalReminderIds || [],
    startingEmotion: story.startingEmotion || character?.startingEmotion || 'neutral'
  };
}

function CharacterEditorModal({ isOpen, onClose, onSave, character }) {
  const { flows, devices, settings, personas, api } = useApp();

  // Player's primary pump calibration time
  const playerPumpCalibration = useMemo(() => {
    const pump = devices?.find(d => d.isPrimaryPump || d.deviceType === 'PUMP');
    return pump?.calibrationTime || null;
  }, [devices]);

  // System-level global reminders from settings
  const systemGlobalReminders = settings?.globalReminders || [];

  // Helper to filter out flow IDs that no longer exist
  const validFlowIds = useMemo(() => new Set((flows || []).map(f => f.id)), [flows]);
  const filterValidFlows = useCallback((flowIds) => {
    if (!flowIds || !Array.isArray(flowIds)) return [];
    return flowIds.filter(id => validFlowIds.has(id));
  }, [validFlowIds]);

  // Calculate initial data from character prop
  const initialData = useMemo(() => {
    if (character) {
      // Handle v2 story format with welcomeMessages[] and scenarios[] arrays
      let stories = character.stories || [];

      if (stories.length === 0) {
        // Create default story structure
        const welcomeMessages = character.welcomeMessages || [{ id: 'wm-1', text: '', llmEnhanced: false }];
        const scenarios = character.scenarios || [{ id: 'sc-1', text: '' }];

        stories = [{
          id: 'story-1',
          name: 'Story 1',
          welcomeMessages,
          activeWelcomeMessageId: character.activeWelcomeMessageId || welcomeMessages[0]?.id,
          scenarios,
          activeScenarioId: character.activeScenarioId || scenarios[0]?.id,
          exampleDialogues: character.exampleDialogues || [],
          autoReplyEnabled: character.autoReplyEnabled || false,
          allowLlmDeviceAccess: character.allowLlmDeviceAccess || false,
          assignedFlows: filterValidFlows(character.assignedFlows),
          assignedButtons: [],
          constantReminderIds: [],
          globalReminderIds: [],
          startingEmotion: character.startingEmotion || 'neutral',
          intensity: character.intensity || '',
          spoilers: character.spoilers || [],
          checkpoints: {},
          attributes: {}
        }];
      } else {
        // Ensure existing stories have v2 format
        stories = stories.map(s => {
          // Convert v1 single values to v2 arrays if needed
          let welcomeMessages = s.welcomeMessages;
          let activeWelcomeMessageId = s.activeWelcomeMessageId;
          if (!Array.isArray(welcomeMessages)) {
            welcomeMessages = s.welcomeMessage ? [{ id: 'wm-1', text: s.welcomeMessage, llmEnhanced: s.llmEnhanced || false }] : [];
            activeWelcomeMessageId = welcomeMessages[0]?.id || null;
          }

          let scenarios = s.scenarios;
          let activeScenarioId = s.activeScenarioId;
          if (!Array.isArray(scenarios)) {
            scenarios = s.scenario ? [{ id: 'sc-1', text: s.scenario }] : [];
            activeScenarioId = scenarios[0]?.id || null;
          }

          return {
            ...s,
            welcomeMessages,
            activeWelcomeMessageId,
            scenarios,
            activeScenarioId,
            exampleDialogues: s.exampleDialogues || [],
            autoReplyEnabled: s.autoReplyEnabled ?? character.autoReplyEnabled ?? false,
            allowLlmDeviceAccess: s.allowLlmDeviceAccess ?? character.allowLlmDeviceAccess ?? false,
            assignedFlows: filterValidFlows(s.assignedFlows || character.assignedFlows),
            assignedButtons: s.assignedButtons || [],
            constantReminderIds: s.constantReminderIds || [],
            globalReminderIds: s.globalReminderIds || [],
            startingEmotion: s.startingEmotion || character.startingEmotion || 'neutral'
          };
        });
      }

      return {
        name: character.name || '',
        avatar: character.avatar || '',
        description: character.description || '',
        personality: character.personality || '',
        isPumpable: character.isPumpable || false,
        characterCalibrationTime: character.characterCalibrationTime || 60,
        charBurstPercent: character.charBurstPercent || 100,
        hideCharBurstFromDetails: character.hideCharBurstFromDetails ?? true,
        charSyncCalibrationWithPlayer: character.charSyncCalibrationWithPlayer || false,
        charInflateKnowledge: character.charInflateKnowledge || 'unaware',
        charInflateDesire: character.charInflateDesire || 'neutral',
        charPopDesire: character.charPopDesire || 'terrified',
        charInflateAutoLoadControls: character.charInflateAutoLoadControls || false,
        charStagedPortraits: character.charStagedPortraits || {},
        charPortraitMedia: character.charPortraitMedia || {},
        charPortraitCrop: character.charPortraitCrop || { scale: 1, offsetX: 0, offsetY: 0 },
        desireToInflateOthers: character.desireToInflateOthers || 'none',
        desireToPopOthers: character.desireToPopOthers || 'none',
        stories,
        activeStoryId: character.activeStoryId || stories[0]?.id || 'story-1',
        buttons: character.buttons || character.events || [],
        globalReminders: character.globalReminders || character.constantReminders || [],
        sessionDefaults: character.sessionDefaults || {
          capacity: 0,
          pain: 0,
          emotion: 'neutral',
          capacityModifier: 1.0
        }
      };
    }

    // New character defaults (v2 format)
    const defaultStory = {
      id: 'story-1',
      name: 'Story 1',
      welcomeMessages: [{ id: 'wm-1', text: '', llmEnhanced: false }],
      activeWelcomeMessageId: 'wm-1',
      scenarios: [{ id: 'sc-1', text: '' }],
      activeScenarioId: 'sc-1',
      exampleDialogues: [],
      autoReplyEnabled: false,
      allowLlmDeviceAccess: false,
      assignedFlows: [],
      assignedButtons: [],
      constantReminderIds: [],
      globalReminderIds: [],
      startingEmotion: 'neutral',
      intensity: '',
      spoilers: [],
      checkpoints: {},
      attributes: {}
    };

    return {
      name: '',
      avatar: '',
      description: '',
      personality: '',
      isPumpable: false,
      characterCalibrationTime: 60,
      charBurstPercent: 100,
      hideCharBurstFromDetails: true,
      charSyncCalibrationWithPlayer: false,
      charInflateKnowledge: 'unaware',
      charInflateDesire: 'neutral',
      charPopDesire: 'terrified',
      charInflateAutoLoadControls: false,
      charStagedPortraits: {},
      charPortraitMedia: {},
      charPortraitCrop: { scale: 1, offsetX: 0, offsetY: 0 },
      desireToInflateOthers: 'none',
      desireToPopOthers: 'none',
      stories: [defaultStory],
      activeStoryId: 'story-1',
      buttons: [],
      globalReminders: [],
      sessionDefaults: {
        capacity: 0,
        pain: 0,
        emotion: 'neutral',
        capacityModifier: 1.0
      }
    };
  }, [character, filterValidFlows]);

  // Use draft persistence - enable for both new and existing characters
  const draftKey = getDraftKey('character', character?.id);
  const { formData, setFormData, clearDraft, hasDraft } = useDraft(draftKey, initialData, isOpen);

  // Migrate draft data to v2 format if needed (only runs when loading from a draft, not from initialData)
  useEffect(() => {
    // Only migrate if we're loading from a draft - initialData is already in correct format
    if (!isOpen || !formData.stories || !hasDraft) return;

    // Check if any story needs migration (missing arrays, empty arrays, or arrays with only empty content)
    const needsMigration = formData.stories.some(s => {
      const wmEmpty = !Array.isArray(s.welcomeMessages) ||
        s.welcomeMessages.length === 0 ||
        (s.welcomeMessages.length === 1 && !s.welcomeMessages[0]?.text);
      const scEmpty = !Array.isArray(s.scenarios) ||
        s.scenarios.length === 0 ||
        (s.scenarios.length === 1 && !s.scenarios[0]?.text);
      return wmEmpty || scEmpty;
    });

    if (needsMigration && character) {
      const migratedStories = formData.stories.map(s => migrateStoryToV2(s, character));
      setFormData(prev => ({ ...prev, stories: migratedStories }));
    }
  }, [isOpen, formData.stories?.length, character, hasDraft]); // Run when modal opens, draft loads, or stories count changes

  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [editingStoryName, setEditingStoryName] = useState(false);
  const [storyNameInput, setStoryNameInput] = useState('');
  const [newDialogue, setNewDialogue] = useState({ user: '', character: '' });
  const [editingDialogueIndex, setEditingDialogueIndex] = useState(null);
  const [editDialogue, setEditDialogue] = useState({ user: '', character: '' });
  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [showButtonForm, setShowButtonForm] = useState(false);
  const [editingButtonId, setEditingButtonId] = useState(null);
  const [buttonForm, setButtonForm] = useState({ name: '', buttonId: null, actions: [] });
  const [spoilersDropdownOpen, setSpoilersDropdownOpen] = useState(false);
  const [visibleCheckpoints, setVisibleCheckpoints] = useState({});
  const [checkpointSubTab, setCheckpointSubTab] = useState('player');
  const [checkpointProfiles, setCheckpointProfiles] = useState({ player: [], character: [] });
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState('');
  const [selectedCharProfile, setSelectedCharProfile] = useState('');
  const [profileDirty, setProfileDirty] = useState({ player: false, character: false });
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState(null);
  const [reminderForm, setReminderForm] = useState({
    name: '',
    text: '',
    target: 'character',
    constant: true,
    keys: [],
    caseSensitive: false,
    priority: 100,
    scanDepth: 10
  });
  // Dropdown selections for story associations
  const [selectedFlowToAdd, setSelectedFlowToAdd] = useState('');
  const [selectedButtonToAdd, setSelectedButtonToAdd] = useState('');
  const [selectedConstantReminder, setSelectedConstantReminder] = useState('');
  const [selectedGlobalReminder, setSelectedGlobalReminder] = useState('');
  const [draggedButtonId, setDraggedButtonId] = useState(null);
  const fileInputRef = React.useRef(null);
  const lorebookFileInputRef = React.useRef(null);
  const [importingLorebook, setImportingLorebook] = useState(false);
  const [enhancingWelcomeMessage, setEnhancingWelcomeMessage] = useState(false);
  const [enhancingScenario, setEnhancingScenario] = useState(false);
  const cancelledRef = React.useRef({ welcomeMessage: false, scenario: false });
  const charStagedFileRefs = React.useRef({});
  const charMediaIdleRefs = React.useRef({});
  const charMediaTransRefs = React.useRef({});

  // Derive POV from active persona's pronouns
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

  // Sync selected story ID when formData changes
  useEffect(() => {
    if (isOpen && formData.stories?.length > 0) {
      setSelectedStoryId(formData.activeStoryId || formData.stories[0]?.id || null);
    }
  }, [isOpen, formData.activeStoryId, formData.stories]);

  // Load checkpoint profiles (if API exists)
  useEffect(() => {
    if (isOpen && typeof api.getCheckpointProfiles === 'function') {
      api.getCheckpointProfiles().then(p => setCheckpointProfiles(p)).catch(() => {});
    }
  }, [isOpen, api]);

  // Memoize computed values to prevent dropdown re-render issues
  const stories = useMemo(() => formData.stories || [], [formData.stories]);
  const buttons = useMemo(() => formData.buttons || [], [formData.buttons]);
  const globalReminders = useMemo(() => formData.globalReminders || [], [formData.globalReminders]);

  const activeStory = useMemo(() => {
    if (!stories.length) return null;
    return stories.find(s => s.id === selectedStoryId) || stories[0];
  }, [stories, selectedStoryId]);

  // Memoize dropdown options to prevent closing on re-render
  const availableFlows = useMemo(() => {
    if (!flows || !activeStory) return [];
    const assignedFlows = activeStory.assignedFlows || [];
    return flows.filter(f => !assignedFlows.includes(f.id));
  }, [flows, activeStory?.assignedFlows]);

  const availableButtons = useMemo(() => {
    if (!activeStory) return [];
    const assignedButtons = activeStory.assignedButtons || [];
    return buttons.filter(b => !assignedButtons.includes(b.buttonId));
  }, [buttons, activeStory?.assignedButtons]);

  const availableConstantReminders = useMemo(() => {
    if (!activeStory) return [];
    const assignedIds = activeStory.constantReminderIds || [];
    return globalReminders.filter(r => !assignedIds.includes(r.id));
  }, [globalReminders, activeStory?.constantReminderIds]);

  const availableGlobalReminders = useMemo(() => {
    if (!activeStory) return [];
    const assignedIds = activeStory.globalReminderIds || [];
    return systemGlobalReminders.filter(r => !assignedIds.includes(r.id));
  }, [systemGlobalReminders, activeStory?.globalReminderIds]);

  if (!isOpen) return null;

  const getActiveStory = () => activeStory;

  const updateStoryField = (field, value) => {
    const storyId = activeStory?.id;
    if (!storyId) return;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === storyId ? { ...s, [field]: value } : s
      )
    }));
  };

  // Get active welcome message and scenario for current story
  const getActiveWelcomeMessage = () => {
    const story = getActiveStory();
    if (!story?.welcomeMessages?.length) return null;
    return story.welcomeMessages.find(wm => wm.id === story.activeWelcomeMessageId) || story.welcomeMessages[0];
  };

  const getActiveScenario = () => {
    const story = getActiveStory();
    if (!story?.scenarios?.length) return null;
    return story.scenarios.find(sc => sc.id === story.activeScenarioId) || story.scenarios[0];
  };

  // Welcome message handlers
  const handleWelcomeMessageChange = (wmId) => {
    updateStoryField('activeWelcomeMessageId', wmId);
  };

  const handleAddWelcomeMessage = () => {
    const story = getActiveStory();
    const currentMessages = story?.welcomeMessages || [];
    const newId = `wm-${Date.now()}`;
    const newMessage = { id: newId, text: '', llmEnhanced: false };
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, welcomeMessages: [...currentMessages, newMessage], activeWelcomeMessageId: newId }
          : s
      )
    }));
  };

  const handleDeleteWelcomeMessage = (wmId) => {
    const story = getActiveStory();
    const currentMessages = story?.welcomeMessages || [];
    if (currentMessages.length <= 1) {
      alert('Cannot delete the last welcome message');
      return;
    }
    if (!window.confirm('Delete this welcome message version?')) return;
    const filtered = currentMessages.filter(wm => wm.id !== wmId);
    const newActiveId = story.activeWelcomeMessageId === wmId ? filtered[0]?.id : story.activeWelcomeMessageId;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, welcomeMessages: filtered, activeWelcomeMessageId: newActiveId }
          : s
      )
    }));
  };

  const handleUpdateWelcomeMessageText = (text) => {
    const story = getActiveStory();
    const currentMessages = story?.welcomeMessages || [];
    const activeWmId = story?.activeWelcomeMessageId;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, welcomeMessages: currentMessages.map(wm => wm.id === activeWmId ? { ...wm, text } : wm) }
          : s
      )
    }));
  };

  const handleToggleWelcomeMessageLlm = () => {
    const story = getActiveStory();
    const currentMessages = story?.welcomeMessages || [];
    const activeWmId = story?.activeWelcomeMessageId;
    const activeWm = currentMessages.find(wm => wm.id === activeWmId);
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, welcomeMessages: currentMessages.map(wm => wm.id === activeWmId ? { ...wm, llmEnhanced: !activeWm?.llmEnhanced } : wm) }
          : s
      )
    }));
  };

  // Enhance welcome message with LLM
  const handleEnhanceWelcomeMessage = async () => {
    // If already enhancing, cancel the current generation
    if (enhancingWelcomeMessage) {
      cancelledRef.current.welcomeMessage = true;
      setEnhancingWelcomeMessage(false);
      return;
    }

    const story = getActiveStory();
    const activeWm = getActiveWelcomeMessage();
    const currentText = activeWm?.text || '';

    // Build context for LLM
    const description = formData.description || '';
    const personality = formData.personality || '';
    const exampleDialogues = story?.exampleDialogues || [];

    // Format dialog examples if they exist
    let dialogExamplesSection = '';
    if (exampleDialogues.length > 0) {
      dialogExamplesSection = '\n\nDialog Examples (showing how this character speaks):\n';
      exampleDialogues.forEach((dialogue, idx) => {
        dialogExamplesSection += `\nExample ${idx + 1}:\n`;
        dialogExamplesSection += `[Player]: ${dialogue.user}\n`;
        dialogExamplesSection += `${formData.name || 'Character'}: ${dialogue.character}\n`;
      });
    }

    // Build POV-specific instructions from active persona
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

      // Check if user cancelled while we were waiting
      if (cancelledRef.current.welcomeMessage) {
        return;
      }

      if (response && response.text) {
        // Update the welcome message with enhanced text
        const currentMessages = story?.welcomeMessages || [];
        const activeWmId = story?.activeWelcomeMessageId;
        setFormData(prev => ({
          ...prev,
          stories: (prev.stories || []).map(s =>
            s.id === activeStory?.id
              ? { ...s, welcomeMessages: currentMessages.map(wm => wm.id === activeWmId ? { ...wm, text: response.text.trim() } : wm) }
              : s
          )
        }));
      }
    } catch (error) {
      // Ignore if user cancelled
      if (cancelledRef.current.welcomeMessage) {
        return;
      }
      alert(`Failed to enhance welcome message: ${error.message}`);
    } finally {
      setEnhancingWelcomeMessage(false);
    }
  };

  // Scenario handlers
  const handleScenarioChange = (scId) => {
    updateStoryField('activeScenarioId', scId);
  };

  const handleAddScenario = () => {
    const story = getActiveStory();
    const currentScenarios = story?.scenarios || [];
    const newId = `sc-${Date.now()}`;
    const newScenario = { id: newId, text: '' };
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, scenarios: [...currentScenarios, newScenario], activeScenarioId: newId }
          : s
      )
    }));
  };

  const handleDeleteScenario = (scId) => {
    const story = getActiveStory();
    const currentScenarios = story?.scenarios || [];
    if (currentScenarios.length <= 1) {
      alert('Cannot delete the last scenario');
      return;
    }
    if (!window.confirm('Delete this scenario version?')) return;
    const filtered = currentScenarios.filter(sc => sc.id !== scId);
    const newActiveId = story.activeScenarioId === scId ? filtered[0]?.id : story.activeScenarioId;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, scenarios: filtered, activeScenarioId: newActiveId }
          : s
      )
    }));
  };

  const handleUpdateScenarioText = (text) => {
    const story = getActiveStory();
    const currentScenarios = story?.scenarios || [];
    const activeScId = story?.activeScenarioId;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === activeStory?.id
          ? { ...s, scenarios: currentScenarios.map(sc => sc.id === activeScId ? { ...sc, text } : sc) }
          : s
      )
    }));
  };

  // Enhance scenario with LLM
  const handleEnhanceScenario = async () => {
    // If already enhancing, cancel the current generation
    if (enhancingScenario) {
      cancelledRef.current.scenario = true;
      setEnhancingScenario(false);
      return;
    }

    const story = getActiveStory();
    const activeScId = story?.activeScenarioId;
    const currentScenarios = story?.scenarios || [];
    const activeScenario = currentScenarios.find(sc => sc.id === activeScId);
    const currentText = activeScenario?.text || '';

    // Build context for LLM
    const description = formData.description || '';
    const personality = formData.personality || '';
    const exampleDialogues = story?.exampleDialogues || [];

    // Format dialog examples if they exist
    let dialogExamplesSection = '';
    if (exampleDialogues.length > 0) {
      dialogExamplesSection = '\n\nDialog Examples (showing character context):\n';
      exampleDialogues.forEach((dialogue, idx) => {
        dialogExamplesSection += `\nExample ${idx + 1}:\n`;
        dialogExamplesSection += `[Player]: ${dialogue.user}\n`;
        dialogExamplesSection += `${formData.name || 'Character'}: ${dialogue.character}\n`;
      });
    }

    // Build POV-specific instructions from active persona
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

      const response = await api.generateText({
        prompt,
        maxTokens: 100  // Override default for shorter scenario descriptions
      });

      // Check if user cancelled while we were waiting
      if (cancelledRef.current.scenario) {
        return;
      }

      if (response && response.text) {
        // Update the scenario with enhanced text
        setFormData(prev => ({
          ...prev,
          stories: (prev.stories || []).map(s =>
            s.id === activeStory?.id
              ? { ...s, scenarios: currentScenarios.map(sc => sc.id === activeScId ? { ...sc, text: response.text.trim() } : sc) }
              : s
          )
        }));
      }
    } catch (error) {
      // Ignore if user cancelled
      if (cancelledRef.current.scenario) {
        return;
      }
      alert(`Failed to enhance scenario: ${error.message}`);
    } finally {
      setEnhancingScenario(false);
    }
  };

  const handleStoryChange = (storyId) => {
    setSelectedStoryId(storyId);
    setEditingDialogueIndex(null);
    setNewDialogue({ user: '', character: '' });
  };

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
      intensity: '',
      spoilers: [],
      storyProgressionEnabled: false,
      storyProgressionMaxOptions: 3,
      checkpoints: {},
      attributes: {}
    };
    setFormData({
      ...formData,
      stories: [...stories, newStory]
    });
    setSelectedStoryId(newId);
  };

  const handleDeleteStory = () => {
    if (stories.length <= 1) {
      alert('Cannot delete the last story');
      return;
    }
    if (!window.confirm('Delete this story?')) return;
    const storyId = activeStory?.id;
    const filtered = stories.filter(s => s.id !== storyId);
    const newSelected = filtered[0]?.id || null;
    setFormData({
      ...formData,
      stories: filtered,
      activeStoryId: newSelected
    });
    setSelectedStoryId(newSelected);
  };

  const handleRenameStory = () => {
    const activeStory = getActiveStory();
    setStoryNameInput(activeStory?.name || '');
    setEditingStoryName(true);
  };

  const handleSaveStoryName = () => {
    if (!storyNameInput.trim()) {
      alert('Story name cannot be empty');
      return;
    }
    updateStoryField('name', storyNameInput.trim());
    setEditingStoryName(false);
  };

  const handleCancelStoryName = () => {
    setEditingStoryName(false);
    setStoryNameInput('');
  };

  // Dialogue handlers
  const handleAddDialogue = () => {
    if (newDialogue.user.trim() && newDialogue.character.trim()) {
      const activeStory = getActiveStory();
      const updatedDialogues = [...(activeStory?.exampleDialogues || []), newDialogue];
      updateStoryField('exampleDialogues', updatedDialogues);
      setNewDialogue({ user: '', character: '' });
    }
  };

  const handleRemoveDialogue = (index) => {
    const activeStory = getActiveStory();
    const updatedDialogues = activeStory?.exampleDialogues?.filter((_, i) => i !== index) || [];
    updateStoryField('exampleDialogues', updatedDialogues);
    if (editingDialogueIndex === index) setEditingDialogueIndex(null);
  };

  const handleStartEditDialogue = (index) => {
    const activeStory = getActiveStory();
    const dialogue = activeStory?.exampleDialogues?.[index];
    if (dialogue) {
      setEditDialogue({ user: dialogue.user, character: dialogue.character });
      setEditingDialogueIndex(index);
    }
  };

  const handleSaveEditDialogue = () => {
    if (editDialogue.user.trim() && editDialogue.character.trim()) {
      const activeStory = getActiveStory();
      const updatedDialogues = (activeStory?.exampleDialogues || []).map((d, i) =>
        i === editingDialogueIndex ? editDialogue : d
      );
      updateStoryField('exampleDialogues', updatedDialogues);
      setEditingDialogueIndex(null);
      setEditDialogue({ user: '', character: '' });
    }
  };

  const handleCancelEditDialogue = () => {
    setEditingDialogueIndex(null);
    setEditDialogue({ user: '', character: '' });
  };

  // Flow assignment for story (add/remove badge pattern)
  // Also auto-adds buttons created by the flow's ButtonActionNodes
  const handleAddStoryFlow = async () => {
    if (!selectedFlowToAdd) return;

    const storyId = activeStory?.id;
    if (!storyId) return;

    const flowToAdd = selectedFlowToAdd;
    setSelectedFlowToAdd(''); // Clear immediately to prevent double-clicks

    try {
      // Fetch full flow data to extract button_press nodes
      const fullFlow = await api.getFlow(flowToAdd);

      // Extract all button_press nodes (they define flow-triggered buttons)
      const flowButtonNodes = (fullFlow?.nodes || []).filter(
        node => node.type === 'button_press' && node.data?.label
      );

      // Create auto-generated button entries for flow buttons
      const newAutoButtons = [];
      const buttonIdsToAssign = [];

      // Find the highest existing buttonId to generate new unique IDs
      const existingIds = buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
      let nextButtonId = existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;

      for (const node of flowButtonNodes) {
        // Check if this button already exists (by label match for this flow)
        const existingButton = buttons.find(
          b => b.sourceFlowId === flowToAdd && b.name === node.data.label
        );

        if (existingButton) {
          // Button already exists from this flow, just assign it
          buttonIdsToAssign.push(existingButton.buttonId);
        } else {
          // Check if node has a specific buttonId (linked to existing button)
          if (node.data.buttonId) {
            const linkedButton = buttons.find(b => String(b.buttonId) === String(node.data.buttonId));
            if (linkedButton) {
              buttonIdsToAssign.push(linkedButton.buttonId);
              continue;
            }
          }

          // Create new auto-generated button
          const newButtonId = nextButtonId++;
          buttonIdsToAssign.push(newButtonId);

          newAutoButtons.push({
            buttonId: newButtonId,
            name: node.data.label,
            actions: [], // Actions are handled by the flow, not stored here
            enabled: true,
            autoGenerated: true,
            sourceFlowId: flowToAdd
          });
        }
      }

      // Update formData with new flow assignment, auto-generated buttons, and assigned button IDs
      setFormData(prev => {
        // Add any new auto-generated buttons to the character's buttons array
        const updatedButtons = [...(prev.buttons || []), ...newAutoButtons];

        const updatedStories = (prev.stories || []).map(s => {
          if (s.id !== storyId) return s;

          const currentFlows = s.assignedFlows || [];
          if (currentFlows.includes(flowToAdd)) return s;

          const currentAssignedButtons = s.assignedButtons || [];
          const newAssignedButtons = [
            ...currentAssignedButtons,
            ...buttonIdsToAssign.filter(id => !currentAssignedButtons.includes(id))
          ];

          return {
            ...s,
            assignedFlows: [...currentFlows, flowToAdd],
            assignedButtons: newAssignedButtons
          };
        });

        return { ...prev, buttons: updatedButtons, stories: updatedStories };
      });
    } catch (error) {
      console.error('Failed to fetch flow data:', error);
      // Still add the flow even if we can't extract buttons
      setFormData(prev => {
        const updatedStories = (prev.stories || []).map(s => {
          if (s.id !== storyId) return s;
          const currentFlows = s.assignedFlows || [];
          if (currentFlows.includes(flowToAdd)) return s;
          return { ...s, assignedFlows: [...currentFlows, flowToAdd] };
        });
        return { ...prev, stories: updatedStories };
      });
    }
  };

  const handleRemoveStoryFlow = (flowId) => {
    const storyId = activeStory?.id;
    if (!storyId) return;

    // Find auto-generated buttons created by this flow
    const flowButtons = buttons.filter(b => b.sourceFlowId === flowId);
    const flowButtonIds = flowButtons.map(b => b.buttonId);

    setFormData(prev => {
      // Remove auto-generated buttons from the character's buttons array
      const updatedButtons = (prev.buttons || []).filter(
        b => !(b.autoGenerated && b.sourceFlowId === flowId)
      );

      const updatedStories = (prev.stories || []).map(s => {
        if (s.id !== storyId) return s;

        const currentFlows = s.assignedFlows || [];
        const currentAssignedButtons = s.assignedButtons || [];
        const newAssignedButtons = currentAssignedButtons.filter(id => !flowButtonIds.includes(id));

        return {
          ...s,
          assignedFlows: currentFlows.filter(id => id !== flowId),
          assignedButtons: newAssignedButtons
        };
      });

      return { ...prev, buttons: updatedButtons, stories: updatedStories };
    });
  };

  // Button assignment for story (add/remove badge pattern)
  const handleAddStoryButton = () => {
    if (!selectedButtonToAdd) return;
    const activeStory = getActiveStory();
    const currentButtons = activeStory?.assignedButtons || [];
    const buttonIdNum = parseInt(selectedButtonToAdd, 10);
    if (!currentButtons.includes(buttonIdNum)) {
      updateStoryField('assignedButtons', [...currentButtons, buttonIdNum]);
    }
    setSelectedButtonToAdd('');
  };

  const handleRemoveStoryButton = (buttonId) => {
    const activeStory = getActiveStory();
    const currentButtons = activeStory?.assignedButtons || [];
    updateStoryField('assignedButtons', currentButtons.filter(id => id !== buttonId));
  };

  // Drag-and-drop handlers for button reordering
  const handleButtonDragStart = (e, buttonId) => {
    setDraggedButtonId(buttonId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', buttonId.toString());
    e.target.classList.add('dragging');
  };

  const handleButtonDragEnd = (e) => {
    setDraggedButtonId(null);
    e.target.classList.remove('dragging');
  };

  const handleButtonDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleButtonDrop = (e, targetButtonId) => {
    e.preventDefault();
    if (draggedButtonId === null || draggedButtonId === targetButtonId) return;

    const activeStory = getActiveStory();
    const currentButtons = [...(activeStory?.assignedButtons || [])];
    const draggedIndex = currentButtons.indexOf(draggedButtonId);
    const targetIndex = currentButtons.indexOf(targetButtonId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged item and insert at target position
    currentButtons.splice(draggedIndex, 1);
    currentButtons.splice(targetIndex, 0, draggedButtonId);

    updateStoryField('assignedButtons', currentButtons);
    setDraggedButtonId(null);
  };

  // Constant reminder assignment (from character's custom reminders)
  const handleAddConstantReminder = () => {
    if (!selectedConstantReminder) return;
    const activeStory = getActiveStory();
    const currentIds = activeStory?.constantReminderIds || [];
    if (!currentIds.includes(selectedConstantReminder)) {
      updateStoryField('constantReminderIds', [...currentIds, selectedConstantReminder]);
    }
    setSelectedConstantReminder('');
  };

  const handleRemoveConstantReminder = (reminderId) => {
    const activeStory = getActiveStory();
    const currentIds = activeStory?.constantReminderIds || [];
    updateStoryField('constantReminderIds', currentIds.filter(id => id !== reminderId));
  };

  // Global reminder assignment (from system settings)
  const handleAddGlobalReminder = () => {
    if (!selectedGlobalReminder) return;
    const activeStory = getActiveStory();
    const currentIds = activeStory?.globalReminderIds || [];
    if (!currentIds.includes(selectedGlobalReminder)) {
      updateStoryField('globalReminderIds', [...currentIds, selectedGlobalReminder]);
    }
    setSelectedGlobalReminder('');
  };

  const handleRemoveGlobalReminder = (reminderId) => {
    const activeStory = getActiveStory();
    const currentIds = activeStory?.globalReminderIds || [];
    updateStoryField('globalReminderIds', currentIds.filter(id => id !== reminderId));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Character name is required');
      return;
    }

    const activeStory = getActiveStory();
    // Strip UI-only fields from stories before save
    const cleanedStories = (formData.stories || []).map(({ _checkpointSubTab, ...story }) => story);
    const saveData = {
      ...formData,
      stories: cleanedStories,
      activeStoryId: activeStory?.id || formData.stories?.[0]?.id,
      // Backwards compatibility
      autoReplyEnabled: activeStory?.autoReplyEnabled || false,
      allowLlmDeviceAccess: activeStory?.allowLlmDeviceAccess || false,
      pumpOnEveryReply: activeStory?.pumpOnEveryReply || false,
      characterCheckpoints: activeStory?.characterCheckpoints || {},
      startingEmotion: activeStory?.startingEmotion || 'neutral',
      assignedFlows: activeStory?.assignedFlows || [],
      exampleDialogues: activeStory?.exampleDialogues || [],
      constantReminders: formData.globalReminders || []
    };

    clearDraft();
    onSave(saveData);
  };

  const handleCancel = () => onClose();

  const handleImageClick = () => fileInputRef.current?.click();

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedImage(event.target.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropSave = (croppedImageData) => {
    setFormData({ ...formData, avatar: croppedImageData });
    setShowCropModal(false);
    setUploadedImage(null);
  };

  const handleCropCancel = () => {
    setShowCropModal(false);
    setUploadedImage(null);
  };

  // Checkpoint profile handlers
  const handleLoadProfile = (profileId, type) => {
    const profiles = checkpointProfiles[type] || [];
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const field = type === 'player' ? 'checkpoints' : 'characterCheckpoints';
    updateStoryField(field, { ...profile.checkpoints });
    // Load triggers from profile if present
    if (profile.checkpointTriggers) {
      const currentTriggers = { ...(activeStory?.checkpointTriggers || {}) };
      Object.assign(currentTriggers, profile.checkpointTriggers);
      updateStoryField('checkpointTriggers', currentTriggers);
    }
    if (type === 'player') setSelectedPlayerProfile(profileId);
    else setSelectedCharProfile(profileId);
    setProfileDirty(prev => ({ ...prev, [type]: false }));
  };

  const handleSaveNewProfile = async (type) => {
    const field = type === 'player' ? 'checkpoints' : 'characterCheckpoints';
    const checkpoints = activeStory?.[field] || {};
    const prefix = type === 'player' ? 'player-' : 'char-';
    const triggers = {};
    for (const [k, v] of Object.entries(activeStory?.checkpointTriggers || {})) {
      if (k.startsWith(prefix) && v.length > 0) triggers[k] = v;
    }
    const name = prompt('Profile name:');
    if (!name?.trim()) return;
    const result = await api.createCheckpointProfile(type, name.trim(), checkpoints, triggers);
    if (result?.id) {
      const updated = await api.getCheckpointProfiles();
      setCheckpointProfiles(updated);
      if (type === 'player') setSelectedPlayerProfile(result.id);
      else setSelectedCharProfile(result.id);
      setProfileDirty(prev => ({ ...prev, [type]: false }));
    }
  };

  const handleUpdateProfile = async (type) => {
    const profileId = type === 'player' ? selectedPlayerProfile : selectedCharProfile;
    if (!profileId) return;
    const profile = (checkpointProfiles[type] || []).find(p => p.id === profileId);
    if (!profile || profile.builtIn) return;
    const field = type === 'player' ? 'checkpoints' : 'characterCheckpoints';
    const checkpoints = activeStory?.[field] || {};
    const prefix = type === 'player' ? 'player-' : 'char-';
    const triggers = {};
    for (const [k, v] of Object.entries(activeStory?.checkpointTriggers || {})) {
      if (k.startsWith(prefix) && v.length > 0) triggers[k] = v;
    }
    await api.updateCheckpointProfile(profileId, type, profile.name, checkpoints, triggers);
    const updated = await api.getCheckpointProfiles();
    setCheckpointProfiles(updated);
    setProfileDirty(prev => ({ ...prev, [type]: false }));
  };

  const handleDeleteProfile = async (type) => {
    const profileId = type === 'player' ? selectedPlayerProfile : selectedCharProfile;
    if (!profileId) return;
    const profile = (checkpointProfiles[type] || []).find(p => p.id === profileId);
    if (!profile || profile.builtIn) return;
    if (!window.confirm(`Delete profile "${profile.name}"?`)) return;
    await api.deleteCheckpointProfile(profileId, type);
    const updated = await api.getCheckpointProfiles();
    setCheckpointProfiles(updated);
    if (type === 'player') setSelectedPlayerProfile('');
    else setSelectedCharProfile('');
  };

  // Character staged portrait handlers (legacy image-only)
  const handleCharStagedImageClick = (rangeId) => {
    charStagedFileRefs.current[rangeId]?.click();
  };

  const handleCharStagedImageUpload = (e, rangeId) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setFormData(prev => ({
        ...prev,
        charStagedPortraits: {
          ...prev.charStagedPortraits,
          [rangeId]: event.target.result
        }
      }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveCharStagedPortrait = (rangeId) => {
    const updated = { ...formData.charStagedPortraits };
    delete updated[rangeId];
    setFormData(prev => ({ ...prev, charStagedPortraits: updated }));
  };

  // Portrait media handlers (new format with video support)

  const uploadPortraitMedia = async (file, slot) => {
    if (!character?.id) return null;
    const folder = character._isDefault ? 'default' : 'custom';
    const form = new FormData();
    form.append('file', file);
    form.append('slot', slot);
    try {
      const res = await fetch(`${window.location.protocol}//${window.location.hostname}:${window.location.port || 3001}/api/portrait-media/chars/${folder}/${character.id}`, {
        method: 'POST',
        body: form
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
      // Images still go through base64 for the crop flow, stored in legacy field too
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target.result;
        setFormData(prev => ({
          ...prev,
          charStagedPortraits: { ...prev.charStagedPortraits, [rangeId]: url },
          charPortraitMedia: {
            ...prev.charPortraitMedia,
            [rangeId]: { ...(prev.charPortraitMedia?.[rangeId] || {}), idle: url, idleType: 'image' }
          }
        }));
      };
      reader.readAsDataURL(file);
    } else {
      // Videos upload directly to server
      const slot = `idle-${rangeId}`;
      const result = await uploadPortraitMedia(file, slot);
      if (result?.url) {
        setFormData(prev => ({
          ...prev,
          charPortraitMedia: {
            ...prev.charPortraitMedia,
            [rangeId]: { ...(prev.charPortraitMedia?.[rangeId] || {}), idle: result.url, idleType: 'video' }
          }
        }));
      }
    }
  };

  const handleTransUpload = async (e, rangeId) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('video/')) return;
    e.target.value = '';

    const slot = `trans-${rangeId}`;
    const result = await uploadPortraitMedia(file, slot);
    if (result?.url) {
      setFormData(prev => ({
        ...prev,
        charPortraitMedia: {
          ...prev.charPortraitMedia,
          [rangeId]: { ...(prev.charPortraitMedia?.[rangeId] || {}), trans: result.url }
        }
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
    // Also remove from legacy
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
      charPortraitCrop: { ...(prev.charPortraitCrop || { scale: 1, offsetX: 0, offsetY: 0 }), [field]: value }
    }));
  };

  // Button management
  const getNextButtonId = () => {
    const existingIds = buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
    return existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
  };

  const handleAddButton = () => {
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: getNextButtonId(), actions: [], enabled: true });
    setShowButtonForm(true);
  };

  const handleToggleButton = (buttonId, enabled) => {
    setFormData(prev => ({
      ...prev,
      buttons: (prev.buttons || []).map(b =>
        b.buttonId === buttonId ? { ...b, enabled } : b
      )
    }));
  };

  const handleEditButton = (button) => {
    setEditingButtonId(button.buttonId);
    setButtonForm({ ...button });
    setShowButtonForm(true);
  };

  const handleDeleteButton = (buttonId) => {
    if (window.confirm('Delete this button?')) {
      setFormData(prev => ({
        ...prev,
        buttons: (prev.buttons || []).filter(b => b.buttonId !== buttonId)
      }));
    }
  };

  const handleSaveButton = () => {
    if (!buttonForm.name.trim()) {
      alert('Button name is required');
      return;
    }

    // Use functional update to avoid stale closure issues
    setFormData(prev => {
      const currentButtons = prev.buttons || [];
      if (editingButtonId !== null) {
        return {
          ...prev,
          buttons: currentButtons.map(b =>
            b.buttonId === editingButtonId ? buttonForm : b
          )
        };
      } else {
        return {
          ...prev,
          buttons: [...currentButtons, buttonForm]
        };
      }
    });

    setShowButtonForm(false);
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: null, actions: [] });
  };

  const handleCancelButtonEdit = () => {
    setShowButtonForm(false);
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: null, actions: [] });
  };

  const handleAddAction = () => {
    setButtonForm({
      ...buttonForm,
      actions: [...buttonForm.actions, { type: 'message', config: {} }]
    });
  };

  const handleUpdateAction = (index, field, value) => {
    const updatedActions = [...buttonForm.actions];
    if (field === 'type') {
      updatedActions[index] = { type: value, config: {} };
    } else {
      updatedActions[index].config[field] = value;
    }
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleDeleteAction = (index) => {
    const updatedActions = buttonForm.actions.filter((_, i) => i !== index);
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleMoveAction = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === buttonForm.actions.length - 1) return;
    const updatedActions = [...buttonForm.actions];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [updatedActions[index], updatedActions[newIndex]] = [updatedActions[newIndex], updatedActions[index]];
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  // Global reminder functions
  const handleAddReminder = () => {
    setEditingReminderId(null);
    setReminderForm({
      name: '',
      text: '',
      target: 'character',
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 100,
      scanDepth: 10
    });
    setShowReminderForm(true);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminderId(reminder.id);
    setReminderForm({
      name: reminder.name,
      text: reminder.text,
      target: reminder.target || 'character',
      constant: reminder.constant !== false, // Default to true for backward compat
      keys: reminder.keys || [],
      caseSensitive: reminder.caseSensitive || false,
      priority: reminder.priority !== undefined ? reminder.priority : 100,
      scanDepth: reminder.scanDepth !== undefined ? reminder.scanDepth : 10
    });
    setShowReminderForm(true);
  };

  const handleDeleteReminder = (reminderId) => {
    if (window.confirm('Delete this reminder?')) {
      const updated = globalReminders.filter(r => r.id !== reminderId);
      setFormData({ ...formData, globalReminders: updated });
    }
  };

  const handleToggleReminder = (reminderId, enabled) => {
    const updated = globalReminders.map(r =>
      r.id === reminderId ? { ...r, enabled } : r
    );
    setFormData({ ...formData, globalReminders: updated });
  };

  const handleSaveReminder = () => {
    if (!reminderForm.name.trim() || !reminderForm.text.trim()) {
      alert('Reminder name and text are required');
      return;
    }

    // Validate keywords if not constant
    if (reminderForm.constant === false && (!reminderForm.keys || reminderForm.keys.length === 0)) {
      alert('Please add at least one trigger keyword, or enable "Always Active"');
      return;
    }

    if (editingReminderId) {
      const updated = globalReminders.map(r =>
        r.id === editingReminderId ? {
          ...r,
          name: reminderForm.name,
          text: reminderForm.text,
          target: reminderForm.target,
          constant: reminderForm.constant,
          keys: reminderForm.keys || [],
          caseSensitive: reminderForm.caseSensitive || false,
          priority: reminderForm.priority !== undefined ? reminderForm.priority : 100,
          scanDepth: reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10
        } : r
      );
      setFormData({ ...formData, globalReminders: updated });
    } else {
      const newReminder = {
        id: `reminder-${Date.now()}`,
        name: reminderForm.name,
        text: reminderForm.text,
        target: reminderForm.target,
        enabled: true,
        constant: reminderForm.constant,
        keys: reminderForm.keys || [],
        caseSensitive: reminderForm.caseSensitive || false,
        priority: reminderForm.priority !== undefined ? reminderForm.priority : 100,
        scanDepth: reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10
      };
      setFormData({ ...formData, globalReminders: [...globalReminders, newReminder] });
    }

    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({
      name: '',
      text: '',
      target: 'character',
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 100,
      scanDepth: 10
    });
  };

  const handleCancelReminderEdit = () => {
    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({
      name: '',
      text: '',
      target: 'character',
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 100,
      scanDepth: 10
    });
  };

  // Lorebook import handlers
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
        // V2/V3 format with array
        entries = data.character_book.entries;
      } else if (data.character_book?.entries && typeof data.character_book.entries === 'object') {
        // V2/V3 format with object (convert to array)
        entries = Object.values(data.character_book.entries);
      } else if (data.data?.character_book?.entries && Array.isArray(data.data.character_book.entries)) {
        // Nested V2/V3 format with array
        entries = data.data.character_book.entries;
      } else if (data.data?.character_book?.entries && typeof data.data.character_book.entries === 'object') {
        // Nested V2/V3 format with object
        entries = Object.values(data.data.character_book.entries);
      } else if (data.entries && Array.isArray(data.entries)) {
        // Direct array
        entries = data.entries;
      } else if (data.entries && typeof data.entries === 'object') {
        // SillyTavern world info format (object with numeric keys)
        entries = Object.values(data.entries);
      } else if (Array.isArray(data)) {
        // File is just an array
        entries = data;
      } else {
        throw new Error('Invalid lorebook format. Expected character_book.entries or entries object/array.');
      }

      // Ensure entries is an array
      if (!Array.isArray(entries)) {
        throw new Error('Lorebook entries must be an array.');
      }

      // Convert entries to Custom Reminders format
      const newReminders = entries
        .filter(entry => entry.enabled !== false && entry.disable !== true)
        .map(entry => ({
          id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entry.name || entry.comment || 'Lorebook Entry',
          text: entry.content || entry.value || '',
          target: 'character',
          enabled: true,
          // V2/V3: constant field directly, SillyTavern: selective=true means keyword-triggered (!constant)
          constant: entry.constant === true || (entry.selective !== undefined && !entry.selective),
          // V2/V3: keys, SillyTavern: key
          keys: entry.keys || entry.key || [],
          caseSensitive: entry.caseSensitive || entry.case_sensitive || false,
          priority: entry.priority !== undefined ? entry.priority : (entry.insertion_order || entry.order || 100),
          scanDepth: entry.extensions?.scan_depth || entry.scanDepth || entry.depth || 10
        }));

      if (newReminders.length === 0) {
        throw new Error('No valid lorebook entries found in file.');
      }

      // Add to existing reminders
      setFormData({
        ...formData,
        globalReminders: [...globalReminders, ...newReminders]
      });

      alert(`Successfully imported ${newReminders.length} lorebook entries as Custom Reminders.`);
    } catch (error) {
      console.error('Failed to import lorebook:', error);
      alert(error.message || 'Failed to import lorebook file');
    } finally {
      setImportingLorebook(false);
      // Reset file input
      if (lorebookFileInputRef.current) {
        lorebookFileInputRef.current.value = '';
      }
    }
  };

  const handleLorebookImportClick = () => {
    lorebookFileInputRef.current?.click();
  };

  return (
    <div className="modal-overlay">
      <div className="modal character-editor-modal">
        <div className="modal-header character-modal-header">
          <h3>{character ? 'Edit Character' : 'New Character'}</h3>
          {hasDraft && (
            <span className="draft-indicator" title="Unsaved changes restored">Draft restored</span>
          )}
          <button type="button" className="modal-close" onClick={handleCancel}>&times;</button>
        </div>

        <div className="modal-tabs character-modal-tabs">
          <button
            type="button"
            className={`modal-tab ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            Character
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'pumpable' ? 'active' : ''}`}
            onClick={() => setActiveTab('pumpable')}
          >
            Pumpable
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'reminders' ? 'active' : ''}`}
            onClick={() => setActiveTab('reminders')}
          >
            Custom Reminders
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            Custom Buttons
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'checkpoints' ? 'active' : ''}`}
            onClick={() => setActiveTab('checkpoints')}
          >
            Checkpoints
          </button>
          {formData.isPumpable && (
            <button
              type="button"
              className={`modal-tab ${activeTab === 'charPortraits' ? 'active' : ''}`}
              onClick={() => setActiveTab('charPortraits')}
            >
              Staged Portraits
            </button>
          )}
          <button
            type="button"
            className={`modal-tab ${activeTab === 'attributes' ? 'active' : ''}`}
            onClick={() => setActiveTab('attributes')}
          >
            Attributes
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Character Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'basic' ? 'block' : 'none' }}>
            <div className="editor-layout">
              <div className="editor-left">
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Character name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief character description..."
                  />
                </div>

                <div className="form-group">
                  <label>Personality</label>
                  <textarea
                    value={formData.personality}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    placeholder="Detailed personality traits..."
                  />
                </div>
              </div>

              <div className="editor-right">
                <label>Character Avatar</label>
                <div className={`avatar-upload-area ${formData.avatar ? 'has-avatar' : ''}`} onClick={handleImageClick}>
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
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                {formData.avatar && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, avatar: '' });
                    }}
                    style={{ marginTop: '0.5rem', width: '100%' }}
                  >
                    Remove Avatar
                  </button>
                )}
              </div>
            </div>

            {/* Story Section */}
            <div className="story-section">
              <div className="story-header">
                <div className="story-labels-row">
                  <label>Story</label>
                  <span></span>
                  <span></span>
                  <span></span>
                  <label className="story-meta-label">Level</label>
                  <label className="story-meta-label">Spoilers</label>
                </div>
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
                        value={selectedStoryId || ''}
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

                      <select
                        value={activeStory?.intensity || ''}
                        onChange={(e) => updateStoryField('intensity', e.target.value)}
                        className="story-intensity-select"
                      >
                        <option value=""></option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                      </select>

                      <div className="story-spoilers-dropdown">
                        <div
                          className="story-spoilers-select"
                          onClick={() => setSpoilersDropdownOpen(!spoilersDropdownOpen)}
                        >
                          {/* Blank display */}
                        </div>
                        {spoilersDropdownOpen && (
                          <div className="spoilers-options">
                            {['GOODEND', 'NOEND', 'BADEND'].map(option => {
                              const spoilers = activeStory?.spoilers || [];
                              const isChecked = spoilers.includes(option);
                              return (
                                <label key={option} className="spoiler-option">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      const currentSpoilers = activeStory?.spoilers || [];
                                      const newSpoilers = e.target.checked
                                        ? [...currentSpoilers, option]
                                        : currentSpoilers.filter(s => s !== option);
                                      updateStoryField('spoilers', newSpoilers);
                                    }}
                                  />
                                  <span>{option}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="story-content-box">
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

                {/* Allow LLM Device Access */}
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
                    <span className="auto-reply-label">Allow LLM Device Access</span>
                    <span className="auto-reply-hint">
                      {settings?.globalCharacterControls?.allowLlmDeviceControl
                        ? 'Allow this character to trigger device commands via LLM responses'
                        : 'Enable "Allow LLM Device Control" in Settings → Global first'}
                    </span>
                  </div>
                </div>

                {activeStory?.allowLlmDeviceAccess && settings?.globalCharacterControls?.allowLlmDeviceControl && (
                  <div className="story-field auto-reply-field" style={{ marginTop: '0.25rem' }}>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={activeStory?.pumpOnEveryReply || false}
                        onChange={(e) => updateStoryField('pumpOnEveryReply', e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <div className="auto-reply-text">
                      <span className="auto-reply-label">Send [pump on] with EVERY reply</span>
                      <span className="auto-reply-hint">
                        Automatically triggers pump on every AI response (excluding flow chain messages)
                      </span>
                    </div>
                    {activeStory?.pumpOnEveryReply && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={activeStory?.pumpOnEveryReplyChance ?? 100}
                          onChange={(e) => updateStoryField('pumpOnEveryReplyChance', Math.min(100, Math.max(1, parseInt(e.target.value) || 100)))}
                          style={{ width: '55px', textAlign: 'center' }}
                        />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>%</span>
                      </div>
                    )}
                  </div>
                )}
                {activeStory?.allowLlmDeviceAccess && settings?.globalCharacterControls?.allowLlmDeviceControl && (
                  <div className="story-field" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '0.25rem', display: 'block' }}>Device Control Limits</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: '0.25rem 0.5rem', alignItems: 'center' }}>
                      <label>Max ON Duration (secs)</label>
                      <input type="number" min={1} max={300} value={activeStory?.llmMaxOnDuration ?? 5}
                        onChange={(e) => updateStoryField('llmMaxOnDuration', Math.min(300, Math.max(1, parseInt(e.target.value) || 5)))}
                        style={{ width: '60px' }} />
                      <label>Max Cycle ON (secs)</label>
                      <input type="number" min={1} max={60} value={activeStory?.llmMaxCycleOnDuration ?? 2}
                        onChange={(e) => updateStoryField('llmMaxCycleOnDuration', Math.min(60, Math.max(1, parseInt(e.target.value) || 2)))}
                        style={{ width: '60px' }} />
                      <label>Max Cycle Repetitions</label>
                      <input type="number" min={1} max={50} value={activeStory?.llmMaxCycleRepetitions ?? 2}
                        onChange={(e) => updateStoryField('llmMaxCycleRepetitions', Math.min(50, Math.max(1, parseInt(e.target.value) || 2)))}
                        style={{ width: '60px' }} />
                      <label>Max Pulse Repetitions</label>
                      <input type="number" min={1} max={50} value={activeStory?.llmMaxPulseRepetitions ?? 5}
                        onChange={(e) => updateStoryField('llmMaxPulseRepetitions', Math.min(50, Math.max(1, parseInt(e.target.value) || 5)))}
                        style={{ width: '60px' }} />
                      <label>Max Timed Duration (secs)</label>
                      <input type="number" min={1} max={300} value={activeStory?.llmMaxTimedDuration ?? 10}
                        onChange={(e) => updateStoryField('llmMaxTimedDuration', Math.min(300, Math.max(1, parseInt(e.target.value) || 10)))}
                        style={{ width: '60px' }} />
                    </div>
                  </div>
                )}

                {/* Story Progression Mode */}
                <div className="story-field auto-reply-field">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={activeStory?.storyProgressionEnabled || false}
                      onChange={(e) => updateStoryField('storyProgressionEnabled', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">Story Progression</span>
                    <span className="auto-reply-hint">Auto-generate player reply suggestions after each AI response</span>
                  </div>
                </div>
                {activeStory?.storyProgressionEnabled && (
                  <div className="story-field" style={{ marginTop: '0.25rem', marginBottom: '0.5rem' }}>
                    <label>Max Suggestions</label>
                    <input
                      type="number"
                      min={2}
                      max={5}
                      value={activeStory?.storyProgressionMaxOptions || 3}
                      onChange={(e) => updateStoryField('storyProgressionMaxOptions', Math.min(5, Math.max(2, parseInt(e.target.value) || 3)))}
                      style={{ width: '60px' }}
                    />
                  </div>
                )}

                {/* Welcome Message */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>
                      Welcome Message
                      {enhancingWelcomeMessage && <span className="spinner-inline"> ⏳</span>}
                    </label>
                    <div className="version-controls">
                      <button
                        type="button"
                        className={`btn-icon btn-llm ${getActiveWelcomeMessage()?.llmEnhanced ? 'active' : ''}`}
                        onClick={handleToggleWelcomeMessageLlm}
                        title="Toggle LLM Enhancement"
                      >🤖</button>
                      <button
                        type="button"
                        className={`btn-icon btn-random-version ${activeStory?.randomWelcomeVersion ? 'active' : ''}`}
                        onClick={() => updateStoryField('randomWelcomeVersion', !activeStory?.randomWelcomeVersion)}
                        title={activeStory?.randomWelcomeVersion ? 'Random version on session start (ON)' : 'Random version on session start (OFF)'}
                      >R</button>
                      <select
                        value={activeStory?.activeWelcomeMessageId || ''}
                        onChange={(e) => handleWelcomeMessageChange(e.target.value)}
                        className="version-select"
                      >
                        {(activeStory?.welcomeMessages || []).map((wm, idx) => (
                          <option key={wm.id} value={wm.id}>Ver {idx + 1}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add" onClick={handleAddWelcomeMessage} title="Add version">+</button>
                      <button
                        type="button"
                        className="btn-icon btn-delete"
                        onClick={() => handleDeleteWelcomeMessage(activeStory?.activeWelcomeMessageId)}
                        disabled={(activeStory?.welcomeMessages || []).length <= 1}
                        title="Delete version"
                      >🗑️</button>
                      <button
                        type="button"
                        className={`btn-icon btn-magic ${enhancingWelcomeMessage ? 'active enhancing' : ''}`}
                        onClick={handleEnhanceWelcomeMessage}
                        title={enhancingWelcomeMessage ? "Click to abort" : "Enhance with LLM"}
                      >🪄</button>
                      <span className="pov-badge" title={`From persona: ${playerName} (${personaPronouns})`}>{activePOV}</span>
                    </div>
                  </div>
                  <textarea
                    value={getActiveWelcomeMessage()?.text || ''}
                    onChange={(e) => handleUpdateWelcomeMessageText(e.target.value)}
                    placeholder="The first message the character sends..."
                    rows={9}
                  />
                </div>

                {/* Post Welcome Triggers */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>Post Welcome Triggers</label>
                    <button type="button" className="btn-icon btn-add" onClick={() => {
                      const current = activeStory?.postWelcomeTriggers || [];
                      updateStoryField('postWelcomeTriggers', [...current, { type: 'impersonate', id: Date.now().toString() }]);
                    }} title="Add trigger">+</button>
                  </div>
                  {(activeStory?.postWelcomeTriggers || []).length === 0 ? (
                    <p className="section-hint" style={{ margin: '0.25rem 0' }}>No triggers — click + to add actions that fire after the welcome message.</p>
                  ) : (
                    <div className="post-welcome-triggers-list">
                      {(activeStory?.postWelcomeTriggers || []).map((trigger, idx) => (
                        <TriggerRow
                          key={trigger.id || idx}
                          trigger={trigger}
                          isPumpable={formData.isPumpable}
                          reminders={formData.globalReminders || []}
                          globalReminders={systemGlobalReminders}
                          onChange={(updated) => {
                            const items = [...(activeStory?.postWelcomeTriggers || [])];
                            items[idx] = updated;
                            updateStoryField('postWelcomeTriggers', items);
                          }}
                          onRemove={() => {
                            updateStoryField('postWelcomeTriggers', (activeStory?.postWelcomeTriggers || []).filter((_, i) => i !== idx));
                          }}
                          dragProps={{
                            draggable: true,
                            onDragStart: (e) => e.dataTransfer.setData('text/plain', idx.toString()),
                            onDragOver: (e) => e.preventDefault(),
                            onDrop: (e) => { e.preventDefault(); const from = parseInt(e.dataTransfer.getData('text/plain')); if (from === idx) return; const items = [...(activeStory?.postWelcomeTriggers || [])]; const [m] = items.splice(from, 1); items.splice(idx, 0, m); updateStoryField('postWelcomeTriggers', items); }
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Scenario */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>
                      Scenario
                      {enhancingScenario && <span className="spinner-inline"> ⏳</span>}
                    </label>
                    <div className="version-controls">
                      <div className="version-controls-spacer"></div>
                      <select
                        value={activeStory?.activeScenarioId || ''}
                        onChange={(e) => handleScenarioChange(e.target.value)}
                        className="version-select"
                      >
                        {(activeStory?.scenarios || []).map((sc, idx) => (
                          <option key={sc.id} value={sc.id}>Ver {idx + 1}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add" onClick={handleAddScenario} title="Add version">+</button>
                      <button
                        type="button"
                        className="btn-icon btn-delete"
                        onClick={() => handleDeleteScenario(activeStory?.activeScenarioId)}
                        disabled={(activeStory?.scenarios || []).length <= 1}
                        title="Delete version"
                      >🗑️</button>
                      <button
                        type="button"
                        className={`btn-icon btn-magic ${enhancingScenario ? 'active enhancing' : ''}`}
                        onClick={handleEnhanceScenario}
                        title={enhancingScenario ? "Click to abort" : "Enhance with LLM"}
                      >🪄</button>
                      <span className="pov-badge" title={`From persona: ${playerName} (${personaPronouns})`}>{activePOV}</span>
                    </div>
                  </div>
                  <textarea
                    value={getActiveScenario()?.text || ''}
                    onChange={(e) => handleUpdateScenarioText(e.target.value)}
                    placeholder="Current situation/scenario..."
                    rows={2}
                  />
                </div>

                {/* Example Dialogues */}
                <div className="story-field">
                  <label>Example Dialogues</label>
                  <div className="dialogues-list">
                    {(activeStory?.exampleDialogues || []).map((dialogue, i) => (
                      <div key={i} className="dialogue-item">
                        {editingDialogueIndex === i ? (
                          <div className="dialogue-edit-form">
                            <input
                              type="text"
                              placeholder="Player says..."
                              value={editDialogue.user}
                              onChange={(e) => setEditDialogue({ ...editDialogue, user: e.target.value })}
                            />
                            <input
                              type="text"
                              placeholder="Character responds..."
                              value={editDialogue.character}
                              onChange={(e) => setEditDialogue({ ...editDialogue, character: e.target.value })}
                            />
                            <div className="dialogue-edit-actions">
                              <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveEditDialogue}>Save</button>
                              <button type="button" className="btn btn-sm btn-secondary" onClick={handleCancelEditDialogue}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="dialogue-content">
                              <p><strong>Player:</strong> {dialogue.user}</p>
                              <p><strong>{formData.name || 'Character'}:</strong> {dialogue.character}</p>
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
                    <input
                      type="text"
                      placeholder="Player says..."
                      value={newDialogue.user}
                      onChange={(e) => setNewDialogue({ ...newDialogue, user: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Character responds..."
                      value={newDialogue.character}
                      onChange={(e) => setNewDialogue({ ...newDialogue, character: e.target.value })}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddDialogue}>Add</button>
                  </div>
                </div>

                {/* Associated Flows */}
                <div className="story-field">
                  <label>Associated Flows</label>
                  <div className="dropdown-add-row">
                    <select
                      value={selectedFlowToAdd}
                      onChange={(e) => setSelectedFlowToAdd(e.target.value)}
                      className="association-dropdown"
                    >
                      <option value="">Select a flow...</option>
                      {availableFlows.map(flow => (
                        <option key={flow.id} value={flow.id}>{flow.name}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-icon btn-add-assoc" onClick={handleAddStoryFlow} disabled={!selectedFlowToAdd}>+</button>
                  </div>
                  <div className="association-badges">
                    {(activeStory?.assignedFlows || []).length === 0 ? (
                      <span className="empty-hint">No flows assigned</span>
                    ) : (
                      (activeStory?.assignedFlows || []).map(flowId => {
                        const flow = flows?.find(f => f.id === flowId);
                        return flow ? (
                          <span key={flowId} className="assoc-badge">
                            {flow.name}
                            <button type="button" className="badge-remove" onClick={() => handleRemoveStoryFlow(flowId)}>−</button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                </div>

                {/* Associated Custom Buttons */}
                <div className="story-field">
                  <label>Associated Custom Buttons</label>
                  <div className="dropdown-add-row">
                    <select
                      value={selectedButtonToAdd}
                      onChange={(e) => setSelectedButtonToAdd(e.target.value)}
                      className="association-dropdown"
                    >
                      <option value="">Select a button...</option>
                      {availableButtons.map(btn => (
                        <option key={btn.buttonId} value={btn.buttonId}>{btn.name} #{btn.buttonId}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-icon btn-add-assoc" onClick={handleAddStoryButton} disabled={!selectedButtonToAdd}>+</button>
                  </div>
                  <div className="association-badges">
                    {(activeStory?.assignedButtons || []).length === 0 ? (
                      <span className="empty-hint">No buttons assigned - add them in the Custom Buttons tab</span>
                    ) : (
                      (activeStory?.assignedButtons || []).map(buttonId => {
                        const btn = buttons.find(b => b.buttonId === buttonId);
                        return btn ? (
                          <span
                            key={buttonId}
                            className={`assoc-badge draggable ${draggedButtonId === buttonId ? 'dragging' : ''}`}
                            draggable
                            onDragStart={(e) => handleButtonDragStart(e, buttonId)}
                            onDragEnd={handleButtonDragEnd}
                            onDragOver={handleButtonDragOver}
                            onDrop={(e) => handleButtonDrop(e, buttonId)}
                          >
                            <span className="drag-handle">⋮⋮</span>
                            {btn.name}
                            <button type="button" className="badge-remove" onClick={() => handleRemoveStoryButton(buttonId)}>−</button>
                          </span>
                        ) : null;
                      })
                    )}
                  </div>
                </div>

                {/* Story Details - Reminders */}
                <div className="story-subsection">
                  <label className="subsection-label">Story Details</label>

                  {/* Constant Reminders - from character's Custom Reminders */}
                  <div className="story-field">
                    <label>Constant Reminders (from Custom Reminders)</label>
                    <div className="dropdown-add-row">
                      <select
                        value={selectedConstantReminder}
                        onChange={(e) => setSelectedConstantReminder(e.target.value)}
                        className="association-dropdown"
                      >
                        <option value="">Select a reminder...</option>
                        {availableConstantReminders.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add-assoc" onClick={handleAddConstantReminder} disabled={!selectedConstantReminder}>+</button>
                    </div>
                    <div className="association-badges">
                      {(activeStory?.constantReminderIds || []).length === 0 ? (
                        <span className="empty-hint">No reminders assigned - add them in the Custom Reminders tab</span>
                      ) : (
                        (activeStory?.constantReminderIds || []).map(reminderId => {
                          const reminder = globalReminders.find(r => r.id === reminderId);
                          return reminder ? (
                            <span key={reminderId} className="assoc-badge">
                              {reminder.name}
                              <button type="button" className="badge-remove" onClick={() => handleRemoveConstantReminder(reminderId)}>−</button>
                            </span>
                          ) : null;
                        })
                      )}
                    </div>
                  </div>

                  {/* Global Reminders - from System Settings */}
                  <div className="story-field">
                    <label>Global Reminders (from Settings)</label>
                    <div className="dropdown-add-row">
                      <select
                        value={selectedGlobalReminder}
                        onChange={(e) => setSelectedGlobalReminder(e.target.value)}
                        className="association-dropdown"
                      >
                        <option value="">Select a reminder...</option>
                        {availableGlobalReminders.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add-assoc" onClick={handleAddGlobalReminder} disabled={!selectedGlobalReminder}>+</button>
                    </div>
                    <div className="association-badges">
                      {(activeStory?.globalReminderIds || []).length === 0 ? (
                        <span className="empty-hint">No global reminders assigned - add them in Settings</span>
                      ) : (
                        (activeStory?.globalReminderIds || []).map(reminderId => {
                          const reminder = systemGlobalReminders.find(r => r.id === reminderId);
                          return reminder ? (
                            <span key={reminderId} className="assoc-badge">
                              {reminder.name}
                              <button type="button" className="badge-remove" onClick={() => handleRemoveGlobalReminder(reminderId)}>−</button>
                            </span>
                          ) : null;
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Session Defaults (per-story) */}
                <div className="story-section-divider" style={{ marginTop: '1rem', marginBottom: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                  <h4 style={{ margin: '0 0 0.25rem 0' }}>Session Defaults</h4>
                  <p className="section-hint">Starting values when beginning a new session with this story.</p>
                </div>

                <div className="story-field">
                  <div className="form-label-row">
                    <label>Starting Capacity</label>
                    <span className="form-value">{activeStory?.startingCapacity || 0}%</span>
                  </div>
                  <input
                    type="range" min="0" max="100" step="5"
                    value={activeStory?.startingCapacity || 0}
                    onChange={(e) => updateStoryField('startingCapacity', parseInt(e.target.value))}
                  />
                </div>

                <div className="story-field">
                  <div className="form-label-row">
                    <label>Pain Level</label>
                    <span className="form-value">{activeStory?.startingPain || 0}</span>
                  </div>
                  <input
                    type="range" min="0" max="10" step="1"
                    value={activeStory?.startingPain || 0}
                    onChange={(e) => updateStoryField('startingPain', parseInt(e.target.value))}
                  />
                </div>

                <div className="story-field auto-reply-field">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={activeStory?.overrideDisposition || false}
                      onChange={(e) => updateStoryField('overrideDisposition', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">Override Persona Starting Disposition</span>
                    <span className="auto-reply-hint">Use this story's disposition instead of the persona's default at session start</span>
                  </div>
                </div>
                {activeStory?.overrideDisposition && (
                  <div className="story-field" style={{ marginTop: '0.25rem' }}>
                    <select
                      value={activeStory?.startingEmotion || 'neutral'}
                      onChange={(e) => updateStoryField('startingEmotion', e.target.value)}
                    >
                      {EMOTIONS.map(e => (
                        <option key={e.key} value={e.key}>{e.emoji} {e.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="story-field">
                  <div className="form-label-row">
                    <label>Auto-Capacity Speed</label>
                    <span className="form-value">{(activeStory?.startingCapacityModifier || 1.0).toFixed(2)}x</span>
                  </div>
                  <input
                    type="range" min="0.25" max="2" step="0.25"
                    value={activeStory?.startingCapacityModifier || 1.0}
                    onChange={(e) => updateStoryField('startingCapacityModifier', parseFloat(e.target.value))}
                  />
                  <div className="form-hint">Affects how fast capacity increases during auto-mode</div>
                </div>

                {/* V2/V3 Import Reference - Show original content if imported */}
                {formData.extensions?.v2v3Import && (
                  <div className="story-subsection">
                    <label className="subsection-label">Original Imported Content (Reference)</label>
                    <p className="section-hint" style={{ marginBottom: '1rem', color: 'var(--warning-color)' }}>
                      These are the original greetings/scenarios from the imported character card.
                      They are preserved here for reference only. Please write inflation-appropriate versions above.
                    </p>

                    {formData.extensions.v2v3Import.originalGreeting && (
                      <div className="story-field">
                        <label>Original Welcome Message</label>
                        <textarea
                          value={formData.extensions.v2v3Import.originalGreeting}
                          readOnly
                          style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed' }}
                          rows={3}
                        />
                      </div>
                    )}

                    {formData.extensions.v2v3Import.originalAlternateGreetings?.length > 0 && (
                      <div className="story-field">
                        <label>Original Alternate Greetings ({formData.extensions.v2v3Import.originalAlternateGreetings.length})</label>
                        {formData.extensions.v2v3Import.originalAlternateGreetings.map((greeting, idx) => (
                          <textarea
                            key={idx}
                            value={greeting}
                            readOnly
                            style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed', marginBottom: '0.5rem' }}
                            rows={2}
                          />
                        ))}
                      </div>
                    )}

                    {formData.extensions.v2v3Import.originalScenario && (
                      <div className="story-field">
                        <label>Original Scenario</label>
                        <textarea
                          value={formData.extensions.v2v3Import.originalScenario}
                          readOnly
                          style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'not-allowed' }}
                          rows={2}
                        />
                      </div>
                    )}

                    <div className="story-field">
                      <label>Import Info</label>
                      <div style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
                        <div>Format: {formData.extensions.v2v3Import.originalFormat || formData.extensions.v2v3Import.spec || 'Unknown'}</div>
                        <div>Imported: {new Date(formData.extensions.v2v3Import.importedAt).toLocaleString()}</div>
                        {formData.extensions.v2v3Import.creator && <div>Creator: {formData.extensions.v2v3Import.creator}</div>}
                        {formData.extensions.v2v3Import.characterVersion && <div>Version: {formData.extensions.v2v3Import.characterVersion}</div>}
                      </div>
                      <p className="section-hint" style={{ marginTop: '0.5rem' }}>
                        💡 <strong>Tip:</strong> The character's lorebook was imported as Custom Reminders.
                        Check the "Custom Reminders" tab to see and manage all lorebook entries.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pumpable Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'pumpable' ? 'block' : 'none' }}>
            <div className="story-field auto-reply-field">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={formData.isPumpable || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, isPumpable: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
              <div className="auto-reply-text">
                <span className="auto-reply-label">Is this character a valid inflation target?</span>
                <span className="auto-reply-hint">Enables a capacity gauge on this character's portrait and allows flow nodes to inflate them</span>
              </div>
            </div>

            {formData.isPumpable && (
              <div style={{ marginTop: '1rem' }}>
                <div className="form-group">
                  <label>Calibration Time (seconds)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="number"
                      min={5}
                      max={600}
                      value={formData.charSyncCalibrationWithPlayer ? (playerPumpCalibration || formData.characterCalibrationTime || 60) : (formData.characterCalibrationTime || 60)}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        characterCalibrationTime: Math.min(600, Math.max(5, parseInt(e.target.value) || 60))
                      }))}
                      disabled={formData.charSyncCalibrationWithPlayer}
                      style={{ width: '100px', opacity: formData.charSyncCalibrationWithPlayer ? 0.5 : 1 }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={formData.charSyncCalibrationWithPlayer || false}
                        onChange={(e) => setFormData(prev => ({ ...prev, charSyncCalibrationWithPlayer: e.target.checked }))}
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
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      charBurstPercent: Math.min(200, Math.max(50, parseInt(e.target.value) || 100))
                    }))}
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
                        onChange={(e) => setFormData(prev => ({ ...prev, hideCharBurstFromDetails: e.target.checked }))}
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
                  <select
                    value={formData.charInflateKnowledge || 'unaware'}
                    onChange={(e) => setFormData(prev => ({ ...prev, charInflateKnowledge: e.target.value }))}
                  >
                    <option value="unaware">Unaware — doesn't know what's happening</option>
                    <option value="confused">Confused — notices something but doesn't understand</option>
                    <option value="partial">Partial — understands the basics but not the full picture</option>
                    <option value="informed">Informed — knows exactly what inflation is and what's happening</option>
                    <option value="expert">Expert — deeply knowledgeable, may have experience</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginTop: '0.5rem' }}>
                  <label>Character's Desire to be Inflated</label>
                  <select
                    value={formData.charInflateDesire || 'neutral'}
                    onChange={(e) => setFormData(prev => ({ ...prev, charInflateDesire: e.target.value }))}
                  >
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
                  <select
                    value={formData.charPopDesire || 'terrified'}
                    onChange={(e) => setFormData(prev => ({ ...prev, charPopDesire: e.target.value }))}
                  >
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

                <div className="story-field auto-reply-field" style={{ marginTop: '1rem' }}>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={formData.charInflateAutoLoadControls || false}
                      onChange={(e) => setFormData(prev => ({ ...prev, charInflateAutoLoadControls: e.target.checked }))}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">Auto Load Basic Controls</span>
                    <span className="auto-reply-hint">Automatically assigns the "Basic Character Inflation Controls" flow (Inflate, Stop, Reset, 50%) to this character's button menu</span>
                  </div>
                </div>

                <div style={{ marginTop: '1rem', padding: '10px', background: 'var(--bg-input, rgba(0,0,0,0.2))', borderRadius: 'var(--border-radius)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>System Variables</strong>
                  <div style={{ marginTop: '6px', lineHeight: 1.6 }}>
                    <code>[CharCapacity]</code> or <code>{'{{charCapacity}}'}</code> — Current character inflation % (0-100)<br/>
                    <code>[Capacity]</code> — Player inflation % (for reference)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Custom Reminders Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'reminders' ? 'block' : 'none' }}>
            <div className="reminders-editor">
              {!showReminderForm ? (
                <>
                  <div className="events-header">
                    <h4>Custom Reminders</h4>
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
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleAddReminder}>+ Add Reminder</button>
                    </div>
                  </div>
                  <p className="section-hint">Character-specific reminders. Create them here, then assign them to stories using "Constant Reminders" in the Story section.</p>

                  {/* V2/V3 Import Notice */}
                  {formData.extensions?.v2v3Import && globalReminders.length > 0 && (
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
                    {globalReminders.length === 0 ? (
                      <p className="empty-message">No custom reminders yet.</p>
                    ) : (
                      globalReminders.map((reminder) => (
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
                            <div className="event-meta">{reminder.text.substring(0, 60)}{reminder.text.length > 60 ? '...' : ''}</div>
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
                  <h4>{editingReminderId ? 'Edit' : 'Add'} Custom Reminder</h4>
                  <div className="form-group">
                    <label>Reminder Name *</label>
                    <input
                      type="text"
                      value={reminderForm.name}
                      onChange={(e) => setReminderForm({ ...reminderForm, name: e.target.value })}
                      placeholder="Brief identifier..."
                    />
                  </div>
                  <div className="form-group">
                    <label>Reminder Text *</label>
                    <textarea
                      value={reminderForm.text}
                      onChange={(e) => setReminderForm({ ...reminderForm, text: e.target.value })}
                      placeholder="What the AI should remember..."
                      rows={4}
                    />
                  </div>
                  <div className="form-group">
                    <label>Display Position</label>
                    <div className="radio-group">
                      <label className="radio-label">
                        <div className="radio-row">
                          <input
                            type="radio"
                            name="reminderTarget"
                            value="player"
                            checked={reminderForm.target === 'player'}
                            onChange={(e) => setReminderForm({ ...reminderForm, target: e.target.value })}
                          />
                          <span className="radio-title">Player</span>
                        </div>
                        <span className="radio-hint">Appears below player portrait</span>
                      </label>
                      <label className="radio-label">
                        <div className="radio-row">
                          <input
                            type="radio"
                            name="reminderTarget"
                            value="character"
                            checked={reminderForm.target === 'character'}
                            onChange={(e) => setReminderForm({ ...reminderForm, target: e.target.value })}
                          />
                          <span className="radio-title">Character</span>
                        </div>
                        <span className="radio-hint">Appears below character portrait</span>
                      </label>
                    </div>
                  </div>

                  {/* Activation Mode */}
                  <div className="form-group">
                    <label className="checkbox-label-block">
                      <input
                        type="checkbox"
                        checked={reminderForm.constant !== false}
                        onChange={(e) => setReminderForm({ ...reminderForm, constant: e.target.checked })}
                      />
                      <div className="checkbox-content">
                        <span className="checkbox-title">Always Active (Constant)</span>
                        <span className="checkbox-hint">If unchecked, only activates when keywords are detected in conversation</span>
                      </div>
                    </label>
                  </div>

                  {/* Keyword Triggers - only show if not constant */}
                  {reminderForm.constant === false && (
                    <div className="form-group">
                      <label>Trigger Keywords</label>
                      <KeywordInput
                        values={reminderForm.keys || []}
                        onChange={(keys) => setReminderForm({ ...reminderForm, keys })}
                        placeholder="Type keyword and press Enter..."
                      />
                      <span className="field-hint">Reminder activates when any keyword appears in recent messages</span>

                      <div className="inline-options" style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={reminderForm.caseSensitive || false}
                            onChange={(e) => setReminderForm({ ...reminderForm, caseSensitive: e.target.checked })}
                          />
                          <span>Case Sensitive</span>
                        </label>

                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <label>Scan Depth:</label>
                          <input
                            type="number"
                            value={reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10}
                            onChange={(e) => setReminderForm({ ...reminderForm, scanDepth: parseInt(e.target.value) || 0 })}
                            min="0"
                            max="100"
                            style={{ width: '80px' }}
                          />
                          <span className="field-hint">(0 = all messages)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Priority */}
                  <div className="form-group">
                    <label>Priority (Insertion Order)</label>
                    <input
                      type="number"
                      value={reminderForm.priority !== undefined ? reminderForm.priority : 100}
                      onChange={(e) => setReminderForm({ ...reminderForm, priority: parseInt(e.target.value) || 100 })}
                      min="0"
                      max="1000"
                      style={{ width: '120px' }}
                    />
                    <span className="field-hint">Higher priority reminders appear earlier in prompt (default: 100)</span>
                  </div>

                  <div className="event-form-buttons">
                    <button type="button" className="btn btn-secondary" onClick={handleCancelReminderEdit}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={handleSaveReminder}>{editingReminderId ? 'Update' : 'Create'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Custom Buttons Tab */}
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
                  <p className="section-hint">Create buttons here, then assign them to specific stories in the Character tab.</p>

                  <div className="events-list-editor">
                    {buttons.length === 0 ? (
                      <p className="empty-message">No buttons yet.</p>
                    ) : (
                      buttons.map((button) => (
                        <div key={button.buttonId} className={`event-item ${button.enabled === false ? 'disabled' : ''} ${button.autoGenerated ? 'auto-generated' : ''}`}>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={button.enabled !== false}
                              onChange={(e) => handleToggleButton(button.buttonId, e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="event-info">
                            <div className={`event-name ${button.enabled === false ? 'strikethrough' : ''}`}>
                              {button.name} <span style={{color: '#666'}}>#{button.buttonId}</span>
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
                    <input
                      type="text"
                      value={buttonForm.name}
                      onChange={(e) => setButtonForm({ ...buttonForm, name: e.target.value })}
                      placeholder="e.g., 'Quick Inflate'"
                    />
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
                              </select>
                              {action.type === 'message' && (
                                <textarea
                                  value={action.config.text || ''}
                                  onChange={(e) => handleUpdateAction(index, 'text', e.target.value)}
                                  placeholder="Instruction for AI..."
                                  rows={2}
                                />
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

          {/* Checkpoints Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'checkpoints' ? 'block' : 'none' }}>
            <div className="session-defaults-editor">
              {formData.isPumpable ? (
                <>
                  {/* Sub-tab switcher for pumpable characters */}
                  <div className="checkpoint-subtabs">
                    <button
                      type="button"
                      className={`checkpoint-subtab ${checkpointSubTab === 'player' ? 'active' : ''}`}
                      onClick={() => setCheckpointSubTab('player')}
                    >
                      Player Capacity
                    </button>
                    <button
                      type="button"
                      className={`checkpoint-subtab ${checkpointSubTab === 'character' ? 'active' : ''}`}
                      onClick={() => setCheckpointSubTab('character')}
                    >
                      Character Capacity
                    </button>
                  </div>

                  {/* Player Capacity Checkpoints */}
                  {checkpointSubTab === 'player' && (
                    <>
                      <h4>Player Capacity Checkpoints</h4>
                      <p className="section-hint">Stage directions telling the AI how to react to the <strong>player's</strong> inflation at each capacity range. Uses <code>[Player]</code> for the persona name.</p>

                      <div className="checkpoint-profile-bar">
                        <select
                          value={selectedPlayerProfile}
                          onChange={(e) => handleLoadProfile(e.target.value, 'player')}
                          className="checkpoint-profile-select"
                        >
                          <option value="">-- Load Profile --</option>
                          {(checkpointProfiles.player || []).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => handleSaveNewProfile('player')}>Save As New</button>
                        {selectedPlayerProfile && !(checkpointProfiles.player || []).find(p => p.id === selectedPlayerProfile)?.builtIn && (
                          <>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleUpdateProfile('player')}>
                              Update{profileDirty.player ? ' !' : ''}
                            </button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteProfile('player')}>Delete</button>
                          </>
                        )}
                      </div>
                      {[
                        { key: '0', label: '0% — Pre-Inflation', hint: 'Requirements that must be met before inflation begins. When filled, the AI is told not to activate the pump until these conditions are satisfied.' },
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
                        { key: '100+', label: '100%+ — Over-Inflation' }
                      ].map(({ key, label, hint }) => (
                        <div className="form-group checkpoint-field" key={key}>
                          <div className="checkpoint-header">
                            <label>{label}</label>
                            <button
                              type="button"
                              className="checkpoint-spoiler-toggle"
                              onClick={() => setVisibleCheckpoints(prev => ({ ...prev, [`player-${key}`]: !prev[`player-${key}`] }))}
                              title={visibleCheckpoints[`player-${key}`] ? 'Hide' : 'Show'}
                            >
                              <span className="spoiler-eye">{visibleCheckpoints[`player-${key}`] ? '👁' : '👁‍🗨'}</span>
                              <span className="spoiler-label">{visibleCheckpoints[`player-${key}`] ? 'Hide Spoiler' : 'Show Spoiler'}</span>
                            </button>
                          </div>
                          {hint && <p className="section-hint">{hint}</p>}
                          <div className={`checkpoint-spoiler-wrap ${visibleCheckpoints[`player-${key}`] ? 'revealed' : ''}`}>
                            <textarea
                              value={activeStory?.checkpoints?.[key] || ''}
                              onChange={(e) => {
                                updateStoryField('checkpoints', {
                                  ...(activeStory?.checkpoints || {}),
                                  [key]: e.target.value
                                });
                                setProfileDirty(prev => ({ ...prev, player: true }));
                              }}
                              placeholder={key === '0' ? 'e.g. Establish trust and comfort before any inflation begins...' : `Guidance for ${label} capacity...`}
                              rows={3}
                            />
                          </div>
                          {/* Checkpoint triggers */}
                          <div className="checkpoint-triggers">
                            <div className="checkpoint-triggers-header">
                              <span className="checkpoint-triggers-label">Triggers</span>
                              <button type="button" className="btn-icon btn-add" onClick={() => {
                                const trigKey = `player-${key}`;
                                const ct = { ...(activeStory?.checkpointTriggers || {}) };
                                ct[trigKey] = [...(ct[trigKey] || []), { type: 'impersonate', id: Date.now().toString() }];
                                updateStoryField('checkpointTriggers', ct);
                              }} title="Add trigger">+</button>
                            </div>
                            {(activeStory?.checkpointTriggers?.[`player-${key}`] || []).map((trigger, tIdx) => (
                              <TriggerRow key={trigger.id || tIdx} trigger={trigger} isPumpable={formData.isPumpable}
                                reminders={formData.globalReminders || []} globalReminders={systemGlobalReminders}
                                onChange={(updated) => { const ct = { ...(activeStory?.checkpointTriggers || {}) }; const items = [...(ct[`player-${key}`] || [])]; items[tIdx] = updated; ct[`player-${key}`] = items; updateStoryField('checkpointTriggers', ct); }}
                                onRemove={() => { const ct = { ...(activeStory?.checkpointTriggers || {}) }; ct[`player-${key}`] = (ct[`player-${key}`] || []).filter((_, i) => i !== tIdx); updateStoryField('checkpointTriggers', ct); }}
                                dragProps={{ draggable: true, onDragStart: (e) => e.dataTransfer.setData('text/plain', tIdx.toString()), onDragOver: (e) => e.preventDefault(), onDrop: (e) => { e.preventDefault(); const from = parseInt(e.dataTransfer.getData('text/plain')); if (from === tIdx) return; const ct = { ...(activeStory?.checkpointTriggers || {}) }; const items = [...(ct[`player-${key}`] || [])]; const [m] = items.splice(from, 1); items.splice(tIdx, 0, m); ct[`player-${key}`] = items; updateStoryField('checkpointTriggers', ct); } }}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Character Capacity Checkpoints */}
                  {checkpointSubTab === 'character' && (
                    <>
                      <h4>Character Capacity Checkpoints</h4>
                      <p className="section-hint">Stage directions telling the AI how to react to <strong>their own</strong> inflation at each capacity range. Uses <code>[Char]</code> for the character name.</p>

                      <div className="checkpoint-profile-bar">
                        <select
                          value={selectedCharProfile}
                          onChange={(e) => handleLoadProfile(e.target.value, 'character')}
                          className="checkpoint-profile-select"
                        >
                          <option value="">-- Load Profile --</option>
                          {(checkpointProfiles.character || []).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => handleSaveNewProfile('character')}>Save As New</button>
                        {selectedCharProfile && !(checkpointProfiles.character || []).find(p => p.id === selectedCharProfile)?.builtIn && (
                          <>
                            <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleUpdateProfile('character')}>
                              Update{profileDirty.character ? ' !' : ''}
                            </button>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteProfile('character')}>Delete</button>
                          </>
                        )}
                      </div>
                      {[
                        { key: '0', label: '0% — Pre-Inflation', hint: 'Guidance for the character before their own inflation begins.' },
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
                        { key: '100+', label: '100%+ — Over-Inflation' }
                      ].map(({ key, label, hint }) => (
                        <div className="form-group checkpoint-field" key={key}>
                          <div className="checkpoint-header">
                            <label>{label}</label>
                            <button
                              type="button"
                              className="checkpoint-spoiler-toggle"
                              onClick={() => setVisibleCheckpoints(prev => ({ ...prev, [`char-${key}`]: !prev[`char-${key}`] }))}
                              title={visibleCheckpoints[`char-${key}`] ? 'Hide' : 'Show'}
                            >
                              <span className="spoiler-eye">{visibleCheckpoints[`char-${key}`] ? '👁' : '👁‍🗨'}</span>
                              <span className="spoiler-label">{visibleCheckpoints[`char-${key}`] ? 'Hide Spoiler' : 'Show Spoiler'}</span>
                            </button>
                          </div>
                          {hint && <p className="section-hint">{hint}</p>}
                          <div className={`checkpoint-spoiler-wrap ${visibleCheckpoints[`char-${key}`] ? 'revealed' : ''}`}>
                            <textarea
                              value={activeStory?.characterCheckpoints?.[key] || ''}
                              onChange={(e) => {
                                updateStoryField('characterCheckpoints', {
                                  ...(activeStory?.characterCheckpoints || {}),
                                  [key]: e.target.value
                                });
                                setProfileDirty(prev => ({ ...prev, character: true }));
                              }}
                              placeholder={key === '0' ? 'e.g. Character is unaware of what inflation feels like...' : `Guidance for character at ${label} capacity...`}
                              rows={3}
                            />
                          </div>
                          {/* Checkpoint triggers */}
                          <div className="checkpoint-triggers">
                            <div className="checkpoint-triggers-header">
                              <span className="checkpoint-triggers-label">Triggers</span>
                              <button type="button" className="btn-icon btn-add" onClick={() => {
                                const trigKey = `char-${key}`;
                                const ct = { ...(activeStory?.checkpointTriggers || {}) };
                                ct[trigKey] = [...(ct[trigKey] || []), { type: 'impersonate', id: Date.now().toString() }];
                                updateStoryField('checkpointTriggers', ct);
                              }} title="Add trigger">+</button>
                            </div>
                            {(activeStory?.checkpointTriggers?.[`char-${key}`] || []).map((trigger, tIdx) => (
                              <TriggerRow key={trigger.id || tIdx} trigger={trigger} isPumpable={formData.isPumpable}
                                reminders={formData.globalReminders || []} globalReminders={systemGlobalReminders}
                                onChange={(updated) => { const ct = { ...(activeStory?.checkpointTriggers || {}) }; const items = [...(ct[`char-${key}`] || [])]; items[tIdx] = updated; ct[`char-${key}`] = items; updateStoryField('checkpointTriggers', ct); }}
                                onRemove={() => { const ct = { ...(activeStory?.checkpointTriggers || {}) }; ct[`char-${key}`] = (ct[`char-${key}`] || []).filter((_, i) => i !== tIdx); updateStoryField('checkpointTriggers', ct); }}
                                dragProps={{ draggable: true, onDragStart: (e) => e.dataTransfer.setData('text/plain', tIdx.toString()), onDragOver: (e) => e.preventDefault(), onDrop: (e) => { e.preventDefault(); const from = parseInt(e.dataTransfer.getData('text/plain')); if (from === tIdx) return; const ct = { ...(activeStory?.checkpointTriggers || {}) }; const items = [...(ct[`char-${key}`] || [])]; const [m] = items.splice(from, 1); items.splice(tIdx, 0, m); ct[`char-${key}`] = items; updateStoryField('checkpointTriggers', ct); } }}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <>
                  <h4>Capacity Checkpoints</h4>
                  <p className="section-hint">Stage directions telling the AI how to react to the <strong>player's</strong> inflation at each capacity range. Uses <code>[Player]</code> for the persona name.</p>

                  <div className="checkpoint-profile-bar">
                    <select
                      value={selectedPlayerProfile}
                      onChange={(e) => handleLoadProfile(e.target.value, 'player')}
                      className="checkpoint-profile-select"
                    >
                      <option value="">-- Load Profile --</option>
                      {(checkpointProfiles.player || []).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => handleSaveNewProfile('player')}>Save As New</button>
                    {selectedPlayerProfile && !(checkpointProfiles.player || []).find(p => p.id === selectedPlayerProfile)?.builtIn && (
                      <>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleUpdateProfile('player')}>
                          Update{profileDirty.player ? ' !' : ''}
                        </button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteProfile('player')}>Delete</button>
                      </>
                    )}
                  </div>
                  {[
                    { key: '0', label: '0% — Pre-Inflation', hint: 'Requirements that must be met before inflation begins. When filled, the AI is told not to activate the pump until these conditions are satisfied.' },
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
                    { key: '100+', label: '100%+ — Over-Inflation' }
                  ].map(({ key, label, hint }) => (
                    <div className="form-group" key={key}>
                      <label>{label}</label>
                      {hint && <p className="section-hint">{hint}</p>}
                      <textarea
                        value={activeStory?.checkpoints?.[key] || ''}
                        onChange={(e) => {
                          updateStoryField('checkpoints', {
                            ...(activeStory?.checkpoints || {}),
                            [key]: e.target.value
                          });
                          setProfileDirty(prev => ({ ...prev, player: true }));
                        }}
                        placeholder={key === '0' ? 'e.g. Establish trust and comfort before any inflation begins...' : `Guidance for ${label} capacity...`}
                        rows={3}
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Character Staged Portraits Tab */}
          {formData.isPumpable && (
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
                            body: form
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
                            ref={(el) => charMediaIdleRefs.current[range.id] = el}
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
                            ref={(el) => charMediaTransRefs.current[range.id] = el}
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

          {/* Attributes Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'attributes' ? 'block' : 'none' }}>
            <div className="session-defaults-editor">
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
                  <label>{label}: {activeStory?.attributes?.[key] || 0}%</label>
                  <p className="section-hint">{hint}</p>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={activeStory?.attributes?.[key] || 0}
                    onChange={(e) => updateStoryField('attributes', {
                      ...(activeStory?.attributes || {}),
                      [key]: parseInt(e.target.value)
                    })}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}

              <h4 style={{ marginTop: '1.5rem' }}>Inflation Disposition</h4>
              <p className="section-hint">These are always active and affect every AI response. They define this character's baseline attitude toward inflating and popping others.</p>

              <div className="form-group">
                <label>Desire to Inflate Others</label>
                <select
                  value={formData.desireToInflateOthers || 'none'}
                  onChange={(e) => setFormData(prev => ({ ...prev, desireToInflateOthers: e.target.value }))}
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
                  value={formData.desireToPopOthers || 'none'}
                  onChange={(e) => setFormData(prev => ({ ...prev, desireToPopOthers: e.target.value }))}
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
            </div>
          </div>

          <div className="modal-footer character-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">{character ? 'Update' : 'Create'} Character</button>
          </div>
        </form>
      </div>

      {showCropModal && (
        <ImageCropModal image={uploadedImage} onSave={handleCropSave} onCancel={handleCropCancel} />
      )}

      {/* Loading overlay during enhancement */}
      {(enhancingWelcomeMessage || enhancingScenario) && (
        <div className="enhancement-overlay" />
      )}
    </div>
  );
}

// Image Crop Modal
function ImageCropModal({ image, onSave, onCancel }) {
  const containerRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imageObj, setImageObj] = React.useState(null);
  const [displayScale, setDisplayScale] = React.useState(1);
  const [crop, setCrop] = React.useState({ x: 0, y: 0, width: 100, height: 133 });
  const [dragging, setDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

  const OUTPUT_WIDTH = 512;
  const OUTPUT_HEIGHT = 911;
  const ASPECT_RATIO = 9 / 16;

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);
      const maxDisplayWidth = 500;
      const scale = img.width > maxDisplayWidth ? maxDisplayWidth / img.width : 1;
      setDisplayScale(scale);
      const maxCropWidth = img.width;
      const maxCropHeight = img.height;
      let cropWidth, cropHeight;
      if (maxCropWidth / maxCropHeight > ASPECT_RATIO) {
        cropHeight = maxCropHeight;
        cropWidth = cropHeight * ASPECT_RATIO;
      } else {
        cropWidth = maxCropWidth;
        cropHeight = cropWidth / ASPECT_RATIO;
      }
      setCrop({
        x: (img.width - cropWidth) / 2,
        y: (img.height - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight
      });
    };
    img.src = image;
  }, [image]);

  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(true);
    setDragStart({
      x: e.clientX - rect.left - crop.x * displayScale,
      y: e.clientY - rect.top - crop.y * displayScale
    });
  };

  React.useEffect(() => {
    if (!dragging || !imageObj) return;
    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      let newX = (e.clientX - rect.left - dragStart.x) / displayScale;
      let newY = (e.clientY - rect.top - dragStart.y) / displayScale;
      newX = Math.max(0, Math.min(newX, imageObj.width - crop.width));
      newY = Math.max(0, Math.min(newY, imageObj.height - crop.height));
      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    };
    const handleMouseUp = () => setDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStart, displayScale, imageObj, crop.width, crop.height]);

  const handleSave = () => {
    if (!imageObj) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    ctx.drawImage(imageObj, crop.x, crop.y, crop.width, crop.height, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    onSave(canvas.toDataURL('image/jpeg', 0.9));
  };

  if (!imageObj) return null;
  const displayWidth = imageObj.width * displayScale;
  const displayHeight = imageObj.height * displayScale;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Crop Avatar</h3>
          <button type="button" className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="text-muted" style={{ marginBottom: '1rem' }}>Drag the crop area to select portion</p>
          <div ref={containerRef} className="crop-container" style={{ width: displayWidth, height: displayHeight, position: 'relative', margin: '0 auto', overflow: 'hidden' }}>
            <img src={image} alt="Crop source" style={{ width: displayWidth, height: displayHeight, display: 'block' }} />
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                left: crop.x * displayScale,
                top: crop.y * displayScale,
                width: crop.width * displayScale,
                height: crop.height * displayScale,
                border: '2px solid #4CAF50',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                cursor: dragging ? 'grabbing' : 'grab',
                backgroundImage: `url(${image})`,
                backgroundSize: `${displayWidth}px ${displayHeight}px`,
                backgroundPosition: `-${crop.x * displayScale}px -${crop.y * displayScale}px`
              }}
            />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default CharacterEditorModal;
