import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import FlowAssignmentModal from '../modals/FlowAssignmentModal';
import './SettingsTabs.css';

function GlobalTab() {
  const { flows, sessionState, sendWsMessage, settings, api, controlMode, setControlMode, simulationRequired, simulationReason, devices, characters } = useApp();
  const { showError } = useError();
  const navigate = useNavigate();
  const [showFlowModal, setShowFlowModal] = useState(false);

  // Timer refs for calibration
  const pumpTimerRef = useRef(null);
  const selectedPumpIdRef = useRef(null);
  const pumpDevicesRef = useRef([]);
  const apiRef = useRef(api);
  const elapsedRef = useRef(0);
  const cycleIdRef = useRef(0); // Unique ID for each pump cycle
  const cycleDurationRef = useRef(5); // Current cycle duration for timer callback
  const [globalPrompt, setGlobalPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const draftInitialized = useRef(false);

  // Global Reminders state
  const [globalReminders, setGlobalReminders] = useState([]);
  const [reminderForm, setReminderForm] = useState({
    name: '',
    text: '',
    constant: true,
    keys: [],
    caseSensitive: false,
    priority: 100,
    scanDepth: 10
  });
  const [keyInput, setKeyInput] = useState('');
  const [editingReminder, setEditingReminder] = useState(null);
  const [isSavingReminders, setIsSavingReminders] = useState(false);
  const lorebookFileInputRef = useRef(null);
  const [importingLorebook, setImportingLorebook] = useState(false);

  // Remote Settings state
  const [remoteSettings, setRemoteSettings] = useState({ allowRemote: false, whitelistedIps: [], isLocalRequest: false });
  const [newIp, setNewIp] = useState('');
  const [isLoadingRemote, setIsLoadingRemote] = useState(true);

  // Global Character Controls state
  const [characterControls, setCharacterControls] = useState({
    useAutoCapacity: false,
    hasCalibrated: false,
    autoLinkCapacityToPain: true,
    emotionalDecline: true,
    autoCapacityMultiplier: 1.0,
    allowLlmDeviceControl: false,
    llmDeviceControlMaxSeconds: 30,
    llmDeviceControlPulseDuration: 3,
    allowOverInflation: false,
    enableAutoPopRoleplay: false,
    autoPopMode: 'fixed',
    autoPopFixedPercent: 110,
    autoPopRandomMin: 100,
    autoPopRandomMax: 150
  });

  // Calibration modal state
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [calibrationState, setCalibrationState] = useState({
    selectedPumpId: null,
    currentTime: 0,
    capacity: 0,
    painLevel: 0,
    phase: 'setup', // 'setup' | 'running' | 'paused' | 'stopped' | 'complete'
    isPumpRunning: false,
    cycleDuration: 5 // 5-30 in 5-second increments, or 'continuous'
  });

  // Manual calibration modal state
  const [showManualCalibrationModal, setShowManualCalibrationModal] = useState(false);
  const [manualCalibrationData, setManualCalibrationData] = useState({
    secondsTo100: '',
    painLevelAt100: 0
  });

  // Resume calibration popup state
  const [showResumePopup, setShowResumePopup] = useState(false);
  const [resumeData, setResumeData] = useState({
    pumpId: null,
    time: 0,
    capacity: 0,
    painLevel: 0,
    cycleDuration: 5
  });

  // Get Julie character for calibration modal
  const julieCharacter = characters.find(c => c.name === 'Julie');

  // Get pump devices
  const pumpDevices = devices.filter(d => d.deviceType === 'PUMP');
  const primaryPump = pumpDevices.find(d => d.isPrimary);

  // Helper to get device identifier - Tuya/Govee use deviceId, TPLink uses ip
  const getDeviceIdentifier = (device) => {
    if (!device) return null;
    if (device.brand === 'tuya' || device.brand === 'govee') {
      return device.deviceId;
    }
    return device.ip;
  };

  // Keep refs in sync for use in interval callbacks (avoids stale closures)
  useEffect(() => {
    selectedPumpIdRef.current = calibrationState.selectedPumpId;
  }, [calibrationState.selectedPumpId]);

  useEffect(() => {
    cycleDurationRef.current = calibrationState.cycleDuration;
  }, [calibrationState.cycleDuration]);

  useEffect(() => {
    pumpDevicesRef.current = pumpDevices;
  }, [pumpDevices]);

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // Handle pump selection
  const handlePumpSelect = (pumpId) => {
    const pump = pumpDevices.find(p => p.id === pumpId);
    selectedPumpIdRef.current = pumpId; // Update ref immediately
    setCalibrationState(prev => ({
      ...prev,
      selectedPumpId: pumpId,
      currentTime: pump?.calibrationTime || 0,
      capacity: 0,
      painLevel: 0
    }));
  };

  // Handle Configure Devices button
  const handleConfigureDevices = () => {
    setShowCalibrationModal(false);
    navigate('/settings', { state: { activeTab: 'device' } });
  };

  // Get Julie's dynamic message based on calibration phase and capacity
  const getJulieMessage = useCallback(() => {
    const { capacity, phase } = calibrationState;

    if (phase === 'setup') {
      return `"Hello! My name is Julie, and I'm going to help you find your limits. We'll be inflating you in 5-second increments. After each burst, tell me how full you feel and how much it hurts. If you need to resume a calibration that was previously interrupted, press Resume Calibration. Ready?"`;
    }

    if (phase === 'running') {
      return `"Here we go... breathe deeply and let it fill you up..."`;
    }

    if (phase === 'stopped') {
      return `"Taking a break? That's okay! When you're ready to continue, just press Continue. We'll get you to your limit together!"`;
    }

    if (phase === 'complete') {
      return `"Oh my! Look at that belly - you look like you're about to pop! You've done wonderfully. Press Finish to save your calibration data."`;
    }

    // Paused phase - messages by capacity level with belly pressing instructions
    if (capacity < 5) return `"Alright, we're just getting started. Move the sliders to show how you feel, then press Continue for another burst!"`;
    if (capacity < 15) return `"Just a little air so far. How does that feel? Give your belly a gentle poke - feel how soft it still is? Adjust your sliders and let's keep going!"`;
    if (capacity < 25) return `"You're warming up nicely! That belly is starting to show. Try pressing gently on the sides - feel it starting to firm up? Ready for more?"`;
    if (capacity < 35) return `"Mmm, looking fuller already! Press your palm flat against your belly and push in slowly. Feel that pressure? Now imagine how much tighter it's going to get!"`;
    if (capacity < 45) return `"Almost halfway there! Squeeze your belly from both sides with your hands - feel how round it's becoming? Press in firmly once or twice. Keep those sliders updated!"`;
    if (capacity < 55) return `"Halfway! You're doing great. Press down on top of your belly with both hands - that's a nice tight drum forming! Give it three good presses and feel how full you are."`;
    if (capacity < 65) return `"Past the halfway mark! The real challenge begins now. Squeeze from the sides firmly, then press directly in with your fist - hold it for a moment. Your belly looks wonderfully distended! Don't stop now!"`;
    if (capacity < 75) return `"Seventy percent! You're getting so big! I know it feels like you might pop, but you can take more. Press hard into your belly from multiple angles - sides, top, directly in. Do it five times. Feel how incredibly tight you are!"`;
    if (capacity < 85) return `"Eighty percent! Oh, that belly is stretched so tight! Squeeze from the sides as hard as you can, then press your fist deep into the center - hold for three seconds. Do this three times. You're almost there - don't give up now!"`;
    if (capacity < 95) return `"Ninety percent! You're incredible! Press and squeeze everywhere - sides, top, bottom, deep into the center. Ten firm presses all around. I know you feel like you're about to burst, but your body can handle more than you think. Just a little more!"`;
    if (capacity < 100) return `"So close to bursting! Your belly is enormous! Give it everything - squeeze from both sides as hard as you can while pressing in with your thumbs. Knead it like dough, press deep, feel every bit of that pressure. One more push to reach 100%! You've got this!"`;

    return `"Calibration in progress..."`;
  }, [calibrationState]);

  // Stop pump helper function - uses ref to avoid stale closure issues
  const stopPump = useCallback(async (autoStopped = false) => {
    // Use ref to get current pump ID (avoids stale closure from interval callback)
    const currentPumpId = selectedPumpIdRef.current;
    const pump = pumpDevices.find(p => p.id === currentPumpId);

    // Clear timer first
    if (pumpTimerRef.current) {
      clearInterval(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }

    if (pump) {
      try {
        console.log('[Calibration] Stopping pump:', pump.label || pump.name);
        await api.deviceOff(getDeviceIdentifier(pump), {
          childId: pump.childId,
          brand: pump.brand
        });
        console.log('[Calibration] Pump stopped successfully');
      } catch (error) {
        console.error('[Calibration] Failed to stop pump:', error);
      }
    } else {
      console.warn('[Calibration] stopPump called but no pump found for ID:', currentPumpId);
    }

    setCalibrationState(prev => ({
      ...prev,
      isPumpRunning: false,
      phase: autoStopped ? 'paused' : 'stopped'
    }));
  }, [pumpDevices, api]);

  // Recursive timeout tick function - defined outside useCallback to avoid closure issues
  const runTimerTick = useCallback(async (tickCount, cycleId) => {
    // Check if this cycle is still valid
    if (cycleIdRef.current !== cycleId) {
      console.log('[Calibration] Cycle cancelled:', cycleId, 'current:', cycleIdRef.current);
      return;
    }

    const duration = cycleDurationRef.current;
    const isContinuous = duration === 'continuous';
    console.log('[Calibration] Tick', tickCount, isContinuous ? '(continuous)' : `of ${duration}`, 'cycle:', cycleId);
    setCalibrationState(prev => ({ ...prev, currentTime: prev.currentTime + 1 }));

    // For continuous mode, never auto-stop - user must press Pause
    // For fixed duration, stop when tickCount reaches the duration
    if (!isContinuous && tickCount >= duration) {
      // Done - stop the pump
      console.log(`[Calibration] ${duration} seconds reached, stopping pump`);
      pumpTimerRef.current = null;

      const pumpId = selectedPumpIdRef.current;
      const pumpToStop = pumpDevicesRef.current.find(p => p.id === pumpId);
      const currentApi = apiRef.current;

      if (pumpToStop && currentApi) {
        console.log('[Calibration] Sending OFF to:', pumpToStop.label || pumpToStop.name);
        // Get correct identifier - Tuya/Govee use deviceId, TPLink uses ip
        const deviceIdentifier = (pumpToStop.brand === 'tuya' || pumpToStop.brand === 'govee')
          ? pumpToStop.deviceId
          : pumpToStop.ip;
        try {
          // Send OFF command twice for reliability (some smart plugs need this)
          await currentApi.deviceOff(deviceIdentifier, {
            childId: pumpToStop.childId,
            brand: pumpToStop.brand
          });
          console.log('[Calibration] First OFF command completed');

          // Small delay then send again
          await new Promise(resolve => setTimeout(resolve, 300));

          await currentApi.deviceOff(deviceIdentifier, {
            childId: pumpToStop.childId,
            brand: pumpToStop.brand
          });
          console.log('[Calibration] Second OFF command completed');

          // Give the device time to actually turn off
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log('[Calibration] Device settle delay complete');
        } catch (err) {
          console.error('[Calibration] OFF command failed:', err);
        }
      }

      setCalibrationState(prev => ({
        ...prev,
        isPumpRunning: false,
        phase: 'paused'
      }));
    } else {
      // Schedule next tick (continues for both fixed duration and continuous)
      pumpTimerRef.current = setTimeout(() => {
        runTimerTick(tickCount + 1, cycleId);
      }, 1000);
    }
  }, []);

  // Start pump function
  const startPump = useCallback(async () => {
    // Clear any existing timer
    if (pumpTimerRef.current) {
      clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }

    // Increment cycle ID to invalidate any stale callbacks
    cycleIdRef.current += 1;
    const thisCycleId = cycleIdRef.current;

    const currentPumpId = selectedPumpIdRef.current;
    const pump = pumpDevicesRef.current.find(p => p.id === currentPumpId);
    if (!pump) {
      console.error('[Calibration] No pump found for ID:', currentPumpId);
      return;
    }

    try {
      console.log('[Calibration] Starting pump:', pump.label || pump.name, 'cycle:', thisCycleId);
      // Get correct identifier - Tuya/Govee use deviceId, TPLink uses ip
      const deviceIdentifier = (pump.brand === 'tuya' || pump.brand === 'govee')
        ? pump.deviceId
        : pump.ip;
      await apiRef.current.deviceOn(deviceIdentifier, {
        childId: pump.childId,
        brand: pump.brand
      });

      setCalibrationState(prev => ({ ...prev, isPumpRunning: true, phase: 'running' }));

      // Start the timer chain with setTimeout
      pumpTimerRef.current = setTimeout(() => {
        runTimerTick(1, thisCycleId);
      }, 1000);

    } catch (error) {
      console.error('[Calibration] Failed to start pump:', error);
      showError('Failed to start pump');
    }
  }, [runTimerTick, showError]);

  // Handle Begin/Continue button
  const handleCalibrationAction = useCallback(() => {
    const { phase, capacity } = calibrationState;

    if (phase === 'setup' || phase === 'paused' || phase === 'stopped') {
      // Check if capacity is 100% - transition to complete
      if (capacity >= 100) {
        setCalibrationState(prev => ({ ...prev, phase: 'complete' }));
      } else {
        startPump();
      }
    }
  }, [calibrationState, startPump]);

  // Handle Stop button
  const handleStopCalibration = useCallback(() => {
    stopPump(false);
  }, [stopPump]);

  // Handle Reset button
  const handleResetCalibration = useCallback(async () => {
    if (calibrationState.isPumpRunning) {
      await stopPump(false);
    }
    clearInterval(pumpTimerRef.current);
    pumpTimerRef.current = null;

    setCalibrationState(prev => ({
      ...prev,
      currentTime: 0,
      capacity: 0,
      painLevel: 0,
      phase: 'setup',
      isPumpRunning: false,
      cycleDuration: 5
    }));
  }, [calibrationState.isPumpRunning, stopPump]);

  // Handle Finish button - save calibration
  const handleFinishCalibration = useCallback(async () => {
    const pump = pumpDevices.find(p => p.id === calibrationState.selectedPumpId);
    if (!pump) return;

    try {
      // Save calibration data to device
      await api.updateDevice(pump.id, {
        calibrationTime: calibrationState.currentTime,
        calibrationCapacity: 100,
        calibrationPainAtMax: calibrationState.painLevel,
        calibratedAt: new Date().toISOString()
      });

      // Update hasCalibrated flag in settings
      const updatedControls = { ...characterControls, hasCalibrated: true };
      await api.updateSettings({ globalCharacterControls: updatedControls });
      setCharacterControls(updatedControls);

      // Close modal with animation
      setIsClosingModal(true);
      setTimeout(() => {
        setShowCalibrationModal(false);
        setIsClosingModal(false);
        // Reset calibration state for next time
        setCalibrationState({
          selectedPumpId: null,
          currentTime: 0,
          capacity: 0,
          painLevel: 0,
          phase: 'setup',
          isPumpRunning: false,
          cycleDuration: 5
        });
      }, 300);
    } catch (error) {
      console.error('Failed to save calibration:', error);
      showError('Failed to save calibration data');
    }
  }, [calibrationState, pumpDevices, api, characterControls, showError]);

  // Handle Save Manual Calibration
  const handleSaveManualCalibration = useCallback(async () => {
    const pump = pumpDevices.find(p => p.id === calibrationState.selectedPumpId);
    if (!pump) {
      showError('Please select a pump first');
      return;
    }

    const seconds = parseFloat(manualCalibrationData.secondsTo100);
    if (!seconds || seconds <= 0) {
      showError('Please enter a valid number of seconds');
      return;
    }

    try {
      await api.updateDevice(pump.id, {
        calibrationTime: seconds,
        calibrationCapacity: 100,
        calibrationPainAtMax: manualCalibrationData.painLevelAt100,
        calibratedAt: new Date().toISOString()
      });

      const updatedControls = { ...characterControls, hasCalibrated: true };
      await api.updateSettings({ globalCharacterControls: updatedControls });
      setCharacterControls(updatedControls);

      setShowManualCalibrationModal(false);
      setManualCalibrationData({ secondsTo100: '', painLevelAt100: 0 });

      // Reset calibration state
      setCalibrationState({
        selectedPumpId: null,
        currentTime: 0,
        capacity: 0,
        painLevel: 0,
        phase: 'setup',
        isPumpRunning: false,
        cycleDuration: 5
      });

      // Close calibration modal with animation
      setIsClosingModal(true);
      setTimeout(() => {
        setShowCalibrationModal(false);
        setIsClosingModal(false);
      }, 300);
    } catch (error) {
      console.error('Failed to save manual calibration:', error);
      showError('Failed to save manual calibration data');
    }
  }, [calibrationState.selectedPumpId, manualCalibrationData, pumpDevices, api, characterControls, showError]);

  // Handle Recalibrate - clears calibration data for selected pump
  const handleRecalibrate = useCallback(async () => {
    const pump = pumpDevices.find(p => p.id === calibrationState.selectedPumpId);
    if (!pump) return;

    try {
      await api.updateDevice(pump.id, {
        calibrationTime: 0,
        calibrationCapacity: 0,
        calibrationPainAtMax: 0,
        calibratedAt: null
      });

      setCalibrationState(prev => ({
        ...prev,
        currentTime: 0,
        capacity: 0,
        painLevel: 0,
        phase: 'setup'
      }));
    } catch (error) {
      console.error('Failed to recalibrate:', error);
      showError('Failed to clear calibration data');
    }
  }, [calibrationState.selectedPumpId, pumpDevices, api, showError]);

  // Close modal handler with animation
  const handleCloseCalibrationModal = useCallback(async () => {
    // Invalidate any running timer cycles
    cycleIdRef.current += 1;
    if (pumpTimerRef.current) {
      clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }

    // Stop pump if running
    if (calibrationState.isPumpRunning) {
      await stopPump(false);
    }

    setIsClosingModal(true);
    setTimeout(() => {
      setShowCalibrationModal(false);
      setIsClosingModal(false);
    }, 300);
  }, [calibrationState.isPumpRunning, stopPump]);

  // Force pump off - emergency stop that directly sends off command
  const handleForcePumpOff = useCallback(async () => {
    console.log('[Calibration] FORCE PUMP OFF triggered');

    // Clear any running timer first
    if (pumpTimerRef.current) {
      clearInterval(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }

    // Try to stop the selected pump
    const currentPumpId = selectedPumpIdRef.current;
    const pump = pumpDevices.find(p => p.id === currentPumpId);

    if (pump) {
      try {
        console.log('[Calibration] Force stopping pump:', pump.label || pump.name);
        await api.deviceOff(getDeviceIdentifier(pump), {
          childId: pump.childId,
          brand: pump.brand
        });
        console.log('[Calibration] Force stop successful');
      } catch (error) {
        console.error('[Calibration] Force stop failed:', error);
        showError('Failed to force stop pump - check device manually!');
      }
    } else {
      // No selected pump, try to stop ALL pump devices as safety measure
      console.log('[Calibration] No pump selected, stopping all pumps');
      for (const p of pumpDevices) {
        try {
          await api.deviceOff(getDeviceIdentifier(p), {
            childId: p.childId,
            brand: p.brand
          });
          console.log('[Calibration] Stopped pump:', p.label || p.name);
        } catch (error) {
          console.error('[Calibration] Failed to stop pump:', p.label || p.name, error);
        }
      }
    }

    // Update state
    setCalibrationState(prev => ({
      ...prev,
      isPumpRunning: false,
      phase: prev.phase === 'running' ? 'stopped' : prev.phase
    }));
  }, [pumpDevices, api, showError]);

  // Resume calibration popup handlers
  const handleOpenResumePopup = useCallback(() => {
    // Reset resume data when opening, pre-select current pump if any
    setResumeData({
      pumpId: calibrationState.selectedPumpId || (pumpDevices[0]?.id || null),
      time: 0,
      capacity: 0,
      painLevel: 0,
      cycleDuration: 5
    });
    setShowResumePopup(true);
  }, [calibrationState.selectedPumpId, pumpDevices]);

  const handleCloseResumePopup = useCallback(() => {
    setShowResumePopup(false);
  }, []);

  const handleApplyResumeData = useCallback(() => {
    if (!resumeData.pumpId) return;

    // Update refs for selected pump and cycle duration
    selectedPumpIdRef.current = resumeData.pumpId;
    cycleDurationRef.current = resumeData.cycleDuration;

    // Apply the resume data to calibration state and switch to 'paused' phase
    // This makes the button show "Continue" instead of "Begin"
    setCalibrationState(prev => ({
      ...prev,
      selectedPumpId: resumeData.pumpId,
      currentTime: resumeData.time,
      capacity: resumeData.capacity,
      painLevel: resumeData.painLevel,
      cycleDuration: resumeData.cycleDuration,
      phase: 'paused' // This makes the button say "Continue"
    }));
    setShowResumePopup(false);
  }, [resumeData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pumpTimerRef.current) {
        clearTimeout(pumpTimerRef.current);
      }
      // Invalidate any running cycles
      cycleIdRef.current += 1;
    };
  }, []);

  // Handle calibrate request from DeviceTab navigation (via sessionStorage)
  useEffect(() => {
    const calibrateDeviceId = sessionStorage.getItem('calibrate-device-id');
    if (calibrateDeviceId) {
      // Clear immediately to prevent re-triggering
      sessionStorage.removeItem('calibrate-device-id');
      // Find the device and load its existing calibration data
      const device = pumpDevices.find(d => d.id === calibrateDeviceId) || pumpDevices[0];
      if (device) {
        const hasCalibration = device.calibrationTime > 0;
        setCalibrationState(prev => ({
          ...prev,
          selectedPumpId: device.id,
          currentTime: device.calibrationTime || 0,
          capacity: hasCalibration ? 100 : 0, // If calibrated, start at 100% (full)
          painLevel: device.calibrationPainAtMax || 0,
          phase: hasCalibration ? 'paused' : 'setup' // Allow continuing if already calibrated
        }));
      }
      setShowCalibrationModal(true);
    }
  }, [pumpDevices]);

  // Check for capacity reaching 100%
  useEffect(() => {
    if (calibrationState.capacity >= 100 && calibrationState.phase === 'paused') {
      setCalibrationState(prev => ({ ...prev, phase: 'complete' }));
    }
  }, [calibrationState.capacity, calibrationState.phase]);

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState({
    controlMode: true,
    characterControls: false,
    authorNote: false,
    reminders: false,
    flows: false,
    remote: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Load global prompt from settings or restore draft
  useEffect(() => {
    const savedDraft = sessionStorage.getItem('global-prompt-draft');
    if (savedDraft && !draftInitialized.current) {
      setGlobalPrompt(savedDraft);
      setHasDraft(true);
      draftInitialized.current = true;
    } else if (settings?.globalPrompt !== undefined && !draftInitialized.current) {
      setGlobalPrompt(settings.globalPrompt);
      draftInitialized.current = true;
    }
  }, [settings?.globalPrompt]);

  // Auto-save global prompt draft
  useEffect(() => {
    if (!draftInitialized.current) return;
    const timeoutId = setTimeout(() => {
      sessionStorage.setItem('global-prompt-draft', globalPrompt);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [globalPrompt]);

  // Load global reminders from settings
  useEffect(() => {
    if (settings?.globalReminders) {
      setGlobalReminders(settings.globalReminders);
    }
  }, [settings?.globalReminders]);

  // Load character controls from settings
  useEffect(() => {
    if (settings?.globalCharacterControls) {
      setCharacterControls(settings.globalCharacterControls);
    }
  }, [settings?.globalCharacterControls]);

  // Load remote settings
  useEffect(() => {
    const loadRemoteSettings = async () => {
      try {
        const data = await api.getRemoteSettings();
        setRemoteSettings(data);
      } catch (error) {
        console.error('Failed to load remote settings:', error);
      }
      setIsLoadingRemote(false);
    };
    loadRemoteSettings();
  }, [api]);

  // Remote settings handlers
  const handleToggleAllowRemote = async (enabled) => {
    try {
      const data = await api.updateRemoteSettings({ allowRemote: enabled });
      setRemoteSettings(data);
    } catch (error) {
      showError(error.message || 'Failed to update remote settings');
    }
  };

  const handleAddIp = async () => {
    const ip = newIp.trim();
    if (!ip) return;

    // Basic IPv4 validation
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) {
      showError('Invalid IPv4 address format');
      return;
    }

    try {
      const data = await api.addWhitelistedIp(ip);
      setRemoteSettings(data);
      setNewIp('');
    } catch (error) {
      showError(error.message || 'Failed to add IP');
    }
  };

  const handleRemoveIp = async (ip) => {
    try {
      const data = await api.removeWhitelistedIp(ip);
      setRemoteSettings(data);
    } catch (error) {
      showError(error.message || 'Failed to remove IP');
    }
  };

  const handleSaveGlobalPrompt = async () => {
    setIsSaving(true);
    try {
      await api.updateSettings({ globalPrompt });
      // Clear draft on successful save
      sessionStorage.removeItem('global-prompt-draft');
      setHasDraft(false);
    } catch (error) {
      console.error('Failed to save global prompt:', error);
    }
    setIsSaving(false);
  };

  // Character Controls handlers
  const handleCharacterControlChange = async (key, value) => {
    const updated = { ...characterControls, [key]: value };
    setCharacterControls(updated);
    try {
      await api.updateSettings({ globalCharacterControls: updated });
    } catch (error) {
      console.error('Failed to save character controls:', error);
    }
  };

  // Global Reminders handlers
  const handleToggleReminder = (id, enabled) => {
    const updated = globalReminders.map(r =>
      r.id === id ? { ...r, enabled } : r
    );
    setGlobalReminders(updated);
    // Auto-save on toggle
    saveReminders(updated);
  };

  const handleEditReminder = (reminder) => {
    setEditingReminder(reminder);
    setReminderForm({
      name: reminder.name,
      text: reminder.text,
      constant: reminder.constant !== undefined ? reminder.constant : true,
      keys: reminder.keys || [],
      caseSensitive: reminder.caseSensitive || false,
      priority: reminder.priority !== undefined ? reminder.priority : 100,
      scanDepth: reminder.scanDepth !== undefined ? reminder.scanDepth : 10
    });
  };

  const handleDeleteReminder = (id) => {
    const updated = globalReminders.filter(r => r.id !== id);
    setGlobalReminders(updated);
    saveReminders(updated);
  };

  const handleAddKey = () => {
    if (!keyInput.trim()) return;
    if (!reminderForm.keys.includes(keyInput.trim())) {
      setReminderForm(prev => ({ ...prev, keys: [...prev.keys, keyInput.trim()] }));
    }
    setKeyInput('');
  };

  const handleRemoveKey = (key) => {
    setReminderForm(prev => ({ ...prev, keys: prev.keys.filter(k => k !== key) }));
  };

  const handleSaveReminder = () => {
    if (!reminderForm.name.trim() || !reminderForm.text.trim()) return;

    let updated;
    if (editingReminder) {
      // Update existing
      updated = globalReminders.map(r =>
        r.id === editingReminder.id
          ? {
              ...r,
              name: reminderForm.name,
              text: reminderForm.text,
              constant: reminderForm.constant,
              keys: reminderForm.keys,
              caseSensitive: reminderForm.caseSensitive,
              priority: reminderForm.priority,
              scanDepth: reminderForm.scanDepth
            }
          : r
      );
    } else {
      // Add new
      const newReminder = {
        id: `global-reminder-${Date.now()}`,
        name: reminderForm.name,
        text: reminderForm.text,
        enabled: true,
        constant: reminderForm.constant,
        keys: reminderForm.keys,
        caseSensitive: reminderForm.caseSensitive,
        priority: reminderForm.priority,
        scanDepth: reminderForm.scanDepth
      };
      updated = [...globalReminders, newReminder];
    }

    setGlobalReminders(updated);
    setReminderForm({ name: '', text: '', constant: true, keys: [], caseSensitive: false, priority: 100, scanDepth: 10 });
    setEditingReminder(null);
    saveReminders(updated);
  };

  const handleCancelEdit = () => {
    setEditingReminder(null);
    setReminderForm({ name: '', text: '', constant: true, keys: [], caseSensitive: false, priority: 100, scanDepth: 10 });
  };

  const saveReminders = async (reminders) => {
    setIsSavingReminders(true);
    try {
      await api.updateSettings({ globalReminders: reminders });
    } catch (error) {
      console.error('Failed to save global reminders:', error);
    }
    setIsSavingReminders(false);
  };

  // Lorebook import handlers for global reminders
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

      // Convert entries to Global Reminders format
      const newReminders = entries
        .filter(entry => entry.enabled !== false && entry.disable !== true)
        .map(entry => ({
          id: `reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entry.name || entry.comment || 'Lorebook Entry',
          text: entry.content || entry.value || '',
          enabled: true
        }));

      if (newReminders.length === 0) {
        throw new Error('No valid lorebook entries found in file.');
      }

      // Add to existing global reminders
      const updatedReminders = [...globalReminders, ...newReminders];
      setGlobalReminders(updatedReminders);

      // Save to backend
      setIsSavingReminders(true);
      try {
        await api.updateSettings({ globalReminders: updatedReminders });
        alert(`Successfully imported ${newReminders.length} lorebook entries as Global Reminders.`);
      } catch (error) {
        console.error('Failed to save imported reminders:', error);
        showError?.('Failed to save imported reminders');
      }
      setIsSavingReminders(false);
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

  const getGlobalFlows = () => {
    return sessionState.flowAssignments?.global || [];
  };

  const handleSaveFlows = (flowIds) => {
    sendWsMessage('update_global_flows', {
      flows: flowIds
    });
  };

  const handleRemoveGlobalFlow = (flowId) => {
    const currentFlows = getGlobalFlows();
    const updatedFlows = currentFlows.filter(id => id !== flowId);
    sendWsMessage('update_global_flows', {
      flows: updatedFlows
    });
  };

  return (
    <div className="settings-tab">
      <h2 className="settings-title">Cross Character Persistence</h2>

      {/* Control Mode Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('controlMode')}>
          <span>Control Mode</span>
          <span className="collapse-icon">{expandedSections.controlMode ? '▼' : '▶'}</span>
        </div>
        {expandedSections.controlMode && (
        <div className="settings-section-content">
          <p className="section-description">
            Choose how device commands are executed. Interactive mode sends real commands to devices.
            Simulated mode logs actions without executing them (for testing).
          </p>
          <div className="form-group">
            <label>
              Mode
              {simulationRequired && (
                <span className="mode-locked-indicator" title={simulationReason}> (Locked)</span>
              )}
            </label>
            <select
              value={controlMode}
              onChange={(e) => setControlMode(e.target.value)}
              disabled={simulationRequired}
              title={simulationRequired ? `Locked: ${simulationReason}` : ''}
              className={simulationRequired ? 'locked' : ''}
            >
              <option value="interactive">Interactive</option>
              <option value="simulated">Simulated</option>
            </select>
          </div>
        </div>
        )}
      </div>

      {/* Global Character Controls Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('characterControls')}>
          <span>Global Character Controls</span>
          <span className="collapse-icon">{expandedSections.characterControls ? '▼' : '▶'}</span>
        </div>
        {expandedSections.characterControls && (
        <div className="settings-section-content">
          <p className="section-description">
            Automatic adjustments to character state based on capacity changes.
          </p>

          <div className="character-control-row with-button">
            <label className={`toggle-switch ${!characterControls.hasCalibrated ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={characterControls.useAutoCapacity}
                onChange={(e) => handleCharacterControlChange('useAutoCapacity', e.target.checked)}
                disabled={!characterControls.hasCalibrated}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="control-label-group">
              <span className="toggle-label">Use Auto-Capacity</span>
              <span className="control-hint">
                {characterControls.hasCalibrated
                  ? 'Use pre-calibrated capacity settings.'
                  : 'Use pre-calibrated capacity settings. Please enter Calibration Setup to use this feature.'}
              </span>
            </div>
            <button
              className="btn btn-secondary btn-calibrate"
              onClick={() => setShowCalibrationModal(true)}
            >
              Calibrate
            </button>
          </div>

          <div className={`character-control-row ${characterControls.useAutoCapacity ? 'disabled-by-auto' : ''}`}>
            <label className={`toggle-switch ${characterControls.useAutoCapacity ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={characterControls.autoLinkCapacityToPain}
                onChange={(e) => handleCharacterControlChange('autoLinkCapacityToPain', e.target.checked)}
                disabled={characterControls.useAutoCapacity}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="control-label-group">
              <span className="toggle-label">Auto-Link Capacity to Pain Scale</span>
              <span className="control-hint">Pain 0-10 scales evenly with capacity 0-100%</span>
            </div>
          </div>

          <div className={`character-control-row ${characterControls.useAutoCapacity ? 'disabled-by-auto' : ''}`}>
            <label className={`toggle-switch ${characterControls.useAutoCapacity ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={characterControls.emotionalDecline}
                onChange={(e) => handleCharacterControlChange('emotionalDecline', e.target.checked)}
                disabled={characterControls.useAutoCapacity}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="control-label-group">
              <span className="toggle-label">Emotional Decline</span>
              <span className="control-hint">Emotion degrades as capacity increases (slow 0-40%, faster 41-60%, rapid 61-80%, locked at Frightened by 75%)</span>
            </div>
          </div>

          <div className="character-control-row">
            <label className="control-inline-label">Capacity Multiplier:</label>
            <input
              type="range"
              min="0.25"
              max="3"
              step="0.25"
              value={characterControls.autoCapacityMultiplier}
              onChange={(e) => handleCharacterControlChange('autoCapacityMultiplier', parseFloat(e.target.value))}
              className="multiplier-slider"
            />
            <span className="multiplier-value">{characterControls.autoCapacityMultiplier}x</span>
            <span className="control-inline-hint">Speed of capacity tracking (1x = calibrated rate)</span>
          </div>

          <hr className="control-divider" />

          <div className="character-control-row">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={characterControls.allowLlmDeviceControl}
                onChange={(e) => handleCharacterControlChange('allowLlmDeviceControl', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="control-label-group">
              <span className="toggle-label">Allow LLM Direct Control of Devices</span>
              <span className="control-hint">The AI can turn devices on/off by including [pump on], [vibe on], etc. in its responses</span>
            </div>
          </div>

          {characterControls.allowLlmDeviceControl && (
            <>
              <div className="character-control-row sub-control">
                <label className="control-inline-label">Max On Duration:</label>
                <input
                  type="number"
                  min="5"
                  max="300"
                  step="5"
                  value={characterControls.llmDeviceControlMaxSeconds}
                  onChange={(e) => handleCharacterControlChange('llmDeviceControlMaxSeconds', parseInt(e.target.value) || 30)}
                  className="control-number-input"
                />
                <span className="control-inline-hint">seconds (AI will be told to turn off after this time)</span>
              </div>
              <div className="character-control-row sub-control">
                <label className="control-inline-label">Pulse Duration:</label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  step="1"
                  value={characterControls.llmDeviceControlPulseDuration}
                  onChange={(e) => handleCharacterControlChange('llmDeviceControlPulseDuration', parseInt(e.target.value) || 3)}
                  className="control-number-input"
                />
                <span className="control-inline-hint">seconds (for rhythmic/pulsing pump phrases)</span>
              </div>
            </>
          )}

          <div className="character-control-row">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={characterControls.allowOverInflation}
                onChange={(e) => handleCharacterControlChange('allowOverInflation', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="control-label-group">
              <span className="toggle-label">Allow Over-Inflation</span>
              <span className="control-hint">When OFF, pumps auto-stop at 100% capacity and cannot be reactivated until capacity drops</span>
            </div>
          </div>

          <div className="character-control-row">
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={characterControls.enableAutoPopRoleplay}
                onChange={(e) => handleCharacterControlChange('enableAutoPopRoleplay', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
            <div className="control-label-group">
              <span className="toggle-label">Enable Auto-Pop Roleplay</span>
              {!characterControls.allowOverInflation ? (
                <span className="control-hint">Display POP portrait at 100% capacity</span>
              ) : (
                <div className="control-hint auto-pop-options">
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="autoPopMode"
                      checked={characterControls.autoPopMode === 'fixed'}
                      onChange={() => handleCharacterControlChange('autoPopMode', 'fixed')}
                      disabled={!characterControls.enableAutoPopRoleplay}
                    />
                    <span>Display POP portrait at</span>
                    <input
                      type="number"
                      min="100"
                      max="999"
                      value={characterControls.autoPopFixedPercent}
                      onChange={(e) => handleCharacterControlChange('autoPopFixedPercent', parseInt(e.target.value) || 100)}
                      disabled={!characterControls.enableAutoPopRoleplay || characterControls.autoPopMode !== 'fixed'}
                      className="auto-pop-input"
                    />
                    <span>%</span>
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="autoPopMode"
                      checked={characterControls.autoPopMode === 'random'}
                      onChange={() => handleCharacterControlChange('autoPopMode', 'random')}
                      disabled={!characterControls.enableAutoPopRoleplay}
                    />
                    <span>Random between</span>
                    <input
                      type="number"
                      min="100"
                      max="999"
                      value={characterControls.autoPopRandomMin}
                      onChange={(e) => handleCharacterControlChange('autoPopRandomMin', parseInt(e.target.value) || 100)}
                      disabled={!characterControls.enableAutoPopRoleplay || characterControls.autoPopMode !== 'random'}
                      className="auto-pop-input"
                    />
                    <span>% and</span>
                    <input
                      type="number"
                      min="100"
                      max="999"
                      value={characterControls.autoPopRandomMax}
                      onChange={(e) => handleCharacterControlChange('autoPopRandomMax', parseInt(e.target.value) || 150)}
                      disabled={!characterControls.enableAutoPopRoleplay || characterControls.autoPopMode !== 'random'}
                      className="auto-pop-input"
                    />
                    <span>%</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Global Prompt / Author Note Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('authorNote')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
            <span>Author Note / System Instructions</span>
            {hasDraft && (
              <span className="draft-indicator" title="Unsaved changes restored from previous session">
                Draft
              </span>
            )}
          </div>
          <span className="collapse-icon">{expandedSections.authorNote ? '▼' : '▶'}</span>
        </div>
        {expandedSections.authorNote && (
        <div className="settings-section-content">
          <p className="section-description">
            This text is injected into every AI prompt at a high priority position. Use it for persistent instructions,
            writing style guidance, or scenario rules that should always be followed.
          </p>

          <div className="form-group">
            <textarea
              className="global-prompt-textarea"
              value={globalPrompt}
              onChange={(e) => setGlobalPrompt(e.target.value)}
              placeholder="Enter global system instructions here...&#10;&#10;Example:&#10;- Always write in third person&#10;- Include sensory descriptions&#10;- Keep responses under 500 words"
              rows={8}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={handleSaveGlobalPrompt}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Global Prompt'}
          </button>
        </div>
        )}
      </div>

      {/* Global Reminders Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('reminders')}>
          <span>Global Reminders</span>
          <span className="collapse-icon">{expandedSections.reminders ? '▼' : '▶'}</span>
        </div>
        {expandedSections.reminders && (
        <div className="settings-section-content">
          <p className="section-description">
            These reminders apply to all characters and are included in every prompt.
            Names are automatically prefixed with "Global-" in the UI.
          </p>

          <div style={{ marginBottom: '1rem' }}>
            <input
              type="file"
              ref={lorebookFileInputRef}
              onChange={handleLorebookImport}
              accept=".json"
              style={{ display: 'none' }}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleLorebookImportClick}
              disabled={importingLorebook}
              title="Import lorebook entries as global reminders"
            >
              {importingLorebook ? 'Importing...' : '📚 Import Lorebook'}
            </button>
          </div>

          <div className="reminders-list">
            {globalReminders.length === 0 ? (
              <p className="empty-message">No global reminders yet. Add one below.</p>
            ) : (
              globalReminders.map(reminder => (
                <div key={reminder.id} className={`reminder-item ${reminder.enabled === false ? 'disabled' : ''}`}>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={reminder.enabled !== false}
                      onChange={(e) => handleToggleReminder(reminder.id, e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="reminder-name">Global-{reminder.name}</span>
                  <div className="reminder-actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => handleEditReminder(reminder)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDeleteReminder(reminder.id)}>Del</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="reminder-form">
            <div className="form-group">
              <label>Reminder Name</label>
              <div className="input-with-prefix">
                <span className="input-prefix">Global-</span>
                <input
                  type="text"
                  value={reminderForm.name}
                  onChange={(e) => setReminderForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Safety, Tone, Boundaries"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Reminder Text</label>
              <textarea
                value={reminderForm.text}
                onChange={(e) => setReminderForm(prev => ({ ...prev, text: e.target.value }))}
                placeholder="Text to include in prompts when active..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="checkbox-title">
                <input
                  type="checkbox"
                  checked={reminderForm.constant}
                  onChange={(e) => setReminderForm(prev => ({ ...prev, constant: e.target.checked }))}
                />
                <span>Always Active (ignore keywords)</span>
              </label>
              <p className="checkbox-hint">When unchecked, only activates when keywords are found in recent messages</p>
            </div>

            {!reminderForm.constant && (
              <>
                <div className="form-group">
                  <label>Activation Keywords</label>
                  <div className="keyword-input-row">
                    <input
                      type="text"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddKey())}
                      placeholder="Enter keyword and press Enter"
                    />
                    <button type="button" className="btn btn-sm btn-secondary" onClick={handleAddKey}>Add</button>
                  </div>
                  {reminderForm.keys.length > 0 && (
                    <div className="keywords-list">
                      {reminderForm.keys.map((key, idx) => (
                        <span key={idx} className="keyword-tag">
                          {key}
                          <button type="button" onClick={() => handleRemoveKey(key)}>&times;</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="checkbox-hint">Reminder activates when ANY keyword is found</p>
                </div>

                <div className="form-group">
                  <label>Scan Depth (messages to check)</label>
                  <input
                    type="number"
                    value={reminderForm.scanDepth}
                    onChange={(e) => setReminderForm(prev => ({ ...prev, scanDepth: parseInt(e.target.value, 10) || 0 }))}
                    min="0"
                    max="100"
                    style={{ width: '100px' }}
                  />
                  <p className="checkbox-hint">0 = scan all messages, 10 = scan last 10 messages</p>
                </div>

                <div className="form-group">
                  <label className="checkbox-title">
                    <input
                      type="checkbox"
                      checked={reminderForm.caseSensitive}
                      onChange={(e) => setReminderForm(prev => ({ ...prev, caseSensitive: e.target.checked }))}
                    />
                    <span>Case-Sensitive Matching</span>
                  </label>
                </div>
              </>
            )}

            <div className="form-group">
              <label>Priority (higher = injected first)</label>
              <input
                type="number"
                value={reminderForm.priority}
                onChange={(e) => setReminderForm(prev => ({ ...prev, priority: parseInt(e.target.value, 10) || 100 }))}
                min="0"
                max="1000"
                style={{ width: '100px' }}
              />
              <p className="checkbox-hint">Default: 100. Higher priority reminders appear first in prompt.</p>
            </div>

            <div className="reminder-form-actions">
              {editingReminder && (
                <button className="btn btn-secondary" onClick={handleCancelEdit}>Cancel</button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSaveReminder}
                disabled={!reminderForm.name.trim() || !reminderForm.text.trim() || isSavingReminders}
              >
                {isSavingReminders ? 'Saving...' : editingReminder ? 'Update Reminder' : 'Add Reminder'}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Global Flows Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('flows')}>
          <span>Global Flows</span>
          <span className="collapse-icon">{expandedSections.flows ? '▼' : '▶'}</span>
        </div>
        {expandedSections.flows && (
        <div className="settings-section-content">
          <p className="section-description">
            These flows are active regardless of the current character or persona.
            They are bound to this chat session and will be saved/loaded with it.
          </p>

          <div className="global-flows-assignment">
            <div className="flow-assignment-header">
              <span className="flow-line-label">Active Flows:</span>
              <button
                className="btn btn-primary"
                onClick={() => setShowFlowModal(true)}
              >
                Add Flows
              </button>
            </div>
            <div className="association-badges">
              {getGlobalFlows().length === 0 ? (
                <span className="empty-hint">No flows assigned</span>
              ) : (
                getGlobalFlows().map(flowId => {
                  const flow = flows.find(f => f.id === flowId);
                  return flow ? (
                    <span key={flowId} className="assoc-badge">
                      {flow.name}
                      <button type="button" className="badge-remove" onClick={() => handleRemoveGlobalFlow(flowId)}>−</button>
                    </span>
                  ) : null;
                })
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Remote Connections Section */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('remote')}>
          <span>Remote Connections</span>
          <span className="collapse-icon">{expandedSections.remote ? '▼' : '▶'}</span>
        </div>
        {expandedSections.remote && (
        <div className="settings-section-content">
          <p className="section-description">
            Control access to this SwellDreams instance from other devices on your network or via Tailscale.
            {!remoteSettings.isLocalRequest && (
              <strong className="remote-warning"> You are viewing from a remote device - settings cannot be modified.</strong>
            )}
          </p>

          {isLoadingRemote ? (
            <p>Loading remote settings...</p>
          ) : (
            <>
              <div className="remote-toggle-row">
                <label className={`toggle-switch ${!remoteSettings.isLocalRequest ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={remoteSettings.allowRemote}
                    onChange={(e) => handleToggleAllowRemote(e.target.checked)}
                    disabled={!remoteSettings.isLocalRequest}
                  />
                  <span className="toggle-slider"></span>
                </label>
                <span className="toggle-label">Allow Remote Connections</span>
              </div>

              {remoteSettings.allowRemote && (
                <div className="ip-whitelist-section">
                  <h4>IP Whitelist</h4>
                  <p className="section-hint">
                    Only whitelisted IPs can access this instance remotely. Add your Tailscale or local network IPs.
                  </p>

                  {remoteSettings.isLocalRequest && (
                    <div className="add-ip-form">
                      <input
                        type="text"
                        value={newIp}
                        onChange={(e) => setNewIp(e.target.value)}
                        placeholder="e.g., 100.64.0.1"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddIp()}
                      />
                      <button className="btn btn-primary" onClick={handleAddIp}>
                        Add IP
                      </button>
                    </div>
                  )}

                  <div className="ip-whitelist">
                    {remoteSettings.whitelistedIps.length === 0 ? (
                      <p className="empty-message">No IPs whitelisted. Remote access is effectively disabled.</p>
                    ) : (
                      remoteSettings.whitelistedIps.map((ip) => (
                        <div key={ip} className="ip-item">
                          <span className="ip-address">{ip}</span>
                          {remoteSettings.isLocalRequest && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleRemoveIp(ip)}
                              title="Remove IP"
                            >
                              Del
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </div>

      <FlowAssignmentModal
        isOpen={showFlowModal}
        onClose={() => setShowFlowModal(false)}
        onSave={handleSaveFlows}
        flows={flows}
        assignedFlowIds={getGlobalFlows()}
        category="global"
        title="Assign Global Flows"
      />

      {/* Calibration Modal - slides from top */}
      {showCalibrationModal && (
        <div className="calibration-modal-overlay" onClick={handleCloseCalibrationModal}>
          <div className={`calibration-modal ${isClosingModal ? 'slide-up' : 'slide-down'}`} onClick={e => e.stopPropagation()}>
            <div className="calibration-modal-header">
              <h2>Pressure Limits - Calibrate Capacity for Automatic Inflation Staging</h2>
              <button className="modal-close" onClick={handleCloseCalibrationModal}>&times;</button>
            </div>
            <div className="calibration-modal-body">
              {/* Julie Portrait and Dynamic Message */}
              <div className="calibration-intro">
                <div className="calibration-portrait-frame">
                  <span className="calibration-portrait-name">Julie</span>
                  {julieCharacter?.avatar ? (
                    <img
                      src={julieCharacter.avatar}
                      alt="Julie"
                      className="calibration-portrait"
                    />
                  ) : (
                    <div className="calibration-portrait calibration-portrait-placeholder">
                      <span>?</span>
                    </div>
                  )}
                </div>
                <div className="calibration-intro-text">
                  <p>
                    <strong>{getJulieMessage()}</strong>
                  </p>
                  {calibrationState.phase === 'setup' && pumpDevices.length > 0 && (
                    <button
                      className="btn btn-secondary btn-resume-calibration"
                      onClick={handleOpenResumePopup}
                    >
                      Resume Calibration
                    </button>
                  )}
                </div>
              </div>

              <hr className="calibration-divider" />

              {calibrationState.phase === 'setup' && (
                <p className="calibration-note">
                  Calibration is done on a per-pump basis. Each pump may have different pressure
                  characteristics that affect how quickly you reach capacity.
                </p>
              )}

              {/* No Pumps Warning */}
              {pumpDevices.length === 0 ? (
                <div className="calibration-no-pumps">
                  <p className="no-pumps-warning">
                    No pump devices configured. You need at least one pump to calibrate capacity limits.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={handleConfigureDevices}
                  >
                    Configure Devices
                  </button>
                </div>
              ) : (
                <>
                  {/* Pump Selection Row with Status and Time */}
                  <div className="calibration-pump-row">
                    <label>Select Pump:</label>
                    <select
                      value={calibrationState.selectedPumpId || ''}
                      onChange={(e) => handlePumpSelect(e.target.value)}
                      className="calibration-pump-dropdown"
                      disabled={calibrationState.phase !== 'setup'}
                    >
                      <option value="">-- Choose a pump --</option>
                      {pumpDevices.map(pump => (
                        <option key={pump.id} value={pump.id}>
                          {pump.label || pump.name}{pump.name && pump.label && pump.name !== pump.label ? ` (${pump.name})` : ''} {pump.isPrimaryPump ? '★' : ''}
                        </option>
                      ))}
                    </select>
                    {calibrationState.selectedPumpId && (
                      <>
                        <span className={`calibration-pump-status ${
                          pumpDevices.find(p => p.id === calibrationState.selectedPumpId)?.calibrationTime
                            ? 'calibrated' : 'uncalibrated'
                        }`}>
                          Status: {
                            pumpDevices.find(p => p.id === calibrationState.selectedPumpId)?.calibrationTime
                              ? 'Calibrated'
                              : 'Uncalibrated'
                          }
                        </span>
                        <span className="calibration-time">
                          Time: {calibrationState.currentTime} secs
                        </span>
                      </>
                    )}
                  </div>

                  {/* Cycle Duration Row */}
                  <div className="calibration-pump-row">
                    <label>Cycle Duration:</label>
                    <select
                      value={calibrationState.cycleDuration}
                      onChange={(e) => {
                        const val = e.target.value === 'continuous' ? 'continuous' : parseInt(e.target.value);
                        setCalibrationState(prev => ({ ...prev, cycleDuration: val }));
                      }}
                      className="calibration-cycle-dropdown"
                      disabled={calibrationState.phase !== 'setup'}
                    >
                      <option value={5}>5 seconds</option>
                      <option value={10}>10 seconds</option>
                      <option value={15}>15 seconds</option>
                      <option value={20}>20 seconds</option>
                      <option value={25}>25 seconds</option>
                      <option value={30}>30 seconds</option>
                      <option value="continuous">Continuous</option>
                    </select>
                    {calibrationState.cycleDuration === 'continuous' && calibrationState.phase !== 'setup' && (
                      <span className="calibration-continuous-hint">
                        Press Pause to stop the pump
                      </span>
                    )}
                  </div>

                  {/* Calibration Sliders */}
                  <div className="calibration-sliders">
                    <div className="calibration-slider-group">
                      <div className="calibration-slider-label">
                        <span>Capacity:</span>
                        <span className="calibration-slider-value">{calibrationState.capacity}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={calibrationState.capacity}
                        onChange={(e) => setCalibrationState(prev => ({
                          ...prev,
                          capacity: parseInt(e.target.value)
                        }))}
                        className="calibration-slider"
                        disabled={!calibrationState.selectedPumpId || calibrationState.phase === 'running'}
                      />
                    </div>

                    <div className="calibration-slider-group">
                      <div className="calibration-slider-label">
                        <span>Pain Level: <span className="pain-scale-description">(No Pain ← → Agonizing)</span></span>
                        <span className="calibration-slider-value">{calibrationState.painLevel}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="1"
                        value={calibrationState.painLevel}
                        onChange={(e) => setCalibrationState(prev => ({
                          ...prev,
                          painLevel: parseInt(e.target.value)
                        }))}
                        className="calibration-slider"
                        disabled={!calibrationState.selectedPumpId || calibrationState.phase === 'running'}
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="calibration-actions">
                    {calibrationState.phase === 'complete' ? (
                      <button
                        className="btn btn-success btn-calibration-finish"
                        onClick={handleFinishCalibration}
                      >
                        Finish!
                      </button>
                    ) : calibrationState.phase === 'running' ? (
                      <button
                        className={`btn ${calibrationState.cycleDuration === 'continuous' ? 'btn-warning' : 'btn-danger'} btn-calibration-stop`}
                        onClick={handleStopCalibration}
                      >
                        {calibrationState.cycleDuration === 'continuous' ? 'Pause' : 'Stop'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-calibration-action"
                        onClick={handleCalibrationAction}
                        disabled={!calibrationState.selectedPumpId}
                      >
                        {calibrationState.phase === 'setup' ? 'Begin' : (calibrationState.cycleDuration === 'continuous' ? 'Resume' : 'Continue')}
                      </button>
                    )}
                    {calibrationState.selectedPumpId && (calibrationState.phase === 'setup' || calibrationState.phase === 'paused') && (
                      <button
                        className="btn btn-secondary btn-calibration-manual"
                        onClick={() => {
                          const pump = pumpDevices.find(p => p.id === calibrationState.selectedPumpId);
                          setManualCalibrationData({
                            secondsTo100: pump?.calibrationTime || '',
                            painLevelAt100: pump?.calibrationPainAtMax || 0
                          });
                          setShowManualCalibrationModal(true);
                        }}
                      >
                        Manual
                      </button>
                    )}
                    {calibrationState.selectedPumpId && (() => {
                      const pump = pumpDevices.find(p => p.id === calibrationState.selectedPumpId);
                      return pump && pump.calibrationTime > 0;
                    })() && (
                      <button
                        className="btn btn-warning btn-calibration-recalibrate"
                        onClick={handleRecalibrate}
                        disabled={calibrationState.phase === 'running'}
                      >
                        Recalibrate
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-calibration-reset"
                      onClick={handleResetCalibration}
                      disabled={calibrationState.phase === 'running'}
                    >
                      Reset
                    </button>
                    <button
                      className="btn btn-warning btn-force-pump-off"
                      onClick={handleForcePumpOff}
                      title="Emergency stop - sends OFF command directly to pump"
                    >
                      Force Pump Off
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manual Calibration Modal */}
      {showManualCalibrationModal && (
        <div className="resume-popup-overlay" onClick={() => setShowManualCalibrationModal(false)}>
          <div className="resume-popup" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            <h3>Manual Calibration</h3>

            <div className="resume-field">
              <label>Seconds to 100%:</label>
              <input
                type="number"
                min="1"
                max="9999"
                value={manualCalibrationData.secondsTo100}
                onChange={(e) => setManualCalibrationData(prev => ({ ...prev, secondsTo100: e.target.value }))}
                className="resume-pump-dropdown"
                placeholder="e.g. 120"
              />
            </div>

            <div className="resume-field">
              <div className="resume-slider-label">
                <span>Pain Level at 100%:</span>
                <span>{manualCalibrationData.painLevelAt100}</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={manualCalibrationData.painLevelAt100}
                onChange={(e) => setManualCalibrationData(prev => ({ ...prev, painLevelAt100: parseInt(e.target.value) }))}
                className="calibration-slider"
              />
            </div>

            <div className="resume-popup-actions">
              <button className="btn btn-secondary" onClick={() => {
                setShowManualCalibrationModal(false);
                setManualCalibrationData({ secondsTo100: '', painLevelAt100: 0 });
              }}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveManualCalibration}
                disabled={!manualCalibrationData.secondsTo100 || parseFloat(manualCalibrationData.secondsTo100) <= 0}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Calibration Popup */}
      {showResumePopup && (
        <div className="resume-popup-overlay" onClick={handleCloseResumePopup}>
          <div className="resume-popup" onClick={e => e.stopPropagation()}>
            <h3>Enter Previous Session Data</h3>

            <div className="resume-field">
              <label>Select Pump:</label>
              <select
                value={resumeData.pumpId || ''}
                onChange={(e) => setResumeData(prev => ({ ...prev, pumpId: e.target.value }))}
                className="resume-pump-dropdown"
              >
                <option value="">-- Choose a pump --</option>
                {pumpDevices.map(pump => (
                  <option key={pump.id} value={pump.id}>
                    {pump.label || pump.name}{pump.name && pump.label && pump.name !== pump.label ? ` (${pump.name})` : ''} {pump.isPrimaryPump ? '★' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="resume-field">
              <label>Cycle Duration:</label>
              <select
                value={resumeData.cycleDuration}
                onChange={(e) => {
                  const val = e.target.value === 'continuous' ? 'continuous' : parseInt(e.target.value);
                  setResumeData(prev => ({ ...prev, cycleDuration: val }));
                }}
                className="resume-pump-dropdown"
              >
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={20}>20 seconds</option>
                <option value={25}>25 seconds</option>
                <option value={30}>30 seconds</option>
                <option value="continuous">Continuous</option>
              </select>
            </div>

            <div className="resume-field">
              <label>Time (seconds):</label>
              <div className="resume-time-control">
                <button
                  className="btn btn-secondary btn-time-adjust"
                  onClick={() => setResumeData(prev => ({ ...prev, time: Math.max(0, prev.time - 5) }))}
                  disabled={resumeData.time <= 0}
                >
                  -5
                </button>
                <span className="resume-time-value">{resumeData.time}</span>
                <button
                  className="btn btn-secondary btn-time-adjust"
                  onClick={() => setResumeData(prev => ({ ...prev, time: prev.time + 5 }))}
                >
                  +5
                </button>
              </div>
            </div>

            <div className="resume-field">
              <div className="resume-slider-label">
                <span>Capacity:</span>
                <span>{resumeData.capacity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={resumeData.capacity}
                onChange={(e) => setResumeData(prev => ({ ...prev, capacity: parseInt(e.target.value) }))}
                className="calibration-slider"
              />
            </div>

            <div className="resume-field">
              <div className="resume-slider-label">
                <span>Pain Level:</span>
                <span>{resumeData.painLevel}</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={resumeData.painLevel}
                onChange={(e) => setResumeData(prev => ({ ...prev, painLevel: parseInt(e.target.value) }))}
                className="calibration-slider"
              />
            </div>

            <div className="resume-popup-actions">
              <button className="btn btn-secondary" onClick={handleCloseResumePopup}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleApplyResumeData}
                disabled={!resumeData.pumpId}
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GlobalTab;
