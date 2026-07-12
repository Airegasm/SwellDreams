import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

// Header extension strip: one compact row per pumpable character in the session —
// name · live capacity · AUTO-PUMP toggle. The toggle is visual-only for now (state
// is kept here per member id, lights up when armed); its behavior gets wired later.
// Kept mounted across route changes (visible prop) so the toggles don't reset on nav.
function AutoPumpHeader({ visible }) {
  const { characters, settings, sessionState } = useApp();
  const [autoPump, setAutoPump] = useState({}); // member id -> armed?

  if (!visible) return null;

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

  const toggle = (id) => setAutoPump(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="auto-pump-header">
      {rows.map(r => {
        const on = !!autoPump[r.id];
        return (
          <div className="auto-pump-row" key={r.id}>
            <span className="apr-name" title={r.name}>{r.name}</span>
            <span className="apr-cap">{Math.round(r.cap)}%</span>
            <button type="button"
              className={`apr-btn ${on ? 'on' : ''}`}
              onClick={() => toggle(r.id)}
              title={on ? `Auto-pump armed for ${r.name} — click to disarm` : `Arm auto-pump for ${r.name}`}>
              {on ? 'AUTO-PUMP OFF' : 'AUTO-PUMP ON'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default AutoPumpHeader;
