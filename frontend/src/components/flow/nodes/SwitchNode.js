import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { EMOTIONS, PAIN_SCALE } from '../../../constants/stateValues';
import './Nodes.css';

const VARIABLES = [
  { value: 'capacity', label: 'Capacity' },
  { value: 'pain', label: 'Pain' },
  { value: 'emotion', label: 'Emotion' },
  { value: 'custom', label: 'Custom Variable' }
];

function SwitchNode({ data, selected }) {
  const flowVariables = data.flowVariables || [];
  const cases = data.cases || [{ value: '' }];

  const addCase = () => {
    const newCases = [...cases, { value: '' }];
    data.onChange?.('cases', newCases);
  };

  const removeCase = (index) => {
    if (cases.length <= 1) return;
    const newCases = cases.filter((_, i) => i !== index);
    data.onChange?.('cases', newCases);
  };

  const updateCase = (index, value) => {
    const newCases = [...cases];
    newCases[index] = { ...newCases[index], value };
    data.onChange?.('cases', newCases);
  };

  const renderCaseValueInput = (caseItem, index) => {
    const variable = data.variable || 'custom';

    switch (variable) {
      case 'capacity':
        return (
          <input
            type="number"
            className="node-input small"
            value={caseItem.value ?? ''}
            min={0}
            max={100}
            onChange={(e) => updateCase(index, parseInt(e.target.value) || 0)}
            placeholder="0-100"
          />
        );
      case 'pain':
        return (
          <select
            className="node-select"
            value={caseItem.value ?? ''}
            onChange={(e) => updateCase(index, parseInt(e.target.value))}
          >
            <option value="">Select...</option>
            {PAIN_SCALE.map(p => (
              <option key={p.value} value={p.value}>{p.emoji} {p.value}</option>
            ))}
          </select>
        );
      case 'emotion':
        return (
          <select
            className="node-select"
            value={caseItem.value || ''}
            onChange={(e) => updateCase(index, e.target.value)}
          >
            <option value="">Select...</option>
            {EMOTIONS.map(em => (
              <option key={em.key} value={em.key}>{em.emoji} {em.label}</option>
            ))}
          </select>
        );
      default:
        return (
          <input
            type="text"
            className="node-input"
            value={caseItem.value ?? ''}
            onChange={(e) => updateCase(index, e.target.value)}
            placeholder="value"
          />
        );
    }
  };

  return (
    <div className={`custom-node switch-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">⑃</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Switch"
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
            <select
              className="node-select"
              value={data.variable || 'custom'}
              onChange={(e) => {
                data.onChange?.('variable', e.target.value);
                // Reset cases when variable type changes
                data.onChange?.('cases', [{ value: '' }]);
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

          <div className="switch-cases-header">
            <span>Cases:</span>
            <button className="add-case-btn" onClick={addCase}>+ Add Case</button>
          </div>

          <div className="switch-cases-list">
            {cases.map((caseItem, index) => (
              <div key={index} className="switch-case-row">
                <span className="case-label">Case {index + 1}:</span>
                {renderCaseValueInput(caseItem, index)}
                {cases.length > 1 && (
                  <button
                    className="case-remove-btn"
                    onClick={() => removeCase(index)}
                    title="Remove case"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.includeDefault !== false}
              onChange={(e) => data.onChange?.('includeDefault', e.target.checked)}
            />
            Include Default branch
          </label>
        </div>
      </div>

      {/* Case handles - on right side */}
      {cases.map((_, index) => (
        <React.Fragment key={`handle-${index}`}>
          <Handle
            type="source"
            position={Position.Right}
            id={`case-${index}`}
            style={{ top: `${100 + index * 32}px` }}
          />
          <span
            className="switch-handle-label"
            style={{ top: `${94 + index * 32}px` }}
          >
            C{index + 1}
          </span>
        </React.Fragment>
      ))}

      {/* Default handle at bottom */}
      {data.includeDefault !== false && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="default"
          />
          <span className="handle-label default-handle">Default</span>
        </>
      )}
    </div>
  );
}

export default memo(SwitchNode);
