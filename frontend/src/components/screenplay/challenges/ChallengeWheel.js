import React from 'react';
import { PrizeWheelModal } from '../../modals/ChallengeModals';

function ChallengeWheel({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <PrizeWheelModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeWheel;
