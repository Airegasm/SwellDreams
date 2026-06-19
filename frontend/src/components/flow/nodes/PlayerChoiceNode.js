import React, { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

const newOpId = () => `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const makeVarOp = () => ({ id: newOpId(), varType: 'custom', variable: '', operation: 'set', value: '' });

function PlayerChoiceNode({ data, selected }) {
  const [choices, setChoices] = useState(data.choices || [
    { id: 'choice-1', label: 'Option A', description: '' },
    { id: 'choice-2', label: 'Option B', description: '' }
  ]);

  const commit = (newChoices) => {
    setChoices(newChoices);
    data.onChange?.('choices', newChoices);
  };

  const addChoice = () => {
    const newId = `choice-${Date.now()}`;
    commit([...choices, {
      id: newId,
      label: `Option ${String.fromCharCode(65 + choices.length)}`,
      description: '',
      playerResponse: ''
    }]);
  };

  const updateChoice = (index, key, value) => {
    commit(choices.map((c, i) => (i === index ? { ...c, [key]: value } : c)));
  };

  const removeChoice = (index) => {
    if (choices.length <= 2) return;
    commit(choices.filter((_, i) => i !== index));
  };

  // --- Per-choice variable operations (set / inc / dec / mult / div) ---
  const toggleSetVariables = (index, checked) => {
    commit(choices.map((c, i) => {
      if (i !== index) return c;
      let ops = c.variableOps || [];
      if (checked && ops.length === 0) ops = [makeVarOp()];
      return { ...c, setVariablesEnabled: checked, variableOps: ops };
    }));
  };

  const addVarOp = (index) => {
    commit(choices.map((c, i) => (
      i === index ? { ...c, variableOps: [...(c.variableOps || []), makeVarOp()] } : c
    )));
  };

  const updateVarOp = (index, opIndex, key, value) => {
    commit(choices.map((c, i) => {
      if (i !== index) return c;
      const ops = (c.variableOps || []).map((op, j) => (j === opIndex ? { ...op, [key]: value } : op));
      return { ...c, variableOps: ops };
    }));
  };

  const removeVarOp = (index, opIndex) => {
    commit(choices.map((c, i) => (
      i === index ? { ...c, variableOps: (c.variableOps || []).filter((_, j) => j !== opIndex) } : c
    )));
  };

  // Group choices into columns of two: [ [c0,c1], [c2,c3], ... ]
  const choiceColumns = [];
  for (let i = 0; i < choices.length; i += 2) {
    choiceColumns.push(choices.slice(i, i + 2).map((choice, j) => ({ choice, index: i + j })));
  }

  const renderChoice = (choice, index) => (
    <div key={choice.id} className="choice-item">
      <label className="choice-field-label">Choice {index + 1} — Button Text:</label>
      <div className="choice-header">
        <input
          type="text"
          value={choice.label}
          onChange={(e) => updateChoice(index, 'label', e.target.value)}
          placeholder={`Choice ${index + 1} label`}
          className="node-input"
        />
        {choices.length > 2 && (
          <button className="choice-remove" onClick={() => removeChoice(index)}>×</button>
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

      {/* Variable operations applied when this choice is selected */}
      <label className="node-checkbox small">
        <input
          type="checkbox"
          checked={choice.setVariablesEnabled === true}
          onChange={(e) => toggleSetVariables(index, e.target.checked)}
        />
        Set Variables
      </label>
      {choice.setVariablesEnabled === true && (
        <div className="choice-varops">
          {(choice.variableOps || []).map((op, opIndex) => (
            <div className="varop-row" key={op.id || opIndex}>
              <select
                className="node-select tiny"
                value={op.varType || 'custom'}
                onChange={(e) => updateVarOp(index, opIndex, 'varType', e.target.value)}
                title="Variable type"
              >
                <option value="custom">Custom</option>
                <option value="system">System</option>
              </select>
              {op.varType === 'system' ? (
                <select
                  className="node-select tiny"
                  value={op.variable || ''}
                  onChange={(e) => updateVarOp(index, opIndex, 'variable', e.target.value)}
                >
                  <option value="">Var…</option>
                  <option value="capacity">Capacity</option>
                  <option value="pain">Pain</option>
                  <option value="emotion">Emotion</option>
                </select>
              ) : (
                <input
                  type="text"
                  className="node-input tiny"
                  value={op.variable || ''}
                  onChange={(e) => updateVarOp(index, opIndex, 'variable', e.target.value)}
                  placeholder="variable"
                />
              )}
              <select
                className="node-select tiny"
                value={op.operation || 'set'}
                onChange={(e) => updateVarOp(index, opIndex, 'operation', e.target.value)}
                title="Operation"
              >
                <option value="set">Set</option>
                <option value="inc">+ Inc</option>
                <option value="dec">− Dec</option>
                <option value="mult">× Mult</option>
                <option value="div">÷ Div</option>
              </select>
              <input
                type="text"
                className="node-input tiny"
                value={op.value ?? ''}
                onChange={(e) => updateVarOp(index, opIndex, 'value', e.target.value)}
                placeholder="value"
              />
              <button
                className="choice-remove"
                onClick={() => removeVarOp(index, opIndex)}
                title="Remove variable"
              >×</button>
            </div>
          ))}
          <button className="varop-add" onClick={() => addVarOp(index)}>+ Variable</button>
        </div>
      )}
    </div>
  );

  const isMulti = data.nodeVariant === 'multi';

  return (
    <div className={`custom-node player-choice-node ${isMulti ? 'choose-multi-node' : ''} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">{isMulti ? '☑' : '⚐'}</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder={isMulti ? 'Choose Multi' : 'Player Choice'}
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
        {isMulti && (
          <div className="config-hint" style={{ marginBottom: 6 }}>
            Player checks one or more options; every selected branch fires in parallel.
          </div>
        )}
        <div className="player-choice-columns">
          {/* Column 1: basic settings */}
          <div className="pc-column pc-settings">
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
          </div>

          {/* Choice columns: two choices each */}
          {choiceColumns.map((col, ci) => (
            <div className="pc-column pc-choices" key={ci}>
              <label className="choice-field-label pc-column-title">
                {col.length > 1 ? `Choices ${ci * 2 + 1}–${ci * 2 + 2}` : `Choice ${ci * 2 + 1}`}
              </label>
              {col.map(({ choice, index }) => renderChoice(choice, index))}
            </div>
          ))}
        </div>
        <button className="choice-add" onClick={addChoice}>+ Add Choice</button>
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
