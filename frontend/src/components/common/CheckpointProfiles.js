import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiFetch } from '../../utils/api';
import { API_BASE } from '../../config';
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
  const [selRsId, setSelectedRangeSetId] = useState(null);
  const [visibleCheckpoints, setVisibleCheckpoints] = useState({});
  const [presets, setPresets] = useState([]);       // shipped read-only preset profiles
  const [selPresetId, setSelPresetId] = useState('');
  const [bulbMaxField, setBulbMaxField] = useState('');
  const [bikeMaxField, setBikeMaxField] = useState('');
  useEffect(() => {
    const sv = settings?.systemVariables || {};
    setBulbMaxField(sv.BulbMax ?? '');
    setBikeMaxField(sv.BikeMax ?? '');
  }, [settings?.systemVariables]);
  // Load the shipped read-only preset profiles (generic capacity pacing) once.
  useEffect(() => {
    apiFetch(`${API_BASE}/api/checkpoint-presets`).then(d => setPresets(d?.presets || [])).catch(() => {});
  }, []);

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

  // One-time migration: the per-range data (ranges, checkpointTriggers, treeRefs.ranges) used to
  // live directly on the profile — now it lives in a "Range Set". Wrap each profile's existing
  // range data into a single default Range Set so cards gain switchable sets without losing data.
  useEffect(() => {
    const profs = Array.isArray(story?.checkpointProfiles) ? story.checkpointProfiles : null;
    if (!profs || !profs.length) return;
    if (profs.every(p => Array.isArray(p.rangeSets) && p.rangeSets.length)) return; // already migrated
    const migrated = profs.map(p => {
      if (Array.isArray(p.rangeSets) && p.rangeSets.length) return p;
      const rsId = `rs-${p.id || Math.random().toString(36).slice(2, 7)}`;
      const set = { id: rsId, name: 'Default', ranges: p.ranges || {}, checkpointTriggers: p.checkpointTriggers || {}, treeRefs: { ranges: p.treeRefs?.ranges || {} } };
      return { ...p, rangeSets: [set], defaultRangeSetId: rsId };
    });
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
  // Apply a shipped preset → COPY it onto this character as a new, editable profile (the preset itself
  // is read-only and stays in the library). Wraps the preset's ranges into the profile/rangeSet shape.
  const applyPreset = () => {
    const preset = presets.find(p => p.id === selPresetId);
    if (!preset) return;
    const pid = `prof-${Date.now()}`;
    const rsId = `rs-${Date.now()}`;
    const newProf = {
      id: pid, name: preset.name,
      rangeSets: [{ id: rsId, name: 'Default', ranges: JSON.parse(JSON.stringify(preset.ranges || {})), checkpointTriggers: {}, treeRefs: { ranges: {} } }],
      defaultRangeSetId: rsId,
      treeRefs: { introEnabled: false },
    };
    setCpProfiles([...cpProfiles, newProf]);
    setSelectedProfileId(pid);
    setSelPresetId('');
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
  const setProfilePumpType = (pumpType) => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, pumpType } : p)));
  const setProfileRules = (rules) => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, rules } : p)));
  const effPumpType = selProfile?.pumpType || defaultPumpType || 'electric';
  const isManualPump = effPumpType === 'bulb' || effPumpType === 'bike';
  const isAutoPump = effPumpType === 'electric';

  // --- Range Sets: the per-range data (ranges/triggers/range scripts) lives in a switchable Range
  // Set inside the active profile. Legacy profiles (no rangeSets) read through an implicit set. ---
  const rangeSets = (selProfile?.rangeSets?.length ? selProfile.rangeSets
    : [{ id: '__legacy', name: 'Default', ranges: selProfile?.ranges || {}, checkpointTriggers: selProfile?.checkpointTriggers || {}, treeRefs: { ranges: selProfile?.treeRefs?.ranges || {} } }]);
  const rsId = selRsId || selProfile?.defaultRangeSetId || rangeSets[0]?.id;
  const selRangeSet = rangeSets.find(rs => rs.id === rsId) || rangeSets[0];
  const updateRangeSet = (patch) => setCpProfiles(cpProfiles.map(p => {
    if (p.id !== selId) return p;
    const sets = (p.rangeSets?.length ? p.rangeSets
      : [{ id: selRangeSet.id, name: 'Default', ranges: p.ranges || {}, checkpointTriggers: p.checkpointTriggers || {}, treeRefs: { ranges: p.treeRefs?.ranges || {} } }]);
    return { ...p, rangeSets: sets.map(rs => (rs.id === selRangeSet.id ? { ...rs, ...patch } : rs)) };
  }));
  const addRangeSet = () => {
    const id = `rs-${Date.now()}`;
    const base = selProfile?.rangeSets?.length ? selProfile.rangeSets : rangeSets;
    setCpProfiles(cpProfiles.map(p => (p.id === selId
      ? { ...p, rangeSets: [...base, { id, name: `Set ${base.length + 1}`, ranges: {}, checkpointTriggers: {}, treeRefs: { ranges: {} } }] }
      : p)));
    setSelectedRangeSetId(id);
  };
  const renameRangeSet = (name) => updateRangeSet({ name });
  const deleteRangeSet = () => {
    if (rangeSets.length <= 1) return;
    const rest = rangeSets.filter(rs => rs.id !== selRangeSet.id);
    setCpProfiles(cpProfiles.map(p => (p.id === selId
      ? { ...p, rangeSets: rest, defaultRangeSetId: p.defaultRangeSetId === selRangeSet.id ? rest[0].id : p.defaultRangeSetId }
      : p)));
    setSelectedRangeSetId(rest[0].id);
  };
  const setDefaultRangeSet = () => setCpProfiles(cpProfiles.map(p => (p.id === selId ? { ...p, defaultRangeSetId: selRangeSet.id } : p)));

  const updateProfileRange = (key, obj) => updateRangeSet({ ranges: { ...(selRangeSet?.ranges || {}), [key]: obj } });
  const setRangeField = (key, field, raw) => {
    const cur = selRangeSet?.ranges?.[key] || { mainTheme: '', injections: [] };
    const val = raw === '' ? undefined : (parseInt(raw, 10) || 0);
    updateProfileRange(key, { ...cur, [field]: val });
  };
  const setRangeText = (key, field, val) => {
    const cur = selRangeSet?.ranges?.[key] || {};
    updateProfileRange(key, { ...cur, [field]: val });
  };
  const triggersFor = (key) => selRangeSet?.checkpointTriggers?.[`player-${key}`] || [];
  const setTriggers = (key, items) => updateRangeSet({ checkpointTriggers: { ...(selRangeSet?.checkpointTriggers || {}), [`player-${key}`]: items } });

  // Per-range content summary — drives the navigator strip dots and the collapsed subtitle so you
  // can see WHERE the content lives without opening all 11 sections. (Triggers may be a legacy flat
  // array or the {sequential,random} shape — mirror the backend's normalizeRangeTriggers.)
  const rangeSummary = (key) => {
    const r = selRangeSet?.ranges?.[key] || {};
    const t = selRangeSet?.checkpointTriggers?.[`player-${key}`];
    const seq = Array.isArray(t) ? t.length : (Array.isArray(t?.sequential) ? t.sequential.length : 0);
    const rnd = Array.isArray(t?.random) ? t.random.length : 0;
    const scriptRef = selRangeSet?.treeRefs?.ranges?.[`player-${key}`];
    const script = scriptRef?.inline?.nodes?.length || (scriptRef?.treeId ? 1 : 0);
    const limits = (r.messagesBetweenOn > 0) || (r.maxPumpOnSecs > 0) || (r.messagesBetweenBatches > 0) || (r.maxPumpsPerBatch > 0);
    const parts = [];
    if ((r.mainTheme || '').trim()) parts.push('steer');
    if (seq) parts.push(`${seq} seq`);
    if (rnd) parts.push(`${rnd} rnd`);
    if (script) parts.push('script');
    if (limits) parts.push('limits');
    return { hasContent: parts.length > 0, text: parts.join(' · ') };
  };
  const jumpToRange = (key) => {
    setVisibleCheckpoints(prev => ({ ...prev, [key]: true }));
    // Scroll after the section opens.
    setTimeout(() => document.getElementById(`ckpt-range-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // Script-testing aid: clear the SESSION's once-memory (fired nodes/ranges, random budgets, event
  // latches) without resetting the chat, so authors can re-trigger scripts while iterating.
  const [onceResetMsg, setOnceResetMsg] = useState('');
  const resetOnceMemory = async () => {
    try {
      await apiFetch(`${API_BASE}/api/session/reset-once`, { method: 'POST' });
      setOnceResetMsg('✓ reset'); setTimeout(() => setOnceResetMsg(''), 2000);
    } catch { setOnceResetMsg('failed'); setTimeout(() => setOnceResetMsg(''), 2000); }
  };

  const profRowProps = { ...rowProps, triggerSets, profiles: cpProfiles };

  if (!cpProfiles.length) {
    return <p className="section-hint">No checkpoint profiles yet — reopen the card to migrate, or add one.</p>;
  }

  return (
    <>
      {/* Top: enable/disable the whole checkpoint system for this card. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, margin: 0 }}>
          <input type="checkbox" checked={story?.checkpointsEnabled !== false} onChange={(e) => updateStory('checkpointsEnabled', e.target.checked)} />
          Enable Checkpoints
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm btn-secondary" onClick={resetOnceMemory}
          title="Testing aid: clears the SESSION's once-memory (fired script nodes, fired range sequences, random budgets, event latches) WITHOUT resetting the chat — so scripts can fire again while you iterate.">
          Reset script memory {onceResetMsg && <em>{onceResetMsg}</em>}
        </button>
      </div>

      {(story?.checkpointsEnabled !== false) && (<>
      <h4 style={{ margin: '4px 0' }}>Checkpoint Profiles (1–100%)</h4>
      <p className="section-hint" style={{ marginTop: 0 }}>Each profile is a full 1–100% checkpoint set. A pre-req choice / trigger loads the matching profile; the Default applies otherwise.</p>
      <div className="checkpoint-profile-bar">
        <span className="section-hint">Profile:</span>
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

      {/* Apply a shipped preset (generic capacity pacing) as a new editable profile — one-click fix for
          cards with no checkpoints, so the description stays bound to the gauge. */}
      {presets.length > 0 && (
        <div className="checkpoint-profile-bar" style={{ marginTop: 6 }}>
          <span className="section-hint">Apply preset:</span>
          <select value={selPresetId} onChange={(e) => setSelPresetId(e.target.value)} style={{ flex: 1, minWidth: 120 }}>
            <option value="">— generic pacing preset —</option>
            {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={applyPreset} disabled={!selPresetId}>Apply as new profile</button>
        </div>
      )}
      {selPresetId && presets.find(p => p.id === selPresetId)?.description && (
        <p className="section-hint" style={{ marginTop: 2 }}>{presets.find(p => p.id === selPresetId).description} — adds an editable copy; you can tweak or delete it after.</p>
      )}

      <div className="form-group" style={{ marginTop: 8 }}>
        <label>Pump Type for “{selProfile?.name || 'this profile'}”</label>
        <select value={selProfile?.pumpType || ''} onChange={(e) => setProfilePumpType(e.target.value)}>
          <option value="">— Inherit card default —</option>
          <option value="electric">Auto / Electric (E-STOP)</option>
          <option value="bulb">Manual / Bulb (PUMP)</option>
          <option value="bike">Manual / Bike (PUMP)</option>
        </select>
        <p className="section-hint">When a pre-req choice / trigger loads this profile, it sets the session pump mode (overrides the card default).</p>
        {isManualPump && (
          <p className="section-hint" style={{ marginTop: 4 }}>
            📋 Manual pump calibration (set in <strong>Settings → Devices</strong>): Bulb <strong>{bulbMaxField || '?'}</strong> · Bike <strong>{bikeMaxField || '?'}</strong> pumps to full
            {bulbMaxField ? ` ≈ ${(100 / Number(bulbMaxField)).toFixed(1)}% per bulb pump` : ''}{bikeMaxField ? ` · ${(100 / Number(bikeMaxField)).toFixed(1)}% per bike pump` : ''}. Reference for laying out the ranges below.
          </p>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 8 }}>
        <label>Rules for “{selProfile?.name || 'this profile'}”</label>
        <textarea
          value={selProfile?.rules || ''}
          onChange={(e) => setProfileRules(e.target.value)}
          placeholder="Profile-specific behaviour rules — appended while this profile is active. Supports [CharVar:Name], [Capacity], etc."
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
        const evtsOff = selProfile?.treeRefs?.eventsDisabled === true;
        const setEvtsEnabled = (enabled) => setCpProfiles(cpProfiles.map(p => {
          if (p.id !== selId) return p;
          const tr = { ...(p.treeRefs || {}) };
          if (enabled) delete tr.eventsDisabled; else tr.eventsDisabled = true;
          return { ...p, treeRefs: tr };
        }));
        return (
          <CollapsibleSection title="Event Triggers" subtitle={`${evtsOff ? '⛔ GROUP OFF — ' : ''}fire a tree every reply (always-on) or on a discrete event (device / state / idle / random)`} badge={evts.length ? `${evts.length}` : ''}>
            <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}
              title="Group toggle — saved on the card. Off = none of this profile's event bindings fire. A Checkpoint Control tree block can flip this for the rest of the session.">
              <input type="checkbox" checked={!evtsOff} onChange={(e) => setEvtsEnabled(e.target.checked)} />
              <span><strong>Group enabled</strong> — event bindings fire (a Checkpoint Control block can override this in-session)</span>
            </label>
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
        const introEnabled = selProfile?.treeRefs?.introEnabled !== false; // default ON (back-compat)
        const readyExit = selProfile?.treeRefs?.introReadyExit === true;
        const setRef = (nextRef) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), intro: nextRef } } : p));
        const setEnabled = (val) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), introEnabled: val } } : p));
        const setReadyExit = (val) => setCpProfiles(cpProfiles.map(p => p.id === selId
          ? { ...p, treeRefs: { ...(p.treeRefs || {}), introReadyExit: val } } : p));
        const on = (introEnabled && (iRef?.inline?.nodes?.length || iRef?.treeId)) ? 'on' : '';
        return (
          <CollapsibleSection title="Intro" subtitle="gated — no pump, blocks other scopes until it ends" badge={on}>
            {/* Stacked for mobile: tickbox on its own line, wrapped description below it. */}
            <div style={{ marginBottom: 8 }}>
              <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <input type="checkbox" checked={introEnabled} onChange={(e) => setEnabled(e.target.checked)} />
                Enable Intro
              </label>
              <div className="section-hint" style={{ fontWeight: 400, marginTop: 2 }}>When off, the intro never runs and nothing is gated — the pump can fire from the first reply.</div>
            </div>
            {introEnabled && (
              <div style={{ marginBottom: 8 }}>
                <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <input type="checkbox" checked={readyExit} onChange={(e) => setReadyExit(e.target.checked)} />
                  Press UNLOCK to exit intro
                </label>
                <div className="section-hint" style={{ fontWeight: 400, marginTop: 2 }}>Lights up the reserved UNLOCK button once the intro's actions finish; pressing it ends the intro, opens the pump gate, and hands control back to the session's pump.</div>
              </div>
            )}
            {introEnabled && (
              <div style={{ marginBottom: 8 }}>
                <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <input type="checkbox" checked={selProfile?.treeRefs?.introEnableProsePumpAfter !== false}
                    onChange={(e) => setCpProfiles(cpProfiles.map(p => p.id === selId
                      ? { ...p, treeRefs: { ...(p.treeRefs || {}), introEnableProsePumpAfter: e.target.checked } } : p))} />
                  Enable prose pump guidance after intro
                </label>
                <div className="section-hint" style={{ fontWeight: 400, marginTop: 2 }}>After the intro ends, narrated pump prose ("she flips the switch…") may reinforce a real [pump on] (when Prose Reinforcement is enabled in Settings). Untick to keep prose reinforcement off for this profile even after the intro.</div>
              </div>
            )}
            {introEnabled && (
              <ScopeTreeSection label="" hint="Runs at session start and each reply until an 'End Gated Intro' action fires. No pumping; always-on / event triggers / buttons are blocked while active."
                refValue={iRef} onChange={setRef} defaultName="Intro" source={`from card: ${cardName}`} rowProps={{ ...profRowProps, profiles: cpProfiles }} />
            )}
          </CollapsibleSection>
        );
      })()}

      {/* Range Sets — swappable 1–100% sets within this profile. A 'Set Range Set' trigger switches
          the active set mid-session; the Default applies otherwise. */}
      <h4 style={{ margin: '12px 0 4px' }}>Range Sets</h4>
      <p className="section-hint" style={{ marginTop: 0 }}>Each set is its own full 1–100% range list. Switch between them mid-session with a “Set Range Set” trigger (e.g. for story switch-ups); the Default applies otherwise.</p>
      <div className="checkpoint-profile-bar">
        <span className="section-hint">Range Set:</span>
        <select value={rsId || ''} onChange={(e) => setSelectedRangeSetId(e.target.value)}>
          {rangeSets.map(rs => (
            <option key={rs.id} value={rs.id}>{rs.name}{rs.id === selProfile?.defaultRangeSetId ? ' (default)' : ''}</option>
          ))}
        </select>
        <input type="text" value={selRangeSet?.name || ''} onChange={(e) => renameRangeSet(e.target.value)} placeholder="Range set name" style={{ flex: 1, minWidth: 100 }} />
        <button type="button" className="btn btn-sm btn-secondary" onClick={addRangeSet}>+ Set</button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={setDefaultRangeSet} disabled={selRangeSet?.id === selProfile?.defaultRangeSetId}>Set Default</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={deleteRangeSet} disabled={rangeSets.length <= 1}>Delete</button>
      </div>

      {/* Range navigator: one chip per range; a dot marks ranges with content in THIS set.
          Click = open + scroll to that range. Replaces scrolling the 11-section accordion blind. */}
      <div className="ckpt-range-strip">
        {CHECKPOINT_RANGES.map(({ key }) => {
          const s = rangeSummary(key);
          return (
            <button key={key} type="button"
              className={`ckpt-range-chip ${s.hasContent ? 'has-content' : ''} ${visibleCheckpoints[key] ? 'open' : ''}`}
              title={s.hasContent ? s.text : 'empty'}
              onClick={() => jumpToRange(key)}>
              {key === '100+' ? '100+' : key}{s.hasContent && <span className="ckpt-dot" />}
            </button>
          );
        })}
        <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => {
          const anyShown = Object.values(visibleCheckpoints).some(Boolean);
          if (anyShown) { setVisibleCheckpoints({}); return; }
          const v = {};
          CHECKPOINT_RANGES.forEach(({ key }) => { v[key] = true; });
          setVisibleCheckpoints(v);
        }}>Show/Hide All</button>
      </div>

      {CHECKPOINT_RANGES.map(({ key, label }) => (
        <div key={key} id={`ckpt-range-${key}`}>
        <CollapsibleSection title={label} subtitle={`${(selProfile?.treeRefs?.rangeDisabled || {})[key] ? '⛔ GROUP OFF — ' : ''}${rangeSummary(key).text}`}
          open={!!visibleCheckpoints[key]} onToggle={(v) => setVisibleCheckpoints(prev => ({ ...prev, [key]: v }))}>
          <label className="tree-check" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}
            title="Group toggle — saved on the card. Off = this range fires nothing (plot steer, triggers, Range Script) and carry-over falls through to the nearest enabled lower range. A Checkpoint Control tree block can flip it for the rest of the session.">
            <input type="checkbox" checked={!(selProfile?.treeRefs?.rangeDisabled || {})[key]}
              onChange={(e) => {
                const enabled = e.target.checked;
                setCpProfiles(cpProfiles.map(p => {
                  if (p.id !== selId) return p;
                  const rd = { ...(p.treeRefs?.rangeDisabled || {}) };
                  if (enabled) delete rd[key]; else rd[key] = true;
                  return { ...p, treeRefs: { ...(p.treeRefs || {}), rangeDisabled: rd } };
                }));
              }} />
            <span><strong>Group enabled</strong> — this range's checkpoints fire (a Checkpoint Control block can override this in-session)</span>
          </label>
          {isManualPump && (
            <div className="form-group" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <div>
                <label title="How many messages must pass after a batch before more pumping is requested">MSG / Batch</label>
                <input type="text" inputMode="numeric" value={selRangeSet?.ranges?.[key]?.messagesBetweenBatches ?? ''}
                  onChange={(e) => setRangeField(key, 'messagesBetweenBatches', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" style={{ maxWidth: 120 }} />
              </div>
              <div>
                <label title="Max pump operations requested in a single reply (one batch)">Max Pump / Batch</label>
                <input type="text" inputMode="numeric" value={selRangeSet?.ranges?.[key]?.maxPumpsPerBatch ?? ''}
                  onChange={(e) => setRangeField(key, 'maxPumpsPerBatch', e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" style={{ maxWidth: 120 }} />
              </div>
            </div>
          )}
          {isAutoPump && (
            <div className="form-group" style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <label title="LIMIT SWITCH — minimum replies between pump-ON events while capacity is in this range; a pump-on that comes too soon is blocked. Blank = no cooldown (does not apply). Never forces the pump on.">Min Replies / Pump ON</label>
                  <input type="text" inputMode="numeric" value={selRangeSet?.ranges?.[key]?.messagesBetweenOn ?? ''}
                    onChange={(e) => setRangeField(key, 'messagesBetweenOn', e.target.value.replace(/[^0-9]/g, ''))} placeholder="blank = no limit" style={{ maxWidth: 150 }} />
                </div>
                <div>
                  <label title="LIMIT SWITCH — caps how long any pump-ON lasts while capacity is in this range. Blank = no range cap. If set and lower than the pump's own / global limit, this value wins. Never forces the pump on.">Max Pump ON (s)</label>
                  <input type="text" inputMode="numeric" value={selRangeSet?.ranges?.[key]?.maxPumpOnSecs ?? ''}
                    onChange={(e) => setRangeField(key, 'maxPumpOnSecs', e.target.value.replace(/[^0-9]/g, ''))} placeholder="blank = no cap" style={{ maxWidth: 150 }} />
                </div>
              </div>
              <div className="section-hint" style={{ marginTop: 4 }}>
                Limit switches — they only <em>cap</em> pumps the story fires, never trigger one. Blank = doesn't apply. Effective ON cap = the lowest that's set of: this range's Max Pump ON → the pump's own limit → the global limit.
              </div>
            </div>
          )}
          <label className="ci-label">Plot Steer / Rules</label>
          <textarea className="ci-main-theme" value={selRangeSet?.ranges?.[key]?.mainTheme || ''}
            onChange={(e) => setRangeText(key, 'mainTheme', e.target.value)}
            placeholder="Guidance the AI must follow while the player's capacity is in this range (sent to the LLM every reply)…" rows={2} />
          <RangeTriggerEditor value={triggersFor(key)} onChange={(v) => setTriggers(key, v)} triggerSets={triggerSets} profiles={cpProfiles} isPumpable={false} isManualPump={isManualPump} firePercentMax={key === '100+' ? 200 : 100} />
          {(() => {
            const rRef = selRangeSet?.treeRefs?.ranges?.[`player-${key}`] || {};
            const setRef = (nextRef) => updateRangeSet({ treeRefs: { ranges: { ...(selRangeSet?.treeRefs?.ranges || {}), [`player-${key}`]: nextRef } } });
            return (
              <div style={{ marginTop: 8 }}>
                <ScopeTreeSection label="Range Script" hint="runs each reply while in this range (once nodes fire once per range)"
                  refValue={rRef} onChange={setRef} defaultName={`Range ${key}`} source={`from card: ${cardName}`} rowProps={profRowProps} />
              </div>
            );
          })()}
        </CollapsibleSection>
        </div>
      ))}
      </>)}
    </>
  );
}

export default CheckpointProfiles;
