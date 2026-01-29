import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import { API_BASE } from '../../config';
import './PlayViewer.css';

function PlayViewer({ playId, onClose }) {
  const { plays, actors, settings, sendWsMessage } = useApp();
  const [enhanceCache, setEnhanceCache] = useState({}); // Cache enhanced text
  const [play, setPlay] = useState(null);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [displayedParagraphs, setDisplayedParagraphs] = useState([]);
  const [currentParaIndex, setCurrentParaIndex] = useState(0);
  const [variables, setVariables] = useState({});
  const [history, setHistory] = useState([]); // For back navigation
  const [isWaitingForChoice, setIsWaitingForChoice] = useState(false);
  const [currentChoices, setCurrentChoices] = useState([]);
  const [isWaitingForInlineChoice, setIsWaitingForInlineChoice] = useState(false);
  const [currentInlineChoice, setCurrentInlineChoice] = useState(null); // The inline_choice paragraph data
  const [usedInlineOptions, setUsedInlineOptions] = useState({}); // Track used options per paragraph: { paraId: Set of option indices }
  const [isEnded, setIsEnded] = useState(false);
  const [endingData, setEndingData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pumpStatus, setPumpStatus] = useState({ inflatee1: null, inflatee2: null }); // 'cycle', 'pulse', 'on', null
  const [inflateeCapacity, setInflateeCapacity] = useState({ inflatee1: 0, inflatee2: 0 });
  const [rightActorId, setRightActorId] = useState(null); // Actor shown on right filmstrip
  const [rightImageUrl, setRightImageUrl] = useState(null); // Custom image URL for right filmstrip (overrides actor)
  const [rightImageName, setRightImageName] = useState(null); // Name/label for custom image
  const [playStarted, setPlayStarted] = useState(false); // Track if play has started (for filmstrip animation)
  const pumpTimerRef = useRef(null);
  const contentRef = useRef(null);

  // Load play on mount
  useEffect(() => {
    const foundPlay = plays.find(p => p.id === playId);
    if (foundPlay) {
      setPlay(foundPlay);
      setCurrentPageId(foundPlay.startPageId);
      setCurrentParaIndex(0);
      setDisplayedParagraphs([]);
      setVariables({});
      setHistory([]);
      setIsWaitingForChoice(false);
      setIsEnded(false);
      // Initialize inflatee capacities from play settings
      setInflateeCapacity({
        inflatee1: foundPlay.inflatee1Capacity || 0,
        inflatee2: foundPlay.inflatee2Capacity || 0
      });
      setPumpStatus({ inflatee1: null, inflatee2: null });
      // Initialize right actor to first non-player actor or inflatee2
      const playActors = foundPlay.actors || [];
      const playerActor = actors.find(a => playActors.includes(a.id) && a.isPlayerAssignable);
      const firstNonPlayer = actors.find(a => playActors.includes(a.id) && a.id !== playerActor?.id);
      setRightActorId(foundPlay.inflatee2ActorId || firstNonPlayer?.id || null);
    }
  }, [playId, plays, actors]);

  // Cleanup pump timer on unmount
  useEffect(() => {
    return () => {
      if (pumpTimerRef.current) {
        clearTimeout(pumpTimerRef.current);
      }
    };
  }, []);

  // Get actor by ID
  const getActor = useCallback((actorId) => {
    return actors.find(a => a.id === actorId);
  }, [actors]);

  // Get Inflatee 1 actor (left filmstrip) - the player-assignable actor
  const inflatee1Actor = React.useMemo(() => {
    if (!play?.actors) return null;
    return actors.find(a => play.actors.includes(a.id) && a.isPlayerAssignable);
  }, [play, actors]);

  // Get right filmstrip actor
  const rightActor = React.useMemo(() => {
    if (!rightActorId) return null;
    return actors.find(a => a.id === rightActorId);
  }, [rightActorId, actors]);

  // Get player actor (the player-assignable one)
  const getPlayerActor = useCallback(() => {
    if (!play?.actors) return null;
    return actors.find(a => play.actors.includes(a.id) && a.isPlayerAssignable);
  }, [play, actors]);

  // Pain labels (same scale as event engine)
  const PAIN_LABELS = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];

  /**
   * Calculate pain/feeling level from capacity using a linear scale
   * @param {number} capacity - Capacity percentage (0-100)
   * @param {number} maxPain - Maximum pain at 100% capacity (default 10)
   * @returns {number} Pain level (0-10)
   */
  const calculatePainFromCapacity = useCallback((capacity, maxPain = 10) => {
    if (capacity <= 0) return 0;
    if (capacity >= 100) return maxPain;
    // Linear scale: capacity 0-100 maps to pain 0-maxPain
    return Math.round((capacity / 100) * maxPain);
  }, []);

  /**
   * Get pain label from pain level
   */
  const getPainLabel = useCallback((painLevel) => {
    const clamped = Math.max(0, Math.min(10, Math.round(painLevel)));
    return PAIN_LABELS[clamped] || `Level ${clamped}`;
  }, []);

  /**
   * Substitute variables in text
   * Supports: [Play:varname], [Player], [Capacity], [Capacity_mock], [Feeling_mock], and {varname} legacy syntax
   */
  const substituteVariables = useCallback((text) => {
    if (!text) return text;

    let result = text;

    // Player name (from player-assignable actor)
    const playerActor = getPlayerActor();
    result = result.replace(/\[Player\]/gi, playerActor?.name || 'Player');

    // Inflatee 1 (player) capacities
    result = result.replace(/\[Capacity\]/gi, String(inflateeCapacity.inflatee1));
    result = result.replace(/\[Capacity1\]/gi, String(inflateeCapacity.inflatee1));

    // Inflatee 2 (mock/NPC) capacity
    result = result.replace(/\[Capacity_mock\]/gi, String(inflateeCapacity.inflatee2));
    result = result.replace(/\[Capacity2\]/gi, String(inflateeCapacity.inflatee2));

    // Feeling based on capacity (player)
    const pain1 = calculatePainFromCapacity(inflateeCapacity.inflatee1, play?.maxPainAtFull || 10);
    result = result.replace(/\[Feeling\]/gi, getPainLabel(pain1));

    // Feeling for mock inflatee (uses same pain scale)
    const pain2 = calculatePainFromCapacity(inflateeCapacity.inflatee2, play?.maxPainAtFull || 10);
    result = result.replace(/\[Feeling_mock\]/gi, getPainLabel(pain2));

    // Play variables - [Play:varname] syntax
    result = result.replace(/\[Play:(\w+)\]/gi, (match, varName) => {
      return variables[varName] !== undefined ? String(variables[varName]) : match;
    });

    // Legacy {varname} pattern (backwards compatibility)
    result = result.replace(/\{(\w+)\}/g, (match, varName) => {
      return variables[varName] !== undefined ? String(variables[varName]) : match;
    });

    return result;
  }, [variables, inflateeCapacity, getPlayerActor, calculatePainFromCapacity, getPainLabel, play?.maxPainAtFull]);

  /**
   * Evaluate expression for set_variable
   * Supports: numbers, [Play:varname], basic math (+, -, *, /)
   */
  const evaluateExpression = useCallback((expr) => {
    if (typeof expr !== 'string') return expr;
    if (expr.trim() === '') return '';

    // First substitute any [Play:varname] references
    let substituted = expr.replace(/\[Play:(\w+)\]/gi, (match, varName) => {
      const val = variables[varName];
      return val !== undefined ? String(val) : '0';
    });

    // Also substitute {varname} legacy syntax
    substituted = substituted.replace(/\{(\w+)\}/g, (match, varName) => {
      const val = variables[varName];
      return val !== undefined ? String(val) : '0';
    });

    // Try to evaluate as a simple math expression
    // Only allow numbers, operators, spaces, and parentheses for safety
    if (/^[\d\s+\-*/().]+$/.test(substituted)) {
      try {
        // eslint-disable-next-line no-new-func
        const result = new Function(`return (${substituted})`)();
        if (typeof result === 'number' && !isNaN(result)) {
          return result;
        }
      } catch (e) {
        // If eval fails, return the substituted string
      }
    }

    // Check if it's just a number
    if (!isNaN(substituted) && substituted.trim() !== '') {
      return parseFloat(substituted);
    }

    return substituted;
  }, [variables]);

  // Build previous text context from displayed paragraphs
  const getPreviousText = useCallback(() => {
    // Get last few paragraphs for context (limit to ~500 chars to avoid huge prompts)
    const relevantParas = displayedParagraphs
      .filter(p => ['narration', 'dialogue', 'player_dialogue'].includes(p.type) && !p.isEnhancing)
      .slice(-5); // Last 5 paragraphs max

    if (relevantParas.length === 0) return '';

    return relevantParas.map(p => {
      if (p.type === 'narration') {
        return p.data.text;
      } else if (p.type === 'dialogue') {
        const actor = getActor(p.data.actorId);
        return `${actor?.name || 'Someone'}: "${p.data.text}"`;
      } else if (p.type === 'player_dialogue') {
        return `You: "${p.data.text}"`;
      }
      return '';
    }).join('\n').slice(-800); // Limit total context length
  }, [displayedParagraphs, getActor]);

  // Enhance text via LLM
  const enhanceText = useCallback(async (text, type, actorId = null, maxTokens = 120) => {
    // Include scenario hash in cache key so different plays don't share cache
    const scenarioHash = (play?.description || '').slice(0, 20);
    const cacheKey = `${scenarioHash}-${type}-${actorId || 'none'}-${maxTokens}-${text}`;

    // Check cache first
    if (enhanceCache[cacheKey]) {
      return enhanceCache[cacheKey];
    }

    try {
      const actor = actorId ? getActor(actorId) : null;
      const previousText = getPreviousText();

      const response = await fetch(`${API_BASE}/api/screenplay/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          type,
          actorName: actor?.name,
          actorPersonality: actor?.personality,
          authorMode: play?.authorMode || '2nd-person',
          maxTokens,
          definitions: settings?.screenplayDefinitions || '',
          scenario: play?.description || '',
          location: play?.location || '',
          actorRelationships: play?.actorRelationships || '',
          previousText
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.text) {
          // Cache the result
          setEnhanceCache(prev => ({ ...prev, [cacheKey]: result.text }));
          return result.text;
        }
      }
    } catch (error) {
      console.error('Enhancement failed:', error);
    }

    // Return original text on failure
    return text;
  }, [enhanceCache, getActor, getPreviousText, play?.authorMode, play?.description, settings?.screenplayDefinitions]);

  // Get current page
  const currentPage = play?.pages?.[currentPageId];

  // Process next paragraph
  const processNextParagraph = useCallback(() => {
    if (!currentPage || isWaitingForChoice || isEnded || isProcessing) return;

    const paragraphs = currentPage.paragraphs || [];

    if (currentParaIndex >= paragraphs.length) {
      // Page finished, no more paragraphs
      return;
    }

    setIsProcessing(true);
    const para = paragraphs[currentParaIndex];

    switch (para.type) {
      case 'narration':
      case 'dialogue':
      case 'player_dialogue':
        // Update right actor when dialogue is spoken (not for narration or player dialogue)
        if (para.type === 'dialogue' && para.data.actorId) {
          // Only update if the speaker is different from inflatee1 (player)
          if (para.data.actorId !== inflatee1Actor?.id) {
            setRightActorId(para.data.actorId);
          }
        }

        // Check if LLM enhancement is enabled
        if (para.data.llmEnhance) {
          // Show placeholder while enhancing
          const placeholderKey = `${currentPageId}-${para.id}`;
          setDisplayedParagraphs(prev => [...prev, {
            ...para,
            key: placeholderKey,
            isEnhancing: true
          }]);

          // Enhance the text with specified token limit
          const tokenLimit = para.data.maxTokens || 120;
          enhanceText(para.data.text, para.type, para.data.actorId, tokenLimit)
            .then(enhancedText => {
              // Update the paragraph with enhanced text
              setDisplayedParagraphs(prev => prev.map(p =>
                p.key === placeholderKey
                  ? { ...p, data: { ...p.data, text: enhancedText }, isEnhancing: false }
                  : p
              ));
              setCurrentParaIndex(prev => prev + 1);
              setIsProcessing(false);
            });
        } else {
          // Display the paragraph as-is
          setDisplayedParagraphs(prev => [...prev, { ...para, key: `${currentPageId}-${para.id}` }]);
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
        }
        break;

      case 'choice':
        // Show choices and wait
        setCurrentChoices(para.data.choices || []);
        setIsWaitingForChoice(true);
        if (para.data.prompt) {
          setDisplayedParagraphs(prev => [...prev, {
            type: 'choice_prompt',
            data: { text: para.data.prompt },
            key: `${currentPageId}-${para.id}-prompt`
          }]);
        }
        setIsProcessing(false);
        break;

      case 'inline_choice':
        // Show inline options (questions that don't change page)
        if (para.data.prompt) {
          setDisplayedParagraphs(prev => [...prev, {
            type: 'choice_prompt',
            data: { text: para.data.prompt },
            key: `${currentPageId}-${para.id}-prompt`
          }]);
        }
        setCurrentInlineChoice({ ...para, paraKey: `${currentPageId}-${para.id}` });
        setIsWaitingForInlineChoice(true);
        setIsProcessing(false);
        break;

      case 'goto_page':
        // Jump to another page
        if (para.data.targetPageId) {
          goToPage(para.data.targetPageId);
        }
        setIsProcessing(false);
        break;

      case 'condition':
        // Evaluate condition and branch
        // Support [Play:varname] in variable field (just use the name directly)
        const condVarName = para.data.variable?.replace(/^\[Play:(\w+)\]$/i, '$1') || para.data.variable;
        const varValue = variables[condVarName];
        // Support [Play:varname] in value field
        const checkValue = evaluateExpression(para.data.value);
        let result = false;

        switch (para.data.operator) {
          case 'equals':
            result = String(varValue) === String(checkValue);
            break;
          case 'not_equals':
            result = String(varValue) !== String(checkValue);
            break;
          case 'greater':
            result = Number(varValue) > Number(checkValue);
            break;
          case 'less':
            result = Number(varValue) < Number(checkValue);
            break;
          case 'contains':
            result = String(varValue).includes(String(checkValue));
            break;
          case 'exists':
            result = varValue !== undefined && varValue !== null && varValue !== '';
            break;
          case 'not_exists':
            result = varValue === undefined || varValue === null || varValue === '';
            break;
          default:
            result = false;
        }

        const targetPage = result ? para.data.truePageId : para.data.falsePageId;
        if (targetPage) {
          goToPage(targetPage);
        } else {
          // Continue to next paragraph
          setCurrentParaIndex(prev => prev + 1);
        }
        setIsProcessing(false);
        break;

      case 'set_variable':
        // Set a variable (supports expressions like "[Play:count] + 1")
        const evaluatedValue = evaluateExpression(para.data.value);
        setVariables(prev => ({
          ...prev,
          [para.data.variableName]: evaluatedValue
        }));
        setCurrentParaIndex(prev => prev + 1);
        setIsProcessing(false);
        break;

      case 'set_npc_actor_avatar':
        // Change the right filmstrip avatar
        if (para.data.sourceType === 'image' && para.data.imageTag) {
          // Use a media image
          setRightImageUrl(`${API_BASE}/api/media/images/tag/${para.data.imageTag}`);
          setRightImageName(para.data.imageTag);
          setRightActorId(null); // Clear actor when using image
        } else if (para.data.actorId) {
          // Use an actor avatar
          setRightActorId(para.data.actorId);
          setRightImageUrl(null); // Clear image when using actor
          setRightImageName(null);
        }
        setCurrentParaIndex(prev => prev + 1);
        setIsProcessing(false);
        break;

      case 'delay':
        // Wait then continue
        setTimeout(() => {
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
        }, para.data.duration || 1000);
        break;

      case 'pump':
        // Handle real pump control via WebSocket
        const pumpDevice = para.data.device || 'Primary Pump';
        const pumpAction = para.data.action || 'cycle';

        // Display pump action notification
        const pumpActionText = pumpAction === 'on' ? 'turns on' :
                              pumpAction === 'off' ? 'turns off' :
                              pumpAction === 'cycle' ? 'starts cycling' :
                              pumpAction === 'pulse' ? 'pulses' :
                              `runs for ${para.data.duration || 5}s`;
        setDisplayedParagraphs(prev => [...prev, {
          type: 'pump_action',
          data: {
            action: pumpAction,
            text: `*${pumpDevice} ${pumpActionText}*`
          },
          key: `${currentPageId}-${para.id}-pump`
        }]);

        // Send WebSocket command based on action
        if (pumpAction === 'cycle') {
          sendWsMessage('screenplay_pump', {
            type: 'start_cycle',
            device: pumpDevice,
            duration: para.data.duration || 5,
            interval: para.data.interval || 10,
            cycles: para.data.cycles || 0
          });
        } else if (pumpAction === 'pulse') {
          sendWsMessage('screenplay_pump', {
            type: 'pulse_pump',
            device: pumpDevice,
            pulses: para.data.pulses || 3
          });
        } else if (pumpAction === 'timed') {
          sendWsMessage('screenplay_pump', {
            type: 'device_on',
            device: pumpDevice,
            duration: para.data.duration || 5
          });
        } else if (pumpAction === 'on') {
          sendWsMessage('screenplay_pump', {
            type: 'device_on',
            device: pumpDevice
          });
        } else if (pumpAction === 'off') {
          sendWsMessage('screenplay_pump', {
            type: 'device_off',
            device: pumpDevice
          });
        }

        setCurrentParaIndex(prev => prev + 1);
        setIsProcessing(false);
        break;

      case 'mock_pump':
        // Handle mock pump events (simulate device control)
        const target = para.data.target || 'inflatee1';
        const action = para.data.action || 'cycle';
        const duration = para.data.duration || 5000;
        const intensity = para.data.intensity || 50;

        // Clear any existing timer for this target
        if (pumpTimerRef.current) {
          clearTimeout(pumpTimerRef.current);
        }

        // Display pump action notification
        const actionText = action === 'on' ? 'starts' :
                          action === 'off' ? 'stops' :
                          `begins ${action} mode`;
        const targetLabel = target === 'inflatee2' ? 'Inflatee 2' : 'Player';
        setDisplayedParagraphs(prev => [...prev, {
          type: 'pump_action',
          data: {
            target,
            action,
            text: `*The pump ${actionText} for ${targetLabel}*`,
            intensity
          },
          key: `${currentPageId}-${para.id}-pump`
        }]);

        if (action === 'off') {
          // Turn pump off
          setPumpStatus(prev => ({ ...prev, [target]: null }));
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
        } else if (action === 'on') {
          // Turn pump on indefinitely
          setPumpStatus(prev => ({ ...prev, [target]: 'on' }));
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
        } else {
          // Cycle, pulse, or timed - run for duration then continue
          setPumpStatus(prev => ({ ...prev, [target]: action }));

          // Simulate capacity increase over time
          const capacityIncrease = Math.min(intensity / 10, 10); // Max 10% per action
          setInflateeCapacity(prev => ({
            ...prev,
            [target]: Math.min(100, prev[target] + capacityIncrease)
          }));

          pumpTimerRef.current = setTimeout(() => {
            // For cycle/pulse, stop after duration; for timed, stop completely
            if (action === 'timed') {
              setPumpStatus(prev => ({ ...prev, [target]: null }));
            }
            setCurrentParaIndex(prev => prev + 1);
            setIsProcessing(false);
          }, duration);
        }
        break;

      case 'end':
        // End the play
        setIsEnded(true);
        setEndingData(para.data);
        setIsProcessing(false);
        break;

      default:
        // Unknown type, skip
        setCurrentParaIndex(prev => prev + 1);
        setIsProcessing(false);
    }
  }, [currentPage, currentPageId, currentParaIndex, isWaitingForChoice, isEnded, isProcessing, variables]);

  // Go to a specific page
  const goToPage = useCallback((pageId) => {
    if (!play?.pages?.[pageId]) return;

    // Save current state to history
    setHistory(prev => [...prev, {
      pageId: currentPageId,
      paraIndex: currentParaIndex,
      displayed: displayedParagraphs
    }]);

    // Reset for new page
    setCurrentPageId(pageId);
    setCurrentParaIndex(0);
    setDisplayedParagraphs([]);
    setIsWaitingForChoice(false);
    setCurrentChoices([]);
  }, [play, currentPageId, currentParaIndex, displayedParagraphs]);

  // Check if a choice/option passes its condition
  const checkCondition = useCallback((item) => {
    if (!item.condVar) return true; // No condition = always show

    const varValue = variables[item.condVar];

    switch (item.condOp) {
      case 'equals':
        return String(varValue) === String(item.condVal);
      case 'not_equals':
        return String(varValue) !== String(item.condVal);
      case 'exists':
        return varValue !== undefined && varValue !== null && varValue !== '';
      case 'not_exists':
        return varValue === undefined || varValue === null || varValue === '';
      default:
        return true;
    }
  }, [variables]);

  // Filter choices based on conditions
  const getVisibleChoices = useCallback(() => {
    return currentChoices.filter(choice => checkCondition(choice));
  }, [currentChoices, checkCondition]);

  // Handle choice selection
  const handleChoiceSelect = useCallback((choice) => {
    // Set variable if specified
    if (choice.setVar) {
      setVariables(prev => ({
        ...prev,
        [choice.setVar]: choice.setVal || 'true'
      }));
    }

    // Display the selected choice
    setDisplayedParagraphs(prev => [...prev, {
      type: 'choice_selected',
      data: { text: choice.text },
      key: `choice-${Date.now()}`
    }]);

    setIsWaitingForChoice(false);
    setCurrentChoices([]);

    if (choice.targetPageId) {
      goToPage(choice.targetPageId);
    } else {
      // Continue on current page
      setCurrentParaIndex(prev => prev + 1);
    }
  }, [goToPage]);

  // Handle inline option selection (doesn't change page, shows response, removes option)
  const handleInlineOptionSelect = useCallback((option, optionIndex) => {
    if (!currentInlineChoice) return;

    const paraKey = currentInlineChoice.paraKey;

    // Set variable if specified
    if (option.setVar) {
      setVariables(prev => ({
        ...prev,
        [option.setVar]: option.setVal || 'true'
      }));
    }

    // Mark this option as used
    setUsedInlineOptions(prev => ({
      ...prev,
      [paraKey]: new Set([...(prev[paraKey] || []), optionIndex])
    }));

    // Display what player asked/said
    setDisplayedParagraphs(prev => [...prev, {
      type: 'choice_selected',
      data: { text: option.text },
      key: `inline-ask-${Date.now()}`
    }]);

    // Display the response (as dialogue or narration)
    if (option.response) {
      const responseActor = option.responseActorId ? actors.find(a => a.id === option.responseActorId) : null;
      setDisplayedParagraphs(prev => [...prev, {
        type: responseActor ? 'dialogue' : 'narration',
        data: {
          text: option.response,
          actorId: option.responseActorId
        },
        key: `inline-response-${Date.now()}`
      }]);
    }
  }, [currentInlineChoice, actors]);

  // Handle inline choice continue (go to next page)
  const handleInlineContinue = useCallback(() => {
    if (!currentInlineChoice) return;

    const targetPageId = currentInlineChoice.data.continueTargetPageId;
    setIsWaitingForInlineChoice(false);
    setCurrentInlineChoice(null);

    if (targetPageId) {
      goToPage(targetPageId);
    } else {
      // Continue on current page
      setCurrentParaIndex(prev => prev + 1);
    }
  }, [currentInlineChoice, goToPage]);

  // Get available inline options (not yet used and passes condition)
  const getAvailableInlineOptions = useCallback(() => {
    if (!currentInlineChoice) return [];
    const paraKey = currentInlineChoice.paraKey;
    const used = usedInlineOptions[paraKey] || new Set();
    return (currentInlineChoice.data.options || [])
      .map((opt, idx) => ({ ...opt, originalIndex: idx }))
      .filter((opt, idx) => !used.has(idx) && checkCondition(opt));
  }, [currentInlineChoice, usedInlineOptions, checkCondition]);

  // Check if continue is allowed
  const canInlineContinue = useCallback(() => {
    if (!currentInlineChoice) return false;
    if (!currentInlineChoice.data.requireAllOptions) return true;

    const paraKey = currentInlineChoice.paraKey;
    const used = usedInlineOptions[paraKey] || new Set();
    const totalOptions = (currentInlineChoice.data.options || []).length;
    return used.size >= totalOptions;
  }, [currentInlineChoice, usedInlineOptions]);

  // Handle continue click (advance to next paragraph)
  const handleContinue = useCallback(() => {
    processNextParagraph();
  }, [processNextParagraph]);

  // Go back in history
  const handleBack = useCallback(() => {
    if (history.length === 0) return;

    const prevState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setCurrentPageId(prevState.pageId);
    setCurrentParaIndex(prevState.paraIndex);
    setDisplayedParagraphs(prevState.displayed);
    setIsWaitingForChoice(false);
    setCurrentChoices([]);
    setIsWaitingForInlineChoice(false);
    setCurrentInlineChoice(null);
    setIsEnded(false);
    setEndingData(null);
  }, [history]);

  // Restart play
  const handleRestart = useCallback(() => {
    if (!play) return;
    // Clear pump timer
    if (pumpTimerRef.current) {
      clearTimeout(pumpTimerRef.current);
    }
    setCurrentPageId(play.startPageId);
    setCurrentParaIndex(0);
    setDisplayedParagraphs([]);
    setVariables({});
    setHistory([]);
    setIsWaitingForChoice(false);
    setCurrentChoices([]);
    setIsWaitingForInlineChoice(false);
    setCurrentInlineChoice(null);
    setUsedInlineOptions({});
    setIsEnded(false);
    setEndingData(null);
    // Reset pump/inflatee state
    setPumpStatus({ inflatee1: null, inflatee2: null });
    setInflateeCapacity({
      inflatee1: play.inflatee1Capacity || 0,
      inflatee2: play.inflatee2Capacity || 0
    });
    // Reset filmstrip state
    setRightImageUrl(null);
    setRightImageName(null);
    // Reset right actor to initial
    const playActors = play.actors || [];
    const playerActor = actors.find(a => playActors.includes(a.id) && a.isPlayerAssignable);
    const firstNonPlayer = actors.find(a => playActors.includes(a.id) && a.id !== playerActor?.id);
    setRightActorId(play.inflatee2ActorId || firstNonPlayer?.id || null);
  }, [play, actors]);

  // Auto-scroll to bottom when new content appears
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedParagraphs]);

  // Auto-process first paragraph when page loads
  useEffect(() => {
    if (currentPage && currentParaIndex === 0 && displayedParagraphs.length === 0 && !isProcessing) {
      // Mark play as started when first paragraph processes
      setPlayStarted(true);
      processNextParagraph();
    }
  }, [currentPage, currentParaIndex, displayedParagraphs.length, isProcessing, processNextParagraph]);

  // Render a single paragraph
  const renderParagraph = (para) => {
    const enhancingClass = para.isEnhancing ? ' enhancing' : '';

    switch (para.type) {
      case 'narration':
        return (
          <div key={para.key} className={`para-display narration${enhancingClass}`}>
            {para.isEnhancing ? (
              <p className="enhancing-text"><span className="typing-dots">...</span></p>
            ) : (
              <p>{substituteVariables(para.data.text)}</p>
            )}
          </div>
        );

      case 'dialogue': {
        const actor = getActor(para.data.actorId);
        return (
          <div key={para.key} className={`para-display dialogue${enhancingClass}`}>
            <div className="dialogue-header">
              {actor?.avatar && (
                <img src={actor.avatar} alt="" className="dialogue-avatar" />
              )}
              <span className="dialogue-name">{actor?.name || 'Unknown'}</span>
            </div>
            {para.isEnhancing ? (
              <p className="dialogue-text enhancing-text"><span className="typing-dots">...</span></p>
            ) : (
              <p className="dialogue-text">"{substituteVariables(para.data.text)}"</p>
            )}
          </div>
        );
      }

      case 'player_dialogue':
        return (
          <div key={para.key} className={`para-display player-dialogue${enhancingClass}`}>
            <div className="dialogue-header">
              <span className="dialogue-name">You</span>
            </div>
            {para.isEnhancing ? (
              <p className="dialogue-text enhancing-text"><span className="typing-dots">...</span></p>
            ) : (
              <p className="dialogue-text">"{substituteVariables(para.data.text)}"</p>
            )}
          </div>
        );

      case 'choice_prompt':
        return (
          <div key={para.key} className="para-display choice-prompt">
            <p>{substituteVariables(para.data.text)}</p>
          </div>
        );

      case 'choice_selected':
        return (
          <div key={para.key} className="para-display choice-selected">
            <p>➤ {substituteVariables(para.data.text)}</p>
          </div>
        );

      case 'pump_action':
        return (
          <div key={para.key} className={`para-display pump-action ${para.data.action}`}>
            <p>{para.data.text}</p>
          </div>
        );

      default:
        return null;
    }
  };

  if (!play) {
    return (
      <div className="play-viewer-overlay">
        <div className="play-viewer">
          <div className="play-viewer-header">
            <h2>Loading...</h2>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>
      </div>
    );
  }

  // Render round capacity gauge (matches StatusBadges style)
  const renderCapacityGauge = (capacity) => {
    // Needle rotation: -135deg at 0%, +135deg at 100% (270deg range)
    const needleRotation = -135 + (Math.min(100, Math.max(0, capacity)) * 2.7);
    return (
      <div className="capacity-gauge-round">
        <div className="capacity-gauge-inner">
          <div className="gauge-arc" />
          <div
            className="gauge-needle"
            style={{ transform: `rotate(${needleRotation}deg)` }}
          />
          <div className="gauge-center" />
          <div className="gauge-percent">{Math.round(capacity)}%</div>
        </div>
      </div>
    );
  };

  return (
    <div className={`play-viewer-overlay ${playStarted ? 'started' : ''}`}>
      {/* Main Play Viewer - Full Screen */}
      <div className="play-viewer">
        <div className="play-viewer-header">
          <h2>{play.name}</h2>
          <div className="header-actions">
            {history.length > 0 && (
              <button className="back-btn" onClick={handleBack} title="Go back">
                ← Back
              </button>
            )}
            <button className="close-btn" onClick={onClose} title="Exit play">
              &times;
            </button>
          </div>
        </div>

        <div className="play-viewer-body">
          <div className="play-viewer-content" ref={contentRef}>
            {currentPage && (
              <div className="page-title-display">
                {currentPage.title}
              </div>
            )}

            <div className="paragraphs-display">
              {displayedParagraphs.map(para => renderParagraph(para))}
            </div>

            {isEnded && endingData && (
              <div className={`ending-display ${endingData.endingType}`}>
                <h3>{endingData.endingType === 'good' ? '🎉' : endingData.endingType === 'bad' ? '💀' : '🏁'} {endingData.message || 'The End'}</h3>
                <button className="restart-btn" onClick={handleRestart}>
                  Play Again
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="play-viewer-footer">
          {isWaitingForChoice ? (
            <div className="choices-display">
              {getVisibleChoices().map((choice, idx) => (
                <button
                  key={idx}
                  className="choice-btn"
                  onClick={() => handleChoiceSelect(choice)}
                >
                  {choice.text}
                </button>
              ))}
            </div>
          ) : isWaitingForInlineChoice ? (
            <div className="choices-display">
              {getAvailableInlineOptions().map((option) => (
                <button
                  key={option.originalIndex}
                  className="choice-btn inline-option"
                  onClick={() => handleInlineOptionSelect(option, option.originalIndex)}
                >
                  {option.text}
                </button>
              ))}
              <button
                className={`choice-btn continue-option ${!canInlineContinue() ? 'disabled' : ''}`}
                onClick={handleInlineContinue}
                disabled={!canInlineContinue()}
                title={!canInlineContinue() ? 'Select all options first' : ''}
              >
                {currentInlineChoice?.data?.continueText || 'Continue'}
              </button>
            </div>
          ) : !isEnded && currentPage && currentParaIndex < (currentPage.paragraphs?.length || 0) ? (
            <button className="continue-btn" onClick={handleContinue} disabled={isProcessing}>
              {isProcessing ? '...' : 'Continue'}
            </button>
          ) : !isEnded && currentPage && currentParaIndex >= (currentPage.paragraphs?.length || 0) ? (
            <div className="page-end-message">
              End of page - add more paragraphs or an ending
            </div>
          ) : null}
        </div>
      </div>

      {/* Filmstrip avatars - portaled to body to avoid transform containment */}
      {createPortal(
        <>
          <div className="filmstrip-column filmstrip-left">
            <div className={`avatar-frame ${playStarted ? 'visible' : ''}`}>
              <div className="frame-name">{inflatee1Actor?.name || 'Player'}</div>
              <div className="portrait-wrapper">
                {inflatee1Actor?.avatar ? (
                  <img src={inflatee1Actor.avatar} alt={inflatee1Actor.name} className="frame-avatar" />
                ) : (
                  <div className="frame-avatar-placeholder">
                    {inflatee1Actor?.name?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              {renderCapacityGauge(inflateeCapacity.inflatee1)}
            </div>
          </div>

          <div className="filmstrip-column filmstrip-right">
            <div className={`avatar-frame ${playStarted ? 'visible' : ''}`}>
              <div className="frame-name">{rightImageName || rightActor?.name || '—'}</div>
              <div className="portrait-wrapper">
                {rightImageUrl ? (
                  <img src={rightImageUrl} alt={rightImageName || 'NPC'} className="frame-avatar" />
                ) : rightActor?.avatar ? (
                  <img src={rightActor.avatar} alt={rightActor.name} className="frame-avatar" />
                ) : rightActor ? (
                  <div className="frame-avatar-placeholder">
                    {rightActor.name?.charAt(0) || '?'}
                  </div>
                ) : (
                  <div className="frame-avatar-placeholder empty">?</div>
                )}
              </div>
              {play?.inflatee2Enabled && renderCapacityGauge(inflateeCapacity.inflatee2)}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export default PlayViewer;
