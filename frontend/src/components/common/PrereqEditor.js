import React, { useState } from 'react';
import './PrereqEditor.css';

const nid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Ordered, drag-arrangeable list of mandatory pre-req choice steps. Each choice may
// load a checkpoint profile and/or set a variable.
function PrereqEditor({ steps = [], onChange, profiles = [] }) {
  const [dragIdx, setDragIdx] = useState(null);

  const set = (s) => onChange(s);
  const addStep = () => set([...steps, { id: nid('pq'), prompt: '', choices: [{ id: nid('pc'), label: '' }] }]);
  const updStep = (i, patch) => set(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const rmStep = (i) => set(steps.filter((_, idx) => idx !== i));
  const move = (from, to) => {
    if (from == null || from === to) return;
    const arr = [...steps];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    set(arr);
  };
  const updChoice = (si, ci, patch) => updStep(si, { choices: steps[si].choices.map((c, idx) => (idx === ci ? { ...c, ...patch } : c)) });
  const addChoice = (si) => { if (steps[si].choices.length < 4) updStep(si, { choices: [...steps[si].choices, { id: nid('pc'), label: '' }] }); };
  const rmChoice = (si, ci) => updStep(si, { choices: steps[si].choices.filter((_, idx) => idx !== ci) });

  return (
    <div className="prereq-editor">
      {steps.map((step, si) => (
        <div
          className="prereq-step"
          key={step.id}
          draggable
          onDragStart={() => setDragIdx(si)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { move(dragIdx, si); setDragIdx(null); }}
        >
          <div className="prereq-step-head">
            <span className="prereq-drag" title="Drag to reorder">☰</span>
            <input
              type="text"
              className="prereq-prompt"
              value={step.prompt || ''}
              onChange={(e) => updStep(si, { prompt: e.target.value })}
              placeholder={`Step ${si + 1} prompt (e.g. What pump are you using?)`}
            />
            <button type="button" className="prereq-del" onClick={() => rmStep(si)} title="Remove step">×</button>
          </div>

          {step.choices.map((c, ci) => (
            <div className="prereq-choice" key={c.id}>
              <div className="prereq-choice-row">
                <input
                  type="text"
                  className="prereq-choice-label"
                  value={c.label || ''}
                  onChange={(e) => updChoice(si, ci, { label: e.target.value })}
                  placeholder={`Choice ${ci + 1} label`}
                />
                <select
                  className="prereq-profile-sel"
                  value={c.loadProfileId || ''}
                  onChange={(e) => updChoice(si, ci, { loadProfileId: e.target.value || undefined })}
                  title="Load this checkpoint profile when picked"
                >
                  <option value="">— load profile —</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label className="prereq-var-toggle" title="Also set a variable">
                  <input
                    type="checkbox"
                    checked={!!c.setVar}
                    onChange={(e) => updChoice(si, ci, { setVar: e.target.checked ? { variable: '', operation: 'set', value: '' } : undefined })}
                  />
                  var
                </label>
                {step.choices.length > 1 && (
                  <button type="button" className="prereq-del-sm" onClick={() => rmChoice(si, ci)} title="Remove choice">×</button>
                )}
              </div>
              {c.setVar && (
                <div className="prereq-setvar">
                  <input type="text" value={c.setVar.variable || ''} onChange={(e) => updChoice(si, ci, { setVar: { ...c.setVar, variable: e.target.value } })} placeholder="variable" />
                  <select value={c.setVar.operation || 'set'} onChange={(e) => updChoice(si, ci, { setVar: { ...c.setVar, operation: e.target.value } })}>
                    <option value="set">Set</option>
                    <option value="inc">+</option>
                    <option value="dec">−</option>
                    <option value="mult">×</option>
                    <option value="div">÷</option>
                  </select>
                  <input type="text" value={c.setVar.value || ''} onChange={(e) => updChoice(si, ci, { setVar: { ...c.setVar, value: e.target.value } })} placeholder="value" />
                </div>
              )}
            </div>
          ))}
          {step.choices.length < 4 && (
            <button type="button" className="prereq-add-sm" onClick={() => addChoice(si)}>+ Choice ({step.choices.length}/4)</button>
          )}
        </div>
      ))}
      <button type="button" className="prereq-add" onClick={addStep}>+ Pre-Req Step</button>
    </div>
  );
}

export default PrereqEditor;
