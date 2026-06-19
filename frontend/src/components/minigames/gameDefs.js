// MiniGame type definitions — mechanics defaults + which games set [GameWinner].
// Branching is NOT here: each game only enumerates named exits (the possible
// [GameResult] values); the "Call MiniGame" trigger binds gotos to them later.

export const GAME_TYPES = [
  { type: 'prize_wheel', name: 'Prize Wheel', icon: '🎡', competitive: false },
  { type: 'dice_roll', name: 'Dice Roll', icon: '🎲', competitive: false },
  { type: 'coin_flip', name: 'Coin Flip', icon: '🪙', competitive: true },
  { type: 'rps', name: 'Rock Paper Scissors', icon: '✊', competitive: true },
  { type: 'timer_challenge', name: 'Timer', icon: '⏱️', competitive: false },
  { type: 'number_guess', name: 'Number Guess', icon: '🔢', competitive: false },
  { type: 'slot_machine', name: 'Slots', icon: '🎰', competitive: false },
  { type: 'card_draw', name: 'Card Draw', icon: '🃏', competitive: false },
  { type: 'simon_challenge', name: 'Simon', icon: '🟢', competitive: false },
  { type: 'reflex_challenge', name: 'Reflex', icon: '🎯', competitive: false },
];

export const gameDef = (type) => GAME_TYPES.find(g => g.type === type) || GAME_TYPES[0];

const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Default mechanics + default exits per type.
export function defaultConfig(type) {
  switch (type) {
    case 'prize_wheel':
      return {
        segments: [
          { id: uid('seg'), label: 'Prize 1', color: '#fb923c', weight: 1 },
          { id: uid('seg'), label: 'Prize 2', color: '#3b82f6', weight: 1 },
        ],
      };
    case 'dice_roll':
      return {
        diceCount: 2,
        exits: [
          { id: uid('ex'), label: 'Low', min: 2, max: 5 },
          { id: uid('ex'), label: 'Medium', min: 6, max: 9 },
          { id: uid('ex'), label: 'High', min: 10, max: 12 },
        ],
        characterAdvantage: 0,
      };
    case 'coin_flip':
      return { headsLabel: 'Heads', tailsLabel: 'Tails', headsWeight: 50, bestOf: 1 };
    case 'rps':
      return { bestOf: 1, characterBias: 0 };
    case 'timer_challenge':
      return { duration: 10, precisionMode: false, precisionWindow: 1 };
    case 'number_guess':
      return { min: 1, max: 10, maxAttempts: 3, closeThreshold: 0 };
    case 'slot_machine':
      return {
        symbols: ['🍒', '🍋', '🔔', '⭐', '7️⃣'],
        exits: [
          { id: uid('ex'), label: 'Jackpot', pattern: 'three-of-a-kind' },
          { id: uid('ex'), label: 'Small Win', pattern: 'two-of-a-kind' },
        ],
      };
    case 'card_draw':
      return { deckType: 'standard', outputMode: 'suit' };
    case 'simon_challenge':
      return { startingLength: 3, maxLength: 8, maxMisses: 3, penaltyDevice: '', penaltyDuration: 3, grandPenaltyDevice: '', grandPenaltyDuration: 10, rewardDevice: '', rewardDuration: 5 };
    case 'reflex_challenge':
      return { timePerTarget: 3, rounds: 5, targetSize: 'small', penaltyDevice: '', penaltyDuration: 3, grandPenaltyDevice: '', grandPenaltyDuration: 10, rewardDevice: '', rewardDuration: 5 };
    default:
      return {};
  }
}

// The exit-point labels (possible [GameResult] values) for a config — what the trigger
// will bind gotos to. Some games derive exits from their mechanics.
export function exitsFor(type, config) {
  switch (type) {
    case 'prize_wheel': return (config.segments || []).map(s => s.label);
    case 'dice_roll': return (config.exits || []).map(e => e.label);
    case 'slot_machine': return [...(config.exits || []).map(e => e.label), 'No Win'];
    case 'coin_flip': return [config.headsLabel || 'Heads', config.tailsLabel || 'Tails'];
    case 'rps': return ['Win', 'Lose', 'Draw'];
    case 'number_guess': return config.closeThreshold > 0 ? ['Correct', 'Close', 'Failed'] : ['Correct', 'Failed'];
    case 'timer_challenge': return config.precisionMode ? ['Perfect', 'Close', 'Miss'] : ['Success', 'Fail'];
    case 'card_draw': return config.outputMode === 'color' ? ['Red', 'Black'] : config.outputMode === 'suit' ? ['Hearts', 'Diamonds', 'Clubs', 'Spades'] : ['High', 'Low'];
    case 'simon_challenge':
    case 'reflex_challenge': return ['Completed', 'Failed'];
    default: return [];
  }
}

export const newId = uid;
