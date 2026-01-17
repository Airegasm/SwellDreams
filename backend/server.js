/**
 * SwellDreams Backend Server
 * Express + WebSocket server for single-player inflation roleplay
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Services
const llmService = require('./services/llm-service');
const { DeviceService, killAllPythonProcesses, activeProcesses } = require('./services/device-service');
const EventEngine = require('./services/event-engine');
const goveeService = require('./services/govee-service');
const tuyaService = require('./services/tuya-service');
const wyzeService = require('./services/wyze-service');
const aiDeviceControl = require('./services/ai-device-control');

// Utilities
const { createLogger } = require('./utils/logger');
const { AppError, ValidationError } = require('./utils/errors');
const validators = require('./utils/validators');
const {
  encrypt,
  decrypt,
  isEncrypted,
  encryptSettings,
  decryptSettings,
  maskSettingsForResponse,
  encryptConnectionProfile,
  decryptConnectionProfile,
  maskApiKey,
  hasApiKey
} = require('./utils/crypto');

const log = createLogger('Server');

// Generate a unique session ID on each server boot - used to clear stale drafts
const SERVER_SESSION_ID = uuidv4();

// Initialize Express
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// CORS Configuration - dynamically uses remote settings whitelist
const CORS_OPTIONS = {
  origin: function(origin, callback) {
    // Always allow localhost
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8889',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:8889',
      undefined, // Allow requests with no origin (same-origin, curl, etc.)
    ];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Check remote settings for whitelist
    let remoteSettings = { allowRemote: false, whitelistedIps: [] };
    try {
      const remoteSettingsPath = path.join(__dirname, 'data', 'remote-settings.json');
      if (fs.existsSync(remoteSettingsPath)) {
        remoteSettings = JSON.parse(fs.readFileSync(remoteSettingsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Error reading remote settings:', e);
    }

    if (!remoteSettings.allowRemote) {
      callback(new Error('Remote access disabled'));
      return;
    }

    // Extract IP from origin (e.g., "http://100.64.0.1:3000" -> "100.64.0.1")
    const originMatch = origin.match(/^https?:\/\/([^:\/]+)/);
    const originIp = originMatch ? originMatch[1] : null;

    if (originIp && remoteSettings.whitelistedIps.includes(originIp)) {
      callback(null, true);
    } else {
      callback(new Error('IP not in whitelist'));
    }
  },
  credentials: true
};

// Middleware
app.use(cors(CORS_OPTIONS));
app.use(express.json({ limit: '10mb' }));

// Rate limiting configurations
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute
  message: { success: false, error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const deviceScanLimiter = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 1, // 1 scan per 30 seconds
  message: { success: false, error: 'Device scan in progress, please wait' },
});

const llmLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 LLM requests per minute
  message: { success: false, error: 'Too many LLM requests, please slow down' },
});

// Apply general rate limiting (skip device endpoints and emergency stop)
app.use('/api', (req, res, next) => {
  // Skip rate limiting for emergency stop - safety critical
  if (req.path === '/emergency-stop') {
    return next();
  }
  // Skip rate limiting for device state polling and control - high frequency
  if (req.path.startsWith('/devices/')) {
    return next();
  }
  generalLimiter(req, res, next);
});

// Data directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Simple async lock for race condition prevention
class SimpleLock {
  constructor() {
    this.locked = false;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.locked = false;
    }
  }
}

// Welcome message lock to prevent duplicates (using proper mutex)
const welcomeMessageLock = new SimpleLock();
let sendingWelcomeMessage = false;

// Message validation helpers
function isBlankMessage(content) {
  if (!content) return true;
  const trimmed = String(content).trim();
  return trimmed === '' || trimmed === '...' || trimmed === '…';
}

function isDuplicateMessage(content, recentCount = 5) {
  if (!content) return false;
  const trimmed = String(content).trim().toLowerCase();
  if (trimmed === '') return false;

  // Check against recent messages
  const recentMessages = sessionState.chatHistory.slice(-recentCount);
  return recentMessages.some(msg =>
    msg.content && String(msg.content).trim().toLowerCase() === trimmed
  );
}

// Data file paths
const DATA_FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  personas: path.join(DATA_DIR, 'personas.json'),
  characters: path.join(DATA_DIR, 'characters.json'),
  devices: path.join(DATA_DIR, 'devices.json'),
  flows: path.join(DATA_DIR, 'flows.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  autosave: path.join(DATA_DIR, 'autosave.json'),
  connectionProfiles: path.join(DATA_DIR, 'connection-profiles.json'),
  remoteSettings: path.join(DATA_DIR, 'remote-settings.json'),
  calibrations: path.join(DATA_DIR, 'calibrations.json'),
  deviceLabels: path.join(DATA_DIR, 'device-labels.json')
};

// Helper to get calibration/label key for a device (ip or ip:childId)
function getDeviceKey(device) {
  if (device.childId) {
    return `${device.ip}:${device.childId}`;
  }
  return device.ip;
}

// Alias for backwards compatibility
function getCalibrationKey(device) {
  return getDeviceKey(device);
}

// Initialize device service
const deviceService = new DeviceService();

// Initialize event engine
const eventEngine = new EventEngine(deviceService, llmService);

// ============================================
// Data Persistence
// ============================================

function loadData(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e);
  }
  return null;
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`Error saving ${file}:`, e);
    return false;
  }
}

// ============================================
// Per-Flow File Storage Helpers
// ============================================

const FLOWS_DIR = path.join(DATA_DIR, 'flows');

// Load flows index (lightweight metadata only)
function loadFlowsIndex() {
  const indexPath = path.join(FLOWS_DIR, 'flows-index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      console.error('Error loading flows index:', e);
    }
  }
  return [];
}

// Save flows index
function saveFlowsIndex(index) {
  if (!fs.existsSync(FLOWS_DIR)) {
    fs.mkdirSync(FLOWS_DIR, { recursive: true });
  }
  const indexPath = path.join(FLOWS_DIR, 'flows-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Load single flow by ID
function loadFlow(flowId) {
  const flowPath = path.join(FLOWS_DIR, `${flowId}.json`);
  if (fs.existsSync(flowPath)) {
    try {
      return JSON.parse(fs.readFileSync(flowPath, 'utf8'));
    } catch (e) {
      console.error(`Error loading flow ${flowId}:`, e);
    }
  }
  return null;
}

// Save single flow to its own file + update index
function saveFlow(flow) {
  if (!fs.existsSync(FLOWS_DIR)) {
    fs.mkdirSync(FLOWS_DIR, { recursive: true });
  }
  const flowPath = path.join(FLOWS_DIR, `${flow.id}.json`);
  fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));
  updateFlowIndex(flow);
}

// Delete flow file + remove from index
function deleteFlowFile(flowId) {
  const flowPath = path.join(FLOWS_DIR, `${flowId}.json`);
  if (fs.existsSync(flowPath)) {
    fs.unlinkSync(flowPath);
  }
  removeFromFlowIndex(flowId);
}

// Update/add entry in index
function updateFlowIndex(flow) {
  const index = loadFlowsIndex();
  const existing = index.findIndex(f => f.id === flow.id);
  const entry = {
    id: flow.id,
    name: flow.name || 'Untitled Flow',
    characterId: flow.characterId || null,
    description: flow.description || ''
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  saveFlowsIndex(index);
}

// Remove entry from index
function removeFromFlowIndex(flowId) {
  const index = loadFlowsIndex();
  const filtered = index.filter(f => f.id !== flowId);
  saveFlowsIndex(filtered);
}

// Load multiple flows by ID array
function loadFlows(flowIds) {
  return flowIds.map(id => loadFlow(id)).filter(f => f !== null);
}

// Check if per-flow storage is active (migration completed)
function isPerFlowStorageActive() {
  return fs.existsSync(path.join(FLOWS_DIR, 'flows-index.json'));
}

// ============================================
// Per-Character File Storage Helpers
// ============================================

const CHARS_DIR = path.join(DATA_DIR, 'chars');
const CHARS_DEFAULT_DIR = path.join(CHARS_DIR, 'default');
const CHARS_CUSTOM_DIR = path.join(CHARS_DIR, 'custom');

// Load characters index (lightweight metadata only)
function loadCharsIndex() {
  const indexPath = path.join(CHARS_DIR, 'chars-index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      console.error('Error loading chars index:', e);
    }
  }
  return [];
}

// Save characters index
function saveCharsIndex(index) {
  if (!fs.existsSync(CHARS_DIR)) {
    fs.mkdirSync(CHARS_DIR, { recursive: true });
  }
  const indexPath = path.join(CHARS_DIR, 'chars-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Load single character by ID (checks both default and custom dirs)
function loadCharacter(charId) {
  // Check custom first, then default
  const customPath = path.join(CHARS_CUSTOM_DIR, `${charId}.json`);
  const defaultPath = path.join(CHARS_DEFAULT_DIR, `${charId}.json`);

  for (const charPath of [customPath, defaultPath]) {
    if (fs.existsSync(charPath)) {
      try {
        return JSON.parse(fs.readFileSync(charPath, 'utf8'));
      } catch (e) {
        console.error(`Error loading character ${charId}:`, e);
      }
    }
  }
  return null;
}

// Save single character to its own file + update index
// New characters go to custom/, existing stay in their location
function saveCharacter(char, forceCustom = false) {
  // Ensure directories exist
  if (!fs.existsSync(CHARS_CUSTOM_DIR)) {
    fs.mkdirSync(CHARS_CUSTOM_DIR, { recursive: true });
  }

  // Determine save location
  let targetPath;
  const customPath = path.join(CHARS_CUSTOM_DIR, `${char.id}.json`);
  const defaultPath = path.join(CHARS_DEFAULT_DIR, `${char.id}.json`);

  if (forceCustom || !fs.existsSync(defaultPath)) {
    // New character or forced custom -> save to custom
    targetPath = customPath;
  } else if (fs.existsSync(customPath)) {
    // Already in custom -> save to custom
    targetPath = customPath;
  } else {
    // Exists in default -> save to default
    targetPath = defaultPath;
  }

  fs.writeFileSync(targetPath, JSON.stringify(char, null, 2));
  updateCharIndex(char, targetPath.includes('/custom/') ? 'custom' : 'default');
}

// Delete character file + remove from index
function deleteCharacterFile(charId) {
  const customPath = path.join(CHARS_CUSTOM_DIR, `${charId}.json`);
  const defaultPath = path.join(CHARS_DEFAULT_DIR, `${charId}.json`);

  // Delete from wherever it exists
  if (fs.existsSync(customPath)) {
    fs.unlinkSync(customPath);
  }
  if (fs.existsSync(defaultPath)) {
    fs.unlinkSync(defaultPath);
  }
  removeFromCharIndex(charId);
}

// Update/add entry in index
function updateCharIndex(char, category = 'custom') {
  const index = loadCharsIndex();
  const existing = index.findIndex(c => c.id === char.id);
  const entry = {
    id: char.id,
    name: char.name || 'Unnamed Character',
    category: category,
    description: char.description ? char.description.substring(0, 100) + '...' : ''
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  saveCharsIndex(index);
}

// Remove entry from index
function removeFromCharIndex(charId) {
  const index = loadCharsIndex();
  const filtered = index.filter(c => c.id !== charId);
  saveCharsIndex(filtered);
}

// Load multiple characters by ID array
function loadCharacters(charIds) {
  return charIds.map(id => loadCharacter(id)).filter(c => c !== null);
}

// Load all characters (from both default and custom)
function loadAllCharacters() {
  const index = loadCharsIndex();
  return loadCharacters(index.map(c => c.id));
}

// Check if per-character storage is active (migration completed)
function isPerCharStorageActive() {
  return fs.existsSync(path.join(CHARS_DIR, 'chars-index.json'));
}

// Default data structures
const DEFAULT_SETTINGS = {
  llm: { ...llmService.DEFAULT_SETTINGS },
  activePersonaId: null,
  activeCharacterId: null,
  activeFlowIds: [],
  globalPrompt: '', // Author note / system instruction sent with every prompt
  globalReminders: [] // Array of { id, name, text, enabled }
};

const DEFAULT_PERSONAS = [];
const DEFAULT_CHARACTERS = [];
const DEFAULT_DEVICES = [];
const DEFAULT_FLOWS = [];
const DEFAULT_REMOTE_SETTINGS = {
  allowRemote: false,
  whitelistedIps: []
};

// Initialize data files if they don't exist
function initializeDataFiles() {
  if (!loadData(DATA_FILES.settings)) {
    saveData(DATA_FILES.settings, DEFAULT_SETTINGS);
  }
  if (!loadData(DATA_FILES.personas)) {
    saveData(DATA_FILES.personas, DEFAULT_PERSONAS);
  }
  if (!loadData(DATA_FILES.characters)) {
    saveData(DATA_FILES.characters, DEFAULT_CHARACTERS);
  }
  if (!loadData(DATA_FILES.devices)) {
    saveData(DATA_FILES.devices, DEFAULT_DEVICES);
  }
  if (!loadData(DATA_FILES.flows)) {
    saveData(DATA_FILES.flows, DEFAULT_FLOWS);
  }
  if (!loadData(DATA_FILES.remoteSettings)) {
    saveData(DATA_FILES.remoteSettings, DEFAULT_REMOTE_SETTINGS);
  }
}

// Helper to get remote settings
function getRemoteSettings() {
  return loadData(DATA_FILES.remoteSettings) || DEFAULT_REMOTE_SETTINGS;
}

// Helper to check if request is from localhost
function isLocalRequest(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

initializeDataFiles();

// ============================================
// API Key Encryption Migration
// ============================================
// Migrate plaintext API keys to encrypted format
function migrateApiKeyEncryption() {
  let migrated = false;

  // Migrate settings
  const settings = loadData(DATA_FILES.settings);
  if (settings) {
    if (settings.openRouterApiKey && !isEncrypted(settings.openRouterApiKey)) {
      settings.openRouterApiKey = encrypt(settings.openRouterApiKey);
      migrated = true;
    }
    if (settings.goveeApiKey && !isEncrypted(settings.goveeApiKey)) {
      settings.goveeApiKey = encrypt(settings.goveeApiKey);
      migrated = true;
    }
    if (settings.tuyaAccessId && !isEncrypted(settings.tuyaAccessId)) {
      settings.tuyaAccessId = encrypt(settings.tuyaAccessId);
      migrated = true;
    }
    if (settings.tuyaAccessSecret && !isEncrypted(settings.tuyaAccessSecret)) {
      settings.tuyaAccessSecret = encrypt(settings.tuyaAccessSecret);
      migrated = true;
    }
    if (migrated) {
      saveData(DATA_FILES.settings, settings);
      console.log('[Migration] Encrypted plaintext API keys in settings');
    }
  }

  // Migrate connection profiles
  const profiles = loadData(DATA_FILES.connectionProfiles);
  if (profiles && Array.isArray(profiles)) {
    let profilesMigrated = false;
    for (const profile of profiles) {
      if (profile.openRouterApiKey && !isEncrypted(profile.openRouterApiKey)) {
        profile.openRouterApiKey = encrypt(profile.openRouterApiKey);
        profilesMigrated = true;
      }
    }
    if (profilesMigrated) {
      saveData(DATA_FILES.connectionProfiles, profiles);
      console.log('[Migration] Encrypted plaintext API keys in connection profiles');
    }
  }
}

migrateApiKeyEncryption();

// ============================================
// Device Brand Migration
// ============================================
// Add brand field to existing devices that don't have it
function migrateDeviceBrands() {
  const devices = loadData(DATA_FILES.devices) || [];
  let migrated = false;

  for (const device of devices) {
    if (!device.brand) {
      device.brand = 'tplink'; // Default existing devices to TPLink
      migrated = true;
    }
  }

  if (migrated) {
    saveData(DATA_FILES.devices, devices);
    console.log('[Server] Migrated existing devices with brand field');
  }
}

migrateDeviceBrands();

// ============================================
// Character Story Migration
// ============================================
// Migrate legacy welcomeMessages, scenarios, exampleDialogues to new Story format (v2 - multi-version)
function migrateCharacterStories() {
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  let migrated = false;
  const migratedCharacters = []; // Track which characters were migrated for per-char saving

  for (const character of characters) {
    // Check if needs v2 migration - either:
    // 1. Stories exist but welcomeMessages is not an array
    // 2. Stories exist with empty welcomeMessages but top-level welcomeMessages exist
    const hasEmptyStoryWMs = character.stories && character.stories.length > 0 &&
      character.stories[0] && Array.isArray(character.stories[0].welcomeMessages) &&
      character.stories[0].welcomeMessages.length === 0;
    const hasTopLevelWMs = character.welcomeMessages && character.welcomeMessages.length > 0;

    const needsV2Migration = character.stories && character.stories.length > 0 &&
      character.stories[0] && (
        !Array.isArray(character.stories[0].welcomeMessages) ||
        (hasEmptyStoryWMs && hasTopLevelWMs)
      );

    // Skip if already v2 format (has stories with non-empty welcomeMessages array)
    if (character.stories && character.stories.length > 0 &&
        Array.isArray(character.stories[0].welcomeMessages) &&
        character.stories[0].welcomeMessages.length > 0) {
      continue;
    }

    // Get all welcome messages (preserve all versions)
    let welcomeMessages = [];
    let activeWelcomeMessageId = null;
    if (character.welcomeMessages && character.welcomeMessages.length > 0) {
      welcomeMessages = character.welcomeMessages.map(wm => ({
        id: wm.id || `wm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: wm.text || '',
        llmEnhanced: wm.llmEnhanced || false
      }));
      activeWelcomeMessageId = character.activeWelcomeMessageId || welcomeMessages[0]?.id;
    } else if (character.firstMessage) {
      welcomeMessages = [{ id: 'wm-1', text: character.firstMessage, llmEnhanced: false }];
      activeWelcomeMessageId = 'wm-1';
    } else if (needsV2Migration && character.stories[0].welcomeMessage) {
      // Migrating from v1 story format
      welcomeMessages = [{
        id: 'wm-1',
        text: character.stories[0].welcomeMessage,
        llmEnhanced: character.stories[0].llmEnhanced || false
      }];
      activeWelcomeMessageId = 'wm-1';
    }

    // Get all scenarios (preserve all versions)
    let scenarios = [];
    let activeScenarioId = null;
    if (character.scenarios && character.scenarios.length > 0) {
      scenarios = character.scenarios.map(sc => ({
        id: sc.id || `sc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: sc.text || ''
      }));
      activeScenarioId = character.activeScenarioId || scenarios[0]?.id;
    } else if (character.scenario) {
      scenarios = [{ id: 'sc-1', text: character.scenario }];
      activeScenarioId = 'sc-1';
    } else if (needsV2Migration && character.stories[0].scenario) {
      // Migrating from v1 story format
      scenarios = [{ id: 'sc-1', text: character.stories[0].scenario }];
      activeScenarioId = 'sc-1';
    }

    // Get example dialogues
    let exampleDialogues = [];
    if (character.exampleDialogues && character.exampleDialogues.length > 0) {
      exampleDialogues = character.exampleDialogues;
    } else if (needsV2Migration && character.stories[0].exampleDialogues) {
      exampleDialogues = character.stories[0].exampleDialogues;
    }

    // Preserve existing story settings if migrating
    const existingStory = needsV2Migration ? character.stories[0] : {};

    // Create/update the stories array with Story 1 (v2 format with arrays)
    character.stories = [{
      id: existingStory.id || 'story-1',
      name: existingStory.name || 'Story 1',
      welcomeMessages,
      activeWelcomeMessageId,
      scenarios,
      activeScenarioId,
      exampleDialogues: exampleDialogues.length > 0 ? exampleDialogues : (existingStory.exampleDialogues || []),
      autoReplyEnabled: existingStory.autoReplyEnabled ?? character.autoReplyEnabled ?? false,
      assignedFlows: existingStory.assignedFlows || character.assignedFlows || [],
      assignedButtons: existingStory.assignedButtons || [],
      constantReminderIds: existingStory.constantReminderIds || [],
      globalReminderIds: existingStory.globalReminderIds || [],
      startingEmotion: existingStory.startingEmotion || character.startingEmotion || 'neutral'
    }];
    character.activeStoryId = character.stories[0].id;

    migrated = true;
    migratedCharacters.push(character);
    console.log(`[Migration] Migrated character "${character.name}" to Story v2 format (multi-version)`);
  }

  if (migrated) {
    // Save using per-char storage if active
    if (isPerCharStorageActive()) {
      for (const char of migratedCharacters) {
        saveCharacter(char);
      }
    } else {
      saveData(DATA_FILES.characters, characters);
    }
    console.log('[Server] Character story migration complete');
  }
}

migrateCharacterStories();

// ============================================
// Simulation Mode Detection
// ============================================

/**
 * Check if simulation mode is required (no devices or no primary pump)
 * @returns {{ required: boolean, reason: string }}
 */
function getSimulationStatus() {
  const devices = loadData(DATA_FILES.devices) || [];

  if (devices.length === 0) {
    return { required: true, reason: 'No devices configured' };
  }

  // Check for primary pump (explicit isPrimaryPump flag OR any device with deviceType === 'PUMP')
  const hasPrimaryPump = devices.some(d =>
    d.isPrimaryPump === true || d.deviceType === 'PUMP'
  );

  if (!hasPrimaryPump) {
    return { required: true, reason: 'No primary pump set' };
  }

  return { required: false, reason: null };
}

// ============================================
// Session State (in-memory)
// ============================================

const sessionState = {
  capacity: 0,
  pain: 0, // 0-10 numeric pain scale
  emotion: 'neutral',
  capacityModifier: 1.0, // Multiplier for auto-capacity speed (0.25 to 2.0)
  chatHistory: [],
  messageInputHistory: [], // Track input history for up/down arrow navigation
  flowVariables: {},
  deviceStates: {},
  flowAssignments: {
    personas: {},
    characters: {},
    global: []
  },
  executionHistory: {
    deliveredMessages: new Set(), // Track message hashes to prevent duplicates
    deviceActions: {}, // Track device states: { deviceIp: { state: 'on'|'off', cycling: bool } }
    storyEvents: new Set(), // Track story event IDs
    lastExecutionTime: {} // Track last execution time per flow node
  },
  autoReply: false, // When false, AI only responds via Guided Response/Events/Flows
  playerName: null, // Active persona's display name
  characterName: null, // Active character's name
  pumpRuntimeTracker: {} // deviceKey -> { totalSeconds } for auto-capacity tracking
};

// LLM State - tracks busy state and queues flow messages when LLM is busy
const llmState = {
  isGenerating: false,
  queuedFlowMessage: null // { type, data } - single queued flow message to process when LLM is free
};

// Process queued flow message when LLM becomes free
async function processQueuedFlowMessage() {
  if (llmState.queuedFlowMessage && !llmState.isGenerating) {
    const { type, data } = llmState.queuedFlowMessage;
    llmState.queuedFlowMessage = null;
    console.log(`[LLM Queue] Processing queued ${type} message`);
    // Re-broadcast to trigger the message generation
    await eventEngine.broadcast(type, data);
  }
}

// ============================================
// Universal Variable Substitution
// ============================================

/**
 * Substitute all variable patterns with their actual values
 * Supports: [Player], [Char], [Capacity], [Feeling], [Emotion], [Flow:varname]
 */
function substituteAllVariables(text, context = {}) {
  if (!text) return text;

  let result = text;

  // Player name
  const playerName = context.playerName || sessionState.playerName;
  if (playerName) {
    result = result.replace(/\[Player\]/gi, playerName);
  }

  // Character name
  const charName = context.characterName || sessionState.characterName;
  if (charName) {
    result = result.replace(/\[Char\]/gi, charName);
  }

  // Session state variables
  result = result.replace(/\[Capacity\]/gi, sessionState.capacity ?? 0);
  // Convert pain number to descriptive label
  const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
  const painValue = sessionState.pain ?? 0;
  const painLabel = painLabels[painValue] || `Level ${painValue}`;
  result = result.replace(/\[Pain\]/gi, painLabel);
  result = result.replace(/\[Feeling\]/gi, painLabel); // Legacy support
  result = result.replace(/\[Emotion\]/gi, sessionState.emotion ?? 'neutral');

  // Challenge result - provides context about the last challenge outcome
  if (sessionState.lastChallengeResult) {
    const cr = sessionState.lastChallengeResult;
    result = result.replace(/\[ChallengeResult\]/gi, cr.description || cr.outcome);
    result = result.replace(/\[ChallengeType\]/gi, cr.typeName || cr.type);
    result = result.replace(/\[ChallengeOutcome\]/gi, cr.outcome);
  } else {
    result = result.replace(/\[ChallengeResult\]/gi, '');
    result = result.replace(/\[ChallengeType\]/gi, '');
    result = result.replace(/\[ChallengeOutcome\]/gi, '');
  }

  // Flow variables - [Flow:varname] syntax
  result = result.replace(/\[Flow:(\w+)\]/gi, (match, varName) => {
    return sessionState.flowVariables?.[varName] !== undefined
      ? sessionState.flowVariables[varName]
      : match;
  });

  return result;
}

// Auto-save session state
function autosaveSession() {
  try {
    const settings = loadData(DATA_FILES.settings);
    const autosaveData = {
      personaId: settings?.activePersonaId,
      characterId: settings?.activeCharacterId,
      capacity: sessionState.capacity,
      pain: sessionState.pain,
      emotion: sessionState.emotion,
      chatHistory: sessionState.chatHistory,
      messageInputHistory: sessionState.messageInputHistory,
      flowVariables: sessionState.flowVariables,
      pumpRuntimeTracker: sessionState.pumpRuntimeTracker,
      updatedAt: Date.now()
    };
    saveData(DATA_FILES.autosave, autosaveData);
  } catch (error) {
    console.error('[Autosave] Failed to save session:', error);
  }
}

// Load autosaved session
function loadAutosave() {
  try {
    const autosaveData = loadData(DATA_FILES.autosave);
    if (autosaveData && autosaveData.chatHistory) {
      sessionState.capacity = autosaveData.capacity || 0;
      // Support both new 'pain' and legacy 'sensation' values
      if (typeof autosaveData.pain === 'number') {
        sessionState.pain = autosaveData.pain;
      } else if (autosaveData.sensation) {
        // Migrate old sensation strings to pain numbers
        const sensationToPain = {
          'normal': 0, 'slightly tight': 2, 'comfortably full': 3,
          'stretched': 5, 'very tight': 7, 'painfully tight': 9
        };
        sessionState.pain = sensationToPain[autosaveData.sensation] ?? 0;
      } else {
        sessionState.pain = 0;
      }
      sessionState.emotion = autosaveData.emotion || 'neutral';
      sessionState.chatHistory = autosaveData.chatHistory || [];
      sessionState.messageInputHistory = autosaveData.messageInputHistory || [];
      sessionState.flowVariables = autosaveData.flowVariables || {};
      sessionState.pumpRuntimeTracker = autosaveData.pumpRuntimeTracker || {};
      console.log('[Autosave] Loaded previous session with', sessionState.chatHistory.length, 'messages, capacity:', sessionState.capacity);
      return true;
    }
  } catch (error) {
    console.error('[Autosave] Failed to load session:', error);
  }
  return false;
}

// ============================================
// WebSocket Management
// ============================================

const wsClients = new Set();

function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ============================================
// Console -> Browser DevTools Bridge
// ============================================
// Intercept console methods and broadcast to frontend for debugging
const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console)
};

let consoleBroadcastEnabled = true;

function formatConsoleArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

console.log = (...args) => {
  originalConsole.log(...args);
  if (consoleBroadcastEnabled && wsClients.size > 0) {
    broadcast('server_log', { level: 'log', message: formatConsoleArgs(args) });
  }
};

console.error = (...args) => {
  originalConsole.error(...args);
  if (consoleBroadcastEnabled && wsClients.size > 0) {
    broadcast('server_log', { level: 'error', message: formatConsoleArgs(args) });
  }
};

console.warn = (...args) => {
  originalConsole.warn(...args);
  if (consoleBroadcastEnabled && wsClients.size > 0) {
    broadcast('server_log', { level: 'warn', message: formatConsoleArgs(args) });
  }
};

/**
 * Handle pump runtime events for auto-capacity tracking
 */
function handlePumpRuntime({ ip, device, runtimeSeconds, calibrationTime, isRealTime }) {
  const settings = loadData(DATA_FILES.settings) || {};
  const useAutoCapacity = settings.globalCharacterControls?.useAutoCapacity;

  if (!useAutoCapacity || !calibrationTime) return;

  // Update tracker
  if (!sessionState.pumpRuntimeTracker[ip]) {
    sessionState.pumpRuntimeTracker[ip] = { totalSeconds: 0, baseSeconds: 0 };
  }

  if (isRealTime) {
    // Real-time updates send total runtime since pump started - add to base
    sessionState.pumpRuntimeTracker[ip].totalSeconds =
      sessionState.pumpRuntimeTracker[ip].baseSeconds + runtimeSeconds;
  } else {
    // Final update when pump stops - add to base for next cycle
    sessionState.pumpRuntimeTracker[ip].baseSeconds += runtimeSeconds;
    sessionState.pumpRuntimeTracker[ip].totalSeconds =
      sessionState.pumpRuntimeTracker[ip].baseSeconds;
  }

  // Calculate total capacity from all pumps, applying the capacity modifier from settings
  const capacityModifier = settings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
  let totalCapacity = 0;
  const devices = loadData(DATA_FILES.devices) || [];

  for (const [deviceKey, tracker] of Object.entries(sessionState.pumpRuntimeTracker)) {
    const deviceData = devices.find(d =>
      d.ip === deviceKey || `${d.ip}:${d.childId}` === deviceKey
    );
    if (deviceData?.calibrationTime) {
      // Apply capacityModifier to speed up or slow down capacity increase
      totalCapacity += (tracker.totalSeconds / deviceData.calibrationTime) * 100 * capacityModifier;
    }
  }

  // Round to nearest integer
  totalCapacity = Math.round(totalCapacity);

  // Calculate pain (scale linearly based on capacity, using max calibrated pain)
  const calibratedPains = devices
    .filter(d => typeof d.calibrationPainAtMax === 'number')
    .map(d => d.calibrationPainAtMax);
  const maxPain = calibratedPains.length > 0 ? Math.max(...calibratedPains) : 10;
  const pain = Math.min(10, Math.round((Math.min(totalCapacity, 100) / 100) * maxPain));

  sessionState.capacity = totalCapacity;
  sessionState.pain = pain;

  console.log(`[AutoCapacity] Runtime: ${runtimeSeconds.toFixed(1)}s, Total capacity: ${totalCapacity}%, Pain: ${pain}`);

  // Broadcast update
  broadcast('auto_capacity_update', {
    capacity: totalCapacity,
    pain: pain,
    isOverInflating: totalCapacity > 100
  });

  // Check device monitors for capacity-based stop conditions
  eventEngine.checkDeviceMonitors();

  // Trigger player state change flows
  eventEngine.checkPlayerStateChanges({
    capacity: totalCapacity,
    pain: pain,
    emotion: sessionState.emotion
  });
}

// Device service event handler
deviceService.setEventEmitter((eventType, data) => {
  broadcast(eventType, data);

  // Route cycle_complete to event engine for completion chain execution
  if (eventType === 'cycle_complete') {
    console.log(`[DeviceEvent] Cycle complete for ${data.ip}, triggering completion chain`);
    eventEngine.handleCycleComplete(data.ip);
  }

  // Route pump_runtime to auto-capacity handler
  if (eventType === 'pump_runtime') {
    handlePumpRuntime(data);
  }
});

// ============================================
// Character Helper Functions
// ============================================

// Get active welcome message for a character
function getActiveWelcomeMessage(character) {
  if (!character) return null;

  // Check active story first (v2 format - stories contain welcomeMessages)
  if (character.stories && character.stories.length > 0) {
    const activeStoryId = character.activeStoryId || character.stories[0].id;
    const activeStory = character.stories.find(s => s.id === activeStoryId) || character.stories[0];

    if (activeStory?.welcomeMessages?.length > 0) {
      const activeId = activeStory.activeWelcomeMessageId || activeStory.welcomeMessages[0].id;
      const activeWelcome = activeStory.welcomeMessages.find(w => w.id === activeId);
      return activeWelcome || activeStory.welcomeMessages[0];
    }
  }

  // Fallback to root level welcomeMessages (legacy format)
  if (character.welcomeMessages && character.welcomeMessages.length > 0) {
    const activeId = character.activeWelcomeMessageId || character.welcomeMessages[0].id;
    const activeWelcome = character.welcomeMessages.find(w => w.id === activeId);
    return activeWelcome || character.welcomeMessages[0];
  }

  // Fallback for old format (shouldn't happen after migration)
  if (character.firstMessage) {
    return { id: 'wm-1', text: character.firstMessage, llmEnhanced: false };
  }

  return null;
}

// Get active scenario for a character
function getActiveScenario(character) {
  if (!character) return '';

  // Check active story first (v2 format - stories contain scenarios)
  if (character.stories && character.stories.length > 0) {
    const activeStoryId = character.activeStoryId || character.stories[0].id;
    const activeStory = character.stories.find(s => s.id === activeStoryId) || character.stories[0];

    if (activeStory?.scenarios?.length > 0) {
      const activeId = activeStory.activeScenarioId || activeStory.scenarios[0].id;
      const activeScenario = activeStory.scenarios.find(s => s.id === activeId);
      return activeScenario ? activeScenario.text : '';
    }
  }

  // Fallback to root level scenarios (legacy format)
  if (character.scenarios && character.scenarios.length > 0) {
    const activeId = character.activeScenarioId || character.scenarios[0].id;
    const activeScenario = character.scenarios.find(s => s.id === activeId);
    return activeScenario ? activeScenario.text : '';
  }

  // Fallback for old format (shouldn't happen after migration)
  if (character.scenario) {
    return character.scenario;
  }

  return '';
}

// Send welcome message (with optional LLM enhancement)
async function sendWelcomeMessage(character, settings) {
  if (!character) return;

  const welcomeMsg = getActiveWelcomeMessage(character);
  if (!welcomeMsg || !welcomeMsg.text) return;

  console.log('[WELCOME] Sending welcome message for', character.name, 'llmEnhanced:', welcomeMsg.llmEnhanced);

  // Check if welcome message is already being sent or was already sent (race condition protection)
  // Only count character/player messages - system messages from flow triggers shouldn't block welcome
  const hasCharacterMessages = sessionState.chatHistory.some(msg => msg.sender === 'character' || msg.sender === 'player');
  if (sendingWelcomeMessage || hasCharacterMessages) {
    console.log('[WELCOME] Skipping - already sending or character messages exist');
    return;
  }

  // Set lock
  sendingWelcomeMessage = true;

  const { v4: uuidv4 } = require('uuid');

  // Add placeholder to chatHistory immediately to prevent race condition
  const messageId = uuidv4();
  const placeholderMessage = {
    id: messageId,
    sender: 'character',
    characterName: character.name,
    content: '...', // Placeholder
    timestamp: Date.now()
  };
  sessionState.chatHistory.push(placeholderMessage);

  let messageContent = welcomeMsg.text;

  // If LLM enhancement is enabled, process through LLM
  if (welcomeMsg.llmEnhanced) {
    try {
      // Notify UI that AI is generating
      broadcast('generating_start', { characterName: character.name });

      // Build system prompt with constant reminders
      let systemPrompt = `You are ${character.name}. ${character.description}\n`;
      systemPrompt += `IMPORTANT WRITING STYLE: Use "I/my/me" in DIALOGUE, but use "${character.name}" (third person) for ACTIONS.\nExample: "I'll turn this up," ${character.name} says, reaching for the dial.\n\n`;
      if (character.personality) {
        systemPrompt += `Personality: ${character.personality}\n\n`;
      }

      const scenario = getActiveScenario(character);
      if (scenario) {
        systemPrompt += `Scenario: ${scenario}\n\n`;
      }

      // Add constant reminders (character + global, filtered by enabled)
      const charReminders = (character.constantReminders || []).filter(r => r.enabled !== false);
      const globalReminders = (settings.globalReminders || []).filter(r => r.enabled !== false);
      if (charReminders.length > 0 || globalReminders.length > 0) {
        systemPrompt += 'Constant Reminders:\n';
        globalReminders.forEach(reminder => {
          systemPrompt += `- [Global] ${reminder.text}\n`;
        });
        charReminders.forEach(reminder => {
          systemPrompt += `- ${reminder.text}\n`;
        });
        systemPrompt += '\n';
      }

      systemPrompt += `Write an engaging, in-character first message to greet the player. Base it on this template but expand and enhance it:\n\n"${welcomeMsg.text}"`;

      const result = await llmService.generate({
        prompt: `${character.name}:`,
        systemPrompt,
        settings: settings.llm
      });

      console.log('[WELCOME] LLM result:', JSON.stringify(result).substring(0, 200));

      if (result && result.text) {
        messageContent = result.text.trim();
        console.log('[WELCOME] LLM enhanced message:', messageContent.substring(0, 100) + '...');
      } else {
        console.log('[WELCOME] LLM returned no response, using template', result);
      }

      broadcast('generating_stop', {});
    } catch (error) {
      console.error('Failed to enhance welcome message with LLM:', error);
      broadcast('generating_stop', {});
      // Fall back to template message
    }
  }

  // Update placeholder with final content (apply variable substitution)
  placeholderMessage.content = substituteAllVariables(messageContent);

  broadcast('chat_message', placeholderMessage);
  autosaveSession();

  // Release lock
  sendingWelcomeMessage = false;
}

// Event engine broadcast handler - wrap to create proper message objects with LLM enhancement
eventEngine.setBroadcast(async (type, data) => {
  // For ai_message, use LLM enhancement (unless suppressed)
  if (type === 'ai_message') {
    // Skip blank messages early
    if (isBlankMessage(data.content)) {
      console.log('[EventEngine] Skipping blank ai_message');
      return;
    }

    // If flows are paused, queue this for later and skip
    if (eventEngine.isFlowsPaused()) {
      console.log('[EventEngine] Flows paused - queueing ai_message for later');
      if (data.flowId && data.nodeId) {
        eventEngine.queuePausedExecution(data.flowId, data.nodeId, data.content, 'ai_message');
      }
      return;
    }

    // If LLM is already busy (e.g., user triggered guided impersonate), wait for it to finish
    if (llmState.isGenerating && !data.suppressLlm) {
      console.log('[EventEngine] LLM busy - waiting for current generation to complete...');
      // Wait for LLM to finish (check every 100ms, timeout after 60s)
      const startWait = Date.now();
      while (llmState.isGenerating && (Date.now() - startWait) < 60000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (llmState.isGenerating) {
        console.log('[EventEngine] LLM wait timeout - proceeding anyway');
      } else {
        console.log('[EventEngine] LLM now available - proceeding with message');
      }
    }

    const settings = loadData(DATA_FILES.settings);
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);

    console.log(`[EventEngine] ai_message: activeCharId=${settings?.activeCharacterId}, found=${activeCharacter?.name || 'none'}, content=${data.content?.substring(0, 50)}...`);

    if (!activeCharacter) {
      console.log('[EventEngine] No active character found for ai_message - skipping');
      return;
    }

    // Create placeholder message with "..."
    const placeholderMessage = {
      id: uuidv4(),
      content: '...',
      sender: 'character',
      characterId: activeCharacter.id,
      characterName: activeCharacter.name,
      timestamp: Date.now()
    };

    // Broadcast placeholder but DON'T add to chat history yet (to avoid LLM seeing "...")
    broadcast('chat_message', placeholderMessage);

    // If suppressLlm is true, use raw content without LLM
    if (data.suppressLlm) {
      console.log('[EventEngine] Suppress LLM - using verbatim message');
      placeholderMessage.content = data.content;
      sessionState.chatHistory.push(placeholderMessage);
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
      return;
    }

    // If LLM is available, enhance the message
    const hasLlmConfig = settings?.llm?.llmUrl ||
      (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);
    if (hasLlmConfig && data.content) {
      llmState.isGenerating = true;
      broadcast('generating_start', { characterName: activeCharacter.name });

      try {
        // Build context with the instruction from the flow
        const context = buildChatContext(activeCharacter, settings);

        // Build challenge-specific instruction if this is from a challenge node
        let challengeInstruction = '';
        if (data.challengeContext) {
          const challengeNames = {
            'prize_wheel': 'Prize Wheel',
            'dice_roll': 'Dice Roll',
            'coin_flip': 'Coin Flip',
            'rps': 'Rock Paper Scissors',
            'timer_challenge': 'Timer Challenge',
            'number_guess': 'Number Guess',
            'slot_machine': 'Slot Machine',
            'card_draw': 'Card Draw'
          };
          const challengeName = challengeNames[data.challengeContext.type] || data.challengeContext.type;

          if (data.challengeContext.event === 'start') {
            challengeInstruction = `\n\nCHALLENGE CONTEXT: A ${challengeName} game is starting. Your message MUST acknowledge and introduce this game to the player. Do not ignore the game or continue as if nothing is happening.`;
          } else if (data.challengeContext.event === 'win') {
            challengeInstruction = `\n\nCHALLENGE CONTEXT: You just WON a ${challengeName} game against the player! Your message MUST celebrate or react to your victory. The outcome was: ${data.challengeContext.outcome}.`;
          } else if (data.challengeContext.event === 'lose') {
            challengeInstruction = `\n\nCHALLENGE CONTEXT: You just LOST a ${challengeName} game to the player! Your message MUST acknowledge your defeat and react to losing. The outcome was: ${data.challengeContext.outcome}.`;
          }
        }

        // Build capacity message instruction if this is from a capacity node
        let capacityInstruction = '';
        if (data.isCapacityMessage) {
          capacityInstruction = `\n\nCAPACITY STATUS OBSERVATION: This is a clinical observation of the player's current inflation state.
- You are ${activeCharacter.name} observing and documenting the player's physical condition
- Maintain your character's personality while being observational
- Note visible physical changes, breathing patterns, and body language
- Use clinical or detached language appropriate to your character`;
        }

        // Add instruction to BOTH system prompt AND at the end of the prompt for emphasis
        const instruction = `[YOUR NEXT MESSAGE MUST EXPRESS THIS ACTION: ${data.content}]`;
        context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be the character performing this specific action: "${data.content}"${challengeInstruction}${capacityInstruction}\nIgnore previous conversation flow. Do NOT respond to what the player said. Simply perform the action described above.\n=== END CRITICAL INSTRUCTION ===`;

        // Append instruction to the prompt so it's the last thing before generation
        context.prompt += `\n\n${instruction}\n${activeCharacter.name}:`;

        console.log('[EventEngine] Generating LLM message based on:', data.content);

        // Generate enhanced response
        const result = await llmService.generate({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: settings.llm
        });

        // Check if generation was aborted (user navigated away OR emergency stop)
        if (eventEngine.shouldAbortGeneration() || eventEngine.aborted) {
          console.log('[EventEngine] Generation aborted -', eventEngine.aborted ? 'emergency stop' : 'user navigated away');
          llmState.isGenerating = false;
          broadcast('generating_stop', {});
          broadcast('message_deleted', { id: placeholderMessage.id });
          // Only queue for resumption if NOT emergency stopped (pause only)
          if (!eventEngine.aborted && data.flowId && data.nodeId) {
            eventEngine.queuePausedExecution(data.flowId, data.nodeId, data.content, 'ai_message');
          }
          return;
        }

        let finalText = result.text;
        let retryCount = 0;
        const maxRetries = 2;

        // Retry if blank or duplicate
        while ((isBlankMessage(finalText) || isDuplicateMessage(finalText)) && retryCount < maxRetries) {
          retryCount++;
          console.log(`[EventEngine] Regenerating (attempt ${retryCount}): blank=${isBlankMessage(finalText)}, duplicate=${isDuplicateMessage(finalText)}`);

          // Add variation instruction
          const variationContext = buildChatContext(activeCharacter, settings);
          variationContext.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be the character performing this specific action: "${data.content}"${challengeInstruction}\nIMPORTANT: Write a UNIQUE and DIFFERENT response. Do not repeat previous messages.\n=== END CRITICAL INSTRUCTION ===`;
          variationContext.prompt += `\n\n[Write a unique variation of: ${data.content}]\n${activeCharacter.name}:`;

          const retryResult = await llmService.generate({
            prompt: variationContext.prompt,
            systemPrompt: variationContext.systemPrompt,
            settings: settings.llm
          });
          finalText = retryResult.text;
        }

        // Apply variable substitution to final result
        finalText = substituteAllVariables(finalText);

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService);
        if (aiControlResult.commands.length > 0) {
          console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
          finalText = aiControlResult.text;
        }

        // Update placeholder with final result
        placeholderMessage.content = finalText;
        llmState.isGenerating = false;
        broadcast('generating_stop', {});

        // Final validation - only skip if still invalid after retries
        if (isBlankMessage(finalText)) {
          console.log('[EventEngine] Skipping blank response after retries');
          broadcast('message_deleted', { id: placeholderMessage.id });
          await processQueuedFlowMessage();
          return;
        }
        if (isDuplicateMessage(finalText)) {
          console.log('[EventEngine] Skipping duplicate response after retries');
          broadcast('message_deleted', { id: placeholderMessage.id });
          await processQueuedFlowMessage();
          return;
        }

        // NOW add to chat history with the real content
        sessionState.chatHistory.push(placeholderMessage);
        broadcast('message_updated', placeholderMessage);
        autosaveSession();
        // Process any queued flow message
        await processQueuedFlowMessage();
      } catch (error) {
        console.error('[EventEngine] LLM enhancement failed:', error);
        llmState.isGenerating = false;
        broadcast('generating_stop', {});

        // If aborted (emergency stop), don't post any message
        if (eventEngine.aborted) {
          console.log('[EventEngine] LLM failed during abort - suppressing fallback message');
          broadcast('message_deleted', { id: placeholderMessage.id });
          return;
        }

        // Validate fallback content
        if (isBlankMessage(data.content) || isDuplicateMessage(data.content)) {
          console.log('[EventEngine] Skipping invalid fallback message');
          broadcast('message_deleted', { id: placeholderMessage.id });
          return;
        }

        // Fallback to raw instruction text
        placeholderMessage.content = data.content;
        sessionState.chatHistory.push(placeholderMessage);
        broadcast('message_updated', placeholderMessage);
        autosaveSession();
        // Process any queued flow message
        await processQueuedFlowMessage();
      }
    } else {
      // No LLM available - validate raw content
      if (isBlankMessage(data.content) || isDuplicateMessage(data.content)) {
        console.log('[EventEngine] Skipping invalid raw message');
        broadcast('message_deleted', { id: placeholderMessage.id });
        return;
      }

      placeholderMessage.content = data.content;
      sessionState.chatHistory.push(placeholderMessage);
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
    }
  } else if (type === 'player_message') {
    // Player messages from flow - optionally LLM enhanced
    if (isBlankMessage(data.content)) {
      console.log('[EventEngine] Skipping blank player_message');
      return;
    }

    // If flows are paused, queue this for later and skip
    if (eventEngine.isFlowsPaused()) {
      console.log('[EventEngine] Flows paused - queueing player_message for later');
      if (data.flowId && data.nodeId) {
        eventEngine.queuePausedExecution(data.flowId, data.nodeId, data.content, 'player_message');
      }
      return;
    }

    const settings = loadData(DATA_FILES.settings);
    const personas = loadData(DATA_FILES.personas) || [];
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activePersona = personas.find(p => p.id === settings?.activePersonaId);
    const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
    const playerName = activePersona?.displayName || 'Player';

    // Create placeholder message
    const placeholderMessage = {
      id: uuidv4(),
      content: '...',
      sender: 'player',
      timestamp: Date.now()
    };

    broadcast('chat_message', placeholderMessage);

    // If suppressLlm is true, use raw content
    if (data.suppressLlm) {
      console.log('[EventEngine] Suppress LLM - using verbatim player message');
      placeholderMessage.content = data.content;
      sessionState.chatHistory.push(placeholderMessage);
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
      return;
    }

    // If LLM is already busy, wait for it to finish
    if (llmState.isGenerating && !data.suppressLlm) {
      console.log('[EventEngine] LLM busy - waiting for current generation to complete...');
      const startWait = Date.now();
      while (llmState.isGenerating && (Date.now() - startWait) < 60000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (llmState.isGenerating) {
        console.log('[EventEngine] LLM wait timeout - proceeding anyway');
      } else {
        console.log('[EventEngine] LLM now available - proceeding with player message');
      }
    }

    // If LLM is available, enhance the message
    const hasLlmConfig = settings?.llm?.llmUrl ||
      (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);
    if (hasLlmConfig && data.content && activeCharacter) {
      llmState.isGenerating = true;
      broadcast('generating_start', { characterName: playerName, isPlayerVoice: true });

      try {
        const context = buildSpecialContext('impersonate', null, activeCharacter, activePersona, settings);

        // Extra enforcement for capacity messages
        const capacityEmphasis = data.isCapacityMessage ? `
IMPORTANT: This is a CAPACITY STATUS message. You are reporting ${playerName}'s physical state.
- Focus on ${playerName}'s internal sensations, breathing, and physical feelings
- Express the intensity appropriate to their current fullness level
- Use desperate, pleading, or overwhelmed tones as appropriate` : '';

        context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===
Your next response MUST be ${playerName} performing this action: "${data.content}"

STRICT RULES:
- Write ONLY in FIRST PERSON (I/me/my) - NEVER use second person (you/your)
- Write ONLY ${playerName}'s words, thoughts, feelings, and physical sensations
- Do NOT write ANY dialogue or actions for ${activeCharacter.name}
- Do NOT narrate what ${activeCharacter.name} does or says
- Keep it SHORT - 1-3 sentences max
- Example format: "*I gasp as the pressure builds...* Please, stop!"${capacityEmphasis}
=== END CRITICAL INSTRUCTION ===`;
        context.prompt += `\n\n[${playerName} (FIRST PERSON ONLY): ${data.content}]\n${playerName}:`;

        const result = await llmService.generate({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: settings.llm
        });

        // Check if generation was aborted (user navigated away OR emergency stop)
        if (eventEngine.shouldAbortGeneration() || eventEngine.aborted) {
          console.log('[EventEngine] Player message generation aborted -', eventEngine.aborted ? 'emergency stop' : 'user navigated away');
          llmState.isGenerating = false;
          broadcast('generating_stop', {});
          broadcast('message_deleted', { id: placeholderMessage.id });
          // Only queue for resumption if NOT emergency stopped (pause only)
          if (!eventEngine.aborted && data.flowId && data.nodeId) {
            eventEngine.queuePausedExecution(data.flowId, data.nodeId, data.content, 'player_message');
          }
          return;
        }

        // Apply variable substitution
        placeholderMessage.content = substituteAllVariables(result.text);
        llmState.isGenerating = false;
        broadcast('generating_stop', {});

        if (isBlankMessage(result.text)) {
          placeholderMessage.content = substituteAllVariables(data.content);
        }

        sessionState.chatHistory.push(placeholderMessage);
        broadcast('message_updated', placeholderMessage);
        autosaveSession();
        await processQueuedFlowMessage();
      } catch (error) {
        console.error('[EventEngine] Player message LLM enhancement failed:', error);
        llmState.isGenerating = false;
        broadcast('generating_stop', {});

        // If aborted (emergency stop), don't post any message
        if (eventEngine.aborted) {
          console.log('[EventEngine] Player message LLM failed during abort - suppressing fallback');
          broadcast('message_deleted', { id: placeholderMessage.id });
          return;
        }

        placeholderMessage.content = data.content;
        sessionState.chatHistory.push(placeholderMessage);
        broadcast('message_updated', placeholderMessage);
        autosaveSession();
        await processQueuedFlowMessage();
      }
    } else {
      // No LLM - use raw content
      placeholderMessage.content = data.content;
      sessionState.chatHistory.push(placeholderMessage);
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
    }
  } else if (type === 'system_message') {
    // System messages don't get LLM enhancement
    const settings = loadData(DATA_FILES.settings);
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);

    const message = {
      id: uuidv4(),
      content: data.content,
      sender: 'system',
      characterId: activeCharacter?.id,
      characterName: activeCharacter?.name,
      timestamp: Date.now()
    };

    sessionState.chatHistory.push(message);
    broadcast('chat_message', message);
    autosaveSession();
  } else {
    // For other message types, broadcast normally
    broadcast(type, data);
  }
});
eventEngine.setSessionState(sessionState);

// Inject storage helpers for per-char/per-flow storage access
eventEngine.setStorageHelpers({
  loadCharacters: () => isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []),
  saveCharacter: (char) => {
    if (isPerCharStorageActive()) {
      saveCharacter(char);
    } else {
      const characters = loadData(DATA_FILES.characters) || [];
      const idx = characters.findIndex(c => c.id === char.id);
      if (idx !== -1) {
        characters[idx] = char;
        saveData(DATA_FILES.characters, characters);
      }
    }
  },
  isPerCharActive: isPerCharStorageActive,
  loadFlow: (flowId) => isPerFlowStorageActive() ? loadFlow(flowId) : null,
  loadAllFlows: () => isPerFlowStorageActive() ? loadAllFlows() : (loadData(DATA_FILES.flows) || []),
  isPerFlowActive: isPerFlowStorageActive
});

// ============================================
// Programmatic Button Sync System
// ============================================

/**
 * Extract all Button Press trigger node labels from a flow
 * @param {Object} flow - The flow object containing nodes
 * @param {string|null} targetType - Optional filter: 'character' or 'persona'. If null, returns all.
 * @returns {Array<{label: string, nodeId: string}>} - Array of button press labels with their node IDs
 */
function extractButtonPressLabels(flow, targetType = null) {
  if (!flow || !flow.nodes) return [];
  return flow.nodes
    .filter(n => {
      if (n.type !== 'button_press' || !n.data?.label) return false;
      // If targetType specified, filter by buttonTarget (default 'character' for backward compat)
      if (targetType !== null) {
        const nodeTarget = n.data.buttonTarget || 'character';
        return nodeTarget === targetType;
      }
      return true;
    })
    .map(n => ({ label: n.data.label, nodeId: n.id }));
}

/**
 * Helper to get next available button ID
 */
function getNextButtonId(buttons) {
  const existingIds = buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
  return existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
}

/**
 * Synchronize auto-generated buttons for a character based on assigned flows
 * @param {string} characterId - The character ID
 * @param {Array<string>} assignedFlowIds - Array of flow IDs assigned to this character
 * @returns {boolean} - Whether buttons were modified
 */
function syncAutoGeneratedButtons(characterId, assignedFlowIds) {
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  // Use per-flow storage if active - load only assigned flows
  const flows = isPerFlowStorageActive() ? loadFlows(assignedFlowIds) : (loadData(DATA_FILES.flows) || []);
  const charIndex = characters.findIndex(c => c.id === characterId);

  if (charIndex === -1) {
    console.log(`[ButtonSync] Character ${characterId} not found`);
    return false;
  }

  const character = characters[charIndex];
  let buttons = character.buttons || [];
  const originalCount = buttons.length;
  const originalAutoCount = buttons.filter(b => b.autoGenerated).length;

  // 1. Collect all expected auto-generated buttons from assigned flows (only character-targeted buttons)
  const expectedAutoButtons = [];
  for (const flowId of assignedFlowIds) {
    const flow = flows.find(f => f.id === flowId);
    if (!flow) continue;

    const buttonPressLabels = extractButtonPressLabels(flow, 'character');
    for (const { label, nodeId } of buttonPressLabels) {
      expectedAutoButtons.push({
        name: label,
        flowId: flowId,
        flowActionLabel: label,
        sourceNodeId: nodeId
      });
    }
  }

  // 2. Remove auto-generated buttons that no longer have corresponding flow actions
  buttons = buttons.filter(button => {
    if (!button.autoGenerated) return true; // Keep manual buttons

    // Check if this auto button still has a matching expected button
    return expectedAutoButtons.some(eb =>
      eb.flowId === button.sourceFlowId &&
      eb.flowActionLabel === button.name
    );
  });

  // 3. Process expected auto buttons
  for (const expected of expectedAutoButtons) {
    // Check if a manual button with this name exists
    const existingManualIndex = buttons.findIndex(b =>
      !b.autoGenerated && b.name === expected.name
    );

    if (existingManualIndex !== -1) {
      // Convert manual button to auto-generated, preserve buttonId
      const manualButton = buttons[existingManualIndex];
      buttons[existingManualIndex] = {
        ...manualButton,
        autoGenerated: true,
        sourceFlowId: expected.flowId,
        sourceNodeId: expected.sourceNodeId,
        actions: [{
          type: 'link_to_flow',
          config: {
            flowId: expected.flowId,
            flowActionLabel: expected.flowActionLabel
          }
        }]
      };
      console.log(`[ButtonSync] Converted manual button "${expected.name}" to auto-generated`);
      continue;
    }

    // Check if auto button already exists
    const existingAutoIndex = buttons.findIndex(b =>
      b.autoGenerated &&
      b.sourceFlowId === expected.flowId &&
      b.name === expected.name
    );

    if (existingAutoIndex !== -1) {
      // Update existing auto button (in case node ID changed or actions missing)
      buttons[existingAutoIndex].sourceNodeId = expected.sourceNodeId;
      // Ensure actions are properly set (fix for buttons with empty actions)
      buttons[existingAutoIndex].actions = [{
        type: 'link_to_flow',
        config: {
          flowId: expected.flowId,
          flowActionLabel: expected.flowActionLabel
        }
      }];
      continue;
    }

    // Create new auto-generated button
    const newButtonId = getNextButtonId(buttons);
    const newButton = {
      buttonId: newButtonId,
      name: expected.name,
      enabled: true,
      autoGenerated: true,
      sourceFlowId: expected.flowId,
      sourceNodeId: expected.sourceNodeId,
      actions: [{
        type: 'link_to_flow',
        config: {
          flowId: expected.flowId,
          flowActionLabel: expected.flowActionLabel
        }
      }]
    };

    buttons.push(newButton);
    console.log(`[ButtonSync] Created auto-generated button "${expected.name}" (ID: ${newButtonId})`);
  }

  // 4. Check if anything changed
  const newAutoCount = buttons.filter(b => b.autoGenerated).length;
  const changed = buttons.length !== originalCount || newAutoCount !== originalAutoCount;

  if (changed) {
    // Save updated character
    characters[charIndex].buttons = buttons;
    // Use per-char storage if active
    if (isPerCharStorageActive()) {
      saveCharacter(characters[charIndex]);
    } else {
      saveData(DATA_FILES.characters, characters);
    }
    console.log(`[ButtonSync] Synced buttons for ${character.name}: ${buttons.length} total (${newAutoCount} auto)`);
  }

  return changed;
}

/**
 * Sync buttons for all characters and personas that have a specific flow assigned
 * Called when a flow is saved/updated
 */
function syncButtonsForFlowChange(flowId) {
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const settings = loadData(DATA_FILES.settings) || {};
  const globalFlows = settings.globalFlows || [];
  const isGlobalFlow = globalFlows.includes(flowId);
  let anyUpdated = false;

  // Sync character buttons (for nodes with buttonTarget === 'character')
  for (const character of characters) {
    const assignedFlows = character.assignedFlows || [];
    // Sync if flow is in character's assigned flows OR is a global flow (for active character)
    const flowApplies = assignedFlows.includes(flowId) ||
      (isGlobalFlow && character.id === settings.activeCharacterId);
    if (flowApplies) {
      // Include global flows in the sync
      const combinedFlows = [...new Set([...assignedFlows, ...globalFlows])];
      const updated = syncAutoGeneratedButtons(character.id, combinedFlows);
      if (updated) anyUpdated = true;
    }
  }

  // Sync persona buttons (for nodes with buttonTarget === 'persona')
  const personas = loadData(DATA_FILES.personas) || [];
  for (const persona of personas) {
    const assignedFlows = persona.assignedFlows || [];
    // Sync if flow is in persona's assigned flows OR is a global flow (for active persona)
    const flowApplies = assignedFlows.includes(flowId) ||
      (isGlobalFlow && persona.id === settings.activePersonaId);
    if (flowApplies) {
      // Include global flows in the sync
      const combinedFlows = [...new Set([...assignedFlows, ...globalFlows])];
      const updated = syncPersonaAutoGeneratedButtons(persona.id, combinedFlows);
      if (updated) anyUpdated = true;
    }
  }

  return anyUpdated;
}

/**
 * Synchronize auto-generated buttons for a persona based on assigned flows
 * @param {string} personaId - The persona ID
 * @param {Array<string>} assignedFlowIds - Array of flow IDs assigned to this persona
 * @returns {boolean} - Whether buttons were modified
 */
function syncPersonaAutoGeneratedButtons(personaId, assignedFlowIds) {
  console.log(`[PersonaButtonSync] Syncing buttons for persona ${personaId} with flows:`, assignedFlowIds);
  const personas = loadData(DATA_FILES.personas) || [];
  // Use per-flow storage if active - load only assigned flows
  const flows = isPerFlowStorageActive() ? loadFlows(assignedFlowIds) : (loadData(DATA_FILES.flows) || []);
  console.log(`[PersonaButtonSync] Loaded ${flows.length} flows`);
  const personaIndex = personas.findIndex(p => p.id === personaId);

  if (personaIndex === -1) {
    console.log(`[PersonaButtonSync] Persona ${personaId} not found`);
    return false;
  }

  const persona = personas[personaIndex];
  let buttons = persona.buttons || [];
  const originalCount = buttons.length;
  const originalAutoCount = buttons.filter(b => b.autoGenerated).length;

  // 1. Collect all expected auto-generated buttons from assigned flows (only persona-targeted buttons)
  const expectedAutoButtons = [];
  for (const flowId of assignedFlowIds) {
    const flow = flows.find(f => f.id === flowId);
    if (!flow) {
      console.log(`[PersonaButtonSync] Flow ${flowId} not found in loaded flows`);
      continue;
    }

    const buttonPressLabels = extractButtonPressLabels(flow, 'persona');
    console.log(`[PersonaButtonSync] Flow ${flow.name} has ${buttonPressLabels.length} persona buttons:`, buttonPressLabels.map(b => b.label));
    for (const { label, nodeId } of buttonPressLabels) {
      expectedAutoButtons.push({
        name: label,
        flowId: flowId,
        flowActionLabel: label,
        sourceNodeId: nodeId
      });
    }
  }
  console.log(`[PersonaButtonSync] Expected ${expectedAutoButtons.length} auto buttons:`, expectedAutoButtons.map(b => b.name));

  // 2. Remove auto-generated buttons that no longer have corresponding flow actions
  buttons = buttons.filter(button => {
    if (!button.autoGenerated) return true; // Keep manual buttons

    // Check if this auto button still has a matching expected button
    return expectedAutoButtons.some(eb =>
      eb.flowId === button.sourceFlowId &&
      eb.flowActionLabel === button.name
    );
  });

  // 3. Process expected auto buttons
  for (const expected of expectedAutoButtons) {
    // Check if a manual button with this name exists
    const existingManualIndex = buttons.findIndex(b =>
      !b.autoGenerated && b.name === expected.name
    );

    if (existingManualIndex !== -1) {
      // Convert manual button to auto-generated, preserve buttonId
      const manualButton = buttons[existingManualIndex];
      buttons[existingManualIndex] = {
        ...manualButton,
        autoGenerated: true,
        sourceFlowId: expected.flowId,
        sourceNodeId: expected.sourceNodeId,
        actions: [{
          type: 'link_to_flow',
          config: {
            flowId: expected.flowId,
            flowActionLabel: expected.flowActionLabel
          }
        }]
      };
      console.log(`[PersonaButtonSync] Converted manual button "${expected.name}" to auto-generated`);
      continue;
    }

    // Check if auto button already exists
    const existingAutoIndex = buttons.findIndex(b =>
      b.autoGenerated &&
      b.sourceFlowId === expected.flowId &&
      b.name === expected.name
    );

    if (existingAutoIndex !== -1) {
      // Update existing auto button (in case node ID changed or actions missing)
      buttons[existingAutoIndex].sourceNodeId = expected.sourceNodeId;
      // Ensure actions are properly set (fix for buttons with empty actions)
      buttons[existingAutoIndex].actions = [{
        type: 'link_to_flow',
        config: {
          flowId: expected.flowId,
          flowActionLabel: expected.flowActionLabel
        }
      }];
      continue;
    }

    // Create new auto-generated button
    const newButtonId = getNextButtonId(buttons);
    const newButton = {
      buttonId: newButtonId,
      name: expected.name,
      enabled: true,
      autoGenerated: true,
      sourceFlowId: expected.flowId,
      sourceNodeId: expected.sourceNodeId,
      actions: [{
        type: 'link_to_flow',
        config: {
          flowId: expected.flowId,
          flowActionLabel: expected.flowActionLabel
        }
      }]
    };

    buttons.push(newButton);
    console.log(`[PersonaButtonSync] Created auto-generated button "${expected.name}" (ID: ${newButtonId})`);
  }

  // 4. Check if anything changed
  const newAutoCount = buttons.filter(b => b.autoGenerated).length;
  const changed = buttons.length !== originalCount || newAutoCount !== originalAutoCount;

  if (changed) {
    // Save updated persona
    personas[personaIndex].buttons = buttons;
    saveData(DATA_FILES.personas, personas);
    console.log(`[PersonaButtonSync] Synced buttons for ${persona.displayName}: ${buttons.length} total (${newAutoCount} auto)`);
  }

  return changed;
}

/**
 * Sync buttons for all personas that have a specific flow assigned
 * Called when a flow is saved/updated
 */
function syncPersonaButtonsForFlowChange(flowId) {
  const personas = loadData(DATA_FILES.personas) || [];
  let anyUpdated = false;

  for (const persona of personas) {
    const assignedFlows = persona.assignedFlows || [];
    if (assignedFlows.includes(flowId)) {
      const updated = syncPersonaAutoGeneratedButtons(persona.id, assignedFlows);
      if (updated) anyUpdated = true;
    }
  }

  return anyUpdated;
}

// Load flow assignments from persisted character/persona data
function loadFlowAssignments() {
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadData(DATA_FILES.personas) || [];
  const settings = loadData(DATA_FILES.settings) || {};

  // Initialize if not exists
  if (!sessionState.flowAssignments.characters) {
    sessionState.flowAssignments.characters = {};
  }
  if (!sessionState.flowAssignments.personas) {
    sessionState.flowAssignments.personas = {};
  }
  if (!sessionState.flowAssignments.global) {
    sessionState.flowAssignments.global = [];
  }

  // Load global flow assignments from settings
  if (settings.globalFlows && settings.globalFlows.length > 0) {
    sessionState.flowAssignments.global = settings.globalFlows;
    console.log(`[FlowLoad] Global flows: ${settings.globalFlows.join(', ')}`);
  }

  // Load character flow assignments
  characters.forEach(char => {
    if (char.assignedFlows && char.assignedFlows.length > 0) {
      sessionState.flowAssignments.characters[char.id] = char.assignedFlows;
      console.log(`[FlowLoad] Character ${char.name}: ${char.assignedFlows.join(', ')}`);
    }
  });

  // Load persona flow assignments
  personas.forEach(persona => {
    if (persona.assignedFlows && persona.assignedFlows.length > 0) {
      sessionState.flowAssignments.personas[persona.id] = persona.assignedFlows;
      console.log(`[FlowLoad] Persona ${persona.displayName}: ${persona.assignedFlows.join(', ')}`);
    }
  });
}

// Load flow assignments on server startup
loadFlowAssignments();
console.log('[Startup] Flow assignments loaded from persisted data');

// Activate flows for current character/persona on startup
activateAssignedFlows();
console.log('[Startup] Flows activated for current session');

// Load and decrypt API keys from settings for service initialization
const startupSettings = decryptSettings(loadData(DATA_FILES.settings) || {});
if (startupSettings.goveeApiKey) {
  goveeService.setApiKey(startupSettings.goveeApiKey);
  console.log('[Startup] Govee API key loaded');
}

// Load Tuya credentials from settings if saved
if (startupSettings.tuyaAccessId && startupSettings.tuyaAccessSecret) {
  tuyaService.setCredentials(
    startupSettings.tuyaAccessId,
    startupSettings.tuyaAccessSecret,
    startupSettings.tuyaRegion || 'us'
  );
  console.log('[Startup] Tuya credentials loaded');
}

// Load Wyze credentials from settings if saved
if (startupSettings.wyzeEmail && startupSettings.wyzePassword && startupSettings.wyzeKeyId && startupSettings.wyzeApiKey) {
  wyzeService.setCredentials(
    startupSettings.wyzeEmail,
    startupSettings.wyzePassword,
    startupSettings.wyzeKeyId,
    startupSettings.wyzeApiKey,
    startupSettings.wyzeTotpKey || null
  );
  console.log('[Startup] Wyze credentials loaded');
  // Auto-connect to Wyze
  wyzeService.connect().then(() => {
    console.log('[Startup] Wyze connected');
  }).catch(err => {
    console.error('[Startup] Wyze auto-connect failed:', err.message);
  });
}

wss.on('connection', async (ws) => {
  wsClients.add(ws);
  console.log('[WS] Client connected');

  const settings = loadData(DATA_FILES.settings);

  // Load autosaved session if no chat history exists
  if (sessionState.chatHistory.length === 0) {
    const autosaveLoaded = loadAutosave();

    // If no autosave was loaded, initialize emotion from character's starting emotion
    if (!autosaveLoaded && settings?.activeCharacterId) {
      // Use per-char storage if active, otherwise fall back to legacy
      const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
      if (activeCharacter && activeCharacter.startingEmotion) {
        sessionState.emotion = activeCharacter.startingEmotion;
      }
    }
  }

  // Initialize player/character names for variable substitution
  if (settings?.activeCharacterId) {
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    sessionState.characterName = activeCharacter?.name || null;
    // Sync character's autoReplyEnabled to session state
    sessionState.autoReply = activeCharacter?.autoReplyEnabled || false;
  }
  if (settings?.activePersonaId) {
    const personas = loadData(DATA_FILES.personas) || [];
    const activePersona = personas.find(p => p.id === settings.activePersonaId);
    sessionState.playerName = activePersona?.displayName || null;
  }

  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      sessionState,
      settings,
      devices: loadData(DATA_FILES.devices),
      serverSessionId: SERVER_SESSION_ID
    }
  }));

  // Send welcome message if character is active but no chat history
  // Only send if truly empty (prevents duplicate from rapid reconnections)
  if (settings?.activeCharacterId && sessionState.chatHistory.length === 0) {
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    if (activeCharacter && sessionState.chatHistory.length === 0) { // Double-check after async operations
      await sendWelcomeMessage(activeCharacter, settings);
    }
  }

  ws.on('message', async (message) => {
    try {
      const { type, data } = JSON.parse(message);
      await handleWsMessage(ws, type, data);
    } catch (e) {
      console.error('[WS] Message error:', e);
    }
  });

  // Cleanup function for WebSocket
  const cleanup = () => {
    if (wsClients.has(ws)) {
      wsClients.delete(ws);
      log.info('Client removed, remaining:', wsClients.size);
    }
  };

  ws.on('close', cleanup);

  ws.on('error', (err) => {
    log.error('Client error:', err.message);
    cleanup();
  });
});

// Periodic cleanup of stale WebSocket connections (every 30 seconds)
setInterval(() => {
  for (const client of wsClients) {
    if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
      wsClients.delete(client);
      log.debug('Cleaned up stale WebSocket connection');
    }
  }
}, 30000);

async function handleWsMessage(ws, type, data) {
  switch (type) {
    case 'chat_message':
      await handleChatMessage(data);
      break;

    case 'special_generate':
      await handleSpecialGenerate(data);
      break;

    case 'impersonate_request':
      await handleImpersonateRequest(data);
      break;

    case 'ai_message':
      // Handle user-initiated character message (verbatim, no LLM)
      {
        const settings = loadData(DATA_FILES.settings);
        const characters = loadData(DATA_FILES.characters) || [];
        const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);

        if (!activeCharacter) {
          console.log('[ai_message] No active character found - skipping');
          break;
        }

        if (!data.content || data.content.trim() === '') {
          console.log('[ai_message] Empty content - skipping');
          break;
        }

        const message = {
          id: uuidv4(),
          content: data.content,
          sender: 'character',
          characterId: activeCharacter.id,
          characterName: activeCharacter.name,
          timestamp: Date.now()
        };

        sessionState.chatHistory.push(message);
        broadcast('chat_message', message);
        autosaveSession();
        console.log(`[ai_message] Sent verbatim as ${activeCharacter.name}: ${data.content.substring(0, 50)}...`);
      }
      break;

    case 'update_capacity':
      sessionState.capacity = data.capacity;
      broadcast('capacity_update', { capacity: sessionState.capacity });

      // Load settings for character controls
      const capacitySettings = loadData(DATA_FILES.settings) || {};

      // Auto-link capacity to pain if enabled (defaults to true if not set)
      if (capacitySettings.globalCharacterControls?.autoLinkCapacityToPain !== false) {
        const newPain = Math.min(10, Math.floor(sessionState.capacity / 10));
        if (newPain !== sessionState.pain) {
          sessionState.pain = newPain;
          broadcast('pain_update', { pain: sessionState.pain });
        }
      }

      // Emotional decline if enabled (defaults to true if not set)
      if (capacitySettings.globalCharacterControls?.emotionalDecline !== false) {
        const capacity = sessionState.capacity;
        let newEmotion = sessionState.emotion;

        // At 75%+, lock to frightened
        if (capacity >= 75) {
          newEmotion = 'frightened';
        }
        // 61-74%: rapid decline - anxious or frightened
        else if (capacity >= 61) {
          if (sessionState.emotion !== 'frightened') {
            newEmotion = 'anxious';
          }
        }
        // 41-60%: faster decline - nervous states
        else if (capacity >= 41) {
          const negativeEmotions = ['anxious', 'frightened', 'sad', 'exhausted'];
          if (!negativeEmotions.includes(sessionState.emotion)) {
            newEmotion = 'anxious';
          }
        }
        // 0-40%: slow decline - stay at current or mild anxiety
        // No forced change in this range

        if (newEmotion !== sessionState.emotion) {
          sessionState.emotion = newEmotion;
          broadcast('emotion_update', { emotion: sessionState.emotion });
        }
      }

      eventEngine.checkDeviceMonitors();
      await eventEngine.checkPlayerStateChanges({
        capacity: sessionState.capacity,
        pain: sessionState.pain,
        emotion: sessionState.emotion
      });
      break;

    case 'update_pain':
      sessionState.pain = data.pain;
      broadcast('pain_update', { pain: sessionState.pain });
      eventEngine.checkDeviceMonitors();
      await eventEngine.checkPlayerStateChanges({
        capacity: sessionState.capacity,
        pain: sessionState.pain,
        emotion: sessionState.emotion
      });
      break;

    case 'update_sensation':
      // Legacy support - convert sensation string to pain number
      const sensationToPain = {
        'normal': 0, 'slightly tight': 2, 'comfortably full': 3,
        'stretched': 5, 'very tight': 7, 'painfully tight': 9
      };
      sessionState.pain = sensationToPain[data.sensation] ?? 0;
      broadcast('pain_update', { pain: sessionState.pain });
      eventEngine.checkDeviceMonitors();
      await eventEngine.checkPlayerStateChanges({
        capacity: sessionState.capacity,
        pain: sessionState.pain,
        emotion: sessionState.emotion
      });
      break;

    case 'update_emotion':
      sessionState.emotion = data.emotion;
      broadcast('emotion_update', { emotion: sessionState.emotion });
      eventEngine.checkDeviceMonitors();
      await eventEngine.checkPlayerStateChanges({
        capacity: sessionState.capacity,
        pain: sessionState.pain,
        emotion: sessionState.emotion
      });
      break;

    case 'settings_updated':
      // Sync settings changes to sessionState
      if (data.globalCharacterControls?.autoCapacityMultiplier !== undefined) {
        sessionState.capacityModifier = data.globalCharacterControls.autoCapacityMultiplier;
        console.log(`[Settings] Auto-capacity multiplier set to: ${sessionState.capacityModifier}x`);
      }
      break;

    case 'set_auto_reply':
      sessionState.autoReply = data.enabled;
      console.log(`[Settings] Auto Reply set to: ${data.enabled}`);
      // Broadcast back to confirm state change
      broadcast('auto_reply_update', { enabled: sessionState.autoReply });
      break;

    case 'set_control_mode':
      // Update simulation mode in event engine based on frontend control mode
      const isSimulated = data.mode === 'simulated';
      eventEngine.setSimulationMode(isSimulated);
      console.log(`[Settings] Control mode set to: ${data.mode} (simulation: ${isSimulated})`);
      break;

    case 'end_infinite_cycle':
      // deviceIp can be just IP or IP:childId format
      const cycleDeviceKey = data.deviceIp;
      const [cycleIp, cycleChildId] = cycleDeviceKey.includes(':') ? cycleDeviceKey.split(':') : [cycleDeviceKey, null];
      console.log(`[WS] Ending infinite cycle for device: ${cycleIp}${cycleChildId ? ` (child: ${cycleChildId})` : ''}`);
      // Get device object if childId is present
      const cycleDevice = cycleChildId ? { ip: cycleIp, childId: cycleChildId, brand: 'tplink' } : null;
      deviceService.stopCycle(cycleIp, cycleDevice);
      break;

    case 'update_message_history':
      sessionState.messageInputHistory = data.history || [];
      autosaveSession();
      break;

    case 'edit_message':
      handleEditMessage(data);
      break;

    case 'swipe_message':
      await handleSwipeMessage(data);
      break;

    case 'delete_message':
      handleDeleteMessage(data);
      break;

    case 'update_persona_flows': {
      console.log(`[WS] update_persona_flows received for persona ${data.personaId} with flows:`, data.flows);
      if (!sessionState.flowAssignments.personas) {
        sessionState.flowAssignments.personas = {};
      }
      sessionState.flowAssignments.personas[data.personaId] = data.flows;

      // Persist to persona data
      const personas = loadData(DATA_FILES.personas) || [];
      const personaIndex = personas.findIndex(p => p.id === data.personaId);
      if (personaIndex !== -1) {
        personas[personaIndex].assignedFlows = data.flows;
        saveData(DATA_FILES.personas, personas);
      }

      // Sync auto-generated buttons for this persona (include global flows)
      const globalFlowsForPersona = sessionState.flowAssignments.global || [];
      const combinedPersonaFlowsForSync = [...new Set([...data.flows, ...globalFlowsForPersona])];
      const personaButtonsUpdated = syncPersonaAutoGeneratedButtons(data.personaId, combinedPersonaFlowsForSync);
      if (personaButtonsUpdated) {
        broadcast('personas_update', loadData(DATA_FILES.personas));
      }

      broadcast('flow_assignments_update', sessionState.flowAssignments);
      activateAssignedFlows();
      break;
    }

    case 'update_character_flows': {
      if (!sessionState.flowAssignments.characters) {
        sessionState.flowAssignments.characters = {};
      }
      sessionState.flowAssignments.characters[data.characterId] = data.flows;

      // Persist to character data - use per-char storage if active
      const charFlowChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const charIndex = charFlowChars.findIndex(c => c.id === data.characterId);
      if (charIndex !== -1) {
        charFlowChars[charIndex].assignedFlows = data.flows;
        if (isPerCharStorageActive()) {
          saveCharacter(charFlowChars[charIndex]);
        } else {
          saveData(DATA_FILES.characters, charFlowChars);
        }
      }

      // Sync auto-generated buttons based on new flow assignments (include global flows)
      const globalFlowsForChar = sessionState.flowAssignments.global || [];
      const combinedCharFlowsForSync = [...new Set([...data.flows, ...globalFlowsForChar])];
      const buttonsUpdated = syncAutoGeneratedButtons(data.characterId, combinedCharFlowsForSync);
      if (buttonsUpdated) {
        const updatedChars = isPerCharStorageActive() ? loadAllCharacters() : loadData(DATA_FILES.characters);
        broadcast('characters_update', updatedChars);
      }

      broadcast('flow_assignments_update', sessionState.flowAssignments);
      activateAssignedFlows();
      break;
    }

    case 'update_global_flows': {
      const oldGlobalFlows = sessionState.flowAssignments.global || [];
      const newGlobalFlows = data.flows;

      sessionState.flowAssignments.global = newGlobalFlows;
      // Persist to settings
      const settingsForGlobal = loadData(DATA_FILES.settings) || {};
      settingsForGlobal.globalFlows = newGlobalFlows;
      saveData(DATA_FILES.settings, settingsForGlobal);
      broadcast('flow_assignments_update', sessionState.flowAssignments);
      activateAssignedFlows();

      // Only sync buttons from global flows - don't touch persona/character assigned flow buttons
      // Find which flows were added and which were removed
      const addedFlows = newGlobalFlows.filter(id => !oldGlobalFlows.includes(id));
      const removedFlows = oldGlobalFlows.filter(id => !newGlobalFlows.includes(id));

      let buttonsUpdatedGlobal = false;

      // Handle character buttons
      if (settingsForGlobal.activeCharacterId) {
        const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
        const charIndex = characters.findIndex(c => c.id === settingsForGlobal.activeCharacterId);
        if (charIndex !== -1) {
          const character = characters[charIndex];
          let buttons = character.buttons || [];
          const originalCount = buttons.length;

          // Remove buttons ONLY from removed global flows
          if (removedFlows.length > 0) {
            buttons = buttons.filter(btn => {
              if (!btn.autoGenerated) return true;
              return !removedFlows.includes(btn.sourceFlowId);
            });
          }

          // Add buttons from newly added global flows
          if (addedFlows.length > 0) {
            const flows = isPerFlowStorageActive() ? loadFlows(addedFlows) : (loadData(DATA_FILES.flows) || []);
            for (const flowId of addedFlows) {
              const flow = flows.find(f => f.id === flowId);
              if (!flow) continue;
              const buttonLabels = extractButtonPressLabels(flow, 'character');
              for (const { label, nodeId } of buttonLabels) {
                // Check if button already exists
                const exists = buttons.some(b => b.sourceFlowId === flowId && b.name === label);
                if (!exists) {
                  const newButtonId = getNextButtonId(buttons);
                  buttons.push({
                    buttonId: newButtonId,
                    name: label,
                    enabled: true,
                    autoGenerated: true,
                    sourceFlowId: flowId,
                    sourceNodeId: nodeId,
                    actions: [{ type: 'link_to_flow', config: { flowId, flowActionLabel: label } }]
                  });
                }
              }
            }
          }

          if (buttons.length !== originalCount) {
            characters[charIndex].buttons = buttons;
            if (isPerCharStorageActive()) {
              saveCharacter(characters[charIndex]);
            } else {
              saveData(DATA_FILES.characters, characters);
            }
            buttonsUpdatedGlobal = true;
          }
        }
      }

      // Handle persona buttons
      if (settingsForGlobal.activePersonaId) {
        const personas = loadData(DATA_FILES.personas) || [];
        const personaIndex = personas.findIndex(p => p.id === settingsForGlobal.activePersonaId);
        if (personaIndex !== -1) {
          const persona = personas[personaIndex];
          let buttons = persona.buttons || [];
          const originalCount = buttons.length;

          // Remove buttons ONLY from removed global flows
          if (removedFlows.length > 0) {
            buttons = buttons.filter(btn => {
              if (!btn.autoGenerated) return true;
              return !removedFlows.includes(btn.sourceFlowId);
            });
          }

          // Add buttons from newly added global flows
          if (addedFlows.length > 0) {
            const flows = isPerFlowStorageActive() ? loadFlows(addedFlows) : (loadData(DATA_FILES.flows) || []);
            for (const flowId of addedFlows) {
              const flow = flows.find(f => f.id === flowId);
              if (!flow) continue;
              const buttonLabels = extractButtonPressLabels(flow, 'persona');
              for (const { label, nodeId } of buttonLabels) {
                // Check if button already exists
                const exists = buttons.some(b => b.sourceFlowId === flowId && b.name === label);
                if (!exists) {
                  const newButtonId = getNextButtonId(buttons);
                  buttons.push({
                    buttonId: newButtonId,
                    name: label,
                    enabled: true,
                    autoGenerated: true,
                    sourceFlowId: flowId,
                    sourceNodeId: nodeId,
                    actions: [{ type: 'link_to_flow', config: { flowId, flowActionLabel: label } }]
                  });
                }
              }
            }
          }

          if (buttons.length !== originalCount) {
            personas[personaIndex].buttons = buttons;
            saveData(DATA_FILES.personas, personas);
            buttonsUpdatedGlobal = true;
          }
        }
      }

      // Broadcast updates if buttons changed
      if (buttonsUpdatedGlobal) {
        const updatedChars = isPerCharStorageActive() ? loadAllCharacters() : loadData(DATA_FILES.characters);
        broadcast('characters_update', updatedChars);
        broadcast('personas_update', loadData(DATA_FILES.personas));
      }
      break;
    }

    case 'player_choice_response':
      await eventEngine.handlePlayerChoice(
        data.nodeId,
        data.choiceId,
        data.choiceLabel
      );
      break;

    case 'challenge_result':
      // Pass full result data object (outputId, rollTotal, slots, segmentLabel, etc.)
      await eventEngine.handleChallengeResult(
        data.nodeId,
        {
          outputId: data.outputId,
          rollTotal: data.rollTotal,
          diceValues: data.diceValues,
          slots: data.slots,  // Slot machine symbols for [Slots] variable
          segmentLabel: data.segmentLabel,
          allSegments: data.allSegments
        }
      );
      break;

    case 'challenge_cancelled':
      // User skipped/cancelled the challenge - just clear the pending state
      // The flow will not continue (no branch taken)
      console.log(`[WS] Challenge cancelled for node ${data.nodeId}`);
      eventEngine.clearPendingChallenge(data.nodeId);
      break;

    case 'challenge_penalty':
      // Mid-game penalty/reward - trigger device action without affecting challenge state
      console.log(`[WS] Challenge penalty: device=${data.deviceId}, duration=${data.duration}s, type=${data.actionType}`);
      await eventEngine.executePenaltyAction(
        data.deviceId,
        data.duration,
        data.actionType
      );
      break;

    case 'input_response':
      // User submitted input value - store and continue flow
      console.log(`[WS] Input response: node=${data.nodeId}, value=${data.value}`);
      await eventEngine.handleInputResponse(
        data.nodeId,
        data.value
      );
      break;

    case 'test_node':
      // Test flow execution from a specific node
      console.log(`[WS] Test node request: flow=${data.flowId}, node=${data.nodeId}`);
      try {
        const flow = flows.find(f => f.id === data.flowId);
        if (flow) {
          const result = await eventEngine.testFromNode(flow, data.nodeId);
          ws.send(JSON.stringify({ type: 'test_result', data: result }));
        } else {
          ws.send(JSON.stringify({
            type: 'test_result',
            data: {
              success: false,
              error: `Flow "${data.flowId}" not found`,
              steps: []
            }
          }));
        }
      } catch (error) {
        console.error('[WS] Test node error:', error);
        ws.send(JSON.stringify({
          type: 'test_result',
          data: {
            success: false,
            error: error.message,
            steps: []
          }
        }));
      }
      break;

    case 'execute_button':
    case 'execute_event':  // Keep for backwards compatibility
      await handleExecuteButton(data);
      break;

    case 'flow_pause':
      eventEngine.pauseFlows();
      break;

    case 'flow_resume':
      await eventEngine.resumeFlows();
      break;

    default:
      console.log('[WS] Unknown message type:', type);
  }
}

function handleEditMessage(data) {
  const { id, content } = data;
  const msgIndex = sessionState.chatHistory.findIndex(m => m.id === id);
  if (msgIndex !== -1) {
    sessionState.chatHistory[msgIndex].content = content;
    sessionState.chatHistory[msgIndex].edited = true;
    broadcast('message_updated', sessionState.chatHistory[msgIndex]);
    autosaveSession();
  }
}

async function handleSwipeMessage(data) {
  const { id, guidanceText } = data;
  const msgIndex = sessionState.chatHistory.findIndex(m => m.id === id);
  if (msgIndex === -1) return;

  const msg = sessionState.chatHistory[msgIndex];
  const settings = loadData(DATA_FILES.settings);
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadData(DATA_FILES.personas) || [];
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);
  if (!activeCharacter || !hasLlmConfig) return;

  const useStreaming = settings.llm?.streaming === true;

  try {
    // Store original content
    const originalContent = msg.content;

    // Notify UI that AI is generating
    const isPlayerVoice = msg.sender === 'player';
    const generatingFor = isPlayerVoice ? (activePersona?.displayName || 'Player') : activeCharacter.name;
    broadcast('generating_start', { characterName: generatingFor, isPlayerVoice });

    // For streaming, set message to empty and mark as streaming
    // For non-streaming, set to "..." placeholder
    if (useStreaming) {
      sessionState.chatHistory[msgIndex].content = '';
      sessionState.chatHistory[msgIndex].streaming = true;
    } else {
      sessionState.chatHistory[msgIndex].content = '...';
    }
    broadcast('message_updated', sessionState.chatHistory[msgIndex]);

    // Small delay to ensure UI updates before heavy LLM processing
    await new Promise(resolve => setTimeout(resolve, 50));

    // Build context up to but not including this message
    const priorHistory = sessionState.chatHistory.slice(0, msgIndex);
    const fullHistory = [...sessionState.chatHistory];
    sessionState.chatHistory = priorHistory;

    const isPlayerMsg = msg.sender === 'player';
    let systemPrompt, prompt;

    if (isPlayerMsg) {
      // For player messages, use impersonate
      const impersonateContext = buildSpecialContext('impersonate', null, activeCharacter, activePersona, settings);
      const playerName = activePersona?.displayName || 'Player';

      systemPrompt = impersonateContext.systemPrompt;
      prompt = impersonateContext.prompt;
      if (guidanceText) {
        systemPrompt += `\n\n**CRITICAL GUIDANCE - THIS IS YOUR PRIMARY DIRECTIVE:**
Your response MUST be about: "${guidanceText}"
- This is the central focus of your message - not just a suggestion
- Your entire response should directly address or embody this direction
- Do NOT repeat the guidance text verbatim, but make it the core subject matter
- Everything you write should relate back to this guidance`;
        prompt += `\n${playerName}:`;
      }
    } else {
      // For character messages
      const context = buildChatContext(activeCharacter, settings);

      systemPrompt = context.systemPrompt;
      prompt = context.prompt;
      if (guidanceText) {
        systemPrompt += `\n\n**CRITICAL GUIDANCE - THIS IS YOUR PRIMARY DIRECTIVE:**
Your response MUST be about: "${guidanceText}"
- This is the central focus of your message - not just a suggestion
- Your entire response should directly address or embody this direction
- Do NOT repeat the guidance text verbatim, but make it the core subject matter
- Everything you write should relate back to this guidance`;
        prompt += `\n${activeCharacter.name}:`;
      }
    }

    let resultText;

    if (useStreaming) {
      const result = await llmService.generateStream({
        prompt,
        systemPrompt,
        settings: settings.llm,
        onToken: (token, fullText) => {
          fullHistory[msgIndex].content = fullText;
          broadcast('stream_token', { messageId: id, token, fullText });
        }
      });
      resultText = result.text;
    } else {
      const result = await llmService.generate({
        prompt,
        systemPrompt,
        settings: settings.llm
      });
      resultText = result.text;
    }

    // Restore history and update the message (apply variable substitution)
    sessionState.chatHistory = fullHistory;
    sessionState.chatHistory[msgIndex].content = substituteAllVariables(resultText);
    sessionState.chatHistory[msgIndex].swiped = true;
    sessionState.chatHistory[msgIndex].streaming = false;

    broadcast('generating_stop', {});

    if (useStreaming) {
      broadcast('stream_complete', { messageId: id, content: sessionState.chatHistory[msgIndex].content });
    } else {
      broadcast('message_updated', sessionState.chatHistory[msgIndex]);
    }

    autosaveSession();

  } catch (error) {
    console.error('[Swipe] Error:', error);
    // Restore original content on error
    sessionState.chatHistory[msgIndex].content = originalContent;
    sessionState.chatHistory[msgIndex].streaming = false;
    broadcast('generating_stop', {});
    broadcast('message_updated', sessionState.chatHistory[msgIndex]);
  }
}

function handleDeleteMessage(data) {
  const { id } = data;
  const msgIndex = sessionState.chatHistory.findIndex(m => m.id === id);
  if (msgIndex !== -1) {
    sessionState.chatHistory.splice(msgIndex, 1);
    broadcast('message_deleted', { id });
    autosaveSession();
  }
}

/**
 * Resolve a device key to deviceId and device object
 * Supports: primary_pump, govee:deviceId, tuya:deviceId, ip:childId, ip
 */
function resolveDeviceKey(deviceKey) {
  if (!deviceKey) {
    return { deviceId: null, deviceObj: null };
  }

  const devices = loadData(DATA_FILES.devices) || [];
  const settings = loadData(DATA_FILES.settings);

  // Handle primary_pump - look up from settings
  if (deviceKey === 'primary_pump') {
    const primaryPumpId = settings?.primaryPump;
    if (!primaryPumpId) {
      console.log('[Device] Primary pump not configured in settings');
      return { deviceId: null, deviceObj: null };
    }
    // Recursively resolve the primary pump device
    return resolveDeviceKey(primaryPumpId);
  }

  // Handle govee:deviceId format
  if (deviceKey.startsWith('govee:')) {
    const deviceId = deviceKey.substring(6);
    const device = devices.find(d => d.brand === 'govee' && d.deviceId === deviceId);
    return { deviceId, deviceObj: device || { brand: 'govee', deviceId } };
  }

  // Handle tuya:deviceId format
  if (deviceKey.startsWith('tuya:')) {
    const deviceId = deviceKey.substring(5);
    const device = devices.find(d => d.brand === 'tuya' && d.deviceId === deviceId);
    return { deviceId, deviceObj: device || { brand: 'tuya', deviceId } };
  }

  // Handle ip:childId format (power strip outlet)
  if (deviceKey.includes(':') && !deviceKey.startsWith('govee:') && !deviceKey.startsWith('tuya:')) {
    const [ip, childId] = deviceKey.split(':');
    const device = devices.find(d => d.ip === ip && d.childId === childId);
    return { deviceId: ip, deviceObj: device || { ip, childId, brand: 'tplink' } };
  }

  // Handle plain IP (legacy or regular device)
  const device = devices.find(d => d.ip === deviceKey);
  return { deviceId: deviceKey, deviceObj: device || { ip: deviceKey, brand: 'tplink' } };
}

async function handleExecuteButton(data) {
  const { buttonId, eventId, characterId, personaId, actions } = data;

  if (!actions || !Array.isArray(actions) || actions.length === 0) {
    console.log('[Button] No actions to execute');
    return;
  }

  const sourceType = personaId ? 'persona' : 'character';
  const sourceId = personaId || characterId;
  console.log(`[Button] Executing button #${buttonId || eventId} from ${sourceType} ${sourceId} with ${actions.length} actions`);

  // Process each action sequentially
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'message':
        case 'send_message':  // Backwards compatibility
          // Pass both characterId and personaId so message handler can use appropriate context
          await handleButtonSendMessage(action, characterId, personaId);
          break;

        case 'turn_on':
          await handleButtonTurnOn(action);
          break;

        case 'cycle':
        case 'start_cycle':  // Backwards compatibility
          await handleButtonCycle(action);
          break;

        case 'link_to_flow':
          await handleButtonLinkToFlow(action, characterId, buttonId || eventId);
          break;

        // Legacy action types
        case 'stop_cycle':
          await handleButtonStopCycle(action);
          break;

        case 'adjust_capacity':
          await handleButtonAdjustCapacity(action);
          break;

        default:
          console.log(`[Button] Unknown action type: ${action.type}`);
      }
    } catch (error) {
      console.error(`[Button] Error executing action ${action.type}:`, error);
    }
  }

  console.log('[Button] Button execution completed');
}

async function handleButtonSendMessage(action, characterId, personaId) {
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const settings = loadData(DATA_FILES.settings);

  // Use passed characterId, or fall back to active character from settings
  const effectiveCharacterId = characterId || settings?.activeCharacterId;
  const character = characters.find(c => c.id === effectiveCharacterId);

  if (!character) {
    console.log('[Button] Character not found');
    return;
  }

  const personas = loadData(DATA_FILES.personas) || [];
  // Use passed personaId, or fall back to active persona from settings
  const effectivePersonaId = personaId || settings?.activePersonaId;
  const activePersona = personas.find(p => p.id === effectivePersonaId);
  const playerName = activePersona?.displayName || 'the player';

  // Substitute [Player] variable in instruction text
  let instructionText = action.config?.text || action.params?.message || '';
  instructionText = instructionText.replace(/\[Player\]/g, playerName);

  // Use LLM enhancement if available
  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);
  if (hasLlmConfig && instructionText) {
    // Create placeholder message with "..."
    const placeholderMessage = {
      id: uuidv4(),
      content: '...',
      sender: 'character',
      characterId: character.id,
      characterName: character.name,
      timestamp: Date.now()
    };

    sessionState.chatHistory.push(placeholderMessage);
    broadcast('chat_message', placeholderMessage);

    // Notify UI that AI is generating
    llmState.isGenerating = true;
    broadcast('generating_start', { characterName: character.name });

    try {
      // Build context with button instruction
      const context = buildChatContext(character, settings);

      // Add instruction to BOTH system prompt AND at the end of the prompt for emphasis
      const instruction = `[YOUR NEXT MESSAGE MUST EXPRESS THIS ACTION: ${instructionText}]`;
      context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be the character performing this specific action: "${instructionText}"\nIgnore previous conversation flow. Do NOT respond to what the player said. Simply perform the action described above.\n=== END CRITICAL INSTRUCTION ===`;

      // Append instruction to the prompt so it's the last thing before generation
      context.prompt += `\n\n${instruction}\n${character.name}:`;

      console.log('[Button] Generating LLM message based on:', instructionText);

      // Generate enhanced response
      const result = await llmService.generate({
        prompt: context.prompt,
        systemPrompt: context.systemPrompt,
        settings: settings.llm
      });

      // Update placeholder message with actual content (apply variable substitution)
      placeholderMessage.content = substituteAllVariables(result.text);

      // Find and update message in chat history
      const msgIndex = sessionState.chatHistory.findIndex(m => m.id === placeholderMessage.id);
      if (msgIndex !== -1) {
        sessionState.chatHistory[msgIndex] = placeholderMessage;
      }

      llmState.isGenerating = false;
      broadcast('generating_stop', {});
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
      await processQueuedFlowMessage();

      console.log(`[Button] Sent LLM-enhanced message from ${character.name}`);

    } catch (error) {
      console.error('[Button] LLM enhancement failed, sending raw text:', error);
      // Fallback to raw text if LLM fails (apply variable substitution)
      placeholderMessage.content = substituteAllVariables(instructionText);

      const msgIndex = sessionState.chatHistory.findIndex(m => m.id === placeholderMessage.id);
      if (msgIndex !== -1) {
        sessionState.chatHistory[msgIndex] = placeholderMessage;
      }

      llmState.isGenerating = false;
      broadcast('generating_stop', {});
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
      await processQueuedFlowMessage();
    }
  } else {
    // No LLM available, send raw text
    const message = {
      id: uuidv4(),
      content: instructionText,
      sender: 'character',
      characterId: character.id,
      characterName: character.name,
      timestamp: Date.now()
    };
    sessionState.chatHistory.push(message);
    broadcast('new_message', message);
    autosaveSession();

    console.log(`[Button] Sent raw message from ${character.name}`);
  }
}

async function handleButtonTurnOn(action) {
  const deviceKey = action.config?.device;

  if (!deviceKey) {
    console.log('[Button] No device specified for turn_on');
    return;
  }

  // Resolve device key to actual device
  const { deviceId, deviceObj } = resolveDeviceKey(deviceKey);

  if (!deviceId) {
    console.log(`[Button] Could not resolve device key: ${deviceKey}`);
    return;
  }

  console.log(`[Button] Turning on device ${deviceId}`);
  await deviceService.turnOn(deviceId, deviceObj);
}

async function handleButtonCycle(action) {
  const { device: deviceKey, duration, interval } = action.config || action.params || {};

  if (!deviceKey) {
    console.log('[Button] No device specified for cycle');
    return;
  }

  // Resolve device key to actual device
  const { deviceId, deviceObj } = resolveDeviceKey(deviceKey);

  if (!deviceId) {
    console.log(`[Button] Could not resolve device key: ${deviceKey}`);
    return;
  }

  const cycleData = {
    duration: parseInt(duration) || 5,
    interval: parseInt(interval) || 2
  };

  console.log(`[Button] Starting cycle on device ${deviceId}: ${JSON.stringify(cycleData)}`);
  await deviceService.startCycle(deviceId, cycleData, deviceObj);
}

async function handleButtonLinkToFlow(action, characterId, buttonId) {
  const flowId = action.config?.flowId;
  const flowActionLabel = action.config?.flowActionLabel;

  if (!flowId) {
    console.log('[Button] No flow ID specified for link_to_flow');
    return;
  }

  if (!flowActionLabel) {
    console.log('[Button] No FlowAction label specified for link_to_flow');
    return;
  }

  console.log(`[Button] Button #${buttonId} triggering FlowAction "${flowActionLabel}" in flow ${flowId}`);

  // Always load fresh flow data from disk to pick up any changes
  // Use per-flow storage if active, otherwise fall back to legacy
  let flow;
  if (isPerFlowStorageActive()) {
    flow = loadFlow(flowId);
  } else {
    const flows = loadData(DATA_FILES.flows) || [];
    flow = flows.find(f => f.id === flowId);
  }

  if (!flow) {
    console.log(`[Button] Flow ${flowId} not found in flows data`);
    return;
  }

  // Only activate if not already active - don't reset flow state on button press
  if (!eventEngine.isFlowActive(flowId)) {
    console.log(`[Button] Activating flow ${flowId}`);
    eventEngine.activateFlow(flow, 1); // Priority 1 (character-level)
  } else {
    console.log(`[Button] Flow ${flowId} already active`);
  }

  // Trigger the FlowAction (Button Press section) by label in the specified flow
  await eventEngine.triggerButtonPressByLabel(flowId, flowActionLabel, characterId);
}

// Legacy handlers for backwards compatibility
async function handleButtonStopCycle(action) {
  const device = action.config?.device || action.params?.device;

  if (!device) {
    console.log('[Button] No device specified for stop_cycle');
    return;
  }

  console.log(`[Button] Stopping cycle on device ${device}`);
  deviceService.stopCycle(device);
}

async function handleButtonAdjustCapacity(action) {
  const amount = parseInt(action.config?.amount || action.params?.amount) || 0;

  if (amount === 0) {
    console.log('[Button] No capacity adjustment amount specified');
    return;
  }

  const oldCapacity = sessionState.capacity || 0;
  sessionState.capacity = Math.max(0, Math.min(100, oldCapacity + amount));

  broadcast('state_update', {
    capacity: sessionState.capacity
  });

  // Check for player state change triggers
  await eventEngine.checkPlayerStateChanges({
    capacity: sessionState.capacity,
    pain: sessionState.pain,
    emotion: sessionState.emotion
  });

  autosaveSession();

  console.log(`[Button] Adjusted capacity by ${amount}% (${oldCapacity}% → ${sessionState.capacity}%)`);
}

// ============================================
// Chat Handling
// ============================================

async function handleChatMessage(data) {
  const { content, sender = 'player' } = data;
  console.log(`[Chat] Message received. autoReply=${sessionState.autoReply}`);

  // Add to chat history
  const playerMessage = {
    id: uuidv4(),
    content,
    sender,
    timestamp: Date.now()
  };
  sessionState.chatHistory.push(playerMessage);
  broadcast('chat_message', playerMessage);
  autosaveSession();

  // Trigger player speaks event for flow engine
  await eventEngine.handleEvent('player_speaks', { content });

  // Check if auto-reply is enabled
  if (!sessionState.autoReply) {
    console.log('[Chat] Auto Reply disabled, skipping AI response');
    return;
  }

  // Check if we should generate AI response
  const settings = loadData(DATA_FILES.settings);
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);

  // Check if LLM is configured (either llmUrl for OpenAI/KoboldCPP, or OpenRouter with API key)
  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);

  console.log(`[Chat] activeCharacter=${activeCharacter?.name || 'none'}, hasLlmConfig=${hasLlmConfig ? 'yes' : 'no'}`);

  if (activeCharacter && hasLlmConfig) {
    // Notify UI that AI is generating
    broadcast('generating_start', { characterName: activeCharacter.name });

    try {
      // Build context
      const context = buildChatContext(activeCharacter, settings);

      console.log('[Chat] Generating AI response...');

      let finalText = '';
      const useStreaming = settings.llm?.streaming === true;

      if (useStreaming) {
        // Streaming mode - create placeholder message and update as tokens arrive
        const aiMessage = {
          id: uuidv4(),
          content: '',
          sender: 'character',
          characterId: activeCharacter.id,
          characterName: activeCharacter.name,
          timestamp: Date.now(),
          streaming: true
        };
        sessionState.chatHistory.push(aiMessage);
        broadcast('chat_message', aiMessage);

        const result = await llmService.generateStream({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: settings.llm,
          onToken: (token, fullText) => {
            // Update message content and broadcast
            aiMessage.content = fullText;
            broadcast('stream_token', { messageId: aiMessage.id, token, fullText });
          }
        });

        finalText = result.text;
        aiMessage.content = substituteAllVariables(finalText);

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlResult = await aiDeviceControl.processLlmOutput(aiMessage.content, devices, deviceService);
        if (aiControlResult.commands.length > 0) {
          console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
          aiMessage.content = aiControlResult.text;
        }

        aiMessage.streaming = false;

        // Broadcast final message state
        broadcast('stream_complete', { messageId: aiMessage.id, content: aiMessage.content });

      } else {
        // Non-streaming mode
        const result = await llmService.generate({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: settings.llm
        });
        finalText = result.text;
      }

      let retryCount = 0;
      const maxRetries = 2;

      // Retry if blank or duplicate (only in non-streaming mode)
      while (!useStreaming && (isBlankMessage(finalText) || isDuplicateMessage(finalText)) && retryCount < maxRetries) {
        retryCount++;
        console.log(`[Chat] Regenerating (attempt ${retryCount}): blank=${isBlankMessage(finalText)}, duplicate=${isDuplicateMessage(finalText)}`);

        const retryContext = buildChatContext(activeCharacter, settings);
        retryContext.systemPrompt += '\n\nIMPORTANT: Write a UNIQUE response. Do not repeat previous messages.';

        const retryResult = await llmService.generate({
          prompt: retryContext.prompt,
          systemPrompt: retryContext.systemPrompt,
          settings: settings.llm
        });
        finalText = retryResult.text;
      }

      console.log('[Chat] Got AI response:', finalText?.substring(0, 50) + '...');

      // Skip if still invalid after retries
      if (isBlankMessage(finalText) || isDuplicateMessage(finalText)) {
        console.log('[Chat] Skipping invalid AI response after retries');
        broadcast('generating_stop', {});
        return;
      }

      // For non-streaming, add message now
      if (!useStreaming) {
        // Apply variable substitution to final text
        finalText = substituteAllVariables(finalText);

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService);
        if (aiControlResult.commands.length > 0) {
          console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
          finalText = aiControlResult.text;
        }

        // Add AI response to chat
        const aiMessage = {
          id: uuidv4(),
          content: finalText,
          sender: 'character',
          characterId: activeCharacter.id,
          characterName: activeCharacter.name,
          timestamp: Date.now()
        };
        sessionState.chatHistory.push(aiMessage);
        broadcast('chat_message', aiMessage);
      }

      broadcast('generating_stop', {});
      autosaveSession();

      // Trigger AI speaks event for flow engine
      const lastMsg = sessionState.chatHistory[sessionState.chatHistory.length - 1];
      await eventEngine.handleEvent('ai_speaks', { content: lastMsg?.content });

    } catch (error) {
      console.error('[Chat] LLM error:', error.message);
      broadcast('generating_stop', {});
      broadcast('error', { message: 'Failed to generate AI response', error: error.message });
    }
  }
}

async function handleSpecialGenerate(data) {
  const { mode, guidedText } = data;

  const settings = loadData(DATA_FILES.settings);
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadData(DATA_FILES.personas) || [];
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);

  if (!activeCharacter || !hasLlmConfig) {
    broadcast('error', { message: 'No character or LLM configured' });
    return;
  }

  // Determine who is generating based on mode
  const isPlayerVoice = mode === 'impersonate' || mode === 'guided_impersonate';
  const generatingFor = isPlayerVoice ? (activePersona?.displayName || 'Player') : activeCharacter.name;

  // Notify UI that we're generating
  broadcast('generating_start', { characterName: generatingFor, isPlayerVoice });

  try {
    const context = buildSpecialContext(mode, guidedText, activeCharacter, activePersona, settings);
    const useStreaming = settings.llm?.streaming === true;

    let finalText = '';

    if (useStreaming) {
      // Streaming mode - create placeholder message and update as tokens arrive
      const message = {
        id: uuidv4(),
        content: '',
        sender: isPlayerVoice ? 'player' : 'character',
        characterId: isPlayerVoice ? null : activeCharacter.id,
        characterName: isPlayerVoice ? null : activeCharacter.name,
        timestamp: Date.now(),
        generated: true,
        mode,
        streaming: true
      };
      sessionState.chatHistory.push(message);
      broadcast('chat_message', message);

      const result = await llmService.generateStream({
        prompt: context.prompt,
        systemPrompt: context.systemPrompt,
        settings: settings.llm,
        onToken: (token, fullText) => {
          message.content = fullText;
          broadcast('stream_token', { messageId: message.id, token, fullText });
        }
      });

      finalText = result.text;
      message.content = substituteAllVariables(finalText);

      // Process AI device commands (e.g., [pump on], [vibe off])
      const devices = loadData(DATA_FILES.devices) || [];
      const aiControlResult = await aiDeviceControl.processLlmOutput(message.content, devices, deviceService);
      if (aiControlResult.commands.length > 0) {
        console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
        message.content = aiControlResult.text;
      }

      message.streaming = false;

      broadcast('stream_complete', { messageId: message.id, content: message.content });
      broadcast('generating_stop', {});
      autosaveSession();
      return;

    } else {
      // Non-streaming mode
      const result = await llmService.generate({
        prompt: context.prompt,
        systemPrompt: context.systemPrompt,
        settings: settings.llm
      });
      finalText = result.text;
    }

    let retryCount = 0;
    const maxRetries = 2;

    // Just use the generated text directly - guidance is incorporated by the LLM
    const getFullContent = (text) => text;

    // Retry if blank or duplicate
    while ((isBlankMessage(finalText) || isDuplicateMessage(getFullContent(finalText))) && retryCount < maxRetries) {
      retryCount++;
      console.log(`[Special Generate] Regenerating (attempt ${retryCount})`);

      const retryContext = buildSpecialContext(mode, guidedText, activeCharacter, activePersona, settings);
      retryContext.systemPrompt += '\n\nIMPORTANT: Write a UNIQUE response. Do not repeat previous messages.';

      const retryResult = await llmService.generate({
        prompt: retryContext.prompt,
        systemPrompt: retryContext.systemPrompt,
        settings: settings.llm
      });
      finalText = retryResult.text;
    }

    // Check for empty result after retries
    if (isBlankMessage(finalText)) {
      console.log('[Special Generate] LLM returned empty result after retries');
      broadcast('generating_stop', {});
      broadcast('error', { message: 'LLM returned empty response. Please try again.' });
      return;
    }

    // Apply variable substitution
    finalText = substituteAllVariables(finalText);

    // Process AI device commands (e.g., [pump on], [vibe off])
    const devices = loadData(DATA_FILES.devices) || [];
    const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService);
    if (aiControlResult.commands.length > 0) {
      console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
      finalText = aiControlResult.text;
    }

    const content = getFullContent(finalText);

    // Final duplicate check
    if (isDuplicateMessage(content)) {
      console.log('[Special Generate] Skipping duplicate after retries');
      broadcast('generating_stop', {});
      broadcast('error', { message: 'Response was duplicate. Please try again.' });
      return;
    }

    const message = {
      id: uuidv4(),
      content,
      sender: isPlayerVoice ? 'player' : 'character',
      characterId: isPlayerVoice ? null : activeCharacter.id,
      characterName: isPlayerVoice ? null : activeCharacter.name,
      timestamp: Date.now(),
      generated: true,
      mode
    };

    broadcast('generating_stop', {});
    sessionState.chatHistory.push(message);
    broadcast('chat_message', message);
    autosaveSession();

  } catch (error) {
    console.error('[Special Generate] Error:', error);
    broadcast('generating_stop', {});
    broadcast('error', { message: 'Failed to generate', error: error.message });
  }
}

async function handleImpersonateRequest(data) {
  const { guidedText } = data;

  const settings = loadData(DATA_FILES.settings);
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadData(DATA_FILES.personas) || [];
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  // Check if LLM is configured (either llmUrl for OpenAI/KoboldCPP, or OpenRouter with API key)
  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);

  if (!activeCharacter || !hasLlmConfig) {
    broadcast('error', { message: 'No character or LLM configured' });
    return;
  }

  try {
    llmState.isGenerating = true;
    broadcast('generating_start', { characterName: activePersona?.displayName || 'Player', isPlayerVoice: true });

    // Use pure impersonate mode if no guided text provided
    const mode = guidedText ? 'guided_impersonate' : 'impersonate';
    const context = buildSpecialContext(mode, guidedText, activeCharacter, activePersona, settings);

    const result = await llmService.generate({
      prompt: context.prompt,
      systemPrompt: context.systemPrompt,
      settings: settings.llm
    });

    // Apply variable substitution and send result
    const substitutedText = substituteAllVariables(result.text);
    llmState.isGenerating = false;
    broadcast('generating_stop', {});
    broadcast('impersonate_result', { text: substitutedText });
    await processQueuedFlowMessage();

  } catch (error) {
    console.error('[Impersonate Request] Error:', error);
    llmState.isGenerating = false;
    broadcast('generating_stop', {});
    broadcast('error', { message: 'Failed to generate impersonation', error: error.message });
    await processQueuedFlowMessage();
  }
}

function buildSpecialContext(mode, guidedText, character, persona, settings) {
  let systemPrompt = '';
  let prompt = '';

  const playerName = persona?.displayName || 'The player';

  // Substitute variables in character fields (uses global substituteAllVariables)
  const substituteVars = (text) => substituteAllVariables(text, { playerName, characterName: character.name });

  // Convert second-person character descriptions to third-person for impersonate mode
  // e.g., "You are a doctor" -> "Dr. Elena is a doctor"
  const toThirdPerson = (text, name) => {
    if (!text) return text;
    return text
      .replace(/\bYou are\b/gi, `${name} is`)
      .replace(/\bYou're\b/gi, `${name}'s`)
      .replace(/\bYou have\b/gi, `${name} has`)
      .replace(/\bYou speak\b/gi, `${name} speaks`)
      .replace(/\bYou use\b/gi, `${name} uses`)
      .replace(/\bYou treat\b/gi, `${name} treats`)
      .replace(/\bYou get\b/gi, `${name} gets`)
      .replace(/\bYou push\b/gi, `${name} pushes`)
      .replace(/\bYou love\b/gi, `${name} loves`)
      .replace(/\bYou view\b/gi, `${name} views`)
      .replace(/\bYou genuinely\b/gi, `${name} genuinely`)
      .replace(/\bYou focus\b/gi, `${name} focuses`)
      .replace(/\bYou maintain\b/gi, `${name} maintains`)
      .replace(/\bYou approach\b/gi, `${name} approaches`)
      .replace(/\bYou live\b/gi, `${name} lives`)
      .replace(/\bYou delight\b/gi, `${name} delights`)
      .replace(/\bYou ramble\b/gi, `${name} rambles`)
      .replace(/\bYou laugh\b/gi, `${name} laughs`)
      .replace(/\bYou document\b/gi, `${name} documents`)
      .replace(/\bYour\b/g, `${name}'s`)
      .replace(/\bYou\b/g, name); // Catch remaining "You" as fallback
  };

  // Map capacity percentage to belly description
  const getCapacityDescription = (capacity) => {
    if (capacity <= 0) return 'flat/normal';
    if (capacity <= 10) return 'very slight fullness, barely noticeable';
    if (capacity <= 25) return 'mildly bloated, like after a large meal';
    if (capacity <= 40) return 'noticeably swollen, belly pushing out';
    if (capacity <= 55) return 'significantly inflated, round and taut';
    if (capacity <= 70) return 'heavily inflated, stretched drum-tight';
    if (capacity <= 85) return 'massively distended, skin pulled tight';
    if (capacity <= 95) return 'enormous, straining at maximum capacity';
    return 'beyond full, dangerously over-inflated';
  };

  // Build strict belly state instructions
  const buildBellyStateInstructions = (capacity, painLevel, subjectName, isFirstPerson = false) => {
    const bellyDesc = getCapacityDescription(capacity);
    const subject = isFirstPerson ? 'Your' : `${subjectName}'s`;
    const verb = isFirstPerson ? 'are' : 'is';

    // Convert pain number to descriptive label
    const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
    const painLabel = painLabels[painLevel] || 'None';

    let instructions = `\n=== MANDATORY BELLY STATE (DO NOT DEVIATE) ===\n`;
    instructions += `${subject} belly ${verb} at EXACTLY ${capacity}% capacity: ${bellyDesc}.\n`;
    instructions += `${subject} pain/discomfort level ${verb} EXACTLY: "${painLabel}" (${painLevel}/10).\n`;
    instructions += `STRICT RULES:\n`;
    instructions += `- Describe the belly ONLY as "${bellyDesc}" - no larger, no smaller\n`;
    instructions += `- Physical discomfort must match "${painLabel}" (${painLevel}/10) EXACTLY\n`;
    instructions += `- DO NOT describe inflation increasing, decreasing, or changing in any way\n`;
    instructions += `- DO NOT mention flow rate, speed, pumping faster/slower, or rate changes\n`;
    instructions += `- DO NOT describe growing, swelling, expanding, or deflating\n`;
    instructions += `- The belly state is FIXED and STATIC until the system updates it\n`;
    instructions += `- Treat the current state as having always been this way in this moment\n`;
    instructions += `=== END MANDATORY BELLY STATE ===\n\n`;
    return instructions;
  };

  if (mode === 'impersonate' || mode === 'guided_impersonate') {
    // Generate as the player
    systemPrompt = `You are ${playerName}, the player character.\n\n`;
    if (persona) {
      if (persona.personality) systemPrompt += `Personality: ${persona.personality}\n`;
      if (persona.appearance) systemPrompt += `Appearance: ${persona.appearance}\n`;
      if (persona.relationshipWithInflation) systemPrompt += `Relationship with Inflation: ${persona.relationshipWithInflation}\n`;
      systemPrompt += '\n';
    }

    // Convert character description to third-person to avoid "You are" confusion
    const charDescThirdPerson = toThirdPerson(substituteVars(character.description), character.name);
    systemPrompt += `You are interacting with ${character.name}. ${charDescThirdPerson}\n`;
    const scenario = getActiveScenario(character);
    if (scenario) systemPrompt += `Scenario: ${substituteVars(scenario)}\n`;
    systemPrompt += '\n';

    // Add constant reminders about the character (helps player responses be contextually appropriate)
    const charRemindersImp = (character.constantReminders || []).filter(r => r.enabled !== false);
    const globalRemindersImp = (settings.globalReminders || []).filter(r => r.enabled !== false);
    if (charRemindersImp.length > 0 || globalRemindersImp.length > 0) {
      systemPrompt += 'Constant Reminders:\n';
      globalRemindersImp.forEach(reminder => {
        systemPrompt += `- ${reminder.text}\n`;
      });
      charRemindersImp.forEach(reminder => {
        systemPrompt += `- ${reminder.text}\n`;
      });
      systemPrompt += '\n';
    }

    systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerName, true);
    systemPrompt += `You emotionally feel ${sessionState.emotion}.\n\n`;

    // Add global prompt / author note
    if (settings?.globalPrompt) {
      systemPrompt += `Author Note: ${settings.globalPrompt}\n\n`;
    }

    systemPrompt += `Write ${playerName}'s next response. Stay in character and be descriptive.`;
  } else {
    // Guided response - generate as character
    systemPrompt = `You are ${character.name}. ${substituteVars(character.description)}\n`;
    systemPrompt += `IMPORTANT WRITING STYLE: Use "I/my/me" in DIALOGUE, but use "${character.name}" (third person) for ACTIONS.\nExample: "I'll turn this up," ${character.name} says, reaching for the dial.\n\n`;
    systemPrompt += `Personality: ${substituteVars(character.personality)}\n`;
    const scenario = getActiveScenario(character);
    if (scenario) systemPrompt += `Scenario: ${substituteVars(scenario)}\n`;
    systemPrompt += '\n';

    systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerName, false);
    systemPrompt += `${playerName} emotionally feels ${sessionState.emotion}.\n\n`;

    // Add constant reminders (character + global, filtered by enabled)
    const charRemindersGuided = (character.constantReminders || []).filter(r => r.enabled !== false);
    const globalRemindersGuided = (settings.globalReminders || []).filter(r => r.enabled !== false);
    if (charRemindersGuided.length > 0 || globalRemindersGuided.length > 0) {
      systemPrompt += 'Constant Reminders:\n';
      globalRemindersGuided.forEach(reminder => {
        systemPrompt += `- ${reminder.text}\n`;
      });
      charRemindersGuided.forEach(reminder => {
        systemPrompt += `- ${reminder.text}\n`;
      });
      systemPrompt += '\n';
    }

    // Add global prompt / author note
    if (settings?.globalPrompt) {
      systemPrompt += `Author Note: ${settings.globalPrompt}\n\n`;
    }

    systemPrompt += `Continue from the text provided. Stay in character.`;
  }

  // Build prompt from history using [Player] and [Char] tags
  const recentMessages = sessionState.chatHistory.slice(-15);
  prompt += 'Current conversation:\n';
  recentMessages.forEach(msg => {
    if (msg.sender === 'player') {
      prompt += `[Player]: ${msg.content}\n`;
    } else {
      prompt += `[Char]: ${msg.content}\n`;
    }
  });

  if (mode === 'guided' || mode === 'guided_impersonate') {
    const speakerTag = mode === 'guided_impersonate' ? '[Player]' : '[Char]';
    if (guidedText) {
      // Add guidance as instruction
      prompt += `\n(Guidance: ${guidedText})\n`;
      prompt += `${speakerTag}:`;
    } else {
      prompt += `${speakerTag}:`;
    }
  } else if (mode === 'impersonate') {
    // For pure impersonate - generate as player
    prompt += `[Player]:`;
  } else {
    // Default - generate as character
    prompt += `[Char]:`;
  }

  return { systemPrompt, prompt };
}

function buildChatContext(character, settings) {
  const personas = loadData(DATA_FILES.personas) || [];
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);
  const playerName = activePersona?.displayName || 'the player';

  // Substitute variables in character fields (uses global substituteAllVariables)
  const substituteVars = (text) => substituteAllVariables(text, { playerName, characterName: character.name });

  // Map capacity percentage to belly description
  const getCapacityDescription = (capacity) => {
    if (capacity <= 0) return 'flat/normal';
    if (capacity <= 10) return 'very slight fullness, barely noticeable';
    if (capacity <= 25) return 'mildly bloated, like after a large meal';
    if (capacity <= 40) return 'noticeably swollen, belly pushing out';
    if (capacity <= 55) return 'significantly inflated, round and taut';
    if (capacity <= 70) return 'heavily inflated, stretched drum-tight';
    if (capacity <= 85) return 'massively distended, skin pulled tight';
    if (capacity <= 95) return 'enormous, straining at maximum capacity';
    return 'beyond full, dangerously over-inflated';
  };

  // Build strict belly state instructions
  const buildBellyStateInstructions = (capacity, painLevel, subjectName, isFirstPerson = false) => {
    const bellyDesc = getCapacityDescription(capacity);
    const subject = isFirstPerson ? 'Your' : `${subjectName}'s`;
    const verb = isFirstPerson ? 'are' : 'is';

    // Convert pain number to descriptive label
    const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
    const painLabel = painLabels[painLevel] || 'None';

    let instructions = `\n=== MANDATORY BELLY STATE (DO NOT DEVIATE) ===\n`;
    instructions += `${subject} belly ${verb} at EXACTLY ${capacity}% capacity: ${bellyDesc}.\n`;
    instructions += `${subject} pain/discomfort level ${verb} EXACTLY: "${painLabel}" (${painLevel}/10).\n`;
    instructions += `STRICT RULES:\n`;
    instructions += `- Describe the belly ONLY as "${bellyDesc}" - no larger, no smaller\n`;
    instructions += `- Physical discomfort must match "${painLabel}" (${painLevel}/10) EXACTLY\n`;
    instructions += `- DO NOT describe inflation increasing, decreasing, or changing in any way\n`;
    instructions += `- DO NOT mention flow rate, speed, pumping faster/slower, or rate changes\n`;
    instructions += `- DO NOT describe growing, swelling, expanding, or deflating\n`;
    instructions += `- The belly state is FIXED and STATIC until the system updates it\n`;
    instructions += `- Treat the current state as having always been this way in this moment\n`;
    instructions += `=== END MANDATORY BELLY STATE ===\n\n`;
    return instructions;
  };

  // Build system prompt from character
  let systemPrompt = `You are ${character.name}. ${substituteVars(character.description)}\n`;
  systemPrompt += `IMPORTANT WRITING STYLE: Use "I/my/me" in DIALOGUE, but use "${character.name}" (third person) for ACTIONS.\nExample: "I'll turn this up," ${character.name} says, reaching for the dial.\n\n`;
  systemPrompt += `Personality: ${substituteVars(character.personality)}\n\n`;
  const scenario = getActiveScenario(character);
  if (scenario) {
    systemPrompt += `Scenario: ${substituteVars(scenario)}\n\n`;
  }

  // Add player info if available
  if (activePersona) {
    systemPrompt += `The player is ${activePersona.displayName}`;
    if (activePersona.pronouns) {
      systemPrompt += ` (${activePersona.pronouns})`;
    }
    systemPrompt += '.\n';
    if (activePersona.appearance) {
      systemPrompt += `Player appearance: ${activePersona.appearance}\n`;
    }
    if (activePersona.personality) {
      systemPrompt += `Player personality: ${activePersona.personality}\n`;
    }
    if (activePersona.relationshipWithInflation) {
      systemPrompt += `Player's relationship with inflation: ${activePersona.relationshipWithInflation}\n`;
    }
    systemPrompt += '\n';
  }

  // Add player's current physical/emotional state
  const playerLabel = activePersona?.displayName || 'The player';
  systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerLabel, false);
  systemPrompt += `${playerLabel} emotionally feels ${sessionState.emotion}.\n`;

  // Add recent challenge result if available (helps AI know the outcome)
  if (sessionState.lastChallengeResult) {
    const cr = sessionState.lastChallengeResult;
    // Only include if the challenge happened recently (within 60 seconds)
    const isRecent = (Date.now() - cr.timestamp) < 60000;
    if (isRecent) {
      systemPrompt += `\n=== RECENT CHALLENGE RESULT ===\n`;
      systemPrompt += `A ${cr.typeName} challenge just occurred. Result: ${playerLabel} ${cr.description}.\n`;
      systemPrompt += `IMPORTANT: Base your response on this ACTUAL result. Do NOT make up a different outcome.\n`;
      systemPrompt += `=== END CHALLENGE RESULT ===\n\n`;
    }
  }

  // Add constant reminders (character + global, filtered by enabled)
  const charRemindersChat = (character.constantReminders || []).filter(r => r.enabled !== false);
  const globalRemindersChat = (settings.globalReminders || []).filter(r => r.enabled !== false);
  if (charRemindersChat.length > 0 || globalRemindersChat.length > 0) {
    systemPrompt += '\nConstant Reminders:\n';
    globalRemindersChat.forEach(reminder => {
      systemPrompt += `- ${reminder.text}\n`;
    });
    charRemindersChat.forEach(reminder => {
      systemPrompt += `- ${reminder.text}\n`;
    });
  }

  // Add global prompt / author note (positioned prominently at end of system prompt)
  if (settings?.globalPrompt) {
    systemPrompt += `\n[Author Note: ${settings.globalPrompt}]\n`;
  }

  // Build prompt from recent chat history
  const recentMessages = sessionState.chatHistory.slice(-20);
  let prompt = '';

  if (character.exampleDialogues && character.exampleDialogues.length > 0) {
    prompt += 'Example dialogue:\n';
    character.exampleDialogues.forEach(ex => {
      prompt += `User: ${ex.user}\n${character.name}: ${ex.character}\n`;
    });
    prompt += '\nCurrent conversation:\n';
  }

  recentMessages.forEach(msg => {
    if (msg.sender === 'player') {
      prompt += `${playerLabel}: ${msg.content}\n`;
    } else if (msg.sender === 'character') {
      prompt += `${character.name}: ${msg.content}\n`;
    }
  });

  prompt += `${character.name}:`;

  return { systemPrompt, prompt };
}

// ============================================
// API Routes
// ============================================

// --- Settings ---

app.get('/api/settings', (req, res) => {
  const settings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
  // Mask sensitive keys before sending to client
  const maskedSettings = maskSettingsForResponse(settings);
  res.json(maskedSettings);
});

app.post('/api/settings', async (req, res) => {
  const oldSettings = loadData(DATA_FILES.settings) || {};

  // Merge new settings, preserving encrypted keys if not provided
  const settings = { ...oldSettings, ...req.body };

  // Encrypt any new API keys provided in the request
  if (req.body.openRouterApiKey && req.body.openRouterApiKey !== '') {
    settings.openRouterApiKey = encrypt(req.body.openRouterApiKey);
  } else if (!req.body.openRouterApiKey) {
    // Keep existing encrypted key if not provided
    settings.openRouterApiKey = oldSettings.openRouterApiKey;
  }
  if (req.body.goveeApiKey && req.body.goveeApiKey !== '') {
    settings.goveeApiKey = encrypt(req.body.goveeApiKey);
  } else if (!req.body.goveeApiKey) {
    settings.goveeApiKey = oldSettings.goveeApiKey;
  }
  if (req.body.tuyaAccessId && req.body.tuyaAccessId !== '') {
    settings.tuyaAccessId = encrypt(req.body.tuyaAccessId);
  } else if (!req.body.tuyaAccessId) {
    settings.tuyaAccessId = oldSettings.tuyaAccessId;
  }
  if (req.body.tuyaAccessSecret && req.body.tuyaAccessSecret !== '') {
    settings.tuyaAccessSecret = encrypt(req.body.tuyaAccessSecret);
  } else if (!req.body.tuyaAccessSecret) {
    settings.tuyaAccessSecret = oldSettings.tuyaAccessSecret;
  }

  saveData(DATA_FILES.settings, settings);

  // Auto-activate flows when character or persona changes
  const charChanged = req.body.activeCharacterId !== undefined && req.body.activeCharacterId !== oldSettings.activeCharacterId;
  const personaChanged = req.body.activePersonaId !== undefined && req.body.activePersonaId !== oldSettings.activePersonaId;

  if (charChanged || personaChanged) {
    activateAssignedFlows();

    // Update sessionState names for variable substitution
    if (charChanged && settings.activeCharacterId) {
      const characters = loadData(DATA_FILES.characters) || [];
      const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
      sessionState.characterName = activeCharacter?.name || null;
      // Sync character's autoReplyEnabled to session state
      sessionState.autoReply = activeCharacter?.autoReplyEnabled || false;
      broadcast('auto_reply_update', { enabled: sessionState.autoReply });
    }
    if (personaChanged && settings.activePersonaId) {
      const personas = loadData(DATA_FILES.personas) || [];
      const activePersona = personas.find(p => p.id === settings.activePersonaId);
      sessionState.playerName = activePersona?.displayName || null;
    }
  }

  // Broadcast masked settings to clients
  broadcast('settings_update', maskSettingsForResponse(settings));

  // Send welcome message if character changed and chat is empty
  if (charChanged && sessionState.chatHistory.length === 0 && settings.activeCharacterId) {
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    if (activeCharacter) {
      await sendWelcomeMessage(activeCharacter, decryptSettings(settings));
    }
  }

  res.json(maskSettingsForResponse(settings));
});

function activateAssignedFlows() {
  const settings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
  const assignments = sessionState.flowAssignments || { characters: {}, personas: {}, global: [] };

  // Collect all flows with their priorities
  // Priority: 0 = Global (highest), 1 = Character, 2 = Persona (lowest)
  const activeFlowsWithPriority = new Map();

  // Add global flows (priority 0)
  (assignments.global || []).forEach(id => {
    if (!activeFlowsWithPriority.has(id)) {
      activeFlowsWithPriority.set(id, 0);
    }
  });

  // Add flows for active character (priority 1)
  if (settings.activeCharacterId && assignments.characters) {
    const charFlows = assignments.characters[settings.activeCharacterId] || [];
    charFlows.forEach(id => {
      if (!activeFlowsWithPriority.has(id)) {
        activeFlowsWithPriority.set(id, 1);
      }
    });
  }

  // Add flows for active persona (priority 2)
  if (settings.activePersonaId && assignments.personas) {
    const personaFlows = assignments.personas[settings.activePersonaId] || [];
    personaFlows.forEach(id => {
      if (!activeFlowsWithPriority.has(id)) {
        activeFlowsWithPriority.set(id, 2);
      }
    });
  }

  // Deactivate all currently active flows
  eventEngine.deactivateAllFlows();

  if (isPerFlowStorageActive()) {
    // Per-flow storage: load only assigned flows
    const flowIdsToLoad = Array.from(activeFlowsWithPriority.keys());
    const flows = loadFlows(flowIdsToLoad);

    // Activate loaded flows with their priorities
    flows.forEach(flow => {
      const priority = activeFlowsWithPriority.get(flow.id);
      flow.isActive = true;
      eventEngine.activateFlow(flow, priority);
      // Save updated isActive state back to file
      saveFlow(flow);
    });

    // Broadcast index (lightweight)
    broadcast('flows_update', loadFlowsIndex());
    console.log('[Flows] Auto-activated flows (per-flow):', flowIdsToLoad.map(id => `${id}(p${activeFlowsWithPriority.get(id)})`).join(', '));
  } else {
    // Legacy: load all flows from single file
    const flows = loadData(DATA_FILES.flows) || [];

    // Activate assigned flows with their priorities
    flows.forEach(flow => {
      if (activeFlowsWithPriority.has(flow.id)) {
        flow.isActive = true;
        const priority = activeFlowsWithPriority.get(flow.id);
        eventEngine.activateFlow(flow, priority);
      } else {
        flow.isActive = false;
      }
    });

    // Save updated flow states
    saveData(DATA_FILES.flows, flows);
    broadcast('flows_update', flows);
    console.log('[Flows] Auto-activated flows:', Array.from(activeFlowsWithPriority.entries()).map(([id, pri]) => `${id}(p${pri})`).join(', '));
  }
}

app.post('/api/settings/llm', (req, res) => {
  const settings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
  settings.llm = { ...settings.llm, ...req.body };

  // Encrypt OpenRouter API key if provided
  if (req.body.openRouterApiKey && req.body.openRouterApiKey !== '') {
    settings.openRouterApiKey = encrypt(req.body.openRouterApiKey);
  }

  saveData(DATA_FILES.settings, settings);
  broadcast('settings_update', maskSettingsForResponse(settings));
  res.json(settings.llm);
});

// --- LLM ---

app.post('/api/llm/test', llmLimiter, async (req, res) => {
  try {
    const settings = req.body;
    const result = await llmService.testConnection(settings);
    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/llm/generate', llmLimiter, async (req, res) => {
  try {
    const { prompt, messages, systemPrompt } = req.body;
    const settings = loadData(DATA_FILES.settings)?.llm || DEFAULT_SETTINGS.llm;
    const result = await llmService.generate({ prompt, messages, systemPrompt, settings });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- OpenRouter ---

// Connect to OpenRouter and fetch models
app.post('/api/openrouter/connect', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }

    console.log('[OpenRouter] Testing connection...');
    const result = await llmService.testOpenRouterConnection(apiKey);

    if (result.success) {
      // Cache the models in memory for quick access
      global.openRouterModels = result.models;
      console.log(`[OpenRouter] Connected successfully, ${result.models.length} models available`);
    }

    res.json(result);
  } catch (error) {
    console.error('[OpenRouter] Connection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reconnect to OpenRouter using stored API key
app.post('/api/openrouter/reconnect', async (req, res) => {
  try {
    const settings = loadData(DATA_FILES.settings) || {};
    if (!settings.openRouterApiKey) {
      return res.status(400).json({ success: false, error: 'No stored API key found' });
    }

    // Decrypt the stored API key
    const apiKey = decrypt(settings.openRouterApiKey);
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'Failed to retrieve stored API key' });
    }

    console.log('[OpenRouter] Reconnecting with stored key...');
    const result = await llmService.testOpenRouterConnection(apiKey);

    if (result.success) {
      global.openRouterModels = result.models;
      console.log(`[OpenRouter] Reconnected successfully, ${result.models.length} models available`);
      result.maskedKey = maskApiKey(apiKey);
    }

    res.json(result);
  } catch (error) {
    console.error('[OpenRouter] Reconnection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get cached OpenRouter models
app.get('/api/openrouter/models', (req, res) => {
  const models = global.openRouterModels || [];
  res.json({ models });
});

// --- Personas ---

app.get('/api/personas', (req, res) => {
  const personas = loadData(DATA_FILES.personas) || [];
  res.json(personas);
});

app.post('/api/personas', (req, res) => {
  const personas = loadData(DATA_FILES.personas) || [];
  const newPersona = {
    id: uuidv4(),
    ...req.body,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  personas.push(newPersona);
  saveData(DATA_FILES.personas, personas);
  broadcast('personas_update', personas);
  res.json(newPersona);
});

app.put('/api/personas/:id', (req, res) => {
  const personas = loadData(DATA_FILES.personas) || [];
  const index = personas.findIndex(p => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Persona not found' });
  }
  personas[index] = { ...personas[index], ...req.body, updatedAt: Date.now() };
  saveData(DATA_FILES.personas, personas);
  broadcast('personas_update', personas);
  res.json(personas[index]);
});

app.delete('/api/personas/:id', (req, res) => {
  let personas = loadData(DATA_FILES.personas) || [];
  personas = personas.filter(p => p.id !== req.params.id);
  saveData(DATA_FILES.personas, personas);
  broadcast('personas_update', personas);
  res.json({ success: true });
});

// --- Connection Profiles ---

// Helper to mask API keys in connection profiles for response
function maskConnectionProfiles(profiles) {
  return profiles.map(profile => {
    const masked = { ...profile };
    if (masked.openRouterApiKey) {
      masked.openRouterApiKeyMasked = maskApiKey(masked.openRouterApiKey);
      masked.hasOpenRouterApiKey = hasApiKey(masked.openRouterApiKey);
      masked.openRouterApiKey = ''; // Don't send actual key
    }
    return masked;
  });
}

app.get('/api/connection-profiles', (req, res) => {
  const profiles = loadData(DATA_FILES.connectionProfiles) || [];
  // Mask API keys before sending to client
  res.json(maskConnectionProfiles(profiles));
});

app.post('/api/connection-profiles', (req, res) => {
  const profiles = loadData(DATA_FILES.connectionProfiles) || [];
  const newProfile = {
    id: 'conn-' + uuidv4().slice(0, 8),
    ...req.body,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Encrypt API key if provided
  if (newProfile.openRouterApiKey) {
    newProfile.openRouterApiKey = encrypt(newProfile.openRouterApiKey);
  }

  profiles.push(newProfile);
  saveData(DATA_FILES.connectionProfiles, profiles);
  broadcast('connection_profiles_update', maskConnectionProfiles(profiles));
  res.json(maskConnectionProfiles([newProfile])[0]);
});

app.put('/api/connection-profiles/:id', (req, res) => {
  const profiles = loadData(DATA_FILES.connectionProfiles) || [];
  const index = profiles.findIndex(p => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Connection profile not found' });
  }

  const oldProfile = profiles[index];
  profiles[index] = { ...oldProfile, ...req.body, updatedAt: Date.now() };

  // Encrypt new API key if provided, otherwise keep existing
  if (req.body.openRouterApiKey && req.body.openRouterApiKey !== '') {
    profiles[index].openRouterApiKey = encrypt(req.body.openRouterApiKey);
  } else if (!req.body.openRouterApiKey) {
    profiles[index].openRouterApiKey = oldProfile.openRouterApiKey;
  }

  saveData(DATA_FILES.connectionProfiles, profiles);
  broadcast('connection_profiles_update', maskConnectionProfiles(profiles));
  res.json(maskConnectionProfiles([profiles[index]])[0]);
});

app.delete('/api/connection-profiles/:id', (req, res) => {
  let profiles = loadData(DATA_FILES.connectionProfiles) || [];
  profiles = profiles.filter(p => p.id !== req.params.id);
  saveData(DATA_FILES.connectionProfiles, profiles);
  broadcast('connection_profiles_update', maskConnectionProfiles(profiles));
  res.json({ success: true });
});

app.post('/api/connection-profiles/:id/activate', (req, res) => {
  const profiles = loadData(DATA_FILES.connectionProfiles) || [];
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) {
    return res.status(404).json({ error: 'Connection profile not found' });
  }

  // Decrypt profile for use, then save to settings (re-encrypted)
  const decryptedProfile = decryptConnectionProfile(profile);
  const settings = loadData(DATA_FILES.settings) || {};
  const { id, name, createdAt, updatedAt, openRouterApiKey, ...llmSettings } = decryptedProfile;
  settings.llm = { ...settings.llm, ...llmSettings, activeProfileId: profile.id };

  // Re-encrypt the API key for storage
  if (openRouterApiKey) {
    settings.openRouterApiKey = encrypt(openRouterApiKey);
  }

  saveData(DATA_FILES.settings, settings);
  broadcast('settings_update', maskSettingsForResponse(settings));
  res.json({ success: true, settings: maskSettingsForResponse(settings) });
});

// --- Remote Settings ---

app.get('/api/remote-settings', (req, res) => {
  const settings = getRemoteSettings();
  // Include whether this is a local request so the UI knows if editing is allowed
  res.json({
    ...settings,
    isLocalRequest: isLocalRequest(req)
  });
});

app.post('/api/remote-settings', (req, res) => {
  // Only allow modifications from localhost
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Remote settings can only be modified from the host machine' });
  }

  const currentSettings = getRemoteSettings();
  const { allowRemote, whitelistedIps } = req.body;

  const newSettings = {
    allowRemote: allowRemote !== undefined ? allowRemote : currentSettings.allowRemote,
    whitelistedIps: whitelistedIps !== undefined ? whitelistedIps : currentSettings.whitelistedIps
  };

  saveData(DATA_FILES.remoteSettings, newSettings);
  log.info('Remote settings updated:', newSettings);
  res.json({ ...newSettings, isLocalRequest: true });
});

app.post('/api/remote-settings/whitelist', (req, res) => {
  // Only allow modifications from localhost
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Remote settings can only be modified from the host machine' });
  }

  const { ip } = req.body;
  if (!ip || typeof ip !== 'string') {
    return res.status(400).json({ error: 'IP address is required' });
  }

  // Basic IP validation (IPv4)
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) {
    return res.status(400).json({ error: 'Invalid IPv4 address format' });
  }

  const settings = getRemoteSettings();
  if (settings.whitelistedIps.includes(ip)) {
    return res.status(400).json({ error: 'IP already whitelisted' });
  }

  settings.whitelistedIps.push(ip);
  saveData(DATA_FILES.remoteSettings, settings);
  log.info('Added IP to whitelist:', ip);
  res.json({ ...settings, isLocalRequest: true });
});

app.delete('/api/remote-settings/whitelist/:ip', (req, res) => {
  // Only allow modifications from localhost
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Remote settings can only be modified from the host machine' });
  }

  const ipToRemove = decodeURIComponent(req.params.ip);
  const settings = getRemoteSettings();

  const index = settings.whitelistedIps.indexOf(ipToRemove);
  if (index === -1) {
    return res.status(404).json({ error: 'IP not found in whitelist' });
  }

  settings.whitelistedIps.splice(index, 1);
  saveData(DATA_FILES.remoteSettings, settings);
  log.info('Removed IP from whitelist:', ipToRemove);
  res.json({ ...settings, isLocalRequest: true });
});

// --- Characters ---

app.get('/api/characters', (req, res) => {
  if (isPerCharStorageActive()) {
    const characters = loadAllCharacters();
    res.json(characters);
  } else {
    const characters = loadData(DATA_FILES.characters) || [];
    res.json(characters);
  }
});

// Get single character by ID
app.get('/api/characters/:id', (req, res) => {
  if (isPerCharStorageActive()) {
    const character = loadCharacter(req.params.id);
    if (character) {
      res.json(character);
    } else {
      res.status(404).json({ error: 'Character not found' });
    }
  } else {
    const characters = loadData(DATA_FILES.characters) || [];
    const character = characters.find(c => c.id === req.params.id);
    if (character) {
      res.json(character);
    } else {
      res.status(404).json({ error: 'Character not found' });
    }
  }
});

app.post('/api/characters', (req, res) => {
  const newCharacter = {
    id: uuidv4(),
    ...req.body,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  if (isPerCharStorageActive()) {
    saveCharacter(newCharacter, true); // Force to custom for new characters
    const characters = loadAllCharacters();
    broadcast('characters_update', characters);
  } else {
    const characters = loadData(DATA_FILES.characters) || [];
    characters.push(newCharacter);
    saveData(DATA_FILES.characters, characters);
    broadcast('characters_update', characters);
  }

  res.json(newCharacter);
});

app.put('/api/characters/:id', (req, res) => {
  let updatedCharacter;

  if (isPerCharStorageActive()) {
    const existingCharacter = loadCharacter(req.params.id);
    if (!existingCharacter) {
      return res.status(404).json({ error: 'Character not found' });
    }
    updatedCharacter = { ...existingCharacter, ...req.body, updatedAt: Date.now() };
    saveCharacter(updatedCharacter);
    const characters = loadAllCharacters();
    broadcast('characters_update', characters);
  } else {
    const characters = loadData(DATA_FILES.characters) || [];
    const index = characters.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Character not found' });
    }
    characters[index] = { ...characters[index], ...req.body, updatedAt: Date.now() };
    updatedCharacter = characters[index];
    saveData(DATA_FILES.characters, characters);
    broadcast('characters_update', characters);
  }

  // If this is the active character, sync autoReplyEnabled to session state
  const settings = loadData(DATA_FILES.settings);
  if (settings?.activeCharacterId === req.params.id && req.body.autoReplyEnabled !== undefined) {
    sessionState.autoReply = req.body.autoReplyEnabled;
    broadcast('auto_reply_update', { enabled: sessionState.autoReply });
  }

  res.json(updatedCharacter);
});

app.delete('/api/characters/:id', (req, res) => {
  if (isPerCharStorageActive()) {
    deleteCharacterFile(req.params.id);
    const characters = loadAllCharacters();
    broadcast('characters_update', characters);
  } else {
    let characters = loadData(DATA_FILES.characters) || [];
    characters = characters.filter(c => c.id !== req.params.id);
    saveData(DATA_FILES.characters, characters);
    broadcast('characters_update', characters);
  }
  res.json({ success: true });
});

// --- Devices ---

app.get('/api/devices', (req, res) => {
  const devices = loadData(DATA_FILES.devices) || [];
  res.json(devices);
});

// Simulation mode status - returns whether simulation mode is required
app.get('/api/simulation-status', (req, res) => {
  const status = getSimulationStatus();
  // Also update event engine simulation mode
  eventEngine.setSimulationMode(status.required);
  res.json({
    simulationRequired: status.required,
    reason: status.reason
  });
});

app.post('/api/devices/scan', deviceScanLimiter, async (req, res) => {
  try {
    const timeout = req.body.timeout || 10;
    const discovered = await deviceService.scanNetwork(timeout);
    res.json({ devices: discovered });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices', (req, res) => {
  const devices = loadData(DATA_FILES.devices) || [];
  const newDevice = {
    id: uuidv4(),
    ...req.body,
    currentState: 'off'
  };

  // Check for existing calibration data for this device
  const calibrations = loadData(DATA_FILES.calibrations) || {};
  const deviceKey = getDeviceKey(newDevice);
  if (calibrations[deviceKey]) {
    // Restore calibration data from saved calibrations
    Object.assign(newDevice, calibrations[deviceKey]);
    console.log(`[Devices] Restored calibration data for ${deviceKey}`);
  }

  // Check for existing custom label for this device
  const deviceLabels = loadData(DATA_FILES.deviceLabels) || {};
  if (deviceLabels[deviceKey]) {
    newDevice.customLabel = deviceLabels[deviceKey];
    console.log(`[Devices] Restored custom label for ${deviceKey}: ${deviceLabels[deviceKey]}`);
  }

  devices.push(newDevice);
  saveData(DATA_FILES.devices, devices);
  deviceService.registerDevice(newDevice);
  broadcast('devices_update', devices);
  res.json(newDevice);
});

app.put('/api/devices/:id', (req, res) => {
  const devices = loadData(DATA_FILES.devices) || [];
  const index = devices.findIndex(d => d.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Device not found' });
  }
  devices[index] = { ...devices[index], ...req.body };
  saveData(DATA_FILES.devices, devices);

  const deviceKey = getDeviceKey(devices[index]);

  // If calibration data is being saved, also save to calibrations store
  const calibrationFields = ['calibrationTime', 'calibrationCapacity', 'calibrationPainAtMax', 'calibratedAt'];
  const hasCalibrationData = calibrationFields.some(field => req.body[field] !== undefined);
  if (hasCalibrationData) {
    const calibrations = loadData(DATA_FILES.calibrations) || {};
    calibrations[deviceKey] = {
      calibrationTime: devices[index].calibrationTime,
      calibrationCapacity: devices[index].calibrationCapacity,
      calibrationPainAtMax: devices[index].calibrationPainAtMax,
      calibratedAt: devices[index].calibratedAt
    };
    saveData(DATA_FILES.calibrations, calibrations);
  }

  // If custom label is being saved, also save to device labels store
  if (req.body.customLabel !== undefined) {
    const deviceLabels = loadData(DATA_FILES.deviceLabels) || {};
    if (req.body.customLabel) {
      deviceLabels[deviceKey] = req.body.customLabel;
    } else {
      // Remove label if set to empty
      delete deviceLabels[deviceKey];
    }
    saveData(DATA_FILES.deviceLabels, deviceLabels);
  }

  broadcast('devices_update', devices);
  res.json(devices[index]);
});

app.delete('/api/devices/:id', (req, res) => {
  let devices = loadData(DATA_FILES.devices) || [];
  const device = devices.find(d => d.id === req.params.id);
  if (device) {
    deviceService.unregisterDevice(device.ip);
  }
  devices = devices.filter(d => d.id !== req.params.id);
  saveData(DATA_FILES.devices, devices);
  broadcast('devices_update', devices);
  res.json({ success: true });
});

// Check reachability of all configured devices on startup
app.post('/api/devices/check-reachability', async (req, res) => {
  try {
    let devices = loadData(DATA_FILES.devices) || [];
    const settings = loadData(DATA_FILES.settings) || {};
    const unreachableDevices = [];
    const reachableDevices = [];
    let devicesUpdated = false;

    // Check each device's reachability
    for (const device of devices) {
      let isReachable = false;

      try {
        if (device.brand === 'govee') {
          // Govee devices - try to get power state
          const state = await goveeService.getPowerState(device.deviceId, device.sku);
          isReachable = state !== null && state !== undefined;
        } else if (device.brand === 'tuya') {
          // Tuya devices - try to get power state
          const state = await tuyaService.getPowerState(device.deviceId);
          isReachable = state !== null && state !== undefined;
        } else {
          // TPLink devices - try to get device info
          const result = await deviceService.getDeviceInfo(device.ip);
          isReachable = !result.error;
        }
      } catch (err) {
        console.log(`[Reachability] Device ${device.label || device.name || device.ip} check failed:`, err.message);
        isReachable = false;
      }

      // Update reachable status on device (don't remove, just mark)
      const wasReachable = device.isReachable !== false;
      device.isReachable = isReachable;
      device.lastReachabilityCheck = Date.now();

      if (isReachable) {
        reachableDevices.push(device);
      } else {
        unreachableDevices.push(device);
        console.log(`[Reachability] WARNING: Device ${device.label || device.name || device.ip} is not responding`);
      }

      // Track if status changed
      if (wasReachable !== isReachable) {
        devicesUpdated = true;
      }
    }

    // Save updated device statuses (but keep all devices)
    if (devicesUpdated || unreachableDevices.length > 0) {
      saveData(DATA_FILES.devices, devices);
      broadcast('devices_update', devices);

      // Send warning notification for unreachable devices
      if (unreachableDevices.length > 0) {
        const warningNames = unreachableDevices.map(d => d.label || d.name || d.ip || d.deviceId).join(', ');
        broadcast('device_warning', {
          type: 'unreachable',
          message: `Device(s) not responding: ${warningNames}`,
          devices: unreachableDevices.map(d => ({
            id: d.id,
            name: d.label || d.name || d.ip || d.deviceId,
            deviceType: d.deviceType
          }))
        });
      }
    }

    // Get updated simulation status
    const simulationStatus = getSimulationStatus();
    eventEngine.setSimulationMode(simulationStatus.required);

    res.json({
      success: true,
      unreachableDevices: unreachableDevices.map(d => ({
        id: d.id,
        name: d.label || d.name || d.ip || d.deviceId,
        deviceType: d.deviceType
      })),
      reachableDevices: reachableDevices.map(d => ({
        id: d.id,
        name: d.label || d.name || d.ip || d.deviceId,
        deviceType: d.deviceType
      })),
      simulationRequired: simulationStatus.required,
      simulationReason: simulationStatus.reason,
      totalDevices: devices.length
    });
  } catch (error) {
    console.error('[Reachability] Check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:ip/on', async (req, res) => {
  try {
    // Support optional childId for power strip outlets and brand for Govee/Tuya
    const { childId, brand, sku } = req.body;
    const deviceIdOrIp = req.params.ip;

    let device = null;
    if (brand === 'govee') {
      device = { deviceId: deviceIdOrIp, brand: 'govee', sku: sku || '' };
    } else if (brand === 'tuya') {
      device = { deviceId: deviceIdOrIp, brand: 'tuya' };
    } else if (childId) {
      device = { ip: deviceIdOrIp, childId, brand: 'tplink' };
    }

    const result = await deviceService.turnOn(deviceIdOrIp, device);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:ip/off', async (req, res) => {
  try {
    // Support optional childId for power strip outlets and brand for Govee/Tuya
    const { childId, brand, sku } = req.body;
    const deviceIdOrIp = req.params.ip;

    let device = null;
    if (brand === 'govee') {
      device = { deviceId: deviceIdOrIp, brand: 'govee', sku: sku || '' };
    } else if (brand === 'tuya') {
      device = { deviceId: deviceIdOrIp, brand: 'tuya' };
    } else if (childId) {
      device = { ip: deviceIdOrIp, childId, brand: 'tplink' };
    }

    const result = await deviceService.turnOff(deviceIdOrIp, device);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/devices/:ip/state', async (req, res) => {
  try {
    // Support optional childId for power strip outlets and brand for Govee/Tuya
    const { childId, brand, sku } = req.query;
    const deviceIdOrIp = req.params.ip;

    // Build device object if we have brand info or childId
    let device = null;
    if (brand === 'govee') {
      device = { deviceId: deviceIdOrIp, brand: 'govee', sku: sku || '' };
    } else if (brand === 'tuya') {
      device = { deviceId: deviceIdOrIp, brand: 'tuya' };
    } else if (childId) {
      device = { ip: deviceIdOrIp, childId, brand: 'tplink' };
    }

    const result = await deviceService.getDeviceState(deviceIdOrIp, device);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get children/outlets for multi-outlet devices (power strips like HS300)
app.get('/api/devices/:ip/children', async (req, res) => {
  try {
    const result = await deviceService.getChildren(req.params.ip);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:ip/cycle/start', async (req, res) => {
  try {
    const result = await deviceService.startCycle(req.params.ip, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:ip/cycle/stop', (req, res) => {
  const result = deviceService.stopCycle(req.params.ip);
  res.json(result);
});

// --- Govee Device API ---

// Connect to Govee (save API key and test connection)
app.post('/api/govee/connect', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  goveeService.setApiKey(apiKey);
  const success = await goveeService.testConnection();

  if (success) {
    // Save encrypted API key to settings
    const settings = loadData(DATA_FILES.settings) || {};
    settings.goveeApiKey = encrypt(apiKey);
    saveData(DATA_FILES.settings, settings);
    res.json({ success: true, message: 'Connected to Govee' });
  } else {
    goveeService.setApiKey(null);
    res.status(401).json({ error: 'Invalid API key or connection failed' });
  }
});

// Check Govee connection status
app.get('/api/govee/status', (req, res) => {
  res.json({ connected: goveeService.isConnected() });
});

// List Govee devices
app.get('/api/govee/devices', async (req, res) => {
  if (!goveeService.isConnected()) {
    return res.status(401).json({ error: 'Govee not connected' });
  }

  try {
    const devices = await goveeService.listDevices();
    res.json({ devices });
  } catch (error) {
    console.error('[Govee] Failed to list devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Govee device ON
app.post('/api/govee/devices/:deviceId/on', async (req, res) => {
  const { deviceId } = req.params;
  const { sku } = req.body;

  if (!sku) {
    return res.status(400).json({ error: 'SKU required' });
  }

  try {
    await goveeService.turnOn(deviceId, sku);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[Govee] Failed to turn on device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Govee device OFF
app.post('/api/govee/devices/:deviceId/off', async (req, res) => {
  const { deviceId } = req.params;
  const { sku } = req.body;

  if (!sku) {
    return res.status(400).json({ error: 'SKU required' });
  }

  try {
    await goveeService.turnOff(deviceId, sku);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[Govee] Failed to turn off device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Govee device state
app.get('/api/govee/devices/:deviceId/state', async (req, res) => {
  const { deviceId } = req.params;
  const { sku } = req.query;

  if (!sku) {
    return res.status(400).json({ error: 'SKU required as query param' });
  }

  try {
    const state = await goveeService.getPowerState(deviceId, sku);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[Govee] Failed to get device state:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Tuya API Routes
// ============================================

// Connect to Tuya (save credentials)
app.post('/api/tuya/connect', async (req, res) => {
  const { accessId, accessSecret, region } = req.body;
  if (!accessId || !accessSecret) {
    return res.status(400).json({ error: 'Access ID and Access Secret required' });
  }

  tuyaService.setCredentials(accessId, accessSecret, region || 'us');

  try {
    const success = await tuyaService.testConnection();

    if (success) {
      // Save encrypted credentials to settings
      const settings = loadData(DATA_FILES.settings) || {};
      settings.tuyaAccessId = encrypt(accessId);
      settings.tuyaAccessSecret = encrypt(accessSecret);
      settings.tuyaRegion = region || 'us';
      saveData(DATA_FILES.settings, settings);
      res.json({ success: true, message: 'Connected to Tuya' });
    } else {
      tuyaService.setCredentials(null, null);
      res.status(401).json({ error: 'Invalid credentials or connection failed' });
    }
  } catch (error) {
    console.error('[Tuya] Connect error:', error);
    tuyaService.setCredentials(null, null);
    res.status(401).json({ error: error.message || 'Connection failed' });
  }
});

// Disconnect from Tuya (clear credentials)
app.post('/api/tuya/disconnect', (req, res) => {
  tuyaService.setCredentials(null, null);
  // Remove from settings
  const settings = loadData(DATA_FILES.settings) || {};
  delete settings.tuyaAccessId;
  delete settings.tuyaAccessSecret;
  delete settings.tuyaRegion;
  saveData(DATA_FILES.settings, settings);
  res.json({ success: true, message: 'Disconnected from Tuya' });
});

// Check Tuya connection status
app.get('/api/tuya/status', (req, res) => {
  res.json({ connected: tuyaService.isConnected() });
});

// Add Tuya device IDs (required for Cloud Authorization)
app.post('/api/tuya/devices/add', (req, res) => {
  const { deviceIds } = req.body;
  if (!deviceIds) {
    return res.status(400).json({ error: 'deviceIds required (string or array)' });
  }
  tuyaService.addDeviceIds(deviceIds);
  res.json({ success: true, knownDevices: tuyaService.knownDeviceIds });
});

// List Tuya devices
app.get('/api/tuya/devices', async (req, res) => {
  if (!tuyaService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Tuya' });
  }

  try {
    // Accept device_ids as query param: ?device_ids=id1,id2
    const deviceIds = req.query.device_ids ? req.query.device_ids.split(',') : null;
    const devices = await tuyaService.listDevices(deviceIds);
    res.json({ devices });
  } catch (error) {
    console.error('[Tuya] Failed to list devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Tuya device on
app.post('/api/tuya/devices/:deviceId/on', async (req, res) => {
  const { deviceId } = req.params;

  try {
    await tuyaService.turnOn(deviceId);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[Tuya] Failed to turn on device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Tuya device off
app.post('/api/tuya/devices/:deviceId/off', async (req, res) => {
  const { deviceId } = req.params;

  try {
    await tuyaService.turnOff(deviceId);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[Tuya] Failed to turn off device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Tuya device state
app.get('/api/tuya/devices/:deviceId/state', async (req, res) => {
  const { deviceId } = req.params;

  try {
    const state = await tuyaService.getPowerState(deviceId);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[Tuya] Failed to get device state:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Wyze ---

// Connect to Wyze (login and get token)
app.post('/api/wyze/connect', async (req, res) => {
  const { email, password, keyId, apiKey, totpKey } = req.body;

  if (!email || !password || !keyId || !apiKey) {
    return res.status(400).json({ error: 'Missing required credentials: email, password, keyId, apiKey' });
  }

  try {
    wyzeService.setCredentials(email, password, keyId, apiKey, totpKey);
    const result = await wyzeService.connect();

    // Save credentials to settings (encrypt sensitive data)
    const settings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
    settings.wyzeEmail = email;
    settings.wyzeKeyId = keyId;
    settings.wyzeApiKey = encrypt(apiKey);
    settings.wyzePassword = encrypt(password);
    if (totpKey) {
      settings.wyzeTotpKey = encrypt(totpKey);
    }
    saveData(DATA_FILES.settings, settings);

    res.json({ success: true, userId: result.userId });
  } catch (error) {
    console.error('[Wyze] Connection failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Wyze connection status
app.get('/api/wyze/status', (req, res) => {
  res.json(wyzeService.getStatus());
});

// Disconnect from Wyze
app.post('/api/wyze/disconnect', (req, res) => {
  wyzeService.disconnect();

  // Clear saved credentials
  const settings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
  delete settings.wyzeEmail;
  delete settings.wyzeKeyId;
  delete settings.wyzeApiKey;
  delete settings.wyzePassword;
  delete settings.wyzeTotpKey;
  saveData(DATA_FILES.settings, settings);

  res.json({ success: true });
});

// List Wyze plugs
app.get('/api/wyze/devices', async (req, res) => {
  try {
    const devices = await wyzeService.listPlugs();
    res.json({ devices });
  } catch (error) {
    console.error('[Wyze] Failed to list devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Wyze device on
app.post('/api/wyze/devices/:deviceId/on', async (req, res) => {
  const { deviceId } = req.params;
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: 'Device model required in body' });
  }

  try {
    await wyzeService.turnOn(deviceId, model);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[Wyze] Failed to turn on device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Wyze device off
app.post('/api/wyze/devices/:deviceId/off', async (req, res) => {
  const { deviceId } = req.params;
  const { model } = req.body;

  if (!model) {
    return res.status(400).json({ error: 'Device model required in body' });
  }

  try {
    await wyzeService.turnOff(deviceId, model);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[Wyze] Failed to turn off device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Wyze device state
app.get('/api/wyze/devices/:deviceId/state', async (req, res) => {
  const { deviceId } = req.params;

  try {
    const state = await wyzeService.getPowerState(deviceId);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[Wyze] Failed to get device state:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Emergency Stop (flow-activated devices, flows, and LLM) ---
app.post('/api/emergency-stop', async (req, res) => {
  console.log('[EMERGENCY STOP] Stopping flow-activated devices, flows, and LLM requests!');
  const results = {
    devices: [],
    flows: null,
    llm: null
  };

  // 1. Halt all flow execution and get list of flow-activated devices
  let devicesToStop = [];
  if (eventEngine) {
    results.flows = eventEngine.emergencyStop();
    devicesToStop = results.flows.devicesToStop || [];
  }

  // 2. Stop only flow-activated devices (not all devices)
  for (const deviceInfo of devicesToStop) {
    try {
      const deviceId = deviceInfo.deviceId;
      const deviceObj = deviceInfo.deviceObj;
      // Stop any active cycle
      deviceService.stopCycle(deviceId);
      // Turn off the device
      await deviceService.turnOff(deviceId, deviceObj);
      results.devices.push({ id: deviceId, name: deviceObj?.name || deviceId, success: true });
      console.log(`[EMERGENCY STOP] Stopped flow-activated device: ${deviceObj?.name || deviceId}`);
    } catch (error) {
      results.devices.push({ id: deviceInfo.deviceId, name: deviceInfo.deviceObj?.name, success: false, error: error.message });
    }
  }

  if (devicesToStop.length === 0) {
    console.log('[EMERGENCY STOP] No flow-activated devices to stop');
  }

  // 3. Abort all pending LLM requests
  results.llm = { aborted: llmService.abortAllRequests() };

  broadcast('emergency_stop', { timestamp: Date.now(), results });
  res.json({ success: true, message: 'Emergency stop executed', results });
});

// --- Flows (Event Scripts) ---

app.get('/api/flows', (req, res) => {
  if (isPerFlowStorageActive()) {
    // Return lightweight index only
    const index = loadFlowsIndex();
    res.json(index);
  } else {
    // Legacy: return all flows from single file
    const flows = loadData(DATA_FILES.flows) || [];
    res.json(flows);
  }
});

// Get single flow by ID
app.get('/api/flows/:id', (req, res) => {
  if (isPerFlowStorageActive()) {
    const flow = loadFlow(req.params.id);
    if (flow) {
      res.json(flow);
    } else {
      res.status(404).json({ error: 'Flow not found' });
    }
  } else {
    // Legacy: find in single file
    const flows = loadData(DATA_FILES.flows) || [];
    const flow = flows.find(f => f.id === req.params.id);
    if (flow) {
      res.json(flow);
    } else {
      res.status(404).json({ error: 'Flow not found' });
    }
  }
});

app.post('/api/flows', (req, res) => {
  const newFlow = {
    id: uuidv4(),
    ...req.body,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  if (isPerFlowStorageActive()) {
    saveFlow(newFlow);
    const index = loadFlowsIndex();
    broadcast('flows_update', index);
  } else {
    const flows = loadData(DATA_FILES.flows) || [];
    flows.push(newFlow);
    saveData(DATA_FILES.flows, flows);
    broadcast('flows_update', flows);
  }

  res.json(newFlow);
});

app.put('/api/flows/:id', (req, res) => {
  const flowId = req.params.id;
  let updatedFlow;

  if (isPerFlowStorageActive()) {
    const existingFlow = loadFlow(flowId);
    if (!existingFlow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    updatedFlow = { ...existingFlow, ...req.body, updatedAt: Date.now() };
    saveFlow(updatedFlow);
  } else {
    const flows = loadData(DATA_FILES.flows) || [];
    const index = flows.findIndex(f => f.id === flowId);
    if (index === -1) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    flows[index] = { ...flows[index], ...req.body, updatedAt: Date.now() };
    updatedFlow = flows[index];
    saveData(DATA_FILES.flows, flows);
  }

  // Sync auto-generated buttons for all characters and personas with this flow assigned
  const charButtonsUpdated = syncButtonsForFlowChange(flowId);
  const personaButtonsUpdated = syncPersonaButtonsForFlowChange(flowId);
  if (charButtonsUpdated) {
    broadcast('characters_update', loadData(DATA_FILES.characters));
  }
  if (personaButtonsUpdated) {
    broadcast('personas_update', loadData(DATA_FILES.personas));
  }

  if (isPerFlowStorageActive()) {
    broadcast('flows_update', loadFlowsIndex());
  } else {
    broadcast('flows_update', loadData(DATA_FILES.flows));
  }

  res.json(updatedFlow);
});

app.delete('/api/flows/:id', (req, res) => {
  if (isPerFlowStorageActive()) {
    deleteFlowFile(req.params.id);
    broadcast('flows_update', loadFlowsIndex());
  } else {
    let flows = loadData(DATA_FILES.flows) || [];
    flows = flows.filter(f => f.id !== req.params.id);
    saveData(DATA_FILES.flows, flows);
    broadcast('flows_update', flows);
  }
  res.json({ success: true });
});

// ============================================
// Data Export/Import
// ============================================

const EXPORT_VERSION = '1.5';

// Export single character
app.get('/api/export/character/:id', (req, res) => {
  let character;
  if (isPerCharStorageActive()) {
    character = loadCharacter(req.params.id);
  } else {
    const characters = loadData(DATA_FILES.characters) || [];
    character = characters.find(c => c.id === req.params.id);
  }

  if (!character) {
    return res.status(404).json({ error: 'Character not found' });
  }

  const exportData = {
    type: 'swelldreams-character',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: character
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${character.name.replace(/[^a-z0-9]/gi, '_')}_character.json"`);
  res.json(exportData);
});

// Export single persona
app.get('/api/export/persona/:id', (req, res) => {
  const personas = loadData(DATA_FILES.personas) || [];
  const persona = personas.find(p => p.id === req.params.id);
  if (!persona) {
    return res.status(404).json({ error: 'Persona not found' });
  }

  const exportData = {
    type: 'swelldreams-persona',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: persona
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${persona.name.replace(/[^a-z0-9]/gi, '_')}_persona.json"`);
  res.json(exportData);
});

// Export single flow
app.get('/api/export/flow/:id', (req, res) => {
  let flow;
  if (isPerFlowStorageActive()) {
    flow = loadFlow(req.params.id);
  } else {
    const flows = loadData(DATA_FILES.flows) || [];
    flow = flows.find(f => f.id === req.params.id);
  }

  if (!flow) {
    return res.status(404).json({ error: 'Flow not found' });
  }

  const exportData = {
    type: 'swelldreams-flow',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: flow
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${flow.name.replace(/[^a-z0-9]/gi, '_')}_flow.json"`);
  res.json(exportData);
});

// Export full backup (all data, excluding sensitive API keys)
app.get('/api/export/backup', (req, res) => {
  const personas = loadData(DATA_FILES.personas) || [];
  const settings = loadData(DATA_FILES.settings) || {};

  // Load all characters (from per-char storage or legacy file)
  let characters;
  if (isPerCharStorageActive()) {
    characters = loadAllCharacters();
  } else {
    characters = loadData(DATA_FILES.characters) || [];
  }

  // Load all flows (from per-flow storage or legacy file)
  let flows;
  if (isPerFlowStorageActive()) {
    const index = loadFlowsIndex();
    flows = loadFlows(index.map(f => f.id));
  } else {
    flows = loadData(DATA_FILES.flows) || [];
  }

  // Remove sensitive data from settings export
  const safeSettings = { ...settings };
  delete safeSettings.openRouterApiKey;
  delete safeSettings.goveeApiKey;
  delete safeSettings.tuyaAccessId;
  delete safeSettings.tuyaAccessSecret;

  const exportData = {
    type: 'swelldreams-backup',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      characters,
      personas,
      flows,
      settings: safeSettings
    }
  };

  const filename = `swelldreams_backup_${new Date().toISOString().split('T')[0]}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(exportData);
});

// Import character
app.post('/api/import/character', (req, res) => {
  try {
    const importData = req.body;

    if (importData.type !== 'swelldreams-character') {
      return res.status(400).json({ error: 'Invalid import file type. Expected swelldreams-character.' });
    }

    const newCharacter = {
      ...importData.data,
      id: uuidv4(), // Generate new ID to avoid conflicts
      importedAt: Date.now(),
      updatedAt: Date.now()
    };

    if (isPerCharStorageActive()) {
      saveCharacter(newCharacter, true); // Import to custom
      const characters = loadAllCharacters();
      broadcast('characters_update', characters);
    } else {
      const characters = loadData(DATA_FILES.characters) || [];
      characters.push(newCharacter);
      saveData(DATA_FILES.characters, characters);
      broadcast('characters_update', characters);
    }

    res.json({ success: true, character: newCharacter });
  } catch (error) {
    console.error('[Import] Character import error:', error);
    res.status(400).json({ error: 'Failed to import character: ' + error.message });
  }
});

// Import persona
app.post('/api/import/persona', (req, res) => {
  try {
    const importData = req.body;

    if (importData.type !== 'swelldreams-persona') {
      return res.status(400).json({ error: 'Invalid import file type. Expected swelldreams-persona.' });
    }

    const personas = loadData(DATA_FILES.personas) || [];
    const newPersona = {
      ...importData.data,
      id: uuidv4(),
      importedAt: Date.now(),
      updatedAt: Date.now()
    };

    personas.push(newPersona);
    saveData(DATA_FILES.personas, personas);
    broadcast('personas_update', personas);

    res.json({ success: true, persona: newPersona });
  } catch (error) {
    console.error('[Import] Persona import error:', error);
    res.status(400).json({ error: 'Failed to import persona: ' + error.message });
  }
});

// Import flow
app.post('/api/import/flow', (req, res) => {
  try {
    const importData = req.body;

    if (importData.type !== 'swelldreams-flow') {
      return res.status(400).json({ error: 'Invalid import file type. Expected swelldreams-flow.' });
    }

    const newFlow = {
      ...importData.data,
      id: uuidv4(),
      importedAt: Date.now(),
      updatedAt: Date.now(),
      isActive: false // Imported flows start inactive
    };

    if (isPerFlowStorageActive()) {
      saveFlow(newFlow);
      broadcast('flows_update', loadFlowsIndex());
    } else {
      const flows = loadData(DATA_FILES.flows) || [];
      flows.push(newFlow);
      saveData(DATA_FILES.flows, flows);
      broadcast('flows_update', flows);
    }

    res.json({ success: true, flow: newFlow });
  } catch (error) {
    console.error('[Import] Flow import error:', error);
    res.status(400).json({ error: 'Failed to import flow: ' + error.message });
  }
});

// Import full backup
app.post('/api/import/backup', (req, res) => {
  try {
    const importData = req.body;

    if (importData.type !== 'swelldreams-backup') {
      return res.status(400).json({ error: 'Invalid import file type. Expected swelldreams-backup.' });
    }

    const results = {
      characters: 0,
      personas: 0,
      flows: 0,
      errors: []
    };

    // Import characters
    if (importData.data.characters && Array.isArray(importData.data.characters)) {
      if (isPerCharStorageActive()) {
        for (const char of importData.data.characters) {
          const newChar = {
            ...char,
            id: uuidv4(),
            importedAt: Date.now(),
            updatedAt: Date.now()
          };
          saveCharacter(newChar, true); // Import to custom
          results.characters++;
        }
        broadcast('characters_update', loadAllCharacters());
      } else {
        const characters = loadData(DATA_FILES.characters) || [];
        for (const char of importData.data.characters) {
          const newChar = {
            ...char,
            id: uuidv4(),
            importedAt: Date.now(),
            updatedAt: Date.now()
          };
          characters.push(newChar);
          results.characters++;
        }
        saveData(DATA_FILES.characters, characters);
        broadcast('characters_update', characters);
      }
    }

    // Import personas
    if (importData.data.personas && Array.isArray(importData.data.personas)) {
      const personas = loadData(DATA_FILES.personas) || [];
      for (const persona of importData.data.personas) {
        const newPersona = {
          ...persona,
          id: uuidv4(),
          importedAt: Date.now(),
          updatedAt: Date.now()
        };
        personas.push(newPersona);
        results.personas++;
      }
      saveData(DATA_FILES.personas, personas);
      broadcast('personas_update', personas);
    }

    // Import flows
    if (importData.data.flows && Array.isArray(importData.data.flows)) {
      if (isPerFlowStorageActive()) {
        for (const flow of importData.data.flows) {
          const newFlow = {
            ...flow,
            id: uuidv4(),
            importedAt: Date.now(),
            updatedAt: Date.now(),
            isActive: false
          };
          saveFlow(newFlow);
          results.flows++;
        }
        broadcast('flows_update', loadFlowsIndex());
      } else {
        const flows = loadData(DATA_FILES.flows) || [];
        for (const flow of importData.data.flows) {
          const newFlow = {
            ...flow,
            id: uuidv4(),
            importedAt: Date.now(),
            updatedAt: Date.now(),
            isActive: false
          };
          flows.push(newFlow);
          results.flows++;
        }
        saveData(DATA_FILES.flows, flows);
        broadcast('flows_update', flows);
      }
    }

    res.json({
      success: true,
      message: `Imported ${results.characters} characters, ${results.personas} personas, ${results.flows} flows`,
      results
    });
  } catch (error) {
    console.error('[Import] Backup import error:', error);
    res.status(400).json({ error: 'Failed to import backup: ' + error.message });
  }
});

// --- Session ---

app.get('/api/session', (req, res) => {
  res.json(sessionState);
});

app.post('/api/session/reset', async (req, res) => {
  // Get initial values from request body (if provided)
  const initialValues = req.body?.initialValues || {};

  // Load settings and character to get starting emotion
  const settings = loadData(DATA_FILES.settings);
  let startingEmotion = 'neutral';

  if (settings?.activeCharacterId) {
    const characters = loadData(DATA_FILES.characters) || [];
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    if (activeCharacter && activeCharacter.startingEmotion) {
      startingEmotion = activeCharacter.startingEmotion;
    }
  }

  // Stop all device cycles and turn off all devices
  console.log('[Session Reset] Stopping all devices...');
  const devices = loadData(DATA_FILES.devices) || [];
  for (const device of devices) {
    try {
      deviceService.stopCycle(device.ip);
      await deviceService.turnOff(device.ip);
      console.log(`[Session Reset] Stopped and turned off: ${device.name || device.ip}`);
    } catch (error) {
      console.error(`[Session Reset] Failed to stop device ${device.ip}:`, error.message);
    }
  }

  // Abort any pending LLM requests
  llmService.abortAllRequests();

  // Use initial values if provided, otherwise use defaults
  sessionState.capacity = initialValues.capacity ?? 0;
  sessionState.pain = initialValues.pain ?? 0;
  sessionState.emotion = initialValues.emotion ?? startingEmotion;
  sessionState.capacityModifier = initialValues.capacityModifier ?? 1.0;
  sessionState.chatHistory = [];
  sessionState.flowVariables = {};
  sessionState.flowAssignments = { personas: {}, characters: {}, global: [] };
  sessionState.executionHistory = {
    deliveredMessages: new Set(),
    deviceActions: {}
  };
  sessionState.pumpRuntimeTracker = {}; // Reset auto-capacity tracking

  console.log(`[Session Reset] Initial values - capacity: ${sessionState.capacity}, pain: ${sessionState.pain}, emotion: ${sessionState.emotion}, capacityModifier: ${sessionState.capacityModifier}`);

  // Reset welcome message lock and first message flag
  sendingWelcomeMessage = false;
  firstAiMessageFired = false;
  console.log('[Session Reset] Reset firstAiMessageFired to false');

  // Reset event engine state (clears "Only Once" conditions, flow states, etc.)
  eventEngine.cleanup();
  console.log('[Session Reset] Event engine cleanup complete');

  // Re-load flow assignments and re-activate flows
  loadFlowAssignments();
  activateAssignedFlows();

  broadcast('session_reset', sessionState);

  // Fire new_session triggers (for variable initialization etc.)
  await eventEngine.handleEvent('new_session', {});
  console.log('[Session Reset] new_session triggers fired');

  // Send welcome message if character is active
  if (settings?.activeCharacterId) {
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    if (activeCharacter) {
      await sendWelcomeMessage(activeCharacter, settings);
    }
  }

  res.json(sessionState);
});

// --- Saved Sessions ---

app.post('/api/sessions/save', (req, res) => {
  const { name, personaId, characterId } = req.body;
  const sessions = loadData(DATA_FILES.sessions) || [];

  const newSession = {
    id: uuidv4(),
    name: name || `Session-${Date.now()}`,
    personaId,
    characterId,
    capacity: sessionState.capacity,
    pain: sessionState.pain,
    emotion: sessionState.emotion,
    chatHistory: sessionState.chatHistory,
    flowVariables: sessionState.flowVariables,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  sessions.push(newSession);
  saveData(DATA_FILES.sessions, sessions);
  res.json(newSession);
});

app.get('/api/sessions/list', (req, res) => {
  const { personaId, characterId } = req.query;
  let sessions = loadData(DATA_FILES.sessions) || [];

  // Filter by persona and character if provided
  if (personaId && characterId) {
    sessions = sessions.filter(s => s.personaId === personaId && s.characterId === characterId);
  }

  // Sort by createdAt descending (newest first)
  sessions.sort((a, b) => b.createdAt - a.createdAt);

  res.json(sessions);
});

app.get('/api/sessions/:id', (req, res) => {
  const sessions = loadData(DATA_FILES.sessions) || [];
  const session = sessions.find(s => s.id === req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json(session);
});

app.post('/api/sessions/:id/load', (req, res) => {
  const sessions = loadData(DATA_FILES.sessions) || [];
  const session = sessions.find(s => s.id === req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Load session state
  sessionState.capacity = session.capacity || 0;
  // Support both new 'pain' and legacy 'sensation' values
  if (typeof session.pain === 'number') {
    sessionState.pain = session.pain;
  } else if (session.sensation) {
    // Migrate old sensation strings to pain numbers
    const sensationToPain = {
      'normal': 0, 'slightly tight': 2, 'comfortably full': 3,
      'stretched': 5, 'very tight': 7, 'painfully tight': 9
    };
    sessionState.pain = sensationToPain[session.sensation] ?? 0;
  } else {
    sessionState.pain = 0;
  }
  sessionState.emotion = session.emotion || 'neutral';
  sessionState.chatHistory = session.chatHistory || [];
  sessionState.flowVariables = session.flowVariables || {};
  sessionState.flowAssignments = session.flowAssignments || { personas: {}, characters: {}, global: [] };
  sessionState.pumpRuntimeTracker = session.pumpRuntimeTracker || {}; // Restore auto-capacity tracking if saved

  // Broadcast the loaded state
  broadcast('session_loaded', sessionState);

  res.json(sessionState);
});

app.delete('/api/sessions/:id', (req, res) => {
  let sessions = loadData(DATA_FILES.sessions) || [];
  sessions = sessions.filter(s => s.id !== req.params.id);
  saveData(DATA_FILES.sessions, sessions);
  res.json({ success: true });
});

// --- Health Check ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Serve frontend static files from React build
const FRONTEND_BUILD_PATH = path.join(__dirname, '../frontend/build');
if (fs.existsSync(FRONTEND_BUILD_PATH)) {
  app.use(express.static(FRONTEND_BUILD_PATH));

  // SPA fallback - serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    // Don't catch API routes - let them fall through to 404 handler
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.join(FRONTEND_BUILD_PATH, 'index.html'));
  });

  log.always('Serving frontend from: ' + FRONTEND_BUILD_PATH);
} else {
  log.always('Frontend build not found - run "npm run build" in frontend folder');
}

// Global 404 handler (for API routes only now)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log full error details to backend console
  console.error('\n[Express Error]', {
    message: err.message,
    path: req.path,
    method: req.method,
    stack: err.stack
  });

  // Broadcast to frontend dev console via WebSocket
  broadcast('server_error', {
    message: err.message,
    path: req.path,
    method: req.method,
    stack: err.stack,
    timestamp: Date.now()
  });

  // Handle operational errors (our custom errors)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'VALIDATION_ERROR'
    });
  }

  // Handle JSON parsing errors
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      code: 'PARSE_ERROR'
    });
  }

  // Unknown errors - don't leak details
  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR'
  });
});

// Start server
const PORT = process.env.PORT || 8889;
server.listen(PORT, () => {
  log.always(`SwellDreams server running on http://localhost:${PORT}`);
});

// ============================================
// Emergency Stop Failsafes
// ============================================

// Track if emergency stop has already been triggered (prevent duplicate calls)
let emergencyStopTriggered = false;

/**
 * Trigger emergency stop for all devices, flows, and LLM.
 * Called on uncaught exceptions, unhandled rejections, and shutdown signals.
 */
async function triggerEmergencyStop(reason) {
  if (emergencyStopTriggered) {
    console.log('[FAILSAFE] Emergency stop already triggered, skipping...');
    return;
  }
  emergencyStopTriggered = true;

  console.error(`\n[FAILSAFE] ========================================`);
  console.error(`[FAILSAFE] EMERGENCY STOP TRIGGERED`);
  console.error(`[FAILSAFE] Reason: ${reason}`);
  console.error(`[FAILSAFE] ========================================\n`);

  try {
    // 1. Stop all device cycles and turn off devices
    const devices = loadData(DATA_FILES.devices) || [];
    for (const device of devices) {
      try {
        // Get correct identifier - Tuya/Govee use deviceId, TPLink uses ip
        const deviceIdentifier = (device.brand === 'tuya' || device.brand === 'govee' || device.brand === 'wyze')
          ? device.deviceId
          : device.ip;
        if (deviceIdentifier) {
          deviceService.stopCycle(deviceIdentifier);
          await deviceService.turnOff(deviceIdentifier, device);
          console.log(`[FAILSAFE] Stopped device: ${device.name || device.label || deviceIdentifier}`);
        }
      } catch (err) {
        console.error(`[FAILSAFE] Failed to stop device ${device.name || device.ip}:`, err.message);
      }
    }

    // 2. Stop all flows
    if (eventEngine) {
      eventEngine.emergencyStop();
      console.log('[FAILSAFE] Flows halted');
    }

    // 3. Abort all LLM requests
    llmService.abortAllRequests();
    console.log('[FAILSAFE] LLM requests aborted');

    // 4. Kill any lingering Python processes
    killAllPythonProcesses();
    console.log('[FAILSAFE] Python processes terminated');

    // 5. Notify connected clients
    broadcast('emergency_stop', {
      timestamp: Date.now(),
      reason,
      automatic: true
    });
    console.log('[FAILSAFE] Clients notified');

    // 6. Close WebSocket connections gracefully
    for (const client of wsClients) {
      try {
        client.close(1001, 'Server shutting down');
      } catch (e) {
        // Ignore errors closing clients
      }
    }
    wsClients.clear();
    console.log('[FAILSAFE] WebSocket connections closed');

  } catch (err) {
    console.error('[FAILSAFE] Error during emergency stop:', err.message);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('[FAILSAFE] Uncaught Exception:', error);
  await triggerEmergencyStop(`Uncaught Exception: ${error.message}`);

  // Give time for devices to stop, then exit
  setTimeout(() => {
    console.log('[FAILSAFE] Exiting process after uncaught exception');
    process.exit(1);
  }, 2000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error('[FAILSAFE] Unhandled Promise Rejection:', reason);
  await triggerEmergencyStop(`Unhandled Rejection: ${reason}`);

  // Give time for devices to stop, then exit
  setTimeout(() => {
    console.log('[FAILSAFE] Exiting process after unhandled rejection');
    process.exit(1);
  }, 2000);
});

// Handle SIGTERM (docker stop, systemd stop, etc.)
process.on('SIGTERM', async () => {
  console.log('[FAILSAFE] Received SIGTERM signal');
  await triggerEmergencyStop('SIGTERM signal received');

  setTimeout(() => {
    console.log('[FAILSAFE] Graceful shutdown complete');
    process.exit(0);
  }, 2000);
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('[FAILSAFE] Received SIGINT signal (Ctrl+C)');
  await triggerEmergencyStop('SIGINT signal received (Ctrl+C)');

  setTimeout(() => {
    console.log('[FAILSAFE] Graceful shutdown complete');
    process.exit(0);
  }, 2000);
});

// Handle server errors
server.on('error', async (error) => {
  console.error('[FAILSAFE] Server error:', error);
  await triggerEmergencyStop(`Server Error: ${error.message}`);
});

// Handle WebSocket server errors
wss.on('error', async (error) => {
  console.error('[FAILSAFE] WebSocket server error:', error);
  await triggerEmergencyStop(`WebSocket Error: ${error.message}`);
});
