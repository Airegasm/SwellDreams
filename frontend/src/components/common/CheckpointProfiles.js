import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import ScopeTreeSection from './ScopeTreeSection';
import EventTriggersSection from './EventTriggersSection';
import RangeTriggerEditor from './RangeTriggerEditor';
import CollapsibleSection from './CollapsibleSection';

// Shared "Checkpoint Profiles (1–100%)" editor — the per-card profile system used by Instructor,
// Character, and MultiChar cards. Each profile is a full 1–100% checkpoint set:
//   { id, name, pumpType?, rules?, ranges{key:{mainTheme, messagesBetweenBatches, maxPumpsPerBatch,
//     messagesBetweenOn, maxPumpOnSecs}}, checkpointTriggers{`player-${key}`:[]}, treeRefs{alwaysOn,events,ranges} }
// The active profile (defaultCheckpointProfileId, or one loaded by a pre-req/trigger) drives
// generation. Extracted from InstructorEditorModal so all three card editors share one UI.

export const CHECKPOINT_RANGES = [
  { key: '1-10', label: '0–10%' },
  { key: '11-20', label: '11–20%' },
  { key: '21-30', label: '21–30%' },
  { key: '31-40', label: '31–40%' },
  { key: '41-50', label: '41–50%' },
  { key: '51-60', label: '51–60%' },
  { key: '61-70', label: '61–70%' },
  { key: '71-80', label: '71–80%' },
  { key: '81-90', label: '81–90%' },
  { key: '91-100', label: '91–100%' },
  { key: '100+', label: '100%+ — Over-Inflation' },
];

// Build a default profile from a story's legacy flat checkpoints/triggers/range-trees. Used by the
// editors to migrate cards that predate the profile system, so checkpointProfiles is never empty.
export function migrateFlatToProfiles(story) {
  if (!story) return [{ id: 'default', name: 'Default', ranges: {} }];
  if (Array.isArray(story.checkpointProfiles) && story.checkpointProfiles.length) return story.checkpointProfiles;
  const ranges = {};
  const cps = story.checkpoints || {};
  for (const k of Object.keys(cps)) {
    if (k === '0') continue;
    const v = cps[k];
    ranges[k] = typeof v === 'string' ? { mainTheme: v } : { ...(v || {}) };
  }
  const checkpointTriggers = {};
  for (const [k, v] of Object.entries(story.checkpointTriggers || {})) {
    if (k.startsWith('player-')) checkpointTriggers[k] = v;
  }
  const treeRefs = {
    alwaysOn: story.treeRefs?.alwaysOn,
    events: story.treeRefs?.events,
    ranges: story.treeRefs?.ranges,
  };
  return [{ id: 'default', name: 'Default', ranges, checkpointTriggers, treeRefs }];
}

function CheckpointProfiles({ story, updateStory, defaultPumpType = 'electric', cardName = 'card', triggerSets = [], rowProps = {} }) {
  const { api, settings } = useApp();
  const [selProfId, setSelectedProfileId] = useState(null);
  const [visibleCheckpoints, setVisibleCheckpoints] = useState({});
  const [bulbMaxField, setBulbMaxField] = useState('');
  const [bikeMaxField, setBikeMaxField] = useState('');
  useEffect(() => {
    const sv = settings?.systemVariables || {};
    setBulbMaxField(sv.BulbMax ?? '');
    setBikeMaxField(sv.BikeMax ?? '');
  }, [settings?.systemVariables]);
  const saveMaxField = (which, raw) => {
    const clean = String(raw).replace(/[^0-9]/g, '');
    const sv = { ...(settings?.systemVariables || {}) };
    if (which === 'bulb') sv.BulbMax = clean === '' ? '' : Number(clean);
    else sv.BikeMax = clean === '' ? '' : Number(clean);
    api.updateSettings({ systemVariables: sv }).catch(() => {});
  };

  // Migrate legacy flat checkpoints → a Default profile the first time this story is edited, so
  // the profile system (and the generalized backend resolver) has something to read.
  useEffect(() => {
    if (story && !(Array.isArray(story.checkpointProfiles) && story.checkpointProfiles.length)) {
      updateStory('checkpointProfiles', migrateFlatToProfiles(story));
    }
    // eslint-disable-next-line
  }, [story?.id]);

  // One-time migration: Session Start / Intro used to be CARD-level (story.treeRefs) — now they're
  // per-profile. If a card still has card-level SS/Intro and the default profile has none, copy
  // them onto the default profile so existing cards don't lose those scopes.
  useEffect(() => {
    const ct = story?.treeRefs || {};
    if (!ct.sessionStart && !ct.intro) return;
    const profs = Array.isArray(story?.checkpointProfiles) ? story.checkpointProfiles : null;
    if (!profs || !profs.length) return;
    const defId = story?.defaultCheckpointProfileId || profs[0].id;
    const def = profs.find(p => p.id === defId) || profs[0];
    const dtr = def.treeRefs || {};
    if (dtr.sessionStart || dtr.intro) return; // already migrated
    const migrated = profs.map(p => (p.id === def.id
      ? { ...p, treeRefs: { ...(p.treeRefs || {}), sessionStart: ct.sessionStart, intro: ct.intro } }
      : p));
    updateStory('checkpointProfiles', migrated);
    // eslint-disable-next-line
  }, [story?.id]);

  // Render-time fallback: if checkpointProfiles isn't populated yet (legacy card whose migrate-on-
  // open write hasn't landed — the effect above persists it, but a formData/draft re-init can race
  // it), derive the profiles inline from the legacy flat checkpoints so the tab ALWAYS shows data
  // instead of collapsing to empty. Once the persist lands, the stored array is used.
  const cpProfiles = (Array.isArray(story?.checkpointProfiles) && story.checkpointProfiles.length)
    ? story.checkpointProfiles
    : migrateFlatToProfiles(story);
  const selId = selProfId || story?.defaultCheckpointProfileId || cpProfiles[0]?.id;
  const selProfile = cpProfiles.find(p => p.id === selId) || cpProfiles[0];
  const setCpProfiles = (list) => updateStory('checkpointProfiles', list);
  const addProfile = () => {
    const id = `prof-${Date.now()}`;
    setCpProfiles([...cpProfiles, { id, name: `Profile ${cpProfiles.length + 1}`, ranges: {} }]);
    setSelectedProfileId(id);
  };
  const renameProfile = (name) => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, name } : p)));
  const deleteProfile = () => {
    if (cpProfiles.length <= 1) return;
    const rest = cpProfiles.filter(p => p.id !== selId);
    setCpProfiles(rest);
    if (story?.defaultCheckpointProfileId === selId) updateStory('defaultCheckpointProfileId', rest[0].id);
    setSelectedProfileId(rest[0].id);
  };
  const setDefaultProfile = () => updateStory('defaultCheckpointProfileId', selId);
  const updateProfileRange = (key, obj) => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, ranges: { ...(p.ranges || {}), [key]: obj } } : p)));
  const setProfilePumpType = (pumpType) => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, pumpType } : p)));
  const setProfileRules = (rules) => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, rules } : p)));
  const effPumpType = selProfile?.pumpType || defaultPumpType || 'electric';
  const isManualPump = effPumpType === 'bulb' || effPumpType === 'bike';
  const isAutoPump = effPumpType === 'electric';
  const setRangeField = (key, field, raw) => {
    const cur = selProfile?.ranges?.[key] || { mainTheme: '', injections: [] };
    const val = raw === '' ? undefined : (parseInt(raw, 10) || 0);
    updateProfileRange(key, { ...cur, [field]: val });
  };
  const setRangeText = (key, field, val) => {
    const cur = selProfile?.ranges?.[key] || {};
    updateProfileRange(key, { ...cur, [field]: val });
  };
  const triggersFor = (key) => selProfile?.checkpointTriggers?.[`player-${key}`] || [];
  const setTriggers = (key, items) => setCpProfiles(cpProfiles.map(p => (p.id === selId
    ? { ...p, checkpointTriggers: { ...(p.checkpointTriggers || {}), [`player-${key}`]: items } }
    : p)));

  const profRowProps = { ...rowProps, triggerSets, profiles: cpProfiles };

  if (!cpProfiles.length) {
    return <p className="section-hint">No checkpoint profiles yet — reopen the card to migrate, or add one.</p>;
  }

  return (
    <>
      {/* Top: enable/disable the whole checkpoint system for this card. */}
      <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 600 }}>
        <input type="checkbox" checked={story?.checkpointsEnabled !== false} onChange={(e) => updateStory('checkpointsEnabled', e.target.checked)} />
        Enable Checkpoints
      </label>

      <div className="checkpoint-tab-header">
        <h4>Checkpoint Profiles (1–100%)</h4>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => {
          const anyShown = Object.values(visibleCheckpoints).some(Boolean);
          if (anyShown) { setVisibleCheckpoints({}); return; }
          const v = {};
          CHECKPOINT_RANGES.forEach(({ key }) => { v[key] = true; });
          setVisibleCheckpoints(v);
        }}>Show/Hide All</button>
      </div>
      <p className="section-hint">Each profile is a full 1–100% checkpoint set. A pre-req choice / trigger loads the matching profile; the Default applies otherwise.</p>
      <div className="checkpoint-profile-bar">
        <select value={selId || ''} onChange={(e) => setSelectedProfileId(e.target.value)}>
          {cpProfiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}{p.id === story?.defaultCheckpointProfileId ? ' (default)' : ''}</option>
          ))}
        </select>
        <input type="text" value={selProfile?.name || ''} onChange={(e) => renameProfile(e.target.value)} placeholder="Profile name" style={{ flex: 1, minWidth: 100 }} />
        <button type="button" className="btn btn-sm btn-secondary" onClick={addProfile}>+ Profile</button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={setDefaultProfile} disabled={selId === story?.defaultCheckpointProfileId}>Set Default</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={deleteProfile} disabled={cpProfiles.length <= 1}>Delete</button>
      </div>

      <div className="form-group" style={{ marginTop: 8 }}>
        <label>Pump Type for “{selProfile?.name || 'this profile'}”</label>
        <select value={selProfile?.pumpType || ''} onChange={(e) => setProfilePumpType(e.target.value)}>
          <option value="">— Inherit card default —</option>
          <option value="electric">Auto / Electric (E-STOP)</option>
          <option value="bulb">Manual / Bulb (PUMP)</option>
          <option value="bike">Manual / Bike (PUMP)</option>
        </select>
        <p className="section-hint">When a pre-req choice / trigger loads this profile, it sets the session pump mode (overrides the card default).</p>
      </div>

      <div className="form-group" style={{ marginTop: 8 }}>
        <label>Rules for “{selProfile?.name || 'this profile'}”</label>
        <textarea
          value={selProfile?.rules || ''}
          onChange={(e) => setProfileRules(e.target.value)}
          placeholder="Profile-specific behaviour rules — appended while this profile is active. Supports [Flow:Name], [Capacity], etc."
          rows={4}
        />
        <p className="section-hint">Active whenever this profile is loaded (across all 1–100% ranges).</p>
      </div>

      {/* Event Triggers (per profile) — includes the "Every reply (always-on)" event type,
          which replaces the old separate Always-On section. */}
      {(() => {
        const evts = selProfile?.treeRefs?.events || [];
        const setEvents = (next) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), events: next } } : p));
        return (
          <CollapsibleSection title="Event Triggers" subtitle="fire a tree every reply (always-on) or on a discrete event (device / state / idle / random)" badge={evts.length ? `${evts.length}` : ''}>
            <EventTriggersSection events={evts} onChange={setEvents} source={`from card: ${cardName}`} rowProps={profRowProps} />
          </CollapsibleSection>
        );
      })()}

      {/* Session Start (per profile) — runs once at session open while this profile is active. */}
      {(() => {
        const ssRef = selProfile?.treeRefs?.sessionStart || {};
        const setRef = (nextRef) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), sessionStart: { overrideWelcome: ssRef.overrideWelcome, ...nextRef } } } : p));
        const setOverride = (v) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), sessionStart: { ...(p.treeRefs?.sessionStart || {}), overrideWelcome: v } } } : p));
        const cnt = ssRef?.inline?.nodes?.length ? `${ssRef.inline.nodes.length}` : ssRef?.treeId ? 'linked' : '';
        return (
          <CollapsibleSection title="Session Start" subtitle="runs once at session open while this profile is active" badge={cnt}>
            <label className="tree-check" style={{ marginBottom: 8, display: 'block' }}>
              <input type="checkbox" checked={!!ssRef.overrideWelcome} onChange={(e) => setOverride(e.target.checked)} />
              &nbsp;Override Welcome Message (let the Session Start script open the scene)
            </label>
            <ScopeTreeSection label="" hint="" refValue={ssRef} onChange={setRef} defaultName="Session Start" source={`from card: ${cardName}`} rowProps={profRowProps} />
          </CollapsibleSection>
        );
      })()}

      {/* Intro (per profile) — gated; no pump, blocks other scopes until an End Gated Intro fires. */}
      {(() => {
        const iRef = selProfile?.treeRefs?.intro || {};
        const setRef = (nextRef) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), intro: nextRef } } : p));
        const on = (iRef?.inline?.nodes?.length || iRef?.treeId) ? 'on' : '';
        return (
          <CollapsibleSection title="Intro" subtitle="gated — no pump, blocks other scopes until it ends" badge={on}>
            <ScopeTreeSection label="" hint="Runs at session start and each reply until an 'End Gated Intro' action fires. No pumping; always-on / event triggers / buttons are blocked while active."
              refValue={iRef} onChange={setRef} defaultName="Intro" source={`from card: ${cardName}`} rowProps={{ ...profRowProps, profiles: cpProfiles }} />
          </CollapsibleSection>
        );
      })()}

      {CHECKPOINT_RANGES.map(({ key, label, hint }) => (
        <CollapsibleSection key={key} title={label} subtitle={hint}
          open={!!visibleCheckpoints[key]} onToggle={(v) => setVisibleCheckpoints(prev => ({ ...prev, [key]: v }))}>
          {isManualPump && (
            <div className="form-group" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <div>
                <label title="How many messages must pass after a batch before more pumping is requested">MSG / Batch</label>
                <input type="text" inputMode="numeric" value={selProfile?.ranges?.[key]?.messagesBetweenBatches ?? ''}
                  onChange={(e) => setRangeField(key, 'messagesBetweenBatches', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" style={{ maxWidth: 120 }} />
              </div>
              <div>
                <label title="Max pump operations requested in a single reply (one batch)">Max Pump / Batch</label>
                <input type="text" inputMode="numeric" value={selProfile?.ranges?.[key]?.maxPumpsPerBatch ?? ''}
                  onChange={(e) => setRangeField(key, 'maxPumpsPerBatch', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" style={{ maxWidth: 120 }} />
              </div>
            </div>
          )}
          {isAutoPump && (
            <div className="form-group" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <div>
                <label title="How many replies between automatic [pump on] events. Skips if the pump is already running.">MSG / ON</label>
                <input type="text" inputMode="numeric" value={selProfile?.ranges?.[key]?.messagesBetweenOn ?? ''}
                  onChange={(e) => setRangeField(key, 'messagesBetweenOn', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0 = off" style={{ maxWidth: 120 }} />
              </div>
              <div>
                <label title="How long the pump stays ON each time, in seconds (auto-off).">Max Pump ON (s)</label>
                <input type="text" inputMode="numeric" value={selProfile?.ranges?.[key]?.maxPumpOnSecs ?? ''}
                  onChange={(e) => setRangeField(key, 'maxPumpOnSecs', e.target.value.replace(/[^0-9]/g, ''))} placeholder="5" style={{ maxWidth: 120 }} />
              </div>
            </div>
          )}
          <label className="ci-label">Main theme</label>
          <textarea className="ci-main-theme" value={selProfile?.ranges?.[key]?.mainTheme || ''}
            onChange={(e) => setRangeText(key, 'mainTheme', e.target.value)}
            placeholder="Always-on guidance while capacity is in this range…" rows={2} />
          <RangeTriggerEditor value={triggersFor(key)} onChange={(v) => setTriggers(key, v)} triggerSets={triggerSets} profiles={cpProfiles} isPumpable={false} isManualPump={isManualPump} />
          {(() => {
            const rRef = selProfile?.treeRefs?.ranges?.[`player-${key}`] || {};
            const setRef = (nextRef) => setCpProfiles(cpProfiles.map(p => p.id === selId
              ? { ...p, treeRefs: { ...(p.treeRefs || {}), ranges: { ...(p.treeRefs?.ranges || {}), [`player-${key}`]: nextRef } } } : p));
            return (
              <div style={{ marginTop: 8 }}>
                <ScopeTreeSection label="Range Script" hint="runs each reply while in this range (once nodes fire once per range)"
                  refValue={rRef} onChange={setRef} defaultName={`Range ${key}`} source={`from card: ${cardName}`} rowProps={profRowProps} />
              </div>
            );
          })()}
        </CollapsibleSection>
      ))}
    </>
  );
}

export default CheckpointProfiles;
