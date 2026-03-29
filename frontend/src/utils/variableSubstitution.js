/**
 * Universal Variable Substitution Utility
 * Replaces variable placeholders with their actual values
 *
 * Supported variables:
 * - [Player] - Player's display name
 * - [Char] - Character's name
 * - [Capacity] - Current capacity value
 * - [Feeling] - Current sensation/feeling
 * - [Emotion] - Current emotion
 * - [Flow:varname] - Custom flow variables
 */

export function substituteVariables(text, context = {}) {
  if (!text) return text;

  let result = text;

  // Player name — support both [Player] and SillyTavern {{user}} macro
  if (context.playerName) {
    result = result.replace(/\[Player\]/gi, context.playerName);
    result = result.replace(/\{\{user\}\}/gi, context.playerName);
  }

  // Character name — support both [Char] and SillyTavern {{char}} macro
  if (context.characterName) {
    result = result.replace(/\[Char\]/gi, context.characterName);
    result = result.replace(/\{\{char\}\}/gi, context.characterName);
  }

  // Session state variables
  if (context.sessionState) {
    result = result.replace(/\[Capacity\]/gi, context.sessionState.capacity ?? 0);
    result = result.replace(/\[Feeling\]/gi, context.sessionState.sensation ?? 'normal');
    result = result.replace(/\[Emotion\]/gi, context.sessionState.emotion ?? 'neutral');

    // Flow variables - [Flow:varname] syntax
    result = result.replace(/\[Flow:(\w+)\]/gi, (match, varName) => {
      return context.sessionState.flowVariables?.[varName] !== undefined
        ? context.sessionState.flowVariables[varName]
        : match;
    });
  }

  return result;
}

export default substituteVariables;
