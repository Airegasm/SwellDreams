import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ChallengeModals.css';

// Prize Wheel Modal
export function PrizeWheelModal({ challengeData, onResult, onCancel, compact = false }) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState(null);
  const [hasAutoSpun, setHasAutoSpun] = useState(false);
  const canvasRef = useRef(null);
  const handleSpinRef = useRef(null);

  const { segments: rawSegments = [], autoSpin = false } = challengeData || {};
  const canvasSize = compact ? 180 : 300;

  // Expand segments based on duplicates field, then distribute evenly
  const segments = React.useMemo(() => {
    // First, collect all expanded segments grouped by original segment
    const groups = rawSegments.map((seg, idx) => {
      const dupes = Math.min(Math.max(seg.duplicates || 1, 1), 10); // Clamp 1-10
      const items = [];
      for (let i = 0; i < dupes; i++) {
        items.push({ ...seg, _originalIndex: idx });
      }
      return items;
    });

    // Interleave segments from each group to distribute them around the wheel
    // e.g., [A,A,A,A] and [B,B,B,B] becomes [A,B,A,B,A,B,A,B]
    const distributed = [];
    const maxLen = Math.max(...groups.map(g => g.length));
    for (let i = 0; i < maxLen; i++) {
      for (const group of groups) {
        if (i < group.length) {
          distributed.push(group[i]);
        }
      }
    }
    return distributed;
  }, [rawSegments]);

  // Draw the wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || segments.length === 0) return;

    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const totalWeight = segments.reduce((sum, s) => sum + (s.weight || 1), 0);
    let startAngle = -Math.PI / 2 + (rotation * Math.PI / 180);

    segments.forEach((segment) => {
      const sliceAngle = (2 * Math.PI * (segment.weight || 1)) / totalWeight;

      // Draw slice
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = segment.color || '#3b82f6';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw label along the segment (radial, like a spoke)
      const midAngle = startAngle + sliceAngle / 2;
      const label = segment.label.substring(0, 12);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(midAngle);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 3;
      // Draw text starting from near center, going outward
      ctx.fillText(label, 30, 0);
      ctx.restore();

      startAngle += sliceAngle;
    });

    // Draw center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, 20, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw pointer (top)
    ctx.beginPath();
    ctx.moveTo(centerX - 15, 5);
    ctx.lineTo(centerX + 15, 5);
    ctx.lineTo(centerX, 35);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [segments, rotation]);

  const handleSpin = useCallback(() => {
    if (isSpinning || segments.length === 0) return;

    setIsSpinning(true);
    setResult(null);

    // Calculate weighted random segment
    const totalWeight = segments.reduce((sum, s) => sum + (s.weight || 1), 0);
    let random = Math.random() * totalWeight;
    let selectedIndex = 0;
    for (let i = 0; i < segments.length; i++) {
      random -= (segments[i].weight || 1);
      if (random <= 0) {
        selectedIndex = i;
        break;
      }
    }

    // Calculate the angle to land on selected segment
    let cumulativeWeight = 0;
    for (let i = 0; i < selectedIndex; i++) {
      cumulativeWeight += (segments[i].weight || 1);
    }
    const segmentMiddle = cumulativeWeight + (segments[selectedIndex].weight || 1) / 2;
    const targetAngle = (segmentMiddle / totalWeight) * 360;

    // Calculate final rotation properly accounting for current rotation
    // We want: (finalRotation + targetAngle) % 360 ≈ 0 (segment at top)
    const spins = 4 + Math.random() * 6; // 4-10 full spins
    const desiredAngle = (360 - targetAngle + 360) % 360; // Where rotation needs to end (mod 360)
    const currentAngle = rotation % 360;
    const deltaAngle = (desiredAngle - currentAngle + 360) % 360; // Extra rotation needed
    const finalRotation = rotation + spins * 360 + deltaAngle;

    // Animate with randomized duration
    let currentRotation = rotation;
    const duration = 3000 + Math.random() * 3000; // 3-6 seconds
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Easing function (ease out cubic)
      const eased = 1 - Math.pow(1 - progress, 3);
      currentRotation = rotation + (finalRotation - rotation) * eased;
      setRotation(currentRotation);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsSpinning(false);
        const selectedSegment = segments[selectedIndex];
        setResult(selectedSegment);

        // Check if this is a spin_again segment
        if (selectedSegment.segmentType === 'spin_again') {
          // Reset result after brief display and allow another spin
          setTimeout(() => {
            setResult(null);
          }, 1500);
        } else {
          // Auto-submit after showing result - pass extended result object
          setTimeout(() => {
            onResult({
              outputId: selectedSegment.id,
              segmentLabel: selectedSegment.label,
              value: selectedSegment.label, // For resultVariable assignment
              targetPageId: selectedSegment.targetPageId,
              allSegments: segments.map(s => s.label)
            });
          }, 1500);
        }
      }
    };

    requestAnimationFrame(animate);
  }, [isSpinning, segments, rotation, onResult]);

  // Keep ref updated with latest handleSpin
  useEffect(() => {
    handleSpinRef.current = handleSpin;
  }, [handleSpin]);

  // Auto-spin on mount if enabled
  useEffect(() => {
    if (autoSpin && !hasAutoSpun && segments.length > 0 && !isSpinning) {
      setHasAutoSpun(true);
      // Small delay to ensure wheel is rendered
      const timer = setTimeout(() => {
        handleSpinRef.current?.();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoSpin, hasAutoSpun, segments.length, isSpinning]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal prize-wheel-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎡 Spin the Wheel!</h3>
        {onCancel && !isSpinning && !result && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className="wheel-container">
          <canvas ref={canvasRef} width={canvasSize} height={canvasSize} />
        </div>
        <div className="wheel-side-panel">
          {result && (
            <div className="challenge-result" style={{ color: result.color }}>
              {result.segmentType === 'spin_again' ? '🔄 Spin Again!' : `🎉 ${result.label}!`}
            </div>
          )}
          <button
            className="btn btn-primary btn-large"
            onClick={handleSpin}
            disabled={isSpinning || (result && result.segmentType !== 'spin_again')}
          >
            {isSpinning ? 'Spinning...' : (result && result.segmentType !== 'spin_again') ? 'Complete!' : 'SPIN'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dice Roll Modal
export function DiceRollModal({ challengeData, onResult, onCancel, compact = false }) {
  const [isRolling, setIsRolling] = useState(false);
  const [diceValues, setDiceValues] = useState([]);
  const [displayValues, setDisplayValues] = useState([]);
  const [result, setResult] = useState(null);
  const [characterRoll, setCharacterRoll] = useState(null);

  const { diceCount = 2, mode = 'ranges', ranges = [], characterAdvantage = 0 } = challengeData || {};

  const rollDice = useCallback(() => {
    const results = [];
    for (let i = 0; i < diceCount; i++) {
      results.push(Math.floor(Math.random() * 6) + 1);
    }
    return results;
  }, [diceCount]);

  const handleRoll = useCallback(() => {
    if (isRolling) return;

    setIsRolling(true);
    setResult(null);
    setCharacterRoll(null);

    // Rolling animation
    let rollCount = 0;
    const maxRolls = 15;
    const rollInterval = setInterval(() => {
      setDisplayValues(rollDice());
      rollCount++;
      if (rollCount >= maxRolls) {
        clearInterval(rollInterval);

        // Final roll
        const finalValues = rollDice();
        setDiceValues(finalValues);
        setDisplayValues(finalValues);
        const total = finalValues.reduce((a, b) => a + b, 0);

        let outputId;
        if (mode === 'direct') {
          outputId = `result-${total}`;
        } else if (mode === 'ranges') {
          const matchedRange = ranges.find(r => total >= r.min && total <= r.max);
          outputId = matchedRange ? matchedRange.id : 'other';
          setResult({ label: matchedRange?.label || `Rolled ${total} (unmatched)`, total });
        } else if (mode === 'against') {
          // Character also rolls
          const charValues = rollDice();
          const charTotal = charValues.reduce((a, b) => a + b, 0) + characterAdvantage;
          setCharacterRoll({ values: charValues, total: charTotal });

          if (total > charTotal) {
            outputId = 'player-wins';
            setResult({ label: 'You Win!', total, charTotal });
          } else if (total < charTotal) {
            outputId = 'character-wins';
            setResult({ label: 'Character Wins!', total, charTotal });
          } else {
            outputId = 'tie';
            setResult({ label: "It's a Tie!", total, charTotal });
          }
        }

        setIsRolling(false);

        // Auto-submit after showing result - pass extended result object
        setTimeout(() => {
          onResult({
            outputId,
            rollTotal: total,
            diceValues: finalValues
          });
        }, 2000);
      }
    }, 100);
  }, [isRolling, diceCount, mode, ranges, characterAdvantage, rollDice, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal dice-roll-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎲 Roll the Dice!</h3>
        {onCancel && !isRolling && !result && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className="dice-container">
          {(displayValues.length > 0 ? displayValues : Array(diceCount).fill(1)).map((value, i) => (
            <div key={i} className={`die ${isRolling ? 'rolling' : ''}`}>
              {value}
            </div>
          ))}
        </div>
        {diceValues.length > 0 && (
          <div className="dice-total">
            Total: {diceValues.reduce((a, b) => a + b, 0)}
          </div>
        )}
        {mode === 'against' && characterRoll && (
          <div className="character-roll">
            <div className="vs-label">VS</div>
            <div className="dice-container small">
              {characterRoll.values.map((value, i) => (
                <div key={i} className="die small">{value}</div>
              ))}
            </div>
            <div className="dice-total small">
              Character: {characterRoll.total}
              {characterAdvantage !== 0 && (
                <span className="advantage">
                  ({characterAdvantage > 0 ? '+' : ''}{characterAdvantage})
                </span>
              )}
            </div>
          </div>
        )}
        {result && (
          <div className="challenge-result">
            {result.label}
          </div>
        )}
      </div>
      <div className="challenge-modal-footer">
        <button
          className="btn btn-primary btn-large"
          onClick={handleRoll}
          disabled={isRolling || result}
        >
          {isRolling ? 'Rolling...' : result ? 'Complete!' : 'ROLL'}
        </button>
      </div>
    </div>
  );
}

// Coin Flip Modal
export function CoinFlipModal({ challengeData, onResult, onCancel, compact = false }) {
  const [isFlipping, setIsFlipping] = useState(false);
  const [result, setResult] = useState(null);
  const [flipCount, setFlipCount] = useState(0);
  const [scores, setScores] = useState({ heads: 0, tails: 0 });

  const {
    headsLabel = 'Heads',
    tailsLabel = 'Tails',
    headsWeight = 50,
    bestOf = 1
  } = challengeData || {};

  const flipCoin = useCallback(() => {
    return Math.random() * 100 < headsWeight ? 'heads' : 'tails';
  }, [headsWeight]);

  const handleFlip = useCallback(() => {
    if (isFlipping) return;

    setIsFlipping(true);
    setResult(null);

    // Flip animation
    setTimeout(() => {
      const flipResult = flipCoin();
      const newScores = { ...scores };
      newScores[flipResult]++;
      setScores(newScores);
      setFlipCount(flipCount + 1);

      const required = Math.ceil(bestOf / 2);

      if (bestOf === 1) {
        setResult(flipResult);
        setIsFlipping(false);
        setTimeout(() => onResult(flipResult), 1500);
      } else if (newScores.heads >= required || newScores.tails >= required) {
        const winner = newScores.heads >= required ? 'heads' : 'tails';
        setResult(winner);
        setIsFlipping(false);
        setTimeout(() => onResult(winner), 1500);
      } else {
        setIsFlipping(false);
      }
    }, 1000);
  }, [isFlipping, flipCoin, bestOf, scores, flipCount, onResult]);

  if (!challengeData) return null;

  const isGameOver = result !== null;

  return (
    <div className={`challenge-modal coin-flip-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🪙 Flip the Coin!</h3>
        {onCancel && !isFlipping && !isGameOver && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className={`coin ${isFlipping ? 'flipping' : ''} ${result || ''}`}>
          <div className="coin-side heads">{headsLabel}</div>
          <div className="coin-side tails">{tailsLabel}</div>
        </div>
        {bestOf > 1 && (
          <div className="score-display">
            <span>{headsLabel}: {scores.heads}</span>
            <span>vs</span>
            <span>{tailsLabel}: {scores.tails}</span>
            <div className="best-of-label">Best of {bestOf}</div>
          </div>
        )}
        {result && (
          <div className="challenge-result">
            🎉 {result === 'heads' ? headsLabel : tailsLabel} wins!
          </div>
        )}
      </div>
      <div className="challenge-modal-footer">
        <button
          className="btn btn-primary btn-large"
          onClick={handleFlip}
          disabled={isFlipping || isGameOver}
        >
          {isFlipping ? 'Flipping...' : isGameOver ? 'Complete!' : 'FLIP'}
        </button>
      </div>
    </div>
  );
}

// Rock Paper Scissors Modal
export function RPSModal({ challengeData, onResult, onCancel, compact = false }) {
  const [playerChoice, setPlayerChoice] = useState(null);
  const [characterChoice, setCharacterChoice] = useState(null);
  const [roundResult, setRoundResult] = useState(null);
  const [scores, setScores] = useState({ player: 0, character: 0 });
  const [roundCount, setRoundCount] = useState(0);
  const [isRevealing, setIsRevealing] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const { bestOf = 1, characterBias = null } = challengeData || {};

  const choices = [
    { id: 'rock', label: 'Rock', emoji: '✊' },
    { id: 'paper', label: 'Paper', emoji: '✋' },
    { id: 'scissors', label: 'Scissors', emoji: '✌️' }
  ];

  const getCharacterChoice = useCallback(() => {
    if (characterBias) {
      // 60% chance of biased choice, 40% random
      if (Math.random() < 0.6) return characterBias;
    }
    const idx = Math.floor(Math.random() * 3);
    return ['rock', 'paper', 'scissors'][idx];
  }, [characterBias]);

  const determineWinner = useCallback((player, character) => {
    if (player === character) return 'tie';
    if (
      (player === 'rock' && character === 'scissors') ||
      (player === 'paper' && character === 'rock') ||
      (player === 'scissors' && character === 'paper')
    ) {
      return 'player';
    }
    return 'character';
  }, []);

  const handleChoice = useCallback((choice) => {
    if (isRevealing || gameOver) return;

    setPlayerChoice(choice);
    setIsRevealing(true);

    setTimeout(() => {
      const charChoice = getCharacterChoice();
      setCharacterChoice(charChoice);

      const winner = determineWinner(choice, charChoice);
      setRoundResult(winner);

      const newScores = { ...scores };
      if (winner === 'player') newScores.player++;
      else if (winner === 'character') newScores.character++;
      setScores(newScores);
      setRoundCount(roundCount + 1);

      const required = Math.ceil(bestOf / 2);

      setTimeout(() => {
        if (newScores.player >= required || newScores.character >= required) {
          setGameOver(true);
          const finalWinner = newScores.player >= required ? 'player-wins' : 'character-wins';
          setTimeout(() => onResult(finalWinner), 1500);
        } else if (bestOf === 1 && winner === 'tie') {
          // Single round tie - play again
          setPlayerChoice(null);
          setCharacterChoice(null);
          setRoundResult(null);
          setIsRevealing(false);
        } else {
          setPlayerChoice(null);
          setCharacterChoice(null);
          setRoundResult(null);
          setIsRevealing(false);
        }
      }, 1500);
    }, 500);
  }, [isRevealing, gameOver, scores, roundCount, bestOf, getCharacterChoice, determineWinner, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal rps-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>✊ Rock Paper Scissors!</h3>
        {onCancel && !isRevealing && !gameOver && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        {bestOf > 1 && (
          <div className="score-display">
            <span>You: {scores.player}</span>
            <span>vs</span>
            <span>Char: {scores.character}</span>
            <div className="best-of-label">Best of {bestOf}</div>
          </div>
        )}
        <div className="rps-arena">
          <div className="rps-player">
            <div className="rps-label">You</div>
            <div className={`rps-choice ${playerChoice ? 'revealed' : ''}`}>
              {playerChoice ? choices.find(c => c.id === playerChoice)?.emoji : '?'}
            </div>
          </div>
          <div className="rps-vs">VS</div>
          <div className="rps-character">
            <div className="rps-label">Opponent</div>
            <div className={`rps-choice ${characterChoice ? 'revealed' : ''}`}>
              {characterChoice ? choices.find(c => c.id === characterChoice)?.emoji : '?'}
            </div>
          </div>
        </div>
        {roundResult && (
          <div className={`round-result ${roundResult}`}>
            {roundResult === 'tie' ? '🔄' : roundResult === 'player' ? '✓' : '✗'}
          </div>
        )}
        {!isRevealing && !gameOver && (
          <div className="rps-choices">
            {choices.map(choice => (
              <button
                key={choice.id}
                className="rps-btn"
                onClick={() => handleChoice(choice.id)}
              >
                <span className="rps-emoji">{choice.emoji}</span>
                <span className="rps-name">{choice.label}</span>
              </button>
            ))}
          </div>
        )}
        {gameOver && (
          <div className="challenge-result">
            ✓ Complete
          </div>
        )}
      </div>
    </div>
  );
}

// Timer Challenge Modal
export function TimerChallengeModal({ challengeData, onResult, onCancel, compact = false }) {
  const [timeLeft, setTimeLeft] = useState(challengeData?.duration || 10);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const intervalRef = useRef(null);

  const { duration = 10, mode = 'normal', precisionMode = false, precisionWindow = 1, escapeWindow = 500 } = challengeData || {};
  const isEscapeMode = mode === 'escape';

  useEffect(() => {
    // Auto-start the timer
    setIsRunning(true);
  }, []);

  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 0.1) {
            clearInterval(intervalRef.current);
            setIsRunning(false);
            setResult('timeout');
            setTimeout(() => onResult('timeout'), 1000);
            return 0;
          }
          return prev - 0.1;
        });
      }, 100);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, onResult, timeLeft]);

  const handlePress = useCallback(() => {
    if (result) return;

    clearInterval(intervalRef.current);
    setIsRunning(false);

    if (isEscapeMode) {
      // Escape mode: pressing early = failure, letting timer finish = success
      // Check if within escape window (last X milliseconds)
      const windowSeconds = escapeWindow / 1000;
      if (timeLeft <= windowSeconds && timeLeft > 0) {
        setResult('success');
        setTimeout(() => onResult('success'), 1000);
      } else {
        setResult('timeout');
        setTimeout(() => onResult('timeout'), 1000);
      }
    } else if (precisionMode) {
      // Must press within the precision window at the end
      if (timeLeft <= precisionWindow && timeLeft > 0) {
        setResult('success');
        setTimeout(() => onResult('success'), 1000);
      } else {
        setResult('timeout');
        setTimeout(() => onResult('timeout'), 1000);
      }
    } else {
      setResult('success');
      setTimeout(() => onResult('success'), 1000);
    }
  }, [result, timeLeft, isEscapeMode, escapeWindow, precisionMode, precisionWindow, onResult]);

  if (!challengeData) return null;

  const percentage = (timeLeft / duration) * 100;
  const isUrgent = timeLeft < duration * 0.3;
  const isPrecisionWindow = precisionMode && timeLeft <= precisionWindow;

  return (
    <div className={`challenge-modal timer-challenge-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>{isEscapeMode ? '⏱️ Endure Without Pressing!' : '⏱️ Quick! Press the Button!'}</h3>
        {onCancel && !result && (
          <button className="btn-skip" onClick={() => {
            clearInterval(intervalRef.current);
            setIsRunning(false);
            onCancel();
          }} title="Skip">×</button>
        )}
        {isEscapeMode && (
          <div className="precision-hint">
            Survive {duration}s without pressing the button!
          </div>
        )}
        {precisionMode && (
          <div className="precision-hint">
            Press when the timer is in the last {precisionWindow}s!
          </div>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className={`timer-display ${isUrgent ? 'urgent' : ''} ${isPrecisionWindow ? 'precision-window' : ''}`}>
          {timeLeft.toFixed(1)}s
        </div>
        <div className="timer-bar-container">
          <div
            className={`timer-bar ${isUrgent ? 'urgent' : ''} ${isPrecisionWindow ? 'precision-window' : ''}`}
            style={{ width: `${percentage}%` }}
          />
          {precisionMode && (
            <div
              className="precision-zone"
              style={{ width: `${(precisionWindow / duration) * 100}%` }}
            />
          )}
        </div>
        {result && (
          <div className={`challenge-result ${result}`}>
            {result === 'success' ? '✅ Success!' : (isEscapeMode ? '❌ Gave Up!' : '❌ Time\'s Up!')}
          </div>
        )}
      </div>
      <div className="challenge-modal-footer">
        <button
          className={`btn btn-large ${isPrecisionWindow ? 'btn-success' : isEscapeMode ? 'btn-danger' : 'btn-primary'}`}
          onClick={handlePress}
          disabled={!!result}
        >
          {result ? (result === 'success' ? 'Success!' : (isEscapeMode ? 'Failed!' : 'Too Late!')) : (isEscapeMode ? 'ESCAPE (Give Up)' : 'PRESS NOW!')}
        </button>
      </div>
    </div>
  );
}

// Number Guess Modal
export function NumberGuessModal({ challengeData, onResult, onCancel, compact = false }) {
  const [targetNumber] = useState(() => {
    const min = challengeData?.min ?? 1;
    const max = challengeData?.max ?? 10;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  });
  const [guess, setGuess] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);

  const { min = 1, max = 10, maxAttempts = 3, closeThreshold = 0 } = challengeData || {};

  const handleGuess = useCallback(() => {
    const guessNum = parseInt(guess);
    if (isNaN(guessNum)) return;

    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    const diff = Math.abs(guessNum - targetNumber);

    if (guessNum === targetNumber) {
      setResult('correct');
      setTimeout(() => onResult('correct'), 1500);
    } else if (closeThreshold > 0 && diff <= closeThreshold) {
      setResult('close');
      setTimeout(() => onResult('close'), 1500);
    } else if (maxAttempts > 0 && newAttempts >= maxAttempts) {
      setResult('wrong');
      setFeedback(`The number was ${targetNumber}`);
      setTimeout(() => onResult('wrong'), 2000);
    } else {
      setFeedback(guessNum > targetNumber ? 'Too High!' : 'Too Low!');
      setGuess('');
    }
  }, [guess, attempts, targetNumber, maxAttempts, closeThreshold, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal number-guess-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🔢 Guess the Number!</h3>
        {onCancel && !result && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className="guess-info">
          Pick a number between {min} and {max}
        </div>
        {maxAttempts > 0 && (
          <div className="attempts-display">
            Attempts: {attempts} / {maxAttempts}
          </div>
        )}
        {!result && (
          <div className="guess-input-row">
            <input
              type="number"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              min={min}
              max={max}
              className="guess-input"
              placeholder="?"
              onKeyDown={(e) => e.key === 'Enter' && handleGuess()}
            />
            <button className="btn btn-primary" onClick={handleGuess}>
              Guess
            </button>
          </div>
        )}
        {feedback && !result && (
          <div className="guess-feedback">
            {feedback}
          </div>
        )}
        {result && (
          <div className={`challenge-result ${result}`}>
            {result === 'correct' && '🎉 Correct!'}
            {result === 'close' && `👍 Close enough! (${targetNumber})`}
            {result === 'wrong' && `❌ Wrong! It was ${targetNumber}`}
          </div>
        )}
      </div>
    </div>
  );
}

// Slot Machine Modal
export function SlotMachineModal({ challengeData, onResult, onCancel, compact = false }) {
  const [reels, setReels] = useState(['?', '?', '?']);
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const {
    symbols = ['🍒', '🍋', '🔔', '⭐', '7️⃣'],
    matches = []
  } = challengeData || {};

  const handleSpin = useCallback(() => {
    if (isSpinning) return;

    setIsSpinning(true);
    setResult(null);

    // Spinning animation
    let spinCount = 0;
    const spinInterval = setInterval(() => {
      setReels([
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
      ]);
      spinCount++;

      if (spinCount > 20) {
        clearInterval(spinInterval);

        // Final result
        const finalReels = [
          symbols[Math.floor(Math.random() * symbols.length)],
          symbols[Math.floor(Math.random() * symbols.length)],
          symbols[Math.floor(Math.random() * symbols.length)]
        ];
        setReels(finalReels);

        // Check for matches - 'other' is fallback for unmatched
        let matchedId = 'other';
        for (const match of matches) {
          if (match.pattern === 'three-of-a-kind') {
            if (finalReels[0] === finalReels[1] && finalReels[1] === finalReels[2]) {
              matchedId = match.id;
              setResult(match.label);
              break;
            }
          } else if (match.pattern === 'two-of-a-kind') {
            if (finalReels[0] === finalReels[1] || finalReels[1] === finalReels[2] || finalReels[0] === finalReels[2]) {
              matchedId = match.id;
              setResult(match.label);
              break;
            }
          } else if (match.pattern === 'any-7') {
            if (finalReels.includes('7️⃣')) {
              matchedId = match.id;
              setResult(match.label);
              break;
            }
          }
        }

        if (matchedId === 'other') {
          setResult('No Match');
        }

        setIsSpinning(false);
        // Pass extended result object with slot symbols
        setTimeout(() => onResult({
          outputId: matchedId,
          slots: finalReels  // Use 'slots' for [Slots] variable
        }), 1500);
      }
    }, 80);
  }, [isSpinning, symbols, matches, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal slot-machine-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎰 Slot Machine!</h3>
        {onCancel && !isSpinning && !result && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className="slot-reels">
          {reels.map((symbol, i) => (
            <div key={i} className={`slot-reel ${isSpinning ? 'spinning' : ''}`}>
              {symbol}
            </div>
          ))}
        </div>
        {result && (
          <div className={`challenge-result ${result === 'No Match' ? 'no-match' : 'win'}`}>
            {result === 'No Match' ? '😢 No Match' : `🎉 ${result}!`}
          </div>
        )}
      </div>
      <div className="challenge-modal-footer">
        <button
          className="btn btn-primary btn-large"
          onClick={handleSpin}
          disabled={isSpinning || result}
        >
          {isSpinning ? 'Spinning...' : result ? 'Complete!' : 'PULL'}
        </button>
      </div>
    </div>
  );
}

// Card Draw Modal
export function CardDrawModal({ challengeData, onResult, onCancel, compact = false }) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnCard, setDrawnCard] = useState(null);

  const { deckType = 'standard', outputMode = 'suit' } = challengeData || {};

  const standardDeck = [];
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  suits.forEach(suit => {
    values.forEach((value, idx) => {
      standardDeck.push({ suit, value, numValue: idx + 1 });
    });
  });

  const tarotDeck = [
    'The Fool', 'The Magician', 'The High Priestess', 'The Empress',
    'The Emperor', 'The Hierophant', 'The Lovers', 'The Chariot',
    'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice',
    'The Hanged Man', 'Death', 'Temperance', 'The Devil',
    'The Tower', 'The Star', 'The Moon', 'The Sun',
    'Judgement', 'The World'
  ];

  const handleDraw = useCallback(() => {
    if (isDrawing) return;

    setIsDrawing(true);

    setTimeout(() => {
      let card;
      let outputId;

      if (deckType === 'standard') {
        card = standardDeck[Math.floor(Math.random() * standardDeck.length)];
        setDrawnCard({
          display: `${card.value}`,
          suit: card.suit,
          suitSymbol: card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠',
          isRed: card.suit === 'hearts' || card.suit === 'diamonds'
        });

        if (outputMode === 'suit') {
          outputId = card.suit;
        } else if (outputMode === 'color') {
          outputId = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'red' : 'black';
        } else if (outputMode === 'range') {
          if (card.numValue <= 5) outputId = 'low';
          else if (card.numValue <= 10) outputId = 'mid';
          else outputId = 'face';
        }
      } else {
        card = tarotDeck[Math.floor(Math.random() * tarotDeck.length)];
        setDrawnCard({ display: card, isTarot: true });
        outputId = 'drawn';
      }

      setIsDrawing(false);
      setTimeout(() => onResult(outputId), 1500);
    }, 1000);
  }, [isDrawing, deckType, outputMode, standardDeck, tarotDeck, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal card-draw-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🃏 Draw a Card!</h3>
        {onCancel && !isDrawing && !drawnCard && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
      </div>
      <div className="challenge-modal-body">
        <div className={`card-display ${isDrawing ? 'drawing' : ''} ${drawnCard ? 'revealed' : ''}`}>
          {drawnCard ? (
            drawnCard.isTarot ? (
              <div className="tarot-card">
                <div className="tarot-name">{drawnCard.display}</div>
              </div>
            ) : (
              <div className={`playing-card ${drawnCard.isRed ? 'red' : 'black'}`}>
                <div className="card-corner top-left">
                  <span className="card-value">{drawnCard.display}</span>
                  <span className="card-suit">{drawnCard.suitSymbol}</span>
                </div>
                <div className="card-center">{drawnCard.suitSymbol}</div>
                <div className="card-corner bottom-right">
                  <span className="card-value">{drawnCard.display}</span>
                  <span className="card-suit">{drawnCard.suitSymbol}</span>
                </div>
              </div>
            )
          ) : (
            <div className="card-back">🂠</div>
          )}
        </div>
      </div>
      <div className="challenge-modal-footer">
        <button
          className="btn btn-primary btn-large"
          onClick={handleDraw}
          disabled={isDrawing || drawnCard}
        >
          {isDrawing ? 'Drawing...' : drawnCard ? 'Complete!' : 'DRAW'}
        </button>
      </div>
    </div>
  );
}

// Simon Challenge Modal
export function SimonChallengeModal({ challengeData, onResult, onCancel, onPenalty, compact = false }) {
  const COLORS = [
    { id: 'red', color: '#ef4444', activeColor: '#fca5a5', sound: 330 },
    { id: 'green', color: '#22c55e', activeColor: '#86efac', sound: 392 },
    { id: 'blue', color: '#3b82f6', activeColor: '#93c5fd', sound: 440 },
    { id: 'yellow', color: '#eab308', activeColor: '#fde047', sound: 523 }
  ];

  const {
    startingLength = 3,
    maxLength = 8,
    maxMisses = 3,
    penaltyDevice,
    penaltyDuration = 3,
    grandPenaltyDevice,
    grandPenaltyDuration = 10,
    rewardDevice,
    rewardDuration = 5
  } = challengeData || {};

  const [sequence, setSequence] = useState([]);
  const [playerInput, setPlayerInput] = useState([]);
  const [isShowingSequence, setIsShowingSequence] = useState(false);
  const [activeColor, setActiveColor] = useState(null);
  const [missCount, setMissCount] = useState(0);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [gameState, setGameState] = useState('waiting'); // 'waiting', 'showing', 'input', 'won', 'lost'
  const [feedback, setFeedback] = useState(null); // 'correct', 'wrong', null

  const audioContextRef = useRef(null);

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Play a tone for a color
  const playTone = useCallback((frequency, duration = 300) => {
    if (!audioContextRef.current) return;
    try {
      const oscillator = audioContextRef.current.createOscillator();
      const gainNode = audioContextRef.current.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContextRef.current.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + duration / 1000);
      oscillator.start();
      oscillator.stop(audioContextRef.current.currentTime + duration / 1000);
    } catch (e) {
      // Audio context might be in wrong state
    }
  }, []);

  // Generate new sequence for current level
  const generateSequence = useCallback(() => {
    const length = Math.min(startingLength + currentLevel - 1, maxLength);
    const newSeq = [];
    for (let i = 0; i < length; i++) {
      newSeq.push(COLORS[Math.floor(Math.random() * COLORS.length)].id);
    }
    return newSeq;
  }, [currentLevel, startingLength, maxLength]);

  // Show the sequence to the player
  const showSequence = useCallback(async (seq) => {
    setGameState('showing');
    setIsShowingSequence(true);

    for (let i = 0; i < seq.length; i++) {
      const colorId = seq[i];
      const colorObj = COLORS.find(c => c.id === colorId);

      await new Promise(resolve => setTimeout(resolve, 400));
      setActiveColor(colorId);
      playTone(colorObj.sound);
      await new Promise(resolve => setTimeout(resolve, 600));
      setActiveColor(null);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
    setIsShowingSequence(false);
    setGameState('input');
    setPlayerInput([]);
  }, [playTone]);

  // Start the game
  const startGame = useCallback(() => {
    const newSequence = generateSequence();
    setSequence(newSequence);
    setMissCount(0);
    setCurrentLevel(1);
    showSequence(newSequence);
  }, [generateSequence, showSequence]);

  // Handle player button press
  const handleColorPress = useCallback((colorId) => {
    if (gameState !== 'input') return;

    const colorObj = COLORS.find(c => c.id === colorId);
    setActiveColor(colorId);
    playTone(colorObj.sound);

    setTimeout(() => setActiveColor(null), 200);

    const nextIndex = playerInput.length;
    const expectedColor = sequence[nextIndex];

    if (colorId === expectedColor) {
      // Correct!
      const newInput = [...playerInput, colorId];
      setPlayerInput(newInput);
      setFeedback('correct');
      setTimeout(() => setFeedback(null), 300);

      if (newInput.length === sequence.length) {
        // Level complete!
        if (sequence.length >= maxLength) {
          // Won the game!
          setGameState('won');
          if (rewardDevice && onPenalty) {
            onPenalty(rewardDevice, rewardDuration, 'reward');
          }
          setTimeout(() => onResult('win'), 1500);
        } else {
          // Next level
          setCurrentLevel(prev => prev + 1);
          const newSequence = [...sequence, COLORS[Math.floor(Math.random() * COLORS.length)].id];
          setSequence(newSequence);
          setTimeout(() => showSequence(newSequence), 1000);
        }
      }
    } else {
      // Wrong!
      setFeedback('wrong');
      const newMissCount = missCount + 1;
      setMissCount(newMissCount);

      // Trigger penalty device
      if (penaltyDevice && onPenalty) {
        onPenalty(penaltyDevice, penaltyDuration, 'penalty');
      }

      setTimeout(() => setFeedback(null), 500);

      if (newMissCount >= maxMisses) {
        // Game over - too many misses
        setGameState('lost');
        if (grandPenaltyDevice && onPenalty) {
          onPenalty(grandPenaltyDevice, grandPenaltyDuration, 'penalty');
        }
        setTimeout(() => onResult('lose'), 1500);
      } else {
        // Reset input for retry
        setPlayerInput([]);
        setTimeout(() => showSequence(sequence), 1000);
      }
    }
  }, [gameState, playerInput, sequence, maxLength, maxMisses, missCount, penaltyDevice, penaltyDuration, grandPenaltyDevice, grandPenaltyDuration, rewardDevice, rewardDuration, onPenalty, onResult, playTone, showSequence]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal simon-challenge-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎵 Simon Says</h3>
        {onCancel && gameState === 'waiting' && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
        <div className="simon-stats">
          <span>Level: {currentLevel}</span>
          <span className="miss-counter">Misses: {missCount}/{maxMisses}</span>
        </div>
      </div>
      <div className="challenge-modal-body">
        <div className={`simon-board ${feedback || ''}`}>
          {COLORS.map(color => (
            <button
              key={color.id}
              className={`simon-button ${color.id} ${activeColor === color.id ? 'active' : ''}`}
              style={{
                backgroundColor: activeColor === color.id ? color.activeColor : color.color
              }}
              onClick={() => handleColorPress(color.id)}
              disabled={gameState !== 'input'}
            />
          ))}
        </div>

        {gameState === 'waiting' && (
          <button className="btn btn-primary btn-large" onClick={startGame}>
            START
          </button>
        )}

        {gameState === 'showing' && (
          <div className="simon-status">Watch the sequence...</div>
        )}

        {gameState === 'input' && (
          <div className="simon-status">Your turn! ({playerInput.length + 1}/{sequence.length})</div>
        )}

        {gameState === 'won' && (
          <div className="challenge-result success">🎉 You Won!</div>
        )}

        {gameState === 'lost' && (
          <div className="challenge-result timeout">😢 Game Over!</div>
        )}
      </div>
    </div>
  );
}

// Reflex Challenge Modal
export function ReflexChallengeModal({ challengeData, onResult, onCancel, onPenalty, compact = false }) {
  const {
    timePerTarget = 3,
    rounds = 5,
    targetSize = 'small',
    penaltyDevice,
    penaltyDuration = 3,
    grandPenaltyDevice,
    grandPenaltyDuration = 10,
    rewardDevice,
    rewardDuration = 5
  } = challengeData || {};

  const TARGET_SIZES = {
    large: 44,
    medium: 36,
    small: 28,
    tiny: 22,
    minuscule: 16
  };

  const [currentRound, setCurrentRound] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [timeLeft, setTimeLeft] = useState(timePerTarget);
  const [targetPosition, setTargetPosition] = useState({ x: 50, y: 50 });
  const [gameState, setGameState] = useState('waiting'); // 'waiting', 'playing', 'won', 'lost'
  const [showTarget, setShowTarget] = useState(false);

  const timerRef = useRef(null);
  const gameAreaRef = useRef(null);
  const size = TARGET_SIZES[targetSize] || 32;

  // Generate random position for target
  const generatePosition = useCallback(() => {
    // Calculate safe bounds based on target size (as percentage)
    const padding = 15; // percentage padding from edges
    const minX = padding;
    const maxX = 100 - padding;
    const minY = padding;
    const maxY = 100 - padding;

    return {
      x: Math.random() * (maxX - minX) + minX,
      y: Math.random() * (maxY - minY) + minY
    };
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    if (currentRound >= rounds) return;

    setTimeLeft(timePerTarget);
    setTargetPosition(generatePosition());
    setShowTarget(true);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.1) {
          // Timeout - miss!
          clearInterval(timerRef.current);
          setShowTarget(false);

          const newMisses = misses + 1;
          setMisses(newMisses);

          // Trigger penalty
          if (penaltyDevice && onPenalty) {
            onPenalty(penaltyDevice, penaltyDuration, 'penalty');
          }

          const newRound = currentRound + 1;
          setCurrentRound(newRound);

          if (newRound >= rounds) {
            // Game over - check result
            if (newMisses > hits) {
              setGameState('lost');
              if (grandPenaltyDevice && onPenalty) {
                onPenalty(grandPenaltyDevice, grandPenaltyDuration, 'penalty');
              }
              setTimeout(() => onResult('lose'), 1500);
            } else {
              setGameState('won');
              if (rewardDevice && onPenalty) {
                onPenalty(rewardDevice, rewardDuration, 'reward');
              }
              setTimeout(() => onResult('win'), 1500);
            }
          }

          return 0;
        }
        return prev - 0.1;
      });
    }, 100);
  }, [currentRound, rounds, timePerTarget, generatePosition, hits, misses, penaltyDevice, penaltyDuration, grandPenaltyDevice, grandPenaltyDuration, rewardDevice, rewardDuration, onPenalty, onResult]);

  // Continue to next round after miss
  useEffect(() => {
    if (gameState === 'playing' && !showTarget && currentRound < rounds && timeLeft === 0) {
      // Wait for penalty to complete before starting next round (penalty duration + 500ms buffer)
      const delay = penaltyDevice ? (penaltyDuration * 1000 + 500) : 800;
      const timer = setTimeout(() => {
        startRound();
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [gameState, showTarget, currentRound, rounds, timeLeft, startRound, penaltyDevice, penaltyDuration]);

  // Handle click on game area (miss - clicked outside)
  const handleAreaClick = useCallback((e) => {
    if (gameState !== 'playing' || !showTarget) return;

    // Check if we clicked the target (in that case, don't count as miss)
    if (e.target.classList.contains('reflex-target')) return;

    // Missed the target - clicked outside
    clearInterval(timerRef.current);
    setShowTarget(false);

    const newMisses = misses + 1;
    setMisses(newMisses);

    if (penaltyDevice && onPenalty) {
      onPenalty(penaltyDevice, penaltyDuration, 'penalty');
    }

    const newRound = currentRound + 1;
    setCurrentRound(newRound);

    if (newRound >= rounds) {
      if (newMisses > hits) {
        setGameState('lost');
        if (grandPenaltyDevice && onPenalty) {
          onPenalty(grandPenaltyDevice, grandPenaltyDuration, 'penalty');
        }
        setTimeout(() => onResult('lose'), 1500);
      } else {
        setGameState('won');
        if (rewardDevice && onPenalty) {
          onPenalty(rewardDevice, rewardDuration, 'reward');
        }
        setTimeout(() => onResult('win'), 1500);
      }
    } else {
      // Wait for penalty to complete before starting next round (penalty duration + 500ms buffer)
      const delay = penaltyDevice ? (penaltyDuration * 1000 + 500) : 800;
      setTimeout(() => startRound(), delay);
    }
  }, [gameState, showTarget, currentRound, rounds, hits, misses, penaltyDevice, penaltyDuration, grandPenaltyDevice, grandPenaltyDuration, rewardDevice, rewardDuration, onPenalty, onResult, startRound]);

  // Handle click on target (hit!)
  const handleTargetClick = useCallback((e) => {
    e.stopPropagation();
    if (gameState !== 'playing' || !showTarget) return;

    clearInterval(timerRef.current);
    setShowTarget(false);

    const newHits = hits + 1;
    setHits(newHits);

    const newRound = currentRound + 1;
    setCurrentRound(newRound);

    if (newRound >= rounds) {
      if (newHits >= misses) {
        setGameState('won');
        if (rewardDevice && onPenalty) {
          onPenalty(rewardDevice, rewardDuration, 'reward');
        }
        setTimeout(() => onResult('win'), 1500);
      } else {
        setGameState('lost');
        if (grandPenaltyDevice && onPenalty) {
          onPenalty(grandPenaltyDevice, grandPenaltyDuration, 'penalty');
        }
        setTimeout(() => onResult('lose'), 1500);
      }
    } else {
      setTimeout(() => startRound(), 500);
    }
  }, [gameState, showTarget, currentRound, rounds, hits, misses, rewardDevice, rewardDuration, grandPenaltyDevice, grandPenaltyDuration, onPenalty, onResult, startRound]);

  // Start game
  const handleStart = useCallback(() => {
    setGameState('playing');
    setCurrentRound(0);
    setHits(0);
    setMisses(0);
    setTimeout(() => startRound(), 500);
  }, [startRound]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!challengeData) return null;

  const percentage = (timeLeft / timePerTarget) * 100;

  return (
    <div className={`challenge-modal reflex-challenge-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎯 Reflex Challenge</h3>
        {onCancel && gameState === 'waiting' && (
          <button className="btn-skip" onClick={onCancel} title="Skip">×</button>
        )}
        <div className="reflex-timer">
          {gameState === 'playing' && showTarget && (
            <span className={timeLeft < 1 ? 'urgent' : ''}>{timeLeft.toFixed(1)}s</span>
          )}
        </div>
      </div>
      <div className="challenge-modal-body">
        <div className="reflex-stats">
          <span className="hit-counter">Hits: {hits}</span>
          <span className="round-counter">Round: {Math.min(currentRound + 1, rounds)}/{rounds}</span>
          <span className="miss-counter">Misses: {misses}</span>
        </div>

        {gameState === 'playing' && showTarget && (
          <div className="reflex-timer-bar">
            <div
              className={`reflex-timer-fill ${timeLeft < 1 ? 'urgent' : ''}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}

        <div
          ref={gameAreaRef}
          className="reflex-game-area"
          onClick={handleAreaClick}
        >
          {showTarget && (
            <button
              className="reflex-target"
              style={{
                left: `${targetPosition.x}%`,
                top: `${targetPosition.y}%`,
                width: `${size}px`,
                height: `${size}px`
              }}
              onClick={handleTargetClick}
            />
          )}
        </div>

        {gameState === 'waiting' && (
          <button className="btn btn-primary btn-large" onClick={handleStart}>
            START
          </button>
        )}

        {gameState === 'won' && (
          <div className="challenge-result success">🎉 You Won! ({hits} hits, {misses} misses)</div>
        )}

        {gameState === 'lost' && (
          <div className="challenge-result timeout">😢 You Lost! ({hits} hits, {misses} misses)</div>
        )}
      </div>
    </div>
  );
}

// Main Challenge Modal Dispatcher
export function ChallengeModal({ challengeData, onResult, onCancel, onPenalty, compact = false }) {
  if (!challengeData) return null;

  const { challengeType } = challengeData;

  switch (challengeType) {
    case 'prize_wheel':
      return <PrizeWheelModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'dice_roll':
      return <DiceRollModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'coin_flip':
      return <CoinFlipModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'rps':
      return <RPSModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'timer_challenge':
      return <TimerChallengeModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'number_guess':
      return <NumberGuessModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'slot_machine':
      return <SlotMachineModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'card_draw':
      return <CardDrawModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} compact={compact} />;
    case 'simon_challenge':
      return <SimonChallengeModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} onPenalty={onPenalty} compact={compact} />;
    case 'reflex_challenge':
      return <ReflexChallengeModal challengeData={challengeData} onResult={onResult} onCancel={onCancel} onPenalty={onPenalty} compact={compact} />;
    default:
      return <div>Unknown challenge type: {challengeType}</div>;
  }
}
