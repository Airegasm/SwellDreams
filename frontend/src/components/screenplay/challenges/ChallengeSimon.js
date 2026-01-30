import React from 'react';
import { SimonChallengeModal } from '../../modals/ChallengeModals';

function ChallengeSimon({ data, onComplete, onPenalty, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  const handlePenalty = (penaltyData) => {
    if (onPenalty) {
      onPenalty(penaltyData);
    }
  };

  return (
    <SimonChallengeModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
      onPenalty={handlePenalty}
    />
  );
}

export default ChallengeSimon;
