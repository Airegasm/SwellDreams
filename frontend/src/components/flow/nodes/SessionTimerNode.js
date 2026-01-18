import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import NumberInput from './NumberInput';
import './Nodes.css';

function SessionTimerNode({ data, selected }) {
  return (
    <div className={`custom-node session-timer-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">⏱️</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Session Timer"
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
        <div className="node-config">
          <div className="config-row">
            <label>Mode:</label>
            <select
              className="node-select"
              value={data.mode || 'check'}
              onChange={(e) => data.onChange?.('mode', e.target.value)}
            >
              <option value="check">Check Elapsed Time</option>
              <option value="interval">Recurring Interval</option>
            </select>
          </div>

          {data.mode === 'interval' ? (
            <div className="config-row">
              <label>Every:</label>
              <NumberInput
                value={data.duration}
                onChange={(val) => data.onChange?.('duration', val)}
                defaultValue={5}
                min={1}
                allowFloat={false}
              />
              <select
                className="node-select small"
                value={data.unit || 'minutes'}
                onChange={(e) => data.onChange?.('unit', e.target.value)}
              >
                <option value="seconds">sec</option>
                <option value="minutes">min</option>
              </select>
            </div>
          ) : (
            <div className="config-row">
              <label>If elapsed ≥</label>
              <NumberInput
                value={data.duration}
                onChange={(val) => data.onChange?.('duration', val)}
                defaultValue={5}
                min={1}
                allowFloat={false}
              />
              <select
                className="node-select small"
                value={data.unit || 'minutes'}
                onChange={(e) => data.onChange?.('unit', e.target.value)}
              >
                <option value="seconds">sec</option>
                <option value="minutes">min</option>
              </select>
            </div>
          )}

          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.onlyOnce || false}
              onChange={(e) => data.onChange?.('onlyOnce', e.target.checked)}
            />
            Only trigger once
          </label>
        </div>
      </div>

      {/* True handle - condition met */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: '60%' }}
      />
      <span className="handle-label timer-true-handle">True</span>

      {/* False handle - condition not met */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
      />
      <span className="handle-label timer-false-handle">False</span>
    </div>
  );
}

export default memo(SessionTimerNode);
