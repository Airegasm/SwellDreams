import React from 'react';
import { ReflexChallengeModal } from '../../modals/ChallengeModals';

function ChallengeReflex({ data, onComplete, onPenalty, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  const handlePenalty = (penaltyData) => {
    if (onPenalty) {
      onPenalty(penaltyData);
    }
  };

  return (
    <ReflexChallengeModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
      onPenalty={handlePenalty}
    />
  );
}

export default ChallengeReflex;
