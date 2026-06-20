import React, { useState } from 'react';
import TriggerRow from './TriggerRow';
import { API_BASE } from '../../config';
import { exitsFor } from '../minigames/gameDefs';
import './TreeEditor.css';

// fire_tree target picker: lazy-loads the global library so any tree (incl. built-ins) can be fired.
function FireTreeEditor({ node, setParams }) {
  const [trees, setTrees] = React.useState(null);
  React.useEffect(() => {
    fetch(`${API_BASE}/api/trigger-trees`).then(r => r.json()).then(d => setTrees(d?.trees || [])).catch(() => setTrees([]));
  }, []);
  return (
    <label className="tree-field">
      <span>Library tree to fire</span>
      <select value={node.params?.treeId || ''} onChange={(e) => setParams({ treeId: e.target.value })}>
        <option value="">select a library tree…</option>
        {(trees || []).map(t => <option key={t.id} value={t.id}>{t.name}{t.builtIn ? ' (built-in)' : ''}</option>)}
      </select>
    </label>
  );
}

// Collect every Label node's name in a tree (recursively) — the valid goto targets.
function collectLabelNames(nodes, out = []) {
  for (const n of (nodes || [])) {
    if (!n) continue;
    if (n.kind === 'action' && n.type === 'label' && n.params?.name) out.push(n.params.name);
    if (n.children) collectLabelNames(n.children, out);
  }
  return out;
}

// call_minigame editor (Phase 5): pick a library MiniGame, then bind an OPTIONAL goto per exit —
// chosen from the tree's Labels (rowProps.treeLabels). The played exit sets [Flow:GameResult]/
// [Flow:GameWinner]; a bound exit jumps to its Label (placed AFTER this node), unbound falls through.
function CallMiniGameBlock({ node, setParams, rowProps = {} }) {
  const [games, setGames] = React.useState(null);
  React.useEffect(() => {
    fetch(`${API_BASE}/api/minigames`).then(r => r.json()).then(d => setGames(d?.games || [])).catch(() => setGames([]));
  }, []);
  const gameId = node.params?.miniGameId || '';
  const game = (games || []).find(g => g.id === gameId);
  const exits = game ? exitsFor(game.type, game.config || {}) : [];
  const gotos = node.params?.exitGotos || {};
  const setGoto = (exit, name) => setParams({ exitGotos: { ...gotos, [exit]: name } });
  const labels = rowProps.treeLabels || [];
  return (
    <div className="tree-params">
      <label className="tree-field">
        <span>MiniGame to play</span>
        <select value={gameId} onChange={(e) => setParams({ miniGameId: e.target.value, exitGotos: {} })}>
          <option value="">select a minigame…</option>
          {(games || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      {gameId && !game && <div className="section-hint">⚠️ This minigame no longer exists in the library.</div>}
      {game && (
        <div className="tree-field">
          <span>On each exit, go to (optional; blank = fall through)</span>
          {exits.length === 0 && <div className="section-hint">No named exits — this game sets <code>[Flow:GameResult]</code> only (e.g. dice = numeric total). Branch on it with conditions.</div>}
          {exits.map(exit => {
            const cur = gotos[exit] || '';
            // Include the stored value even if its Label was since removed, so it isn't lost.
            const opts = cur && !labels.includes(cur) ? [cur, ...labels] : labels;
            return (
              <div key={exit} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '3px 0' }}>
                <code style={{ minWidth: 90 }}>{exit}</code>
                <span>→</span>
                <select value={cur} onChange={(e) => setGoto(exit, e.target.value)}>
                  <option value="">— fall through —</option>
                  {opts.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            );
          })}
          {exits.length > 0 && labels.length === 0 && <div className="section-hint">Add <strong>Label</strong> nodes after this one to bind gotos.</div>}
          <div className="section-hint">Sets <code>[Flow:GameResult]</code>{game.competitive ? <> and <code>[Flow:GameWinner]</code></> : null}. Goto targets must be Labels placed AFTER this node.</div>
        </div>
      )}
    </div>
  );
}

// Reusable nested-block Trigger Tree editor (collapsible outline; see plan
// typed-dazzling-nygaard.md). ONE component, context-driven: pass a character's
// rowProps (isPumpable, reminders, globalReminders, members, profiles) for an inline
// card-scoped tree, or omit them for an agnostic library tree. Mirrors the runTree
// node model: { id, kind:'event'|'container'|'action', type, once?, params, children?[] }.

const rid = (p = 'n') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const SYSTEM_VARS = [
  { value: 'capacity', label: 'Player Capacity' },
  { value: 'characterCapacity', label: 'Char Capacity' },
  { value: 'pain', label: 'Player Pain' },
  { value: 'emotion', label: 'Player Disposition' },
  { value: 'device_state', label: 'Device State' },
];

const OPERATORS = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: 'contains', label: 'contains' },
  { value: 'empty', label: 'is empty' },
  { value: 'notEmpty', label: 'is not empty' },
];

// Add-block menu, grouped. Actions are a single generic node — TriggerRow picks the
// specific action type and renders its params.
const ADD_GROUPS = [
  {
    label: 'Containers', items: [
      { kind: 'container', type: 'group', label: 'Group' },
      { kind: 'container', type: 'if', label: 'If / Else' },
      { kind: 'container', type: 'player_choice', label: 'Player Choice' },
      { kind: 'container', type: 'choose_multi', label: 'Choose Multiple' },
      { kind: 'container', type: 'chance', label: 'Chance (%)' },
      { kind: 'container', type: 'random', label: 'Random (one of)' },
      { kind: 'container', type: 'keyword_gate', label: 'Keyword Gate' },
      { kind: 'container', type: 'repeat', label: 'Repeat / Loop' },
      { kind: 'container', type: 'pause_resume', label: 'Pause / Resume' },
    ]
  },
  {
    label: 'Events', items: [
      { kind: 'event', type: 'keyword', label: 'On Player Keyword' },
    ]
  },
  {
    label: 'Control', items: [
      { kind: 'action', type: 'label', label: 'Label (jump target)' },
      { kind: 'action', type: 'goto', label: 'Go To (jump)' },
    ]
  },
  {
    label: 'Flow', items: [
      { kind: 'action', type: 'fire_tree', label: 'Fire Tree (library)' },
      { kind: 'action', type: 'fire_flow', label: 'Fire Flow (escape hatch)' },
      { kind: 'action', type: 'call_minigame', label: 'Call MiniGame' },
      { kind: 'action', type: 'end_intro', label: 'End Gated Intro' },
    ]
  },
  {
    label: 'Actions', items: [
      { kind: 'action', type: '', label: 'Action…' },
    ]
  },
];

const CONTROL_LEAF_TYPES = new Set(['label', 'goto', 'fire_tree', 'fire_flow', 'call_minigame', 'end_intro']); // edited outside TriggerRow

const NO_OPERAND_OPS = new Set(['empty', 'notEmpty']);
const HOLDS_CHILDREN = new Set(['group', 'chance', 'random', 'keyword_gate', 'keyword', 'repeat', 'pause_resume']); // not if/player_choice/choose_multi (special children)

function makeCond() { return { varType: 'flow', variable: '', operator: '==', value: '' }; }
function makeBranch(isElse = false) {
  return { id: rid('br'), kind: 'container', type: 'branch', params: isElse ? { else: true } : { match: 'all', conditions: [makeCond()] }, children: [] };
}
function makeChoice() { return { id: rid('ch'), kind: 'container', type: 'choice', params: { label: 'Option' }, children: [] }; }
function makeNode(kind, type) {
  const node = { id: rid(), kind, type, params: {} };
  if (kind === 'container' || kind === 'event') node.children = [];
  if (type === 'if') node.children = [makeBranch(false)];
  if (type === 'player_choice' || type === 'choose_multi') node.children = [makeChoice()];
  if (type === 'chance') node.params.chance = 50;
  if (type === 'repeat') { node.params.mode = 'fixed'; node.params.iterations = 3; }
  if (type === 'pause_resume') { node.params.resumeAfterType = 'turns'; node.params.resumeAfterValue = 4; }
  if (type === 'keyword_gate' || type === 'keyword') node.params.keys = [];
  if (type === 'label' || type === 'goto') node.params.name = '';
  if (type === 'fire_tree') node.params.treeId = '';
  if (type === 'fire_flow') { node.params.flowId = ''; node.params.flowActionLabel = ''; }
  if (type === 'call_minigame') { node.params.miniGameId = ''; node.params.exitGotos = {}; }
  if (type === 'end_intro') node.params.loadProfileId = '';
  return node;
}

// One-row summary shown when a node is collapsed.
function summarize(node) {
  const t = node.type;
  const p = node.params || {};
  if (node.kind === 'action') {
    if (!t) return '(choose action…)';
    if (t === 'label') return `Label: ${p.name || '(unnamed)'}`;
    if (t === 'goto') return `Go to: ${p.name || '(unset)'}`;
    if (t === 'fire_tree') return `Fire Tree: ${p.treeId || '(unset)'}`;
    if (t === 'fire_flow') return `Fire Flow: ${p.flowId || '(unset)'}${p.flowActionLabel ? ' › ' + p.flowActionLabel : ''}`;
    if (t === 'call_minigame') return `Call MiniGame${p.miniGameId ? '' : ' (unset)'}${Object.values(p.exitGotos || {}).filter(Boolean).length ? ` · ${Object.values(p.exitGotos).filter(Boolean).length} goto(s)` : ''}`;
    if (t === 'end_intro') return `End Gated Intro${p.manualRelease ? ' (GO! gate)' : ''}${p.loadProfileId ? ' → load profile' : ' → default'}`;
    if (t === 'ai_message') return `Message${p.llmEnhance === false ? ' (verbatim)' : ''}: ${(p.context || '').slice(0, 48) || '(empty)'}`;
    if (t === 'flow_var' || t === 'set_variable') return `Set ${p.varType === 'system' ? 'System' : 'Flow'} ${p.variable || '?'} ${p.operation || 'set'} ${p.value ?? ''}`;
    return t;
  }
  if (t === 'group') return `Group · ${(node.children || []).length} item(s)`;
  if (t === 'if') return `If / Else · ${(node.children || []).filter(b => b && b.type === 'branch').length} branch(es)`;
  if (t === 'player_choice') return `Player Choice · ${(node.children || []).filter(c => c && c.type === 'choice').length} option(s)`;
  if (t === 'choose_multi') return `Choose Multiple · ${(node.children || []).filter(c => c && c.type === 'choice').length} option(s)`;
  if (t === 'chance') return `Chance ${p.chance ?? 0}%`;
  if (t === 'random') return `Random — one of ${(node.children || []).length}`;
  if (t === 'repeat') return p.mode === 'until' ? `Repeat until ${p.condition?.variable || '?'} ${p.condition?.operator || ''} ${p.condition?.value ?? ''}` : `Repeat ×${p.iterations ?? 1}`;
  if (t === 'pause_resume') return `Pause · resume after ${p.resumeAfterValue ?? 4} turn(s)`;
  if (t === 'keyword_gate') return `Keyword Gate: ${(p.keys || []).join(', ') || '(none)'}`;
  if (t === 'keyword') return `On Keyword: ${(p.keys || []).join(', ') || '(none)'}`;
  return t;
}

// Add-block dropdown.
function AddMenu({ onAdd, small }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tree-add ${small ? 'tree-add-sm' : ''}`}>
      <button type="button" className="tree-add-btn" onClick={() => setOpen(o => !o)}>+ Add block</button>
      {open && (
        <div className="tree-add-menu" onMouseLeave={() => setOpen(false)}>
          {ADD_GROUPS.map(g => (
            <div key={g.label} className="tree-add-group">
              <div className="tree-add-group-label">{g.label}</div>
              {g.items.map(it => (
                <button key={it.type || 'action'} type="button" className="tree-add-item"
                  onClick={() => { onAdd(makeNode(it.kind, it.type)); setOpen(false); }}>{it.label}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A single condition row inside a branch.
function ConditionRow({ cond, onChange, onRemove }) {
  const set = (patch) => onChange({ ...cond, ...patch });
  const noOperand = NO_OPERAND_OPS.has(cond.operator);
  return (
    <div className="tree-cond-row">
      <select value={cond.varType || 'flow'} onChange={(e) => set({ varType: e.target.value })} title="Variable source">
        <option value="flow">Flow</option>
        <option value="system">System</option>
      </select>
      {cond.varType === 'system' ? (
        <select value={cond.variable || ''} onChange={(e) => set({ variable: e.target.value })}>
          <option value="">variable…</option>
          {SYSTEM_VARS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      ) : (
        <input type="text" value={cond.variable || ''} onChange={(e) => set({ variable: e.target.value })} placeholder="flow variable" />
      )}
      <select value={cond.operator || '=='} onChange={(e) => set({ operator: e.target.value })}>
        {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {!noOperand && (
        <input type="text" value={cond.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="value or [Flow:x]" />
      )}
      <button type="button" className="tree-x" onClick={onRemove} title="Remove condition">×</button>
    </div>
  );
}

// A branch within an 'if'. Header (If / Else if / Else) + conditions + a nested child list.
function BranchBlock({ branch, index, isLast, onChange, onRemove, rowProps }) {
  const isElse = branch.params?.else === true;
  const conds = branch.params?.conditions || [];
  const setParams = (patch) => onChange({ ...branch, params: { ...(branch.params || {}), ...patch } });
  const setConds = (next) => setParams({ conditions: next });

  const heading = isElse ? 'Else' : index === 0 ? 'If' : 'Else if';
  return (
    <div className="tree-branch">
      <div className="tree-branch-head">
        <span className="tree-branch-label">{heading}</span>
        {!isElse && (
          <select className="tree-match" value={branch.params?.match === 'any' ? 'any' : 'all'} onChange={(e) => setParams({ match: e.target.value })} title="Match">
            <option value="all">match ALL</option>
            <option value="any">match ANY</option>
          </select>
        )}
        <button type="button" className="tree-x" onClick={onRemove} title="Remove branch">×</button>
      </div>
      {!isElse && (
        <div className="tree-branch-conds">
          {conds.map((c, i) => (
            <ConditionRow key={i} cond={c} onChange={(u) => setConds(conds.map((x, idx) => idx === i ? u : x))} onRemove={() => setConds(conds.filter((_, idx) => idx !== i))} />
          ))}
          <button type="button" className="tree-mini" onClick={() => setConds([...conds, makeCond()])}>+ Condition</button>
        </div>
      )}
      <div className="tree-branch-body">
        <NodeList nodes={branch.children || []} onChange={(next) => onChange({ ...branch, children: next })} rowProps={rowProps} />
      </div>
    </div>
  );
}

// The 'if' body: ordered branches + add else-if / else controls.
function IfBlock({ node, onChange, rowProps }) {
  const branches = (node.children || []).filter(b => b && b.type === 'branch');
  const hasElse = branches.some(b => b.params?.else === true);
  const setBranches = (next) => onChange({ ...node, children: next });
  // An else (always-passes) must stay LAST or it shadows every branch after it (the walker
  // takes the first passing branch). Insert new else-ifs BEFORE any existing else.
  const addElseIf = () => {
    const elseIdx = branches.findIndex(b => b.params?.else === true);
    if (elseIdx === -1) return setBranches([...branches, makeBranch(false)]);
    const a = [...branches];
    a.splice(elseIdx, 0, makeBranch(false));
    setBranches(a);
  };
  return (
    <div className="tree-if">
      {branches.map((b, i) => (
        <BranchBlock key={b.id || i} branch={b} index={i} isLast={i === branches.length - 1}
          onChange={(u) => setBranches(branches.map((x, idx) => idx === i ? u : x))}
          onRemove={() => setBranches(branches.filter((_, idx) => idx !== i))}
          rowProps={rowProps} />
      ))}
      <div className="tree-if-controls">
        <button type="button" className="tree-mini" onClick={addElseIf}>+ Else if</button>
        {!hasElse && <button type="button" className="tree-mini" onClick={() => setBranches([...branches, makeBranch(true)])}>+ Else</button>}
      </div>
    </div>
  );
}

// One option within a player_choice: a label + its body (the subtree run when picked).
function ChoiceBlock({ choice, onChange, onRemove, rowProps }) {
  return (
    <div className="tree-branch">
      <div className="tree-branch-head">
        <span className="tree-branch-label">Option</span>
        <input type="text" value={choice.params?.label || ''} onChange={(e) => onChange({ ...choice, params: { ...(choice.params || {}), label: e.target.value } })} placeholder="button label" style={{ flex: 1 }} />
        <button type="button" className="tree-x" onClick={onRemove} title="Remove option">×</button>
      </div>
      <div className="tree-branch-body">
        <NodeList nodes={choice.children || []} onChange={(next) => onChange({ ...choice, children: next })} rowProps={rowProps} />
      </div>
    </div>
  );
}

// player_choice body: an optional prompt + up to 4 options (each a choice sub-list). Suspends
// the turn at runtime; the chosen option's body + same-level fall-through run on the player's pick.
function PlayerChoiceBlock({ node, onChange, rowProps, max = 4 }) {
  const choices = (node.children || []).filter(c => c && c.type === 'choice');
  const setChoices = (next) => onChange({ ...node, children: next });
  return (
    <div className="tree-if">
      <label className="tree-field">
        <span>Prompt (optional)</span>
        <input type="text" value={node.params?.prompt || ''} onChange={(e) => onChange({ ...node, params: { ...(node.params || {}), prompt: e.target.value } })} placeholder="question shown above the options" />
      </label>
      {choices.map((c, i) => (
        <ChoiceBlock key={c.id || i} choice={c}
          onChange={(u) => setChoices(choices.map((x, idx) => idx === i ? u : x))}
          onRemove={() => setChoices(choices.filter((_, idx) => idx !== i))}
          rowProps={rowProps} />
      ))}
      {choices.length < max && <button type="button" className="tree-mini" onClick={() => setChoices([...choices, makeChoice()])}>+ Option</button>}
    </div>
  );
}

// Per-node body: the type-specific param editor + (for containers) a nested child list.
function NodeBody({ node, onChange, rowProps }) {
  const t = node.type;
  const setParams = (patch) => onChange({ ...node, params: { ...(node.params || {}), ...patch } });

  // Control-flow leaves (label/goto) — simple name editors, NOT the TriggerRow action path.
  if (t === 'label' || t === 'goto') {
    return (
      <label className="tree-field tree-field-inline">
        <span>{t === 'label' ? 'Label name' : 'Go to label'}</span>
        <input type="text" value={node.params?.name || ''} onChange={(e) => setParams({ name: e.target.value })} placeholder="name" />
      </label>
    );
  }
  if (t === 'fire_tree') return <FireTreeEditor node={node} setParams={setParams} />;
  if (t === 'call_minigame') return <CallMiniGameBlock node={node} setParams={setParams} rowProps={rowProps} />;
  if (t === 'end_intro') {
    const profiles = rowProps?.profiles || [];
    return (
      <div className="tree-params">
        <label className="tree-field">
          <span>On end, load checkpoint profile</span>
          <select value={node.params?.loadProfileId || ''} onChange={(e) => setParams({ loadProfileId: e.target.value })}>
            <option value="">— Default (fall into 0–10%) —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
          </select>
        </label>
        <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <input type="checkbox" checked={!!node.params?.manualRelease} onChange={(e) => setParams({ manualRelease: e.target.checked })} />
          <span>Wait for manual <strong>GO!</strong> button before opening the pump gate</span>
        </label>
        <p className="section-hint">Ends the gated intro. {node.params?.manualRelease
          ? 'The pump gate stays CLOSED until the player presses GO! — then the profile loads and pumping/checkpoints begin. Prevents premature pumping during long buildups.'
          : 'Opens the pump gate immediately.'} Place this behind an On Player Keyword / Player Choice so it only fires when the player meets the condition.</p>
      </div>
    );
  }
  if (t === 'fire_flow') {
    return (
      <div className="tree-params">
        <label className="tree-field"><span>Flow ID</span><input type="text" value={node.params?.flowId || ''} onChange={(e) => setParams({ flowId: e.target.value })} placeholder="flow id" /></label>
        <label className="tree-field"><span>FlowAction (Button-Press) label</span><input type="text" value={node.params?.flowActionLabel || ''} onChange={(e) => setParams({ flowActionLabel: e.target.value })} placeholder="button-press label to enter at" /></label>
      </div>
    );
  }

  if (node.kind === 'action') {
    // Adapter: a TriggerRow edits { id, type, ...params }; split back into { type, params }.
    // Switching the action type starts the params fresh — TriggerRow keeps the prior type's
    // fields on a type change, which would otherwise leak (e.g. a stale `value` into set_emotion).
    const trigger = { id: node.id, type: node.type, ...(node.params || {}) };
    const onTrig = (u) => {
      const { id, type, ...rest } = u;
      const newType = type || '';
      onChange({ ...node, type: newType, params: newType === node.type ? rest : {} });
    };
    return <TriggerRow trigger={trigger} onChange={onTrig} onRemove={null} hideRemove {...rowProps} />;
  }

  if (t === 'if') return <IfBlock node={node} onChange={onChange} rowProps={rowProps} />;
  if (t === 'player_choice') return <PlayerChoiceBlock node={node} onChange={onChange} rowProps={rowProps} />;
  if (t === 'choose_multi') return <PlayerChoiceBlock node={node} onChange={onChange} rowProps={rowProps} max={8} />;

  // Keyword params shared by keyword_gate (container) and keyword (event).
  const keywordParams = (t === 'keyword_gate' || t === 'keyword') && (
    <div className="tree-params">
      <label className="tree-field">
        <span>Keywords (any of, comma-separated)</span>
        <input type="text" value={(node.params?.keys || []).join(', ')}
          onChange={(e) => setParams({ keys: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="e.g. balloon, inflate" />
      </label>
      <label className="tree-check"><input type="checkbox" checked={!!node.params?.caseSensitive} onChange={(e) => setParams({ caseSensitive: e.target.checked })} /> case sensitive</label>
      <label className="tree-check"><input type="checkbox" checked={node.params?.matchWholeWords !== false} onChange={(e) => setParams({ matchWholeWords: e.target.checked })} /> whole words</label>
    </div>
  );

  const chanceParams = t === 'chance' && (
    <div className="tree-params">
      <label className="tree-field tree-field-inline">
        <span>Chance</span>
        <input type="number" min={0} max={100} value={node.params?.chance ?? 50} onChange={(e) => setParams({ chance: parseInt(e.target.value) || 0 })} /> %
      </label>
    </div>
  );

  const repeatParams = t === 'repeat' && (
    <div className="tree-params">
      <select value={node.params?.mode || 'fixed'} onChange={(e) => setParams({ mode: e.target.value })} title="Repeat mode">
        <option value="fixed">Fixed times</option>
        <option value="until">Until condition</option>
      </select>
      {(node.params?.mode || 'fixed') === 'fixed' ? (
        <label className="tree-field tree-field-inline"><span>×</span><input type="number" min={1} value={node.params?.iterations ?? 3} onChange={(e) => setParams({ iterations: parseInt(e.target.value) || 1 })} /></label>
      ) : (
        <>
          <ConditionRow cond={node.params?.condition || makeCond()} onChange={(c) => setParams({ condition: c })} onRemove={() => setParams({ condition: makeCond() })} />
          <label className="tree-field tree-field-inline"><span>max</span><input type="number" min={1} value={node.params?.maxIterations ?? 100} onChange={(e) => setParams({ maxIterations: parseInt(e.target.value) || 1 })} /></label>
        </>
      )}
    </div>
  );

  const pauseParams = t === 'pause_resume' && (
    <div className="tree-params">
      <label className="tree-field tree-field-inline">
        <span>Resume after</span>
        <input type="number" min={1} value={node.params?.resumeAfterValue ?? 4} onChange={(e) => setParams({ resumeAfterValue: parseInt(e.target.value) || 1 })} /> reply turn(s)
      </label>
      <div className="tree-hint">Defers the rest of this tree, then runs the body below after the wait.</div>
    </div>
  );

  return (
    <div className="tree-container-body">
      {chanceParams}
      {repeatParams}
      {pauseParams}
      {keywordParams}
      {HOLDS_CHILDREN.has(t) && (
        <NodeList nodes={node.children || []} onChange={(next) => onChange({ ...node, children: next })} rowProps={rowProps} />
      )}
    </div>
  );
}

// One node row: header (collapse, type/summary, once, move, delete) + body.
function NodeRow({ node, onChange, onRemove, onMoveUp, onMoveDown, rowProps }) {
  const [open, setOpen] = useState(node.kind === 'action' ? true : true);
  const isContainer = node.kind !== 'action';
  return (
    <div className={`tree-node tree-node-${node.kind}`}>
      <div className="tree-node-head">
        <button type="button" className="tree-collapse" onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
        <span className="tree-node-kind">{node.kind === 'action' ? 'Action' : node.kind === 'event' ? 'Event' : 'Block'}</span>
        {!open && <span className="tree-node-summary">{summarize(node)}</span>}
        <span className="tree-node-spacer" />
        <label className="tree-once" title="Fire only once per session"><input type="checkbox" checked={!!node.once} onChange={(e) => onChange({ ...node, once: e.target.checked })} /> once</label>
        <button type="button" className="tnode-ctrl" onClick={onMoveUp} title="Move up">↑</button>
        <button type="button" className="tnode-ctrl" onClick={onMoveDown} title="Move down">↓</button>
        <button type="button" className="tnode-ctrl tnode-del" onClick={onRemove} title="Remove">×</button>
      </div>
      {open && (
        <div className="tree-node-body">
          <NodeBody node={node} onChange={onChange} rowProps={rowProps} />
        </div>
      )}
    </div>
  );
}

// A list of sibling nodes with reorder + an add menu. Recursive (containers nest NodeLists).
function NodeList({ nodes, onChange, rowProps }) {
  const list = Array.isArray(nodes) ? nodes : [];
  const update = (i, n) => onChange(list.map((x, idx) => (idx === i ? n : x)));
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = [...list];
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  return (
    <div className="tree-list">
      {list.map((node, i) => (
        <NodeRow key={node.id || i} node={node}
          onChange={(n) => update(i, n)} onRemove={() => remove(i)}
          onMoveUp={() => move(i, -1)} onMoveDown={() => move(i, 1)} rowProps={rowProps} />
      ))}
      <AddMenu small={list.length > 0} onAdd={(n) => onChange([...list, n])} />
    </div>
  );
}

// Public entry: edits a flat node array (a tree's `nodes`). `value` = nodes[], `onChange(nodes)`.
function TreeEditor({ value, onChange, ...rowProps }) {
  // Expose this tree's Label names so Call MiniGame (and future goto pickers) can offer them as a dropdown.
  const treeLabels = React.useMemo(() => Array.from(new Set(collectLabelNames(value || []))), [value]);
  return (
    <div className="tree-editor">
      <NodeList nodes={value || []} onChange={onChange} rowProps={{ ...rowProps, treeLabels }} />
    </div>
  );
}

export default TreeEditor;
