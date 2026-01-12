import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { EMOTIONS, PAIN_SCALE } from '../../../constants/stateValues';
import './Nodes.css';

function ActionNode({ data, selected }) {
  const renderConfig = () => {
    switch (data.actionType) {
      case 'send_message':
      case 'send_player_message':
        return (
          <div className="node-config">
            <textarea
              value={data.message || ''}
              onChange={(e) => data.onChange?.('message', e.target.value)}
              placeholder="Enter message..."
              className="node-textarea"
              rows={2}
            />
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.suppressLlm || false}
                onChange={(e) => data.onChange?.('suppressLlm', e.target.checked)}
              />
              Suppress LLM Enhancement
            </label>
            <div className="config-row">
              <label>Post Delay:</label>
              <input
                type="number"
                value={data.postDelay ?? 3}
                onChange={(e) => data.onChange?.('postDelay', parseFloat(e.target.value) || 0)}
                min={0}
                step={0.5}
                className="node-input small"
              />
              <span>s</span>
            </div>
          </div>
        );

      case 'system_message':
        return (
          <div className="node-config">
            <textarea
              value={data.message || ''}
              onChange={(e) => data.onChange?.('message', e.target.value)}
              placeholder="Enter message..."
              className="node-textarea"
              rows={2}
            />
          </div>
        );

      case 'device_on':
        return (
          <div className="node-config">
            <select
              value={data.device || ''}
              onChange={(e) => data.onChange?.('device', e.target.value)}
              className="node-select"
            >
              <option value="">Select Device</option>
              <option value="primary_pump">Primary Pump</option>
              {data.devices?.map(d => (
                <option key={d.ip} value={d.ip}>{d.label}</option>
              ))}
            </select>
            <div className="config-row">
              <label>Until:</label>
              <select
                value={data.untilType || 'forever'}
                onChange={(e) => {
                  data.onChange?.('untilType', e.target.value);
                  // Reset value when type changes
                  if (e.target.value === 'capacity') {
                    data.onChange?.('untilValue', 50);
                  } else if (e.target.value === 'pain') {
                    data.onChange?.('untilValue', 5);
                  } else if (e.target.value === 'emotion') {
                    data.onChange?.('untilValue', 'neutral');
                  }
                }}
                className="node-select"
              >
                <option value="forever">Forever</option>
                <option value="capacity">Capacity</option>
                <option value="pain">Pain</option>
                <option value="emotion">Emotion</option>
              </select>
            </div>
            {data.untilType && data.untilType !== 'forever' && data.untilType !== 'emotion' && (
              <div className="config-row">
                <label>When:</label>
                <select
                  value={data.untilOperator || '>='}
                  onChange={(e) => data.onChange?.('untilOperator', e.target.value)}
                  className="node-select small"
                >
                  <option value="==">= (equals)</option>
                  <option value=">=">≥ (meet or exceed)</option>
                  <option value=">">{'>'} (greater than)</option>
                  <option value="<">{'<'} (less than)</option>
                  <option value="<=">≤ (less or equal)</option>
                </select>
              </div>
            )}
            {data.untilType === 'emotion' && (
              <div className="config-row">
                <label>When:</label>
                <select
                  value={data.untilOperator || '=='}
                  onChange={(e) => data.onChange?.('untilOperator', e.target.value)}
                  className="node-select small"
                >
                  <option value="==">= (equals)</option>
                  <option value="!=">!= (not equals)</option>
                </select>
              </div>
            )}
            {data.untilType === 'capacity' && (
              <div className="config-row">
                <input
                  type="number"
                  value={data.untilValue ?? 50}
                  onChange={(e) => data.onChange?.('untilValue', parseInt(e.target.value) || 0)}
                  min={0}
                  max={100}
                  className="node-input small"
                />
                <span>%</span>
              </div>
            )}
            {data.untilType === 'pain' && (
              <div className="config-row">
                <select
                  value={data.untilValue ?? 5}
                  onChange={(e) => data.onChange?.('untilValue', parseInt(e.target.value))}
                  className="node-select"
                >
                  {PAIN_SCALE.map(p => (
                    <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
                  ))}
                </select>
              </div>
            )}
            {data.untilType === 'emotion' && (
              <div className="config-row">
                <select
                  value={data.untilValue || 'neutral'}
                  onChange={(e) => data.onChange?.('untilValue', e.target.value)}
                  className="node-select"
                >
                  {EMOTIONS.map(em => (
                    <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );

      case 'device_off':
      case 'stop_cycle':
        return (
          <div className="node-config">
            <select
              value={data.device || ''}
              onChange={(e) => data.onChange?.('device', e.target.value)}
              className="node-select"
            >
              <option value="">Select Device</option>
              <option value="primary_pump">Primary Pump</option>
              {data.devices?.map(d => (
                <option key={d.ip} value={d.ip}>{d.label}</option>
              ))}
            </select>
          </div>
        );

      case 'start_cycle':
        return (
          <div className="node-config">
            <select
              value={data.device || ''}
              onChange={(e) => data.onChange?.('device', e.target.value)}
              className="node-select"
            >
              <option value="">Select Device</option>
              <option value="primary_pump">Primary Pump</option>
              {data.devices?.map(d => (
                <option key={d.ip} value={d.ip}>{d.label}</option>
              ))}
            </select>
            <div className="config-row">
              <label>Duration:</label>
              <input
                type="number"
                value={data.duration || 5}
                onChange={(e) => data.onChange?.('duration', parseInt(e.target.value))}
                min={1}
                className="node-input small"
              />
              <span>s</span>
            </div>
            <div className="config-row">
              <label>Interval:</label>
              <input
                type="number"
                value={data.interval || 10}
                onChange={(e) => data.onChange?.('interval', parseInt(e.target.value))}
                min={1}
                className="node-input small"
              />
              <span>s</span>
            </div>
            <div className="config-row">
              <label>Cycles:</label>
              <input
                type="number"
                value={data.cycles || 0}
                onChange={(e) => data.onChange?.('cycles', parseInt(e.target.value))}
                min={0}
                className="node-input small"
              />
              <span>(0=∞)</span>
            </div>
            <div className="config-row">
              <label>Until:</label>
              <select
                value={data.untilType || 'forever'}
                onChange={(e) => {
                  data.onChange?.('untilType', e.target.value);
                  // Reset value when type changes
                  if (e.target.value === 'capacity') {
                    data.onChange?.('untilValue', 50);
                  } else if (e.target.value === 'pain') {
                    data.onChange?.('untilValue', 5);
                  } else if (e.target.value === 'emotion') {
                    data.onChange?.('untilValue', 'neutral');
                  }
                }}
                className="node-select"
              >
                <option value="forever">Forever</option>
                <option value="capacity">Capacity</option>
                <option value="pain">Pain</option>
                <option value="emotion">Emotion</option>
              </select>
            </div>
            {data.untilType && data.untilType !== 'forever' && data.untilType !== 'emotion' && (
              <div className="config-row">
                <label>When:</label>
                <select
                  value={data.untilOperator || '>='}
                  onChange={(e) => data.onChange?.('untilOperator', e.target.value)}
                  className="node-select small"
                >
                  <option value="==">= (equals)</option>
                  <option value=">=">≥ (meet or exceed)</option>
                  <option value=">">{'>'} (greater than)</option>
                  <option value="<">{'<'} (less than)</option>
                  <option value="<=">≤ (less or equal)</option>
                </select>
              </div>
            )}
            {data.untilType === 'emotion' && (
              <div className="config-row">
                <label>When:</label>
                <select
                  value={data.untilOperator || '=='}
                  onChange={(e) => data.onChange?.('untilOperator', e.target.value)}
                  className="node-select small"
                >
                  <option value="==">= (equals)</option>
                  <option value="!=">!= (not equals)</option>
                </select>
              </div>
            )}
            {data.untilType === 'capacity' && (
              <div className="config-row">
                <input
                  type="number"
                  value={data.untilValue ?? 50}
                  onChange={(e) => data.onChange?.('untilValue', parseInt(e.target.value) || 0)}
                  min={0}
                  max={100}
                  className="node-input small"
                />
                <span>%</span>
              </div>
            )}
            {data.untilType === 'pain' && (
              <div className="config-row">
                <select
                  value={data.untilValue ?? 5}
                  onChange={(e) => data.onChange?.('untilValue', parseInt(e.target.value))}
                  className="node-select"
                >
                  {PAIN_SCALE.map(p => (
                    <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
                  ))}
                </select>
              </div>
            )}
            {data.untilType === 'emotion' && (
              <div className="config-row">
                <select
                  value={data.untilValue || 'neutral'}
                  onChange={(e) => data.onChange?.('untilValue', e.target.value)}
                  className="node-select"
                >
                  {EMOTIONS.map(em => (
                    <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );

      case 'declare_variable':
        return (
          <div className="node-config">
            <input
              type="text"
              value={data.name || ''}
              onChange={(e) => data.onChange?.('name', e.target.value)}
              placeholder="Variable name"
              className="node-input"
            />
            <input
              type="text"
              value={data.value || ''}
              onChange={(e) => data.onChange?.('value', e.target.value)}
              placeholder="Initial value"
              className="node-input"
            />
          </div>
        );

      case 'set_variable': {
        const systemVars = [
          { value: 'capacity', label: '[Capacity]' },
          { value: 'pain', label: '[Pain]' },
          { value: 'emotion', label: '[Emotion]' }
        ];
        const flowVars = data.flowVariables || [];

        return (
          <div className="node-config">
            {/* Variable Type Dropdown */}
            <select
              value={data.varType || 'system'}
              onChange={(e) => {
                data.onChange?.('varType', e.target.value);
                // Reset variable selection when type changes
                data.onChange?.('variable', '');
              }}
              className="node-select"
            >
              <option value="system">System Variable</option>
              <option value="custom">Custom Variable</option>
            </select>

            {/* Variable Selection - Text input for custom, dropdown for system */}
            {data.varType === 'custom' ? (
              <input
                type="text"
                value={data.variable || ''}
                onChange={(e) => data.onChange?.('variable', e.target.value)}
                placeholder="Variable name (e.g. myVar)"
                className="node-input"
              />
            ) : (
              <select
                value={data.variable || ''}
                onChange={(e) => data.onChange?.('variable', e.target.value)}
                className="node-select"
              >
                <option value="">Select Variable</option>
                {systemVars.map(v => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            )}

            {/* Value Input - changes based on system variable type */}
            {data.varType !== 'custom' && data.variable === 'capacity' ? (
              <div className="config-row">
                <input
                  type="number"
                  value={data.value ?? ''}
                  onChange={(e) => data.onChange?.('value', e.target.value)}
                  min={0}
                  max={100}
                  placeholder="0-100"
                  className="node-input small"
                />
                <span>%</span>
              </div>
            ) : data.varType !== 'custom' && data.variable === 'pain' ? (
              <select
                value={data.value ?? ''}
                onChange={(e) => data.onChange?.('value', parseInt(e.target.value))}
                className="node-select"
              >
                <option value="">Select Pain Level</option>
                {PAIN_SCALE.map(p => (
                  <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
                ))}
              </select>
            ) : data.varType !== 'custom' && data.variable === 'emotion' ? (
              <select
                value={data.value || ''}
                onChange={(e) => data.onChange?.('value', e.target.value)}
                className="node-select"
              >
                <option value="">Select Emotion</option>
                {EMOTIONS.map(em => (
                  <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={data.value || ''}
                onChange={(e) => data.onChange?.('value', e.target.value)}
                placeholder="Value"
                className="node-input"
              />
            )}
          </div>
        );
      }

      case 'toggle_reminder': {
        const reminderType = data.reminderType || 'character';
        const availableReminders = reminderType === 'global'
          ? (data.globalReminders || [])
          : (data.characterReminders || []);

        return (
          <div className="node-config">
            {/* Reminder Type Selector */}
            <select
              value={reminderType}
              onChange={(e) => {
                data.onChange?.('reminderType', e.target.value);
                data.onChange?.('reminderId', ''); // Reset selection when type changes
              }}
              className="node-select"
            >
              <option value="character">Character</option>
              <option value="global">Global</option>
            </select>

            {/* Reminder Selector - filtered by type */}
            <select
              value={data.reminderId || ''}
              onChange={(e) => data.onChange?.('reminderId', e.target.value)}
              className="node-select"
            >
              <option value="">Select Reminder</option>
              {availableReminders.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>

            {/* Action Type */}
            <select
              value={data.action || 'enable'}
              onChange={(e) => data.onChange?.('action', e.target.value)}
              className="node-select"
            >
              <option value="enable">Enable</option>
              <option value="disable">Disable</option>
              <option value="update_text">Update Text</option>
            </select>

            {/* Text input for update_text action */}
            {data.action === 'update_text' && (
              <textarea
                value={data.newText || ''}
                onChange={(e) => data.onChange?.('newText', e.target.value)}
                placeholder="New reminder text..."
                className="node-textarea"
                rows={2}
              />
            )}
          </div>
        );
      }

      case 'toggle_button': {
        const availableButtons = data.characterButtons || [];

        return (
          <div className="node-config">
            {/* Button Selector */}
            <select
              value={data.buttonId || ''}
              onChange={(e) => data.onChange?.('buttonId', e.target.value)}
              className="node-select"
            >
              <option value="">Select Button</option>
              {availableButtons.map(b => (
                <option key={b.buttonId} value={b.buttonId}>{b.name} #{b.buttonId}</option>
              ))}
            </select>

            {/* Enable/Disable */}
            <select
              value={data.action || 'enable'}
              onChange={(e) => data.onChange?.('action', e.target.value)}
              className="node-select"
            >
              <option value="enable">Enable</option>
              <option value="disable">Disable</option>
            </select>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className={`custom-node action-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">▶</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Label..."
        />
      </div>
      <div className="node-body">
        {renderConfig()}
      </div>
      {(data.actionType === 'start_cycle' || data.actionType === 'device_on') ? (
        <>
          <Handle type="source" position={Position.Bottom} id="immediate" isConnectable={true} style={{ left: '30%' }} />
          <Handle type="source" position={Position.Bottom} id="completion" isConnectable={true} style={{ left: '70%' }} />
          <div className="handle-labels">
            <span className="handle-label immediate">Immediate</span>
            <span className="handle-label completion">Completion</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}

export default memo(ActionNode);
