/**
 * Character Exporter Service
 *
 * Handles exporting SwellDreams characters as PNG character cards in two formats:
 * - V3: SillyTavern-compatible character card (chara + ccv3 tEXt chunks)
 * - SwellD: Full SwellDreams format with logo overlay (swelld tEXt chunk)
 *
 * The PNG image is the character's avatar. Metadata is embedded as tEXt chunks.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { embedChunksInPNG } = require('./png-embed');
const imageStorage = require('./image-storage');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
const EXPORTS_BASE = path.join(__dirname, '..', '..', 'exports', 'characters');

/**
 * Convert SwellDreams constant reminders to V3 character_book entries
 * @param {Array} reminders - SwellDreams constant reminders
 * @returns {Array} V3 character_book entries
 */
function convertToV3Lore(reminders) {
  if (!reminders || !Array.isArray(reminders)) return [];

  return reminders.map((reminder, index) => ({
    keys: reminder.keys || [],
    content: reminder.text || '',
    extensions: {
      case_sensitive: reminder.caseSensitive || false,
      scan_depth: reminder.scanDepth || 10
    },
    enabled: reminder.enabled !== false,
    insertion_order: reminder.priority || (100 + index),
    constant: reminder.constant || false,
    name: reminder.name || `Entry ${index + 1}`,
    comment: reminder.name || '',
    selective: false,
    secondary_keys: [],
    position: 'after_char'
  }));
}

/**
 * Format SwellDreams example dialogues into V3 mes_example format
 * @param {Array} dialogues - Array of {user, character} dialogue objects
 * @param {string} charName - Character name for {{char}} replacement
 * @returns {string} Formatted example dialogues
 */
function formatExampleDialogues(dialogues, charName) {
  if (!dialogues || !Array.isArray(dialogues) || dialogues.length === 0) return '';

  return dialogues.map(d => {
    const parts = ['<START>'];
    if (d.user) parts.push(`{{user}}: ${d.user}`);
    if (d.character) parts.push(`{{char}}: ${d.character}`);
    return parts.join('\n');
  }).join('\n');
}

/**
 * Convert a SwellDreams character to V3 character card JSON
 * @param {Object} character - SwellDreams character object
 * @param {Array} selectedStories - Stories to include in export
 * @returns {Object} V3 character card JSON
 */
function convertToV3(character, selectedStories) {
  // Find the active story
  const activeStory = selectedStories.find(s => s.id === character.activeStoryId)
    || selectedStories[0];

  // Get first_mes from active story's active welcome message
  let firstMes = '';
  if (activeStory) {
    const activeWelcome = activeStory.welcomeMessages?.find(
      w => w.id === activeStory.activeWelcomeMessageId
    ) || activeStory.welcomeMessages?.[0];
    firstMes = activeWelcome?.text || '';
  }

  // Get alternate_greetings from other selected stories
  const alternateGreetings = [];
  for (const story of selectedStories) {
    if (story.id === activeStory?.id) continue;
    const welcome = story.welcomeMessages?.find(
      w => w.id === story.activeWelcomeMessageId
    ) || story.welcomeMessages?.[0];
    if (welcome?.text) {
      alternateGreetings.push(welcome.text);
    }
  }

  // Format example dialogues from active story
  const mesExample = activeStory
    ? formatExampleDialogues(activeStory.exampleDialogues, character.name)
    : '';

  // Convert constant reminders to character_book entries
  const loreEntries = convertToV3Lore(character.constantReminders);

  const characterBook = loreEntries.length > 0 ? {
    entries: loreEntries,
    name: `${character.name}'s Lorebook`,
    description: '',
    scan_depth: 10,
    token_budget: 2048,
    recursive_scanning: false,
    extensions: {}
  } : undefined;

  const data = {
    name: character.name || '',
    description: character.description || '',
    personality: character.personality || '',
    scenario: '',
    first_mes: firstMes,
    mes_example: mesExample,
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    tags: [],
    creator: 'SwellDreams',
    character_version: '',
    alternate_greetings: alternateGreetings,
    extensions: {},
    group_only_greetings: [],
    ...(characterBook ? { character_book: characterBook } : {})
  };

  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    avatar: 'none',
    tags: [],
    data
  };
}

/**
 * Build a full SwellDreams export JSON wrapper
 * @param {Object} character - SwellDreams character object
 * @param {Array} selectedStories - Stories to include
 * @param {Array} flows - Flow objects to embed (if embedFlows is true)
 * @param {boolean} embedFlows - Whether to embed flow data
 * @param {string} avatarDataUri - Clean avatar as base64 data URI
 * @returns {Object} SwellD export JSON
 */
function buildSwellDExport(character, selectedStories, flows, embedFlows, avatarDataUri) {
  // Clone character data for export
  const exportChar = JSON.parse(JSON.stringify(character));

  // Filter stories to only selected ones
  if (selectedStories && selectedStories.length > 0) {
    const selectedIds = new Set(selectedStories.map(s => s.id));
    exportChar.stories = exportChar.stories.filter(s => selectedIds.has(s.id));
  }

  // Embed clean avatar data for import without logo
  if (avatarDataUri) {
    exportChar.avatarData = avatarDataUri;
  }

  const exportData = {
    type: 'swelldreams-character',
    version: '1.5',
    exportedAt: new Date().toISOString(),
    data: exportChar
  };

  if (embedFlows && flows && flows.length > 0) {
    exportData.flows = flows;
  }

  return exportData;
}

/**
 * Generate a placeholder avatar PNG for characters without an avatar
 * Creates a dark gradient background with the character's initial
 * @param {string} characterName - Character name
 * @returns {Buffer} PNG buffer
 */
async function generatePlaceholderAvatar(characterName) {
  const size = 512;
  const initial = (characterName || 'C').charAt(0).toUpperCase();

  // Generate a consistent hue from character name
  let hash = 0;
  for (let i = 0; i < (characterName || '').length; i++) {
    hash = ((hash << 5) - hash + characterName.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash % 360);

  // Create a gradient background using SVG
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:hsl(${hue},40%,20%)" />
        <stop offset="100%" style="stop-color:hsl(${(hue + 40) % 360},50%,12%)" />
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)" />
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
      font-family="Arial, sans-serif" font-size="220" font-weight="bold"
      fill="rgba(255,255,255,0.3)">${initial}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Read a character's avatar from disk
 * @param {Object} character - Character object with avatar path
 * @returns {Buffer|null} PNG buffer or null if not found
 */
async function readAvatarFromDisk(character) {
  if (!character.avatar || !character.avatar.startsWith('/api/images/')) {
    return null;
  }

  const avatarMatch = character.avatar.match(
    /^\/api\/images\/(chars)\/(default|custom)\/([^/]+)\/(.+)$/
  );
  if (!avatarMatch) return null;

  const [, type, folder, charId, filename] = avatarMatch;
  const filePath = imageStorage.getImageFilePath(type, folder, charId, filename);

  if (!filePath || !fs.existsSync(filePath)) return null;

  return fs.readFileSync(filePath);
}

/**
 * Get avatar as base64 data URI
 * @param {Object} character - Character object
 * @returns {string|null} Base64 data URI or null
 */
async function getAvatarDataUri(character) {
  const buffer = await readAvatarFromDisk(character);
  if (!buffer) return null;

  // Detect format from avatar path
  const ext = path.extname(character.avatar).toLowerCase().replace('.', '');
  const mimeType = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Overlay the SwellDreams logo on an avatar image
 * @param {Buffer} avatarBuffer - Avatar PNG buffer
 * @returns {Buffer} Avatar with logo overlay as PNG buffer
 */
async function overlayLogo(avatarBuffer) {
  if (!fs.existsSync(LOGO_PATH)) {
    console.warn('[Exporter] Logo file not found at', LOGO_PATH);
    return avatarBuffer;
  }

  const avatarMeta = await sharp(avatarBuffer).metadata();
  const avatarWidth = avatarMeta.width || 512;
  const avatarHeight = avatarMeta.height || 512;

  // Resize logo to ~40% of avatar width
  const logoWidth = Math.round(avatarWidth * 0.4);
  const logoBuffer = await sharp(LOGO_PATH)
    .resize({ width: logoWidth })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logoBuffer).metadata();
  const logoHeight = logoMeta.height || Math.round(logoWidth * 0.3);

  // Position in bottom-right with small margin
  const margin = Math.round(avatarWidth * 0.03);
  const left = avatarWidth - logoWidth - margin;
  const top = avatarHeight - logoHeight - margin;

  return sharp(avatarBuffer)
    .composite([{
      input: logoBuffer,
      left: Math.max(0, left),
      top: Math.max(0, top)
    }])
    .png()
    .toBuffer();
}

/**
 * Ensure avatar is in PNG format
 * @param {Buffer} imageBuffer - Image buffer (may be jpg, webp, etc.)
 * @returns {Buffer} PNG buffer
 */
async function ensurePNG(imageBuffer) {
  return sharp(imageBuffer).png().toBuffer();
}

/**
 * Main export orchestrator - generates a character card PNG
 * @param {Object} character - SwellDreams character object
 * @param {string} format - 'v3' or 'swelld'
 * @param {Object} options - Export options
 * @param {Array} options.selectedStories - Stories to include
 * @param {Array} options.flows - Flow objects to embed (SwellD only)
 * @param {boolean} options.embedFlows - Whether to embed flows (SwellD only)
 * @returns {Buffer} PNG buffer with embedded metadata
 */
async function exportCharacterPNG(character, format, options = {}) {
  const { selectedStories = [], flows = [], embedFlows = false } = options;

  // 1. Get avatar image
  let avatarBuffer = await readAvatarFromDisk(character);
  if (!avatarBuffer) {
    avatarBuffer = await generatePlaceholderAvatar(character.name);
  }

  // Ensure PNG format
  avatarBuffer = await ensurePNG(avatarBuffer);

  // 2. Get clean avatar data URI (for SwellD export - before logo overlay)
  const cleanAvatarDataUri = `data:image/png;base64,${avatarBuffer.toString('base64')}`;

  // 3. Build the PNG image (with or without logo)
  let pngBuffer;
  if (format === 'swelld') {
    // SwellD: overlay logo on avatar
    pngBuffer = await overlayLogo(avatarBuffer);
  } else {
    // V3: use avatar as-is
    pngBuffer = avatarBuffer;
  }

  // 4. Build metadata and embed as tEXt chunks
  const chunks = [];

  if (format === 'v3') {
    const v3Card = convertToV3(character, selectedStories);
    const v3Json = JSON.stringify(v3Card);

    // Embed both chara (V2 compat) and ccv3 (V3)
    chunks.push({ key: 'chara', json: v3Json });
    chunks.push({ key: 'ccv3', json: v3Json });
  } else {
    // SwellD format
    const swelldData = buildSwellDExport(
      character, selectedStories, flows, embedFlows, cleanAvatarDataUri
    );
    chunks.push({ key: 'swelld', json: JSON.stringify(swelldData) });
  }

  // 5. Embed chunks in PNG
  const finalPNG = embedChunksInPNG(pngBuffer, chunks);

  // 6. Save to exports directory
  const formatDir = format === 'v3' ? 'V3' : 'SwellD';
  const exportDir = path.join(EXPORTS_BASE, formatDir);
  fs.mkdirSync(exportDir, { recursive: true });

  const safeName = (character.name || 'Character').replace(/[^a-z0-9]/gi, '_');
  const exportPath = path.join(exportDir, `${safeName}.png`);
  fs.writeFileSync(exportPath, finalPNG);

  console.log(`[Exporter] Saved ${format} export to ${exportPath}`);

  return finalPNG;
}

module.exports = {
  convertToV3,
  convertToV3Lore,
  formatExampleDialogues,
  buildSwellDExport,
  generatePlaceholderAvatar,
  exportCharacterPNG
};
