import React, { useState } from 'react';
import './PreFillEditor.css';

const nid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Card-level "Pre-Fill" gate phase: an ordered, branching keyword state machine that runs
// after the welcome and before any pumping. The instructor/character converses freely; when
// the player says a step's trigger phrase, it advances to another step or starts the pump
// phase. No pumping happens until a trigger exits pre-fill.
function PreFillEditor({ value, onChange, profiles = [], isInstructor = false }) {
  const pf = value || { enabled: false, steps: [] };
  const steps = Array.isArray(pf.steps) ? pf.steps : [];
  const [dragIdx, setDragIdx] = useState(null);

  const emit = (patch) => onChange({ ...pf, ...patch });
  const setSteps = (s) => emit({ steps: s });
  const addStep = () => setSteps([...steps, { id: nid('pfs'), instruction: { text: '', llmEnhance: true }, triggers: [{ id: nid('pft'), words: '' }] }]);
  const updStep = (i, patch) => setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const rmStep = (i) => setSteps(steps.filter((_, idx) => idx !== i));
  const move = (from, to) => {
    if (from == null || from === to) return;
    const a = [...steps]; const [x] = a.splice(from, 1); a.splice(to, 0, x); setSteps(a);
  };

  const updTrig = (si, ti, patch) => updStep(si, { triggers: steps[si].triggers.map((t, idx) => (idx === ti ? { ...t, ...patch } : t)) });
  const addTrig = (si) => updStep(si, { triggers: [...(steps[si].triggers || []), { id: nid('pft'), words: '' }] });
  const rmTrig = (si, ti) => updStep(si, { triggers: steps[si].triggers.filter((_, idx) => idx !== ti) });

  return (
    <div className="prefill-editor">
      <label className="prefill-enable">
        <input type="checkbox" checked={!!pf.enabled} onChange={(e) => emit({ enabled: e.target.checked })} />
        Enable Pre-Fill (gated intro — no pumping until a trigger starts the pump phase)
      </label>

      {pf.enabled && (
        <>
          <p className="section-hint">Ordered steps run after the welcome. The {isInstructor ? 'instructor' : 'character'} converses freely; when the player says a step's trigger phrase, it advances (or starts the pump phase). Step 1 begins the sequence. Triggers are comma-separated and matched case-insensitively in the player's message.</p>

          {steps.map((step, si) => (
            <div
              className="prefill-step"
              key={step.id}
              draggable
              onDragStart={() => setDragIdx(si)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { move(dragIdx, si); setDragIdx(null); }}
            >
              <div className="prefill-step-head">
                <span className="prefill-drag" title="Drag to reorder">☰</span>
                <span className="prefill-step-num">Step {si + 1}{si === 0 ? ' · start' : ''}</span>
                <button type="button" className="prefill-del" onClick={() => rmStep(si)} title="Remove step">×</button>
              </div>

              <textarea
                className="prefill-instruction"
                rows={2}
                value={step.instruction?.text || ''}
                onChange={(e) => updStep(si, { instruction: { ...(step.instruction || {}), text: e.target.value } })}
                placeholder="What to convey / wait for at this step (e.g. Explain setup, then have them say 'ready' to continue)…"
              />
              <label className="prefill-enh" title="Let the model weave this instruction naturally; uncheck to keep it terse/verbatim.">
                <input type="checkbox" checked={step.instruction?.llmEnhance !== false} onChange={(e) => updStep(si, { instruction: { ...(step.instruction || {}), llmEnhance: e.target.checked } })} />
                LLM enhance
              </label>

              <div className="prefill-triggers">
                {(step.triggers || []).map((t, ti) => (
                  <div className="prefill-trigger" key={t.id}>
                    <input
                      type="text"
                      className="prefill-words"
                      value={t.words || ''}
                      onChange={(e) => updTrig(si, ti, { words: e.target.value })}
                      placeholder="Trigger phrase(s), comma-separated — e.g. ready, let's go"
                    />
                    <div className="prefill-trigger-row">
                      <select value={t.exit ? 'exit' : 'goto'} onChange={(e) => updTrig(si, ti, { exit: e.target.value === 'exit' })}>
                        <option value="goto">→ go to step</option>
                        <option value="exit">▶ start pump phase</option>
                      </select>
                      {!t.exit && (
                        <select value={t.goto || ''} onChange={(e) => updTrig(si, ti, { goto: e.target.value })} title="Which step this trigger jumps to">
                          <option value="">— step —</option>
                          {steps.map((s, idx) => (idx !== si ? <option key={s.id} value={s.id}>Step {idx + 1}</option> : null))}
                        </select>
                      )}
                      {t.exit && isInstructor && (
                        <select value={t.loadProfileId || ''} onChange={(e) => updTrig(si, ti, { loadProfileId: e.target.value })} title="Pump profile to load on exit">
                          <option value="">— pump profile —</option>
                          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      <label className="prefill-var-toggle" title="Also set a variable on this trigger">
                        <input type="checkbox" checked={!!t.setVar} onChange={(e) => updTrig(si, ti, { setVar: e.target.checked ? { variable: '', operation: 'set', value: '' } : undefined })} />
                        var
                      </label>
                      {step.triggers.length > 1 && <button type="button" className="prefill-del-sm" onClick={() => rmTrig(si, ti)} title="Remove trigger">×</button>}
                    </div>
                    {t.setVar && (
                      <div className="prefill-setvar">
                        <input type="text" value={t.setVar.variable || ''} onChange={(e) => updTrig(si, ti, { setVar: { ...t.setVar, variable: e.target.value } })} placeholder="variable" />
                        <select value={t.setVar.operation || 'set'} onChange={(e) => updTrig(si, ti, { setVar: { ...t.setVar, operation: e.target.value } })}>
                          <option value="set">Set</option><option value="inc">+</option><option value="dec">−</option><option value="mult">×</option><option value="div">÷</option>
                        </select>
                        <input type="text" value={t.setVar.value || ''} onChange={(e) => updTrig(si, ti, { setVar: { ...t.setVar, value: e.target.value } })} placeholder="value" />
                      </div>
                    )}
                    <input
                      type="text"
                      className="prefill-response"
                      value={(t.response && typeof t.response === 'object' ? t.response.text : t.response) || ''}
                      onChange={(e) => updTrig(si, ti, { response: { ...(typeof t.response === 'object' ? t.response : {}), text: e.target.value } })}
                      placeholder="Optional line for the reply on this transition…"
                    />
                  </div>
                ))}
                <button type="button" className="prefill-add-sm" onClick={() => addTrig(si)}>+ Trigger</button>
              </div>
            </div>
          ))}
          <button type="button" className="prefill-add" onClick={addStep}>+ Step</button>
        </>
      )}
    </div>
  );
}

export default PreFillEditor;
