import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';

// Pump/device behavior controls, migrated out of "Global Character Controls" into the
// Automatic Pumps → Settings sub-tab. All values persist to settings.globalCharacterControls.
function PumpSettings() {
  const { settings, api } = useApp();
  const [cc, setCc] = useState(settings?.globalCharacterControls || {});

  useEffect(() => {
    if (settings?.globalCharacterControls) setCc(settings.globalCharacterControls);
  }, [settings?.globalCharacterControls]);

  const update = useCallback((key, value) => {
    setCc(prev => {
      const next = { ...prev, [key]: value };
      api.updateSettings?.({ globalCharacterControls: next }).catch(() => {});
      return next;
    });
  }, [api]);

  // On-by-default master switches (undefined => on).
  const master = cc.allowLlmDeviceControl ?? true;
  const autoCap = cc.useAutoCapacity ?? true;

  return (
    <div className="pump-settings">
      <p className="section-description">
        How the AI drives pumps and how capacity is tracked. These apply to every card.
      </p>

      {/* 1. AI Pump Control master switch (on by default) */}
      <div className="character-control-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={master}
            onChange={(e) => update('allowLlmDeviceControl', e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
        <div className="control-label-group">
          <span className="toggle-label">AI Pump Control (Master Switch)</span>
          <span className="control-hint">The AI can operate pumps and devices by including [pump on], [vibe on], etc. in its responses. Master switch for all AI device control.</span>
        </div>
      </div>

      {/* 2. Max On Duration + Max Pulses on one row (only when the master switch is on) */}
      {master && (
        <div className="character-control-row sub-control" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="control-inline-label">Max On Duration:</label>
            <input type="number" min="5" max="300" step="5" className="control-number-input"
              value={cc.llmDeviceControlMaxSeconds ?? 30}
              onChange={(e) => update('llmDeviceControlMaxSeconds', parseInt(e.target.value) || 30)} />
            <span className="control-inline-hint">sec</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="control-inline-label">Max Pulses:</label>
            <input type="number" min="1" max="30" step="1" className="control-number-input"
              value={cc.llmDeviceControlPulseDuration ?? 3}
              onChange={(e) => update('llmDeviceControlPulseDuration', parseInt(e.target.value) || 3)} />
            <span className="control-inline-hint">per rhythmic/pulse phrase</span>
          </div>
        </div>
      )}

      {/* 3. Pump Trigger Phrase Assist (off by default) */}
      <div className="character-control-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={!!cc.allowProseReinforcement}
            onChange={(e) => update('allowProseReinforcement', e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
        <div className="control-label-group">
          <span className="toggle-label">Pump Trigger Phrase Assist</span>
          <span className="control-hint">Helps weaker models: scans the AI's narration for pump trigger phrases and fires the pump even when it forgets the [pump on] tag. Off by default. (Turning the pump OFF from narration is always on.)</span>
        </div>
      </div>

      <hr className="control-divider" />

      {/* 4. Use Auto-Capacity (on by default) */}
      <div className="character-control-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={autoCap}
            onChange={(e) => update('useAutoCapacity', e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
        <div className="control-label-group">
          <span className="toggle-label">Use Auto-Capacity</span>
          <span className="control-hint">Track capacity automatically from a calibrated pump's run time. Calibrate pumps in the Pumps tab.</span>
        </div>
      </div>

      {/* 5. Allow Over-Inflation */}
      <div className="character-control-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={!!cc.allowOverInflation}
            onChange={(e) => update('allowOverInflation', e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
        <div className="control-label-group">
          <span className="toggle-label">Allow Over-Inflation</span>
          <span className="control-hint">When OFF, pumps auto-stop at 100% capacity and cannot be reactivated until capacity drops.</span>
        </div>
      </div>

      {/* 6. Capacity Multiplier */}
      <div className="character-control-row">
        <label className="control-inline-label">Capacity Multiplier:</label>
        <input type="range" min="0.25" max="3" step="0.25" className="multiplier-slider"
          value={cc.autoCapacityMultiplier ?? 1.0}
          onChange={(e) => update('autoCapacityMultiplier', parseFloat(e.target.value))} />
        <span className="multiplier-value">{cc.autoCapacityMultiplier ?? 1.0}x</span>
        <span className="control-inline-hint">Speed of capacity tracking (1x = calibrated rate)</span>
      </div>

      <hr className="control-divider" />

      {/* 7. Auto-Pop Roleplay + Hide from Details */}
      <div className="character-control-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={!!cc.enableAutoPopRoleplay}
            onChange={(e) => update('enableAutoPopRoleplay', e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
        <div className="control-label-group">
          <span className="toggle-label">Enable Auto-Pop Roleplay</span>
          {!cc.allowOverInflation ? (
            <span className="control-hint">Display POP portrait at 100% capacity.</span>
          ) : (
            <div className="control-hint auto-pop-options">
              <label className="radio-option">
                <input type="radio" name="autoPopMode" checked={(cc.autoPopMode || 'fixed') === 'fixed'}
                  onChange={() => update('autoPopMode', 'fixed')} disabled={!cc.enableAutoPopRoleplay} />
                <span>Display POP portrait at</span>
                <input type="number" min="100" max="999" className="auto-pop-input"
                  value={cc.autoPopFixedPercent ?? 110}
                  onChange={(e) => update('autoPopFixedPercent', parseInt(e.target.value) || 100)}
                  disabled={!cc.enableAutoPopRoleplay || (cc.autoPopMode || 'fixed') !== 'fixed'} />
                <span>%</span>
              </label>
              <label className="radio-option">
                <input type="radio" name="autoPopMode" checked={cc.autoPopMode === 'random'}
                  onChange={() => update('autoPopMode', 'random')} disabled={!cc.enableAutoPopRoleplay} />
                <span>Random between</span>
                <input type="number" min="100" max="999" className="auto-pop-input"
                  value={cc.autoPopRandomMin ?? 100}
                  onChange={(e) => update('autoPopRandomMin', parseInt(e.target.value) || 100)}
                  disabled={!cc.enableAutoPopRoleplay || cc.autoPopMode !== 'random'} />
                <span>% and</span>
                <input type="number" min="100" max="999" className="auto-pop-input"
                  value={cc.autoPopRandomMax ?? 150}
                  onChange={(e) => update('autoPopRandomMax', parseInt(e.target.value) || 150)}
                  disabled={!cc.enableAutoPopRoleplay || cc.autoPopMode !== 'random'} />
                <span>%</span>
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="character-control-row">
        <label className="toggle-switch">
          <input type="checkbox" checked={cc.hidePlayerBurstFromDetails ?? true}
            onChange={(e) => update('hidePlayerBurstFromDetails', e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
        <div className="control-label-group">
          <span className="toggle-label">Hide from Details Panel</span>
          <span className="control-hint">Hide the player Auto-Pop threshold from the info panel below the character portrait.</span>
        </div>
      </div>
    </div>
  );
}

export default PumpSettings;
