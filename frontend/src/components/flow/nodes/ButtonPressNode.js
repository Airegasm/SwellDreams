import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function ButtonPressNode({ data, selected }) {
  const availableButtons = data.characterButtons || [];

  return (
    <div className={`custom-node trigger-node ${selected ? 'selected' : ''}`}>
      <div className="node-header">
        <span className="node-icon">🔘</span>
        <span className="node-title">Button Press</span>
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
          {/* Button Selection Dropdown */}
          {availableButtons.length > 0 && (
            <select
              value={data.buttonId || ''}
              onChange={(e) => {
                const selectedButton = availableButtons.find(b => String(b.buttonId) === e.target.value);
                data.onChange?.('buttonId', e.target.value);
                if (selectedButton) {
                  data.onChange?.('label', selectedButton.name);
                }
              }}
              className="node-select"
            >
              <option value="">Select Button...</option>
              {availableButtons.map(b => (
                <option key={b.buttonId} value={b.buttonId}>{b.name} #{b.buttonId}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={data.label || ''}
            onChange={(e) => data.onChange?.('label', e.target.value)}
            placeholder="FlowAction Label"
            className="node-input"
          />
          <p className="node-hint" style={{fontSize: '0.75rem', color: '#888', margin: '0.25rem 0 0 0'}}>
            {availableButtons.length > 0
              ? 'Select a button or type a custom label'
              : 'Add buttons in Character Editor first, or type a custom label'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ButtonPressNode);
