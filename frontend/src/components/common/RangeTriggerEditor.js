import React from 'react';
import TriggerRow from './TriggerRow';
import './CheckpointInjections.css';

const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// A range's triggers may be a legacy flat array (= all sequential) or { sequential, random }.
const norm = (v) => Array.isArray(v)
  ? { sequential: v, random: [] }
  : { sequential: v?.sequential || [], random: v?.random || [] };

// Per-range trigger editor: a Sequential list (fire in order on entry) + Random Chance
// blocks (roll each message; group of triggers, or one-at-random from a Trigger Set).
// `rowProps` (isPumpable, reminders, globalReminders, members, profiles) pass through to TriggerRow.
function RangeTriggerEditor({ value, onChange, triggerSets = [], ...rowProps }) {
  const data = norm(value);
  const emit = (patch) => onChange({ ...data, ...patch });

  // --- Sequential ---
  const addSeq = () => emit({ sequential: [...data.sequential, { id: newId('trg'), type: '', value: '' }] });
  const updSeq = (i, t) => emit({ sequential: data.sequential.map((x, idx) => (idx === i ? t : x)) });
  const rmSeq = (i) => emit({ sequential: data.sequential.filter((_, idx) => idx !== i) });
  const moveSeq = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= data.sequential.length) return;
    const a = [...data.sequential];
    [a[i], a[j]] = [a[j], a[i]];
    emit({ sequential: a });
  };

  // --- Random blocks ---
  const updBlock = (i, patch) => emit({ random: data.random.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });
  const addBlock = () => emit({ random: [...data.random, { id: newId('blk'), chance: 50, repeats: 1, mode: 'group', triggers: [], setId: '' }] });
  const rmBlock = (i) => emit({ random: data.random.filter((_, idx) => idx !== i) });
  const addBlockTrigger = (i) => updBlock(i, { triggers: [...(data.random[i].triggers || []), { id: newId('trg'), type: '', value: '' }] });
  const updBlockTrigger = (i, ti, t) => updBlock(i, { triggers: (data.random[i].triggers || []).map((x, idx) => (idx === ti ? t : x)) });
  const rmBlockTrigger = (i, ti) => updBlock(i, { triggers: (data.random[i].triggers || []).filter((_, idx) => idx !== ti) });

  return (
    <div className="range-trigger-editor">
      <div className="rte-section">
        <div className="rte-head"><strong>Sequential</strong> <span className="section-hint">run top-to-bottom on entry; a trigger with a Fire% holds the rest of the sequence until capacity reaches that %</span></div>
        {data.sequential.map((t, i) => (
          <TriggerRow key={t.id || i} trigger={t} onChange={(u) => updSeq(i, u)} onRemove={() => rmSeq(i)} showFirePercent
            onMoveUp={i > 0 ? () => moveSeq(i, -1) : undefined}
            onMoveDown={i < data.sequential.length - 1 ? () => moveSeq(i, 1) : undefined}
            {...rowProps} />
        ))}
        <button type="button" className="btn btn-sm btn-secondary" onClick={addSeq}>+ Sequential Trigger</button>
      </div>

      <div className="rte-section" style={{ marginTop: 10 }}>
        <div className="rte-head"><strong>Random Chance</strong> <span className="section-hint">roll each message once sequential completes; carries up through trigger-less ranges</span></div>
        {data.random.map((b, i) => (
          <div className="rte-block" key={b.id || i}>
            <div className="rte-block-head">
              <label className="ci-num" title="% chance per message">%<input type="number" min={0} max={100} value={b.chance ?? 50} onChange={(e) => updBlock(i, { chance: parseInt(e.target.value) || 0 })} /></label>
              <label className="ci-num" title="Max fires (-1 = unlimited)">reps<input type="number" min={-1} value={b.repeats ?? 1} onChange={(e) => updBlock(i, { repeats: parseInt(e.target.value) })} /></label>
              <select value={b.mode || 'group'} onChange={(e) => updBlock(i, { mode: e.target.value })}>
                <option value="group">Group</option>
                <option value="set">From Set (random 1)</option>
              </select>
              <button type="button" className="ci-del" onClick={() => rmBlock(i)} title="Remove block">×</button>
            </div>
            {b.mode === 'set' ? (
              <select value={b.setId || ''} onChange={(e) => updBlock(i, { setId: e.target.value })} style={{ width: '100%', marginTop: 4 }}>
                <option value="">Select Trigger Set…</option>
                {triggerSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <div className="rte-block-triggers">
                {(b.triggers || []).map((t, ti) => (
                  <TriggerRow key={t.id || ti} trigger={t} onChange={(u) => updBlockTrigger(i, ti, u)} onRemove={() => rmBlockTrigger(i, ti)} {...rowProps} />
                ))}
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => addBlockTrigger(i)}>+ Trigger</button>
              </div>
            )}
          </div>
        ))}
        <button type="button" className="ci-add" onClick={addBlock}>+ Random Block</button>
      </div>
    </div>
  );
}

export default RangeTriggerEditor;
