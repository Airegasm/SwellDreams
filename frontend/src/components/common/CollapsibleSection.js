import React, { useState } from 'react';
import './CollapsibleSection.css';

// Clean accordion section: a click-to-toggle header (chevron + title + optional subtitle/badge)
// over a body that only renders when open. Used to organise the checkpoint/scope editors.
function CollapsibleSection({ title, subtitle, badge, defaultOpen = false, accent, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`csec ${open ? 'csec-open' : ''}`} style={accent ? { borderLeftColor: accent } : undefined}>
      <button type="button" className="csec-header" onClick={() => setOpen(o => !o)}>
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
