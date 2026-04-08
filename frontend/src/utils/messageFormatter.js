import React from 'react';

/**
 * Parse a paragraph into segments: speaker prefixes, action text, and plain text
 */
function parseParagraph(para, speakerNames) {
  const segments = [];

  // Check for speaker prefix at start of paragraph
  for (const { name, type } of speakerNames) {
    if (para.startsWith(name + ':')) {
      segments.push({ type: 'speaker', content: name + ':', speakerType: type });
      para = para.slice(name.length + 1);
      break;
    }
  }

  // Parse *action* segments
  let i = 0;
  let currentText = '';

  while (i < para.length) {
    if (para[i] === '*') {
      // Check if this asterisk touches a word on its right
      if (i + 1 < para.length && para[i + 1] !== ' ' && para[i + 1] !== '*') {
        // Flush any accumulated text
        if (currentText) {
          segments.push({ type: 'text', content: currentText });
          currentText = '';
        }

        // Find closing asterisk
        let closeIdx = -1;
        for (let j = i + 1; j < para.length; j++) {
          if (para[j] === '*') {
            closeIdx = j;
            break;
          }
        }

        if (closeIdx !== -1) {
          // Matched pair — keep asterisks visible
          segments.push({ type: 'action', content: para.slice(i, closeIdx + 1) });
          i = closeIdx + 1;
        } else {
          // No closing asterisk — treat rest of paragraph as action, keep leading *
          segments.push({ type: 'action', content: para.slice(i) });
          i = para.length;
        }
      } else {
        // Orphan asterisk (not touching a word) — discard it
        i++;
      }
    } else {
      currentText += para[i];
      i++;
    }
  }

  if (currentText) {
    segments.push({ type: 'text', content: currentText });
  }

  return segments;
}

/**
 * Format message content with action text highlighting and speaker prefixes
 * @param {string} text - The message content (already variable-substituted)
 * @param {string} playerName - Active persona display name
 * @param {string} characterName - Active character name
 * @param {string[]} multiCharNames - Array of multi-char character names (optional)
 * @returns {React.ReactNode[]} Array of React elements
 */
export function formatMessageContent(text, playerName, characterName, multiCharNames = []) {
  if (!text) return [text];

  // Build speaker name list with types
  const speakerNames = [];
  if (characterName) speakerNames.push({ name: characterName, type: 'character' });
  if (playerName) speakerNames.push({ name: playerName, type: 'player' });
  for (const name of multiCharNames) {
    if (name && !speakerNames.some(s => s.name === name)) {
      speakerNames.push({ name, type: 'character' });
    }
  }
  // Sort by name length descending to match longest first
  speakerNames.sort((a, b) => b.name.length - a.name.length);

  const paragraphs = text.split('\n');
  const result = [];

  paragraphs.forEach((para, pIdx) => {
    if (pIdx > 0) result.push(<br key={`br-${pIdx}`} />);
    if (!para.trim()) return;

    const segments = parseParagraph(para, speakerNames);
    segments.forEach((seg, sIdx) => {
      const key = `${pIdx}-${sIdx}`;
      if (seg.type === 'speaker') {
        const cls = seg.speakerType === 'player' ? 'player-speaker' : 'char-speaker';
        result.push(<span key={key} className={`speaker-prefix ${cls}`}>{seg.content}</span>);
      } else if (seg.type === 'action') {
        result.push(<span key={key} className="action-text">{seg.content}</span>);
      } else {
        result.push(<span key={key}>{seg.content}</span>);
      }
    });
  });

  return result;
}
