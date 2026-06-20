// MiniGame type definitions — mechanics defaults + which games set [GameWinner].
// Branching is NOT here: each game only enumerates named exits (the possible
// [GameResult] values); the "Call MiniGame" trigger binds gotos to them later.

export const GAME_TYPES = [
  { type: 'prize_wheel', name: 'Prize Wheel', icon: '🎡', competitive: false },
  { type: 'dice_roll', name: 'Dice Roll', icon: '🎲', competitive: false },
  { type: 'coin_flip', name: 'Coin Flip', icon: '🪙', competitive: true },
  { type: 'rps', name: 'Rock Paper Scissors', icon: '✊', competitive: true },
  { type: 'slot_machine', name: 'Slots', icon: '🎰', competitive: false },
  { type: 'card_draw', name: 'Blackjack', icon: '🃏', competitive: true },
  { type: 'simon_challenge', name: 'Simon', icon: '🟢', competitive: false },
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
      // No exits — [GameResult] is the numeric total. characterAdvantage adds to the total.
      return { diceCount: 2, characterAdvantage: 0 };
    case 'coin_flip':
      return { headsLabel: 'Heads', tailsLabel: 'Tails', headsWeight: 50, bestOf: 1 };
    case 'rps':
      return { bestOf: 1, characterBias: 0 };
    case 'slot_machine':
      return {
        symbols: ['🍒', '🍋', '🔔', '⭐', '7️⃣'],
        exits: [
          { id: uid('ex'), label: 'Jackpot', pattern: 'three-of-a-kind' },
          { id: uid('ex'), label: 'Small Win', pattern: 'two-of-a-kind' },
          { id: uid('ex'), label: 'No Matches', pattern: 'no-match' },
        ],
      };
    case 'card_draw':
      // Easy Blackjack: Player vs Character, hit/stay, closest to target without busting.
      return { target: 21, charStandsAt: 17 };
    case 'simon_challenge':
      return { startingLength: 3, maxLength: 8, maxMisses: 3, penaltyDevice: '', penaltyDuration: 3, grandPenaltyDevice: '', grandPenaltyDuration: 10, rewardDevice: '', rewardDuration: 5 };
    default:
      return {};
  }
}

// The exit-point labels (possible [GameResult] values) for a config — what the trigger
// will bind gotos to. Some games derive exits from their mechanics.
export function exitsFor(type, config) {
  switch (type) {
    case 'prize_wheel': return (config.segments || []).map(s => s.label);
    case 'dice_roll': return []; // [GameResult] is the numeric total — nothing to bind gotos to
    case 'slot_machine': return [...(config.exits || []).map(e => e.label), 'No Win'];
    case 'coin_flip': return [config.headsLabel || 'Heads', config.tailsLabel || 'Tails'];
    case 'rps': return ['Win', 'Lose', 'Draw'];
    case 'card_draw': return ['Win', 'Lose', 'Push']; // Blackjack outcome (player perspective)
    case 'simon_challenge': return ['Completed', 'Failed'];
    default: return [];
  }
}

export const newId = uid;
