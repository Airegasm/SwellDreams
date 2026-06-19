import React, { useState } from 'react';
import './CollapsibleSection.css';

// Clean accordion section: a click-to-toggle header (chevron + title + optional subtitle/badge)
// over a body that only renders when open. Used to organise the checkpoint/scope editors.
// Uncontrolled by default; pass `open` + `onToggle` to control it externally (e.g. a Show/Hide-All).
function CollapsibleSection({ title, subtitle, badge, defaultOpen = false, accent, open: openProp, onToggle, children }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const toggle = () => { if (controlled) onToggle && onToggle(!open); else setInternalOpen(o => !o); };
  return (
    <div className={`csec ${open ? 'csec-open' : ''}`} style={accent ? { borderLeftColor: accent } : undefined}>
      <button type="button" className="csec-header" onClick={toggle}>
        <span className="csec-chevron">{open ? '▾' : '▸'}</span>
        <span className="csec-title">{title}</span>
        {subtitle && <span className="csec-sub">{subtitle}</span>}
        {badge != null && badge !== '' && <span className="csec-badge">{badge}</span>}
      </button>
      {open && <div className="csec-body">{children}</div>}
    </div>
  );
}

export default CollapsibleSection;
