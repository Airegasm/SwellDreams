import React, { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function PlayerChoiceNode({ data, selected }) {
  const [choices, setChoices] = useState(data.choices || [
    { id: 'choice-1', label: 'Option A', description: '' },
    { id: 'choice-2', label: 'Option B', description: '' }
  ]);

  const addChoice = () => {
    const newId = `choice-${Date.now()}`;
    const newChoices = [...choices, {
      id: newId,
      label: `Option ${String.fromCharCode(65 + choices.length)}`,
      description: ''
    }];
    setChoices(newChoices);
    data.onChange?.('choices', newChoices);
  };

  const updateChoice = (index, key, value) => {
    const newChoices = [...choices];
    newChoices[index][key] = value;
    setChoices(newChoices);
    data.onChange?.('choices', newChoices);
  };

  const removeChoice = (index) => {
    if (choices.length <= 2) return;
    const newChoices = choices.filter((_, i) => i !== index);
    setChoices(newChoices);
    data.onChange?.('choices', newChoices);
  };

  return (
    <div className={`custom-node player-choice-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">⚐</span>
        <span className="node-title">{data.label || 'Player Choice'}</span>
      </div>
      <div className="node-body">
        <div className="node-config">
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.sendMessageFirst !== false}
              onChange={(e) => data.onChange?.('sendMessageFirst', e.target.checked)}
            />
            Send Character Message First
          </label>
          <div className={`form-group ${data.sendMessageFirst === false ? 'disabled' : ''}`}>
            <label>Character Prompt:</label>
            <textarea
              value={data.prompt || ''}
              onChange={(e) => data.onChange?.('prompt', e.target.value)}
              placeholder="What the character says/asks..."
              className="node-textarea"
              rows={3}
              disabled={data.sendMessageFirst === false}
            />
          </div>
          <div className="form-group">
            <label>Modal Description:</label>
            <textarea
              value={data.description || ''}
              onChange={(e) => data.onChange?.('description', e.target.value)}
              placeholder="Description shown in the choice modal..."
              className="node-textarea"
              rows={2}
            />
          </div>
          <div className="form-group">
            <label>Choices:</label>
            <div className="choices-list">
              {choices.map((choice, index) => (
                <div key={choice.id} className="choice-item">
                  <div className="choice-header">
                    <input
                      type="text"
                      value={choice.label}
                      onChange={(e) => updateChoice(index, 'label', e.target.value)}
                      placeholder={`Choice ${index + 1} label`}
                      className="node-input"
                    />
                    {choices.length > 2 && (
                      <button
                        className="choice-remove"
                        onClick={() => removeChoice(index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <textarea
                    value={choice.description}
                    onChange={(e) => updateChoice(index, 'description', e.target.value)}
                    placeholder="Choice description..."
                    className="node-textarea small"
                    rows={2}
                  />
                </div>
              ))}
            </div>
            <button className="choice-add" onClick={addChoice}>
              + Add Choice
            </button>
          </div>
        </div>
      </div>
      {choices.map((choice, index) => (
        <Handle
          key={choice.id}
          type="source"
          position={Position.Bottom}
          id={choice.id}
          style={{ left: `${(index + 1) * (100 / (choices.length + 1))}%` }}
        />
      ))}
      <div className="handle-labels choice-labels">
        {choices.map((choice, index) => (
          <span
            key={choice.id}
            className="handle-label"
            style={{ left: `${(index + 1) * (100 / (choices.length + 1))}%` }}
          >
            {choice.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(PlayerChoiceNode);
