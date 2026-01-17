import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import NumberInput from './NumberInput';
import './Nodes.css';

function InputNode({ data, selected }) {
  return (
    <div className={`custom-node input-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">📝</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="User Input"
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
          {/* Input Type Selection */}
          <div className="config-row">
            <label>Type:</label>
            <select
              value={data.inputType || 'text'}
              onChange={(e) => data.onChange?.('inputType', e.target.value)}
              className="node-select"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
          </div>

          {/* Variable Name */}
          <div className="config-row">
            <label>Variable:</label>
            <input
              type="text"
              value={data.variableName || 'Input'}
              onChange={(e) => data.onChange?.('variableName', e.target.value)}
              placeholder="Input"
              className="node-input"
            />
          </div>
          <div className="config-hint">
            Access as [Flow:{data.variableName || 'Input'}]
          </div>

          {/* Prompt Message */}
          <div className="form-group">
            <label>Modal Prompt:</label>
            <textarea
              value={data.prompt || ''}
              onChange={(e) => data.onChange?.('prompt', e.target.value)}
              placeholder="Enter your prompt here..."
              className="node-textarea"
              rows={2}
            />
          </div>

          {/* Placeholder */}
          <div className="form-group">
            <label>Placeholder:</label>
            <input
              type="text"
              value={data.placeholder || ''}
              onChange={(e) => data.onChange?.('placeholder', e.target.value)}
              placeholder="Input placeholder text..."
              className="node-input"
            />
          </div>

          {/* Number-specific options */}
          {data.inputType === 'number' && (
            <div className="config-row">
              <label>Min:</label>
              <NumberInput
                value={data.minValue}
                onChange={(val) => data.onChange?.('minValue', val)}
                defaultValue={0}
                className="node-input small"
                allowFloat={true}
              />
              <label style={{ marginLeft: '10px' }}>Max:</label>
              <NumberInput
                value={data.maxValue}
                onChange={(val) => data.onChange?.('maxValue', val)}
                defaultValue={100}
                className="node-input small"
                allowFloat={true}
              />
            </div>
          )}

          {/* Required checkbox */}
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.required !== false}
              onChange={(e) => data.onChange?.('required', e.target.checked)}
            />
            Required (must enter value)
          </label>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(InputNode);
