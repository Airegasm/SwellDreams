import React from 'react';
import { substituteVariables } from '../../utils/variableSubstitution';

function PlayerChoiceModal({ choiceData, onChoice, subContext, compact = false }) {
  if (!choiceData) return null;

  const { description, choices } = choiceData;
  const limitedChoices = choices; // No cap — render all configured choices

  return (
    <div className={`player-choice-panel ${compact ? 'compact' : ''}`}>
      <div className="player-choice-panel-header">
        <h3>Make Your Choice</h3>
      </div>
      <div className="player-choice-panel-body">
        {description && (
          <p className="choice-description">{substituteVariables(description, subContext)}</p>
        )}
        <div className="choice-buttons">
          {limitedChoices.map((choice) => (
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
          {choiceData.addRandom && limitedChoices.length > 0 && (
            <button
              className="btn btn-choice choice-random"
              title="Pick one of the options above at random"
              onClick={() => onChoice(limitedChoices[Math.floor(Math.random() * limitedChoices.length)])}
            >
              <div className="choice-button-label">🎲 Random</div>
            </button>
          )}
          {choiceData.addCancel && (
            <button
              className="btn btn-choice choice-cancel"
              title="Close this popup and abort the running trigger tree"
              onClick={() => onChoice({ id: '__cancel__', label: 'Cancel' })}
            >
              <div className="choice-button-label">✕ Cancel</div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PlayerChoiceModal;
