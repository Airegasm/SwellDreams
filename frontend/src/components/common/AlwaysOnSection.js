import React from 'react';
import ScopeTreeSection from './ScopeTreeSection';

// Always-On as a multi-trigger section (like Event Triggers): zero or more always-on scripts,
// each its own trigger-tree, all running every reply. Replaces the old single ScopeTreeSection.
// Backward compatible: a legacy single ref ({inline}/{treeId}) is shown as one entry; onChange
// always emits an ARRAY (the backend runActiveAlwaysOn accepts single OR array).
function AlwaysOnSection({ value, onChange, source = 'from card', rowProps = {} }) {
  const list = Array.isArray(value) ? value : (value && (value.inline || value.treeId) ? [value] : []);
  const update = (i, r) => onChange(list.map((x, idx) => (idx === i ? r : x)));
  const add = () => onChange([...list, {}]);
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));

  return (
    <div className="always-on-section">
      {list.length === 0 && (
        <p className="section-hint" style={{ marginTop: 0 }}>No always-on scripts yet — add one to run a trigger tree every reply.</p>
      )}
      {list.map((ref, i) => (
        <div key={i} className="always-on-entry" style={{ border: '1px solid var(--border-color, #444)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong style={{ fontSize: '0.85rem' }}>Always-On #{i + 1}</strong>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(i)}>Remove</button>
          </div>
          <ScopeTreeSection label="" hint="" refValue={ref} onChange={(r) => update(i, r)}
            defaultName={`Always On ${i + 1}`} source={source} rowProps={rowProps} />
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-primary" onClick={add}>+ Add Always-On Script</button>
    </div>
  );
}

export default AlwaysOnSection;
