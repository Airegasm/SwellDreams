import React, { useState, useEffect } from 'react';
import TreeEditor from './TreeEditor';
import { useApp } from '../../context/AppContext';

// One card scope bound to a Trigger Tree ref — {inline:{id,name,nodes}} OR {treeId} (a global
// library link) — with Assign-from-Library / Fork-to-local / Save-to-Library affordances.
// refValue = the current ref object (may carry sibling flags like overrideWelcome — the caller's
// onChange is responsible for preserving those). onChange(nextRef) receives {inline} | {treeId}.

// Default hard rules pre-populated into a card's Intro instructions box (editable per card).
export const DEFAULT_INTRO_RULES = "DO NOT turn on or operate any pumps yet — no [pump on], and don't instruct the player to pump. Set the scene and converse toward the intro's goal; this gated phase ends only when its End Gated Intro trigger fires.";

const rid = (p = 'n') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Deep-copy a node array with FRESH ids (goto/label pairing is by params.name, so it survives).
function remapIds(nodes) {
  return (nodes || []).map(n => ({ ...n, id: rid(), children: n.children ? remapIds(n.children) : n.children }));
}

function ScopeTreeSection({ label, hint, refValue, onChange, defaultName = 'Script', source = 'from card', rowProps = {} }) {
  const { api } = useApp();
  const [trees, setTrees] = useState([]);
  const refetch = () => api.getTriggerTrees().then(d => setTrees(d?.trees || [])).catch(() => {});
  useEffect(() => { refetch(); }, [api]);

  const ref = refValue || {};
  const linkedId = ref.treeId;
  const linkedTree = linkedId ? trees.find(t => t.id === linkedId) : null;

  const setInlineNodes = (nodes) => onChange({ inline: { id: ref.inline?.id || rid('tree'), name: ref.inline?.name || defaultName, nodes } });

  const assign = (treeId) => {
    if (!treeId) { if (linkedId) onChange({ inline: { id: rid('tree'), name: defaultName, nodes: [] } }); return; }
    if (ref.inline?.nodes?.length && !window.confirm('Replace the local tree with a library link? (your local nodes will be detached)')) return;
    onChange({ treeId });
  };
  const fork = () => {
    const t = trees.find(x => x.id === linkedId);
    if (!t) return;
    onChange({ inline: { id: rid('tree'), name: `${t.name} (local)`, nodes: remapIds(t.nodes || []) } });
  };
  const promote = async () => {
    const nodes = ref.inline?.nodes || [];
    if (!nodes.length) return;
    const name = window.prompt('Save this tree to the global library as:', ref.inline?.name || defaultName);
    if (!name) return;
    try {
      const created = await api.createTriggerTree(name, remapIds(nodes), '', source);
      if (created?.id) { await refetch(); onChange({ treeId: created.id }); }
    } catch (e) { console.error('Promote to library failed', e); }
  };

  return (
    <div className="scope-tree-section">
      <div className="rte-head"><strong>{label}</strong> {hint && <span className="section-hint">{hint}</span>}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0' }}>
        <select value={linkedId || ''} onChange={(e) => assign(e.target.value)} title="Inline, or link a global library tree">
          <option value="">— inline (local copy) —</option>
          {trees.map(t => <option key={t.id} value={t.id}>{t.name}{t.builtIn ? ' (built-in)' : ''}</option>)}
        </select>
        {linkedId && <button type="button" className="btn btn-sm btn-secondary" onClick={fork} title="Detach a local editable copy">Fork to local</button>}
        {!linkedId && (ref.inline?.nodes?.length > 0) && <button type="button" className="btn btn-sm btn-secondary" onClick={promote} title="Promote this local tree to the global library">Save to Library</button>}
      </div>
      {linkedId ? (
        <div className="section-hint" style={{ padding: '6px 0' }}>
          🔗 Linked to library tree “{linkedTree?.name || linkedId}” — edits in the Trigger Library apply everywhere it's used. Fork to local to customise just this card.
        </div>
      ) : (
        <TreeEditor value={ref.inline?.nodes || []} onChange={setInlineNodes} {...rowProps} />
      )}
    </div>
  );
}

export default ScopeTreeSection;
