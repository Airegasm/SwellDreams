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
// chosen from the tree's Labels (rowProps.treeLabels). The played exit sets [CharVar:GameResult]/
// [CharVar:GameWinner]; a bound exit jumps to its Label (placed AFTER this node), unbound falls through.
function CallMiniGameBlock({ node, setParams, rowProps = {} }) {
  const [games, setGames] = React.useState(null);
  React.useEffect(() => {
    fetch(`${API_BASE}/api/minigames`).then(r => r.json()).then(d => setGames(d?.games || [])).catch(() => setGames([]));
  }, []);
  // Card-baked games (character.miniGames via rowProps.cardGames) merge in behind the master
  // list, so an imported card's trees can pick its travelling games. Master wins on id ties —
  // same precedence the engine resolves with at runtime.
  const masterIds = new Set((games || []).map(g => g.id));
  const cardOnly = (rowProps.cardGames || []).filter(g => g && g.id && !masterIds.has(g.id));
  const allGames = [...(games || []), ...cardOnly];
  const gameId = node.params?.miniGameId || '';
  const game = allGames.find(g => g.id === gameId);
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
          {cardOnly.map(g => <option key={g.id} value={g.id}>{g.name} (card)</option>)}
        </select>
      </label>
      {gameId && !game && <div className="section-hint">⚠️ This minigame no longer exists in the library or on this card.</div>}
      {game && (
        <div className="tree-field">
          <span>On each exit, go to (optional; blank = fall through)</span>
          {exits.length === 0 && <div className="section-hint">No named exits — this game sets <code>[CharVar:GameResult]</code> only (e.g. dice = numeric total). Branch on it with conditions.</div>}
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
          <div className="section-hint">Sets <code>[CharVar:GameResult]</code>{game.competitive ? <> and <code>[CharVar:GameWinner]</code></> : null}. Goto targets must be Labels placed AFTER this node.</div>
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
// True when an ANCESTOR block is "once": children are then forced-once (checkbox shown checked +
// locked), since a once parent only runs its subtree a single time per session anyway.
const AncestorOnceContext = React.createContext(false);

const ADD_GROUPS = [
  {
    label: 'Actions', items: [
      { kind: 'action', type: '', label: 'Action…' },
      { kind: 'action', type: 'fire_tree', label: 'Fire Tree (library)' },
      { kind: 'action', type: 'end_intro', label: 'End Gated Intro' },
    ]
  },
  {
    label: 'Containers', items: [
      { kind: 'container', type: 'group', label: 'Group' },
      { kind: 'container', type: 'if', label: 'If / Else' },
      { kind: 'container', type: 'switch', label: 'Switch / Case' },
      { kind: 'container', type: 'player_choice', label: 'Player Choice' },
      { kind: 'container', type: 'choose_multi', label: 'Choose Multiple' },
      { kind: 'container', type: 'chance', label: 'Chance (%)' },
      { kind: 'container', type: 'random', label: 'Random (one of)' },
      { kind: 'container', type: 'keyword_gate', label: 'On Keyword' },
      { kind: 'container', type: 'repeat', label: 'Repeat / Loop' },
      { kind: 'container', type: 'pause_resume', label: 'Pause / Resume' },
      { kind: 'container', type: 'select_member', label: 'Select Member' },
      { kind: 'container', type: 'player_input', label: 'Player Input' },
      { kind: 'container', type: 'call_minigame', label: 'Call MiniGame' },
    ]
  },
  {
    label: 'Control', items: [
      { kind: 'action', type: 'label', label: 'Label (jump target)' },
      { kind: 'action', type: 'goto', label: 'Go To (jump)' },
      { kind: 'action', type: 'wait', label: 'Wait (spacer)' },
      { kind: 'action', type: 'next_button', label: 'Next Button (>> gate)' },
      { kind: 'action', type: 'cancel_current', label: 'Cancel Current (abort others)' },
      { kind: 'action', type: 'checkpoint_control', label: 'Checkpoint Control (groups on/off)' },
    ]
  },
];

const CONTROL_LEAF_TYPES = new Set(['label', 'goto', 'wait', 'next_button', 'cancel_current', 'checkpoint_control', 'fire_tree', 'fire_flow', 'call_minigame', 'end_intro']); // edited outside TriggerRow

// Range group keys for the Checkpoint Control dropdown (must mirror the backend's CHECKPOINT_RANGE_KEYS).
const CKPT_CONTROL_RANGES = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '100+'];

const NO_OPERAND_OPS = new Set(['empty', 'notEmpty']);
const HOLDS_CHILDREN = new Set(['group', 'chance', 'random', 'keyword_gate', 'keyword', 'repeat', 'pause_resume', 'select_member', 'player_input']); // not if/player_choice/choose_multi (special children)

function makeCond() { return { varType: 'flow', variable: '', operator: '==', value: '' }; }
function makeBranch(isElse = false) {
  return { id: rid('br'), kind: 'container', type: 'branch', params: isElse ? { else: true } : { match: 'all', conditions: [makeCond()] }, children: [] };
}
function makeChoice() { return { id: rid('ch'), kind: 'container', type: 'choice', params: { label: 'Option' }, children: [] }; }
function makeCase(isDefault = false) {
  return { id: rid('cs'), kind: 'container', type: 'case', params: isDefault ? { default: true } : { match: '' }, children: [] };
}

// Switch-value picks for the searchable dropdown: every system variable the backend resolves.
// Free text is equally valid — a bare name (no brackets) runs as [CharVar:name], so authors can
// switch on a CharVar that doesn't exist yet.
const SWITCH_VALUE_VARS = [
  { value: '[CharVar:GameResult]', label: 'Last MiniGame exit (Completed/Failed/…)' },
  { value: '[CharVar:GameWinner]', label: 'Last MiniGame winner' },
  { value: '[CharVar:GamePick]', label: "Player's pick in the last MiniGame" },
  { value: '[Capacity]', label: 'Player capacity %' },
  { value: '[CharCapacity]', label: 'Character capacity %' },
  { value: '[CharCapacity:[SelectedChar]]', label: "Selected member's capacity %" },
  { value: '[SelectedChar]', label: 'Selected member name' },
  { value: '[Pain]', label: 'Pain label (None…Excruciating)' },
  { value: '[Emotion]', label: 'Player disposition' },
  { value: '[PlayerIsInflating]', label: 'Player inflating (true/false)' },
  { value: '[Choice]', label: 'Last Player Choice label' },
  { value: '[PlayerInput:1]', label: 'Player Input row 1' },
  { value: '[Player]', label: 'Player name' },
  { value: '[Char]', label: 'Character name' },
  { value: '[Group]', label: 'Group member list' },
  { value: '[PumpType]', label: 'Pump type (electric/…)' },
  { value: '[PumpInit]', label: 'Pump init (auto/…)' },
  { value: '[BulbCurrent]', label: 'Bulb pump count' },
  { value: '[BikeCurrent]', label: 'Bike pump count' },
  { value: '[Roll]', label: 'Last dice total' },
  { value: '[Segment]', label: 'Last wheel segment' },
  { value: '[Slots]', label: 'Last slots symbols' },
  { value: '[Secs2Pct:5]', label: '% gained by 5 pump-seconds' },
];
function makeNode(kind, type) {
  // "once" (fire a single time per session) defaults ON for new nodes — trees re-run every reply turn
  // while a scope is active, so without it a node re-fires each turn. Excludes pure control-flow
  // markers (label/goto), where a one-time skip would break loops/redirects on re-run.
  const node = { id: rid(), kind, type, once: type !== 'label' && type !== 'goto', params: {} };
  if (kind === 'container' || kind === 'event') node.children = [];
  if (type === 'if') node.children = [makeBranch(false)];
  if (type === 'switch') { node.params.value = ''; node.children = [makeCase(false), makeCase(true)]; }
  if (type === 'player_choice' || type === 'choose_multi') node.children = [makeChoice()];
  if (type === 'player_input') node.params.rows = [{ id: rid('pir'), label: '', type: 'num', min: 0, max: 100, def: '' }]; // one row by default
  if (type === 'chance') node.params.chance = 50;
  if (type === 'repeat') { node.params.mode = 'fixed'; node.params.iterations = 3; }
  if (type === 'pause_resume') { node.params.resumeAfterValue = 4; } // reply turns — the only unit the backend implements (resumeAfterType was vestigial)
  if (type === 'keyword_gate' || type === 'keyword') node.params.keys = [];
  if (type === 'label' || type === 'goto') node.params.name = '';
  if (type === 'wait') node.params.messages = 2;
  if (type === 'checkpoint_control') { node.params.mode = 'off'; node.params.target = 'all'; }
  if (type === 'fire_tree') node.params.treeId = '';
  if (type === 'fire_flow') { node.params.flowId = ''; node.params.flowActionLabel = ''; }
  if (type === 'call_minigame') { node.params.miniGameId = ''; node.params.exitGotos = {}; }
  if (type === 'end_intro') node.params.loadProfileId = '';
  return node;
}

// Deep-duplicate a node: fresh ids all the way down (REQUIRED — 'once' memory is keyed per node id,
// so a shared id would make the copy count as already-fired the moment the original fires).
function cloneNodeDeep(n) {
  const c = { ...n, id: rid() };
  if (n.params) c.params = JSON.parse(JSON.stringify(n.params));
  if (Array.isArray(n.children)) c.children = n.children.map(cloneNodeDeep);
  return c;
}

// One-row summary shown when a node is collapsed.
function summarize(node) {
  const t = node.type;
  const p = node.params || {};
  if (node.kind === 'action') {
    if (!t) return '(choose action…)';
    if (t === 'label') return `Label: ${p.name || '(unnamed)'}`;
    if (t === 'goto') return `Go to: ${p.name || '(unset)'}`;
    if (t === 'wait') return `Wait ${p.messages ?? 1} message(s)`;
    if (t === 'next_button') return 'Next Button — hold for >>';
    if (t === 'cancel_current') return 'Cancel Current — abort other running triggers';
    if (t === 'checkpoint_control') return `Checkpoints ${p.mode === 'on' ? 'ON' : 'OFF'}: ${!p.target || p.target === 'all' ? 'All groups' : p.target === 'events' ? 'Event Triggers' : `Range ${p.target}%`}`;
    if (t === 'fire_tree') return `Fire Tree: ${p.treeId || '(unset)'}`;
    if (t === 'fire_flow') return `Fire Flow: ${p.flowId || '(unset)'}${p.flowActionLabel ? ' › ' + p.flowActionLabel : ''}`;
    if (t === 'call_minigame') return `Call MiniGame${p.miniGameId ? '' : ' (unset)'}${Object.values(p.exitGotos || {}).filter(Boolean).length ? ` · ${Object.values(p.exitGotos).filter(Boolean).length} goto(s)` : ''}`;
    if (t === 'end_intro') return `End Gated Intro${p.manualRelease ? ' (GO! gate)' : ''}${p.loadProfileId ? ' → load profile' : ' → default'}`;
    if (t === 'ai_message') return `Message${p.llmEnhance === false ? ' (verbatim)' : ''}: ${(p.context || '').slice(0, 48) || '(empty)'}`;
    if (t === 'toast') return `Toast (${p.preset || 'midnight'}): ${(p.text || '').split('\n')[0].slice(0, 40) || '(empty)'}`;
    if (t === 'pump_on') return p.durationMode === 'percent' ? `Primary Pump ON · +${p.duration || '?'}% capacity` : `Primary Pump ON${p.duration ? ` · ${p.duration}s` : ' · latch'}`;
    if (t === 'pump_off') return 'Primary Pump OFF';
    if (t === 'custom_device') return `Custom Device "${p.deviceName || '?'}" ${p.mode === 'off' ? 'OFF' : p.mode === 'timed' ? `ON ${p.seconds || '?'}s` : 'ON'}`;
    if (t === 'flow_var' || t === 'set_variable') return `Set ${p.varType === 'system' ? 'System' : 'CharVar'} ${p.variable || '?'} ${p.operation || 'set'} ${p.value ?? ''}`;
    return t;
  }
  if (t === 'group') return `Group · ${(node.children || []).length} item(s)`;
  if (t === 'if') return `If / Else · ${(node.children || []).filter(b => b && b.type === 'branch').length} branch(es)`;
  if (t === 'switch') return `Switch on ${p.value || '(unset)'} · ${(node.children || []).filter(c => c && c.type === 'case').length} case(s)`;
  if (t === 'player_choice') return `Player Choice · ${(node.children || []).filter(c => c && c.type === 'choice').length} option(s)`;
  if (t === 'choose_multi') return `Choose Multiple · ${(node.children || []).filter(c => c && c.type === 'choice').length} option(s)`;
  if (t === 'chance') return `Chance ${p.chance ?? 0}%`;
  if (t === 'random') return `Random — one of ${(node.children || []).length}`;
  if (t === 'repeat') return p.mode === 'until' ? `Repeat until ${p.condition?.variable || '?'} ${p.condition?.operator || ''} ${p.condition?.value ?? ''}` : `Repeat ×${p.iterations ?? 1}`;
  if (t === 'pause_resume') return `Pause · resume after ${p.resumeAfterValue ?? 4} turn(s)`;
  if (t === 'select_member') return `Select Member · ${p.pumpableOnly ? 'pumpable only' : 'all members'} → [SelectedChar]`;
  if (t === 'player_input') return `Player Input · ${(p.rows || []).length} row(s) → [PlayerInput:#]`;
  if (t === 'keyword_gate' || t === 'keyword') {
    const who = (p.speaker === 'char' || p.speaker === 'character') ? 'char' : p.speaker === 'either' ? 'either' : 'player';
    return `On Keyword (${who}): ${(p.keys || []).join(', ') || '(none)'}`;
  }
  return t;
}

// Add-block dropdown.
function AddMenu({ onAdd, small }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const groups = query
    ? ADD_GROUPS.map(g => ({ ...g, items: g.items.filter(it => it.label.toLowerCase().includes(query)) })).filter(g => g.items.length)
    : ADD_GROUPS;
  const close = () => { setOpen(false); setQ(''); };
  return (
    <div className={`tree-add ${small ? 'tree-add-sm' : ''}`}>
      <button type="button" className="tree-add-btn" onClick={() => setOpen(o => !o)}>+ Add block</button>
      {open && (
        <div className="tree-add-menu" onMouseLeave={close}>
          <input type="text" className="tree-add-search" value={q} autoFocus
            onChange={(e) => setQ(e.target.value)} placeholder="Filter blocks…"
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }} />
          {groups.map(g => (
            <div key={g.label} className="tree-add-group">
              <div className="tree-add-group-label">{g.label}</div>
              {g.items.map(it => (
                <button key={it.type || 'action'} type="button" className="tree-add-item"
                  onClick={() => { onAdd(makeNode(it.kind, it.type)); close(); }}>{it.label}</button>
              ))}
            </div>
          ))}
          {!groups.length && <div className="tree-add-group-label" style={{ opacity: 0.6, padding: '6px 8px' }}>No matches</div>}
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
        <option value="flow">CharVar</option>
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
        <input type="text" value={cond.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="value or [CharVar:x]" />
      )}
      <button type="button" className="tree-x" onClick={onRemove} title="Remove condition">×</button>
    </div>
  );
}

// A branch within an 'if'. Header (If / Else if / Else) + conditions + a nested child list.
function BranchBlock({ branch, index, isLast, onChange, onRemove, onDuplicate, rowProps }) {
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
        {!isElse && onDuplicate && <button type="button" className="tree-x" onClick={onDuplicate} title="Duplicate this branch (conditions + contents)">⧉</button>}
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
          onDuplicate={() => setBranches([...branches.slice(0, i + 1), cloneNodeDeep(b), ...branches.slice(i + 1)])}
          rowProps={rowProps} />
      ))}
      <div className="tree-if-controls">
        <button type="button" className="tree-mini" onClick={addElseIf}>+ Else if</button>
        {!hasElse && <button type="button" className="tree-mini" onClick={() => setBranches([...branches, makeBranch(true)])}>+ Else</button>}
      </div>
    </div>
  );
}

// One case within a 'switch': a match value (or Default) + its body.
function CaseBlock({ caseNode, onChange, onRemove, onDuplicate, rowProps }) {
  const isDefault = caseNode.params?.default === true;
  return (
    <div className="tree-branch">
      <div className="tree-branch-head">
        <span className="tree-branch-label">{isDefault ? 'Default' : 'Case'}</span>
        {!isDefault && (
          <input type="text" value={caseNode.params?.match ?? ''} placeholder="value to match (substitutions ok)"
            onChange={(e) => onChange({ ...caseNode, params: { ...(caseNode.params || {}), match: e.target.value } })} style={{ flex: 1 }} />
        )}
        {!isDefault && onDuplicate && <button type="button" className="tree-x" onClick={onDuplicate} title="Duplicate this case (match + contents)">⧉</button>}
        <button type="button" className="tree-x" onClick={onRemove} title="Remove case">×</button>
      </div>
      <div className="tree-branch-body">
        <NodeList nodes={caseNode.children || []} onChange={(next) => onChange({ ...caseNode, children: next })} rowProps={rowProps} />
      </div>
    </div>
  );
}

// The 'switch' body: the value to switch on (searchable system-variable dropdown that also takes
// free text — a bare name runs as [CharVar:name]) + ordered cases + an optional Default.
function SwitchBlock({ node, onChange, rowProps }) {
  const cases = (node.children || []).filter(c => c && c.type === 'case');
  const hasDefault = cases.some(c => c.params?.default === true);
  const setCases = (next) => onChange({ ...node, children: next });
  const listId = `tree-switch-vars-${node.id}`;
  return (
    <div className="tree-if">
      <label className="tree-field">
        <span>Switch on</span>
        <input type="text" list={listId} value={node.params?.value || ''}
          onChange={(e) => onChange({ ...node, params: { ...(node.params || {}), value: e.target.value } })}
          placeholder="pick a system variable, or type a CharVar name" />
        <datalist id={listId}>
          {SWITCH_VALUE_VARS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </datalist>
      </label>
      <div className="tree-hint">First matching case wins (numbers compare numerically, text case-insensitively). A bare name like <code>MyVar</code> reads [CharVar:MyVar] — fine if it's only set later; unset values fall to Default.</div>
      {cases.map((c, i) => (
        <CaseBlock key={c.id || i} caseNode={c}
          onChange={(u) => setCases(cases.map((x, idx) => idx === i ? u : x))}
          onRemove={() => setCases(cases.filter((_, idx) => idx !== i))}
          onDuplicate={() => setCases([...cases.slice(0, i + 1), cloneNodeDeep(c), ...cases.slice(i + 1)])}
          rowProps={rowProps} />
      ))}
      <div className="tree-if-controls">
        <button type="button" className="tree-mini" onClick={() => {
          // Keep an existing Default visually last (execution finds it anywhere, but last reads right).
          const defIdx = cases.findIndex(c => c.params?.default === true);
          if (defIdx === -1) return setCases([...cases, makeCase(false)]);
          const a = [...cases];
          a.splice(defIdx, 0, makeCase(false));
          setCases(a);
        }}>+ Case</button>
        {!hasDefault && <button type="button" className="tree-mini" onClick={() => setCases([...cases, makeCase(true)])}>+ Default</button>}
      </div>
    </div>
  );
}

// One option within a player_choice: a label + its body (the subtree run when picked).
function ChoiceBlock({ choice, onChange, onRemove, onDuplicate, rowProps }) {
  return (
    <div className="tree-branch">
      <div className="tree-branch-head">
        <span className="tree-branch-label">Option</span>
        <input type="text" value={choice.params?.label || ''} onChange={(e) => onChange({ ...choice, params: { ...(choice.params || {}), label: e.target.value } })} placeholder="button label" style={{ flex: 1 }} />
        {onDuplicate && <button type="button" className="tree-x" onClick={onDuplicate} title="Duplicate this option (label + contents)">⧉</button>}
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
          onDuplicate={choices.length < max ? () => setChoices([...choices.slice(0, i + 1), cloneNodeDeep(c), ...choices.slice(i + 1)]) : undefined}
          rowProps={rowProps} />
      ))}
      {choices.length < max && <button type="button" className="tree-mini" onClick={() => setChoices([...choices, makeChoice()])}>+ Option</button>}
    </div>
  );
}

// Per-node body: the type-specific param editor + (for containers) a nested child list.
// Comma-separated keyword input that keeps the RAW text locally so typing a space/comma doesn't get
// re-split/trimmed mid-edit (which reset the caret to the start — "spacebar doesn't work"). The keys[]
// array is derived on change; local text is re-seeded only on remount (i.e. switching nodes).
function KeywordsInput({ value, onChange, placeholder }) {
  const [text, setText] = React.useState(() => (value || []).join(', '));
  return (
    <input type="text" value={text} placeholder={placeholder}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean)); }} />
  );
}

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
  if (t === 'wait') {
    return (
      <label className="tree-field tree-field-inline">
        <span>Wait this many chat messages, then continue</span>
        <input type="number" min={1} value={node.params?.messages ?? 1}
          onChange={(e) => setParams({ messages: Math.max(1, parseInt(e.target.value) || 1) })} style={{ width: 70 }} />
      </label>
    );
  }
  if (t === 'next_button') {
    return (
      <p className="section-hint">
        Forces a <strong>&gt;&gt;</strong> (Next) hold at this point — everything after this block waits
        until the player presses Next. Same button the tree uses automatically between back-to-back
        generated messages; this places one anywhere you want a pause.
      </p>
    );
  }
  if (t === 'cancel_current') {
    return (
      <p className="section-hint">
        Aborts every <strong>other</strong> running trigger tree and checkpoint sequence, and closes
        their popups and gates (Player Choice, Player Input, Select Member, MiniGame, &gt;&gt;/await/Fire%).
        This tree keeps running — place it as the <strong>first block</strong> so the tree claims the
        session before doing its work.
      </p>
    );
  }
  if (t === 'checkpoint_control') {
    return (
      <div className="tree-params">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" name={`ckc-${node.id}`} checked={node.params?.mode !== 'on'} onChange={() => setParams({ mode: 'off' })} /> Off
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="radio" name={`ckc-${node.id}`} checked={node.params?.mode === 'on'} onChange={() => setParams({ mode: 'on' })} /> On
          </label>
          <select value={node.params?.target || 'all'} onChange={(e) => setParams({ target: e.target.value })}>
            <option value="all">All (every range group + events)</option>
            <option value="events">Event Triggers group</option>
            {CKPT_CONTROL_RANGES.map(k => <option key={k} value={k}>Range {k}%</option>)}
          </select>
        </div>
        <p className="section-hint">
          Session-scoped override on top of the card's saved group toggles — lasts until the session
          resets. Turning a group OFF also drops any await/Fire% sequence it left pending. Use it from a
          long-running tree (e.g. an endgame) to silence range checkpoints and event triggers — or to
          re-enable a group the card ships disabled.
        </p>
      </div>
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
  if (t === 'switch') return <SwitchBlock node={node} onChange={onChange} rowProps={rowProps} />;
  if (t === 'player_choice') return <PlayerChoiceBlock node={node} onChange={onChange} rowProps={rowProps} />;
  if (t === 'choose_multi') return <PlayerChoiceBlock node={node} onChange={onChange} rowProps={rowProps} max={8} />;

  // Keyword params shared by keyword_gate (container) and keyword (event).
  const keywordParams = (t === 'keyword_gate' || t === 'keyword') && (
    <div className="tree-params">
      <label className="tree-field">
        <span>Keywords (any of, comma-separated)</span>
        <KeywordsInput value={node.params?.keys} onChange={(keys) => setParams({ keys })} placeholder="e.g. balloon, inflate" />
      </label>
      <label className="tree-field tree-field-inline">
        <span>Who says it</span>
        <select value={node.params?.speaker || 'player'} onChange={(e) => setParams({ speaker: e.target.value })} title="Whose message the keyword must appear in">
          <option value="player">Player</option>
          <option value="char">Character</option>
          <option value="either">Either</option>
        </select>
      </label>
      <label className="tree-field">
        <span>AND also requires (any of, comma-separated — optional)</span>
        <KeywordsInput value={node.params?.secondaryKeys}
          onChange={(secondaryKeys) => setParams({ secondaryKeys, logic: (secondaryKeys || []).length ? 'and_any' : undefined })}
          placeholder="e.g. yes, please — message must contain a keyword AND one of these" />
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

  const selectMemberParams = t === 'select_member' && (
    <div className="tree-params">
      <label className="tree-field">
        <span>Prompt (shown in the popup)</span>
        <input type="text" value={node.params?.prompt || ''} onChange={(e) => setParams({ prompt: e.target.value })}
          placeholder="e.g. Who gets pumped?" />
      </label>
      <label className="tree-field tree-field-inline" title="Only list members marked as valid inflation targets">
        <input type="checkbox" checked={!!node.params?.pumpableOnly} onChange={(e) => setParams({ pumpableOnly: e.target.checked })} />
        <span>Pumpable members only</span>
      </label>
      <div className="tree-hint">
        Group mode only: pops up a member picker. OK stores the pick in [SelectedChar] and runs the body below;
        Cancel aborts the whole tree. [SelectedChar] resets to the base character at the start of every tree run.
      </div>
    </div>
  );

  const playerInputParams = t === 'player_input' && (() => {
    const rows = node.params?.rows || [];
    const setRows = (next) => setParams({ rows: next });
    const upd = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };
    return (
      <div className="tree-params">
        {rows.map((r, i) => (
          <div key={r.id || i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ opacity: 0.7, minWidth: 20 }}>#{i + 1}</span>
            <input type="text" value={r.label || ''} onChange={(e) => upd(i, { label: e.target.value })}
              placeholder={`Label for row ${i + 1}…`} style={{ flex: 1, minWidth: 110 }} />
            <select value={r.type === 'text' ? 'text' : 'num'} onChange={(e) => upd(i, { type: e.target.value })} title="Input type">
              <option value="num">Numbox</option>
              <option value="text">Text</option>
            </select>
            {r.type !== 'text' ? (
              <>
                <label className="tree-field tree-field-inline"><span>min</span><input type="number" value={r.min ?? 0} onChange={(e) => upd(i, { min: parseInt(e.target.value, 10) || 0 })} style={{ width: 58 }} /></label>
                <label className="tree-field tree-field-inline"><span>max</span><input type="number" value={r.max ?? 100} onChange={(e) => upd(i, { max: parseInt(e.target.value, 10) || 0 })} style={{ width: 58 }} /></label>
                <label className="tree-field tree-field-inline"><span>default</span><input type="number" value={r.def ?? ''} onChange={(e) => upd(i, { def: e.target.value === '' ? '' : parseInt(e.target.value, 10) || 0 })} placeholder="—" style={{ width: 62 }} title="Optional — blank leaves the field empty (min used if OK'd empty)" /></label>
              </>
            ) : (
              <input type="text" value={r.def ?? ''} onChange={(e) => upd(i, { def: e.target.value })}
                placeholder="Default text (optional)…" style={{ flex: 1, minWidth: 100 }} />
            )}
            <label className="tree-field tree-field-inline" title="Also write this row's value into a named CharVar on OK">
              <input type="checkbox" checked={!!r.storeVar} onChange={(e) => upd(i, { storeVar: e.target.checked })} />
              <span>Store as CharVar</span>
            </label>
            {r.storeVar && (
              <input type="text" value={r.varName || ''} onChange={(e) => upd(i, { varName: e.target.value })}
                placeholder="variable name" style={{ width: 100 }} title="CharVar to receive this row's value ([CharVar:<name>])" />
            )}
            <button type="button" className="tnode-ctrl" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">▲</button>
            <button type="button" className="tnode-ctrl" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down">▼</button>
            <button type="button" className="tnode-ctrl" onClick={() => setRows([...rows.slice(0, i + 1), { ...r, id: rid('pir') }, ...rows.slice(i + 1)])} title="Duplicate this row">⧉</button>
            <button type="button" className="ci-del" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} title="Remove row">×</button>
          </div>
        ))}
        <button type="button" className="prereq-add-sm" onClick={() => setRows([...rows, { id: rid('pir'), label: '', type: 'num', min: 0, max: 100, def: '' }])}>+ Row</button>
        <div className="tree-hint">
          Pops up a form for the player. Each row's value is stored as <strong>[PlayerInput:Row#]</strong> ([PlayerInput:1], [PlayerInput:2], …),
          plus any "Store as CharVar" name you set. OK runs the body below; Cancel aborts the whole tree.
        </div>
      </div>
    );
  })();

  return (
    <div className="tree-container-body">
      {chanceParams}
      {repeatParams}
      {pauseParams}
      {selectMemberParams}
      {playerInputParams}
      {keywordParams}
      {HOLDS_CHILDREN.has(t) && (
        <NodeList nodes={node.children || []} onChange={(next) => onChange({ ...node, children: next })} rowProps={rowProps} />
      )}
    </div>
  );
}

// One node row: header (collapse, type/summary, once, move, delete) + body.
// Inline misconfiguration check — mirrors what the backend walker would skip/warn on at runtime,
// so a broken node is red-flagged while AUTHORING instead of silently no-oping mid-session.
function validateNode(node, rowProps) {
  const p = node.params || {};
  if (node.type === 'goto') {
    if (!p.name) return 'Go To has no label name';
    if (Array.isArray(rowProps?.treeLabels) && !rowProps.treeLabels.includes(p.name)) return `no Label named "${p.name}" in this tree`;
  }
  if (node.type === 'label' && !p.name) return 'Label is unnamed — a Go To can never target it';
  if (node.type === 'fire_tree' && !p.treeId) return 'Fire Tree has no target tree';
  if (node.type === 'call_minigame' && !p.miniGameId) return 'Call MiniGame has no game selected';
  if (node.type === 'player_input' && !(p.rows || []).length) return 'no input rows — the popup will be skipped';
  if (node.type === 'player_choice' || node.type === 'choose_multi') {
    const opts = (node.children || []).filter(c => c && c.type === 'choice' && c.params?.label);
    if (!opts.length) return 'no options with labels — the choice will be skipped';
  }
  if (node.type === 'keyword_gate' && !(p.keys || []).length) return 'no keywords — the gate can never open';
  if (node.type === 'if') {
    const passable = (node.children || []).some(b => b && b.type === 'branch' && (b.params?.else === true || (b.params?.conditions || []).length));
    if (!passable) return 'no passable branch (add conditions or an Else)';
  }
  return null;
}

// Collapse/expand-all broadcast: TreeEditor bumps {n, open}; every NodeRow follows it.
const CollapseSignalContext = React.createContext(null);

function NodeRow({ node, onChange, onRemove, onMoveUp, onMoveDown, onDuplicate, rowProps }) {
  const [open, setOpen] = useState(node.kind === 'action' ? true : true);
  const collapseSig = React.useContext(CollapseSignalContext);
  React.useEffect(() => { if (collapseSig) setOpen(collapseSig.open); }, [collapseSig]);
  const isContainer = node.kind !== 'action';
  const ancestorOnce = React.useContext(AncestorOnceContext); // a parent block is "once" → force this one once
  const effectiveOnce = ancestorOnce || !!node.once;
  const warn = validateNode(node, rowProps);
  return (
    <div className={`tree-node tree-node-${node.kind}`}>
      <div className="tree-node-head">
        <button type="button" className="tree-collapse" onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
        <span className="tree-node-kind">{node.kind === 'action' ? 'Action' : node.kind === 'event' ? 'Event' : 'Block'}</span>
        {warn && <span className="tree-node-warn" title={warn}>⚠ {warn}</span>}
        {!open && <span className="tree-node-summary">{summarize(node)}</span>}
        <span className="tree-node-spacer" />
        <label className="tree-once" title={ancestorOnce ? 'Locked once — a parent block is set to Once, so everything inside it runs once' : 'Fire only once per session'}><input type="checkbox" checked={effectiveOnce} disabled={ancestorOnce} onChange={(e) => onChange({ ...node, once: e.target.checked })} /> once</label>
        {onDuplicate && <button type="button" className="tnode-ctrl" onClick={onDuplicate} title="Duplicate this block (with everything inside it; fresh once-memory)">⧉</button>}
        <button type="button" className="tnode-ctrl" onClick={onMoveUp} title="Move up">↑</button>
        <button type="button" className="tnode-ctrl" onClick={onMoveDown} title="Move down">↓</button>
        <button type="button" className="tnode-ctrl tnode-del" onClick={onRemove} title="Remove">×</button>
      </div>
      {open && (
        <div className="tree-node-body">
          <AncestorOnceContext.Provider value={effectiveOnce}>
            <NodeBody node={node} onChange={onChange} rowProps={rowProps} />
          </AncestorOnceContext.Provider>
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
  const duplicate = (i) => onChange([...list.slice(0, i + 1), cloneNodeDeep(list[i]), ...list.slice(i + 1)]);
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
          onMoveUp={() => move(i, -1)} onMoveDown={() => move(i, 1)}
          onDuplicate={() => duplicate(i)} rowProps={rowProps} />
      ))}
      <AddMenu small={list.length > 0} onAdd={(n) => onChange([...list, n])} />
    </div>
  );
}

// Public entry: edits a flat node array (a tree's `nodes`). `value` = nodes[], `onChange(nodes)`.
function TreeEditor({ value, onChange, ...rowProps }) {
  // Expose this tree's Label names so Call MiniGame (and future goto pickers) can offer them as a dropdown.
  const treeLabels = React.useMemo(() => Array.from(new Set(collectLabelNames(value || []))), [value]);
  const [collapseSig, setCollapseSig] = useState(null); // {n, open} — bump n so the effect re-fires
  const hasNodes = Array.isArray(value) && value.length > 0;
  return (
    <div className="tree-editor">
      {hasNodes && (
        <div className="tree-editor-toolbar">
          <button type="button" className="tree-mini" onClick={() => setCollapseSig(s => ({ n: (s?.n || 0) + 1, open: false }))}>Collapse all</button>
          <button type="button" className="tree-mini" onClick={() => setCollapseSig(s => ({ n: (s?.n || 0) + 1, open: true }))}>Expand all</button>
        </div>
      )}
      <CollapseSignalContext.Provider value={collapseSig}>
        <NodeList nodes={value || []} onChange={onChange} rowProps={{ ...rowProps, treeLabels }} />
      </CollapseSignalContext.Provider>
    </div>
  );
}

export default TreeEditor;
