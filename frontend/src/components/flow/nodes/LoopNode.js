import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { EMOTIONS, PAIN_SCALE } from '../../../constants/stateValues';
import NumberInput from './NumberInput';
import './Nodes.css';

const VARIABLES = [
  { value: 'capacity', label: 'Capacity' },
  { value: 'pain', label: 'Pain' },
  { value: 'emotion', label: 'Emotion' },
  { value: 'custom', label: 'Custom Variable' }
];

const NUMERIC_OPERATORS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' }
];

const STRING_OPERATORS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' }
];

function LoopNode({ data, selected }) {
  const flowVariables = data.flowVariables || [];

  const getOperatorsForVariable = (variable) => {
    if (variable === 'capacity' || variable === 'pain') {
      return NUMERIC_OPERATORS;
    }
    return STRING_OPERATORS;
  };

  const renderValueInput = () => {
    switch (data.variable) {
      case 'capacity':
        return (
          <NumberInput
            className="node-input small"
            value={data.value}
            defaultValue={50}
            min={0}
            max={100}
            onChange={(val) => data.onChange?.('value', val)}
            allowFloat={false}
          />
        );
      case 'pain':
        return (
          <select
            className="node-select"
            value={data.value ?? 5}
            onChange={(e) => data.onChange?.('value', parseInt(e.target.value))}
          >
            {PAIN_SCALE.map(p => (
              <option key={p.value} value={p.value}>{p.emoji} {p.value} - {p.label}</option>
            ))}
          </select>
        );
      case 'emotion':
        return (
          <select
            className="node-select"
            value={data.value || 'neutral'}
            onChange={(e) => data.onChange?.('value', e.target.value)}
          >
            {EMOTIONS.map(em => (
              <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
            ))}
          </select>
        );
      default:
        return (
          <input
            type="text"
            className="node-input small"
            value={data.value ?? ''}
            onChange={(e) => data.onChange?.('value', e.target.value)}
            placeholder="Value"
          />
        );
    }
  };

  return (
    <div className={`custom-node loop-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🔄</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Loop"
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
              value={data.mode || 'fixed'}
              onChange={(e) => data.onChange?.('mode', e.target.value)}
            >
              <option value="fixed">Fixed Count</option>
              <option value="until">Until Condition</option>
            </select>
          </div>

          {data.mode === 'fixed' || !data.mode ? (
            <div className="config-row">
              <label>Iterations:</label>
              <NumberInput
                value={data.iterations}
                onChange={(val) => data.onChange?.('iterations', val)}
                defaultValue={5}
                min={1}
                max={1000}
                allowFloat={false}
              />
            </div>
          ) : (
            <>
              <div className="config-row">
                <label>Variable:</label>
                <select
                  className="node-select"
                  value={data.variable || 'capacity'}
                  onChange={(e) => {
                    data.onChange?.('variable', e.target.value);
                    // Reset value when variable changes
                    if (e.target.value === 'capacity') {
                      data.onChange?.('value', 50);
                      data.onChange?.('operator', '>=');
                    } else if (e.target.value === 'pain') {
                      data.onChange?.('value', 5);
                      data.onChange?.('operator', '>=');
                    } else if (e.target.value === 'emotion') {
                      data.onChange?.('value', 'neutral');
                      data.onChange?.('operator', '==');
                    } else {
                      data.onChange?.('value', '');
                      data.onChange?.('operator', '==');
                    }
                  }}
                >
                  {VARIABLES.map(v => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>

              {data.variable === 'custom' && (
                <div className="config-row">
                  <label>Name:</label>
                  <select
                    className="node-select"
                    value={data.customVariable || ''}
                    onChange={(e) => data.onChange?.('customVariable', e.target.value)}
                  >
                    <option value="">Select Variable</option>
                    {flowVariables.map(v => (
                      <option key={v} value={v}>[Flow:{v}]</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="config-row">
                <label>Operator:</label>
                <select
                  className="node-select"
                  value={data.operator || '>='}
                  onChange={(e) => data.onChange?.('operator', e.target.value)}
                >
                  {getOperatorsForVariable(data.variable).map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="config-row">
                <label>Value:</label>
                {renderValueInput()}
              </div>
            </>
          )}

          <div className="config-row">
            <label>Max (safety):</label>
            <NumberInput
              value={data.maxIterations}
              onChange={(val) => data.onChange?.('maxIterations', val)}
              defaultValue={100}
              min={1}
              max={10000}
              allowFloat={false}
            />
          </div>
        </div>
      </div>

      {/* Loop handle - goes back into loop body */}
      <Handle
        type="source"
        position={Position.Right}
        id="loop"
        style={{ top: '60%' }}
      />
      <span className="handle-label loop-handle">Loop</span>

      {/* Done handle - exits the loop */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="done"
      />
      <span className="handle-label done-handle">Done</span>
    </div>
  );
}

export default memo(LoopNode);
