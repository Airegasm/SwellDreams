import React, { useState, useEffect } from 'react';
import ScopeTreeSection from './ScopeTreeSection';
import { useApp } from '../../context/AppContext';

// Phase 3 (Flow→Trigger): per-card Event Triggers — the tree-side replacement for a flow's
// trigger node. Each binding = { id, event, filter, ref } and fires its Trigger Tree when the
// chosen event occurs. Stored on the card's treeRefs.events array.
//
//   event  ∈ device_on | device_off | player_state_change | char_state_change | idle | random
//   filter = { deviceId } | { stateType, operator, value, fireOnce } | { idleSeconds } | { probability }
//            (+ optional { cooldown } = minimum messages between fires)
//   ref    = {inline}|{treeId} (handled by ScopeTreeSection)

const EVENT_TYPES = [
  { value: 'device_on', label: 'Device turns ON' },
  { value: 'device_off', label: 'Device turns OFF' },
  { value: 'player_state_change', label: 'Player state change' },
  { value: 'char_state_change', label: 'Character state change' },
  { value: 'idle', label: 'Idle (no activity)' },
  { value: 'random', label: 'Random (per reply)' },
];

const PLAYER_STATES = [
  { value: 'capacity', label: 'Capacity (%)' },
  { value: 'pain', label: 'Pain (0–10)' },
  { value: 'emotion', label: 'Emotion' },
];
const CHAR_STATES = [{ value: 'characterCapacity', label: 'Character Capacity (%)' }];
const OPERATORS = ['>=', '>', '<=', '<', '==', '!='];

const rid = () => `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const newBinding = () => ({
  id: rid(),
  event: 'device_on',
  filter: {},
  ref: { inline: { id: `tree-${rid()}`, name: 'Event Script', nodes: [] } },
});

function EventTriggersSection({ events = [], onChange, rowProps = {}, source = 'from card' }) {
  const { api } = useApp();
  const [devices, setDevices] = useState([]);
  useEffect(() => { api.getDevices().then(d => setDevices(Array.isArray(d) ? d : [])).catch(() => {}); }, [api]);

  const list = Array.isArray(events) ? events : [];
  const update = (id, patch) => onChange(list.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const updateFilter = (id, fpatch) => onChange(list.map(b => (b.id === id ? { ...b, filter: { ...(b.filter || {}), ...fpatch } } : b)));
  const add = () => onChange([...list, newBinding()]);
  const remove = (id) => onChange(list.filter(b => b.id !== id));

  const deviceValue = (d) => d.deviceId || d.ip || '';
  const deviceLabel = (d) => `${d.name || d.deviceType || 'Device'} (${deviceValue(d)})`;

  const renderFilter = (b) => {
    const f = b.filter || {};
    switch (b.event) {
      case 'device_on':
      case 'device_off':
        return (
          <select value={f.deviceId || ''} onChange={(e) => updateFilter(b.id, { deviceId: e.target.value })} title="Which device (blank = any)">
            <option value="">— any device —</option>
            {devices.map(d => <option key={deviceValue(d)} value={deviceValue(d)}>{deviceLabel(d)}</option>)}
          </select>
        );
      case 'player_state_change':
      case 'char_state_change': {
        const states = b.event === 'char_state_change' ? CHAR_STATES : PLAYER_STATES;
        return (
          <>
            <select value={f.stateType || states[0].value} onChange={(e) => updateFilter(b.id, { stateType: e.target.value })}>
              {states.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={f.operator || '>='} onChange={(e) => updateFilter(b.id, { operator: e.target.value })}>
              {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <input type="number" value={f.value ?? ''} placeholder="value" style={{ width: 70 }}
              onChange={(e) => updateFilter(b.id, { value: e.target.value === '' ? '' : Number(e.target.value) })} />
            <label className="tree-check" title="Fire only once per crossing — re-arms when the condition becomes false again">
              <input type="checkbox" checked={!!f.fireOnce} onChange={(e) => updateFilter(b.id, { fireOnce: e.target.checked })} /> once
            </label>
          </>
        );
      }
      case 'idle':
        return (
          <label className="section-hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            after
            <input type="number" value={f.idleSeconds ?? 300} min={5} style={{ width: 80 }}
              onChange={(e) => updateFilter(b.id, { idleSeconds: Number(e.target.value) })} /> s idle
          </label>
        );
      case 'random':
        return (
          <label className="section-hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" value={f.probability ?? 0} min={0} max={100} style={{ width: 70 }}
              onChange={(e) => updateFilter(b.id, { probability: Number(e.target.value) })} /> % chance / reply
          </label>
        );
      default:
        return null;
    }
  };

  return (
    <div className="event-triggers-section">
      {list.length === 0 && (
        <p className="section-hint">No event triggers. Add one to fire a Trigger Tree when a device toggles, a state crosses a threshold, the session goes idle, or at random each reply.</p>
      )}
      {list.map(b => (
        <div key={b.id} className="event-trigger-binding" style={{ border: '1px solid var(--border-color, #444)', borderRadius: 6, padding: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <select value={b.event} onChange={(e) => update(b.id, { event: e.target.value, filter: {} })} title="Event that fires this tree">
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {renderFilter(b)}
            {b.event !== 'random' && (
              <label className="section-hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Minimum messages between fires (0 = no cooldown)">
                cooldown
                <input type="number" value={b.filter?.cooldown ?? 0} min={0} style={{ width: 60 }}
                  onChange={(e) => updateFilter(b.id, { cooldown: Number(e.target.value) })} /> msgs
              </label>
            )}
            <button type="button" className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }} onClick={() => remove(b.id)} title="Delete this event trigger">🗑️</button>
          </div>
          <ScopeTreeSection label="" hint="" refValue={b.ref} onChange={(r) => update(b.id, { ref: r })}
            defaultName="Event Script" source={source} rowProps={rowProps} />
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-primary" onClick={add}>+ Add Event Trigger</button>
    </div>
  );
}

export default EventTriggersSection;
