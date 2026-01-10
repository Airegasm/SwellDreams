import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

const VARIABLES = [
  { value: 'capacity', label: 'Capacity' },
  { value: 'feeling', label: 'Feeling' },
  { value: 'emotion', label: 'Emotion' },
  { value: 'device_state', label: 'Device State' },
  { value: 'custom', label: 'Custom Variable' }
];

const OPERATORS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'range', label: 'RANGE' },
  { value: 'contains', label: 'contains' }
];

function ConditionNode({ data, selected }) {
  // Support both new conditions array and legacy single condition
  const conditions = data.conditions || [
    { variable: data.variable || 'capacity', operator: data.operator || '>', value: data.value ?? 50, value2: null, onlyOnce: data.executeOnce || false }
  ];

  // Flow variables passed from FlowEditor
  const flowVariables = data.flowVariables || [];

  const addCondition = () => {
    const newConditions = [...conditions, { variable: 'capacity', operator: '>', value: 50, value2: null, onlyOnce: false }];
    data.onChange?.('conditions', newConditions);
  };

  const removeCondition = (index) => {
    if (conditions.length <= 1) return;
    const newConditions = conditions.filter((_, i) => i !== index);
    data.onChange?.('conditions', newConditions);
  };

  const updateCondition = (index, field, value) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    if (field === 'operator' && value !== 'range') {
      newConditions[index].value2 = null;
    }
    // When switching to custom, clear customVariable if not set
    if (field === 'variable' && value === 'custom' && !newConditions[index].customVariable) {
      newConditions[index].customVariable = flowVariables[0] || '';
    }
    data.onChange?.('conditions', newConditions);
  };

  return (
    <div className={`custom-node condition-node multi-condition ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />

      <div className="node-header">
        <span className="node-icon">?</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Condition"
        />
        <button className="add-else-btn" onClick={addCondition}>Add Else</button>
      </div>

      <div className="node-body conditions-body">
        {conditions.map((condition, index) => (
          <div key={index} className="condition-row-container">
            <div className="condition-row">
              {conditions.length > 1 && (
                <button className="condition-remove" onClick={() => removeCondition(index)}>×</button>
              )}

              <select
                className="node-select"
                value={condition.variable || 'capacity'}
                onChange={(e) => updateCondition(index, 'variable', e.target.value)}
              >
                {VARIABLES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>

              {/* Custom variable dropdown - shows when 'custom' is selected */}
              {condition.variable === 'custom' && (
                <select
                  className="node-select"
                  value={condition.customVariable || ''}
                  onChange={(e) => updateCondition(index, 'customVariable', e.target.value)}
                >
                  <option value="">Select Variable</option>
                  {flowVariables.map(v => (
                    <option key={v} value={v}>[Flow:{v}]</option>
                  ))}
                </select>
              )}

              <select
                className="node-select"
                value={condition.operator || '>'}
                onChange={(e) => updateCondition(index, 'operator', e.target.value)}
              >
                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              <input
                type={condition.variable === 'capacity' ? 'number' : 'text'}
                className="node-input small"
                value={condition.value ?? ''}
                onChange={(e) => updateCondition(index, 'value', e.target.value)}
              />

              {condition.operator === 'range' && (
                <>
                  <span className="range-separator">to</span>
                  <input
                    type="number"
                    className="node-input small"
                    value={condition.value2 ?? ''}
                    onChange={(e) => updateCondition(index, 'value2', e.target.value)}
                  />
                </>
              )}

              <label className="node-checkbox compact">
                <input
                  type="checkbox"
                  checked={condition.onlyOnce || false}
                  onChange={(e) => updateCondition(index, 'onlyOnce', e.target.checked)}
                />
                Once
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* TRUE handles - positioned outside the body for correct alignment */}
      {conditions.map((_, index) => (
        <React.Fragment key={`handle-${index}`}>
          <Handle
            type="source"
            position={Position.Right}
            id={`true-${index}`}
            style={{ top: `${52 + index * 35}px` }}
          />
          <span
            className="condition-handle-label"
            style={{ top: `${46 + index * 35}px` }}
          >
            T{index + 1}
          </span>
        </React.Fragment>
      ))}

      {/* Global FALSE handle at bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '85%' }}
      />
      <span className="handle-label false bottom-false">False</span>
    </div>
  );
}

export default memo(ConditionNode);
