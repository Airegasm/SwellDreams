/**
 * Media Variable Parser Utility
 * Parses and extracts media variables from message content
 *
 * Supported variables:
 * - [Image:tag] - Display image from Media Album
 * - [Video:tag] or [Video:tag:once] - Play video once
 * - [Video:tag:loop] - Loop video
 * - [Audio:tag] - Play audio with bubble
 * - [Audio:tag:nomsg] - Play audio without bubble (silent/background)
 */

/**
 * Parse message content and extract media variables
 * @param {string} content - Original message content
 * @returns {Object} { cleanContent, mediaItems }
 */
export function parseMediaVariables(content) {
  if (!content) return { cleanContent: content, mediaItems: [] };

  const mediaItems = [];
  let cleanContent = content;

  // Pattern for images: [Image:tag]
  const imagePattern = /\[Image:([^\]]+)\]/gi;

  // Pattern for videos: [Video:tag] or [Video:tag:once] or [Video:tag:loop] or [Video:tag:blocking]
  // blocking cannot be combined with loop
  const videoPattern = /\[Video:([^\]:]+)(?::(once|loop|blocking))?\]/gi;

  // Pattern for audio: [Audio:tag] or [Audio:tag:nomsg]
  const audioPattern = /\[Audio:([^\]:]+)(?::(nomsg))?\]/gi;

  // Extract images
  let match;
  while ((match = imagePattern.exec(content)) !== null) {
    mediaItems.push({
      type: 'image',
      tag: match[1].trim(),
      originalMatch: match[0],
    });
  }

  // Extract videos
  while ((match = videoPattern.exec(content)) !== null) {
    const modifier = match[2];
    mediaItems.push({
      type: 'video',
      tag: match[1].trim(),
      loop: modifier === 'loop',
      blocking: modifier === 'blocking',
      originalMatch: match[0],
    });
  }

  // Extract audio
  while ((match = audioPattern.exec(content)) !== null) {
    mediaItems.push({
      type: 'audio',
      tag: match[1].trim(),
      nomsg: match[2] === 'nomsg',
      originalMatch: match[0],
    });
  }

  // Remove media variables from content
  for (const item of mediaItems) {
    cleanContent = cleanContent.replace(item.originalMatch, '');
  }

  // Clean up multiple spaces and newlines left by removal
  cleanContent = cleanContent
    .replace(/[ \t]+/g, ' ')      // Multiple spaces to single space
    .replace(/\n{3,}/g, '\n\n')   // Multiple newlines to double
    .trim();

  return { cleanContent, mediaItems };
}

export default parseMediaVariables;
