import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';

// Reusable per-card lore selection (Phase C of the Dictionary/reminders migration).
// - Dictionary (global lore): which main-Dictionary groups apply to this card. Backed by
//   story.dictionaryGroupIds (server buildDictionaryPrompt filter). NONE selected = ALL groups
//   stay always-on (default, backward-compatible).
// - Library (shared term groups): which shared instructor-library groups this card opts into.
//   Backed by story.libraryGroupIds (server getSharedLibraryTermEntries → keyword-activated).
// Generalizes the Instructor card's Library pattern to all card types. Self-contained: fetches
// its own group lists; parent passes the active story + an updateStoryField(field, value) setter.
function CardLoreSection({ activeStory, updateStoryField }) {
  const { api } = useApp();
  const [dictGroups, setDictGroups] = useState([]);
  const [libGroups, setLibGroups] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      Promise.resolve(api.getDictionary ? api.getDictionary() : { groups: [] }).catch(() => ({ groups: [] })),
      Promise.resolve(api.getInstructorLibrary ? api.getInstructorLibrary() : { groups: [] }).catch(() => ({ groups: [] })),
    ]).then(([d, l]) => {
      if (!alive) return;
      setDictGroups((d && d.groups) || []);
      setLibGroups((l && l.groups) || []);
    });
    return () => { alive = false; };
  }, [api]);

  const dictIds = activeStory?.dictionaryGroupIds || [];
  const libIds = activeStory?.libraryGroupIds || [];
  const toggle = (field, ids, id) => {
    const has = ids.includes(id);
    updateStoryField(field, has ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const rowStyle = { display: 'flex', gap: 6, alignItems: 'center', margin: '2px 0' };

  return (
    <div className="story-field" style={{ marginTop: '0.5rem' }}>
      <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>Dictionary (global lore)</label>
      <p className="section-hint" style={{ marginTop: 0 }}>
        Which global Dictionary groups apply to this card. Leave all unchecked = every group applies (always-on).
      </p>
      {dictGroups.length === 0
        ? <span className="section-hint">No Dictionary groups yet — add them on the Dictionary page.</span>
        : dictGroups.map(g => (
          <label key={g.id} style={rowStyle}>
            <input type="checkbox" checked={dictIds.includes(g.id)} onChange={() => toggle('dictionaryGroupIds', dictIds, g.id)} />
            <span>{g.name}</span>
          </label>
        ))}

      <label style={{ fontWeight: 'bold', display: 'block', margin: '0.6rem 0 0.2rem' }}>Library (shared term groups)</label>
      <p className="section-hint" style={{ marginTop: 0 }}>Local lore groups this card pulls in (keyword-activated).</p>
      {libGroups.length === 0
        ? <span className="section-hint">No shared Library groups yet.</span>
        : libGroups.map(g => (
          <label key={g.id} style={rowStyle}>
            <input type="checkbox" checked={libIds.includes(g.id)} onChange={() => toggle('libraryGroupIds', libIds, g.id)} />
            <span>{g.name}</span>
          </label>
        ))}
    </div>
  );
}

export default CardLoreSection;
