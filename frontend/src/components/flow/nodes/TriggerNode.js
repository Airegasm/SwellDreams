import React, { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { EMOTIONS, PAIN_SCALE } from '../../../constants/stateValues';
import NumberInput from './NumberInput';
import './Nodes.css';

function TriggerNode({ data, selected }) {
  // Common trigger options (Priority, Unblockable, Notify)
  const renderTriggerOptions = () => (
    <div className="trigger-options">
      <div className="trigger-options-row">
        <label className="node-checkbox" title="Flow can run even when other flows are active">
          <input
            type="checkbox"
            checked={data.unblockable || false}
            onChange={(e) => data.onChange?.('unblockable', e.target.checked)}
          />
          Unblockable
        </label>
        <label className="node-checkbox" title="Show toast notifications for this flow">
          <input
            type="checkbox"
            checked={data.notify || false}
            onChange={(e) => data.onChange?.('notify', e.target.checked)}
          />
          Notify
        </label>
      </div>
      <div className="priority-row">
        <label className="node-checkbox" title="Enable priority-based flow interruption">
          <input
            type="checkbox"
            checked={data.hasPriority || false}
            onChange={(e) => data.onChange?.('hasPriority', e.target.checked)}
          />
          Priority
        </label>
        {data.hasPriority && (
          <NumberInput
            className="node-input tiny"
            value={data.priority}
            defaultValue={3}
            min={1}
            max={5}
            onChange={(val) => data.onChange?.('priority', Math.min(5, Math.max(1, val)))}
            allowFloat={false}
          />
        )}
      </div>
    </div>
  );

  const renderConfig = () => {
    switch (data.triggerType) {
      case 'device_on':
      case 'device_off':
        return (
          <div className="node-config">
            <select
              value={data.device || ''}
              onChange={(e) => data.onChange?.('device', e.target.value)}
              className="node-select"
            >
              <option value="">Any Device</option>
              <option value="primary_pump">Primary Pump</option>
              {data.devices?.map(d => (
                <option key={d.ip} value={d.ip}>{d.label}</option>
              ))}
            </select>
            {renderTriggerOptions()}
          </div>
        );

      case 'player_speaks':
      case 'ai_speaks': {
        // Support both legacy single keyword and new keywords array
        const keywords = data.keywords || (data.keyword ? [data.keyword] : ['']);

        const addPhrase = () => {
          const newKeywords = [...keywords, ''];
          data.onChange?.('keywords', newKeywords);
        };

        const removePhrase = (index) => {
          if (keywords.length <= 1) return;
          const newKeywords = keywords.filter((_, i) => i !== index);
          data.onChange?.('keywords', newKeywords);
        };

        const updatePhrase = (index, value) => {
          const newKeywords = [...keywords];
          newKeywords[index] = value;
          data.onChange?.('keywords', newKeywords);
        };

        return (
          <div className="node-config phrases-config">
            <div className="phrases-header">
              <span className="phrases-label">Phrases:</span>
              <button className="add-phrase-btn" onClick={addPhrase}>Add Phrase</button>
            </div>
            {keywords.map((keyword, index) => (
              <div key={index} className="phrase-row">
                {keywords.length > 1 && (
                  <button className="phrase-remove" onClick={() => removePhrase(index)}>×</button>
                )}
                <input
                  type="text"
                  value={keyword || ''}
                  onChange={(e) => updatePhrase(index, e.target.value)}
                  placeholder="Pattern (use * for wildcard)"
                  className="node-input"
                />
              </div>
            ))}
            <div className="cooldown-row">
              <span className="cooldown-label">Cooldown:</span>
              <NumberInput
                className="node-input tiny"
                value={data.cooldown}
                defaultValue={5}
                min={0}
                max={100}
                onChange={(val) => data.onChange?.('cooldown', val)}
                allowFloat={false}
              />
              <span className="cooldown-hint">messages</span>
            </div>
            {renderTriggerOptions()}
          </div>
        );
      }

      case 'random':
        return (
          <div className="node-config">
            <NumberInput
              value={data.probability}
              onChange={(val) => data.onChange?.('probability', val)}
              defaultValue={50}
              min={0}
              max={100}
              allowFloat={false}
            />
            <span>% chance</span>
            {renderTriggerOptions()}
          </div>
        );

      case 'idle':
        return (
          <div className="node-config">
            <NumberInput
              value={data.threshold}
              onChange={(val) => data.onChange?.('threshold', val)}
              defaultValue={300}
              min={1}
              allowFloat={false}
            />
            <span>seconds</span>
            {renderTriggerOptions()}
          </div>
        );

      case 'new_session': {
        const variables = data.initialVariables || [];

        const addVariable = () => {
          const nameInput = document.getElementById(`new-var-name-${data.id || 'default'}`);
          const valueInput = document.getElementById(`new-var-value-${data.id || 'default'}`);
          const name = nameInput?.value?.trim();
          const value = valueInput?.value?.trim() || '';

          if (name && !variables.some(v => v.name === name)) {
            data.onChange?.('initialVariables', [...variables, { name, value }]);
            if (nameInput) nameInput.value = '';
            if (valueInput) valueInput.value = '';
          }
        };

        const removeVariable = (index) => {
          const newVars = variables.filter((_, i) => i !== index);
          data.onChange?.('initialVariables', newVars);
        };

        return (
          <div className="node-config">
            <span className="config-hint">Fires once at the start of each new session</span>

            {/* Variable Declaration Section */}
            <div className="variable-declaration-section">
              <div className="var-input-row">
                <input
                  id={`new-var-name-${data.id || 'default'}`}
                  type="text"
                  className="node-input small"
                  placeholder="Variable"
                  onKeyDown={(e) => e.key === 'Enter' && addVariable()}
                />
                <input
                  id={`new-var-value-${data.id || 'default'}`}
                  type="text"
                  className="node-input small"
                  placeholder="Value (optional)"
                  onKeyDown={(e) => e.key === 'Enter' && addVariable()}
                />
                <button className="var-add-btn" onClick={addVariable} title="Add variable">+</button>
              </div>

              {variables.length > 0 && (
                <div className="var-list">
                  {variables.map((v, i) => (
                    <div key={i} className="var-list-item">
                      <span className="var-name">{v.name}</span>
                      {v.value && <span className="var-value">= {v.value}</span>}
                      <button className="var-remove-btn" onClick={() => removeVariable(i)} title="Remove">−</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Alternate Welcome Section */}
            <div className="alternate-welcome-section">
              <div className="section-header">Alternate Welcome</div>
              <div className="welcome-checkboxes">
                <label className="node-checkbox" title="Use this welcome message instead of character settings">
                  <input
                    type="checkbox"
                    checked={data.alternateWelcomeEnabled || false}
                    onChange={(e) => data.onChange?.('alternateWelcomeEnabled', e.target.checked)}
                  />
                  Enable
                </label>
                <label className="node-checkbox" title="Send exactly as written without LLM enhancement">
                  <input
                    type="checkbox"
                    checked={data.suppressWelcomeEnhancement || false}
                    onChange={(e) => data.onChange?.('suppressWelcomeEnhancement', e.target.checked)}
                  />
                  Suppress LLM Enhancement
                </label>
              </div>
              <textarea
                className="node-textarea"
                value={data.alternateWelcome || ''}
                onChange={(e) => data.onChange?.('alternateWelcome', e.target.value)}
                placeholder="Custom welcome message (overrides character welcome)..."
                rows={3}
                disabled={!data.alternateWelcomeEnabled}
              />
            </div>

            {/* Initial Reminder States Section */}
            {((data.globalReminders?.length > 0) || (data.characterReminders?.length > 0)) && (() => {
              const allReminders = [
                ...(data.globalReminders || []).map(r => ({ ...r, isGlobal: true })),
                ...(data.characterReminders || []).map(r => ({ ...r, isGlobal: false }))
              ];
              const addedReminders = Object.entries(data.initialReminderStates || {});
              const availableReminders = allReminders.filter(r => !(data.initialReminderStates || {})[r.id]);

              const addReminder = (reminderId, action) => {
                if (!reminderId) return;
                const newStates = { ...(data.initialReminderStates || {}), [reminderId]: action };
                data.onChange?.('initialReminderStates', newStates);
              };

              const removeReminder = (reminderId) => {
                const newStates = { ...(data.initialReminderStates || {}) };
                delete newStates[reminderId];
                data.onChange?.('initialReminderStates', newStates);
              };

              return (
                <div className="initial-states-section">
                  <div className="section-header">Initial Reminder States</div>
                  <div className="initial-add-row">
                    <select id={`reminder-select-${data.id || 'default'}`} className="node-select small">
                      <option value="">Select...</option>
                      {availableReminders.map(r => (
                        <option key={r.id} value={r.id}>{r.isGlobal ? '[G] ' : '[C] '}{r.name}</option>
                      ))}
                    </select>
                    <select id={`reminder-action-${data.id || 'default'}`} className="node-select tiny">
                      <option value="enable">On</option>
                      <option value="disable">Off</option>
                    </select>
                    <button
                      className="var-add-btn"
                      onClick={() => {
                        const sel = document.getElementById(`reminder-select-${data.id || 'default'}`);
                        const act = document.getElementById(`reminder-action-${data.id || 'default'}`);
                        addReminder(sel?.value, act?.value || 'enable');
                        if (sel) sel.value = '';
                      }}
                      title="Add reminder"
                    >+</button>
                  </div>
                  {addedReminders.length > 0 && (
                    <div className="initial-badges">
                      {addedReminders.map(([id, action]) => {
                        const reminder = allReminders.find(r => r.id === id);
                        if (!reminder) return null;
                        return (
                          <div key={id} className={`initial-badge ${action}`}>
                            <span className="badge-tag">{reminder.isGlobal ? 'G' : 'C'}</span>
                            <span className="badge-name">{reminder.name}</span>
                            <span className="badge-action">{action === 'enable' ? 'ON' : 'OFF'}</span>
                            <button className="badge-remove" onClick={() => removeReminder(id)}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Initial Button States Section */}
            {(data.characterButtons?.length > 0) && (() => {
              const allButtons = data.characterButtons || [];
              const addedButtons = Object.entries(data.initialButtonStates || {});
              const availableButtons = allButtons.filter(b => !(data.initialButtonStates || {})[b.buttonId]);

              const addButton = (buttonId, action) => {
                if (!buttonId) return;
                const newStates = { ...(data.initialButtonStates || {}), [buttonId]: action };
                data.onChange?.('initialButtonStates', newStates);
              };

              const removeButton = (buttonId) => {
                const newStates = { ...(data.initialButtonStates || {}) };
                delete newStates[buttonId];
                data.onChange?.('initialButtonStates', newStates);
              };

              return (
                <div className="initial-states-section">
                  <div className="section-header">Initial Button States</div>
                  <div className="initial-add-row">
                    <select id={`button-select-${data.id || 'default'}`} className="node-select small">
                      <option value="">Select...</option>
                      {availableButtons.map(b => (
                        <option key={b.buttonId} value={b.buttonId}>{b.name}</option>
                      ))}
                    </select>
                    <select id={`button-action-${data.id || 'default'}`} className="node-select tiny">
                      <option value="enable">On</option>
                      <option value="disable">Off</option>
                    </select>
                    <button
                      className="var-add-btn"
                      onClick={() => {
                        const sel = document.getElementById(`button-select-${data.id || 'default'}`);
                        const act = document.getElementById(`button-action-${data.id || 'default'}`);
                        addButton(sel?.value, act?.value || 'enable');
                        if (sel) sel.value = '';
                      }}
                      title="Add button"
                    >+</button>
                  </div>
                  {addedButtons.length > 0 && (
                    <div className="initial-badges">
                      {addedButtons.map(([id, action]) => {
                        const button = allButtons.find(b => String(b.buttonId) === String(id));
                        if (!button) return null;
                        return (
                          <div key={id} className={`initial-badge ${action}`}>
                            <span className="badge-name">{button.name}</span>
                            <span className="badge-action">{action === 'enable' ? 'ON' : 'OFF'}</span>
                            <button className="badge-remove" onClick={() => removeButton(id)}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {renderTriggerOptions()}
          </div>
        );
      }

      case 'player_state_change': {
        // Helper to check if state type supports numeric comparison
        const isNumericState = (type) => type === 'capacity' || type === 'pain' || !type;

        return (
          <div className="node-config">
            {/* State Type Dropdown */}
            <div className="config-row">
              <label>State:</label>
              <select
                className="node-select"
                value={data.stateType || 'capacity'}
                onChange={(e) => {
                  data.onChange?.('stateType', e.target.value);
                  // Reset targetValue when type changes
                  if (e.target.value === 'capacity') {
                    data.onChange?.('targetValue', 50);
                    data.onChange?.('comparison', 'meet');
                  } else if (e.target.value === 'pain') {
                    data.onChange?.('targetValue', 5);
                    data.onChange?.('comparison', 'meet');
                  } else {
                    data.onChange?.('targetValue', 'neutral');
                    data.onChange?.('comparison', 'meet');
                  }
                }}
              >
                <option value="capacity">Capacity (0-100%)</option>
                <option value="pain">Pain (0-10)</option>
                <option value="emotion">Emotion</option>
              </select>
            </div>

            {/* Comparison Dropdown - different options for numeric vs emotion */}
            <div className="config-row">
              <label>When:</label>
              <select
                className="node-select"
                value={data.comparison || 'meet'}
                onChange={(e) => data.onChange?.('comparison', e.target.value)}
              >
                {isNumericState(data.stateType) ? (
                  <>
                    <option value="meet">= (equals)</option>
                    <option value="meet_or_exceed">>= (meet or exceed)</option>
                    <option value="greater">> (greater than)</option>
                    <option value="less">{'<'} (less than)</option>
                    <option value="less_or_equal">{'<='} (less or equal)</option>
                    <option value="range">range (between)</option>
                  </>
                ) : (
                  <>
                    <option value="meet">= (equals)</option>
                    <option value="not_equal">!= (not equals)</option>
                  </>
                )}
              </select>
            </div>

            {/* Conditional Value Input */}
            <div className="config-row">
              <label>Value:</label>
              {data.stateType === 'capacity' || !data.stateType ? (
                data.comparison === 'range' ? (
                  <>
                    <NumberInput
                      className="node-input small"
                      value={data.targetValue}
                      defaultValue={0}
                      min={0}
                      max={100}
                      onChange={(val) => data.onChange?.('targetValue', val)}
                      allowFloat={false}
                    />
                    <span>to</span>
                    <NumberInput
                      className="node-input small"
                      value={data.targetValue2}
                      defaultValue={100}
                      min={0}
                      max={100}
                      onChange={(val) => data.onChange?.('targetValue2', val)}
                      allowFloat={false}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <NumberInput
                      className="node-input small"
                      value={data.targetValue}
                      defaultValue={50}
                      min={0}
                      max={100}
                      onChange={(val) => data.onChange?.('targetValue', val)}
                      allowFloat={false}
                    />
                    <span>%</span>
                  </>
                )
              ) : data.stateType === 'pain' ? (
                data.comparison === 'range' ? (
                  <>
                    <select
                      className="node-select"
                      value={data.targetValue ?? 0}
                      onChange={(e) => data.onChange?.('targetValue', parseInt(e.target.value))}
                    >
                      {PAIN_SCALE.map(p => (
                        <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
                      ))}
                    </select>
                    <span>to</span>
                    <select
                      className="node-select"
                      value={data.targetValue2 ?? 10}
                      onChange={(e) => data.onChange?.('targetValue2', parseInt(e.target.value))}
                    >
                      {PAIN_SCALE.map(p => (
                        <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <select
                    className="node-select"
                    value={data.targetValue ?? 5}
                    onChange={(e) => data.onChange?.('targetValue', parseInt(e.target.value))}
                  >
                    {PAIN_SCALE.map(p => (
                      <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
                    ))}
                  </select>
                )
              ) : (
                <select
                  className="node-select"
                  value={data.targetValue || 'neutral'}
                  onChange={(e) => data.onChange?.('targetValue', e.target.value)}
                >
                  {EMOTIONS.map(em => (
                    <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Fire Only Once Checkbox */}
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.fireOnlyOnce !== false}
                onChange={(e) => data.onChange?.('fireOnlyOnce', e.target.checked)}
              />
              Fire Only Once
            </label>

            {renderTriggerOptions()}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className={`custom-node trigger-node ${selected ? 'selected' : ''}`}>
      <div className="node-header">
        <span className="node-icon">⚡</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Label..."
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        {renderConfig()}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(TriggerNode);
