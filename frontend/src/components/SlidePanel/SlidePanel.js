import React from 'react';
import './SlidePanel.css';
import PlayerChoiceModal from '../modals/PlayerChoiceModal';
import { ChallengeModal } from '../modals/ChallengeModals';
import { substituteVariables } from '../../utils/variableSubstitution';

function SlidePanel({
  playerChoiceData,
  simpleABData,
  challengeData,
  onPlayerChoice,
  onSimpleAB,
  onChallengeResult,
  onChallengeCancel,
  subContext
}) {
  const isOpen = !!(playerChoiceData || simpleABData || challengeData);

  const renderContent = () => {
    if (playerChoiceData) {
      return (
        <PlayerChoiceModal
          choiceData={playerChoiceData}
          onChoice={onPlayerChoice}
          subContext={subContext}
          compact={true}
        />
      );
    }

    if (simpleABData) {
      return (
        <div className="simple-ab-compact">
          <div className="simple-ab-header">
            <h3>Choose</h3>
          </div>
          <div className="simple-ab-body">
            {simpleABData.description && (
              <p className="ab-description">{substituteVariables(simpleABData.description, subContext)}</p>
            )}
            <div className="ab-buttons-compact">
              <button
                className="btn-ab-compact btn-ab-a"
                onClick={() => onSimpleAB('a')}
              >
                <span className="ab-label">{simpleABData.labelA}</span>
                {simpleABData.descriptionA && (
                  <span className="ab-desc">{substituteVariables(simpleABData.descriptionA, subContext)}</span>
                )}
              </button>
              <button
                className="btn-ab-compact btn-ab-b"
                onClick={() => onSimpleAB('b')}
              >
                <span className="ab-label">{simpleABData.labelB}</span>
                {simpleABData.descriptionB && (
                  <span className="ab-desc">{substituteVariables(simpleABData.descriptionB, subContext)}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (challengeData) {
      return (
        <ChallengeModal
          challengeData={challengeData}
          onResult={onChallengeResult}
          onCancel={onChallengeCancel}
          compact={true}
        />
      );
    }

    return null;
  };

  return (
    <div className={`slide-panel ${isOpen ? 'open' : ''}`}>
      <div className="slide-panel-content">
        {renderContent()}
      </div>
    </div>
  );
}

export default SlidePanel;
