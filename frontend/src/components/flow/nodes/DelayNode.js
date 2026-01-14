import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function DelayNode({ data, selected }) {
  return (
    <div className={`custom-node delay-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">⏱</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Delay"
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
          <div className="delay-row">
            <input
              type="number"
              value={data.duration || 5}
              onChange={(e) => data.onChange?.('duration', parseInt(e.target.value))}
              min={1}
              className="node-input small"
            />
            <select
              value={data.unit || 'seconds'}
              onChange={(e) => data.onChange?.('unit', e.target.value)}
              className="node-select"
            >
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
            </select>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(DelayNode);
