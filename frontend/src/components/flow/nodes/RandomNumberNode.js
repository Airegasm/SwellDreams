import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import NumberInput from './NumberInput';
import './Nodes.css';

function RandomNumberNode({ data, selected }) {
  return (
    <div className={`custom-node random-number-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🎲</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Random Number"
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
          {/* Min/Max Row */}
          <div className="config-row">
            <label>Min:</label>
            <NumberInput
              value={data.minValue}
              onChange={(val) => data.onChange?.('minValue', val)}
              defaultValue={1}
              allowFloat={false}
            />
            <label style={{ marginLeft: '8px' }}>Max:</label>
            <NumberInput
              value={data.maxValue}
              onChange={(val) => data.onChange?.('maxValue', val)}
              defaultValue={100}
              allowFloat={false}
            />
          </div>

          {/* Variable Name */}
          <div className="config-row">
            <label>Variable:</label>
            <input
              type="text"
              value={data.variableName || 'RandomNum'}
              onChange={(e) => data.onChange?.('variableName', e.target.value)}
              placeholder="RandomNum"
              className="node-input"
            />
          </div>
          <div className="config-hint">
            Access as [Flow:{data.variableName || 'RandomNum'}]
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(RandomNumberNode);
