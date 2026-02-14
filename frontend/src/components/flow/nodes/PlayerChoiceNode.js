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
      description: '',
      playerResponse: ''
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
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Player Choice"
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
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.aiMessageIntroEnabled === true}
              onChange={(e) => data.onChange?.('aiMessageIntroEnabled', e.target.checked)}
            />
            AI Message Intro
          </label>
          <div className={`form-group ${data.aiMessageIntroEnabled !== true ? 'disabled' : ''}`}>
            <label>Intro Message (use [Choices] for list):</label>
            <textarea
              value={data.aiMessageIntro || ''}
              onChange={(e) => data.onChange?.('aiMessageIntro', e.target.value)}
              placeholder="AI message before choices appear. Use [Choices] to list options."
              className="node-textarea"
              rows={3}
              disabled={data.aiMessageIntroEnabled !== true}
            />
            <label className="node-checkbox small">
              <input
                type="checkbox"
                checked={data.aiMessageIntroSuppressLlm === true}
                onChange={(e) => data.onChange?.('aiMessageIntroSuppressLlm', e.target.checked)}
                disabled={data.aiMessageIntroEnabled !== true}
              />
              Suppress LLM Enhancement
            </label>
          </div>
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.sendMessageFirst !== false}
              onChange={(e) => data.onChange?.('sendMessageFirst', e.target.checked)}
            />
            LLM-Generated Character Message
          </label>
          <div className={`form-group ${data.sendMessageFirst === false ? 'disabled' : ''}`}>
            <label>Character Prompt (for LLM):</label>
            <textarea
              value={data.prompt || ''}
              onChange={(e) => data.onChange?.('prompt', e.target.value)}
              placeholder="What the character says/asks (LLM will generate)..."
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
                  <label className="choice-field-label">Choice Button Text:</label>
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
                  <label className="choice-field-label">Choice Description:</label>
                  <textarea
                    value={choice.description}
                    onChange={(e) => updateChoice(index, 'description', e.target.value)}
                    placeholder="Explanation shown in the choice modal..."
                    className="node-textarea small"
                    rows={2}
                  />
                  <label className="node-checkbox small">
                    <input
                      type="checkbox"
                      checked={choice.playerResponseEnabled === true}
                      onChange={(e) => updateChoice(index, 'playerResponseEnabled', e.target.checked)}
                    />
                    Player Response
                  </label>
                  <textarea
                    value={choice.playerResponse || ''}
                    onChange={(e) => updateChoice(index, 'playerResponse', e.target.value)}
                    placeholder="Player response. Use [Choice] for the choice label."
                    className={`node-textarea small ${choice.playerResponseEnabled !== true ? 'disabled' : ''}`}
                    rows={2}
                    disabled={choice.playerResponseEnabled !== true}
                  />
                  <label className="node-checkbox small">
                    <input
                      type="checkbox"
                      checked={choice.playerResponseSuppressLlm === true}
                      onChange={(e) => updateChoice(index, 'playerResponseSuppressLlm', e.target.checked)}
                      disabled={choice.playerResponseEnabled !== true}
                    />
                    Suppress LLM Enhancement
                  </label>
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
          style={{
            left: `${(index + 1) * (100 / (choices.length + 1))}%`,
            transform: 'translateX(-50%)'
          }}
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
