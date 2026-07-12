import React from 'react';
import { useApp } from '../context/AppContext';

// Auto-pump rows: one compact row per pumpable character in the session —
// name · live capacity · AUTO-PUMP toggle. The toggle's armed state lives in AppContext
// (autoPumpArmed / toggleAutoPump) so the desktop strip and the mobile block stay in sync;
// its behavior gets wired later. Rendered in two places:
//   • AutoPumpHeader (default export) — fixed strip hanging from the desktop top frame
//   • AutoPumpRows — embedded in-flow under the mobile chat header (Chat.js)
export function AutoPumpRows() {
  const { characters, settings, sessionState, autoPumpArmed, toggleAutoPump } = useApp();

  const active = (characters || []).find(c => c.id === settings?.activeCharacterId);
  if (!active) return null;
  const mm = active.multiChar?.characters || [];
  const isGroup = !!active.multiChar?.enabled && mm.length > 1;

  // Pumpable rows: group → members flagged isPumpable (base member rides the main character
  // capacity); single → the card itself when isPumpable.
  const rows = isGroup
    ? mm.filter(m => m?.isPumpable && m?.name).map(m => ({
        id: m.id,
        name: m.name,
        cap: mm[0] && m.id === mm[0].id ? (sessionState.characterCapacity ?? 0) : (sessionState.memberCapacities?.[m.id] ?? 0)
      }))
    : (active.isPumpable ? [{ id: 'base', name: active.name, cap: sessionState.characterCapacity ?? 0 }] : []);

  if (!rows.length) return null;

  return (
    <>
      {rows.map(r => {
        const on = !!autoPumpArmed[r.id];
        return (
          <div className="auto-pump-row" key={r.id}>
            <span className="apr-name" title={r.name}>{r.name}</span>
            <span className="apr-cap">{Math.round(r.cap)}%</span>
            <button type="button"
              className={`apr-btn ${on ? 'on' : ''}`}
              onClick={() => toggleAutoPump(r.id)}
              title={on ? `Auto-pump armed for ${r.name} — click to disarm` : `Arm auto-pump for ${r.name}`}>
              {on ? 'AUTO-PUMP OFF' : 'AUTO-PUMP ON'}
            </button>
          </div>
        );
      })}
    </>
  );
}

// Desktop strip: fixed under the top frame, centered between the corner toppers.
function AutoPumpHeader({ visible }) {
  const { characters, settings } = useApp();
  if (!visible) return null;
  // Cheap emptiness pre-check so we don't render an empty shell (AutoPumpRows also self-nulls).
  const active = (characters || []).find(c => c.id === settings?.activeCharacterId);
  const mm = active?.multiChar?.characters || [];
  const isGroup = !!active?.multiChar?.enabled && mm.length > 1;
  const hasRows = isGroup ? mm.some(m => m?.isPumpable && m?.name) : !!active?.isPumpable;
  if (!hasRows) return null;

  return (
    <div className="auto-pump-header">
      <AutoPumpRows />
    </div>
  );
}

export default AutoPumpHeader;
