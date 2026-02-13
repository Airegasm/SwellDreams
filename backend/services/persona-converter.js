const { v4: uuidv4 } = require('uuid');

/**
 * V2/V3 Character Card to SwellDreams Persona Converter
 *
 * Converts standard V2/V3 character card format to SwellDreams Persona format.
 * Note: Personas are the user's identity, so some fields (welcome messages, scenarios)
 * are handled differently than in character conversion.
 */

/**
 * Convert V2 format to SwellDreams Persona
 * @param {Object} v2Card - V2 format character card
 * @returns {Object} SwellDreams persona object
 */
function convertV2ToPersona(v2Card) {
  const data = v2Card.data || v2Card;

  // Basic persona structure
  const persona = {
    displayName: data.name || 'Imported Persona',
    pronouns: inferPronouns(data.personality, data.description),
    appearance: data.description || '',
    personality: data.personality || '',
    relationshipWithInflation: data.scenario || '',
    avatar: '', // Will be set during import if PNG
    stagedPortraits: {},
    assignedFlows: [],
    buttons: [],
    assignedButtons: [],
    extensions: {
      v2v3Import: {
        originalFormat: v2Card.spec || 'chara_card_v2',
        importedAt: new Date().toISOString(),
        tags: data.tags || [],
        creator: data.creator || '',
        creatorNotes: data.creator_notes || '',
        characterVersion: data.character_version || ''
      }
    }
  };

  return persona;
}

/**
 * Convert V3 format to SwellDreams Persona
 * @param {Object} v3Card - V3 format character card
 * @returns {Object} SwellDreams persona object
 */
function convertV3ToPersona(v3Card) {
  const data = v3Card.data || v3Card;

  // Start with V2 conversion (V3 is superset of V2)
  const persona = convertV2ToPersona(v3Card);

  // V3-specific fields
  if (data.nickname) {
    // Add nickname to display name in parentheses
    persona.displayName = `${data.name} (${data.nickname})`;
  }

  // Store V3-specific metadata
  if (persona.extensions && persona.extensions.v2v3Import) {
    persona.extensions.v2v3Import.nickname = data.nickname || '';
    persona.extensions.v2v3Import.source = data.source || [];
  }

  return persona;
}

/**
 * Attempt to infer pronouns from personality and description text
 * @param {string} personality - Personality description
 * @param {string} description - Character description
 * @returns {string} Pronouns (he/him, she/her, they/them, it/its)
 */
function inferPronouns(personality = '', description = '') {
  const text = (personality + ' ' + description).toLowerCase();

  // Count pronoun occurrences
  const heCount = (text.match(/\bhe\b|\bhis\b|\bhim\b|\bhimself\b/g) || []).length;
  const sheCount = (text.match(/\bshe\b|\bher\b|\bhers\b|\bherself\b/g) || []).length;
  const theyCount = (text.match(/\bthey\b|\bthem\b|\btheir\b|\bthemselves\b/g) || []).length;
  const itCount = (text.match(/\bit\b|\bits\b|\bitself\b/g) || []).length;

  // Return most common pronoun set
  const max = Math.max(heCount, sheCount, theyCount, itCount);
  if (max === 0) return 'they/them'; // Default
  if (heCount === max) return 'he/him';
  if (sheCount === max) return 'she/her';
  if (itCount === max) return 'it/its';
  return 'they/them';
}

/**
 * Extract character card JSON from PNG metadata
 * @param {Buffer} pngBuffer - PNG file buffer
 * @param {string} format - 'v2' or 'v3'
 * @returns {Object|null} Extracted character card data
 */
function extractPNGMetadata(pngBuffer, format = 'v2') {
  try {
    if (format === 'v2') {
      // V2: Extract from EXIF "Chara" field (base64 encoded JSON)
      return extractV2PNG(pngBuffer);
    } else if (format === 'v3') {
      // V3: Extract from tEXt chunk "ccv3" (utf-8 → base64 encoded JSON)
      return extractV3PNG(pngBuffer);
    }
  } catch (error) {
    console.error('Failed to extract PNG metadata:', error);
    return null;
  }
  return null;
}

/**
 * Extract V2 character data from PNG (EXIF Chara field)
 * @param {Buffer} pngBuffer - PNG file buffer
 * @returns {Object|null} Character card data
 */
function extractV2PNG(pngBuffer) {
  try {
    // Look for tEXt chunk with key "chara"
    const chunks = extractPNGChunks(pngBuffer);
    const charaChunk = chunks.find(chunk =>
      chunk.type === 'tEXt' && chunk.key === 'chara'
    );

    if (!charaChunk) return null;

    // Decode base64
    const jsonString = Buffer.from(charaChunk.value, 'base64').toString('utf-8');
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('V2 PNG extraction failed:', error);
    return null;
  }
}

/**
 * Extract V3 character data from PNG (tEXt ccv3 chunk)
 * @param {Buffer} pngBuffer - PNG file buffer
 * @returns {Object|null} Character card data
 */
function extractV3PNG(pngBuffer) {
  try {
    // Look for tEXt chunk with key "ccv3"
    const chunks = extractPNGChunks(pngBuffer);
    const ccv3Chunk = chunks.find(chunk =>
      chunk.type === 'tEXt' && chunk.key === 'ccv3'
    );

    if (!ccv3Chunk) return null;

    // V3 stores as base64 encoded JSON (value is already utf-8 text)
    const jsonString = Buffer.from(ccv3Chunk.value, 'base64').toString('utf-8');
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('V3 PNG extraction failed:', error);
    return null;
  }
}

/**
 * Extract PNG chunks (tEXt) from PNG buffer
 * @param {Buffer} pngBuffer - PNG file buffer
 * @returns {Array} Array of chunk objects {type, key, value}
 */
function extractPNGChunks(pngBuffer) {
  const chunks = [];
  let offset = 8; // Skip PNG signature

  while (offset < pngBuffer.length) {
    // Read chunk length (4 bytes)
    if (offset + 4 > pngBuffer.length) break;
    const length = pngBuffer.readUInt32BE(offset);
    offset += 4;

    // Read chunk type (4 bytes)
    if (offset + 4 > pngBuffer.length) break;
    const type = pngBuffer.toString('ascii', offset, offset + 4);
    offset += 4;

    // Read chunk data
    if (offset + length > pngBuffer.length) break;
    const data = pngBuffer.slice(offset, offset + length);
    offset += length;

    // Skip CRC (4 bytes)
    offset += 4;

    // Parse tEXt chunks
    if (type === 'tEXt') {
      // tEXt format: key\0value
      const nullIndex = data.indexOf(0);
      if (nullIndex !== -1) {
        const key = data.toString('latin1', 0, nullIndex);
        const value = data.toString('latin1', nullIndex + 1);
        chunks.push({ type, key, value });
      }
    }

    // Stop at IEND
    if (type === 'IEND') break;
  }

  return chunks;
}

/**
 * Detect if card is V2 or V3 format
 * @param {Object} card - Character card JSON
 * @returns {string} 'v2' or 'v3'
 */
function detectFormat(card) {
  if (card.spec_version === '3.0' || card.spec === 'chara_card_v3') {
    return 'v3';
  }
  return 'v2';
}

module.exports = {
  convertV2ToPersona,
  convertV3ToPersona,
  extractPNGMetadata,
  detectFormat,
  inferPronouns
};
