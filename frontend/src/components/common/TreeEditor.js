import React, { useState } from 'react';
import TriggerRow from './TriggerRow';
import './TreeEditor.css';

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
      { kind: 'container', type: 'chance', label: 'Chance (%)' },
      { kind: 'container', type: 'random', label: 'Random (one of)' },
      { kind: 'container', type: 'keyword_gate', label: 'Keyword Gate' },
    ]
  },
  {
    label: 'Events', items: [
      { kind: 'event', type: 'keyword', label: 'On Player Keyword' },
    ]
  },
  {
    label: 'Actions', items: [
      { kind: 'action', type: '', label: 'Action…' },
    ]
  },
];

const NO_OPERAND_OPS = new Set(['empty', 'notEmpty']);
const HOLDS_CHILDREN = new Set(['group', 'chance', 'random', 'keyword_gate', 'keyword']); // not 'if' (children are branches)

function makeCond() { return { varType: 'flow', variable: '', operator: '==', value: '' }; }
function makeBranch(isElse = false) {
  return { id: rid('br'), kind: 'container', type: 'branch', params: isElse ? { else: true } : { match: 'all', conditions: [makeCond()] }, children: [] };
}
function makeNode(kind, type) {
  const node = { id: rid(), kind, type, params: {} };
  if (kind === 'container' || kind === 'event') node.children = [];
  if (type === 'if') node.children = [makeBranch(false)];
  if (type === 'chance') node.params.chance = 50;
  if (type === 'keyword_gate' || type === 'keyword') node.params.keys = [];
  return node;
}

// One-row summary shown when a node is collapsed.
function summarize(node) {
  const t = node.type;
  const p = node.params || {};
  if (node.kind === 'action') {
    if (!t) return '(choose action…)';
    if (t === 'ai_message') return `Message${p.llmEnhance === false ? ' (verbatim)' : ''}: ${(p.context || '').slice(0, 48) || '(empty)'}`;
    if (t === 'flow_var' || t === 'set_variable') return `Set ${p.varType === 'system' ? 'System' : 'Flow'} ${p.variable || '?'} ${p.operation || 'set'} ${p.value ?? ''}`;
    return t;
  }
  if (t === 'group') return `Group · ${(node.children || []).length} item(s)`;
  if (t === 'if') return `If / Else · ${(node.children || []).filter(b => b && b.type === 'branch').length} branch(es)`;
  if (t === 'chance') return `Chance ${p.chance ?? 0}%`;
  if (t === 'random') return `Random — one of ${(node.children || []).length}`;
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

// Per-node body: the type-specific param editor + (for containers) a nested child list.
function NodeBody({ node, onChange, rowProps }) {
  const t = node.type;
  const setParams = (patch) => onChange({ ...node, params: { ...(node.params || {}), ...patch } });

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

  return (
    <div className="tree-container-body">
      {chanceParams}
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
  return (
    <div className="tree-editor">
      <NodeList nodes={value || []} onChange={onChange} rowProps={rowProps} />
    </div>
  );
}

export default TreeEditor;
