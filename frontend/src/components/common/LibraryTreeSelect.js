import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

// Minimal picker over the global Trigger Tree library — used where a feature fires a named
// library tree by id (e.g. a button's "Run Trigger Tree" action).
function LibraryTreeSelect({ value, onChange }) {
  const { api } = useApp();
  const [trees, setTrees] = useState([]);
  useEffect(() => { api.getTriggerTrees().then(d => setTrees(d?.trees || [])).catch(() => {}); }, [api]);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select Library Tree...</option>
      {trees.map(t => <option key={t.id} value={t.id}>{t.name}{t.builtIn ? ' (built-in)' : ''}</option>)}
    </select>
  );
}

export default LibraryTreeSelect;
