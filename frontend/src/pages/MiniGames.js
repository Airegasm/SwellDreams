import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MiniWheel from '../components/minigames/MiniWheel';
import MiniDice from '../components/minigames/MiniDice';
import { MiniCoin, MiniRPS, MiniSlots, MiniTimer, MiniNumberGuess, MiniCardDraw, MiniSimon, MiniReflex } from '../components/minigames/MoreGames';
import { GAME_TYPES, gameDef, defaultConfig, exitsFor, newId } from '../components/minigames/gameDefs';
import './MiniGames.css';

const STORE_KEY = 'swelldreams.minigames';
const loadStore = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } };
const saveStore = (list) => localStorage.setItem(STORE_KEY, JSON.stringify(list));

// ---- per-type live preview ----
function Preview({ type, config }) {
  switch (type) {
    case 'prize_wheel': return <MiniWheel segments={config.segments || []} size={240} interactive />;
    case 'dice_roll': return <MiniDice diceCount={config.diceCount || 2} size={84} interactive />;
    case 'coin_flip': return <MiniCoin config={config} interactive />;
    case 'rps': return <MiniRPS config={config} interactive />;
    case 'slot_machine': return <MiniSlots config={config} interactive />;
    case 'timer_challenge': return <MiniTimer config={config} interactive />;
    case 'number_guess': return <MiniNumberGuess config={config} interactive />;
    case 'card_draw': return <MiniCardDraw config={config} interactive />;
    case 'simon_challenge': return <MiniSimon config={config} interactive />;
    case 'reflex_challenge': return <MiniReflex config={config} interactive />;
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
const Sel = ({ label, value, onChange, options }) => (
  <label className="mg-field"><span>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

// ---- per-type mechanics + exits editor ----
function GameEditor({ type, config, set }) {
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
          <h4 className="mg-group">Exits <span className="mg-hint">(total → range → [GameResult])</span></h4>
          {(config.exits || []).map((e, i) => (
            <div className="mg-row" key={e.id}>
              <input type="text" className="mg-grow" value={e.label} onChange={(ev) => updExit('exits', i, { label: ev.target.value })} placeholder="Label" />
              <label className="mg-range">min<input type="text" inputMode="numeric" value={e.min} onChange={(ev) => updExit('exits', i, { min: ev.target.value.replace(/[^0-9]/g, '') })} /></label>
              <label className="mg-range">max<input type="text" inputMode="numeric" value={e.max} onChange={(ev) => updExit('exits', i, { max: ev.target.value.replace(/[^0-9]/g, '') })} /></label>
              {config.exits.length > 1 && <button className="mg-del" onClick={() => rmExit('exits', i)}>×</button>}
            </div>
          ))}
          <button className="mg-add" onClick={() => upd({ exits: [...config.exits, { id: newId('ex'), label: 'New', min: 2, max: 12 }] })}>+ Exit</button>
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
    case 'timer_challenge':
      return (
        <>
          <h4 className="mg-group">Mechanics</h4>
          <div className="mg-grid">
            <Num label="Duration (s)" value={config.duration} onChange={(v) => upd({ duration: v })} />
            <label className="mg-check"><input type="checkbox" checked={!!config.precisionMode} onChange={(e) => upd({ precisionMode: e.target.checked })} /> Precision mode</label>
            {config.precisionMode && <Num label="Window (s)" value={config.precisionWindow} onChange={(v) => upd({ precisionWindow: v })} />}
          </div>
        </>
      );
    case 'number_guess':
      return (
        <>
          <h4 className="mg-group">Mechanics</h4>
          <div className="mg-grid">
            <Num label="Min" value={config.min} onChange={(v) => upd({ min: v })} />
            <Num label="Max" value={config.max} onChange={(v) => upd({ max: v })} />
            <Num label="Max attempts" value={config.maxAttempts} onChange={(v) => upd({ maxAttempts: v })} />
            <Num label="Close threshold" value={config.closeThreshold} onChange={(v) => upd({ closeThreshold: v })} />
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
                <option value="any-pair">Any pair</option>
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
          <h4 className="mg-group">Mechanics</h4>
          <div className="mg-grid">
            <Sel label="Deck" value={config.deckType} onChange={(v) => upd({ deckType: v })} options={[{ value: 'standard', label: 'Standard 52' }, { value: 'no-face', label: 'No face cards' }]} />
            <Sel label="Output (exits)" value={config.outputMode} onChange={(v) => upd({ outputMode: v })} options={[{ value: 'suit', label: 'By suit' }, { value: 'color', label: 'Red / Black' }, { value: 'highlow', label: 'High / Low' }]} />
          </div>
        </>
      );
    case 'simon_challenge':
    case 'reflex_challenge': {
      const isSimon = type === 'simon_challenge';
      return (
        <>
          <h4 className="mg-group">Mechanics</h4>
          <div className="mg-grid">
            {isSimon ? <Num label="Start length" value={config.startingLength} onChange={(v) => upd({ startingLength: v })} /> : <Num label="Time / target (s)" value={config.timePerTarget} onChange={(v) => upd({ timePerTarget: v })} />}
            {isSimon ? <Num label="Max length" value={config.maxLength} onChange={(v) => upd({ maxLength: v })} /> : <Num label="Rounds" value={config.rounds} onChange={(v) => upd({ rounds: v })} />}
            {isSimon ? <Num label="Max misses" value={config.maxMisses} onChange={(v) => upd({ maxMisses: v })} /> : <Sel label="Target size" value={config.targetSize} onChange={(v) => upd({ targetSize: v })} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />}
          </div>
          <h4 className="mg-group">In-game device feedback <span className="mg-hint">(fires during play)</span></h4>
          <div className="mg-grid">
            <Txt label="Miss device" value={config.penaltyDevice} onChange={(v) => upd({ penaltyDevice: v })} />
            <Num label="Miss dur (s)" value={config.penaltyDuration} onChange={(v) => upd({ penaltyDuration: v })} />
            <Txt label="Fail device" value={config.grandPenaltyDevice} onChange={(v) => upd({ grandPenaltyDevice: v })} />
            <Num label="Fail dur (s)" value={config.grandPenaltyDuration} onChange={(v) => upd({ grandPenaltyDuration: v })} />
            <Txt label="Win device" value={config.rewardDevice} onChange={(v) => upd({ rewardDevice: v })} />
            <Num label="Win dur (s)" value={config.rewardDuration} onChange={(v) => upd({ rewardDuration: v })} />
          </div>
        </>
      );
    }
    default:
      return null;
  }
}

function MiniGames() {
  const navigate = useNavigate();
  const [games, setGames] = useState(loadStore);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => { saveStore(games); }, [games]);

  const selected = games.find(g => g.id === selectedId) || null;

  const create = (type) => {
    const def = gameDef(type);
    const g = { id: newId('mg'), name: `New ${def.name}`, type, config: defaultConfig(type) };
    setGames(prev => [...prev, g]);
    setSelectedId(g.id);
  };
  const update = (patch) => setGames(prev => prev.map(g => (g.id === selectedId ? { ...g, ...patch } : g)));
  const remove = (id) => {
    setGames(prev => prev.filter(g => g.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // group library by type
  const byType = GAME_TYPES.map(t => ({ ...t, items: games.filter(g => g.type === t.type) })).filter(t => t.items.length);

  return (
    <div className="mg-page">
      <div className="mg-header">
        <h2>MiniGames</h2>
        <button className="mg-close" onClick={() => navigate('/')} title="Back to chat">×</button>
      </div>

      <div className="mg-body">
        {/* Library rail */}
        <aside className="mg-rail">
          <div className="mg-rail-scroll">
            {byType.length === 0 && <p className="mg-empty">No minigames yet. Create one below.</p>}
            {byType.map(t => (
              <div key={t.type} className="mg-rail-group">
                <div className="mg-rail-group-head">{t.icon} {t.name}</div>
                {t.items.map(g => (
                  <button key={g.id} className={`mg-rail-item ${g.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(g.id)}>
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
                <span className="mg-editor-type">{gameDef(selected.type).name}</span>
                <button className="mg-editor-del" onClick={() => remove(selected.id)} title="Delete">Delete</button>
              </div>

              <div className="mg-editor-grid">
                <div className="mg-preview-pane">
                  <Preview type={selected.type} config={selected.config} />
                  <div className="mg-exits-readout">
                    <div className="mg-exits-title">Exits → trigger gotos</div>
                    <div className="mg-exits-chips">
                      {exitsFor(selected.type, selected.config).map((x, i) => <span key={i} className="mg-exit-chip">{x}</span>)}
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
