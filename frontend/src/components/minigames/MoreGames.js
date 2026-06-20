import React, { useState, useRef, useEffect, useCallback } from 'react';
import './MoreGames.css';

const rid = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ───────────────────────── Coin Flip ─────────────────────────
export function MiniCoin({ config = {}, interactive, onResult }) {
  const heads = config.headsLabel || 'Heads';
  const tails = config.tailsLabel || 'Tails';
  const [rot, setRot] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [landed, setLanded] = useState(null);
  const [done, setDone] = useState(false);
  const accum = useRef(0);

  // Player calls the side first; they win if the coin lands on their call.
  const flip = (choice) => {
    if (flipping || done) return;
    setLanded(null);
    const isHeads = Math.random() * 100 < (Number(config.headsWeight) ?? 50);
    const landedSide = isHeads ? 'heads' : 'tails';
    const landing = isHeads ? 0 : 180;
    const cur = accum.current % 360;
    const next = accum.current + (((landing - cur) + 360) % 360) + 360 * 5;
    accum.current = next;
    setRot(next);
    setFlipping(true);
    window.setTimeout(() => {
      setFlipping(false);
      setDone(true);
      const playerWon = landedSide === choice;
      setLanded(playerWon ? 'Player' : 'Character');
      onResult && onResult(isHeads ? heads : tails, playerWon ? 'Player' : 'Character');
    }, 1500);
  };

  return (
    <div className="pv">
      <div className={`pv-coin-wrap ${landed ? 'landed' : ''}`}>
        <div className="pv-coin" style={{ transform: `rotateX(${rot}deg)`, transition: flipping ? 'transform 1.5s cubic-bezier(.2,.75,.2,1)' : 'none' }}>
          <div className="pv-coin-face pv-coin-h">{heads}</div>
          <div className="pv-coin-face pv-coin-t">{tails}</div>
        </div>
      </div>
      {interactive && !done && (
        <div className="pv-pick">
          <span className="pv-pick-label">Call it:</span>
          <button className="pv-btn sm" onClick={() => flip('heads')} disabled={flipping}>{heads}</button>
          <button className="pv-btn sm" onClick={() => flip('tails')} disabled={flipping}>{tails}</button>
        </div>
      )}
      {landed && <div className={`pv-result ${landed === 'Player' ? 'r-win' : 'r-lose'}`}>{landed === 'Player' ? 'You win' : 'You lose'}</div>}
    </div>
  );
}

// ───────────────────────── Rock Paper Scissors ─────────────────────────
const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const RPS_KEYS = Object.keys(RPS);
const rpsJudge = (p, c) => (p === c ? 'Draw' : ((p === 'rock' && c === 'scissors') || (p === 'paper' && c === 'rock') || (p === 'scissors' && c === 'paper')) ? 'Win' : 'Lose');

const RPS_BEATS = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
export function MiniRPS({ config = {}, interactive, onResult }) {
  const [p, setP] = useState('rock');
  const [c, setC] = useState('rock');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  // Player throws first; the character's hand cycles, then locks. characterBias% of the time the
  // character plays the move that BEATS the player's throw, otherwise random.
  const play = (choice) => {
    if (busy || res) return;
    setP(choice); setBusy(true); setRes(null);
    let n = 0;
    const iv = window.setInterval(() => {
      setC(rid(RPS_KEYS));
      if (++n > 8) {
        window.clearInterval(iv);
        const bias = Number(config.characterBias) || 0;
        const cc = (Math.random() * 100 < bias) ? RPS_BEATS[choice] : rid(RPS_KEYS);
        setC(cc);
        const r = rpsJudge(choice, cc);
        setRes(r); setBusy(false);
        onResult && onResult(r, r === 'Win' ? 'Player' : r === 'Lose' ? 'Character' : 'Draw');
      }
    }, 110);
  };

  return (
    <div className="pv">
      <div className="pv-rps">
        <div className={`pv-hand ${busy ? 'shake' : ''} ${res === 'Win' ? 'win' : res === 'Lose' ? 'lose' : ''}`}>{RPS[p]}</div>
        <span className="pv-vs">vs</span>
        <div className={`pv-hand flip ${busy ? 'shake' : ''} ${res === 'Lose' ? 'win' : res === 'Win' ? 'lose' : ''}`}>{RPS[c]}</div>
      </div>
      {res && <div className={`pv-result r-${res.toLowerCase()}`}>{res}</div>}
      {interactive && !busy && !res && (
        <div className="pv-pick">
          {RPS_KEYS.map(k => <button key={k} className="pv-btn sm" onClick={() => play(k)} title={k}>{RPS[k]}</button>)}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Slot Machine ─────────────────────────
export function MiniSlots({ config = {}, interactive, onResult }) {
  const symbols = (config.symbols && config.symbols.length) ? config.symbols : ['🍒', '🍋', '🔔', '⭐', '7️⃣'];
  const [reels, setReels] = useState([0, 0, 0]);
  const [spin, setSpin] = useState(false);
  const [won, setWon] = useState(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearInterval), []);

  const play = () => {
    if (spin) return;
    setSpin(true); setWon(false);
    const finals = [0, 1, 2].map(() => Math.floor(Math.random() * symbols.length));
    [0, 1, 2].forEach((col, idx) => {
      const iv = window.setInterval(() => setReels(r => { const n = [...r]; n[col] = Math.floor(Math.random() * symbols.length); return n; }), 70);
      timers.current[col] = iv;
      window.setTimeout(() => {
        clearInterval(iv);
        setReels(r => { const n = [...r]; n[col] = finals[col]; return n; });
        if (idx === 2) {
          window.setTimeout(() => {
            setSpin(false);
            const vals = finals.map(i => symbols[i]);
            const counts = {}; vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
            const max = Math.max(...Object.values(counts));
            const tier = (config.exits || []).find(e =>
              (e.pattern === 'three-of-a-kind' && max === 3) ||
              (e.pattern === 'two-of-a-kind' && max === 2) ||
              (e.pattern === 'any-pair' && max >= 2) || // legacy
              (e.pattern === 'no-match' && max === 1));
            if (tier && max >= 2) setWon(true);
            onResult && onResult(tier ? tier.label : 'No Win');
          }, 250);
        }
      }, 700 + idx * 450);
    });
  };

  return (
    <div className="pv">
      <div className={`pv-slots ${won ? 'won' : ''}`}>
        {reels.map((i, col) => <div key={col} className={`pv-reel ${spin ? 'spinning' : ''}`}>{symbols[i]}</div>)}
      </div>
      {interactive && <button className="pv-btn" onClick={play} disabled={spin}>{spin ? 'Spinning…' : 'Pull'}</button>}
    </div>
  );
}

// ───────────────────────── Blackjack (easy: hit or stay) ─────────────────────────
const SUITS = [{ s: '♥', c: 'red', n: 'Hearts' }, { s: '♦', c: 'red', n: 'Diamonds' }, { s: '♣', c: 'black', n: 'Clubs' }, { s: '♠', c: 'black', n: 'Spades' }];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const cardValue = (rank) => (rank === 'A' ? 11 : ('JQK'.includes(rank) ? 10 : parseInt(rank, 10)));
const drawCard = () => ({ suit: rid(SUITS), rank: rid(RANKS) });
const handTotal = (cards) => {
  let total = cards.reduce((s, c) => s + cardValue(c.rank), 0);
  let aces = cards.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; } // soften aces 11→1
  return total;
};

export function MiniCardDraw({ config = {}, interactive, onResult }) {
  const target = Number(config.target) || 21;
  const charStandsAt = Number(config.charStandsAt) || 17;
  const [player, setPlayer] = useState([]);
  const [char, setChar] = useState([]);
  const [phase, setPhase] = useState('start'); // start | player | done
  const [outcome, setOutcome] = useState(null);
  const done = useRef(false);

  const settle = (pHand, cHand) => {
    let c = [...cHand];
    if (handTotal(pHand) <= target) {
      while (handTotal(c) < charStandsAt) c.push(drawCard()); // character plays out its turn
    }
    setChar(c);
    const pt = handTotal(pHand), ct = handTotal(c);
    let result, winner;
    if (pt > target) { result = 'Lose'; winner = 'Character'; }
    else if (ct > target) { result = 'Win'; winner = 'Player'; }
    else if (pt > ct) { result = 'Win'; winner = 'Player'; }
    else if (ct > pt) { result = 'Lose'; winner = 'Character'; }
    else { result = 'Push'; winner = 'Draw'; }
    setOutcome(result); setPhase('done');
    if (!done.current) { done.current = true; onResult && onResult(result, winner); }
  };

  const deal = () => { setPlayer([drawCard(), drawCard()]); setChar([drawCard()]); setPhase('player'); setOutcome(null); };
  const hit = () => { const p = [...player, drawCard()]; setPlayer(p); if (handTotal(p) > target) settle(p, char); };
  const stay = () => settle(player, char);

  const Card = (c, i) => <span key={i} className={`pv-bj-card ${c.suit.c}`}>{c.rank}<span className="pv-bj-suit">{c.suit.s}</span></span>;

  return (
    <div className="pv pv-blackjack">
      <div className="pv-bj-hands">
        <div className="pv-bj-side">
          <div className="pv-bj-label">You · {player.length ? handTotal(player) : '—'}</div>
          <div className="pv-bj-cards">{player.map(Card)}</div>
        </div>
        <div className="pv-bj-side">
          <div className="pv-bj-label">Character · {phase === 'done' ? handTotal(char) : (char.length ? '?' : '—')}</div>
          <div className="pv-bj-cards">
            {char.map(Card)}
            {phase === 'player' && char.length > 0 && <span className="pv-bj-card back">🂠</span>}
          </div>
        </div>
      </div>
      {outcome && <div className={`pv-result ${outcome === 'Win' ? 'r-win' : outcome === 'Lose' ? 'r-lose' : 'r-draw'}`}>{outcome === 'Push' ? 'Push' : outcome === 'Win' ? 'You win' : 'You lose'}</div>}
      {interactive && phase === 'start' && <button className="pv-btn" onClick={deal}>Deal</button>}
      {interactive && phase === 'player' && (
        <div className="pv-pick">
          <button className="pv-btn sm" onClick={hit}>Hit</button>
          <button className="pv-btn sm" onClick={stay}>Stay</button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Simon (demo) ─────────────────────────
const SIMON_PADS = [{ k: 'g', c: '#22c55e' }, { k: 'r', c: '#ef4444' }, { k: 'b', c: '#3b82f6' }, { k: 'y', c: '#eab308' }];
export function MiniSimon({ config = {}, interactive, onResult }) {
  const [lit, setLit] = useState(-1);
  const [busy, setBusy] = useState(false);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const demo = () => {
    if (busy) return;
    setBusy(true);
    const len = Math.max(2, Number(config.startingLength) || 3);
    const seq = Array.from({ length: len }, () => Math.floor(Math.random() * 4));
    seq.forEach((p, i) => {
      timers.current.push(window.setTimeout(() => setLit(p), i * 600));
      timers.current.push(window.setTimeout(() => setLit(-1), i * 600 + 350));
    });
    timers.current.push(window.setTimeout(() => { setBusy(false); onResult && onResult('Completed'); }, len * 600 + 200));
  };

  return (
    <div className="pv">
      <div className="pv-simon">
        {SIMON_PADS.map((p, i) => (
          <div key={p.k} className={`pv-pad ${lit === i ? 'lit' : ''}`} style={{ background: p.c, '--pad-c': p.c }} />
        ))}
      </div>
      {interactive && <button className="pv-btn" onClick={demo} disabled={busy}>{busy ? 'Watch…' : 'Demo sequence'}</button>}
    </div>
  );
}

