import React from 'react';
import TriggerRow from './TriggerRow';
import './CheckpointInjections.css';

const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const trigLabel = (t, idx) => {
  if (!t) return `${idx + 1}.`;
  const v = (t.value ?? t.context ?? t.skinId ?? '');
  return `${idx + 1}. ${t.type || 'trigger'}${v !== '' ? ` = ${String(v).slice(0, 18)}` : ''}`;
};

// Ordered list of trigger blocks for buttons / the Fire-Trigger-Set flow node.
// Sequential block fires all its triggers in order; random fires one at random.
// Each entry is EITHER a cross-set reference { setId, triggerId } into a saved Trigger Set,
// OR an inline trigger object { id, type, ... } authored right here with TriggerRow
// (the backend's resolveBlockTrigger already accepts both shapes).
// rowProps forwards TriggerRow context (isPumpable, members, profiles, ...); callers without
// a bound character get the Trigger-Sets-editor convention: all options available.
function TriggerBlockComposer({ value, onChange, triggerSets = [], rowProps = {} }) {
  const blocks = Array.isArray(value) ? value : [];
  const rp = { isPumpable: true, reminders: [], globalReminders: [], ...rowProps };
  const updBlock = (i, patch) => onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const addBlock = () => onChange([...blocks, { id: newId('blk'), type: 'sequential', triggers: [] }]);
  const rmBlock = (i) => onChange(blocks.filter((_, idx) => idx !== i));
  const addRef = (i) => updBlock(i, { triggers: [...(blocks[i].triggers || []), { setId: '', triggerId: '' }] });
  const addInline = (i) => updBlock(i, { triggers: [...(blocks[i].triggers || []), { id: newId('trg'), type: 'system_message' }] });
  const updRef = (i, ri, patch) => updBlock(i, { triggers: (blocks[i].triggers || []).map((r, idx) => (idx === ri ? { ...r, ...patch } : r)) });
  const setTrig = (i, ri, next) => updBlock(i, { triggers: (blocks[i].triggers || []).map((r, idx) => (idx === ri ? next : r)) });
  const rmRef = (i, ri) => updBlock(i, { triggers: (blocks[i].triggers || []).filter((_, idx) => idx !== ri) });

  return (
    <div className="trigger-block-composer">
      {blocks.map((b, i) => (
        <div className="rte-block" key={b.id || i}>
          <div className="rte-block-head">
            <select value={b.type || 'sequential'} onChange={(e) => updBlock(i, { type: e.target.value })}>
              <option value="sequential">Sequential (all)</option>
              <option value="random">Random (one)</option>
            </select>
            <button type="button" className="ci-del" onClick={() => rmBlock(i)} title="Remove block">×</button>
          </div>
          {(b.triggers || []).map((r, ri) => {
            // Inline trigger — full TriggerRow editor (has its own remove button).
            if (r && r.type && !r.setId) {
              return (
                <div key={r.id || ri} style={{ marginBottom: 4 }}>
                  <TriggerRow trigger={r} onChange={(t) => setTrig(i, ri, t)} onRemove={() => rmRef(i, ri)} {...rp} />
                </div>
              );
            }
            // Set reference — pick a saved Trigger Set, then one of its triggers.
            const set = triggerSets.find(s => s.id === r.setId);
            return (
              <div key={ri} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                <select value={r.setId || ''} onChange={(e) => updRef(i, ri, { setId: e.target.value, triggerId: '' })}>
                  <option value="">Set…</option>
                  {triggerSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={r.triggerId ?? ''} onChange={(e) => updRef(i, ri, { triggerId: e.target.value })} style={{ flex: 1, minWidth: 100 }}>
                  <option value="">Trigger…</option>
                  {(set?.triggers || []).map((t, idx) => <option key={t.id || idx} value={t.id || String(idx)}>{trigLabel(t, idx)}</option>)}
                </select>
                <button type="button" className="ci-del" onClick={() => rmRef(i, ri)} title="Remove">×</button>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => addInline(i)} title="Author a trigger right here">+ New Trigger</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => addRef(i)} title="Reference a trigger from a saved Trigger Set">+ From Set</button>
          </div>
        </div>
      ))}
      <button type="button" className="ci-add" onClick={addBlock}>+ Block</button>
    </div>
  );
}

export default TriggerBlockComposer;
