import React, { useState, useRef, useCallback } from 'react';
import './MiniWheel.css';

// Prize wheel — ported from PumpDirect (views/overlay.js): SVG wedges + a CSS-transition
// spin with cubic-bezier easing. Pure geometry below is copied verbatim; the DOM
// string-building became JSX + a rotation state.

const R = 90;
const CX = 100;
const CY = 100;

// SVG path for one wedge (verbatim from PumpDirect _wedgePath).
function wedgePath(cx, cy, r, startDeg, endDeg) {
  const toRad = (d) => ((d - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function weightedPick(segments) {
  const total = segments.reduce((s, x) => s + (Number(x.weight) > 0 ? Number(x.weight) : 1), 0);
  let r = Math.random() * total;
  for (let i = 0; i < segments.length; i++) {
    r -= Number(segments[i].weight) > 0 ? Number(segments[i].weight) : 1;
    if (r <= 0) return i;
  }
  return 0;
}

/**
 * @param {Array} segments  [{ label, color, weight }]
 * @param {number} size     px
 * @param {boolean} interactive  show a Spin button + report result
 * @param {function} onResult(segment, index)
 */
function MiniWheel({ segments = [], size = 240, interactive = false, onResult }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const accumRef = useRef(0);
  const segs = segments.length ? segments : [{ label: '—', color: '#3a3d45', weight: 1 }];
  const N = segs.length;
  const slice = 360 / N;

  const spin = useCallback(() => {
    if (spinning || N < 1) return;
    const target = weightedPick(segs);
    // 5 full turns + land the target wedge's centre under the top pointer.
    const landing = 360 * 5 - (target * slice + slice / 2);
    const next = accumRef.current + (((landing % 360) - (accumRef.current % 360) + 360) % 360) + 360 * 5;
    accumRef.current = next;
    setSpinning(true);
    setRotation(next);
    window.setTimeout(() => {
      setSpinning(false);
      onResult && onResult(segs[target], target);
    }, 4200);
  }, [spinning, N, slice, segs, onResult]);

  const fontSize = N <= 4 ? 12 : N <= 6 ? 10 : N <= 8 ? 8.5 : 7.5;

  return (
    <div className="mini-wheel" style={{ width: size }}>
      <svg viewBox="0 0 200 220" className="mini-wheel-svg" style={{ width: size, height: size }}>
        {/* top pointer */}
        <path d="M 100 4 L 92 20 L 108 20 Z" className="mini-wheel-pointer" />
        <g
          className="mini-wheel-rot"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? 'transform 4200ms cubic-bezier(.18,.7,.12,1)' : 'none',
          }}
        >
          {segs.map((s, i) => (
            <path key={`w-${i}`} d={wedgePath(CX, CY, R, i * slice, (i + 1) * slice)}
              fill={s.color || '#7b3fd6'} stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />
          ))}
          {segs.map((s, i) => {
            const rot = i * slice + slice / 2;
            const tx = 100, ty = 100 - R * 0.55;
            return (
              <g key={`l-${i}`} transform={`rotate(${rot.toFixed(2)} 100 100)`}>
                <text x={tx} y={ty} transform={`rotate(-90 ${tx} ${ty})`} textAnchor="middle"
                  fontSize={fontSize} fill="#fff" fontWeight="700" style={{ pointerEvents: 'none' }}>
                  {String(s.label || '').slice(0, 14)}
                </text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r="6" fill="#fff" />
        </g>
      </svg>
      {interactive && (
        <button type="button" className="mini-wheel-spin" onClick={spin} disabled={spinning}>
          {spinning ? 'Spinning…' : 'Spin'}
        </button>
      )}
    </div>
  );
}

export default MiniWheel;
