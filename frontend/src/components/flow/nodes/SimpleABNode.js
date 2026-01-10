import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function SimpleABNode({ data, selected }) {
  return (
    <div className={`custom-node simple-ab-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">AB</span>
        <span className="node-title">{data.label || 'Simple A/B'}</span>
      </div>
      <div className="node-body">
        <div className="node-config">
          <div className="form-group">
            <label>Popup Description:</label>
            <textarea
              value={data.description || ''}
              onChange={(e) => data.onChange?.('description', e.target.value)}
              placeholder="Main text shown in the popup..."
              className="node-textarea"
              rows={2}
            />
          </div>
          <div className="simple-ab-options">
            <div className="ab-option">
              <label>Button A (Left):</label>
              <input
                type="text"
                value={data.labelA || 'Option A'}
                onChange={(e) => data.onChange?.('labelA', e.target.value)}
                placeholder="Button A label"
                className="node-input"
              />
              <textarea
                value={data.descriptionA || ''}
                onChange={(e) => data.onChange?.('descriptionA', e.target.value)}
                placeholder="Description for A..."
                className="node-textarea small"
                rows={2}
              />
            </div>
            <div className="ab-option">
              <label>Button B (Right):</label>
              <input
                type="text"
                value={data.labelB || 'Option B'}
                onChange={(e) => data.onChange?.('labelB', e.target.value)}
                placeholder="Button B label"
                className="node-input"
              />
              <textarea
                value={data.descriptionB || ''}
                onChange={(e) => data.onChange?.('descriptionB', e.target.value)}
                placeholder="Description for B..."
                className="node-textarea small"
                rows={2}
              />
            </div>
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="a"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        style={{ left: '70%' }}
      />
      <div className="handle-labels ab-labels">
        <span className="handle-label" style={{ left: '30%' }}>A</span>
        <span className="handle-label" style={{ left: '70%' }}>B</span>
      </div>
    </div>
  );
}

export default memo(SimpleABNode);
