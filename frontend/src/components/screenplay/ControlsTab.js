import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './ScreenPlayTabs.css';

// Default core definition
const DEFAULT_CORE_DEFINITION = `Belly inflation is the practice of inflating one's belly with air, water, or other substances to make it swell tight like a balloon. This is NOT pregnancy. It's about the sensation of fullness, tightness, pressure, and expansion. The belly becomes round, firm, and drum-tight as it grows larger.

Key sensations: pressure building, skin stretching taut, growing tightness, overwhelming fullness, the belly becoming hard and round like a ball.`;

function ControlsTab() {
  const { settings, api } = useApp();
  const [coreDefinition, setCoreDefinition] = useState(DEFAULT_CORE_DEFINITION);
  const [additionalDefinitions, setAdditionalDefinitions] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load definitions from settings
  useEffect(() => {
    if (settings?.screenplayCoreDefinition !== undefined) {
      setCoreDefinition(settings.screenplayCoreDefinition || DEFAULT_CORE_DEFINITION);
    }
    if (settings?.screenplayAdditionalDefinitions !== undefined) {
      setAdditionalDefinitions(settings.screenplayAdditionalDefinitions || '');
    }
    setHasChanges(false);
  }, [settings?.screenplayCoreDefinition, settings?.screenplayAdditionalDefinitions]);

  const handleCoreDefinitionChange = (value) => {
    setCoreDefinition(value);
    setHasChanges(true);
  };

  const handleAdditionalChange = (value) => {
    setAdditionalDefinitions(value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save both core and additional definitions
      const fullDefinitions = coreDefinition + (additionalDefinitions ? '\n\n' + additionalDefinitions : '');
      await api.updateSettings({
        ...settings,
        screenplayCoreDefinition: coreDefinition,
        screenplayDefinitions: fullDefinitions,
        screenplayAdditionalDefinitions: additionalDefinitions
      });
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save definitions:', err);
    }
    setSaving(false);
  };

  const handleDiscard = () => {
    setCoreDefinition(settings?.screenplayCoreDefinition || DEFAULT_CORE_DEFINITION);
    setAdditionalDefinitions(settings?.screenplayAdditionalDefinitions || '');
    setHasChanges(false);
  };

  const handleResetCore = () => {
    setCoreDefinition(DEFAULT_CORE_DEFINITION);
    setHasChanges(true);
  };

  return (
    <div className="controls-tab">
      <div className="tab-header">
        <h2>Controls</h2>
      </div>

      <div className="controls-section">
        <h3>Definitions</h3>
        <p className="section-description">
          Context provided to the LLM for all plays. The core definition below is always included.
        </p>

        <div className="form-group">
          <div className="label-row">
            <label>Core Definition</label>
            <button
              className="btn btn-xs btn-secondary"
              onClick={handleResetCore}
              title="Reset to default"
            >
              Reset Default
            </button>
          </div>
          <textarea
            value={coreDefinition}
            onChange={(e) => handleCoreDefinitionChange(e.target.value)}
            rows={6}
            className="definitions-textarea"
          />
        </div>

        <div className="form-group">
          <label>Additional Definitions (optional)</label>
          <textarea
            value={additionalDefinitions}
            onChange={(e) => handleAdditionalChange(e.target.value)}
            placeholder="Add any additional context, terms, or themes you want the LLM to know about..."
            rows={4}
            className="definitions-textarea"
          />
        </div>

        {hasChanges && (
          <div className="form-actions">
            <button
              className="btn btn-secondary"
              onClick={handleDiscard}
              disabled={saving}
            >
              Discard
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="controls-section">
        <h3>Default Settings</h3>
        <p className="section-hint">More settings coming soon...</p>
      </div>
    </div>
  );
}

export default ControlsTab;
