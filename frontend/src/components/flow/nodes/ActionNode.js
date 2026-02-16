import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { EMOTIONS, PAIN_SCALE } from '../../../constants/stateValues';
import ActionWrapper from './ActionWrapper';
import NumberInput from './NumberInput';
import './Nodes.css';

// Helper to create unique device identifier (handles power strip outlets with same IP)
const getDeviceValue = (device) => {
  if (device.childId !== undefined && device.childId !== null) {
    return `${device.ip}:${device.childId}`;
  }
  return device.ip;
};

// Helper to create unique key for React
const getDeviceKey = (device) => {
  if (device.childId !== undefined && device.childId !== null) {
    return `${device.ip}-${device.childId}`;
  }
  return device.ip;
};

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
              <option value="primary_vibe">Primary Vibe</option>
              {data.devices?.map(d => (
                <option key={getDeviceKey(d)} value={getDeviceValue(d)}>{d.label}</option>
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
                  } else if (e.target.value === 'timer') {
                    data.onChange?.('untilValue', 5);
                  }
                }}
                className="node-select"
              >
                <option value="forever">Forever</option>
                <option value="timer">Timed</option>
                <option value="capacity">Capacity</option>
                <option value="pain">Pain</option>
                <option value="emotion">Emotion</option>
              </select>
            </div>
            {data.untilType === 'timer' && (
              <div className="config-row">
                <label>Duration:</label>
                <NumberInput
                  value={data.untilValue}
                  onChange={(val) => data.onChange?.('untilValue', val)}
                  defaultValue={5}
                  min={1}
                  allowFloat={false}
                />
                <span>sec</span>
              </div>
            )}
            {data.untilType && data.untilType !== 'forever' && data.untilType !== 'timer' && data.untilType !== 'emotion' && (
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
                <NumberInput
                  value={data.untilValue}
                  onChange={(val) => data.onChange?.('untilValue', val)}
                  defaultValue={50}
                  min={0}
                  max={100}
                  allowFloat={false}
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
              <option value="primary_vibe">Primary Vibe</option>
              {data.devices?.map(d => (
                <option key={getDeviceKey(d)} value={getDeviceValue(d)}>{d.label}</option>
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
              <option value="primary_vibe">Primary Vibe</option>
              {data.devices?.map(d => (
                <option key={getDeviceKey(d)} value={getDeviceValue(d)}>{d.label}</option>
              ))}
            </select>
            <div className="config-row">
              <label>Duration:</label>
              <NumberInput
                value={data.duration}
                onChange={(val) => data.onChange?.('duration', val)}
                defaultValue={5}
                min={1}
                allowFloat={false}
              />
              <span>s</span>
            </div>
            <div className="config-row">
              <label>Interval:</label>
              <NumberInput
                value={data.interval}
                onChange={(val) => data.onChange?.('interval', val)}
                defaultValue={10}
                min={1}
                allowFloat={false}
              />
              <span>s</span>
            </div>
            <div className="config-row">
              <label>Cycles:</label>
              <NumberInput
                value={data.cycles}
                onChange={(val) => data.onChange?.('cycles', val)}
                defaultValue={0}
                min={0}
                allowFloat={false}
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
                  } else if (e.target.value === 'timer') {
                    data.onChange?.('untilValue', 5);
                  }
                }}
                className="node-select"
              >
                <option value="forever">Forever</option>
                <option value="timer">Timed</option>
                <option value="capacity">Capacity</option>
                <option value="pain">Pain</option>
                <option value="emotion">Emotion</option>
              </select>
            </div>
            {data.untilType === 'timer' && (
              <div className="config-row">
                <label>Duration:</label>
                <NumberInput
                  value={data.untilValue}
                  onChange={(val) => data.onChange?.('untilValue', val)}
                  defaultValue={5}
                  min={1}
                  allowFloat={false}
                />
                <span>sec</span>
              </div>
            )}
            {data.untilType && data.untilType !== 'forever' && data.untilType !== 'timer' && data.untilType !== 'emotion' && (
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
                <NumberInput
                  value={data.untilValue}
                  onChange={(val) => data.onChange?.('untilValue', val)}
                  defaultValue={50}
                  min={0}
                  max={100}
                  allowFloat={false}
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

      case 'pulse_pump':
        return (
          <div className="node-config">
            <select
              value={data.device || ''}
              onChange={(e) => data.onChange?.('device', e.target.value)}
              className="node-select"
            >
              <option value="">Select Pump</option>
              <option value="primary_pump">Primary Pump</option>
              {data.devices?.filter(d => d.deviceType === 'PUMP').map(d => (
                <option key={getDeviceKey(d)} value={getDeviceValue(d)}>{d.label}</option>
              ))}
            </select>
            <div className="config-row">
              <label>Pulses:</label>
              <NumberInput
                value={data.pulses}
                onChange={(val) => data.onChange?.('pulses', val)}
                defaultValue={3}
                min={1}
                max={100}
                allowFloat={false}
              />
              <span>(1s on/1s off)</span>
            </div>
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
                <NumberInput
                  value={data.value}
                  onChange={(val) => data.onChange?.('value', val)}
                  defaultValue={0}
                  min={0}
                  max={100}
                  placeholder="0-100"
                  allowFloat={false}
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

      case 'show_image':
        return (
          <div className="node-config">
            <input
              type="text"
              value={data.tag || ''}
              onChange={(e) => data.onChange?.('tag', e.target.value)}
              placeholder="Image tag"
              className="node-input"
            />
          </div>
        );

      case 'play_video':
        return (
          <div className="node-config">
            <input
              type="text"
              value={data.tag || ''}
              onChange={(e) => data.onChange?.('tag', e.target.value)}
              placeholder="Video tag"
              className="node-input"
            />
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.loop || false}
                onChange={(e) => {
                  data.onChange?.('loop', e.target.checked);
                  if (e.target.checked) data.onChange?.('blocking', false);
                }}
              />
              Loop
            </label>
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.blocking || false}
                disabled={data.loop}
                onChange={(e) => data.onChange?.('blocking', e.target.checked)}
              />
              Blocking (pause flow until video ends)
            </label>
          </div>
        );

      case 'play_audio':
        return (
          <div className="node-config">
            <input
              type="text"
              value={data.tag || ''}
              onChange={(e) => data.onChange?.('tag', e.target.value)}
              placeholder="Audio tag"
              className="node-input"
            />
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.noBubble || false}
                onChange={(e) => data.onChange?.('noBubble', e.target.checked)}
              />
              No bubble (play silently)
            </label>
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.blocking || false}
                onChange={(e) => data.onChange?.('blocking', e.target.checked)}
              />
              Blocking (pause flow until audio ends)
            </label>
          </div>
        );

      case 'set_emotion':
        return (
          <div className="node-config">
            <select
              value={data.emotion || ''}
              onChange={(e) => data.onChange?.('emotion', e.target.value)}
              className="node-select"
            >
              <option value="">Select Emotion</option>
              {EMOTIONS.map(em => (
                <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
              ))}
            </select>
          </div>
        );

      case 'set_attribute': {
        const ATTRIBUTE_OPTIONS = [
          { key: 'dominant', label: 'Dominant' },
          { key: 'sadistic', label: 'Sadistic' },
          { key: 'psychopathic', label: 'Psychopathic' },
          { key: 'sensual', label: 'Sensual' },
          { key: 'sexual', label: 'Sexual' }
        ];

        return (
          <div className="node-config">
            <select
              value={data.attribute || ''}
              onChange={(e) => data.onChange?.('attribute', e.target.value)}
              className="node-select"
            >
              <option value="">Select Attribute</option>
              {ATTRIBUTE_OPTIONS.map(a => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
            <div className="config-row">
              <label>Value: {data.attributeValue ?? 50}%</label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={data.attributeValue ?? 50}
                onChange={(e) => data.onChange?.('attributeValue', parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
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
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          {renderConfig()}
        </ActionWrapper>
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
