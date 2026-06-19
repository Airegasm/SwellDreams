import React, { useState } from 'react';
import { substituteVariables } from '../../utils/variableSubstitution';

function ChooseMultiModal({ choiceData, onConfirm, subContext, compact = false }) {
  const [selected, setSelected] = useState(() => new Set());

  if (!choiceData) return null;
  const { description, choices = [] } = choiceData;

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirm = () => {
    const chosen = choices.filter(c => selected.has(c.id));
    onConfirm(chosen);
  };

  return (
    <div className={`player-choice-panel choose-multi-panel ${compact ? 'compact' : ''}`}>
      <div className="player-choice-panel-header">
        <h3>Select All That Apply</h3>
      </div>
      <div className="player-choice-panel-body">
        {description && (
          <p className="choice-description">{substituteVariables(description, subContext)}</p>
        )}
        <div className="choice-buttons">
          {choices.map((choice) => {
            const isOn = selected.has(choice.id);
            return (
              <button
                key={choice.id}
                className={`btn btn-choice choose-multi-option ${isOn ? 'selected' : ''}`}
                onClick={() => toggle(choice.id)}
                aria-pressed={isOn}
              >
                <span className="choose-multi-check">{isOn ? '☑' : '☐'}</span>
                <span className="choose-multi-text">
                  <span className="choice-button-label">{substituteVariables(choice.label, subContext)}</span>
                  {choice.description && (
                    <span className="choice-button-desc">{substituteVariables(choice.description, subContext)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <button
          className="btn btn-primary choose-multi-confirm"
          onClick={confirm}
          disabled={selected.size === 0}
        >
          Confirm{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>
    </div>
  );
}

export default ChooseMultiModal;
