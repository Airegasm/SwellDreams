import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import NumberInput from './NumberInput';
import './Nodes.css';

function ButtonPressNode({ data, selected }) {
  const buttonTarget = data.buttonTarget || 'character';
  const availableButtons = buttonTarget === 'persona'
    ? (data.personaButtons || [])
    : (data.characterButtons || []);

  // Common trigger options (Priority, Unblockable, Notify)
  const renderTriggerOptions = () => (
    <div className="trigger-options">
      <div className="trigger-options-row">
        <label className="node-checkbox" title="Flow can run even when other flows are active">
          <input
            type="checkbox"
            checked={data.unblockable || false}
            onChange={(e) => data.onChange?.('unblockable', e.target.checked)}
          />
          Unblockable
        </label>
        <label className="node-checkbox" title="Show toast notifications for this flow">
          <input
            type="checkbox"
            checked={data.notify || false}
            onChange={(e) => data.onChange?.('notify', e.target.checked)}
          />
          Notify
        </label>
      </div>
      <div className="priority-row">
        <label className="node-checkbox" title="Enable priority-based flow interruption">
          <input
            type="checkbox"
            checked={data.hasPriority || false}
            onChange={(e) => data.onChange?.('hasPriority', e.target.checked)}
          />
          Priority
        </label>
        {data.hasPriority && (
          <NumberInput
            className="node-input tiny"
            value={data.priority}
            defaultValue={3}
            min={1}
            max={5}
            onChange={(val) => data.onChange?.('priority', Math.min(5, Math.max(1, val)))}
            allowFloat={false}
          />
        )}
      </div>
    </div>
  );

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
          {/* Button Target Selector */}
          <select
            value={buttonTarget}
            onChange={(e) => {
              data.onChange?.('buttonTarget', e.target.value);
              data.onChange?.('buttonId', ''); // Reset selection when target changes
            }}
            className="node-select"
          >
            <option value="character">Character Button</option>
            <option value="persona">Persona Button</option>
          </select>
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
              ? `Select a ${buttonTarget} button or type a custom label`
              : `Add buttons in ${buttonTarget === 'persona' ? 'Persona' : 'Character'} Editor first, or type a custom label`}
          </p>
          {renderTriggerOptions()}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default memo(ButtonPressNode);
