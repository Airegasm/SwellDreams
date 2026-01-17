import React, { memo, useState, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import ActionWrapper from './ActionWrapper';
import NumberInput from './NumberInput';
import './Nodes.css';
import './ChallengeNodes.css';

// Outcome Messages component for win/lose with suppress LLM option
function OutcomeMessages({ data }) {
  return (
    <div className="outcome-messages">
      <div className="ai-message-section">
        <label className="node-checkbox">
          <input
            type="checkbox"
            checked={data.aiMessageWinEnabled || false}
            onChange={(e) => data.onChange?.('aiMessageWinEnabled', e.target.checked)}
          />
          AI Message (Char Wins)
        </label>
        {data.aiMessageWinEnabled && (
          <>
            <textarea
              value={data.aiMessageWin || ''}
              onChange={(e) => data.onChange?.('aiMessageWin', e.target.value)}
              placeholder="Prompt for AI when character wins..."
              className="node-textarea"
              rows={2}
            />
            <label className="node-checkbox suppress-llm">
              <input
                type="checkbox"
                checked={data.aiMessageWinSuppressLlm || false}
                onChange={(e) => data.onChange?.('aiMessageWinSuppressLlm', e.target.checked)}
              />
              Suppress LLM Enhancement
            </label>
          </>
        )}
      </div>
      <div className="ai-message-section">
        <label className="node-checkbox">
          <input
            type="checkbox"
            checked={data.aiMessageLoseEnabled || false}
            onChange={(e) => data.onChange?.('aiMessageLoseEnabled', e.target.checked)}
          />
          AI Message (Char Loses)
        </label>
        {data.aiMessageLoseEnabled && (
          <>
            <textarea
              value={data.aiMessageLose || ''}
              onChange={(e) => data.onChange?.('aiMessageLose', e.target.value)}
              placeholder="Prompt for AI when character loses..."
              className="node-textarea"
              rows={2}
            />
            <label className="node-checkbox suppress-llm">
              <input
                type="checkbox"
                checked={data.aiMessageLoseSuppressLlm || false}
                onChange={(e) => data.onChange?.('aiMessageLoseSuppressLlm', e.target.checked)}
              />
              Suppress LLM Enhancement
            </label>
          </>
        )}
      </div>
    </div>
  );
}

// Default colors for wheel segments
const SEGMENT_COLORS = [
  '#fb923c', '#3b82f6', '#10b981', '#a855f7',
  '#ec4899', '#eab308', '#ef4444', '#14b8a6',
  '#6366f1', '#f97316', '#22c55e', '#8b5cf6'
];

// Prize Wheel Node
function PrizeWheelNode({ data, selected }) {
  const [segments, setSegments] = useState(data.segments || [
    { id: 'seg-1', label: 'Prize 1', color: SEGMENT_COLORS[0], weight: 1 },
    { id: 'seg-2', label: 'Prize 2', color: SEGMENT_COLORS[1], weight: 1 }
  ]);

  const addSegment = () => {
    if (segments.length >= 12) return;
    const newId = `seg-${Date.now()}`;
    const newSegments = [...segments, {
      id: newId,
      label: `Prize ${segments.length + 1}`,
      color: SEGMENT_COLORS[segments.length % SEGMENT_COLORS.length],
      weight: 1
    }];
    setSegments(newSegments);
    data.onChange?.('segments', newSegments);
  };

  const updateSegment = (index, key, value) => {
    const newSegments = [...segments];
    newSegments[index][key] = value;
    setSegments(newSegments);
    data.onChange?.('segments', newSegments);
  };

  const removeSegment = (index) => {
    if (segments.length <= 2) return;
    const newSegments = segments.filter((_, i) => i !== index);
    setSegments(newSegments);
    data.onChange?.('segments', newSegments);
  };

  return (
    <div className={`custom-node challenge-node prize-wheel-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🎡</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Prize Wheel"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="form-group">
              <label>Segments ({segments.length}/12):</label>
              <div className="segments-list">
                {segments.map((segment, index) => (
                  <div key={segment.id} className="segment-item">
                    <input
                      type="color"
                      value={segment.color}
                      onChange={(e) => updateSegment(index, 'color', e.target.value)}
                      className="segment-color"
                    />
                    <input
                      type="text"
                      value={segment.label}
                      onChange={(e) => updateSegment(index, 'label', e.target.value)}
                      placeholder={`Segment ${index + 1}`}
                      className="node-input"
                      style={{ flex: 1 }}
                    />
                    <NumberInput
                      value={segment.weight}
                      onChange={(val) => updateSegment(index, 'weight', Math.max(1, val))}
                      defaultValue={1}
                      min={1}
                      max={10}
                      className="node-input tiny"
                      allowFloat={false}
                      title="Weight (probability)"
                    />
                    {segments.length > 2 && (
                      <button
                        className="segment-remove"
                        onClick={() => removeSegment(index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {segments.length < 12 && (
                <button className="segment-add" onClick={addSegment}>
                  + Add Segment
                </button>
              )}
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      {segments.map((segment, index) => (
        <Handle
          key={segment.id}
          type="source"
          position={Position.Bottom}
          id={segment.id}
          style={{
            left: `${(index + 1) * (100 / (segments.length + 1))}%`,
            backgroundColor: segment.color
          }}
        />
      ))}
      <div className="handle-labels segment-labels">
        {segments.map((segment, index) => (
          <span
            key={segment.id}
            className="handle-label"
            style={{
              left: `${(index + 1) * (100 / (segments.length + 1))}%`,
              color: segment.color
            }}
          >
            {segment.label.substring(0, 8)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Dice Roll Node
function DiceRollNode({ data, selected }) {
  const [diceCount, setDiceCount] = useState(data.diceCount || 2);
  const [mode, setMode] = useState(data.mode || 'ranges');
  const [ranges, setRanges] = useState(data.ranges || [
    { id: 'range-1', label: 'Low', min: 2, max: 5 },
    { id: 'range-2', label: 'Medium', min: 6, max: 9 },
    { id: 'range-3', label: 'High', min: 10, max: 12 }
  ]);
  const [characterAdvantage, setCharacterAdvantage] = useState(data.characterAdvantage || 0);

  // Calculate min/max possible totals
  const minTotal = diceCount;
  const maxTotal = diceCount * 6;

  // Generate outputs based on mode - all modes include "Other" safety fallback
  const outputs = useMemo(() => {
    if (mode === 'direct') {
      // Each possible total gets its own output + Other fallback
      const results = [];
      for (let i = minTotal; i <= maxTotal; i++) {
        results.push({ id: `result-${i}`, label: `${i}` });
      }
      results.push({ id: 'other', label: 'Other' });
      return results;
    } else if (mode === 'ranges') {
      // Custom ranges + Other for unmatched totals
      return [
        ...ranges.map(r => ({ id: r.id, label: r.label })),
        { id: 'other', label: 'Other' }
      ];
    } else if (mode === 'against') {
      // Versus mode + Other safety fallback
      return [
        { id: 'player-wins', label: 'Player Wins' },
        { id: 'character-wins', label: 'Char Wins' },
        { id: 'tie', label: 'Tie' },
        { id: 'other', label: 'Other' }
      ];
    }
    return [];
  }, [mode, ranges, minTotal, maxTotal]);

  const handleDiceCountChange = (value) => {
    const count = Math.max(1, Math.min(10, parseInt(value) || 1));
    setDiceCount(count);
    data.onChange?.('diceCount', count);
  };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    data.onChange?.('mode', newMode);
  };

  const addRange = () => {
    if (ranges.length >= 6) return;
    const newId = `range-${Date.now()}`;
    const newRanges = [...ranges, {
      id: newId,
      label: `Range ${ranges.length + 1}`,
      min: minTotal,
      max: maxTotal
    }];
    setRanges(newRanges);
    data.onChange?.('ranges', newRanges);
  };

  const updateRange = (index, key, value) => {
    const newRanges = [...ranges];
    newRanges[index][key] = value;
    setRanges(newRanges);
    data.onChange?.('ranges', newRanges);
  };

  const removeRange = (index) => {
    if (ranges.length <= 2) return;
    const newRanges = ranges.filter((_, i) => i !== index);
    setRanges(newRanges);
    data.onChange?.('ranges', newRanges);
  };

  const handleAdvantageChange = (value) => {
    const adv = Math.max(-2, Math.min(2, parseInt(value) || 0));
    setCharacterAdvantage(adv);
    data.onChange?.('characterAdvantage', adv);
  };

  return (
    <div className={`custom-node challenge-node dice-roll-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🎲</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Dice Roll"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-row">
              <label>Dice:</label>
              <NumberInput
                value={diceCount}
                onChange={(val) => handleDiceCountChange(val)}
                defaultValue={2}
                min={1}
                max={10}
                className="node-input tiny"
                allowFloat={false}
              />
              <span className="dice-range">({minTotal}-{maxTotal})</span>
            </div>
            <div className="config-row">
              <label>Mode:</label>
              <select
                value={mode}
                onChange={(e) => handleModeChange(e.target.value)}
                className="node-select"
              >
                <option value="direct">Direct Result</option>
                <option value="ranges">Range Buckets</option>
                <option value="against">Roll Against</option>
              </select>
            </div>

            {mode === 'ranges' && (
              <div className="form-group">
                <label>Ranges:</label>
                <div className="ranges-list">
                  {ranges.map((range, index) => (
                    <div key={range.id} className="range-item">
                      <input
                        type="text"
                        value={range.label}
                        onChange={(e) => updateRange(index, 'label', e.target.value)}
                        placeholder="Label"
                        className="node-input"
                        style={{ width: '60px' }}
                      />
                      <NumberInput
                        value={range.min}
                        onChange={(val) => updateRange(index, 'min', val)}
                        defaultValue={minTotal}
                        min={minTotal}
                        max={maxTotal}
                        className="node-input tiny"
                        allowFloat={false}
                      />
                      <span className="range-separator">-</span>
                      <NumberInput
                        value={range.max}
                        onChange={(val) => updateRange(index, 'max', val)}
                        defaultValue={maxTotal}
                        min={minTotal}
                        max={maxTotal}
                        className="node-input tiny"
                        allowFloat={false}
                      />
                      {ranges.length > 2 && (
                        <button
                          className="range-remove"
                          onClick={() => removeRange(index)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {ranges.length < 6 && (
                  <button className="range-add" onClick={addRange}>
                    + Add Range
                  </button>
                )}
              </div>
            )}

            {mode === 'against' && (
              <div className="config-row">
                <label>Char +/-:</label>
                <NumberInput
                  value={characterAdvantage}
                  onChange={(val) => handleAdvantageChange(val)}
                  defaultValue={0}
                  min={-2}
                  max={2}
                  className="node-input tiny"
                  allowFloat={false}
                  title="Character advantage (-2 to +2)"
                />
              </div>
            )}

            {mode === 'direct' && (
              <div className="config-hint">
                Outputs: {minTotal} to {maxTotal} ({maxTotal - minTotal + 1} results)
              </div>
            )}
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      {outputs.map((output, index) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Bottom}
          id={output.id}
          style={{ left: `${(index + 1) * (100 / (outputs.length + 1))}%` }}
        />
      ))}
      <div className="handle-labels dice-labels">
        {outputs.slice(0, 8).map((output, index) => (
          <span
            key={output.id}
            className="handle-label"
            style={{ left: `${(index + 1) * (100 / (Math.min(outputs.length, 8) + 1))}%` }}
          >
            {output.label.substring(0, 6)}
          </span>
        ))}
        {outputs.length > 8 && (
          <span className="handle-label" style={{ left: '90%' }}>
            ...+{outputs.length - 8}
          </span>
        )}
      </div>
    </div>
  );
}

// Coin Flip Node
function CoinFlipNode({ data, selected }) {
  const [headsLabel, setHeadsLabel] = useState(data.headsLabel || 'Heads');
  const [tailsLabel, setTailsLabel] = useState(data.tailsLabel || 'Tails');
  const [headsWeight, setHeadsWeight] = useState(data.headsWeight ?? 50);
  const [bestOf, setBestOf] = useState(data.bestOf || 1);

  const handleHeadsLabelChange = (value) => {
    setHeadsLabel(value);
    data.onChange?.('headsLabel', value);
  };

  const handleTailsLabelChange = (value) => {
    setTailsLabel(value);
    data.onChange?.('tailsLabel', value);
  };

  const handleWeightChange = (value) => {
    const weight = Math.max(0, Math.min(100, parseInt(value) || 50));
    setHeadsWeight(weight);
    data.onChange?.('headsWeight', weight);
  };

  const handleBestOfChange = (value) => {
    setBestOf(parseInt(value) || 1);
    data.onChange?.('bestOf', parseInt(value) || 1);
  };

  return (
    <div className={`custom-node challenge-node coin-flip-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🪙</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Coin Flip"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="coin-options">
              <div className="coin-option">
                <label>Heads:</label>
                <input
                  type="text"
                  value={headsLabel}
                  onChange={(e) => handleHeadsLabelChange(e.target.value)}
                  placeholder="Heads"
                  className="node-input"
                />
              </div>
              <div className="coin-option">
                <label>Tails:</label>
                <input
                  type="text"
                  value={tailsLabel}
                  onChange={(e) => handleTailsLabelChange(e.target.value)}
                  placeholder="Tails"
                  className="node-input"
                />
              </div>
            </div>
            <div className="config-row">
              <label>Weight:</label>
              <NumberInput
                value={headsWeight}
                onChange={(val) => handleWeightChange(val)}
                defaultValue={50}
                min={0}
                max={100}
                className="node-input tiny"
                allowFloat={false}
              />
              <span className="weight-display">% heads</span>
            </div>
            <div className="config-row">
              <label>Best of:</label>
              <select
                value={bestOf}
                onChange={(e) => handleBestOfChange(e.target.value)}
                className="node-select"
              >
                <option value="1">Single flip</option>
                <option value="3">Best of 3</option>
                <option value="5">Best of 5</option>
                <option value="7">Best of 7</option>
              </select>
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="heads"
        style={{ left: '33%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="tails"
        style={{ left: '67%' }}
      />
      <div className="handle-labels coin-labels">
        <span className="handle-label" style={{ left: '33%', color: '#eab308' }}>
          {headsLabel.substring(0, 8)}
        </span>
        <span className="handle-label" style={{ left: '67%', color: '#eab308' }}>
          {tailsLabel.substring(0, 8)}
        </span>
      </div>
    </div>
  );
}

// Rock Paper Scissors Node
function RPSNode({ data, selected }) {
  const [bestOf, setBestOf] = useState(data.bestOf || 1);
  const [characterBias, setCharacterBias] = useState(data.characterBias || null);

  const handleBestOfChange = (value) => {
    setBestOf(parseInt(value) || 1);
    data.onChange?.('bestOf', parseInt(value) || 1);
  };

  const handleBiasChange = (value) => {
    const bias = value === 'random' ? null : value;
    setCharacterBias(bias);
    data.onChange?.('characterBias', bias);
  };

  return (
    <div className={`custom-node challenge-node rps-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">✊</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Rock Paper Scissors"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-row">
              <label>Best of:</label>
              <select
                value={bestOf}
                onChange={(e) => handleBestOfChange(e.target.value)}
                className="node-select"
              >
                <option value="1">Single round</option>
                <option value="3">Best of 3</option>
                <option value="5">Best of 5</option>
              </select>
            </div>
            <div className="config-row">
              <label>Char bias:</label>
              <select
                value={characterBias || 'random'}
                onChange={(e) => handleBiasChange(e.target.value)}
                className="node-select"
              >
                <option value="random">Random</option>
                <option value="rock">Prefers Rock</option>
                <option value="paper">Prefers Paper</option>
                <option value="scissors">Prefers Scissors</option>
              </select>
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="player-wins"
        style={{ left: '25%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="tie"
        style={{ left: '50%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="character-wins"
        style={{ left: '75%' }}
      />
      <div className="handle-labels rps-labels">
        <span className="handle-label" style={{ left: '25%', color: '#22c55e' }}>
          Win
        </span>
        <span className="handle-label" style={{ left: '50%', color: '#eab308' }}>
          Tie
        </span>
        <span className="handle-label" style={{ left: '75%', color: '#ef4444' }}>
          Lose
        </span>
      </div>
    </div>
  );
}

// Timer Challenge Node
function TimerChallengeNode({ data, selected }) {
  const [duration, setDuration] = useState(data.duration || 10);
  const [precisionMode, setPrecisionMode] = useState(data.precisionMode || false);
  const [precisionWindow, setPrecisionWindow] = useState(data.precisionWindow || 1);

  const handleDurationChange = (value) => {
    const dur = Math.max(3, Math.min(120, parseInt(value) || 10));
    setDuration(dur);
    data.onChange?.('duration', dur);
  };

  const handlePrecisionModeChange = (checked) => {
    setPrecisionMode(checked);
    data.onChange?.('precisionMode', checked);
  };

  const handlePrecisionWindowChange = (value) => {
    const win = Math.max(0.5, Math.min(5, parseFloat(value) || 1));
    setPrecisionWindow(win);
    data.onChange?.('precisionWindow', win);
  };

  return (
    <div className={`custom-node challenge-node timer-challenge-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">⏱️</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Timer Challenge"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-row">
              <label>Duration:</label>
              <NumberInput
                value={duration}
                onChange={(val) => handleDurationChange(val)}
                defaultValue={10}
                min={3}
                max={120}
                className="node-input small"
                allowFloat={false}
              />
              <span>sec</span>
            </div>
            <label className="node-checkbox">
              <input
                type="checkbox"
                checked={precisionMode}
                onChange={(e) => handlePrecisionModeChange(e.target.checked)}
              />
              Precision Mode
            </label>
            {precisionMode && (
              <div className="config-row">
                <label>Window:</label>
                <NumberInput
                  value={precisionWindow}
                  onChange={(val) => handlePrecisionWindowChange(val)}
                  defaultValue={1}
                  min={0.5}
                  max={5}
                  step={0.5}
                  className="node-input small"
                  allowFloat={true}
                />
                <span>sec</span>
              </div>
            )}
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="success"
        style={{ left: '33%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="timeout"
        style={{ left: '67%' }}
      />
      <div className="handle-labels timer-labels">
        <span className="handle-label" style={{ left: '33%', color: '#22c55e' }}>
          Success
        </span>
        <span className="handle-label" style={{ left: '67%', color: '#ef4444' }}>
          Timeout
        </span>
      </div>
    </div>
  );
}

// Number Guess Node
function NumberGuessNode({ data, selected }) {
  const [min, setMin] = useState(data.min ?? 1);
  const [max, setMax] = useState(data.max ?? 10);
  const [maxAttempts, setMaxAttempts] = useState(data.maxAttempts ?? 3);
  const [closeThreshold, setCloseThreshold] = useState(data.closeThreshold ?? 0);

  const handleMinChange = (value) => {
    const val = parseInt(value) || 1;
    setMin(val);
    data.onChange?.('min', val);
  };

  const handleMaxChange = (value) => {
    const val = parseInt(value) || 10;
    setMax(val);
    data.onChange?.('max', val);
  };

  const handleMaxAttemptsChange = (value) => {
    const val = Math.max(0, parseInt(value) || 0);
    setMaxAttempts(val);
    data.onChange?.('maxAttempts', val);
  };

  const handleCloseThresholdChange = (value) => {
    const val = Math.max(0, parseInt(value) || 0);
    setCloseThreshold(val);
    data.onChange?.('closeThreshold', val);
  };

  // Outputs depend on closeThreshold
  const hasCloseOutput = closeThreshold > 0;

  return (
    <div className={`custom-node challenge-node number-guess-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🔢</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Number Guess"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-row">
              <label>Range:</label>
              <NumberInput
                value={min}
                onChange={(val) => handleMinChange(val)}
                defaultValue={1}
                className="node-input tiny"
                allowFloat={false}
              />
              <span className="range-separator">to</span>
              <NumberInput
                value={max}
                onChange={(val) => handleMaxChange(val)}
                defaultValue={10}
                className="node-input tiny"
                allowFloat={false}
              />
            </div>
            <div className="config-row">
              <label>Attempts:</label>
              <NumberInput
                value={maxAttempts}
                onChange={(val) => handleMaxAttemptsChange(val)}
                defaultValue={3}
                min={0}
                className="node-input tiny"
                allowFloat={false}
                title="0 = unlimited"
              />
              <span className="config-hint">(0=∞)</span>
            </div>
            <div className="config-row">
              <label>Close if ±:</label>
              <NumberInput
                value={closeThreshold}
                onChange={(val) => handleCloseThresholdChange(val)}
                defaultValue={0}
                min={0}
                className="node-input tiny"
                allowFloat={false}
                title="0 = exact only"
              />
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="correct"
        style={{ left: hasCloseOutput ? '25%' : '33%' }}
      />
      {hasCloseOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="close"
          style={{ left: '50%' }}
        />
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        id="wrong"
        style={{ left: hasCloseOutput ? '75%' : '67%' }}
      />
      <div className="handle-labels number-guess-labels">
        <span className="handle-label" style={{ left: hasCloseOutput ? '25%' : '33%', color: '#22c55e' }}>
          Correct
        </span>
        {hasCloseOutput && (
          <span className="handle-label" style={{ left: '50%', color: '#eab308' }}>
            Close
          </span>
        )}
        <span className="handle-label" style={{ left: hasCloseOutput ? '75%' : '67%', color: '#ef4444' }}>
          Wrong
        </span>
      </div>
    </div>
  );
}

// Slot Machine Node
function SlotMachineNode({ data, selected }) {
  const defaultSymbols = ['🍒', '🍋', '🔔', '⭐', '7️⃣'];
  const [symbols, setSymbols] = useState(data.symbols || defaultSymbols);
  const [matches, setMatches] = useState(data.matches || [
    { id: 'match-1', pattern: 'three-of-a-kind', label: 'Jackpot' },
    { id: 'match-2', pattern: 'two-of-a-kind', label: 'Small Win' }
  ]);

  const addMatch = () => {
    if (matches.length >= 5) return;
    const newId = `match-${Date.now()}`;
    const newMatches = [...matches, {
      id: newId,
      pattern: 'two-of-a-kind',
      label: `Match ${matches.length + 1}`
    }];
    setMatches(newMatches);
    data.onChange?.('matches', newMatches);
  };

  const updateMatch = (index, key, value) => {
    const newMatches = [...matches];
    newMatches[index][key] = value;
    setMatches(newMatches);
    data.onChange?.('matches', newMatches);
  };

  const removeMatch = (index) => {
    if (matches.length <= 1) return;
    const newMatches = matches.filter((_, i) => i !== index);
    setMatches(newMatches);
    data.onChange?.('matches', newMatches);
  };

  const handleSymbolsChange = (value) => {
    const syms = value.split(',').map(s => s.trim()).filter(s => s);
    setSymbols(syms.length > 0 ? syms : defaultSymbols);
    data.onChange?.('symbols', syms.length > 0 ? syms : defaultSymbols);
  };

  // Outputs: each match pattern + "Other" fallback for unmatched
  const outputs = [
    ...matches.map(m => ({ id: m.id, label: m.label })),
    { id: 'other', label: 'Other' }
  ];

  return (
    <div className={`custom-node challenge-node slot-machine-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🎰</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Slot Machine"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="form-group">
              <label>Symbols (comma-separated):</label>
              <input
                type="text"
                value={symbols.join(', ')}
                onChange={(e) => handleSymbolsChange(e.target.value)}
                className="node-input"
                placeholder="🍒, 🍋, 🔔, ⭐, 7️⃣"
              />
            </div>
            <div className="form-group">
              <label>Match Patterns:</label>
              <div className="matches-list">
                {matches.map((match, index) => (
                  <div key={match.id} className="match-item">
                    <select
                      value={match.pattern}
                      onChange={(e) => updateMatch(index, 'pattern', e.target.value)}
                      className="node-select"
                    >
                      <option value="three-of-a-kind">3 of a Kind</option>
                      <option value="two-of-a-kind">2 of a Kind</option>
                      <option value="any-7">Any 7️⃣</option>
                    </select>
                    <input
                      type="text"
                      value={match.label}
                      onChange={(e) => updateMatch(index, 'label', e.target.value)}
                      className="node-input"
                      placeholder="Label"
                      style={{ width: '70px' }}
                    />
                    {matches.length > 1 && (
                      <button
                        className="match-remove"
                        onClick={() => removeMatch(index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {matches.length < 5 && (
                <button className="match-add" onClick={addMatch}>
                  + Add Match
                </button>
              )}
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      {outputs.map((output, index) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Bottom}
          id={output.id}
          style={{ left: `${(index + 1) * (100 / (outputs.length + 1))}%` }}
        />
      ))}
      <div className="handle-labels slot-labels">
        {outputs.map((output, index) => (
          <span
            key={output.id}
            className="handle-label"
            style={{
              left: `${(index + 1) * (100 / (outputs.length + 1))}%`,
              color: output.id === 'other' ? '#ef4444' : '#7c3aed'
            }}
          >
            {output.label.substring(0, 8)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Card Draw Node
function CardDrawNode({ data, selected }) {
  const [deckType, setDeckType] = useState(data.deckType || 'standard');
  const [outputMode, setOutputMode] = useState(data.outputMode || 'suit');

  const handleDeckTypeChange = (value) => {
    setDeckType(value);
    data.onChange?.('deckType', value);
  };

  const handleOutputModeChange = (value) => {
    setOutputMode(value);
    data.onChange?.('outputMode', value);
  };

  // Generate outputs based on mode
  const outputs = useMemo(() => {
    if (outputMode === 'suit') {
      return [
        { id: 'hearts', label: '♥ Hearts' },
        { id: 'diamonds', label: '♦ Diamonds' },
        { id: 'clubs', label: '♣ Clubs' },
        { id: 'spades', label: '♠ Spades' }
      ];
    } else if (outputMode === 'color') {
      return [
        { id: 'red', label: 'Red' },
        { id: 'black', label: 'Black' }
      ];
    } else if (outputMode === 'range') {
      return [
        { id: 'low', label: 'A-5' },
        { id: 'mid', label: '6-10' },
        { id: 'face', label: 'Face' }
      ];
    }
    return [];
  }, [outputMode]);

  return (
    <div className={`custom-node challenge-node card-draw-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🃏</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Card Draw"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-row">
              <label>Deck:</label>
              <select
                value={deckType}
                onChange={(e) => handleDeckTypeChange(e.target.value)}
                className="node-select"
              >
                <option value="standard">Standard 52</option>
                <option value="tarot">Tarot Major</option>
              </select>
            </div>
            <div className="config-row">
              <label>Output:</label>
              <select
                value={outputMode}
                onChange={(e) => handleOutputModeChange(e.target.value)}
                className="node-select"
              >
                <option value="suit">By Suit</option>
                <option value="color">By Color</option>
                <option value="range">By Range</option>
              </select>
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      {outputs.map((output, index) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Bottom}
          id={output.id}
          style={{ left: `${(index + 1) * (100 / (outputs.length + 1))}%` }}
        />
      ))}
      <div className="handle-labels card-labels">
        {outputs.map((output, index) => (
          <span
            key={output.id}
            className="handle-label"
            style={{
              left: `${(index + 1) * (100 / (outputs.length + 1))}%`,
              color: output.id === 'hearts' || output.id === 'diamonds' || output.id === 'red' ? '#ef4444' : '#1e293b'
            }}
          >
            {output.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Simon Challenge Node
function SimonChallengeNode({ data, selected }) {
  const [startingLength, setStartingLength] = useState(data.startingLength ?? 3);
  const [maxLength, setMaxLength] = useState(data.maxLength ?? 8);
  const [maxMisses, setMaxMisses] = useState(data.maxMisses ?? 3);
  const [penaltyDevice, setPenaltyDevice] = useState(data.penaltyDevice || '');
  const [penaltyDuration, setPenaltyDuration] = useState(data.penaltyDuration ?? 3);
  const [grandPenaltyDevice, setGrandPenaltyDevice] = useState(data.grandPenaltyDevice || '');
  const [grandPenaltyDuration, setGrandPenaltyDuration] = useState(data.grandPenaltyDuration ?? 10);
  const [rewardDevice, setRewardDevice] = useState(data.rewardDevice || '');
  const [rewardDuration, setRewardDuration] = useState(data.rewardDuration ?? 5);

  const devices = data.devices || [];

  const handleStartingLengthChange = (value) => {
    const val = Math.max(2, Math.min(6, parseInt(value) || 3));
    setStartingLength(val);
    data.onChange?.('startingLength', val);
  };

  const handleMaxLengthChange = (value) => {
    const val = Math.max(4, Math.min(12, parseInt(value) || 8));
    setMaxLength(val);
    data.onChange?.('maxLength', val);
  };

  const handleMaxMissesChange = (value) => {
    const val = Math.max(1, Math.min(10, parseInt(value) || 3));
    setMaxMisses(val);
    data.onChange?.('maxMisses', val);
  };

  const handlePenaltyDeviceChange = (value) => {
    setPenaltyDevice(value);
    data.onChange?.('penaltyDevice', value);
  };

  const handlePenaltyDurationChange = (value) => {
    const val = Math.max(1, Math.min(60, parseInt(value) || 3));
    setPenaltyDuration(val);
    data.onChange?.('penaltyDuration', val);
  };

  const handleGrandPenaltyDeviceChange = (value) => {
    setGrandPenaltyDevice(value);
    data.onChange?.('grandPenaltyDevice', value);
  };

  const handleGrandPenaltyDurationChange = (value) => {
    const val = Math.max(1, Math.min(120, parseInt(value) || 10));
    setGrandPenaltyDuration(val);
    data.onChange?.('grandPenaltyDuration', val);
  };

  const handleRewardDeviceChange = (value) => {
    setRewardDevice(value);
    data.onChange?.('rewardDevice', value);
  };

  const handleRewardDurationChange = (value) => {
    const val = Math.max(1, Math.min(60, parseInt(value) || 5));
    setRewardDuration(val);
    data.onChange?.('rewardDuration', val);
  };

  return (
    <div className={`custom-node challenge-node simon-challenge-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🎵</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Simon Challenge"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-section-label">Sequence Settings</div>
            <div className="config-row">
              <label>Start Length:</label>
              <NumberInput
                value={startingLength}
                onChange={(val) => handleStartingLengthChange(val)}
                defaultValue={3}
                min={2}
                max={6}
                className="node-input tiny"
                allowFloat={false}
              />
            </div>
          <div className="config-row">
            <label>Max Length:</label>
            <NumberInput
              value={maxLength}
              onChange={(val) => handleMaxLengthChange(val)}
              defaultValue={8}
              min={4}
              max={12}
              className="node-input tiny"
              allowFloat={false}
            />
          </div>

          <div className="config-section-label">Per-Miss Penalty</div>
          <div className="config-row">
            <label>Device:</label>
            <select
              value={penaltyDevice}
              onChange={(e) => handlePenaltyDeviceChange(e.target.value)}
              className="node-select"
            >
              <option value="">None</option>
              {devices.map(d => (
                <option key={d.alias || d.ip} value={d.alias || d.ip}>
                  {d.name || d.alias || d.ip}
                </option>
              ))}
            </select>
          </div>
          <div className="config-row">
            <label>Duration:</label>
            <NumberInput
              value={penaltyDuration}
              onChange={(val) => handlePenaltyDurationChange(val)}
              defaultValue={3}
              min={1}
              max={60}
              className="node-input tiny"
              allowFloat={false}
            />
            <span>sec</span>
          </div>
          <div className="config-row">
            <label>Max Misses:</label>
            <NumberInput
              value={maxMisses}
              onChange={(val) => handleMaxMissesChange(val)}
              defaultValue={3}
              min={1}
              max={10}
              className="node-input tiny"
              allowFloat={false}
            />
          </div>

          <div className="config-section-label">Grand Penalty (Lose)</div>
          <div className="config-row">
            <label>Device:</label>
            <select
              value={grandPenaltyDevice}
              onChange={(e) => handleGrandPenaltyDeviceChange(e.target.value)}
              className="node-select"
            >
              <option value="">None</option>
              {devices.map(d => (
                <option key={d.alias || d.ip} value={d.alias || d.ip}>
                  {d.name || d.alias || d.ip}
                </option>
              ))}
            </select>
          </div>
          <div className="config-row">
            <label>Duration:</label>
            <NumberInput
              value={grandPenaltyDuration}
              onChange={(val) => handleGrandPenaltyDurationChange(val)}
              defaultValue={10}
              min={1}
              max={120}
              className="node-input tiny"
              allowFloat={false}
            />
            <span>sec</span>
          </div>

          <div className="config-section-label">Reward (Win)</div>
          <div className="config-row">
            <label>Device:</label>
            <select
              value={rewardDevice}
              onChange={(e) => handleRewardDeviceChange(e.target.value)}
              className="node-select"
            >
              <option value="">None</option>
              {devices.map(d => (
                <option key={d.alias || d.ip} value={d.alias || d.ip}>
                  {d.name || d.alias || d.ip}
                </option>
              ))}
            </select>
          </div>
          <div className="config-row">
            <label>Duration:</label>
            <NumberInput
              value={rewardDuration}
              onChange={(val) => handleRewardDurationChange(val)}
              defaultValue={5}
              min={1}
              max={60}
              className="node-input tiny"
              allowFloat={false}
            />
            <span>sec</span>
          </div>
        </div>
        <OutcomeMessages data={data} />
      </ActionWrapper>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="win"
        style={{ left: '33%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="lose"
        style={{ left: '67%' }}
      />
      <div className="handle-labels simon-labels">
        <span className="handle-label" style={{ left: '33%', color: '#22c55e' }}>
          Win
        </span>
        <span className="handle-label" style={{ left: '67%', color: '#ef4444' }}>
          Lose
        </span>
      </div>
    </div>
  );
}

// Reflex Challenge Node
function ReflexChallengeNode({ data, selected }) {
  const [timePerTarget, setTimePerTarget] = useState(data.timePerTarget ?? 3);
  const [rounds, setRounds] = useState(data.rounds ?? 5);
  const [targetSize, setTargetSize] = useState(data.targetSize || 'small');
  const [penaltyDevice, setPenaltyDevice] = useState(data.penaltyDevice || '');
  const [penaltyDuration, setPenaltyDuration] = useState(data.penaltyDuration ?? 3);
  const [grandPenaltyDevice, setGrandPenaltyDevice] = useState(data.grandPenaltyDevice || '');
  const [grandPenaltyDuration, setGrandPenaltyDuration] = useState(data.grandPenaltyDuration ?? 10);
  const [rewardDevice, setRewardDevice] = useState(data.rewardDevice || '');
  const [rewardDuration, setRewardDuration] = useState(data.rewardDuration ?? 5);

  const devices = data.devices || [];

  const handleTimePerTargetChange = (value) => {
    const val = Math.max(1, Math.min(10, parseFloat(value) || 3));
    setTimePerTarget(val);
    data.onChange?.('timePerTarget', val);
  };

  const handleRoundsChange = (value) => {
    const val = parseInt(value) || 5;
    setRounds(val);
    data.onChange?.('rounds', val);
  };

  const handleTargetSizeChange = (value) => {
    setTargetSize(value);
    data.onChange?.('targetSize', value);
  };

  const handlePenaltyDeviceChange = (value) => {
    setPenaltyDevice(value);
    data.onChange?.('penaltyDevice', value);
  };

  const handlePenaltyDurationChange = (value) => {
    const val = Math.max(1, Math.min(60, parseInt(value) || 3));
    setPenaltyDuration(val);
    data.onChange?.('penaltyDuration', val);
  };

  const handleGrandPenaltyDeviceChange = (value) => {
    setGrandPenaltyDevice(value);
    data.onChange?.('grandPenaltyDevice', value);
  };

  const handleGrandPenaltyDurationChange = (value) => {
    const val = Math.max(1, Math.min(120, parseInt(value) || 10));
    setGrandPenaltyDuration(val);
    data.onChange?.('grandPenaltyDuration', val);
  };

  const handleRewardDeviceChange = (value) => {
    setRewardDevice(value);
    data.onChange?.('rewardDevice', value);
  };

  const handleRewardDurationChange = (value) => {
    const val = Math.max(1, Math.min(60, parseInt(value) || 5));
    setRewardDuration(val);
    data.onChange?.('rewardDuration', val);
  };

  return (
    <div className={`custom-node challenge-node reflex-challenge-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">🎯</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Reflex Challenge"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <ActionWrapper data={data}>
          <div className="node-config">
            <div className="config-section-label">Game Settings</div>
            <div className="config-row">
              <label>Time/Target:</label>
              <NumberInput
                value={timePerTarget}
                onChange={(val) => handleTimePerTargetChange(val)}
                defaultValue={3}
                min={1}
                max={10}
                step={0.5}
                className="node-input tiny"
                allowFloat={true}
              />
              <span>sec</span>
            </div>
            <div className="config-row">
              <label>Rounds:</label>
              <select
                value={rounds}
                onChange={(e) => handleRoundsChange(e.target.value)}
                className="node-select"
              >
                <option value="3">3 rounds</option>
                <option value="5">5 rounds</option>
                <option value="7">7 rounds</option>
                <option value="10">10 rounds</option>
                <option value="15">15 rounds</option>
              </select>
            </div>
            <div className="config-row">
              <label>Target Size:</label>
              <select
                value={targetSize}
                onChange={(e) => handleTargetSizeChange(e.target.value)}
                className="node-select"
              >
                <option value="large">Large (60px)</option>
                <option value="medium">Medium (45px)</option>
                <option value="small">Small (32px)</option>
                <option value="tiny">Tiny (24px)</option>
                <option value="minuscule">Minuscule (16px)</option>
              </select>
            </div>

            <div className="config-section-label">Per-Miss Penalty</div>
            <div className="config-row">
              <label>Device:</label>
              <select
                value={penaltyDevice}
                onChange={(e) => handlePenaltyDeviceChange(e.target.value)}
                className="node-select"
              >
                <option value="">None</option>
                {devices.map(d => (
                  <option key={d.alias || d.ip} value={d.alias || d.ip}>
                    {d.name || d.alias || d.ip}
                  </option>
                ))}
              </select>
            </div>
            <div className="config-row">
              <label>Duration:</label>
              <NumberInput
                value={penaltyDuration}
                onChange={(val) => handlePenaltyDurationChange(val)}
                defaultValue={3}
                min={1}
                max={60}
                className="node-input tiny"
                allowFloat={false}
              />
              <span>sec</span>
            </div>

            <div className="config-section-label">Grand Penalty (Lose)</div>
            <div className="config-row">
              <label>Device:</label>
              <select
                value={grandPenaltyDevice}
                onChange={(e) => handleGrandPenaltyDeviceChange(e.target.value)}
                className="node-select"
              >
                <option value="">None</option>
                {devices.map(d => (
                  <option key={d.alias || d.ip} value={d.alias || d.ip}>
                    {d.name || d.alias || d.ip}
                  </option>
                ))}
              </select>
            </div>
            <div className="config-row">
              <label>Duration:</label>
              <NumberInput
                value={grandPenaltyDuration}
                onChange={(val) => handleGrandPenaltyDurationChange(val)}
                defaultValue={10}
                min={1}
                max={120}
                className="node-input tiny"
                allowFloat={false}
              />
              <span>sec</span>
            </div>

            <div className="config-section-label">Reward (Win)</div>
            <div className="config-row">
              <label>Device:</label>
              <select
                value={rewardDevice}
                onChange={(e) => handleRewardDeviceChange(e.target.value)}
                className="node-select"
              >
                <option value="">None</option>
                {devices.map(d => (
                  <option key={d.alias || d.ip} value={d.alias || d.ip}>
                    {d.name || d.alias || d.ip}
                  </option>
                ))}
              </select>
            </div>
            <div className="config-row">
              <label>Duration:</label>
              <NumberInput
                value={rewardDuration}
                onChange={(val) => handleRewardDurationChange(val)}
                defaultValue={5}
                min={1}
                max={60}
                className="node-input tiny"
                allowFloat={false}
              />
              <span>sec</span>
            </div>
          </div>
          <OutcomeMessages data={data} />
        </ActionWrapper>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="win"
        style={{ left: '33%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="lose"
        style={{ left: '67%' }}
      />
      <div className="handle-labels reflex-labels">
        <span className="handle-label" style={{ left: '33%', color: '#22c55e' }}>
          Win
        </span>
        <span className="handle-label" style={{ left: '67%', color: '#ef4444' }}>
          Lose
        </span>
      </div>
    </div>
  );
}

export const PrizeWheelNodeMemo = memo(PrizeWheelNode);
export const DiceRollNodeMemo = memo(DiceRollNode);
export const CoinFlipNodeMemo = memo(CoinFlipNode);
export const RPSNodeMemo = memo(RPSNode);
export const TimerChallengeNodeMemo = memo(TimerChallengeNode);
export const NumberGuessNodeMemo = memo(NumberGuessNode);
export const SlotMachineNodeMemo = memo(SlotMachineNode);
export const CardDrawNodeMemo = memo(CardDrawNode);
export const SimonChallengeNodeMemo = memo(SimonChallengeNode);
export const ReflexChallengeNodeMemo = memo(ReflexChallengeNode);

export {
  PrizeWheelNode,
  DiceRollNode,
  CoinFlipNode,
  RPSNode,
  TimerChallengeNode,
  NumberGuessNode,
  SlotMachineNode,
  CardDrawNode,
  SimonChallengeNode,
  ReflexChallengeNode
};
