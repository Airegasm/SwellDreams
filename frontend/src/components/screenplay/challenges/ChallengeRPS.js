import React from 'react';
import { RPSModal } from '../../modals/ChallengeModals';

function ChallengeRPS({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <RPSModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeRPS;
