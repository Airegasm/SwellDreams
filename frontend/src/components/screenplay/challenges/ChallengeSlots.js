import React from 'react';
import { SlotMachineModal } from '../../modals/ChallengeModals';

function ChallengeSlots({ data, onComplete, substituteVariables }) {
  const handleResult = (result) => {
    onComplete(result);
  };

  return (
    <SlotMachineModal
      challengeData={data}
      onResult={handleResult}
      onCancel={() => onComplete({ value: null, cancelled: true })}
    />
  );
}

export default ChallengeSlots;
