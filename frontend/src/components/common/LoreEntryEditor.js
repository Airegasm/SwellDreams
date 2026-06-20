import React, { useState } from 'react';
import KeywordInput from './KeywordInput';

// ONE shared lorebook entry editor used everywhere lore is authored — the Dictionary page (global
// books), and every card's Library (the card's own entries). Mirrors SillyTavern: World Info,
// character_book, and chat lore are one schema + one engine; only the SCOPE differs. So every
// surface gets the full capability set here.
//
// Operates on a CANONICAL entry shape so each surface can adapt to its storage field names:
//   { title, content, keys[], secondaryKeys[], logic, probability, group,
//     target, scanDepth, priority, recurse, caseSensitive, enabled }
// Title↔term/name and content↔definition/text mapping lives at the call site (toCanonical/fromCanonical).

export const LOGIC_OPTIONS = [
  { value: 'and_any', label: 'trigger AND any secondary' },
  { value: 'and_all', label: 'trigger AND all secondary' },
  { value: 'not_any', label: 'trigger AND no secondary' },
  { value: 'not_all', label: 'trigger AND not all secondary' },
];

// A fresh canonical entry with sensible defaults (full caps).
export const blankLoreEntry = () => ({
  title: '', content: '', keys: [], secondaryKeys: [], logic: 'and_any',
  probability: 100, group: '', target: 'character', scanDepth: 10, priority: 100,
  recurse: true, caseSensitive: false, enabled: true,
});

function LoreEntryEditor({ entry, onChange, showEnabled = false, showTarget = true }) {
  const [advOpen, setAdvOpen] = useState(false);
  const e = entry || {};
  const set = (patch) => onChange({ ...e, ...patch });
  const keys = e.keys || [];

  return (
    <div className={`lore-entry ${e.enabled === false ? 'disabled' : ''}`}>
      <div className="lore-entry-head">
        {showEnabled && (
          <label className="lore-entry-enable" title={e.enabled === false ? 'Disabled' : 'Enabled'}>
            <input type="checkbox" checked={e.enabled !== false} onChange={(ev) => set({ enabled: ev.target.checked })} />
          </label>
        )}
        <input type="text" className="lore-entry-title" value={e.title || ''} onChange={(ev) => set({ title: ev.target.value })} placeholder="Title (e.g. Bike Pump)" />
      </div>

      <label className="lore-entry-label">Trigger keywords</label>
      <KeywordInput values={keys} onChange={(k) => set({ keys: k })} placeholder="Type keyword and press Enter… (blank = always-on)" />
      <span className="lore-entry-hint">{keys.length === 0 ? 'No keywords → always-on (constant).' : 'Activates when any keyword appears in recent messages.'}</span>

      <label className="lore-entry-label">Content</label>
      <textarea className="lore-entry-content" rows={3} value={e.content || ''} onChange={(ev) => set({ content: ev.target.value })} placeholder="What the AI should know / remember…" />

      <button type="button" className="dict-adv-toggle" onClick={() => setAdvOpen(o => !o)}>
        {advOpen ? '▾ Advanced' : '▸ Advanced'}
      </button>
      {advOpen && (
        <div className="dict-adv">
          <label className="lore-entry-label">Secondary keys</label>
          <KeywordInput values={e.secondaryKeys || []} onChange={(k) => set({ secondaryKeys: k })} placeholder="Optional — combined with the triggers via the logic below" />
          <div className="dict-adv-row">
            <label className="dict-adv-field" title="How secondary keys combine with the triggers">Logic
              <select value={e.logic || 'and_any'} onChange={(ev) => set({ logic: ev.target.value })}>
                {LOGIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="dict-adv-field" title="Chance to activate when matched">% chance
              <input type="number" min={0} max={100} value={e.probability ?? 100} onChange={(ev) => set({ probability: ev.target.value })} />
            </label>
            <label className="dict-adv-field" title="Inclusion group — only one entry per group activates per turn">Group
              <input type="text" value={e.group || ''} onChange={(ev) => set({ group: ev.target.value })} placeholder="(none)" />
            </label>
          </div>
          <div className="dict-adv-row">
            {showTarget && (
              <label className="dict-adv-field" title="Where this entry is shown">Display position
                <select value={e.target || 'character'} onChange={(ev) => set({ target: ev.target.value })}>
                  <option value="character">Character</option>
                  <option value="player">Player</option>
                </select>
              </label>
            )}
            <label className="dict-adv-field" title="How many recent messages to scan for keywords (0 = all)">Scan depth
              <input type="number" min={0} max={100} value={e.scanDepth ?? 10} onChange={(ev) => set({ scanDepth: parseInt(ev.target.value) || 0 })} />
            </label>
            <label className="dict-adv-field" title="Insertion order — higher appears earlier in the prompt">Priority
              <input type="number" min={0} max={1000} value={e.priority ?? 100} onChange={(ev) => set({ priority: parseInt(ev.target.value) || 100 })} />
            </label>
          </div>
          <div className="dict-adv-row">
            <label className="dict-adv-check" title="Recursion: let this entry's content trigger other entries' keywords">
              <input type="checkbox" checked={e.recurse !== false} onChange={(ev) => set({ recurse: ev.target.checked })} />
              <span>recursion</span>
            </label>
            <label className="dict-adv-check" title="Match keywords case-sensitively">
              <input type="checkbox" checked={!!e.caseSensitive} onChange={(ev) => set({ caseSensitive: ev.target.checked })} />
              <span>case sensitive</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoreEntryEditor;
