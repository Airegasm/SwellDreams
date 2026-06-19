import React from 'react';
import './CheckpointInjections.css';

const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Normalize a message slot to { text, llmEnhance }. Legacy plain strings -> enhanced.
const normMsg = (m, legacy) => (m && typeof m === 'object')
  ? { text: m.text || '', llmEnhance: m.llmEnhance !== false }
  : { text: (legacy || ''), llmEnhance: true };

// A text field with an "LLM" (enhance) checkbox. Unchecked = verbatim (no LLM rewrite).
function MsgField({ label, value, onChange, placeholder }) {
  const v = value || { text: '', llmEnhance: true };
  return (
    <div className="ci-msg-field">
      <span className="ci-msg-label">{label}</span>
      <input
        type="text"
        className="ci-msg-text"
        value={v.text || ''}
        onChange={(e) => onChange({ ...v, text: e.target.value })}
        placeholder={placeholder}
      />
      <label className="ci-inline-check" title="LLM Enhance — let the AI rewrite/weave this. Uncheck to use it verbatim.">
        <input type="checkbox" checked={v.llmEnhance !== false} onChange={(e) => onChange({ ...v, llmEnhance: e.target.checked })} />
        LLM
      </label>
    </div>
  );
}

// Pump action fields (mode + duration + cycles). action = { type:'pump', mode, duration, cycles }
function PumpFields({ action, onChange }) {
  const a = action || { type: 'pump', mode: 'timed', duration: 5, cycles: 3 };
  const set = (patch) => onChange({ ...a, type: 'pump', ...patch });
  return (
    <div className="ci-pump-fields">
      <select value={a.mode || 'timed'} onChange={(e) => set({ mode: e.target.value })}>
        <option value="timed">Timed</option>
        <option value="cycle">Cycle</option>
      </select>
      <label>Dur</label>
      <input type="number" min={1} value={a.duration ?? 5} onChange={(e) => set({ duration: parseInt(e.target.value) || 1 })} style={{ width: 56 }} />
      <span>s</span>
      {a.mode === 'cycle' && (
        <>
          <label>×</label>
          <input type="number" min={1} value={a.cycles ?? 3} onChange={(e) => set({ cycles: parseInt(e.target.value) || 1 })} style={{ width: 48 }} />
        </>
      )}
    </div>
  );
}

// Set-variable action fields. action = { type:'set_variable', varType, variable, operation, value }
function VarFields({ action, onChange }) {
  const a = action || { type: 'set_variable', varType: 'custom', variable: '', operation: 'set', value: '' };
  const set = (patch) => onChange({ ...a, type: 'set_variable', ...patch });
  return (
    <div className="ci-var-fields">
      <select value={a.varType || 'custom'} onChange={(e) => set({ varType: e.target.value })} title="Variable type">
        <option value="custom">Flow</option>
        <option value="system">System</option>
      </select>
      <input type="text" value={a.variable || ''} onChange={(e) => set({ variable: e.target.value })} placeholder="variable" className="ci-var-name" />
      <select value={a.operation || 'set'} onChange={(e) => set({ operation: e.target.value })} title="Operation">
        <option value="set">=</option>
        <option value="inc">+=</option>
        <option value="dec">−=</option>
        <option value="mult">×=</option>
        <option value="div">÷=</option>
      </select>
      <input type="text" value={a.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="value" className="ci-var-value" />
    </div>
  );
}

// Player-choice action editor: up to 4 choices, each with label + optional pump/var + Message + Response.
function ChoiceEditor({ action, onChange }) {
  const choices = (action?.choices || []);
  const setChoices = (c) => onChange({ type: 'player_choice', choices: c });
  const add = () => { if (choices.length < 4) setChoices([...choices, { id: newId('cc'), label: '', action: null, setVar: null, message: { text: '', llmEnhance: true }, response: { text: '', llmEnhance: true } }]); };
  const upd = (i, patch) => setChoices(choices.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const rm = (i) => setChoices(choices.filter((_, idx) => idx !== i));
  return (
    <div className="ci-choices">
      {choices.map((c, i) => (
        <div className="ci-choice" key={c.id || i}>
          <div className="ci-choice-row">
            <input type="text" value={c.label || ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder={`Choice ${i + 1} label`} />
            <label className="ci-inline-check" title="Run the pump if this choice is picked">
              <input type="checkbox" checked={!!c.action} onChange={(e) => upd(i, { action: e.target.checked ? { type: 'pump', mode: 'timed', duration: 5, cycles: 3 } : null })} />
              Pump
            </label>
            <label className="ci-inline-check" title="Set a variable if this choice is picked">
              <input type="checkbox" checked={!!c.setVar} onChange={(e) => upd(i, { setVar: e.target.checked ? { varType: 'custom', variable: '', operation: 'set', value: '' } : null })} />
              Var
            </label>
            <button type="button" className="ci-del" onClick={() => rm(i)} title="Remove choice">×</button>
          </div>
          {c.action && <PumpFields action={c.action} onChange={(a) => upd(i, { action: a })} />}
          {c.setVar && <VarFields action={{ type: 'set_variable', ...c.setVar }} onChange={(a) => upd(i, { setVar: { varType: a.varType, variable: a.variable, operation: a.operation, value: a.value } })} />}
          <MsgField label="Response" value={normMsg(c.response)} onChange={(m) => upd(i, { response: m })} placeholder="Reply shown immediately when picked…" />
        </div>
      ))}
      {choices.length < 4 && <button type="button" className="ci-add-sm" onClick={add}>+ Choice ({choices.length}/4)</button>}
    </div>
  );
}

function CheckpointInjections({ value, onChange }) {
  const cp = typeof value === 'string' ? { mainTheme: value, injections: [] } : (value || { mainTheme: '', injections: [] });
  const mainTheme = cp.mainTheme || '';
  const injections = Array.isArray(cp.injections) ? cp.injections : [];

  const emit = (patch) => onChange({ mainTheme, injections, ...patch });
  const setInjections = (inj) => emit({ injections: inj });
  const addInjection = () => setInjections([...injections, { id: newId('inj'), message: { text: '', llmEnhance: true }, response: { text: '', llmEnhance: true }, enabled: true, chance: 50, maxAppearances: -1, action: null }]);
  const upd = (i, patch) => setInjections(injections.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const rm = (i) => setInjections(injections.filter((_, idx) => idx !== i));

  const actionType = (inj) => (inj.action?.type || 'none');
  const setActionType = (i, type) => {
    if (type === 'none') upd(i, { action: null });
    else if (type === 'pump') upd(i, { action: { type: 'pump', mode: 'timed', duration: 5, cycles: 3 } });
    else if (type === 'set_variable') upd(i, { action: { type: 'set_variable', varType: 'custom', variable: '', operation: 'set', value: '' } });
    else if (type === 'player_choice') upd(i, { action: { type: 'player_choice', choices: [] } });
  };

  return (
    <div className="checkpoint-injections">
      <label className="ci-label">Main theme</label>
      <textarea
        className="ci-main-theme"
        value={mainTheme}
        onChange={(e) => emit({ mainTheme: e.target.value })}
        placeholder="Always-on guidance while capacity is in this range…"
        rows={2}
      />

      <div className="ci-injections-header">
        <span className="ci-label">Injections (random pop-ups)</span>
        <button type="button" className="ci-add" onClick={addInjection}>+ Injection</button>
      </div>

      {injections.map((inj, i) => (
        <div className={`ci-injection ${inj.enabled === false ? 'disabled' : ''}`} key={inj.id || i}>
          <div className="ci-injection-top">
            <input type="checkbox" checked={inj.enabled !== false} onChange={(e) => upd(i, { enabled: e.target.checked })} title="Enabled" />
            <label className="ci-num" title="% chance per message">%<input type="number" min={0} max={100} value={inj.chance ?? 50} onChange={(e) => upd(i, { chance: parseInt(e.target.value) || 0 })} /></label>
            <label className="ci-num" title="Max appearances per session (-1 = unlimited)">max<input type="number" min={-1} value={inj.maxAppearances ?? -1} onChange={(e) => upd(i, { maxAppearances: parseInt(e.target.value) })} /></label>
            <button type="button" className="ci-del" onClick={() => rm(i)} title="Remove injection">×</button>
          </div>
          <MsgField label="Message" value={normMsg(inj.message, inj.text)} onChange={(m) => upd(i, { message: m, text: undefined })} placeholder="Delivered this message…" />
          <MsgField label="Response" value={normMsg(inj.response)} onChange={(m) => upd(i, { response: m })} placeholder="Delivered next message (optional)…" />
          <div className="ci-action-row">
            <label>Action:</label>
            <select value={actionType(inj)} onChange={(e) => setActionType(i, e.target.value)}>
              <option value="none">None</option>
              <option value="pump">Primary Pump</option>
              <option value="set_variable">Set Variable</option>
              <option value="player_choice">Player Choice</option>
            </select>
            {actionType(inj) === 'pump' && <PumpFields action={inj.action} onChange={(a) => upd(i, { action: a })} />}
            {actionType(inj) === 'set_variable' && <VarFields action={inj.action} onChange={(a) => upd(i, { action: a })} />}
          </div>
          {actionType(inj) === 'player_choice' && <ChoiceEditor action={inj.action} onChange={(a) => upd(i, { action: a })} />}
        </div>
      ))}
    </div>
  );
}

export default CheckpointInjections;
