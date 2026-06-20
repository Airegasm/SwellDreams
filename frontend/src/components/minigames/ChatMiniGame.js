import React from 'react';
import MiniWheel from './MiniWheel';
import MiniDice from './MiniDice';
import { MiniCoin, MiniRPS, MiniSlots, MiniCardDraw, MiniSimon } from './MoreGames';
import { gameDef } from './gameDefs';
import './ChatMiniGame.css';

// In-chat host for a Trigger Tree "Call MiniGame" (Phase 5). Renders the interactive game for the
// resolved template and reports the fired exit (+ winner for competitive games) via onResult,
// which the tree resume path turns into [Flow:GameResult] / [Flow:GameWinner] + the bound goto.
// Mirrors the authoring Preview in MiniGames.js, but normalizes every game's onResult to (exit, winner).
function ChatMiniGame({ data, onResult }) {
  if (!data) return null;
  const { type, config = {} } = data;
  const done = React.useRef(false);
  // Each broadcast is a fresh data object — re-arm so a later minigame in the same session reports.
  React.useEffect(() => { done.current = false; }, [data]);
  const r = (exit, winner) => { if (done.current) return; done.current = true; onResult(exit, winner || null); };

  const game = (() => {
    switch (type) {
      case 'prize_wheel': return <MiniWheel segments={config.segments || []} size={240} interactive onResult={(seg) => r(seg?.label)} />;
      case 'dice_roll': return <MiniDice diceCount={config.diceCount || 2} characterAdvantage={config.characterAdvantage || 0} size={84} interactive onResult={(total) => r(String(total))} />;
      case 'coin_flip': return <MiniCoin config={config} interactive onResult={(res, w) => r(res, w)} />;
      case 'rps': return <MiniRPS config={config} interactive onResult={(res, w) => r(res, w)} />;
      case 'slot_machine': return <MiniSlots config={config} interactive onResult={(res) => r(res)} />;
      case 'card_draw': return <MiniCardDraw config={config} interactive onResult={(res, w) => r(res, w)} />;
      case 'simon_challenge': return <MiniSimon config={config} interactive onResult={(res) => r(res)} />;
      default: return <div className="mg-preview-stub"><div className="mg-preview-glyph">{gameDef(type).icon}</div><div className="mg-preview-name">{gameDef(type).name}</div></div>;
    }
  })();

  return (
    <div className="chat-minigame">
      <div className="chat-minigame-name">{data.name || gameDef(type).name}</div>
      {game}
    </div>
  );
}

export default ChatMiniGame;
