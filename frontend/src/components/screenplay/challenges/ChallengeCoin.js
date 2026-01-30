import React from 'react';
import { CoinFlipModal } from '../../modals/ChallengeModals';

function ChallengeCoin({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <CoinFlipModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeCoin;
