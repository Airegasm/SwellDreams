import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import { API_BASE } from '../../config';
import './PlayViewer.css';
import ChallengeCoin from './challenges/ChallengeCoin';
import ChallengeDice from './challenges/ChallengeDice';
import ChallengeWheel from './challenges/ChallengeWheel';
import ChallengeRPS from './challenges/ChallengeRPS';
import ChallengeNumberGuess from './challenges/ChallengeNumberGuess';
import ChallengeSlots from './challenges/ChallengeSlots';
import ChallengeCard from './challenges/ChallengeCard';
import ChallengeSimon from './challenges/ChallengeSimon';
import ChallengeReflex from './challenges/ChallengeReflex';

function PlayViewer({ playId, onClose }) {
  const { plays, actors, settings, devices, sendWsMessage, sessionState } = useApp();
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
  const [isWaitingForPopup, setIsWaitingForPopup] = useState(false);
  const [currentPopupData, setCurrentPopupData] = useState(null);
  const [isWaitingForChallenge, setIsWaitingForChallenge] = useState(false);
  const [currentChallengeType, setCurrentChallengeType] = useState(null);
  const [currentChallengeData, setCurrentChallengeData] = useState(null);
  const [isEnded, setIsEnded] = useState(false);
  const [endingData, setEndingData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pumpStatus, setPumpStatus] = useState({ inflatee1: null, inflatee2: null }); // 'cycle', 'pulse', 'on', null
  const [inflateeCapacity, setInflateeCapacity] = useState({ inflatee1: 0, inflatee2: 0 });
  const [rightActorId, setRightActorId] = useState(null); // Actor shown on right filmstrip (upper)
  const [rightImageUrl, setRightImageUrl] = useState(null); // Custom image URL for right filmstrip (overrides actor)
  const [rightImageName, setRightImageName] = useState(null); // Name/label for custom image
  const [thirdActorId, setThirdActorId] = useState(null); // Third actor shown on right filmstrip (lower)
  const [playStarted, setPlayStarted] = useState(false); // Track if play has started (for filmstrip animation)
  const [isClosing, setIsClosing] = useState(false); // Track if we're closing (for slide-out animation)
  const [autoAdvancePending, setAutoAdvancePending] = useState(false); // Track if we should auto-advance to next paragraph
  const [displayedToasts, setDisplayedToasts] = useState([]); // Toast notifications
  const [showPumpDialog, setShowPumpDialog] = useState(null); // 'cycle', 'pulse', 'timed', 'until', or null
  const [pumpDialogValues, setPumpDialogValues] = useState({ duration: 5, interval: 10, cycles: 0, pulses: 3, targetCapacity: 100 });
  const pumpTimerRef = useRef(null);
  const mockPumpIntervalRef = useRef(null); // Interval for continuous inflatee2 capacity tracking
  const mockPumpStartTimeRef = useRef(null); // Track when mock pump started for inflatee2
  const mockPumpTrackingActiveRef = useRef(false); // Guard against concurrent tracking starts
  const contentRef = useRef(null);
  const hasAutoStartedRef = useRef(false); // Track if current page has been auto-started

  // Mobile-specific state
  const [expandedAvatarIndex, setExpandedAvatarIndex] = useState(null); // null, -1 (player), 0 (main NPC), or 1 (third actor)
  const [expandedGaugeIndex, setExpandedGaugeIndex] = useState(null); // null, 0 (player), or 1 (inflatee2)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

  // Load play on mount
  useEffect(() => {
    const foundPlay = plays.find(p => p.id === playId);
    if (foundPlay) {
      // Stop all pumps when loading a new play
      if (mockPumpIntervalRef.current) {
        clearInterval(mockPumpIntervalRef.current);
        mockPumpIntervalRef.current = null;
      }
      mockPumpTrackingActiveRef.current = false; // Clear guard
      if (pumpTimerRef.current) {
        clearTimeout(pumpTimerRef.current);
      }
      // Send emergency stop to real pumps
      sendWsMessage('screenplay_pump', {
        type: 'emergency_stop_all'
      });

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
      const nonPlayerActors = actors.filter(a => playActors.includes(a.id) && a.id !== playerActor?.id);
      const firstNonPlayer = nonPlayerActors[0];
      const secondNonPlayer = nonPlayerActors[1];

      setRightActorId(foundPlay.inflatee2ActorId || firstNonPlayer?.id || null);

      // Set third actor if there are 3+ actors total
      if (playActors.length >= 3 && secondNonPlayer) {
        setThirdActorId(secondNonPlayer.id);
      } else {
        setThirdActorId(null);
      }

      console.log('[Screenplay] New play loaded - all pumps stopped, capacities reset');
    }
  }, [playId, plays, actors, sendWsMessage]);

  // Cleanup pump timer and mock pump interval on unmount
  useEffect(() => {
    return () => {
      // Trigger closing animation
      setIsClosing(true);

      if (pumpTimerRef.current) {
        clearTimeout(pumpTimerRef.current);
      }
      if (mockPumpIntervalRef.current) {
        clearInterval(mockPumpIntervalRef.current);
      }
      mockPumpTrackingActiveRef.current = false; // Clear guard
      // Emergency stop all pumps when component unmounts
      sendWsMessage('screenplay_pump', {
        type: 'emergency_stop_all'
      });
    };
  }, [sendWsMessage]);

  // Sync inflatee1 capacity with global sessionState.capacity (from flow/real pump)
  useEffect(() => {
    if (sessionState?.capacity !== undefined) {
      setInflateeCapacity(prev => ({
        ...prev,
        inflatee1: sessionState.capacity
      }));
    }
  }, [sessionState?.capacity]);

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

  // Get third filmstrip actor (bottom right)
  const thirdActor = React.useMemo(() => {
    if (!thirdActorId) return null;
    return actors.find(a => a.id === thirdActorId);
  }, [thirdActorId, actors]);

  // Get player actor (the player-assignable one)
  const getPlayerActor = useCallback(() => {
    if (!play?.actors) return null;
    return actors.find(a => play.actors.includes(a.id) && a.isPlayerAssignable);
  }, [play, actors]);

  // Get calibration time from primary pump device
  const getPrimaryPumpCalibrationTime = useCallback(() => {
    if (!devices || devices.length === 0) return 150; // Default to 150 seconds
    const primaryPump = devices.find(d => d.isPrimaryPump || d.deviceType === 'PUMP');
    return primaryPump?.calibrationTime || 150;
  }, [devices]);

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

  // Start continuous capacity tracking for inflatee2 (mock pump)
  const startMockPumpTracking = useCallback(() => {
    // Guard: Don't create new interval if tracking already active
    if (mockPumpTrackingActiveRef.current) {
      console.log('[PlayViewer] Mock tracking already active - ignoring duplicate start');
      return;
    }

    // Clear any existing interval (defensive)
    if (mockPumpIntervalRef.current) {
      clearInterval(mockPumpIntervalRef.current);
      mockPumpIntervalRef.current = null;
    }

    // Mark as active BEFORE creating interval
    mockPumpTrackingActiveRef.current = true;

    // Get calibration time (in seconds to reach 100%)
    const calibrationTime = getPrimaryPumpCalibrationTime();

    // Get capacity modifier from settings (same as backend calculation)
    const capacityModifier = settings?.globalCharacterControls?.autoCapacityMultiplier || sessionState?.capacityModifier || 1.0;

    // Record start time and get initial capacity synchronously
    const startTime = Date.now();
    mockPumpStartTimeRef.current = startTime;

    // Get initial capacity immediately (synchronously)
    const initialCapacity = inflateeCapacity.inflatee2;

    // Create interval OUTSIDE of setState to ensure it's created immediately
    // Update every 1 second to match real pump update rate
    mockPumpIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000; // seconds elapsed
      // Match backend formula: (elapsed / calibrationTime) * 100 * capacityModifier
      const capacityGain = (elapsed / calibrationTime) * 100 * capacityModifier;
      const newCapacity = Math.min(100, initialCapacity + capacityGain);

      setInflateeCapacity(prev => ({
        ...prev,
        inflatee2: newCapacity
      }));
    }, 1000);

    console.log('[PlayViewer] Mock tracking started:', {
      intervalId: mockPumpIntervalRef.current,
      initialCapacity,
      calibrationTime,
      capacityModifier
    });
  }, [getPrimaryPumpCalibrationTime, settings, sessionState]);

  // Stop continuous capacity tracking for inflatee2
  const stopMockPumpTracking = useCallback(() => {
    if (mockPumpIntervalRef.current) {
      clearInterval(mockPumpIntervalRef.current);
      mockPumpIntervalRef.current = null;
      console.log('[PlayViewer] Mock tracking stopped');
    }
    mockPumpStartTimeRef.current = null;
    mockPumpTrackingActiveRef.current = false; // Clear guard
  }, []);

  // Sync mock pump tracking with pumpStatus changes (safety net)
  useEffect(() => {
    // If inflatee2 pump status becomes null but interval is still running, stop it
    if (pumpStatus.inflatee2 === null && mockPumpIntervalRef.current !== null) {
      console.log('[PlayViewer] Auto-stopping orphaned mock tracking');
      stopMockPumpTracking();
    }
  }, [pumpStatus.inflatee2, stopMockPumpTracking]);

  // Emergency stop - stop all pumps (real and mock)
  const handleEmergencyStop = useCallback(() => {
    // Stop mock pump tracking
    stopMockPumpTracking();

    // Clear pump timer
    if (pumpTimerRef.current) {
      clearTimeout(pumpTimerRef.current);
    }

    // Clear pump status
    setPumpStatus({ inflatee1: null, inflatee2: null });

    // Send WebSocket message to stop all real devices
    sendWsMessage('screenplay_pump', {
      type: 'emergency_stop_all'
    });

    console.log('[Screenplay] Emergency stop activated - all pumps stopped');
  }, [stopMockPumpTracking, sendWsMessage]);

  // Pump control handlers
  const handlePumpOn = useCallback(() => {
    sendWsMessage('screenplay_pump', {
      type: 'device_on',
      device: 'Primary Pump'
    });
    console.log('[Screenplay] Pump ON');
  }, [sendWsMessage]);

  const handlePumpOff = useCallback(() => {
    sendWsMessage('screenplay_pump', {
      type: 'device_off',
      device: 'Primary Pump'
    });
    console.log('[Screenplay] Pump OFF');
  }, [sendWsMessage]);

  const handlePumpCycle = useCallback(() => {
    setShowPumpDialog('cycle');
  }, []);

  const handlePumpPulse = useCallback(() => {
    setShowPumpDialog('pulse');
  }, []);

  const handlePumpTimed = useCallback(() => {
    setShowPumpDialog('timed');
  }, []);

  const handlePumpUntil = useCallback(() => {
    setShowPumpDialog('until');
  }, []);

  const executePumpCycle = useCallback(() => {
    sendWsMessage('screenplay_pump', {
      type: 'start_cycle',
      device: 'Primary Pump',
      duration: pumpDialogValues.duration,
      interval: pumpDialogValues.interval,
      cycles: pumpDialogValues.cycles
    });
    console.log('[Screenplay] Pump CYCLE started:', pumpDialogValues);
    setShowPumpDialog(null);
  }, [sendWsMessage, pumpDialogValues]);

  const executePumpPulse = useCallback(() => {
    sendWsMessage('screenplay_pump', {
      type: 'pulse_pump',
      device: 'Primary Pump',
      pulses: pumpDialogValues.pulses
    });
    console.log('[Screenplay] Pump PULSE:', pumpDialogValues.pulses);
    setShowPumpDialog(null);
  }, [sendWsMessage, pumpDialogValues]);

  const executePumpTimed = useCallback(() => {
    sendWsMessage('screenplay_pump', {
      type: 'device_on',
      device: 'Primary Pump',
      duration: pumpDialogValues.duration
    });
    console.log('[Screenplay] Pump TIMED:', pumpDialogValues.duration);
    setShowPumpDialog(null);
  }, [sendWsMessage, pumpDialogValues]);

  const executePumpUntil = useCallback(() => {
    sendWsMessage('screenplay_pump', {
      type: 'device_on_until',
      device: 'Primary Pump',
      targetCapacity: pumpDialogValues.targetCapacity,
      untilType: 'capacity'
    });
    console.log('[Screenplay] Pump UNTIL capacity:', pumpDialogValues.targetCapacity);
    setShowPumpDialog(null);
  }, [sendWsMessage, pumpDialogValues]);

  // Get current page
  const currentPage = play?.pages?.[currentPageId];

  // Process next paragraph
  const processNextParagraph = useCallback(() => {
    if (!currentPage || isWaitingForChoice || isWaitingForPopup || isEnded || isProcessing) return;

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
          setIsProcessing(false);
        } else {
          // Continue to next paragraph
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
          // Auto-advance immediately
          setTimeout(() => {
            setIsProcessing(false);
            processNextParagraph();
          }, 10);
        }
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
        // Auto-advance immediately
        setTimeout(() => {
          setIsProcessing(false);
          processNextParagraph();
        }, 10);
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
        // Auto-advance immediately
        setTimeout(() => {
          setIsProcessing(false);
          processNextParagraph();
        }, 10);
        break;

      case 'delay':
        // Wait then continue
        setTimeout(() => {
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
          // Auto-advance after delay
          setTimeout(() => {
            setIsProcessing(false);
            processNextParagraph();
          }, 10);
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
        // Auto-advance immediately for pump events
        setTimeout(() => {
          setIsProcessing(false);
          processNextParagraph();
        }, 10);
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
          if (target === 'inflatee2') {
            stopMockPumpTracking();
          }
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
          // Auto-advance immediately for pump events
          setTimeout(() => {
            setIsProcessing(false);
            processNextParagraph();
          }, 10);
        } else if (action === 'on') {
          // Turn pump on indefinitely with continuous capacity tracking
          setPumpStatus(prev => ({ ...prev, [target]: 'on' }));
          if (target === 'inflatee2') {
            startMockPumpTracking();
          }
          setCurrentParaIndex(prev => prev + 1);
          setIsProcessing(false);
          // Auto-advance immediately for pump events
          setTimeout(() => {
            setIsProcessing(false);
            processNextParagraph();
          }, 10);
        } else {
          // Cycle, pulse, or timed - run for duration with continuous tracking then stop
          setPumpStatus(prev => ({ ...prev, [target]: action }));

          if (target === 'inflatee2') {
            startMockPumpTracking();
          }

          pumpTimerRef.current = setTimeout(() => {
            // Stop tracking and pump after duration
            if (target === 'inflatee2') {
              stopMockPumpTracking();
            }
            // Always set status to null when timer expires
            setPumpStatus(prev => ({ ...prev, [target]: null }));
            setCurrentParaIndex(prev => prev + 1);
            setIsProcessing(false);
            // Auto-advance immediately for pump events
            setTimeout(() => {
              setIsProcessing(false);
              processNextParagraph();
            }, 10);
          }, duration);
        }
        break;

      case 'parallel_container':
        // Execute all child events simultaneously and immediately continue
        const children = para.data.children || [];

        // Fire off all child events without waiting
        children.forEach(child => {
          // Execute child based on its type
          switch (child.type) {
            case 'pump':
              // Real pump event
              const pumpDevice = child.data.device || 'Primary Pump';
              const pumpAction = child.data.action || 'cycle';

              if (pumpAction === 'cycle') {
                sendWsMessage('screenplay_pump', {
                  type: 'start_cycle',
                  device: pumpDevice,
                  duration: child.data.duration || 5,
                  interval: child.data.interval || 10,
                  cycles: child.data.cycles || 0
                });
              } else if (pumpAction === 'pulse') {
                sendWsMessage('screenplay_pump', {
                  type: 'pulse_pump',
                  device: pumpDevice,
                  pulses: child.data.pulses || 3
                });
              } else if (pumpAction === 'timed') {
                sendWsMessage('screenplay_pump', {
                  type: 'device_on',
                  device: pumpDevice,
                  duration: child.data.duration || 5
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
              } else if (pumpAction === 'until') {
                sendWsMessage('screenplay_pump', {
                  type: 'device_on_until',
                  device: pumpDevice,
                  targetCapacity: child.data.targetCapacity || 50,
                  untilType: 'capacity'
                });
              }
              break;

            case 'mock_pump':
              // Mock pump event - fire and forget
              const mockTarget = child.data.target || 'inflatee1';
              const mockAction = child.data.action || 'cycle';
              const mockDuration = child.data.duration || 5000;

              if (mockAction === 'off') {
                setPumpStatus(prev => ({ ...prev, [mockTarget]: null }));
                if (mockTarget === 'inflatee2') {
                  stopMockPumpTracking();
                }
              } else if (mockAction === 'on') {
                setPumpStatus(prev => ({ ...prev, [mockTarget]: 'on' }));
                if (mockTarget === 'inflatee2') {
                  startMockPumpTracking();
                }
              } else if (mockAction === 'until') {
                // Run until target capacity reached
                setPumpStatus(prev => ({ ...prev, [mockTarget]: 'until' }));
                if (mockTarget === 'inflatee2') {
                  startMockPumpTracking();
                }

                const targetCap = child.data.targetCapacity || 50;
                const checkInterval = setInterval(() => {
                  const currentCap = inflateeCapacity[mockTarget] || 0;
                  if (currentCap >= targetCap) {
                    clearInterval(checkInterval);
                    if (mockTarget === 'inflatee2') {
                      stopMockPumpTracking();
                    }
                    setPumpStatus(prev => ({ ...prev, [mockTarget]: null }));
                  }
                }, 500);

                // Safety timeout: 10 minutes
                setTimeout(() => {
                  clearInterval(checkInterval);
                  if (mockTarget === 'inflatee2') {
                    stopMockPumpTracking();
                  }
                  setPumpStatus(prev => ({ ...prev, [mockTarget]: null }));
                }, 600000);
              } else {
                // Cycle, pulse, or timed - run for duration
                setPumpStatus(prev => ({ ...prev, [mockTarget]: mockAction }));
                if (mockTarget === 'inflatee2') {
                  startMockPumpTracking();
                }
                setTimeout(() => {
                  if (mockTarget === 'inflatee2') {
                    stopMockPumpTracking();
                  }
                  // Always set status to null after timed operations
                  setPumpStatus(prev => ({ ...prev, [mockTarget]: null }));
                }, mockDuration);
              }
              break;

            case 'set_variable':
              // Set a variable
              const varName = child.data.variableName;
              const varValue = child.data.value;
              if (varName) {
                setVariables(prev => ({
                  ...prev,
                  [varName]: varValue
                }));
              }
              break;

            case 'set_npc_actor_avatar':
              // Set NPC actor avatar
              if (child.data.sourceType === 'image' && child.data.imageTag) {
                setRightImageUrl(`${API_BASE}/api/media/images/tag/${child.data.imageTag}`);
                setRightImageName(child.data.imageTag);
                setRightActorId(null);
              } else if (child.data.actorId) {
                setRightActorId(child.data.actorId);
                setRightImageUrl(null);
                setRightImageName(null);
              }
              break;

            case 'delay':
              // Delays are ignored in parallel containers (they run in background)
              break;

            default:
              // Unknown child type, ignore
              break;
          }
        });

        // Immediately advance to next paragraph without waiting
        setCurrentParaIndex(prev => prev + 1);
        setIsProcessing(false);
        setAutoAdvancePending(true); // Trigger auto-advance via effect
        break;

      case 'popup':
        // Show popup notification with OK/Cancel buttons
        setCurrentPopupData(para.data);
        setIsWaitingForPopup(true);
        setIsProcessing(false);
        break;

      case 'toast':
        // Display toast notification that auto-fades
        const toastId = `toast-${Date.now()}`;
        const toastDuration = para.data.duration || 2000;

        // Show toast immediately
        setDisplayedToasts(prev => [...prev, {
          id: toastId,
          message: substituteVariables(para.data.message || 'Notification'),
          duration: toastDuration
        }]);

        // Auto-remove toast after duration
        setTimeout(() => {
          setDisplayedToasts(prev => prev.filter(t => t.id !== toastId));
        }, toastDuration + 500); // +500ms for fade animation

        // Advance to next paragraph immediately (don't wait for toast to fade)
        // Must increment index and trigger advance in separate ticks for React state to settle
        setCurrentParaIndex(prev => prev + 1);
        setIsProcessing(false);
        requestAnimationFrame(() => {
          setAutoAdvancePending(true);
        });
        break;

      case 'challenge_wheel':
      case 'challenge_dice':
      case 'challenge_coin':
      case 'challenge_rps':
      case 'challenge_number_guess':
      case 'challenge_slots':
      case 'challenge_card':
      case 'challenge_simon':
      case 'challenge_reflex':
        // Add challenge as inline bubble (not modal)
        setDisplayedParagraphs(prev => [...prev, {
          type: para.type,
          data: para.data,
          key: `${currentPageId}-${para.id}-challenge`,
          paraId: para.id
        }]);
        setCurrentChallengeType(para.type);
        setCurrentChallengeData(para.data);
        setIsWaitingForChallenge(true);
        setIsProcessing(false);
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
  }, [currentPage, currentPageId, currentParaIndex, isWaitingForChoice, isWaitingForPopup, isEnded, isProcessing, variables, substituteVariables, enhanceText, sendWsMessage, startMockPumpTracking]);

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
    hasAutoStartedRef.current = false; // Reset auto-start flag for new page
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

    // Emergency stop all pumps first
    handleEmergencyStop();

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
    setIsProcessing(false); // Reset processing state to allow auto-start
    hasAutoStartedRef.current = false; // Reset auto-start flag to allow restart

    // Reset all capacities to initial values
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
    const nonPlayerActors = actors.filter(a => playActors.includes(a.id) && a.id !== playerActor?.id);
    const firstNonPlayer = nonPlayerActors[0];
    const secondNonPlayer = nonPlayerActors[1];

    setRightActorId(play.inflatee2ActorId || firstNonPlayer?.id || null);

    // Reset third actor if there are 3+ actors total
    if (playActors.length >= 3 && secondNonPlayer) {
      setThirdActorId(secondNonPlayer.id);
    } else {
      setThirdActorId(null);
    }

    console.log('[Screenplay] Play reset - all states cleared, will auto-restart');
  }, [play, actors, handleEmergencyStop]);

  // Exit play (close viewer)
  const handleExit = useCallback(() => {
    // Trigger closing animation
    setIsClosing(true);

    // Emergency stop all pumps before closing
    handleEmergencyStop();

    console.log('[Screenplay] Exiting play - all pumps stopped, avatars sliding out');

    // Wait for slide-out animation to complete (500ms) before closing
    setTimeout(() => {
      onClose();
    }, 500);
  }, [handleEmergencyStop, onClose]);

  // Handle popup OK button
  const handlePopupOk = useCallback(() => {
    const action = currentPopupData?.okAction || 'continue';
    const targetPageId = currentPopupData?.okTargetPageId;

    setIsWaitingForPopup(false);
    setCurrentPopupData(null);

    if (action === 'exit') {
      handleExit();
    } else if (action === 'jump_to_page' && targetPageId) {
      goToPage(targetPageId);
    } else {
      // Default: continue to next paragraph
      setCurrentParaIndex(prev => prev + 1);
      requestAnimationFrame(() => {
        setAutoAdvancePending(true);
      });
    }
  }, [currentPopupData, handleExit, goToPage]);

  // Handle popup Cancel button
  const handlePopupCancel = useCallback(() => {
    const action = currentPopupData?.cancelAction || 'exit';
    const targetPageId = currentPopupData?.cancelTargetPageId;

    setIsWaitingForPopup(false);
    setCurrentPopupData(null);

    if (action === 'jump_to_page' && targetPageId) {
      goToPage(targetPageId);
    } else {
      // Default: exit play
      handleExit();
    }
  }, [currentPopupData, handleExit, goToPage]);

  // Handle challenge completion
  const handleChallengeComplete = useCallback((result) => {
    if (!isWaitingForChallenge) return; // Prevent double-trigger

    setIsWaitingForChallenge(false);

    // Replace the challenge in displayedParagraphs with a result display
    setDisplayedParagraphs(prev => prev.map(p =>
      p.type === currentChallengeType ? {
        ...p,
        type: 'challenge_result',
        data: {
          challengeType: currentChallengeType,
          result: result.segmentLabel || result.outcome || result.value || 'Complete'
        }
      } : p
    ));

    // Store result in session variables if resultVariable specified
    if (currentChallengeData?.resultVariable && result.value !== undefined) {
      setVariables(prev => ({
        ...prev,
        [currentChallengeData.resultVariable]: result.value
      }));
    }

    // Store additional variables (e.g., cardValue, cardSuit, playerChoice)
    if (result.additionalVariables) {
      setVariables(prev => ({
        ...prev,
        ...result.additionalVariables
      }));
    }

    setCurrentChallengeType(null);
    const skipTargetPageId = currentChallengeData?.skipTargetPageId;
    setCurrentChallengeData(null);

    // Navigate to target page or continue
    // If cancelled (skip pressed), use skipTargetPageId if set
    if (result.cancelled && skipTargetPageId) {
      goToPage(skipTargetPageId);
    } else if (result.targetPageId) {
      goToPage(result.targetPageId);
    } else {
      // Continue to next paragraph
      setCurrentParaIndex(prev => prev + 1);
      setAutoAdvancePending(true);
    }
  }, [currentChallengeData, currentChallengeType, isWaitingForChallenge, goToPage]);

  // Auto-scroll to bottom when new content appears
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedParagraphs]);

  // Auto-process first paragraph when page loads (only once per page)
  useEffect(() => {
    if (currentPage && currentParaIndex === 0 && displayedParagraphs.length === 0 && !isProcessing && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true; // Mark as auto-started to prevent duplicates
      // Mark play as started when first paragraph processes
      setPlayStarted(true);
      processNextParagraph();
    }
  }, [currentPage, currentParaIndex, displayedParagraphs.length, isProcessing, processNextParagraph]);

  // Auto-advance to next paragraph for non-interactive events (pump, delay, set_variable, etc.)
  useEffect(() => {
    if (autoAdvancePending && !isProcessing) {
      setAutoAdvancePending(false);
      // Small delay to allow state to settle
      const timer = setTimeout(() => {
        processNextParagraph();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoAdvancePending, isProcessing, processNextParagraph]);

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

      case 'challenge_wheel':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeWheel
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_dice':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeDice
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_coin':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeCoin
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_rps':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeRPS
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_number_guess':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeNumberGuess
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_slots':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeSlots
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_card':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeCard
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_simon':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeSimon
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_reflex':
        return (
          <div key={para.key} className="para-display challenge-bubble">
            <ChallengeReflex
              data={para.data}
              onComplete={handleChallengeComplete}
              substituteVariables={substituteVariables}
            />
          </div>
        );

      case 'challenge_result':
        return (
          <div key={para.key} className="para-display challenge-result">
            <p>Result: {para.data.result}</p>
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

            {/* Desktop ending display - inline */}
            {isEnded && endingData && (
              <div className={`ending-display desktop-only ${endingData.endingType}`}>
                <h3>{endingData.endingType === 'good' ? '🎉' : endingData.endingType === 'bad' ? '💀' : '🏁'} {endingData.message || 'The End'}</h3>
                <div className="ending-buttons">
                  <button className="restart-btn" onClick={handleRestart}>
                    Play Again
                  </button>
                  <button className="exit-btn" onClick={handleExit}>
                    Exit
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="play-viewer-footer desktop-only">
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

      {/* Desktop Filmstrip avatars - portaled to body to avoid transform containment */}
      {createPortal(
        <>
          <div className="filmstrip-column filmstrip-left">
            <div className={`avatar-frame ${playStarted && !isClosing ? 'visible' : ''}`}>
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

            {/* Control panel (bottom left) */}
            <div className={`control-panel ${playStarted && !isClosing ? 'visible' : ''}`}>
              <div className="control-panel-content">
                <div className="control-row control-row-main">
                  <button className="reset-btn" onClick={handleRestart} title="Reset play">
                    RESET
                  </button>
                  <button className="exit-btn" onClick={handleExit} title="Exit play">
                    EXIT
                  </button>
                </div>
                <div className="control-section-label">Pump Controls</div>
                <div className="control-row">
                  <button className="pump-btn" onClick={handlePumpOn}>ON</button>
                  <button className="pump-btn" onClick={handlePumpOff}>OFF</button>
                </div>
                <div className="control-row">
                  <button className="pump-btn" onClick={handlePumpCycle}>CYCLE</button>
                  <button className="pump-btn" onClick={handlePumpPulse}>PULSE</button>
                </div>
                <div className="control-row">
                  <button className="pump-btn" onClick={handlePumpTimed}>TIMED</button>
                  <button className="pump-btn" onClick={handlePumpUntil}>UNTIL</button>
                </div>
              </div>
            </div>
          </div>

          <div className="filmstrip-column filmstrip-right">
            <div className={`avatar-frame ${playStarted && !isClosing ? 'visible' : ''}`}>
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

            {/* Third actor frame (bottom right) - only if 3+ actors */}
            {thirdActor && (
              <div className={`avatar-frame avatar-frame-third ${playStarted && !isClosing ? 'visible' : ''}`}>
                <div className="frame-name">{thirdActor.name}</div>
                <div className="portrait-wrapper portrait-wrapper-small">
                  {thirdActor.avatar ? (
                    <img src={thirdActor.avatar} alt={thirdActor.name} className="frame-avatar" />
                  ) : (
                    <div className="frame-avatar-placeholder">
                      {thirdActor.name?.charAt(0) || '?'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Mobile-only gauges and avatars - portaled to body */}
      {playStarted && !isClosing && createPortal(
        <>
          {/* Mobile Gauges (left side) */}
          <div className="mobile-gauges">
            {/* Player gauge */}
            <div
              className={`mobile-gauge ${expandedGaugeIndex === 0 ? 'expanded' : ''}`}
              onClick={() => setExpandedGaugeIndex(expandedGaugeIndex === 0 ? null : 0)}
            >
              <div className="mobile-gauge-inner">
                <div className="mobile-gauge-arc" />
                <div
                  className="mobile-gauge-needle"
                  style={{ transform: `rotate(${-135 + (Math.min(100, Math.max(0, inflateeCapacity.inflatee1)) * 2.7)}deg)` }}
                />
                <div className="mobile-gauge-center" />
                <div className="mobile-gauge-percent">{Math.round(inflateeCapacity.inflatee1)}%</div>
              </div>
              <div className="mobile-gauge-name">{inflatee1Actor?.name || 'Player'}</div>
            </div>

            {/* Inflatee2 gauge (if enabled) */}
            {play?.inflatee2Enabled && (
              <div
                className={`mobile-gauge ${expandedGaugeIndex === 1 ? 'expanded' : ''}`}
                onClick={() => setExpandedGaugeIndex(expandedGaugeIndex === 1 ? null : 1)}
              >
                <div className="mobile-gauge-inner">
                  <div className="mobile-gauge-arc" />
                  <div
                    className="mobile-gauge-needle"
                    style={{ transform: `rotate(${-135 + (Math.min(100, Math.max(0, inflateeCapacity.inflatee2)) * 2.7)}deg)` }}
                  />
                  <div className="mobile-gauge-center" />
                  <div className="mobile-gauge-percent">{Math.round(inflateeCapacity.inflatee2)}%</div>
                </div>
                <div className="mobile-gauge-name">{rightActor?.name || rightImageName || 'Inflatee 2'}</div>
              </div>
            )}
          </div>

          {/* Mobile Avatar Bubbles (right side) */}
          <div className="mobile-avatars">
            {/* Player avatar (top) */}
            {inflatee1Actor && (
              <div
                className={`mobile-avatar-bubble ${expandedAvatarIndex === -1 ? 'expanded' : ''}`}
                onClick={() => setExpandedAvatarIndex(expandedAvatarIndex === -1 ? null : -1)}
              >
                {inflatee1Actor.avatar ? (
                  <img src={inflatee1Actor.avatar} alt={inflatee1Actor.name} />
                ) : (
                  <div className="mobile-avatar-placeholder">
                    {inflatee1Actor.name?.charAt(0) || '?'}
                  </div>
                )}
                <div className="mobile-avatar-name">
                  {inflatee1Actor.name || 'Player'}
                </div>
              </div>
            )}

            {/* Inflatee2 avatar - shows rightActor which is set to inflatee2ActorId */}
            {(rightActor || rightImageUrl) && (
              <div
                className={`mobile-avatar-bubble ${expandedAvatarIndex === 0 ? 'expanded' : ''}`}
                onClick={() => setExpandedAvatarIndex(expandedAvatarIndex === 0 ? null : 0)}
              >
                {rightImageUrl ? (
                  <img src={rightImageUrl} alt={rightImageName || 'Inflatee 2'} />
                ) : rightActor?.avatar ? (
                  <img src={rightActor.avatar} alt={rightActor.name} />
                ) : rightActor ? (
                  <div className="mobile-avatar-placeholder">
                    {rightActor.name?.charAt(0) || '?'}
                  </div>
                ) : null}
                <div className="mobile-avatar-name">
                  {rightImageName || rightActor?.name || 'Inflatee 2'}
                </div>
              </div>
            )}

            {/* Third actor avatar (only show if not the same as rightActor) */}
            {thirdActor && thirdActor.id !== rightActorId && (
              <div
                className={`mobile-avatar-bubble ${expandedAvatarIndex === 1 ? 'expanded' : ''}`}
                onClick={() => setExpandedAvatarIndex(expandedAvatarIndex === 1 ? null : 1)}
              >
                {thirdActor.avatar ? (
                  <img src={thirdActor.avatar} alt={thirdActor.name} />
                ) : (
                  <div className="mobile-avatar-placeholder">
                    {thirdActor.name?.charAt(0) || '?'}
                  </div>
                )}
                <div className="mobile-avatar-name">{thirdActor.name}</div>
              </div>
            )}
          </div>

          {/* Mobile Controls Panel */}
          <div className={`mobile-controls-panel ${mobileControlsOpen ? 'open' : ''}`}>
            <div className="mobile-controls-header">
              <div className="mobile-controls-title">Controls</div>
              <button className="mobile-controls-close" onClick={() => setMobileControlsOpen(false)}>
                ×
              </button>
            </div>
            <div className="mobile-controls-content">
              <div className="mobile-control-row mobile-control-row-main">
                <button className="mobile-reset-btn" onClick={() => { handleRestart(); setMobileControlsOpen(false); }}>
                  RESET
                </button>
                <button className="mobile-exit-btn" onClick={() => { handleExit(); setMobileControlsOpen(false); }}>
                  EXIT
                </button>
              </div>
              <div className="mobile-control-section-label">Pump Controls</div>
              <div className="mobile-control-row">
                <button className="mobile-pump-btn" onClick={() => { handlePumpOn(); setMobileControlsOpen(false); }}>ON</button>
                <button className="mobile-pump-btn" onClick={() => { handlePumpOff(); setMobileControlsOpen(false); }}>OFF</button>
              </div>
              <div className="mobile-control-row">
                <button className="mobile-pump-btn" onClick={() => { handlePumpCycle(); setMobileControlsOpen(false); }}>CYCLE</button>
                <button className="mobile-pump-btn" onClick={() => { handlePumpPulse(); setMobileControlsOpen(false); }}>PULSE</button>
              </div>
              <div className="mobile-control-row">
                <button className="mobile-pump-btn" onClick={() => { handlePumpTimed(); setMobileControlsOpen(false); }}>TIMED</button>
                <button className="mobile-pump-btn" onClick={() => { handlePumpUntil(); setMobileControlsOpen(false); }}>UNTIL</button>
              </div>
            </div>
          </div>

          {/* Mobile Footer (portaled to ensure it's always visible) - hide when ended */}
          {!isEnded && (
            <div className="mobile-footer">
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
              <>
                <button className="mobile-controls-btn" onClick={() => setMobileControlsOpen(true)}>
                  Controls
                </button>
                <button className="continue-btn" onClick={handleContinue} disabled={isProcessing}>
                  {isProcessing ? '...' : 'Continue'}
                </button>
              </>
            ) : !isEnded && currentPage && currentParaIndex >= (currentPage.paragraphs?.length || 0) ? (
              <div className="page-end-message">
                End of page - add more paragraphs or an ending
              </div>
            ) : null}
          </div>
          )}

          {/* Mobile ending display - portaled and centered */}
          {isEnded && endingData && (
            <div className={`ending-display mobile-only ${endingData.endingType}`}>
              <h3>{endingData.endingType === 'good' ? '🎉' : endingData.endingType === 'bad' ? '💀' : '🏁'} {endingData.message || 'The End'}</h3>
              <div className="ending-buttons">
                <button className="restart-btn" onClick={handleRestart}>
                  Play Again
                </button>
                <button className="exit-btn" onClick={handleExit}>
                  Exit
                </button>
              </div>
            </div>
          )}
        </>,
        document.body
      )}

      {/* Pump control dialogs */}
      {showPumpDialog && (
        <div className="pump-dialog-overlay" onClick={() => setShowPumpDialog(null)}>
          <div className="pump-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{showPumpDialog.toUpperCase()} Settings</h3>

            {showPumpDialog === 'cycle' && (
              <>
                <div className="pump-dialog-field">
                  <label>Duration (seconds):</label>
                  <input
                    type="number"
                    value={pumpDialogValues.duration}
                    onChange={(e) => setPumpDialogValues(prev => ({ ...prev, duration: Number(e.target.value) }))}
                    min="1"
                  />
                </div>
                <div className="pump-dialog-field">
                  <label>Interval (seconds):</label>
                  <input
                    type="number"
                    value={pumpDialogValues.interval}
                    onChange={(e) => setPumpDialogValues(prev => ({ ...prev, interval: Number(e.target.value) }))}
                    min="1"
                  />
                </div>
                <div className="pump-dialog-field">
                  <label>Cycles (0 = infinite):</label>
                  <input
                    type="number"
                    value={pumpDialogValues.cycles}
                    onChange={(e) => setPumpDialogValues(prev => ({ ...prev, cycles: Number(e.target.value) }))}
                    min="0"
                  />
                </div>
              </>
            )}

            {showPumpDialog === 'pulse' && (
              <div className="pump-dialog-field">
                <label>Number of pulses:</label>
                <input
                  type="number"
                  value={pumpDialogValues.pulses}
                  onChange={(e) => setPumpDialogValues(prev => ({ ...prev, pulses: Number(e.target.value) }))}
                  min="1"
                />
              </div>
            )}

            {showPumpDialog === 'timed' && (
              <div className="pump-dialog-field">
                <label>Duration (seconds):</label>
                <input
                  type="number"
                  value={pumpDialogValues.duration}
                  onChange={(e) => setPumpDialogValues(prev => ({ ...prev, duration: Number(e.target.value) }))}
                  min="1"
                />
              </div>
            )}

            {showPumpDialog === 'until' && (
              <div className="pump-dialog-field">
                <label>Target Capacity (%):</label>
                <input
                  type="number"
                  value={pumpDialogValues.targetCapacity}
                  onChange={(e) => setPumpDialogValues(prev => ({ ...prev, targetCapacity: Number(e.target.value) }))}
                  min="0"
                  max="100"
                />
              </div>
            )}

            <div className="pump-dialog-actions">
              <button className="pump-dialog-cancel" onClick={() => setShowPumpDialog(null)}>Cancel</button>
              <button
                className="pump-dialog-confirm"
                onClick={() => {
                  if (showPumpDialog === 'cycle') executePumpCycle();
                  else if (showPumpDialog === 'pulse') executePumpPulse();
                  else if (showPumpDialog === 'timed') executePumpTimed();
                  else if (showPumpDialog === 'until') executePumpUntil();
                }}
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popup notification dialog */}
      {isWaitingForPopup && currentPopupData && (
        <div className="popup-overlay">
          <div className="popup-dialog">
            <div className="popup-message">
              {substituteVariables(currentPopupData.message || 'Notification')}
            </div>
            <div className="popup-actions">
              {currentPopupData.cancelEnabled && (
                <button className="popup-btn popup-cancel" onClick={handlePopupCancel}>
                  {currentPopupData.cancelLabel || 'Cancel'}
                </button>
              )}
              <button className="popup-btn popup-ok" onClick={handlePopupOk}>
                {currentPopupData.okLabel || 'Ok'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {displayedToasts.length > 0 && createPortal(
        <div className="toast-container">
          {displayedToasts.map((toast, index) => (
            <div
              key={toast.id}
              className="toast-notification"
              style={{
                animationDuration: `${toast.duration}ms`,
                bottom: `${20 + (index * 80)}px` // Stack toasts if multiple
              }}
            >
              {toast.message}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default PlayViewer;
