const { v4: uuidv4 } = require('uuid');

/**
 * V2/V3 Character Card to SwellDreams Character Converter
 *
 * Converts standard V2/V3 character card format to SwellDreams character format.
 * Supports full lorebook/character book conversion with keyword triggers.
 */

/**
 * Convert V2 format to SwellDreams Character
 * @param {Object} v2Card - V2 format character card
 * @returns {Object} SwellDreams character object
 */
function convertV2ToSwellD(v2Card) {
  const data = v2Card.data || v2Card;

  // Parse example dialogues if present
  const exampleDialogues = parseExampleDialogues(data.mes_example || '');

  // Import welcome messages from first_mes and alternate_greetings
  const welcomeMessages = [];
  if (data.first_mes) {
    welcomeMessages.push({
      id: uuidv4(),
      text: data.first_mes,
      llmEnhanced: false
    });
  }
  if (data.alternate_greetings && Array.isArray(data.alternate_greetings)) {
    data.alternate_greetings.forEach(greeting => {
      if (greeting && greeting.trim()) {
        welcomeMessages.push({
          id: uuidv4(),
          text: greeting,
          llmEnhanced: false
        });
      }
    });
  }
  // Fallback to empty if no greetings found
  if (welcomeMessages.length === 0) {
    welcomeMessages.push({
      id: uuidv4(),
      text: '',
      llmEnhanced: false
    });
  }

  // Import scenario
  const scenarios = [{
    id: uuidv4(),
    text: data.scenario || ''
  }];

  // Convert character book to enhanced constant reminders
  const constantReminders = buildConstantReminders(data);

  // Create default story
  const defaultStory = {
    id: uuidv4(),
    name: data.source || 'Default Story',
    welcomeMessages: welcomeMessages.length > 0 ? welcomeMessages : [{ id: uuidv4(), text: '', llmEnhanced: false }],
    activeWelcomeMessageId: welcomeMessages.length > 0 ? welcomeMessages[0].id : null,
    scenarios: scenarios,
    activeScenarioId: scenarios.length > 0 ? scenarios[0].id : null,
    exampleDialogues: exampleDialogues,
    autoReplyEnabled: false,
    assignedFlows: [],
    assignedButtons: [],
    constantReminderIds: [],
    globalReminderIds: [],
    startingEmotion: 'neutral'
  };

  // Build character object
  const character = {
    id: uuidv4(),
    name: data.name || 'Imported Character',
    description: data.description || '',
    personality: data.personality || '',
    avatar: '', // Will be set during PNG import if applicable
    stories: [defaultStory],
    activeStoryId: defaultStory.id,
    constantReminders: constantReminders,  // Enhanced with lorebook fields
    globalReminders: [],  // Empty by default
    buttons: [],
    extensions: {
      v2v3Import: {
        originalFormat: v2Card.spec || 'chara_card_v2',
        importedAt: new Date().toISOString(),
        // Preserved originals for reference (not used by SwellDreams)
        originalGreeting: data.first_mes || '',
        originalAlternateGreetings: data.alternate_greetings || [],
        originalScenario: data.scenario || '',
        originalExampleMessages: data.mes_example || '',
        // Metadata
        tags: data.tags || [],
        creator: data.creator || '',
        creatorNotes: data.creator_notes || '',
        characterVersion: data.character_version || '',
        // Preserve any fields we don't explicitly map
        preservedData: {
          system_prompt: data.system_prompt || '',
          post_history_instructions: data.post_history_instructions || '',
          extensions: data.extensions || {}
        }
      }
    }
  };

  return character;
}

/**
 * Convert V3 format to SwellDreams Character
 * @param {Object} v3Card - V3 format character card
 * @returns {Object} SwellDreams character object
 */
function convertV3ToSwellD(v3Card) {
  const data = v3Card.data || v3Card;

  // Start with V2 conversion (V3 is superset of V2)
  const character = convertV2ToSwellD(v3Card);

  // V3-specific enhancements
  if (data.nickname) {
    // Add nickname to description or name
    character.description = `Nickname: ${data.nickname}\n\n${character.description}`;
  }

  // Store V3-specific metadata
  if (character.extensions && character.extensions.v2v3Import) {
    character.extensions.v2v3Import.nickname = data.nickname || '';
    character.extensions.v2v3Import.source = data.source || [];
    character.extensions.v2v3Import.spec = 'chara_card_v3';
    // V3-specific preserved data
    character.extensions.v2v3Import.preservedData.group_only_greetings = data.group_only_greetings || [];
  }

  return character;
}

/**
 * Build constant reminders from character card data
 * Converts creator_notes and character_book entries to enhanced reminders
 * @param {Object} data - Character card data
 * @returns {Array} Array of enhanced reminder objects
 */
function buildConstantReminders(data) {
  const reminders = [];

  // Add creator_notes as high-priority constant reminder
  if (data.creator_notes) {
    reminders.push({
      id: uuidv4(),
      name: 'Creator Notes',
      text: data.creator_notes,
      target: 'character',
      enabled: true,
      constant: true,           // Always active
      keys: [],
      caseSensitive: false,
      priority: 200,            // High priority for creator notes
      scanDepth: 10
    });
  }

  // Convert character_book entries to reminders
  if (data.character_book && Array.isArray(data.character_book.entries)) {
    data.character_book.entries
      .filter(entry => entry.enabled !== false)  // Only enabled entries
      .forEach(entry => {
        // Determine if this should be constant or keyword-triggered
        const isConstant = entry.constant === true;
        const keys = entry.keys || [];

        reminders.push({
          id: uuidv4(),
          name: entry.name || entry.comment || 'Lorebook Entry',
          text: entry.content || entry.value || '',
          target: 'character',
          enabled: true,
          constant: isConstant,
          keys: keys,
          caseSensitive: entry.case_sensitive || false,
          priority: entry.priority !== undefined ? entry.priority : (entry.insertion_order || 100),
          scanDepth: entry.extensions?.scan_depth || entry.scan_depth || 10
        });
      });
  }

  return reminders;
}

/**
 * Parse example dialogues from mes_example field
 * Format: <START>\nUser: ...\nChar: ...\n<START>\n...
 * @param {string} mesExample - Example messages string
 * @returns {Array} Array of {user, character} dialogue objects
 */
function parseExampleDialogues(mesExample) {
  if (!mesExample) return [];

  const dialogues = [];
  const blocks = mesExample.split(/<START>/i).filter(b => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let user = '';
    let character = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Match patterns like "User:", "{{user}}:", "You:", etc.
      const userMatch = trimmed.match(/^(?:User|You|{{user}})\s*:\s*(.+)/i);
      if (userMatch) {
        user += (user ? '\n' : '') + userMatch[1];
        continue;
      }

      // Match patterns like "Char:", "{{char}}:", character name, etc.
      const charMatch = trimmed.match(/^(?:Char|{{char}}|.+?)\s*:\s*(.+)/i);
      if (charMatch) {
        character += (character ? '\n' : '') + charMatch[1];
      }
    }

    if (user || character) {
      dialogues.push({ user, character });
    }
  }

  return dialogues;
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
      return extractV2PNG(pngBuffer);
    } else if (format === 'v3') {
      return extractV3PNG(pngBuffer);
    }
  } catch (error) {
    console.error('Failed to extract PNG metadata:', error);
    return null;
  }
  return null;
}

/**
 * Extract V2 character data from PNG (tEXt chunk with key "chara")
 * @param {Buffer} pngBuffer - PNG file buffer
 * @returns {Object|null} Character card data
 */
function extractV2PNG(pngBuffer) {
  try {
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
 * Extract V3 character data from PNG (tEXt chunk with key "ccv3")
 * @param {Buffer} pngBuffer - PNG file buffer
 * @returns {Object|null} Character card data
 */
function extractV3PNG(pngBuffer) {
  try {
    const chunks = extractPNGChunks(pngBuffer);
    const ccv3Chunk = chunks.find(chunk =>
      chunk.type === 'tEXt' && chunk.key === 'ccv3'
    );

    if (!ccv3Chunk) return null;

    // V3 stores as base64 encoded JSON
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
  convertV2ToSwellD,
  convertV3ToSwellD,
  parseExampleDialogues,
  extractPNGMetadata,
  detectFormat
};
