import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import NumberInput from './NumberInput';
import './Nodes.css';

const OPERATIONS = [
  { value: 'increment', label: 'Increment (+)' },
  { value: 'decrement', label: 'Decrement (-)' },
  { value: 'set', label: 'Set to Value' },
  { value: 'reset', label: 'Reset to Initial' }
];

function CounterNode({ data, selected }) {
  return (
    <div className={`custom-node counter-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🔢</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Counter"
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
            <label>Variable:</label>
            <input
              type="text"
              className="node-input"
              value={data.variable || ''}
              onChange={(e) => data.onChange?.('variable', e.target.value)}
              placeholder="counter_name"
            />
          </div>
          <div className="config-row">
            <label>Operation:</label>
            <select
              className="node-select"
              value={data.operation || 'increment'}
              onChange={(e) => data.onChange?.('operation', e.target.value)}
            >
              {OPERATIONS.map(op => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>
          {(data.operation === 'increment' || data.operation === 'decrement' || data.operation === 'set') && (
            <div className="config-row">
              <label>Amount:</label>
              <NumberInput
                value={data.amount}
                onChange={(val) => data.onChange?.('amount', val)}
                defaultValue={1}
                min={0}
                allowFloat={true}
              />
            </div>
          )}
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.initializeDefault !== false}
              onChange={(e) => data.onChange?.('initializeDefault', e.target.checked)}
            />
            Initialize if not set
          </label>
          {data.initializeDefault !== false && (
            <div className="config-row">
              <label>Initial:</label>
              <NumberInput
                value={data.initialValue}
                onChange={(val) => data.onChange?.('initialValue', val)}
                defaultValue={0}
                allowFloat={true}
              />
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(CounterNode);
