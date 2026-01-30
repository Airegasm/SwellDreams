import React from 'react';
import { CardDrawModal } from '../../modals/ChallengeModals';

function ChallengeCard({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <CardDrawModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeCard;
