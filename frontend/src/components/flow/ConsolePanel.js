import React, { useState, useEffect, useRef } from 'react';
import './ConsolePanel.css';

const ICONS = {
  trigger: '⚡',
  button_press: '⚡',
  action: '▶',
  condition: '?',
  branch: '⑃',
  delay: '⏱',
  pause_resume: '⏸',
  challenge: '🎲',
  prize_wheel: '🎡',
  dice_roll: '🎲',
  coin_flip: '🪙',
  card_draw: '🃏',
  rps: '✊',
  number_guess: '🔢',
  timer_challenge: '⏱',
  slot_machine: '🎰',
  simon_challenge: '🧠',
  reflex_challenge: '🎯',
  player_choice: '❓',
  simple_ab: '❓',
  input: '⌨',
  random_number: '🎲',
  capacity_ai_message: '📊',
  capacity_player_message: '📊',
  device: '⚡',
  message: '💬',
  ai_message: '🤖',
  player_message: '🗣',
  system_message: 'ℹ',
  error: '✗',
  success: '✓',
  test_start: '▶',
  test_complete: '✓',
  node: '●',
  broadcast: '📢',
  state_change: '📊',
  pending_completion: '⏳',
  info: 'ℹ'
};

const CATEGORY_MAP = {
  trigger: 'trigger',
  button_press: 'trigger',
  action: 'action',
  condition: 'condition',
  branch: 'condition',
  delay: 'delay',
  pause_resume: 'delay',
  challenge: 'challenge',
  prize_wheel: 'challenge',
  dice_roll: 'challenge',
  coin_flip: 'challenge',
  card_draw: 'challenge',
  rps: 'challenge',
  number_guess: 'challenge',
  timer_challenge: 'challenge',
  slot_machine: 'challenge',
  simon_challenge: 'challenge',
  reflex_challenge: 'challenge',
  player_choice: 'choice',
  simple_ab: 'choice',
  input: 'action',
  random_number: 'action',
  capacity_ai_message: 'message',
  capacity_player_message: 'message',
  device: 'device',
  message: 'message',
  ai_message: 'message',
  player_message: 'message',
  system_message: 'info',
  error: 'error',
  success: 'success',
  test_start: 'success',
  test_complete: 'success',
  node: 'action',
  broadcast: 'broadcast',
  state_change: 'state',
  pending_completion: 'pending',
  info: 'info'
};

function ConsoleEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.details && entry.details.length > 0;
  const category = CATEGORY_MAP[entry.icon] || CATEGORY_MAP[entry.category] || 'info';

  return (
    <div
      className={`console-entry entry-${category} ${hasDetails ? 'has-details' : ''} ${expanded ? 'expanded' : ''}`}
      onClick={() => hasDetails && setExpanded(!expanded)}
    >
      <div className="entry-main">
        <span className="entry-time">{entry.time}</span>
        <span className="entry-icon">{ICONS[entry.icon] || ICONS[entry.category] || '•'}</span>
        <span className="entry-label">{entry.label}</span>
        {hasDetails && <span className="entry-expand-hint">{expanded ? '▼' : '▶'}</span>}
      </div>
      {hasDetails && expanded && (
        <div className="entry-details">
          {entry.details}
        </div>
      )}
    </div>
  );
}

export default function ConsolePanel({ entries, onClear, collapsed, onToggle }) {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current && autoScroll) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  // Detect manual scroll
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  if (collapsed) {
    return (
      <div className="console-panel collapsed" onClick={onToggle}>
        <span className="console-expand-hint">
          ◀ Console {entries.length > 0 && `(${entries.length})`}
        </span>
      </div>
    );
  }

  return (
    <div className="console-panel">
      <div className="console-header">
        <span className="console-title">Console</span>
        <div className="console-actions">
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }}
              title="Scroll to bottom"
              className="console-btn scroll-btn"
            >
              ↓
            </button>
          )}
          <button onClick={onClear} title="Clear console" className="console-btn">
            Clear
          </button>
          <button onClick={onToggle} title="Hide console" className="console-btn">
            ▶
          </button>
        </div>
      </div>
      <div className="console-body" ref={scrollRef} onScroll={handleScroll}>
        {entries.length === 0 ? (
          <div className="console-empty">
            Click "Test" on any node to see execution output
          </div>
        ) : (
          entries.map((entry, i) => <ConsoleEntry key={entry.id || i} entry={entry} />)
        )}
      </div>
    </div>
  );
}
