import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { API_BASE } from '../config';
import MiniWheel from '../components/minigames/MiniWheel';
import MiniDice from '../components/minigames/MiniDice';
import { MiniCoin, MiniRPS, MiniSlots, MiniCardDraw, MiniSimon } from '../components/minigames/MoreGames';
import { GAME_TYPES, gameDef, defaultConfig, exitsFor, newId } from '../components/minigames/gameDefs';
import './MiniGames.css';

// ---- per-type live preview ----
function Preview({ type, config, onResult }) {
  const r = (result, winner, note) => onResult && onResult({ result, winner, note });
  switch (type) {
    case 'prize_wheel': return <MiniWheel segments={config.segments || []} size={240} interactive onResult={(seg) => r(seg.label)} />;
    case 'dice_roll': return <MiniDice diceCount={config.diceCount || 2} characterAdvantage={config.characterAdvantage || 0} size={84} interactive onResult={(total) => r(String(total), null, `[GameResult] = ${total}`)} />;
    case 'coin_flip': return <MiniCoin config={config} interactive onResult={(res, w) => r(res, w)} />;
    case 'rps': return <MiniRPS config={config} interactive onResult={(res, w) => r(res, w)} />;
    case 'slot_machine': return <MiniSlots config={config} interactive onResult={(res) => r(res)} />;
    case 'card_draw': return <MiniCardDraw config={config} interactive onResult={(res, w) => r(res, w)} />;
    case 'simon_challenge': return <MiniSimon config={config} interactive onResult={(res) => r(res)} />;
    default: {
      const def = gameDef(type);
      return <div className="mg-preview-stub"><div className="mg-preview-glyph">{def.icon}</div><div className="mg-preview-name">{def.name}</div></div>;
    }
  }
}

// ---- small field helpers ----
const Num = ({ label, value, onChange, ...p }) => (
  <label className="mg-field"><span>{label}</span>
    <input type="text" inputMode="numeric" value={value ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^0-9-]/g, ''))} {...p} />
  </label>
);
const Txt = ({ label, value, onChange, ...p }) => (
  <label className="mg-field"><span>{label}</span>
    <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} />
  </label>
);

// ---- per-type mechanics + exits editor ----
function GameTypeConfig({ type, config, set }) {
  const upd = (patch) => set({ ...config, ...patch });
  const updExit = (key, i, patch) => upd({ [key]: config[key].map((x, idx) => (idx === i ? { ...x, ...patch } : x)) });
  const rmExit = (key, i) => upd({ [key]: config[key].filter((_, idx) => idx !== i) });

  switch (type) {
    case 'prize_wheel':
      return (
        <>
          <h4 className="mg-group">Segments <span className="mg-hint">(each = an exit / [GameResult])</span></h4>
          {(config.segments || []).map((s, i) => (
            <div className="mg-row" key={s.id}>
              <input type="color" value={s.color || '#7b3fd6'} onChange={(e) => updExit('segments', i, { color: e.target.value })} title="Colour" />
              <input type="text" className="mg-grow" value={s.label} onChange={(e) => updExit('segments', i, { label: e.target.value })} placeholder="Label" />
              <label className="mg-weight" title="Weight (odds)">▓<input type="text" inputMode="numeric" value={s.weight ?? 1} onChange={(e) => updExit('segments', i, { weight: e.target.value.replace(/[^0-9]/g, '') })} /></label>
              {config.segments.length > 1 && <button className="mg-del" onClick={() => rmExit('segments', i)}>×</button>}
            </div>
          ))}
          <button className="mg-add" onClick={() => upd({ segments: [...config.segments, { id: newId('seg'), label: `Prize ${config.segments.length + 1}`, color: '#7b3fd6', weight: 1 }] })}>+ Segment</button>
        </>
      );
    case 'dice_roll':
      return (
        <>
          <h4 className="mg-group">Mechanics</h4>
          <div className="mg-grid">
            <Num label="Dice count" value={config.diceCount} onChange={(v) => upd({ diceCount: v })} />
            <Num label="Character advantage" value={config.characterAdvantage} onChange={(v) => upd({ characterAdvantage: v })} />
          </div>
          <p className="mg-hint"><code>[GameResult]</code> is the numeric total (dice + advantage). Branch on it with conditions in the tree — no exits to bind.</p>
        </>
      );
    case 'coin_flip':
      return (
        <>
          <h4 className="mg-group">Mechanics <span className="mg-hint">(sets [GameResult] + [GameWinner])</span></h4>
          <div className="mg-grid">
            <Txt label="Heads label" value={config.headsLabel} onChange={(v) => upd({ headsLabel: v })} />
            <Txt label="Tails label" value={config.tailsLabel} onChange={(v) => upd({ tailsLabel: v })} />
            <Num label="Heads weight %" value={config.headsWeight} onChange={(v) => upd({ headsWeight: v })} />
            <Num label="Best of" value={config.bestOf} onChange={(v) => upd({ bestOf: v })} />
          </div>
        </>
      );
    case 'rps':
      return (
        <>
          <h4 className="mg-group">Mechanics <span className="mg-hint">(sets [GameResult] + [GameWinner])</span></h4>
          <div className="mg-grid">
            <Num label="Best of" value={config.bestOf} onChange={(v) => upd({ bestOf: v })} />
            <Num label="Character bias %" value={config.characterBias} onChange={(v) => upd({ characterBias: v })} />
          </div>
        </>
      );
    case 'slot_machine':
      return (
        <>
          <h4 className="mg-group">Symbols</h4>
          <Txt label="Symbols (comma)" value={(config.symbols || []).join(', ')} onChange={(v) => upd({ symbols: v.split(',').map(s => s.trim()).filter(Boolean) })} />
          <h4 className="mg-group">Exits <span className="mg-hint">(match tier → [GameResult]; plus 'No Win')</span></h4>
          {(config.exits || []).map((e, i) => (
            <div className="mg-row" key={e.id}>
              <input type="text" className="mg-grow" value={e.label} onChange={(ev) => updExit('exits', i, { label: ev.target.value })} placeholder="Label" />
              <select value={e.pattern} onChange={(ev) => updExit('exits', i, { pattern: ev.target.value })}>
                <option value="three-of-a-kind">3 of a kind</option>
                <option value="two-of-a-kind">2 of a kind</option>
                <option value="no-match">No matches</option>
              </select>
              {config.exits.length > 1 && <button className="mg-del" onClick={() => rmExit('exits', i)}>×</button>}
            </div>
          ))}
          <button className="mg-add" onClick={() => upd({ exits: [...config.exits, { id: newId('ex'), label: 'Win', pattern: 'two-of-a-kind' }] })}>+ Tier</button>
        </>
      );
    case 'card_draw':
      return (
        <>
          <h4 className="mg-group">Blackjack <span className="mg-hint">(Player vs Character; sets [GameResult] Win/Lose/Push + [GameWinner])</span></h4>
          <div className="mg-grid">
            <Num label="Target (bust over)" value={config.target} onChange={(v) => upd({ target: v })} />
            <Num label="Character stands at" value={config.charStandsAt} onChange={(v) => upd({ charStandsAt: v })} />
          </div>
          <p className="mg-hint">You're dealt two cards, the character one. Hit or stay; the character draws until it reaches its stand value. Closest to the target without busting wins.</p>
        </>
      );
    case 'simon_challenge':
      return (
        <>
          <h4 className="mg-group">Mechanics <span className="mg-hint">(sequence grows +1 each round; reach Max length to win)</span></h4>
          <div className="mg-grid">
            <Num label="Start length" value={config.startingLength} onChange={(v) => upd({ startingLength: v })} />
            <Num label="Max length" value={config.maxLength} onChange={(v) => upd({ maxLength: v })} />
            <Num label="Max misses" value={config.maxMisses} onChange={(v) => upd({ maxMisses: v })} />
          </div>
          <p className="mg-hint">A wrong pad = a miss (the round replays). Each miss fires the <strong>MiniGame miss</strong> event (Checkpoints → Events) AND the Call MiniGame block's <strong>Miss</strong> goto, if bound — the tree runs from that label while the game stays open (penalty pumps/messages mid-game). Hitting Max misses fires the <strong>Failed</strong> exit; completing the Max-length round fires <strong>Completed</strong>.</p>
        </>
      );
    default:
      return null;
  }
}

// Wraps the per-type config with the universal Concede section: every game gets a Concede
// button in chat; conceding exits cleanly (GameResult = Conceded, bound goto runs) and can
// optionally fire a configured trigger tree as well.
function GameEditor({ type, config, set }) {
  const upd = (patch) => set({ ...config, ...patch });
  const [trees, setTrees] = React.useState([]);
  React.useEffect(() => {
    fetch(`${API_BASE}/api/trigger-trees`).then(r => r.json()).then(d => setTrees(d?.trees || [])).catch(() => {});
  }, []);
  return (
    <>
      <GameTypeConfig type={type} config={config} set={set} />
      <h4 className="mg-group">Concede <span className="mg-hint">(every game shows a Concede button)</span></h4>
      <p className="mg-hint">
        Conceding exits the game cleanly and closes its UI — <code>[GameResult]</code> becomes{' '}
        <strong>Conceded</strong>, and a <strong>Conceded</strong> goto bound on the Call MiniGame block runs.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={config.concedeCustom === true} onChange={(e) => upd({ concedeCustom: e.target.checked })} />
        <span>Custom concede action — also fire a trigger tree when the player concedes</span>
      </label>
      {config.concedeCustom === true && (
        <select value={config.concedeTreeId || ''} onChange={(e) => upd({ concedeTreeId: e.target.value })} style={{ marginTop: 6 }}>
          <option value="">— select a library tree —</option>
          {trees.map(t => <option key={t.id} value={t.id}>{t.name}{t.builtIn ? ' (built-in)' : ''}</option>)}
        </select>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <input type="checkbox" checked={config.concedeConfirm === true} onChange={(e) => upd({ concedeConfirm: e.target.checked })} />
        <span>Confirmation dialogue — ask before conceding (Cancel returns to the game)</span>
      </label>
      {config.concedeConfirm === true && (
        <Txt label="Confirmation message" value={config.concedeConfirmText} onChange={(v) => upd({ concedeConfirmText: v })} placeholder="Give up on this game?" />
      )}
    </>
  );
}

function MiniGames() {
  const navigate = useNavigate();
  const { api } = useApp();
  const [games, setGames] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [railOpen, setRailOpen] = useState(false); // mobile: library rail slides in off-canvas

  // Server-backed store (Phase 5) so the Call MiniGame tree action can resolve templates by id.
  const gamesRef = useRef(games);
  useEffect(() => { gamesRef.current = games; }, [games]);
  const saveTimers = useRef({});
  useEffect(() => { api.getMiniGames().then(d => setGames(d?.games || [])).catch(() => {}); }, [api]);
  useEffect(() => { setLastResult(null); }, [selectedId]);

  const selected = games.find(g => g.id === selectedId) || null;

  const create = async (type) => {
    const def = gameDef(type);
    const name = `New ${def.name}`, config = defaultConfig(type);
    try {
      const res = await api.createMiniGame(name, type, config);
      if (res?.id) { setGames(prev => [...prev, { id: res.id, name, type, config }]); setSelectedId(res.id); setRailOpen(false); }
    } catch (e) { console.error('create minigame failed', e); }
  };
  // Save pipeline is debounced-auto + explicit: every edit schedules a PUT 400ms out, the 💾
  // button (and page unmount) flush immediately, and saveState makes success/failure VISIBLE —
  // "silently maybe-saved" is how fields appear to reset.
  const [saveState, setSaveState] = useState('');
  const flushSave = (id) => {
    if (!id) return Promise.resolve();
    clearTimeout(saveTimers.current[id]);
    delete saveTimers.current[id];
    const g = (gamesRef.current || []).find(x => x.id === id);
    if (!g) return Promise.resolve();
    setSaveState('saving…');
    return api.updateMiniGame(id, { name: g.name, type: g.type, config: g.config })
      .then(() => setSaveState(`✓ saved ${new Date().toLocaleTimeString()}`))
      .catch(e => { console.error('save minigame failed', e); setSaveState(`⚠ SAVE FAILED: ${e.message || e}`); });
  };
  const update = (patch) => {
    if (!selectedId) return;
    setGames(prev => prev.map(g => (g.id === selectedId ? { ...g, ...patch } : g)));
    const id = selectedId;
    setSaveState('unsaved…');
    clearTimeout(saveTimers.current[id]); // debounce config-drag edits into one PUT
    saveTimers.current[id] = setTimeout(() => flushSave(id), 400);
  };
  // Leaving the page mid-debounce must not drop the last edit.
  useEffect(() => () => {
    for (const id of Object.keys(saveTimers.current)) {
      clearTimeout(saveTimers.current[id]);
      const g = (gamesRef.current || []).find(x => x.id === id);
      if (g) api.updateMiniGame(id, { name: g.name, type: g.type, config: g.config }).catch(() => {});
    }
  }, [api]);
  const remove = async (id) => {
    setGames(prev => prev.filter(g => g.id !== id));
    if (selectedId === id) setSelectedId(null);
    try { await api.deleteMiniGame(id); } catch (e) { console.error('delete minigame failed', e); }
  };

  // group library by type
  const byType = GAME_TYPES.map(t => ({ ...t, items: games.filter(g => g.type === t.type) })).filter(t => t.items.length);

  return (
    <div className="mg-page">
      <div className="mg-header">
        <button className="mg-rail-toggle" onClick={() => setRailOpen(o => !o)} aria-label="Toggle library" title="Library">☰</button>
        <h2>MiniGames</h2>
        <button className="mg-close" onClick={() => navigate('/')} title="Back to chat">×</button>
      </div>

      <div className="mg-body">
        {/* Backdrop closes the off-canvas rail on mobile */}
        {railOpen && <div className="mg-rail-backdrop" onClick={() => setRailOpen(false)} />}
        {/* Library rail */}
        <aside className={`mg-rail ${railOpen ? 'mg-rail-open' : ''}`}>
          <div className="mg-rail-scroll">
            {byType.length === 0 && <p className="mg-empty">No minigames yet. Create one below.</p>}
            {byType.map(t => (
              <div key={t.type} className="mg-rail-group">
                <div className="mg-rail-group-head">{t.icon} {t.name}</div>
                {t.items.map(g => (
                  <button key={g.id} className={`mg-rail-item ${g.id === selectedId ? 'active' : ''}`} onClick={() => { setSelectedId(g.id); setRailOpen(false); }}>
                    {g.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mg-new">
            <div className="mg-new-label">+ New minigame</div>
            <div className="mg-new-grid">
              {GAME_TYPES.map(t => (
                <button key={t.type} className="mg-new-tile" onClick={() => create(t.type)} title={t.name}>
                  <span className="mg-new-icon">{t.icon}</span>
                  <span className="mg-new-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Editor */}
        <main className="mg-editor">
          {!selected ? (
            <div className="mg-editor-empty">
              <div className="mg-editor-empty-glyph">🎲</div>
              <p>Pick a minigame to edit, or create one from the shelf.</p>
            </div>
          ) : (
            <>
              <div className="mg-editor-head">
                <span className="mg-editor-icon">{gameDef(selected.type).icon}</span>
                <input className="mg-editor-name" value={selected.name} onChange={(e) => update({ name: e.target.value })} placeholder="Name" />
                <button className="mg-add" onClick={() => flushSave(selectedId)} title="Save this game's profile now (edits also auto-save)">💾 Save</button>
                {saveState && <span className="mg-hint" style={{ marginLeft: 6 }}>{saveState}</span>}
                <span className="mg-editor-type">{gameDef(selected.type).name}</span>
                <button className="mg-editor-del" onClick={() => remove(selected.id)} title="Delete">Delete</button>
              </div>

              <div className="mg-editor-grid">
                <div className="mg-preview-pane">
                  <Preview key={selected.id} type={selected.type} config={selected.config} onResult={setLastResult} />
                  {lastResult && (
                    <div className="mg-last">
                      <span className="mg-last-label">Result</span>
                      <strong>{lastResult.result}</strong>
                      {lastResult.winner && <span className="mg-last-winner">winner: {lastResult.winner}</span>}
                      {lastResult.note && <span className="mg-last-note">({lastResult.note})</span>}
                    </div>
                  )}
                  <div className="mg-exits-readout">
                    <div className="mg-exits-title">Exits → trigger gotos</div>
                    <div className="mg-exits-chips">
                      {exitsFor(selected.type, selected.config).map((x, i) => (
                        <span key={i} className={`mg-exit-chip ${lastResult?.result === x ? 'hit' : ''}`}>{x}</span>
                      ))}
                    </div>
                    <div className="mg-vars">
                      Sets <code>[GameResult]</code>{gameDef(selected.type).competitive && <> + <code>[GameWinner]</code></>}
                    </div>
                  </div>
                </div>
                <div className="mg-config-pane">
                  <GameEditor type={selected.type} config={selected.config} set={(c) => update({ config: c })} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default MiniGames;
