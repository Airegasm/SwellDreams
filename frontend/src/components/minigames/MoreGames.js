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
  const accum = useRef(0);

  const flip = () => {
    if (flipping) return;
    setLanded(null);
    const isHeads = Math.random() * 100 < (Number(config.headsWeight) ?? 50);
    const landing = isHeads ? 0 : 180;
    const cur = accum.current % 360;
    const next = accum.current + (((landing - cur) + 360) % 360) + 360 * 5;
    accum.current = next;
    setRot(next);
    setFlipping(true);
    window.setTimeout(() => { setFlipping(false); setLanded(isHeads ? 'Player' : 'Character'); onResult && onResult(isHeads ? heads : tails, isHeads ? 'Player' : 'Character'); }, 1500);
  };

  return (
    <div className="pv">
      <div className={`pv-coin-wrap ${landed ? 'landed' : ''}`}>
        <div className="pv-coin" style={{ transform: `rotateX(${rot}deg)`, transition: flipping ? 'transform 1.5s cubic-bezier(.2,.75,.2,1)' : 'none' }}>
          <div className="pv-coin-face pv-coin-h">{heads}</div>
          <div className="pv-coin-face pv-coin-t">{tails}</div>
        </div>
      </div>
      {interactive && <button className="pv-btn" onClick={flip} disabled={flipping}>{flipping ? 'Flipping…' : 'Flip'}</button>}
    </div>
  );
}

// ───────────────────────── Rock Paper Scissors ─────────────────────────
const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const RPS_KEYS = Object.keys(RPS);
const rpsJudge = (p, c) => (p === c ? 'Draw' : ((p === 'rock' && c === 'scissors') || (p === 'paper' && c === 'rock') || (p === 'scissors' && c === 'paper')) ? 'Win' : 'Lose');

export function MiniRPS({ interactive, onResult }) {
  const [p, setP] = useState('rock');
  const [c, setC] = useState('rock');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const play = () => {
    if (busy) return;
    setBusy(true); setRes(null);
    let n = 0;
    const iv = window.setInterval(() => {
      setP(rid(RPS_KEYS)); setC(rid(RPS_KEYS));
      if (++n > 8) {
        window.clearInterval(iv);
        const pp = rid(RPS_KEYS), cc = rid(RPS_KEYS);
        setP(pp); setC(cc);
        const r = rpsJudge(pp, cc);
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
      {interactive && <button className="pv-btn" onClick={play} disabled={busy}>{busy ? 'Throwing…' : 'Throw'}</button>}
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
            const tier = (config.exits || []).find(e => (e.pattern === 'three-of-a-kind' && max === 3) || ((e.pattern === 'two-of-a-kind' || e.pattern === 'any-pair') && max >= 2));
            if (tier) setWon(true);
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

// ───────────────────────── Timer ─────────────────────────
export function MiniTimer({ config = {}, interactive, onResult }) {
  const duration = Math.max(1, Number(config.duration) || 10);
  const [pct, setPct] = useState(0);
  const [running, setRunning] = useState(false);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  const stop = useCallback((auto) => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    const elapsed = (performance && performance.now ? performance.now() : Date.now()) - startRef.current;
    const t = elapsed / 1000;
    let result;
    if (config.precisionMode) {
      const win = Number(config.precisionWindow) || 1;
      const diff = Math.abs(t - duration);
      result = diff <= win * 0.3 ? 'Perfect' : diff <= win ? 'Close' : 'Miss';
    } else {
      result = (!auto && t <= duration) ? 'Success' : 'Fail';
    }
    onResult && onResult(result);
  }, [config.precisionMode, config.precisionWindow, duration, onResult]);

  const start = () => {
    if (running) return;
    setRunning(true);
    startRef.current = (performance && performance.now ? performance.now() : Date.now());
    const tick = () => {
      const elapsed = (performance && performance.now ? performance.now() : Date.now()) - startRef.current;
      const p = Math.min(1, elapsed / 1000 / duration);
      setPct(p);
      if (p >= 1) { stop(true); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const R = 52, C = 2 * Math.PI * R;
  // Colour shifts with progress. Precision: green only inside the target window near
  // the end; otherwise straight time-pressure green → amber → red.
  let ringColor = '#7b3fd6';
  if (config.precisionMode) {
    const win = (Number(config.precisionWindow) || 1) / duration;
    const d = Math.abs(pct - 1);
    ringColor = d <= win * 0.3 ? '#4ade80' : d <= win ? '#fbbf24' : '#f87171';
  } else {
    ringColor = pct < 0.5 ? '#4ade80' : pct < 0.8 ? '#fbbf24' : '#f87171';
  }
  return (
    <div className="pv">
      <svg className="pv-ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={R} className="pv-ring-bg" />
        <circle cx="60" cy="60" r={R} className="pv-ring-fg" style={{ stroke: ringColor }} strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        <text x="60" y="66" textAnchor="middle" className="pv-ring-txt">{(duration * (1 - pct)).toFixed(1)}s</text>
      </svg>
      {interactive && (running
        ? <button className="pv-btn" onClick={() => stop(false)}>Stop</button>
        : <button className="pv-btn" onClick={start}>Start</button>)}
    </div>
  );
}

// ───────────────────────── Number Guess ─────────────────────────
export function MiniNumberGuess({ config = {}, interactive, onResult }) {
  const min = Number(config.min) || 1, max = Number(config.max) || 10;
  const maxAttempts = Number(config.maxAttempts) || 3;
  const close = Number(config.closeThreshold) || 0;
  const [target, setTarget] = useState(() => min + Math.floor(Math.random() * (max - min + 1)));
  const [guess, setGuess] = useState('');
  const [left, setLeft] = useState(maxAttempts);
  const [feedback, setFeedback] = useState('');
  const [done, setDone] = useState(false);
  const [anim, setAnim] = useState('');
  const animRef = useRef(0);

  const reset = () => { setTarget(min + Math.floor(Math.random() * (max - min + 1))); setLeft(maxAttempts); setFeedback(''); setGuess(''); setDone(false); setAnim(''); };
  useEffect(reset, [config.min, config.max, config.maxAttempts]); // eslint-disable-line
  const pulse = (cls) => { setAnim(''); clearTimeout(animRef.current); animRef.current = window.setTimeout(() => setAnim(cls), 10); };
  useEffect(() => () => clearTimeout(animRef.current), []);

  const submit = () => {
    if (done) { reset(); return; }
    const g = parseInt(guess, 10);
    if (Number.isNaN(g)) return;
    const remaining = left - 1;
    if (g === target) { setFeedback('Correct!'); setDone(true); pulse('good'); onResult && onResult('Correct'); return; }
    if (remaining <= 0) {
      const res = close > 0 && Math.abs(g - target) <= close ? 'Close' : 'Failed';
      setFeedback(`${res} — it was ${target}`); setDone(true); pulse('bad'); onResult && onResult(res); return;
    }
    setLeft(remaining); setFeedback(g < target ? 'Higher ↑' : 'Lower ↓'); setGuess(''); pulse('bad');
  };

  return (
    <div className="pv pv-guess">
      <div className="pv-guess-range">{min} – {max}</div>
      <div className={`pv-guess-row ${anim}`}>
        <input type="text" inputMode="numeric" value={guess} onChange={(e) => setGuess(e.target.value.replace(/[^0-9]/g, ''))} placeholder="?" disabled={!interactive || done} />
        {interactive && <button className="pv-btn sm" onClick={submit}>{done ? 'Again' : 'Guess'}</button>}
      </div>
      <div className="pv-guess-meta">
        <span className={`pv-fb ${feedback.includes('Correct') ? 'good' : feedback.includes('Failed') ? 'bad' : ''}`}>{feedback || ' '}</span>
        <span className="pv-attempts">{left} left</span>
      </div>
    </div>
  );
}

// ───────────────────────── Card Draw ─────────────────────────
const SUITS = [{ s: '♥', c: 'red', n: 'Hearts' }, { s: '♦', c: 'red', n: 'Diamonds' }, { s: '♣', c: 'black', n: 'Clubs' }, { s: '♠', c: 'black', n: 'Spades' }];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export function MiniCardDraw({ config = {}, interactive, onResult }) {
  const [card, setCard] = useState(null);
  const [flipping, setFlipping] = useState(false);

  const draw = () => {
    if (flipping) return;
    setFlipping(true);
    const ranks = config.deckType === 'no-face' ? RANKS.filter(r => !'JQK'.includes(r)) : RANKS;
    const suit = rid(SUITS); const rank = rid(ranks);
    window.setTimeout(() => {
      setCard({ suit, rank });
      setFlipping(false);
      const mode = config.outputMode || 'suit';
      const ri = RANKS.indexOf(rank);
      const result = mode === 'color' ? (suit.c === 'red' ? 'Red' : 'Black')
        : mode === 'highlow' ? (ri >= 6 ? 'High' : 'Low')
        : suit.n;
      onResult && onResult(result);
    }, 350);
  };

  return (
    <div className="pv">
      <div className="pv-card-wrap">
        <div className={`pv-card ${flipping ? 'flipping' : ''} ${card?.suit.c || ''}`}>
          {card ? <><span className="pv-card-rank">{card.rank}</span><span className="pv-card-suit">{card.suit.s}</span></> : <span className="pv-card-back">🂠</span>}
        </div>
      </div>
      {interactive && <button className="pv-btn" onClick={draw} disabled={flipping}>Draw</button>}
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

// ───────────────────────── Reflex ─────────────────────────
export function MiniReflex({ config = {}, interactive, onResult }) {
  const rounds = Math.max(1, Number(config.rounds) || 5);
  const sizeMap = { small: 26, medium: 40, large: 56 };
  const dia = sizeMap[config.targetSize] || 34;
  const [pos, setPos] = useState(null);
  const [round, setRound] = useState(0);
  const [hits, setHits] = useState(0);
  const [active, setActive] = useState(false);
  const [flash, setFlash] = useState(false);
  const tRef = useRef(0);
  const fRef = useRef(0);

  const place = useCallback((r, h) => {
    if (r >= rounds) {
      setActive(false); setPos(null);
      onResult && onResult(h >= Math.ceil(rounds / 2) ? 'Completed' : 'Failed');
      return;
    }
    setPos({ x: 8 + Math.random() * 84, y: 8 + Math.random() * 84 });
    tRef.current = window.setTimeout(() => place(r + 1, h), Math.max(500, (Number(config.timePerTarget) || 3) * 1000));
  }, [rounds, config.timePerTarget, onResult]);

  const start = () => {
    if (active) return;
    setActive(true); setRound(0); setHits(0);
    place(0, 0);
  };
  const hit = () => {
    clearTimeout(tRef.current);
    setFlash(true);
    clearTimeout(fRef.current);
    fRef.current = window.setTimeout(() => setFlash(false), 140);
    const h = hits + 1, r = round + 1;
    setHits(h); setRound(r);
    place(r, h);
  };
  useEffect(() => () => { clearTimeout(tRef.current); clearTimeout(fRef.current); }, []);

  return (
    <div className="pv">
      <div className={`pv-reflex ${flash ? 'flash' : ''}`}>
        {pos && <button className="pv-target" style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: dia, height: dia }} onClick={hit} />}
        {!active && <span className="pv-reflex-hint">tap targets fast</span>}
      </div>
      <div className="pv-reflex-meta">{active ? `${round}/${rounds} · ${hits} hit` : `best of ${rounds}`}</div>
      {interactive && !active && <button className="pv-btn" onClick={start}>Start</button>}
    </div>
  );
}
