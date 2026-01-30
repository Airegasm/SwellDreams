import React from 'react';
import { NumberGuessModal } from '../../modals/ChallengeModals';

function ChallengeNumberGuess({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <NumberGuessModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeNumberGuess;
