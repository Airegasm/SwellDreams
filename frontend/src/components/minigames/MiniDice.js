import React, { useState, useEffect, useCallback } from 'react';
import Lottie from 'lottie-react';
import './MiniDice.css';
import dice1 from './assets/dice/dice-1.json';
import dice2 from './assets/dice/dice-2.json';
import dice3 from './assets/dice/dice-3.json';
import dice4 from './assets/dice/dice-4.json';
import dice5 from './assets/dice/dice-5.json';
import dice6 from './assets/dice/dice-6.json';

// PumpDirect's Lottie dice (dice-number-1..6). Each animation rolls and settles on its
// number, so showing face N = playing the Nth animation once (loop=false holds last frame).
const DICE = [dice1, dice2, dice3, dice4, dice5, dice6];

/**
 * @param {number} diceCount
 * @param {Array} exits  [{ label, min, max }] — total is mapped to its range label
 * @param {boolean} interactive  show a Roll button + report the result
 * @param {function} onResult(rangeLabel, total)
 * @param {number} size  px per die
 */
function MiniDice({ diceCount = 2, exits = [], interactive = false, onResult, size = 84 }) {
  const count = Math.max(1, Math.min(6, Number(diceCount) || 1));
  const [faces, setFaces] = useState(() => Array.from({ length: count }, () => 1));
  const [rollId, setRollId] = useState(0);
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    setFaces(prev => Array.from({ length: count }, (_, i) => prev[i] || 1 + Math.floor(Math.random() * 6)));
  }, [count]);

  const roll = useCallback(() => {
    if (rolling) return;
    const next = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6));
    setFaces(next);
    setRollId(id => id + 1);
    setRolling(true);
    window.setTimeout(() => {
      setRolling(false);
      const total = next.reduce((a, b) => a + b, 0);
      const range = (exits || []).find(e => total >= Number(e.min) && total <= Number(e.max));
      onResult && onResult(range ? range.label : String(total), total);
    }, 1600);
  }, [rolling, count, exits, onResult]);

  return (
    <div className="mini-dice">
      <div className={`mini-dice-cluster dice-${count}`}>
        {faces.map((f, i) => (
          <div className="mini-die" key={i} style={{ width: size, height: size }}>
            <Lottie
              key={`${i}-${f}-${rollId}`}
              animationData={DICE[f - 1]}
              loop={false}
              autoplay
            />
          </div>
        ))}
      </div>
      {interactive && (
        <button type="button" className="mini-dice-roll" onClick={roll} disabled={rolling}>
          {rolling ? 'Rolling…' : 'Roll'}
        </button>
      )}
    </div>
  );
}

export default MiniDice;
