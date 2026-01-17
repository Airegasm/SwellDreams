import React from 'react';
import NumberInput from './NumberInput';
import './Nodes.css';

/**
 * ActionWrapper - Consistent pre/post message wrapper for ACTION and CHALLENGE nodes
 *
 * Provides:
 * - Pre-Action Message section (enable, suppress LLM, character/persona target, text, delay)
 * - Children (main action/challenge content)
 * - Post-Action Message section (enable, suppress LLM, character/persona target, text, delay)
 */
function ActionWrapper({ data, children }) {
  const renderMessageSection = (prefix, label) => {
    const enabledKey = `${prefix}MessageEnabled`;
    const messageKey = `${prefix}Message`;
    const suppressKey = `${prefix}MessageSuppressLlm`;
    const targetKey = `${prefix}MessageTarget`;
    const delayKey = `${prefix}Delay`;

    const isEnabled = data[enabledKey] || false;

    return (
      <div className="wrapper-section">
        <div className="wrapper-section-header">
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => data.onChange?.(enabledKey, e.target.checked)}
            />
            {label}
          </label>
        </div>
        {isEnabled && (
          <div className="wrapper-section-content">
            <div className="wrapper-options-row">
              <label className="node-checkbox small">
                <input
                  type="checkbox"
                  checked={data[suppressKey] || false}
                  onChange={(e) => data.onChange?.(suppressKey, e.target.checked)}
                />
                Suppress LLM
              </label>
              <select
                value={data[targetKey] || 'character'}
                onChange={(e) => data.onChange?.(targetKey, e.target.value)}
                className="node-select small"
              >
                <option value="character">Character</option>
                <option value="persona">Persona</option>
              </select>
            </div>
            <textarea
              value={data[messageKey] || ''}
              onChange={(e) => data.onChange?.(messageKey, e.target.value)}
              placeholder="Enter message..."
              className="node-textarea"
              rows={2}
            />
            <div className="wrapper-delay-row">
              <label>Delay:</label>
              <NumberInput
                value={data[delayKey]}
                onChange={(val) => data.onChange?.(delayKey, val)}
                defaultValue={0}
                min={0}
                step={0.5}
                className="node-input tiny"
                allowFloat={true}
              />
              <span>s</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="action-wrapper">
      {renderMessageSection('pre', 'Pre-Action Message')}

      <div className="wrapper-main-content">
        {children}
      </div>

      {renderMessageSection('post', 'Post-Action Message')}
    </div>
  );
}

export default ActionWrapper;
