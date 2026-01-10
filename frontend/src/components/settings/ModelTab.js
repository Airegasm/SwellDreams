import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './ModelTab.css';

const API_BASE = `http://${window.location.hostname}:8889`;

// Reusable Slider component
function Slider({ label, value, onChange, min, max, step = 0.01, defaultValue, info }) {
  return (
    <div className="slider-container">
      <div className="slider-header">
        <span className="slider-label">
          {label}
          {info && <span className="info-icon" title={info}>?</span>}
        </span>
        <span className="slider-value">{value}</span>
      </div>
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

function ModelTab() {
  const { settings, api } = useApp();
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
  const [openRouterApiKey, setOpenRouterApiKey] = useState(settings.llm?.openRouterApiKey || '');
  const [openRouterModels, setOpenRouterModels] = useState([]);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState(settings.llm?.openRouterModel || '');
  const [modelSortOrder, setModelSortOrder] = useState('cost-low');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [openRouterConnecting, setOpenRouterConnecting] = useState(false);
  const [openRouterError, setOpenRouterError] = useState(null);


  const updateSetting = async (key, value) => {
    const newSettings = { ...llmSettings, [key]: value };
    setLlmSettings(newSettings);
    setSaved(false);

    // Auto-save after change
    try {
      await api.updateLlmSettings(newSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to auto-save settings:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateLlmSettings(llmSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
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
        // Auto-save on successful connection
        await api.updateLlmSettings(llmSettings);
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

  // Handle endpoint standard change
  const handleEndpointStandardChange = async (value) => {
    setEndpointStandard(value);
    // Reset connection status when switching endpoints
    setConnectionStatus('offline');
    setModelStatus('');
    setOpenRouterError(null);

    const newSettings = { ...llmSettings, endpointStandard: value };
    setLlmSettings(newSettings);
    try {
      await api.updateLlmSettings(newSettings);
      // If switching to non-OpenRouter, trigger connection test
      if (value !== 'openrouter' && llmSettings.llmUrl) {
        handleTest();
      }
    } catch (error) {
      console.error('Failed to save endpoint standard:', error);
    }
  };

  // Connect to OpenRouter
  const handleOpenRouterConnect = async () => {
    if (!openRouterApiKey.trim()) {
      setOpenRouterError('Please enter an API key');
      return;
    }

    setOpenRouterConnecting(true);
    setOpenRouterError(null);

    try {
      const response = await fetch(`${API_BASE}/api/openrouter/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: openRouterApiKey })
      });
      const result = await response.json();

      if (result.success) {
        setOpenRouterModels(result.models);
        setConnectionStatus('online');
        setModelStatus(`${result.models.length} models available`);

        // Save the API key to settings
        const newSettings = {
          ...llmSettings,
          endpointStandard: 'openrouter',
          openRouterApiKey: openRouterApiKey
        };
        setLlmSettings(newSettings);
        await api.updateLlmSettings(newSettings);
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
      await api.updateLlmSettings(newSettings);
    } catch (error) {
      console.error('Failed to save model selection:', error);
    }
  };

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
          if (loadedSettings.llm.openRouterApiKey) {
            setOpenRouterApiKey(loadedSettings.llm.openRouterApiKey);
          }
          if (loadedSettings.llm.openRouterModel) {
            setSelectedOpenRouterModel(loadedSettings.llm.openRouterModel);
          }
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };
    loadSettings();
    // eslint-disable-next-line
  }, []);

  // Auto-test when settings are loaded and URL exists
  useEffect(() => {
    if (llmSettings.llmUrl && connectionStatus === 'offline') {
      handleTest();
    }
    // eslint-disable-next-line
  }, [llmSettings.llmUrl]);

  // Load connection profiles on mount
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const profiles = await api.getConnectionProfiles();
        setConnectionProfiles(profiles);
        // Set selected profile if one is active
        if (settings.llm?.activeProfileId) {
          setSelectedProfileId(settings.llm.activeProfileId);
        }
      } catch (error) {
        console.error('Failed to load connection profiles:', error);
      }
    };
    loadProfiles();
    // eslint-disable-next-line
  }, []);

  // Auto-connect to OpenRouter if API key is saved
  useEffect(() => {
    const autoConnectOpenRouter = async () => {
      if (endpointStandard === 'openrouter' && openRouterApiKey && openRouterModels.length === 0 && !openRouterConnecting) {
        // First try to get cached models from backend
        try {
          const response = await fetch(`${API_BASE}/api/openrouter/models`);
          const data = await response.json();
          if (data.models && data.models.length > 0) {
            setOpenRouterModels(data.models);
            setConnectionStatus('online');
            // If we have a previously selected model, show its name
            if (selectedOpenRouterModel) {
              const savedModel = data.models.find(m => m.id === selectedOpenRouterModel);
              if (savedModel) {
                setModelStatus(savedModel.name || savedModel.id);
              } else {
                setModelStatus(`${data.models.length} models available`);
              }
            } else {
              setModelStatus(`${data.models.length} models available`);
            }
            return;
          }
        } catch (e) {
          // Cached models not available, try to connect
        }
        // If no cached models, auto-connect
        handleOpenRouterConnect();
      }
    };
    autoConnectOpenRouter();
    // eslint-disable-next-line
  }, [endpointStandard, openRouterApiKey]);

  // Update model status when models load and we have a saved selection
  useEffect(() => {
    if (openRouterModels.length > 0 && selectedOpenRouterModel) {
      const savedModel = openRouterModels.find(m => m.id === selectedOpenRouterModel);
      if (savedModel) {
        setModelStatus(savedModel.name || savedModel.id);
      }
    }
  }, [openRouterModels, selectedOpenRouterModel]);

  // Handle profile selection
  const handleProfileSelect = async (profileId) => {
    if (!profileId || profileId === 'none') {
      setSelectedProfileId(null);
      return;
    }
    if (profileId === 'new') {
      setShowNewProfileInput(true);
      return;
    }
    try {
      const result = await api.activateConnectionProfile(profileId);
      if (result.success && result.settings?.llm) {
        setLlmSettings(result.settings.llm);
        setSelectedProfileId(profileId);
        // Restore endpoint standard and OpenRouter settings
        if (result.settings.llm.endpointStandard) {
          setEndpointStandard(result.settings.llm.endpointStandard);
        }
        if (result.settings.llm.openRouterApiKey) {
          setOpenRouterApiKey(result.settings.llm.openRouterApiKey);
        }
        if (result.settings.llm.openRouterModel) {
          setSelectedOpenRouterModel(result.settings.llm.openRouterModel);
        }
        setConnectionStatus('offline'); // Trigger re-test
        setOpenRouterModels([]); // Clear models to trigger re-fetch if OpenRouter
      }
    } catch (error) {
      console.error('Failed to activate profile:', error);
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
      <div className="tab-header">
        <h3>Model Settings</h3>
        <span className="model-status">{modelStatus}</span>
      </div>

      <div className="model-tab">
        {/* Connection Profiles */}
        <div className="settings-section" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
            <label style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>Connection Profile:</label>
            <select
              value={selectedProfileId || 'none'}
              onChange={(e) => handleProfileSelect(e.target.value)}
              style={{ padding: '6px 12px', minWidth: '180px' }}
            >
              <option value="none">-- No Profile --</option>
              {connectionProfiles.map(profile => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
              <option value="new">+ Save as New Profile...</option>
            </select>
            {selectedProfileId && (
              <>
                <button
                  onClick={handleUpdateProfile}
                  className="btn-secondary"
                  style={{ padding: '6px 12px' }}
                  title="Update profile with current settings"
                >
                  Update
                </button>
                <button
                  onClick={handleDeleteProfile}
                  className="btn-danger"
                  style={{ padding: '6px 12px' }}
                  title="Delete this profile"
                >
                  Delete
                </button>
              </>
            )}
          </div>
          {showNewProfileInput && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-md)' }}>
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Profile name (e.g., Lyonade, Local LLM)"
                style={{ flex: 1, padding: '6px 12px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveNewProfile()}
                autoFocus
              />
              <button
                onClick={handleSaveNewProfile}
                className="btn-primary"
                style={{ padding: '6px 12px' }}
                disabled={!newProfileName.trim()}
              >
                Save
              </button>
              <button
                onClick={() => { setShowNewProfileInput(false); setNewProfileName(''); }}
                className="btn-secondary"
                style={{ padding: '6px 12px' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Endpoint Standard */}
        <div className="settings-section" style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
            <label style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>Endpoint Standard:</label>
            <select
              value={endpointStandard}
              onChange={(e) => handleEndpointStandardChange(e.target.value)}
              style={{ padding: '6px 12px', minWidth: '180px' }}
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="kobold">KoboldCPP</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
        </div>

        {/* OpenRouter Settings */}
        {endpointStandard === 'openrouter' ? (
          <>
            {/* OpenRouter Connection */}
            <div className="settings-section">
              <h3>OpenRouter Connection</h3>
              <div className="form-group">
                <label>API URL</label>
                <input
                  type="text"
                  value="https://openrouter.ai/api/v1/chat/completions"
                  disabled
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                />
              </div>
              <div className="form-group">
                <label>API Key</label>
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                  <input
                    type="password"
                    value={openRouterApiKey}
                    onChange={(e) => setOpenRouterApiKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    style={{ flex: 1 }}
                  />
                  <button
                    className={`btn ${connectionStatus === 'online' && openRouterModels.length > 0 ? 'btn-success' : 'btn-primary'}`}
                    onClick={handleOpenRouterConnect}
                    disabled={openRouterConnecting || !openRouterApiKey.trim()}
                  >
                    {openRouterConnecting ? 'Connecting...' : connectionStatus === 'online' && openRouterModels.length > 0 ? 'Connected' : 'Connect'}
                  </button>
                </div>
                {openRouterError && (
                  <span className="form-hint" style={{ color: 'var(--error)' }}>{openRouterError}</span>
                )}
              </div>
            </div>

            {/* OpenRouter Models List */}
            {openRouterModels.length > 0 && (
              <div className="settings-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                  <h3 style={{ margin: 0 }}>
                    Models ({sortedOpenRouterModels.length}{modelSearchQuery ? ` of ${openRouterModels.length}` : ''})
                  </h3>
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

            {/* OpenRouter Generation Settings */}
            {selectedOpenRouterModel && (
              <>
                <div className="settings-section">
                  <h3>Token Settings</h3>
                  <div className="settings-grid">
                    <div className="form-group">
                      <label>Max Tokens (Response)</label>
                      <input
                        type="number"
                        value={llmSettings.maxTokens || 300}
                        onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
                        min={1}
                        max={32768}
                      />
                    </div>
                    <div className="form-group">
                      <label>Context Window</label>
                      <input
                        type="number"
                        value={llmSettings.contextTokens || 8192}
                        onChange={(e) => updateSetting('contextTokens', parseInt(e.target.value))}
                        min={512}
                        max={200000}
                      />
                    </div>
                  </div>
                  <label className="checkbox-container" style={{ marginTop: 'var(--spacing-md)' }}>
                    <input
                      type="checkbox"
                      checked={llmSettings.streaming ?? true}
                      onChange={(e) => updateSetting('streaming', e.target.checked)}
                    />
                    <span>Streaming</span>
                  </label>
                </div>

                <div className="settings-section">
                  <h3>Sampler Settings</h3>
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
              </>
            )}
          </>
        ) : (
          <>
        {/* LLM URL */}
        <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <h3 style={{ margin: 0 }}>LLM Connection</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
            <select
              value={llmSettings.apiType || 'auto'}
              onChange={(e) => updateSetting('apiType', e.target.value)}
              style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
              title="API Type"
            >
              <option value="auto">Auto-detect</option>
              <option value="text_completion">Text Completion</option>
              <option value="chat_completion">Chat Completion</option>
            </select>
            <select
              value={llmSettings.promptTemplate || 'none'}
              onChange={(e) => updateSetting('promptTemplate', e.target.value)}
              style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
              title="Instruct Template (for text completion)"
            >
              <option value="none">No Template</option>
              <option value="chatml">ChatML</option>
              <option value="llama">Llama 2</option>
              <option value="mistral">Mistral</option>
              <option value="alpaca">Alpaca</option>
              <option value="vicuna">Vicuna</option>
            </select>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)' }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: connectionStatus === 'online' ? '#10b981' : '#ef4444',
                display: 'inline-block'
              }}></span>
              {connectionStatus === 'online' ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="form-group">
          <label>LLM API URL</label>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <input
              type="text"
              value={llmSettings.llmUrl || ''}
              onChange={(e) => updateSetting('llmUrl', e.target.value)}
              placeholder="http://localhost:5001/api/v1/generate or http://localhost:1234/v1/chat/completions"
              style={{ flex: 1 }}
            />
            <button
              className={`btn ${connectionStatus === 'online' ? 'btn-danger' : 'btn-secondary'}`}
              onClick={connectionStatus === 'online' ? handleDisconnect : handleTest}
              disabled={!llmSettings.llmUrl || testing}
              style={{ whiteSpace: 'nowrap' }}
            >
              {testing ? 'Connecting...' : connectionStatus === 'online' ? 'Disconnect' : 'Connect'}
            </button>
          </div>
          <span className="form-hint">
            KoboldCpp: /api/v1/generate | OpenAI-compatible: /v1/chat/completions
          </span>
        </div>
      </div>

      {/* Token Settings */}
      <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <h3 style={{ margin: 0 }}>Token Settings</h3>
          <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
            <label className="checkbox-container">
              <input
                type="checkbox"
                checked={llmSettings.trimIncompleteSentences ?? true}
                onChange={(e) => updateSetting('trimIncompleteSentences', e.target.checked)}
              />
              <span>Trim Incomplete Sentences</span>
              <span className="info-icon" title="Remove incomplete sentences from the end of responses">?</span>
            </label>
            <label className="checkbox-container">
              <input
                type="checkbox"
                checked={llmSettings.streaming ?? true}
                onChange={(e) => updateSetting('streaming', e.target.checked)}
              />
              <span>Streaming</span>
              <span className="info-icon" title="Stream responses token by token">?</span>
            </label>
          </div>
        </div>
        <div className="settings-grid">
          <div className="form-group">
            <label>Response (tokens)</label>
            <input
              type="number"
              value={llmSettings.maxTokens || 300}
              onChange={(e) => updateSetting('maxTokens', parseInt(e.target.value))}
              min={1}
              max={4096}
            />
          </div>
          <div className="form-group">
            <label>Context (tokens)</label>
            <input
              type="number"
              value={llmSettings.contextTokens || 8192}
              onChange={(e) => updateSetting('contextTokens', parseInt(e.target.value))}
              min={512}
              max={131072}
            />
          </div>
        </div>
      </div>

      {/* Sampler Controls */}
      <div className="settings-section">
        <div className="section-header">
          <h3>Sampler Settings</h3>
          <div className="sampler-buttons">
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

      {/* Repetition Penalty Settings */}
      <div className="settings-section">
        <h3>Repetition Penalty</h3>

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

      {/* DRY Repetition Penalty (KoboldCpp) */}
      <div className="settings-section">
        <h3>DRY Repetition Penalty <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>(KoboldCpp)</span></h3>

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

      {/* XTC - Exclude Top Choices (KoboldCpp) */}
      <div className="settings-section">
        <h3>XTC <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>(KoboldCpp)</span></h3>

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

      {/* Smoothing (KoboldCpp) */}
      <div className="settings-section">
        <h3>Smoothing <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>(KoboldCpp)</span></h3>

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

      {/* Dynamic Temperature (KoboldCpp) */}
      <div className="settings-section">
        <h3>Dynamic Temperature <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>(KoboldCpp)</span></h3>
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

      {/* Mirostat (KoboldCpp) */}
      <div className="settings-section">
        <h3>Mirostat <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>(KoboldCpp)</span></h3>
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

      {/* Stop Sequences & Token Control (KoboldCpp) */}
      <div className="settings-section">
        <h3>Stop Sequences & Token Control <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>(KoboldCpp)</span></h3>

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
          <span className="form-hint">Comma-separated tokens to ban from generation</span>
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
      </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ModelTab;
