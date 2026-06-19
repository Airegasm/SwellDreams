import React, { useState } from 'react';
import './MemberTargetPicker.css';

/**
 * Target-character picker for multichar attribute mutators (flow set_attribute,
 * triggers, checkpoints). Shows the current target and opens a popup listing
 * "Whole group" + each member (portrait + name) to choose from.
 */
function MemberTargetPicker({ members = [], value, onChange }) {
  const [open, setOpen] = useState(false);
  if (!members.length) return null;

  const selected = members.find(m => m.id === value);
  const label = value ? (selected?.name || 'Character') : 'Whole group';

  const pick = (id) => { onChange(id); setOpen(false); };

  return (
    <div className="member-target-picker">
      <button
        type="button"
        className="member-target-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="Target character"
      >
        🎯 {label} ▾
      </button>
      {open && (
        <>
          <div className="member-target-backdrop" onClick={() => setOpen(false)} />
          <div className="member-target-popup" onClick={(e) => e.stopPropagation()}>
            <div className="member-target-title">Choose target</div>
            <button
              type="button"
              className={`member-target-option ${!value ? 'selected' : ''}`}
              onClick={() => pick('')}
            >
              <span className="member-target-avatar group">👥</span>
              <span className="member-target-name">Whole group</span>
            </button>
            {members.map(m => (
              <button
                type="button"
                key={m.id}
                className={`member-target-option ${value === m.id ? 'selected' : ''}`}
                onClick={() => pick(m.id)}
              >
                {m.portrait
                  ? <img className="member-target-avatar" src={m.portrait} alt="" />
                  : <span className="member-target-avatar">{(m.name || '?').charAt(0).toUpperCase()}</span>}
                <span className="member-target-name">{m.name || 'Character'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default MemberTargetPicker;
