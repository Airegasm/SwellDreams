import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function TriggerNode({ data, selected }) {
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
          </div>
        );
      }

      case 'timer':
        return (
          <div className="node-config">
            <input
              type="number"
              value={data.delay || 60}
              onChange={(e) => data.onChange?.('delay', parseInt(e.target.value))}
              min={1}
              className="node-input small"
            />
            <span>seconds</span>
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={data.repeat || false}
                onChange={(e) => data.onChange?.('repeat', e.target.checked)}
              />
              Repeat
            </label>
          </div>
        );

      case 'random':
        return (
          <div className="node-config">
            <input
              type="number"
              value={data.probability || 50}
              onChange={(e) => data.onChange?.('probability', parseInt(e.target.value))}
              min={0}
              max={100}
              className="node-input small"
            />
            <span>% chance</span>
          </div>
        );

      case 'idle':
        return (
          <div className="node-config">
            <input
              type="number"
              value={data.threshold || 300}
              onChange={(e) => data.onChange?.('threshold', parseInt(e.target.value))}
              min={1}
              className="node-input small"
            />
            <span>seconds</span>
          </div>
        );

      case 'new_session':
        return (
          <div className="node-config">
            <span className="config-hint">Fires once at the start of each new session</span>
          </div>
        );

      case 'player_state_change': {
        const sensations = ['normal', 'slightly tight', 'comfortably full', 'stretched', 'very tight', 'painfully tight'];
        const emotions = ['neutral', 'nervous', 'anxious', 'scared', 'curious', 'excited', 'aroused', 'embarrassed', 'humiliated', 'resigned', 'defiant', 'submissive', 'blissful', 'overwhelmed'];

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
                  } else if (e.target.value === 'feeling') {
                    data.onChange?.('targetValue', 'normal');
                  } else {
                    data.onChange?.('targetValue', 'neutral');
                  }
                }}
              >
                <option value="capacity">Capacity</option>
                <option value="feeling">Feeling</option>
                <option value="emotion">Emotion</option>
              </select>
            </div>

            {/* Comparison Dropdown */}
            <div className="config-row">
              <label>When:</label>
              <select
                className="node-select"
                value={data.comparison || 'meet'}
                onChange={(e) => data.onChange?.('comparison', e.target.value)}
              >
                <option value="meet">MEET</option>
                <option value="meet_or_exceed">MEET OR EXCEED</option>
                {(data.stateType === 'capacity' || !data.stateType) && (
                  <option value="range">RANGE</option>
                )}
              </select>
            </div>

            {/* Conditional Value Input */}
            <div className="config-row">
              <label>Value:</label>
              {data.stateType === 'capacity' || !data.stateType ? (
                data.comparison === 'range' ? (
                  <>
                    <input
                      type="number"
                      className="node-input small"
                      value={data.targetValue ?? 0}
                      min="0"
                      max="100"
                      onChange={(e) => data.onChange?.('targetValue', parseInt(e.target.value) || 0)}
                    />
                    <span>to</span>
                    <input
                      type="number"
                      className="node-input small"
                      value={data.targetValue2 ?? 100}
                      min="0"
                      max="100"
                      onChange={(e) => data.onChange?.('targetValue2', parseInt(e.target.value) || 0)}
                    />
                    <span>%</span>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      className="node-input small"
                      value={data.targetValue ?? 50}
                      min="0"
                      max="100"
                      onChange={(e) => data.onChange?.('targetValue', parseInt(e.target.value) || 0)}
                    />
                    <span>%</span>
                  </>
                )
              ) : data.stateType === 'feeling' ? (
                <select
                  className="node-select"
                  value={data.targetValue || 'normal'}
                  onChange={(e) => data.onChange?.('targetValue', e.target.value)}
                >
                  {sensations.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <select
                  className="node-select"
                  value={data.targetValue || 'neutral'}
                  onChange={(e) => data.onChange?.('targetValue', e.target.value)}
                >
                  {emotions.map(em => <option key={em} value={em}>{em}</option>)}
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

            {/* Priority Section */}
            <div className="priority-row">
              <label className="node-checkbox">
                <input
                  type="checkbox"
                  checked={data.hasPriority || false}
                  onChange={(e) => data.onChange?.('hasPriority', e.target.checked)}
                />
                Priority
              </label>
              {data.hasPriority && (
                <input
                  type="number"
                  className="node-input tiny"
                  value={data.priority ?? 5}
                  min="1"
                  max="10"
                  onChange={(e) => data.onChange?.('priority', Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                />
              )}
            </div>
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
        <span className="node-title">{data.label}</span>
      </div>
      <div className="node-body">
        {renderConfig()}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(TriggerNode);
