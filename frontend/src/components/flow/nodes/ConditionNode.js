import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { EMOTIONS, PAIN_SCALE } from '../../../constants/stateValues';
import './Nodes.css';

const VARIABLES = [
  { value: 'capacity', label: 'Capacity' },
  { value: 'pain', label: 'Pain' },
  { value: 'emotion', label: 'Emotion' },
  { value: 'device_state', label: 'Device State' },
  { value: 'custom', label: 'Custom Variable' }
];

// Operators for numeric values (capacity, pain)
const NUMERIC_OPERATORS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'range', label: 'RANGE' }
];

// Operators for non-numeric values (emotion, device_state, custom)
const STRING_OPERATORS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
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
    // When switching variable type, reset value and operator appropriately
    if (field === 'variable') {
      if (value === 'capacity') {
        newConditions[index].value = 50;
        newConditions[index].value2 = null;
        newConditions[index].operator = '>=';
      } else if (value === 'pain') {
        newConditions[index].value = 5;
        newConditions[index].value2 = null;
        newConditions[index].operator = '>=';
      } else if (value === 'emotion') {
        newConditions[index].value = 'neutral';
        newConditions[index].value2 = null;
        newConditions[index].operator = '==';
      } else if (value === 'device_state') {
        newConditions[index].value = 'on';
        newConditions[index].operator = '==';
      } else if (value === 'custom') {
        newConditions[index].customVariable = flowVariables[0] || '';
        newConditions[index].value = '';
        newConditions[index].operator = '==';
      }
    }
    data.onChange?.('conditions', newConditions);
  };

  // Helper to get operators based on variable type
  const getOperatorsForVariable = (variable) => {
    if (variable === 'capacity' || variable === 'pain') {
      return NUMERIC_OPERATORS;
    }
    return STRING_OPERATORS;
  };

  // Render value input based on variable type
  const renderValueInput = (condition, index, isSecondValue = false) => {
    const field = isSecondValue ? 'value2' : 'value';
    const currentValue = isSecondValue ? condition.value2 : condition.value;

    switch (condition.variable) {
      case 'capacity':
        return (
          <input
            type="number"
            className="node-input small"
            value={currentValue ?? (isSecondValue ? 100 : 50)}
            min={0}
            max={100}
            onChange={(e) => updateCondition(index, field, parseInt(e.target.value) || 0)}
          />
        );
      case 'pain':
        return (
          <select
            className="node-select"
            value={currentValue ?? (isSecondValue ? 10 : 5)}
            onChange={(e) => updateCondition(index, field, parseInt(e.target.value))}
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
            value={currentValue || 'neutral'}
            onChange={(e) => updateCondition(index, field, e.target.value)}
          >
            {EMOTIONS.map(em => (
              <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
            ))}
          </select>
        );
      case 'device_state':
        return (
          <select
            className="node-select"
            value={currentValue || 'on'}
            onChange={(e) => updateCondition(index, field, e.target.value)}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        );
      default:
        return (
          <input
            type="text"
            className="node-input small"
            value={currentValue ?? ''}
            onChange={(e) => updateCondition(index, field, e.target.value)}
          />
        );
    }
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
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
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
                value={condition.operator || '>='}
                onChange={(e) => updateCondition(index, 'operator', e.target.value)}
              >
                {getOperatorsForVariable(condition.variable).map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {renderValueInput(condition, index)}

              {condition.operator === 'range' && (
                <>
                  <span className="range-separator">to</span>
                  {renderValueInput(condition, index, true)}
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
