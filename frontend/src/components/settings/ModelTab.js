import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import './ModelTab.css';

// Reusable Slider component — the value box is editable. You can type freely (including
// leaving it blank while mid-edit); on blur, a blank/invalid entry resolves to 0.
function Slider({ label, value, onChange, min, max, step = 0.01, defaultValue, info }) {
  // draft === null  → not editing, show the live `value`.
  // draft is a string → user is typing; show their raw text verbatim (don't coerce).
  const [draft, setDraft] = useState(null);
  const display = draft !== null ? draft : (value ?? '');

  const handleType = (raw) => {
    setDraft(raw);
    // Live-update the slider only when the text is already a complete number.
    // Partial/blank entries ('', '-', '.', '-.') are left alone so typing isn't fought.
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
    const n = parseFloat(raw);
    if (!Number.isNaN(n)) onChange(n);
  };

  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    onChange(Number.isNaN(n) ? 0 : n); // blank/invalid → 0 on click-out
    setDraft(null);
  };

  return (
    <div className="slider-container">
      <div className="slider-header">
        <span className="slider-label">
          {label}
          {info && <span className="info-icon" title={info}>?</span>}
        </span>
        <input
          type="text"
          inputMode="decimal"
          className="slider-value slider-value-input"
          value={display}
          onChange={(e) => handleType(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      </div>
      <input
        type="range"
        value={value}
        onChange={(e) => { setDraft(null); onChange(parseFloat(e.target.value)); }}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

function ModelTab() {
  const { settings, api } = useApp();
  const { showError } = useError();
  const [llmSettings, setLlmSettings] = useState(() => ({
    ...settings.llm,
    streaming: settings.llm?.streaming ?? true
  }));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lockSamplers, setLockSamplers] = useState(true);
  const [modelStatus, setModelStatus] = useState('No Models Detected');
  const [connectionStatus, setConnectionStatus] = useState('offline');

  // Connection profiles state
  const [connectionProfiles, setConnectionProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [showNewProfileInput, setShowNewProfileInput] = useState(false);

  // OpenRouter state
  const [endpointStandard, setEndpointStandard] = useState(settings.llm?.endpointStandard || 'openai');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [hasOpenRouterApiKey, setHasOpenRouterApiKey] = useState(settings.hasOpenRouterApiKey || false);
  const [openRouterApiKeyMasked, setOpenRouterApiKeyMasked] = useState(settings.openRouterApiKeyMasked || '');
  const [openRouterModels, setOpenRouterModels] = useState([]);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState(settings.llm?.openRouterModel || '');
  const [modelSortOrder, setModelSortOrder] = useState('cost-low');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [openRouterConnecting, setOpenRouterConnecting] = useState(false);
  const [openRouterError, setOpenRouterError] = useState(null);

  // AI Horde state
  const [hordeApiKey, setHordeApiKey] = useState('');
  const [hasHordeApiKey, setHasHordeApiKey] = useState(settings.hasHordeApiKey || false);
  const [hordeApiKeyMasked, setHordeApiKeyMasked] = useState(settings.hordeApiKeyMasked || '');
  const [hordeModels, setHordeModels] = useState([]);
  const [selectedHordeModel, setSelectedHordeModel] = useState(settings.llm?.hordeModel || '');
  const [hordeUsername, setHordeUsername] = useState(null);
  const [hordeConnecting, setHordeConnecting] = useState(false);
  const [hordeError, setHordeError] = useState(null);

  // Collapsible section states (collapsed by default)
  const [expandedSections, setExpandedSections] = useState({
    connection: true, // Keep connection expanded by default
    models: false,
    tokenSettings: false,
    advancedControl: false, // Parent collapsible for KoboldCpp/OpenAI settings
    samplerSettings: false,
    repetitionPenalty: false,
    dryPenalty: false,
    xtc: false,
    smoothing: false,
    dynamicTemp: false,
    mirostat: false,
    stopSequences: false
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };


  // Save settings to both global settings AND the active connection profile
  const persistSettings = async (settingsObj) => {
    await api.updateLlmSettings(settingsObj);
    if (selectedProfileId) {
      const { activeProfileId, ...toProfile } = settingsObj;
      const profile = connectionProfiles.find(p => p.id === selectedProfileId);
      await api.updateConnectionProfile(selectedProfileId, {
        name: profile?.name, ...toProfile, endpointStandard, openRouterApiKey, openRouterModel: selectedOpenRouterModel,
        hordeModel: selectedHordeModel
      });
    }
  };

  // Keep a ref to the latest persistSettings so the debounced commit never uses
  // a stale closure (selectedProfileId / profiles / endpoint can change).
  const persistSettingsRef = useRef(persistSettings);
  useEffect(() => {
    persistSettingsRef.current = persistSettings;
  });

  // Debounced, serialized auto-save for rapid slider drags.
  // - Local state updates immediately (responsive UI).
  // - The network commit is debounced (300ms) so a drag fires one save, not many.
  // - Writes are serialized through a chained promise so the two POSTs inside
  //   persistSettings never interleave across overlapping commits.
  const saveTimerRef = useRef(null);
  const saveChainRef = useRef(Promise.resolve());
  // Snapshot of the last-persisted settings, used for rollback on failure.
  const lastPersistedRef = useRef(null);

  const commitSettings = useCallback((settingsObj, rollbackPrev) => {
    saveChainRef.current = saveChainRef.current
      .catch(() => {}) // isolate prior failures so the queue keeps draining
      .then(async () => {
        try {
          await persistSettingsRef.current(settingsObj);
          lastPersistedRef.current = settingsObj;
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        } catch (error) {
          console.error('Failed to auto-save settings:', error);
          showError('Failed to save setting — reverting');
          // Roll back local state to the last known-good values so the UI does
          // not show an unpersisted value.
          if (rollbackPrev) {
            setLlmSettings(rollbackPrev);
          }
        }
      });
  }, [showError]);

  const updateSetting = (key, value) => {
    setSaved(false);
    // Update local state immediately for a responsive UI.
    const newSettings = { ...llmSettings, [key]: value };
    // Pre-change snapshot for rollback on save failure.
    const rollbackPrev = lastPersistedRef.current || llmSettings;
    setLlmSettings(newSettings);
    // Debounce the network commit so a slider drag fires one save, not many.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      commitSettings(newSettings, rollbackPrev);
    }, 300);
  };

  // Flush any pending debounced save on unmount so a final drag isn't lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await persistSettings(llmSettings);
      lastPersistedRef.current = llmSettings;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      showError('Failed to save settings');
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await api.testLlm(llmSettings);

      if (result.success) {
        setConnectionStatus('online');
        if (result.modelName) {
          setModelStatus(result.modelName);
        } else {
          setModelStatus('No Models Detected');
        }

        // Auto-detect context size and chat template if reported by the backend
        let settingsToSave = llmSettings;
        if (result.contextSize && result.contextSize > 0) {
          console.log(`[ModelTab] Auto-detected context size: ${result.contextSize}`);
          settingsToSave = { ...settingsToSave, contextTokens: result.contextSize };
          setLlmSettings(prev => ({ ...prev, contextTokens: result.contextSize }));
        }
        if (result.chatTemplate) {
          console.log(`[ModelTab] Auto-detected chat template: ${result.chatTemplate}`);
          settingsToSave = { ...settingsToSave, promptTemplate: result.chatTemplate };
          setLlmSettings(prev => ({ ...prev, promptTemplate: result.chatTemplate }));
        }
        if (result.supportsSystemRole !== undefined) {
          settingsToSave = { ...settingsToSave, supportsSystemRole: result.supportsSystemRole };
          setLlmSettings(prev => ({ ...prev, supportsSystemRole: result.supportsSystemRole }));
        }

        // Auto-save on successful connection (global + profile)
        await persistSettings(settingsToSave);
      } else {
        setConnectionStatus('offline');
        setModelStatus('Check URL');
      }
    } catch (error) {
      setConnectionStatus('offline');
      setModelStatus('Check URL');
    }
    setTesting(false);
  };

  const handleDisconnect = () => {
    setConnectionStatus('offline');
    setModelStatus('Disconnected');
  };

  // Default URLs per endpoint standard
  const defaultUrls = {
    openai: 'http://localhost:1234/v1/chat/completions',
    kobold: 'http://localhost:5001/api/v1/generate',
    llamacpp: 'http://localhost:8080/completion'
  };
  const defaultUrlValues = new Set(Object.values(defaultUrls));

  // Handle endpoint standard change
  const handleEndpointStandardChange = async (value) => {
    setEndpointStandard(value);
    // Reset connection status when switching endpoints
    setConnectionStatus('offline');
    setModelStatus('');
    setOpenRouterError(null);
    setHordeError(null);

    // Auto-populate URL if empty or still set to another backend's default
    const currentUrl = llmSettings.llmUrl || '';
    const shouldPopulate = !currentUrl || defaultUrlValues.has(currentUrl);
    const newUrl = shouldPopulate && defaultUrls[value] ? defaultUrls[value] : currentUrl;

    const newSettings = { ...llmSettings, endpointStandard: value, llmUrl: newUrl };
    setLlmSettings(newSettings);
    try {
      await persistSettings(newSettings);
      // Keyed providers (OpenRouter / AI Horde) connect via their own button, not a URL test.
      if (value !== 'openrouter' && value !== 'aihorde' && newUrl) {
        handleTest();
      }
    } catch (error) {
      console.error('Failed to save endpoint standard:', error);
    }
  };

  // Connect to OpenRouter
  const handleOpenRouterConnect = async () => {
    // If no new key entered but we have a saved key, just reconnect
    const isReconnect = !openRouterApiKey.trim() && hasOpenRouterApiKey;

    if (!openRouterApiKey.trim() && !hasOpenRouterApiKey) {
      setOpenRouterError('Please enter an API key');
      return;
    }

    setOpenRouterConnecting(true);
    setOpenRouterError(null);

    try {
      // For reconnect, call the reconnect endpoint that uses stored key
      const endpoint = isReconnect
        ? `${API_BASE}/api/openrouter/reconnect`
        : `${API_BASE}/api/openrouter/connect`;

      const result = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: isReconnect ? '{}' : JSON.stringify({ apiKey: openRouterApiKey })
      });

      if (result.success) {
        setOpenRouterModels(result.models);
        setConnectionStatus('online');
        setModelStatus(`${result.models.length} models available`);
        setHasOpenRouterApiKey(true);
        if (result.maskedKey) {
          setOpenRouterApiKeyMasked(result.maskedKey);
        }

        // Save the settings (key will be encrypted on backend)
        if (!isReconnect) {
          const newSettings = {
            ...llmSettings,
            endpointStandard: 'openrouter',
            openRouterApiKey: openRouterApiKey
          };
          setLlmSettings(newSettings);
          await persistSettings(newSettings);
          setOpenRouterApiKey(''); // Clear the input after saving
        }
      } else {
        setOpenRouterError(result.error || 'Connection failed');
        setConnectionStatus('offline');
      }
    } catch (error) {
      setOpenRouterError(error.message);
      setConnectionStatus('offline');
    }

    setOpenRouterConnecting(false);
  };

  // Handle OpenRouter model selection
  const handleOpenRouterModelSelect = async (model) => {
    setSelectedOpenRouterModel(model.id);
    const newSettings = {
      ...llmSettings,
      openRouterModel: model.id,
      openRouterModelName: model.name,
      contextTokens: model.context_length || 8192
    };
    setLlmSettings(newSettings);
    setModelStatus(model.name);
    try {
      await persistSettings(newSettings);
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  };

  // Connect to AI Horde (blank key = anonymous tier)
  const handleHordeConnect = async () => {
    const isReconnect = !hordeApiKey.trim() && hasHordeApiKey;
    setHordeConnecting(true);
    setHordeError(null);
    try {
      const endpoint = isReconnect
        ? `${API_BASE}/api/horde/reconnect`
        : `${API_BASE}/api/horde/connect`;
      const result = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: isReconnect ? '{}' : JSON.stringify({ apiKey: hordeApiKey.trim() })
      });

      if (result.success) {
        setHordeModels(result.models);
        setHordeUsername(result.username || null);
        setConnectionStatus('online');
        setModelStatus(`${result.models.length} models available`);
        if (hordeApiKey.trim()) {
          setHasHordeApiKey(true);
          // Persist the (plaintext) working key into settings.llm + encrypt top-level.
          const newSettings = { ...llmSettings, endpointStandard: 'aihorde', hordeApiKey: hordeApiKey.trim() };
          setLlmSettings(newSettings);
          await persistSettings(newSettings);
          setHordeApiKey('');
        }
      } else {
        setHordeError(result.error || 'Connection failed');
        setConnectionStatus('offline');
      }
    } catch (error) {
      setHordeError(error.message);
      setConnectionStatus('offline');
    }
    setHordeConnecting(false);
  };

  // Handle AI Horde model selection ('' = any available worker). Horde doesn't expose
  // the worker's chat template, so we auto-apply the one inferred from the model name
  // (backend `inferHordeTemplate`) — fixes template-roulette for a pinned model.
  const handleHordeModelSelect = async (model) => {
    const id = model ? model.id : '';
    setSelectedHordeModel(id);
    const newSettings = { ...llmSettings, hordeModel: id };
    let appliedTemplate = null;
    if (model && model.template && model.template !== llmSettings.promptTemplate) {
      newSettings.promptTemplate = model.template;
      appliedTemplate = model.template;
    }
    setLlmSettings(newSettings);
    setModelStatus(model ? `${model.name}${appliedTemplate ? ` · template → ${appliedTemplate}` : ''}` : 'Any model');
    try {
      await persistSettings(newSettings);
    } catch (error) {
      console.error('Failed to save Horde model selection:', error);
    }
  };

  // Filter AI Horde models by the shared search box
  const filteredHordeModels = hordeModels.filter(m => {
    if (!modelSearchQuery.trim()) return true;
    return (m.name || '').toLowerCase().includes(modelSearchQuery.toLowerCase());
  });

  // Filter and sort OpenRouter models
  const sortedOpenRouterModels = [...openRouterModels]
    .filter(model => {
      if (!modelSearchQuery.trim()) return true;
      const query = modelSearchQuery.toLowerCase();
      return (
        (model.name || '').toLowerCase().includes(query) ||
        (model.id || '').toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const costA = parseFloat(a.pricing?.prompt || 0);
      const costB = parseFloat(b.pricing?.prompt || 0);
      return modelSortOrder === 'cost-low' ? costA - costB : costB - costA;
    });

  // Load settings from API on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await api.getSettings();
        if (loadedSettings.llm) {
          setLlmSettings({
            ...loadedSettings.llm,
            streaming: loadedSettings.llm.streaming ?? true
          });
          // Sync OpenRouter state
          if (loadedSettings.llm.endpointStandard) {
            setEndpointStandard(loadedSettings.llm.endpointStandard);
          }
          if (loadedSettings.llm.openRouterModel) {
            setSelectedOpenRouterModel(loadedSettings.llm.openRouterModel);
          }
          if (loadedSettings.llm.hordeModel !== undefined) {
            setSelectedHordeModel(loadedSettings.llm.hordeModel || '');
          }
        }
        // Handle masked API key info
        if (loadedSettings.hasOpenRouterApiKey !== undefined) {
          setHasOpenRouterApiKey(loadedSettings.hasOpenRouterApiKey);
        }
        if (loadedSettings.openRouterApiKeyMasked) {
          setOpenRouterApiKeyMasked(loadedSettings.openRouterApiKeyMasked);
        }
        if (loadedSettings.hasHordeApiKey !== undefined) {
          setHasHordeApiKey(loadedSettings.hasHordeApiKey);
        }
        if (loadedSettings.hordeApiKeyMasked) {
          setHordeApiKeyMasked(loadedSettings.hordeApiKeyMasked);
        }
        // If AI Horde is the active endpoint, restore the connection: hydrate the
        // cached model list, or reconnect (stored key / anonymous) if the cache is
        // empty (e.g. after a server restart). Without this the panel shows "Connect"
        // every time the menu is reopened even though Horde is configured.
        if (loadedSettings.llm?.endpointStandard === 'aihorde') {
          try {
            let models = [];
            const hm = await apiFetch(`${API_BASE}/api/horde/models`);
            if (hm.models && hm.models.length > 0) {
              models = hm.models;
            } else {
              const data = await apiFetch(`${API_BASE}/api/horde/reconnect`, { method: 'POST', body: '{}' });
              if (data.success) models = data.models;
            }
            if (models.length > 0) {
              setHordeModels(models);
              setConnectionStatus('online');
              const sel = loadedSettings.llm.hordeModel;
              const selModel = sel && models.find(m => m.id === sel);
              setModelStatus(selModel ? selModel.name : sel ? sel : `${models.length} models available`);
            }
          } catch (_) { /* non-fatal */ }
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
    // eslint-disable-next-line
  }, []);

  // Load connection profiles on mount and auto-connect to saved profile
  useEffect(() => {
    const loadProfilesAndConnect = async () => {
      try {
        const profiles = await api.getConnectionProfiles();
        setConnectionProfiles(profiles);

        // Auto-connect to saved active profile
        if (settings.llm?.activeProfileId) {
          const activeProfile = profiles.find(p => p.id === settings.llm.activeProfileId);
          if (activeProfile) {
            setSelectedProfileId(settings.llm.activeProfileId);
            // Connect based on endpoint type
            if (activeProfile.endpointStandard === 'openrouter' && activeProfile.openRouterApiKey) {
              // Load OpenRouter models
              try {
                const data = await apiFetch(`${API_BASE}/api/openrouter/models`);
                if (data.models && data.models.length > 0) {
                  setOpenRouterModels(data.models);
                  setConnectionStatus('online');
                  if (activeProfile.openRouterModel) {
                    const savedModel = data.models.find(m => m.id === activeProfile.openRouterModel);
                    setModelStatus(savedModel?.name || savedModel?.id || `${data.models.length} models available`);
                  } else {
                    setModelStatus(`${data.models.length} models available`);
                  }
                } else {
                  // Fetch fresh models
                  handleOpenRouterConnect();
                }
              } catch (e) {
                handleOpenRouterConnect();
              }
            } else if (activeProfile.llmUrl) {
              // Test Kobold/OpenAI connection — inline to avoid stale closure
              try {
                const testResult = await api.testLlm(settings.llm);
                if (testResult.success) {
                  setConnectionStatus('online');
                  setModelStatus(testResult.modelName || 'Connected');
                  let updated = { ...settings.llm };
                  if (testResult.contextSize && testResult.contextSize > 0) {
                    updated.contextTokens = testResult.contextSize;
                    setLlmSettings(prev => ({ ...prev, contextTokens: testResult.contextSize }));
                  }
                  if (testResult.chatTemplate) {
                    updated.promptTemplate = testResult.chatTemplate;
                    setLlmSettings(prev => ({ ...prev, promptTemplate: testResult.chatTemplate }));
                  }
                  if (testResult.supportsSystemRole !== undefined) {
                    updated.supportsSystemRole = testResult.supportsSystemRole;
                    setLlmSettings(prev => ({ ...prev, supportsSystemRole: testResult.supportsSystemRole }));
                  }
                  await persistSettings(updated);
                }
              } catch (e) {
                setConnectionStatus('offline');
                setModelStatus('Connection failed');
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load connection profiles:', error);
      }
    };
    loadProfilesAndConnect();
    // eslint-disable-next-line
  }, []);

  // Update model status when models load and we have a saved selection
  useEffect(() => {
    if (openRouterModels.length > 0 && selectedOpenRouterModel) {
      const savedModel = openRouterModels.find(m => m.id === selectedOpenRouterModel);
      if (savedModel) {
        setModelStatus(savedModel.name || savedModel.id);
      }
    }
  }, [openRouterModels, selectedOpenRouterModel]);

  // Handle profile selection - disconnect from current, then connect to new
  const handleProfileSelect = async (profileId) => {
    if (!profileId || profileId === 'none') {
      // Disconnect from current profile
      setSelectedProfileId(null);
      setConnectionStatus('offline');
      setModelStatus('Disconnected');
      setOpenRouterModels([]);
      return;
    }
    if (profileId === 'new') {
      setShowNewProfileInput(true);
      return;
    }

    // First disconnect from current connection
    setConnectionStatus('offline');
    setModelStatus('Connecting...');
    setOpenRouterModels([]);

    try {
      const result = await api.activateConnectionProfile(profileId);
      if (result.success && result.settings?.llm) {
        const profileSettings = result.settings.llm;
        setLlmSettings(profileSettings);
        setSelectedProfileId(profileId);

        // Restore endpoint standard and OpenRouter settings
        const newEndpoint = profileSettings.endpointStandard || 'openai';
        setEndpointStandard(newEndpoint);

        if (profileSettings.openRouterApiKey) {
          setOpenRouterApiKey(profileSettings.openRouterApiKey);
        }
        if (profileSettings.openRouterModel) {
          setSelectedOpenRouterModel(profileSettings.openRouterModel);
        }
        setSelectedHordeModel(profileSettings.hordeModel || '');

        // Auto-connect based on endpoint type
        if (newEndpoint === 'aihorde') {
          try {
            let models = [];
            const cached = await apiFetch(`${API_BASE}/api/horde/models`);
            if (cached.models && cached.models.length > 0) {
              models = cached.models;
            } else {
              setHordeConnecting(true);
              const data = await apiFetch(`${API_BASE}/api/horde/reconnect`, { method: 'POST', body: '{}' });
              setHordeConnecting(false);
              if (data.success) models = data.models;
            }
            if (models.length > 0) {
              setHordeModels(models);
              setConnectionStatus('online');
              setModelStatus(`${models.length} models available`);
            } else {
              setConnectionStatus('offline');
            }
          } catch (e) {
            setHordeConnecting(false);
            setConnectionStatus('offline');
          }
        } else if (newEndpoint === 'openrouter' && profileSettings.openRouterApiKey) {
          // Connect to OpenRouter
          try {
            const data = await apiFetch(`${API_BASE}/api/openrouter/models`);
            if (data.models && data.models.length > 0) {
              setOpenRouterModels(data.models);
              setConnectionStatus('online');
              if (profileSettings.openRouterModel) {
                const savedModel = data.models.find(m => m.id === profileSettings.openRouterModel);
                setModelStatus(savedModel?.name || savedModel?.id || `${data.models.length} models available`);
              } else {
                setModelStatus(`${data.models.length} models available`);
              }
            } else {
              // Need to fetch fresh - call connect
              setOpenRouterConnecting(true);
              const connectResult = await api.connectOpenRouter(profileSettings.openRouterApiKey);
              setOpenRouterConnecting(false);
              if (connectResult.success) {
                setOpenRouterModels(connectResult.models);
                setConnectionStatus('online');
                setModelStatus(`${connectResult.models.length} models available`);
              } else {
                setConnectionStatus('offline');
                setModelStatus('Connection failed');
              }
            }
          } catch (e) {
            setConnectionStatus('offline');
            setModelStatus('Connection failed');
          }
        } else if (profileSettings.llmUrl) {
          // Test Kobold/OpenAI connection
          try {
            const testResult = await api.testLlm(profileSettings);
            if (testResult.success) {
              setConnectionStatus('online');
              setModelStatus(testResult.modelName || 'Connected');

              // Auto-detect context size and chat template if reported by the backend
              let updatedSettings = profileSettings;
              if (testResult.contextSize && testResult.contextSize > 0) {
                updatedSettings = { ...updatedSettings, contextTokens: testResult.contextSize };
              }
              if (testResult.chatTemplate) {
                updatedSettings = { ...updatedSettings, promptTemplate: testResult.chatTemplate };
              }
              if (testResult.supportsSystemRole !== undefined) {
                updatedSettings = { ...updatedSettings, supportsSystemRole: testResult.supportsSystemRole };
              }
              if (updatedSettings !== profileSettings) {
                setLlmSettings(updatedSettings);
                await persistSettings(updatedSettings);
              }
            } else {
              setConnectionStatus('offline');
              setModelStatus('Connection failed');
            }
          } catch (e) {
            setConnectionStatus('offline');
            setModelStatus('Connection failed');
          }
        } else {
          setModelStatus('No endpoint configured');
        }
      }
    } catch (error) {
      console.error('Failed to activate profile:', error);
      setConnectionStatus('offline');
      setModelStatus('Profile activation failed');
    }
  };

  // Save current settings as new profile
  const handleSaveNewProfile = async () => {
    if (!newProfileName.trim()) return;
    try {
      const { activeProfileId, ...settingsToSave } = llmSettings;
      // Include endpoint standard and OpenRouter settings
      const profileSettings = {
        ...settingsToSave,
        endpointStandard,
        openRouterApiKey,
        openRouterModel: selectedOpenRouterModel
      };
      const newProfile = await api.createConnectionProfile({
        name: newProfileName.trim(),
        ...profileSettings
      });
      setConnectionProfiles(prev => [...prev, newProfile]);
      setSelectedProfileId(newProfile.id);
      setNewProfileName('');
      setShowNewProfileInput(false);
      // Update settings to track active profile
      await api.updateLlmSettings({ ...llmSettings, activeProfileId: newProfile.id });
    } catch (error) {
      console.error('Failed to create profile:', error);
    }
  };

  // Update existing profile with current settings
  const handleUpdateProfile = async () => {
    if (!selectedProfileId) return;
    try {
      const { activeProfileId, ...settingsToSave } = llmSettings;
      // Include endpoint standard and OpenRouter settings
      const profileSettings = {
        ...settingsToSave,
        endpointStandard,
        openRouterApiKey,
        openRouterModel: selectedOpenRouterModel
      };
      const profile = connectionProfiles.find(p => p.id === selectedProfileId);
      await api.updateConnectionProfile(selectedProfileId, {
        name: profile?.name,
        ...profileSettings
      });
      setConnectionProfiles(prev =>
        prev.map(p => p.id === selectedProfileId ? { ...p, ...profileSettings } : p)
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  // Delete selected profile
  const handleDeleteProfile = async () => {
    if (!selectedProfileId) return;
    const profile = connectionProfiles.find(p => p.id === selectedProfileId);
    if (!window.confirm(`Delete profile "${profile?.name}"?`)) return;
    try {
      await api.deleteConnectionProfile(selectedProfileId);
      setConnectionProfiles(prev => prev.filter(p => p.id !== selectedProfileId));
      setSelectedProfileId(null);
    } catch (error) {
      console.error('Failed to delete profile:', error);
    }
  };

  const handleNeutralizeSamplers = () => {
    setLlmSettings(prev => ({
      ...prev,
      neutralizeSamplers: !prev.neutralizeSamplers,
      // Reset to neutral values if enabling
      ...(!prev.neutralizeSamplers ? {
        temperature: 1,
        topP: 1,
        topK: 0,
        typicalP: 1,
        minP: 0,
        topA: 0,
        tfs: 1,
        repetitionPenalty: 1,
        frequencyPenalty: 0,
        presencePenalty: 0
      } : {})
    }));
    setSaved(false);
  };

  return (
    <div className="settings-tab">
      <h2 className="settings-title">Give SwellDreams the Will to Inflate</h2>
      <div className="model-tab">
        {/* Combined Connection Settings */}
        <div className="settings-section-collapsible">
          <div className="settings-section-header" onClick={() => toggleSection('connection')}>
            <span>Connection Settings</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
              <span className="model-status">{modelStatus}</span>
              <span className="collapse-icon">{expandedSections.connection ? '▼' : '▶'}</span>
            </div>
          </div>
          {expandedSections.connection && (
          <div className="settings-section-content connection-grid">
            {/* Row 1: Profile */}
            <div className="connection-row">
              <label>Profile</label>
              <select
                value={selectedProfileId || 'none'}
                onChange={(e) => handleProfileSelect(e.target.value)}
                className="connection-field-twothirds"
              >
                <option value="none">-- No Profile --</option>
                {connectionProfiles.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
                <option value="new">+ Save as New Profile...</option>
              </select>
              <div className="connection-field-onethird-buttons">
                {selectedProfileId ? (
                  <>
                    <button onClick={handleUpdateProfile} className="btn btn-sm btn-secondary">Update</button>
                    <button onClick={handleDeleteProfile} className="btn btn-sm btn-danger">Delete</button>
                  </>
                ) : (
                  <span></span>
                )}
              </div>
            </div>

            {showNewProfileInput && (
              <div className="connection-row">
                <label></label>
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Profile name (e.g., Lyonade, Local LLM)"
                  className="connection-field-twothirds"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveNewProfile()}
                  autoFocus
                />
                <div className="connection-field-onethird-buttons">
                  <button onClick={handleSaveNewProfile} className="btn btn-sm btn-primary" disabled={!newProfileName.trim()}>Save</button>
                  <button onClick={() => { setShowNewProfileInput(false); setNewProfileName(''); }} className="btn btn-sm btn-secondary">Cancel</button>
                </div>
              </div>
            )}

            {/* Row 2: Endpoint, API Type, Template (for URL-based backends) */}
            <div className="connection-row">
              <label>Endpoint</label>
              {endpointStandard !== 'openrouter' && endpointStandard !== 'aihorde' ? (
                <>
                  <select
                    value={endpointStandard}
                    onChange={(e) => handleEndpointStandardChange(e.target.value)}
                    className="connection-field-third"
                  >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="kobold">KoboldCPP</option>
                    <option value="llamacpp">Llama.cpp</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="aihorde">AI Horde</option>
                  </select>
                  <select
                    value={llmSettings.apiType || 'auto'}
                    onChange={(e) => updateSetting('apiType', e.target.value)}
                    className="connection-field-third"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="text_completion">Text Completion</option>
                    <option value="chat_completion">Chat Completion</option>
                  </select>
                  <select
                    value={llmSettings.promptTemplate || 'none'}
                    onChange={(e) => updateSetting('promptTemplate', e.target.value)}
                    className="connection-field-third"
                  >
                    <option value="none">No Template</option>
                    <option value="chatml">ChatML</option>
                    <option value="llama">Llama 2</option>
                    <option value="llama3">Llama 3</option>
                    <option value="mistral">Mistral (v0.2+)</option>
                    <option value="mistral-tekken">Mistral v7 (Tekken)</option>
                    <option value="alpaca">Alpaca</option>
                    <option value="vicuna">Vicuna</option>
                    <option value="gemma2">Gemma 2</option>
                    <option value="gemma3">Gemma 3</option>
                    <option value="jinja">Jinja (Server)</option>
                  </select>
                </>
              ) : endpointStandard === 'aihorde' ? (
                <>
                  <select
                    value={endpointStandard}
                    onChange={(e) => handleEndpointStandardChange(e.target.value)}
                    className="connection-field-half"
                  >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="kobold">KoboldCPP</option>
                    <option value="llamacpp">Llama.cpp</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="aihorde">AI Horde</option>
                  </select>
                  {/* Horde is raw text-completion: the instruct template still matters. */}
                  <select
                    value={llmSettings.promptTemplate || 'none'}
                    onChange={(e) => updateSetting('promptTemplate', e.target.value)}
                    className="connection-field-half"
                  >
                    <option value="none">No Template</option>
                    <option value="chatml">ChatML</option>
                    <option value="llama">Llama 2</option>
                    <option value="llama3">Llama 3</option>
                    <option value="mistral">Mistral (v0.2+)</option>
                    <option value="mistral-tekken">Mistral v7 (Tekken)</option>
                    <option value="alpaca">Alpaca</option>
                    <option value="vicuna">Vicuna</option>
                    <option value="gemma2">Gemma 2</option>
                    <option value="gemma3">Gemma 3</option>
                  </select>
                </>
              ) : (
                <select
                  value={endpointStandard}
                  onChange={(e) => handleEndpointStandardChange(e.target.value)}
                  className="connection-field"
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="kobold">KoboldCPP</option>
                  <option value="llamacpp">Llama.cpp</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="aihorde">AI Horde</option>
                </select>
              )}
            </div>

            {/* Row 3: URL/API Key + Connect */}
            {endpointStandard === 'openrouter' ? (
              <>
                <div className="connection-row">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={openRouterApiKey}
                    onChange={(e) => setOpenRouterApiKey(e.target.value)}
                    placeholder={hasOpenRouterApiKey ? `Key saved (${openRouterApiKeyMasked || '****'}) - enter new to replace` : 'sk-or-v1-...'}
                    className="connection-field-twothirds"
                  />
                  <div className="connection-field-onethird-buttons">
                    <button
                      className={`btn btn-sm ${connectionStatus === 'online' && openRouterModels.length > 0 ? 'btn-success' : 'btn-primary'}`}
                      onClick={handleOpenRouterConnect}
                      disabled={openRouterConnecting || (!openRouterApiKey.trim() && !hasOpenRouterApiKey)}
                    >
                      {openRouterConnecting ? 'Connecting...' : connectionStatus === 'online' && openRouterModels.length > 0 ? 'Connected' : (hasOpenRouterApiKey && !openRouterApiKey.trim() ? 'Reconnect' : 'Connect')}
                    </button>
                  </div>
                </div>
                {hasOpenRouterApiKey && (
                  <div className="connection-row">
                    <label></label>
                    <span className="api-key-status">API key is securely stored (encrypted)</span>
                  </div>
                )}
                {openRouterError && (
                  <div className="connection-row">
                    <label></label>
                    <span className="connection-error">{openRouterError}</span>
                  </div>
                )}
                {/* OpenRouter Token Settings */}
                <div className="connection-row token-row">
                  <label>Response</label>
                  <input
                    type="number"
                    value={llmSettings.maxTokens || 150}
                    onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
                    min={1}
                    max={32768}
                  />
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={llmSettings.streaming ?? true}
                      onChange={(e) => updateSetting('streaming', e.target.checked)}
                    />
                    <span>Streaming</span>
                  </label>
                </div>
                <div className="connection-row token-row">
                  <label>Impersonate</label>
                  <input
                    type="number"
                    value={llmSettings.impersonateMaxTokens || llmSettings.maxTokens || 150}
                    onChange={(e) => updateSetting('impersonateMaxTokens', parseInt(e.target.value))}
                    min={1}
                    max={32768}
                  />
                </div>
                <div className="connection-row token-row">
                  <label>Context</label>
                  <input
                    type="number"
                    value={llmSettings.contextTokens || 8192}
                    onChange={(e) => updateSetting('contextTokens', parseInt(e.target.value))}
                    min={512}
                    max={200000}
                  />
                </div>
              </>
            ) : endpointStandard === 'aihorde' ? (
              <>
                <div className="connection-row">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={hordeApiKey}
                    onChange={(e) => setHordeApiKey(e.target.value)}
                    placeholder={hasHordeApiKey ? `Key saved (${hordeApiKeyMasked || '****'}) — enter new to replace` : 'Horde key (blank = anonymous)'}
                    className="connection-field-twothirds"
                  />
                  <div className="connection-field-onethird-buttons">
                    <button
                      className={`btn btn-sm ${connectionStatus === 'online' && hordeModels.length > 0 ? 'btn-success' : 'btn-primary'}`}
                      onClick={handleHordeConnect}
                      disabled={hordeConnecting}
                    >
                      {hordeConnecting ? 'Connecting...' : connectionStatus === 'online' && hordeModels.length > 0 ? 'Connected' : (hasHordeApiKey && !hordeApiKey.trim() ? 'Reconnect' : 'Connect')}
                    </button>
                  </div>
                </div>
                <div className="connection-row">
                  <label></label>
                  <span className="form-hint">
                    Free crowdsourced inference via <strong>aihorde.net</strong>. A blank key uses the anonymous tier (slower, lower priority). Register at aihorde.net for a key and faster queue.
                    {hordeUsername && <> Signed in as <strong>{hordeUsername}</strong>.</>}
                  </span>
                </div>
                {hasHordeApiKey && (
                  <div className="connection-row">
                    <label></label>
                    <span className="api-key-status">API key is securely stored (encrypted)</span>
                  </div>
                )}
                {hordeError && (
                  <div className="connection-row">
                    <label></label>
                    <span className="connection-error">{hordeError}</span>
                  </div>
                )}
                <div className="connection-row token-row">
                  <label>Response</label>
                  <input
                    type="number"
                    value={llmSettings.maxTokens || 150}
                    onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
                    min={1}
                    max={512}
                  />
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={llmSettings.streaming ?? true}
                      onChange={(e) => updateSetting('streaming', e.target.checked)}
                    />
                    <span>Streaming</span>
                  </label>
                </div>
                <div className="connection-row token-row">
                  <label>Impersonate</label>
                  <input
                    type="number"
                    value={llmSettings.impersonateMaxTokens || llmSettings.maxTokens || 150}
                    onChange={(e) => updateSetting('impersonateMaxTokens', parseInt(e.target.value))}
                    min={1}
                    max={512}
                  />
                </div>
                <div className="connection-row token-row">
                  <label>Context</label>
                  <input
                    type="number"
                    value={llmSettings.contextTokens || 4096}
                    onChange={(e) => updateSetting('contextTokens', parseInt(e.target.value))}
                    min={512}
                    max={32768}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="connection-row">
                  <label>URL</label>
                  <input
                    type="text"
                    value={llmSettings.llmUrl || ''}
                    onChange={(e) => updateSetting('llmUrl', e.target.value)}
                    placeholder={endpointStandard === 'kobold' ? 'http://localhost:5001/api/v1/generate' : endpointStandard === 'llamacpp' ? 'http://localhost:8080/completion' : 'http://localhost:1234/v1/chat/completions'}
                    className="connection-field-twothirds"
                  />
                  <div className="connection-field-onethird-buttons">
                    <button
                      className={`btn btn-sm ${connectionStatus === 'online' ? 'btn-success' : 'btn-primary'}`}
                      onClick={connectionStatus === 'online' ? handleDisconnect : handleTest}
                      disabled={!llmSettings.llmUrl || testing}
                    >
                      {testing ? 'Testing...' : connectionStatus === 'online' ? 'Connected' : 'Connect'}
                    </button>
                  </div>
                </div>
                {/* Kobold/OpenAI Token Settings */}
                <div className="connection-row token-row">
                  <label>Response</label>
                  <input
                    type="number"
                    value={llmSettings.maxTokens || 150}
                    onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
                    min={1}
                    max={4096}
                  />
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={llmSettings.streaming ?? true}
                      onChange={(e) => updateSetting('streaming', e.target.checked)}
                    />
                    <span>Streaming</span>
                  </label>
                </div>
                <div className="connection-row token-row">
                  <label>Impersonate</label>
                  <input
                    type="number"
                    value={llmSettings.impersonateMaxTokens || llmSettings.maxTokens || 150}
                    onChange={(e) => updateSetting('impersonateMaxTokens', parseInt(e.target.value))}
                    min={1}
                    max={4096}
                  />
                </div>
                <div className="connection-row token-row">
                  <label>Context</label>
                  <input
                    type="number"
                    value={llmSettings.contextTokens || 8192}
                    onChange={(e) => updateSetting('contextTokens', parseInt(e.target.value))}
                    min={512}
                    max={131072}
                  />
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={llmSettings.trimIncompleteSentences ?? true}
                      onChange={(e) => updateSetting('trimIncompleteSentences', e.target.checked)}
                    />
                    <span>Trim Incomplete</span>
                  </label>
                </div>
              </>
            )}
          </div>
          )}
        </div>

        {/* AI Horde Models List (samplers fall through to the standard section below) */}
        {endpointStandard === 'aihorde' && hordeModels.length > 0 && (
          <div className="settings-section-collapsible">
            <div className="settings-section-header" onClick={() => toggleSection('models')}>
              <span>Models ({filteredHordeModels.length}{modelSearchQuery ? ` of ${hordeModels.length}` : ''})</span>
              <span className="collapse-icon">{expandedSections.models ? '▼' : '▶'}</span>
            </div>
            {expandedSections.models && (
              <div className="settings-section-content">
                <div className="model-search-container" style={{ marginBottom: 'var(--spacing-sm)' }}>
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder="Search models..."
                    className="model-search-input"
                  />
                  {modelSearchQuery && (
                    <button className="model-search-clear" onClick={() => setModelSearchQuery('')} title="Clear search">×</button>
                  )}
                </div>
                <div className="openrouter-models-list">
                  <div
                    className={`openrouter-model-item ${!selectedHordeModel ? 'selected' : ''}`}
                    onClick={() => handleHordeModelSelect(null)}
                  >
                    <div className="model-info">
                      <span className="model-name">Any model</span>
                      <span className="model-id">fastest available worker</span>
                    </div>
                  </div>
                  {filteredHordeModels.map(model => (
                    <div
                      key={model.id}
                      className={`openrouter-model-item ${selectedHordeModel === model.id ? 'selected' : ''}`}
                      onClick={() => handleHordeModelSelect(model)}
                    >
                      <div className="model-info">
                        <span className="model-name">{model.name}</span>
                        <span className="model-id">{model.count} worker{model.count === 1 ? '' : 's'}{model.queued ? ` · ${model.queued} queued` : ''}</span>
                      </div>
                      <div className="model-meta">
                        <span className="model-context">{model.count > 0 ? `~${Math.max(1, Math.round(model.eta))}s eta` : 'offline'}</span>
                        {model.template && <span className="model-cost">{model.template}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OpenRouter Settings */}
        {endpointStandard === 'openrouter' ? (
          <>

            {/* OpenRouter Models List */}
            {openRouterModels.length > 0 && (
              <div className="settings-section-collapsible">
                <div className="settings-section-header" onClick={() => toggleSection('models')}>
                  <span>Models ({sortedOpenRouterModels.length}{modelSearchQuery ? ` of ${openRouterModels.length}` : ''})</span>
                  <span className="collapse-icon">{expandedSections.models ? '▼' : '▶'}</span>
                </div>
                {expandedSections.models && (
                <div className="settings-section-content">
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--spacing-sm)' }}>
                  <select
                    value={modelSortOrder}
                    onChange={(e) => setModelSortOrder(e.target.value)}
                    style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
                  >
                    <option value="cost-low">Cost: Low → High</option>
                    <option value="cost-high">Cost: High → Low</option>
                  </select>
                </div>
                <div className="model-search-container" style={{ marginBottom: 'var(--spacing-sm)' }}>
                  <input
                    type="text"
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    placeholder="Search models..."
                    className="model-search-input"
                  />
                  {modelSearchQuery && (
                    <button
                      className="model-search-clear"
                      onClick={() => setModelSearchQuery('')}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="openrouter-models-list">
                  {sortedOpenRouterModels.map(model => (
                    <div
                      key={model.id}
                      className={`openrouter-model-item ${selectedOpenRouterModel === model.id ? 'selected' : ''}`}
                      onClick={() => handleOpenRouterModelSelect(model)}
                    >
                      <div className="model-info">
                        <span className="model-name">{model.name || model.id}</span>
                        <span className="model-id">{model.id}</span>
                      </div>
                      <div className="model-meta">
                        <span className="model-context">{model.context_length?.toLocaleString() || '?'} ctx</span>
                        <span className="model-cost">
                          ${(parseFloat(model.pricing?.prompt || 0) * 1000000).toFixed(2)}/M
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
                )}
              </div>
            )}

            {/* OpenRouter Sampler Settings */}
            {selectedOpenRouterModel && (
              <>
                <div className="settings-section-collapsible">
                  <div className="settings-section-header" onClick={() => toggleSection('samplerSettings')}>
                    <span>Sampler Settings</span>
                    <span className="collapse-icon">{expandedSections.samplerSettings ? '▼' : '▶'}</span>
                  </div>
                  {expandedSections.samplerSettings && (
                  <div className="settings-section-content">
                  <div className="sampler-grid">
                    <Slider
                      label="Temperature"
                      value={llmSettings.temperature ?? 1}
                      onChange={(v) => updateSetting('temperature', v)}
                      min={0}
                      max={2}
                      step={0.01}
                      info="Controls randomness. Higher = more creative"
                    />
                    <Slider
                      label="Top P"
                      value={llmSettings.topP ?? 1}
                      onChange={(v) => updateSetting('topP', v)}
                      min={0}
                      max={1}
                      step={0.01}
                      info="Nucleus sampling threshold"
                    />
                    <Slider
                      label="Top K"
                      value={llmSettings.topK ?? 0}
                      onChange={(v) => updateSetting('topK', v)}
                      min={0}
                      max={200}
                      step={1}
                      info="Limits to top K tokens. 0 = disabled"
                    />
                    <Slider
                      label="Frequency Penalty"
                      value={llmSettings.frequencyPenalty ?? 0}
                      onChange={(v) => updateSetting('frequencyPenalty', v)}
                      min={0}
                      max={2}
                      step={0.01}
                      info="Penalizes frequent tokens"
                    />
                    <Slider
                      label="Presence Penalty"
                      value={llmSettings.presencePenalty ?? 0}
                      onChange={(v) => updateSetting('presencePenalty', v)}
                      min={0}
                      max={2}
                      step={0.01}
                      info="Penalizes tokens that appeared"
                    />
                    <Slider
                      label="Repetition Penalty"
                      value={llmSettings.repetitionPenalty ?? 1}
                      onChange={(v) => updateSetting('repetitionPenalty', v)}
                      min={1}
                      max={2}
                      step={0.01}
                      info="Penalizes repeated tokens. 1 = disabled"
                    />
                  </div>
                  </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
      {/* Sampler Controls */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('samplerSettings')}>
          <span>Sampler Settings</span>
          <span className="collapse-icon">{expandedSections.samplerSettings ? '▼' : '▶'}</span>
        </div>
        {expandedSections.samplerSettings && (
        <div className="settings-section-content">
          <div className="sampler-buttons" style={{ marginBottom: 'var(--spacing-md)' }}>
            <label className="checkbox-container" style={{ marginRight: 'var(--spacing-md)' }}>
              <input
                type="checkbox"
                checked={lockSamplers}
                onChange={(e) => setLockSamplers(e.target.checked)}
              />
              <span>Lock Samplers</span>
            </label>
            <button
              className={`btn btn-sm ${llmSettings.neutralizeSamplers ? 'btn-primary' : 'btn-secondary'}`}
              onClick={handleNeutralizeSamplers}
              disabled={lockSamplers}
            >
              Neutralize Samplers
            </button>
          </div>
          <div className="sampler-grid" style={{ opacity: lockSamplers ? 0.5 : 1, pointerEvents: lockSamplers ? 'none' : 'auto' }}>
            <Slider
              label="Temperature"
              value={llmSettings.temperature ?? 0.92}
              onChange={(v) => updateSetting('temperature', v)}
              min={0}
              max={2}
              step={0.01}
              info="Controls randomness. Higher = more creative, Lower = more focused"
            />
            <Slider
              label="Top K"
              value={llmSettings.topK ?? 0}
              onChange={(v) => updateSetting('topK', v)}
              min={0}
              max={200}
              step={1}
              info="Limits vocabulary to top K tokens. 0 = disabled"
            />
            <Slider
              label="Top P"
              value={llmSettings.topP ?? 0.92}
              onChange={(v) => updateSetting('topP', v)}
              min={0}
              max={1}
              step={0.01}
              info="Nucleus sampling. Considers tokens until cumulative probability reaches P"
            />
            <Slider
              label="Typical P"
              value={llmSettings.typicalP ?? 1}
              onChange={(v) => updateSetting('typicalP', v)}
              min={0}
              max={1}
              step={0.01}
              info="Locally typical sampling. 1 = disabled"
            />
            <Slider
              label="Min P"
              value={llmSettings.minP ?? 0.08}
              onChange={(v) => updateSetting('minP', v)}
              min={0}
              max={1}
              step={0.01}
              info="Minimum probability threshold relative to top token"
            />
            <Slider
              label="Top A"
              value={llmSettings.topA ?? 0}
              onChange={(v) => updateSetting('topA', v)}
              min={0}
              max={1}
              step={0.01}
              info="Top-A sampling. 0 = disabled"
            />
            <Slider
              label="TFS"
              value={llmSettings.tfs ?? 1}
              onChange={(v) => updateSetting('tfs', v)}
              min={0}
              max={1}
              step={0.01}
              info="Tail Free Sampling. 1 = disabled"
            />
            <Slider
              label="Top NSigma"
              value={llmSettings.topNsigma ?? 0}
              onChange={(v) => updateSetting('topNsigma', v)}
              min={0}
              max={5}
              step={0.1}
              info="Top N-sigma sampling. 0 = disabled"
            />
          </div>
        </div>
        )}
      </div>

      {/* Repetition Penalty Settings */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('repetitionPenalty')}>
          <span>Repetition Penalty</span>
          <span className="collapse-icon">{expandedSections.repetitionPenalty ? '▼' : '▶'}</span>
        </div>
        {expandedSections.repetitionPenalty && (
        <div className="settings-section-content">
          <div className="sampler-grid" style={{ opacity: lockSamplers ? 0.5 : 1, pointerEvents: lockSamplers ? 'none' : 'auto' }}>
            <Slider
              label="Repetition Penalty"
              value={llmSettings.repetitionPenalty ?? 1.05}
              onChange={(v) => updateSetting('repetitionPenalty', v)}
              min={1}
              max={2}
              step={0.01}
              info="Penalizes repeated tokens. 1 = disabled"
            />
            <Slider
              label="Rep Pen Range"
              value={llmSettings.repPenRange ?? 2048}
              onChange={(v) => updateSetting('repPenRange', v)}
              min={0}
              max={8192}
              step={64}
              info="How many tokens back to apply repetition penalty"
            />
            <Slider
              label="Rep Pen Slope"
              value={llmSettings.repPenSlope ?? 1}
              onChange={(v) => updateSetting('repPenSlope', v)}
              min={0}
              max={10}
              step={0.1}
              info="Slope for dynamic repetition penalty"
            />
            <Slider
              label="Frequency Penalty"
              value={llmSettings.frequencyPenalty ?? 0.58}
              onChange={(v) => updateSetting('frequencyPenalty', v)}
              min={0}
              max={2}
              step={0.01}
              info="Penalizes frequent tokens. OpenAI-style"
            />
            <Slider
              label="Presence Penalty"
              value={llmSettings.presencePenalty ?? 0.2}
              onChange={(v) => updateSetting('presencePenalty', v)}
              min={0}
              max={2}
              step={0.01}
              info="Penalizes tokens that appeared at all. OpenAI-style"
            />
          </div>
        </div>
        )}
      </div>

      {/* Advanced Control - Parent collapsible for KoboldCpp-specific settings */}
      <div className="settings-section-collapsible">
        <div className="settings-section-header" onClick={() => toggleSection('advancedControl')}>
          <span>Advanced Control (KoboldCpp / Llama.cpp)</span>
          <span className="collapse-icon">{expandedSections.advancedControl ? '▼' : '▶'}</span>
        </div>
        {expandedSections.advancedControl && (
        <div className="settings-section-content">

          {/* Override server samplers — when off, SwellDreams sends only
              prompt/limits/stop/EOS so the server's launched sampler profile
              governs (e.g. llama-server / LlamaHerder). */}
          <div className="form-group">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={llmSettings.overrideSamplers !== false}
                onChange={(e) => updateSetting('overrideSamplers', e.target.checked)}
              />
              <span>Override server samplers</span>
            </label>
            <span className="form-hint">
              On: send SwellDreams' sampler settings every request. Off: send only prompt, token limits,
              stop strings &amp; EOS — let the server's own sampler profile govern (for llama-server / LlamaHerder users).
            </span>
          </div>

          {/* Sub-collapsible: DRY Repetition Penalty */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('dryPenalty')}>
              <span>DRY Repetition Penalty</span>
              <span className="collapse-icon">{expandedSections.dryPenalty ? '▼' : '▶'}</span>
            </div>
            {expandedSections.dryPenalty && (
            <div className="settings-subsection-content">
              <div className="sampler-grid" style={{ opacity: lockSamplers ? 0.5 : 1, pointerEvents: lockSamplers ? 'none' : 'auto' }}>
                <Slider
                  label="DRY Multiplier"
                  value={llmSettings.dryMultiplier ?? 0}
                  onChange={(v) => updateSetting('dryMultiplier', v)}
                  min={0}
                  max={2}
                  step={0.05}
                  info="DRY penalty multiplier. 0 = disabled"
                />
                <Slider
                  label="DRY Base"
                  value={llmSettings.dryBase ?? 1.75}
                  onChange={(v) => updateSetting('dryBase', v)}
                  min={1}
                  max={3}
                  step={0.05}
                  info="Base for DRY penalty calculation"
                />
                <Slider
                  label="DRY Allowed Length"
                  value={llmSettings.dryAllowedLength ?? 2}
                  onChange={(v) => updateSetting('dryAllowedLength', v)}
                  min={1}
                  max={10}
                  step={1}
                  info="Minimum sequence length before DRY applies"
                />
                <Slider
                  label="DRY Range"
                  value={llmSettings.dryPenaltyLastN ?? 0}
                  onChange={(v) => updateSetting('dryPenaltyLastN', v)}
                  min={0}
                  max={8192}
                  step={64}
                  info="How many tokens back to check. 0 = auto"
                />
              </div>
              <div className="form-group" style={{ marginTop: 'var(--spacing-md)', opacity: lockSamplers ? 0.5 : 1, pointerEvents: lockSamplers ? 'none' : 'auto' }}>
                <label>DRY Sequence Breakers</label>
                <input
                  type="text"
                  value={(llmSettings.drySequenceBreakers || []).join(', ')}
                  onChange={(e) => {
                    const breakers = e.target.value.split(',').map(s => s.trim()).filter(s => s);
                    updateSetting('drySequenceBreakers', breakers);
                  }}
                  placeholder='e.g. \n, :, ", *'
                />
                <span className="form-hint">Comma-separated tokens that break DRY sequences</span>
              </div>
            </div>
            )}
          </div>

          {/* Sub-collapsible: XTC */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('xtc')}>
              <span>XTC (Exclude Top Choices)</span>
              <span className="collapse-icon">{expandedSections.xtc ? '▼' : '▶'}</span>
            </div>
            {expandedSections.xtc && (
            <div className="settings-subsection-content">
              <div className="sampler-grid" style={{ opacity: lockSamplers ? 0.5 : 1, pointerEvents: lockSamplers ? 'none' : 'auto' }}>
                <Slider
                  label="XTC Probability"
                  value={llmSettings.xtcProbability ?? 0}
                  onChange={(v) => updateSetting('xtcProbability', v)}
                  min={0}
                  max={1}
                  step={0.05}
                  info="Chance to exclude top choices. 0 = disabled"
                />
                <Slider
                  label="XTC Threshold"
                  value={llmSettings.xtcThreshold ?? 0.1}
                  onChange={(v) => updateSetting('xtcThreshold', v)}
                  min={0}
                  max={0.5}
                  step={0.01}
                  info="Probability threshold for token exclusion"
                />
              </div>
            </div>
            )}
          </div>

          {/* Sub-collapsible: Smoothing */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('smoothing')}>
              <span>Smoothing</span>
              <span className="collapse-icon">{expandedSections.smoothing ? '▼' : '▶'}</span>
            </div>
            {expandedSections.smoothing && (
            <div className="settings-subsection-content">
              <div className="sampler-grid" style={{ opacity: lockSamplers ? 0.5 : 1, pointerEvents: lockSamplers ? 'none' : 'auto' }}>
                <Slider
                  label="Smoothing Factor"
                  value={llmSettings.smoothingFactor ?? 0}
                  onChange={(v) => updateSetting('smoothingFactor', v)}
                  min={0}
                  max={10}
                  step={0.1}
                  info="Smoothing factor. 0 = disabled"
                />
                <Slider
                  label="Smoothing Curve"
                  value={llmSettings.smoothingCurve ?? 1}
                  onChange={(v) => updateSetting('smoothingCurve', v)}
                  min={0.5}
                  max={3}
                  step={0.1}
                  info="Curve shape for smoothing"
                />
              </div>
            </div>
            )}
          </div>

          {/* Sub-collapsible: Dynamic Temperature */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('dynamicTemp')}>
              <span>Dynamic Temperature</span>
              <span className="collapse-icon">{expandedSections.dynamicTemp ? '▼' : '▶'}</span>
            </div>
            {expandedSections.dynamicTemp && (
            <div className="settings-subsection-content">
              <div className="sampler-grid">
                <Slider
                  label="DynaTemp Range"
                  value={llmSettings.dynaTempRange ?? 0}
                  onChange={(v) => updateSetting('dynaTempRange', v)}
                  min={0}
                  max={2}
                  step={0.1}
                  info="Dynamic temp range. 0 = disabled. Varies temp based on token entropy."
                />
                <Slider
                  label="DynaTemp Exponent"
                  value={llmSettings.dynaTempExponent ?? 1}
                  onChange={(v) => updateSetting('dynaTempExponent', v)}
                  min={0.5}
                  max={2}
                  step={0.1}
                  info="Exponent for dynamic temperature scaling"
                />
              </div>
            </div>
            )}
          </div>

          {/* Sub-collapsible: Mirostat */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('mirostat')}>
              <span>Mirostat</span>
              <span className="collapse-icon">{expandedSections.mirostat ? '▼' : '▶'}</span>
            </div>
            {expandedSections.mirostat && (
            <div className="settings-subsection-content">
              <div className="sampler-grid">
                <div className="slider-container">
                  <div className="slider-header">
                    <span className="slider-label">
                      Mirostat Mode
                      <span className="info-icon" title="0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0">?</span>
                    </span>
                    <span className="slider-value">{llmSettings.mirostat ?? 0}</span>
                  </div>
                  <select
                    value={llmSettings.mirostat ?? 0}
                    onChange={(e) => updateSetting('mirostat', parseInt(e.target.value))}
                    style={{ width: '100%', padding: '6px' }}
                  >
                    <option value={0}>Disabled</option>
                    <option value={1}>Mirostat 1</option>
                    <option value={2}>Mirostat 2.0</option>
                  </select>
                </div>
                <Slider
                  label="Mirostat Tau"
                  value={llmSettings.mirostatTau ?? 5}
                  onChange={(v) => updateSetting('mirostatTau', v)}
                  min={0}
                  max={10}
                  step={0.1}
                  info="Target entropy (perplexity). Lower = more focused, higher = more random."
                />
                <Slider
                  label="Mirostat Eta"
                  value={llmSettings.mirostatEta ?? 0.1}
                  onChange={(v) => updateSetting('mirostatEta', v)}
                  min={0}
                  max={1}
                  step={0.01}
                  info="Learning rate. How fast Mirostat adjusts."
                />
              </div>
            </div>
            )}
          </div>

          {/* Sub-collapsible: Stop Sequences & Token Control */}
          <div className="settings-subsection-collapsible">
            <div className="settings-subsection-header" onClick={() => toggleSection('stopSequences')}>
              <span>Stop Sequences, Tokens & Generation</span>
              <span className="collapse-icon">{expandedSections.stopSequences ? '▼' : '▶'}</span>
            </div>
            {expandedSections.stopSequences && (
            <div className="settings-subsection-content">
              <div className="form-group">
                <label>Stop Sequences</label>
                <input
                  type="text"
                  value={(llmSettings.stopSequences || []).join(', ')}
                  onChange={(e) => {
                    const sequences = e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s.length > 0);
                    updateSetting('stopSequences', sequences);
                  }}
                  placeholder="e.g., \nUser:, \n###, </s>"
                />
                <span className="form-hint">Comma-separated sequences that stop generation</span>
              </div>
              <div className="form-group">
                <label>Banned Tokens</label>
                <input
                  type="text"
                  value={(llmSettings.bannedTokens || []).join(', ')}
                  onChange={(e) => {
                    const tokens = e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s.length > 0);
                    updateSetting('bannedTokens', tokens);
                  }}
                  placeholder="e.g., [, ], <|"
                />
                <span className="form-hint">Comma-separated. KoboldCpp accepts strings; on llama.cpp only numeric token IDs are banned (text entries are ignored).</span>
              </div>
              <div className="form-group">
                <label>Banned Strings (Anti-Slop)</label>
                <input
                  type="text"
                  value={(llmSettings.bannedStrings || []).join(', ')}
                  onChange={(e) => {
                    const strings = e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s.length > 0);
                    updateSetting('bannedStrings', strings);
                  }}
                  placeholder="e.g., shivers down, ministrations"
                />
                <span className="form-hint">KoboldCpp only — phrases the model backtracks &amp; avoids (distinct from stop strings, which halt).</span>
              </div>
              <div className="form-group">
                <label>Custom Token Bias / Bans (logit_bias)</label>
                <input
                  type="text"
                  value={(llmSettings.logitBias || []).map(p => `${p[0]}:${p[1]}`).join(', ')}
                  onChange={(e) => {
                    const pairs = e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s.includes(':'))
                      .map(s => {
                        const [id, bias] = s.split(':').map(x => x.trim());
                        return [parseInt(id), Number(bias)];
                      })
                      .filter(p => !Number.isNaN(p[0]) && !Number.isNaN(p[1]));
                    updateSetting('logitBias', pairs);
                  }}
                  placeholder="tokenId:bias  e.g. 128009:-100, 5618:2"
                />
                <span className="form-hint">Per-token-ID bias (both backends). Use a large negative bias (e.g. -100) to hard-ban a token.</span>
              </div>
              <div className="form-group">
                <label>Grammar (GBNF)</label>
                <textarea
                  value={llmSettings.grammar || ''}
                  onChange={(e) => updateSetting('grammar', e.target.value)}
                  placeholder="GBNF grammar for structured output (leave empty to disable)"
                  rows={4}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 'var(--font-size-sm)' }}
                />
                <span className="form-hint">GBNF grammar to constrain output format (JSON, etc.)</span>
              </div>

              {/* Generation / tokenization controls — sampler-level token flags,
                  deliberately separate from the stop-string list above. */}
              <div className="settings-divider" />
              <div className="form-group">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={llmSettings.banEosToken === true}
                    onChange={(e) => updateSetting('banEosToken', e.target.checked)}
                  />
                  <span>Ban EOS Token (don't let the model end its own turn)</span>
                </label>
                <span className="form-hint">
                  Forces generation to run to the token limit / a stop string instead of stopping at the model's
                  end-of-turn token. Useful for story/continuation modes; usually OFF for chat. This is a sampler flag,
                  NOT a stop string.
                </span>
              </div>
              <div className="form-group">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={llmSettings.skipSpecialTokens !== false}
                    onChange={(e) => updateSetting('skipSpecialTokens', e.target.checked)}
                  />
                  <span>Skip special tokens in output (KoboldCpp)</span>
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={llmSettings.addBosToken !== false}
                    onChange={(e) => updateSetting('addBosToken', e.target.checked)}
                  />
                  <span>Add BOS token (KoboldCpp)</span>
                </label>
                <span className="form-hint">Turn off if your prompt template already injects a BOS marker (avoids double-BOS).</span>
              </div>
              <div className="form-group">
                <label>Seed</label>
                <input
                  type="number"
                  value={llmSettings.seed ?? -1}
                  onChange={(e) => updateSetting('seed', parseInt(e.target.value))}
                  placeholder="-1"
                />
                <span className="form-hint">-1 = random each generation. Set a fixed value for reproducible output.</span>
              </div>
              <div className="form-group">
                <label>Keep Leading Tokens (n_keep, llama.cpp)</label>
                <input
                  type="number"
                  value={llmSettings.nKeep ?? 0}
                  onChange={(e) => updateSetting('nKeep', parseInt(e.target.value))}
                  placeholder="0"
                />
                <span className="form-hint">Leading prompt tokens (e.g. system prompt / character card) to retain when context overflows. 0 = none, -1 = all.</span>
              </div>
            </div>
            )}
          </div>

        </div>
        )}
      </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ModelTab;
