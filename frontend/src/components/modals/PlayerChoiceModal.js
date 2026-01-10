import React from 'react';
import { substituteVariables } from '../../utils/variableSubstitution';

function PlayerChoiceModal({ choiceData, onChoice, subContext }) {
  if (!choiceData) return null;

  const { description, choices } = choiceData;

  return (
    <div className="player-choice-panel">
      <div className="player-choice-panel-header">
        <h3>Make Your Choice</h3>
      </div>
      <div className="player-choice-panel-body">
        {description && (
          <p className="choice-description">{substituteVariables(description, subContext)}</p>
        )}
        <div className="choice-buttons">
          {choices.map((choice) => (
            <button
              key={choice.id}
              className="btn btn-choice"
              onClick={() => onChoice(choice)}
            >
              <div className="choice-button-label">{substituteVariables(choice.label, subContext)}</div>
              {choice.description && (
                <div className="choice-button-desc">{substituteVariables(choice.description, subContext)}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PlayerChoiceModal;
