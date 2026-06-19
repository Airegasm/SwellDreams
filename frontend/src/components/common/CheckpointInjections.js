import React from 'react';
import './CheckpointInjections.css';

const newId = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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

// Player-choice action editor: up to 4 choices, each with label + optional pump + response.
function ChoiceEditor({ action, onChange }) {
  const choices = (action?.choices || []);
  const setChoices = (c) => onChange({ type: 'player_choice', choices: c });
  const add = () => { if (choices.length < 4) setChoices([...choices, { id: newId('cc'), label: '', action: null, response: '' }]); };
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
            <button type="button" className="ci-del" onClick={() => rm(i)} title="Remove choice">×</button>
          </div>
          {c.action && <PumpFields action={c.action} onChange={(a) => upd(i, { action: a })} />}
          <input type="text" value={c.response || ''} onChange={(e) => upd(i, { response: e.target.value })} placeholder="Response injection (next turn)" />
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
  const addInjection = () => setInjections([...injections, { id: newId('inj'), text: '', enabled: true, chance: 50, maxAppearances: -1, action: null }]);
  const upd = (i, patch) => setInjections(injections.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const rm = (i) => setInjections(injections.filter((_, idx) => idx !== i));

  const actionType = (inj) => (inj.action?.type || 'none');
  const setActionType = (i, type) => {
    if (type === 'none') upd(i, { action: null });
    else if (type === 'pump') upd(i, { action: { type: 'pump', mode: 'timed', duration: 5, cycles: 3 } });
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
            <input type="text" className="ci-injection-text" value={inj.text || ''} onChange={(e) => upd(i, { text: e.target.value })} placeholder="Injection text…" />
            <label className="ci-num" title="% chance per message">%<input type="number" min={0} max={100} value={inj.chance ?? 50} onChange={(e) => upd(i, { chance: parseInt(e.target.value) || 0 })} /></label>
            <label className="ci-num" title="Max appearances per session (-1 = unlimited)">max<input type="number" min={-1} value={inj.maxAppearances ?? -1} onChange={(e) => upd(i, { maxAppearances: parseInt(e.target.value) })} /></label>
            <button type="button" className="ci-del" onClick={() => rm(i)} title="Remove injection">×</button>
          </div>
          <div className="ci-action-row">
            <label>Action:</label>
            <select value={actionType(inj)} onChange={(e) => setActionType(i, e.target.value)}>
              <option value="none">None</option>
              <option value="pump">Primary Pump</option>
              <option value="player_choice">Player Choice</option>
            </select>
            {actionType(inj) === 'pump' && <PumpFields action={inj.action} onChange={(a) => upd(i, { action: a })} />}
          </div>
          {actionType(inj) === 'player_choice' && <ChoiceEditor action={inj.action} onChange={(a) => upd(i, { action: a })} />}
        </div>
      ))}
    </div>
  );
}

export default CheckpointInjections;
