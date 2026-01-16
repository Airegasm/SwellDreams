import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useDraft, getDraftKey } from '../../hooks/useDraft';
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
    assignedFlows: story.assignedFlows || character?.assignedFlows || [],
    assignedButtons: story.assignedButtons || [],
    constantReminderIds: story.constantReminderIds || [],
    globalReminderIds: story.globalReminderIds || [],
    startingEmotion: story.startingEmotion || character?.startingEmotion || 'neutral'
  };
}

function CharacterEditorModal({ isOpen, onClose, onSave, character }) {
  const { flows, devices, settings } = useApp();

  // System-level global reminders from settings
  const systemGlobalReminders = settings?.globalReminders || [];

  // Calculate initial data from character prop
  const initialData = useMemo(() => {
    if (character) {
      // Handle v2 story format with welcomeMessages[] and scenarios[] arrays
      let stories = character.stories || [];

      if (stories.length === 0) {
        // Migrate from legacy format (no stories)
        const welcomeMessages = character.welcomeMessages || (character.firstMessage ? [
          { id: 'wm-1', text: character.firstMessage, llmEnhanced: false }
        ] : [{ id: 'wm-1', text: '', llmEnhanced: false }]);
        const scenarios = character.scenarios || (character.scenario ? [
          { id: 'sc-1', text: character.scenario }
        ] : [{ id: 'sc-1', text: '' }]);

        stories = [{
          id: 'story-1',
          name: 'Story 1',
          welcomeMessages,
          activeWelcomeMessageId: character.activeWelcomeMessageId || welcomeMessages[0]?.id,
          scenarios,
          activeScenarioId: character.activeScenarioId || scenarios[0]?.id,
          exampleDialogues: character.exampleDialogues || [],
          autoReplyEnabled: character.autoReplyEnabled || false,
          assignedFlows: character.assignedFlows || [],
          assignedButtons: [],
          constantReminderIds: [],
          globalReminderIds: [],
          startingEmotion: character.startingEmotion || 'neutral'
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
            assignedFlows: s.assignedFlows || character.assignedFlows || [],
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
        stories,
        activeStoryId: character.activeStoryId || stories[0]?.id || 'story-1',
        buttons: character.buttons || character.events || [],
        globalReminders: character.globalReminders || character.constantReminders || []
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
      assignedFlows: [],
      assignedButtons: [],
      constantReminderIds: [],
      globalReminderIds: [],
      startingEmotion: 'neutral'
    };

    return {
      name: '',
      avatar: '',
      description: '',
      personality: '',
      stories: [defaultStory],
      activeStoryId: 'story-1',
      buttons: [],
      globalReminders: []
    };
  }, [character]);

  // Use draft persistence - only enable when character is actually loaded
  const draftKey = getDraftKey('character', character?.id);
  const isReady = isOpen && character?.id;
  const { formData, setFormData, clearDraft, hasDraft } = useDraft(draftKey, initialData, isReady);

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
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState(null);
  const [reminderForm, setReminderForm] = useState({ name: '', text: '', target: 'character' });
  // Dropdown selections for story associations
  const [selectedFlowToAdd, setSelectedFlowToAdd] = useState('');
  const [selectedButtonToAdd, setSelectedButtonToAdd] = useState('');
  const [selectedConstantReminder, setSelectedConstantReminder] = useState('');
  const [selectedGlobalReminder, setSelectedGlobalReminder] = useState('');
  const [draggedButtonId, setDraggedButtonId] = useState(null);
  const fileInputRef = React.useRef(null);

  // Sync selected story ID when formData changes
  useEffect(() => {
    if (isOpen && formData.stories?.length > 0) {
      setSelectedStoryId(formData.activeStoryId || formData.stories[0]?.id || null);
    }
  }, [isOpen, formData.activeStoryId, formData.stories]);

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
      assignedFlows: [],
      assignedButtons: [],
      constantReminderIds: [],
      globalReminderIds: [],
      startingEmotion: 'neutral'
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
  // Also auto-adds buttons created by the flow (sourceFlowId)
  const handleAddStoryFlow = () => {
    if (!selectedFlowToAdd) return;

    const storyId = activeStory?.id;
    if (!storyId) return;

    // Find buttons created by this flow
    const flowButtons = buttons.filter(b => b.sourceFlowId === selectedFlowToAdd);
    const flowButtonIds = flowButtons.map(b => b.buttonId);
    const flowToAdd = selectedFlowToAdd;

    // Update story with new flow and auto-populated buttons
    setFormData(prev => {
      const updatedStories = (prev.stories || []).map(s => {
        if (s.id !== storyId) return s;

        const currentFlows = s.assignedFlows || [];
        if (currentFlows.includes(flowToAdd)) return s;

        const currentButtons = s.assignedButtons || [];
        const newButtons = [...currentButtons, ...flowButtonIds.filter(id => !currentButtons.includes(id))];

        return {
          ...s,
          assignedFlows: [...currentFlows, flowToAdd],
          assignedButtons: newButtons
        };
      });

      return { ...prev, stories: updatedStories };
    });
    setSelectedFlowToAdd('');
  };

  const handleRemoveStoryFlow = (flowId) => {
    const storyId = activeStory?.id;
    if (!storyId) return;

    // Find buttons created by this flow
    const flowButtons = buttons.filter(b => b.sourceFlowId === flowId);
    const flowButtonIds = flowButtons.map(b => b.buttonId);

    setFormData(prev => {
      const updatedStories = (prev.stories || []).map(s => {
        if (s.id !== storyId) return s;

        const currentFlows = s.assignedFlows || [];
        const currentButtons = s.assignedButtons || [];
        const newButtons = currentButtons.filter(id => !flowButtonIds.includes(id));

        return {
          ...s,
          assignedFlows: currentFlows.filter(id => id !== flowId),
          assignedButtons: newButtons
        };
      });

      return { ...prev, stories: updatedStories };
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
    const saveData = {
      ...formData,
      activeStoryId: activeStory?.id || formData.stories?.[0]?.id,
      // Backwards compatibility
      autoReplyEnabled: activeStory?.autoReplyEnabled || false,
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
    const updatedButtons = buttons.map(b =>
      b.buttonId === buttonId ? { ...b, enabled } : b
    );
    setFormData({ ...formData, buttons: updatedButtons });
  };

  const handleEditButton = (button) => {
    setEditingButtonId(button.buttonId);
    setButtonForm({ ...button });
    setShowButtonForm(true);
  };

  const handleDeleteButton = (buttonId) => {
    if (window.confirm('Delete this button?')) {
      const updatedButtons = buttons.filter(b => b.buttonId !== buttonId);
      setFormData({ ...formData, buttons: updatedButtons });
    }
  };

  const handleSaveButton = () => {
    if (!buttonForm.name.trim()) {
      alert('Button name is required');
      return;
    }

    if (editingButtonId !== null) {
      const updatedButtons = buttons.map(b =>
        b.buttonId === editingButtonId ? buttonForm : b
      );
      setFormData({ ...formData, buttons: updatedButtons });
    } else {
      setFormData({ ...formData, buttons: [...buttons, buttonForm] });
    }

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
    setReminderForm({ name: '', text: '', target: 'character' });
    setShowReminderForm(true);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminderId(reminder.id);
    setReminderForm({ name: reminder.name, text: reminder.text, target: reminder.target || 'character' });
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

    if (editingReminderId) {
      const updated = globalReminders.map(r =>
        r.id === editingReminderId ? { ...r, name: reminderForm.name, text: reminderForm.text, target: reminderForm.target } : r
      );
      setFormData({ ...formData, globalReminders: updated });
    } else {
      const newReminder = {
        id: `reminder-${Date.now()}`,
        name: reminderForm.name,
        text: reminderForm.text,
        target: reminderForm.target,
        enabled: true
      };
      setFormData({ ...formData, globalReminders: [...globalReminders, newReminder] });
    }

    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '', target: 'character' });
  };

  const handleCancelReminderEdit = () => {
    setShowReminderForm(false);
    setEditingReminderId(null);
    setReminderForm({ name: '', text: '', target: 'character' });
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal character-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header character-modal-header">
          <h3>{character ? 'Edit Character' : 'New Character'}</h3>
          {hasDraft && (
            <span className="draft-indicator" title="Unsaved changes restored">Draft restored</span>
          )}
          <button className="modal-close" onClick={handleCancel}>&times;</button>
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
                    rows={3}
                  />
                </div>

                <div className="form-group">
                  <label>Personality</label>
                  <textarea
                    value={formData.personality}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    placeholder="Detailed personality traits..."
                    rows={4}
                  />
                </div>
              </div>

              <div className="editor-right">
                <label>Character Avatar</label>
                <div className="avatar-upload-area" onClick={handleImageClick}>
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
                <label>Story</label>
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

                {/* Welcome Message */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>Welcome Message</label>
                    <div className="version-controls">
                      <select
                        value={activeStory?.activeWelcomeMessageId || ''}
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
                        className="btn-icon btn-delete"
                        onClick={() => handleDeleteWelcomeMessage(activeStory?.activeWelcomeMessageId)}
                        disabled={(activeStory?.welcomeMessages || []).length <= 1}
                        title="Delete version"
                      >🗑️</button>
                      <button
                        type="button"
                        className={`btn-icon btn-llm ${getActiveWelcomeMessage()?.llmEnhanced ? 'active' : ''}`}
                        onClick={handleToggleWelcomeMessageLlm}
                        title="Toggle LLM Enhancement"
                      >🤖</button>
                    </div>
                  </div>
                  <textarea
                    value={getActiveWelcomeMessage()?.text || ''}
                    onChange={(e) => handleUpdateWelcomeMessageText(e.target.value)}
                    placeholder="The first message the character sends..."
                    rows={3}
                  />
                </div>

                {/* Scenario */}
                <div className="story-field">
                  <div className="story-field-header">
                    <label>Scenario</label>
                    <div className="version-controls">
                      <select
                        value={activeStory?.activeScenarioId || ''}
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
                        onClick={() => handleDeleteScenario(activeStory?.activeScenarioId)}
                        disabled={(activeStory?.scenarios || []).length <= 1}
                        title="Delete version"
                      >🗑️</button>
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

                {/* Persona Details */}
                <div className="story-subsection">
                  <label className="subsection-label">Persona Details</label>
                  <div className="story-field">
                    <label>Starting Persona Emotion</label>
                    <select
                      value={activeStory?.startingEmotion || 'neutral'}
                      onChange={(e) => updateStoryField('startingEmotion', e.target.value)}
                    >
                      <option value="neutral">Neutral</option>
                      <option value="relaxed">Relaxed</option>
                      <option value="curious">Curious</option>
                      <option value="nervous">Nervous</option>
                      <option value="excited">Excited</option>
                      <option value="aroused">Aroused</option>
                      <option value="embarrassed">Embarrassed</option>
                      <option value="anxious">Anxious</option>
                      <option value="submissive">Submissive</option>
                      <option value="defiant">Defiant</option>
                      <option value="overwhelmed">Overwhelmed</option>
                      <option value="blissful">Blissful</option>
                    </select>
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
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleAddReminder}>+ Add Reminder</button>
                  </div>
                  <p className="section-hint">Character-specific reminders. Create them here, then assign them to stories using "Constant Reminders" in the Story section.</p>

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

          <div className="modal-footer character-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">{character ? 'Update' : 'Create'} Character</button>
          </div>
        </form>
      </div>

      {showCropModal && (
        <ImageCropModal image={uploadedImage} onSave={handleCropSave} onCancel={handleCropCancel} />
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
  const OUTPUT_HEIGHT = 683;
  const ASPECT_RATIO = 3 / 4;

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

export default CharacterEditorModal;
