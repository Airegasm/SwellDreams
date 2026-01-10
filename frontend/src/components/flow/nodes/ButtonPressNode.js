import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function ButtonPressNode({ data, selected }) {
  return (
    <div className={`custom-node trigger-node ${selected ? 'selected' : ''}`}>
      <div className="node-header">
        <span className="node-icon">🔘</span>
        <span className="node-title">Button Press</span>
      </div>
      <div className="node-body">
        <div className="node-config">
          <input
            type="text"
            value={data.label || ''}
            onChange={(e) => data.onChange?.('label', e.target.value)}
            placeholder="FlowAction Label"
            className="node-input"
          />
          <p className="node-hint" style={{fontSize: '0.75rem', color: '#888', margin: '0.25rem 0 0 0'}}>
            Give this FlowAction a descriptive label (e.g., "Quick Inflate", "Emergency Stop")
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ButtonPressNode);
