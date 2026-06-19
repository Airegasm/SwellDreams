import React, { memo } from 'react';
import PlayerChoiceNode from './PlayerChoiceNode';

// Choose Multi reuses the Player Choice editor UI (same choices, per-choice
// variable ops, etc.) — it only differs at runtime: the modal shows checkboxes
// and every selected branch fires in parallel. The `nodeVariant` flag switches
// the header/hint; it is injected at render time and not persisted.
function ChooseMultiNode({ data, selected }) {
  return <PlayerChoiceNode data={{ ...data, nodeVariant: 'multi' }} selected={selected} />;
}

export default memo(ChooseMultiNode);
