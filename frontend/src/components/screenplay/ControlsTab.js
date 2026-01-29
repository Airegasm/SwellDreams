import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './ScreenPlayTabs.css';

// Immutable core definition - always included
const CORE_DEFINITION = `Belly inflation is the practice of inflating one's belly with air, water, or other substances to make it swell tight like a balloon. This is NOT pregnancy. It's about the sensation of fullness, tightness, pressure, and expansion. The belly becomes round, firm, and drum-tight as it grows larger.

Key sensations: pressure building, skin stretching taut, growing tightness, overwhelming fullness, the belly becoming hard and round like a ball.`;

function ControlsTab() {
  const { settings, api } = useApp();
  const [additionalDefinitions, setAdditionalDefinitions] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load additional definitions from settings
  useEffect(() => {
    if (settings?.screenplayAdditionalDefinitions !== undefined) {
      setAdditionalDefinitions(settings.screenplayAdditionalDefinitions || '');
      setHasChanges(false);
    }
  }, [settings?.screenplayAdditionalDefinitions]);

  const handleDefinitionsChange = (value) => {
    setAdditionalDefinitions(value);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save the full combined definition and the additional part separately
      await api.updateSettings({
        ...settings,
        screenplayDefinitions: CORE_DEFINITION + (additionalDefinitions ? '\n\n' + additionalDefinitions : ''),
        screenplayAdditionalDefinitions: additionalDefinitions
      });
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save definitions:', err);
    }
    setSaving(false);
  };

  const handleDiscard = () => {
    setAdditionalDefinitions(settings?.screenplayAdditionalDefinitions || '');
    setHasChanges(false);
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
          <label>Core Definition (immutable)</label>
          <textarea
            value={CORE_DEFINITION}
            readOnly
            disabled
            rows={6}
            className="definitions-textarea immutable"
          />
        </div>

        <div className="form-group">
          <label>Additional Definitions (optional)</label>
          <textarea
            value={additionalDefinitions}
            onChange={(e) => handleDefinitionsChange(e.target.value)}
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
