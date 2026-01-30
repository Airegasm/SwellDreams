import React from 'react';
import { DiceRollModal } from '../../modals/ChallengeModals';

function ChallengeDice({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <DiceRollModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeDice;
