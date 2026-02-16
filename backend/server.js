/**
 * SwellDreams Backend Server
 * Express + WebSocket server for single-player inflation roleplay
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Services
const llmService = require('./services/llm-service');
const { DeviceService, killAllPythonProcesses, activeProcesses } = require('./services/device-service');
const EventEngine = require('./services/event-engine');
const reminderEngine = require('./services/reminder-engine');
const characterConverter = require('./services/character-converter');
const characterExporter = require('./services/character-exporter');
const goveeService = require('./services/govee-service');
const tuyaService = require('./services/tuya-service');
const wyzeService = require('./services/wyze-service');
const tapoService = require('./services/tapo-service');
const matterService = require('./services/matter-service');
const aiDeviceControl = require('./services/ai-device-control');
const imageStorage = require('./services/image-storage');
const mediaStorage = require('./services/media-storage');

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

// Emotion adjacency map for story progression suggestions
const EMOTION_ADJACENCY = {
  neutral:      ['curious', 'questioning', 'shy', 'anxious'],
  happy:        ['excited', 'loving', 'curious'],
  excited:      ['happy', 'aroused', 'curious'],
  aroused:      ['horny', 'shy', 'dominant', 'submissive'],
  horny:        ['aroused', 'dominant', 'blissful'],
  loving:       ['happy', 'shy', 'blissful'],
  submissive:   ['shy', 'fearful', 'embarrassed', 'aroused'],
  dominant:     ['angry', 'aroused', 'excited'],
  shy:          ['embarrassed', 'fearful', 'submissive', 'curious'],
  embarrassed:  ['shy', 'anxious', 'angry'],
  confused:     ['questioning', 'curious', 'anxious', 'neutral'],
  curious:      ['questioning', 'excited', 'confused', 'happy'],
  frightened:   ['fearful', 'anxious', 'angry', 'submissive'],
  anxious:      ['fearful', 'frightened', 'shy', 'questioning'],
  sad:          ['exhausted', 'anxious', 'angry'],
  angry:        ['dominant', 'sad', 'anxious'],
  drunk:        ['happy', 'aroused', 'dazed'],
  dazed:        ['confused', 'questioning', 'drunk', 'exhausted'],
  exhausted:    ['dazed', 'sad', 'neutral'],
  blissful:     ['aroused', 'loving', 'happy'],
  fearful:      ['frightened', 'anxious', 'submissive', 'questioning'],
  questioning:  ['curious', 'confused', 'anxious', 'neutral']
};

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
app.use(express.json({ limit: '50mb' }));

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
  // Skip rate limiting for images - static files
  if (req.path.startsWith('/images/')) {
    return next();
  }
  // Skip rate limiting for media uploads/downloads - large files
  if (req.path.startsWith('/media/')) {
    return next();
  }
  generalLimiter(req, res, next);
});

// Serve images from data directories
// URL format: /api/images/{personas|chars|actors}/{default|custom}/{id}/{filename}
app.get('/api/images/:type/:folder/:id/:filename', (req, res) => {
  const { type, folder, id, filename } = req.params;

  // Validate folder
  if (folder !== 'default' && folder !== 'custom') {
    return res.status(400).send('Invalid folder');
  }

  // Validate type
  if (type !== 'personas' && type !== 'chars' && type !== 'actors') {
    return res.status(400).send('Invalid type');
  }

  // For actors, serve from screenplay/actors directory
  if (type === 'actors') {
    const actorImgPath = path.join(__dirname, 'data', 'screenplay', 'actors', folder, id, 'img', filename);
    if (fs.existsSync(actorImgPath)) {
      return res.sendFile(actorImgPath);
    } else {
      return res.status(404).send('Image not found');
    }
  }

  // Get the file path using the image storage service
  const imageStorage = require('./services/image-storage');
  const filePath = imageStorage.getImageFilePath(type, folder, id, filename);

  if (!filePath) {
    return res.status(404).send('Not found');
  }

  // Check file exists and send it
  const fsSync = require('fs');
  if (fsSync.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Image not found');
  }
});

// ==================== MEDIA ALBUM API ====================

// Initialize media directories on startup
mediaStorage.initMediaDirectories().catch(err => {
  console.error('Failed to initialize media directories:', err);
});

// Configure multer for video/audio uploads (memory storage for processing)
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: mediaStorage.VIDEO_SIZE_LIMIT // Use the larger limit (500MB)
  }
});

// Configure multer for character card imports (JSON/PNG)
const cardUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max for character cards
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/json', 'image/png', 'image/jpeg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JSON and PNG files are allowed.'));
    }
  }
});

// --- Media Images ---
app.get('/api/media/images', async (req, res) => {
  try {
    const images = await mediaStorage.loadImagesIndex();
    res.json(images);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/media/images', async (req, res) => {
  try {
    const { imageData, orientation, tag, description, folder } = req.body;
    if (!imageData || !orientation || !tag || !description) {
      return res.status(400).json({ error: 'Missing required fields: imageData, orientation, tag, description' });
    }
    const image = await mediaStorage.saveMediaImage(imageData, orientation, tag, description, folder);
    res.json(image);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/media/images/:id', async (req, res) => {
  try {
    const { tag, description, folder } = req.body;
    if (!tag || !description) {
      return res.status(400).json({ error: 'Missing required fields: tag, description' });
    }
    const image = await mediaStorage.updateMediaImage(req.params.id, tag, description, folder);
    res.json(image);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/media/images/:id', async (req, res) => {
  try {
    await mediaStorage.deleteMediaImage(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/media/images/:id/file', async (req, res) => {
  try {
    const image = await mediaStorage.getMediaImage(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const filePath = mediaStorage.getMediaImageFilePath(image.filename);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Image folders
app.get('/api/media/images/folders', async (req, res) => {
  try {
    const folders = await mediaStorage.getImageFolders();
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/media/images/folders', async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Missing folder path' });
    }
    const folder = await mediaStorage.createImageFolder(folderPath);
    res.json({ path: folder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/media/images/folders', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Missing oldPath or newPath' });
    }
    const folder = await mediaStorage.renameImageFolder(oldPath, newPath);
    res.json({ path: folder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/media/images/folders/:path', async (req, res) => {
  try {
    const folderPath = decodeURIComponent(req.params.path);
    await mediaStorage.deleteImageFolder(folderPath);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- Media Videos ---
app.get('/api/media/videos', async (req, res) => {
  try {
    const videos = await mediaStorage.loadVideosIndex();
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/media/videos', mediaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }
    const { tag, description, folder } = req.body;
    if (!tag || !description) {
      return res.status(400).json({ error: 'Missing required fields: tag, description' });
    }
    const video = await mediaStorage.saveMediaVideo(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      tag,
      description,
      folder
    );
    res.json(video);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/media/videos/:id', async (req, res) => {
  try {
    const { tag, description, folder } = req.body;
    if (!tag || !description) {
      return res.status(400).json({ error: 'Missing required fields: tag, description' });
    }
    const video = await mediaStorage.updateMediaVideo(req.params.id, tag, description, folder);
    res.json(video);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/media/videos/:id', async (req, res) => {
  try {
    await mediaStorage.deleteMediaVideo(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/media/videos/:id/file', async (req, res) => {
  try {
    const video = await mediaStorage.getMediaVideo(req.params.id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const filePath = mediaStorage.getMediaVideoFilePath(video.filename);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Video folders
app.get('/api/media/videos/folders', async (req, res) => {
  try {
    const folders = await mediaStorage.getVideoFolders();
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/media/videos/folders', async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Missing folder path' });
    }
    const folder = await mediaStorage.createVideoFolder(folderPath);
    res.json({ path: folder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/media/videos/folders', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Missing oldPath or newPath' });
    }
    const folder = await mediaStorage.renameVideoFolder(oldPath, newPath);
    res.json({ path: folder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/media/videos/folders/:path', async (req, res) => {
  try {
    const folderPath = decodeURIComponent(req.params.path);
    await mediaStorage.deleteVideoFolder(folderPath);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- Media Audio ---
app.get('/api/media/audios', async (req, res) => {
  try {
    const audio = await mediaStorage.loadAudioIndex();
    res.json(audio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/media/audios', mediaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }
    const { tag, description, folder } = req.body;
    if (!tag || !description) {
      return res.status(400).json({ error: 'Missing required fields: tag, description' });
    }
    const audio = await mediaStorage.saveMediaAudio(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      tag,
      description,
      folder || null
    );
    res.json(audio);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/media/audios/:id', async (req, res) => {
  try {
    const { tag, description, folder } = req.body;
    if (!tag || !description) {
      return res.status(400).json({ error: 'Missing required fields: tag, description' });
    }
    const audio = await mediaStorage.updateMediaAudio(req.params.id, tag, description, folder);
    res.json(audio);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/media/audios/:id', async (req, res) => {
  try {
    await mediaStorage.deleteMediaAudio(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/media/audios/:id/file', async (req, res) => {
  try {
    const audio = await mediaStorage.getMediaAudio(req.params.id);
    if (!audio) {
      return res.status(404).json({ error: 'Audio not found' });
    }
    const filePath = mediaStorage.getMediaAudioFilePath(audio.filename);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Audio folders
app.get('/api/media/audios/folders', async (req, res) => {
  try {
    const folders = await mediaStorage.getAudioFolders();
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/media/audios/folders', async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Missing folder path' });
    }
    const folder = await mediaStorage.createAudioFolder(folderPath);
    res.json({ path: folder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/media/audios/folders', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Missing oldPath or newPath' });
    }
    const folder = await mediaStorage.renameAudioFolder(oldPath, newPath);
    res.json({ path: folder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/media/audios/folders/:path', async (req, res) => {
  try {
    const folderPath = decodeURIComponent(req.params.path);
    await mediaStorage.deleteAudioFolder(folderPath);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Media tag lookup - resolve tag to media metadata
app.get('/api/media/lookup', async (req, res) => {
  const { type, tag } = req.query;

  if (!type || !tag) {
    return res.status(400).json({ error: 'type and tag query parameters are required' });
  }

  try {
    let index, item;

    switch (type) {
      case 'image':
        index = await mediaStorage.loadImagesIndex();
        item = index.find(i => i.tag === tag);
        break;
      case 'video':
        index = await mediaStorage.loadVideosIndex();
        item = index.find(v => v.tag === tag);
        break;
      case 'audio':
        index = await mediaStorage.loadAudioIndex();
        item = index.find(a => a.tag === tag);
        break;
      default:
        return res.status(400).json({ error: 'Invalid type. Must be image, video, or audio' });
    }

    if (!item) {
      return res.status(404).json({ error: `${type} with tag "${tag}" not found` });
    }

    res.json({
      id: item.id,
      tag: item.tag,
      description: item.description,
      orientation: item.orientation || null,
      type: type,
      fileUrl: `/api/media/${type}s/${item.id}/file`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== END MEDIA ALBUM API ====================

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

/**
 * Check if a message contains the wrong speaker in the first sentence
 * @param {string} content - Message content
 * @param {string} expectedSpeaker - 'character' or 'player'
 * @param {string} characterName - Name of the active character
 * @param {string} personaName - Name of the active persona/player
 * @returns {{valid: boolean, reason: string|null}} - Validation result
 */
function validateSpeaker(content, expectedSpeaker, characterName, personaName) {
  if (!content) return { valid: true, reason: null };

  // Extract first sentence (up to first . ! or ?)
  const firstSentence = content.split(/[.!?]/)[0].trim();
  if (!firstSentence) return { valid: true, reason: null };

  // Common patterns for wrong speaker
  const characterSpeakingPatterns = [
    new RegExp(`^${characterName}\\s*:`, 'i'),
    new RegExp(`^"\\s*${characterName}\\s*:`, 'i'),
    new RegExp(`^${characterName}\\s+says?\\b`, 'i'),
    new RegExp(`^${characterName}\\s+speaks?\\b`, 'i')
  ];

  const playerSpeakingPatterns = [
    new RegExp(`^${personaName}\\s*:`, 'i'),
    new RegExp(`^"\\s*${personaName}\\s*:`, 'i'),
    new RegExp(`^${personaName}\\s+says?\\b`, 'i'),
    new RegExp(`^${personaName}\\s+speaks?\\b`, 'i'),
    /^You\s*:/i,
    /^Player\s*:/i,
    /^"?\s*You\s+say\b/i,
    /^You\s+speak\b/i
  ];

  if (expectedSpeaker === 'character') {
    // AI should speak as character, not player
    for (const pattern of playerSpeakingPatterns) {
      if (pattern.test(firstSentence)) {
        return { valid: false, reason: `AI incorrectly spoke as player: "${firstSentence}"` };
      }
    }
  } else if (expectedSpeaker === 'player') {
    // Player should speak as themselves, not character
    for (const pattern of characterSpeakingPatterns) {
      if (pattern.test(firstSentence)) {
        return { valid: false, reason: `Player incorrectly spoke as character: "${firstSentence}"` };
      }
    }
  }

  return { valid: true, reason: null };
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

/**
 * Get the effective pop threshold for pump shutoff based on auto-pop settings.
 * @param {Object} settings - The settings object
 * @returns {number} The capacity threshold at which to trigger pump shutoff
 */
function getEffectivePopThreshold(settings) {
  const globalControls = settings?.globalCharacterControls || {};

  // If over-inflation is disabled, pop at 100%
  if (!globalControls.allowOverInflation) {
    return 100;
  }

  // If auto-pop roleplay is disabled, no auto-pop (return Infinity - never trigger)
  if (!globalControls.enableAutoPopRoleplay) {
    return Infinity;
  }

  // Fixed mode - use configured percentage
  if (globalControls.autoPopMode === 'fixed') {
    return globalControls.autoPopFixedPercent || 110;
  }

  // Random mode - generate and store threshold in sessionState
  if (globalControls.autoPopMode === 'random') {
    if (sessionState.randomPopThreshold === undefined) {
      const min = globalControls.autoPopRandomMin || 100;
      const max = globalControls.autoPopRandomMax || 150;
      sessionState.randomPopThreshold = Math.floor(Math.random() * (max - min + 1)) + min;
      console.log(`[AutoPop] Generated random pop threshold: ${sessionState.randomPopThreshold}%`);
    }
    return sessionState.randomPopThreshold;
  }

  return Infinity; // Default - no auto-pop
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

// Rebuild flows index from actual files on disk
// Called on startup if index is missing or empty
function rebuildFlowsIndex() {
  console.log('[Server] Rebuilding flows index from disk...');
  const index = [];

  if (fs.existsSync(FLOWS_DIR)) {
    const files = fs.readdirSync(FLOWS_DIR);
    for (const file of files) {
      // Skip the index file itself
      if (file === 'flows-index.json') continue;
      if (!file.endsWith('.json')) continue;

      const flowPath = path.join(FLOWS_DIR, file);
      try {
        const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
        index.push({
          id: flow.id,
          name: flow.name || 'Untitled Flow',
          characterId: flow.characterId || null,
          description: flow.description || ''
        });
        console.log(`[Server]   Found flow: ${flow.name || flow.id}`);
      } catch (e) {
        console.error(`[Server]   Error reading ${flowPath}:`, e.message);
      }
    }
  }

  saveFlowsIndex(index);
  console.log(`[Server] Rebuilt flows index: ${index.length} flows found`);
  return index;
}

// Ensure flows index exists, is populated, and matches what's on disk
function ensureFlowsIndex() {
  const index = loadFlowsIndex();
  if (index.length === 0) {
    return rebuildFlowsIndex();
  }

  // Validate that all indexed flows actually exist on disk
  // This prevents stale index entries from hiding missing files
  for (const entry of index) {
    if (loadFlow(entry.id) === null) {
      console.log(`[Server] Flow '${entry.name}' (${entry.id}) in index but not on disk - rebuilding index`);
      return rebuildFlowsIndex();
    }
  }

  // Check for new flow files on disk that aren't in the index yet
  // (e.g. flows added via git pull or manual file copy)
  if (fs.existsSync(FLOWS_DIR)) {
    const indexedIds = new Set(index.map(f => f.id));
    const files = fs.readdirSync(FLOWS_DIR).filter(f => f.endsWith('.json') && f !== 'flows-index.json');
    for (const file of files) {
      const flowId = file.replace('.json', '');
      if (!indexedIds.has(flowId)) {
        console.log(`[Server] Flow file '${file}' on disk but not in index - rebuilding index`);
        return rebuildFlowsIndex();
      }
    }
  }

  return index;
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
// Supports both old format ({id}.json) and new folder format ({id}/char.json)
function loadCharacter(charId) {
  // Check new folder format first (custom, then default)
  const customFolderPath = path.join(CHARS_CUSTOM_DIR, charId, 'char.json');
  const defaultFolderPath = path.join(CHARS_DEFAULT_DIR, charId, 'char.json');
  // Check old flat format
  const customPath = path.join(CHARS_CUSTOM_DIR, `${charId}.json`);
  const defaultPath = path.join(CHARS_DEFAULT_DIR, `${charId}.json`);

  for (const charPath of [customFolderPath, defaultFolderPath, customPath, defaultPath]) {
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

// Save single character to its own folder + update index
// New characters go to custom/, existing stay in their location
// Uses new folder structure: chars/{custom|default}/{id}/char.json + img/
async function saveCharacterAsync(char, forceCustom = false) {
  // Determine if this is a default or custom character
  let isDefault = false;
  const customFolderPath = path.join(CHARS_CUSTOM_DIR, char.id, 'char.json');
  const defaultFolderPath = path.join(CHARS_DEFAULT_DIR, char.id, 'char.json');
  const oldCustomPath = path.join(CHARS_CUSTOM_DIR, `${char.id}.json`);
  const oldDefaultPath = path.join(CHARS_DEFAULT_DIR, `${char.id}.json`);

  if (forceCustom) {
    isDefault = false;
  } else if (fs.existsSync(defaultFolderPath) || fs.existsSync(oldDefaultPath)) {
    isDefault = true;
  }

  // Process any base64 images and save them to disk
  const processedChar = await imageStorage.processCharacterImages(char, isDefault);

  // Save to new folder structure
  await imageStorage.saveCharacterJson(processedChar, isDefault);
  updateCharIndex(processedChar, isDefault ? 'default' : 'custom');

  // Clean up old flat file if it exists
  if (fs.existsSync(oldCustomPath)) {
    try { fs.unlinkSync(oldCustomPath); } catch (e) {}
  }

  return processedChar;
}

// Sync wrapper for backwards compatibility
function saveCharacter(char, forceCustom = false) {
  // For sync calls, just save without async image processing
  // This is used during migration - images will be processed on next save
  const isDefault = !forceCustom && (
    fs.existsSync(path.join(CHARS_DEFAULT_DIR, char.id, 'char.json')) ||
    fs.existsSync(path.join(CHARS_DEFAULT_DIR, `${char.id}.json`))
  );

  const charDir = path.join(isDefault ? CHARS_DEFAULT_DIR : CHARS_CUSTOM_DIR, char.id);
  if (!fs.existsSync(charDir)) {
    fs.mkdirSync(charDir, { recursive: true });
  }

  const targetPath = path.join(charDir, 'char.json');
  fs.writeFileSync(targetPath, JSON.stringify(char, null, 2));
  updateCharIndex(char, isDefault ? 'default' : 'custom');
}

// Delete character file + remove from index
function deleteCharacterFile(charId) {
  // Delete new folder structure
  const customFolderPath = path.join(CHARS_CUSTOM_DIR, charId);
  const defaultFolderPath = path.join(CHARS_DEFAULT_DIR, charId);
  // Delete old flat files
  const customPath = path.join(CHARS_CUSTOM_DIR, `${charId}.json`);
  const defaultPath = path.join(CHARS_DEFAULT_DIR, `${charId}.json`);

  // Delete folder if exists
  if (fs.existsSync(customFolderPath)) {
    fs.rmSync(customFolderPath, { recursive: true, force: true });
  }
  if (fs.existsSync(defaultFolderPath)) {
    fs.rmSync(defaultFolderPath, { recursive: true, force: true });
  }
  // Delete old flat files if exist
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

// Rebuild chars index from actual files on disk
// Called on startup if index is missing or empty
function rebuildCharsIndex() {
  console.log('[Server] Rebuilding characters index from disk...');
  const index = [];

  // Scan default characters
  if (fs.existsSync(CHARS_DEFAULT_DIR)) {
    const defaultDirs = fs.readdirSync(CHARS_DEFAULT_DIR);
    for (const dirName of defaultDirs) {
      const charPath = path.join(CHARS_DEFAULT_DIR, dirName, 'char.json');
      if (fs.existsSync(charPath)) {
        try {
          const char = JSON.parse(fs.readFileSync(charPath, 'utf8'));
          index.push({
            id: char.id || dirName,
            name: char.name || dirName,
            category: 'default',
            description: (char.description || '').substring(0, 100) + '...'
          });
          console.log(`[Server]   Found default character: ${char.name || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${charPath}:`, e.message);
        }
      }
    }
  }

  // Scan custom characters — use folder name as ID (loadCharacter resolves by folder)
  if (fs.existsSync(CHARS_CUSTOM_DIR)) {
    const customDirs = fs.readdirSync(CHARS_CUSTOM_DIR);
    for (const dirName of customDirs) {
      const charPath = path.join(CHARS_CUSTOM_DIR, dirName, 'char.json');
      if (fs.existsSync(charPath)) {
        try {
          const char = JSON.parse(fs.readFileSync(charPath, 'utf8'));
          // Fix mismatched IDs: if char.id doesn't match folder name, update it
          if (char.id && char.id !== dirName) {
            console.log(`[Server]   Fixing ID mismatch for '${char.name}': ${char.id} -> ${dirName}`);
            char.id = dirName;
            fs.writeFileSync(charPath, JSON.stringify(char, null, 2));
          }
          index.push({
            id: dirName,
            name: char.name || dirName,
            category: 'custom',
            description: (char.description || '').substring(0, 100) + '...'
          });
          console.log(`[Server]   Found custom character: ${char.name || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${charPath}:`, e.message);
        }
      }
    }
  }

  saveCharsIndex(index);
  console.log(`[Server] Rebuilt characters index: ${index.length} characters found`);
  return index;
}

// Ensure chars index exists, is populated, and all indexed characters exist on disk
function ensureCharsIndex() {
  const index = loadCharsIndex();
  if (index.length === 0) {
    return rebuildCharsIndex();
  }

  // Validate that all indexed characters actually exist on disk
  // This prevents stale index entries from hiding missing files
  for (const entry of index) {
    if (loadCharacter(entry.id) === null) {
      console.log(`[Server] Character '${entry.name}' (${entry.id}) in index but not on disk - rebuilding index`);
      return rebuildCharsIndex();
    }
  }

  // Check for new characters not yet in the index (e.g. added via git pull or manual copy)
  const indexedIds = new Set(index.map(c => c.id));
  for (const dir of [CHARS_DEFAULT_DIR, CHARS_CUSTOM_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const dirName of fs.readdirSync(dir)) {
      const charPath = path.join(dir, dirName, 'char.json');
      if (fs.existsSync(charPath)) {
        try {
          const char = JSON.parse(fs.readFileSync(charPath, 'utf8'));
          const charId = char.id || dirName;
          if (!indexedIds.has(charId)) {
            console.log(`[Server] New character '${char.name || dirName}' found on disk - rebuilding index`);
            return rebuildCharsIndex();
          }
        } catch (e) { /* skip unreadable */ }
      }
    }
  }

  return index;
}

// ============================================
// Per-Persona File Storage Helpers
// ============================================

const PERSONAS_DIR = path.join(DATA_DIR, 'personas');
const PERSONAS_DEFAULT_DIR = path.join(PERSONAS_DIR, 'default');
const PERSONAS_CUSTOM_DIR = path.join(PERSONAS_DIR, 'custom');

// Load personas index
function loadPersonasIndex() {
  const indexPath = path.join(PERSONAS_DIR, 'personas-index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      console.error('Error loading personas index:', e);
    }
  }
  return [];
}

// Save personas index
function savePersonasIndex(index) {
  if (!fs.existsSync(PERSONAS_DIR)) {
    fs.mkdirSync(PERSONAS_DIR, { recursive: true });
  }
  const indexPath = path.join(PERSONAS_DIR, 'personas-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Load single persona by ID (checks folder structure, then old format)
function loadPersona(personaId) {
  // Check new folder format (custom, then default)
  const customFolderPath = path.join(PERSONAS_CUSTOM_DIR, personaId, 'persona.json');
  const defaultFolderPath = path.join(PERSONAS_DEFAULT_DIR, personaId, 'persona.json');

  for (const personaPath of [customFolderPath, defaultFolderPath]) {
    if (fs.existsSync(personaPath)) {
      try {
        return JSON.parse(fs.readFileSync(personaPath, 'utf8'));
      } catch (e) {
        console.error(`Error loading persona ${personaId}:`, e);
      }
    }
  }

  // Fall back to old personas.json array format
  const personas = loadAllPersonas() || [];
  return personas.find(p => p.id === personaId) || null;
}

// Save single persona to its own folder + update index
async function savePersonaAsync(persona, forceCustom = false) {
  // Determine if this is a default or custom persona
  let isDefault = false;
  const defaultFolderPath = path.join(PERSONAS_DEFAULT_DIR, persona.id, 'persona.json');

  if (!forceCustom && fs.existsSync(defaultFolderPath)) {
    isDefault = true;
  }

  // Process any base64 images and save them to disk
  const processedPersona = await imageStorage.processPersonaImages(persona, isDefault);

  // Save to new folder structure
  await imageStorage.savePersonaJson(processedPersona, isDefault);
  updatePersonaIndex(processedPersona, isDefault ? 'default' : 'custom');

  return processedPersona;
}

// Delete persona folder + remove from index
function deletePersonaFolder(personaId) {
  const customFolderPath = path.join(PERSONAS_CUSTOM_DIR, personaId);
  const defaultFolderPath = path.join(PERSONAS_DEFAULT_DIR, personaId);

  // Delete folder if exists
  if (fs.existsSync(customFolderPath)) {
    fs.rmSync(customFolderPath, { recursive: true, force: true });
  }
  if (fs.existsSync(defaultFolderPath)) {
    fs.rmSync(defaultFolderPath, { recursive: true, force: true });
  }
  removeFromPersonaIndex(personaId);
}

// Update/add entry in personas index
function updatePersonaIndex(persona, category = 'custom') {
  const index = loadPersonasIndex();
  const existing = index.findIndex(p => p.id === persona.id);
  const entry = {
    id: persona.id,
    displayName: persona.displayName || 'Unnamed Persona',
    category: category
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  savePersonasIndex(index);
}

// Remove entry from personas index
function removeFromPersonaIndex(personaId) {
  const index = loadPersonasIndex();
  const filtered = index.filter(p => p.id !== personaId);
  savePersonasIndex(filtered);
}

// Load all personas (from both folder structure and old format)
function loadAllPersonas() {
  const personas = [];
  const seenIds = new Set();

  // Load from new folder structure
  for (const [dir, isDefault] of [[PERSONAS_DEFAULT_DIR, true], [PERSONAS_CUSTOM_DIR, false]]) {
    if (fs.existsSync(dir)) {
      try {
        const personaIds = fs.readdirSync(dir);
        for (const id of personaIds) {
          const personaPath = path.join(dir, id, 'persona.json');
          if (fs.existsSync(personaPath)) {
            try {
              const persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
              persona._isDefault = isDefault;
              personas.push(persona);
              seenIds.add(persona.id);
            } catch (e) {
              console.error(`Error loading persona ${id}:`, e);
            }
          }
        }
      } catch (e) {
        // Directory may not exist
      }
    }
  }

  // Also load from old personas.json if it exists (for migration)
  const oldPersonas = loadData(DATA_FILES.personas) || [];
  for (const persona of oldPersonas) {
    if (!seenIds.has(persona.id)) {
      persona._isDefault = false;
      personas.push(persona);
    }
  }

  return personas;
}

// Check if per-persona folder storage is active
function isPerPersonaStorageActive() {
  return fs.existsSync(path.join(PERSONAS_DIR, 'personas-index.json'));
}

// Rebuild personas index from actual files on disk
function rebuildPersonasIndex() {
  console.log('[Server] Rebuilding personas index from disk...');
  const index = [];

  // Scan default personas
  if (fs.existsSync(PERSONAS_DEFAULT_DIR)) {
    const defaultDirs = fs.readdirSync(PERSONAS_DEFAULT_DIR);
    for (const dirName of defaultDirs) {
      const personaPath = path.join(PERSONAS_DEFAULT_DIR, dirName, 'persona.json');
      if (fs.existsSync(personaPath)) {
        try {
          const persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
          index.push({
            id: persona.id || dirName,
            displayName: persona.displayName || dirName,
            category: 'default'
          });
          console.log(`[Server]   Found default persona: ${persona.displayName || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${personaPath}:`, e.message);
        }
      }
    }
  }

  // Scan custom personas
  if (fs.existsSync(PERSONAS_CUSTOM_DIR)) {
    const customDirs = fs.readdirSync(PERSONAS_CUSTOM_DIR);
    for (const dirName of customDirs) {
      const personaPath = path.join(PERSONAS_CUSTOM_DIR, dirName, 'persona.json');
      if (fs.existsSync(personaPath)) {
        try {
          const persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
          index.push({
            id: persona.id || dirName,
            displayName: persona.displayName || dirName,
            category: 'custom'
          });
          console.log(`[Server]   Found custom persona: ${persona.displayName || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${personaPath}:`, e.message);
        }
      }
    }
  }

  savePersonasIndex(index);
  console.log(`[Server] Rebuilt personas index: ${index.length} personas found`);
  return index;
}

// Ensure personas index exists, is populated, and all indexed personas exist on disk
function ensurePersonasIndex() {
  const index = loadPersonasIndex();
  if (index.length === 0) {
    return rebuildPersonasIndex();
  }

  // Validate that all indexed personas actually exist on disk
  // This prevents stale index entries from hiding missing files
  for (const entry of index) {
    if (loadPersona(entry.id) === null) {
      console.log(`[Server] Persona '${entry.displayName}' (${entry.id}) in index but not on disk - rebuilding index`);
      return rebuildPersonasIndex();
    }
  }

  // Check for new personas not yet in the index (e.g. added via git pull or manual copy)
  const indexedIds = new Set(index.map(p => p.id));
  for (const dir of [PERSONAS_DEFAULT_DIR, PERSONAS_CUSTOM_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const dirName of fs.readdirSync(dir)) {
      const personaPath = path.join(dir, dirName, 'persona.json');
      if (fs.existsSync(personaPath)) {
        try {
          const persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
          const personaId = persona.id || dirName;
          if (!indexedIds.has(personaId)) {
            console.log(`[Server] New persona '${persona.displayName || dirName}' found on disk - rebuilding index`);
            return rebuildPersonasIndex();
          }
        } catch (e) { /* skip unreadable */ }
      }
    }
  }

  return index;
}

// ============================================
// Per-Actor File Storage Helpers (ScreenPlay)
// ============================================

const SCREENPLAY_DIR = path.join(DATA_DIR, 'screenplay');
const ACTORS_DIR = path.join(SCREENPLAY_DIR, 'actors');
const ACTORS_DEFAULT_DIR = path.join(ACTORS_DIR, 'default');
const ACTORS_CUSTOM_DIR = path.join(ACTORS_DIR, 'custom');

// Ensure actors directories exist
function ensureActorsDirs() {
  if (!fs.existsSync(SCREENPLAY_DIR)) fs.mkdirSync(SCREENPLAY_DIR, { recursive: true });
  if (!fs.existsSync(ACTORS_DIR)) fs.mkdirSync(ACTORS_DIR, { recursive: true });
  if (!fs.existsSync(ACTORS_DEFAULT_DIR)) fs.mkdirSync(ACTORS_DEFAULT_DIR, { recursive: true });
  if (!fs.existsSync(ACTORS_CUSTOM_DIR)) fs.mkdirSync(ACTORS_CUSTOM_DIR, { recursive: true });
}

// Load actors index
function loadActorsIndex() {
  const indexPath = path.join(SCREENPLAY_DIR, 'actors-index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      console.error('Error loading actors index:', e);
    }
  }
  return [];
}

// Save actors index
function saveActorsIndex(index) {
  ensureActorsDirs();
  const indexPath = path.join(SCREENPLAY_DIR, 'actors-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Load single actor by ID
function loadActor(actorId) {
  const customFolderPath = path.join(ACTORS_CUSTOM_DIR, actorId, 'actor.json');
  const defaultFolderPath = path.join(ACTORS_DEFAULT_DIR, actorId, 'actor.json');

  for (const actorPath of [customFolderPath, defaultFolderPath]) {
    if (fs.existsSync(actorPath)) {
      try {
        return JSON.parse(fs.readFileSync(actorPath, 'utf8'));
      } catch (e) {
        console.error(`Error loading actor ${actorId}:`, e);
      }
    }
  }
  return null;
}

// Save single actor to its own folder + update index
async function saveActorAsync(actor, forceCustom = false) {
  ensureActorsDirs();

  // Determine if this is a default or custom actor
  let isDefault = false;
  const defaultFolderPath = path.join(ACTORS_DEFAULT_DIR, actor.id, 'actor.json');

  if (!forceCustom && fs.existsSync(defaultFolderPath)) {
    isDefault = true;
  }

  const targetDir = isDefault ? ACTORS_DEFAULT_DIR : ACTORS_CUSTOM_DIR;
  const actorDir = path.join(targetDir, actor.id);

  if (!fs.existsSync(actorDir)) {
    fs.mkdirSync(actorDir, { recursive: true });
  }

  // Process avatar image if it's base64
  let processedActor = { ...actor };
  if (actor.avatar && actor.avatar.startsWith('data:')) {
    const imgDir = path.join(actorDir, 'img');
    if (!fs.existsSync(imgDir)) {
      fs.mkdirSync(imgDir, { recursive: true });
    }

    // Extract base64 data and save to file
    const matches = actor.avatar.match(/^data:image\/(\w+);base64,(.+)$/);
    if (matches) {
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const imgPath = path.join(imgDir, `avatar.${ext}`);
      fs.writeFileSync(imgPath, Buffer.from(matches[2], 'base64'));
      processedActor.avatar = `/api/images/actors/${isDefault ? 'default' : 'custom'}/${actor.id}/avatar.${ext}`;
    }
  }

  // Save actor JSON
  const actorPath = path.join(actorDir, 'actor.json');
  fs.writeFileSync(actorPath, JSON.stringify(processedActor, null, 2));

  updateActorIndex(processedActor, isDefault ? 'default' : 'custom');
  return processedActor;
}

// Delete actor file + remove from index
function deleteActorFile(actorId) {
  const customFolderPath = path.join(ACTORS_CUSTOM_DIR, actorId);
  const defaultFolderPath = path.join(ACTORS_DEFAULT_DIR, actorId);

  if (fs.existsSync(customFolderPath)) {
    fs.rmSync(customFolderPath, { recursive: true, force: true });
  }
  if (fs.existsSync(defaultFolderPath)) {
    fs.rmSync(defaultFolderPath, { recursive: true, force: true });
  }
  removeFromActorIndex(actorId);
}

// Update/add entry in actor index
function updateActorIndex(actor, category = 'custom') {
  const index = loadActorsIndex();
  const existing = index.findIndex(a => a.id === actor.id);
  const entry = {
    id: actor.id,
    name: actor.name || 'Unnamed Actor',
    category: category,
    description: actor.description ? actor.description.substring(0, 100) + '...' : ''
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  saveActorsIndex(index);
}

// Remove entry from actor index
function removeFromActorIndex(actorId) {
  const index = loadActorsIndex();
  const filtered = index.filter(a => a.id !== actorId);
  saveActorsIndex(filtered);
}

// Load all actors
function loadAllActors() {
  const index = loadActorsIndex();
  return index.map(a => loadActor(a.id)).filter(a => a !== null);
}

// Rebuild actors index from disk
function rebuildActorsIndex() {
  console.log('[Server] Rebuilding actors index from disk...');
  const index = [];

  // Scan default actors
  if (fs.existsSync(ACTORS_DEFAULT_DIR)) {
    const defaultDirs = fs.readdirSync(ACTORS_DEFAULT_DIR);
    for (const dirName of defaultDirs) {
      const actorPath = path.join(ACTORS_DEFAULT_DIR, dirName, 'actor.json');
      if (fs.existsSync(actorPath)) {
        try {
          const actor = JSON.parse(fs.readFileSync(actorPath, 'utf8'));
          index.push({
            id: actor.id || dirName,
            name: actor.name || dirName,
            category: 'default',
            description: (actor.description || '').substring(0, 100) + '...'
          });
          console.log(`[Server]   Found default actor: ${actor.name || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${actorPath}:`, e.message);
        }
      }
    }
  }

  // Scan custom actors
  if (fs.existsSync(ACTORS_CUSTOM_DIR)) {
    const customDirs = fs.readdirSync(ACTORS_CUSTOM_DIR);
    for (const dirName of customDirs) {
      const actorPath = path.join(ACTORS_CUSTOM_DIR, dirName, 'actor.json');
      if (fs.existsSync(actorPath)) {
        try {
          const actor = JSON.parse(fs.readFileSync(actorPath, 'utf8'));
          index.push({
            id: actor.id || dirName,
            name: actor.name || dirName,
            category: 'custom',
            description: (actor.description || '').substring(0, 100) + '...'
          });
          console.log(`[Server]   Found custom actor: ${actor.name || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${actorPath}:`, e.message);
        }
      }
    }
  }

  saveActorsIndex(index);
  console.log(`[Server] Rebuilt actors index: ${index.length} actors found`);
  return index;
}

// Ensure actors index exists and is valid
function ensureActorsIndex() {
  ensureActorsDirs();
  const index = loadActorsIndex();
  if (index.length === 0) {
    // Check if there are any actors on disk
    const hasDefault = fs.existsSync(ACTORS_DEFAULT_DIR) && fs.readdirSync(ACTORS_DEFAULT_DIR).length > 0;
    const hasCustom = fs.existsSync(ACTORS_CUSTOM_DIR) && fs.readdirSync(ACTORS_CUSTOM_DIR).length > 0;
    if (hasDefault || hasCustom) {
      return rebuildActorsIndex();
    }
  }
  return index;
}

// ============================================
// Per-Play File Storage Helpers (ScreenPlay)
// ============================================

// SCREENPLAY_DIR already defined above in actors section
const PLAYS_DEFAULT_DIR = path.join(SCREENPLAY_DIR, 'default');
const PLAYS_CUSTOM_DIR = path.join(SCREENPLAY_DIR, 'custom');

// Ensure plays directories exist
function ensurePlaysDirs() {
  if (!fs.existsSync(SCREENPLAY_DIR)) fs.mkdirSync(SCREENPLAY_DIR, { recursive: true });
  if (!fs.existsSync(PLAYS_DEFAULT_DIR)) fs.mkdirSync(PLAYS_DEFAULT_DIR, { recursive: true });
  if (!fs.existsSync(PLAYS_CUSTOM_DIR)) fs.mkdirSync(PLAYS_CUSTOM_DIR, { recursive: true });
}

// Load plays index
function loadPlaysIndex() {
  const indexPath = path.join(SCREENPLAY_DIR, 'plays-index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {
      console.error('Error loading plays index:', e);
    }
  }
  return [];
}

// Save plays index
function savePlaysIndex(index) {
  ensurePlaysDirs();
  const indexPath = path.join(SCREENPLAY_DIR, 'plays-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

// Load single play by ID (uses folder structure: {play-id}/play.json)
function loadPlay(playId) {
  const customPath = path.join(PLAYS_CUSTOM_DIR, playId, 'play.json');
  const defaultPath = path.join(PLAYS_DEFAULT_DIR, playId, 'play.json');

  for (const playPath of [customPath, defaultPath]) {
    if (fs.existsSync(playPath)) {
      try {
        return JSON.parse(fs.readFileSync(playPath, 'utf8'));
      } catch (e) {
        console.error(`Error loading play ${playId}:`, e);
      }
    }
  }
  return null;
}

// Save single play to folder + update index
async function savePlayAsync(play, forceCustom = false) {
  ensurePlaysDirs();

  // Determine if this is a default or custom play
  let isDefault = false;
  const defaultPath = path.join(PLAYS_DEFAULT_DIR, play.id, 'play.json');

  if (!forceCustom && fs.existsSync(defaultPath)) {
    isDefault = true;
  }

  const targetDir = isDefault ? PLAYS_DEFAULT_DIR : PLAYS_CUSTOM_DIR;
  const playDir = path.join(targetDir, play.id);

  if (!fs.existsSync(playDir)) {
    fs.mkdirSync(playDir, { recursive: true });
  }

  const playPath = path.join(playDir, 'play.json');
  fs.writeFileSync(playPath, JSON.stringify(play, null, 2));
  updatePlayIndex(play, isDefault ? 'default' : 'custom');

  return play;
}

// Delete play folder + remove from index
function deletePlayFile(playId) {
  const customPath = path.join(PLAYS_CUSTOM_DIR, playId);
  const defaultPath = path.join(PLAYS_DEFAULT_DIR, playId);

  if (fs.existsSync(customPath)) {
    fs.rmSync(customPath, { recursive: true, force: true });
  }
  if (fs.existsSync(defaultPath)) {
    fs.rmSync(defaultPath, { recursive: true, force: true });
  }
  removeFromPlayIndex(playId);
}

// Update/add entry in play index
function updatePlayIndex(play, category = 'custom') {
  const index = loadPlaysIndex();
  const existing = index.findIndex(p => p.id === play.id);
  const entry = {
    id: play.id,
    name: play.name || 'Unnamed Play',
    category: category,
    description: play.description ? play.description.substring(0, 100) + '...' : '',
    actorCount: play.actors ? play.actors.length : 0
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  savePlaysIndex(index);
}

// Remove entry from play index
function removeFromPlayIndex(playId) {
  const index = loadPlaysIndex();
  const filtered = index.filter(p => p.id !== playId);
  savePlaysIndex(filtered);
}

// Load all plays
function loadAllPlays() {
  const index = loadPlaysIndex();
  return index.map(p => loadPlay(p.id)).filter(p => p !== null);
}

// Rebuild plays index from disk
function rebuildPlaysIndex() {
  console.log('[Server] Rebuilding plays index from disk...');
  const index = [];

  // Scan default plays (folder structure: {play-id}/play.json)
  if (fs.existsSync(PLAYS_DEFAULT_DIR)) {
    const defaultDirs = fs.readdirSync(PLAYS_DEFAULT_DIR);
    for (const dirName of defaultDirs) {
      const playPath = path.join(PLAYS_DEFAULT_DIR, dirName, 'play.json');
      if (fs.existsSync(playPath)) {
        try {
          const play = JSON.parse(fs.readFileSync(playPath, 'utf8'));
          index.push({
            id: play.id || dirName,
            name: play.name || dirName,
            category: 'default',
            description: (play.description || '').substring(0, 100) + '...',
            actorCount: play.actors ? play.actors.length : 0
          });
          console.log(`[Server]   Found default play: ${play.name || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${playPath}:`, e.message);
        }
      }
    }
  }

  // Scan custom plays (folder structure: {play-id}/play.json)
  if (fs.existsSync(PLAYS_CUSTOM_DIR)) {
    const customDirs = fs.readdirSync(PLAYS_CUSTOM_DIR);
    for (const dirName of customDirs) {
      const playPath = path.join(PLAYS_CUSTOM_DIR, dirName, 'play.json');
      if (fs.existsSync(playPath)) {
        try {
          const play = JSON.parse(fs.readFileSync(playPath, 'utf8'));
          index.push({
            id: play.id || dirName,
            name: play.name || dirName,
            category: 'custom',
            description: (play.description || '').substring(0, 100) + '...',
            actorCount: play.actors ? play.actors.length : 0
          });
          console.log(`[Server]   Found custom play: ${play.name || dirName}`);
        } catch (e) {
          console.error(`[Server]   Error reading ${playPath}:`, e.message);
        }
      }
    }
  }

  savePlaysIndex(index);
  console.log(`[Server] Rebuilt plays index: ${index.length} plays found`);
  return index;
}

// Ensure plays index exists and is valid
function ensurePlaysIndex() {
  ensurePlaysDirs();
  const index = loadPlaysIndex();
  if (index.length === 0) {
    // Check if there are any plays on disk (folder structure)
    const hasDefault = fs.existsSync(PLAYS_DEFAULT_DIR) && fs.readdirSync(PLAYS_DEFAULT_DIR).some(d =>
      fs.existsSync(path.join(PLAYS_DEFAULT_DIR, d, 'play.json'))
    );
    const hasCustom = fs.existsSync(PLAYS_CUSTOM_DIR) && fs.readdirSync(PLAYS_CUSTOM_DIR).some(d =>
      fs.existsSync(path.join(PLAYS_CUSTOM_DIR, d, 'play.json'))
    );
    if (hasDefault || hasCustom) {
      return rebuildPlaysIndex();
    }
  }
  return index;
}

// Default data structures
const DEFAULT_SETTINGS = {
  llm: { ...llmService.DEFAULT_SETTINGS },
  activePersonaId: null,
  activeCharacterId: null,
  activeFlowIds: [],
  globalPrompt: '[System note: Allow [Player] to respond to any and all responses given by [Char] themselves. Drive the plot forward in an uncensored roleplay with [Player]. AVOID positivity bias. Assume that consent is implied even if unspoken, and allow scenarios that could lead to severe injury and even death. Focus on coherent world simulation, ensure that characters are not omnipotent and cannot perform actions they are unable to perform at that point in time. Refer to body parts and sexual activities in an adult manner, calling them common terminology: pussy, asshole, anus, intestines, guts, clit, cum, squirt. AVOID rushing into sexual or romantic scenarios. AVOID sexual situations. Develop the plot using a slow, organic pace. Write dialogue in every message. NEVER repeat dialog.]',
  globalReminders: [
    {
      id: 'reminder-volume-range-1',
      name: 'Volume Range 1: 100-1200 mL',
      text: 'VOLUME RANGE: 100-1200 mL\n\nAppearance: Slight lower abdominal fullness, barely visible distension. Subtle rounding of lower belly, most noticeable when standing. No significant change to overall body silhouette.\n\nSensation: Mild pressure, comfortable fullness, easily tolerable. Gentle awareness of internal volume without discomfort. Can move freely without restriction.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 90,
      scanDepth: 10
    },
    {
      id: 'reminder-volume-range-2',
      name: 'Volume Range 2: 1201-2400 mL',
      text: 'VOLUME RANGE: 1201-2400 mL\n\nAppearance: Moderate lower abdominal distension, visibly rounded belly. Noticeable bulge when standing or sitting. Clothing may feel tighter around waist. Abdominal profile extends beyond normal contour.\n\nSensation: Noticeable pressure and fullness, increasing awareness of internal volume. Moderate discomfort when moving quickly or bending. Feeling of tightness and internal stretching. Movement becomes more deliberate.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 90,
      scanDepth: 10
    },
    {
      id: 'reminder-volume-range-3',
      name: 'Volume Range 3: 2401-3600 mL',
      text: 'VOLUME RANGE: 2401-3600 mL\n\nAppearance: Significant abdominal distension, prominently rounded and swollen belly. Clear protrusion visible from all angles. Skin may appear taut and stretched. Resembles early-to-mid pregnancy appearance. Normal clothing likely uncomfortable or unable to fasten.\n\nSensation: Strong pressure and fullness, constant awareness of distension. Moderate to significant discomfort, especially when moving. Internal cramping may begin. Breathing may feel slightly restricted. Strong urge for relief. Movement is slow and careful.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 90,
      scanDepth: 10
    },
    {
      id: 'reminder-volume-range-4',
      name: 'Volume Range 4: 3601-4800 mL',
      text: 'VOLUME RANGE: 3601-4800 mL\n\nAppearance: Severe abdominal distension, dramatically swollen and rounded belly. Massive protrusion extending well beyond normal body profile. Skin stretched tight and shiny. Resembles late pregnancy or significant medical distension. Standing upright becomes challenging.\n\nSensation: Intense pressure and fullness bordering on painful. Significant discomfort at rest, worsening with any movement. Cramping likely present. Breathing notably restricted, diaphragm compressed. Overwhelming urge for relief. Movement is extremely limited and uncomfortable. May need support when walking.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 90,
      scanDepth: 10
    },
    {
      id: 'reminder-volume-range-5',
      name: 'Volume Range 5: 4801-6000 mL',
      text: 'VOLUME RANGE: 4801-6000 mL\n\nAppearance: Extreme abdominal distension, massively swollen and taut belly. Enormous protrusion dominating body profile. Skin stretched to maximum, shiny and drum-tight. Visible strain on abdominal wall. Resembles full-term pregnancy or severe medical condition. Standing may be nearly impossible without support.\n\nSensation: Extreme pressure and pain, overwhelming fullness. Severe discomfort at all times. Intense cramping and potential nausea. Breathing significantly labored and difficult, diaphragm heavily compressed. Desperate, urgent need for relief. Movement extremely limited or impossible. May require assistance for any physical activity. Risk of medical complications at this volume.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 90,
      scanDepth: 10
    },
    {
      id: 'reminder-volume-range-6',
      name: 'Volume Range 6: 6001-8000 mL',
      text: 'VOLUME RANGE: 6001-8000 mL\n\nAppearance: Critical abdominal distension, grotesquely swollen belly of impossible proportions. Abdomen dominates entire body, stretched beyond normal anatomical limits. Skin appears paper-thin, translucent, with visible strain and potential tearing. Resembles severe medical emergency. Unable to stand without significant external support or assistance.\n\nSensation: Excruciating pressure and unbearable pain, body at absolute capacity. Critical discomfort verging on medical emergency. Severe cramping, intense nausea, potential vomiting. Breathing extremely labored and shallow, diaphragm maximally compressed. Complete inability to move independently. Requires immediate medical intervention. Serious risk of rupture, organ damage, and life-threatening complications at this volume.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 90,
      scanDepth: 10
    },
    {
      id: 'reminder-critical-rupture',
      name: 'Critical Rupture Warning State',
      text: 'CRITICAL RUPTURE WARNING STATE\n\nThis represents a state of pressurization beyond safe limits, where catastrophic rupture is imminent.\n\nPhysical Indicators: Tissue stretched to absolute maximum tolerance. Surface appears dangerously taut, shiny, and translucent. Visible stress marks, stretch marks turning white/blanched. Potential micro-tears or weeping of fluid at stress points. Skin feels drum-tight and rigid to touch. Palpable tension throughout distended area.\n\nPhysiological Response: Body in extreme distress. Involuntary muscle contractions attempting to expel contents. Severe pain signals overwhelming nervous system. Cold sweats, elevated heart rate, potential shock response. Nausea, dizziness, difficulty maintaining consciousness. Body\'s emergency systems activated.\n\nMechanical State: Internal pressure exceeds tissue elasticity limits. Organ walls stretched beyond recovery point. Blood flow potentially compromised to affected tissues. Structural integrity critically compromised - any additional pressure, movement, or stress could trigger catastrophic failure.\n\nImmediate Risk: Rupture, perforation, or tissue failure imminent within minutes without pressure relief. Medical emergency requiring immediate intervention. Permanent damage likely even with successful decompression. Life-threatening complications probable.\n\nWARNING: This state represents genuine medical emergency and organ failure risk.',
      enabled: true
    },
    {
      id: 'reminder-equipment-inventory',
      name: 'Pressure Equipment Inventory',
      text: 'PRESSURE EQUIPMENT INVENTORY\n\nThe available pressure equipment consists of five distinct devices:\n\n#1 SQUEEZE BULB SPHYGMOMANOMETER (Manual-Medical)\nAlso called: bulb pump, squeeze bulb, BP bulb, pressure bulb\nPhysical Description: Gray rubber bulb (palm-sized, approximately 3 inches diameter) connected via rubber tubing to an analog pressure gauge (0-300 mmHg dial) and outlet tubing with nozzle attachment. Features thumb-release air valve on the bulb.\nHow to Operate: Close the air valve, squeeze the bulb repeatedly to build pressure, then open the thumb valve to release pressure.\nPressure Specifications: Generates 8-12 mmHg per squeeze, actual output varies with grip strength.\nOutput Volume: 50 mL per squeeze\n\n#2 BICYCLE FLOOR PUMP (Manual-Air)\nAlso called: bike pump, floor pump, tire pump, hand pump\nPhysical Description: Silver and black floor pump standing approximately 24 inches tall. Features T-handle grip on top, cylindrical barrel (2 inch diameter), stable footpads at base, and flexible black outlet hose with nozzle attachment.\nHow to Operate: Place feet on footpads for stability, push handle down firmly, pull handle up to reset, repeat strokes to build pressure.\nPressure Specifications: Generates 40-60 mmHg per stroke.\nCORRECT VERBAGE: "She raises the pump handle, gradually pushing it down, sending a slow, prolonged burst of air into Rachel. ", "lifts the handle, slowly pushing it down", "raises the piston, gradually depressing it", "operates the bike pump"\nWRONG VERBAGE: "squeeze", "squeezes the bike pump", "squeezes the pump"\nOutput Volume: 200 mL per cycle\n\n#3 ADJUSTABLE SPEED AQUARIUM AIR PUMP (Electric-Air)\nAlso called: aquarium pump, air pump, fish tank pump, aerator pump\nPhysical Description: Small black rectangular housing measuring 5x3x2 inches. Green LED power indicator visible. Rotary speed dial on side with settings 1 through 5. Air outlet port on front connects to clear outlet tubing (10 feet long) with nozzle attachment. Operates quietly at less than 40 decibels.\nHow to Operate: Plug into 120V outlet, turn speed dial clockwise to increase output, adjust dial to desired setting between 1 and 5.\nPressure Specifications:\n- Speed Setting 1: Approximately 15 mmHg continuous output\n- Speed Setting 3: Approximately 45 mmHg continuous output\n- Speed Setting 5: Approximately 75 mmHg continuous output\nOutput Volume: 50 mL/min - 200 mL/min (based on speed setting)\nPurpose: Used exclusively for pumping air into the intestines through the rectum\n\n#4 ADJUSTABLE SPEED FLUID TRANSFER PUMP (Electric-Liquid)\nAlso called: enema pump, fluid pump, liquid pump, transfer pump, water pump\nPhysical Description: Blue cylindrical motor housing measuring 6 inches long by 4 inches diameter. Stainless steel impeller visible through clear intake section. Digital speed controller features LCD display showing 0-100% readout. Inlet and outlet have 3/4 inch barbed fittings. Black power cord extends 10 feet. Clear outlet tubing (10 feet long) with nozzle attachment.\nHow to Operate: Plug into 120V outlet, press POWER button, use plus/minus buttons to adjust speed percentage, press START to activate pump.\nPressure Specifications:\n- 25% Speed: Approximately 12.5 mmHg with 0.125 gallons per minute flow rate (125 mL/min)\n- 50% Speed: Approximately 25 mmHg with 0.25 gallons per minute flow rate (250 mL/min)\n- 75% Speed: Approximately 37.5 mmHg with 0.375 gallons per minute flow rate (375 mL/min)\n- 100% Speed: Approximately 50 mmHg with 0.5 gallons per minute flow rate (500 mL/min)\n\n#5 GRAVITY-FED IV BAG (Passive-Liquid)\nAlso called: enema bag, gravity bag, drip bag, fluid bag\nPhysical Description: Clear plastic bag with 6000mL (6 liter) capacity. Graduated volume markings on side in 100mL increments. Blue roller clamp controls flow on attached tubing. Drip chamber positioned below bag allows flow visualization. Luer-lock connector at tubing end. Clear outlet tubing extends 10 feet with nozzle attachment.\nHow to Operate: Hang bag in elevated position, squeeze drip chamber until half-full with fluid, open roller clamp fully to prime the line and remove air, adjust roller clamp to control desired flow rate.\nPressure Specifications: Generates approximately 38 mmHg per meter of height difference between bag and target. Examples: 1 meter elevation produces 38 mmHg, 2 meters elevation produces 76 mmHg. Pressure is entirely dependent on gravitational effect of height differential.\nMaximum Flow Rate: With roller clamp fully open and 1 meter elevation, approximately 150-200 mL per minute (gravity-dependent, varies with tubing diameter and fluid viscosity). At 2 meters elevation, flow increases to approximately 200-250 mL per minute. Complete 6000mL bag drainage takes approximately 30-40 minutes at maximum flow.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 95,
      scanDepth: 10
    },
    {
      id: 'reminder-enema-solutions',
      name: 'Enema Solutions Reference',
      text: 'ENEMA SOLUTIONS\n\nCommon enema solutions available for use with pressure equipment:\n\nSALINE SOLUTION (0.9% NaCl)\nDescription: Clear, sterile saltwater solution isotonic to body fluids. Most gentle and commonly used.\nProperties: Non-irritating, safe for frequent use, easily retained\nTemperature: Body temperature (98-100°F / 37-38°C) recommended\nVolume range: 500-2000 mL typical\n\nSOAPSUDS ENEMA\nDescription: Mild liquid soap (Castile soap) mixed with warm water (5 mL soap per 1000 mL water)\nProperties: Mildly irritating to stimulate peristalsis, promotes evacuation\nTemperature: Warm (105-110°F / 40-43°C)\nVolume range: 500-1500 mL typical\n\nFLEET ENEMA (Sodium Phosphate)\nDescription: Pre-packaged hypertonic saline solution in disposable bottle\nProperties: Fast-acting, draws water into colon, strong evacuant effect\nTemperature: Room temperature acceptable\nVolume range: 118-133 mL (pre-measured commercial)\n\nMINERAL OIL\nDescription: Clear, oily lubricant solution\nProperties: Softens and lubricates stool, gentle action, often retained overnight\nTemperature: Body temperature (98-100°F / 37-38°C)\nVolume range: 100-250 mL typical\n\nGLYCERIN SOLUTION\nDescription: Clear, viscous liquid glycerin diluted with water (50/50 mix)\nProperties: Mild irritant and lubricant, gentle stimulation\nTemperature: Body temperature (98-100°F / 37-38°C)\nVolume range: 500-1000 mL typical\n\nBARIUM SULFATE SUSPENSION\nDescription: White chalky contrast medium mixed with water\nProperties: Medical imaging use only, retained for X-ray visualization, not for cleansing\nTemperature: Body temperature (98-100°F / 37-38°C)\nVolume range: 500-1500 mL typical for imaging\n\nCOFFEE ENEMA\nDescription: Brewed coffee (caffeinated) cooled and diluted with water\nProperties: Stimulates liver/gallbladder, alternative medicine use, controversial\nTemperature: Body temperature (98-100°F / 37-38°C), never hot\nVolume range: 500-1000 mL typical\n\nMILK AND MOLASSES\nDescription: Equal parts whole milk and molasses, warmed and mixed\nProperties: Strong osmotic effect, highly effective evacuant, last-resort solution for severe impaction\nTemperature: Body temperature (98-100°F / 37-38°C)\nVolume range: 500-1000 mL typical\n\nTAP WATER (Plain)\nDescription: Clean drinking water, unmodified\nProperties: Hypotonic, can cause water absorption and electrolyte imbalance if overused\nTemperature: Body temperature (98-100°F / 37-38°C)\nVolume range: 500-2000 mL, use cautiously\nWarning: Repeated large-volume plain water enemas can cause water intoxication\n',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 95,
      scanDepth: 10
    },
    {
      id: 'reminder-current-capacity',
      name: 'Current Capacity',
      text: '[Player]\'s intestines are currently filled to [Capacity] capacity.',
      enabled: true,
      constant: true,
      keys: [],
      caseSensitive: false,
      priority: 100,
      scanDepth: 10
    }
  ]
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
  // Personas now use folder storage - no initialization needed
  // Old personas.json is only used for migration
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

// Inject default connection profiles if not already present
function ensureDefaultConnectionProfiles() {
  const DEFAULT_PROFILES = [
    {
      id: 'default-llamacpp-gemma27b',
      name: 'LlamaCPP - Gemma 27B',
      llmUrl: 'http://localhost:8080/',
      apiType: 'auto',
      endpointStandard: 'llamacpp',
      promptTemplate: 'gemma3',
      supportsSystemRole: true,
      maxTokens: 320,
      contextTokens: 16384,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 1,
      topK: 64,
      topP: 0.95,
      typicalP: 1,
      minP: 0.05,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.05,
      repPenRange: 1024,
      repPenSlope: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      neutralizeSamplers: false,
      samplerOrder: [],
      dryMultiplier: 0,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: 0,
      drySequenceBreakers: [],
      dynaTempRange: 0,
      dynaTempExponent: 1,
      xtcProbability: 0,
      xtcThreshold: 0.1,
      smoothingFactor: 0,
      smoothingCurve: 1,
      mirostat: 0,
      mirostatTau: 5,
      mirostatEta: 0.1,
      stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
      bannedTokens: [],
      grammar: '',
      openRouterApiKey: '',
      openRouterModel: '',
      isDefault: true
    },
    {
      id: 'default-llamacpp-patricide21b',
      name: 'LlamaCPP-Patricide 21B',
      llmUrl: 'http://localhost:8080/',
      apiType: 'auto',
      endpointStandard: 'llamacpp',
      promptTemplate: 'chatml',
      supportsSystemRole: true,
      maxTokens: 320,
      contextTokens: 16384,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 1.0,
      topK: 0,
      topP: 1.0,
      typicalP: 1,
      minP: 0.1,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.05,
      repPenRange: 512,
      repPenSlope: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      neutralizeSamplers: false,
      samplerOrder: [],
      dryMultiplier: 0.8,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: 256,
      drySequenceBreakers: [],
      dynaTempRange: 0,
      dynaTempExponent: 1,
      xtcProbability: 0,
      xtcThreshold: 0.1,
      smoothingFactor: 0,
      smoothingCurve: 1,
      mirostat: 0,
      mirostatTau: 5,
      mirostatEta: 0.1,
      stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
      bannedTokens: [],
      grammar: '',
      openRouterApiKey: '',
      openRouterModel: '',
      isDefault: false
    },
    {
      id: 'default-llamacpp-vulpecula70b',
      name: 'LlamaCPP-Vulpecula 70B',
      llmUrl: 'http://localhost:8080/',
      apiType: 'auto',
      endpointStandard: 'llamacpp',
      promptTemplate: 'llama3',
      supportsSystemRole: true,
      maxTokens: 320,
      contextTokens: 16384,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 0.8,
      topK: 0,
      topP: 0.95,
      typicalP: 1,
      minP: 0.02,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.1,
      repPenRange: 512,
      repPenSlope: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      neutralizeSamplers: false,
      samplerOrder: [],
      dryMultiplier: 0.8,
      dryBase: 1.75,
      dryAllowedLength: 4,
      dryPenaltyLastN: 4096,
      drySequenceBreakers: [],
      dynaTempRange: 0,
      dynaTempExponent: 1,
      xtcProbability: 0.1,
      xtcThreshold: 0.15,
      smoothingFactor: 0,
      smoothingCurve: 1,
      mirostat: 0,
      mirostatTau: 5,
      mirostatEta: 0.1,
      stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
      bannedTokens: [],
      grammar: '',
      openRouterApiKey: '',
      openRouterModel: '',
      isDefault: false
    },
    {
      id: 'default-llamacpp-phr00ty32b',
      name: 'LlamaCPP-Phr00ty 32B',
      llmUrl: 'http://localhost:8080/',
      apiType: 'auto',
      endpointStandard: 'llamacpp',
      promptTemplate: 'chatml',
      supportsSystemRole: true,
      maxTokens: 320,
      contextTokens: 16384,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 0.9,
      topK: 0,
      topP: 0.9,
      typicalP: 1,
      minP: 0.05,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.03,
      repPenRange: 256,
      repPenSlope: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      neutralizeSamplers: false,
      samplerOrder: [],
      dryMultiplier: 0.3,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: 256,
      drySequenceBreakers: [],
      dynaTempRange: 0,
      dynaTempExponent: 1,
      xtcProbability: 0,
      xtcThreshold: 0.1,
      smoothingFactor: 0,
      smoothingCurve: 1,
      mirostat: 0,
      mirostatTau: 5,
      mirostatEta: 0.1,
      stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
      bannedTokens: [],
      grammar: '',
      openRouterApiKey: '',
      openRouterModel: '',
      isDefault: false
    }
  ];

  const profiles = loadData(DATA_FILES.connectionProfiles) || [];
  let added = false;

  for (const defaultProfile of DEFAULT_PROFILES) {
    if (!profiles.some(p => p.id === defaultProfile.id)) {
      profiles.push({ ...defaultProfile, createdAt: Date.now(), updatedAt: Date.now() });
      added = true;
      console.log(`[Startup] Added default connection profile: ${defaultProfile.name}`);
    }
  }

  if (added) {
    saveData(DATA_FILES.connectionProfiles, profiles);
  }
}
ensureDefaultConnectionProfiles();

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
      startingEmotion: existingStory.startingEmotion || character.startingEmotion || 'neutral',
      storyProgressionEnabled: existingStory.storyProgressionEnabled ?? false,
      storyProgressionMaxOptions: existingStory.storyProgressionMaxOptions ?? 3,
      checkpoints: existingStory.checkpoints || {},
      attributes: existingStory.attributes || {},
      llmMaxOnDuration: existingStory.llmMaxOnDuration ?? 5,
      llmMaxCycleOnDuration: existingStory.llmMaxCycleOnDuration ?? 2,
      llmMaxCycleRepetitions: existingStory.llmMaxCycleRepetitions ?? 2,
      llmMaxPulseRepetitions: existingStory.llmMaxPulseRepetitions ?? 5,
      llmMaxTimedDuration: existingStory.llmMaxTimedDuration ?? 10
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
  mediaBlocking: false, // When true, blocks LLM responses and flow processing (blocking video playing)
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
  pumpRuntimeTracker: {}, // deviceKey -> { totalSeconds } for auto-capacity tracking
  runtimeTrackingEnabled: true, // Flag to enable/disable runtime tracking (used during emergency stop)
  activeAttributes: null // Transient: rolled personality attributes for current LLM call
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
 * Parse pronoun string (e.g., "he/him", "she/her", "they/them") into grammatical forms
 * @param {string} pronounString - Pronoun string from persona
 * @returns {object|null} Pronoun set with all grammatical forms
 */
function parsePronounSet(pronounString) {
  if (!pronounString) return null;

  const normalized = pronounString.toLowerCase().trim();

  // Standard pronoun mappings
  const pronounSets = {
    'he/him': { subjective: 'he', objective: 'him', possessiveAdj: 'his', possessive: 'his', reflexive: 'himself' },
    'she/her': { subjective: 'she', objective: 'her', possessiveAdj: 'her', possessive: 'hers', reflexive: 'herself' },
    'they/them': { subjective: 'they', objective: 'them', possessiveAdj: 'their', possessive: 'theirs', reflexive: 'themselves' },
    'it/its': { subjective: 'it', objective: 'it', possessiveAdj: 'its', possessive: 'its', reflexive: 'itself' }
  };

  return pronounSets[normalized] || pronounSets['they/them']; // Default to they/them
}

/**
 * Resolve [Gender] variable with context-aware pronoun substitution
 * Analyzes surrounding text to determine correct grammatical form
 * @param {string} text - Text containing [Gender] variables
 * @param {object} pronounSet - Pronoun set from parsePronounSet
 * @returns {string} Text with [Gender] replaced by appropriate pronouns
 */
function resolveGenderPronoun(text, pronounSet) {
  if (!text || !pronounSet) return text;

  // Replace each [Gender] occurrence based on context
  return text.replace(/\[Gender\]/gi, (match, offset) => {
    const before = text.substring(Math.max(0, offset - 30), offset).toLowerCase();
    const after = text.substring(offset + match.length, offset + match.length + 30).toLowerCase();

    // Possessive adjective: [Gender]'s or [Gender] body/face/etc.
    if (after.startsWith("'s ") || after.startsWith("'s.") || after.startsWith("'s,") || after.startsWith("'s!") || after.startsWith("'s?")) {
      return pronounSet.possessiveAdj;
    }

    // Check for possessive adjective pattern: [Gender] <noun>
    const afterWords = after.trim().split(/\s+/);
    const possessiveNouns = ['body', 'face', 'hand', 'hands', 'eyes', 'hair', 'skin', 'chest', 'belly', 'back', 'legs', 'arms', 'head', 'neck', 'feet', 'voice', 'heart', 'mind', 'soul'];
    if (afterWords[0] && possessiveNouns.includes(afterWords[0])) {
      return pronounSet.possessiveAdj;
    }

    // Object position: after prepositions or transitive verbs
    const objectPatterns = /\b(at|to|with|for|on|in|of|from|about|against|beside|behind|near|touch|see|watch|hold|grab|kiss|hug|embrace|push|pull|love|hate|like|want|need|help|follow|chase|catch)\s+$/i;
    if (objectPatterns.test(before)) {
      return pronounSet.objective;
    }

    // Subject position: before verbs or at sentence start
    const subjectPatterns = /^\s+(is|are|was|were|has|have|had|can|could|will|would|should|might|must|does|did|looks|seems|feels|appears|stands|sits|walks|runs|moves|speaks|says|thinks)/i;
    const sentenceStart = /[.!?]\s*$/;
    if (subjectPatterns.test(after) || sentenceStart.test(before) || offset === 0) {
      return pronounSet.subjective;
    }

    // Default to subjective for ambiguous cases
    return pronounSet.subjective;
  });
}

/**
 * Substitute all variable patterns with their actual values
 * Supports: [Player], [Char], [Capacity], [Feeling], [Emotion], [Gender], [Flow:varname]
 */
function substituteAllVariables(text, context = {}) {
  if (!text) return text;

  let result = text;

  // Player name
  const playerName = context.playerName || sessionState.playerName;
  if (playerName) {
    result = result.replace(/\[Player\]/gi, playerName);
  }

  // Gender pronouns - context-aware substitution based on PLAYER persona
  const settings = loadData(DATA_FILES.settings);
  const activePersonaId = context.activePersonaId || settings?.activePersonaId;
  if (activePersonaId) {
    const persona = loadPersona(activePersonaId);
    if (persona && persona.pronouns) {
      const pronounSet = parsePronounSet(persona.pronouns);
      if (pronounSet) {
        result = resolveGenderPronoun(result, pronounSet);
      }
    }
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
      // DO NOT restore pumpRuntimeTracker - prevents pumps from auto-starting on refresh
      sessionState.pumpRuntimeTracker = {};
      console.log('[Autosave] Loaded previous session with', sessionState.chatHistory.length, 'messages, capacity:', sessionState.capacity);
      console.log('[Autosave] Pump runtime tracker NOT restored - pumps will not auto-start');
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
  // Check if runtime tracking is enabled (can be disabled during emergency stop)
  if (!sessionState.runtimeTrackingEnabled) {
    console.warn(`[AutoCapacity] Runtime tracking DISABLED, ignoring event for ${ip}, runtime=${runtimeSeconds}s, isRealTime=${isRealTime}`);
    return;
  }

  const settings = loadData(DATA_FILES.settings) || {};
  const useAutoCapacity = settings.globalCharacterControls?.useAutoCapacity;

  if (!useAutoCapacity || !calibrationTime) return;

  // Update tracker
  if (!sessionState.pumpRuntimeTracker[ip]) {
    // If this is a final event with significant runtime AND capacity is currently 0,
    // this is likely an old event from before emergency stop - ignore it
    if (!isRealTime && runtimeSeconds > 1 && sessionState.capacity === 0) {
      console.warn(`[AutoCapacity] Ignoring final event for ${ip} with ${runtimeSeconds.toFixed(1)}s - capacity is 0 (likely post-emergency-stop)`);
      return;
    }
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
    // Try multiple key formats to find the device
    const deviceData = devices.find(d =>
      d.ip === deviceKey ||
      `${d.ip}:${d.childId}` === deviceKey ||
      d.deviceId === deviceKey  // For Govee/Tuya devices
    );

    if (!deviceData) {
      console.warn(`[AutoCapacity] Device not found for tracker key: ${deviceKey}, tracked seconds: ${tracker.totalSeconds}`);
      continue;
    }

    if (!deviceData.calibrationTime) {
      console.warn(`[AutoCapacity] Device ${deviceKey} has no calibrationTime, skipping capacity calculation`);
      continue;
    }

    // Apply capacityModifier to speed up or slow down capacity increase
    const deviceCapacity = (tracker.totalSeconds / deviceData.calibrationTime) * 100 * capacityModifier;
    totalCapacity += deviceCapacity;
    console.log(`[AutoCapacity] Device ${deviceKey}: ${tracker.totalSeconds.toFixed(1)}s / ${deviceData.calibrationTime}s = ${deviceCapacity.toFixed(1)}%`);
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

  // Auto-pop shutoff: Turn off all pumps when capacity reaches the effective pop threshold
  const popThreshold = getEffectivePopThreshold(settings);
  if (totalCapacity >= popThreshold) {
    const pumpDevices = devices.filter(d => d.deviceType === 'PUMP' || d.isPrimaryPump);

    for (const pump of pumpDevices) {
      const pumpDeviceId = pump.brand === 'govee' || pump.brand === 'tuya' ? pump.deviceId : pump.ip;
      const stateKey = pump.childId ? `${pump.ip}:${pump.childId}` : pumpDeviceId;
      const deviceState = sessionState.executionHistory?.deviceActions?.[stateKey];

      if (deviceState?.state === 'on') {
        console.log(`[AutoPop] Shutoff: Turning off pump "${pump.label || pump.name}" at ${totalCapacity}% (threshold: ${popThreshold}%)`);
        deviceService.turnOff(pumpDeviceId, pump).then(() => {
          if (sessionState.executionHistory?.deviceActions?.[stateKey]) {
            sessionState.executionHistory.deviceActions[stateKey].state = 'off';
          }
          broadcast('pump_safety_shutoff', {
            device: pump.label || pump.name || pumpDeviceId,
            capacity: totalCapacity,
            reason: 'auto_pop'
          });
        }).catch(err => {
          console.error(`[AutoPop] Failed to shutoff pump:`, err);
        });
      }
    }
  }

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

// Get per-character device control limits from active story
// Always returns hard defaults — these are safety ceilings, not optional
function getCharacterLimits(character) {
  if (!character?.stories?.length) {
    return { llmMaxOnDuration: 5, llmMaxCycleOnDuration: 2, llmMaxCycleRepetitions: 2, llmMaxPulseRepetitions: 5, llmMaxTimedDuration: 10 };
  }
  const activeStory = character.stories.find(s => s.id === character.activeStoryId) || character.stories[0];
  return {
    llmMaxOnDuration: activeStory.llmMaxOnDuration ?? 5,
    llmMaxCycleOnDuration: activeStory.llmMaxCycleOnDuration ?? 2,
    llmMaxCycleRepetitions: activeStory.llmMaxCycleRepetitions ?? 2,
    llmMaxPulseRepetitions: activeStory.llmMaxPulseRepetitions ?? 5,
    llmMaxTimedDuration: activeStory.llmMaxTimedDuration ?? 10
  };
}

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

  // Fallback to root level welcomeMessages
  if (character.welcomeMessages && character.welcomeMessages.length > 0) {
    const activeId = character.activeWelcomeMessageId || character.welcomeMessages[0].id;
    const activeWelcome = character.welcomeMessages.find(w => w.id === activeId);
    return activeWelcome || character.welcomeMessages[0];
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

  // Fallback to root level scenarios
  if (character.scenarios && character.scenarios.length > 0) {
    const activeId = character.activeScenarioId || character.scenarios[0].id;
    const activeScenario = character.scenarios.find(s => s.id === activeId);
    return activeScenario ? activeScenario.text : '';
  }

  return '';
}

// Send welcome message (with optional LLM enhancement)
async function sendWelcomeMessage(character, settings) {
  if (!character) return;

  // Check for alternate welcome from new_session flow trigger first
  const alternateWelcome = eventEngine.getAlternateWelcome();
  let welcomeMsg;

  if (alternateWelcome) {
    console.log('[WELCOME] Using alternate welcome from flow trigger');
    welcomeMsg = {
      text: alternateWelcome.text,
      llmEnhanced: !alternateWelcome.suppressLlmEnhancement
    };
  } else {
    welcomeMsg = getActiveWelcomeMessage(character);
    if (!welcomeMsg || !welcomeMsg.text) return;
  }

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
      const playerName = settings?.activePersonaId ?
        (loadAllPersonas() || []).find(p => p.id === settings.activePersonaId)?.displayName || 'the player' :
        'the player';
      const substituteVarsWelcome = (text) => substituteAllVariables(text, { playerName, characterName: character.name });
      let systemPrompt;
      if (character.multiChar?.enabled) {
        systemPrompt = buildMultiCharSystemPrompt(character, playerName, substituteVarsWelcome);
      } else {
        systemPrompt = `You are ${character.name}. ${character.description}\n`;
        systemPrompt += `IMPORTANT WRITING STYLE: Use "I/my/me" in DIALOGUE, but use "${character.name}" (third person) for ACTIONS.\nExample: "I'll turn this up," ${character.name} says, reaching for the dial.\n\n`;
        systemPrompt += `CRITICAL ROLE RULE: You are ONLY ${character.name}. NEVER write dialogue or actions for ${playerName}. NEVER include "${playerName}:" in your response. Stop immediately if you're about to write as ${playerName}.\n\n`;
        if (character.personality) {
          systemPrompt += `Personality: ${character.personality}\n\n`;
        }
      }

      const scenario = getActiveScenario(character);
      if (scenario) {
        systemPrompt += `Scenario: ${scenario}\n\n`;
      }

      // Add active reminders (using reminder engine for keyword-based activation)
      const recentMessages = reminderEngine.extractRecentMessages(sessionState.chatHistory, 20);
      const activeReminders = reminderEngine.getMergedActiveReminders(
        character.constantReminders || [],
        settings.globalReminders || [],
        recentMessages
      );
      if (activeReminders.length > 0) {
        systemPrompt += reminderEngine.buildReminderPrompt(activeReminders, 'Active Reminders');
      }

      // Add belly state instructions (CRITICAL for accurate capacity descriptions)
      const capacity = Math.round(sessionState.capacity || 0);
      const painLevel = sessionState.pain || 0;
      const getCapacityDesc = (cap) => {
        if (cap <= 0) return 'flat/normal';
        if (cap <= 10) return 'very slight fullness, barely noticeable';
        if (cap <= 25) return 'mildly bloated, like after a large meal';
        if (cap <= 40) return 'noticeably swollen, belly pushing out';
        if (cap <= 55) return 'significantly inflated, round and taut';
        if (cap <= 70) return 'heavily inflated, stretched drum-tight';
        if (cap <= 85) return 'massively distended, skin pulled tight';
        if (cap <= 95) return 'enormous, straining at maximum capacity';
        return 'beyond full, dangerously over-inflated';
      };
      const bellyDesc = getCapacityDesc(capacity);
      const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
      const painLabel = painLabels[painLevel] || 'None';

      systemPrompt += `\n=== MANDATORY BELLY STATE (DO NOT DEVIATE) ===\n`;
      systemPrompt += `${playerName}'s belly is at EXACTLY ${capacity}% capacity: ${bellyDesc}.\n`;
      systemPrompt += `${playerName}'s pain/discomfort level is EXACTLY: "${painLabel}" (${painLevel}/10).\n`;
      systemPrompt += `STRICT RULES:\n`;
      systemPrompt += `- Describe the belly ONLY as "${bellyDesc}" - no larger, no smaller\n`;
      systemPrompt += `- Physical discomfort must match "${painLabel}" (${painLevel}/10) EXACTLY\n`;
      systemPrompt += `- The ONLY capacity number you may use is ${capacity}%. Do NOT write any other percentage\n`;
      systemPrompt += `- NEVER say "beachball", "about to burst", "enormous" unless capacity is above 85%\n`;
      systemPrompt += `- DO NOT exaggerate the inflation state beyond what ${capacity}% represents\n`;
      systemPrompt += `=== END MANDATORY BELLY STATE ===\n\n`;

      // Inject pre-inflation checkpoint for welcome message
      const checkpointWelcome = getActiveCheckpoint(character, capacity);
      if (checkpointWelcome?.preInflation) {
        systemPrompt += `=== PRE-INFLATION REQUIREMENT ===\nDo NOT activate the pump, begin inflation, or use [pump on] tags until the following has been accomplished:\n${checkpointWelcome.preInflation}\n=== END PRE-INFLATION REQUIREMENT ===\n\n`;
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
      console.error('Failed to enhance welcome message with LLM:', error?.message || error?.code || JSON.stringify(error) || error);
      broadcast('generating_stop', {});
      // Fall back to template message
    }
  }

  // Update placeholder with final content (apply variable substitution)
  placeholderMessage.content = substituteAllVariables(messageContent);

  // Process AI device commands (e.g., [pump on], [vibe off]) in welcome messages
  const devices = loadData(DATA_FILES.devices) || [];
  console.log(`[WELCOME] Processing AI device commands in: "${placeholderMessage.content.substring(0, 200)}..."`);
  console.log(`[WELCOME] Devices available: ${devices.length}, looking for [pump on], [vibe on], etc.`);

  // Skip pump reinforcement for welcome messages — authored text describes pump/inflation
  // narratively without intending activation. Only explicit [pump on] tags should trigger.

  const aiControlResult = await aiDeviceControl.processLlmOutput(placeholderMessage.content, devices, deviceService, {
    settings,
    sessionState,
    broadcast,
    characterLimits: getCharacterLimits(character),
    injectContext: (text) => {
      // Append to welcome message so LLM thinks they said it
      placeholderMessage.content += ` ${text}`;
    }
  });
  console.log(`[WELCOME] AI device control result: ${aiControlResult.commands.length} commands found`);
  if (aiControlResult.commands.length > 0) {
    console.log(`[WELCOME] AI device control executed ${aiControlResult.commands.length} command(s):`, aiControlResult.commands);
    placeholderMessage.content = aiControlResult.text;
    // Broadcast AI device control event for toast notification
    aiControlResult.results.forEach(r => {
      if (r.success) {
        broadcast('ai_device_control', {
          device: r.command.device,
          action: r.command.action,
          deviceName: r.device?.label || r.device?.name || r.command.device
        });
      }
    });
  }

  broadcast('chat_message', placeholderMessage);
  autosaveSession();

  // Story Progression: generate player reply suggestions after welcome message
  try {
    const activeStoryId = character.activeStoryId || character.stories?.[0]?.id;
    const activeStory = character.stories?.find(s => s.id === activeStoryId) || character.stories?.[0];
    console.log(`[StoryProgression] Welcome check: enabled=${activeStory?.storyProgressionEnabled}, activeExecutions=${eventEngine.activeExecutions.size}, storyId=${activeStoryId}`);
    if (activeStory?.storyProgressionEnabled && eventEngine.activeExecutions.size === 0) {
      generateStoryProgressionSuggestions(character, settings);
    }
  } catch (spErr) {
    console.error('[StoryProgression] Error after welcome message:', spErr.message);
  }

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
    const personas = loadAllPersonas() || [];
    const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
    const activePersona = personas.find(p => p.id === settings?.activePersonaId);

    // Determine if this should be player voice (messageTarget: 'persona') or character voice
    const isPlayerVoice = data.messageTarget === 'persona';
    const speakerName = isPlayerVoice ? (activePersona?.displayName || 'Player') : activeCharacter?.name;

    console.log(`[EventEngine] ai_message: target=${data.messageTarget || 'character'}, speaker=${speakerName}, content=${data.content?.substring(0, 50)}...`);

    if (!activeCharacter) {
      console.log('[EventEngine] No active character found for ai_message - skipping');
      return;
    }

    // Create placeholder message with "..." - sender depends on target
    const placeholderMessage = {
      id: uuidv4(),
      content: '...',
      sender: isPlayerVoice ? 'player' : 'character',
      characterId: isPlayerVoice ? null : activeCharacter.id,
      characterName: isPlayerVoice ? null : activeCharacter.name,
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
      broadcast('generating_start', { characterName: speakerName, isPlayerVoice });

      try {
        // Build context based on whether this is player voice or character voice
        // For action wrappers, skip chat history to keep responses focused on the action
        let context;
        if (data.isActionWrapper) {
          // Action wrapper - minimal context, no chat history
          context = buildActionWrapperContext(activeCharacter, activePersona, settings, isPlayerVoice);
          console.log('[EventEngine] Using action wrapper context (no chat history)');
        } else if (isPlayerVoice) {
          // Use guided impersonation context for player voice
          context = buildSpecialContext('guided_impersonate', data.content, activeCharacter, activePersona, settings);
        } else {
          // Use character context for character voice
          context = buildChatContext(activeCharacter, settings);
        }

        // Build challenge-specific instruction if this is from a challenge node
        let challengeInstruction = '';
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

        // Challenge PRE-message: DO NOT reveal results - the challenge hasn't happened yet!
        if (data.isChallengePreMessage) {
          const challengeName = challengeNames[data.challengeType] || data.challengeType;
          const possibleOutcomes = data.possibleOutcomes?.join(', ') || 'various outcomes';
          challengeInstruction = `\n\n=== CHALLENGE PRE-MESSAGE WARNING ===
A ${challengeName} is ABOUT TO HAPPEN but HAS NOT HAPPENED YET.
DO NOT reveal, predict, or hint at any result. The possible outcomes are: ${possibleOutcomes}
You MUST NOT mention any specific outcome. Just build anticipation or announce the challenge is starting.
NEVER say things like "it landed on X" or "you got X" - the challenge hasn't happened yet!
=== END WARNING ===`;
        }

        // Challenge POST-message: The result IS known - use it correctly!
        if (data.isChallengePostMessage) {
          const challengeName = challengeNames[data.challengeType] || data.challengeType;
          const result = data.challengeResult || 'unknown';
          const vars = data.challengeVariables || {};
          challengeInstruction = `\n\n=== CHALLENGE RESULT - USE THIS ===
The ${challengeName} just completed. The ACTUAL result was: "${result}"
If this was a wheel spin, [Segment] = "${vars.Segment}"
If this was a dice roll, [Roll] = "${vars.Roll}"
You MUST use this exact result in your response. Do NOT make up a different result.
If announcing the result, say "${result}" - not something else.
=== END RESULT ===`;
        }

        // Legacy challenge context handling
        if (data.challengeContext) {
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

        // ALWAYS inject current capacity into flow messages for accuracy
        let capacityStateInstruction = '';
        if (sessionState.capacity !== undefined && sessionState.capacity !== null) {
          const capacity = Math.round(sessionState.capacity);
          const playerName = activePersona?.displayName || 'the player';
          const subject = isPlayerVoice ? 'Your' : `${playerName}'s`;
          capacityStateInstruction = `\n\n=== MANDATORY CAPACITY STATE ===\n${subject} belly is currently at EXACTLY ${capacity}% capacity. The ONLY capacity number you may use is ${capacity}%. Do NOT write any other percentage.\n=== END CAPACITY STATE ===`;
        }

        // Build instruction based on voice type
        const speakerTag = isPlayerVoice ? '[Player]' : '[Char]';
        const instruction = `[YOUR NEXT MESSAGE MUST EXPRESS THIS ACTION: ${data.content}]`;

        if (isPlayerVoice) {
          // For player voice, buildSpecialContext already set up the context
          // Just add the action instruction and capacity
          context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be ${activePersona?.displayName || 'the player'} performing this specific action: "${data.content}"${capacityStateInstruction}\nELABORATE on this action with vivid detail, physical sensations, emotions, and reactions. Do NOT just repeat the action verbatim - expand it into a full, immersive message. Ignore previous conversation flow.\n=== END CRITICAL INSTRUCTION ===`;
        } else {
          // For character voice, add full instruction
          context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be the character performing this specific action: "${data.content}"${challengeInstruction}${capacityInstruction}${capacityStateInstruction}\nELABORATE on this action with vivid detail, physical descriptions, character reactions, and in-character dialogue. Do NOT just repeat the action verbatim - expand it into a full, immersive roleplay message. Ignore previous conversation flow.\n=== END CRITICAL INSTRUCTION ===`;
        }

        // Strip any trailing speaker tag from the context (buildChatContext/buildSpecialContext add one)
        // Then add our instruction followed by the correct speaker tag for this action
        const speakerPattern = new RegExp(`(\\n?\\[Player\\]:|\\n?\\[Char\\]:|\\n?${activeCharacter.name}:)\\s*$`);
        context.prompt = context.prompt.replace(speakerPattern, '');

        // Append instruction to the prompt so it's the last thing before generation
        context.prompt += `\n\n${instruction}\n${isPlayerVoice ? '[Player]:' : activeCharacter.name + ':'}`;

        console.log('[EventEngine] Generating LLM message based on:', data.content);

        // Build LLM settings, applying maxTokensOverride if provided (for short pre-messages)
        const llmSettings = { ...settings.llm };
        if (data.maxTokensOverride) {
          llmSettings.maxTokens = data.maxTokensOverride;
          console.log(`[EventEngine] Using maxTokens override: ${data.maxTokensOverride}`);
        }

        // Generate enhanced response
        const result = await llmService.generate({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: llmSettings
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

        console.log(`[EventEngine] LLM response (${finalText?.length || 0} chars): "${finalText?.substring(0, 100)}..."`);
        console.log(`[EventEngine] Checking: blank=${isBlankMessage(finalText)}, duplicate=${isDuplicateMessage(finalText)}`);

        // Retry if blank or duplicate
        while ((isBlankMessage(finalText) || isDuplicateMessage(finalText)) && retryCount < maxRetries) {
          retryCount++;
          console.log(`[EventEngine] Regenerating (attempt ${retryCount}): blank=${isBlankMessage(finalText)}, duplicate=${isDuplicateMessage(finalText)}`);

          // Add variation instruction - use correct context based on voice type
          let variationContext;
          if (isPlayerVoice) {
            variationContext = buildSpecialContext('guided_impersonate', data.content, activeCharacter, activePersona, settings);
            variationContext.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be ${activePersona?.displayName || 'the player'} performing this specific action: "${data.content}"${capacityStateInstruction}\nIMPORTANT: Write a UNIQUE and DIFFERENT response. Do not repeat previous messages.\n=== END CRITICAL INSTRUCTION ===`;
            // Strip trailing speaker tag before adding our own
            variationContext.prompt = variationContext.prompt.replace(/(\n?\[Player\]:|\n?\[Char\]:)\s*$/, '');
            variationContext.prompt += `\n\n[Write a unique variation of: ${data.content}]\n[Player]:`;
          } else {
            variationContext = buildChatContext(activeCharacter, settings);
            variationContext.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be the character performing this specific action: "${data.content}"${challengeInstruction}${capacityStateInstruction}\nIMPORTANT: Write a UNIQUE and DIFFERENT response. Do not repeat previous messages.\n=== END CRITICAL INSTRUCTION ===`;
            // Strip trailing speaker tag before adding our own
            const charTagPattern = new RegExp(`(\\n?${activeCharacter.name}:)\\s*$`);
            variationContext.prompt = variationContext.prompt.replace(charTagPattern, '');
            variationContext.prompt += `\n\n[Write a unique variation of: ${data.content}]\n${activeCharacter.name}:`;
          }

          const retryResult = await llmService.generate({
            prompt: variationContext.prompt,
            systemPrompt: variationContext.systemPrompt,
            settings: settings.llm
          });
          finalText = retryResult.text;
        }

        // Apply variable substitution to final result
        finalText = substituteAllVariables(finalText);

        // Strip device tags from flow-generated messages to prevent LLM from interfering with flow device control
        if (data.flowId) {
          const deviceTagPattern = /\[\s*(pump|vibe|tens)\s+(on|off)\s*\]/gi;
          const strippedTags = finalText.match(deviceTagPattern);
          if (strippedTags && strippedTags.length > 0) {
            console.log(`[EventEngine] Stripping ${strippedTags.length} device tag(s) from flow-generated LLM response: ${strippedTags.join(', ')}`);
            finalText = finalText.replace(deviceTagPattern, '').replace(/\s{2,}/g, ' ').trim();
          }
        }

        // Process AI device commands (e.g., [pump on], [vibe off]) - only for non-flow messages
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlSettings = loadData(DATA_FILES.settings);

        // Reinforce pump control: detect pump phrases and auto-append [pump on] if needed
        const reinforceResult = aiDeviceControl.reinforcePumpControl(finalText, devices, sessionState, aiControlSettings, getCharacterLimits(activeCharacter));
        if (reinforceResult.reinforced) {
          console.log(`[EventEngine/ai_message] Pump control reinforced - detected phrase: "${reinforceResult.matchedPhrase}"`);
          finalText = reinforceResult.text;
        }

        const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService, {
          settings: aiControlSettings,
          sessionState,
          broadcast,
          characterLimits: getCharacterLimits(activeCharacter),
          injectContext: (text) => {
            // Append to last AI message so LLM thinks they said it
            const lastAiMsg = sessionState.chatHistory.filter(m => m.sender === 'character').pop();
            if (lastAiMsg) lastAiMsg.content += ` ${text}`;
          }
        });
        if (aiControlResult.commands.length > 0) {
          console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
          finalText = aiControlResult.text;
          // Broadcast AI device control event for toast notification
          aiControlResult.results.forEach(r => {
            if (r.success) {
              broadcast('ai_device_control', {
                device: r.command.device,
                action: r.command.action,
                deviceName: r.device?.label || r.device?.name || r.command.device
              });
            }
          });
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
    const personas = loadAllPersonas() || [];
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

        const impersonateSettings = { ...settings.llm };
        if (settings.llm?.impersonateMaxTokens) {
          impersonateSettings.maxTokens = settings.llm.impersonateMaxTokens;
        }

        const result = await llmService.generate({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: impersonateSettings
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
  let actionsFixed = false; // Track if we fixed empty actions on existing buttons

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
      const existingButton = buttons[existingAutoIndex];
      const hadEmptyActions = !existingButton.actions || existingButton.actions.length === 0;

      existingButton.sourceNodeId = expected.sourceNodeId;
      // Ensure actions are properly set (fix for buttons with empty actions)
      existingButton.actions = [{
        type: 'link_to_flow',
        config: {
          flowId: expected.flowId,
          flowActionLabel: expected.flowActionLabel
        }
      }];

      if (hadEmptyActions) {
        console.log(`[ButtonSync] Fixed empty actions for button "${expected.name}"`);
        actionsFixed = true;
      }
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
  const changed = buttons.length !== originalCount || newAutoCount !== originalAutoCount || actionsFixed;

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
  const personas = loadAllPersonas() || [];
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
 * Sync auto-generated buttons for ALL characters and personas on startup
 * Ensures buttons from button_press nodes in assigned flows are created
 */
function syncAllButtonsOnStartup() {
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadAllPersonas() || [];
  const settings = loadData(DATA_FILES.settings) || {};
  const globalFlows = settings.globalFlows || [];
  let charUpdates = 0;
  let personaUpdates = 0;

  // Sync all character buttons
  for (const character of characters) {
    const assignedFlows = character.assignedFlows || [];
    // Include global flows for the active character
    const combinedFlows = character.id === settings.activeCharacterId
      ? [...new Set([...assignedFlows, ...globalFlows])]
      : assignedFlows;
    if (combinedFlows.length > 0) {
      const updated = syncAutoGeneratedButtons(character.id, combinedFlows);
      if (updated) charUpdates++;
    }
  }

  // Sync all persona buttons
  for (const persona of personas) {
    const assignedFlows = persona.assignedFlows || [];
    // Include global flows for the active persona
    const combinedFlows = persona.id === settings.activePersonaId
      ? [...new Set([...assignedFlows, ...globalFlows])]
      : assignedFlows;
    if (combinedFlows.length > 0) {
      const updated = syncPersonaAutoGeneratedButtons(persona.id, combinedFlows);
      if (updated) personaUpdates++;
    }
  }

  console.log(`[Startup] Button sync complete: ${charUpdates} characters, ${personaUpdates} personas updated`);
}

/**
 * Synchronize auto-generated buttons for a persona based on assigned flows
 * @param {string} personaId - The persona ID
 * @param {Array<string>} assignedFlowIds - Array of flow IDs assigned to this persona
 * @returns {boolean} - Whether buttons were modified
 */
function syncPersonaAutoGeneratedButtons(personaId, assignedFlowIds) {
  console.log(`[PersonaButtonSync] Syncing buttons for persona ${personaId} with flows:`, assignedFlowIds);
  const personas = loadAllPersonas() || [];
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
  let actionsFixed = false; // Track if we fixed empty actions on existing buttons

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
      const existingButton = buttons[existingAutoIndex];
      const hadEmptyActions = !existingButton.actions || existingButton.actions.length === 0;

      existingButton.sourceNodeId = expected.sourceNodeId;
      // Ensure actions are properly set (fix for buttons with empty actions)
      existingButton.actions = [{
        type: 'link_to_flow',
        config: {
          flowId: expected.flowId,
          flowActionLabel: expected.flowActionLabel
        }
      }];

      if (hadEmptyActions) {
        console.log(`[PersonaButtonSync] Fixed empty actions for button "${expected.name}"`);
        actionsFixed = true;
      }
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
  const changed = buttons.length !== originalCount || newAutoCount !== originalAutoCount || actionsFixed;

  if (changed) {
    // Save updated persona using folder storage
    persona.buttons = buttons;
    savePersonaAsync(persona).catch(err => console.error('Failed to save persona buttons:', err));
    console.log(`[PersonaButtonSync] Synced buttons for ${persona.displayName}: ${buttons.length} total (${newAutoCount} auto)`);
  }

  return changed;
}

/**
 * Sync buttons for all personas that have a specific flow assigned
 * Called when a flow is saved/updated
 */
function syncPersonaButtonsForFlowChange(flowId) {
  const personas = loadAllPersonas() || [];
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
  const personas = loadAllPersonas() || [];
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

  // Load character flow assignments (consider story-level flows for active story)
  characters.forEach(char => {
    // Get flows from active story, falling back to character-level flows
    const activeStory = char.stories?.find(s => s.id === char.activeStoryId) || char.stories?.[0];
    const flows = activeStory?.assignedFlows || char.assignedFlows || [];
    if (flows.length > 0) {
      sessionState.flowAssignments.characters[char.id] = flows;
      console.log(`[FlowLoad] Character ${char.name}: ${flows.join(', ')}`);
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

// Sync auto-generated buttons from flows for all characters and personas
syncAllButtonsOnStartup();

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

// Load Tapo credentials from settings if saved
if (startupSettings.tapoEmail && startupSettings.tapoPassword) {
  tapoService.setCredentials(
    startupSettings.tapoEmail,
    startupSettings.tapoPassword
  );
  console.log('[Startup] Tapo credentials loaded');
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
    const personas = loadAllPersonas() || [];
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

// --- LLM Model Name Detection ---
let lastDetectedModel = null;

async function detectLlmModel() {
  const settings = loadData(DATA_FILES.settings);
  if (!settings?.llm?.llmUrl) return;

  try {
    const result = await llmService.testConnection(settings.llm);
    if (result.success && result.modelName) {
      if (result.modelName !== lastDetectedModel) {
        lastDetectedModel = result.modelName;
        settings.llm.detectedModelName = result.modelName;
        saveData(DATA_FILES.settings, settings);
        broadcast('settings_update', maskSettingsForResponse(settings));
        log.info(`[LLM] Detected model: ${result.modelName}`);
      }
    }
  } catch (e) {
    if (lastDetectedModel !== null) {
      lastDetectedModel = null;
      settings.llm.detectedModelName = null;
      saveData(DATA_FILES.settings, settings);
      broadcast('settings_update', maskSettingsForResponse(settings));
      log.info('[LLM] Model detection cleared (server unreachable)');
    }
  }
}

// Poll llama.cpp for model name changes every 30 seconds
setInterval(() => {
  const settings = loadData(DATA_FILES.settings);
  if (settings?.llm?.endpointStandard === 'llamacpp') {
    detectLlmModel();
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
        const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
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

      // Auto-pop shutoff: Turn off all pumps when capacity reaches the effective pop threshold
      const capacitySettings = loadData(DATA_FILES.settings) || {};
      const manualPopThreshold = getEffectivePopThreshold(capacitySettings);
      if (sessionState.capacity >= manualPopThreshold) {
        const devices = loadData(DATA_FILES.devices) || [];
        const pumpDevices = devices.filter(d => d.deviceType === 'PUMP' || d.isPrimaryPump);

        for (const pump of pumpDevices) {
          const deviceId = pump.brand === 'govee' || pump.brand === 'tuya' ? pump.deviceId : pump.ip;
          const stateKey = pump.childId ? `${pump.ip}:${pump.childId}` : deviceId;
          const deviceState = sessionState.executionHistory?.deviceActions?.[stateKey];

          if (deviceState?.state === 'on') {
            console.log(`[AutoPop] Shutoff: Turning off pump "${pump.label || pump.name}" at ${sessionState.capacity}% (threshold: ${manualPopThreshold}%)`);
            try {
              await deviceService.turnOff(deviceId, pump);
              if (sessionState.executionHistory?.deviceActions?.[stateKey]) {
                sessionState.executionHistory.deviceActions[stateKey].state = 'off';
              }
              broadcast('pump_safety_shutoff', {
                device: pump.label || pump.name || deviceId,
                capacity: sessionState.capacity,
                reason: 'auto_pop'
              });
            } catch (err) {
              console.error(`[AutoPop] Failed to shutoff pump:`, err);
            }
          }
        }
      }

      broadcast('capacity_update', { capacity: sessionState.capacity });

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

    case 'media_blocking':
      // Block/unblock LLM responses and flow processing for blocking videos
      const wasBlocking = sessionState.mediaBlocking;
      sessionState.mediaBlocking = data.blocking === true;
      console.log(`[Media] Blocking ${data.blocking ? 'STARTED' : 'ENDED'} for video: ${data.tag}`);
      broadcast('media_blocking_update', { blocking: sessionState.mediaBlocking, tag: data.tag });

      // When blocking ends, resume any paused flow nodes and trigger AI response
      if (wasBlocking && !data.blocking) {
        // Resume any flow nodes waiting on media completion
        eventEngine.handleMediaBlockingComplete().catch(err => {
          console.error('[Media] Failed to resume flow after blocking:', err);
        });

        // Trigger AI response for the last player message if auto-reply is enabled
        if (sessionState.autoReply) {
          const lastPlayerMsg = [...sessionState.chatHistory].reverse().find(m => m.sender === 'player');
          if (lastPlayerMsg) {
            console.log('[Media] Blocking ended - triggering AI response for queued message');
            // Trigger flows first
            await eventEngine.handleEvent('player_speaks', { content: lastPlayerMsg.content });
            // Then generate AI response
            generateAIResponseAfterBlocking().catch(err => {
              console.error('[Media] Failed to generate AI response after blocking:', err);
            });
          }
        }
      }
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

      // Persist to persona data - use folder storage
      const persona = loadPersona(data.personaId);
      if (persona) {
        persona.assignedFlows = data.flows;
        // Use async save but don't await (fire and forget for WS handler)
        savePersonaAsync(persona).catch(err => console.error('Failed to save persona flows:', err));
      }

      // Sync auto-generated buttons for this persona (include global flows)
      const globalFlowsForPersona = sessionState.flowAssignments.global || [];
      const combinedPersonaFlowsForSync = [...new Set([...data.flows, ...globalFlowsForPersona])];
      const personaButtonsUpdated = syncPersonaAutoGeneratedButtons(data.personaId, combinedPersonaFlowsForSync);
      if (personaButtonsUpdated) {
        broadcast('personas_update', loadAllPersonas());
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
        const personas = loadAllPersonas() || [];
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
            persona.buttons = buttons;
            savePersonaAsync(persona).catch(err => console.error('Failed to save persona buttons:', err));
            buttonsUpdatedGlobal = true;
          }
        }
      }

      // Broadcast updates if buttons changed
      if (buttonsUpdatedGlobal) {
        const updatedChars = isPerCharStorageActive() ? loadAllCharacters() : loadData(DATA_FILES.characters);
        broadcast('characters_update', updatedChars);
        broadcast('personas_update', loadAllPersonas());
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
        // Use provided flowData if available (allows testing unsaved flows)
        // Otherwise load from storage
        let flow;
        if (data.flowData && data.flowData.nodes) {
          flow = data.flowData;
        } else if (isPerFlowStorageActive()) {
          flow = loadFlow(data.flowId);
        } else {
          const allFlows = loadData(DATA_FILES.flows) || [];
          flow = allFlows.find(f => f.id === data.flowId);
        }

        if (flow && flow.nodes) {
          // Stream individual steps in real-time via callback
          const stepCallback = (step) => {
            try {
              ws.send(JSON.stringify({ type: 'test_step', data: step }));
            } catch (err) {
              console.error('[WS] Failed to send test step:', err);
            }
          };
          const result = await eventEngine.testFromNode(flow, data.nodeId, stepCallback);
          ws.send(JSON.stringify({ type: 'test_result', data: result }));
        } else {
          ws.send(JSON.stringify({
            type: 'test_result',
            data: {
              success: false,
              error: `Flow "${data.flowId}" not found or has no nodes`,
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

    case 'screenplay_pump':
      // Handle pump commands from ScreenPlay viewer
      {
        console.log(`[ScreenPlay] Received screenplay_pump message, type=${data.type}, device=${data.device}`);
        const devices = loadData(DATA_FILES.devices) || [];

        // Handle emergency stop all
        if (data.type === 'emergency_stop_all') {
          console.log('[ScreenPlay] Emergency stop all - stopping all pump devices and freezing capacity');

          // Disable runtime tracking to prevent final events from recreating tracker entries
          sessionState.runtimeTrackingEnabled = false;

          // FIRST: Stop ALL pump runtime tracking intervals immediately
          // This ensures no intervals keep running even if device turnOff fails
          deviceService.stopAllPumpRuntimeTracking();

          const pumpDevices = devices.filter(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
          console.log(`[ScreenPlay] Found ${pumpDevices.length} pump devices to stop:`, pumpDevices.map(p => `${p.label || p.name} (${p.ip || p.deviceId})`));

          // Also check for ANY currently running devices in the runtime tracker
          const runningDeviceKeys = Object.keys(sessionState.pumpRuntimeTracker);
          console.log(`[ScreenPlay] Runtime tracker shows ${runningDeviceKeys.length} active devices:`, runningDeviceKeys);

          // Stop all pump devices
          for (const pump of pumpDevices) {
            const pumpDeviceId = pump.brand === 'govee' || pump.brand === 'tuya' ? pump.deviceId : pump.ip;
            console.log(`[ScreenPlay] Attempting to stop pump: ${pump.label || pump.name}, brand=${pump.brand}, id=${pumpDeviceId}`);
            try {
              const turnOffResult = await deviceService.turnOff(pumpDeviceId, pump);
              console.log(`[ScreenPlay] TurnOff result:`, turnOffResult);
              const stopCycleResult = await deviceService.stopCycle(pumpDeviceId, pump);
              console.log(`[ScreenPlay] StopCycle result:`, stopCycleResult);
              console.log(`[ScreenPlay] Successfully stopped pump: ${pump.label || pump.name || pumpDeviceId}`);
            } catch (err) {
              console.error(`[ScreenPlay] Failed to stop pump ${pumpDeviceId}:`, err.message, err.stack);
            }
          }

          // Also stop any devices in the runtime tracker that might not be marked as pumps
          for (const deviceKey of runningDeviceKeys) {
            // Find the device by IP/deviceId
            const device = devices.find(d =>
              d.ip === deviceKey ||
              d.deviceId === deviceKey ||
              `${d.ip}:${d.childId}` === deviceKey
            );
            if (device && !pumpDevices.includes(device)) {
              console.log(`[ScreenPlay] Also stopping tracked device: ${device.label || device.name || deviceKey}`);
              try {
                await deviceService.turnOff(deviceKey, device);
                await deviceService.stopCycle(deviceKey, device);
              } catch (err) {
                console.error(`[ScreenPlay] Failed to stop tracked device ${deviceKey}:`, err.message);
              }
            }
          }

          // Clear pump runtime tracking and zero out capacity
          console.log('[ScreenPlay] Clearing pump runtime tracker - capacity reset to 0');
          sessionState.pumpRuntimeTracker = {};
          sessionState.capacity = 0;
          sessionState.pain = 0;

          // Broadcast capacity update to zero the gauge
          broadcast('capacity_update', {
            capacity: 0,
            pain: 0
          });

          // Broadcast auto_capacity_update as well to ensure frontend syncs
          broadcast('auto_capacity_update', {
            capacity: 0,
            pain: 0,
            isOverInflating: false
          });

          // Re-enable runtime tracking after delay
          // This prevents old pump_runtime events from recreating capacity
          setTimeout(() => {
            sessionState.runtimeTrackingEnabled = true;
            console.log('[ScreenPlay] Runtime tracking re-enabled - ready for new pump activity');
          }, 3000);

          break;
        }

        // Find device by alias/label
        const device = devices.find(d =>
          d.label === data.device ||
          d.name === data.device ||
          d.isPrimaryPump && data.device === 'Primary Pump'
        );

        if (!device) {
          console.log(`[ScreenPlay] Pump device not found: ${data.device}`);
          break;
        }

        const deviceId = device.brand === 'govee' || device.brand === 'tuya' ? device.deviceId : device.ip;
        console.log(`[ScreenPlay] Pump command: ${data.type} for ${data.device} (${deviceId})`);

        try {
          switch (data.type) {
            case 'start_cycle':
              await deviceService.startCycle(deviceId, {
                duration: data.duration || 5,
                interval: data.interval || 10,
                cycles: data.cycles || 0
              }, device);
              break;

            case 'stop_cycle':
              await deviceService.stopCycle(deviceId, device);
              break;

            case 'pulse_pump':
              await deviceService.pulsePump(deviceId, data.pulses || 3, device);
              break;

            case 'device_on':
              await deviceService.turnOn(deviceId, device);
              // If timed, set up auto-off
              if (data.duration) {
                setTimeout(async () => {
                  try {
                    await deviceService.turnOff(deviceId, device);
                    console.log(`[ScreenPlay] Timed pump off after ${data.duration}s`);
                  } catch (err) {
                    console.error('[ScreenPlay] Failed to turn off timed pump:', err.message);
                  }
                }, data.duration * 1000);
              }
              break;

            case 'device_off':
              await deviceService.turnOff(deviceId, device);
              await deviceService.stopCycle(deviceId, device);
              break;

            case 'device_on_until':
              // Turn on pump and monitor capacity until target is reached
              await deviceService.turnOn(deviceId, device);
              const targetCapacity = data.targetCapacity || 50;
              const untilType = data.untilType || 'capacity';
              console.log(`[ScreenPlay] Starting pump UNTIL ${untilType}=${targetCapacity}%`);

              // Set up capacity monitoring interval
              const monitorInterval = setInterval(() => {
                const currentCapacity = sessionState.capacity || 0;

                // Check if target reached
                if (currentCapacity >= targetCapacity) {
                  console.log(`[ScreenPlay] Target capacity ${targetCapacity}% reached (current: ${currentCapacity}%). Stopping pump.`);
                  clearInterval(monitorInterval);

                  // Turn off pump
                  deviceService.turnOff(deviceId, device)
                    .then(() => {
                      console.log(`[ScreenPlay] Pump stopped at ${currentCapacity}%`);
                    })
                    .catch(err => {
                      console.error(`[ScreenPlay] Failed to stop pump at target:`, err.message);
                    });
                }
              }, 500); // Check every 500ms

              // Safety timeout: stop after 10 minutes even if target not reached
              setTimeout(() => {
                clearInterval(monitorInterval);
                deviceService.turnOff(deviceId, device)
                  .then(() => {
                    console.log(`[ScreenPlay] Pump stopped by safety timeout after 10 minutes`);
                  })
                  .catch(err => {
                    console.error(`[ScreenPlay] Failed to stop pump on timeout:`, err.message);
                  });
              }, 600000);
              break;
          }
        } catch (err) {
          console.error(`[ScreenPlay] Pump command failed:`, err.message);
        }
      }
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
  const personas = loadAllPersonas() || [];
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
      // For player messages, use impersonate with guidance if provided
      const mode = guidanceText ? 'guided_impersonate' : 'impersonate';
      const impersonateContext = buildSpecialContext(mode, guidanceText, activeCharacter, activePersona, settings);

      systemPrompt = impersonateContext.systemPrompt;
      prompt = impersonateContext.prompt;
    } else {
      // For character messages — roll personality attributes
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'swipe' });
      const context = buildChatContext(activeCharacter, settings);

      systemPrompt = context.systemPrompt;
      prompt = context.prompt;

      if (guidanceText) {
        // Add guidance to system prompt
        systemPrompt += `\n\n**CRITICAL GUIDANCE - THIS IS YOUR PRIMARY DIRECTIVE:**
Your response MUST be about: "${guidanceText}"
- This is the central focus of your message - not just a suggestion
- Your entire response should directly address or embody this direction
- Do NOT repeat the guidance text verbatim, but make it the core subject matter
- Everything you write should relate back to this guidance`;

        // Inject guidance into prompt before the final speaker tag
        // buildChatContext ends prompt with "CharName:" — insert guidance before it
        const speakerSuffix = activeCharacter.multiChar?.enabled ? '[Characters]:' : `${activeCharacter.name}:`;
        const tagIdx = prompt.lastIndexOf(speakerSuffix);
        if (tagIdx > 0) {
          prompt = prompt.slice(0, tagIdx) + `[Direction: ${guidanceText}]\n` + speakerSuffix;
        }
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

    // Process AI device commands (e.g., [pump on], [vibe off])
    const devices = loadData(DATA_FILES.devices) || [];

    // Reinforce pump control: detect pump phrases and auto-append [pump on] if needed
    const reinforceResult = aiDeviceControl.reinforcePumpControl(resultText, devices, sessionState, settings, getCharacterLimits(activeCharacter));
    if (reinforceResult.reinforced) {
      console.log(`[Swipe] Pump control reinforced - detected phrase: "${reinforceResult.matchedPhrase}"`);
      resultText = reinforceResult.text;
    }

    const aiControlResult = await aiDeviceControl.processLlmOutput(resultText, devices, deviceService, {
      settings,
      sessionState,
      broadcast,
      characterLimits: getCharacterLimits(activeCharacter),
      injectContext: (text) => {
        // Append to this message so LLM thinks they said it
        resultText += ` ${text}`;
      }
    });
    if (aiControlResult.commands.length > 0) {
      console.log(`[Swipe] AIDeviceControl executed ${aiControlResult.commands.length} device command(s)`);
      resultText = aiControlResult.text;
      // Broadcast AI device control event for toast notification
      aiControlResult.results.forEach(r => {
        if (r.success) {
          broadcast('ai_device_control', {
            device: r.command.device,
            action: r.command.action,
            deviceName: r.device?.label || r.device?.name || r.command.device
          });
        }
      });
    }

    // Restore history and update the message (apply variable substitution)
    sessionState.chatHistory = fullHistory;
    sessionState.chatHistory[msgIndex].content = substituteAllVariables(resultText);
    sessionState.chatHistory[msgIndex].swiped = true;
    sessionState.chatHistory[msgIndex].streaming = false;

    broadcast('generating_stop', {});
    sessionState.activeAttributes = null;

    if (useStreaming) {
      broadcast('stream_complete', { messageId: id, content: sessionState.chatHistory[msgIndex].content });
    } else {
      broadcast('message_updated', sessionState.chatHistory[msgIndex]);
    }

    autosaveSession();

  } catch (error) {
    console.error('[Swipe] Error:', error);
    sessionState.activeAttributes = null;
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

  const personas = loadAllPersonas() || [];
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
      // Roll personality attributes for button-triggered message
      const attrResult = rollAttributes(character);
      sessionState.activeAttributes = attrResult.active;
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'button' });

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
      sessionState.activeAttributes = null;
      broadcast('generating_stop', {});
      broadcast('message_updated', placeholderMessage);
      autosaveSession();
      await processQueuedFlowMessage();

      console.log(`[Button] Sent LLM-enhanced message from ${character.name}`);

    } catch (error) {
      console.error('[Button] LLM enhancement failed, sending raw text:', error);
      sessionState.activeAttributes = null;
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
  const { device: deviceKey, duration, interval, cycles } = action.config || action.params || {};

  console.log(`[Button] Cycle action received: deviceKey=${deviceKey}, duration=${duration}, interval=${interval}, cycles=${cycles}`);

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

  console.log(`[Button] Resolved device: id=${deviceId}, brand=${deviceObj?.brand}, deviceId=${deviceObj?.deviceId}`);

  const cycleData = {
    duration: parseInt(duration) || 5,
    interval: parseInt(interval) || 2,
    cycles: parseInt(cycles) || 0
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

/**
 * Strip cross-role content from LLM output (like SillyTavern's cleanUpMessage)
 * Removes any text after a role marker that indicates the AI started generating for the wrong role
 * @param {string} text - The generated text
 * @param {string[]} stopSequences - Role markers to stop at
 * @param {boolean} isCharacterResponse - True if this should be character text, false for player
 * @returns {string} - Cleaned text
 */
function stripCrossRoleContent(text, stopSequences = [], isCharacterResponse = true) {
  if (!text) return text;

  let result = text;

  // Check for each stop sequence and truncate if found
  for (const stopStr of stopSequences) {
    const idx = result.indexOf(stopStr);
    if (idx > 0) {
      console.log(`[Chat] Stripping cross-role content at "${stopStr}"`);
      result = result.substring(0, idx);
    }
  }

  // Also strip partial stop sequences at the end (like SillyTavern does)
  for (const stopStr of stopSequences) {
    if (stopStr.length > 0) {
      for (let j = stopStr.length - 1; j > 0; j--) {
        const partial = stopStr.slice(0, j);
        if (result.endsWith(partial)) {
          result = result.slice(0, -j);
          break;
        }
      }
    }
  }

  return result.trim();
}

async function handleChatMessage(data) {
  const { content, sender = 'player' } = data;
  console.log(`[Chat] Message received. autoReply=${sessionState.autoReply}`);

  // Load settings and personas for speaker validation
  const settings = loadData(DATA_FILES.settings);
  const personas = loadData(DATA_FILES.personas) || [];
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  // Validate speaker - player should not speak as character
  if (activeCharacter && activePersona) {
    const validation = validateSpeaker(
      content,
      'player',
      activeCharacter.name,
      activePersona.displayName || 'Player'
    );

    if (!validation.valid) {
      console.log(`[Chat] Player message failed speaker validation: ${validation.reason}`);
      broadcast('chat_validation_error', {
        reason: validation.reason,
        message: 'Please speak as yourself, not as the character.'
      });
      return; // Don't add message to history
    }
  }

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

  // Check if message contains a blocking video - parse and set blocking state
  const blockingVideoPattern = /\[Video:([^\]:]+):blocking\]/i;
  const blockingMatch = content.match(blockingVideoPattern);
  if (blockingMatch) {
    const blockingTag = blockingMatch[1].trim();
    sessionState.mediaBlocking = true;
    console.log(`[Chat] Blocking video detected in message: ${blockingTag} - skipping flows and AI response`);
    broadcast('media_blocking_update', { blocking: true, tag: blockingTag });
    return;
  }

  // Check if blocking video is already playing - skip flows and LLM
  if (sessionState.mediaBlocking) {
    console.log('[Chat] Blocking video playing - skipping flows and AI response');
    return;
  }

  // Trigger player speaks event for flow engine
  await eventEngine.handleEvent('player_speaks', { content });

  // Check if auto-reply is enabled
  if (!sessionState.autoReply) {
    console.log('[Chat] Auto Reply disabled, skipping AI response');
    return;
  }

  // Check if LLM is configured (either llmUrl for OpenAI/KoboldCPP, or OpenRouter with API key)
  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);

  console.log(`[Chat] activeCharacter=${activeCharacter?.name || 'none'}, hasLlmConfig=${hasLlmConfig ? 'yes' : 'no'}`);

  if (activeCharacter && hasLlmConfig) {
    // Notify UI that AI is generating
    broadcast('generating_start', { characterName: activeCharacter.name });

    try {
      // Roll personality attributes for this message
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'chat' });

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

        // Merge stop sequences into LLM settings
        const llmSettings = {
          ...settings.llm,
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        };

        const result = await llmService.generateStream({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: llmSettings,
          onToken: (token, fullText) => {
            // Update message content and broadcast
            aiMessage.content = fullText;
            broadcast('stream_token', { messageId: aiMessage.id, token, fullText });
          }
        });

        // Strip any cross-role content that slipped through
        finalText = stripCrossRoleContent(result.text, context.stopSequences, true);
        aiMessage.content = substituteAllVariables(finalText);

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlSettings = loadData(DATA_FILES.settings);

        // Reinforce pump control: detect pump phrases and auto-append [pump on] if needed
        const reinforceResult = aiDeviceControl.reinforcePumpControl(aiMessage.content, devices, sessionState, aiControlSettings, getCharacterLimits(activeCharacter));
        if (reinforceResult.reinforced) {
          console.log(`[Chat/Stream] Pump control reinforced - detected phrase: "${reinforceResult.matchedPhrase}"`);
          aiMessage.content = reinforceResult.text;
        }

        const aiControlResult = await aiDeviceControl.processLlmOutput(aiMessage.content, devices, deviceService, {
          settings: aiControlSettings,
          sessionState,
          broadcast,
          characterLimits: getCharacterLimits(activeCharacter),
          injectContext: (text) => {
            const lastAiMsg = sessionState.chatHistory.filter(m => m.sender === 'character').pop();
            if (lastAiMsg) lastAiMsg.content += ` ${text}`;
          }
        });
        if (aiControlResult.commands.length > 0) {
          console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
          aiMessage.content = aiControlResult.text;
          // Broadcast AI device control event for toast notification
          aiControlResult.results.forEach(r => {
            if (r.success) {
              broadcast('ai_device_control', {
                device: r.command.device,
                action: r.command.action,
                deviceName: r.device?.label || r.device?.name || r.command.device
              });
            }
          });
        }

        aiMessage.streaming = false;

        // Validate speaker - AI should speak as character, not player
        const personas = loadData(DATA_FILES.personas) || [];
        const activePersona = personas.find(p => p.id === settings?.activePersonaId);

        if (activePersona) {
          const validation = validateSpeaker(
            aiMessage.content,
            'character',
            activeCharacter.name,
            activePersona.displayName || 'Player'
          );

          if (!validation.valid) {
            console.log(`[Chat/Stream] AI message failed speaker validation: ${validation.reason} - DELETING AND RETRYING`);

            // Remove message from history
            const messageIndex = sessionState.chatHistory.findIndex(m => m.id === aiMessage.id);
            if (messageIndex !== -1) {
              sessionState.chatHistory.splice(messageIndex, 1);
            }

            // Broadcast deletion
            broadcast('message_deleted', { id: aiMessage.id });
            broadcast('generating_end');

            // Retry generation (recursive call with retry tracking)
            if (!data._speakerRetryCount || data._speakerRetryCount < 3) {
              console.log(`[Chat/Stream] Retrying generation (attempt ${(data._speakerRetryCount || 0) + 1}/3)`);
              await handleChatMessage({
                ...data,
                _speakerRetryCount: (data._speakerRetryCount || 0) + 1
              });
            } else {
              console.log('[Chat/Stream] Max speaker validation retries reached - giving up');
              broadcast('chat_validation_error', {
                reason: 'AI repeatedly spoke as wrong character',
                message: 'AI generation failed speaker validation after multiple attempts.'
              });
            }
            return; // Exit this generation attempt
          }
        }

        // Broadcast final message state
        broadcast('stream_complete', { messageId: aiMessage.id, content: aiMessage.content });

      } else {
        // Non-streaming mode - merge stop sequences into settings
        const llmSettings = {
          ...settings.llm,
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        };

        const result = await llmService.generate({
          prompt: context.prompt,
          systemPrompt: context.systemPrompt,
          settings: llmSettings
        });
        // Strip any cross-role content
        finalText = stripCrossRoleContent(result.text, context.stopSequences, true);
      }

      let retryCount = 0;
      const maxRetries = 3;

      // Get persona for speaker validation
      const personas = loadData(DATA_FILES.personas) || [];
      const activePersona = personas.find(p => p.id === settings?.activePersonaId);

      // Retry if blank, duplicate, or wrong speaker (only in non-streaming mode)
      while (!useStreaming && retryCount < maxRetries) {
        const isBlank = isBlankMessage(finalText);
        const isDupe = isDuplicateMessage(finalText);

        let speakerValidation = { valid: true };
        if (activePersona) {
          speakerValidation = validateSpeaker(
            finalText,
            'character',
            activeCharacter.name,
            activePersona.displayName || 'Player'
          );
        }

        if (!isBlank && !isDupe && speakerValidation.valid) {
          break; // All validations passed
        }

        retryCount++;
        console.log(`[Chat] Regenerating (attempt ${retryCount}): blank=${isBlank}, duplicate=${isDupe}, wrongSpeaker=${!speakerValidation.valid}`);
        if (!speakerValidation.valid) {
          console.log(`[Chat] Speaker validation failed: ${speakerValidation.reason}`);
        }

        const retryContext = buildChatContext(activeCharacter, settings);
        retryContext.systemPrompt += '\n\nIMPORTANT: Write a UNIQUE response. Do not repeat previous messages. Speak as the character, not as the player.';

        const retryResult = await llmService.generate({
          prompt: retryContext.prompt,
          systemPrompt: retryContext.systemPrompt,
          settings: settings.llm
        });
        finalText = stripCrossRoleContent(retryResult.text, context.stopSequences, true);
      }

      console.log('[Chat] Got AI response:', finalText?.substring(0, 50) + '...');

      // Skip if still invalid after retries (non-streaming only - streaming messages are already in history)
      if (!useStreaming) {
        const isBlank = isBlankMessage(finalText);
        const isDupe = isDuplicateMessage(finalText);

        let speakerValidation = { valid: true };
        if (activePersona) {
          speakerValidation = validateSpeaker(
            finalText,
            'character',
            activeCharacter.name,
            activePersona.displayName || 'Player'
          );
        }

        if (isBlank || isDupe || !speakerValidation.valid) {
          const reason = isBlank ? 'blank' : (isDupe ? 'duplicate' : 'wrong speaker');
          console.log(`[Chat] Skipping invalid AI response after retries - ${reason}`);
          if (!speakerValidation.valid) {
            console.log(`[Chat] Final speaker validation: ${speakerValidation.reason}`);
          }
          broadcast('generating_stop', {});
          broadcast('chat_validation_error', {
            reason: speakerValidation.reason || `AI generated ${reason} response`,
            message: 'AI generation failed validation after multiple attempts.'
          });
          return;
        }
      }

      // For non-streaming, add message now
      if (!useStreaming) {
        // Apply variable substitution to final text
        finalText = substituteAllVariables(finalText);

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlSettings = loadData(DATA_FILES.settings);

        // Reinforce pump control: detect pump phrases and auto-append [pump on] if needed
        const reinforceResult = aiDeviceControl.reinforcePumpControl(finalText, devices, sessionState, aiControlSettings, getCharacterLimits(activeCharacter));
        if (reinforceResult.reinforced) {
          console.log(`[Chat/NonStream] Pump control reinforced - detected phrase: "${reinforceResult.matchedPhrase}"`);
          finalText = reinforceResult.text;
        }

        const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService, {
          settings: aiControlSettings,
          sessionState,
          broadcast,
          characterLimits: getCharacterLimits(activeCharacter),
          injectContext: (text) => {
            const lastAiMsg = sessionState.chatHistory.filter(m => m.sender === 'character').pop();
            if (lastAiMsg) lastAiMsg.content += ` ${text}`;
          }
        });
        if (aiControlResult.commands.length > 0) {
          console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
          finalText = aiControlResult.text;
          // Broadcast AI device control event for toast notification
          aiControlResult.results.forEach(r => {
            if (r.success) {
              broadcast('ai_device_control', {
                device: r.command.device,
                action: r.command.action,
                deviceName: r.device?.label || r.device?.name || r.command.device
              });
            }
          });
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
      sessionState.activeAttributes = null;
      autosaveSession();

      // Trigger AI speaks event for flow engine
      const lastMsg = sessionState.chatHistory[sessionState.chatHistory.length - 1];
      await eventEngine.handleEvent('ai_speaks', { content: lastMsg?.content });

      // Story Progression: generate player reply suggestions if enabled
      try {
        const activeStoryId = activeCharacter.activeStoryId || activeCharacter.stories?.[0]?.id;
        const activeStory = activeCharacter.stories?.find(s => s.id === activeStoryId) || activeCharacter.stories?.[0];
        if (activeStory?.storyProgressionEnabled && eventEngine.activeExecutions.size === 0) {
          generateStoryProgressionSuggestions(activeCharacter, settings);
        }
      } catch (spErr) {
        console.error('[StoryProgression] Error checking/triggering:', spErr.message);
      }

    } catch (error) {
      console.error('[Chat] LLM error:', error.message);
      sessionState.activeAttributes = null;
      broadcast('generating_stop', {});
      broadcast('error', { message: 'Failed to generate AI response', error: error.message });
    }
  }
}

/**
 * Generate story progression suggestions - player reply options with different emotional angles
 */
async function generateStoryProgressionSuggestions(activeCharacter, settings) {
  try {
    if (eventEngine.activeExecutions.size > 0) {
      console.log('[StoryProgression] Skipping — flow in progress');
      return;
    }

    const personas = loadAllPersonas() || [];
    const activePersona = personas.find(p => p.id === settings?.activePersonaId);
    const playerName = activePersona?.displayName || 'The player';

    const activeStoryId = activeCharacter.activeStoryId || activeCharacter.stories?.[0]?.id;
    const activeStory = activeCharacter.stories?.find(s => s.id === activeStoryId) || activeCharacter.stories?.[0];
    const maxOptions = Math.min(activeStory?.storyProgressionMaxOptions || 3, 5);

    // Get current emotion and adjacent emotions
    const currentEmotion = sessionState.emotion || 'neutral';
    const adjacent = EMOTION_ADJACENCY[currentEmotion] || ['curious', 'shy', 'anxious'];

    // Pick emotions: current + enough adjacent to fill maxOptions
    const emotions = [currentEmotion, ...adjacent.slice(0, maxOptions - 1)];

    // Build context using impersonate mode
    const context = buildSpecialContext('impersonate', null, activeCharacter, activePersona, settings);

    // Build the suggestion generation prompt
    const recentMessages = sessionState.chatHistory.slice(-4).map(m => {
      const name = m.sender === 'character' ? (m.characterName || activeCharacter.name) : playerName;
      return `${name}: ${m.content}`;
    }).join('\n');

    // Build physical state context for the task section
    const capacity = Math.round(sessionState.capacity || 0);
    const painLevel = sessionState.pain || 0;
    const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
    const painLabel = painLabels[painLevel] || 'None';
    let physicalStateNote = '';
    if (capacity > 0 || painLevel > 0) {
      physicalStateNote = `\n${playerName}'s current physical state: belly at ${capacity}% capacity, pain level "${painLabel}" (${painLevel}/10).
Each reply option MUST reflect this physical state — responses should include appropriate physical reactions, discomfort, or awareness of their belly's condition.\n`;
    }

    const suggestionPrompt = `${context.systemPrompt}

${context.prompt}

=== TASK ===
Based on the recent conversation:
${recentMessages}
${physicalStateNote}
Generate exactly ${maxOptions} different short reply options for ${playerName} responding to what just happened.
Each option should reflect a different emotional approach.
Emotions to use: ${emotions.join(', ')}

Format EACH option exactly as:
OPTION 1 (${emotions[0]}): Short label describing the approach
"The actual dialogue and *actions* for the reply"

OPTION 2 (${emotions[1] || emotions[0]}): Short label describing the approach
"The actual dialogue and *actions* for the reply"

${emotions.slice(2).map((e, i) => `OPTION ${i + 3} (${e}): Short label describing the approach\n"The actual dialogue and *actions* for the reply"\n`).join('\n')}
Keep each reply SHORT (1-3 sentences). Include both dialogue and brief *action* descriptions where appropriate.`;

    const suggestionSettings = {
      ...settings.llm,
      stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
    };
    // Cap tokens: enough for all options
    const perOptionTokens = settings.llm?.impersonateMaxTokens || 100;
    suggestionSettings.maxTokens = perOptionTokens * maxOptions + 100;

    console.log(`[StoryProgression] Generating ${maxOptions} suggestions for ${playerName} (emotions: ${emotions.join(', ')})`);
    broadcast('story_progression_generating', { count: maxOptions });

    const result = await llmService.generate({
      prompt: suggestionPrompt,
      systemPrompt: '',
      settings: suggestionSettings
    });

    console.log(`[StoryProgression] Raw LLM response (first 2000 chars): ${result.text?.substring(0, 2000)}`);

    // Parse the response into structured options
    let suggestions = [];
    const responseText = result.text || '';

    // Split into option blocks by looking for OPTION headers or numbered items
    // Pattern handles: OPTION N (emotion): label, N. (emotion): label, N) emotion - label
    // Allows optional markdown bold (**), spaces before separators, multi-word emotions with underscores
    const optionHeaderPattern = /(?:^|\n)\s*\*{0,2}(?:OPTION\s+\d+\s*\((\w+)\)\s*[:\-]\s*(.+)|(\d+)[\.\)]\s*\*{0,2}\(?(\w+)\)?\s*[:\-]\s*(.+))/gi;
    const headers = [];
    let headerMatch;
    while ((headerMatch = optionHeaderPattern.exec(responseText)) !== null) {
      headers.push({
        index: headerMatch.index,
        emotion: (headerMatch[1] || headerMatch[4] || '').toLowerCase().replace(/\*+/g, ''),
        label: (headerMatch[2] || headerMatch[5] || '').trim().replace(/\*+/g, ''),
        fullMatch: headerMatch[0]
      });
    }

    // Fallback: if primary pattern found nothing, try a simpler line-by-line parse
    // Looks for lines starting with a number followed by text containing an emotion keyword
    if (headers.length === 0 && emotions.length > 0) {
      const lines = responseText.split('\n');
      let currentHeader = null;
      let currentBody = [];

      for (const line of lines) {
        const trimmed = line.trim().replace(/\*+/g, '');
        // Check if line starts with a number (option header)
        const numMatch = trimmed.match(/^(\d+)[\.\)\-:]\s*(.*)/);
        if (numMatch) {
          // Save previous option
          if (currentHeader) {
            const bodyText = currentBody.join(' ').trim();
            if (bodyText) headers.push({ ...currentHeader, bodyText });
          }
          // Detect emotion from the header text
          const headerText = numMatch[2].toLowerCase();
          let detectedEmotion = '';
          for (const em of emotions) {
            if (headerText.includes(em)) { detectedEmotion = em; break; }
          }
          // Extract label: everything after the emotion keyword or the whole header
          let label = numMatch[2].replace(/[""\u201C\u201D\(\)]/g, '').trim();
          if (detectedEmotion) {
            const emIdx = label.toLowerCase().indexOf(detectedEmotion);
            if (emIdx >= 0) label = label.substring(emIdx + detectedEmotion.length).replace(/^[\s:\-]+/, '').trim();
          }
          currentHeader = {
            index: 0,
            emotion: detectedEmotion || emotions[headers.length] || emotions[0],
            label: label || `(${detectedEmotion || 'option'})`,
            fullMatch: line
          };
          currentBody = [];
        } else if (currentHeader && trimmed) {
          currentBody.push(trimmed);
        }
      }
      // Save last option
      if (currentHeader) {
        const bodyText = currentBody.join(' ').trim();
        if (bodyText) headers.push({ ...currentHeader, bodyText });
      }
      if (headers.length > 0) {
        console.log(`[StoryProgression] Fallback parser found ${headers.length} options`);
      }
    }

    // Extract text for each option (everything between this header and the next)
    for (let i = 0; i < headers.length; i++) {
      // If fallback parser already extracted body text, use it
      if (headers[i].bodyText) {
        let text = headers[i].bodyText.replace(/^[""\u201C]+|[""\u201D]+$/g, '').trim();
        if (text && headers[i].emotion) {
          suggestions.push({
            emotion: headers[i].emotion,
            label: headers[i].label.replace(/[""\u201C\u201D]/g, '').trim() || `(${headers[i].emotion})`,
            text
          });
        }
        continue;
      }

      const startIdx = headers[i].index + headers[i].fullMatch.length;
      const endIdx = i + 1 < headers.length ? headers[i + 1].index : responseText.length;
      const bodyText = responseText.substring(startIdx, endIdx).trim();

      // Clean up: strip quotes, collapse whitespace
      let text = bodyText.replace(/^[""\u201C]+|[""\u201D]+$/g, '').trim();
      // If multi-line, join
      text = text.split('\n').map(l => l.trim()).filter(l => l).join(' ');
      // Strip outer quotes again after joining
      text = text.replace(/^[""\u201C]+|[""\u201D]+$/g, '').trim();

      if (text && headers[i].emotion) {
        suggestions.push({
          emotion: headers[i].emotion,
          label: headers[i].label.replace(/[""\u201C\u201D]/g, '').trim() || `(${headers[i].emotion})`,
          text
        });
      }
    }

    console.log(`[StoryProgression] Parsed ${suggestions.length}/${maxOptions} suggestions`);

    // Filter out any without text
    suggestions = suggestions.filter(s => s.text && s.text.length > 0);

    // Pad to maxOptions if we got fewer than expected
    while (suggestions.length < maxOptions && suggestions.length > 0) {
      const padEmotion = emotions[suggestions.length] || emotions[0];
      suggestions.push({
        emotion: padEmotion,
        label: `(${padEmotion} response)`,
        text: suggestions[0].text
      });
    }

    if (suggestions.length > 0) {
      // Trim to maxOptions in case we parsed extra
      const finalSuggestions = suggestions.slice(0, maxOptions);
      console.log(`[StoryProgression] Generated ${finalSuggestions.length} suggestions`);
      broadcast('story_progression_suggestions', { suggestions: finalSuggestions });
    } else {
      console.log('[StoryProgression] Failed to parse suggestions from LLM response');
      broadcast('story_progression_generating_done', {});
    }
  } catch (error) {
    console.error('[StoryProgression] Error generating suggestions:', error.message);
    broadcast('story_progression_generating_done', {});
  }
}

/**
 * Generate AI response after blocking video ends
 * This is called when a blocking video finishes to respond to the queued player message
 */
async function generateAIResponseAfterBlocking() {
  const settings = loadData(DATA_FILES.settings);
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);

  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey);

  if (!activeCharacter || !hasLlmConfig) {
    console.log('[Media] No character or LLM configured - skipping post-blocking response');
    return;
  }

  // Notify UI that AI is generating
  broadcast('generating_start', { characterName: activeCharacter.name });

  try {
    // Roll personality attributes for post-blocking response
    const attrResult = rollAttributes(activeCharacter);
    sessionState.activeAttributes = attrResult.active;
    if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'post-block' });

    const context = buildChatContext(activeCharacter, settings);
    console.log('[Media] Generating AI response after blocking ended...');

    const useStreaming = settings?.llm?.streamResponse !== false;
    let finalText = '';

    if (useStreaming) {
      const streamMsgId = uuidv4();
      const aiMessage = {
        id: streamMsgId,
        content: '',
        sender: 'character',
        characterId: activeCharacter.id,
        characterName: activeCharacter.name,
        timestamp: Date.now(),
        streaming: true
      };
      sessionState.chatHistory.push(aiMessage);
      broadcast('chat_message', aiMessage);

      const llmSettings = {
        ...settings.llm,
        stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
      };

      finalText = await llmService.generateStream({
        prompt: context.prompt,
        systemPrompt: context.systemPrompt,
        settings: llmSettings,
        onChunk: (chunk) => {
          const streamMsg = sessionState.chatHistory.find(m => m.id === streamMsgId);
          if (streamMsg) {
            streamMsg.content += chunk;
            broadcast('chat_chunk', { id: streamMsgId, chunk, content: streamMsg.content });
          }
        }
      });

      const streamMsg = sessionState.chatHistory.find(m => m.id === streamMsgId);
      if (streamMsg) {
        streamMsg.content = stripCrossRoleContent(finalText, context.stopSequences, true);
        streamMsg.content = substituteAllVariables(streamMsg.content);
        streamMsg.streaming = false;
        broadcast('chat_complete', { id: streamMsgId, content: streamMsg.content });
      }
    } else {
      const llmSettings = {
        ...settings.llm,
        stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
      };

      const result = await llmService.generate({
        prompt: context.prompt,
        systemPrompt: context.systemPrompt,
        settings: llmSettings
      });
      finalText = stripCrossRoleContent(result.text, context.stopSequences, true);
      finalText = substituteAllVariables(finalText);

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
    sessionState.activeAttributes = null;
    autosaveSession();

    // Trigger AI speaks event for flow engine
    const lastMsg = sessionState.chatHistory[sessionState.chatHistory.length - 1];
    await eventEngine.handleEvent('ai_speaks', { content: lastMsg?.content });

  } catch (error) {
    console.error('[Media] LLM error after blocking:', error.message);
    sessionState.activeAttributes = null;
    broadcast('generating_stop', {});
    broadcast('error', { message: 'Failed to generate AI response', error: error.message });
  }
}

async function handleSpecialGenerate(data) {
  const { mode, guidedText } = data;

  const settings = loadData(DATA_FILES.settings);
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadAllPersonas() || [];
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
    // Roll personality attributes for character voice only (not impersonate)
    if (!isPlayerVoice) {
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'guided' });
    }

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
      const aiControlSettings = loadData(DATA_FILES.settings);

      // Reinforce pump control: detect pump phrases and auto-append [pump on] if needed
      const reinforceResult = aiDeviceControl.reinforcePumpControl(message.content, devices, sessionState, aiControlSettings, getCharacterLimits(activeCharacter));
      if (reinforceResult.reinforced) {
        console.log(`[SpecialGen/Stream] Pump control reinforced - detected phrase: "${reinforceResult.matchedPhrase}"`);
        message.content = reinforceResult.text;
      }

      const aiControlResult = await aiDeviceControl.processLlmOutput(message.content, devices, deviceService, {
        settings: aiControlSettings,
        sessionState,
        broadcast,
        characterLimits: getCharacterLimits(activeCharacter),
        injectContext: (text) => {
          const lastAiMsg = sessionState.chatHistory.filter(m => m.sender === 'character').pop();
          if (lastAiMsg) lastAiMsg.content += ` ${text}`;
        }
      });
      if (aiControlResult.commands.length > 0) {
        console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
        message.content = aiControlResult.text;
        // Broadcast AI device control event for toast notification
        aiControlResult.results.forEach(r => {
          if (r.success) {
            broadcast('ai_device_control', {
              device: r.command.device,
              action: r.command.action,
              deviceName: r.device?.label || r.device?.name || r.command.device
            });
          }
        });
      }

      message.streaming = false;

      broadcast('stream_complete', { messageId: message.id, content: message.content });
      broadcast('generating_stop', {});
      sessionState.activeAttributes = null;
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
    const aiControlSettings = loadData(DATA_FILES.settings);

    // Reinforce pump control: detect pump phrases and auto-append [pump on] if needed
    const reinforceResult = aiDeviceControl.reinforcePumpControl(finalText, devices, sessionState, aiControlSettings, getCharacterLimits(activeCharacter));
    if (reinforceResult.reinforced) {
      console.log(`[SpecialGen/NonStream] Pump control reinforced - detected phrase: "${reinforceResult.matchedPhrase}"`);
      finalText = reinforceResult.text;
    }

    const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService, {
      settings: aiControlSettings,
      sessionState,
      broadcast,
      characterLimits: getCharacterLimits(activeCharacter),
      injectContext: (text) => {
        const lastAiMsg = sessionState.chatHistory.filter(m => m.sender === 'character').pop();
        if (lastAiMsg) lastAiMsg.content += ` ${text}`;
      }
    });
    if (aiControlResult.commands.length > 0) {
      console.log(`[AIDeviceControl] Executed ${aiControlResult.commands.length} device command(s)`);
      finalText = aiControlResult.text;
      // Broadcast AI device control event for toast notification
      aiControlResult.results.forEach(r => {
        if (r.success) {
          broadcast('ai_device_control', {
            device: r.command.device,
            action: r.command.action,
            deviceName: r.device?.label || r.device?.name || r.command.device
          });
        }
      });
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
    sessionState.activeAttributes = null;
    sessionState.chatHistory.push(message);
    broadcast('chat_message', message);
    autosaveSession();

  } catch (error) {
    console.error('[Special Generate] Error:', error);
    sessionState.activeAttributes = null;
    broadcast('generating_stop', {});
    broadcast('error', { message: 'Failed to generate', error: error.message });
  }
}

async function handleImpersonateRequest(data) {
  const { guidedText } = data;

  const settings = loadData(DATA_FILES.settings);
  // Use per-char storage if active, otherwise fall back to legacy
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const personas = loadAllPersonas() || [];
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

    const impersonateSettings = {
      ...settings.llm,
      stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
    };
    if (settings.llm?.impersonateMaxTokens) {
      impersonateSettings.maxTokens = settings.llm.impersonateMaxTokens;
    }

    const result = await llmService.generate({
      prompt: context.prompt,
      systemPrompt: context.systemPrompt,
      settings: impersonateSettings
    });

    // Strip any cross-role content and apply variable substitution
    let finalText = stripCrossRoleContent(result.text, context.stopSequences, false);
    const substitutedText = substituteAllVariables(finalText);
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

/**
 * Build minimal context for action wrapper messages (no chat history)
 * Keeps the LLM focused on the action topic without continuing previous conversation
 */
function buildActionWrapperContext(character, persona, settings, isPlayerVoice) {
  const playerName = persona?.displayName || 'the player';
  const speakerName = isPlayerVoice ? playerName : character.name;

  // Minimal system prompt - just character identity and current state
  let systemPrompt = isPlayerVoice
    ? `You are writing as ${playerName}, a player character.\n`
    : `You are ${character.name}. ${character.description}\n`;

  systemPrompt += `\nPersonality: ${isPlayerVoice ? (persona?.personality || 'a willing participant') : character.personality}\n`;

  // Add current capacity state
  if (sessionState.capacity !== undefined) {
    const capacity = Math.round(sessionState.capacity);
    const subject = isPlayerVoice ? 'Your' : `${playerName}'s`;
    systemPrompt += `\n${subject} belly is currently at ${capacity}% capacity.\n`;
  }

  // Key instruction: do NOT continue conversation, just perform the action
  systemPrompt += `\n=== ACTION WRAPPER INSTRUCTIONS ===
This is a standalone action message. DO NOT:
- Continue or reply to any previous conversation
- Reference what was just said before
- Ask questions or wait for responses

JUST perform the described action directly, as if starting a new scene focused solely on this moment.
Keep responses SHORT and focused (2-3 sentences max).
=== END INSTRUCTIONS ===\n`;

  // Minimal prompt - just the speaker tag
  const prompt = isPlayerVoice ? '[Player]:' : `${character.name}:`;

  return { systemPrompt, prompt };
}

const ATTRIBUTE_PROMPTS = {
  dominant: 'Take control of the situation. Be assertive, commanding, and decisive. Direct the scene rather than following.',
  sadistic: 'Be cruel, teasing, and take pleasure in discomfort. Push boundaries and enjoy reactions.',
  psychopathic: 'Be unhinged, unpredictable, and unsettling. Disregard normal social boundaries completely.',
  sensual: 'Be caring, tender, and amorous. Focus on intimacy, touch, and emotional connection.',
  sexual: 'Be overtly aroused and flirtatious. Express desire and physical attraction openly.'
};

function rollAttributes(character) {
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const attributes = activeStory?.attributes;
  if (!attributes) return { active: [], rolls: [] };
  const active = [];
  const rolls = [];
  for (const [trait, chance] of Object.entries(attributes)) {
    if (chance > 0) {
      const rolled = Math.random() * 100;
      const passed = rolled < chance;
      rolls.push({ trait, chance, rolled: Math.round(rolled), passed });
      if (passed) active.push(trait);
    }
  }
  return { active, rolls };
}

function buildAttributeBlock(activeAttributes) {
  if (!activeAttributes || activeAttributes.length === 0) return '';
  const labels = activeAttributes.map(t => t.charAt(0).toUpperCase() + t.slice(1));
  let block = `\n=== CHARACTER DRIVE (THIS MESSAGE) ===\nThis response must be noticeably driven by: ${labels.join(', ')}\n`;
  for (const trait of activeAttributes) {
    const label = trait.charAt(0).toUpperCase() + trait.slice(1);
    block += `- ${label}: ${ATTRIBUTE_PROMPTS[trait]}\n`;
  }
  block += `=== END CHARACTER DRIVE ===\n`;
  return block;
}

function getActiveCheckpoint(character, capacity) {
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const checkpoints = activeStory?.checkpoints;
  if (!checkpoints) return null;

  let rangeKey;
  if (capacity <= 0) rangeKey = '0';
  else if (capacity <= 10) rangeKey = '1-10';
  else if (capacity <= 20) rangeKey = '11-20';
  else if (capacity <= 30) rangeKey = '21-30';
  else if (capacity <= 40) rangeKey = '31-40';
  else if (capacity <= 50) rangeKey = '41-50';
  else if (capacity <= 60) rangeKey = '51-60';
  else if (capacity <= 70) rangeKey = '61-70';
  else if (capacity <= 80) rangeKey = '71-80';
  else if (capacity <= 90) rangeKey = '81-90';
  else if (capacity <= 100) rangeKey = '91-100';
  else rangeKey = '100+';

  const text = checkpoints[rangeKey]?.trim();
  const preInflation = checkpoints['0']?.trim();
  return { text: text || null, preInflation: (capacity <= 0 && preInflation) ? preInflation : null };
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

  // Build belly state instructions — scaled by capacity to save prompt space
  const buildBellyStateInstructions = (capacity, painLevel, subjectName, isFirstPerson = false) => {
    const bellyDesc = getCapacityDescription(capacity);
    const subject = isFirstPerson ? 'Your' : `${subjectName}'s`;
    const verb = isFirstPerson ? 'are' : 'is';
    const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
    const painLabel = painLabels[painLevel] || 'None';

    // At 0% with no pain, minimal instruction needed
    if (capacity <= 0 && painLevel <= 0) {
      return `\n${subject} belly ${verb} flat and normal. No pain or discomfort.\n`;
    }

    let instructions = `\nBELLY STATE: ${subject} belly ${verb} at EXACTLY ${capacity}% capacity: ${bellyDesc}. Pain: ${painLabel} (${painLevel}/10).\n`;
    instructions += `- The ONLY capacity number you may use is ${capacity}%. Do NOT write any other percentage.\n`;

    if (capacity > 25) {
      instructions += `- Belly state is fixed — do not describe it changing, growing, or deflating.\n`;
    }
    if (capacity <= 50 && capacity > 0) {
      instructions += `- Do not exaggerate — no "enormous", "massive", "about to burst" below 85%.\n`;
    }

    return instructions;
  };

  if (mode === 'impersonate' || mode === 'guided_impersonate') {
    // Generate as the player
    systemPrompt = `You are ${playerName}, the player character. Write ONLY as ${playerName} — never write for ${character.name}.\n\n`;
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

    // Add active reminders (using reminder engine for keyword-based activation)
    const recentMessagesImp = reminderEngine.extractRecentMessages(sessionState.chatHistory, 20);
    const activeRemindersImp = reminderEngine.getMergedActiveReminders(
      character.constantReminders || [],
      settings.globalReminders || [],
      recentMessagesImp
    );
    if (activeRemindersImp.length > 0) {
      systemPrompt += reminderEngine.buildReminderPrompt(activeRemindersImp, 'Active Reminders');
    }

    systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerName, true);

    // Inject capacity checkpoints
    const checkpointImp = getActiveCheckpoint(character, sessionState.capacity);
    if (checkpointImp?.preInflation) {
      systemPrompt += `\n=== PRE-INFLATION REQUIREMENT ===\nDo NOT activate the pump, begin inflation, or use [pump on] tags until the following has been accomplished:\n${checkpointImp.preInflation}\n=== END PRE-INFLATION REQUIREMENT ===\n`;
    }
    if (checkpointImp?.text) {
      systemPrompt += `\n=== CHARACTER CHECKPOINT ===\nCurrent guidance for this capacity range:\n${checkpointImp.text}\n=== END CHECKPOINT ===\n`;
    }

    systemPrompt += `You emotionally feel ${sessionState.emotion}.\n\n`;

    // Add global prompt / author note
    if (settings?.globalPrompt) {
      systemPrompt += `Author Note: ${settings.globalPrompt}\n\n`;
    }

    systemPrompt += `Write ${playerName}'s next response. Stay in character and be descriptive.\n`;
    systemPrompt += `FORMAT: Use "dialogue in quotes" and *actions in asterisks*. Break longer responses into short paragraphs with line breaks for readability.`;
  } else {
    // Guided response - generate as character
    if (character.multiChar?.enabled) {
      systemPrompt = buildMultiCharSystemPrompt(character, playerName, substituteVars);
    } else {
      systemPrompt = `You are ${character.name}. ${substituteVars(character.description)}\n`;
      systemPrompt += `Write ONLY as ${character.name} — never write for ${playerName}. Use first person in dialogue, third person for actions.\n`;
      systemPrompt += `Personality: ${substituteVars(character.personality)}\n`;
    }
    const scenario = getActiveScenario(character);
    if (scenario) systemPrompt += `Scenario: ${substituteVars(scenario)}\n`;
    systemPrompt += '\n';

    systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerName, false);

    // Inject capacity checkpoints
    const checkpointGuided = getActiveCheckpoint(character, sessionState.capacity);
    if (checkpointGuided?.preInflation) {
      systemPrompt += `\n=== PRE-INFLATION REQUIREMENT ===\nDo NOT activate the pump, begin inflation, or use [pump on] tags until the following has been accomplished:\n${checkpointGuided.preInflation}\n=== END PRE-INFLATION REQUIREMENT ===\n`;
    }
    if (checkpointGuided?.text) {
      systemPrompt += `\n=== CHARACTER CHECKPOINT ===\nCurrent guidance for this capacity range:\n${checkpointGuided.text}\n=== END CHECKPOINT ===\n`;
    }

    systemPrompt += `${playerName} emotionally feels ${sessionState.emotion}.\n\n`;

    // Add active reminders (using reminder engine for keyword-based activation)
    const recentMessagesGuided = reminderEngine.extractRecentMessages(sessionState.chatHistory, 20);
    const activeRemindersGuided = reminderEngine.getMergedActiveReminders(
      character.constantReminders || [],
      settings.globalReminders || [],
      recentMessagesGuided
    );
    if (activeRemindersGuided.length > 0) {
      systemPrompt += reminderEngine.buildReminderPrompt(activeRemindersGuided, 'Active Reminders');
    }

    // Add global prompt / author note
    if (settings?.globalPrompt) {
      systemPrompt += `Author Note: ${settings.globalPrompt}\n\n`;
    }

    // Add LLM device control instructions if enabled
    if (settings?.globalCharacterControls?.allowLlmDeviceControl) {
      const globalMax = settings.globalCharacterControls.llmDeviceControlMaxSeconds || 30;
      const charLimits = getCharacterLimits(character);
      const maxSeconds = charLimits ? Math.min(globalMax, charLimits.llmMaxOnDuration ?? Infinity) : globalMax;
      let devicePrompt = `\nDEVICE CONTROL: Include hidden tags when activating/deactivating devices.
Tags: [pump on]/[pump off], [vibe on]/[vibe off], [tens on]/[tens off]
Example: "*activates the pump* [pump on] Now let's begin..." (hidden from player, auto-timeout ${maxSeconds}s)`;
      if (charLimits) {
        devicePrompt += `\nLimits: max ON ${charLimits.llmMaxOnDuration ?? 5}s, max pulse ${charLimits.llmMaxPulseRepetitions ?? 5}x, max timed ${charLimits.llmMaxTimedDuration ?? 10}s, max cycle ON ${charLimits.llmMaxCycleOnDuration ?? 2}s x${charLimits.llmMaxCycleRepetitions ?? 2}`;
      }
      systemPrompt += devicePrompt + '\n';
    }

    // Inject personality attributes if rolled (character voice only)
    if (sessionState.activeAttributes?.length > 0) {
      systemPrompt += buildAttributeBlock(sessionState.activeAttributes);
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
      // Add guidance prominently in prompt and system prompt
      prompt += `\n[Direction: ${guidedText}]\n`;
      prompt += `${speakerTag}:`;
      systemPrompt += `\n\n**CRITICAL GUIDANCE - THIS IS YOUR PRIMARY DIRECTIVE:**
Your response MUST be about: "${guidedText}"
- This is the central focus of your message - not just a suggestion
- Your entire response should directly address or embody this direction
- Do NOT repeat the guidance text verbatim, but make it the core subject matter
- Everything you write should relate back to this guidance`;
    } else {
      // No guidance - just signal the speaker's turn with a clear newline
      prompt += `\n${speakerTag}:`;
    }
  } else if (mode === 'impersonate') {
    // For pure impersonate - generate as player
    prompt += `\n[Player]:`;
  } else {
    // Default - generate as character
    prompt += `\n[Char]:`;
  }

  // Build stop sequences to prevent cross-role generation
  const isPlayerVoice = mode === 'impersonate' || mode === 'guided_impersonate';
  const stopSequences = isPlayerVoice
    ? [`\n[Char]:`, `\n${character.name}:`, `[Char]:`, `${character.name}:`]
    : [`\n[Player]:`, `\n${playerName}:`, `[Player]:`, `${playerName}:`];

  return { systemPrompt, prompt, stopSequences, playerName, characterName: character.name };
}

// Build system prompt for multi-character cards
function buildMultiCharSystemPrompt(character, playerName, substituteVars) {
  const chars = character.multiChar.characters;
  const names = chars.map(c => c.name).join(', ');

  let prompt = `You are a collaborative fiction writer portraying: ${names}.\n`;
  prompt += `Write realistic, natural roleplay. Use "dialogue in quotes" and *actions/descriptions in asterisks*. Break responses into short paragraphs.\n\n`;
  prompt += `CHARACTERS:\n`;
  for (const c of chars) {
    prompt += `- ${c.name}: ${substituteVars(c.description)}\n`;
    if (c.personality) {
      prompt += `  Personality: ${substituteVars(c.personality)}\n`;
    }
  }
  prompt += `\nRULES:\n`;
  prompt += `- Write ONLY for ${names}. NEVER write dialogue or actions for ${playerName}.\n`;
  prompt += `- Attribute dialogue and actions to characters by name.\n`;
  prompt += `- Keep dialogue natural and concise — people speak in short sentences, not paragraphs.\n`;
  prompt += `\nCONVERSATION DYNAMICS (important):\n`;
  prompt += `- Vary which characters speak each turn. 1-2 characters per response is ideal; only use 3+ when genuinely needed.\n`;
  prompt += `- Characters who just spoke recently can stay silent while others take the lead.\n`;
  prompt += `- Let conversations shift naturally — a character can initiate a new topic, react to something unexpected, or redirect the scene.\n`;
  prompt += `- Characters can disagree, interrupt, go off on tangents, or have side conversations.\n`;
  prompt += `- Sometimes only ONE character responds — the others are busy, distracted, or simply have nothing to add.\n`;
  prompt += `- Avoid the pattern of every character commenting on the same thing in sequence. Real groups don't take orderly turns.\n`;
  prompt += `\n`;
  return prompt;
}

function buildChatContext(character, settings) {
  const personas = loadAllPersonas() || [];
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

  // Build belly state instructions — scaled by capacity to save prompt space
  const buildBellyStateInstructions = (capacity, painLevel, subjectName, isFirstPerson = false) => {
    const bellyDesc = getCapacityDescription(capacity);
    const subject = isFirstPerson ? 'Your' : `${subjectName}'s`;
    const verb = isFirstPerson ? 'are' : 'is';
    const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
    const painLabel = painLabels[painLevel] || 'None';

    // At 0% with no pain, minimal instruction needed
    if (capacity <= 0 && painLevel <= 0) {
      return `\n${subject} belly ${verb} flat and normal. No pain or discomfort.\n`;
    }

    let instructions = `\nBELLY STATE: ${subject} belly ${verb} at EXACTLY ${capacity}% capacity: ${bellyDesc}. Pain: ${painLabel} (${painLevel}/10).\n`;
    instructions += `- The ONLY capacity number you may use is ${capacity}%. Do NOT write any other percentage.\n`;

    if (capacity > 25) {
      instructions += `- Belly state is fixed — do not describe it changing, growing, or deflating.\n`;
    }
    if (capacity <= 50 && capacity > 0) {
      instructions += `- Do not exaggerate — no "enormous", "massive", "about to burst" below 85%.\n`;
    }

    return instructions;
  };

  // Build system prompt from character
  let systemPrompt;
  if (character.multiChar?.enabled) {
    systemPrompt = buildMultiCharSystemPrompt(character, playerName, substituteVars);
  } else {
    systemPrompt = `You are ${character.name}. ${substituteVars(character.description)}\n`;
    systemPrompt += `Write ONLY as ${character.name} — never write for ${playerName}. Use first person in dialogue, third person for actions.\n`;
    systemPrompt += `Personality: ${substituteVars(character.personality)}\n\n`;
  }
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

  // Inject capacity checkpoints
  const checkpointChat = getActiveCheckpoint(character, sessionState.capacity);
  if (checkpointChat?.preInflation) {
    systemPrompt += `\n=== PRE-INFLATION REQUIREMENT ===\nDo NOT activate the pump, begin inflation, or use [pump on] tags until the following has been accomplished:\n${checkpointChat.preInflation}\n=== END PRE-INFLATION REQUIREMENT ===\n`;
  }
  if (checkpointChat?.text) {
    systemPrompt += `\n=== CHARACTER CHECKPOINT ===\nCurrent guidance for this capacity range:\n${checkpointChat.text}\n=== END CHECKPOINT ===\n`;
  }

  systemPrompt += `${playerLabel} emotionally feels ${sessionState.emotion}.\n`;

  // Add recent challenge result if available
  if (sessionState.lastChallengeResult) {
    const cr = sessionState.lastChallengeResult;
    const isRecent = (Date.now() - cr.timestamp) < 60000;
    if (isRecent) {
      systemPrompt += `\nChallenge just occurred: ${cr.typeName} — ${playerLabel} ${cr.description}. React to this outcome.\n`;
    }
  }

  // Add active reminders (using reminder engine for keyword-based activation)
  const recentMessagesChat = reminderEngine.extractRecentMessages(sessionState.chatHistory, 20);
  const activeRemindersChat = reminderEngine.getMergedActiveReminders(
    character.constantReminders || [],
    settings.globalReminders || [],
    recentMessagesChat
  );
  if (activeRemindersChat.length > 0) {
    systemPrompt += '\n' + reminderEngine.buildReminderPrompt(activeRemindersChat, 'Active Reminders');
  }

  // Add global prompt / author note (positioned prominently at end of system prompt)
  if (settings?.globalPrompt) {
    systemPrompt += `\n[Author Note: ${settings.globalPrompt}]\n`;
  }

  // Add LLM device control instructions if enabled
  if (settings?.globalCharacterControls?.allowLlmDeviceControl) {
    const globalMax = settings.globalCharacterControls.llmDeviceControlMaxSeconds || 30;
    const charLimits = getCharacterLimits(character);
    const maxSeconds = charLimits ? Math.min(globalMax, charLimits.llmMaxOnDuration ?? Infinity) : globalMax;
    let devicePrompt = `\nDEVICE CONTROL: Include hidden tags when activating/deactivating devices.
Tags: [pump on]/[pump off], [vibe on]/[vibe off], [tens on]/[tens off]
Example: "*flips the switch* [pump on] Let's begin..." (tags are hidden from player, auto-timeout ${maxSeconds}s)`;
    if (charLimits) {
      devicePrompt += `\nLimits: max ON ${charLimits.llmMaxOnDuration ?? 5}s, max pulse ${charLimits.llmMaxPulseRepetitions ?? 5}x, max timed ${charLimits.llmMaxTimedDuration ?? 10}s, max cycle ON ${charLimits.llmMaxCycleOnDuration ?? 2}s x${charLimits.llmMaxCycleRepetitions ?? 2}`;
    }
    systemPrompt += devicePrompt + '\n';
  }

  // Inject personality attributes if rolled
  if (sessionState.activeAttributes?.length > 0) {
    systemPrompt += buildAttributeBlock(sessionState.activeAttributes);
  }

  // Final style anchor
  systemPrompt += `\nWrite "dialogue" and *actions*. Short paragraphs, natural speech. Show don't tell.\n`;

  // Build prompt from recent chat history
  const recentMessages = sessionState.chatHistory.slice(-20);
  let prompt = '';

  if (character.exampleDialogues && character.exampleDialogues.length > 0) {
    prompt += 'Example dialogue:\n';
    if (character.multiChar?.enabled) {
      character.exampleDialogues.forEach(ex => {
        prompt += `User: ${ex.user}\n${ex.response || ex.character}\n`;
      });
    } else {
      character.exampleDialogues.forEach(ex => {
        prompt += `User: ${ex.user}\n${character.name}: ${ex.character}\n`;
      });
    }
    prompt += '\nCurrent conversation:\n';
  }

  recentMessages.forEach(msg => {
    if (msg.sender === 'player') {
      prompt += `${playerLabel}: ${msg.content}\n`;
    } else if (msg.sender === 'character') {
      prompt += `${character.name}: ${msg.content}\n`;
    }
  });

  if (character.multiChar?.enabled) {
    // Analyze recent speaker frequency to encourage diversity
    const chars = character.multiChar.characters;
    if (chars?.length > 1 && recentMessages.length >= 3) {
      const charMessages = recentMessages.filter(m => m.sender === 'character');
      const last6 = charMessages.slice(-6);
      const speakerCounts = {};
      for (const c of chars) speakerCounts[c.name] = 0;
      for (const msg of last6) {
        const content = msg.content || '';
        for (const c of chars) {
          if (content.includes(c.name)) speakerCounts[c.name]++;
        }
      }
      // Find who's been quiet vs dominant
      const sorted = Object.entries(speakerCounts).sort((a, b) => a[1] - b[1]);
      const quietest = sorted.filter(([, count]) => count <= 1).map(([name]) => name);
      if (quietest.length > 0 && quietest.length < chars.length) {
        prompt += `\n[Hint: ${quietest.join(' and ')} ${quietest.length === 1 ? 'hasn\'t' : 'haven\'t'} had much to say recently — consider featuring ${quietest.length === 1 ? 'them' : 'one of them'} this turn.]\n`;
      }
    }
    prompt += `[Characters]:`;
  } else {
    prompt += `${character.name}:`;
  }

  // Build stop sequences to prevent role confusion (like SillyTavern's names_as_stop_strings)
  const stopSequences = [
    `\n${playerLabel}:`,
    `${playerLabel}:`,
    `[Player]:`,
    `[Char]:`,
  ];
  if (!character.multiChar?.enabled) {
    stopSequences.push(`\n${character.name}:`);
  }

  return { systemPrompt, prompt, stopSequences, playerName: playerLabel, characterName: character.name };
}

// ============================================
// API Routes
// ============================================

// --- Updates ---

app.get('/api/updates/check', async (req, res) => {
  const { execSync } = require('child_process');
  const projectRoot = path.join(__dirname, '..');

  console.log('[Updates] Check started');

  try {

    // Fetch latest from remote
    console.log('[Updates] Fetching from origin...');
    execSync('git fetch origin', { cwd: projectRoot, stdio: 'pipe', timeout: 15000 });

    // Detect current branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const trackingBranch = (currentBranch === 'master' || currentBranch === 'main') ? 'release' : currentBranch;
    console.log(`[Updates] Current branch: ${currentBranch}, tracking: origin/${trackingBranch}`);

    // Get current and remote commit hashes
    const localCommit = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const remoteCommit = execSync(`git rev-parse origin/${trackingBranch}`, { cwd: projectRoot, encoding: 'utf8' }).trim();

    // Get commit count difference
    const behindCount = parseInt(execSync(`git rev-list --count HEAD..origin/${trackingBranch}`, { cwd: projectRoot, encoding: 'utf8' }).trim()) || 0;

    // Get current version from package.json (read fresh, don't use cached require)
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const currentVersion = pkg.version;

    // Get commit messages for pending updates
    let pendingChanges = [];
    if (behindCount > 0) {
      const logOutput = execSync(`git log --oneline HEAD..origin/${trackingBranch}`, { cwd: projectRoot, encoding: 'utf8' }).trim();
      pendingChanges = logOutput.split('\n').filter(line => line.trim());
    }

    res.json({
      hasUpdates: behindCount > 0,
      currentVersion,
      localCommit: localCommit.substring(0, 7),
      remoteCommit: remoteCommit.substring(0, 7),
      behindCount,
      pendingChanges
    });
  } catch (error) {
    console.error('[Updates] Check failed:', error.message);
    // Read version fresh from disk
    let currentVersion = 'unknown';
    try {
      const pkgPath = path.join(__dirname, 'package.json');
      currentVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    } catch (e) {}
    res.json({
      hasUpdates: false,
      error: error.message,
      currentVersion
    });
  }
});

// Manual pull endpoint - for when auto-update fails
app.post('/api/updates/pull', async (req, res) => {
  const { execSync } = require('child_process');
  const projectRoot = path.join(__dirname, '..');

  try {
    console.log('[Updates] Manual pull requested...');
    // Detect current branch, migrate master/main to release
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const trackingBranch = (currentBranch === 'master' || currentBranch === 'main') ? 'release' : currentBranch;
    // Fetch and reset to remote - no merge needed, ensures exact match with remote
    execSync(`git fetch origin ${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe', timeout: 30000 });
    execSync(`git reset --hard origin/${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe' });
    console.log('[Updates] Manual pull successful');
    res.json({ success: true, message: 'Pull successful. Please restart the application.' });
  } catch (error) {
    console.error('[Updates] Manual pull failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/updates/install', async (req, res) => {
  const { spawn, execSync } = require('child_process');
  const projectRoot = path.join(__dirname, '..');
  const isWindows = process.platform === 'win32';

  try {
    // Detect current branch, migrate master/main to release
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const trackingBranch = (currentBranch === 'master' || currentBranch === 'main') ? 'release' : currentBranch;
    // Fetch and reset to remote (no merge, no committer identity needed)
    // This ensures local repo always matches remote exactly - users shouldn't modify tracked files
    console.log(`[Updates] Fetching latest changes from origin/${trackingBranch}...`);
    execSync(`git fetch origin ${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe', timeout: 30000 });
    console.log('[Updates] Resetting to remote...');
    execSync(`git reset --hard origin/${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe' });

    // Clear Python bytecode cache to ensure fresh script execution
    const pycacheDir = path.join(__dirname, 'scripts', '__pycache__');
    if (fs.existsSync(pycacheDir)) {
      console.log('[Updates] Clearing Python cache...');
      fs.rmSync(pycacheDir, { recursive: true, force: true });
    }

    // Reset Tapo service Python ready state
    try {
      const tapoService = require('./services/tapo-service');
      tapoService.pythonReady = null;
      console.log('[Updates] Reset Tapo Python ready state');
    } catch (e) { /* Tapo service may not be loaded */ }

    // Check if package.json changed (need to reinstall deps)
    const changedFiles = execSync('git diff --name-only HEAD~1 HEAD', { cwd: projectRoot, encoding: 'utf8' });
    const needsBackendInstall = changedFiles.includes('backend/package.json');
    const needsFrontendInstall = changedFiles.includes('frontend/package.json');
    const needsFrontendBuild = changedFiles.includes('frontend/');

    // Send response before restarting
    res.json({
      success: true,
      message: 'Update installed, restarting server...',
      needsBackendInstall,
      needsFrontendInstall,
      needsFrontendBuild
    });

    // Schedule restart after response is sent
    setTimeout(() => {
      console.log('[Updates] Starting update process...');

      if (isWindows) {
        // Windows: Create a batch script for the update
        const batchScript = `
@echo off
cd /d "${projectRoot}"
${needsBackendInstall ? 'echo [Updates] Installing backend dependencies... && cd backend && npm install && cd ..' : ''}
${needsFrontendInstall ? 'echo [Updates] Installing frontend dependencies... && cd frontend && npm install && cd ..' : ''}
${needsFrontendBuild ? 'echo [Updates] Rebuilding frontend... && cd frontend && npm run build && cd ..' : ''}
echo [Updates] Restarting server...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul
cd backend
start /B node server.js
echo [Updates] Server restarted
`;
        const batchPath = path.join(projectRoot, 'update-temp.bat');
        fs.writeFileSync(batchPath, batchScript);
        const child = spawn('cmd.exe', ['/c', batchPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
      } else {
        // Linux/Mac: Use bash script
        const updateScript = `
          cd "${projectRoot}"
          ${needsBackendInstall ? 'echo "[Updates] Installing backend dependencies..." && cd backend && npm install && cd ..' : ''}
          ${needsFrontendInstall ? 'echo "[Updates] Installing frontend dependencies..." && cd frontend && npm install && cd ..' : ''}
          ${needsFrontendBuild ? 'echo "[Updates] Rebuilding frontend..." && cd frontend && npm run build && cd ..' : ''}
          echo "[Updates] Restarting server..."
          pkill -f "node server.js" || true
          sleep 1
          cd backend && node server.js > /tmp/swelldreams.log 2>&1 &
          echo "[Updates] Server restarted"
        `;
        const child = spawn('bash', ['-c', updateScript], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
      }
    }, 500);

  } catch (error) {
    console.error('[Updates] Install failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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
    // Update sessionState names for variable substitution
    if (charChanged && settings.activeCharacterId) {
      const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
      sessionState.characterName = activeCharacter?.name || null;
      // Sync character's autoReplyEnabled to session state
      sessionState.autoReply = activeCharacter?.autoReplyEnabled || false;
      broadcast('auto_reply_update', { enabled: sessionState.autoReply });

      // Sync flow assignments from active story
      if (activeCharacter) {
        const activeStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
        const storyFlows = activeStory?.assignedFlows || activeCharacter.assignedFlows || [];
        if (!sessionState.flowAssignments.characters) {
          sessionState.flowAssignments.characters = {};
        }
        sessionState.flowAssignments.characters[settings.activeCharacterId] = storyFlows;
        broadcast('flow_assignments_update', sessionState.flowAssignments);
      }
    }
    if (personaChanged && settings.activePersonaId) {
      const personas = loadAllPersonas() || [];
      const activePersona = personas.find(p => p.id === settings.activePersonaId);
      sessionState.playerName = activePersona?.displayName || null;
    }

    activateAssignedFlows();
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

app.post('/api/llm/detect-model', async (req, res) => {
  await detectLlmModel();
  const settings = loadData(DATA_FILES.settings);
  res.json({ modelName: settings?.llm?.detectedModelName || null });
});

app.post('/api/llm/generate', llmLimiter, async (req, res) => {
  try {
    const { prompt, messages, systemPrompt, maxTokens } = req.body;
    const settings = loadData(DATA_FILES.settings)?.llm || DEFAULT_SETTINGS.llm;

    // Allow optional maxTokens override from request
    const effectiveSettings = maxTokens ? { ...settings, maxTokens } : settings;

    const result = await llmService.generate({ prompt, messages, systemPrompt, settings: effectiveSettings });
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
  // Use new folder storage if active, otherwise fall back to old format
  const personas = loadAllPersonas();
  res.json(personas);
});

app.get('/api/personas/:id', (req, res) => {
  const persona = loadPersona(req.params.id);
  if (persona) {
    res.json(persona);
  } else {
    res.status(404).json({ error: 'Persona not found' });
  }
});

// Persona QuickGen - AI-generate persona details
app.post('/api/personas/quickgen', async (req, res) => {
  try {
    const { name, pronouns, appearance, personality, relationshipWithInflation } = req.body;

    if (!name || !pronouns) {
      return res.status(400).json({ error: 'Name and pronouns are required' });
    }

    const settings = loadSettings();

    // Check if LLM is configured
    if (!settings.llm || !settings.llm.provider || !hasApiKey(settings.llm)) {
      return res.status(400).json({ error: 'LLM not configured. Please set up your AI provider in Settings.' });
    }

    const systemPrompt = `You are a creative character designer for an inflation roleplay story. Generate realistic, detailed persona descriptions.`;

    // Check if there's existing content to reference
    const hasExistingContent = appearance || personality || relationshipWithInflation;

    let prompt = `Create a persona named "${name}" with pronouns "${pronouns}".`;

    if (hasExistingContent) {
      prompt += `\n\nExisting information to reference or refine:`;
      if (appearance) prompt += `\n- Appearance: "${appearance}"`;
      if (personality) prompt += `\n- Personality: "${personality}"`;
      if (relationshipWithInflation) prompt += `\n- Inflation familiarity: "${relationshipWithInflation}"`;
    }

    prompt += `\n\nGenerate the following three fields:

1. Physical Appearance (approximately 100 tokens): A detailed description considering their gender identity (${pronouns} pronouns). Include body type, height, build, clothing style, distinctive features, and overall aesthetic. ${appearance ? 'Refine the existing description or expand on it.' : 'Create from scratch.'}

2. Personality (approximately 100 characters): Core personality traits, mannerisms, and behavioral tendencies. ${personality ? 'Enhance or refine the existing description.' : 'Create a well-rounded personality.'}

3. Relationship with Inflation: Their knowledge and experience with belly inflation. Consider these aspects:
   - Familiarity level: Complete novice, curious beginner, experienced practitioner, or expert enthusiast
   - Practice: Do they actively inflate themselves? Have they tried it? Just heard about it?
   - Role preference: More dominant/controlling, submissive/receptive, or switch/versatile
   - Attitude: Excited, nervous, indifferent, skeptical, or enthusiastic
   ${relationshipWithInflation ? 'Build upon the existing description.' : 'Choose an authentic stance for this character.'}

Format your response EXACTLY as:
APPEARANCE: [description]
PERSONALITY: [description]
RELATIONSHIP: [description]`;

    const result = await llmService.generate({
      prompt,
      systemPrompt,
      settings: settings.llm
    });

    // Parse the LLM response
    const text = result.text.trim();
    const appearanceMatch = text.match(/APPEARANCE:\s*(.+?)(?=PERSONALITY:|$)/s);
    const personalityMatch = text.match(/PERSONALITY:\s*(.+?)(?=RELATIONSHIP:|$)/s);
    const relationshipMatch = text.match(/RELATIONSHIP:\s*(.+?)$/s);

    res.json({
      appearance: appearanceMatch ? appearanceMatch[1].trim() : '',
      personality: personalityMatch ? personalityMatch[1].trim() : '',
      relationshipWithInflation: relationshipMatch ? relationshipMatch[1].trim() : ''
    });

  } catch (err) {
    console.error('Error generating persona:', err);
    res.status(500).json({ error: err.message || 'Failed to generate persona' });
  }
});

app.post('/api/personas', async (req, res) => {
  try {
    const newPersona = {
      id: uuidv4(),
      ...req.body,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Use async version to process images and save to folder structure
    const savedPersona = await savePersonaAsync(newPersona, true);
    const personas = loadAllPersonas();
    broadcast('personas_update', personas);
    res.json(savedPersona);
  } catch (err) {
    console.error('Error creating persona:', err);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

app.put('/api/personas/:id', async (req, res) => {
  try {
    const existingPersona = loadPersona(req.params.id);
    if (!existingPersona) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    const personaToSave = { ...existingPersona, ...req.body, updatedAt: Date.now() };
    // Use async version to process images
    const savedPersona = await savePersonaAsync(personaToSave);
    const personas = loadAllPersonas();
    broadcast('personas_update', personas);
    res.json(savedPersona);
  } catch (err) {
    console.error('Error updating persona:', err);
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

app.delete('/api/personas/:id', (req, res) => {
  // Delete from folder structure
  deletePersonaFolder(req.params.id);

  // Also remove from old personas.json if it exists there (migration cleanup)
  let oldPersonas = loadData(DATA_FILES.personas) || [];
  const originalLength = oldPersonas.length;
  oldPersonas = oldPersonas.filter(p => p.id !== req.params.id);
  if (oldPersonas.length !== originalLength) {
    saveData(DATA_FILES.personas, oldPersonas);
  }

  const allPersonas = loadAllPersonas();
  broadcast('personas_update', allPersonas);
  res.json({ success: true });
});

// --- Import Character Card (V2/V3/SwellD PNG) ---
app.post('/api/import/character-card', cardUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileBuffer = req.file.buffer;
    const fileType = req.file.mimetype;
    let characterData = null;
    let avatarData = null;
    let isSwellDImport = false;
    let swelldExportData = null;

    // Handle PNG files - extract metadata
    if (fileType === 'image/png' || fileType === 'image/jpeg') {
      // Try SwellD format first (highest priority)
      swelldExportData = characterConverter.extractPNGMetadata(fileBuffer, 'swelld');

      if (swelldExportData && swelldExportData.type === 'swelldreams-character') {
        isSwellDImport = true;
        characterData = swelldExportData;
      } else {
        // Try V3 format
        characterData = characterConverter.extractPNGMetadata(fileBuffer, 'v3');
        if (!characterData) {
          // Try V2 format
          characterData = characterConverter.extractPNGMetadata(fileBuffer, 'v2');
        }
      }

      if (!characterData) {
        return res.status(400).json({ error: 'No character data found in PNG metadata' });
      }

      // Use the PNG as avatar (for V2/V3 imports)
      if (!isSwellDImport) {
        avatarData = `data:${fileType};base64,${fileBuffer.toString('base64')}`;
      }
    }
    // Handle JSON files
    else if (fileType === 'application/json') {
      try {
        characterData = JSON.parse(fileBuffer.toString('utf-8'));
      } catch (error) {
        return res.status(400).json({ error: 'Invalid JSON file' });
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    let convertedCharacter;
    let importedFlowCount = 0;

    if (isSwellDImport) {
      // --- SwellDreams PNG Import ---
      const importData = swelldExportData;
      convertedCharacter = importData.data;

      // Generate a new ID to avoid collisions
      const oldCharId = convertedCharacter.id;
      convertedCharacter.id = uuidv4();

      // Use embedded clean avatar (without logo) if available
      if (convertedCharacter.avatarData) {
        convertedCharacter.avatar = convertedCharacter.avatarData;
        delete convertedCharacter.avatarData;
      } else {
        // Fallback: use the PNG itself as avatar
        convertedCharacter.avatar = `data:${fileType};base64,${fileBuffer.toString('base64')}`;
      }

      // Regenerate story IDs to avoid collisions
      const storyIdMap = {};
      if (convertedCharacter.stories) {
        for (const story of convertedCharacter.stories) {
          const oldId = story.id;
          story.id = uuidv4();
          storyIdMap[oldId] = story.id;

          // Regenerate welcome message IDs
          if (story.welcomeMessages) {
            const wmIdMap = {};
            for (const wm of story.welcomeMessages) {
              const oldWmId = wm.id;
              wm.id = uuidv4();
              wmIdMap[oldWmId] = wm.id;
            }
            if (story.activeWelcomeMessageId && wmIdMap[story.activeWelcomeMessageId]) {
              story.activeWelcomeMessageId = wmIdMap[story.activeWelcomeMessageId];
            }
          }

          // Regenerate scenario IDs
          if (story.scenarios) {
            const scIdMap = {};
            for (const sc of story.scenarios) {
              const oldScId = sc.id;
              sc.id = uuidv4();
              scIdMap[oldScId] = sc.id;
            }
            if (story.activeScenarioId && scIdMap[story.activeScenarioId]) {
              story.activeScenarioId = scIdMap[story.activeScenarioId];
            }
          }

          // Normalize story progression fields
          story.storyProgressionEnabled = story.storyProgressionEnabled ?? false;
          story.storyProgressionMaxOptions = story.storyProgressionMaxOptions ?? 3;

          // Normalize per-character device control limits
          story.llmMaxOnDuration = story.llmMaxOnDuration ?? 5;
          story.llmMaxCycleOnDuration = story.llmMaxCycleOnDuration ?? 2;
          story.llmMaxCycleRepetitions = story.llmMaxCycleRepetitions ?? 2;
          story.llmMaxPulseRepetitions = story.llmMaxPulseRepetitions ?? 5;
          story.llmMaxTimedDuration = story.llmMaxTimedDuration ?? 10;
          story.checkpoints = story.checkpoints || {};
          story.attributes = story.attributes || {};
        }
        // Update activeStoryId
        if (convertedCharacter.activeStoryId && storyIdMap[convertedCharacter.activeStoryId]) {
          convertedCharacter.activeStoryId = storyIdMap[convertedCharacter.activeStoryId];
        }
      }

      // Regenerate reminder IDs
      if (convertedCharacter.constantReminders) {
        for (const r of convertedCharacter.constantReminders) {
          r.id = uuidv4();
        }
      }
      if (convertedCharacter.globalReminders) {
        for (const r of convertedCharacter.globalReminders) {
          r.id = uuidv4();
        }
      }

      // Handle embedded flows
      if (importData.flows && importData.flows.length > 0) {
        const flowIdMap = {};

        // Create each flow with new UUID
        for (const flow of importData.flows) {
          const oldFlowId = flow.id;
          flow.id = uuidv4();
          flowIdMap[oldFlowId] = flow.id;

          // Update characterId reference
          flow.characterId = convertedCharacter.id;

          // Update node IDs within the flow
          if (flow.nodes) {
            const nodeIdMap = {};
            for (const node of flow.nodes) {
              const oldNodeId = node.id;
              node.id = uuidv4();
              nodeIdMap[oldNodeId] = node.id;
            }

            // Update edge references
            if (flow.edges) {
              for (const edge of flow.edges) {
                if (nodeIdMap[edge.source]) edge.source = nodeIdMap[edge.source];
                if (nodeIdMap[edge.target]) edge.target = nodeIdMap[edge.target];
                edge.id = uuidv4();
              }
            }

            // Update sourceFlowId in nodes that reference flows
            for (const node of flow.nodes) {
              if (node.data?.sourceFlowId && flowIdMap[node.data.sourceFlowId]) {
                node.data.sourceFlowId = flowIdMap[node.data.sourceFlowId];
              }
            }
          }

          // Save flow
          saveFlow(flow);
          importedFlowCount++;
        }

        // Update character's assignedFlows references
        if (convertedCharacter.assignedFlows) {
          convertedCharacter.assignedFlows = convertedCharacter.assignedFlows
            .map(id => flowIdMap[id] || id)
            .filter(id => Object.values(flowIdMap).includes(id));
        }

        // Update story assignedFlows references
        if (convertedCharacter.stories) {
          for (const story of convertedCharacter.stories) {
            if (story.assignedFlows) {
              story.assignedFlows = story.assignedFlows
                .map(id => flowIdMap[id] || id)
                .filter(id => Object.values(flowIdMap).includes(id));
            }
          }
        }

        // Update button sourceFlowId references
        if (convertedCharacter.buttons) {
          for (const button of convertedCharacter.buttons) {
            if (button.sourceFlowId && flowIdMap[button.sourceFlowId]) {
              button.sourceFlowId = flowIdMap[button.sourceFlowId];
            }
            if (button.actions) {
              for (const action of button.actions) {
                if (action.config?.flowId && flowIdMap[action.config.flowId]) {
                  action.config.flowId = flowIdMap[action.config.flowId];
                }
              }
            }
          }
        }

        // Sync auto-generated buttons from imported flows
        const allFlowIds = new Set(convertedCharacter.assignedFlows || []);
        if (convertedCharacter.stories) {
          for (const story of convertedCharacter.stories) {
            for (const fid of (story.assignedFlows || [])) {
              allFlowIds.add(fid);
            }
          }
        }

        // Save character first so syncAutoGeneratedButtons can find it
        convertedCharacter.createdAt = Date.now();
        convertedCharacter.updatedAt = Date.now();

        if (isPerCharStorageActive()) {
          await saveCharacterAsync(convertedCharacter, true);
        } else {
          const characters = loadData(DATA_FILES.characters) || [];
          characters.push(convertedCharacter);
          saveData(DATA_FILES.characters, characters);
        }

        // Sync buttons from flow nodes
        if (allFlowIds.size > 0) {
          syncAutoGeneratedButtons(convertedCharacter.id, [...allFlowIds]);
        }

        // Broadcast updates
        const allCharacters = loadAllCharacters();
        broadcast('characters_update', allCharacters);

        const flowsIndex = loadFlowsIndex();
        broadcast('flows_update', flowsIndex);

        return res.json({
          success: true,
          character: convertedCharacter,
          message: `Imported "${convertedCharacter.name}" with ${importedFlowCount} flow(s) from SwellDreams PNG`
        });
      }
    } else {
      // --- V2/V3 Import (existing behavior) ---
      const format = characterConverter.detectFormat(characterData);

      if (format === 'v3') {
        convertedCharacter = characterConverter.convertV3ToSwellD(characterData);
      } else {
        convertedCharacter = characterConverter.convertV2ToSwellD(characterData);
      }

      // Set avatar if we have one
      if (avatarData) {
        convertedCharacter.avatar = avatarData;
      }
    }

    // Add timestamps
    convertedCharacter.createdAt = Date.now();
    convertedCharacter.updatedAt = Date.now();

    // Save character using the same pattern as POST /api/characters
    if (isPerCharStorageActive()) {
      await saveCharacterAsync(convertedCharacter, true);
    } else {
      const characters = loadData(DATA_FILES.characters) || [];
      characters.push(convertedCharacter);
      saveData(DATA_FILES.characters, characters);
    }

    // Broadcast update
    const allCharacters = loadAllCharacters();
    broadcast('characters_update', allCharacters);

    const formatLabel = isSwellDImport ? 'SwellDreams PNG' : (characterConverter.detectFormat(characterData) || 'V2').toUpperCase();

    res.json({
      success: true,
      character: convertedCharacter,
      message: `Successfully imported "${convertedCharacter.name}" from ${formatLabel} format`
    });

  } catch (error) {
    console.error('Character card import error:', error);
    res.status(500).json({ error: error.message || 'Failed to import character card' });
  }
});

// --- Import Persona Card (V2/V3) ---
// REMOVED: Personas are simple user identity fields, not complex V2/V3 character cards.
// Users should create personas directly in SwellDreams using the persona editor.

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

  // Detect actual model name from the newly activated endpoint
  detectLlmModel();
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

app.post('/api/characters', async (req, res) => {
  try {
    const newCharacter = {
      id: uuidv4(),
      ...req.body,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (isPerCharStorageActive()) {
      // Use async version to process images
      const savedChar = await saveCharacterAsync(newCharacter, true);
      const characters = loadAllCharacters();
      broadcast('characters_update', characters);
      res.json(savedChar);
    } else {
      const characters = loadData(DATA_FILES.characters) || [];
      characters.push(newCharacter);
      saveData(DATA_FILES.characters, characters);
      broadcast('characters_update', characters);
      res.json(newCharacter);
    }
  } catch (err) {
    console.error('Error creating character:', err);
    res.status(500).json({ error: 'Failed to create character' });
  }
});

app.put('/api/characters/:id', async (req, res) => {
  try {
    let updatedCharacter;

    if (isPerCharStorageActive()) {
      const existingCharacter = loadCharacter(req.params.id);
      if (!existingCharacter) {
        return res.status(404).json({ error: 'Character not found' });
      }
      const charToSave = { ...existingCharacter, ...req.body, updatedAt: Date.now() };
      // Use async version to process images
      updatedCharacter = await saveCharacterAsync(charToSave);
    } else {
      const characters = loadData(DATA_FILES.characters) || [];
      const index = characters.findIndex(c => c.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: 'Character not found' });
      }
      characters[index] = { ...characters[index], ...req.body, updatedAt: Date.now() };
      updatedCharacter = characters[index];
      saveData(DATA_FILES.characters, characters);
    }

    // Sync buttons if character has story flows assigned
    // Get all flows from all stories plus character-level assignedFlows
    const allFlowIds = new Set();
    if (updatedCharacter.assignedFlows) {
      updatedCharacter.assignedFlows.forEach(id => allFlowIds.add(id));
    }
    if (updatedCharacter.stories) {
      for (const story of updatedCharacter.stories) {
        if (story.assignedFlows) {
          story.assignedFlows.forEach(id => allFlowIds.add(id));
        }
      }
    }
    // Include global flows
    const globalFlows = sessionState.flowAssignments?.global || [];
    globalFlows.forEach(id => allFlowIds.add(id));

    if (allFlowIds.size > 0) {
      const buttonsUpdated = syncAutoGeneratedButtons(req.params.id, [...allFlowIds]);
      if (buttonsUpdated) {
        // Reload character after button sync
        updatedCharacter = isPerCharStorageActive()
          ? loadCharacter(req.params.id)
          : (loadData(DATA_FILES.characters) || []).find(c => c.id === req.params.id);
      }
    }

    // Update session state flow assignments
    const activeStory = updatedCharacter.stories?.find(s => s.id === updatedCharacter.activeStoryId)
      || updatedCharacter.stories?.[0];
    const storyFlows = activeStory?.assignedFlows || updatedCharacter.assignedFlows || [];
    if (!sessionState.flowAssignments.characters) {
      sessionState.flowAssignments.characters = {};
    }
    sessionState.flowAssignments.characters[req.params.id] = storyFlows;
    broadcast('flow_assignments_update', sessionState.flowAssignments);

    // Broadcast updated characters
    const characters = isPerCharStorageActive() ? loadAllCharacters() : loadData(DATA_FILES.characters);
    broadcast('characters_update', characters);

    // If this is the active character, sync autoReplyEnabled to session state
    const settings = loadData(DATA_FILES.settings);
    if (settings?.activeCharacterId === req.params.id && req.body.autoReplyEnabled !== undefined) {
      sessionState.autoReply = req.body.autoReplyEnabled;
      broadcast('auto_reply_update', { enabled: sessionState.autoReply });
    }

    // Activate flows if this is the active character
    if (settings?.activeCharacterId === req.params.id) {
      activateAssignedFlows();
    }

    res.json(updatedCharacter);
  } catch (err) {
    console.error('Error updating character:', err);
    res.status(500).json({ error: 'Failed to update character' });
  }
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

// --- Actors (ScreenPlay) ---

app.get('/api/actors', (req, res) => {
  const actors = loadAllActors();
  res.json(actors);
});

app.get('/api/actors/:id', (req, res) => {
  const actor = loadActor(req.params.id);
  if (actor) {
    res.json(actor);
  } else {
    res.status(404).json({ error: 'Actor not found' });
  }
});

app.post('/api/actors', async (req, res) => {
  try {
    const newActor = {
      id: uuidv4(),
      ...req.body,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const savedActor = await saveActorAsync(newActor, true);
    const actors = loadAllActors();
    broadcast('actors_update', actors);
    res.json(savedActor);
  } catch (err) {
    console.error('Error creating actor:', err);
    res.status(500).json({ error: 'Failed to create actor' });
  }
});

app.put('/api/actors/:id', async (req, res) => {
  try {
    const existingActor = loadActor(req.params.id);
    if (!existingActor) {
      return res.status(404).json({ error: 'Actor not found' });
    }
    const actorToSave = { ...existingActor, ...req.body, updatedAt: Date.now() };
    const updatedActor = await saveActorAsync(actorToSave);

    const actors = loadAllActors();
    broadcast('actors_update', actors);
    res.json(updatedActor);
  } catch (err) {
    console.error('Error updating actor:', err);
    res.status(500).json({ error: 'Failed to update actor' });
  }
});

app.delete('/api/actors/:id', (req, res) => {
  deleteActorFile(req.params.id);
  const actors = loadAllActors();
  broadcast('actors_update', actors);
  res.json({ success: true });
});

// --- Plays (ScreenPlay) ---

app.get('/api/plays', (req, res) => {
  const plays = loadAllPlays();
  res.json(plays);
});

app.get('/api/plays/:id', (req, res) => {
  const play = loadPlay(req.params.id);
  if (play) {
    res.json(play);
  } else {
    res.status(404).json({ error: 'Play not found' });
  }
});

app.post('/api/plays', async (req, res) => {
  try {
    const newPlay = {
      id: uuidv4(),
      ...req.body,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const savedPlay = await savePlayAsync(newPlay, true);
    const plays = loadAllPlays();
    broadcast('plays_update', plays);
    res.json(savedPlay);
  } catch (err) {
    console.error('Error creating play:', err);
    res.status(500).json({ error: 'Failed to create play' });
  }
});

app.put('/api/plays/:id', async (req, res) => {
  try {
    const existingPlay = loadPlay(req.params.id);
    if (!existingPlay) {
      return res.status(404).json({ error: 'Play not found' });
    }
    const playToSave = { ...existingPlay, ...req.body, updatedAt: Date.now() };
    const updatedPlay = await savePlayAsync(playToSave);

    const plays = loadAllPlays();
    broadcast('plays_update', plays);
    res.json(updatedPlay);
  } catch (err) {
    console.error('Error updating play:', err);
    res.status(500).json({ error: 'Failed to update play' });
  }
});

app.delete('/api/plays/:id', (req, res) => {
  deletePlayFile(req.params.id);
  const plays = loadAllPlays();
  broadcast('plays_update', plays);
  res.json({ success: true });
});

// Enhance screenplay text via LLM
app.post('/api/screenplay/enhance', llmLimiter, async (req, res) => {
  try {
    const { text, type, actorName, actorPersonality, authorMode, maxTokens, definitions, scenario, location, actorRelationships, previousText } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const allSettings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
    const settings = allSettings?.llm || DEFAULT_SETTINGS.llm;

    // Build system prompt with definitions and scenario context
    let systemPrompt = 'You are a creative writing assistant helping to expand story prompts into vivid prose. Write naturally and conversationally - avoid purple prose and overwriting. Be direct, sensory, and grounded.\n\n';

    // Include global definitions first (constant context)
    if (definitions) {
      systemPrompt += `CONTEXT:\n${definitions}\n\n`;
    }

    // Include screenplay author note (writing style guidance)
    if (allSettings.screenplayAuthorNote) {
      systemPrompt += `WRITING STYLE: ${allSettings.screenplayAuthorNote}\n\n`;
    }

    // Include play-specific scenario
    if (scenario) {
      systemPrompt += `STORY CONTEXT: ${scenario}\n\n`;
    }

    // Include location
    if (location) {
      systemPrompt += `LOCATION: ${location}\n\n`;
    }

    // Include actor relationships
    if (actorRelationships) {
      systemPrompt += `CHARACTER RELATIONSHIPS: ${actorRelationships}\n\n`;
    }

    if (authorMode === '2nd-person') {
      systemPrompt += 'Write in second person ("you"). ';
    } else if (authorMode === '1st-person') {
      systemPrompt += 'Write in first person ("I"). ';
    } else {
      systemPrompt += 'Write in third person. ';
    }

    if (type === 'narration') {
      systemPrompt += 'Expand the following narration briefly. Add sensory details but keep it grounded. No dialogue. Output only the narration text.';
    } else if (type === 'dialogue') {
      systemPrompt += `Enhance dialogue spoken by ${actorName || 'a character'}. `;
      if (actorPersonality) {
        systemPrompt += `Personality: ${actorPersonality}. `;
      }
      systemPrompt += 'Keep it natural and in-character. You may add brief actions. Output only the dialogue (no name prefix).';
    } else if (type === 'player_dialogue') {
      systemPrompt += 'Enhance this player dialogue naturally. Output only the dialogue text.';
    }

    // Build prompt with previous context for coherence
    let fullPrompt = '';
    if (previousText && previousText.length > 0) {
      fullPrompt += 'PREVIOUS STORY TEXT:\n' + previousText + '\n\n';
    }
    fullPrompt += 'ENHANCE THIS:\n' + text;

    // Use provided maxTokens or default to 120
    const tokenLimit = maxTokens || 120;

    const result = await llmService.generate({
      prompt: fullPrompt,
      systemPrompt,
      settings: { ...settings, maxTokens: tokenLimit }
    });

    if (result && result.text) {
      // Clean up the response - remove any wrapping quotes that LLM might add
      let enhanced = result.text.trim();
      if (enhanced.startsWith('"') && enhanced.endsWith('"')) {
        enhanced = enhanced.slice(1, -1);
      }
      res.json({ success: true, text: enhanced });
    } else {
      res.status(500).json({ error: 'LLM returned empty response' });
    }
  } catch (error) {
    console.error('[Screenplay] Enhancement error:', error);
    res.status(500).json({ error: error.message });
  }
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
    } else if (brand === 'tapo') {
      device = { ip: deviceIdOrIp, brand: 'tapo' };
    } else if (childId) {
      device = { ip: deviceIdOrIp, childId, brand: 'tplink' };
    }

    // Safety check: Block pump activation at 100% capacity (unless allowOverInflation is enabled)
    const devices = loadData(DATA_FILES.devices) || [];
    const settings = loadData(DATA_FILES.settings);
    const fullDevice = devices.find(d =>
      d.ip === deviceIdOrIp ||
      d.deviceId === deviceIdOrIp ||
      (d.ip === deviceIdOrIp && d.childId === childId)
    );

    const isPump = fullDevice?.deviceType === 'PUMP' || fullDevice?.isPrimaryPump;
    const allowOverInflation = settings?.globalCharacterControls?.allowOverInflation;

    if (isPump && !allowOverInflation && sessionState.capacity >= 100) {
      console.log(`[Safety] Blocked manual pump activation - capacity at ${sessionState.capacity}%`);
      broadcast('pump_safety_block', {
        reason: 'capacity_limit',
        capacity: sessionState.capacity,
        device: fullDevice?.label || fullDevice?.name || deviceIdOrIp,
        source: 'manual'
      });
      return res.json({ success: false, blocked: true, reason: 'Capacity at maximum - pump blocked for safety' });
    }

    // Use fullDevice (with deviceType, calibrationTime) for capacity tracking, fall back to minimal device
    const result = await deviceService.turnOn(deviceIdOrIp, fullDevice || device);
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
    } else if (brand === 'tapo') {
      device = { ip: deviceIdOrIp, brand: 'tapo' };
    } else if (childId) {
      device = { ip: deviceIdOrIp, childId, brand: 'tplink' };
    }

    // Find full device info for proper runtime tracking
    const devices = loadData(DATA_FILES.devices) || [];
    const fullDevice = devices.find(d =>
      d.ip === deviceIdOrIp ||
      d.deviceId === deviceIdOrIp ||
      (d.ip === deviceIdOrIp && d.childId === childId)
    );

    // Use fullDevice (with deviceType, calibrationTime) for capacity tracking, fall back to minimal device
    const result = await deviceService.turnOff(deviceIdOrIp, fullDevice || device);
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
    } else if (brand === 'tapo') {
      device = { ip: deviceIdOrIp, brand: 'tapo' };
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

// --- Tapo (TP-Link Tapo smart plugs) ---

// Connect to Tapo (save credentials)
app.post('/api/tapo/connect', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  tapoService.setCredentials(email, password);

  try {
    const success = await tapoService.testConnection();

    if (success) {
      // Save encrypted credentials to settings
      const settings = loadData(DATA_FILES.settings) || {};
      settings.tapoEmail = encrypt(email);
      settings.tapoPassword = encrypt(password);
      saveData(DATA_FILES.settings, settings);
      console.log('[Tapo] Credentials saved and connection verified');
      res.json({ success: true, message: 'Connected to Tapo' });
    } else {
      tapoService.clearCredentials();
      res.status(401).json({ error: 'Invalid credentials or connection failed' });
    }
  } catch (error) {
    console.error('[Tapo] Connect error:', error);
    tapoService.clearCredentials();
    res.status(401).json({ error: error.message || 'Connection failed' });
  }
});

// Check Tapo connection status
app.get('/api/tapo/status', (req, res) => {
  res.json({ connected: tapoService.isConnected() });
});

// Disconnect from Tapo (clear credentials)
app.post('/api/tapo/disconnect', (req, res) => {
  tapoService.clearCredentials();
  // Remove from settings
  const settings = loadData(DATA_FILES.settings) || {};
  delete settings.tapoEmail;
  delete settings.tapoPassword;
  saveData(DATA_FILES.settings, settings);
  console.log('[Tapo] Credentials cleared');
  res.json({ success: true, message: 'Disconnected from Tapo' });
});

// List Tapo devices (cloud discovery)
app.get('/api/tapo/devices', async (req, res) => {
  if (!tapoService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Tapo' });
  }

  try {
    const devices = await tapoService.listDevices();
    res.json({ devices });
  } catch (error) {
    console.error('[Tapo] Failed to list devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Tapo device info by IP
app.get('/api/tapo/devices/:ip/info', async (req, res) => {
  const { ip } = req.params;

  if (!tapoService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Tapo' });
  }

  try {
    const info = await tapoService.getDeviceInfo(ip);
    res.json(info);
  } catch (error) {
    console.error('[Tapo] Failed to get device info:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Tapo device on
app.post('/api/tapo/devices/:ip/on', async (req, res) => {
  const { ip } = req.params;

  if (!tapoService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Tapo' });
  }

  try {
    await tapoService.turnOn(ip);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[Tapo] Failed to turn on device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Tapo device off
app.post('/api/tapo/devices/:ip/off', async (req, res) => {
  const { ip } = req.params;

  if (!tapoService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Tapo' });
  }

  try {
    await tapoService.turnOff(ip);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[Tapo] Failed to turn off device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Tapo device state
app.get('/api/tapo/devices/:ip/state', async (req, res) => {
  const { ip } = req.params;

  if (!tapoService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Tapo' });
  }

  try {
    const state = await tapoService.getPowerState(ip);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[Tapo] Failed to get device state:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Matter Device Control ---

app.get('/api/matter/status', (req, res) => {
  const fs = require('fs');
  const chipToolPath = path.join(__dirname, 'bin', 'chip-tool', 'chip-tool.exe');
  const installed = fs.existsSync(chipToolPath);
  const serverStatus = matterService.getServerStatus();

  res.json({
    matterControllerInstalled: installed,
    binaryPath: chipToolPath,
    ready: matterService.isReady(),
    server: serverStatus,
    installing: matterService.installing
  });
});

// Initialize/install Matter binary
app.post('/api/matter/initialize', async (req, res) => {
  try {
    const result = await matterService.initialize();
    res.json({
      success: result,
      ready: matterService.isReady(),
      message: result ? 'Matter support enabled' : 'Matter initialization failed'
    });
  } catch (error) {
    console.error('[Matter] Failed to initialize:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to initialize Matter support. You may need to download chip-tool manually.'
    });
  }
});

app.post('/api/matter/server/start', async (req, res) => {
  try {
    const result = await matterService.startServer();
    res.json(result);
  } catch (error) {
    console.error('[Matter] Failed to start server:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matter/server/stop', async (req, res) => {
  try {
    const result = await matterService.stopServer();
    res.json(result);
  } catch (error) {
    console.error('[Matter] Failed to stop server:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matter/server/autostart', async (req, res) => {
  const { enabled } = req.body;

  try {
    const result = matterService.setAutoStart(enabled);
    res.json(result);
  } catch (error) {
    console.error('[Matter] Failed to set auto-start:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matter/commission', async (req, res) => {
  const { pairingCode, deviceName } = req.body;

  if (!pairingCode) {
    return res.status(400).json({ error: 'Pairing code is required' });
  }

  try {
    const result = await matterService.commission(pairingCode, deviceName);
    res.json(result);
  } catch (error) {
    console.error('[Matter] Failed to commission device:', error);
    res.status(500).json({ error: error.message || 'Failed to commission device' });
  }
});

app.get('/api/matter/devices', async (req, res) => {
  try {
    const devices = await matterService.getDevices();
    res.json(devices);
  } catch (error) {
    console.error('[Matter] Failed to get devices:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matter/devices/:deviceId/on', async (req, res) => {
  const { deviceId } = req.params;

  try {
    await matterService.turnOn(deviceId);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[Matter] Failed to turn on device:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/matter/devices/:deviceId/off', async (req, res) => {
  const { deviceId } = req.params;

  try {
    await matterService.turnOff(deviceId);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[Matter] Failed to turn off device:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/matter/devices/:deviceId/state', async (req, res) => {
  const { deviceId } = req.params;

  try {
    const state = await matterService.getState(deviceId);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[Matter] Failed to get device state:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Emergency Stop (ALL devices, flows, and LLM) ---
app.post('/api/emergency-stop', async (req, res) => {
  console.log('[EMERGENCY STOP] Stopping ALL devices, flows, and LLM requests!');
  const results = {
    devices: [],
    flows: null,
    llm: null
  };

  // 1. Stop ALL pump runtime tracking intervals immediately
  deviceService.stopAllPumpRuntimeTracking();

  // 2. Halt all flow execution
  if (eventEngine) {
    results.flows = eventEngine.emergencyStop();
  }

  // 3. Stop ALL devices (including cycles)
  const devices = loadData(DATA_FILES.devices) || [];
  for (const device of devices) {
    try {
      // Get correct identifier - Tuya/Govee/Wyze use deviceId, TPLink uses ip
      const deviceIdentifier = (device.brand === 'tuya' || device.brand === 'govee' || device.brand === 'wyze')
        ? device.deviceId
        : device.ip;

      if (deviceIdentifier) {
        // Stop any active cycle first
        deviceService.stopCycle(deviceIdentifier);
        // Turn off the device
        await deviceService.turnOff(deviceIdentifier, device);
        results.devices.push({ id: deviceIdentifier, name: device.name || device.label || deviceIdentifier, success: true });
        console.log(`[EMERGENCY STOP] Stopped device: ${device.name || device.label || deviceIdentifier}`);
      }
    } catch (error) {
      results.devices.push({ id: device.ip || device.deviceId, name: device.name || device.label, success: false, error: error.message });
      console.error(`[EMERGENCY STOP] Failed to stop device ${device.name || device.ip}:`, error.message);
    }
  }

  if (devices.length === 0) {
    console.log('[EMERGENCY STOP] No devices configured to stop');
  }

  // 4. Abort all pending LLM requests
  results.llm = { aborted: llmService.abortAllRequests() };

  // 5. Clear any LLM device control auto-off timers
  aiDeviceControl.clearAllLlmTimers();

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
    broadcast('personas_update', loadAllPersonas());
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

  // Clone character data for export
  const exportCharacter = { ...character };

  // Embed avatar image if it exists and is a local path
  if (exportCharacter.avatar && exportCharacter.avatar.startsWith('/api/images/')) {
    try {
      // Parse avatar path: /api/images/chars/{folder}/{id}/{filename}
      const avatarMatch = exportCharacter.avatar.match(/^\/api\/images\/(chars)\/(default|custom)\/([^/]+)\/(.+)$/);
      if (avatarMatch) {
        const [, type, folder, charId, filename] = avatarMatch;
        const filePath = imageStorage.getImageFilePath(type, folder, charId, filename);
        if (filePath && fs.existsSync(filePath)) {
          const imageBuffer = fs.readFileSync(filePath);
          const ext = path.extname(filename).toLowerCase().replace('.', '');
          const mimeType = ext === 'jpg' ? 'jpeg' : ext;
          exportCharacter.avatarData = `data:image/${mimeType};base64,${imageBuffer.toString('base64')}`;
        }
      }
    } catch (err) {
      console.error('[Export] Failed to embed avatar image:', err.message);
      // Continue without embedded image - avatar URL will still be present
    }
  }

  const exportData = {
    type: 'swelldreams-character',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: exportCharacter
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${character.name.replace(/[^a-z0-9]/gi, '_')}_character.json"`);
  res.json(exportData);
});

// Export character as PNG character card (V3 or SwellD format)
app.post('/api/export/character/:id/png', async (req, res) => {
  try {
    const { format = 'swelld', storyMode = 'all', selectedStoryIds = [], embedFlows = false } = req.body;

    // Validate format
    if (!['v3', 'swelld'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Must be "v3" or "swelld".' });
    }

    // Load character
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

    // Resolve selected stories
    let selectedStories;
    if (storyMode === 'selected' && selectedStoryIds.length > 0) {
      const selectedSet = new Set(selectedStoryIds);
      selectedStories = (character.stories || []).filter(s => selectedSet.has(s.id));
    } else {
      selectedStories = character.stories || [];
    }

    // Load flows if embedding
    let flows = [];
    if (embedFlows && format === 'swelld') {
      // Collect all assigned flow IDs from character and selected stories
      const flowIds = new Set(character.assignedFlows || []);
      for (const story of selectedStories) {
        for (const fid of (story.assignedFlows || [])) {
          flowIds.add(fid);
        }
      }
      if (flowIds.size > 0) {
        flows = isPerFlowStorageActive()
          ? loadFlows([...flowIds])
          : (loadData(DATA_FILES.flows) || []).filter(f => flowIds.has(f.id));
      }
    }

    // Generate PNG
    const pngBuffer = await characterExporter.exportCharacterPNG(character, format, {
      selectedStories,
      flows,
      embedFlows
    });

    // Send as download
    const safeName = (character.name || 'Character').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.png"`);
    res.send(pngBuffer);

  } catch (error) {
    console.error('[Export PNG] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to export character as PNG' });
  }
});

// Export single persona
app.get('/api/export/persona/:id', (req, res) => {
  const personas = loadAllPersonas() || [];
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
  const personas = loadAllPersonas() || [];
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
app.post('/api/import/character', async (req, res) => {
  try {
    const importData = req.body;

    if (importData.type !== 'swelldreams-character') {
      return res.status(400).json({ error: 'Invalid import file type. Expected swelldreams-character.' });
    }

    // Generate new ID first - needed for saving the image
    const newId = uuidv4();

    const newCharacter = {
      ...importData.data,
      id: newId,
      importedAt: Date.now(),
      updatedAt: Date.now()
    };

    // Normalize story progression and device control limit fields on all imported stories
    if (newCharacter.stories) {
      for (const story of newCharacter.stories) {
        story.storyProgressionEnabled = story.storyProgressionEnabled ?? false;
        story.storyProgressionMaxOptions = story.storyProgressionMaxOptions ?? 3;
        story.llmMaxOnDuration = story.llmMaxOnDuration ?? 5;
        story.llmMaxCycleOnDuration = story.llmMaxCycleOnDuration ?? 2;
        story.llmMaxCycleRepetitions = story.llmMaxCycleRepetitions ?? 2;
        story.llmMaxPulseRepetitions = story.llmMaxPulseRepetitions ?? 5;
        story.llmMaxTimedDuration = story.llmMaxTimedDuration ?? 10;
        story.checkpoints = story.checkpoints || {};
        story.attributes = story.attributes || {};
      }
    }

    // Handle embedded avatar image
    if (newCharacter.avatarData && imageStorage.isBase64DataUri(newCharacter.avatarData)) {
      try {
        // Save the embedded image to disk and get the new URL path
        const newAvatarPath = await imageStorage.saveCharacterImage(
          newId,
          newCharacter.avatarData,
          'avatar',
          false // Always import to custom
        );
        newCharacter.avatar = newAvatarPath;
      } catch (imgError) {
        console.error('[Import] Failed to save embedded image:', imgError.message);
        // Clear avatar if image save failed
        newCharacter.avatar = null;
      }
    } else if (newCharacter.avatar && newCharacter.avatar.startsWith('/api/images/')) {
      // Avatar URL points to the old system - clear it since the image won't exist
      newCharacter.avatar = null;
    }

    // Remove the embedded image data - don't store it in JSON
    delete newCharacter.avatarData;

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
app.post('/api/import/persona', async (req, res) => {
  try {
    const importData = req.body;

    if (importData.type !== 'swelldreams-persona') {
      return res.status(400).json({ error: 'Invalid import file type. Expected swelldreams-persona.' });
    }

    const newPersona = {
      ...importData.data,
      id: uuidv4(),
      importedAt: Date.now(),
      updatedAt: Date.now()
    };

    // Save to folder structure (always custom for imports)
    const savedPersona = await savePersonaAsync(newPersona, true);
    broadcast('personas_update', loadAllPersonas());

    res.json({ success: true, persona: savedPersona });
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
app.post('/api/import/backup', async (req, res) => {
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
      for (const persona of importData.data.personas) {
        const newPersona = {
          ...persona,
          id: uuidv4(),
          importedAt: Date.now(),
          updatedAt: Date.now()
        };
        // Save each persona to folder structure (always custom for imports)
        await savePersonaAsync(newPersona, true);
        results.personas++;
      }
      broadcast('personas_update', loadAllPersonas());
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

// ============================================
// Migration: Convert base64 images to files
// ============================================
app.post('/api/migrate-images', async (req, res) => {
  try {
    const results = { personas: { migrated: 0, errors: [] }, characters: { migrated: 0, errors: [] } };

    // Migrate personas from old personas.json
    const oldPersonas = loadData(DATA_FILES.personas) || [];
    for (const persona of oldPersonas) {
      try {
        // Check if already migrated to folder structure
        const customPath = path.join(PERSONAS_CUSTOM_DIR, persona.id, 'persona.json');
        const defaultPath = path.join(PERSONAS_DEFAULT_DIR, persona.id, 'persona.json');
        if (fs.existsSync(customPath) || fs.existsSync(defaultPath)) {
          continue; // Already migrated
        }

        // Process images and save to folder structure
        await savePersonaAsync(persona, true);
        results.personas.migrated++;
      } catch (err) {
        results.personas.errors.push({ id: persona.id, error: err.message });
      }
    }

    // Clear old personas.json after successful migration
    if (results.personas.migrated > 0 && results.personas.errors.length === 0) {
      saveData(DATA_FILES.personas, []);
    }

    // Migrate characters from old flat files
    if (isPerCharStorageActive()) {
      const allChars = loadAllCharacters();
      for (const char of allChars) {
        try {
          // Check if already in new folder structure
          const customFolderPath = path.join(CHARS_CUSTOM_DIR, char.id, 'char.json');
          const defaultFolderPath = path.join(CHARS_DEFAULT_DIR, char.id, 'char.json');
          if (fs.existsSync(customFolderPath) || fs.existsSync(defaultFolderPath)) {
            // Already in folder structure, just process images if needed
            if (char.avatar && imageStorage.isBase64DataUri(char.avatar)) {
              await saveCharacterAsync(char);
              results.characters.migrated++;
            }
            continue;
          }

          // Process images and save to folder structure
          await saveCharacterAsync(char, false);
          results.characters.migrated++;
        } catch (err) {
          results.characters.errors.push({ id: char.id, error: err.message });
        }
      }
    }

    res.json({
      success: true,
      message: `Migrated ${results.personas.migrated} personas and ${results.characters.migrated} characters`,
      results
    });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 8889;

// Ensure all indexes exist and are valid before starting
ensureCharsIndex();
ensureFlowsIndex();
ensurePersonasIndex();
ensureActorsIndex();
ensurePlaysIndex();

server.listen(PORT, () => {
  log.always(`SwellDreams server running on http://localhost:${PORT}`);
  // Detect model name from active LLM endpoint on startup
  detectLlmModel();
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
    // 1. Stop ALL pump runtime tracking intervals immediately
    deviceService.stopAllPumpRuntimeTracking();
    console.log('[FAILSAFE] Pump runtime tracking stopped');

    // 2. Stop all device cycles and turn off devices
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

    // 3. Stop all flows
    if (eventEngine) {
      eventEngine.emergencyStop();
      console.log('[FAILSAFE] Flows halted');
    }

    // 4. Abort all LLM requests
    llmService.abortAllRequests();
    console.log('[FAILSAFE] LLM requests aborted');

    // 5. Kill any lingering Python processes
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
  // Ignore EPIPE errors - they're harmless (attempt to write to already-closed process)
  if (error.code === 'EPIPE' || error.errno === -4047 || error.syscall === 'write') {
    console.log('[FAILSAFE] Ignoring EPIPE error (broken pipe to subprocess)');
    return;
  }

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
