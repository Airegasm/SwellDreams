import React from 'react';
import MiniWheel from './MiniWheel';
import MiniDice from './MiniDice';
import { MiniCoin, MiniRPS, MiniSlots, MiniCardDraw, MiniSimon } from './MoreGames';
import { gameDef } from './gameDefs';
import './ChatMiniGame.css';

// In-chat host for a Trigger Tree "Call MiniGame" (Phase 5). Renders the interactive game for the
// resolved template and reports the fired exit (+ winner for competitive games) via onResult,
// which the tree resume path turns into [CharVar:GameResult] / [CharVar:GameWinner] + the bound goto.
// onMiss reports mid-game wrong moves (game still running) → the 'MiniGame miss' event bindings.
// Mirrors the authoring Preview in MiniGames.js, but normalizes every game's onResult to (exit, winner).
function ChatMiniGame({ data, onResult, onMiss }) {
  if (!data) return null;
  const { type, config = {} } = data;
  const done = React.useRef(false);
  const [confirming, setConfirming] = React.useState(false); // concede confirmation panel open
  // Each broadcast is a fresh data object — re-arm so a later minigame in the same session reports.
  React.useEffect(() => { done.current = false; setConfirming(false); }, [data]);
  const r = (exit, winner, pick) => { if (done.current) return; done.current = true; onResult(exit, winner || null, pick || null); };

  const game = (() => {
    switch (type) {
      case 'prize_wheel': return <MiniWheel segments={config.segments || []} size={240} interactive onResult={(seg) => r(seg?.label)} />;
      case 'dice_roll': return <MiniDice diceCount={config.diceCount || 2} characterAdvantage={config.characterAdvantage || 0} size={84} interactive onResult={(total) => r(String(total))} />;
      case 'coin_flip': return <MiniCoin config={config} interactive onResult={(res, w, pick) => r(res, w, pick)} />;
      case 'rps': return <MiniRPS config={config} interactive onResult={(res, w, pick) => r(res, w, pick)} />;
      case 'slot_machine': return <MiniSlots config={config} interactive onResult={(res) => r(res)} />;
      case 'card_draw': return <MiniCardDraw config={config} interactive onResult={(res, w) => r(res, w)} />;
      case 'simon_challenge': return <MiniSimon config={config} interactive onResult={(res) => r(res)} onMiss={(m, mm) => onMiss && onMiss(m, mm)} />;
      default: return <div className="mg-preview-stub"><div className="mg-preview-glyph">{gameDef(type).icon}</div><div className="mg-preview-name">{gameDef(type).name}</div></div>;
    }
  })();

  return (
    <div className="chat-minigame">
      <div className="chat-minigame-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{data.name || gameDef(type).name}</span>
        <button type="button" className="btn btn-sm btn-secondary"
          title="Give up — the game closes cleanly ([CharVar:GameResult] = Conceded; a bound Conceded goto and the game's custom concede tree fire, if configured)"
          onClick={() => (config.concedeConfirm === true ? setConfirming(true) : r('Conceded'))}>
          Concede
        </button>
      </div>
      {confirming && (
        <div style={{ margin: '6px 0', padding: 10, border: '1px solid rgba(200,120,120,0.6)', borderRadius: 8, background: 'rgba(74,18,20,0.35)' }}>
          <div style={{ marginBottom: 8 }}>{config.concedeConfirmText || 'Give up on this game?'}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirming(false)}>Keep playing</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirming(false); r('Conceded'); }}>Concede</button>
          </div>
        </div>
      )}
      {game}
    </div>
  );
}

export default ChatMiniGame;
