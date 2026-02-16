import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useDraft, getDraftKey } from '../../hooks/useDraft';
import KeywordInput from '../common/KeywordInput';
import './CharacterEditorModal.css';
import './MultiCharEditorModal.css';

// Migration function to ensure story data has v2 format
function migrateStoryToV2(story, character) {
  let welcomeMessages = story.welcomeMessages;
  let activeWelcomeMessageId = story.activeWelcomeMessageId;

  const wmEmpty = !Array.isArray(welcomeMessages) ||
    welcomeMessages.length === 0 ||
    (welcomeMessages.length === 1 && !welcomeMessages[0]?.text);

  if (wmEmpty) {
    if (story.welcomeMessage) {
      welcomeMessages = [{ id: 'wm-1', text: story.welcomeMessage, llmEnhanced: story.llmEnhanced || false }];
    } else if (character?.welcomeMessages?.length > 0 && character.welcomeMessages[0]?.text) {
      welcomeMessages = character.welcomeMessages;
    } else {
      welcomeMessages = [{ id: 'wm-1', text: '', llmEnhanced: false }];
    }
    activeWelcomeMessageId = welcomeMessages[0]?.id || null;
  }

  let scenarios = story.scenarios;
  let activeScenarioId = story.activeScenarioId;

  const scEmpty = !Array.isArray(scenarios) ||
    scenarios.length === 0 ||
    (scenarios.length === 1 && !scenarios[0]?.text);

  if (scEmpty) {
    if (story.scenario) {
      scenarios = [{ id: 'sc-1', text: story.scenario }];
    } else if (character?.scenarios?.length > 0 && character.scenarios[0]?.text) {
      scenarios = character.scenarios;
    } else {
      scenarios = [{ id: 'sc-1', text: '' }];
    }
    activeScenarioId = scenarios[0]?.id || null;
  }

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

function MultiCharEditorModal({ isOpen, onClose, onSave, character }) {
  const { flows, devices, settings, personas, api } = useApp();

  const systemGlobalReminders = settings?.globalReminders || [];

  const validFlowIds = useMemo(() => new Set((flows || []).map(f => f.id)), [flows]);
  const filterValidFlows = useCallback((flowIds) => {
    if (!flowIds || !Array.isArray(flowIds)) return [];
    return flowIds.filter(id => validFlowIds.has(id));
  }, [validFlowIds]);

  // Calculate initial data from character prop
  const initialData = useMemo(() => {
    if (character) {
      let stories = character.stories || [];

      if (stories.length === 0) {
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
        stories = stories.map(s => {
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

      // Extract multi-char characters or create defaults
      const multiChars = character.multiChar?.characters || [
        { id: 'mc-1', name: '', description: '', personality: '' },
        { id: 'mc-2', name: '', description: '', personality: '' }
      ];

      return {
        name: character.name || '',
        avatar: character.avatar || '',
        description: character.description || '',
        personality: character.personality || '',
        multiChar: {
          enabled: true,
          characters: multiChars
        },
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

    // New multi-char character defaults
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
      multiChar: {
        enabled: true,
        characters: [
          { id: 'mc-1', name: '', description: '', personality: '' },
          { id: 'mc-2', name: '', description: '', personality: '' }
        ]
      },
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

  // Draft persistence
  const draftKey = getDraftKey('multichar', character?.id);
  const isReady = isOpen && character?.id;
  const { formData, setFormData, clearDraft, hasDraft } = useDraft(draftKey, initialData, isReady);

  // Migrate draft data to v2 format if needed
  useEffect(() => {
    if (!isOpen || !formData.stories || !hasDraft) return;

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
  }, [isOpen, formData.stories?.length, character, hasDraft]);

  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [editingStoryName, setEditingStoryName] = useState(false);
  const [storyNameInput, setStoryNameInput] = useState('');
  const [newDialogue, setNewDialogue] = useState({ user: '', response: '' });
  const [editingDialogueIndex, setEditingDialogueIndex] = useState(null);
  const [editDialogue, setEditDialogue] = useState({ user: '', response: '' });
  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [activeTab, setActiveTab] = useState('basic');
  const [showButtonForm, setShowButtonForm] = useState(false);
  const [editingButtonId, setEditingButtonId] = useState(null);
  const [buttonForm, setButtonForm] = useState({ name: '', buttonId: null, actions: [] });
  const [spoilersDropdownOpen, setSpoilersDropdownOpen] = useState(false);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState(null);
  const [reminderForm, setReminderForm] = useState({
    name: '', text: '', target: 'character', constant: true, keys: [],
    caseSensitive: false, priority: 100, scanDepth: 10
  });
  const [selectedFlowToAdd, setSelectedFlowToAdd] = useState('');
  const [selectedButtonToAdd, setSelectedButtonToAdd] = useState('');
  const [selectedConstantReminder, setSelectedConstantReminder] = useState('');
  const [selectedGlobalReminder, setSelectedGlobalReminder] = useState('');
  const [draggedButtonId, setDraggedButtonId] = useState(null);
  const fileInputRef = React.useRef(null);
  const lorebookFileInputRef = React.useRef(null);
  const [importingLorebook, setImportingLorebook] = useState(false);

  // LLM enhancement state
  const [enhancingWelcomeMessage, setEnhancingWelcomeMessage] = useState(false);
  const [enhancingScenario, setEnhancingScenario] = useState(false);
  const cancelledRef = React.useRef({ welcomeMessage: false, scenario: false });

  // Derive POV from active persona's pronouns
  const activePersona = personas?.find(p => p.id === settings?.activePersonaId);
  const playerName = activePersona?.displayName || 'The player';
  const personaPronouns = activePersona?.pronouns || 'they/them';
  const activePOV = personaPronouns === 'she/her' ? 'FEMPOV' : personaPronouns === 'he/him' ? 'MALEPOV' : 'ANYPOV';

  // Multi-char specific state
  const [selectedCharIndex, setSelectedCharIndex] = useState(0);

  // Sync selected story ID when formData changes
  useEffect(() => {
    if (isOpen && formData.stories?.length > 0) {
      setSelectedStoryId(formData.activeStoryId || formData.stories[0]?.id || null);
    }
  }, [isOpen, formData.activeStoryId, formData.stories]);

  // Memoize computed values
  const stories = useMemo(() => formData.stories || [], [formData.stories]);
  const buttons = useMemo(() => formData.buttons || [], [formData.buttons]);
  const globalReminders = useMemo(() => formData.globalReminders || [], [formData.globalReminders]);
  const multiChars = useMemo(() => formData.multiChar?.characters || [], [formData.multiChar?.characters]);

  const activeStory = useMemo(() => {
    if (!stories.length) return null;
    return stories.find(s => s.id === selectedStoryId) || stories[0];
  }, [stories, selectedStoryId]);

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

  // Welcome message / scenario helpers
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

  const handleWelcomeMessageChange = (wmId) => {
    updateStoryField('activeWelcomeMessageId', wmId);
  };

  const handleUpdateWelcomeMessageText = (text) => {
    const story = getActiveStory();
    if (!story) return;
    const wmId = story.activeWelcomeMessageId || story.welcomeMessages?.[0]?.id;
    const updatedWMs = (story.welcomeMessages || []).map(wm =>
      wm.id === wmId ? { ...wm, text } : wm
    );
    updateStoryField('welcomeMessages', updatedWMs);
  };

  const handleToggleLlmEnhanced = () => {
    const story = getActiveStory();
    if (!story) return;
    const wmId = story.activeWelcomeMessageId || story.welcomeMessages?.[0]?.id;
    const updatedWMs = (story.welcomeMessages || []).map(wm =>
      wm.id === wmId ? { ...wm, llmEnhanced: !wm.llmEnhanced } : wm
    );
    updateStoryField('welcomeMessages', updatedWMs);
  };

  const handleAddWelcomeMessage = () => {
    const story = getActiveStory();
    if (!story) return;
    const newId = `wm-${Date.now()}`;
    const updatedWMs = [...(story.welcomeMessages || []), { id: newId, text: '', llmEnhanced: false }];
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === story.id ? { ...s, welcomeMessages: updatedWMs, activeWelcomeMessageId: newId } : s
      )
    }));
  };

  const handleDeleteWelcomeMessage = () => {
    const story = getActiveStory();
    if (!story || (story.welcomeMessages || []).length <= 1) return;
    const wmId = story.activeWelcomeMessageId;
    const updatedWMs = (story.welcomeMessages || []).filter(wm => wm.id !== wmId);
    const newActiveId = updatedWMs[0]?.id || null;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === story.id ? { ...s, welcomeMessages: updatedWMs, activeWelcomeMessageId: newActiveId } : s
      )
    }));
  };

  const handleScenarioChange = (scId) => {
    updateStoryField('activeScenarioId', scId);
  };

  const handleUpdateScenarioText = (text) => {
    const story = getActiveStory();
    if (!story) return;
    const scId = story.activeScenarioId || story.scenarios?.[0]?.id;
    const updatedSCs = (story.scenarios || []).map(sc =>
      sc.id === scId ? { ...sc, text } : sc
    );
    updateStoryField('scenarios', updatedSCs);
  };

  const handleAddScenario = () => {
    const story = getActiveStory();
    if (!story) return;
    const newId = `sc-${Date.now()}`;
    const updatedSCs = [...(story.scenarios || []), { id: newId, text: '' }];
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === story.id ? { ...s, scenarios: updatedSCs, activeScenarioId: newId } : s
      )
    }));
  };

  const handleDeleteScenario = () => {
    const story = getActiveStory();
    if (!story || (story.scenarios || []).length <= 1) return;
    const scId = story.activeScenarioId;
    const updatedSCs = (story.scenarios || []).filter(sc => sc.id !== scId);
    const newActiveId = updatedSCs[0]?.id || null;
    setFormData(prev => ({
      ...prev,
      stories: (prev.stories || []).map(s =>
        s.id === story.id ? { ...s, scenarios: updatedSCs, activeScenarioId: newActiveId } : s
      )
    }));
  };

  // Build POV instruction string from active persona
  const getPovInstruction = () => {
    const genderNote = activePOV === 'FEMPOV' ? `${playerName} is female (she/her).`
      : activePOV === 'MALEPOV' ? `${playerName} is male (he/him).`
      : `${playerName} is unspecified gender (they/them).`;
    return `${genderNote} When referring to the player with pronouns, ALWAYS use the [Gender] variable instead of writing literal pronouns. Examples: "looks at [Gender]", "[Gender] eyes", "[Gender] smiles". The [Gender] tag auto-resolves to the correct pronoun form at runtime.`;
  };

  // Build multi-char context summary for LLM prompts
  const getCharacterContext = () => {
    const chars = formData.multiChar?.characters || [];
    return chars.map(c =>
      `${c.name || 'Unnamed'}${c.description ? ': ' + c.description : ''}${c.personality ? ' (Personality: ' + c.personality + ')' : ''}`
    ).join('\n');
  };

  // Enhance welcome message with LLM
  const handleEnhanceWelcomeMessage = async () => {
    if (enhancingWelcomeMessage) {
      cancelledRef.current.welcomeMessage = true;
      setEnhancingWelcomeMessage(false);
      return;
    }

    const story = getActiveStory();
    const activeWm = getActiveWelcomeMessage();
    const currentText = activeWm?.text || '';
    const exampleDialogues = story?.exampleDialogues || [];

    let dialogExamplesSection = '';
    if (exampleDialogues.length > 0) {
      dialogExamplesSection = '\n\nDialog Examples (showing how these characters speak):\n';
      exampleDialogues.forEach((dialogue, idx) => {
        dialogExamplesSection += `\nExample ${idx + 1}:\n`;
        dialogExamplesSection += `[Player]: ${dialogue.user}\n`;
        dialogExamplesSection += `Response: ${dialogue.response || dialogue.character}\n`;
      });
    }

    const prompt = `You are a creative writing assistant helping to craft an immersive greeting message for a multi-character card.

Card Name: ${formData.name || 'Character Card'}
${formData.description ? `Description: ${formData.description}` : ''}

Characters in this card:
${getCharacterContext()}
${dialogExamplesSection}

IMPORTANT INSTRUCTIONS:
- Write the greeting featuring ALL characters in the card
- Use roleplay format: *actions in asterisks* mixed with "dialog in quotes"
- Use [Player] for the player's name and [Gender] for their pronouns (both auto-resolve at runtime)
- ${getPovInstruction()}
- The greeting should show what the characters are doing and saying in the moment
- Make it engaging, sensory, and in-character
- Keep language natural and grounded - avoid purple prose or overly flowery descriptions
${exampleDialogues.length > 0 ? '- Match the speaking style and tone shown in the dialog examples above' : ''}

${currentText ? `Current greeting:\n${currentText}\n\nPlease rewrite and enhance this greeting following the format above. Keep the same general intent but improve the prose, add sensory details, and ensure proper roleplay formatting.` : 'Write a compelling first greeting message featuring these characters. Use the roleplay format with *actions* and "dialog", include [Player] variable where appropriate.'}

Write only the greeting message itself, no explanations or meta-commentary.`;

    try {
      cancelledRef.current.welcomeMessage = false;
      setEnhancingWelcomeMessage(true);

      const response = await api.generateText({ prompt, maxTokens: 500 });

      if (cancelledRef.current.welcomeMessage) return;

      if (response && response.text) {
        const wmId = story?.activeWelcomeMessageId || story?.welcomeMessages?.[0]?.id;
        const updatedWMs = (story.welcomeMessages || []).map(wm =>
          wm.id === wmId ? { ...wm, text: response.text.trim() } : wm
        );
        updateStoryField('welcomeMessages', updatedWMs);
      }
    } catch (error) {
      if (cancelledRef.current.welcomeMessage) return;
      alert(`Failed to enhance welcome message: ${error.message}`);
    } finally {
      setEnhancingWelcomeMessage(false);
    }
  };

  // Enhance scenario with LLM
  const handleEnhanceScenario = async () => {
    if (enhancingScenario) {
      cancelledRef.current.scenario = true;
      setEnhancingScenario(false);
      return;
    }

    const story = getActiveStory();
    const activeScId = story?.activeScenarioId;
    const activeScenario = (story?.scenarios || []).find(sc => sc.id === activeScId);
    const currentText = activeScenario?.text || '';
    const exampleDialogues = story?.exampleDialogues || [];

    let dialogExamplesSection = '';
    if (exampleDialogues.length > 0) {
      dialogExamplesSection = '\n\nDialog Examples (showing character context):\n';
      exampleDialogues.forEach((dialogue, idx) => {
        dialogExamplesSection += `\nExample ${idx + 1}:\n`;
        dialogExamplesSection += `[Player]: ${dialogue.user}\n`;
        dialogExamplesSection += `Response: ${dialogue.response || dialogue.character}\n`;
      });
    }

    const prompt = `You are a creative writing assistant helping to craft a concise scenario description for a multi-character card.

Card Name: ${formData.name || 'Character Card'}
${formData.description ? `Description: ${formData.description}` : ''}

Characters in this card:
${getCharacterContext()}
${dialogExamplesSection}

IMPORTANT INSTRUCTIONS:
- Write a simple, descriptive scenario in 1-2 sentences
- Use third-person perspective (describe the situation objectively)
- Use [Player] for the player's name and [Gender] for their pronouns (both auto-resolve at runtime)
- ${getPovInstruction()}
- Focus on setting and situation, not actions or dialog
- Keep it concise and atmospheric
- Use natural, grounded language - avoid purple prose or excessive flowery descriptions
${exampleDialogues.length > 0 ? '- Consider the context and relationship shown in the dialog examples' : ''}

${currentText ? `Current scenario:\n${currentText}\n\nPlease rewrite this scenario following the guidelines above. Keep it brief (1-2 sentences) but vivid.` : 'Write a brief scenario description (1-2 sentences) that sets the scene for these characters.'}

Write only the scenario description itself, no explanations.`;

    try {
      cancelledRef.current.scenario = false;
      setEnhancingScenario(true);

      const response = await api.generateText({ prompt, maxTokens: 100 });

      if (cancelledRef.current.scenario) return;

      if (response && response.text) {
        const updatedSCs = (story.scenarios || []).map(sc =>
          sc.id === activeScId ? { ...sc, text: response.text.trim() } : sc
        );
        updateStoryField('scenarios', updatedSCs);
      }
    } catch (error) {
      if (cancelledRef.current.scenario) return;
      alert(`Failed to enhance scenario: ${error.message}`);
    } finally {
      setEnhancingScenario(false);
    }
  };

  // Multi-char character management
  const handleAddMultiChar = () => {
    const newId = `mc-${Date.now()}`;
    setFormData(prev => ({
      ...prev,
      multiChar: {
        ...prev.multiChar,
        characters: [...(prev.multiChar?.characters || []), { id: newId, name: '', description: '', personality: '' }]
      }
    }));
  };

  const handleRemoveMultiChar = (index) => {
    if ((formData.multiChar?.characters || []).length <= 2) return;
    setFormData(prev => {
      const chars = [...(prev.multiChar?.characters || [])];
      chars.splice(index, 1);
      return {
        ...prev,
        multiChar: { ...prev.multiChar, characters: chars }
      };
    });
    if (selectedCharIndex >= index && selectedCharIndex > 0) {
      setSelectedCharIndex(selectedCharIndex - 1);
    }
  };

  const handleMultiCharNameChange = (index, value) => {
    setFormData(prev => {
      const chars = [...(prev.multiChar?.characters || [])];
      chars[index] = { ...chars[index], name: value };
      return {
        ...prev,
        multiChar: { ...prev.multiChar, characters: chars }
      };
    });
  };

  const handleMultiCharFieldChange = (index, field, value) => {
    setFormData(prev => {
      const chars = [...(prev.multiChar?.characters || [])];
      chars[index] = { ...chars[index], [field]: value };
      return {
        ...prev,
        multiChar: { ...prev.multiChar, characters: chars }
      };
    });
  };

  // Story management
  const handleStoryChange = (storyId) => {
    setSelectedStoryId(storyId);
    setEditingDialogueIndex(null);
    setNewDialogue({ user: '', response: '' });
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
    setFormData({ ...formData, stories: [...stories, newStory] });
    setSelectedStoryId(newId);
  };

  const handleDeleteStory = () => {
    if (stories.length <= 1) { alert('Cannot delete the last story'); return; }
    if (!window.confirm('Delete this story?')) return;
    const storyId = activeStory?.id;
    const filtered = stories.filter(s => s.id !== storyId);
    const newSelected = filtered[0]?.id || null;
    setFormData({ ...formData, stories: filtered, activeStoryId: newSelected });
    setSelectedStoryId(newSelected);
  };

  const handleRenameStory = () => {
    setStoryNameInput(activeStory?.name || '');
    setEditingStoryName(true);
  };

  const handleSaveStoryName = () => {
    if (!storyNameInput.trim()) { alert('Story name cannot be empty'); return; }
    updateStoryField('name', storyNameInput.trim());
    setEditingStoryName(false);
  };

  const handleCancelStoryName = () => {
    setEditingStoryName(false);
    setStoryNameInput('');
  };

  // Dialogue handlers (multi-char: uses response instead of character)
  const handleAddDialogue = () => {
    if (newDialogue.user.trim() && newDialogue.response.trim()) {
      const updatedDialogues = [...(activeStory?.exampleDialogues || []), newDialogue];
      updateStoryField('exampleDialogues', updatedDialogues);
      setNewDialogue({ user: '', response: '' });
    }
  };

  const handleRemoveDialogue = (index) => {
    const updatedDialogues = activeStory?.exampleDialogues?.filter((_, i) => i !== index) || [];
    updateStoryField('exampleDialogues', updatedDialogues);
    if (editingDialogueIndex === index) setEditingDialogueIndex(null);
  };

  const handleStartEditDialogue = (index) => {
    const dialogue = activeStory?.exampleDialogues?.[index];
    if (dialogue) {
      setEditDialogue({ user: dialogue.user, response: dialogue.response || dialogue.character || '' });
      setEditingDialogueIndex(index);
    }
  };

  const handleSaveEditDialogue = () => {
    if (editDialogue.user.trim() && editDialogue.response.trim()) {
      const updatedDialogues = (activeStory?.exampleDialogues || []).map((d, i) =>
        i === editingDialogueIndex ? editDialogue : d
      );
      updateStoryField('exampleDialogues', updatedDialogues);
      setEditingDialogueIndex(null);
      setEditDialogue({ user: '', response: '' });
    }
  };

  const handleCancelEditDialogue = () => {
    setEditingDialogueIndex(null);
    setEditDialogue({ user: '', response: '' });
  };

  // Flow assignment for story
  const handleAddStoryFlow = async () => {
    if (!selectedFlowToAdd) return;
    const storyId = activeStory?.id;
    if (!storyId) return;

    const flowToAdd = selectedFlowToAdd;
    setSelectedFlowToAdd('');

    try {
      const fullFlow = await api.getFlow(flowToAdd);
      const flowButtonNodes = (fullFlow?.nodes || []).filter(
        node => node.type === 'button_press' && node.data?.label
      );

      const newAutoButtons = [];
      const buttonIdsToAssign = [];
      const existingIds = buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
      let nextButtonId = existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;

      for (const node of flowButtonNodes) {
        const existingButton = buttons.find(b => b.sourceFlowId === flowToAdd && b.name === node.data.label);
        if (existingButton) {
          buttonIdsToAssign.push(existingButton.buttonId);
        } else {
          if (node.data.buttonId) {
            const linkedButton = buttons.find(b => String(b.buttonId) === String(node.data.buttonId));
            if (linkedButton) { buttonIdsToAssign.push(linkedButton.buttonId); continue; }
          }
          const newButtonId = nextButtonId++;
          buttonIdsToAssign.push(newButtonId);
          newAutoButtons.push({
            buttonId: newButtonId, name: node.data.label, actions: [],
            enabled: true, autoGenerated: true, sourceFlowId: flowToAdd
          });
        }
      }

      setFormData(prev => {
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
          return { ...s, assignedFlows: [...currentFlows, flowToAdd], assignedButtons: newAssignedButtons };
        });
        return { ...prev, buttons: updatedButtons, stories: updatedStories };
      });
    } catch (error) {
      console.error('Failed to fetch flow data:', error);
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
    const flowButtons = buttons.filter(b => b.sourceFlowId === flowId);
    const flowButtonIds = flowButtons.map(b => b.buttonId);

    setFormData(prev => {
      const updatedButtons = (prev.buttons || []).filter(b => !(b.autoGenerated && b.sourceFlowId === flowId));
      const updatedStories = (prev.stories || []).map(s => {
        if (s.id !== storyId) return s;
        const currentFlows = s.assignedFlows || [];
        const currentAssignedButtons = s.assignedButtons || [];
        return {
          ...s,
          assignedFlows: currentFlows.filter(id => id !== flowId),
          assignedButtons: currentAssignedButtons.filter(id => !flowButtonIds.includes(id))
        };
      });
      return { ...prev, buttons: updatedButtons, stories: updatedStories };
    });
  };

  const handleAddStoryButton = () => {
    if (!selectedButtonToAdd) return;
    const currentButtons = activeStory?.assignedButtons || [];
    const buttonIdNum = parseInt(selectedButtonToAdd, 10);
    if (!currentButtons.includes(buttonIdNum)) {
      updateStoryField('assignedButtons', [...currentButtons, buttonIdNum]);
    }
    setSelectedButtonToAdd('');
  };

  const handleRemoveStoryButton = (buttonId) => {
    const currentButtons = activeStory?.assignedButtons || [];
    updateStoryField('assignedButtons', currentButtons.filter(id => id !== buttonId));
  };

  // Button drag-and-drop
  const handleButtonDragStart = (e, buttonId) => {
    setDraggedButtonId(buttonId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', buttonId.toString());
  };

  const handleButtonDragEnd = () => { setDraggedButtonId(null); };

  const handleButtonDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const handleButtonDrop = (e, targetButtonId) => {
    e.preventDefault();
    if (draggedButtonId === null || draggedButtonId === targetButtonId) return;
    const currentButtons = [...(activeStory?.assignedButtons || [])];
    const draggedIndex = currentButtons.indexOf(draggedButtonId);
    const targetIndex = currentButtons.indexOf(targetButtonId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    currentButtons.splice(draggedIndex, 1);
    currentButtons.splice(targetIndex, 0, draggedButtonId);
    updateStoryField('assignedButtons', currentButtons);
    setDraggedButtonId(null);
  };

  // Reminder assignments
  const handleAddConstantReminder = () => {
    if (!selectedConstantReminder) return;
    const currentIds = activeStory?.constantReminderIds || [];
    if (!currentIds.includes(selectedConstantReminder)) {
      updateStoryField('constantReminderIds', [...currentIds, selectedConstantReminder]);
    }
    setSelectedConstantReminder('');
  };

  const handleRemoveConstantReminder = (reminderId) => {
    const currentIds = activeStory?.constantReminderIds || [];
    updateStoryField('constantReminderIds', currentIds.filter(id => id !== reminderId));
  };

  const handleAddGlobalReminder = () => {
    if (!selectedGlobalReminder) return;
    const currentIds = activeStory?.globalReminderIds || [];
    if (!currentIds.includes(selectedGlobalReminder)) {
      updateStoryField('globalReminderIds', [...currentIds, selectedGlobalReminder]);
    }
    setSelectedGlobalReminder('');
  };

  const handleRemoveGlobalReminder = (reminderId) => {
    const currentIds = activeStory?.globalReminderIds || [];
    updateStoryField('globalReminderIds', currentIds.filter(id => id !== reminderId));
  };

  // Submit
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Group name is required');
      return;
    }

    // Validate at least 2 characters have names
    const namedChars = (formData.multiChar?.characters || []).filter(c => c.name.trim());
    if (namedChars.length < 2) {
      alert('At least 2 characters must have names');
      return;
    }

    const activeStory = getActiveStory();
    const saveData = {
      ...formData,
      description: '', // unused for multi-char
      personality: '', // unused for multi-char
      multiChar: {
        enabled: true,
        characters: (formData.multiChar?.characters || []).filter(c => c.name.trim())
      },
      activeStoryId: activeStory?.id || formData.stories?.[0]?.id,
      autoReplyEnabled: activeStory?.autoReplyEnabled || false,
      allowLlmDeviceAccess: activeStory?.allowLlmDeviceAccess || false,
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
    if (!file.type.startsWith('image/')) { alert('Please upload an image file'); return; }
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
      buttons: (prev.buttons || []).map(b => b.buttonId === buttonId ? { ...b, enabled } : b)
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
    if (!buttonForm.name.trim()) { alert('Button name is required'); return; }
    setFormData(prev => {
      const currentButtons = prev.buttons || [];
      if (editingButtonId !== null) {
        return { ...prev, buttons: currentButtons.map(b => b.buttonId === editingButtonId ? buttonForm : b) };
      } else {
        return { ...prev, buttons: [...currentButtons, buttonForm] };
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
    setButtonForm({ ...buttonForm, actions: [...buttonForm.actions, { type: 'message', config: {} }] });
  };

  const handleUpdateAction = (index, field, value) => {
    const updatedActions = [...buttonForm.actions];
    if (field === 'type') { updatedActions[index] = { type: value, config: {} }; }
    else { updatedActions[index].config[field] = value; }
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleDeleteAction = (index) => {
    setButtonForm({ ...buttonForm, actions: buttonForm.actions.filter((_, i) => i !== index) });
  };

  const handleMoveAction = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === buttonForm.actions.length - 1) return;
    const updatedActions = [...buttonForm.actions];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [updatedActions[index], updatedActions[newIndex]] = [updatedActions[newIndex], updatedActions[index]];
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  // Reminder management
  const handleAddReminder = () => {
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '', target: 'character', constant: true, keys: [], caseSensitive: false, priority: 100, scanDepth: 10 });
    setShowReminderForm(true);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminderId(reminder.id);
    setReminderForm({
      name: reminder.name, text: reminder.text, target: reminder.target || 'character',
      constant: reminder.constant !== false, keys: reminder.keys || [], caseSensitive: reminder.caseSensitive || false,
      priority: reminder.priority !== undefined ? reminder.priority : 100,
      scanDepth: reminder.scanDepth !== undefined ? reminder.scanDepth : 10
    });
    setShowReminderForm(true);
  };

  const handleDeleteReminder = (reminderId) => {
    if (window.confirm('Delete this reminder?')) {
      setFormData({ ...formData, globalReminders: globalReminders.filter(r => r.id !== reminderId) });
    }
  };

  const handleToggleReminder = (reminderId, enabled) => {
    setFormData({ ...formData, globalReminders: globalReminders.map(r => r.id === reminderId ? { ...r, enabled } : r) });
  };

  const handleSaveReminder = () => {
    if (!reminderForm.name.trim() || !reminderForm.text.trim()) {
      alert('Reminder name and text are required');
      return;
    }
    if (reminderForm.constant === false && (!reminderForm.keys || reminderForm.keys.length === 0)) {
      alert('Please add at least one trigger keyword, or enable "Always Active"');
      return;
    }

    if (editingReminderId) {
      const updated = globalReminders.map(r =>
        r.id === editingReminderId ? {
          ...r, name: reminderForm.name, text: reminderForm.text, target: reminderForm.target,
          constant: reminderForm.constant, keys: reminderForm.keys || [], caseSensitive: reminderForm.caseSensitive || false,
          priority: reminderForm.priority !== undefined ? reminderForm.priority : 100,
          scanDepth: reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10
        } : r
      );
      setFormData({ ...formData, globalReminders: updated });
    } else {
      const newReminder = {
        id: `reminder-${Date.now()}`, name: reminderForm.name, text: reminderForm.text,
        target: reminderForm.target, enabled: true, constant: reminderForm.constant,
        keys: reminderForm.keys || [], caseSensitive: reminderForm.caseSensitive || false,
        priority: reminderForm.priority !== undefined ? reminderForm.priority : 100,
        scanDepth: reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10
      };
      setFormData({ ...formData, globalReminders: [...globalReminders, newReminder] });
    }

    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '', target: 'character', constant: true, keys: [], caseSensitive: false, priority: 100, scanDepth: 10 });
  };

  const handleCancelReminderEdit = () => {
    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '', target: 'character', constant: true, keys: [], caseSensitive: false, priority: 100, scanDepth: 10 });
  };

  // Lorebook import
  const handleLorebookImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportingLorebook(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      let entries = [];
      if (data.character_book?.entries && Array.isArray(data.character_book.entries)) entries = data.character_book.entries;
      else if (data.character_book?.entries && typeof data.character_book.entries === 'object') entries = Object.values(data.character_book.entries);
      else if (data.data?.character_book?.entries && Array.isArray(data.data.character_book.entries)) entries = data.data.character_book.entries;
      else if (data.data?.character_book?.entries && typeof data.data.character_book.entries === 'object') entries = Object.values(data.data.character_book.entries);
      else if (data.entries && Array.isArray(data.entries)) entries = data.entries;
      else if (data.entries && typeof data.entries === 'object') entries = Object.values(data.entries);
      else if (Array.isArray(data)) entries = data;
      else throw new Error('Invalid lorebook format.');

      if (!Array.isArray(entries)) throw new Error('Lorebook entries must be an array.');

      const newReminders = entries
        .filter(entry => entry.enabled !== false && entry.disable !== true)
        .map(entry => ({
          id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entry.name || entry.comment || 'Lorebook Entry',
          text: entry.content || entry.value || '',
          target: 'character', enabled: true,
          constant: entry.constant === true || (entry.selective !== undefined && !entry.selective),
          keys: entry.keys || entry.key || [],
          caseSensitive: entry.caseSensitive || entry.case_sensitive || false,
          priority: entry.priority !== undefined ? entry.priority : (entry.insertion_order || entry.order || 100),
          scanDepth: entry.extensions?.scan_depth || entry.scanDepth || entry.depth || 10
        }));

      if (newReminders.length === 0) throw new Error('No valid lorebook entries found.');
      setFormData({ ...formData, globalReminders: [...globalReminders, ...newReminders] });
      alert(`Successfully imported ${newReminders.length} lorebook entries as Custom Reminders.`);
    } catch (error) {
      console.error('Failed to import lorebook:', error);
      alert(error.message || 'Failed to import lorebook file');
    } finally {
      setImportingLorebook(false);
      if (lorebookFileInputRef.current) lorebookFileInputRef.current.value = '';
    }
  };

  const handleLorebookImportClick = () => { lorebookFileInputRef.current?.click(); };

  return (
    <div className="modal-overlay">
      <div className="modal character-editor-modal">
        <div className="modal-header character-modal-header">
          <h3>{character ? 'Edit Multi-Character' : 'New Multi-Character'}</h3>
          {hasDraft && (
            <span className="draft-indicator" title="Unsaved changes restored">Draft restored</span>
          )}
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>

        <div className="modal-tabs character-modal-tabs">
          <button type="button" className={`modal-tab ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')}>
            Characters
          </button>
          <button type="button" className={`modal-tab ${activeTab === 'reminders' ? 'active' : ''}`} onClick={() => setActiveTab('reminders')}>
            Custom Reminders
          </button>
          <button type="button" className={`modal-tab ${activeTab === 'events' ? 'active' : ''}`} onClick={() => setActiveTab('events')}>
            Custom Buttons
          </button>
          <button type="button" className={`modal-tab ${activeTab === 'session' ? 'active' : ''}`} onClick={() => setActiveTab('session')}>
            Session
          </button>
          <button type="button" className={`modal-tab ${activeTab === 'checkpoints' ? 'active' : ''}`} onClick={() => setActiveTab('checkpoints')}>
            Checkpoints
          </button>
          <button type="button" className={`modal-tab ${activeTab === 'attributes' ? 'active' : ''}`} onClick={() => setActiveTab('attributes')}>
            Attributes
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Characters Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'basic' ? 'block' : 'none' }}>
            <div className="editor-layout">
              <div className="editor-left">
                {/* Group Name */}
                <div className="form-group">
                  <label>Group Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Group display name"
                    required
                  />
                </div>

                {/* Character Names */}
                <div className="form-group">
                  <label>Characters</label>
                  <div className="multi-char-names">
                    {multiChars.map((mc, i) => (
                      <div key={mc.id} className="multi-char-name-row">
                        <span className="multi-char-label">Char {i + 1}</span>
                        <input
                          type="text"
                          value={mc.name}
                          onChange={(e) => handleMultiCharNameChange(i, e.target.value)}
                          placeholder={`Character ${i + 1} name`}
                        />
                        {multiChars.length > 2 && (
                          <button
                            type="button"
                            className="btn-icon btn-delete-small"
                            onClick={() => handleRemoveMultiChar(i)}
                            title="Remove character"
                          >
                            X
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddMultiChar}>
                      + Add Character
                    </button>
                  </div>
                </div>

                {/* Descriptions (per character via dropdown) */}
                <div className="form-group">
                  <label>Descriptions</label>
                  <select
                    className="multi-char-selector"
                    value={selectedCharIndex}
                    onChange={(e) => setSelectedCharIndex(parseInt(e.target.value))}
                  >
                    {multiChars.map((mc, i) => (
                      <option key={mc.id} value={i}>{mc.name || `Character ${i + 1}`}</option>
                    ))}
                  </select>
                  <textarea
                    value={multiChars[selectedCharIndex]?.description || ''}
                    onChange={(e) => handleMultiCharFieldChange(selectedCharIndex, 'description', e.target.value)}
                    placeholder={`Description for ${multiChars[selectedCharIndex]?.name || 'this character'}...`}
                  />
                </div>

                {/* Personalities (per character via same dropdown selection) */}
                <div className="form-group">
                  <label>Personality</label>
                  <textarea
                    value={multiChars[selectedCharIndex]?.personality || ''}
                    onChange={(e) => handleMultiCharFieldChange(selectedCharIndex, 'personality', e.target.value)}
                    placeholder={`Personality traits for ${multiChars[selectedCharIndex]?.name || 'this character'}...`}
                  />
                </div>
              </div>

              <div className="editor-right">
                <label>Group Avatar</label>
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
                    onClick={(e) => { e.stopPropagation(); setFormData({ ...formData, avatar: '' }); }}
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
                        <div className="story-spoilers-select" onClick={() => setSpoilersDropdownOpen(!spoilersDropdownOpen)} />
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
                <div className="auto-reply-field">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={activeStory?.autoReplyEnabled || false}
                      onChange={(e) => updateStoryField('autoReplyEnabled', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">Auto-Reply</span>
                    <span className="auto-reply-hint">AI responds automatically after each message</span>
                  </div>
                </div>

                {/* LLM Device Access */}
                <div className="auto-reply-field" style={{ marginTop: '0.5rem' }}>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={activeStory?.allowLlmDeviceAccess || false}
                      onChange={(e) => updateStoryField('allowLlmDeviceAccess', e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <div className="auto-reply-text">
                    <span className="auto-reply-label">LLM Device Access</span>
                    <span className="auto-reply-hint">Allow AI to control physical devices</span>
                  </div>
                </div>
                {activeStory?.allowLlmDeviceAccess && (
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
                <div className="auto-reply-field" style={{ marginTop: '0.5rem' }}>
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
                    <span className="auto-reply-hint">Auto-generate player reply suggestions</span>
                  </div>
                </div>
                {activeStory?.storyProgressionEnabled && (
                  <div className="story-field" style={{ marginTop: '0.25rem' }}>
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

                {/* Starting Emotion */}
                <div className="story-field" style={{ marginTop: '1rem' }}>
                  <label>Starting Emotion</label>
                  <select
                    value={activeStory?.startingEmotion || 'neutral'}
                    onChange={(e) => updateStoryField('startingEmotion', e.target.value)}
                  >
                    <option value="neutral">Neutral</option>
                    <option value="happy">Happy</option>
                    <option value="excited">Excited</option>
                    <option value="nervous">Nervous</option>
                    <option value="uncomfortable">Uncomfortable</option>
                    <option value="struggling">Struggling</option>
                    <option value="distressed">Distressed</option>
                    <option value="desperate">Desperate</option>
                  </select>
                </div>

                {/* Welcome Message */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>
                      Welcome Message
                      {enhancingWelcomeMessage && <span className="spinner-inline"> ⏳</span>}
                    </label>
                    <div className="version-controls">
                      <select
                        value={getActiveWelcomeMessage()?.id || ''}
                        onChange={(e) => handleWelcomeMessageChange(e.target.value)}
                        className="version-select"
                      >
                        {(activeStory?.welcomeMessages || []).map((wm, idx) => (
                          <option key={wm.id} value={wm.id}>Version {idx + 1}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add" onClick={handleAddWelcomeMessage} title="Add version">+</button>
                      <button
                        type="button"
                        className={`btn-icon btn-llm ${getActiveWelcomeMessage()?.llmEnhanced ? 'active' : ''}`}
                        onClick={handleToggleLlmEnhanced}
                        title={getActiveWelcomeMessage()?.llmEnhanced ? 'LLM Enhanced (click to disable)' : 'Click to enable LLM enhancement'}
                      >
                        🤖
                      </button>
                      <button
                        type="button"
                        className="btn-icon btn-delete"
                        onClick={handleDeleteWelcomeMessage}
                        disabled={(activeStory?.welcomeMessages || []).length <= 1}
                        title="Delete version"
                      >
                        🗑️
                      </button>
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
                    placeholder="Welcome message..."
                    rows={3}
                  />
                </div>

                {/* Scenario */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>
                      Scenario
                      {enhancingScenario && <span className="spinner-inline"> ⏳</span>}
                    </label>
                    <div className="version-controls">
                      <select
                        value={getActiveScenario()?.id || ''}
                        onChange={(e) => handleScenarioChange(e.target.value)}
                        className="version-select"
                      >
                        {(activeStory?.scenarios || []).map((sc, idx) => (
                          <option key={sc.id} value={sc.id}>Version {idx + 1}</option>
                        ))}
                      </select>
                      <button type="button" className="btn-icon btn-add" onClick={handleAddScenario} title="Add version">+</button>
                      <button
                        type="button"
                        className="btn-icon btn-delete"
                        onClick={handleDeleteScenario}
                        disabled={(activeStory?.scenarios || []).length <= 1}
                        title="Delete version"
                      >
                        🗑️
                      </button>
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

                {/* Example Dialogues — Multi-char version */}
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
                            <textarea
                              placeholder={`${multiChars[0]?.name || 'Luna'}: "Hey there!"\n${multiChars[1]?.name || 'Kai'}: *waves silently*`}
                              value={editDialogue.response}
                              onChange={(e) => setEditDialogue({ ...editDialogue, response: e.target.value })}
                              rows={3}
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
                              <p style={{ whiteSpace: 'pre-wrap' }}>{dialogue.response || dialogue.character}</p>
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
                  <div className="add-dialogue" style={{ flexDirection: 'column' }}>
                    <input
                      type="text"
                      placeholder="Player says..."
                      value={newDialogue.user}
                      onChange={(e) => setNewDialogue({ ...newDialogue, user: e.target.value })}
                    />
                    <textarea
                      placeholder={`${multiChars[0]?.name || 'Luna'}: "Hey there!"\n${multiChars[1]?.name || 'Kai'}: *waves silently*`}
                      value={newDialogue.response}
                      onChange={(e) => setNewDialogue({ ...newDialogue, response: e.target.value })}
                      rows={3}
                      style={{ width: '100%' }}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddDialogue} style={{ alignSelf: 'flex-end' }}>Add</button>
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
                      <span className="empty-hint">No buttons assigned</span>
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
                        <span className="empty-hint">No reminders assigned</span>
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
                        <span className="empty-hint">No global reminders assigned</span>
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
              </div>
            </div>
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
                  <p className="section-hint">Character-specific reminders. Create them here, then assign them to stories.</p>

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
                                <span className="priority-badge" title="Priority">P{reminder.priority}</span>
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
                          <input type="radio" name="reminderTarget" value="player"
                            checked={reminderForm.target === 'player'}
                            onChange={(e) => setReminderForm({ ...reminderForm, target: e.target.value })}
                          />
                          <span className="radio-title">Player</span>
                        </div>
                        <span className="radio-hint">Appears below player portrait</span>
                      </label>
                      <label className="radio-label">
                        <div className="radio-row">
                          <input type="radio" name="reminderTarget" value="character"
                            checked={reminderForm.target === 'character'}
                            onChange={(e) => setReminderForm({ ...reminderForm, target: e.target.value })}
                          />
                          <span className="radio-title">Character</span>
                        </div>
                        <span className="radio-hint">Appears below character portrait</span>
                      </label>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="checkbox-label-block">
                      <input
                        type="checkbox"
                        checked={reminderForm.constant !== false}
                        onChange={(e) => setReminderForm({ ...reminderForm, constant: e.target.checked })}
                      />
                      <div className="checkbox-content">
                        <span className="checkbox-title">Always Active (Constant)</span>
                        <span className="checkbox-hint">If unchecked, only activates when keywords are detected</span>
                      </div>
                    </label>
                  </div>

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
                          <input type="checkbox" checked={reminderForm.caseSensitive || false}
                            onChange={(e) => setReminderForm({ ...reminderForm, caseSensitive: e.target.checked })}
                          />
                          <span>Case Sensitive</span>
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <label>Scan Depth:</label>
                          <input type="number" value={reminderForm.scanDepth !== undefined ? reminderForm.scanDepth : 10}
                            onChange={(e) => setReminderForm({ ...reminderForm, scanDepth: parseInt(e.target.value) || 0 })}
                            min="0" max="100" style={{ width: '80px' }}
                          />
                          <span className="field-hint">(0 = all messages)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Priority (Insertion Order)</label>
                    <input type="number" value={reminderForm.priority !== undefined ? reminderForm.priority : 100}
                      onChange={(e) => setReminderForm({ ...reminderForm, priority: parseInt(e.target.value) || 100 })}
                      min="0" max="1000" style={{ width: '120px' }}
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
                  <p className="section-hint">Create buttons here, then assign them to specific stories.</p>

                  <div className="events-list-editor">
                    {buttons.length === 0 ? (
                      <p className="empty-message">No buttons yet.</p>
                    ) : (
                      buttons.map((button) => (
                        <div key={button.buttonId} className={`event-item ${button.enabled === false ? 'disabled' : ''} ${button.autoGenerated ? 'auto-generated' : ''}`}>
                          <label className="toggle-switch">
                            <input type="checkbox" checked={button.enabled !== false}
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
                    <input type="text" value={buttonForm.name}
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
                                <textarea value={action.config.text || ''}
                                  onChange={(e) => handleUpdateAction(index, 'text', e.target.value)}
                                  placeholder="Instruction for AI..." rows={2}
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

          {/* Session Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'session' ? 'block' : 'none' }}>
            <div className="session-defaults-editor">
              <h4>Session</h4>
              <p className="section-hint">These values will be used when starting a new session with this character group.</p>

              <div className="form-group">
                <div className="form-label-row">
                  <label>Starting Capacity</label>
                  <span className="form-value">{formData.sessionDefaults?.capacity || 0}%</span>
                </div>
                <input type="range" min="0" max="100" step="5"
                  value={formData.sessionDefaults?.capacity || 0}
                  onChange={(e) => setFormData(prev => ({
                    ...prev, sessionDefaults: { ...prev.sessionDefaults, capacity: parseInt(e.target.value) }
                  }))}
                />
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label>Pain Level</label>
                  <span className="form-value">{formData.sessionDefaults?.pain || 0}</span>
                </div>
                <input type="range" min="0" max="10" step="1"
                  value={formData.sessionDefaults?.pain || 0}
                  onChange={(e) => setFormData(prev => ({
                    ...prev, sessionDefaults: { ...prev.sessionDefaults, pain: parseInt(e.target.value) }
                  }))}
                />
              </div>

              <div className="form-group">
                <label>Emotion</label>
                <select
                  value={formData.sessionDefaults?.emotion || 'neutral'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev, sessionDefaults: { ...prev.sessionDefaults, emotion: e.target.value }
                  }))}
                >
                  <option value="neutral">Neutral</option>
                  <option value="happy">Happy</option>
                  <option value="excited">Excited</option>
                  <option value="nervous">Nervous</option>
                  <option value="uncomfortable">Uncomfortable</option>
                  <option value="struggling">Struggling</option>
                  <option value="distressed">Distressed</option>
                  <option value="desperate">Desperate</option>
                </select>
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label>Auto-Capacity Speed</label>
                  <span className="form-value">{(formData.sessionDefaults?.capacityModifier || 1.0).toFixed(2)}x</span>
                </div>
                <input type="range" min="0.25" max="2" step="0.25"
                  value={formData.sessionDefaults?.capacityModifier || 1.0}
                  onChange={(e) => setFormData(prev => ({
                    ...prev, sessionDefaults: { ...prev.sessionDefaults, capacityModifier: parseFloat(e.target.value) }
                  }))}
                />
                <div className="form-hint">Affects how fast capacity increases during auto-mode</div>
              </div>
            </div>
          </div>

          {/* Checkpoints Tab */}
          <div className="modal-body character-modal-body" style={{ display: activeTab === 'checkpoints' ? 'block' : 'none' }}>
            <div className="session-defaults-editor">
              <h4>Capacity Checkpoints</h4>
              <p className="section-hint">Author instructions injected into the AI prompt at different capacity ranges. Blank ranges are ignored.</p>

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
                    onChange={(e) => updateStoryField('checkpoints', {
                      ...(activeStory?.checkpoints || {}),
                      [key]: e.target.value
                    })}
                    placeholder={key === '0' ? 'e.g. Establish trust and comfort before any inflation begins...' : `Guidance for ${label} capacity...`}
                    rows={3}
                  />
                </div>
              ))}
            </div>
          </div>

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
            </div>
          </div>

          <div className="modal-footer character-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">{character ? 'Update' : 'Create'} Multi-Character</button>
          </div>
        </form>
      </div>

      {showCropModal && (
        <ImageCropModal image={uploadedImage} onSave={handleCropSave} onCancel={handleCropCancel} />
      )}
    </div>
  );
}

// Image Crop Modal (same as CharacterEditorModal)
function ImageCropModal({ image, onSave, onCancel }) {
  const containerRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imageObj, setImageObj] = React.useState(null);
  const [displayScale, setDisplayScale] = React.useState(1);
  const [crop, setCrop] = React.useState({ x: 0, y: 0, width: 100, height: 133 });
  const [dragging, setDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

  const OUTPUT_WIDTH = 512;
  const OUTPUT_HEIGHT = 683;
  const ASPECT_RATIO = 3 / 4;

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);
      const maxDisplayWidth = 500;
      const scale = img.width > maxDisplayWidth ? maxDisplayWidth / img.width : 1;
      setDisplayScale(scale);
      let cropWidth, cropHeight;
      if (img.width / img.height > ASPECT_RATIO) {
        cropHeight = img.height;
        cropWidth = cropHeight * ASPECT_RATIO;
      } else {
        cropWidth = img.width;
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
          <button className="modal-close" onClick={onCancel}>&times;</button>
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
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default MultiCharEditorModal;
