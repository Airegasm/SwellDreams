import React from 'react';
import { EMOTIONS } from '../../constants/stateValues';

const DESIRE_OPTIONS = [
  { value: 'terrified', label: 'Terrified' },
  { value: 'reluctant', label: 'Reluctant' },
  { value: 'nervous', label: 'Nervous' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'curious', label: 'Curious' },
  { value: 'eager', label: 'Eager' },
  { value: 'obsessed', label: 'Obsessed' }
];

const POP_DESIRE_OPTIONS = [
  { value: 'terrified', label: 'Terrified' },
  { value: 'avoidant', label: 'Avoidant' },
  { value: 'nervous', label: 'Nervous' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'curious', label: 'Curious' },
  { value: 'willing', label: 'Willing' },
  { value: 'eager', label: 'Eager' }
];

const INFLATE_OTHERS_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'reluctant', label: 'Reluctant' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'curious', label: 'Curious' },
  { value: 'eager', label: 'Eager' },
  { value: 'obsessed', label: 'Obsessed' }
];

const POP_OTHERS_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'avoidant', label: 'Avoidant' },
  { value: 'careless', label: 'Careless' },
  { value: 'curious', label: 'Curious' },
  { value: 'willing', label: 'Willing' },
  { value: 'eager', label: 'Eager' },
  { value: 'sadistic', label: 'Sadistic' }
];

const ATTRIBUTE_KEYS = ['dominant', 'sadistic', 'psychopathic', 'sensual', 'sexual'];

const PUMP_MODES = [
  { value: 'on', label: 'ON' },
  { value: 'pulse', label: 'PULSE' },
  { value: 'cycle', label: 'CYCLE' },
  { value: 'timed', label: 'TIMED' }
];

// All available trigger types
function getTriggerTypes(isPumpable) {
  const types = [
    { value: 'impersonate', label: 'Trigger Player Impersonate' },
    { value: 'ai_message', label: 'Trigger AI Message' },
  ];

  if (isPumpable) {
    types.push({ value: 'char_inflate_start', label: 'AI Pump ON' });
    types.push({ value: 'char_inflate_stop', label: 'AI Pump OFF' });
  }

  types.push(
    { value: 'pump_on', label: 'Primary Pump ON' },
    { value: 'pump_off', label: 'Primary Pump OFF' },
    { value: 'toggle_pump_always', label: 'Toggle Send Pump Always' },
    { value: 'set_attribute', label: 'Change Character Attribute' },
    { value: 'set_player_capacity', label: 'Update Player Capacity' },
  );

  if (isPumpable) {
    types.push({ value: 'set_char_capacity', label: 'Update Char Capacity' });
  }

  types.push(
    { value: 'set_player_pain', label: 'Update Player Pain' },
    { value: 'set_emotion', label: 'Set Player Emotion' },
    { value: 'toggle_device_control', label: 'Toggle Chat Device Control' },
    { value: 'set_pump_mode', label: 'Modify Pump Mode/Timer' },
    { value: 'toggle_auto_reply', label: 'Toggle Char Auto-Response' },
  );

  if (isPumpable) {
    types.push({ value: 'toggle_pumpable', label: 'Toggle Char Pumpable Status' });
  }

  types.push({ value: 'set_player_burst', label: 'Modify Player Burst Limit' });

  if (isPumpable) {
    types.push({ value: 'set_char_burst', label: 'Modify Char Burst Limit' });
  }

  types.push(
    { value: 'set_char_inflate_desire', label: 'Set Char Inflate Desire' },
    { value: 'set_char_pop_desire', label: 'Set Char Pop Desire' },
    { value: 'set_char_desire_inflate_others', label: 'Set Char Desire to Inflate Others' },
    { value: 'set_char_desire_pop_others', label: 'Set Char Desire to Pop Others' },
    { value: 'toggle_reminder', label: 'Character Reminder State' },
    { value: 'equip_reminder', label: 'Equip/Unequip Reminder' },
  );

  return types;
}

/**
 * TriggerRow — reusable trigger item with type dropdown + dynamic inline params.
 *
 * Props:
 *   trigger: { type, id, ...params }
 *   onChange(updatedTrigger)
 *   onRemove()
 *   dragProps: { draggable, onDragStart, onDragOver, onDrop }
 *   isPumpable: boolean
 *   reminders: array — character reminders
 *   globalReminders: array — global reminders
 */
function TriggerRow({ trigger, onChange, onRemove, dragProps, isPumpable, reminders = [], globalReminders = [] }) {
  const update = (field, value) => onChange({ ...trigger, [field]: value });
  const triggerTypes = getTriggerTypes(isPumpable);

  const renderParams = () => {
    switch (trigger.type) {
      case 'impersonate':
      case 'ai_message':
        return (
          <input type="text" value={trigger.context || ''} onChange={(e) => update('context', e.target.value)}
            placeholder="Optional context..." style={{ flex: 1, minWidth: '80px' }} />
        );

      case 'toggle_pump_always':
        return (
          <>
            <select value={trigger.enabled ? 'on' : 'off'} onChange={(e) => update('enabled', e.target.value === 'on')} style={{ width: '60px' }}>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
            {trigger.enabled && (
              <input type="number" min={1} max={100} value={trigger.chance ?? 100} onChange={(e) => update('chance', parseInt(e.target.value) || 100)}
                style={{ width: '50px' }} title="% chance" />
            )}
          </>
        );

      case 'set_attribute':
        return (
          <>
            <select value={trigger.trait || 'dominant'} onChange={(e) => update('trait', e.target.value)} style={{ width: '100px' }}>
              {ATTRIBUTE_KEYS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <input type="number" min={0} max={100} value={trigger.value ?? 50} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
              style={{ width: '50px' }} title="% chance" />
          </>
        );

      case 'set_player_capacity':
      case 'set_char_capacity':
      case 'set_player_burst':
      case 'set_char_burst':
        return (
          <input type="number" min={0} max={200} value={trigger.value ?? 0} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
            style={{ width: '55px' }} title="%" />
        );

      case 'set_player_pain':
        return (
          <input type="number" min={0} max={10} value={trigger.value ?? 0} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
            style={{ width: '50px' }} title="0-10" />
        );

      case 'set_emotion':
        return (
          <select value={trigger.value || 'neutral'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {EMOTIONS.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        );

      case 'toggle_device_control':
      case 'toggle_auto_reply':
        return (
          <select value={trigger.enabled ? 'on' : 'off'} onChange={(e) => update('enabled', e.target.value === 'on')} style={{ width: '60px' }}>
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        );

      case 'set_pump_mode':
        return (
          <>
            <select value={trigger.mode || 'on'} onChange={(e) => update('mode', e.target.value)} style={{ width: '75px' }}>
              {PUMP_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {trigger.mode !== 'on' && (
              <input type="number" min={1} max={300} value={trigger.duration ?? 5} onChange={(e) => update('duration', parseInt(e.target.value) || 5)}
                style={{ width: '50px' }} title="Duration/count" />
            )}
          </>
        );

      case 'toggle_pumpable':
        return (
          <>
            <select value={trigger.enabled ? 'on' : 'off'} onChange={(e) => update('enabled', e.target.value === 'on')} style={{ width: '60px' }}>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
            {trigger.enabled && (
              <>
                <input type="number" min={10} max={3600} value={trigger.calTime ?? 60} onChange={(e) => update('calTime', parseInt(e.target.value) || 60)}
                  style={{ width: '55px', opacity: trigger.sync ? 0.4 : 1 }} title="Cal time (s)" disabled={trigger.sync} />
                <label style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <input type="checkbox" checked={trigger.sync || false} onChange={(e) => update('sync', e.target.checked)} />
                  Sync
                </label>
              </>
            )}
          </>
        );

      case 'set_char_inflate_desire':
        return (
          <select value={trigger.value || 'neutral'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {DESIRE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'set_char_pop_desire':
        return (
          <select value={trigger.value || 'terrified'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {POP_DESIRE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'set_char_desire_inflate_others':
        return (
          <select value={trigger.value || 'none'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {INFLATE_OTHERS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'set_char_desire_pop_others':
        return (
          <select value={trigger.value || 'none'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {POP_OTHERS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'toggle_reminder': {
        const allReminders = [...reminders, ...globalReminders.map(r => ({ ...r, _isGlobal: true }))];
        return (
          <>
            <select value={trigger.reminderId || ''} onChange={(e) => update('reminderId', e.target.value)} style={{ flex: 1, minWidth: '80px' }}>
              <option value="">-- Select --</option>
              {allReminders.map((r, i) => <option key={r.id || i} value={r.id || i}>{r.name || r.text?.substring(0, 30) || `Reminder ${i + 1}`}</option>)}
            </select>
            <select value={trigger.enabled ? 'on' : 'off'} onChange={(e) => update('enabled', e.target.value === 'on')} style={{ width: '55px' }}>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </>
        );
      }

      case 'equip_reminder': {
        const isCustom = trigger.source !== 'global';
        const sourceReminders = isCustom ? reminders : globalReminders;
        return (
          <>
            <select value={trigger.action || 'equip'} onChange={(e) => update('action', e.target.value)} style={{ width: '70px' }}>
              <option value="equip">Equip</option>
              <option value="unequip">Unequip</option>
            </select>
            <select value={trigger.source || 'custom'} onChange={(e) => update('source', e.target.value)} style={{ width: '65px' }}>
              <option value="custom">Custom</option>
              <option value="global">Global</option>
            </select>
            <select value={trigger.reminderId || ''} onChange={(e) => update('reminderId', e.target.value)} style={{ flex: 1, minWidth: '60px' }}>
              <option value="">-- Select --</option>
              {sourceReminders.map((r, i) => <option key={r.id || i} value={r.id || i}>{r.name || r.text?.substring(0, 30) || `Reminder ${i + 1}`}</option>)}
            </select>
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="post-welcome-trigger-row" {...dragProps}>
      <span className="drag-handle">☰</span>
      <select value={trigger.type} onChange={(e) => onChange({ ...trigger, type: e.target.value })} style={{ minWidth: '140px' }}>
        {triggerTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {renderParams()}
      <button type="button" className="btn-remove" onClick={onRemove}>−</button>
    </div>
  );
}

export default TriggerRow;
