import React from 'react';
import { API_BASE } from '../../config';
import MemberTargetPicker from './MemberTargetPicker';
import './TriggerRow.css';

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

const ATTRIBUTE_KEYS = ['dominant', 'submissive', 'sadistic', 'psychopathic', 'sensual', 'sexual'];
const PERSONA_ATTRIBUTE_KEYS = ['dominant', 'submissive', 'sadistic', 'masochistic', 'sensual', 'sexual'];

const PUMP_MODES = [
  { value: 'on', label: 'ON' },
  { value: 'pulse', label: 'PULSE' },
  { value: 'cycle', label: 'CYCLE' },
  { value: 'timed', label: 'TIMED' }
];

// All available trigger types
function getTriggerTypes(isPumpable, isManualPump) {
  const types = [
    { value: 'impersonate', label: 'Player Message' },
    { value: 'ai_message', label: 'Char AI Message' },
    { value: 'ai_message_member', label: 'Group Member Message' },
    { value: 'system_message', label: 'System Message' },
    { value: 'flow_var', label: 'Set CharVar (variable)' },
  ];

  if (isPumpable) {
    types.push({ value: 'char_inflate_start', label: 'Char Pump ON' });
    types.push({ value: 'char_inflate_stop', label: 'Char Pump OFF' });
  }

  types.push(
    { value: 'pump_on', label: 'Primary Pump ON' },
    { value: 'pump_off', label: 'Primary Pump OFF' },
    { value: 'set_attribute', label: 'Set Char Attribute' },
    { value: 'set_persona_attribute', label: 'Set Player Attribute' },
    { value: 'set_player_capacity', label: 'Set Player Capacity' },
    { value: 'set_pre_req', label: 'Inflation Pre-Req (Met/Unmet)' },
  );

  if (isPumpable) {
    // Supersedes 'set_char_capacity' (kept rendering/executing for saved cards): adds member
    // targeting + set/inc/dec. Base char by default; pumpable group members selectable.
    types.push({ value: 'char_capacity', label: 'Char Capacity' });
  }

  types.push(
    { value: 'toggle_device_control', label: 'Toggle Char Device Control' },
    { value: 'set_pump_mode', label: 'Modify Pump Mode/Timer' },
    { value: 'toggle_auto_reply', label: 'Toggle Char Auto-Response' },
    { value: 'player_pump_ready', label: 'Player PumpReady' },
    { value: 'char_pump_ready', label: 'Char PumpReady' },
    { value: 'groupmem_pump_ready', label: 'GroupMem PumpReady' },
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
    { value: 'set_persona_inflate_desire', label: 'Set Player Inflate Desire' },
    { value: 'set_persona_pop_desire', label: 'Set Player Pop Desire' },
    { value: 'set_persona_inflate_others', label: 'Set Player Desire to Inflate Others' },
    { value: 'set_persona_pop_others', label: 'Set Player Desire to Pop Others' },
    { value: 'nudge_attribute', label: 'Nudge Char Attribute (+/-)' },
    { value: 'nudge_persona_attribute', label: 'Nudge Player Attribute (+/-)' },
    { value: 'set_skin', label: 'Set Display Skin' },
    { value: 'set_instructor_profile', label: 'Set Instructor Profile' },
    { value: 'set_range_set', label: 'Set Range Set' },
    { value: 'toggle_library_entry', label: 'Toggle Char Library Entry' },
    // Await gates — pause the sequence here; the triggers AFTER this one wait until satisfied.
    { value: 'await_input', label: '⏸ Await Input (wait for keyword)' },
    // Branch gate — runs the block after it (until the next Capacity In-Range gate) only if capacity is in range.
    { value: 'capacity_inrange', label: '◧ Capacity In-Range (branch by %)' },
  );
  if (isManualPump) {
    types.push({ value: 'await_pump', label: '⏸ Await Pump Amount (wait for N pumps)' });
  }

  // Flow-parity media + misc actions
  types.push(
    { value: 'send_player_message', label: 'Player Message', hidden: true }, // reached via the Player Message mode picker (Verbatim)
    { value: 'show_image', label: 'Show Image' },
    { value: 'play_video', label: 'Play Video' },
    { value: 'play_audio', label: 'Play Audio' },
    { value: 'random_number', label: 'Random Number → Variable' },
    { value: 'device_on', label: 'Turn Device On' },
    { value: 'device_off', label: 'Turn Device Off' },
    { value: 'start_cycle', label: 'Start Device Cycle' },
    { value: 'stop_cycle', label: 'Stop Device Cycle' },
    { value: 'pulse_pump', label: 'Pulse Pump' },
    { value: 'toggle_button', label: 'Toggle Button (enable/disable)' },
    { value: 'delay', label: 'Delay (seconds)' },
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
function TriggerRow({ trigger, onChange, onRemove, hideRemove, dragProps, isPumpable, isManualPump, reminders = [], globalReminders = [], members = [], profiles = [], showFirePercent = false, firePercentMax = 100, onMoveUp, onMoveDown, onDuplicate }) {
  // Reusable "target character" picker for multichar attribute triggers
  const renderMemberTarget = (update) => members.length > 0 ? (
    <MemberTargetPicker members={members} value={trigger.targetMember || ''} onChange={(v) => update('targetMember', v)} />
  ) : null;

  // Prepend/Append Verbatim (all message actions): literal author text placed in the SAME chat
  // bubble before/after whatever the action generates (or posts verbatim). Variables resolve at
  // fire time, and the combined text is stored in chat history — so it's in context, not
  // display-only. Textareas wrap to their own full-width line (the row is flex-wrap).
  const renderVerbatimWraps = () => (
    <>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', whiteSpace: 'nowrap' }}
        title="Prepend Verbatim — literal text at the START of the same bubble (variables resolve; goes in context)">
        <input type="checkbox" checked={!!trigger.prependVerbatim} onChange={(e) => update('prependVerbatim', e.target.checked)} />
        Prepend
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', whiteSpace: 'nowrap' }}
        title="Append Verbatim — literal text at the END of the same bubble (variables resolve; goes in context)">
        <input type="checkbox" checked={!!trigger.appendVerbatim} onChange={(e) => update('appendVerbatim', e.target.checked)} />
        Append
      </label>
      {trigger.prependVerbatim && (
        <textarea value={trigger.prependText || ''} onChange={(e) => update('prependText', e.target.value)} rows={2}
          placeholder="Prepended verbatim text — appears BEFORE the message in the same bubble ([CharVar:x] etc. resolve)…"
          style={{ flexBasis: '100%', resize: 'vertical' }} />
      )}
      {trigger.appendVerbatim && (
        <textarea value={trigger.appendText || ''} onChange={(e) => update('appendText', e.target.value)} rows={2}
          placeholder="Appended verbatim text — appears AFTER the message in the same bubble ([CharVar:x] etc. resolve)…"
          style={{ flexBasis: '100%', resize: 'vertical' }} />
      )}
    </>
  );

  // Shared member-ref dropdown (Group Member Message / Char Capacity / Char Pump ON-OFF):
  // base char + (optionally pumpable-only) members when the card context provides them, plus the
  // dynamic refs — [SelectedChar] and a CharVar holding a member name — which work everywhere
  // (trees, blocks, character-agnostic Trigger Sets). Backend resolves all forms uniformly.
  const renderMemberRefPicker = ({ baseLabel, pumpableOnly = false, title }) => {
    const tm = trigger.targetMember || '';
    const isCV = /^\[CharVar:/i.test(tm);
    const known = tm === '' || tm === '[SelectedChar]' || members.some(m => m.id === tm);
    const list = pumpableOnly ? members.filter((m, i) => i === 0 || m?.isPumpable) : members;
    return (
      <>
        <select value={isCV ? '__charvar__' : tm}
          onChange={(e) => update('targetMember', e.target.value === '__charvar__' ? '[CharVar:]' : e.target.value)}
          style={{ maxWidth: '150px', flexShrink: 0 }} title={title}>
          <option value="">{baseLabel}</option>
          {members.length > 1 && list.map((m, mi) => {
            if (members.indexOf(m) === 0) return null; // base is the '' option above
            return <option key={m.id || mi} value={m.id}>{m.name || `Character ${mi + 1}`}</option>;
          })}
          <option value="[SelectedChar]">Selected member ([SelectedChar])</option>
          <option value="__charvar__">CharVar…</option>
          {!isCV && !known && <option value={tm}>(missing member: {tm})</option>}
        </select>
        {isCV && (
          <input type="text" value={tm.replace(/^\[CharVar:/i, '').replace(/\]$/, '')}
            onChange={(e) => update('targetMember', `[CharVar:${e.target.value.trim()}]`)}
            placeholder="variable name" style={{ width: '100px', flexShrink: 0 }}
            title="The member is resolved at fire time from this CharVar's value (a member name or id)" />
        )}
      </>
    );
  };
  const [typeSearch, setTypeSearch] = React.useState('');
  const [typeOpen, setTypeOpen] = React.useState(false);
  const typeRef = React.useRef(null);
  const [skinsList, setSkinsList] = React.useState(null);
  const update = (field, value) => onChange({ ...trigger, [field]: value });

  // Nested actions for the Capacity In-Range block (trigger.triggers). Child rows reuse this same
  // component so they get the full action palette; rowProps are forwarded so pickers keep working.
  const kids = Array.isArray(trigger.triggers) ? trigger.triggers : [];
  const newKidId = () => `trg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const setKids = (arr) => onChange({ ...trigger, triggers: arr });
  const addKid = () => setKids([...kids, { id: newKidId(), type: '', value: '' }]);
  const updKid = (i, u) => setKids(kids.map((k, idx) => (idx === i ? u : k)));
  const rmKid = (i) => setKids(kids.filter((_, idx) => idx !== i));
  const childProps = { isPumpable, isManualPump, reminders, globalReminders, members, profiles };

  // Lazy-load skins when set_skin trigger is selected
  React.useEffect(() => {
    if (trigger.type === 'set_skin' && !skinsList) {
      fetch(`${API_BASE}/api/display-settings`).then(r => r.json()).then(data => {
        setSkinsList(data?.skins || []);
      }).catch(() => setSkinsList([]));
    }
  }, [trigger.type, skinsList]);
  const triggerTypes = getTriggerTypes(isPumpable, isManualPump);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!typeOpen) return;
    const handler = (e) => { if (typeRef.current && !typeRef.current.contains(e.target)) setTypeOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [typeOpen]);

  const renderParams = () => {
    // Player Message mode picker — one menu entry, two behaviours. Flips the underlying trigger type:
    // 'impersonate' (AI writes a line in the player's voice) vs 'send_player_message' (post your exact
    // text as the player, no generation). Shown in both cases so switching is in-row.
    const playerMsgMode = (
      <select value={trigger.type} onChange={(e) => update('type', e.target.value)} style={{ width: '170px', flexShrink: 0 }}
        title="Impersonate = the AI writes the player's line. Verbatim = post your exact text as the player (suppresses AI generation).">
        <option value="impersonate">Impersonate</option>
        <option value="send_player_message">Verbatim (Suppress LLM)</option>
      </select>
    );
    switch (trigger.type) {
      case 'pump_on':
        // Optional timer: blank = latch on (until a Pump OFF); a number = run that many seconds then
        // auto-off (capped by the pump/global/range limits). Lets game outcomes fire varied intervals.
        return (
          <input type="text" value={trigger.duration ?? ''} onChange={(e) => update('duration', e.target.value)}
            placeholder="secs (blank = latch on)" style={{ width: '170px' }} title="Seconds to run the primary pump, then auto-off. Blank = stay on until a Pump OFF. Accepts a variable like [CharVar:GameResult] (e.g. a dice total). Capped only by the 30-minute hard safety limit." />
        );
      case 'await_pump':
        return (
          <input type="number" min={1} value={trigger.count ?? 3} onChange={(e) => update('count', e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="pumps" style={{ width: '90px' }} title="Wait until the player presses PUMP this many times, then fire the triggers below this one" />
        );
      case 'await_input':
        return (
          <>
            <input type="text" value={trigger.words || ''} onChange={(e) => update('words', e.target.value)}
              placeholder="keyword1, keyword2, …" style={{ flex: 1, minWidth: '120px' }} title="Comma-separated words. Shown as clickable options on AI messages; saying/clicking one fires the triggers below this one." />
            <select value={trigger.speaker || 'player'} onChange={(e) => update('speaker', e.target.value)} style={{ width: '110px' }}
              title="Who may satisfy this keyword gate.">
              <option value="player">Player Only</option>
              <option value="char">Char Only</option>
              <option value="either">Either</option>
            </select>
          </>
        );
      case 'capacity_inrange':
        return (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}
            title="Runs the triggers after this one (up to the next Capacity In-Range gate) only when capacity is within this % range. Stack several with non-overlapping ranges to branch by capacity — exactly one block runs.">
            capacity
            <input type="number" min="0" max="200" value={trigger.min ?? ''} onChange={(e) => update('min', e.target.value === '' ? '' : Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0)))} placeholder="min" style={{ width: '56px' }} />
            –
            <input type="number" min="0" max="200" value={trigger.max ?? ''} onChange={(e) => update('max', e.target.value === '' ? '' : Math.max(0, Math.min(200, parseInt(e.target.value, 10) || 0)))} placeholder="max" style={{ width: '56px' }} />
            %
          </label>
        );
      case 'set_range_set':
        return (
          <input type="text" value={trigger.value || ''} onChange={(e) => update('value', e.target.value)}
            placeholder="range set name (or id)" style={{ flex: 1, minWidth: '120px' }} title="Switch the active Range Set in the current profile to the one with this name" />
        );
      case 'impersonate':
        return (
          <>
            {playerMsgMode}
            <input type="text" value={trigger.context || ''} onChange={(e) => update('context', e.target.value)}
              placeholder="Guidance for the impersonated line…" style={{ flex: 1, minWidth: '80px' }} />
            <input type="number" min="1" value={trigger.maxTokens ?? ''}
              onChange={(e) => update('maxTokens', e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 0))}
              placeholder="Max tok" style={{ width: '70px' }}
              title="Max Response Tokens — caps this generation's length. Blank = use the character/global limit." />
          {renderVerbatimWraps()}
            </>
        );

      case 'ai_message':
        return (
          <>
            {/* Verbatim (LLM unchecked) posts the text as-is → multi-line editor; enhanced mode is
                one-line guidance for the generation. */}
            {trigger.llmEnhance === false ? (
              <textarea value={trigger.context || ''} onChange={(e) => update('context', e.target.value)}
                placeholder="Message (verbatim, Enter = new line)..." rows={2}
                style={{ flex: 1, minWidth: '80px', resize: 'vertical' }} />
            ) : (
              <input type="text" value={trigger.context || ''} onChange={(e) => update('context', e.target.value)}
                placeholder="Message / context..." style={{ flex: 1, minWidth: '80px' }} />
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', whiteSpace: 'nowrap' }}
              title="LLM Enhance — generate from this. Uncheck to post the text verbatim.">
              <input type="checkbox" checked={trigger.llmEnhance !== false} onChange={(e) => update('llmEnhance', e.target.checked)} />
              LLM
            </label>
            <input type="number" min="1" value={trigger.maxTokens ?? ''}
              onChange={(e) => update('maxTokens', e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 0))}
              placeholder="Max tok" style={{ width: '70px' }}
              title="Max Response Tokens — caps this generation's length. Blank = use the character/global limit." />
          {renderVerbatimWraps()}
            </>
        );

      case 'ai_message_member': {
        return (
          <>
            {renderMemberRefPicker({ baseLabel: members.length > 1 ? 'Whole group' : 'Base character', title: 'Which member speaks this message' })}
            {trigger.llmEnhance === false ? (
              <textarea value={trigger.context || ''} onChange={(e) => update('context', e.target.value)}
                placeholder="Message (verbatim, Enter = new line)..." rows={2}
                style={{ flex: 1, minWidth: '80px', resize: 'vertical' }} />
            ) : (
              <input type="text" value={trigger.context || ''} onChange={(e) => update('context', e.target.value)}
                placeholder="Message / context..." style={{ flex: 1, minWidth: '80px' }} />
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', whiteSpace: 'nowrap' }}
              title="LLM Enhance — generate from this. Uncheck to post the text verbatim.">
              <input type="checkbox" checked={trigger.llmEnhance !== false} onChange={(e) => update('llmEnhance', e.target.checked)} />
              LLM
            </label>
            <input type="number" min="1" value={trigger.maxTokens ?? ''}
              onChange={(e) => update('maxTokens', e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 0))}
              placeholder="Max tok" style={{ width: '70px' }}
              title="Max Response Tokens — blank uses this member's Response Tokens, then the global limit." />
          {renderVerbatimWraps()}
            </>
        );
      }

      case 'char_inflate_start':
      case 'char_inflate_stop':
        // Mock auto-pump per body: base char rides the classic engine; each member gets an
        // independent capacity ticker. Same target refs as the Group Member Message dropdown.
        return renderMemberRefPicker({
          baseLabel: members[0]?.name || 'Base character',
          pumpableOnly: true,
          title: trigger.type === 'char_inflate_start'
            ? 'Whose mock auto-pump turns ON (their capacity ticks independently)'
            : 'Whose mock auto-pump turns OFF'
        });

      case 'groupmem_pump_ready':
        return (
          <>
            {renderMemberTarget(update)}
            <select value={trigger.enabled ? 'on' : 'off'} onChange={(e) => update('enabled', e.target.value === 'on')} style={{ width: '60px' }}>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </>
        );

      case 'send_player_message':
        return (
          <>
            {playerMsgMode}
            {/* No LLM tickbox here — the Impersonate/Verbatim mode dropdown IS the choice; this
                variant is always verbatim (posted exactly as typed, no generation). */}
            <textarea value={trigger.message || ''} onChange={(e) => update('message', e.target.value)}
              placeholder="Exact player message (verbatim, Enter = new line)…" rows={2}
              style={{ flex: 1, minWidth: '80px', resize: 'vertical' }} />
          {renderVerbatimWraps()}
            </>
        );

      case 'show_image':
      case 'play_video':
      case 'play_audio':
        return (
          <>
            <input type="text" value={trigger.tag || ''} onChange={(e) => update('tag', e.target.value)}
              placeholder="media tag" style={{ flex: 1, minWidth: '90px' }} />
            {trigger.type === 'play_video' && (
              <>
                <label style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><input type="checkbox" checked={!!trigger.loop} onChange={(e) => update('loop', e.target.checked)} /> loop</label>
                <label style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><input type="checkbox" checked={!!trigger.blocking} onChange={(e) => update('blocking', e.target.checked)} /> block</label>
              </>
            )}
            {trigger.type === 'play_audio' && (
              <label style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><input type="checkbox" checked={!!trigger.noBubble} onChange={(e) => update('noBubble', e.target.checked)} /> no bubble</label>
            )}
          </>
        );

      case 'random_number':
        return (
          <>
            <input type="text" value={trigger.variable || ''} onChange={(e) => update('variable', e.target.value)} placeholder="Variable" style={{ width: '100px' }} />
            <input type="number" value={trigger.min ?? 1} onChange={(e) => update('min', e.target.value)} placeholder="min" style={{ width: '64px' }} />
            <input type="number" value={trigger.max ?? 100} onChange={(e) => update('max', e.target.value)} placeholder="max" style={{ width: '64px' }} />
          </>
        );

      case 'device_on':
      case 'device_off':
      case 'stop_cycle':
      case 'pulse_pump':
        return (
          <>
            <input type="text" value={trigger.device || ''} onChange={(e) => update('device', e.target.value)} placeholder="device ip / id" style={{ flex: 1, minWidth: '90px' }} />
            {trigger.type === 'pulse_pump' && <input type="number" value={trigger.pulses ?? 3} onChange={(e) => update('pulses', e.target.value)} placeholder="pulses" style={{ width: '64px' }} title="pulse count" />}
          </>
        );

      case 'start_cycle':
        return (
          <>
            <input type="text" value={trigger.device || ''} onChange={(e) => update('device', e.target.value)} placeholder="device ip / id" style={{ flex: 1, minWidth: '80px' }} />
            <input type="number" value={trigger.duration ?? 5} onChange={(e) => update('duration', e.target.value)} placeholder="on" style={{ width: '52px' }} title="ON seconds" />
            <input type="number" value={trigger.interval ?? 10} onChange={(e) => update('interval', e.target.value)} placeholder="off" style={{ width: '52px' }} title="OFF seconds" />
            <input type="number" value={trigger.cycles ?? 0} onChange={(e) => update('cycles', e.target.value)} placeholder="×" style={{ width: '52px' }} title="cycles (0 = forever)" />
          </>
        );

      case 'toggle_button':
        return (
          <>
            <input type="text" value={trigger.buttonId || ''} onChange={(e) => update('buttonId', e.target.value)} placeholder="button #" style={{ width: '80px' }} />
            <select value={trigger.action || 'enable'} onChange={(e) => update('action', e.target.value)} style={{ width: '90px' }}>
              <option value="enable">Enable</option>
              <option value="disable">Disable</option>
            </select>
          </>
        );

      case 'delay':
        return (
          <input type="number" value={trigger.duration ?? 3} onChange={(e) => update('duration', e.target.value)} placeholder="seconds" style={{ width: '80px' }} title="max 120s" />
        );

      case 'set_instructor_profile':
        return (
          <select value={trigger.value || ''} onChange={(e) => update('value', e.target.value)} style={{ flex: 1, minWidth: '120px' }}>
            <option value="">Select profile…</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        );

      case 'system_message':
        return (
          <textarea value={trigger.content || ''} onChange={(e) => update('content', e.target.value)}
            placeholder="System message text... (Enter = new line)" rows={2}
            style={{ flex: 1, minWidth: '120px', resize: 'vertical' }} />
        );

      case 'flow_var':
        return (
          <>
            <input type="text" value={trigger.variable || ''} onChange={(e) => update('variable', e.target.value)}
              placeholder="Variable" style={{ width: '100px' }}
              title="Target variable name (may itself use [CharVar:x] / [Choice] / [SelectedChar])" />
            {/* Left operand: This Var (classic X = X op value) or another CharVar (X = Y op value)
                — set a var from math between two OTHER vars in one action. */}
            <select value={trigger.sourceVar != null ? '__charvar__' : ''}
              onChange={(e) => update('sourceVar', e.target.value === '__charvar__' ? '' : null)}
              style={{ width: '90px' }}
              title="Left operand of the math: This Var = the target's current value; CharVar = another variable's value">
              <option value="">This Var</option>
              <option value="__charvar__">CharVar…</option>
            </select>
            {trigger.sourceVar != null && (
              <input type="text" value={trigger.sourceVar || ''} onChange={(e) => update('sourceVar', e.target.value)}
                placeholder="source var" style={{ width: '90px' }}
                title="The variable whose value is the left operand (Set = copies it; Inc/Dec/Mult/Div = source op value)" />
            )}
            <select value={trigger.operation || 'set'} onChange={(e) => update('operation', e.target.value)} style={{ width: '95px' }}>
              <option value="set">Set =</option>
              <option value="inc">Inc +=</option>
              <option value="dec">Dec −=</option>
              <option value="mult">Mult ×=</option>
              <option value="div">Div ÷=</option>
            </select>
            <input type="text" value={trigger.value ?? ''} onChange={(e) => update('value', e.target.value)}
              placeholder="Value / expression…" style={{ flex: 1, minWidth: '110px' }}
              title="Accepts variables and math: [CharVar:x], [System:Name], [Capacity], [CharCapacity:Member], [SelectedChar], nested combos — e.g. ([CharCapacity:[SelectedChar]] + 10) * 2" />
          </>
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
            {renderMemberTarget(update)}
            <select value={trigger.trait || 'dominant'} onChange={(e) => update('trait', e.target.value)} style={{ width: '100px' }}>
              {ATTRIBUTE_KEYS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <input type="number" min={0} max={100} value={trigger.value ?? 50} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
              style={{ width: '50px' }} title="% chance" />
          </>
        );

      case 'set_persona_attribute':
        return (
          <>
            <select value={trigger.trait || 'dominant'} onChange={(e) => update('trait', e.target.value)} style={{ width: '100px' }}>
              {PERSONA_ATTRIBUTE_KEYS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <input type="number" min={0} max={100} value={trigger.value ?? 50} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
              style={{ width: '50px' }} title="% chance" />
          </>
        );

      case 'nudge_attribute':
        return (
          <>
            {renderMemberTarget(update)}
            <select value={trigger.trait || 'dominant'} onChange={(e) => update('trait', e.target.value)} style={{ width: '100px' }}>
              {ATTRIBUTE_KEYS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <input type="number" min={-100} max={100} value={trigger.value ?? 10} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
              style={{ width: '60px' }} title="+/- amount" />
          </>
        );

      case 'nudge_persona_attribute':
        return (
          <>
            <select value={trigger.trait || 'dominant'} onChange={(e) => update('trait', e.target.value)} style={{ width: '100px' }}>
              {PERSONA_ATTRIBUTE_KEYS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <input type="number" min={-100} max={100} value={trigger.value ?? 10} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
              style={{ width: '60px' }} title="+/- amount" />
          </>
        );

      case 'set_skin':
        return (
          <select value={trigger.skinId || 'swelldreams-default'} onChange={(e) => update('skinId', e.target.value)} style={{ minWidth: '140px' }}>
            {(skinsList || []).map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.builtIn ? ' (Default)' : ''}</option>
            ))}
            {!skinsList && <option value={trigger.skinId || 'swelldreams-default'}>Loading...</option>}
          </select>
        );

      case 'char_capacity': {
        return (
          <>
            {renderMemberRefPicker({ baseLabel: members[0]?.name || 'Base character', pumpableOnly: true, title: 'Whose capacity changes' })}
            <select value={trigger.operation || 'set'} onChange={(e) => update('operation', e.target.value)} style={{ width: '65px' }}
              title="Set = to this value; Inc/Dec = by this value">
              <option value="set">Set</option>
              <option value="inc">Inc</option>
              <option value="dec">Dec</option>
            </select>
            <input type="number" min={1} max={100} value={trigger.value ?? ''}
              onChange={(e) => update('value', e.target.value === '' ? '' : Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 0)))}
              placeholder="%" style={{ width: '60px' }} title="Amount (1-100%)" />
          </>
        );
      }

      case 'set_player_capacity':
      case 'set_char_capacity':
      case 'set_player_burst':
      case 'set_char_burst':
        return (
          <input type="number" min={0} max={200} value={trigger.value ?? 0} onChange={(e) => update('value', parseInt(e.target.value) || 0)}
            style={{ width: '55px' }} title="%" />
        );

      case 'set_pre_req':
        return (
          <select value={trigger.value || 'met'} onChange={(e) => update('value', e.target.value)} style={{ width: '90px' }} title="Pre-inflation gate status">
            <option value="met">Met</option>
            <option value="unmet">Unmet</option>
          </select>
        );

      case 'player_pump_ready':
      case 'char_pump_ready':
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
      case 'set_persona_inflate_desire':
        return (
          <select value={trigger.value || 'neutral'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {DESIRE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'set_char_pop_desire':
      case 'set_persona_pop_desire':
        return (
          <select value={trigger.value || 'terrified'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {POP_DESIRE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'set_char_desire_inflate_others':
      case 'set_persona_inflate_others':
        return (
          <select value={trigger.value || 'none'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {INFLATE_OTHERS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'set_char_desire_pop_others':
      case 'set_persona_pop_others':
        return (
          <select value={trigger.value || 'none'} onChange={(e) => update('value', e.target.value)} style={{ width: '100px' }}>
            {POP_OTHERS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );

      case 'toggle_library_entry': {
        return (
          <>
            <select value={trigger.reminderId || ''} onChange={(e) => update('reminderId', e.target.value)} style={{ flex: 1, minWidth: '80px' }}>
              <option value="">-- Select Library Entry --</option>
              {reminders.map((r, i) => <option key={r.id || i} value={r.id || i}>{r.name || r.text?.substring(0, 30) || `Entry ${i + 1}`}</option>)}
            </select>
            <select value={trigger.enabled ? 'on' : 'off'} onChange={(e) => update('enabled', e.target.value === 'on')} style={{ width: '55px' }}>
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </>
        );
      }

      default:
        return null;
    }
  };

  const currentLabel = triggerTypes.find(t => t.value === trigger.type)?.label || trigger.type;
  // `hidden` types (e.g. send_player_message) resolve for display above but are kept OUT of the
  // add-dropdown — they're reached via an in-row mode picker instead of picked directly.
  const filteredTypes = (typeSearch
    ? triggerTypes.filter(t => t.label.toLowerCase().includes(typeSearch.toLowerCase()))
    : triggerTypes).filter(t => !t.hidden);

  return (
    <>
    <div className="post-welcome-trigger-row" {...dragProps}>
      <span className="drag-handle">☰</span>
      <div className="trigger-type-picker" ref={typeRef}>
        <button
          type="button"
          className="trigger-type-btn"
          onClick={() => { setTypeOpen(!typeOpen); setTypeSearch(''); }}
        >
          {currentLabel}
        </button>
        {typeOpen && (
          <div className="trigger-type-dropdown">
            <input
              type="text"
              className="trigger-type-search"
              value={typeSearch}
              onChange={(e) => setTypeSearch(e.target.value)}
              placeholder="Search..."
              autoFocus
            />
            <div className="trigger-type-list">
              {filteredTypes.map(t => (
                <div
                  key={t.value}
                  className={`trigger-type-option ${t.value === trigger.type ? 'selected' : ''}`}
                  onClick={() => { onChange({ ...trigger, type: t.value }); setTypeOpen(false); }}
                >
                  {t.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {renderParams()}
      {showFirePercent && trigger.type !== 'capacity_inrange' && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}
          title="Fire% — hold the sequence here until capacity reaches this exact % (inside the range), then fire and continue. Leave blank to fire in turn as soon as the sequence reaches this trigger.">
          <span style={{ opacity: 0.75, fontWeight: 600 }}>Fire @</span>
          <input type="number" min="0" max={firePercentMax} value={trigger.firePercent ?? ''}
            onChange={(e) => update('firePercent', e.target.value === '' ? '' : Math.max(0, Math.min(firePercentMax, parseInt(e.target.value, 10) || 0)))}
            placeholder="blank = in turn" style={{ width: '120px' }} />
          <span style={{ opacity: 0.75 }}>%</span>
        </label>
      )}
      {onDuplicate && <button type="button" className="btn-remove" onClick={onDuplicate} title="Duplicate this trigger">⧉</button>}
      {onMoveUp && <button type="button" className="btn-remove" onClick={onMoveUp} title="Move up">↑</button>}
      {onMoveDown && <button type="button" className="btn-remove" onClick={onMoveDown} title="Move down">↓</button>}
      {!hideRemove && <button type="button" className="btn-remove" onClick={onRemove}>−</button>}
    </div>
    {trigger.type === 'capacity_inrange' && (
      <div className="capacity-inrange-block" style={{ marginLeft: 28, borderLeft: '2px solid var(--border-color, #444)', paddingLeft: 10, marginTop: 2, marginBottom: 6 }}>
        {kids.length === 0 && <div className="section-hint" style={{ margin: '2px 0 6px' }}>Actions here run only when capacity is {trigger.min ?? 0}–{trigger.max ?? 200}%.</div>}
        {kids.map((k, i) => (
          <TriggerRow key={k.id || i} trigger={k} onChange={(u) => updKid(i, u)} onRemove={() => rmKid(i)}
            onMoveUp={i > 0 ? () => { const a = [...kids]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setKids(a); } : undefined}
            onMoveDown={i < kids.length - 1 ? () => { const a = [...kids]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setKids(a); } : undefined}
            onDuplicate={() => { const c = JSON.parse(JSON.stringify(k)); c.id = `trg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; setKids([...kids.slice(0, i + 1), c, ...kids.slice(i + 1)]); }}
            {...childProps} />
        ))}
        <button type="button" className="btn btn-sm btn-secondary" onClick={addKid}>+ Action (in {trigger.min ?? 0}–{trigger.max ?? 200}%)</button>
      </div>
    )}
    </>
  );
}

export default TriggerRow;
