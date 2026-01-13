import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ChallengeModals.css';

// Prize Wheel Modal
export function PrizeWheelModal({ challengeData, onResult, compact = false }) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState(null);
  const canvasRef = useRef(null);

  const { segments = [] } = challengeData || {};
  const canvasSize = compact ? 180 : 300;

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

      // Draw label
      const midAngle = startAngle + sliceAngle / 2;
      const labelRadius = radius * 0.65;
      const x = centerX + Math.cos(midAngle) * labelRadius;
      const y = centerY + Math.sin(midAngle) * labelRadius;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(midAngle + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 2;
      ctx.fillText(segment.label.substring(0, 12), 0, 0);
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

    // Spin animation: multiple rotations + target
    const spins = 5 + Math.random() * 3;
    const finalRotation = rotation + spins * 360 + (360 - targetAngle);

    // Animate
    let currentRotation = rotation;
    const duration = 4000;
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
        setResult(segments[selectedIndex]);
        // Auto-submit after showing result
        setTimeout(() => {
          onResult(segments[selectedIndex].id);
        }, 1500);
      }
    };

    requestAnimationFrame(animate);
  }, [isSpinning, segments, rotation, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal prize-wheel-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎡 Spin the Wheel!</h3>
      </div>
      <div className="challenge-modal-body">
        <div className="wheel-container">
          <canvas ref={canvasRef} width={canvasSize} height={canvasSize} />
        </div>
        {result && (
          <div className="challenge-result" style={{ color: result.color }}>
            🎉 {result.label}!
          </div>
        )}
      </div>
      <div className="challenge-modal-footer">
        <button
          className="btn btn-primary btn-large"
          onClick={handleSpin}
          disabled={isSpinning || result}
        >
          {isSpinning ? 'Spinning...' : result ? 'Complete!' : 'SPIN'}
        </button>
      </div>
    </div>
  );
}

// Dice Roll Modal
export function DiceRollModal({ challengeData, onResult, compact = false }) {
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
          outputId = matchedRange ? matchedRange.id : ranges[0]?.id;
          setResult({ label: matchedRange?.label || 'Unknown', total });
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

        // Auto-submit after showing result
        setTimeout(() => {
          onResult(outputId);
        }, 2000);
      }
    }, 100);
  }, [isRolling, diceCount, mode, ranges, characterAdvantage, rollDice, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal dice-roll-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎲 Roll the Dice!</h3>
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
export function CoinFlipModal({ challengeData, onResult, compact = false }) {
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
export function RPSModal({ challengeData, onResult, compact = false }) {
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
            <div className="rps-label">Character</div>
            <div className={`rps-choice ${characterChoice ? 'revealed' : ''}`}>
              {characterChoice ? choices.find(c => c.id === characterChoice)?.emoji : '?'}
            </div>
          </div>
        </div>
        {roundResult && (
          <div className={`round-result ${roundResult}`}>
            {roundResult === 'tie' ? "It's a tie!" : roundResult === 'player' ? 'You win this round!' : 'Character wins!'}
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
            🎉 {scores.player > scores.character ? 'You Win!' : 'Character Wins!'}
          </div>
        )}
      </div>
    </div>
  );
}

// Timer Challenge Modal
export function TimerChallengeModal({ challengeData, onResult, compact = false }) {
  const [timeLeft, setTimeLeft] = useState(challengeData?.duration || 10);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const intervalRef = useRef(null);

  const { duration = 10, precisionMode = false, precisionWindow = 1 } = challengeData || {};

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

    if (precisionMode) {
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
  }, [result, timeLeft, precisionMode, precisionWindow, onResult]);

  if (!challengeData) return null;

  const percentage = (timeLeft / duration) * 100;
  const isUrgent = timeLeft < duration * 0.3;
  const isPrecisionWindow = precisionMode && timeLeft <= precisionWindow;

  return (
    <div className={`challenge-modal timer-challenge-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>⏱️ Quick! Press the Button!</h3>
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
            {result === 'success' ? '✅ Success!' : '❌ Time\'s Up!'}
          </div>
        )}
      </div>
      <div className="challenge-modal-footer">
        <button
          className={`btn btn-large ${isPrecisionWindow ? 'btn-success' : 'btn-primary'}`}
          onClick={handlePress}
          disabled={!!result}
        >
          {result ? (result === 'success' ? 'Success!' : 'Too Late!') : 'PRESS NOW!'}
        </button>
      </div>
    </div>
  );
}

// Number Guess Modal
export function NumberGuessModal({ challengeData, onResult, compact = false }) {
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
export function SlotMachineModal({ challengeData, onResult, compact = false }) {
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

        // Check for matches
        let matchedId = 'no-match';
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

        if (matchedId === 'no-match') {
          setResult('No Match');
        }

        setIsSpinning(false);
        setTimeout(() => onResult(matchedId), 1500);
      }
    }, 80);
  }, [isSpinning, symbols, matches, onResult]);

  if (!challengeData) return null;

  return (
    <div className={`challenge-modal slot-machine-modal ${compact ? 'compact' : ''}`}>
      <div className="challenge-modal-header">
        <h3>🎰 Slot Machine!</h3>
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
export function CardDrawModal({ challengeData, onResult, compact = false }) {
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

// Main Challenge Modal Dispatcher
export function ChallengeModal({ challengeData, onResult, compact = false }) {
  if (!challengeData) return null;

  const { challengeType } = challengeData;

  switch (challengeType) {
    case 'prize_wheel':
      return <PrizeWheelModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'dice_roll':
      return <DiceRollModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'coin_flip':
      return <CoinFlipModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'rps':
      return <RPSModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'timer_challenge':
      return <TimerChallengeModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'number_guess':
      return <NumberGuessModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'slot_machine':
      return <SlotMachineModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    case 'card_draw':
      return <CardDrawModal challengeData={challengeData} onResult={onResult} compact={compact} />;
    default:
      return <div>Unknown challenge type: {challengeType}</div>;
  }
}
