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
const kasaKlapService = require('./services/kasa-klap-service');
const haService = require('./services/homeassistant-service');
const aiDeviceControl = require('./services/ai-device-control');
const imageStorage = require('./services/image-storage');
const mediaStorage = require('./services/media-storage');

// Utilities
const { createLogger } = require('./utils/logger');
const { AppError, ValidationError } = require('./utils/errors');
const validators = require('./utils/validators');
const { atomicWriteJson } = require('./utils/atomic-write');
const { isSafeId, assertSafeId } = require('./utils/id-validator');
const {
  validateCharacter: mwValidateCharacter,
  validatePersona: mwValidatePersona,
  validateFlow: mwValidateFlow,
  validateDevice: mwValidateDevice,
  validateIdParam: mwValidateIdParam
} = require('./middleware/validate');
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

// Returns true for loopback / local remote addresses.
function isLocalAddress(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost' || a.startsWith('127.');
}

// Load remote-access settings directly from disk (used before getRemoteSettings exists).
function readRemoteSettingsRaw() {
  try {
    const p = path.join(__dirname, 'data', 'remote-settings.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) { /* fall through to default */ }
  return { allowRemote: false, whitelistedIps: [] };
}

// Validate an Origin/Host header host against localhost + the remote allow-list.
function isAllowedHost(host, remoteSettings) {
  if (!host) return true; // same-origin / non-browser clients send no Origin
  if (isLocalAddress(host)) return true;
  if (remoteSettings && remoteSettings.allowRemote && Array.isArray(remoteSettings.whitelistedIps)) {
    return remoteSettings.whitelistedIps.includes(host);
  }
  return false;
}

// Extract just the host portion from an Origin or Host header value.
function extractHost(value) {
  if (!value) return null;
  const m = String(value).match(/^(?:https?:\/\/)?([^:\/]+)/);
  return m ? m[1] : null;
}

const wss = new WebSocket.Server({
  server,
  // Gate WS upgrades by the CLIENT's remote IP — identical model to the HTTP
  // remote-access middleware. (Do NOT gate on the Origin/Host the client connected
  // TO: that's the server's own address/hostname, e.g. a Tailscale MagicDNS name,
  // which is not — and should not be — in the client-IP whitelist.)
  verifyClient: (info, done) => {
    const remoteSettings = readRemoteSettingsRaw();
    const remoteAddr = info.req.socket && info.req.socket.remoteAddress;
    // Always allow strictly-local connections.
    if (isLocalAddress(remoteAddr)) {
      return done(true);
    }
    if (!remoteSettings.allowRemote) {
      return done(false, 403, 'Remote access disabled');
    }
    const cleanIp = String(remoteAddr || '').replace(/^::ffff:/, '');
    if (Array.isArray(remoteSettings.whitelistedIps) && remoteSettings.whitelistedIps.includes(cleanIp)) {
      return done(true);
    }
    return done(false, 403, 'IP not in whitelist');
  }
});

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

    // Extract host and port from origin (e.g., "http://100.64.0.1:8889" -> host "100.64.0.1", port "8889")
    const originMatch = origin.match(/^https?:\/\/([^:\/]+)(?::(\d+))?/);
    const originHost = originMatch ? originMatch[1] : null;
    const originPort = originMatch ? originMatch[2] : null;

    // Allow same-origin: if the origin port matches this server's port, it's our own frontend
    if (originPort === String(PORT)) {
      callback(null, true);
      return;
    }

    // Allow if the origin host matches any whitelisted IP
    if (originHost && remoteSettings.whitelistedIps.includes(originHost)) {
      callback(null, true);
      return;
    }

    callback(new Error('IP not in whitelist'));
  },
  credentials: true
};

// Middleware
app.use(cors(CORS_OPTIONS));

// Body-size limits: the global default is modest (2mb) to limit memory abuse,
// while routes that legitimately carry large base64 images / backups (imports,
// media, character & persona payloads with embedded avatars) get a 50mb limit.
const largeJsonParser = express.json({ limit: '50mb' });
const smallJsonParser = express.json({ limit: '2mb' });
const LARGE_JSON_PREFIXES = [
  '/api/import',
  '/api/media',
  '/api/migrate-images',
  '/api/characters',
  '/api/personas',
  '/api/actors',
  '/api/plays',
  '/api/display-settings'
];
app.use((req, res, next) => {
  const usesLarge = LARGE_JSON_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'));
  return (usesLarge ? largeJsonParser : smallJsonParser)(req, res, next);
});

// Remote-access enforcement: when allowRemote is off, only loopback clients may
// reach the API/app. When on, the remote IP must be on the whitelist. This does
// NOT rely on CORS (which only protects browsers) — it gates by remote IP.
app.use((req, res, next) => {
  const remoteAddr = req.ip || (req.socket && req.socket.remoteAddress) || '';
  if (isLocalAddress(remoteAddr)) {
    return next();
  }
  const remoteSettings = readRemoteSettingsRaw();
  if (!remoteSettings.allowRemote) {
    return res.status(403).json({ success: false, error: 'Remote access disabled' });
  }
  const cleanIp = String(remoteAddr).replace(/^::ffff:/, '');
  if (Array.isArray(remoteSettings.whitelistedIps) && remoteSettings.whitelistedIps.includes(cleanIp)) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'IP not in whitelist' });
});

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

  // Prevent path traversal via id/filename before they reach path.join.
  if (!isSafeId(id)) {
    return res.status(400).send('Invalid id');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
    return res.status(400).send('Invalid filename');
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

// ==================== PORTRAIT MEDIA API ====================

// Multer config for portrait media uploads (disk-based to avoid memory pressure for large videos)
const portraitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB max per portrait video
});

// Upload a portrait media file (image or video) to a specific slot
app.post('/api/portrait-media/:type/:folder/:id', portraitUpload.single('file'), async (req, res) => {
  try {
    const { type, folder, id } = req.params;
    const { slot } = req.body;

    if (!slot || !req.file) {
      return res.status(400).json({ error: 'Missing file or slot parameter' });
    }
    if (!['chars', 'personas'].includes(type) || !['default', 'custom'].includes(folder)) {
      return res.status(400).json({ error: 'Invalid type or folder' });
    }

    const isDefault = folder === 'default';
    const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase() || 'mp4';
    const url = await imageStorage.savePortraitMedia(type, id, isDefault, slot, req.file.buffer, ext);

    console.log(`[PortraitMedia] Saved ${slot}.${ext} for ${type}/${folder}/${id}`);
    res.json({ url, slot, isVideo: imageStorage.isVideoFile(`${slot}.${ext}`) });
  } catch (error) {
    console.error('[PortraitMedia] Upload error:', error);
    res.status(500).json({ error: 'Failed to save portrait media' });
  }
});

// Delete a portrait media slot
app.delete('/api/portrait-media/:type/:folder/:id/:slot', async (req, res) => {
  try {
    const { type, folder, id, slot } = req.params;
    if (!['chars', 'personas'].includes(type) || !['default', 'custom'].includes(folder)) {
      return res.status(400).json({ error: 'Invalid type or folder' });
    }

    const isDefault = folder === 'default';
    await imageStorage.deletePortraitMedia(type, id, isDefault, slot);

    console.log(`[PortraitMedia] Deleted ${slot} for ${type}/${folder}/${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[PortraitMedia] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete portrait media' });
  }
});

// List all portrait media for an entity
app.get('/api/portrait-media/:type/:folder/:id', async (req, res) => {
  try {
    const { type, folder, id } = req.params;
    if (!['chars', 'personas'].includes(type) || !['default', 'custom'].includes(folder)) {
      return res.status(400).json({ error: 'Invalid type or folder' });
    }

    const isDefault = folder === 'default';
    const files = await imageStorage.listPortraitMedia(type, id, isDefault);
    res.json({ files });
  } catch (error) {
    console.error('[PortraitMedia] List error:', error);
    res.status(500).json({ error: 'Failed to list portrait media' });
  }
});

// ==================== PORTRAIT MEDIA ZIP EXPORT/IMPORT ====================

const archiver = require('archiver');
const AdmZip = require('adm-zip');

// Export all portrait media as a zip
app.get('/api/export/portrait-media/:type/:folder/:id', async (req, res) => {
  try {
    const { type, folder, id } = req.params;
    if (!['chars', 'personas'].includes(type) || !['default', 'custom'].includes(folder)) {
      return res.status(400).json({ error: 'Invalid type or folder' });
    }

    const isDefault = folder === 'default';
    const imgDir = imageStorage.getImgDir(type, id, isDefault);

    try {
      await require('fs').promises.access(imgDir);
    } catch {
      return res.status(404).json({ error: 'No portrait media found' });
    }

    let entity;
    if (type === 'chars') {
      entity = loadCharacter(id);
    } else {
      entity = loadPersona(id);
    }

    const name = entity?.name || entity?.displayName || id;
    const manifest = {
      entityType: type,
      entityId: id,
      name,
      portraitMedia: type === 'chars' ? entity?.charPortraitMedia : entity?.portraitMedia,
      portraitCrop: type === 'chars' ? entity?.charPortraitCrop : entity?.portraitCrop,
      exportedAt: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^a-zA-Z0-9]/g, '_')}-portraits.zip"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.directory(imgDir, 'img');
    await archive.finalize();
    console.log(`[PortraitMedia] Exported portrait zip for ${type}/${folder}/${id} (${name})`);
  } catch (error) {
    console.error('[PortraitMedia] Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export portrait media' });
    }
  }
});

// Import portrait media from a zip
app.post('/api/import/portrait-media/:type/:folder/:id', portraitUpload.single('file'), async (req, res) => {
  try {
    const { type, folder, id } = req.params;
    if (!['chars', 'personas'].includes(type) || !['default', 'custom'].includes(folder)) {
      return res.status(400).json({ error: 'Invalid type or folder' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No zip file provided' });
    }

    const isDefault = folder === 'default';
    const imgDir = imageStorage.getImgDir(type, id, isDefault);
    await imageStorage.ensureDir(imgDir);

    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    let manifest = null;

    for (const entry of entries) {
      if (entry.entryName === 'manifest.json') {
        manifest = JSON.parse(entry.getData().toString('utf8'));
        continue;
      }
      if (entry.entryName.startsWith('img/') && !entry.isDirectory) {
        const filename = entry.entryName.replace('img/', '');
        const filePath = path.join(imgDir, filename);
        await require('fs').promises.writeFile(filePath, entry.getData());
      }
    }

    if (manifest) {
      if (type === 'chars') {
        const char = loadCharacter(id);
        if (char) {
          if (manifest.portraitMedia) char.charPortraitMedia = manifest.portraitMedia;
          if (manifest.portraitCrop) char.charPortraitCrop = manifest.portraitCrop;
          await saveCharacterAsync(char);
        }
      } else {
        const persona = loadPersona(id);
        if (persona) {
          if (manifest.portraitMedia) persona.portraitMedia = manifest.portraitMedia;
          if (manifest.portraitCrop) persona.portraitCrop = manifest.portraitCrop;
          await savePersonaAsync(persona);
        }
      }
    }

    console.log(`[PortraitMedia] Imported portrait zip for ${type}/${folder}/${id}`);
    res.json({ success: true, filesImported: entries.filter(e => !e.isDirectory && e.entryName !== 'manifest.json').length });
  } catch (error) {
    console.error('[PortraitMedia] Import error:', error);
    res.status(500).json({ error: 'Failed to import portrait media' });
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
  deviceLabels: path.join(DATA_DIR, 'device-labels.json'),
  triggerSets: path.join(DATA_DIR, 'trigger-sets.json')
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
// Pump safety constants & helpers
// ============================================

// Hard ceiling on continuous pump on-time, applied at EVERY device-on timer site.
// A single source of truth — do not duplicate this value.
const MAX_ON_SECONDS = 1800; // 30 minutes

// Clamp a (possibly client-supplied) maxTokens value to a sane positive integer
// before it is sent to the provider, so bogus/huge/negative values can't be passed through.
const MAX_TOKENS_CEILING = 8192;
function clampMaxTokens(value, fallback = 320) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_TOKENS_CEILING);
}

// Per-character "Individual Response Tokens" override. Returns a patch object to spread
// over an llm settings object ({ maxTokens } when the card sets responseTokens, else {}).
function charTokenOverride(character) {
  const rt = Number(character?.responseTokens);
  return rt > 0 ? { maxTokens: clampMaxTokens(rt) } : {};
}

// Tracked server-side "timed pump on" off-timers, keyed by control id. Cleared by
// emergency stop / watchdog so a scheduled turn-off can never outlive a stop.
const serverTimedPumpTimers = new Map();

function clearServerTimedPumpTimer(id) {
  const t = serverTimedPumpTimers.get(id);
  if (t) {
    clearTimeout(t);
    serverTimedPumpTimers.delete(id);
  }
}

function clearAllServerTimedPumpTimers() {
  for (const t of serverTimedPumpTimers.values()) {
    try { clearTimeout(t); } catch (e) { /* ignore */ }
  }
  serverTimedPumpTimers.clear();
}

/**
 * Turn a pump on for a bounded duration, scheduling a tracked turn-off that
 * emergency stop / the watchdog will cancel. Duration is clamped to MAX_ON_SECONDS.
 */
async function timedPumpOn(id, device, durationSeconds) {
  const dur = Math.max(1, Math.min(Number(durationSeconds) || 1, MAX_ON_SECONDS));
  clearServerTimedPumpTimer(id);
  await deviceService.turnOn(id, device);
  const timer = setTimeout(() => {
    serverTimedPumpTimers.delete(id);
    deviceService.turnOff(id, device).catch((err) => {
      console.error(`[timedPumpOn] turnOff failed for ${id}:`, err && err.message ? err.message : err);
    });
  }, dur * 1000);
  serverTimedPumpTimers.set(id, timer);
}

// Fire the primary pump for a checkpoint-injection action ({mode:'timed'|'cycle', duration, cycles}).
async function firePrimaryPump(action) {
  if (!action) return;
  const devices = loadData(DATA_FILES.devices) || [];
  const pump = devices.find(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
  if (!pump) return;
  const id = resolveControlId(pump);
  const dur = Number(action.duration) || 5;
  if (action.mode === 'cycle') {
    const cycles = Number(action.cycles) || 3;
    await deviceService.startCycle(id, { duration: dur, interval: dur, cycles }, pump);
  } else {
    await timedPumpOn(id, pump, dur);
  }
  broadcast('ai_device_control', { device: 'pump', action: action.mode || 'timed', deviceName: pump.label || pump.name || 'Pump' });
}

// Auto-pump pacing for electric/auto instructor ranges. Drives [pump on] on a paced
// cadence: every N assistant replies ("messages between ON") it turns the pump on for the
// range's "maximum pump ON (secs)" (auto-off via timedPumpOn). Skips entirely — no pump-on,
// no message/trigger — if the pump is already running or pacing isn't configured for the
// active range. Runs before generation so the pump is moving while the model writes.
async function executeAutoPumpPacing(character, isFlowChain) {
  if (isFlowChain) return;
  if (sessionState.pumpType !== 'electric') return;            // manual pumps use batch pacing
  if (!sessionState.preInflationGateMet) return;               // respect the pre-inflation gate
  const cp = getActiveCheckpoint(character, sessionState.capacity || 0);
  const gap = parseInt(cp?.messagesBetweenOn);
  if (!(gap > 0)) return;                                      // pacing disabled for this range

  // Capacity ceiling (unless over-inflation is allowed).
  const settings = loadData(DATA_FILES.settings) || {};
  const allowOver = settings?.globalCharacterControls?.allowOverInflation;
  if (!allowOver && (sessionState.capacity || 0) >= 100) return;

  // Count this reply; only fire once the gap is reached.
  sessionState.messagesSincePumpOn = (sessionState.messagesSincePumpOn || 0) + 1;
  if (sessionState.messagesSincePumpOn < gap) return;

  const devices = loadData(DATA_FILES.devices) || [];
  const pump = devices.find(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
  if (!pump) return;
  const id = resolveControlId(pump);
  // Already running (a timed-on is in flight) → skip without resetting the counter.
  if (serverTimedPumpTimers.has(id)) return;

  const maxSecs = parseInt(cp?.maxPumpOnSecs);
  const dur = (maxSecs > 0) ? maxSecs : 5;
  await timedPumpOn(id, pump, dur);
  sessionState.messagesSincePumpOn = 0;
  broadcast('ai_device_control', { device: 'pump', action: 'timed', deviceName: pump.label || pump.name || 'Pump' });
  console.log(`[AutoPumpPacing] [pump on] for ${dur}s (every ${gap} msgs) at ${sessionState.capacity}%`);
}

/**
 * Resolve the identifier used to start/stop a cycle or control a device.
 * Cloud brands key on deviceId; local/IP brands key on ip. Home Assistant keys
 * on deviceId (its entity/device id), NOT ip. This MUST match the id the cycle
 * was started with so stopCycle/turnOff target the right tracker entry.
 *
 * @param {object} device
 * @returns {string|undefined}
 */
function resolveControlId(device) {
  if (!device) return undefined;
  const brand = device.brand;
  if (brand === 'tuya' || brand === 'govee' || brand === 'wyze' || brand === 'homeassistant') {
    return device.deviceId || device.ip;
  }
  return device.ip || device.deviceId;
}

/**
 * Race a promise against a per-device timeout so an offline device cannot block.
 */
function withTimeout(promise, timeoutMs, onTimeoutValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(onTimeoutValue), timeoutMs))
  ]);
}

/**
 * Turn off a single device, stopping its cycle first using the SAME id the cycle
 * was started with. Resolves a normalized { ok, error, confirmed } shape and
 * never throws (errors are captured into the result).
 */
async function safeStopDevice(device, opts = {}) {
  const name = device.name || device.label || device.ip || device.deviceId || 'unknown';
  const controlId = resolveControlId(device);
  if (!controlId) {
    return { name, device, ok: false, error: 'No control id for device' };
  }
  try {
    // Stop the tracked cycle using the resolved control id (covers homeassistant too).
    try { await deviceService.stopCycle(controlId, device); } catch (e) { /* best-effort */ }

    let result;
    if (typeof deviceService.turnOffWithConfirm === 'function') {
      result = await deviceService.turnOffWithConfirm(controlId, device, opts);
    } else {
      // Fallback if confirm variant is unavailable.
      result = await deviceService.turnOff(controlId, device);
    }
    const ok = result && (result.ok === true || result.success === true);
    return {
      name, device,
      ok: !!ok,
      error: ok ? undefined : (result && result.error) || 'turn-off not confirmed',
      confirmed: result && result.confirmed
    };
  } catch (err) {
    return { name, device, ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Stop/turn-off every supplied device concurrently with a per-device timeout.
 * Returns an array of normalized { name, ok, error } results (never blanket success).
 */
async function stopAllDevicesConcurrently(devices, logPrefix = '[Stop]', opts = {}) {
  const perDeviceTimeout = opts.timeoutMs || 5000;
  const settled = await Promise.allSettled(
    (devices || []).map((device) => {
      const name = device.name || device.label || device.ip || device.deviceId || 'unknown';
      return withTimeout(
        safeStopDevice(device, opts),
        perDeviceTimeout,
        { name, device, ok: false, error: 'timeout', confirmed: false }
      );
    })
  );
  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const device = (devices || [])[i] || {};
    const name = device.name || device.label || device.ip || device.deviceId || 'unknown';
    return { name, device, ok: false, error: s.reason && s.reason.message ? s.reason.message : 'rejected' };
  });
}

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
    // Primary file is corrupt/unparseable — attempt the rolling backup loudly.
    const bakFile = file + '.bak';
    try {
      if (fs.existsSync(bakFile)) {
        const recovered = JSON.parse(fs.readFileSync(bakFile, 'utf8'));
        console.error(`[loadData] RECOVERED ${file} from backup ${bakFile} after parse failure`);
        return recovered;
      }
    } catch (bakErr) {
      console.error(`[loadData] Backup ${bakFile} also failed to parse:`, bakErr);
    }
  }
  return null;
}

function saveData(file, data) {
  try {
    atomicWriteJson(file, data);
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
  atomicWriteJson(indexPath, index);
}

// Load single flow by ID
function loadFlow(flowId) {
  assertSafeId(flowId);
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
  assertSafeId(flow && flow.id);
  if (!fs.existsSync(FLOWS_DIR)) {
    fs.mkdirSync(FLOWS_DIR, { recursive: true });
  }
  const flowPath = path.join(FLOWS_DIR, `${flow.id}.json`);
  atomicWriteJson(flowPath, flow);
  updateFlowIndex(flow);
}

// Delete flow file + remove from index
function deleteFlowFile(flowId) {
  assertSafeId(flowId);
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
  atomicWriteJson(indexPath, index);
}

/**
 * Migrate old charStagedPortraits to charPortraitMedia format.
 * Only runs if charPortraitMedia doesn't exist yet.
 */
function migrateCharPortraitMedia(character) {
  if (!character) return character;
  if (character.charPortraitMedia) return character; // Already migrated
  if (!character.charStagedPortraits || typeof character.charStagedPortraits !== 'object') return character;

  const media = {};
  for (const [rangeId, url] of Object.entries(character.charStagedPortraits)) {
    if (url) {
      media[rangeId] = {
        idle: url,
        idleType: imageStorage.isVideoFile(url) ? 'video' : 'image'
      };
    }
  }
  character.charPortraitMedia = media;
  return character;
}

/**
 * Migrate old persona stagedPortraits to portraitMedia format.
 */
function migratePersonaPortraitMedia(persona) {
  if (!persona) return persona;
  if (persona.portraitMedia) return persona;
  if (!persona.stagedPortraits || typeof persona.stagedPortraits !== 'object') return persona;

  const media = {};
  for (const [rangeId, url] of Object.entries(persona.stagedPortraits)) {
    if (url) {
      media[rangeId] = {
        idle: url,
        idleType: imageStorage.isVideoFile(url) ? 'video' : 'image'
      };
    }
  }
  persona.portraitMedia = media;
  return persona;
}

// Load single character by ID (checks both default and custom dirs)
// Supports both old format ({id}.json) and new folder format ({id}/char.json)
function loadCharacter(charId) {
  // Reject path-unsafe ids before touching the filesystem.
  if (!isSafeId(charId)) return null;
  // Check new folder format first (custom, then default)
  const customFolderPath = path.join(CHARS_CUSTOM_DIR, charId, 'char.json');
  const defaultFolderPath = path.join(CHARS_DEFAULT_DIR, charId, 'char.json');
  // Check old flat format
  const customPath = path.join(CHARS_CUSTOM_DIR, `${charId}.json`);
  const defaultPath = path.join(CHARS_DEFAULT_DIR, `${charId}.json`);

  const paths = [
    { path: customFolderPath, isDefault: false },
    { path: defaultFolderPath, isDefault: true },
    { path: customPath, isDefault: false },
    { path: defaultPath, isDefault: true }
  ];

  for (const { path: charPath, isDefault } of paths) {
    if (fs.existsSync(charPath)) {
      try {
        const char = JSON.parse(fs.readFileSync(charPath, 'utf8'));
        char._isDefault = isDefault;
        return migrateCharPortraitMedia(char);
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
async function saveCharacterAsync(char, forceCustom = false, syncFactory = false) {
  if (!isSafeId(char.id)) throw new Error('Invalid character id');
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

  // If this is a default character, optionally sync to the git-tracked factory backup.
  // Normal gameplay saves (syncFactory=false) must NOT write into data/factory/ —
  // only explicit "save as factory default" operations should mutate that tree.
  if (isDefault && syncFactory) {
    const FACTORY_DIR = path.join(DATA_DIR, 'factory', 'chars-default', char.id);
    const sourceDir = path.join(CHARS_DEFAULT_DIR, char.id);
    syncDirToFactory(sourceDir, FACTORY_DIR);
    console.log(`[SaveChar] Synced default character "${char.id}" to factory backup`);
  }

  // Clean up old flat file if it exists
  if (fs.existsSync(oldCustomPath)) {
    try { fs.unlinkSync(oldCustomPath); } catch (e) {}
  }

  return processedChar;
}

// Sync wrapper for backwards compatibility.
// syncFactory defaults to FALSE: gameplay/startup/button-sync callers must never
// mutate the git-tracked data/factory/ tree. Only an explicit "save as factory
// default" should pass syncFactory=true.
function saveCharacter(char, forceCustom = false, syncFactory = false) {
  if (!isSafeId(char.id)) throw new Error('Invalid character id');
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

  // Strip runtime-only fields so they never get persisted (or pushed to factory).
  const { _isDefault, ...toPersist } = char;
  const targetPath = path.join(charDir, 'char.json');
  atomicWriteJson(targetPath, toPersist);
  updateCharIndex(char, isDefault ? 'default' : 'custom');

  // Sync default characters to factory backup (whole dir, including img/) ONLY on
  // explicit request — never during normal gameplay/startup.
  if (isDefault && syncFactory) {
    const factoryDir = path.join(DATA_DIR, 'factory', 'chars-default', char.id);
    syncDirToFactory(charDir, factoryDir);
    console.log(`[SaveChar] Synced default character "${char.id}" to factory backup`);
  }
}

// Recursively copy a character directory (char.json + img/ + any media) into the
// factory tree. Used to seed/refresh the git-tracked factory defaults.
function syncDirToFactory(sourceDir, factoryDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(factoryDir, { recursive: true });
  fs.cpSync(sourceDir, factoryDir, { recursive: true, force: true });
}

// Delete character file + remove from index
function deleteCharacterFile(charId) {
  assertSafeId(charId);
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
  // Active if the index exists OR per-char folders are present on disk. The folder
  // check lets early startup migrations (which run before the index is rebuilt)
  // correctly detect per-char storage instead of falling back to the legacy file.
  if (fs.existsSync(path.join(CHARS_DIR, 'chars-index.json'))) return true;
  for (const dir of [CHARS_DEFAULT_DIR, CHARS_CUSTOM_DIR]) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (fs.existsSync(path.join(dir, name, 'char.json'))) return true;
      }
    } catch (e) { /* ignore */ }
  }
  return false;
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
            atomicWriteJson(charPath, char);
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
  atomicWriteJson(indexPath, index);
}

// Load single persona by ID (checks folder structure, then old format)
function loadPersona(personaId) {
  // Reject path-unsafe ids before touching the filesystem.
  if (!isSafeId(personaId)) return null;
  // Check new folder format (custom, then default)
  const customFolderPath = path.join(PERSONAS_CUSTOM_DIR, personaId, 'persona.json');
  const defaultFolderPath = path.join(PERSONAS_DEFAULT_DIR, personaId, 'persona.json');

  for (const personaPath of [customFolderPath, defaultFolderPath]) {
    if (fs.existsSync(personaPath)) {
      try {
        const persona = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
        return migratePersonaPortraitMedia(persona);
      } catch (e) {
        console.error(`Error loading persona ${personaId}:`, e);
      }
    }
  }

  // Fall back to old personas.json array format
  const personas = loadAllPersonas() || [];
  const found = personas.find(p => p.id === personaId) || null;
  return found ? migratePersonaPortraitMedia(found) : null;
}

// Save single persona to its own folder + update index
async function savePersonaAsync(persona, forceCustom = false, syncFactory = false) {
  if (!isSafeId(persona.id)) throw new Error('Invalid persona id');
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

  // Mirror the character factory-sync behaviour: only explicit user saves
  // (syncFactory=true) push default personas into the git-tracked factory tree.
  if (isDefault && syncFactory) {
    const sourceDir = path.join(PERSONAS_DEFAULT_DIR, persona.id);
    const factoryDir = path.join(DATA_DIR, 'factory', 'personas-default', persona.id);
    syncDirToFactory(sourceDir, factoryDir);
    console.log(`[SavePersona] Synced default persona "${persona.id}" to factory backup`);
  }

  return processedPersona;
}

// Delete persona folder + remove from index
function deletePersonaFolder(personaId) {
  assertSafeId(personaId);
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
              if (seenIds.has(persona.id)) continue; // Skip duplicates (default takes precedence)
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
  if (!isSafeId(actorId)) { console.warn(`[Security] Rejected unsafe actor id: ${actorId}`); return null; }
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
  if (!isSafeId(actor.id)) throw new Error('Invalid actor id');
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
  if (!isSafeId(actorId)) { console.warn(`[Security] Rejected unsafe actor id for delete: ${actorId}`); return; }
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
  if (!isSafeId(playId)) { console.warn(`[Security] Rejected unsafe play id: ${playId}`); return null; }
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
  if (!isSafeId(play.id)) throw new Error('Invalid play id');
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
  if (!isSafeId(playId)) { console.warn(`[Security] Rejected unsafe play id for delete: ${playId}`); return; }
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

// Validate that a request is same-origin (its Origin/Referer host matches the
// Host header) AND originates from localhost. Used to gate destructive
// self-update endpoints so they can't be driven cross-site or remotely.
function isSameOriginLocal(req) {
  if (!isLocalRequest(req)) return false;
  const hostHeader = extractHost(req.headers.host);
  const origin = req.headers.origin || req.headers.referer;
  // No Origin/Referer (e.g. curl on the box itself) is acceptable for a local request.
  if (!origin) return true;
  const originHost = extractHost(origin);
  return originHost === hostHeader || isLocalAddress(originHost);
}

// Number of local commits not present on the remote tracking branch.
// Used to refuse `git reset --hard` when it would discard local work.
function localCommitsAhead(projectRoot, trackingBranch) {
  const { execSync } = require('child_process');
  try {
    const out = execSync(`git rev-list --count origin/${trackingBranch}..HEAD`, { cwd: projectRoot, encoding: 'utf8' }).trim();
    return parseInt(out, 10) || 0;
  } catch (e) {
    // If we cannot determine ahead-count, be conservative and treat as ahead.
    return -1;
  }
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
    },
    {
      // Free crowdsourced cloud inference (aihorde.net). Works anonymously out of
      // the box (blank key). All sampler values are kept inside AI Horde's accepted
      // ranges so generation never trips its strict payload validation.
      id: 'default-aihorde',
      name: 'AI Horde (Free Cloud)',
      llmUrl: '',
      apiType: 'text_completion',
      endpointStandard: 'aihorde',
      promptTemplate: 'alpaca',
      supportsSystemRole: true,
      maxTokens: 200,          // Horde max_length: 16–512
      contextTokens: 4096,     // Horde max_context_length: 80–32768
      streaming: false,        // Horde has no token streaming (delivered on completion)
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 0.75,       // 0–5
      topK: 0,                 // 0–100
      topP: 0.92,              // 0.001–1
      typicalP: 1,             // 0–1
      minP: 0.05,              // 0–1
      topA: 0,                 // 0–1
      tfs: 1,                  // 0–1
      topNsigma: 0,
      repetitionPenalty: 1.1,  // 1–3
      repPenRange: 1024,       // 0–4096
      repPenSlope: 0.7,        // 0–10
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
      hordeApiKey: '',
      hordeModel: '',
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
    if (settings.haToken && !isEncrypted(settings.haToken)) {
      settings.haToken = encrypt(settings.haToken);
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

/**
 * Backfill new fields onto all characters and personas with sensible defaults.
 * Only sets fields that don't already exist — never overwrites existing values.
 * Runs on every startup to ensure all cards are up to date.
 */
async function migrateNewFieldDefaults() {
  const CHARACTER_DEFAULTS = {
    isPumpable: false,
    characterCalibrationTime: 60,
    charBurstPercent: 100,
    charSyncCalibrationWithPlayer: false,
    charInflateKnowledge: 'unaware',
    charInflateDesire: 'neutral',
    charPopDesire: 'terrified',
    charInflateAutoLoadControls: false,
    charStagedPortraits: {},
    desireToInflateOthers: 'none',
    desireToPopOthers: 'none'
  };

  const PERSONA_DEFAULTS = {
    inflationKnowledge: 'unaware',
    inflationDesire: 'neutral',
    popDesire: 'terrified',
    attributes: {},
    checkpoints: {},
    characterCheckpoints: {},
    disposition: 'neutral',
    desireToInflateOthers: 'none',
    desireToPopOthers: 'none'
  };

  // Migrate characters
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  let charUpdated = 0;

  for (const char of characters) {
    let changed = false;
    for (const [key, defaultValue] of Object.entries(CHARACTER_DEFAULTS)) {
      if (char[key] === undefined) {
        char[key] = defaultValue;
        changed = true;
      }
    }
    // Ensure sessionDefaults exists
    if (!char.sessionDefaults) {
      char.sessionDefaults = { capacity: 0, pain: 0, emotion: 'neutral', capacityModifier: 1.0 };
      changed = true;
    }
    if (changed) {
      if (isPerCharStorageActive()) {
        saveCharacter(char);
      }
      charUpdated++;
    }
  }

  if (!isPerCharStorageActive() && charUpdated > 0) {
    saveData(DATA_FILES.characters, characters);
  }

  // Migrate personas
  const personas = loadAllPersonas() || [];
  let personaUpdated = 0;

  for (const persona of personas) {
    let changed = false;
    for (const [key, defaultValue] of Object.entries(PERSONA_DEFAULTS)) {
      if (persona[key] === undefined) {
        persona[key] = defaultValue;
        changed = true;
      }
    }
    if (changed) {
      // Determine if default or custom
      const isDefault = imageStorage.getPersonaDir &&
        fs.existsSync(path.join(imageStorage.getPersonaDir(persona.id, true), 'persona.json'));
      await imageStorage.savePersonaJson(persona, isDefault);
      personaUpdated++;
    }
  }

  if (charUpdated > 0 || personaUpdated > 0) {
    console.log(`[Migration] Backfilled new field defaults: ${charUpdated} characters, ${personaUpdated} personas updated`);
  }
}

migrateNewFieldDefaults().catch(e => console.error('[Migration] Error:', e.message));

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
  chatMemorySummary: null, // LLM-generated summary of older messages that fell out of the context window
  chatMemorySummaryUpTo: 0, // Index in chatHistory that the summary covers up to (exclusive)
  autoReply: false, // When false, AI only responds via Guided Response/Events/Flows
  playerName: null, // Active persona's display name
  characterName: null, // Active character's name
  pumpRuntimeTracker: {}, // deviceKey -> { totalSeconds } for auto-capacity tracking
  capacityOffset: 0, // Manual slider offset applied on top of auto-capacity
  runtimeTrackingEnabled: true, // Flag to enable/disable runtime tracking (used during emergency stop)
  activeAttributes: null, // Transient: rolled personality attributes for current LLM call
  characterCapacity: 0, // 0-100% simulated inflation for the AI character
  characterInflationBaseCapacity: 0, // capacity when inflation started (to add to)
  preInflationGateMet: true, // When false, blocks LLM-initiated pump commands until capacity > 0
  firedTreeNodes: new Set(), // Per-session Trigger Tree "once" set; key: `${treeId}::${scopeKey}::${nodeId}`
  pendingTreeChoice: null // Armed when a tree player_choice suspends; { choices, ctxSnapshot, after }
};

// Non-serializable character inflation timer state (kept separate to avoid circular JSON)
let charInflationTimer = null;
let charInflationStartTime = null;
let charInflationAutoStopTimer = null;

// Track which checkpoint ranges have already fired triggers this session
// Keys: "player-{rangeKey}" and "char-{rangeKey}"
const firedCheckpointTriggers = new Set();

/**
 * Get the range key for a capacity value
 */
function capacityToRangeKey(capacity) {
  if (capacity <= 10) return '1-10'; // first range now starts at 0% (no separate pre-inflation gate)
  if (capacity <= 20) return '11-20';
  if (capacity <= 30) return '21-30';
  if (capacity <= 40) return '31-40';
  if (capacity <= 50) return '41-50';
  if (capacity <= 60) return '51-60';
  if (capacity <= 70) return '61-70';
  if (capacity <= 80) return '71-80';
  if (capacity <= 90) return '81-90';
  if (capacity <= 100) return '91-100';
  return '100+';
}

// A range's triggers may be a legacy flat array (treated as all-sequential) or the new
// { sequential, random } shape. Always returns the normalized shape.
function normalizeRangeTriggers(val) {
  if (Array.isArray(val)) return { sequential: val, random: [] };
  if (val && typeof val === 'object') {
    return {
      sequential: Array.isArray(val.sequential) ? val.sequential : [],
      random: Array.isArray(val.random) ? val.random : [],
    };
  }
  return { sequential: [], random: [] };
}

/**
 * Execute checkpoint triggers when capacity enters a new range.
 * @param {string} type - 'player' or 'char'
 * @param {number} oldCapacity - previous capacity
 * @param {number} newCapacity - current capacity
 */
async function executeCheckpointTriggers(type, oldCapacity, newCapacity) {
  const oldRange = capacityToRangeKey(oldCapacity);
  const newRange = capacityToRangeKey(newCapacity);
  if (oldRange === newRange) return;

  const triggerKey = `${type}-${newRange}`;
  if (firedCheckpointTriggers.has(triggerKey)) return;

  // Get the active character and story
  const settings = loadData(DATA_FILES.settings);
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  if (!activeCharacter) return;

  const activeStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
  // Instructor checkpoint triggers are per-profile; everyone else uses the story-level set.
  const checkpointTriggers = isInstructor(activeCharacter)
    ? (getInstructorActiveProfile(activeCharacter)?.checkpointTriggers || {})
    : activeStory?.checkpointTriggers;
  if (!checkpointTriggers) return;

  const triggers = normalizeRangeTriggers(checkpointTriggers[triggerKey]).sequential;
  if (!triggers || triggers.length === 0) return;

  // Mark as fired
  firedCheckpointTriggers.add(triggerKey);
  console.log(`[CheckpointTriggers] Firing ${triggers.length} trigger(s) for ${triggerKey}`);

  for (const trigger of triggers) {
    await executeTrigger(trigger, triggerKey, activeCharacter, settings);
  }
}

/**
 * Execute persona checkpoint triggers when capacity enters a new range.
 * Reads triggers from the active persona's checkpointTriggers.
 * @param {string} type - 'player' or 'char'
 * @param {number} oldCapacity - previous capacity
 * @param {number} newCapacity - current capacity
 */
async function executePersonaCheckpointTriggers(type, oldCapacity, newCapacity) {
  const oldRange = capacityToRangeKey(oldCapacity);
  const newRange = capacityToRangeKey(newCapacity);
  if (oldRange === newRange) return;

  const prefix = type === 'player' ? 'p-player' : 'p-char';
  const triggerKey = `${prefix}-${newRange}`;
  if (firedCheckpointTriggers.has(triggerKey)) return;

  const settings = loadData(DATA_FILES.settings);
  const persona = settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null;
  if (!persona?.checkpointTriggers) return;

  const triggers = normalizeRangeTriggers(persona.checkpointTriggers[triggerKey]).sequential;
  if (!triggers || triggers.length === 0) return;

  // Character checkpoint precedence: if a character checkpoint trigger already fired
  // for this range with the same trigger type, skip the persona version of that type
  const charTriggerKey = `${type}-${newRange}`;
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activeStory = activeCharacter?.stories?.find(s => s.id === activeCharacter?.activeStoryId) || activeCharacter?.stories?.[0];
  const charTriggers = normalizeRangeTriggers(activeStory?.checkpointTriggers?.[charTriggerKey]).sequential;
  const charTriggerTypes = new Set(charTriggers.map(t => t.type));

  // Filter persona triggers: skip any type that character already handles for this range
  const filteredTriggers = triggers.filter(t => {
    if (charTriggerTypes.has(t.type)) {
      console.log(`[PersonaCheckpointTriggers] Skipping ${t.type} — character checkpoint takes precedence for ${newRange}`);
      return false;
    }
    return true;
  });

  if (filteredTriggers.length === 0) return;

  firedCheckpointTriggers.add(triggerKey);
  console.log(`[PersonaCheckpointTriggers] Firing ${filteredTriggers.length} trigger(s) for ${triggerKey} (${triggers.length - filteredTriggers.length} skipped for char precedence)`);

  for (const trigger of filteredTriggers) {
    await executeTrigger(trigger, triggerKey, activeCharacter, settings);
  }
}

/**
 * Execute a single trigger action. Shared by post-welcome, checkpoint, and future trigger sources.
 */
async function executeTrigger(trigger, source, character, settings) {
  const personas = loadAllPersonas() || [];
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  try {
    console.log(`[Trigger/${source}] Executing: ${trigger.type}`);

    switch (trigger.type) {
      case 'impersonate': {
        broadcast('generating_start', { characterName: sessionState.playerName || 'Player', isPlayerVoice: true });
        const mode = trigger.context ? 'guided_impersonate' : 'impersonate';
        const impContext = buildSpecialContext(mode, trigger.context || null, character, activePersona, settings);
        const impSettings = { ...settings.llm };
        if (settings.llm?.impersonateMaxTokens) impSettings.maxTokens = settings.llm.impersonateMaxTokens;
        impSettings.stopSequences = [...(settings.llm?.stopSequences || []), ...(impContext.stopSequences || [])];
        const impResult = await llmService.generate({ prompt: impContext.prompt, messages: impContext.messages, systemPrompt: impContext.systemPrompt, settings: impSettings });
        if (impResult.text) {
          let impText = stripCrossRoleContent(impResult.text, impContext.stopSequences, false);
          broadcast('generating_stop', {});
          broadcast('impersonate_result', { text: substituteAllVariables(impText) });
        } else {
          broadcast('generating_stop', {});
        }
        break;
      }

      case 'ai_message': {
        // LLM Enhance off → post the message text verbatim (no generation).
        if (trigger.llmEnhance === false) {
          const vtext = (trigger.context || '').trim();
          if (vtext) {
            const { v4: uuidv4 } = require('uuid');
            const vmsg = { id: uuidv4(), content: substituteAllVariables(vtext), sender: 'character', characterName: character.name, timestamp: Date.now() };
            sessionState.chatHistory.push(vmsg);
            broadcast('chat_message', vmsg);
            autosaveSession();
          }
          break;
        }
        broadcast('generating_start', { characterName: character.name });
        // Character-voice guided generation — use the unified normal builder
        // + single guidance injection (same path as guided response/swipe)
        const aiContext = applyCharacterGuidance(buildChatContext(character, settings), character, trigger.context || 'Continue the conversation naturally.');
        const aiResult = await llmService.generate({ prompt: aiContext.prompt, messages: aiContext.messages, systemPrompt: aiContext.systemPrompt, settings: settings.llm });
        if (aiResult.text) {
          const { v4: uuidv4 } = require('uuid');
          const msg = { id: uuidv4(), content: substituteAllVariables(aiResult.text), sender: 'character', characterName: character.name, timestamp: Date.now() };
          sessionState.chatHistory.push(msg);
          broadcast('chat_message', msg);
          autosaveSession();
        }
        broadcast('generating_stop', {});
        break;
      }

      case 'char_inflate_start': {
        const ciCalTime = getCharacterCalibrationTime(character);
        if (character?.isPumpable && ciCalTime) startCharacterInflation(ciCalTime, character.charBurstPercent || 100);
        break;
      }

      case 'char_inflate_stop':
        stopCharacterInflation();
        break;

      case 'pump_on': {
        const devices = loadData(DATA_FILES.devices) || [];
        const pump = devices.find(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
        if (pump) {
          const id = resolveControlId(pump);
          await deviceService.turnOn(id, pump);
          broadcast('ai_device_control', { device: 'pump', action: 'on', deviceName: pump.label || pump.name || 'Pump' });
        }
        break;
      }

      case 'pump_off': {
        const devices = loadData(DATA_FILES.devices) || [];
        const pump = devices.find(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
        if (pump) {
          const id = resolveControlId(pump);
          clearServerTimedPumpTimer(id);
          await deviceService.turnOff(id, pump);
          broadcast('ai_device_control', { device: 'pump', action: 'off', deviceName: pump.label || pump.name || 'Pump' });
        }
        break;
      }

      case 'toggle_pump_always': {
        const activeStory = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
        if (activeStory) {
          activeStory.pumpOnEveryReply = !!trigger.enabled;
          if (trigger.chance !== undefined) activeStory.pumpOnEveryReplyChance = trigger.chance;
          await saveCharacterAsync(character);
        }
        break;
      }

      case 'set_attribute': {
        const activeStory = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
        if (activeStory && trigger.trait) {
          // For multichar, trigger.targetMember routes to that member's attributes
          const store = resolveAttributeStore(activeStory, trigger.targetMember);
          store[trigger.trait] = trigger.value ?? 50;
          await saveCharacterAsync(character);
        }
        break;
      }

      case 'set_skin': {
        const skinId = trigger.skinId || 'swelldreams-default';
        const displayData = loadDisplaySettings();
        const skin = displayData.skins?.find(s => s.id === skinId);
        if (skin) {
          displayData.activeSkinId = skinId;
          saveDisplaySettings(displayData);
          broadcast('skin_changed', { skinId, skin });
          console.log(`[Trigger/${source}] Set display skin to "${skin.name}"`);
        }
        break;
      }

      case 'set_instructor_profile': {
        // Switch the active instructor checkpoint profile for this session, which may
        // also flip the pump mode. Reuses the same flip path as pre-req choices.
        if (trigger.value) {
          sessionState.activeCheckpointProfileId = trigger.value;
          if (isInstructor(character)) applyActivePumpType(character);
          broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: sessionState.preInflationGateMet });
          console.log(`[Trigger/${source}] Switched instructor profile to ${trigger.value}`);
        }
        break;
      }

      case 'set_persona_attribute': {
        const persona = activePersona || (settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null);
        if (persona && trigger.trait) {
          persona.attributes = persona.attributes || {};
          persona.attributes[trigger.trait] = trigger.value ?? 50;
          await savePersonaAsync(persona);
          console.log(`[Trigger/${source}] Set persona ${trigger.trait} to ${trigger.value}`);
        }
        break;
      }

      case 'nudge_attribute': {
        const nudgeStory = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
        if (nudgeStory && trigger.trait) {
          const store = resolveAttributeStore(nudgeStory, trigger.targetMember);
          const current = store[trigger.trait] ?? 50;
          store[trigger.trait] = Math.max(0, Math.min(100, current + (parseInt(trigger.value) || 0)));
          await saveCharacterAsync(character);
          console.log(`[Trigger/${source}] Nudged char ${trigger.trait}${trigger.targetMember ? ` (${trigger.targetMember})` : ''}: ${current} → ${store[trigger.trait]}`);
        }
        break;
      }

      case 'nudge_persona_attribute': {
        const persona = activePersona || (settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null);
        if (persona && trigger.trait) {
          persona.attributes = persona.attributes || {};
          const current = persona.attributes[trigger.trait] ?? 0;
          persona.attributes[trigger.trait] = Math.max(0, Math.min(100, current + (parseInt(trigger.value) || 0)));
          await savePersonaAsync(persona);
          console.log(`[Trigger/${source}] Nudged persona ${trigger.trait}: ${current} → ${persona.attributes[trigger.trait]}`);
        }
        break;
      }

      case 'set_player_capacity':
        sessionState.capacity = Math.max(0, parseInt(trigger.value) || 0);
        broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: sessionState.preInflationGateMet });
        break;

      case 'set_pre_req': {
        // Force the pre-inflation gate status for this session. "met" opens the gate
        // (LLM pump commands allowed); "unmet" re-arms it (blocks pump until capacity > 0
        // or a later trigger marks it met).
        sessionState.preInflationGateMet = (trigger.value !== 'unmet');
        broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: sessionState.preInflationGateMet });
        console.log(`[Trigger/${source}] Pre-inflation gate set to ${sessionState.preInflationGateMet ? 'MET' : 'UNMET'}`);
        break;
      }

      case 'set_char_capacity':
        sessionState.characterCapacity = Math.max(0, Math.min(200, parseInt(trigger.value) || 0));
        broadcast('character_capacity_update', { characterCapacity: sessionState.characterCapacity, elapsed: 0, inflating: !!charInflationTimer });
        break;

      case 'set_player_pain':
        sessionState.pain = Math.max(0, Math.min(10, parseInt(trigger.value) || 0));
        broadcast('pain_update', { pain: sessionState.pain });
        break;

      case 'set_emotion':
        sessionState.emotion = trigger.value || 'neutral';
        broadcast('emotion_update', { emotion: sessionState.emotion });
        break;

      case 'toggle_device_control': {
        const s = loadData(DATA_FILES.settings) || {};
        s.globalCharacterControls = s.globalCharacterControls || {};
        s.globalCharacterControls.allowLlmDeviceControl = !!trigger.enabled;
        saveData(DATA_FILES.settings, s);
        break;
      }

      case 'set_pump_mode': {
        const devices = loadData(DATA_FILES.devices) || [];
        const pump = devices.find(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
        if (pump) {
          const id = resolveControlId(pump);
          const dur = trigger.duration || 5;
          if (trigger.mode === 'on') await deviceService.turnOn(id, pump);
          else if (trigger.mode === 'pulse') await deviceService.pulsePump(id, dur, pump);
          else if (trigger.mode === 'cycle') await deviceService.startCycle(id, { duration: dur, interval: dur, cycles: 3 }, pump);
          else if (trigger.mode === 'timed') {
            // Route through the tracked timed mechanism so emergency stop clears it,
            // and clamp the on-time to the MAX_ON_SECONDS safety ceiling.
            await timedPumpOn(id, pump, dur);
          }
          broadcast('ai_device_control', { device: 'pump', action: trigger.mode, deviceName: pump.label || pump.name || 'Pump' });
        }
        break;
      }

      case 'toggle_auto_reply':
        sessionState.autoReply = !!trigger.enabled;
        broadcast('auto_reply_update', { enabled: sessionState.autoReply });
        break;

      case 'toggle_pumpable': {
        character.isPumpable = !!trigger.enabled;
        if (trigger.enabled) {
          if (trigger.sync) character.charSyncCalibrationWithPlayer = true;
          else if (trigger.calTime) character.characterCalibrationTime = trigger.calTime;
        }
        await saveCharacterAsync(character);
        break;
      }

      case 'set_player_burst': {
        const s = loadData(DATA_FILES.settings) || {};
        s.globalCharacterControls = s.globalCharacterControls || {};
        s.globalCharacterControls.autoPopFixedPercent = parseInt(trigger.value) || 110;
        saveData(DATA_FILES.settings, s);
        break;
      }

      case 'set_char_burst':
        character.charBurstPercent = parseInt(trigger.value) || 100;
        await saveCharacterAsync(character);
        break;

      case 'set_char_inflate_desire':
        character.charInflateDesire = trigger.value || 'neutral';
        await saveCharacterAsync(character);
        break;

      case 'set_char_pop_desire':
        character.charPopDesire = trigger.value || 'terrified';
        await saveCharacterAsync(character);
        break;

      case 'set_char_desire_inflate_others':
        character.desireToInflateOthers = trigger.value || 'none';
        await saveCharacterAsync(character);
        break;

      case 'set_char_desire_pop_others':
        character.desireToPopOthers = trigger.value || 'none';
        await saveCharacterAsync(character);
        break;

      case 'set_persona_inflate_desire': {
        const persona = activePersona || (settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null);
        if (persona) {
          persona.inflationDesire = trigger.value || 'neutral';
          await savePersonaAsync(persona);
          console.log(`[Trigger/${source}] Set persona inflate desire to ${persona.inflationDesire}`);
        }
        break;
      }

      case 'set_persona_pop_desire': {
        const persona = activePersona || (settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null);
        if (persona) {
          persona.popDesire = trigger.value || 'terrified';
          await savePersonaAsync(persona);
          console.log(`[Trigger/${source}] Set persona pop desire to ${persona.popDesire}`);
        }
        break;
      }

      case 'set_persona_inflate_others': {
        const persona = activePersona || (settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null);
        if (persona) {
          persona.desireToInflateOthers = trigger.value || 'none';
          await savePersonaAsync(persona);
          console.log(`[Trigger/${source}] Set persona desire to inflate others to ${persona.desireToInflateOthers}`);
        }
        break;
      }

      case 'set_persona_pop_others': {
        const persona = activePersona || (settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null);
        if (persona) {
          persona.desireToPopOthers = trigger.value || 'none';
          await savePersonaAsync(persona);
          console.log(`[Trigger/${source}] Set persona desire to pop others to ${persona.desireToPopOthers}`);
        }
        break;
      }

      case 'toggle_reminder': {
        if (trigger.reminderId && character.constantReminders) {
          const reminder = character.constantReminders.find(r => r.id === trigger.reminderId);
          if (reminder) {
            reminder.enabled = !!trigger.enabled;
            await saveCharacterAsync(character);
          }
        }
        break;
      }

      case 'equip_reminder': {
        const activeStory = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
        if (activeStory && trigger.reminderId) {
          const field = trigger.source === 'global' ? 'globalReminderIds' : 'constantReminderIds';
          activeStory[field] = activeStory[field] || [];
          if (trigger.action === 'equip') {
            if (!activeStory[field].includes(trigger.reminderId)) activeStory[field].push(trigger.reminderId);
          } else {
            activeStory[field] = activeStory[field].filter(id => id !== trigger.reminderId);
          }
          await saveCharacterAsync(character);
        }
        break;
      }

      case 'system_message': {
        const content = substituteAllVariables(trigger.content || '');
        if (content) {
          const msg = { id: uuidv4(), content, sender: 'system', characterId: character?.id, characterName: character?.name, timestamp: Date.now() };
          sessionState.chatHistory.push(msg);
          broadcast('chat_message', msg);
          autosaveSession();
        }
        break;
      }

      case 'flow_var': {
        if (trigger.variable) {
          eventEngine.applySetVariable('custom', trigger.variable, trigger.operation || 'set', trigger.value);
          console.log(`[Trigger/${source}] flow_var ${trigger.variable} ${trigger.operation || 'set'} ${trigger.value}`);
        }
        break;
      }

      default:
        console.log(`[Trigger/${source}] Unknown trigger type: ${trigger.type}`);
    }
  } catch (err) {
    console.error(`[Trigger/${source}] Error executing ${trigger.type}:`, err.message);
    broadcast('generating_stop', {});
  }
}

// ==============================================
// Character Inflation Helpers
// ==============================================

/**
 * Start simulated inflation for the active character
 * @param {number} calibrationTime - seconds to reach 100%
 * @param {number} burstPercent - capacity at which character pops (default 100)
 */
function startCharacterInflation(calibrationTime, burstPercent = 100) {
  // Stop any existing inflation first
  stopCharacterInflation();

  charInflationStartTime = Date.now();
  sessionState.characterInflationBaseCapacity = sessionState.characterCapacity;
  const startCap = sessionState.characterCapacity;

  console.log(`[CharInflation] Starting: calibrationTime=${calibrationTime}s, startCap=${startCap}%, burstAt=${burstPercent}%`);

  // Broadcast initial state (pump just turned on)
  broadcast('character_inflate_state', { active: true, elapsed: 0, characterCapacity: startCap });

  charInflationTimer = setInterval(async () => {
    const elapsed = (Date.now() - charInflationStartTime) / 1000;
    const gain = (elapsed / calibrationTime) * 100;
    const newCapacity = Math.min(burstPercent, Math.round(startCap + gain));
    const elapsedRounded = Math.round(elapsed);

    if (newCapacity !== sessionState.characterCapacity) {
      const prevCharCap = sessionState.characterCapacity;
      sessionState.characterCapacity = newCapacity;
      eventEngine.checkCharacterStateChanges({ characterCapacity: newCapacity });
      try {
        await executeCheckpointTriggers('char', prevCharCap, newCapacity);
        await executePersonaCheckpointTriggers('char', prevCharCap, newCapacity);
      } catch (err) {
        console.error('[CharInflation] Checkpoint trigger error:', err && err.message ? err.message : err);
      }
    }

    // Always broadcast elapsed + capacity so frontend timer overlay stays in sync
    broadcast('character_capacity_update', {
      characterCapacity: newCapacity,
      elapsed: elapsedRounded,
      inflating: true
    });

    // Auto-stop at burst threshold
    if (newCapacity >= burstPercent) {
      console.log(`[CharInflation] Reached burst threshold ${burstPercent}%, auto-stopping (POP!)`);
      stopCharacterInflation();
      broadcast('character_burst', { characterCapacity: newCapacity, burstPercent });
    }
  }, 1000);
}

/**
 * Stop simulated inflation for the active character
 */
function stopCharacterInflation() {
  if (charInflationAutoStopTimer) {
    clearTimeout(charInflationAutoStopTimer);
    charInflationAutoStopTimer = null;
  }
  if (charInflationTimer) {
    clearInterval(charInflationTimer);
    charInflationTimer = null;
    charInflationStartTime = null;
    console.log(`[CharInflation] Stopped at ${sessionState.characterCapacity}%`);
    broadcast('character_inflate_state', { active: false, elapsed: 0, characterCapacity: sessionState.characterCapacity });
  }
}

/**
 * Build character inflation context for the AI system prompt.
 * Only returns content if the character is pumpable and capacity > 0.
 */
function buildCharacterInflationContext(character) {
  if (!character?.isPumpable) return '';
  const cap = sessionState.characterCapacity || 0;
  if (cap <= 0) return '';

  const charName = character.name || 'The character';
  const isInflating = !!charInflationTimer;

  // Map capacity to description
  let bellyDesc;
  if (cap <= 10) bellyDesc = 'very slight fullness, barely noticeable';
  else if (cap <= 25) bellyDesc = 'mildly bloated, noticeably rounder';
  else if (cap <= 40) bellyDesc = 'visibly swollen, belly pushing outward';
  else if (cap <= 55) bellyDesc = 'significantly inflated, round and taut';
  else if (cap <= 70) bellyDesc = 'heavily inflated, stretched drum-tight';
  else if (cap <= 85) bellyDesc = 'massively distended, skin pulled tight';
  else if (cap <= 95) bellyDesc = 'enormous, straining at maximum capacity';
  else bellyDesc = 'beyond full, dangerously over-inflated';

  // Pain level mapped evenly from 0-100%
  const painLevel = Math.min(10, Math.floor(cap / 10));
  const painLabels = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
  const painLabel = painLabels[painLevel] || 'None';

  // Knowledge level
  const knowledgeMap = {
    unaware: `${charName} has NO idea what inflation is or what is happening to them`,
    confused: `${charName} notices something strange happening to their body but doesn't understand why`,
    partial: `${charName} has a basic understanding of what's happening but lacks full context`,
    informed: `${charName} knows exactly what inflation is and understands what's being done to them`,
    expert: `${charName} has deep knowledge of inflation and may have experienced it before`
  };

  // Desire level
  const desireMap = {
    terrified: `desperately does NOT want to be inflated and is fighting against it`,
    reluctant: `would prefer not to be inflated but may reluctantly comply`,
    nervous: `is anxious about being inflated but not fully opposed`,
    neutral: `neither wants nor resists the inflation`,
    curious: `is intrigued by the inflation and willing to explore it`,
    eager: `actively wants to be inflated and enjoys the sensation`,
    obsessed: `craves inflation intensely and encourages more`
  };

  const knowledge = knowledgeMap[character.charInflateKnowledge] || knowledgeMap.unaware;
  const desire = desireMap[character.charInflateDesire] || desireMap.neutral;

  const burstPercent = character.charBurstPercent || 100;
  const burstProximity = Math.round((cap / burstPercent) * 100);
  const burstWarning = burstProximity >= 90 ? ' DANGEROUSLY CLOSE TO POPPING!'
    : burstProximity >= 75 ? ' Getting very close to their limit.'
    : burstProximity >= 50 ? ' Past the halfway point to their limit.'
    : '';

  let context = `\n=== ${charName.toUpperCase()}'S INFLATION STATE ===\n`;
  context += `${charName}'s belly is at ${cap}% capacity: ${bellyDesc}. Pain: ${painLabel} (${painLevel}/10).\n`;
  context += `Burst threshold: ${burstPercent}% (currently ${burstProximity}% of the way to popping).${burstWarning}\n`;
  if (cap >= burstPercent) {
    context += `${charName.toUpperCase()} HAS POPPED! They have exceeded their burst threshold. React to this catastrophic event!\n`;
  }
  context += `Inflation pump is currently ${isInflating ? 'ON and actively inflating' : 'OFF'}.\n`;
  context += `Knowledge: ${knowledge}.\n`;
  context += `Desire: ${charName} ${desire}.\n`;

  // Pop desire context at 60%+
  if (burstProximity >= 60) {
    const popDesireMap = {
      terrified: `will do ANYTHING to avoid popping — begging, pleading, bargaining`,
      dreading: `deeply fears popping and is becoming increasingly desperate`,
      anxious: `is visibly worried about the growing possibility of popping`,
      resigned: `has accepted that popping may be inevitable`,
      indifferent: `doesn't seem to care whether they pop or not`,
      curious: `is strangely curious about what popping would feel like`,
      willing: `is okay with popping if it happens — no resistance`,
      eager: `actually WANTS to pop and may encourage pushing further`
    };
    const popDesire = popDesireMap[character.charPopDesire] || popDesireMap.terrified;
    context += `Pop desire: ${charName} ${popDesire}.\n`;
  }

  // Positive-framing graduated guidance
  if (cap <= 5) {
    context += `${charName}'s inflation has barely begun — their belly looks normal. They may notice: a faint warmth, a subtle internal awareness. Focus on dialogue and the situation, not physical sensations.\n`;
  } else if (cap <= 15) {
    context += `${charName} is in the very early stage. They may feel: gentle internal warmth, mild curiosity about the sensation. One brief mention of a physical feeling at most — then back to the scene.\n`;
  } else if (cap <= 30) {
    context += `${charName} has mild inflation. They may describe: subtle bloating, gentle pressure, a slight rounding. Keep it understated — brief physical mentions mixed with dialogue.\n`;
  } else if (cap <= 50) {
    context += `${charName} has moderate inflation. They may describe: visible roundness, building tightness, clothes fitting differently. Balance physical awareness with interaction.\n`;
  } else if (cap <= 70) {
    context += `${charName} has significant inflation. They should describe: prominent swelling, taut skin, difficulty moving, labored breathing. Physical sensations are hard to ignore.\n`;
  } else {
    context += `${charName} is heavily/critically inflated. Describe: extreme pressure, drum-tight skin, every movement is strain. React strongly.\n`;
  }
  context += `Write ${cap}% if referencing a number.\n`;
  context += `=== END ${charName.toUpperCase()}'S INFLATION STATE ===\n`;

  return context;
}

/**
 * Get the effective calibration time for a pumpable character.
 * If synced with player, uses the primary pump's calibration time.
 */
function getCharacterCalibrationTime(character) {
  if (character?.charSyncCalibrationWithPlayer) {
    const devices = loadData(DATA_FILES.devices) || [];
    const pump = devices.find(d => d.isPrimaryPump || d.deviceType === 'PUMP');
    if (pump?.calibrationTime) return pump.calibrationTime;
  }
  return character?.characterCalibrationTime || 60;
}

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

  // Player name — support both [Player] and SillyTavern {{user}} macro
  const playerName = context.playerName || sessionState.playerName;
  if (playerName) {
    result = result.replace(/\[Player\]/gi, playerName);
    result = result.replace(/\{\{user\}\}/gi, playerName);
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

  // Character name — support both [Char] and SillyTavern {{char}} macro
  const charName = context.characterName || sessionState.characterName;
  if (charName) {
    result = result.replace(/\[Char\]/gi, charName);
    result = result.replace(/\{\{char\}\}/gi, charName);
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

  // System config variables (settings.systemVariables, e.g. BulbMax / BikeMax).
  // Resolvable as [System:Name] and directly as [Name].
  const sysVars = settings?.systemVariables || {};
  result = result.replace(/\[System:(\w+)\]/gi, (match, varName) => {
    const key = Object.keys(sysVars).find(k => k.toLowerCase() === varName.toLowerCase());
    return key && sysVars[key] !== '' && sysVars[key] != null ? sysVars[key] : match;
  });
  for (const [k, v] of Object.entries(sysVars)) {
    if (v === '' || v == null || !/^\w+$/.test(k)) continue;
    result = result.replace(new RegExp(`\\[${k}\\]`, 'gi'), v);
  }

  // Instructor pump session variables
  result = result.replace(/\[BulbCurrent\]/gi, sessionState.bulbCurrent ?? 0);
  result = result.replace(/\[BikeCurrent\]/gi, sessionState.bikeCurrent ?? 0);
  result = result.replace(/\[PumpType\]/gi, sessionState.pumpType || 'electric');
  result = result.replace(/\[PumpInit\]/gi, sessionState.pumpInit || 'auto');

  // Token Switching — replace overused LLM words with random alternatives
  result = applyTokenSwitching(result, settings);
  result = applyTokenRemovals(result, settings);

  // Normalize double asterisks to single (LLMs often use **bold** for actions)
  result = result.replace(/\*\*/g, '*');

  return result;
}

/**
 * Apply token switching rules to text.
 * Each rule has a trigger word and comma-separated replacements.
 * Occurrences of the trigger word are randomly replaced with one of the alternatives.
 */
// True when the active character is an instructor that opted out of token swapping.
function activeCharIgnoresTokenSwap(settings) {
  try {
    const id = settings?.activeCharacterId;
    if (!id) return false;
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const ch = chars.find(c => c.id === id);
    return !!(ch && isInstructor(ch) && ch.ignoreTokenSwapping);
  } catch (e) {
    return false;
  }
}

function applyTokenSwitching(text, settings) {
  if (!text) return text;
  const rules = settings?.tokenSwitching;
  if (!rules || !Array.isArray(rules) || rules.length === 0) return text;
  // Instructors can opt out of global token swapping.
  if (activeCharIgnoresTokenSwap(settings)) return text;

  let result = text;
  for (const rule of rules) {
    if (!rule.enabled || !rule.trigger || !rule.replacements) continue;
    const triggers = rule.trigger.split(',').map(t => t.trim()).filter(Boolean);
    const replacements = rule.replacements.split(',').map(r => r.trim()).filter(Boolean);
    if (triggers.length === 0 || replacements.length === 0) continue;
    // Build alternation regex from all trigger words/phrases
    const pattern = triggers.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`\\b(?:${pattern})\\b`, 'gi');
    result = result.replace(regex, (match) => {
      const replacement = replacements[Math.floor(Math.random() * replacements.length)];
      // Preserve capitalization: if match was all-caps, capitalize replacement; if title-case, title-case it
      if (match === match.toUpperCase() && match !== match.toLowerCase()) {
        return replacement.toUpperCase();
      } else if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }
  return result;
}

/**
 * Apply token removal rules to text.
 * Each rule has comma-separated trigger words/phrases.
 * When a trigger is found, the entire sentence containing it is removed.
 * Sentence boundaries: . ! ? : (colon has special handling)
 *
 * Colon rules:
 *   "She paused: a shiver ran down her spine." → trigger "shiver" → "She paused."
 *     (removed right side of colon, colon replaced with period)
 *   "A shiver ran through her: she gasped." → trigger "shiver" → "She gasped."
 *     (removed left side of colon and the colon, capitalize next segment)
 */
function applyTokenRemovals(text, settings) {
  if (!text) return text;
  const rules = settings?.tokenRemovals;
  if (!rules || !Array.isArray(rules) || rules.length === 0) return text;

  // Build a combined list of all enabled triggers
  const allTriggers = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.triggers) continue;
    const triggers = rule.triggers.split(',').map(t => t.trim()).filter(Boolean);
    allTriggers.push(...triggers);
  }
  if (allTriggers.length === 0) return text;

  // Build regex for all triggers
  const triggerPattern = allTriggers.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const triggerRegex = new RegExp(`\\b(?:${triggerPattern})\\b`, 'i');

  // Process text by splitting into segments around sentence-ending punctuation
  // We handle colons specially, so split into chunks at . ! ? first, then handle colons within
  let result = text;
  let changed = true;
  let iterations = 0;

  // Iterate until no more removals (a removal might expose new sentence boundaries)
  while (changed && iterations < 20) {
    changed = false;
    iterations++;

    // Split into sentences on . ! ? while preserving the punctuation
    // Handle colon-separated clauses within each sentence
    const sentences = [];
    let current = '';
    for (let i = 0; i < result.length; i++) {
      current += result[i];
      if (result[i] === '.' || result[i] === '!' || result[i] === '?') {
        // Include trailing whitespace
        while (i + 1 < result.length && result[i + 1] === ' ') {
          i++;
          current += result[i];
        }
        sentences.push(current);
        current = '';
      }
    }
    if (current.trim()) sentences.push(current);

    const rebuilt = [];
    for (const sentence of sentences) {
      // Check if this sentence contains a colon (splitting into clauses)
      const colonIdx = sentence.indexOf(':');

      if (colonIdx !== -1 && colonIdx > 0 && colonIdx < sentence.length - 1) {
        const leftClause = sentence.substring(0, colonIdx);
        const rightClause = sentence.substring(colonIdx + 1);

        const leftHasTrigger = triggerRegex.test(leftClause);
        const rightHasTrigger = triggerRegex.test(rightClause);

        if (leftHasTrigger && rightHasTrigger) {
          // Both sides match — remove entire sentence
          changed = true;
          continue;
        } else if (rightHasTrigger) {
          // Remove right side, replace colon with period
          const trimmedLeft = leftClause.trimEnd();
          // Add period if doesn't already end with punctuation
          const lastChar = trimmedLeft[trimmedLeft.length - 1];
          const needsPeriod = lastChar !== '.' && lastChar !== '!' && lastChar !== '?';
          rebuilt.push(trimmedLeft + (needsPeriod ? '. ' : ' '));
          changed = true;
          continue;
        } else if (leftHasTrigger) {
          // Remove left side and colon, capitalize remaining
          let remaining = rightClause.trimStart();
          if (remaining.length > 0) {
            remaining = remaining.charAt(0).toUpperCase() + remaining.slice(1);
          }
          rebuilt.push(remaining);
          changed = true;
          continue;
        }
      }

      // No colon logic — check the whole sentence
      if (triggerRegex.test(sentence)) {
        changed = true;
        continue; // Remove entire sentence
      }

      rebuilt.push(sentence);
    }

    result = rebuilt.join('').replace(/ {2,}/g, ' ').trim();
  }

  return result;
}

// Auto-save session state
function _autosaveSessionNow() {
  try {
    const settings = loadData(DATA_FILES.settings);
    const autosaveData = {
      personaId: settings?.activePersonaId,
      characterId: settings?.activeCharacterId,
      capacity: sessionState.capacity,
      pain: sessionState.pain,
      emotion: sessionState.emotion,
      chatHistory: sessionState.chatHistory,
      chatMemorySummary: sessionState.chatMemorySummary,
      chatMemorySummaryUpTo: sessionState.chatMemorySummaryUpTo,
      messageInputHistory: sessionState.messageInputHistory,
      flowVariables: sessionState.flowVariables,
      pumpRuntimeTracker: sessionState.pumpRuntimeTracker,
      updatedAt: Date.now()
    };
    // saveData uses atomicWriteJson (writes .tmp, fsync, rolls one .bak, renames).
    saveData(DATA_FILES.autosave, autosaveData);
  } catch (error) {
    console.error('[Autosave] Failed to save session:', error);
  }
}

// Debounce autosaves: many state changes fire in quick succession (per-second
// runtime ticks etc.) — coalesce them into a single atomic write.
let _autosaveTimer = null;
const AUTOSAVE_DEBOUNCE_MS = 1000;
function autosaveSession() {
  if (_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    _autosaveTimer = null;
    _autosaveSessionNow();
  }, AUTOSAVE_DEBOUNCE_MS);
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
      sessionState.chatMemorySummary = autosaveData.chatMemorySummary || null;
      sessionState.chatMemorySummaryUpTo = autosaveData.chatMemorySummaryUpTo || 0;
      sessionState.messageInputHistory = autosaveData.messageInputHistory || [];
      sessionState.flowVariables = autosaveData.flowVariables || {};
      // DO NOT restore pumpRuntimeTracker - prevents pumps from auto-starting on refresh
      sessionState.pumpRuntimeTracker = {};
      sessionState.capacityOffset = 0;
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
    // Log every 10 seconds to avoid console flood
    if (Math.round(tracker.totalSeconds) % 10 === 0) {
      console.log(`[AutoCapacity] Device ${deviceKey}: ${tracker.totalSeconds.toFixed(1)}s / ${deviceData.calibrationTime}s = ${deviceCapacity.toFixed(1)}%`);
    }
  }

  // Apply manual capacity offset (set by slider) so auto-capacity continues from the manual value
  totalCapacity += (sessionState.capacityOffset || 0);

  // Round to nearest integer, floor at 0
  totalCapacity = Math.max(0, Math.round(totalCapacity));

  // Calculate pain (scale linearly based on capacity, using max calibrated pain)
  const calibratedPains = devices
    .filter(d => typeof d.calibrationPainAtMax === 'number')
    .map(d => d.calibrationPainAtMax);
  const maxPain = calibratedPains.length > 0 ? Math.max(...calibratedPains) : 10;
  const pain = Math.min(10, Math.round((Math.min(totalCapacity, 100) / 100) * maxPain));

  const prevPlayerCapacity = sessionState.capacity;
  sessionState.capacity = totalCapacity;
  sessionState.pain = pain;

  // Open pre-inflation gate once capacity rises above 0
  if (!sessionState.preInflationGateMet && totalCapacity > 0) {
    sessionState.preInflationGateMet = true;
    console.log('[Pre-Inflation Gate] Gate OPENED — capacity is now above 0%. LLM pump commands enabled.');
  }

  // Log every 10 seconds to avoid console flood
  if (Math.round(runtimeSeconds) % 10 === 0) {
    console.log(`[AutoCapacity] Runtime: ${runtimeSeconds.toFixed(1)}s, Total capacity: ${totalCapacity}%, Pain: ${pain}`);
  }

  // Auto-pop shutoff: Turn off all pumps when capacity reaches the effective pop threshold
  const popThreshold = getEffectivePopThreshold(settings);
  if (totalCapacity >= popThreshold) {
    const pumpDevices = devices.filter(d => d.deviceType === 'PUMP' || d.isPrimaryPump);

    for (const pump of pumpDevices) {
      const pumpDeviceId = resolveControlId(pump);
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
    isOverInflating: totalCapacity > 100,
    preInflationGateMet: sessionState.preInflationGateMet
  });

  // Check device monitors for capacity-based stop conditions
  eventEngine.checkDeviceMonitors();

  // Trigger player state change flows
  eventEngine.checkPlayerStateChanges({
    capacity: totalCapacity,
    pain: pain,
    emotion: sessionState.emotion
  });

  // Fire checkpoint triggers on range boundary crossing. handlePumpRuntime is
  // invoked from a (non-awaiting) event emitter, so guard these async calls.
  Promise.resolve()
    .then(() => executeCheckpointTriggers('player', prevPlayerCapacity, totalCapacity))
    .then(() => executePersonaCheckpointTriggers('player', prevPlayerCapacity, totalCapacity))
    .catch(err => console.error('[AutoCapacity] Checkpoint trigger error:', err && err.message ? err.message : err));
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

  // Whenever any PUMP turns on, record a wall-clock on-timestamp and ensure the
  // always-on pump safety watchdog runs. This is independent of useAutoCapacity and
  // covers EVERY activation path (LLM, manual, timed, flow) because all of them flow
  // through deviceService.turnOn -> 'device_on'.
  if (eventType === 'device_on') {
    if (isPumpDeviceData(data)) {
      if (!pumpActiveSince[data.ip]) pumpActiveSince[data.ip] = Date.now();
      startPumpSafetyWatchdog();
    }
  }
  if (eventType === 'device_off') {
    if (data && data.ip) delete pumpActiveSince[data.ip];
  }
});

// ============================================
// Always-on pump safety watchdog
// ============================================
//
// Independent of useAutoCapacity. Whenever ANY pump is reported ON, this forces
// every pump OFF when either:
//   - cumulative on-time exceeds MAX_ON_SECONDS, OR
//   - tracked capacity reaches the effective pop threshold.
// This is the failsafe that the auto-capacity early-return (`if (!useAutoCapacity)`)
// would otherwise skip.

let pumpSafetyWatchdog = null;

// Wall-clock on-timestamps for pumps, keyed by the same `data.ip` deviceService emits
// on 'device_on'/'device_off'. This is the SOURCE OF TRUTH for the safety watchdog and
// is populated for ALL activation paths — independent of useAutoCapacity, the
// pumpRuntimeTracker, and flow-node execution state.
const pumpActiveSince = {};

// Does this device_on/off payload refer to a PUMP? Falls back to the device store when
// the emitted payload lacks deviceType.
function isPumpDeviceData(data) {
  const d = data && data.device;
  if (d && (d.deviceType === 'PUMP' || d.isPrimaryPump)) return true;
  if (d && d.deviceType && d.deviceType !== 'PUMP' && !d.isPrimaryPump) return false;
  const key = data && data.ip;
  if (!key) return false;
  const devices = loadData(DATA_FILES.devices) || [];
  return devices.some(dev => (dev.deviceType === 'PUMP' || dev.isPrimaryPump) &&
    (dev.ip === key || dev.deviceId === key || (dev.childId ? `${dev.ip}:${dev.childId}` : dev.ip) === key));
}

function getEffectivePopThresholdSafe(settings) {
  try {
    return getEffectivePopThreshold(settings);
  } catch (e) {
    return 100;
  }
}

// Is any pump currently ON? Uses the wall-clock tracker (all paths) plus execution
// history as a backstop.
function anyPumpOn() {
  if (Object.keys(pumpActiveSince).length > 0) return true;
  const actions = sessionState.executionHistory?.deviceActions || {};
  return Object.values(actions).some(a => a && a.state === 'on');
}

// Max cumulative on-time (seconds) across active pumps. Takes the larger of the
// wall-clock since-on (universal) and the auto-capacity pumpRuntimeTracker total.
function maxCumulativePumpSeconds() {
  let max = 0;
  const now = Date.now();
  for (const since of Object.values(pumpActiveSince)) {
    if (typeof since === 'number') {
      const s = (now - since) / 1000;
      if (s > max) max = s;
    }
  }
  const tracker = sessionState.pumpRuntimeTracker || {};
  for (const t of Object.values(tracker)) {
    if (t && typeof t.totalSeconds === 'number' && t.totalSeconds > max) max = t.totalSeconds;
  }
  return max;
}

// Force every configured pump OFF, regardless of believed state. Non-throwing.
function forceAllPumpsOff(reason) {
  const devices = loadData(DATA_FILES.devices) || [];
  const pumps = devices.filter(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
  for (const pump of pumps) {
    const id = resolveControlId(pump);
    if (!id) continue;
    clearServerTimedPumpTimer(id);
    const offFn = typeof deviceService.turnOffWithConfirm === 'function'
      ? deviceService.turnOffWithConfirm(id, pump)
      : deviceService.turnOff(id, pump);
    Promise.resolve(offFn).then((result) => {
      // Only mark OFF / clear tracking when the OFF is actually confirmed; otherwise
      // leave pumpActiveSince intact so the watchdog keeps retrying a stuck pump.
      const ok = result && (result.confirmed || result.ok);
      const stateKey = pump.childId ? `${pump.ip}:${pump.childId}` : id;
      if (ok) {
        delete pumpActiveSince[stateKey];
        delete pumpActiveSince[id];
        if (sessionState.executionHistory?.deviceActions?.[stateKey]) {
          sessionState.executionHistory.deviceActions[stateKey].state = 'off';
        }
      } else {
        console.error(`[PumpWatchdog] Force-off of pump ${id} NOT confirmed — will keep retrying`);
      }
      broadcast('pump_safety_shutoff', {
        device: pump.label || pump.name || id,
        capacity: sessionState.capacity,
        reason,
        confirmed: !!ok
      });
    }).catch(err => {
      console.error(`[PumpWatchdog] Failed to force-off pump ${id}:`, err && err.message ? err.message : err);
    });
  }
}

function pumpSafetyWatchdogTick() {
  try {
    if (!anyPumpOn()) {
      // Nothing on — stop the watchdog until a pump turns on again.
      stopPumpSafetyWatchdog();
      return;
    }
    const settings = loadData(DATA_FILES.settings) || {};
    const popThreshold = getEffectivePopThresholdSafe(settings);
    const onSeconds = maxCumulativePumpSeconds();
    const capacity = sessionState.capacity || 0;

    if (onSeconds >= MAX_ON_SECONDS) {
      console.error(`[PumpWatchdog] MAX_ON_SECONDS (${MAX_ON_SECONDS}s) exceeded (on=${onSeconds.toFixed(1)}s) — forcing all pumps OFF`);
      forceAllPumpsOff('max_on_time');
      return;
    }
    if (capacity >= popThreshold) {
      console.error(`[PumpWatchdog] Capacity ${capacity}% >= pop threshold ${popThreshold}% — forcing all pumps OFF`);
      forceAllPumpsOff('capacity_ceiling');
    }
  } catch (err) {
    console.error('[PumpWatchdog] tick error:', err && err.message ? err.message : err);
  }
}

function startPumpSafetyWatchdog() {
  if (pumpSafetyWatchdog) return;
  pumpSafetyWatchdog = setInterval(pumpSafetyWatchdogTick, 1000);
}

function stopPumpSafetyWatchdog() {
  if (pumpSafetyWatchdog) {
    clearInterval(pumpSafetyWatchdog);
    pumpSafetyWatchdog = null;
  }
}

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

/**
 * Check if the active story has pumpOnEveryReply enabled
 */
function isPumpOnEveryReply(character) {
  if (!character?.stories?.length) return false;
  const activeStory = character.stories.find(s => s.id === character.activeStoryId) || character.stories[0];
  return activeStory?.pumpOnEveryReply === true;
}

/**
 * Programmatically turn on the pump if pumpOnEveryReply is enabled.
 * Runs after each LLM response. Skips if already has a pump tag in text,
 * if it's a flow chain message, or if the pump is already on.
 */
const pumpEveryReplyTimers = new Map();

async function executePumpOnEveryReply(text, character, isFlowChain) {
  if (isFlowChain) return;
  if (!isPumpOnEveryReply(character)) return;

  // Pre-inflation gate: block if gate is not met
  if (!sessionState.preInflationGateMet) {
    console.log('[PumpOnEveryReply] Skipped — pre-inflation gate not met');
    return;
  }

  // Roll against chance percentage (default 100%)
  const activeStory = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
  const chance = activeStory?.pumpOnEveryReplyChance ?? 100;
  if (chance < 100 && Math.random() * 100 >= chance) {
    console.log(`[PumpOnEveryReply] Skipped (rolled above ${chance}% chance)`);
    return;
  }

  // Don't double up if text already has a pump command
  if (/\[\s*pump\s+(on|off)\s*\]/i.test(text)) return;

  const devices = loadData(DATA_FILES.devices) || [];
  const pumpDevice = devices.find(d => d.deviceType === 'PUMP' || d.isPrimaryPump);
  if (!pumpDevice) return;

  const deviceId = pumpDevice.brand === 'govee' || pumpDevice.brand === 'tuya' || pumpDevice.brand === 'wyze'
    ? pumpDevice.deviceId : pumpDevice.ip;

  // Check if pump is already on
  const currentState = sessionState.executionHistory?.deviceActions?.[deviceId];
  if (currentState?.state === 'on') return;

  const settings = loadData(DATA_FILES.settings);
  const capacityMod = settings?.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
  const globalMax = settings?.globalCharacterControls?.llmDeviceControlMaxSeconds || 30;
  const charLimits = getCharacterLimits(character);
  const charMax = Math.round((charLimits?.llmMaxOnDuration ?? 5) * capacityMod);
  const maxSeconds = Math.min(globalMax, charMax);

  // Safety: block at 100% unless over-inflation allowed
  const allowOver = settings?.globalCharacterControls?.allowOverInflation;
  if (!allowOver && sessionState.capacity >= 100) return;

  try {
    await deviceService.turnOn(deviceId, pumpDevice);
    console.log(`[PumpOnEveryReply] Pump ON (auto-off in ${maxSeconds}s)`);
    broadcast('ai_device_control', { device: 'pump', action: 'on', label: pumpDevice.label || pumpDevice.name || 'Pump' });

    // Auto-off timer (use module-level Map to avoid circular ref issues)
    const timerKey = `pump-every-reply-${deviceId}`;
    if (pumpEveryReplyTimers.has(timerKey)) clearTimeout(pumpEveryReplyTimers.get(timerKey));
    pumpEveryReplyTimers.set(timerKey, setTimeout(async () => {
      try {
        await deviceService.turnOff(deviceId, pumpDevice);
        console.log(`[PumpOnEveryReply] Auto-off after ${maxSeconds}s`);
        broadcast('ai_device_control', { device: 'pump', action: 'off', deviceName: pumpDevice.label || pumpDevice.name || 'Pump', autoOff: true });
      } catch (e) {
        console.error('[PumpOnEveryReply] Auto-off error:', e.message);
      }
      pumpEveryReplyTimers.delete(timerKey);
    }, maxSeconds * 1000));
  } catch (e) {
    console.error('[PumpOnEveryReply] Pump ON error:', e.message);
  }
}

// Get active welcome message for a character
function getActiveWelcomeMessage(character) {
  if (!character) return null;

  // Check active story first (v2 format - stories contain welcomeMessages)
  if (character.stories && character.stories.length > 0) {
    const activeStoryId = character.activeStoryId || character.stories[0].id;
    const activeStory = character.stories.find(s => s.id === activeStoryId) || character.stories[0];

    if (activeStory?.welcomeMessages?.length > 0) {
      // Random version: pick a random welcome message on session start
      if (activeStory.randomWelcomeVersion && activeStory.welcomeMessages.length > 1) {
        const randomIdx = Math.floor(Math.random() * activeStory.welcomeMessages.length);
        return activeStory.welcomeMessages[randomIdx];
      }
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
      if (isInstructor(character)) {
        systemPrompt = buildInstructorSystemPrompt(character, playerName, substituteVarsWelcome);
      } else if (character.multiChar?.enabled) {
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

      // Always-on global dictionary, unless this instructor opts out (Use Card Library Only)
      if (!(isInstructor(character) && character.ignoreDictionary)) {
        systemPrompt += buildDictionaryPrompt();
      }

      // Add active reminders (using reminder engine for keyword-based activation)
      const memSettingsAutoReply = getChatMemorySettings(settings);
      const recentMessages = reminderEngine.extractRecentMessages(sessionState.chatHistory, memSettingsAutoReply.reminderScanDepth);
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

      if (isInstructor(character)) {
        systemPrompt += `\nCurrent capacity: ${capacity}%. Pain: ${painLabel} (${painLevel}/10).\n\n`;
      } else {
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
      }

      // Inject pre-inflation checkpoint for welcome message
      const checkpointWelcome = getActiveCheckpoint(character, capacity);
      if (checkpointWelcome?.preInflation) {
        systemPrompt += `=== PRE-INFLATION REQUIREMENT ===\nDo NOT activate the pump, begin inflation, or use [pump on] tags until the following has been accomplished:\n${checkpointWelcome.preInflation}\n=== END PRE-INFLATION REQUIREMENT ===\n\n`;
      }

      if (isInstructor(character)) {
        systemPrompt += `Deliver the opening instruction to the player. Stay terse, direct, and on-mission — do not embellish. Base it on this template:\n\n"${welcomeMsg.text}"`;
      } else {
        systemPrompt += `Write an engaging, in-character first message to greet the player. Base it on this template but expand and enhance it:\n\n"${welcomeMsg.text}"`;
      }

      const result = await llmService.generate({
        prompt: `${character.name}:`,
        systemPrompt,
        settings: { ...settings.llm, ...charTokenOverride(character) }
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

  // Execute post-welcome triggers sequentially
  const activeStoryWelcome = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
  const postTriggers = activeStoryWelcome?.postWelcomeTriggers || [];
  if (postTriggers.length > 0) {
    console.log(`[WELCOME] Executing ${postTriggers.length} post-welcome trigger(s)`);
    for (const trigger of postTriggers) {
      await executeTrigger(trigger, 'post-welcome', character, settings);
    }
  }

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
      (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');
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
          // Lean enhance context (character voice + current state + 2-message tail) — this
          // line is its own directive, so it doesn't need the full per-turn context.
          context = buildLeanEnhanceContext(activeCharacter, activePersona, settings, 2);
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
        const actionPlayerName = activePersona?.displayName || 'The player';
        const instruction = `[YOUR NEXT MESSAGE MUST EXPRESS THIS ACTION: ${data.content}]`;

        if (isPlayerVoice) {
          // For player voice, buildSpecialContext already set up the context
          // Just add the action instruction and capacity
          context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be ${activePersona?.displayName || 'the player'} performing this specific action: "${data.content}"${capacityStateInstruction}\nELABORATE on this action with vivid detail, physical sensations, emotions, and reactions. Do NOT just repeat the action verbatim - expand it into a full, immersive message. Ignore previous conversation flow.\n=== END CRITICAL INSTRUCTION ===`;
        } else if (isInstructor(activeCharacter)) {
          // Instructors deliver terse spoken instruction — never "immersive roleplay".
          context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next message MUST deliver this as a direct spoken instruction: "${data.content}"${capacityStateInstruction}\nRephrase it naturally in your own words as the instructor. No "quotes", no *actions*, no narration. Be terse.\n=== END CRITICAL INSTRUCTION ===`;
        } else {
          // For character voice, add full instruction
          context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be the character performing this specific action: "${data.content}"${challengeInstruction}${capacityInstruction}${capacityStateInstruction}\nELABORATE on this action with vivid detail, physical descriptions, character reactions, and in-character dialogue. Do NOT just repeat the action verbatim - expand it into a full, immersive roleplay message. Ignore previous conversation flow.\n=== END CRITICAL INSTRUCTION ===`;
        }

        // Strip any trailing speaker tag from the context (buildChatContext/buildSpecialContext add one)
        // Then add our instruction followed by the correct speaker tag for this action
        const speakerPattern = new RegExp(`(\\n?\\[Player\\]:|\\n?\\[Char\\]:|\\n?${activeCharacter.name}:|\\n?${actionPlayerName}:)\\s*$`);
        context.prompt = context.prompt.replace(speakerPattern, '');

        // Append instruction to the prompt so it's the last thing before generation
        context.prompt += `\n\n${instruction}\n${isPlayerVoice ? actionPlayerName + ':' : activeCharacter.name + ':'}`;

        console.log('[EventEngine] Generating LLM message based on:', data.content);

        // Build LLM settings, applying maxTokensOverride if provided (for short pre-messages)
        const llmSettings = { ...settings.llm, ...charTokenOverride(activeCharacter) };
        if (data.maxTokensOverride) {
          llmSettings.maxTokens = clampMaxTokens(data.maxTokensOverride);
          console.log(`[EventEngine] Using maxTokens override: ${llmSettings.maxTokens}`);
        }

        // Generate enhanced response
        const result = await llmService.generate({
          prompt: context.prompt,
          messages: context.messages,
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
            variationContext.prompt = variationContext.prompt.replace(new RegExp(`(\\n?\\[Player\\]:|\\n?\\[Char\\]:|\\n?${actionPlayerName}:)\\s*$`), '');
            variationContext.prompt += `\n\n[Write a unique variation of: ${data.content}]\n${actionPlayerName}:`;
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
            messages: variationContext.messages,
            systemPrompt: variationContext.systemPrompt,
            settings: settings.llm
          });
          finalText = retryResult.text;
        }

        // Apply variable substitution to final result
        finalText = substituteAllVariables(finalText);
        // Instructors never roleplay — strip asterisk actions / quoted dialogue here too.
        if (!isPlayerVoice && isInstructor(activeCharacter)) finalText = stripInstructorRoleplay(finalText);

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

        // Inject [pump on] if pumpOnEveryReply is enabled (skips flow chain messages)
        // pumpOnEveryReply handled before generation

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
      (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');
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
          messages: context.messages,
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
  } else if (type === 'character_inflate_start') {
    // Start character inflation timer
    const ciSettings = loadData(DATA_FILES.settings) || {};
    const ciChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const ciChar = ciChars.find(c => c.id === ciSettings.activeCharacterId);
    const ciCalTime = getCharacterCalibrationTime(ciChar);
    console.log(`[CharInflation] Broadcast received: activeChar=${ciChar?.name}, isPumpable=${ciChar?.isPumpable}, calibrationTime=${ciCalTime}, synced=${ciChar?.charSyncCalibrationWithPlayer}`);
    if (ciChar?.isPumpable && ciCalTime) {
      startCharacterInflation(ciCalTime, ciChar.charBurstPercent || 100);
    } else {
      console.log(`[CharInflation] Cannot start: character not pumpable or missing calibration time`);
    }
  } else if (type === 'character_inflate_stop') {
    console.log('[CharInflation] Deactivate broadcast received');
    stopCharacterInflation();
  } else if (type === 'fire_trigger_set') {
    // Flow "Fire Trigger Set" action — fire its trigger blocks, or a whole saved set (legacy).
    const s = loadData(DATA_FILES.settings) || {};
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const ch = chars.find(c => c.id === s?.activeCharacterId);
    if (Array.isArray(data?.blocks) && data.blocks.length) {
      await fireTriggerBlocks(data.blocks, 'flow', ch, s);
    } else if (data?.triggerSetId) {
      const r = await fireTriggerSetById(data.triggerSetId);
      console.log(`[Flow] fire_trigger_set ${data.triggerSetId}:`, r);
    }
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
      const updated = syncPersonaAutoGeneratedButtons(persona.id, combinedFlows, persona);
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
      const updated = syncPersonaAutoGeneratedButtons(persona.id, combinedFlows, persona);
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
function syncPersonaAutoGeneratedButtons(personaId, assignedFlowIds, existingPersona) {
  console.log(`[PersonaButtonSync] Syncing buttons for persona ${personaId} with flows:`, assignedFlowIds);

  // Use provided persona object to avoid re-reading stale data from disk
  let persona = existingPersona;
  if (!persona) {
    const personas = loadAllPersonas() || [];
    persona = personas.find(p => p.id === personaId);
  }

  if (!persona) {
    console.log(`[PersonaButtonSync] Persona ${personaId} not found`);
    return false;
  }

  // Use per-flow storage if active - load only assigned flows
  const flows = isPerFlowStorageActive() ? loadFlows(assignedFlowIds) : (loadData(DATA_FILES.flows) || []);
  console.log(`[PersonaButtonSync] Loaded ${flows.length} flows`);

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
    // Update buttons on the persona object — caller is responsible for saving
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
      const updated = syncPersonaAutoGeneratedButtons(persona.id, assignedFlows, persona);
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

// ensureCharInflateFlowAssignments removed — pump toggle button on portrait replaces auto-loaded flows

// Flow assignments, pump controls, and button sync are deferred to after
// factory restore and index rebuilds — see startup block near server.listen()

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

// Load Kasa 1.1.x+ credentials from settings if saved
if (startupSettings.kasaKlapEmail && startupSettings.kasaKlapPassword) {
  kasaKlapService.setCredentials(
    startupSettings.kasaKlapEmail,
    startupSettings.kasaKlapPassword
  );
  console.log('[Startup] Kasa 1.1.x+ credentials loaded');
}

// Load Home Assistant credentials from settings if saved
if (startupSettings.haUrl && startupSettings.haToken) {
  haService.setCredentials(
    startupSettings.haUrl,
    startupSettings.haToken
  );
  console.log('[Startup] Home Assistant credentials loaded');
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
    // Sync character's autoReplyEnabled to session state. Instructors auto-respond
    // by default (overridable by setting autoReplyEnabled:false on the card).
    sessionState.autoReply = isInstructor(activeCharacter)
      ? (activeCharacter?.autoReplyEnabled ?? true)
      : (activeCharacter?.autoReplyEnabled || false);
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
    case 'emergency_stop': {
      console.log('[EMERGENCY STOP via WS] Immediate LLM abort + device shutoff');
      // Abort LLM immediately — this is the most time-critical action
      llmService.abortAllRequests();
      aiDeviceControl.clearAllLlmTimers(deviceService);
      // Halt flows
      if (eventEngine) eventEngine.emergencyStop();
      // Stop timers
      deviceService.stopAllPumpRuntimeTracking();
      stopCharacterInflation();
      stopPumpSafetyWatchdog();
      clearAllServerTimedPumpTimers();
      // Stop all devices CONCURRENTLY with per-device timeout, confirming each
      // turn-off and reporting REAL status (covers homeassistant via resolveControlId).
      const estopDevices = loadData(DATA_FILES.devices) || [];
      const wsStopResults = await stopAllDevicesConcurrently(estopDevices, '[EMERGENCY STOP via WS]');
      const wsDevices = wsStopResults.map(r => ({
        id: resolveControlId(r.device),
        name: r.name,
        success: r.ok,
        confirmed: r.confirmed,
        error: r.ok ? undefined : r.error
      }));
      broadcast('emergency_stop', { timestamp: Date.now(), results: { devices: wsDevices } });
      break;
    }

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
      if (!sessionState.preInflationGateMet && data.capacity > 0) {
        sessionState.preInflationGateMet = true;
        console.log('[Pre-Inflation Gate] Gate OPENED — manual capacity set above 0%.');
      }

      // Store offset between manual value and auto-calculated value so
      // auto-capacity continues increasing FROM the manual value
      {
        const recalSettings = loadData(DATA_FILES.settings) || {};
        const recalModifier = recalSettings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
        const recalDevices = loadData(DATA_FILES.devices) || [];
        let autoCapacity = 0;
        for (const [key, tracker] of Object.entries(sessionState.pumpRuntimeTracker)) {
          const dev = recalDevices.find(d => d.ip === key || `${d.ip}:${d.childId}` === key || d.deviceId === key);
          if (dev?.calibrationTime) {
            autoCapacity += (tracker.totalSeconds / dev.calibrationTime) * 100 * recalModifier;
          }
        }
        sessionState.capacityOffset = data.capacity - Math.round(autoCapacity);
        console.log(`[ManualCapacity] Set offset: ${sessionState.capacityOffset} (manual=${data.capacity}%, auto=${Math.round(autoCapacity)}%)`);
      }

      // Auto-pop shutoff: Turn off all pumps when capacity reaches the effective pop threshold
      const capacitySettings = loadData(DATA_FILES.settings) || {};
      const manualPopThreshold = getEffectivePopThreshold(capacitySettings);
      if (sessionState.capacity >= manualPopThreshold) {
        const devices = loadData(DATA_FILES.devices) || [];
        const pumpDevices = devices.filter(d => d.deviceType === 'PUMP' || d.isPrimaryPump);

        for (const pump of pumpDevices) {
          const deviceId = pump.brand === 'govee' || pump.brand === 'tuya' || pump.brand === 'homeassistant' ? pump.deviceId : pump.ip;
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

      broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: sessionState.preInflationGateMet });

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

    case 'update_capacity_modifier': {
      const newModifier = Math.max(0.25, Math.min(2.0, parseFloat(data.capacityModifier) || 1.0));
      sessionState.capacityModifier = newModifier;
      // Also persist to settings so it survives restart
      const modSettings = loadData(DATA_FILES.settings) || {};
      if (!modSettings.globalCharacterControls) modSettings.globalCharacterControls = {};
      modSettings.globalCharacterControls.autoCapacityMultiplier = newModifier;
      saveData(DATA_FILES.settings, modSettings);
      console.log(`[CapacityModifier] Updated to ${newModifier}x`);
      broadcast('capacity_modifier_update', { capacityModifier: newModifier });
      break;
    }

    case 'update_character_capacity':
      sessionState.characterCapacity = Math.max(0, Math.min(100, parseInt(data.characterCapacity) || 0));
      broadcast('character_capacity_update', { characterCapacity: sessionState.characterCapacity });
      eventEngine.checkCharacterStateChanges({ characterCapacity: sessionState.characterCapacity });
      console.log(`[CharCapacity] Manually set to ${sessionState.characterCapacity}%`);
      break;

    case 'character_inflate_start': {
      const charInflateSettings = loadData(DATA_FILES.settings) || {};
      const charInflateChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const activeCharInflate = charInflateChars.find(c => c.id === charInflateSettings.activeCharacterId);
      const wsCalTime = getCharacterCalibrationTime(activeCharInflate);
      if (activeCharInflate?.isPumpable && wsCalTime) {
        startCharacterInflation(wsCalTime, activeCharInflate.charBurstPercent || 100);
      } else {
        console.log(`[CharInflation] Cannot start - character not pumpable or no calibration time`);
      }
      break;
    }

    case 'character_inflate_stop':
      stopCharacterInflation();
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

    case 'update_chat_memory_summary':
      // Allow user to edit or clear the rolling chat summary
      sessionState.chatMemorySummary = data.summary || null;
      if (!data.summary) {
        sessionState.chatMemorySummaryUpTo = 0;
      }
      autosaveSession();
      broadcast('chat_memory_summary_updated', { summary: sessionState.chatMemorySummary });
      break;

    case 'clear_chat':
      await handleClearChat(data);
      break;

    case 'edit_message':
      handleEditMessage(data);
      break;

    case 'swipe_message':
      await handleSwipeMessage(data);
      break;

    case 'cancel_generation': {
      llmService.abortAllRequests();
      llmState.isGenerating = false;
      // Remove any in-progress message (streaming or placeholder)
      const cancelIdx = sessionState.chatHistory.findIndex(m => m.streaming || m.content === '...');
      if (cancelIdx !== -1) {
        const removedId = sessionState.chatHistory[cancelIdx].id;
        sessionState.chatHistory.splice(cancelIdx, 1);
        broadcast('message_deleted', { id: removedId });
      }
      broadcast('generating_stop', {});
      break;
    }

    case 'navigate_swipe': {
      const { messageId, direction } = data;
      const navIdx = sessionState.chatHistory.findIndex(m => m.id === messageId);
      if (navIdx === -1) break;
      const navMsg = sessionState.chatHistory[navIdx];
      if (!navMsg.swipeHistory || navMsg.swipeHistory.length <= 1) break;

      let newIndex = navMsg.activeSwipeIndex ?? navMsg.swipeHistory.length - 1;
      if (direction === 'back') newIndex = Math.max(0, newIndex - 1);
      else if (direction === 'forward') newIndex = Math.min(navMsg.swipeHistory.length - 1, newIndex + 1);

      navMsg.activeSwipeIndex = newIndex;
      navMsg.content = navMsg.swipeHistory[newIndex];
      broadcast('message_updated', navMsg);
      autosaveSession();
      break;
    }

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

        // Sync auto-generated buttons (pass in-memory persona to avoid stale re-read)
        const globalFlowsForPersona = sessionState.flowAssignments.global || [];
        const combinedPersonaFlowsForSync = [...new Set([...data.flows, ...globalFlowsForPersona])];
        const personaButtonsUpdated = syncPersonaAutoGeneratedButtons(data.personaId, combinedPersonaFlowsForSync, persona);

        // syncPersonaAutoGeneratedButtons saves if buttons changed; if only flows changed, save here
        if (!personaButtonsUpdated) {
          savePersonaAsync(persona).catch(err => console.error('Failed to save persona flows:', err));
        }

        if (personaButtonsUpdated) {
          broadcast('personas_update', loadAllPersonas());
        }
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

    case 'choose_multi_response':
      await eventEngine.handleChooseMulti(
        data.nodeId,
        data.selectedIds
      );
      break;

    case 'checkpoint_choice_response':
      await handleCheckpointChoice(data.choiceId);
      break;

    case 'manual_pump':
      await handleManualPump();
      break;

    case 'toggle_member_mute': {
      // Toggle whether a multichar member can speak/reply this session
      const list = new Set(sessionState.mutedMembers || []);
      if (data.muted === true) list.add(data.memberId);
      else if (data.muted === false) list.delete(data.memberId);
      else if (list.has(data.memberId)) list.delete(data.memberId);
      else list.add(data.memberId);
      sessionState.mutedMembers = Array.from(list);
      broadcast('member_mute_update', { mutedMembers: sessionState.mutedMembers });
      break;
    }

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
            const pumpDeviceId = pump.brand === 'govee' || pump.brand === 'tuya' || pump.brand === 'homeassistant' ? pump.deviceId : pump.ip;
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
          sessionState.capacityOffset = 0;
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

        const deviceId = device.brand === 'govee' || device.brand === 'tuya' || device.brand === 'homeassistant' ? device.deviceId : device.ip;
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

/**
 * Handle clear chat actions: clear screen, clear context, clear both, summarize & clear.
 * Modes: 'screen' | 'context' | 'both' | 'summarize'
 */
async function handleClearChat(data) {
  const { mode } = data;
  const { v4: uuidv4 } = require('uuid');

  console.log(`[ClearChat] Mode: ${mode}`);

  if (mode === 'summarize') {
    // Summarize all messages, then clear both screen and context
    const settings = loadData(DATA_FILES.settings);
    const playerName = sessionState.playerName || 'Player';
    const charName = sessionState.characterName || 'Character';

    // Build message block from all history
    let messageBlock = '';
    sessionState.chatHistory.forEach(msg => {
      if (msg.excludeFromContext || msg.sender === 'system') return;
      const speaker = msg.sender === 'player' ? playerName : (msg.characterName || charName);
      messageBlock += `${speaker}: ${msg.content}\n`;
    });

    let summaryText = null;

    if (messageBlock.trim()) {
      const hasLlmConfig = settings?.llm?.llmUrl ||
        (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');

      if (hasLlmConfig) {
        try {
          const existingSummary = sessionState.chatMemorySummary;
          let summaryPrompt;
          if (existingSummary) {
            summaryPrompt = `You are a narrator summarizing a roleplay session. Below is an existing summary of earlier events, followed by the most recent conversation. Produce a cohesive narrative summary that incorporates both.

EARLIER SUMMARY:
${existingSummary}

RECENT CONVERSATION:
${messageBlock}

Write a concise narrative summary (5-10 sentences) that captures:
- The story arc and key events
- Current physical state (capacity, pain, emotional state)
- Character dynamics and relationship progression
- Important details that would affect continuing the story

Write ONLY the summary in third-person narrator voice, no preamble or labels.`;
          } else {
            summaryPrompt = `You are a narrator summarizing a roleplay session. Summarize the following conversation.

CONVERSATION:
${messageBlock}

Write a concise narrative summary (5-10 sentences) that captures:
- The story arc and key events
- Current physical state (capacity, pain, emotional state)
- Character dynamics and relationship progression
- Important details that would affect continuing the story

Write ONLY the summary in third-person narrator voice, no preamble or labels.`;
          }

          const summarySettings = { ...settings.llm };
          summarySettings.maxTokens = 500;
          summarySettings.streaming = false;

          broadcast('generating_start', { characterName: 'System', isPlayerVoice: false });

          const result = await llmService.generate({
            prompt: summaryPrompt,
            systemPrompt: 'You are a concise narrative summarizer. Output only the summary text.',
            settings: summarySettings
          });

          broadcast('generating_stop', {});

          if (result.text?.trim()) {
            summaryText = result.text.trim();
          }
        } catch (error) {
          console.error('[ClearChat] Summarization failed:', error.message);
          broadcast('generating_stop', {});
        }
      }
    }

    // Clear both screen and context
    sessionState.chatHistory = [];
    sessionState.chatMemorySummaryUpTo = 0;
    // Allow checkpoint triggers to re-fire after a context wipe. We do NOT touch the
    // physical capacity (it must stay in sync with the real pump state).
    firedCheckpointTriggers.clear();
    sessionState.firedTreeNodes.clear();

    // Set the summary as the rolling memory
    if (summaryText) {
      sessionState.chatMemorySummary = summaryText;

      // Add state context to the summary
      const stateNote = `[Current state: ${playerName} capacity ${Math.round(sessionState.capacity)}%, pain ${sessionState.pain}/10, emotion: ${sessionState.emotion}` +
        (sessionState.characterCapacity > 0 ? `, ${charName} capacity ${Math.round(sessionState.characterCapacity)}%` : '') + ']';
      sessionState.chatMemorySummary += '\n' + stateNote;

      // Create display-only summary bubble
      const summaryMessage = {
        id: uuidv4(),
        content: summaryText,
        sender: 'system',
        systemLabel: 'Summary',
        excludeFromContext: true,
        timestamp: Date.now()
      };
      sessionState.chatHistory.push(summaryMessage);
      broadcast('chat_cleared', { messages: sessionState.chatHistory });
    } else {
      sessionState.chatMemorySummary = null;
      broadcast('chat_cleared', { messages: [] });
    }

    autosaveSession();
    console.log(`[ClearChat] Summarize & Clear complete. Summary: ${summaryText ? summaryText.substring(0, 80) + '...' : 'none'}`);

  } else if (mode === 'screen') {
    // Mark all messages as hidden but keep in context
    // We'll send empty messages array to frontend but keep chatHistory intact
    broadcast('chat_cleared', { messages: [], screenOnly: true });
    console.log('[ClearChat] Screen cleared (context preserved)');

  } else if (mode === 'context') {
    // Clear the LLM memory but keep screen
    const preserved = sessionState.chatHistory.map(m => ({ ...m, excludeFromContext: true }));
    sessionState.chatHistory = preserved;
    sessionState.chatMemorySummary = null;
    sessionState.chatMemorySummaryUpTo = 0;
    firedCheckpointTriggers.clear();
    sessionState.firedTreeNodes.clear();
    autosaveSession();
    broadcast('chat_cleared', { messages: preserved, contextOnly: true });
    console.log('[ClearChat] Context cleared (screen preserved)');

  } else if (mode === 'both') {
    // Nuclear — clear everything
    sessionState.chatHistory = [];
    sessionState.chatMemorySummary = null;
    sessionState.chatMemorySummaryUpTo = 0;
    firedCheckpointTriggers.clear();
    sessionState.firedTreeNodes.clear();
    autosaveSession();
    broadcast('chat_cleared', { messages: [] });
    console.log('[ClearChat] Both screen and context cleared');
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
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');
  if (!activeCharacter || !hasLlmConfig) return;

  const useStreaming = settings.llm?.streaming === true;

  try {
    // Store original content
    const originalContent = msg.content;

    // Initialize swipe history if first swipe
    if (!msg.swipeHistory) {
      msg.swipeHistory = [originalContent];
      msg.activeSwipeIndex = 0;
    }

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
    let systemPrompt, prompt, swipeMessages;

    if (isPlayerMsg) {
      // For player messages, use impersonate with guidance if provided
      const mode = guidanceText ? 'guided_impersonate' : 'impersonate';
      const impersonateContext = buildSpecialContext(mode, guidanceText, activeCharacter, activePersona, settings);

      systemPrompt = impersonateContext.systemPrompt;
      prompt = impersonateContext.prompt;
      swipeMessages = impersonateContext.messages;
    } else {
      // For character messages — roll personality attributes
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      await runReplyScopes(activeCharacter);
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'swipe' });
      if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply
      const context = applyCharacterGuidance(
        buildChatContext(activeCharacter, settings),
        activeCharacter,
        guidanceText
      );
      systemPrompt = context.systemPrompt;
      prompt = context.prompt;
      swipeMessages = context.messages;
    }

    let resultText;

    if (useStreaming) {
      const result = await llmService.generateStream({
        prompt,
        messages: swipeMessages,
        systemPrompt,
        settings: { ...settings.llm, ...charTokenOverride(activeCharacter) },
        onToken: (token, fullText) => {
          fullHistory[msgIndex].content = fullText;
          broadcast('stream_token', { messageId: id, token, fullText });
        }
      });
      resultText = result.text;
    } else {
      const result = await llmService.generate({
        prompt,
        messages: swipeMessages,
        systemPrompt,
        settings: { ...settings.llm, ...charTokenOverride(activeCharacter) }
      });
      resultText = result.text;
    }

    // Abort guard: if an emergency stop fired while the LLM was generating, do NOT
    // activate any device from this (now-stale) response.
    if (eventEngine.aborted) {
      console.log('[Swipe] Aborted after generation — skipping device activation');
      broadcast('generating_stop', {});
      return;
    }

    // Process AI device commands (e.g., [pump on], [vibe off])
    const devices = loadData(DATA_FILES.devices) || [];

    // Inject [pump on] if pumpOnEveryReply is enabled
    // pumpOnEveryReply handled before generation

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
    const finalContent = substituteAllVariables(resultText);
    sessionState.chatHistory[msgIndex].content = finalContent;
    sessionState.chatHistory[msgIndex].swipeHistory.push(finalContent);
    sessionState.chatHistory[msgIndex].activeSwipeIndex = sessionState.chatHistory[msgIndex].swipeHistory.length - 1;
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

  // Handle ha:entityId format (Home Assistant)
  if (deviceKey.startsWith('ha:')) {
    const deviceId = deviceKey.substring(3);
    const device = devices.find(d => d.brand === 'homeassistant' && d.deviceId === deviceId);
    return { deviceId, deviceObj: device || { brand: 'homeassistant', deviceId } };
  }

  // Handle ip:childId format (power strip outlet)
  if (deviceKey.includes(':') && !deviceKey.startsWith('govee:') && !deviceKey.startsWith('tuya:') && !deviceKey.startsWith('ha:')) {
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

        case 'run_trigger_set':
          await handleButtonRunTriggerSet(action, characterId);
          break;

        case 'trigger_blocks':
          await handleButtonTriggerBlocks(action, characterId);
          break;

        case 'run_tree':
          await handleButtonRunTree(action, characterId);
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

// Button "Run Trigger Tree" action: resolve the button's tree ref ({inline}|{treeId}) and run
// it standalone (ai_message posts immediately, like other button actions). scopeKey btn:<id> so
// `once` nodes fire once per button per session.
async function handleButtonRunTree(action, characterId) {
  const ref = action.config?.treeRef || (action.config?.treeId ? { treeId: action.config.treeId } : action.config?.inline ? { inline: action.config.inline } : null);
  if (!ref) { console.log('[Button] run_tree: no tree ref configured'); return; }
  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === (characterId || settings?.activeCharacterId)) || null;
  const treeIndex = buildTreeIndex();
  const tree = resolveRefTree(ref, treeIndex);
  if (!tree) { console.log('[Button] run_tree: ref did not resolve to a tree'); return; }
  await runTreeScope(tree, `btn:${action.config?.buttonId || action.id || 'x'}`, character, settings, { delivery: 'standalone', treeIndex });
}

async function handleButtonTriggerBlocks(action, characterId) {
  const blocks = action.config?.blocks || action.blocks;
  if (!Array.isArray(blocks) || !blocks.length) { console.log('[Button] No trigger blocks configured'); return; }
  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === (characterId || settings?.activeCharacterId));
  console.log(`[Button] Firing ${blocks.length} trigger block(s)`);
  await fireTriggerBlocks(blocks, 'button', character, settings);
}

async function handleButtonRunTriggerSet(action, characterId) {
  const setId = action.config?.triggerSetId;
  if (!setId) { console.log('[Button] No triggerSetId specified for run_trigger_set'); return; }
  const sets = loadData(DATA_FILES.triggerSets) || [];
  const set = sets.find(s => s.id === setId);
  if (!set) { console.log(`[Button] Trigger set ${setId} not found`); return; }
  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === (characterId || settings?.activeCharacterId));
  console.log(`[Button] Running trigger set "${set.name}" (${(set.triggers || []).length} triggers)`);
  for (const trigger of (set.triggers || [])) {
    await executeTrigger(trigger, 'button', character, settings);
  }
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
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');
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
      await runReplyScopes(character);
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'button' });
      if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply

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
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        settings: { ...settings.llm, ...charTokenOverride(character) }
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
// Instructors speak only as a terse operator — never roleplay. Strip *asterisk actions*
// and unwrap "quoted dialogue" so it (a) reads as direct instruction and (b) never enters
// chat history, where the model would otherwise copy its own RP style on the next turn.
function stripInstructorRoleplay(text) {
  if (!text) return text;
  let t = text;
  t = t.replace(/\*[^*\n]*\*/g, ''); // remove *action* spans
  t = t.replace(/\*/g, '');          // remove any stray asterisks
  t = t.replace(/[“”„"]/g, '');      // unwrap quoted dialogue (keep the words, drop the quotes)
  // Tidy whitespace left behind.
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

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

  // Instructor pre-reqs configured to start after the first player message
  if (activeCharacter && sender === 'player' && isInstructor(activeCharacter)
      && !sessionState.prereqsDone && !sessionState.pendingPrereqs) {
    const aStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
    if (aStory?.prereqTiming === 'after_first_message') {
      startInstructorPrereqs(activeCharacter);
    }
  }

  // Pre-Fill: a player message may advance/branch/exit the gated intro before we generate,
  // so the reply reflects the new step (or the freshly-started pump phase).
  if (activeCharacter && sender === 'player' && sessionState.preFillActive) {
    scanPreFill(activeCharacter, content);
  }

  // Summarize overflow messages before building context (non-blocking on failure)
  await summarizeOverflowMessages(settings);

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
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');

  console.log(`[Chat] activeCharacter=${activeCharacter?.name || 'none'}, hasLlmConfig=${hasLlmConfig ? 'yes' : 'no'}`);

  if (activeCharacter && hasLlmConfig) {
    // Notify UI that AI is generating
    broadcast('generating_start', { characterName: activeCharacter.name });

    // Pump on every reply — fire before LLM generates so pump runs during generation
    await executePumpOnEveryReply('', activeCharacter, false);
    // Per-range auto-pump pacing (electric instructor ranges)
    await executeAutoPumpPacing(activeCharacter, false);

    try {
      // Roll personality attributes for this message
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      await runReplyScopes(activeCharacter);
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'chat' });
      if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply

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
          ...charTokenOverride(activeCharacter),
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        };

        const result = await llmService.generateStream({
          prompt: context.prompt,
          messages: context.messages,
          systemPrompt: context.systemPrompt,
          settings: llmSettings,
          onToken: (token, fullText) => {
            // Update message content and broadcast
            aiMessage.content = fullText;
            broadcast('stream_token', { messageId: aiMessage.id, token, fullText });
          }
        });

        // Abort guard: if emergency stop fired during generation, do not activate
        // devices from this stale streamed response.
        if (eventEngine.aborted) {
          console.log('[Chat/Stream] Aborted after generation — skipping device activation');
          broadcast('generating_stop', {});
          return;
        }

        // Strip any cross-role content that slipped through
        finalText = stripCrossRoleContent(result.text, context.stopSequences, true);
        aiMessage.content = substituteAllVariables(finalText);
        // Instructors never roleplay — strip asterisk actions / quoted dialogue before
        // it's broadcast (via stream_complete) and saved to history.
        if (isInstructor(activeCharacter)) {
          aiMessage.content = stripInstructorRoleplay(aiMessage.content);
          sessionState.repliesSinceManualPump = Math.min((sessionState.repliesSinceManualPump ?? 999) + 1, 9999);
        }

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlSettings = loadData(DATA_FILES.settings);

        // Inject [pump on] if pumpOnEveryReply is enabled
        // pumpOnEveryReply handled before generation

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
          ...charTokenOverride(activeCharacter),
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        };

        const result = await llmService.generate({
          prompt: context.prompt,
          messages: context.messages,
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
          messages: retryContext.messages,
          systemPrompt: retryContext.systemPrompt,
          settings: { ...settings.llm, ...charTokenOverride(activeCharacter) }
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

      // Abort guard: if emergency stop fired during generation/retries, do not
      // activate devices from this stale response.
      if (eventEngine.aborted) {
        console.log('[Chat] Aborted after generation — skipping device activation');
        broadcast('generating_stop', {});
        return;
      }

      // For non-streaming, add message now
      if (!useStreaming) {
        // Apply variable substitution to final text
        finalText = substituteAllVariables(finalText);
        if (isInstructor(activeCharacter)) {
          finalText = stripInstructorRoleplay(finalText);
          sessionState.repliesSinceManualPump = Math.min((sessionState.repliesSinceManualPump ?? 999) + 1, 9999);
        }

        // Process AI device commands (e.g., [pump on], [vibe off])
        const devices = loadData(DATA_FILES.devices) || [];
        const aiControlSettings = loadData(DATA_FILES.settings);

        // Inject [pump on] if pumpOnEveryReply is enabled
        // pumpOnEveryReply handled before generation

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
    const recentMessages = sessionState.chatHistory.slice(-4).filter(m => !m.excludeFromContext && m.sender !== 'system').map(m => {
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
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');

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
    await runReplyScopes(activeCharacter);
    if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'post-block' });
    if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply

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
        ...charTokenOverride(activeCharacter),
        stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
      };

      finalText = await llmService.generateStream({
        prompt: context.prompt,
        messages: context.messages,
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
        ...charTokenOverride(activeCharacter),
        stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
      };

      const result = await llmService.generate({
        prompt: context.prompt,
        messages: context.messages,
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
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');

  if (!activeCharacter || !hasLlmConfig) {
    broadcast('error', { message: 'No character or LLM configured' });
    return;
  }

  // Summarize overflow messages before building context
  await summarizeOverflowMessages(settings);

  // Determine who is generating based on mode
  const isPlayerVoice = mode === 'impersonate' || mode === 'guided_impersonate';
  const generatingFor = isPlayerVoice ? (activePersona?.displayName || 'Player') : activeCharacter.name;

  // Notify UI that we're generating
  broadcast('generating_start', { characterName: generatingFor, isPlayerVoice });

  // Pump on every reply — fire before LLM generates
  if (!isPlayerVoice) {
    await executePumpOnEveryReply('', activeCharacter, false);
    await executeAutoPumpPacing(activeCharacter, false);
  }

  try {
    // Roll personality attributes for character voice only (not impersonate)
    if (!isPlayerVoice) {
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      await runReplyScopes(activeCharacter);
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'guided' });
      if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply
    }

    // P1: character-voice guided responses use the SAME full context as a normal
    // reply (buildChatContext) plus ONE guidance injection — converging with the
    // guided-swipe-of-character path. Player voice keeps buildSpecialContext.
    let context;
    if (isPlayerVoice) {
      context = buildSpecialContext(mode, guidedText, activeCharacter, activePersona, settings);
    } else {
      context = applyCharacterGuidance(
        buildChatContext(activeCharacter, settings),
        activeCharacter,
        guidedText
      );
    }
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
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        settings: {
          ...settings.llm,
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        },
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

      // Inject [pump on] if pumpOnEveryReply is enabled
      // pumpOnEveryReply handled before generation

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
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        settings: {
          ...settings.llm,
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        }
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

      let retryContext;
      if (isPlayerVoice) {
        retryContext = buildSpecialContext(mode, guidedText, activeCharacter, activePersona, settings);
      } else {
        retryContext = applyCharacterGuidance(
          buildChatContext(activeCharacter, settings),
          activeCharacter,
          guidedText
        );
      }
      retryContext.systemPrompt += '\n\nIMPORTANT: Write a UNIQUE response. Do not repeat previous messages.';

      const retryResult = await llmService.generate({
        prompt: retryContext.prompt,
        messages: retryContext.messages,
        systemPrompt: retryContext.systemPrompt,
        settings: {
          ...settings.llm,
          stopSequences: [...(settings.llm?.stopSequences || []), ...(retryContext.stopSequences || [])]
        }
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

    // Inject [pump on] if pumpOnEveryReply is enabled
    // pumpOnEveryReply handled before generation

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
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');

  if (!activeCharacter || !hasLlmConfig) {
    broadcast('error', { message: 'No character or LLM configured' });
    return;
  }

  // Summarize overflow messages before building context
  await summarizeOverflowMessages(settings);

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
      messages: context.messages,
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

  // Minimal prompt - just the speaker tag (real names for a consistent convention)
  const prompt = isPlayerVoice ? `${playerName}:` : `${character.name}:`;

  return { systemPrompt, prompt };
}

// Lean context for enhancing a single line (trigger "Char AI Message", LLM-enhanced
// injection/choice/prereq responses). Character voice + current capacity + a SHORT history
// tail for coherence — but none of the full checkpoint/dictionary/device/persona stack, so
// the enhanced line stays focused on its own text instead of drifting into the scene.
function buildLeanEnhanceContext(character, persona, settings, historyTail = 2) {
  const playerName = persona?.displayName || 'the player';
  const sub = (t) => substituteAllVariables(t || '', { playerName, characterName: character.name });

  let systemPrompt;
  if (isInstructor(character)) {
    systemPrompt = `You are ${character.name}${character.gender ? `, ${character.gender}` : ''}.\n`;
    if (character.mission) systemPrompt += `Mission: ${sub(character.mission)}\n`;
    systemPrompt += `Speak ONLY as the instructor: a direct spoken instruction. No "quoted dialogue", no *actions*, no narration, no prose.\n`;
  } else {
    systemPrompt = `You are ${character.name}. ${sub(character.description)}\n`;
    if (character.personality) systemPrompt += `Personality: ${sub(character.personality)}\n`;
    systemPrompt += `Write ONLY as ${character.name} — never write for ${playerName}.\n`;
  }
  const capacity = Math.round(sessionState.capacity || 0);
  systemPrompt += `\nCurrent capacity: ${capacity}%.\n`;

  // Short history tail (option B) — just enough recent context for coherence.
  let prompt = '';
  const tail = (sessionState.chatHistory || [])
    .filter(m => m && m.sender !== 'system' && !m.excludeFromContext)
    .slice(-Math.max(0, historyTail));
  for (const m of tail) {
    const who = m.sender === 'player' ? playerName : character.name;
    prompt += `${who}: ${m.content}\n`;
  }
  prompt += `${character.name}:`;

  return { systemPrompt, prompt };
}

const ATTRIBUTE_PROMPTS = {
  dominant: 'Take control of the situation. Be assertive, commanding, and decisive. Direct the scene rather than following.',
  sadistic: 'Be cruel, teasing, and take pleasure in discomfort. Push boundaries and enjoy reactions.',
  psychopathic: 'Be unhinged, unpredictable, and unsettling. Disregard normal social boundaries completely.',
  sensual: 'Be caring, tender, and amorous. Focus on intimacy, touch, and emotional connection.',
  sexual: 'Be overtly aroused and flirtatious. Express desire and physical attraction openly.'
};

function rollPersonaAttributes(persona) {
  const attributes = persona?.attributes;
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

const PERSONA_ATTRIBUTE_PROMPTS = {
  dominant: 'Take control of the situation. Be assertive, commanding, and decisive.',
  submissive: 'Be compliant, yielding, and eager to please. Follow rather than lead.',
  sadistic: 'Be cruel, teasing, and take pleasure in others\' discomfort.',
  masochistic: 'Enjoy your own discomfort and pain. Lean into the sensations.',
  sensual: 'Be tender, intimate, and focused on physical connection.',
  sexual: 'Be overtly aroused and flirtatious. Express desire openly.'
};

function buildPersonaAttributeBlock(activeAttributes) {
  if (!activeAttributes || activeAttributes.length === 0) return '';
  const labels = activeAttributes.map(t => t.charAt(0).toUpperCase() + t.slice(1));
  let block = `\n=== PERSONA DRIVE (THIS MESSAGE) ===\nThis response must be noticeably driven by: ${labels.join(', ')}\n`;
  for (const trait of activeAttributes) {
    const label = trait.charAt(0).toUpperCase() + trait.slice(1);
    block += `- ${label}: ${PERSONA_ATTRIBUTE_PROMPTS[trait] || ''}\n`;
  }
  block += `=== END PERSONA DRIVE ===\n`;
  return block;
}

/**
 * Build persona inflation disposition context for inflating/popping others
 */
function buildPersonaDispositionContext(persona, playerName) {
  const inflateDesire = persona?.desireToInflateOthers;
  const popDesire = persona?.desireToPopOthers;

  if ((!inflateDesire || inflateDesire === 'none') && (!popDesire || popDesire === 'none')) {
    return '';
  }

  const inflateMap = {
    none: null,
    reluctant: `${playerName} would only inflate someone if absolutely forced to`,
    indifferent: `${playerName} has no strong feelings about inflating others`,
    willing: `${playerName} is happy to inflate others when asked`,
    eager: `${playerName} actively wants to inflate others`,
    obsessed: `${playerName} is driven to inflate others at every opportunity`,
    sadistic: `${playerName} inflates others specifically to cause discomfort and takes pleasure in it`
  };

  const popMap = {
    none: null,
    avoidant: `${playerName} actively tries to prevent others from popping`,
    careless: `${playerName} doesn't worry about others popping`,
    curious: `${playerName} wonders what it would be like if someone popped`,
    willing: `${playerName} is okay with others popping`,
    eager: `${playerName} actively tries to push others past their limit`,
    sadistic: `${playerName} wants to make others pop and takes pleasure in it`
  };

  const parts = [];
  if (inflateMap[inflateDesire]) parts.push(inflateMap[inflateDesire]);
  if (popMap[popDesire]) parts.push(popMap[popDesire]);

  if (parts.length === 0) return '';
  return `Player's inflation drives: ${parts.join('. ')}.\n`;
}

// Pronoun string for a per-member gender (multichar). Empty when unset.
function genderPronoun(gender) {
  switch ((gender || '').toLowerCase()) {
    case 'male': return 'he/him';
    case 'female': return 'she/her';
    case 'nonbinary': case 'nb': case 'they': return 'they/them';
    default: return '';
  }
}

// Resolve which attribute object a mutation targets: a specific multichar member
// (story.memberAttributes[id]) or the shared/group story attributes.
function resolveAttributeStore(story, targetMember) {
  if (targetMember && targetMember !== 'group' && targetMember !== 'all') {
    story.memberAttributes = story.memberAttributes || {};
    story.memberAttributes[targetMember] = story.memberAttributes[targetMember] || {};
    return story.memberAttributes[targetMember];
  }
  story.attributes = story.attributes || {};
  return story.attributes;
}

function rollAttributes(character) {
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];

  // Multichar: roll each member independently into sessionState.multiCharAttributes.
  // Each member uses its own memberAttributes profile, falling back to the shared
  // story attributes when it has none. The single activeAttributes is left empty
  // (the per-member block in buildMultiCharSystemPrompt replaces it).
  if (character?.multiChar?.enabled && sessionState) {
    const memberAttrs = activeStory?.memberAttributes || {};
    const fallback = activeStory?.attributes || {};
    const byMember = {};
    const rolls = [];
    for (const m of (character.multiChar.characters || [])) {
      const attrs = (memberAttrs[m.id] && Object.keys(memberAttrs[m.id]).length) ? memberAttrs[m.id] : fallback;
      const active = [];
      for (const [trait, chance] of Object.entries(attrs)) {
        if (chance > 0 && Math.random() * 100 < chance) active.push(trait);
      }
      byMember[m.id] = active;
      if (active.length) rolls.push({ member: m.name, traits: active });
    }
    sessionState.multiCharAttributes = byMember;
    return { active: [], rolls, multiChar: true };
  }
  if (sessionState) sessionState.multiCharAttributes = null;

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

/**
 * Build inflation disposition context — always-on personality traits for inflating/popping others
 */
/**
 * Build persona inflation context — knowledge, desire, and pop desire for the player
 */
/**
 * Build a hardcoded physical state preface injected before every generation.
 * This grounds the LLM in the current reality regardless of what checkpoints say.
 */
function buildStatePreface(playerName, charName, character) {
  const playerCap = sessionState.capacity || 0;
  const charCap = sessionState.characterCapacity || 0;
  const isPumpable = character?.isPumpable;

  // Player physical state lookup
  const playerDesc = playerCap <= 0 ? 'flat and completely normal'
    : playerCap <= 5 ? 'normal-looking — inflation has just barely started'
    : playerCap <= 15 ? 'mostly flat with a very faint hint of fullness'
    : playerCap <= 30 ? 'slightly bloated, like after a meal'
    : playerCap <= 50 ? 'noticeably rounded and swollen'
    : playerCap <= 70 ? 'very swollen, visibly inflated and taut'
    : playerCap <= 85 ? 'hugely distended, skin tight and shiny'
    : playerCap <= 95 ? 'enormous, about to burst, straining at the absolute limit'
    : 'impossibly over-inflated, about to pop, beyond any safe limit';

  // Player feeling lookup
  const playerFeeling = playerCap <= 0 ? 'completely normal'
    : playerCap <= 5 ? 'barely aware of anything different'
    : playerCap <= 15 ? 'a faint warmth and subtle internal pressure'
    : playerCap <= 30 ? 'a growing fullness and mild pressure'
    : playerCap <= 50 ? 'persistent tightness and real pressure building'
    : playerCap <= 70 ? 'intense pressure, difficulty breathing deeply'
    : playerCap <= 85 ? 'overwhelming tightness, every movement hurts'
    : playerCap <= 95 ? 'pure agony, feeling like they could burst any second'
    : 'beyond agony, seconds from popping';

  let preface = `[Current physical reality — use this, not your imagination:\n`;
  preface += `${playerName}'s belly (${playerCap}%) is ${playerDesc}. ${playerName} feels ${playerFeeling}.\n`;

  if (isPumpable && charCap > 0) {
    const charDesc = charCap <= 5 ? 'normal-looking — inflation has just barely started'
      : charCap <= 15 ? 'mostly flat with a very faint hint of fullness'
      : charCap <= 30 ? 'slightly bloated, subtly rounder than normal'
      : charCap <= 50 ? 'noticeably rounded and swollen'
      : charCap <= 70 ? 'very swollen, visibly inflated and taut'
      : charCap <= 85 ? 'hugely distended, skin tight and shiny'
      : charCap <= 95 ? 'enormous, about to burst, straining at the absolute limit'
      : 'impossibly over-inflated, about to pop';

    const charFeeling = charCap <= 5 ? 'barely aware of anything'
      : charCap <= 15 ? 'a faint warmth and subtle pressure'
      : charCap <= 30 ? 'mild fullness and growing pressure'
      : charCap <= 50 ? 'persistent tightness and real pressure'
      : charCap <= 70 ? 'intense pressure, hard to ignore'
      : charCap <= 85 ? 'overwhelming tightness, real pain'
      : charCap <= 95 ? 'pure agony, feeling like they could burst any second'
      : 'beyond agony, seconds from popping';

    preface += `${charName}'s belly (${charCap}%) is ${charDesc}. ${charName} feels ${charFeeling}.\n`;
    preface += `${playerName} can see that ${charName}'s belly looks ${charDesc}.\n`;
    preface += `${charName} can see that ${playerName}'s belly looks ${playerDesc}.\n`;
  } else if (isPumpable && charCap <= 0) {
    preface += `${charName}'s belly is completely flat and normal — not inflated at all.\n`;
    if (playerCap > 0) {
      preface += `${charName} can see that ${playerName}'s belly looks ${playerDesc}.\n`;
    }
  } else if (playerCap > 0) {
    // Non-pumpable char can still see the player
    preface += `${charName} can see that ${playerName}'s belly looks ${playerDesc}.\n`;
  }

  preface += `]\n`;
  return preface;
}

function buildPersonaInflationContext(persona, playerName) {
  const knowledge = persona?.inflationKnowledge;
  const desire = persona?.inflationDesire;
  const popDesire = persona?.popDesire;

  // Skip if all defaults
  if ((!knowledge || knowledge === 'unaware') && (!desire || desire === 'neutral') && (!popDesire || popDesire === 'terrified')) {
    return '';
  }

  const knowledgeMap = {
    unaware: null,
    confused: `${playerName} notices something but doesn't understand what inflation is`,
    partial: `${playerName} understands the basics of inflation but not the full picture`,
    informed: `${playerName} knows exactly what inflation is and what's happening`,
    expert: `${playerName} is deeply knowledgeable about inflation and may have experience`
  };

  const desireMap = {
    terrified: `desperately does NOT want to be inflated`,
    reluctant: `would prefer not to be inflated but may comply`,
    nervous: `is anxious about being inflated but not fully opposed`,
    neutral: null,
    curious: `is intrigued by inflation and willing to try`,
    eager: `actively wants to be inflated`,
    obsessed: `craves inflation intensely`
  };

  const popMap = {
    terrified: null, // default, don't mention
    dreading: `deeply fears popping`,
    anxious: `is worried about the possibility of popping`,
    resigned: `has accepted that popping may happen`,
    indifferent: `doesn't care whether they pop or not`,
    curious: `wonders what popping would feel like`,
    willing: `is okay with popping if it happens`,
    eager: `actually wants to pop`
  };

  const parts = [];
  if (knowledgeMap[knowledge]) parts.push(knowledgeMap[knowledge]);
  if (desireMap[desire]) parts.push(`${playerName} ${desireMap[desire]}`);
  if (popMap[popDesire]) parts.push(`${playerName} ${popMap[popDesire]}`);

  if (parts.length === 0) return '';

  return `Player inflation disposition: ${parts.join('. ')}.\n`;
}

function buildInflationDispositionContext(character) {
  const inflateDesire = character?.desireToInflateOthers;
  const popDesire = character?.desireToPopOthers;

  // Skip if both are default/none
  if ((!inflateDesire || inflateDesire === 'none') && (!popDesire || popDesire === 'none')) {
    return '';
  }

  const charName = character.name || 'This character';

  const inflateMap = {
    none: null,
    reluctant: `${charName} would only inflate someone if absolutely forced to — deeply uncomfortable with it`,
    indifferent: `${charName} has no strong feelings about inflating others — would do it or not without caring`,
    willing: `${charName} is happy to inflate others when asked or when the situation calls for it`,
    eager: `${charName} actively wants to inflate others and looks for opportunities to do so`,
    obsessed: `${charName} is driven to inflate others at every opportunity — it's a compulsion they can barely control`,
    sadistic: `${charName} inflates others specifically to cause discomfort, fear, and helplessness — and takes visible pleasure in it`
  };

  const popMap = {
    none: null,
    avoidant: `${charName} actively tries to prevent others from popping — monitors limits carefully and stops before it's too late`,
    careless: `${charName} doesn't worry about others popping — pushes forward without checking if they're at their limit`,
    curious: `${charName} wonders what it would be like if someone popped — might push boundaries to find out`,
    willing: `${charName} is okay with others popping if it happens — won't try to prevent it`,
    eager: `${charName} actively tries to push others past their limit to make them pop`,
    sadistic: `${charName} wants to make others pop and takes pleasure in pushing them beyond their breaking point`
  };

  const inflateText = inflateMap[inflateDesire];
  const popText = popMap[popDesire];

  if (!inflateText && !popText) return '';

  let context = `\n=== INFLATION DISPOSITION ===\n`;
  if (inflateText) context += `${inflateText}.\n`;
  if (popText) context += `${popText}.\n`;
  context += `These drives should subtly influence ${charName}'s dialogue, actions, and decisions.\n`;
  context += `=== END INFLATION DISPOSITION ===\n`;

  return context;
}

function getActiveCharacterCheckpoint(character) {
  if (!character?.isPumpable) return null;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const checkpoints = activeStory?.characterCheckpoints;
  if (!checkpoints) return null;

  const capacity = sessionState.characterCapacity || 0;
  const rangeKey = capacityRangeKey(capacity);
  const cp = normalizeCheckpoint(checkpoints[rangeKey]);
  const text = cp.mainTheme?.trim();
  return text || null;
}

// Roll the active range's checkpoint injections for THIS generation. Each injection
// rolls its % chance, capped by a per-session max-appearances (-1 = unlimited).
// Successful rolls add their text to sessionState.activeCheckpointInjections (read by
// the prompt builders) and fire their optional action. Called once per generation,
// alongside rollAttributes.
// Normalize a Message/Response slot to { text, llmEnhance }. Legacy plain strings -> enhanced.
function injMsg(slot, legacy) {
  if (slot && typeof slot === 'object') return { text: (slot.text || '').trim(), llmEnhance: slot.llmEnhance !== false };
  return { text: ((typeof slot === 'string' ? slot : legacy) || '').trim(), llmEnhance: true };
}

// (GC step 6) rollCheckpointInjections removed — dead since the sequential/random block model,
// now fully superseded by the Trigger Tree scopes (runReplyScopes). injMsg above is retained
// (still used by handleCheckpointChoice).

// Roll the active range's RANDOM trigger blocks (the sequential/random model that
// supersedes injections). Per-block % chance, capped by per-block repeats; the active
// Deliver an ai_message into THIS reply: enhanced -> woven via activeCheckpointInjections;
// verbatim (llmEnhance===false) -> appended to pendingVerbatimReply (replaces the reply).
// Shared by the checkpoint random-block roller and the Trigger Tree walker. PRODUCER ONLY:
// it appends/pushes and never resets activeCheckpointInjections (runReplyScopes is the sole
// per-turn resetter), so callers can compose multiple producers into one reply.
function deliverTreeMsg(text, llmEnhance) {
  const t = (text || '').trim();
  if (!t) return;
  if (llmEnhance !== false) sessionState.activeCheckpointInjections.push(t);
  else sessionState.pendingVerbatimReply = sessionState.pendingVerbatimReply ? `${sessionState.pendingVerbatimReply}\n${t}` : t;
}

// Evaluate ONE Trigger Tree condition against live state. Builds on the existing flow
// condition logic (event-engine evaluateConditions): SYSTEM vars read from sessionState,
// FLOW vars read from eventEngine.variables (the canonical map applySetVariable writes).
// The compare value (and string left sides) pass through eventEngine.substituteVariables so
// a branch can compare var-vs-var ([Flow:x]/[System:x] resolve). Pure read, never throws out.
// Cond = { varType:'system'|'flow', variable, operator, value }
function evalTreeCondition(cond) {
  if (!cond || !cond.operator) return false;
  const op = cond.operator;
  // 1. Left side
  let left;
  if (cond.varType === 'system') {
    switch (cond.variable) {
      case 'capacity': left = sessionState.capacity ?? 0; break;
      case 'pain': case 'feeling': left = sessionState.pain ?? 0; break;
      case 'emotion': left = sessionState.emotion ?? 'neutral'; break;
      case 'characterCapacity': left = sessionState.characterCapacity ?? 0; break;
      case 'device_state': {
        const id = cond.device || 'primary_pump';
        left = sessionState.executionHistory?.deviceActions?.[id]?.state || 'off';
        break;
      }
      default: left = sessionState[cond.variable];
    }
  } else {
    left = eventEngine.variables[cond.variable]; // 'flow' (custom) map
  }
  // 2. empty / notEmpty act on the resolved left, ignore the right
  const isEmpty = v => v === undefined || v === null || String(v).trim() === '';
  if (op === 'empty') return isEmpty(left);
  if (op === 'notEmpty') return !isEmpty(left);
  // 3. Resolve nested refs: string left + the compare value pass through substituteVariables
  const leftR = (typeof left === 'string') ? eventEngine.substituteVariables(left) : left;
  const rightR = eventEngine.substituteVariables(String(cond.value ?? ''));
  // 4. Numeric compare when BOTH sides parse numeric (mirrors evaluateCondition); else string
  const ln = parseFloat(leftR), rn = parseFloat(rightR);
  const bothNum = !isNaN(ln) && !isNaN(rn) && String(leftR).trim() !== '' && String(rightR).trim() !== '';
  switch (op) {
    case '==': return bothNum ? ln === rn : String(leftR) == String(rightR);
    case '!=': return bothNum ? ln !== rn : String(leftR) != String(rightR);
    case '>': return parseFloat(leftR) > parseFloat(rightR);
    case '<': return parseFloat(leftR) < parseFloat(rightR);
    case '>=': return parseFloat(leftR) >= parseFloat(rightR);
    case '<=': return parseFloat(leftR) <= parseFloat(rightR);
    case 'contains': return String(leftR ?? '').toLowerCase().includes(String(rightR ?? '').toLowerCase());
    default: return false;
  }
}

// Evaluate a Trigger Tree 'branch' (a child of an 'if'). else:true always passes (must be
// last). Otherwise AND/OR over its conditions (match:'all' default, 'any' = OR). A non-else
// branch with no conditions never passes. One bad condition fails its branch, not the walk.
function evalBranch(branch) {
  if (!branch) return false;
  if (branch.params?.else === true || branch.else === true) return true;
  const conds = branch.params?.conditions || [];
  if (!conds.length) return false;
  const match = branch.params?.match === 'any' ? 'any' : 'all';
  const test = c => { try { return evalTreeCondition(c); } catch (e) { console.error('[runTree] cond failed:', e?.message || e); return false; } };
  return match === 'any' ? conds.some(test) : conds.every(test);
}

// Resolve a character's scope tree-refs container ({ sessionStart?, alwaysOn?, ranges? }) —
// per active checkpoint PROFILE for instructors, per active STORY otherwise. Single source of
// truth mirroring how the legacy roller picks `ct` (getInstructorActiveProfile vs activeStory).
function resolveScopeRefs(character) {
  if (!character) return {};
  if (isInstructor(character)) return getInstructorActiveProfile(character)?.treeRefs || {};
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  return activeStory?.treeRefs || {};
}

// Per-turn index of the global tree library (id -> Tree). Built ONCE per turn in runReplyScopes
// and threaded via ctx so {treeId} scope refs and fire_tree hops resolve without re-reading disk.
function buildTreeIndex() {
  const m = new Map();
  for (const t of (loadTriggerTrees().trees || [])) m.set(t.id, t);
  return m;
}

// Resolve a scope ref to a runnable Tree: an inline tree (unchanged path) OR a library {treeId}
// lookup. Returns null (never throws) on missing/empty so the walker degrades to a skip.
function resolveRefTree(ref, treeIndex) {
  if (ref?.inline && Array.isArray(ref.inline.nodes) && ref.inline.nodes.length) return ref.inline;
  if (ref?.treeId) {
    const t = (treeIndex || buildTreeIndex()).get(ref.treeId);
    if (t && Array.isArray(t.nodes) && t.nodes.length) return t;
    console.warn(`[runTree] scope ref treeId '${ref.treeId}' not in library or empty — skipping`);
  }
  return null;
}

// Run the Always-On tree scope IN-REPLY every reply (recurring ambient guidance/triggers),
// composed after the range trees. Resolves inline OR {treeId} library refs.
async function runActiveAlwaysOn(character, settings, treeIndex) {
  const tree = resolveRefTree(resolveScopeRefs(character).alwaysOn, treeIndex);
  if (tree) await runTreeScope(tree, 'alwaysOn', character, settings, { delivery: 'inReply', treeIndex });
}

// Run the active Capacity-Range tree scope(s) IN-REPLY (woven/verbatim into this turn).
// Carry-over matches the legacy roll (nearest DEFINING range <= current capacity; a defining
// ref = an inline OR {treeId} ref resolving to a non-empty tree). Player axis always; char axis
// only for pumpable non-instructors.
async function runActiveRangeTrees(character, settings, treeIndex) {
  if (!character) return;
  const ORDER = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '100+'];
  const refs = resolveScopeRefs(character).ranges || {};

  const runAxis = async (prefix, capacity) => {
    const curIdx = ORDER.indexOf(capacityToRangeKey(capacity || 0));
    if (curIdx < 0) return;
    let tree = null, key = null;
    for (let i = curIdx; i >= 0; i--) {
      tree = resolveRefTree(refs[`${prefix}-${ORDER[i]}`], treeIndex);
      if (tree) { key = ORDER[i]; break; }
    }
    if (!tree) return;
    // scopeKey uses the carried-over DEFINING key (not raw capacity) so `once` nodes are
    // stable while in-band and only re-arm when the defining range changes.
    await runTreeScope(tree, `range:${prefix}:${key}`, character, settings, { delivery: 'inReply', treeIndex });
  };

  await runAxis('player', sessionState.capacity || 0);
  if (sessionState.pendingTreeChoice) return; // player_choice suspended — don't run the char axis
  if (!isInstructor(character) && character.isPumpable) await runAxis('char', sessionState.characterCapacity || 0);
}

// Single per-turn entry point for all IN-REPLY producers. Owns the ONE activeCheckpointInjections
// reset, then runs each producer in order so they COMPOSE into the same array: legacy random
// blocks, then the Capacity-Range tree scope, then the Always-On tree scope. The 5 gen-loop
// call sites await this, then flush any verbatim via deliverPendingVerbatimReply.
async function runReplyScopes(character) {
  sessionState.activeCheckpointInjections = [];
  if (!character) return;
  const settings = loadData(DATA_FILES.settings) || {};
  const treeIndex = buildTreeIndex(); // one library read per turn; threaded into every scope/fire_tree hop
  rollCheckpointRandomTriggers(character); // legacy producer (sync; no longer self-resets)
  try { await runActiveRangeTrees(character, settings, treeIndex); }
  catch (e) { console.error('[runReplyScopes] range trees failed:', e?.message || e); }
  if (sessionState.pendingTreeChoice) return; // a player_choice suspended the turn — stop further scopes
  try { await runActiveAlwaysOn(character, settings, treeIndex); }
  catch (e) { console.error('[runReplyScopes] always-on failed:', e?.message || e); }
}

// block-set carries over into higher ranges that define no blocks of their own.
// ai_message triggers weave into (or verbatim-replace) this reply via the same plumbing
// injections used; every other trigger fires through executeTrigger.
function rollCheckpointRandomTriggers(character) {
  // NOTE: does NOT reset activeCheckpointInjections — runReplyScopes owns the single per-turn
  // reset so this roller and the range-tree scope compose into one array. Pure co-producer.
  if (!character) return;
  const settings = loadData(DATA_FILES.settings) || {};
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const ct = isInstructor(character)
    ? (getInstructorActiveProfile(character)?.checkpointTriggers || {})
    : (activeStory?.checkpointTriggers || {});

  const triggerSets = loadData(DATA_FILES.triggerSets) || [];
  const budget = sessionState.randomBlockBudget || (sessionState.randomBlockBudget = {});
  const ORDER = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '100+'];

  const deliverMsg = deliverTreeMsg;
  const fireTrigger = (trg) => {
    if (!trg || !trg.type) return;
    if (trg.type === 'ai_message') {
      deliverMsg(trg.context, trg.llmEnhance);
    } else {
      Promise.resolve(executeTrigger(trg, 'random-block', character, settings))
        .catch(e => console.error('[RandomTriggers] trigger failed:', e?.message || e));
    }
  };

  // Roll one capacity axis (player or char). Per-block repeats persist per session (keyed by
  // block id); carry-over uses the nearest defining range <= current capacity for that axis.
  const rollAxis = (prefix, capacity) => {
    const curIdx = ORDER.indexOf(capacityToRangeKey(capacity || 0));
    let definingRange = null;
    for (let i = curIdx; i >= 0; i--) {
      if (normalizeRangeTriggers(ct[`${prefix}-${ORDER[i]}`]).random.length) { definingRange = ORDER[i]; break; }
    }
    if (!definingRange) return;
    for (const block of normalizeRangeTriggers(ct[`${prefix}-${definingRange}`]).random) {
      if (!block || !block.id) continue;
      const cap = (block.repeats === undefined || block.repeats === null || Number(block.repeats) < 0) ? Infinity : Number(block.repeats);
      if ((budget[block.id] || 0) >= cap) continue;
      const chance = Number(block.chance);
      if (!(chance > 0) || Math.random() * 100 >= chance) continue;
      budget[block.id] = (budget[block.id] || 0) + 1;
      if (block.mode === 'set') {
        const trgs = triggerSets.find(s => s.id === block.setId)?.triggers || [];
        if (trgs.length) fireTrigger(trgs[Math.floor(Math.random() * trgs.length)]);
      } else {
        for (const t of (block.triggers || [])) fireTrigger(t);
      }
    }
  };

  rollAxis('player', sessionState.capacity || 0);
  if (!isInstructor(character) && character.isPumpable) rollAxis('char', sessionState.characterCapacity || 0);
}

// Verbatim injection messages replace the whole reply: post them directly (no LLM) and
// signal callers to skip normal generation. Returns true if a reply was delivered.
async function deliverPendingVerbatimReply() {
  const text = sessionState.pendingVerbatimReply;
  if (!text) return false;
  sessionState.pendingVerbatimReply = null;
  await eventEngine.broadcast('ai_message', { content: text, suppressLlm: true });
  broadcast('generating_stop', {});
  return true;
}

// Render the rolled injections as a prompt block (empty when none rolled).
function checkpointInjectionsBlock() {
  const inj = sessionState.activeCheckpointInjections || [];
  if (!inj.length) return '';
  return `\n=== STAGE EVENTS (THIS MESSAGE) ===\nWeave the following into this reply naturally:\n${inj.map(t => `- ${t}`).join('\n')}\n=== END STAGE EVENTS ===\n`;
}

// (GC step 6) fireCheckpointInjectionAction + presentCheckpointChoice removed — dead with
// rollCheckpointInjections; player_choice is now handled by the Trigger Tree walker.

// Resume a suspended Trigger Tree player_choice on the player's pick. Runs the chosen option's
// body, then the post-choice same-level continuation (`after`) captured at suspend time — both
// in 'standalone' delivery (post immediately, like the legacy choice response). Clears the armed
// state FIRST so a nested player_choice in the body can re-arm cleanly and a double-click can't
// double-fire. Same entry the real WS click takes (via handleCheckpointChoice dispatch).
async function resumeTreeChoice(choiceId) {
  const pend = sessionState.pendingTreeChoice;
  if (!pend) return;
  const chosen = (pend.choices || []).find(c => c.id === choiceId);
  const after = pend.after, snap = pend.ctxSnapshot || {};
  sessionState.pendingTreeChoice = null;
  broadcast('checkpoint_choice_clear', {});
  if (!chosen) return; // stale/invalid pick — already dismissed

  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === settings?.activeCharacterId) || null;
  const ctx = {
    character, settings,
    treeId: snap.treeId, scopeKey: snap.scopeKey,
    depth: snap.childDepth || 0,
    delivery: snap.delivery || 'standalone',
    source: snap.source || `tree:${snap.treeId}`,
    visited: new Set(snap.visited || [snap.treeId]),
    firedSet: sessionState.firedTreeNodes, // live Set, never serialized
    labels: new Map()
  };
  let sig;
  try { sig = await runTree(chosen.body || [], ctx); }
  catch (e) { console.error('[resumeTreeChoice] body failed:', e?.message || e); }
  if (sig) return; // body re-armed a nested choice (or a goto bubbled out) — stop here
  if (Array.isArray(after) && after.length) {
    try { await runTree(after, ctx); } // post-choice fall-through at the choice's own level
    catch (e) { console.error('[resumeTreeChoice] continuation failed:', e?.message || e); }
  }
}

// Resolve a checkpoint player-choice pick: fire the choice's pump action and queue its
// response to be injected on the NEXT generation. Pre-req sequences are routed first.
async function handleCheckpointChoice(choiceId) {
  if (sessionState.pendingPrereqs) return handlePrereqChoice(choiceId);
  if (sessionState.pendingTreeChoice) return resumeTreeChoice(choiceId); // Trigger Tree player_choice resume
  const pending = sessionState.pendingCheckpointChoice;
  if (!pending) return;
  const choice = (pending.choices || []).find(c => c.id === choiceId);
  sessionState.pendingCheckpointChoice = null;
  sessionState.pendingTreeChoice = null;
  broadcast('checkpoint_choice_clear', {});
  if (!choice) return;
  if (choice.action?.type === 'pump') {
    await firePrimaryPump(choice.action).catch(err => console.error('[Checkpoint] choice pump failed:', err?.message || err));
  }
  if (choice.setVar?.variable) {
    eventEngine.applySetVariable(choice.setVar.varType || 'custom', choice.setVar.variable, choice.setVar.operation || 'set', choice.setVar.value);
  }
  // Choice response fires immediately as a reply (verbatim or LLM-enhanced), not next turn.
  const resp = injMsg(choice.response);
  if (resp.text) {
    await eventEngine.broadcast('ai_message', { content: resp.text, suppressLlm: resp.llmEnhance === false });
  }
}

// ===== Instructor pre-req sequence =====
// Ordered, mandatory player-choice steps shown before inflation. Each choice may set
// a variable and/or load a checkpoint profile. The inflation gate stays closed until done.
// Seed Flow/system variables for an instructor at session start. These run once,
// before any pre-req questions, so prereq choices and checkpoint injections can read
// them via the shared [Flow:Name]/[System:Name] format.
function applyInstructorInitVars(character) {
  if (!isInstructor(character)) return;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const initVars = Array.isArray(activeStory?.prereqInitVars) ? activeStory.prereqInitVars : [];
  for (const v of initVars) {
    if (!v || !v.variable) continue;
    eventEngine.applySetVariable(v.varType || 'custom', v.variable, v.operation || 'set', v.value);
  }
  if (initVars.length) console.log(`[Instructor] Seeded ${initVars.length} session-start variable(s)`);
}

// ===== Pre-Fill: card-level gated intro phase (no pumping until a trigger exits it) =====
function getPreFillConfig(character) {
  const story = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const pf = story?.preFill;
  if (!pf || !pf.enabled) return null;
  const steps = Array.isArray(pf.steps) ? pf.steps.filter(s => s && s.id) : [];
  return steps.length ? { steps } : null;
}

// Enter pre-fill at session start (all card types). Closes the inflation gate.
function startPreFill(character) {
  const pf = getPreFillConfig(character);
  if (!pf) { sessionState.preFillActive = false; sessionState.preFillStepId = null; return false; }
  sessionState.preFillActive = true;
  sessionState.preFillStepId = pf.steps[0].id;
  sessionState.preFillNote = null;
  sessionState.preInflationGateMet = false; // strict: no pumping during pre-fill
  console.log(`[PreFill] Started (${pf.steps.length} step(s)) — gate closed`);
  return true;
}

function getPreFillStep(character) {
  if (!sessionState.preFillActive) return null;
  const pf = getPreFillConfig(character);
  if (!pf) return null;
  return pf.steps.find(s => s.id === sessionState.preFillStepId) || pf.steps[0];
}

// Hard directive + current-step instruction injected every turn while in pre-fill.
function preFillBlock(character) {
  const step = getPreFillStep(character);
  if (!step) return '';
  const instr = injMsg(step.instruction);
  let s = `\n=== PRE-FILL PHASE (MANDATORY — NO PUMPING) ===\n`;
  s += `Inflation has NOT started. Do NOT pump, do NOT instruct the player to pump, never use [pump on]. There is zero pumping in this phase.\n`;
  if (instr.text) s += `Current goal: ${substituteAllVariables(instr.text)}\n`;
  s += `Converse naturally toward that goal. This phase only advances when the player says the required phrase — never advance it yourself.\n`;
  if (sessionState.preFillNote) {
    s += `A transition just happened — work this into your reply: ${substituteAllVariables(sessionState.preFillNote)}\n`;
  }
  s += `=== END PRE-FILL PHASE ===\n`;
  return s;
}

// Scan a player message against the current step's triggers; advance/branch/exit on first match.
function scanPreFill(character, playerText) {
  if (!sessionState.preFillActive || !playerText) return;
  const step = getPreFillStep(character);
  if (!step) return;
  const text = String(playerText).toLowerCase();
  sessionState.preFillNote = null;
  for (const trig of (step.triggers || [])) {
    const words = String(trig.words || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    if (!words.length) continue;
    if (!words.some(w => text.includes(w))) continue;
    // First match wins.
    if (trig.setVar?.variable) {
      eventEngine.applySetVariable(trig.setVar.varType || 'custom', trig.setVar.variable, trig.setVar.operation || 'set', trig.setVar.value);
    }
    const resp = injMsg(trig.response);
    if (resp.text) sessionState.preFillNote = resp.text;
    if (trig.exit) {
      sessionState.preFillActive = false;
      sessionState.preFillStepId = null;
      sessionState.preInflationGateMet = true;
      if (isInstructor(character) && trig.loadProfileId) sessionState.activeCheckpointProfileId = trig.loadProfileId;
      applyActivePumpType(character);
      broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: true });
      console.log(`[PreFill] Exit → pump phase${trig.loadProfileId ? ` (profile ${trig.loadProfileId})` : ''}`);
    } else if (trig.goto) {
      sessionState.preFillStepId = trig.goto;
      console.log(`[PreFill] Advance → step ${trig.goto}`);
    }
    return;
  }
}

function startInstructorPrereqs(character) {
  if (!isInstructor(character)) return false;
  if (sessionState.pendingPrereqs || sessionState.prereqsDone) return false;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const steps = (Array.isArray(activeStory?.prereqs) ? activeStory.prereqs : [])
    .filter(s => s && Array.isArray(s.choices) && s.choices.some(c => c && c.label));
  // Set the default active profile regardless
  sessionState.activeCheckpointProfileId = activeStory?.defaultCheckpointProfileId || sessionState.activeCheckpointProfileId || null;
  if (!steps.length) return false;
  sessionState.pendingPrereqs = { steps, index: 0 };
  sessionState.preInflationGateMet = false;
  presentPrereqStep();
  return true;
}

function presentPrereqStep() {
  const p = sessionState.pendingPrereqs;
  if (!p || p.index >= p.steps.length) { finishPrereqs(); return; }
  const step = p.steps[p.index];
  const choices = (step.choices || []).filter(c => c && c.label).map(c => ({ id: c.id, label: c.label }));
  broadcast('checkpoint_choice', { description: step.prompt || '', choices, prereq: true });
}

function finishPrereqs() {
  sessionState.pendingPrereqs = null;
  sessionState.prereqsDone = true;
  sessionState.preInflationGateMet = true;
  broadcast('checkpoint_choice_clear', {});
  broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: true });
}

async function handlePrereqChoice(choiceId) {
  const p = sessionState.pendingPrereqs;
  if (!p) return;
  const step = p.steps[p.index];
  const choice = (step?.choices || []).find(c => c.id === choiceId);
  if (choice) {
    if (choice.setVar?.variable) {
      eventEngine.applySetVariable('custom', choice.setVar.variable, choice.setVar.operation, choice.setVar.value);
    }
    if (choice.loadProfileId) {
      sessionState.activeCheckpointProfileId = choice.loadProfileId;
      // Changing the active profile may flip the pump mode (auto/electric <-> manual/bulb/bike).
      const s = loadData(DATA_FILES.settings) || {};
      const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const ch = chars.find(c => c.id === s.activeCharacterId);
      if (ch) applyActivePumpType(ch);
    }
    // Optional pump run when an automatic profile is loaded (timed or cycle).
    if (choice.pump) {
      await firePrimaryPump({ mode: choice.pump.mode, duration: choice.pump.duration, cycles: choice.pump.cycles })
        .catch(err => console.error('[Prereq] pump action failed:', err?.message || err));
    }
    // Per-choice instructor response (verbatim or LLM-enhanced), fired immediately.
    const resp = injMsg(choice.response);
    if (resp.text) {
      await eventEngine.broadcast('ai_message', { content: resp.text, suppressLlm: resp.llmEnhance === false });
    }
  }
  p.index++;
  if (p.index >= p.steps.length) finishPrereqs();
  else presentPrereqStep();
}

/**
 * Get active persona checkpoint for player's own inflation
 */
function getPersonaCheckpoint(persona, capacity) {
  const checkpoints = persona?.checkpoints;
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

  return checkpoints[rangeKey]?.trim() || null;
}

/**
 * Get active persona checkpoint for reacting to character's inflation
 */
function getPersonaCharacterCheckpoint(persona) {
  const checkpoints = persona?.characterCheckpoints;
  if (!checkpoints) return null;

  const capacity = sessionState.characterCapacity || 0;
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

  return checkpoints[rangeKey]?.trim() || null;
}

// Normalize a checkpoint value: a legacy plain string becomes { mainTheme, injections: [] }.
function normalizeCheckpoint(val) {
  if (!val) return { mainTheme: '', injections: [] };
  if (typeof val === 'string') return { mainTheme: val, injections: [] };
  return {
    mainTheme: val.mainTheme || '',
    injections: Array.isArray(val.injections) ? val.injections : [],
    // Manual-pump pacing (bulb/bike instructor ranges) — carried through for the prompt.
    maxPumpsPerBatch: val.maxPumpsPerBatch,
    messagesBetweenBatches: val.messagesBetweenBatches,
    // Auto-pump pacing (electric instructor ranges) — system-driven [pump on] cadence.
    maxPumpOnSecs: val.maxPumpOnSecs,
    messagesBetweenOn: val.messagesBetweenOn,
  };
}

// Map a capacity to its checkpoint range key.
function capacityRangeKey(capacity) {
  if (capacity <= 10) return '1-10'; // first range now starts at 0% (no separate pre-inflation gate)
  if (capacity <= 20) return '11-20';
  if (capacity <= 30) return '21-30';
  if (capacity <= 40) return '31-40';
  if (capacity <= 50) return '41-50';
  if (capacity <= 60) return '51-60';
  if (capacity <= 70) return '61-70';
  if (capacity <= 80) return '71-80';
  if (capacity <= 90) return '81-90';
  if (capacity <= 100) return '91-100';
  return '100+';
}

// Resolve the active checkpoint-profile ranges for an instructor (1-100% sets live
// in named profiles selected at runtime). Returns null for non-instructors.
// Migration: if no profiles exist, synthesize a "Default" from legacy checkpoints.
function getInstructorActiveProfileRanges(character) {
  if (!isInstructor(character)) return null;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  if (!activeStory) return null;
  let profiles = Array.isArray(activeStory.checkpointProfiles) ? activeStory.checkpointProfiles : [];
  if (!profiles.length) {
    const ranges = {};
    const cps = activeStory.checkpoints || {};
    for (const k of Object.keys(cps)) { if (k !== '0') ranges[k] = cps[k]; }
    profiles = [{ id: 'default', name: 'Default', ranges }];
  }
  const activeId = sessionState.activeCheckpointProfileId || activeStory.defaultCheckpointProfileId || profiles[0].id;
  const prof = profiles.find(p => p.id === activeId) || profiles[0];
  return prof?.ranges || {};
}

// Resolve the currently-active instructor checkpoint profile object (for its rules,
// pumpType, name). Returns null for non-instructors / when no profiles exist.
function getInstructorActiveProfile(character) {
  if (!isInstructor(character)) return null;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const profiles = Array.isArray(activeStory?.checkpointProfiles) ? activeStory.checkpointProfiles : [];
  if (!profiles.length) return null;
  const activeId = sessionState.activeCheckpointProfileId || activeStory?.defaultCheckpointProfileId || profiles[0].id;
  return profiles.find(p => p.id === activeId) || profiles[0];
}

// Set the session pump mode (type + derived init) from the active instructor checkpoint
// profile, falling back to the card default. electric => auto/E-STOP, bulb/bike => manual/PUMP.
function applyActivePumpType(character) {
  let pumpType = character?.defaultPumpType || 'electric';
  if (isInstructor(character)) {
    const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
    const profiles = Array.isArray(activeStory?.checkpointProfiles) ? activeStory.checkpointProfiles : [];
    const activeId = sessionState.activeCheckpointProfileId || activeStory?.defaultCheckpointProfileId;
    const prof = profiles.find(p => p.id === activeId);
    if (prof?.pumpType) pumpType = prof.pumpType;
  }
  if (!['electric', 'bulb', 'bike'].includes(pumpType)) pumpType = 'electric';
  sessionState.pumpType = pumpType;
  sessionState.pumpInit = pumpType === 'electric' ? 'auto' : 'manual';
  broadcast('pump_mode_update', { pumpType: sessionState.pumpType, pumpInit: sessionState.pumpInit });
}

// A manual pump press (bulb/bike): bump the count, add the per-pump capacity %, and record
// context for the next instructor reply. Electric/auto pumps are device-driven, not counted here.
async function handleManualPump() {
  if (sessionState.preFillActive) { console.log('[ManualPump] Blocked — pre-fill phase (no pumping)'); return; }
  const type = sessionState.pumpType;
  if (type !== 'bulb' && type !== 'bike') return;
  const sv = (loadData(DATA_FILES.settings) || {}).systemVariables || {};
  const max = type === 'bulb' ? Number(sv.BulbMax) : Number(sv.BikeMax);
  const perPump = max > 0 ? 100 / max : 0;
  if (type === 'bulb') sessionState.bulbCurrent = (sessionState.bulbCurrent || 0) + 1;
  else sessionState.bikeCurrent = (sessionState.bikeCurrent || 0) + 1;
  const before = sessionState.capacity || 0;
  sessionState.capacity = Math.max(0, Math.min(100, before + perPump));
  if (!sessionState.preInflationGateMet && sessionState.capacity > 0) sessionState.preInflationGateMet = true;
  const added = Math.round((sessionState.capacity - before) * 100) / 100;
  const cap = Math.round(sessionState.capacity);
  const count = type === 'bulb' ? sessionState.bulbCurrent : sessionState.bikeCurrent;
  sessionState.repliesSinceManualPump = 0; // player pumped → start the between-batch cooldown
  sessionState.pendingPumpContext = sessionState.pendingPumpContext || [];
  sessionState.pendingPumpContext.push(`Player operated the ${type} pump (pump #${count}); added ${added}% — capacity is now ${cap}%.`);
  broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: sessionState.preInflationGateMet });
  broadcast('pump_vars_update', { bulbCurrent: sessionState.bulbCurrent, bikeCurrent: sessionState.bikeCurrent });
  // Fire checkpoint triggers if this press crossed into a new capacity range (mirrors the
  // auto-capacity path so manual pumping reaches checkpoints just like electric does).
  await executeCheckpointTriggers('player', before, sessionState.capacity)
    .catch(err => console.error('[ManualPump] checkpoint triggers failed:', err?.message || err));
  await executePersonaCheckpointTriggers('player', before, sessionState.capacity)
    .catch(err => console.error('[ManualPump] persona checkpoint triggers failed:', err?.message || err));
  autosaveSession();
}

function getActiveCheckpoint(character, capacity) {
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  // Instructors: 1-100% ranges come from the active checkpoint profile; the 0
  // range (pre-inflation) is handled by the pre-req sequence, not text.
  const isInstr = isInstructor(character);
  const checkpoints = isInstr ? getInstructorActiveProfileRanges(character) : activeStory?.checkpoints;
  if (!checkpoints) return null;

  const rangeKey = capacityRangeKey(capacity);
  let cp = normalizeCheckpoint(checkpoints[rangeKey]);
  // Fold the legacy 0% range into the new first range (0–10%) at read time so existing
  // pre-inflation guidance isn't lost now that the separate 0% gate is removed. Only used
  // as a fallback when the first range is empty — never duplicates.
  if (rangeKey === '1-10' && checkpoints['0']) {
    const zero = normalizeCheckpoint(checkpoints['0']);
    if (!cp.mainTheme && zero.mainTheme) cp = { ...cp, mainTheme: zero.mainTheme };
    if ((!cp.injections || !cp.injections.length) && zero.injections?.length) cp = { ...cp, injections: zero.injections };
  }
  const text = cp.mainTheme?.trim();
  // The separate 0% pre-inflation gate is gone — the first range starts at 0%, and gating
  // is handled by Pre-Fill. preInflation is retained as always-null for caller compatibility.
  return {
    text: text || null,
    preInflation: null,
    injections: cp.injections,
    maxPumpsPerBatch: cp.maxPumpsPerBatch,
    messagesBetweenBatches: cp.messagesBetweenBatches,
    maxPumpOnSecs: cp.maxPumpOnSecs,
    messagesBetweenOn: cp.messagesBetweenOn,
    rangeKey
  };
}

// Manual-pump pacing directive for the active range (bulb/bike instructors only).
// Tells the LLM how many pump operations it may request per batch and how long to
// wait between batches. Returns '' for electric/auto pumps or when no limits are set.
function manualPumpBatchBlock(cp) {
  if (!cp) return '';
  if (sessionState.pumpType !== 'bulb' && sessionState.pumpType !== 'bike') return '';
  const maxPumps = parseInt(cp.maxPumpsPerBatch);
  const gap = parseInt(cp.messagesBetweenBatches);
  if (!(maxPumps > 0) && !(gap > 0)) return '';
  // Stateful: the server tracks replies since the player last pumped, so we hand the
  // model a concrete "may pump / cooldown" state instead of asking it to count turns
  // (which LLMs can't do reliably).
  const since = sessionState.repliesSinceManualPump ?? 999;
  const cooling = gap > 0 && since < gap;
  let s = `\n=== MANUAL PUMP PACING (${sessionState.capacity}%) ===\n`;
  if (cooling) {
    const left = gap - since;
    s += `- COOLDOWN: the player pumped recently. Do NOT instruct ANY pumping for the next ${left} repl${left === 1 ? 'y' : 'ies'}. Give other guidance, check-ins, or corrections instead.\n`;
  } else {
    if (maxPumps > 0) {
      s += `- You MAY instruct the player to operate the ${sessionState.pumpType} pump now.\n`;
      s += `- HARD LIMIT: ask for at most ${maxPumps} pump${maxPumps === 1 ? '' : 's'} in this instruction. Do NOT exceed ${maxPumps}, and do NOT imply continuous/unlimited pumping.\n`;
    } else {
      s += `- You may instruct the player to operate the ${sessionState.pumpType} pump now.\n`;
    }
    if (gap > 0) s += `- After they pump, you must NOT instruct pumping again for ${gap} repl${gap === 1 ? 'y' : 'ies'}.\n`;
  }
  s += `=== END MANUAL PUMP PACING ===\n`;
  return s;
}

/**
 * Get chat memory settings with defaults
 */
function getChatMemorySettings(settings) {
  const mem = settings?.chatMemory || {};
  return {
    chatHistoryDepth: mem.chatHistoryDepth || 20,
    impersonateHistoryDepth: mem.impersonateHistoryDepth || 15,
    reminderScanDepth: mem.reminderScanDepth || 20,
    summarizationEnabled: mem.summarizationEnabled ?? true
  };
}

/**
 * Summarize older chat messages that have fallen outside the context window.
 * Merges any existing summary with newly overflowed messages to produce a rolling summary.
 * Called before building context when there are messages beyond the window.
 */
async function summarizeOverflowMessages(settings) {
  const memSettings = getChatMemorySettings(settings);
  if (!memSettings.summarizationEnabled) return;

  const depth = memSettings.chatHistoryDepth;
  const totalMessages = sessionState.chatHistory.length;

  // Nothing to summarize if history fits in the window
  if (totalMessages <= depth) return;

  // The overflow boundary: messages before this index are outside the context window
  const overflowEnd = totalMessages - depth;

  // Already summarized up to this point
  if (sessionState.chatMemorySummaryUpTo >= overflowEnd) return;

  // Collect messages that need summarizing (between last summary point and current overflow boundary)
  const newOverflow = sessionState.chatHistory.slice(sessionState.chatMemorySummaryUpTo, overflowEnd);
  if (newOverflow.length === 0) return;

  // Check if LLM is available
  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');
  if (!hasLlmConfig) return;

  // Format the new messages for summarization
  const playerName = sessionState.playerName || 'Player';
  const charName = sessionState.characterName || 'Character';
  let messageBlock = '';
  newOverflow.forEach(msg => {
    if (msg.excludeFromContext || msg.sender === 'system') return;
    const speaker = msg.sender === 'player' ? playerName : (msg.characterName || charName);
    messageBlock += `${speaker}: ${msg.content}\n`;
  });

  // Build the summarization prompt
  const existingSummary = sessionState.chatMemorySummary;
  let summaryPrompt;
  if (existingSummary) {
    summaryPrompt = `You are a summarization assistant. Below is an existing summary of earlier conversation, followed by new messages that continue the story. Produce an updated summary that incorporates both.

EXISTING SUMMARY:
${existingSummary}

NEW MESSAGES:
${messageBlock}

Write a concise summary (3-8 sentences) that captures:
- Key events, actions, and emotional beats
- Current physical state and scenario progression
- Important details that would affect future conversation
- Who did what to whom

Write ONLY the summary, no preamble or labels.`;
  } else {
    summaryPrompt = `You are a summarization assistant. Summarize the following roleplay conversation messages.

MESSAGES:
${messageBlock}

Write a concise summary (3-8 sentences) that captures:
- Key events, actions, and emotional beats
- Current physical state and scenario progression
- Important details that would affect future conversation
- Who did what to whom

Write ONLY the summary, no preamble or labels.`;
  }

  try {
    console.log(`[ChatMemory] Summarizing ${newOverflow.length} overflow messages (${sessionState.chatMemorySummaryUpTo} → ${overflowEnd})`);
    const summarySettings = { ...settings.llm };
    summarySettings.maxTokens = 300;
    // Don't stream summaries
    summarySettings.streaming = false;

    const result = await llmService.generate({
      prompt: summaryPrompt,
      systemPrompt: 'You are a concise summarizer. Output only the summary text.',
      settings: summarySettings
    });

    if (result.text && result.text.trim()) {
      sessionState.chatMemorySummary = result.text.trim();
      sessionState.chatMemorySummaryUpTo = overflowEnd;
      console.log(`[ChatMemory] Summary updated (covers ${overflowEnd} messages): ${sessionState.chatMemorySummary.substring(0, 100)}...`);
      autosaveSession();
    }
  } catch (error) {
    console.error('[ChatMemory] Summarization failed:', error.message);
    // Non-fatal — we just won't have a summary this round
  }
}

/**
 * Build chat history in BOTH representations from one loop:
 *  - flat: "Name: text\n" lines for text-completion `prompt`
 *  - messages: [{role:'user'|'assistant', content:'Name: text'}] for chat-completion
 * The author note (globalPrompt) is injected at `authorNoteDepth` from the end
 * (SillyTavern-style) in both representations. depth>=length => top of transcript.
 *
 * @param {Array}  recentMessages - already sliced/ordered oldest->newest
 * @param {Object} opts
 * @param {string} opts.playerName     - real persona/player display name
 * @param {string} opts.characterName  - real character name
 * @param {boolean} opts.isPlayerVoice - true when generating AS the player (impersonate)
 * @param {string} [opts.authorNote]   - globalPrompt text (undefined/empty => no note)
 * @param {number} [opts.authorNoteDepth=4]
 * @returns {{ flat: string, messages: Array<{role,content}> }}
 */
function buildHistoryRepresentations(recentMessages, opts) {
  const {
    playerName,
    characterName,
    isPlayerVoice = false,
    authorNote,
    authorNoteDepth = 4,
  } = opts;

  // Filter to displayable turns, preserving order.
  const turns = recentMessages.filter(
    m => !m.excludeFromContext && m.sender !== 'system'
  );

  // Author note line (rendered identically in flat + messages as a system-style note).
  const noteText = authorNote ? `[Author's Note: ${authorNote}]` : null;

  // Insertion index measured from the end. depth 0 => after last turn (handled at primer,
  // NOT here). For history injection we clamp 1..length; depth>=length => index 0 (top).
  let insertIdx = -1;
  if (noteText) {
    insertIdx = Math.max(0, turns.length - Math.max(1, authorNoteDepth));
  }

  let flat = '';
  const messages = [];

  const flushNote = () => {
    if (!noteText) return;
    flat += `${noteText}\n`;
    // In chat-completion, an author note rides as a user-role context line.
    messages.push({ role: 'user', content: noteText });
  };

  turns.forEach((msg, i) => {
    if (noteText && i === insertIdx) flushNote();

    const isPlayerTurn = msg.sender === 'player';
    const name = isPlayerTurn ? playerName : characterName;
    const line = `${name}: ${msg.content}`;
    flat += `${line}\n`;

    // Role is relative to who we are generating AS:
    //  - character voice: player turns => user, character turns => assistant
    //  - player voice  : player turns => assistant, character turns => user
    let role;
    if (isPlayerVoice) {
      role = isPlayerTurn ? 'assistant' : 'user';
    } else {
      role = isPlayerTurn ? 'user' : 'assistant';
    }
    messages.push({ role, content: line });
  });

  // Note depth >= length (or empty transcript) => top of transcript.
  if (noteText && (insertIdx >= turns.length || turns.length === 0)) {
    // prepend
    flat = `${noteText}\n` + flat;
    messages.unshift({ role: 'user', content: noteText });
  }

  return { flat, messages };
}

function buildSpecialContext(mode, guidedText, character, persona, settings) {
  let systemPrompt = '';
  let prompt = '';

  const playerName = persona?.displayName || 'The player';

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

    let instructions = `\nBELLY STATE: ${subject} belly ${verb} at EXACTLY ${capacity}%: ${bellyDesc}. Pain: ${painLabel} (${painLevel}/10).\n`;

    if (capacity <= 5) {
      instructions += `INFLATION HAS BARELY BEGUN. ${subject} belly looks completely normal. You may only mention: a faint warmth, a subtle awareness of the tube, or nothing at all. Focus on conversation, emotions, and the situation — not physical sensations. The story is just starting.\n`;
    } else if (capacity <= 15) {
      instructions += `EARLY STAGE. ${subject} belly is still flat-looking. You may only describe: a gentle internal warmth, a slight feeling of fullness like after a snack, or mild curiosity about the sensation. Keep physical descriptions minimal — one brief mention at most. Focus on dialogue and interaction.\n`;
    } else if (capacity <= 30) {
      instructions += `MILD INFLATION. You may describe: subtle bloating, a feeling of gentle pressure, clothes fitting slightly different. Keep it understated — this is still early. One or two brief physical references per response, then focus on the scene.\n`;
    } else if (capacity <= 50) {
      instructions += `MODERATE INFLATION. You may describe: visible roundness, noticeable tightness, pressure building, clothes straining. Physical sensations are present but manageable. Balance physical description with dialogue and character interaction.\n`;
    } else if (capacity <= 70) {
      instructions += `SIGNIFICANT INFLATION. You may describe: prominent swelling, taut skin, difficulty moving comfortably, labored breathing. Physical sensations are hard to ignore. Reactions should match the intensity.\n`;
    } else if (capacity <= 85) {
      instructions += `HEAVY INFLATION. Describe: drum-tight skin, extreme pressure, every movement causing discomfort, genuine strain. The body is at serious capacity.\n`;
    } else {
      instructions += `CRITICAL/MAX INFLATION. Describe: impossibly full, skin creaking, at the absolute limit. This is the climax.\n`;
    }

    instructions += `Write ${capacity}% if referencing a number. The belly state is a snapshot — describe it as-is, not changing in real time.\n`;

    return instructions;
  };

  if (mode === 'impersonate' || mode === 'guided_impersonate') {
    // Generate as the player
    systemPrompt = `You are ${playerName}, the player character. Write ONLY as ${playerName} — never write for ${character.name}.\n\n`;
    if (persona) {
      if (persona.personality) systemPrompt += `Personality: ${persona.personality}\n`;
      if (persona.appearance) systemPrompt += `Appearance: ${persona.appearance}\n`;
      if (persona.relationshipWithInflation) systemPrompt += `Additional inflation context: ${persona.relationshipWithInflation}\n`;
      systemPrompt += buildPersonaInflationContext(persona, playerName);
      systemPrompt += '\n';
    }

    // Keep the character card text exactly as written; frame it as context about the
    // OTHER party so the model never adopts the character's voice.
    systemPrompt += `You are ${playerName}. ${character.name} is the one you are interacting with; `;
    systemPrompt += `their description follows for context (do NOT write as ${character.name}):\n`;
    systemPrompt += `${substituteVars(character.description)}\n`;
    const scenario = getActiveScenario(character);
    if (scenario) systemPrompt += `Scenario: ${substituteVars(scenario)}\n`;
    systemPrompt += '\n';

    // Add active reminders (using reminder engine for keyword-based activation)
    const recentMessagesImp = reminderEngine.extractRecentMessages(sessionState.chatHistory, getChatMemorySettings(settings).reminderScanDepth);
    const activeRemindersImp = reminderEngine.getMergedActiveReminders(
      character.constantReminders || [],
      settings.globalReminders || [],
      recentMessagesImp
    );
    if (activeRemindersImp.length > 0) {
      systemPrompt += reminderEngine.buildReminderPrompt(activeRemindersImp, 'Active Reminders');
    }

    systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerName, true);
    systemPrompt += buildCharacterInflationContext(character);

    systemPrompt += `You emotionally feel ${sessionState.emotion}.\n\n`;

    // Author note is injected into the chat history at configurable depth (see below).

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
    systemPrompt += buildCharacterInflationContext(character);

    systemPrompt += `${playerName} emotionally feels ${sessionState.emotion}.\n\n`;

    // Add active reminders (using reminder engine for keyword-based activation)
    const recentMessagesGuided = reminderEngine.extractRecentMessages(sessionState.chatHistory, getChatMemorySettings(settings).reminderScanDepth);
    const activeRemindersGuided = reminderEngine.getMergedActiveReminders(
      character.constantReminders || [],
      settings.globalReminders || [],
      recentMessagesGuided
    );
    if (activeRemindersGuided.length > 0) {
      systemPrompt += reminderEngine.buildReminderPrompt(activeRemindersGuided, 'Active Reminders');
    }

    // Author note is injected into the chat history at configurable depth (see below).

    // Add LLM device control instructions if enabled
    if (settings?.globalCharacterControls?.allowLlmDeviceControl) {
      const globalMax = settings.globalCharacterControls.llmDeviceControlMaxSeconds || 30;
      const charLimits = getCharacterLimits(character);
      const capacityMod = settings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
      const scaledMaxOn = Math.round((charLimits?.llmMaxOnDuration ?? 5) * capacityMod);
      const maxSeconds = charLimits ? Math.min(globalMax, scaledMaxOn) : globalMax;
      let devicePrompt = `\nDEVICE CONTROL — REQUIRED: You operate a REAL physical device through hidden tags. If your reply narrates the pump starting, running, or continuing but you do NOT include the tag, the pump does NOT move — so you MUST emit the tag in the SAME reply.
Tags: [pump on]/[pump off], [vibe on]/[vibe off], [tens on]/[tens off]
- Emit [pump on] the instant you describe starting/running the pump; place the tag right after the action.
- The pump auto-stops after ${maxSeconds}s — re-emit [pump on] every reply you want it to keep running.
- Emit [pump off] when you narrate stopping. Tags are hidden from the player.
Example: "*flips the switch* [pump on] Let's begin..."`;
      if (charLimits) {
        const scaledMaxTimed = Math.round((charLimits.llmMaxTimedDuration ?? 10) * capacityMod);
        const scaledMaxCycleOn = Math.round((charLimits.llmMaxCycleOnDuration ?? 2) * capacityMod);
        devicePrompt += `\nLimits: max ON ${scaledMaxOn}s, max pulse ${charLimits.llmMaxPulseRepetitions ?? 5}x, max timed ${scaledMaxTimed}s, max cycle ON ${scaledMaxCycleOn}s x${charLimits.llmMaxCycleRepetitions ?? 2}`;
      }
      systemPrompt += devicePrompt + '\n';
    }

    // Inject personality attributes if rolled (character voice only, for guided response)
    if (mode !== 'impersonate' && mode !== 'guided_impersonate') {
      if (sessionState.activeAttributes?.length > 0) {
        systemPrompt += buildAttributeBlock(sessionState.activeAttributes);
      }
      systemPrompt += buildInflationDispositionContext(character);
    }

    // Inject persona attributes for impersonate mode
    if ((mode === 'impersonate' || mode === 'guided_impersonate') && persona) {
      const personaAttrResult = rollPersonaAttributes(persona);
      if (personaAttrResult.active.length > 0) {
        systemPrompt += buildPersonaAttributeBlock(personaAttrResult.active);
      }
      systemPrompt += buildPersonaDispositionContext(persona, playerName);
    }

    // Inject checkpoints at end (recency = higher LLM priority)
    const checkpointSpecial = getActiveCheckpoint(character, sessionState.capacity);
    if (checkpointSpecial?.preInflation) {
      systemPrompt += `\n=== MANDATORY PRE-INFLATION REQUIREMENT ===\n${checkpointSpecial.preInflation}\n=== END REQUIREMENT ===\n`;
    }
    if (checkpointSpecial?.text) {
      systemPrompt += `\n=== MANDATORY — INFLATION STAGE DIRECTION (${sessionState.capacity}%) ===\nYou MUST follow this guidance. Do NOT describe inflation beyond what ${sessionState.capacity}% represents:\n${checkpointSpecial.text}\n=== END STAGE DIRECTION ===\n`;
    }
    systemPrompt += manualPumpBatchBlock(checkpointSpecial);
    systemPrompt += checkpointInjectionsBlock();
    systemPrompt += preFillBlock(character);
    const charCheckpointSpecial = getActiveCharacterCheckpoint(character);
    if (charCheckpointSpecial) {
      systemPrompt += `\n=== MANDATORY — ${character.name.toUpperCase()}'S STAGE DIRECTION (${sessionState.characterCapacity}%) ===\nYou MUST follow this. Do NOT describe ${character.name}'s inflation beyond what ${sessionState.characterCapacity}% represents:\n${charCheckpointSpecial}\n=== END STAGE DIRECTION ===\n`;
    }

    // Inject persona checkpoints for impersonate mode
    const isPlayerVoice = (mode === 'impersonate' || mode === 'guided_impersonate');
    if (isPlayerVoice && persona) {
      const personaCp = getPersonaCheckpoint(persona, sessionState.capacity);
      if (personaCp) {
        systemPrompt += `\n=== MANDATORY — YOUR REACTION TO YOUR OWN INFLATION (${sessionState.capacity}%) ===\n${personaCp}\n=== END ===\n`;
      }
      if (character?.isPumpable) {
        const personaCharCp = getPersonaCharacterCheckpoint(persona);
        if (personaCharCp) {
          systemPrompt += `\n=== MANDATORY — YOUR REACTION TO ${character.name.toUpperCase()}'S INFLATION (${sessionState.characterCapacity}%) ===\n${personaCharCp}\n=== END ===\n`;
        }
      }
    }

    systemPrompt += `Continue from the text provided. Stay in character.`;
  }

  // Build prompt from history using REAL names (consistent with buildChatContext).
  const memSettingsSpecial = getChatMemorySettings(settings);
  const recentMessages = sessionState.chatHistory.slice(-memSettingsSpecial.impersonateHistoryDepth);
  const isPlayerVoiceHist = mode === 'impersonate' || mode === 'guided_impersonate';

  // Inject rolling summary of older messages if available
  if (sessionState.chatMemorySummary) {
    prompt += `[Summary of earlier conversation: ${sessionState.chatMemorySummary}]\n\n`;
  }
  prompt += 'Current conversation:\n';
  const specialHistory = buildHistoryRepresentations(recentMessages, {
    playerName,
    characterName: character.name,
    isPlayerVoice: isPlayerVoiceHist,
    authorNote: settings?.globalPrompt,
    authorNoteDepth: settings?.llm?.authorNoteDepth ?? 4,
  });
  prompt += specialHistory.flat;

  // Inject hardcoded physical state preface before every generation
  prompt += buildStatePreface(playerName, character.name, character);

  const isPlayerVoicePrimer = mode === 'impersonate' || mode === 'guided_impersonate';
  const primerName = isPlayerVoicePrimer ? playerName : character.name;

  // Guidance at DEPTH 0: place the directive in the user block immediately before
  // the primer (and as the final chat message below). Mistral/Tekken-family models
  // heavily weight the most recent instruction and largely ignore the system block,
  // so a system-only note gets dropped — keeping it adjacent to generation, in the
  // same "=== MANDATORY ===" shape the model already obeys for checkpoints, makes it stick.
  let guidanceDirective = '';
  if (guidedText) {
    const subject = isPlayerVoicePrimer ? `${playerName}'s` : `${character.name}'s`;
    guidanceDirective = `\n=== MANDATORY — DIRECTOR'S NOTE FOR THIS REPLY ===\n${subject} next message MUST center on: "${guidedText}"\nMake this the focus of the reply right now. Stay in character. Do NOT quote this note.\n=== END NOTE ===\n`;
    prompt += guidanceDirective;
    // Light reinforcement in the system block too (helps ChatML-style models).
    systemPrompt += `\n[Director's note for the next reply: ${guidedText}]`;
  }

  // Generation primer uses the REAL speaker name.
  prompt += `\n${primerName}:`;

  // Build stop sequences to prevent cross-role generation (real-name convention).
  const isPlayerVoice = mode === 'impersonate' || mode === 'guided_impersonate';
  const stopSequences = isPlayerVoice
    ? [`\n${character.name}:`, `${character.name}:`]
    : [`\n${playerName}:`, `${playerName}:`];

  // Structured messages for chat-completion endpoints (text-completion ignores this).
  const messages = [];
  if (sessionState.chatMemorySummary) {
    messages.push({ role: 'user', content: `[Summary of earlier conversation: ${sessionState.chatMemorySummary}]` });
  }
  messages.push(...specialHistory.messages);
  messages.push({ role: 'user', content: buildStatePreface(playerName, character.name, character).trim() });
  // Guidance as the FINAL message so chat-completion endpoints see it at depth 0.
  if (guidanceDirective) messages.push({ role: 'user', content: guidanceDirective.trim() });

  return { systemPrompt, prompt, stopSequences, messages, playerName, characterName: character.name };
}

// Build system prompt for multi-character cards
function buildMultiCharSystemPrompt(character, playerName, substituteVars) {
  const chars = character.multiChar.characters || [];
  const muted = new Set(sessionState?.mutedMembers || []);
  const activeChars = chars.filter(c => !muted.has(c.id));
  const silentChars = chars.filter(c => muted.has(c.id));
  // If every member is muted, fall back to all (avoid an empty cast).
  const speakable = activeChars.length ? activeChars : chars;
  const names = speakable.map(c => c.name).join(', ');

  let prompt = `You are a collaborative fiction writer portraying: ${names}.\n`;
  prompt += `Write realistic, natural roleplay. Use "dialogue in quotes" and *actions/descriptions in asterisks*. Break responses into short paragraphs.\n\n`;
  prompt += `CHARACTERS:\n`;
  for (const c of chars) {
    const pron = genderPronoun(c.gender);
    const silent = muted.has(c.id) && speakable !== chars;
    prompt += `- ${c.name}${pron ? ` (${pron})` : ''}${silent ? ' [PRESENT BUT SILENT THIS TURN]' : ''}: ${substituteVars(c.description)}\n`;
    if (c.personality) {
      prompt += `  Personality: ${substituteVars(c.personality)}\n`;
    }
    // Per-member current personality drive (rolled this turn)
    const active = sessionState?.multiCharAttributes?.[c.id] || [];
    if (active.length && !silent) {
      const labels = active.map(t => t.charAt(0).toUpperCase() + t.slice(1));
      prompt += `  RIGHT NOW ${c.name} is driven by ${labels.join(', ')}: ${active.map(t => ATTRIBUTE_PROMPTS[t]).filter(Boolean).join(' ')}\n`;
    }
    // Per-member voice examples
    if (Array.isArray(c.exampleDialogues) && c.exampleDialogues.length) {
      const ex = c.exampleDialogues.slice(0, 2)
        .filter(e => e && (e.user || e.character))
        .map(e => `    ${playerName}: ${substituteVars(e.user || '')}\n    ${c.name}: ${substituteVars(e.character || '')}`)
        .join('\n');
      if (ex) prompt += `  Voice example:\n${ex}\n`;
    }
  }
  prompt += `\nRULES:\n`;
  prompt += `- Write ONLY for ${names}. NEVER write dialogue or actions for ${playerName}.\n`;
  if (silentChars.length && speakable !== chars) {
    prompt += `- Do NOT write dialogue or actions for ${silentChars.map(c => c.name).join(', ')} this turn — they are present in the scene but silent.\n`;
  }
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

// ===== Instructor character type =====
// Instructor cards are stored as ordinary characters marked with instructor.enabled.
// They speak only in direct, non-embellished, mission-specific instructions (no RP prose).
function isInstructor(character) {
  return !!character?.instructor?.enabled;
}

const INSTRUCTOR_PROFILES_PATH = path.join(DATA_DIR, 'instructor-profiles.json');
const INSTRUCTOR_LIBRARY_PATH = path.join(DATA_DIR, 'instructor-library.json');

function loadInstructorProfiles() {
  try {
    return JSON.parse(fs.readFileSync(INSTRUCTOR_PROFILES_PATH, 'utf8'));
  } catch (e) {
    return { profiles: [] };
  }
}

function saveInstructorProfiles(data) {
  fs.writeFileSync(INSTRUCTOR_PROFILES_PATH, JSON.stringify(data, null, 2));
}

function loadInstructorLibrary() {
  try {
    return JSON.parse(fs.readFileSync(INSTRUCTOR_LIBRARY_PATH, 'utf8'));
  } catch (e) {
    return { groups: [] };
  }
}

function saveInstructorLibrary(data) {
  fs.writeFileSync(INSTRUCTOR_LIBRARY_PATH, JSON.stringify(data, null, 2));
}

// Build the terse instructor system prompt: identity + mission + assigned profile + hard
// behavioral constraints. No belly-state prose is added by this function (see callers).
function buildInstructorSystemPrompt(character, playerName, substituteVars) {
  const name = character.name || 'Instructor';
  let p = `You are ${name}`;
  if (character.gender) p += `, ${character.gender}`;
  p += `.\n`;
  if (character.mission) {
    p += `Mission: ${substituteVars(character.mission)}\n`;
  }
  if (character.instructorProfileId) {
    const profile = (loadInstructorProfiles().profiles || []).find(pr => pr.id === character.instructorProfileId);
    if (profile && profile.prompt) {
      p += `\n${substituteVars(profile.prompt)}\n`;
    }
  }
  // Profile-specific rules from the active checkpoint profile (e.g. bike-pump limits/tone).
  const activeProfile = getInstructorActiveProfile(character);
  if (activeProfile?.rules && activeProfile.rules.trim()) {
    p += `\nProfile rules (${activeProfile.name || 'active profile'}):\n${substituteVars(activeProfile.rules.trim())}\n`;
  }
  p += `\n=== INSTRUCTOR DIRECTIVE (MANDATORY) ===\n`;
  p += `You are an instructor/operator, not a roleplay character. Speak ONLY in direct, non-embellished, mission-specific instructions and clarifications to ${playerName}.\n`;
  p += `- No narration, no scene-setting, no prose, no internal monologue.\n`;
  p += `- No asterisk actions (*...*), no emotive description, no embellishment.\n`;
  p += `- Output only what the instructor would say aloud: commands, corrections, confirmations, and concise answers.\n`;
  p += `- Stay strictly on mission. Be terse and precise.\n`;
  p += `=== END INSTRUCTOR DIRECTIVE ===\n\n`;
  return p;
}

// Keyword-triggered term lookup: assigned library groups -> reminder-shaped objects ->
// reminder engine keyword activation. Returns active reminder-shaped entries.
function getInstructorActiveTerms(character, recentMessages) {
  const groupIds = character.instructorLibraryGroupIds || [];
  if (!groupIds.length) return [];
  const groups = loadInstructorLibrary().groups || [];
  const terms = [];
  for (const g of groups) {
    if (!groupIds.includes(g.id)) continue;
    for (const t of (g.terms || [])) {
      if (!t || !t.definition || !t.term) continue;
      // The term itself plus any extra comma-separated keys all trigger the entry
      const keys = [t.term, ...(Array.isArray(t.keys) ? t.keys : [])].filter(Boolean);
      terms.push({
        name: t.term,
        text: `${t.term}: ${t.definition}`,
        constant: false,
        keys,
        caseSensitive: !!t.caseSensitive,
        enabled: true,
        priority: 100,
        scanDepth: 10
      });
    }
  }
  return reminderEngine.getActiveEntries(terms, recentMessages, { maxRecursion: 3 });
}

// ===== Global Dictionary =====
// Always-on, global term definitions injected into every character's system prompt.
// Same group/term structure as the Instructor Library, but never keyword-gated and not
// assigned per-card — it applies to all sessions.
const DICTIONARY_PATH = path.join(DATA_DIR, 'dictionary.json');

function loadDictionary() {
  try {
    return JSON.parse(fs.readFileSync(DICTIONARY_PATH, 'utf8'));
  } catch (e) {
    return { groups: [] };
  }
}

function saveDictionary(data) {
  fs.writeFileSync(DICTIONARY_PATH, JSON.stringify(data, null, 2));
}

// Build the dictionary block. Terms with no trigger words are always-on; terms
// with comma-separated trigger words are keyword-gated against recent messages.
// Routed through the reminder engine so multiple matching phrases activate
// multiple entries in a single generation.
function buildDictionaryPrompt() {
  const groups = loadDictionary().groups || [];
  const entries = [];
  for (const g of groups) {
    if (g.enabled === false) continue;
    for (const t of (g.terms || [])) {
      const term = t?.term ?? t?.title;
      const def = t?.definition ?? t?.content;
      if (!t || !term || !def || t.enabled === false) continue;
      // Forward the whole entry to the engine so the advanced fields (secondaryKeys, logic,
      // probability, group, recursion) are honored — not just term/definition/keys.
      entries.push({ ...t, title: term, content: `${term}: ${def}` });
    }
  }
  if (!entries.length) return '';
  const recentMessages = reminderEngine.extractRecentMessages(sessionState?.chatHistory || [], 10);
  const active = reminderEngine.getActiveEntries(entries, recentMessages, { maxRecursion: 3 });
  if (!active.length) return '';
  return `Dictionary:\n${active.map(r => `- ${r.content}`).join('\n')}\n\n`;
}

// ===== SillyTavern lorebook import =====
// Convert ST World Info (native `{entries:{uid:{...}}}`) or the v2 character_book
// (`{entries:[{keys,secondary_keys,...}]}`) into our canonical entry shape. Drops the
// JS/automation/vector fields (we don't run STscript).
function convertImportedLorebookEntry(raw) {
  const toArr = (v) => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean)
    : (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
  const ext = raw.extensions || {};
  const keys = toArr(raw.key ?? raw.keys);
  const secondaryKeys = toArr(raw.keysecondary ?? raw.secondary_keys);
  const logicNum = raw.selectiveLogic ?? ext.selectiveLogic;
  const logic = ({ 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' })[logicNum] || 'and_any';
  const enabled = raw.disable != null ? !raw.disable : (raw.enabled != null ? !!raw.enabled : true);
  return {
    id: `imp-${raw.uid ?? Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`,
    term: raw.comment || keys[0] || 'Imported entry',
    definition: raw.content || '',
    keys, secondaryKeys, logic,
    constant: raw.constant === true,
    enabled,
    probability: (raw.useProbability === false) ? 100 : (raw.probability ?? ext.probability ?? 100),
    order: raw.order ?? raw.insertion_order ?? 100,
    scanDepth: raw.scanDepth ?? ext.scan_depth ?? null,
    caseSensitive: !!(raw.caseSensitive ?? ext.case_sensitive),
    matchWholeWords: raw.matchWholeWords ?? ext.match_whole_words,
    group: raw.group ?? ext.group ?? '',
    groupWeight: raw.groupWeight ?? ext.group_weight ?? 100,
    recurse: !(raw.preventRecursion ?? ext.prevent_recursion),
    excludeRecursion: !!(raw.excludeRecursion ?? ext.exclude_recursion),
  };
}

function convertSillyTavernLorebook(json) {
  if (!json) return [];
  let raw = [];
  if (Array.isArray(json.entries)) raw = json.entries;                              // character_book
  else if (json.entries && typeof json.entries === 'object') raw = Object.values(json.entries); // ST native
  else if (Array.isArray(json)) raw = json;
  return raw.map(convertImportedLorebookEntry).filter(e => e.definition);
}

// ===== Built-in defaults (seeded once on startup) =====
const BUILTIN_INSTRUCTOR_PROFILE_ID = 'instr-builtin-inflation-assistant';

// Immutable, ships-with-the-app instructor profile.
function ensureDefaultInstructorProfiles() {
  const data = loadInstructorProfiles();
  if (!Array.isArray(data.profiles)) data.profiles = [];
  if (data.profiles.some(p => p.id === BUILTIN_INSTRUCTOR_PROFILE_ID)) return;
  data.profiles.unshift({
    id: BUILTIN_INSTRUCTOR_PROFILE_ID,
    name: 'Inflation Assistant',
    builtIn: true,
    prompt: `You are the user's Inflation Assistant: a calm, knowledgeable, safety-first operator who guides them through air- or fluid-based belly inflation sessions using their own equipment.

Your job:
- Help select the right tool for the session and confirm it is set up correctly.
- Walk the user through inflation in small, controlled increments; never rush.
- Continuously check the user's stated capacity, comfort, and pain. Slow down or stop the moment they report tightness, pain, dizziness, or nausea.
- Talk them through holding safely and through a slow, complete release at the end.
- Answer tool and technique questions accurately and briefly.

Safety is non-negotiable and overrides everything else:
- A manual hardware shutoff (valve, clamp, or power disconnect) must be within the user's reach at all times. Confirm this before starting.
- Never instruct the user to exceed a safe limit, hold past discomfort, or ignore a stop signal. If they ask you to, refuse and explain the risk.
- Use only clean, body-safe equipment; for fluid, body-safe fluid at a comfortable temperature.
- If the user reports pain, dizziness, faintness, or anything alarming, instruct an immediate stop and release, and tell them to seek help if it does not resolve.
- You are not a medical professional; for any health concern, tell the user to consult one.`
  });
  saveInstructorProfiles(data);
  console.log('[Startup] Seeded built-in instructor profile: Inflation Assistant');
}

// Default (mutable) global dictionary group of inflation tools.
function ensureDefaultDictionary() {
  const data = loadDictionary();
  if (!Array.isArray(data.groups)) data.groups = [];
  const GROUP_ID = 'dict-builtin-inflation-tools';
  if (data.groups.some(g => g.id === GROUP_ID)) return;
  data.groups.push({
    id: GROUP_ID,
    name: 'Inflation Tools',
    enabled: true,
    terms: [
      { id: 'it-bulb', term: 'Bulb pump', keys: ['bulb pump', 'squeeze bulb', 'bulb'], enabled: true,
        definition: 'A handheld squeeze-bulb (like a blood-pressure bulb) that pushes a small burst of air with each squeeze. Very low volume and highly controllable — good for slow, precise inflation, but tiring over long sessions. How to operate: connect the bulb to the tube, then squeeze and release rhythmically — each squeeze adds a small puff of air. Pause between squeezes to check comfort, and open the release valve to let air back out.' },
      { id: 'it-bike', term: 'Bike/bicycle pump', keys: ['bike pump', 'bicycle pump', 'hand pump', 'floor pump'], enabled: true,
        definition: 'A manual hand or floor pump made for tires, repurposed for air. Moves a moderate volume of air per stroke; a built-in gauge helps track pressure. Use a steady, controlled pace. How to operate: connect the hose securely, then push the handle in slow, full strokes while watching the gauge. Add a few strokes, pause to assess capacity and comfort, then open the bleed valve to release.' },
      { id: 'it-compressor', term: 'Air compressor', keys: ['air compressor', 'compressor'], enabled: true,
        definition: 'A powered pump that delivers high air volume and pressure quickly. Powerful and fast — only use with a pressure regulator/relief and extreme caution, since over-inflation happens fast. A hardware shutoff within reach is mandatory. How to operate: set the regulator to a low pressure first, attach the hose, and add air in short bursts via the trigger/valve — never a continuous flow. Keep the relief/bleed valve and shutoff within reach so you can vent instantly.' },
      { id: 'it-aquarium', term: 'Aquarium pump', keys: ['aquarium pump', 'fish tank pump', 'air pump'], enabled: true,
        definition: 'A small electric air pump made for fish tanks. Provides gentle, continuous low-pressure airflow — slow and forgiving, good for gradual top-ups, with a limited maximum pressure. How to operate: connect the airline and power it on for continuous low-pressure air. Use an inline valve or hose clamp to start, stop, and release; pinch or open the line to control the rate.' },
      { id: 'it-fluid', term: 'Water/fluid/enema pump', keys: ['water pump', 'fluid pump', 'enema pump'], enabled: true,
        definition: 'A pump that introduces water or fluid instead of air. Fluid adds weight and behaves differently from air; use clean, body-safe fluid at a comfortable temperature and inflate at a slow, controlled rate. How to operate: prime the line with clean, body-safe fluid at a comfortable temperature, attach the nozzle, and pump slowly. Stop often to assess, and open the clamp/valve to drain when finished.' },
      { id: 'it-enemabag', term: 'Enema bag', keys: ['enema bag', 'gravity bag'], enabled: true,
        definition: "A gravity-fed bag with a hose and nozzle that introduces water or fluid using the bag's height for pressure. Flow is controlled by how high the bag hangs and by the hose clamp — raise it slowly and use the clamp to pause. How to operate: fill with body-safe fluid, hang it, and raise it slowly to increase pressure; open the hose clamp to start the flow. Lower the bag or close the clamp to pause, and open it to drain." }
    ]
  });
  saveDictionary(data);
  console.log('[Startup] Seeded default dictionary group: Inflation Tools');
}

ensureDefaultInstructorProfiles();
ensureDefaultDictionary();

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

    let instructions = `\nBELLY STATE: ${subject} belly ${verb} at EXACTLY ${capacity}%: ${bellyDesc}. Pain: ${painLabel} (${painLevel}/10).\n`;

    if (capacity <= 5) {
      instructions += `INFLATION HAS BARELY BEGUN. ${subject} belly looks completely normal. You may only mention: a faint warmth, a subtle awareness of the tube, or nothing at all. Focus on conversation, emotions, and the situation — not physical sensations. The story is just starting.\n`;
    } else if (capacity <= 15) {
      instructions += `EARLY STAGE. ${subject} belly is still flat-looking. You may only describe: a gentle internal warmth, a slight feeling of fullness like after a snack, or mild curiosity about the sensation. Keep physical descriptions minimal — one brief mention at most. Focus on dialogue and interaction.\n`;
    } else if (capacity <= 30) {
      instructions += `MILD INFLATION. You may describe: subtle bloating, a feeling of gentle pressure, clothes fitting slightly different. Keep it understated — this is still early. One or two brief physical references per response, then focus on the scene.\n`;
    } else if (capacity <= 50) {
      instructions += `MODERATE INFLATION. You may describe: visible roundness, noticeable tightness, pressure building, clothes straining. Physical sensations are present but manageable. Balance physical description with dialogue and character interaction.\n`;
    } else if (capacity <= 70) {
      instructions += `SIGNIFICANT INFLATION. You may describe: prominent swelling, taut skin, difficulty moving comfortably, labored breathing. Physical sensations are hard to ignore. Reactions should match the intensity.\n`;
    } else if (capacity <= 85) {
      instructions += `HEAVY INFLATION. Describe: drum-tight skin, extreme pressure, every movement causing discomfort, genuine strain. The body is at serious capacity.\n`;
    } else {
      instructions += `CRITICAL/MAX INFLATION. Describe: impossibly full, skin creaking, at the absolute limit. This is the climax.\n`;
    }

    instructions += `Write ${capacity}% if referencing a number. The belly state is a snapshot — describe it as-is, not changing in real time.\n`;

    return instructions;
  };

  // Build system prompt from character
  let systemPrompt;
  if (isInstructor(character)) {
    systemPrompt = buildInstructorSystemPrompt(character, playerName, substituteVars);
  } else if (character.multiChar?.enabled) {
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

  // Always-on global dictionary, unless this instructor opts out (Use Card Library Only)
  if (!(isInstructor(character) && character.ignoreDictionary)) {
    systemPrompt += buildDictionaryPrompt();
  }

  // Add player info if available. Instructors only need the player's NAME/pronouns —
  // appearance, personality, and inflation-disposition prose are scene flavor a terse,
  // checkpoint-driven operator doesn't use, so they're skipped to keep the prompt lean.
  if (activePersona) {
    systemPrompt += `The player is ${activePersona.displayName}`;
    if (activePersona.pronouns) {
      systemPrompt += ` (${activePersona.pronouns})`;
    }
    systemPrompt += '.\n';
    if (!isInstructor(character)) {
      if (activePersona.appearance) {
        systemPrompt += `Player appearance: ${activePersona.appearance}\n`;
      }
      if (activePersona.personality) {
        systemPrompt += `Player personality: ${activePersona.personality}\n`;
      }
      if (activePersona.relationshipWithInflation) {
        systemPrompt += `Player's additional inflation context: ${activePersona.relationshipWithInflation}\n`;
      }
      systemPrompt += buildPersonaInflationContext(activePersona, activePersona.displayName || 'The player');
      systemPrompt += buildPersonaDispositionContext(activePersona, activePersona.displayName || 'The player');
    }
    systemPrompt += '\n';
  }

  // Add player's current physical/emotional state
  const playerLabel = activePersona?.displayName || 'The player';
  const recentMessagesChat = reminderEngine.extractRecentMessages(sessionState.chatHistory, getChatMemorySettings(settings).reminderScanDepth);

  if (isInstructor(character)) {
    // Instructors get raw capacity awareness (so they can command device/checkpoint actions)
    // but none of the belly-state prose. Terms are keyword-activated from assigned library groups.
    const capacityNow = Math.round(sessionState.capacity || 0);
    const painLabelsInstr = ['None', 'Minimal', 'Mild', 'Uncomfortable', 'Moderate', 'Distracting', 'Distressing', 'Intense', 'Severe', 'Agonizing', 'Excruciating'];
    const painLabelNow = painLabelsInstr[sessionState.pain || 0] || 'None';
    systemPrompt += `\nCurrent capacity: ${capacityNow}%. Pain: ${painLabelNow} (${sessionState.pain || 0}/10).\n`;

    // Manual pump activity since the last reply (consumed once).
    if (sessionState.pendingPumpContext?.length) {
      systemPrompt += `\nPump activity since your last reply:\n${sessionState.pendingPumpContext.map(s => `- ${s}`).join('\n')}\n`;
      sessionState.pendingPumpContext = [];
    }

    const activeTerms = getInstructorActiveTerms(character, recentMessagesChat);
    if (activeTerms.length > 0) {
      systemPrompt += '\n' + reminderEngine.buildReminderPrompt(activeTerms, 'Known Terms');
    }
  } else {
    systemPrompt += buildBellyStateInstructions(sessionState.capacity, sessionState.pain, playerLabel, false);
    systemPrompt += buildCharacterInflationContext(character);

    systemPrompt += `${playerLabel} emotionally feels ${sessionState.emotion}.\n`;

    // Add recent challenge result if available
    if (sessionState.lastChallengeResult) {
      const cr = sessionState.lastChallengeResult;
      const isRecent = (Date.now() - cr.timestamp) < 60000;
      if (isRecent) {
        systemPrompt += `\nChallenge just occurred: ${cr.typeName} — ${playerLabel} ${cr.description}. React to this outcome.\n`;
      }
    }

    // Active lore via the unified engine. Local Library = card-embedded (constantReminders
    // + story.library) + persona-embedded; merged with global reminders. One pipeline.
    const activeStoryLore = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
    const localLibrary = [
      ...(character.constantReminders || []),
      ...(activeStoryLore?.library || []),
      ...(activePersona?.constantReminders || activePersona?.library || []),
    ];
    const activeRemindersChat = reminderEngine.getMergedActiveReminders(
      localLibrary,
      settings.globalReminders || [],
      recentMessagesChat
    );
    if (activeRemindersChat.length > 0) {
      systemPrompt += '\n' + reminderEngine.buildReminderPrompt(activeRemindersChat, 'Active Lore');
    }
  }

  // Author note is injected into the chat history at configurable depth (see below),
  // not appended to the system prompt.

  // Add LLM device control instructions if enabled
  if (settings?.globalCharacterControls?.allowLlmDeviceControl) {
    const globalMax = settings.globalCharacterControls.llmDeviceControlMaxSeconds || 30;
    const charLimits = getCharacterLimits(character);
    const capacityMod2 = settings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
    const scaledMaxOn2 = Math.round((charLimits?.llmMaxOnDuration ?? 5) * capacityMod2);
    const maxSeconds = charLimits ? Math.min(globalMax, scaledMaxOn2) : globalMax;
    let devicePrompt = `\nDEVICE CONTROL — REQUIRED: You operate a REAL physical device through hidden tags. If your reply narrates the pump starting, running, or continuing but you do NOT include the tag, the pump does NOT move — so you MUST emit the tag in the SAME reply.
Tags: [pump on]/[pump off], [vibe on]/[vibe off], [tens on]/[tens off]
- Emit [pump on] the instant you describe starting/running the pump; place the tag right after the action.
- The pump auto-stops after ${maxSeconds}s — re-emit [pump on] every reply you want it to keep running.
- Emit [pump off] when you narrate stopping. Tags are hidden from the player.
Example: "*flips the switch* [pump on] Let's begin..."`;
    if (charLimits) {
      const scaledMaxTimed2 = Math.round((charLimits.llmMaxTimedDuration ?? 10) * capacityMod2);
      const scaledMaxCycleOn2 = Math.round((charLimits.llmMaxCycleOnDuration ?? 2) * capacityMod2);
      devicePrompt += `\nLimits: max ON ${scaledMaxOn2}s, max pulse ${charLimits.llmMaxPulseRepetitions ?? 5}x, max timed ${scaledMaxTimed2}s, max cycle ON ${scaledMaxCycleOn2}s x${charLimits.llmMaxCycleRepetitions ?? 2}`;
    }
    systemPrompt += devicePrompt + '\n';
  }

  // Inject personality attributes if rolled
  if (sessionState.activeAttributes?.length > 0) {
    systemPrompt += buildAttributeBlock(sessionState.activeAttributes);
  }
  systemPrompt += buildInflationDispositionContext(character);

  // Inject checkpoints at end of system prompt (recency = higher priority for LLM)
  const checkpointChat = getActiveCheckpoint(character, sessionState.capacity);
  if (checkpointChat?.preInflation) {
    console.log(`[Checkpoints] Injecting PRE-INFLATION for player at ${sessionState.capacity}%`);
    systemPrompt += `\n=== MANDATORY PRE-INFLATION REQUIREMENT ===\nDo NOT activate the pump, begin inflation, or use [pump on] tags until the following has been accomplished:\n${checkpointChat.preInflation}\n=== END REQUIREMENT ===\n`;
  }
  if (checkpointChat?.text) {
    console.log(`[Checkpoints] Injecting PLAYER checkpoint at ${sessionState.capacity}%: ${checkpointChat.text.substring(0, 60)}...`);
    systemPrompt += `\n=== MANDATORY — PLAYER INFLATION STAGE DIRECTION (${sessionState.capacity}%) ===\nYou MUST follow this guidance for the player's current inflation level. Do NOT describe inflation beyond what ${sessionState.capacity}% represents:\n${checkpointChat.text}\n=== END STAGE DIRECTION ===\n`;
  }
  systemPrompt += manualPumpBatchBlock(checkpointChat);

  const charCheckpointChat = getActiveCharacterCheckpoint(character);
  if (charCheckpointChat) {
    console.log(`[Checkpoints] Injecting CHARACTER checkpoint at ${sessionState.characterCapacity}%: ${charCheckpointChat.substring(0, 60)}...`);
    systemPrompt += `\n=== MANDATORY — ${character.name.toUpperCase()}'S INFLATION STAGE DIRECTION (${sessionState.characterCapacity}%) ===\nYou MUST follow this guidance for ${character.name}'s current inflation level. Do NOT describe their inflation beyond what ${sessionState.characterCapacity}% represents:\n${charCheckpointChat}\n=== END STAGE DIRECTION ===\n`;
  }

  // Checkpoint injections rolled for this generation (pop-up stage events)
  systemPrompt += checkpointInjectionsBlock();

  // Pre-Fill gated-intro directive (no pumping; drives toward the current step)
  systemPrompt += preFillBlock(character);

  // Final style anchor — the LAST line carries the most weight for recency-biased
  // models, so instructors get the OPPOSITE of the roleplay anchor (this line was the
  // main reason instructors slipped into quoted dialogue / *actions*).
  if (isInstructor(character)) {
    systemPrompt += `\nRespond ONLY as the instructor speaking aloud: direct commands, corrections, and answers. No "quoted dialogue", no *asterisk actions*, no narration, no prose.\n`;
  } else {
    systemPrompt += `\nWrite "dialogue" and *actions*. Short paragraphs, natural speech. Show don't tell.\n`;
  }

  // Build prompt from recent chat history. A card may override the global depth
  // (instructors especially want a short window — their authoritative state is the
  // freshly-rebuilt checkpoint/pacing injections, not the back-and-forth).
  const memSettingsChat = getChatMemorySettings(settings);
  const cardDepth = Number(character?.historyDepth);
  const effectiveDepth = cardDepth > 0 ? cardDepth : memSettingsChat.chatHistoryDepth;
  const recentMessages = sessionState.chatHistory.slice(-effectiveDepth);
  let prompt = '';

  // Inject rolling summary of older messages if available
  if (sessionState.chatMemorySummary) {
    prompt += `[Summary of earlier conversation: ${sessionState.chatMemorySummary}]\n\n`;
  }

  if (character.exampleDialogues && character.exampleDialogues.length > 0) {
    if (character.multiChar?.enabled) {
      character.exampleDialogues.forEach(ex => {
        prompt += `<START>\n${playerLabel}: ${ex.user}\n${ex.response || ex.character}\n`;
      });
    } else {
      character.exampleDialogues.forEach(ex => {
        prompt += `<START>\n${playerLabel}: ${ex.user}\n${character.name}: ${ex.character}\n`;
      });
    }
    prompt += '\nCurrent conversation:\n';
  }

  const history = buildHistoryRepresentations(recentMessages, {
    playerName: playerLabel,
    characterName: character.name,
    isPlayerVoice: false,
    authorNote: settings?.globalPrompt,
    authorNoteDepth: settings?.llm?.authorNoteDepth ?? 4,
  });
  prompt += history.flat;

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
    prompt += buildStatePreface(playerLabel, character.name, character);
    prompt += `[Characters]:`;
  } else {
    prompt += buildStatePreface(playerLabel, character.name, character);
    prompt += `${character.name}:`;
  }

  // Build stop sequences to prevent role confusion (like SillyTavern's names_as_stop_strings)
  const stopSequences = [
    `\n${playerLabel}:`,
    `${playerLabel}:`,
  ];
  if (!character.multiChar?.enabled) {
    stopSequences.push(`\n${character.name}:`);
  }

  // Structured messages for chat-completion endpoints (text-completion ignores this).
  const messages = [];
  // Lead-in context (summary + example dialogues), if any, as a single user turn.
  const leadIn = [];
  if (sessionState.chatMemorySummary) {
    leadIn.push(`[Summary of earlier conversation: ${sessionState.chatMemorySummary}]`);
  }
  if (character.exampleDialogues && character.exampleDialogues.length > 0) {
    if (character.multiChar?.enabled) {
      character.exampleDialogues.forEach(ex => {
        leadIn.push(`<START>\n${playerLabel}: ${ex.user}\n${ex.response || ex.character}`);
      });
    } else {
      character.exampleDialogues.forEach(ex => {
        leadIn.push(`<START>\n${playerLabel}: ${ex.user}\n${character.name}: ${ex.character}`);
      });
    }
  }
  if (leadIn.length > 0) {
    messages.push({ role: 'user', content: leadIn.join('\n') });
  }
  // Conversation turns + author note at depth (from the shared helper).
  messages.push(...history.messages);
  // Final state preface as a system-style instruction at depth 0 (right before generation).
  messages.push({ role: 'user', content: buildStatePreface(playerLabel, character.name, character).trim() });

  return { systemPrompt, prompt, stopSequences, messages, playerName: playerLabel, characterName: character.name };
}

/**
 * Take a buildChatContext() result and apply a SINGLE guidance injection for
 * character-voice guided responses. One system note at depth 0; no prompt-tag copy.
 * Returns the same shape ({systemPrompt, prompt, stopSequences, messages, ...}).
 */
function applyCharacterGuidance(context, character, guidanceText) {
  if (!guidanceText) return context;

  const isMulti = character.multiChar?.enabled;
  const primer = isMulti ? '[Characters]:' : `${character.name}:`;
  const subject = isMulti ? "The characters'" : `${character.name}'s`;

  // Guidance at DEPTH 0, in the same "=== MANDATORY ===" shape the model already
  // obeys for checkpoints. Mistral/Tekken-family models weight the most recent
  // instruction far above the system block, so this must sit right before the
  // primer (and as the final chat message) — not buried in the system prompt.
  const directive = `\n=== MANDATORY — DIRECTOR'S NOTE FOR THIS REPLY ===\n${subject} next message MUST center on: "${guidanceText}"\nMake this the focus of the reply right now. Stay in character. Do NOT quote this note.\n=== END NOTE ===\n`;

  // Flat prompt (text-completion): insert just before the trailing primer.
  if (typeof context.prompt === 'string') {
    const idx = context.prompt.lastIndexOf(primer);
    if (idx >= 0) {
      context.prompt = context.prompt.slice(0, idx) + directive + context.prompt.slice(idx);
    } else {
      context.prompt += directive;
    }
  }

  // Structured messages (chat-completion): append as the final turn before generation.
  if (Array.isArray(context.messages)) {
    context.messages.push({ role: 'user', content: directive.trim() });
  }

  // Light reinforcement in the system block too (helps ChatML-style models).
  context.systemPrompt += `\n[Director's note for the next reply: ${guidanceText}]`;
  return context;
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

    // The current branch may not exist on origin (e.g. a local-only feature branch).
    // Treat that as "no updates available" instead of failing the whole check.
    let remoteExists = true;
    try {
      execSync(`git rev-parse --verify --quiet origin/${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe' });
    } catch (e) {
      remoteExists = false;
    }
    if (!remoteExists) {
      console.log(`[Updates] origin/${trackingBranch} not found — no remote tracking branch; reporting no updates`);
      let cv = 'unknown';
      try { cv = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch (e) {}
      return res.json({
        hasUpdates: false,
        currentVersion: cv,
        behindCount: 0,
        pendingChanges: [],
        note: `Branch '${trackingBranch}' has no remote on origin; update checks are disabled for this branch.`
      });
    }

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

  // Self-update is destructive (git reset --hard) — require a same-origin LOCAL request.
  if (!isSameOriginLocal(req)) {
    return res.status(403).json({ success: false, error: 'Self-update is only allowed from a same-origin localhost request' });
  }

  try {
    console.log('[Updates] Manual pull requested...');
    // Detect current branch, migrate master/main to release
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const trackingBranch = (currentBranch === 'master' || currentBranch === 'main') ? 'release' : currentBranch;
    // Fetch first so the ahead-count is computed against up-to-date remote refs.
    execSync(`git fetch origin ${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe', timeout: 30000 });
    // Refuse to clobber local commits not yet on the remote.
    const ahead = localCommitsAhead(projectRoot, trackingBranch);
    if (ahead !== 0) {
      return res.status(409).json({
        success: false,
        error: ahead < 0
          ? 'Unable to determine local/remote divergence; refusing hard reset'
          : `Local HEAD is ${ahead} commit(s) ahead of origin/${trackingBranch}; refusing hard reset`
      });
    }
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

  // Self-update is destructive (git reset --hard + restart) — require same-origin LOCAL.
  if (!isSameOriginLocal(req)) {
    return res.status(403).json({ success: false, error: 'Self-update is only allowed from a same-origin localhost request' });
  }

  try {
    // Detect current branch, migrate master/main to release
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const trackingBranch = (currentBranch === 'master' || currentBranch === 'main') ? 'release' : currentBranch;
    // Fetch and reset to remote (no merge, no committer identity needed)
    // This ensures local repo always matches remote exactly - users shouldn't modify tracked files
    console.log(`[Updates] Fetching latest changes from origin/${trackingBranch}...`);
    execSync(`git fetch origin ${trackingBranch}`, { cwd: projectRoot, stdio: 'pipe', timeout: 30000 });
    // Refuse to clobber local commits not yet on the remote.
    const ahead = localCommitsAhead(projectRoot, trackingBranch);
    if (ahead !== 0) {
      return res.status(409).json({
        success: false,
        error: ahead < 0
          ? 'Unable to determine local/remote divergence; refusing hard reset'
          : `Local HEAD is ${ahead} commit(s) ahead of origin/${trackingBranch}; refusing hard reset`
      });
    }
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

    // Reset Kasa 1.1.x+ service Python ready state
    try {
      const kasaKlapService = require('./services/kasa-klap-service');
      kasaKlapService.pythonReady = null;
      console.log('[Updates] Reset Kasa 1.1.x+ Python ready state');
    } catch (e) { /* Kasa 1.1.x+ service may not be loaded */ }

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

  // Pre-compute per-pump capacity contributions from the manual-device maxes so they're
  // resolvable as [BulbAmountPerPump] / [BikeAmountPerPump] in prompts and flows.
  if (settings.systemVariables && typeof settings.systemVariables === 'object') {
    const sv = settings.systemVariables;
    const bulbMax = Number(sv.BulbMax);
    const bikeMax = Number(sv.BikeMax);
    sv.BulbAmountPerPump = bulbMax > 0 ? Math.round((100 / bulbMax) * 100) / 100 : 0;
    sv.BikeAmountPerPump = bikeMax > 0 ? Math.round((100 / bikeMax) * 100) / 100 : 0;
  }

  // Encrypt any new API keys provided in the request
  if (req.body.openRouterApiKey && req.body.openRouterApiKey !== '') {
    settings.openRouterApiKey = encrypt(req.body.openRouterApiKey);
  } else if (!req.body.openRouterApiKey) {
    // Keep existing encrypted key if not provided
    settings.openRouterApiKey = oldSettings.openRouterApiKey;
  }
  if (req.body.hordeApiKey && req.body.hordeApiKey !== '') {
    settings.hordeApiKey = encrypt(req.body.hordeApiKey);
  } else if (!req.body.hordeApiKey) {
    settings.hordeApiKey = oldSettings.hordeApiKey;
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
  if (req.body.haToken && req.body.haToken !== '') {
    settings.haToken = encrypt(req.body.haToken);
  } else if (!req.body.haToken) {
    settings.haToken = oldSettings.haToken;
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

    // Ensure AI pump flow assignments are correct for the new character or persona
    if (charChanged) {
      // If new character is not pumpable, stop any active inflation and reset capacity
      const charsForPumpCheck = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const newActiveChar = charsForPumpCheck.find(c => c.id === settings.activeCharacterId);
      if (!newActiveChar?.isPumpable) {
        stopCharacterInflation();
        sessionState.characterCapacity = 0;
        sessionState.characterInflationBaseCapacity = 0;
        broadcast('character_inflate_state', { active: false, elapsed: 0, characterCapacity: 0 });
        broadcast('character_capacity_update', { characterCapacity: 0, elapsed: 0, inflating: false });
      }
    }

    if (charChanged || personaChanged) {
      broadcast('flow_assignments_update', sessionState.flowAssignments);
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
  // Encrypt AI Horde API key if provided (top-level copy for reconnect/masking;
  // the plaintext working copy lives in settings.llm for generation).
  if (req.body.hordeApiKey && req.body.hordeApiKey !== '') {
    settings.hordeApiKey = encrypt(req.body.hordeApiKey);
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

// --- AI Horde ---

// Connect to AI Horde and fetch text models. An empty key is treated as the
// anonymous tier (Horde key '0000000000').
app.post('/api/horde/connect', async (req, res) => {
  try {
    const apiKey = (req.body.apiKey && req.body.apiKey.trim()) || '0000000000';
    console.log('[Horde] Testing connection...');
    const result = await llmService.testHordeConnection(apiKey);
    if (result.success) {
      global.hordeModels = result.models;
      console.log(`[Horde] Connected${result.username ? ` as ${result.username}` : ' (anonymous)'}, ${result.models.length} text models available`);
    }
    res.json(result);
  } catch (error) {
    console.error('[Horde] Connection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reconnect to AI Horde using the stored API key
app.post('/api/horde/reconnect', async (req, res) => {
  try {
    const settings = loadData(DATA_FILES.settings) || {};
    // Fall back to anonymous if no key is stored.
    const apiKey = settings.hordeApiKey ? decrypt(settings.hordeApiKey) : '0000000000';
    console.log('[Horde] Reconnecting with stored key...');
    const result = await llmService.testHordeConnection(apiKey);
    if (result.success) {
      global.hordeModels = result.models;
      if (settings.hordeApiKey) result.maskedKey = maskApiKey(apiKey);
      console.log(`[Horde] Reconnected, ${result.models.length} text models available`);
    }
    res.json(result);
  } catch (error) {
    console.error('[Horde] Reconnection error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get cached AI Horde models
app.get('/api/horde/models', (req, res) => {
  const models = global.hordeModels || [];
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

app.post('/api/personas', mwValidatePersona, async (req, res) => {
  try {
    const newPersona = {
      ...req.body,
      id: uuidv4(),
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
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid persona id' });
    }
    const existingPersona = loadPersona(req.params.id);
    if (!existingPersona) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    const personaToSave = { ...existingPersona, ...req.body, id: req.params.id, updatedAt: Date.now() };
    // Use async version to process images. Explicit user save → sync default personas to factory.
    const savedPersona = await savePersonaAsync(personaToSave, false, true);
    const personas = loadAllPersonas();
    broadcast('personas_update', personas);
    res.json(savedPersona);
  } catch (err) {
    console.error('Error updating persona:', err);
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

app.delete('/api/personas/:id', (req, res) => {
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid persona id' });
  }
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

// --- Trigger Sets (global, button-assignable) ---
app.get('/api/trigger-sets', (req, res) => {
  res.json(loadData(DATA_FILES.triggerSets) || []);
});
// Validate a trigger-set body: triggers must be an array of plausible trigger objects.
function validateTriggerSetBody(body) {
  if (body.triggers !== undefined) {
    if (!Array.isArray(body.triggers)) {
      return 'triggers must be an array';
    }
    for (const t of body.triggers) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        return 'each trigger must be an object';
      }
    }
  }
  return null;
}
app.post('/api/trigger-sets', (req, res) => {
  const err = validateTriggerSetBody(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const sets = loadData(DATA_FILES.triggerSets) || [];
  const newSet = { name: req.body.name || 'New Trigger Set', ...req.body, triggers: req.body.triggers || [], id: uuidv4(), createdAt: Date.now(), updatedAt: Date.now() };
  sets.push(newSet);
  saveData(DATA_FILES.triggerSets, sets);
  broadcast('trigger_sets_update', sets);
  res.json(newSet);
});
app.put('/api/trigger-sets/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid trigger set id' });
  const err = validateTriggerSetBody(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const sets = loadData(DATA_FILES.triggerSets) || [];
  const idx = sets.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Trigger set not found' });
  sets[idx] = { ...sets[idx], ...req.body, id: sets[idx].id, updatedAt: Date.now() };
  saveData(DATA_FILES.triggerSets, sets);
  broadcast('trigger_sets_update', sets);
  res.json(sets[idx]);
});
app.delete('/api/trigger-sets/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid trigger set id' });
  let sets = loadData(DATA_FILES.triggerSets) || [];
  sets = sets.filter(s => s.id !== req.params.id);
  saveData(DATA_FILES.triggerSets, sets);
  broadcast('trigger_sets_update', sets);
  res.json({ success: true });
});
// Fire every trigger in a saved trigger set against the active character/session.
// Shared by the REST endpoint and the flow "Fire Trigger Set" action.
async function fireTriggerSetById(setId) {
  const sets = loadData(DATA_FILES.triggerSets) || [];
  const set = sets.find(s => s.id === setId);
  if (!set) return { error: 'Trigger set not found' };
  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === settings?.activeCharacterId);
  const triggers = set.triggers || [];
  let fired = 0;
  let failed = 0;
  // Wrap each trigger so one bad trigger doesn't abort the whole sequence.
  for (const trigger of triggers) {
    try {
      await executeTrigger(trigger, 'trigger-set', character, settings);
      fired++;
    } catch (tErr) {
      failed++;
      console.error('Error executing trigger in set:', tErr);
    }
  }
  return { name: set.name, fired, failed };
}

// Resolve a block trigger entry: an inline trigger object, or a {setId, triggerId} reference
// into a saved Trigger Set.
function resolveBlockTrigger(t, sets) {
  if (!t) return null;
  if (t.setId && t.triggerId != null && t.triggerId !== '') {
    const arr = sets.find(s => s.id === t.setId)?.triggers || [];
    return arr.find(tr => tr.id === t.triggerId) || arr[Number(t.triggerId)] || null;
  }
  return t.type ? t : null;
}

// ===== Trigger Tree walker (step 2: see plan typed-dazzling-nygaard.md) =====
// One recursive walker for the nested-block scripting model. Re-entrant-safe beside the
// checkpoint loop: it READS live sessionState/eventEngine state and only PRODUCES into the
// shared reply sinks (activeCheckpointInjections push / pendingVerbatimReply append) via
// deliverTreeMsg — it NEVER resets those sinks and never touches firedCheckpointTriggers.
// runNode/runTree return undefined in step 2; the `if (sig) return sig` plumbing reserves a
// control sentinel ({__control:...}) so step-3 player_choice/label/goto slot in with no refactor.
const MAX_TREE_DEPTH = 64;
const MAX_GOTO_ITERS = 10000; // per-frame cap so a pathological goto-loop can't spin forever
const TREE_STUB_TYPES = new Set(['repeat']);

function treeOnceKey(node, ctx) { return `${ctx.treeId}::${ctx.scopeKey}::${node.id}`; }
function treeChildCtx(ctx) { return { ...ctx, depth: ctx.depth + 1 }; }
// Mark a once-node as fired, but only when it has an id (id-less once nodes stay recurring).
function markTreeOnce(node, ctx) { if (node.once && node.id) ctx.firedSet.add(treeOnceKey(node, ctx)); }
// Enter a container's body: returns the depth-bumped child ctx, or null if the body would
// exceed MAX_TREE_DEPTH. When too deep we abort WITHOUT consuming the node's once (its effect —
// running its children — did not happen, so it retries next turn). Marks once only on real entry.
// Routing random's single-child descent through here also bounds runNode->runNode recursion.
function enterChild(node, ctx) {
  const child = treeChildCtx(ctx);
  if (child.depth > MAX_TREE_DEPTH) {
    console.warn(`[runTree] max depth exceeded at node ${node.id} (${node.type}) — aborting subtree, once not consumed`);
    return null;
  }
  markTreeOnce(node, ctx);
  return child;
}

// Latest player/user message text (for keyword gates). Empty string if none yet.
function latestPlayerText() {
  const hist = sessionState.chatHistory || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const m = hist[i];
    if (m && (m.sender === 'user' || m.sender === 'player')) return m.content || m.text || '';
  }
  return '';
}

// Match a keyword-gate/keyword-event node against the latest player message using the
// reminder-engine matcher. Closed (no match) when no keys are defined.
function treeKeywordMatches(node) {
  const keys = node.params?.keys || [];
  if (!keys.length) return false;
  const entry = {
    keys,
    secondaryKeys: node.params?.secondaryKeys || [],
    caseSensitive: !!node.params?.caseSensitive,
    matchWholeWords: node.params?.matchWholeWords !== false,
    logic: node.params?.logic || 'and_any'
  };
  return reminderEngine._matchKeys(entry, latestPlayerText());
}

// Run a single Trigger Tree node. Returns a control sentinel (reserved) or undefined.
async function runNode(node, ctx) {
  // once SKIP gate (the .add happens per-kind once the node is known to run its effect)
  if (node.once) {
    if (!node.id) console.warn(`[runTree] once node missing id (type '${node.type}') — treating as recurring`);
    else if (ctx.firedSet.has(treeOnceKey(node, ctx))) return;
  }

  const type = node.type;
  if (TREE_STUB_TYPES.has(type)) {
    console.log(`[runTree] node type '${type}' not yet implemented (later step) — skipping`);
    return;
  }

  // ----- Control-flow leaves (scope-local label/goto) — before the generic action path -----
  if (type === 'label') return; // pure marker; a goto in the same list targets it. No effect, no once.
  if (type === 'goto') return { __control: 'goto', name: node.params?.name }; // runTree repositions to the label

  // ----- fire_tree: run another library tree as a subroutine (cycle-guarded recursion) -----
  if (type === 'fire_tree') {
    const targetId = node.params?.treeId;
    if (!targetId) { console.warn(`[runTree] fire_tree node ${node.id} has no treeId`); return; }
    if (ctx.visited.has(targetId)) { console.warn(`[runTree] fire_tree cycle: '${targetId}' already on the stack — skipping`); return; } // skip, do not consume once
    const target = (ctx.treeIndex || buildTreeIndex()).get(targetId);
    if (!target || !Array.isArray(target.nodes) || !target.nodes.length) { console.warn(`[runTree] fire_tree target '${targetId}' missing/empty — skipping`); return; }
    if (ctx.depth + 1 > MAX_TREE_DEPTH) { console.warn(`[runTree] fire_tree '${targetId}' exceeds max depth — skipping`); return; }
    markTreeOnce(node, ctx); // firing IS the effect — a once fire_tree fires once per scope
    const child = {
      ...ctx,
      treeId: target.id, // re-root: the fired tree's once-keys live under ITS id
      scopeKey: `${ctx.scopeKey}>fire:${target.id}`, // nested per call-site -> independent once-sets
      depth: ctx.depth + 1, // CONTINUE depth (shared 64 budget bounds acyclic fan-out)
      visited: new Set([...ctx.visited, target.id]), // copy = DFS stack (A>B>A blocked; A>B then A>C allowed)
      source: `tree:${target.id}`,
      labels: new Map() // labels are scope-local — fired tree gets a fresh frame
    };
    return await runTree(target.nodes, child); // inherits delivery/character/settings/firedSet; sentinels bubble
  }

  // ----- fire_flow: escape hatch to the flow engine (fire-and-forget; reuses the button->flow path) -----
  if (type === 'fire_flow') {
    const flowId = node.params?.flowId, label = node.params?.flowActionLabel;
    if (!flowId || !label) { console.warn(`[runTree] fire_flow node ${node.id} needs flowId + flowActionLabel`); return; }
    markTreeOnce(node, ctx); // firing is the effect
    Promise.resolve(handleButtonLinkToFlow({ config: { flowId, flowActionLabel: label } }, ctx.character?.id, `tree:${ctx.treeId}`))
      .catch(e => console.error(`[runTree] fire_flow '${flowId}' failed:`, e?.message || e));
    return; // NOT awaited — flows pace over turns + own their suspend channel; awaiting risks deadlock
  }

  // ----- Actions (leaves) -----
  if (node.kind === 'action') {
    markTreeOnce(node, ctx); // an action always runs its effect
    const p = node.params || {};
    try {
      if (type === 'ai_message') {
        // Delivery depends on context. In-reply (default, mid-turn): weave/verbatim into the
        // reply being built. Standalone (e.g. Session Start, before any reply turn): post
        // immediately like the welcome — executeTrigger's ai_message case handles verbatim
        // (post as-typed) vs enhanced (generate then post). Avoids a double-post mid-turn.
        if (ctx.delivery === 'standalone') {
          await executeTrigger({ type, ...p }, ctx.source, ctx.character, ctx.settings);
        } else {
          deliverTreeMsg(p.context, p.llmEnhance);
        }
      } else if (type === 'set_variable') {
        eventEngine.applySetVariable(p.varType || 'custom', p.variable, p.operation || 'set', p.value); // mirrors fireCheckpointInjectionAction
      } else {
        await executeTrigger({ type, ...p }, ctx.source, ctx.character, ctx.settings);
      }
    } catch (e) {
      console.error(`[runTree] action '${type}' (node ${node.id}) failed:`, e?.message || e);
    }
    return;
  }

  // ----- Containers -----
  if (node.kind === 'container') {
    switch (type) {
      case 'group': {
        const child = enterChild(node, ctx);
        if (!child) return;
        return await runTree(node.children || [], child);
      }

      case 'chance': {
        const pct = Number(node.params?.chance);
        const pass = pct >= 100 ? true : pct <= 0 ? false : (Math.random() * 100 < pct);
        if (!pass) return; // failed roll does NOT consume once — a once+chance keeps rolling until it hits
        const child = enterChild(node, ctx);
        if (!child) return;
        return await runTree(node.children || [], child);
      }

      case 'random': {
        const kids = node.children || [];
        if (!kids.length) return; // nothing to pick — do not consume once
        const child = enterChild(node, ctx);
        if (!child) return;
        const pick = kids[Math.floor(Math.random() * kids.length)];
        return await runNode(pick, child); // single child: its own once/kind/children apply
      }

      case 'if': {
        for (const br of node.children || []) {
          if (!br || br.type !== 'branch') continue;
          if (evalBranch(br)) {
            const child = enterChild(node, ctx); // once on the 'if' consumed only when a branch matched
            if (!child) return;
            return await runTree(br.children || [], child); // first match wins, then fall through
          }
        }
        return; // no branch matched — run nothing, fall through to next sibling
      }

      case 'keyword_gate': {
        if (!treeKeywordMatches(node)) return; // closed gate does not consume once
        const child = enterChild(node, ctx);
        if (!child) return;
        return await runTree(node.children || [], child);
      }

      case 'player_choice': {
        // Re-entrancy guard: if a tree choice is already armed (the walker may re-run before the
        // click), suspend again without clobbering it.
        if (sessionState.pendingTreeChoice) return { __control: 'suspend', reason: 'player_choice' };
        const opts = (node.children || [])
          .filter(c => c && c.kind === 'container' && c.type === 'choice' && c.params?.label)
          .slice(0, 4);
        if (!opts.length) return; // nothing to present — clean fall-through, do not consume once/suspend
        markTreeOnce(node, ctx); // presenting IS the effect; a once choice presents once per session
        sessionState.pendingTreeChoice = {
          choices: opts.map(c => ({ id: c.id, label: c.params.label, body: c.children || [] })),
          ctxSnapshot: {
            treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth + 1,
            delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
          },
          after: null // innermost sibling tail, filled by runTree as the suspend bubbles
        };
        broadcast('checkpoint_choice', { description: node.params?.prompt || '', choices: opts.map(c => ({ id: c.id, label: c.params.label })), tree: true });
        return { __control: 'suspend', reason: 'player_choice' };
      }

      default:
        console.log(`[runTree] unknown container type '${type}' (node ${node.id}) — skipping`);
        return;
    }
  }

  // ----- Events (step-2 partial: only 'keyword' is wired) -----
  if (node.kind === 'event') {
    if (type === 'keyword') {
      if (!treeKeywordMatches(node)) return;
      const child = enterChild(node, ctx);
      if (!child) return;
      return await runTree(node.children || [], child);
    }
    console.log(`[runTree] unhandled event type '${type}' (node ${node.id}) — skipping children`);
    return;
  }

  console.log(`[runTree] unknown node kind '${node.kind}' type '${type}' — skipping`);
}

// Walk a node LIST top-to-bottom (sequence = drag order). One bad node degrades to a skip;
// siblings still run. Index-based so control sentinels can re-position:
//  - {__control:'goto',name}: jump to a 'label' marker IN THIS list (resume after it); if the
//    label isn't here, bubble up to an enclosing frame. Per-frame loop cap via MAX_GOTO_ITERS.
//  - {__control:'suspend'}: a player_choice suspended the turn. Capture THIS list's remaining
//    siblings as the post-choice continuation (innermost frame only — `after == null` guard),
//    then bubble to runTreeScope so the turn ends.
async function runTree(nodes, ctx) {
  if (ctx.depth > MAX_TREE_DEPTH) { console.warn('[runTree] max depth exceeded — aborting subtree'); return; }
  if (!Array.isArray(nodes)) return;
  let i = 0, gotoBudget = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (!node || typeof node !== 'object') { i++; continue; }
    let sig;
    try { sig = await runNode(node, ctx); }
    catch (e) { console.error(`[runTree] node ${node?.id}(${node?.type}) failed:`, e?.message || e); i++; continue; }
    if (sig) {
      if (sig.__control === 'goto') {
        if (!sig.name) { console.warn('[runTree] goto with empty name — skipping'); i++; continue; } // never match a blank label
        const target = nodes.findIndex(n => n && n.kind === 'action' && n.type === 'label' && n.params?.name === sig.name);
        if (target >= 0) {
          if (++gotoBudget > MAX_GOTO_ITERS) { console.warn(`[runTree] goto loop cap hit for '${sig.name}' — aborting frame`); return; }
          i = target + 1; // resume AFTER the label marker
          continue;
        }
        return sig; // label not in THIS list — bubble up to an enclosing frame
      }
      if (sig.__control === 'suspend') {
        // Capture the innermost same-level continuation for post-choice fall-through.
        if (sessionState.pendingTreeChoice && sessionState.pendingTreeChoice.after == null) {
          sessionState.pendingTreeChoice.after = nodes.slice(i + 1);
        }
        return sig;
      }
      return sig; // any other sentinel bubbles unchanged
    }
    i++;
  }
}

// Entry point: run a tree for a given scope. Builds the per-run ctx (firedSet references the
// session once-set so 'once' persists across runs within a session). opts.delivery controls
// ai_message: 'inReply' (default, weave/verbatim into the current reply) or 'standalone'
// (post immediately — used by Session Start, which runs before any reply turn).
async function runTreeScope(tree, scopeKey, character, settings, opts = {}) {
  if (!tree || !Array.isArray(tree.nodes)) return;
  const treeId = tree.id || `inline:${scopeKey || 'default'}`;
  const ctx = {
    character, settings,
    treeId,
    scopeKey: scopeKey || 'default',
    depth: 0,
    delivery: opts.delivery || 'inReply',
    source: `tree:${treeId}`,
    visited: new Set([treeId]), // DFS stack for the fire_tree cycle guard
    treeIndex: opts.treeIndex || null, // per-turn library index for fire_tree hops (null -> lazy buildTreeIndex)
    firedSet: sessionState.firedTreeNodes,
    labels: new Map() // scope-local label/goto frame
  };
  try { await runTree(tree.nodes, ctx); }
  catch (e) { console.error('[runTree] scope failed:', e?.message || e); }
}

// Fire an ordered list of trigger blocks. Sequential blocks fire all their triggers in order;
// random blocks fire exactly one trigger picked at random. Shared by buttons + the flow node.
async function fireTriggerBlocks(blocks, source, character, settings) {
  if (!Array.isArray(blocks)) return;
  const sets = loadData(DATA_FILES.triggerSets) || [];
  for (const block of blocks) {
    if (!block) continue;
    let toFire = (block.triggers || []).map(t => resolveBlockTrigger(t, sets)).filter(Boolean);
    if (block.type === 'random' && toFire.length) toFire = [toFire[Math.floor(Math.random() * toFire.length)]];
    for (const trg of toFire) {
      try { await executeTrigger(trg, source, character, settings); }
      catch (e) { console.error('[TriggerBlocks] trigger failed:', e?.message || e); }
    }
  }
}

app.post('/api/trigger-sets/:id/fire', async (req, res) => {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid trigger set id' });
    const result = await fireTriggerSetById(req.params.id);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ success: true, fired: result.fired, failed: result.failed });
  } catch (err) {
    console.error('Error firing trigger set:', err);
    res.status(500).json({ error: err.message || 'Failed to fire trigger set' });
  }
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
          story.characterCheckpoints = story.characterCheckpoints || {};
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
    const fileName = req.file?.originalname || 'unknown';
    console.error(`[Import] Character card import failed for "${fileName}":`, error.message || error);
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
    if (masked.hordeApiKey) {
      masked.hordeApiKeyMasked = maskApiKey(masked.hordeApiKey);
      masked.hasHordeApiKey = hasApiKey(masked.hordeApiKey);
      masked.hordeApiKey = ''; // Don't send actual key
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
  if (newProfile.hordeApiKey) {
    newProfile.hordeApiKey = encrypt(newProfile.hordeApiKey);
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
  if (req.body.hordeApiKey && req.body.hordeApiKey !== '') {
    profiles[index].hordeApiKey = encrypt(req.body.hordeApiKey);
  } else if (!req.body.hordeApiKey) {
    profiles[index].hordeApiKey = oldProfile.hordeApiKey;
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
  // hordeApiKey stays inside settings.llm (plaintext working copy for generation);
  // also keep an encrypted top-level copy for reconnect/masking.
  if (llmSettings.hordeApiKey) {
    settings.hordeApiKey = encrypt(llmSettings.hordeApiKey);
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
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid character id' });
  }
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

app.post('/api/characters', mwValidateCharacter, async (req, res) => {
  try {
    const newCharacter = {
      ...req.body,
      id: uuidv4(),
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
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid character id' });
    }
    let updatedCharacter;

    if (isPerCharStorageActive()) {
      const existingCharacter = loadCharacter(req.params.id);
      if (!existingCharacter) {
        return res.status(404).json({ error: 'Character not found' });
      }
      const charToSave = { ...existingCharacter, ...req.body, id: req.params.id, updatedAt: Date.now() };
      // Use async version to process images. This is an explicit user save via the
      // editor, so sync default characters back into the git-tracked factory tree.
      updatedCharacter = await saveCharacterAsync(charToSave, false, true);
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
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid character id' });
  }
  // Block deletion of immutable (ships-with-the-app) characters
  const existingChar = (isPerCharStorageActive() ? loadCharacter(req.params.id) : (loadData(DATA_FILES.characters) || []).find(c => c.id === req.params.id));
  if (existingChar?.immutable) {
    return res.status(400).json({ error: 'Cannot delete a built-in character' });
  }
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
      ...req.body,
      id: uuidv4(),
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
      ...req.body,
      id: uuidv4(),
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

// mDNS discovery of local-only smart plugs (Shelly + ESPHome). Tasmota is
// omitted — its mDNS advertising is unreliable, so it is added by IP.
app.post('/api/devices/scan/local', deviceScanLimiter, async (req, res) => {
  let Bonjour;
  try {
    ({ Bonjour } = require('bonjour-service'));
  } catch {
    return res.status(500).json({ error: 'bonjour-service not installed' });
  }
  try {
    const found = new Map();
    const bonjour = new Bonjour();
    const collect = (brand) => (service) => {
      const ip = (service.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      if (ip && !found.has(ip)) {
        found.set(ip, { ip, brand, name: service.name || service.host || ip });
      }
    };
    const browsers = [
      bonjour.find({ type: 'shelly' }, collect('shelly')),
      bonjour.find({ type: 'esphomelib' }, collect('esphome')),
    ];
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      browsers.forEach((b) => { if (b && b.stop) b.stop(); });
      bonjour.destroy();
    } catch {}
    res.json({ devices: [...found.values()] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices', (req, res) => {
  const devices = loadData(DATA_FILES.devices) || [];
  const newDevice = {
    ...req.body,
    id: uuidv4(),
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
        } else if (device.brand === 'homeassistant') {
          // Home Assistant devices - try to get power state
          const state = await haService.getPowerState(device.deviceId);
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
    } else if (brand === 'kasa-klap') {
      device = { ip: deviceIdOrIp, brand: 'kasa-klap' };
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
    } else if (brand === 'kasa-klap') {
      device = { ip: deviceIdOrIp, brand: 'kasa-klap' };
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
    } else if (brand === 'kasa-klap') {
      device = { ip: deviceIdOrIp, brand: 'kasa-klap' };
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

// --- Kasa 1.1.x+ (TP-Link Kasa devices on KLAP firmware) ---

// Connect to Kasa 1.1.x+ (save credentials)
app.post('/api/kasa-klap/connect', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  kasaKlapService.setCredentials(email, password);

  try {
    const success = await kasaKlapService.testConnection();

    if (success) {
      // Save encrypted credentials to settings
      const settings = loadData(DATA_FILES.settings) || {};
      settings.kasaKlapEmail = encrypt(email);
      settings.kasaKlapPassword = encrypt(password);
      saveData(DATA_FILES.settings, settings);
      console.log('[Kasa 1.1.x+] Credentials saved and connection verified');
      res.json({ success: true, message: 'Connected to Kasa 1.1.x+' });
    } else {
      kasaKlapService.clearCredentials();
      res.status(401).json({ error: 'Invalid credentials or connection failed' });
    }
  } catch (error) {
    console.error('[Kasa 1.1.x+] Connect error:', error);
    kasaKlapService.clearCredentials();
    res.status(401).json({ error: error.message || 'Connection failed' });
  }
});

// Check Kasa 1.1.x+ connection status
app.get('/api/kasa-klap/status', (req, res) => {
  res.json({ connected: kasaKlapService.isConnected() });
});

// Disconnect from Kasa 1.1.x+ (clear credentials)
app.post('/api/kasa-klap/disconnect', (req, res) => {
  kasaKlapService.clearCredentials();
  // Remove from settings
  const settings = loadData(DATA_FILES.settings) || {};
  delete settings.kasaKlapEmail;
  delete settings.kasaKlapPassword;
  saveData(DATA_FILES.settings, settings);
  console.log('[Kasa 1.1.x+] Credentials cleared');
  res.json({ success: true, message: 'Disconnected from Kasa 1.1.x+' });
});

// Discover Kasa 1.1.x+ devices on the local network
app.get('/api/kasa-klap/devices', async (req, res) => {
  if (!kasaKlapService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Kasa 1.1.x+' });
  }

  try {
    const timeout = parseInt(req.query.timeout, 10) || 5;
    const devices = await kasaKlapService.listDevices(timeout);
    res.json({ devices });
  } catch (error) {
    console.error('[Kasa 1.1.x+] Failed to discover devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Kasa 1.1.x+ device info by IP
app.get('/api/kasa-klap/devices/:ip/info', async (req, res) => {
  const { ip } = req.params;

  if (!kasaKlapService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Kasa 1.1.x+' });
  }

  try {
    const info = await kasaKlapService.getDeviceInfo(ip);
    res.json(info);
  } catch (error) {
    console.error('[Kasa 1.1.x+] Failed to get device info:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Kasa 1.1.x+ device on
app.post('/api/kasa-klap/devices/:ip/on', async (req, res) => {
  const { ip } = req.params;

  if (!kasaKlapService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Kasa 1.1.x+' });
  }

  try {
    await kasaKlapService.turnOn(ip);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[Kasa 1.1.x+] Failed to turn on device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Kasa 1.1.x+ device off
app.post('/api/kasa-klap/devices/:ip/off', async (req, res) => {
  const { ip } = req.params;

  if (!kasaKlapService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Kasa 1.1.x+' });
  }

  try {
    await kasaKlapService.turnOff(ip);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[Kasa 1.1.x+] Failed to turn off device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Kasa 1.1.x+ device state
app.get('/api/kasa-klap/devices/:ip/state', async (req, res) => {
  const { ip } = req.params;

  if (!kasaKlapService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Kasa 1.1.x+' });
  }

  try {
    const state = await kasaKlapService.getPowerState(ip);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[Kasa 1.1.x+] Failed to get device state:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================================
// Home Assistant API Routes
// ==============================================

// Connect to Home Assistant (save URL + token)
app.post('/api/homeassistant/connect', async (req, res) => {
  const { url, token } = req.body;
  if (!url || !token) {
    return res.status(400).json({ error: 'URL and token required' });
  }

  haService.setCredentials(url, token);

  try {
    const success = await haService.testConnection();

    if (success) {
      const settings = loadData(DATA_FILES.settings) || {};
      settings.haUrl = url;
      settings.haToken = encrypt(token);
      saveData(DATA_FILES.settings, settings);
      console.log('[HomeAssistant] Connected and credentials saved');
      res.json({ success: true, message: 'Connected to Home Assistant' });
    } else {
      haService.clearCredentials();
      res.status(401).json({ error: 'Connection failed - check URL and token' });
    }
  } catch (error) {
    console.error('[HomeAssistant] Connect error:', error);
    haService.clearCredentials();
    res.status(401).json({ error: error.message || 'Connection failed' });
  }
});

// Check Home Assistant connection status
app.get('/api/homeassistant/status', (req, res) => {
  res.json({ connected: haService.isConnected() });
});

// Disconnect from Home Assistant
app.post('/api/homeassistant/disconnect', (req, res) => {
  haService.clearCredentials();
  const settings = loadData(DATA_FILES.settings) || {};
  delete settings.haUrl;
  delete settings.haToken;
  saveData(DATA_FILES.settings, settings);
  console.log('[HomeAssistant] Credentials cleared');
  res.json({ success: true, message: 'Disconnected from Home Assistant' });
});

// List Home Assistant switch entities
app.get('/api/homeassistant/devices', async (req, res) => {
  if (!haService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Home Assistant' });
  }

  try {
    const devices = await haService.listDevices();
    res.json({ devices });
  } catch (error) {
    console.error('[HomeAssistant] Failed to list devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Home Assistant entity info
app.get('/api/homeassistant/devices/:entityId/info', async (req, res) => {
  if (!haService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Home Assistant' });
  }

  try {
    const info = await haService.getEntityInfo(req.params.entityId);
    res.json(info);
  } catch (error) {
    console.error('[HomeAssistant] Failed to get entity info:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Home Assistant entity on
app.post('/api/homeassistant/devices/:entityId/on', async (req, res) => {
  if (!haService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Home Assistant' });
  }

  try {
    await haService.turnOn(req.params.entityId);
    res.json({ success: true, state: 'on' });
  } catch (error) {
    console.error('[HomeAssistant] Failed to turn on entity:', error);
    res.status(500).json({ error: error.message });
  }
});

// Turn Home Assistant entity off
app.post('/api/homeassistant/devices/:entityId/off', async (req, res) => {
  if (!haService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Home Assistant' });
  }

  try {
    await haService.turnOff(req.params.entityId);
    res.json({ success: true, state: 'off' });
  } catch (error) {
    console.error('[HomeAssistant] Failed to turn off entity:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Home Assistant entity state
app.get('/api/homeassistant/devices/:entityId/state', async (req, res) => {
  if (!haService.isConnected()) {
    return res.status(401).json({ error: 'Not connected to Home Assistant' });
  }

  try {
    const state = await haService.getPowerState(req.params.entityId);
    res.json({ state, relay_state: state === 'on' ? 1 : 0 });
  } catch (error) {
    console.error('[HomeAssistant] Failed to get entity state:', error);
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

  // 1. IMMEDIATELY abort all LLM requests (highest priority — stops token generation)
  results.llm = { aborted: llmService.abortAllRequests() };
  aiDeviceControl.clearAllLlmTimers(deviceService);

  // 2. Halt all flow execution
  if (eventEngine) {
    results.flows = eventEngine.emergencyStop();
  }

  // 3. Stop ALL pump runtime tracking intervals
  deviceService.stopAllPumpRuntimeTracking();
  stopCharacterInflation();
  clearAllServerTimedPumpTimers();
  stopPumpSafetyWatchdog();

  // 4. Stop ALL devices (including cycles) CONCURRENTLY with per-device timeout,
  //    confirming each turn-off and reporting each device's REAL status.
  const devices = loadData(DATA_FILES.devices) || [];
  const stopResults = await stopAllDevicesConcurrently(devices, '[EMERGENCY STOP]');
  for (const r of stopResults) {
    results.devices.push({
      id: resolveControlId(r.device),
      name: r.name,
      success: r.ok,
      confirmed: r.confirmed,
      error: r.ok ? undefined : r.error
    });
    if (r.ok) {
      console.log(`[EMERGENCY STOP] Stopped device: ${r.name}`);
    } else {
      console.error(`[EMERGENCY STOP] Failed to stop device ${r.name}: ${r.error}`);
    }
  }

  if (devices.length === 0) {
    console.log('[EMERGENCY STOP] No devices configured to stop');
  }

  const allOk = results.devices.every(d => d.success);
  broadcast('emergency_stop', { timestamp: Date.now(), results });
  res.json({ success: allOk, message: 'Emergency stop executed', results });
});

// --- Checkpoint Profiles ---

const CHECKPOINT_PROFILES_PATH = path.join(DATA_DIR, 'checkpoint-profiles.json');

function loadCheckpointProfiles() {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PROFILES_PATH, 'utf8'));
  } catch (e) {
    return { player: [], character: [] };
  }
}

function saveCheckpointProfiles(profiles) {
  fs.writeFileSync(CHECKPOINT_PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

app.get('/api/checkpoint-profiles', (req, res) => {
  res.json(loadCheckpointProfiles());
});

app.post('/api/checkpoint-profiles', (req, res) => {
  const { type, name, checkpoints, checkpointTriggers } = req.body;
  if (!type || !name || !checkpoints) {
    return res.status(400).json({ error: 'type, name, and checkpoints required' });
  }
  const profiles = loadCheckpointProfiles();
  if (!profiles[type]) profiles[type] = [];
  const id = `${type}-${Date.now()}`;
  const entry = { id, name, builtIn: false, checkpoints };
  if (checkpointTriggers) entry.checkpointTriggers = checkpointTriggers;
  profiles[type].push(entry);
  saveCheckpointProfiles(profiles);
  res.json({ success: true, id });
});

app.put('/api/checkpoint-profiles/:id', (req, res) => {
  const { type, name, checkpoints, checkpointTriggers } = req.body;
  const profiles = loadCheckpointProfiles();
  if (!profiles[type]) return res.status(404).json({ error: 'Profile type not found' });
  const idx = profiles[type].findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  if (profiles[type][idx].builtIn) return res.status(400).json({ error: 'Cannot modify built-in profiles' });
  if (name) profiles[type][idx].name = name;
  if (checkpoints) profiles[type][idx].checkpoints = checkpoints;
  if (checkpointTriggers !== undefined) profiles[type][idx].checkpointTriggers = checkpointTriggers;
  saveCheckpointProfiles(profiles);
  res.json({ success: true });
});

app.delete('/api/checkpoint-profiles/:id', (req, res) => {
  const { type } = req.query;
  const profiles = loadCheckpointProfiles();
  if (!profiles[type]) return res.status(404).json({ error: 'Profile type not found' });
  const idx = profiles[type].findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  if (profiles[type][idx].builtIn) return res.status(400).json({ error: 'Cannot delete built-in profiles' });
  profiles[type].splice(idx, 1);
  saveCheckpointProfiles(profiles);
  res.json({ success: true });
});

// --- Instructor Profiles (named system-prompt briefs assignable to Instructor cards) ---
// loadInstructorProfiles/saveInstructorProfiles are declared near buildInstructorSystemPrompt.

app.get('/api/instructor-profiles', (req, res) => {
  res.json(loadInstructorProfiles());
});

app.post('/api/instructor-profiles', (req, res) => {
  const { name, prompt } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name required' });
  }
  const data = loadInstructorProfiles();
  if (!Array.isArray(data.profiles)) data.profiles = [];
  const id = `instr-${Date.now()}`;
  data.profiles.push({ id, name, prompt: prompt || '', builtIn: false });
  saveInstructorProfiles(data);
  res.json({ success: true, id });
});

app.put('/api/instructor-profiles/:id', (req, res) => {
  const { name, prompt } = req.body;
  const data = loadInstructorProfiles();
  const idx = (data.profiles || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  if (data.profiles[idx].builtIn) return res.status(400).json({ error: 'Cannot modify built-in profiles' });
  if (name !== undefined) data.profiles[idx].name = name;
  if (prompt !== undefined) data.profiles[idx].prompt = prompt;
  saveInstructorProfiles(data);
  res.json({ success: true });
});

app.delete('/api/instructor-profiles/:id', (req, res) => {
  const data = loadInstructorProfiles();
  const idx = (data.profiles || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  if (data.profiles[idx].builtIn) return res.status(400).json({ error: 'Cannot delete built-in profiles' });
  data.profiles.splice(idx, 1);
  saveInstructorProfiles(data);
  res.json({ success: true });
});

// --- Instructor Library (keyword-triggered term groups assignable to Instructor cards) ---
// loadInstructorLibrary/saveInstructorLibrary are declared near buildInstructorSystemPrompt.

app.get('/api/instructor-library', (req, res) => {
  res.json(loadInstructorLibrary());
});

app.post('/api/instructor-library', (req, res) => {
  const { name, terms } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name required' });
  }
  const data = loadInstructorLibrary();
  if (!Array.isArray(data.groups)) data.groups = [];
  const id = `lib-${Date.now()}`;
  data.groups.push({ id, name, terms: Array.isArray(terms) ? terms : [] });
  saveInstructorLibrary(data);
  res.json({ success: true, id });
});

app.put('/api/instructor-library/:id', (req, res) => {
  const { name, terms } = req.body;
  const data = loadInstructorLibrary();
  const idx = (data.groups || []).findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Term group not found' });
  if (name !== undefined) data.groups[idx].name = name;
  if (terms !== undefined) data.groups[idx].terms = Array.isArray(terms) ? terms : [];
  saveInstructorLibrary(data);
  res.json({ success: true });
});

app.delete('/api/instructor-library/:id', (req, res) => {
  const data = loadInstructorLibrary();
  const idx = (data.groups || []).findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Term group not found' });
  data.groups.splice(idx, 1);
  saveInstructorLibrary(data);
  res.json({ success: true });
});

// --- Global Dictionary (always-on, global term definitions) ---
// loadDictionary/saveDictionary are declared near buildDictionaryPrompt.

app.get('/api/dictionary', (req, res) => {
  res.json(loadDictionary());
});

app.post('/api/dictionary', (req, res) => {
  const { name, terms, enabled } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name required' });
  }
  const data = loadDictionary();
  if (!Array.isArray(data.groups)) data.groups = [];
  const id = `dict-${Date.now()}`;
  data.groups.push({ id, name, enabled: enabled !== false, terms: Array.isArray(terms) ? terms : [] });
  saveDictionary(data);
  res.json({ success: true, id });
});

// Import a SillyTavern World Info / character_book JSON as a new Dictionary book.
app.post('/api/dictionary/import', (req, res) => {
  try {
    let { json, name } = req.body;
    if (typeof json === 'string') json = JSON.parse(json);
    const entries = convertSillyTavernLorebook(json);
    if (!entries.length) return res.status(400).json({ error: 'No importable entries found' });
    const data = loadDictionary();
    if (!Array.isArray(data.groups)) data.groups = [];
    const id = `dict-${Date.now()}`;
    data.groups.push({ id, name: (name && String(name).trim()) || 'Imported Lorebook', enabled: true, terms: entries });
    saveDictionary(data);
    res.json({ success: true, id, count: entries.length });
  } catch (e) {
    res.status(400).json({ error: `Import failed: ${e.message}` });
  }
});

app.put('/api/dictionary/:id', (req, res) => {
  const { name, terms, enabled } = req.body;
  const data = loadDictionary();
  const idx = (data.groups || []).findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Term group not found' });
  if (name !== undefined) data.groups[idx].name = name;
  if (terms !== undefined) data.groups[idx].terms = Array.isArray(terms) ? terms : [];
  if (enabled !== undefined) data.groups[idx].enabled = enabled;
  saveDictionary(data);
  res.json({ success: true });
});

app.delete('/api/dictionary/:id', (req, res) => {
  const data = loadDictionary();
  const idx = (data.groups || []).findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Term group not found' });
  data.groups.splice(idx, 1);
  saveDictionary(data);
  res.json({ success: true });
});

// --- Trigger Trees (global library — nested-block scripting; see plan typed-dazzling-nygaard.md) ---
const TRIGGER_TREES_PATH = path.join(DATA_DIR, 'trigger-trees.json');
function loadTriggerTrees() {
  try { return JSON.parse(fs.readFileSync(TRIGGER_TREES_PATH, 'utf8')); } catch (e) { return { trees: [] }; }
}
function saveTriggerTrees(data) { fs.writeFileSync(TRIGGER_TREES_PATH, JSON.stringify(data, null, 2)); }

app.get('/api/trigger-trees', (req, res) => res.json(loadTriggerTrees()));

app.post('/api/trigger-trees', (req, res) => {
  const { name, nodes, tag, source } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  const data = loadTriggerTrees();
  if (!Array.isArray(data.trees)) data.trees = [];
  const id = `tree-${Date.now()}`;
  data.trees.push({ id, name, tag: tag || '', source: source || '', builtIn: false, nodes: Array.isArray(nodes) ? nodes : [] });
  saveTriggerTrees(data);
  res.json({ success: true, id });
});

app.put('/api/trigger-trees/:id', (req, res) => {
  const { name, nodes, tag, source } = req.body;
  const data = loadTriggerTrees();
  const idx = (data.trees || []).findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tree not found' });
  if (data.trees[idx].builtIn) return res.status(400).json({ error: 'Cannot modify built-in trees' });
  if (name !== undefined) data.trees[idx].name = name;
  if (nodes !== undefined) data.trees[idx].nodes = Array.isArray(nodes) ? nodes : [];
  if (tag !== undefined) data.trees[idx].tag = tag;
  if (source !== undefined) data.trees[idx].source = source;
  saveTriggerTrees(data);
  res.json({ success: true });
});

app.delete('/api/trigger-trees/:id', (req, res) => {
  const data = loadTriggerTrees();
  const idx = (data.trees || []).findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tree not found' });
  if (data.trees[idx].builtIn) return res.status(400).json({ error: 'Cannot delete built-in trees' });
  data.trees.splice(idx, 1);
  saveTriggerTrees(data);
  res.json({ success: true });
});

// --- Trigger Tree export / import (portability with fire_tree transitive closure + dedup) ---

// Collect fire_tree targetIds + fire_flow flowIds referenced anywhere in a node tree.
function collectTreeRefs(nodes, treeIds, flowIds) {
  for (const n of (nodes || [])) {
    if (!n) continue;
    if (n.type === 'fire_tree' && n.params?.treeId) treeIds.add(n.params.treeId);
    if (n.type === 'fire_flow' && n.params?.flowId) flowIds.add(n.params.flowId);
    if (n.children) collectTreeRefs(n.children, treeIds, flowIds);
  }
}

// Deterministic content hash of a tree's NODES (volatile node.id stripped; goto/label identity
// is the NAME in params, which IS hashed). name/tag/source excluded so a re-tagged twin dedups.
function sortKeysDeep(o) {
  if (Array.isArray(o)) return o.map(sortKeysDeep);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).sort()) r[k] = sortKeysDeep(o[k]); return r; }
  return o;
}
function canonNodes(nodes) {
  return (nodes || []).map(n => ({ kind: n.kind, type: n.type, once: !!n.once, params: sortKeysDeep(n.params || {}), children: canonNodes(n.children) }));
}
function treeContentHash(tree) {
  return require('crypto').createHash('sha256').update(JSON.stringify(canonNodes(tree.nodes))).digest('hex');
}

// Rewrite fire_tree refs through an old->new id map (only embedded deps; builtin/external unchanged).
function remapTreeRefs(nodes, idMap) {
  return (nodes || []).map(n => {
    let params = n.params;
    if (n.type === 'fire_tree' && n.params?.treeId && idMap.has(n.params.treeId)) params = { ...n.params, treeId: idMap.get(n.params.treeId) };
    return { ...n, params, children: n.children ? remapTreeRefs(n.children, idMap) : n.children };
  });
}

// Export a tree + its transitive fire_tree closure. Built-in deps are listed (never embedded);
// fire_flow flowIds are listed (flows have their own export pipeline, not bundled here).
app.get('/api/trigger-trees/:id/export', (req, res) => {
  const data = loadTriggerTrees();
  const byId = new Map((data.trees || []).map(t => [t.id, t]));
  const root = byId.get(req.params.id);
  if (!root) return res.status(404).json({ error: 'Tree not found' });
  const trees = [], requiresBuiltIns = new Set(), flowRefs = new Set(), visited = new Set();
  const walk = (tree) => {
    if (!tree || visited.has(tree.id)) return;
    visited.add(tree.id);
    trees.push(tree);
    const tids = new Set(), fids = new Set();
    collectTreeRefs(tree.nodes, tids, fids);
    fids.forEach(f => flowRefs.add(f));
    for (const tid of tids) {
      const dep = byId.get(tid);
      if (!dep) continue;
      if (dep.builtIn) { requiresBuiltIns.add(dep.id); continue; } // ships with app — never embed
      walk(dep);
    }
  };
  walk(root);
  res.json({ format: 'swelldreams-trigger-tree', version: 1, rootId: root.id, trees, requiresBuiltIns: [...requiresBuiltIns], flowRefs: [...flowRefs] });
});

// Import an envelope into the recipient library: fresh ids, content-dedup (reuse identical
// trees), fire_tree refs rewritten, built-in refs left to re-link by their stable id. Processes
// in DEPENDENCY ORDER so a shared subtree dedups before its parents are hashed.
app.post('/api/trigger-trees/import', (req, res) => {
  const env = req.body;
  if (!env || env.format !== 'swelldreams-trigger-tree' || !Array.isArray(env.trees)) return res.status(400).json({ error: 'Invalid envelope' });
  const data = loadTriggerTrees();
  if (!Array.isArray(data.trees)) data.trees = [];
  const localByHash = new Map();
  for (const t of data.trees) if (!t.builtIn) localByHash.set(treeContentHash(t), t.id);

  const envById = new Map(env.trees.map(t => [t.id, t]));
  const order = [], seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return; seen.add(id);
    const t = envById.get(id); if (!t) return;
    const deps = new Set(), fl = new Set(); collectTreeRefs(t.nodes, deps, fl);
    for (const d of deps) if (envById.has(d)) visit(d); // deps (leaves) first
    order.push(t);
  };
  for (const t of env.trees) visit(t.id);

  const idMap = new Map(); // envelope id -> local id
  let added = 0, reused = 0;
  for (const t of order) {
    const rewritten = remapTreeRefs(t.nodes, idMap); // deps already have local ids
    const hash = treeContentHash({ nodes: rewritten });
    const existing = localByHash.get(hash);
    if (existing) { idMap.set(t.id, existing); reused++; continue; }
    const newId = `tree-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    data.trees.push({ id: newId, name: t.name || 'Imported Tree', tag: t.tag || '', source: t.source || 'imported', builtIn: false, nodes: rewritten });
    localByHash.set(hash, newId);
    idMap.set(t.id, newId);
    added++;
  }
  saveTriggerTrees(data);
  const missingBuiltIns = (env.requiresBuiltIns || []).filter(id => !data.trees.some(t => t.id === id));
  res.json({ success: true, rootId: idMap.get(env.rootId) || null, added, reused, missingBuiltIns, flowRefs: env.flowRefs || [] });
});

// (GC step 6) Removed the temp POST /api/trigger-trees/:id/run smoke endpoint — the walker,
// scopes, player_choice, fire_tree, and export/import are all shipped + verified.

// --- Persona Checkpoint Profiles (separate from character profiles) ---

const PERSONA_CHECKPOINT_PROFILES_PATH = path.join(DATA_DIR, 'persona-checkpoint-profiles.json');

function loadPersonaCheckpointProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PERSONA_CHECKPOINT_PROFILES_PATH, 'utf8'));
  } catch (e) {
    return { player: [], character: [] };
  }
}

function savePersonaCheckpointProfiles(profiles) {
  fs.writeFileSync(PERSONA_CHECKPOINT_PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

app.get('/api/persona-checkpoint-profiles', (req, res) => {
  res.json(loadPersonaCheckpointProfiles());
});

app.post('/api/persona-checkpoint-profiles', (req, res) => {
  const { type, name, checkpoints, checkpointTriggers } = req.body;
  if (!type || !name || !checkpoints) {
    return res.status(400).json({ error: 'type, name, and checkpoints required' });
  }
  const profiles = loadPersonaCheckpointProfiles();
  if (!profiles[type]) profiles[type] = [];
  const id = `persona-${type}-${Date.now()}`;
  const entry = { id, name, builtIn: false, checkpoints };
  if (checkpointTriggers) entry.checkpointTriggers = checkpointTriggers;
  profiles[type].push(entry);
  savePersonaCheckpointProfiles(profiles);
  res.json({ success: true, id });
});

app.put('/api/persona-checkpoint-profiles/:id', (req, res) => {
  const { type, name, checkpoints, checkpointTriggers } = req.body;
  const profiles = loadPersonaCheckpointProfiles();
  if (!profiles[type]) return res.status(404).json({ error: 'Profile type not found' });
  const idx = profiles[type].findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  if (profiles[type][idx].builtIn) return res.status(400).json({ error: 'Cannot modify built-in profiles' });
  if (name) profiles[type][idx].name = name;
  if (checkpoints) profiles[type][idx].checkpoints = checkpoints;
  if (checkpointTriggers !== undefined) profiles[type][idx].checkpointTriggers = checkpointTriggers;
  savePersonaCheckpointProfiles(profiles);
  res.json({ success: true });
});

app.delete('/api/persona-checkpoint-profiles/:id', (req, res) => {
  const { type } = req.query;
  const profiles = loadPersonaCheckpointProfiles();
  if (!profiles[type]) return res.status(404).json({ error: 'Profile type not found' });
  const idx = profiles[type].findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  if (profiles[type][idx].builtIn) return res.status(400).json({ error: 'Cannot delete built-in profiles' });
  profiles[type].splice(idx, 1);
  savePersonaCheckpointProfiles(profiles);
  res.json({ success: true });
});

// --- Display Settings (Skins) ---

const DISPLAY_SETTINGS_PATH = path.join(DATA_DIR, 'display-settings.json');
const SKINS_DIR = path.join(DATA_DIR, 'skins');
if (!fs.existsSync(SKINS_DIR)) {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
}

const DEFAULT_SKIN = {
  id: 'swelldreams-default',
  name: 'SwellDreams',
  builtIn: true,
  backgroundImage: '/assets/chat-bg.png',
  playerOutlineColor: '#00ff88',
  playerBubbleBg: 'rgba(31, 41, 55, 0.75)',
  playerTextColor: '#f3f4f6',
  playerFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  playerFontSize: 16,
  charOutlineColor: '#ff6b6b',
  charBubbleBg: 'rgba(22, 33, 62, 0.75)',
  charTextColor: '#ffffff',
  charFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  charFontSize: 16,
  systemOutlineColor: 'rgba(100, 149, 237, 0.5)',
  systemBubbleBg: 'rgba(30, 60, 114, 0.85)',
  systemTextColor: 'rgba(200, 220, 255, 0.95)',
  systemFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  systemFontSize: 14,
  uiHeaderColor: 'linear-gradient(180deg, #1e2a4a 0%, #16213e 40%, #0d1526 100%)',
  uiTabColor: 'linear-gradient(180deg, #2a2d31 0%, #1a1c1f 100%)',
  uiModalBg: '',
  uiModalBgImage: '/assets/card-bg.png',
  uiSystemFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  inputBoxBg: 'linear-gradient(180deg, #3d4147 0%, #2d3036 20%, #1a1d21 40%, #0d0f12 60%, #1a1d21 80%, #2d3036 100%)',
  inputBoxFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  inputBoxTextColor: '#ffffff',
  inputBoxFontSize: 16,
  inputButtonFaceColor: 'linear-gradient(180deg, #1a1d21 0%, #0d0f12 30%, #1a1d21 50%, #0d0f12 70%, #1a1d21 100%)',
  historyArrowColor: '#8b9099',
  frameBtnFaceColor: 'linear-gradient(180deg, #1a1d21 0%, #0d0f12 30%, #1a1d21 50%, #0d0f12 70%, #1a1d21 100%)',
  frameBtnTextColor: '#8b9099',
  charActionMenuBg: 'linear-gradient(180deg, #1a1d21 0%, #0d0f12 20%, #1a1d21 100%)',
  charActionBtnFace: 'linear-gradient(180deg, #3d4147 0%, #2d3036 50%, #1a1d21 100%)',
  charActionBtnText: '#ffffff',
  personaActionMenuBg: '',
  personaActionBtnFace: 'linear-gradient(180deg, #3d4147 0%, #2d3036 50%, #1a1d21 100%)',
  personaActionBtnText: '#ffffff',
  leftSidebarBg: '',
  leftSidebarBgImage: '/assets/sidebar-bg-left.png',
  rightSidebarBg: '',
  rightSidebarBgImage: '/assets/sidebar-bg-right.png',
  trimTopperColor: '',
  trimCenterColor: '',
  trimFooterColor: '',
  nameBackingTransparent: true,
  nameBackingColor: '#1a1d21',
  uiHeaderTextColor: '#f3f4f6',
  uiSectionHeaderColor: '',
  uiSectionBgColor: '',
  uiSectionFontColor: '',
  uiCentralMenuBg: '',
  uiCentralMenuTransparent: true,
  uiSelectorDescFontColor: '',
  sceneDetailsBg: 'transparent',
  sceneDetailsText: '#1a1d21',
  sceneDetailsFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  sceneDetailsFontSize: 14,
  pumpableColor: '#dc2626',
  actionTextColor: '#c4a0e8'
};

const BUILTIN_SKINS = [
  DEFAULT_SKIN,
  {
    id: 'skin-moonlit-embrace',
    name: 'Moonlit Embrace',
    builtIn: true,
    backgroundImage: '/api/skins/luna-bg.png',
    playerOutlineColor: '#e8a0d0',
    playerBubbleBg: 'rgba(60, 30, 55, 0.85)',
    playerTextColor: '#f5e0f0',
    playerFont: 'Georgia, "Times New Roman", serif',
    playerFontSize: 16,
    charOutlineColor: '#c8a0e8',
    charBubbleBg: 'rgba(40, 25, 60, 0.85)',
    charTextColor: '#f0e0f8',
    charFont: 'Georgia, "Times New Roman", serif',
    charFontSize: 16,
    systemOutlineColor: 'rgba(200, 160, 220, 0.5)',
    systemBubbleBg: 'rgba(50, 25, 55, 0.85)',
    systemTextColor: 'rgba(230, 210, 240, 0.95)',
    systemFont: 'Georgia, "Times New Roman", serif',
    systemFontSize: 14,
    uiHeaderColor: 'linear-gradient(180deg, #3a1a3a 0%, #2a1030 40%, #1a0820 100%)',
    uiHeaderTextColor: '#e8c0e0',
    uiTabColor: 'linear-gradient(180deg, #3a2040 0%, #2a1530 100%)',
    uiSectionHeaderColor: 'linear-gradient(0deg, #1a0820 0%, #2a1030 60%, #3a1a3a 100%)',
    uiSectionBgColor: '#f8e8f4',
    uiSectionFontColor: '#3a1a3a',
    uiCentralMenuBg: '#1a0820',
    uiCentralMenuTransparent: false,
    uiSelectorDescFontColor: '#c8a0c0',
    uiModalBg: '',
    uiModalBgImage: '',
    uiSystemFont: 'Georgia, "Times New Roman", serif',
    inputBoxBg: 'linear-gradient(180deg, #3a2040 0%, #2a1530 30%, #1a0820 60%, #2a1530 100%)',
    inputBoxFont: 'Georgia, "Times New Roman", serif',
    inputBoxTextColor: '#f5e0f0',
    inputBoxFontSize: 16,
    inputButtonFaceColor: 'linear-gradient(180deg, #2a1530 0%, #1a0820 50%, #2a1530 100%)',
    historyArrowColor: '#9a7090',
    frameBtnFaceColor: 'linear-gradient(180deg, #2a1530 0%, #1a0820 50%, #2a1530 100%)',
    frameBtnTextColor: '#9a7090',
    charActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    charActionBtnFace: 'linear-gradient(180deg, #3a2540 0%, #2a1530 50%, #1a0820 100%)',
    charActionBtnText: '#f0e0f8',
    personaActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    personaActionBtnFace: 'linear-gradient(180deg, #3a2540 0%, #2a1530 50%, #1a0820 100%)',
    personaActionBtnText: '#f5e0f0',
    leftSidebarBg: '#1a0820',
    leftSidebarBgImage: '/api/skins/luna-l.png',
    rightSidebarBg: '#1a0820',
    rightSidebarBgImage: '/api/skins/luna-r.png',
    trimTopperColor: '#3a1a3a',
    trimCenterColor: '#2a1030',
    trimFooterColor: '#3a1a3a',
    nameBackingTransparent: false,
    nameBackingColor: 'rgba(40, 15, 40, 0.85)',
    sceneDetailsBg: 'rgba(40, 15, 40, 0.7)',
    sceneDetailsText: '#d8b8d0',
    sceneDetailsFont: 'Georgia, "Times New Roman", serif',
    sceneDetailsFontSize: 13,
    pumpableColor: '#e8a0d0',
    actionTextColor: '#d4a0f0',
    bubbleOpacity: 0.75
  },
  {
    id: 'skin-red-room',
    name: 'The Red Room',
    builtIn: true,
    backgroundImage: '/api/skins/scarlett-bg.jpeg',
    playerOutlineColor: '#888888',
    playerBubbleBg: 'rgba(25, 20, 20, 0.9)',
    playerTextColor: '#d0d0d0',
    playerFont: '"Segoe UI", Roboto, sans-serif',
    playerFontSize: 15,
    charOutlineColor: '#cc2222',
    charBubbleBg: 'rgba(40, 10, 10, 0.9)',
    charTextColor: '#f0c8c8',
    charFont: '"Segoe UI", Roboto, sans-serif',
    charFontSize: 15,
    systemOutlineColor: 'rgba(150, 50, 50, 0.5)',
    systemBubbleBg: 'rgba(35, 10, 10, 0.85)',
    systemTextColor: 'rgba(220, 180, 180, 0.95)',
    systemFont: '"Segoe UI", Roboto, sans-serif',
    systemFontSize: 14,
    uiHeaderColor: 'linear-gradient(180deg, #2a0a0a 0%, #1a0505 40%, #0d0202 100%)',
    uiHeaderTextColor: '#cc8888',
    uiTabColor: 'linear-gradient(180deg, #2a1010 0%, #1a0808 100%)',
    uiSectionHeaderColor: 'linear-gradient(0deg, #0d0202 0%, #1a0505 60%, #2a0a0a 100%)',
    uiSectionBgColor: '#f0e0e0',
    uiSectionFontColor: '#2a0a0a',
    uiCentralMenuBg: '#0d0202',
    uiCentralMenuTransparent: false,
    uiSelectorDescFontColor: '#aa6666',
    uiModalBg: '',
    uiModalBgImage: '',
    uiSystemFont: '"Segoe UI", Roboto, sans-serif',
    inputBoxBg: 'linear-gradient(180deg, #2a1010 0%, #1a0808 30%, #0d0202 60%, #1a0808 100%)',
    inputBoxFont: '"Segoe UI", Roboto, sans-serif',
    inputBoxTextColor: '#d0d0d0',
    inputBoxFontSize: 15,
    inputButtonFaceColor: 'linear-gradient(180deg, #1a0808 0%, #0d0202 50%, #1a0808 100%)',
    historyArrowColor: '#6a4040',
    frameBtnFaceColor: 'linear-gradient(180deg, #1a0808 0%, #0d0202 50%, #1a0808 100%)',
    frameBtnTextColor: '#6a4040',
    charActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    charActionBtnFace: 'linear-gradient(180deg, #2a1010 0%, #1a0808 50%, #0d0202 100%)',
    charActionBtnText: '#f0c8c8',
    personaActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    personaActionBtnFace: 'linear-gradient(180deg, #2a1010 0%, #1a0808 50%, #0d0202 100%)',
    personaActionBtnText: '#d0d0d0',
    leftSidebarBg: '#0d0202',
    leftSidebarBgImage: '/api/skins/scarlett-l.jpeg',
    rightSidebarBg: '#0d0202',
    rightSidebarBgImage: '/api/skins/scarlett-r.jpeg',
    trimTopperColor: '#2a0a0a',
    trimCenterColor: '#1a0505',
    trimFooterColor: '#2a0a0a',
    nameBackingTransparent: false,
    nameBackingColor: 'rgba(30, 5, 5, 0.85)',
    sceneDetailsBg: 'rgba(30, 5, 5, 0.7)',
    sceneDetailsText: '#c8a0a0',
    sceneDetailsFont: '"Segoe UI", Roboto, sans-serif',
    sceneDetailsFontSize: 13,
    pumpableColor: '#cc2222',
    actionTextColor: '#e88090',
    bubbleOpacity: 0.75
  },
  {
    id: 'skin-neon-arcade',
    name: 'Neon Arcade',
    builtIn: true,
    backgroundImage: '/api/skins/vex-bg.png',
    playerOutlineColor: '#00ffcc',
    playerBubbleBg: 'rgba(10, 25, 30, 0.9)',
    playerTextColor: '#c0fff0',
    playerFont: '"Lucida Console", Monaco, monospace',
    playerFontSize: 14,
    charOutlineColor: '#ff44cc',
    charBubbleBg: 'rgba(30, 10, 25, 0.9)',
    charTextColor: '#ffc0f0',
    charFont: '"Lucida Console", Monaco, monospace',
    charFontSize: 14,
    systemOutlineColor: 'rgba(100, 200, 255, 0.5)',
    systemBubbleBg: 'rgba(10, 15, 30, 0.85)',
    systemTextColor: 'rgba(180, 230, 255, 0.95)',
    systemFont: '"Lucida Console", Monaco, monospace',
    systemFontSize: 13,
    uiHeaderColor: 'linear-gradient(180deg, #0a1525 0%, #050a15 40%, #020510 100%)',
    uiHeaderTextColor: '#00ffcc',
    uiTabColor: 'linear-gradient(180deg, #0a1520 0%, #050a15 100%)',
    uiSectionHeaderColor: 'linear-gradient(0deg, #020510 0%, #050a15 60%, #0a1525 100%)',
    uiSectionBgColor: '#0a1520',
    uiSectionFontColor: '#c0fff0',
    uiCentralMenuBg: '#020510',
    uiCentralMenuTransparent: false,
    uiSelectorDescFontColor: '#6090a0',
    uiModalBg: '',
    uiModalBgImage: '',
    uiSystemFont: '"Lucida Console", Monaco, monospace',
    inputBoxBg: 'linear-gradient(180deg, #0a1520 0%, #050a15 30%, #020510 60%, #050a15 100%)',
    inputBoxFont: '"Lucida Console", Monaco, monospace',
    inputBoxTextColor: '#c0fff0',
    inputBoxFontSize: 14,
    inputButtonFaceColor: 'linear-gradient(180deg, #050a15 0%, #020510 50%, #050a15 100%)',
    historyArrowColor: '#406070',
    frameBtnFaceColor: 'linear-gradient(180deg, #050a15 0%, #020510 50%, #050a15 100%)',
    frameBtnTextColor: '#406070',
    charActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    charActionBtnFace: 'linear-gradient(180deg, #0a1520 0%, #050a15 50%, #020510 100%)',
    charActionBtnText: '#ffc0f0',
    personaActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    personaActionBtnFace: 'linear-gradient(180deg, #0a1520 0%, #050a15 50%, #020510 100%)',
    personaActionBtnText: '#c0fff0',
    leftSidebarBg: '#020510',
    leftSidebarBgImage: '/api/skins/vex-l.png',
    rightSidebarBg: '#020510',
    rightSidebarBgImage: '/api/skins/vex-r.png',
    trimTopperColor: '#0a1525',
    trimCenterColor: '#050a15',
    trimFooterColor: '#0a1525',
    nameBackingTransparent: false,
    nameBackingColor: 'rgba(5, 10, 20, 0.9)',
    sceneDetailsBg: 'rgba(5, 10, 20, 0.7)',
    sceneDetailsText: '#80c0d0',
    sceneDetailsFont: '"Lucida Console", Monaco, monospace',
    sceneDetailsFontSize: 12,
    pumpableColor: '#ff44cc',
    actionTextColor: '#80f0c0',
    bubbleOpacity: 0.75
  },
  {
    id: 'skin-laboratory',
    name: 'The Laboratory',
    builtIn: true,
    backgroundImage: '/api/skins/iris-bg.png',
    playerOutlineColor: '#4488cc',
    playerBubbleBg: 'rgba(220, 230, 240, 0.9)',
    playerTextColor: '#1a2a40',
    playerFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    playerFontSize: 15,
    charOutlineColor: '#2266aa',
    charBubbleBg: 'rgba(230, 238, 248, 0.9)',
    charTextColor: '#0a1a30',
    charFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    charFontSize: 15,
    systemOutlineColor: 'rgba(100, 150, 200, 0.5)',
    systemBubbleBg: 'rgba(235, 242, 250, 0.9)',
    systemTextColor: 'rgba(30, 50, 80, 0.95)',
    systemFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    systemFontSize: 14,
    uiHeaderColor: 'linear-gradient(180deg, #e0e8f0 0%, #c8d4e0 40%, #b0c0d0 100%)',
    uiHeaderTextColor: '#1a2a40',
    uiTabColor: 'linear-gradient(180deg, #d0d8e0 0%, #c0c8d0 100%)',
    uiSectionHeaderColor: 'linear-gradient(0deg, #b0c0d0 0%, #c8d4e0 60%, #e0e8f0 100%)',
    uiSectionBgColor: '#f0f4f8',
    uiSectionFontColor: '#1a2a40',
    uiCentralMenuBg: '#e8eef4',
    uiCentralMenuTransparent: false,
    uiSelectorDescFontColor: '#4466aa',
    uiModalBg: '',
    uiModalBgImage: '',
    uiSystemFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    inputBoxBg: 'linear-gradient(180deg, #d8e0e8 0%, #c8d0d8 30%, #b8c4d0 60%, #c8d0d8 100%)',
    inputBoxFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    inputBoxTextColor: '#1a2a40',
    inputBoxFontSize: 15,
    inputButtonFaceColor: 'linear-gradient(180deg, #c8d4e0 0%, #b0c0d0 50%, #c8d4e0 100%)',
    historyArrowColor: '#6080a0',
    frameBtnFaceColor: 'linear-gradient(180deg, #c8d4e0 0%, #b0c0d0 50%, #c8d4e0 100%)',
    frameBtnTextColor: '#4060a0',
    charActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    charActionBtnFace: 'linear-gradient(180deg, #e0e8f0 0%, #d0d8e0 50%, #c0c8d0 100%)',
    charActionBtnText: '#1a2a40',
    personaActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    personaActionBtnFace: 'linear-gradient(180deg, #e0e8f0 0%, #d0d8e0 50%, #c0c8d0 100%)',
    personaActionBtnText: '#1a2a40',
    leftSidebarBg: '#d8e0e8',
    leftSidebarBgImage: '/api/skins/iris-l.png',
    rightSidebarBg: '#d8e0e8',
    rightSidebarBgImage: '/api/skins/iris-r.png',
    trimTopperColor: '#b0c0d0',
    trimCenterColor: '#a0b0c0',
    trimFooterColor: '#b0c0d0',
    nameBackingTransparent: false,
    nameBackingColor: 'rgba(200, 215, 230, 0.9)',
    sceneDetailsBg: 'rgba(220, 230, 240, 0.8)',
    sceneDetailsText: '#1a2a40',
    sceneDetailsFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    sceneDetailsFontSize: 13,
    pumpableColor: '#cc4444',
    actionTextColor: '#7090c0',
    bubbleOpacity: 0.75
  },
  {
    id: 'skin-observation-ward',
    name: 'Observation Ward',
    builtIn: true,
    backgroundImage: '/api/skins/alpha-bg.png',
    playerOutlineColor: '#40c0a0',
    playerBubbleBg: 'rgba(10, 30, 28, 0.9)',
    playerTextColor: '#c0f0e0',
    playerFont: '"Trebuchet MS", sans-serif',
    playerFontSize: 15,
    charOutlineColor: '#20a080',
    charBubbleBg: 'rgba(8, 25, 22, 0.9)',
    charTextColor: '#b0e8d8',
    charFont: '"Trebuchet MS", sans-serif',
    charFontSize: 15,
    systemOutlineColor: 'rgba(60, 180, 150, 0.5)',
    systemBubbleBg: 'rgba(8, 20, 18, 0.85)',
    systemTextColor: 'rgba(160, 220, 200, 0.95)',
    systemFont: '"Trebuchet MS", sans-serif',
    systemFontSize: 14,
    uiHeaderColor: 'linear-gradient(180deg, #0a2a25 0%, #061a18 40%, #031010 100%)',
    uiHeaderTextColor: '#80d0b8',
    uiTabColor: 'linear-gradient(180deg, #0a2520 0%, #061a18 100%)',
    uiSectionHeaderColor: 'linear-gradient(0deg, #031010 0%, #061a18 60%, #0a2a25 100%)',
    uiSectionBgColor: '#e0f4ee',
    uiSectionFontColor: '#0a2a25',
    uiCentralMenuBg: '#031010',
    uiCentralMenuTransparent: false,
    uiSelectorDescFontColor: '#60a090',
    uiModalBg: '',
    uiModalBgImage: '',
    uiSystemFont: '"Trebuchet MS", sans-serif',
    inputBoxBg: 'linear-gradient(180deg, #0a2520 0%, #061a18 30%, #031010 60%, #061a18 100%)',
    inputBoxFont: '"Trebuchet MS", sans-serif',
    inputBoxTextColor: '#c0f0e0',
    inputBoxFontSize: 15,
    inputButtonFaceColor: 'linear-gradient(180deg, #061a18 0%, #031010 50%, #061a18 100%)',
    historyArrowColor: '#408878',
    frameBtnFaceColor: 'linear-gradient(180deg, #061a18 0%, #031010 50%, #061a18 100%)',
    frameBtnTextColor: '#408878',
    charActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    charActionBtnFace: 'linear-gradient(180deg, #0a2520 0%, #061a18 50%, #031010 100%)',
    charActionBtnText: '#b0e8d8',
    personaActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    personaActionBtnFace: 'linear-gradient(180deg, #0a2520 0%, #061a18 50%, #031010 100%)',
    personaActionBtnText: '#c0f0e0',
    leftSidebarBg: '#031010',
    leftSidebarBgImage: '/api/skins/alpha-l.png',
    rightSidebarBg: '#031010',
    rightSidebarBgImage: '/api/skins/alpha-r.png',
    trimTopperColor: '#0a2a25',
    trimCenterColor: '#061a18',
    trimFooterColor: '#0a2a25',
    nameBackingTransparent: false,
    nameBackingColor: 'rgba(6, 20, 18, 0.85)',
    sceneDetailsBg: 'rgba(6, 20, 18, 0.7)',
    sceneDetailsText: '#90c8b8',
    sceneDetailsFont: '"Trebuchet MS", sans-serif',
    sceneDetailsFontSize: 13,
    pumpableColor: '#40c0a0',
    actionTextColor: '#80d0b0',
    bubbleOpacity: 0.75
  },
  {
    id: 'skin-slumber-party',
    name: 'Slumber Party',
    builtIn: true,
    backgroundImage: '/api/skins/megan-bg.png',
    playerOutlineColor: '#ff8899',
    playerBubbleBg: 'rgba(50, 25, 30, 0.85)',
    playerTextColor: '#ffe0e8',
    playerFont: 'Verdana, Geneva, sans-serif',
    playerFontSize: 15,
    charOutlineColor: '#ffaa66',
    charBubbleBg: 'rgba(45, 28, 18, 0.85)',
    charTextColor: '#fff0e0',
    charFont: 'Verdana, Geneva, sans-serif',
    charFontSize: 15,
    systemOutlineColor: 'rgba(255, 150, 120, 0.5)',
    systemBubbleBg: 'rgba(45, 22, 25, 0.85)',
    systemTextColor: 'rgba(255, 220, 210, 0.95)',
    systemFont: 'Verdana, Geneva, sans-serif',
    systemFontSize: 14,
    uiHeaderColor: 'linear-gradient(180deg, #3a1820 0%, #2a1018 40%, #1a0810 100%)',
    uiHeaderTextColor: '#ffb8c8',
    uiTabColor: 'linear-gradient(180deg, #3a1820 0%, #2a1018 100%)',
    uiSectionHeaderColor: 'linear-gradient(0deg, #1a0810 0%, #2a1018 60%, #3a1820 100%)',
    uiSectionBgColor: '#fff0f4',
    uiSectionFontColor: '#3a1820',
    uiCentralMenuBg: '#1a0810',
    uiCentralMenuTransparent: false,
    uiSelectorDescFontColor: '#c08898',
    uiModalBg: '',
    uiModalBgImage: '',
    uiSystemFont: 'Verdana, Geneva, sans-serif',
    inputBoxBg: 'linear-gradient(180deg, #3a1820 0%, #2a1018 30%, #1a0810 60%, #2a1018 100%)',
    inputBoxFont: 'Verdana, Geneva, sans-serif',
    inputBoxTextColor: '#ffe0e8',
    inputBoxFontSize: 15,
    inputButtonFaceColor: 'linear-gradient(180deg, #2a1018 0%, #1a0810 50%, #2a1018 100%)',
    historyArrowColor: '#906070',
    frameBtnFaceColor: 'linear-gradient(180deg, #2a1018 0%, #1a0810 50%, #2a1018 100%)',
    frameBtnTextColor: '#906070',
    charActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    charActionBtnFace: 'linear-gradient(180deg, #3a2028 0%, #2a1018 50%, #1a0810 100%)',
    charActionBtnText: '#fff0e0',
    personaActionMenuBg: 'rgba(0, 0, 0, 0.5)',
    personaActionBtnFace: 'linear-gradient(180deg, #3a2028 0%, #2a1018 50%, #1a0810 100%)',
    personaActionBtnText: '#ffe0e8',
    leftSidebarBg: '#1a0810',
    leftSidebarBgImage: '/api/skins/megan-l.png',
    rightSidebarBg: '#1a0810',
    rightSidebarBgImage: '/api/skins/megan-r.png',
    trimTopperColor: '#3a1820',
    trimCenterColor: '#2a1018',
    trimFooterColor: '#3a1820',
    nameBackingTransparent: false,
    nameBackingColor: 'rgba(35, 12, 18, 0.85)',
    sceneDetailsBg: 'rgba(35, 12, 18, 0.7)',
    sceneDetailsText: '#d8a8b8',
    sceneDetailsFont: 'Verdana, Geneva, sans-serif',
    sceneDetailsFontSize: 13,
    pumpableColor: '#ff8899',
    actionTextColor: '#e0a0c0',
    bubbleOpacity: 0.75
  }
];

function loadDisplaySettings() {
  try {
    const data = JSON.parse(fs.readFileSync(DISPLAY_SETTINGS_PATH, 'utf8'));
    // Always replace built-in skins with latest definitions (picks up new fields)
    data.skins = data.skins || [];
    for (const builtIn of BUILTIN_SKINS) {
      const idx = data.skins.findIndex(s => s.id === builtIn.id);
      if (idx !== -1) {
        data.skins[idx] = builtIn;
      } else {
        data.skins.push(builtIn);
      }
    }
    return data;
  } catch (e) {
    return { activeSkinId: 'swelldreams-default', skins: [...BUILTIN_SKINS] };
  }
}

function saveDisplaySettings(data) {
  fs.writeFileSync(DISPLAY_SETTINGS_PATH, JSON.stringify(data, null, 2));
}

app.get('/api/display-settings', (req, res) => {
  res.json(loadDisplaySettings());
});

app.put('/api/display-settings/active-skin', (req, res) => {
  const data = loadDisplaySettings();
  const { skinId } = req.body;
  if (!data.skins.find(s => s.id === skinId)) {
    return res.status(404).json({ error: 'Skin not found' });
  }
  data.activeSkinId = skinId;
  saveDisplaySettings(data);
  res.json({ success: true });
});

app.post('/api/display-settings/skins', (req, res) => {
  const data = loadDisplaySettings();
  const { name, skin } = req.body;
  if (!name || !skin) return res.status(400).json({ error: 'name and skin required' });
  const id = `skin-${Date.now()}`;
  const newSkin = { ...skin, id, name, builtIn: false };
  data.skins.push(newSkin);
  data.activeSkinId = id;
  saveDisplaySettings(data);
  res.json({ success: true, id });
});

app.put('/api/display-settings/skins/:id', (req, res) => {
  const data = loadDisplaySettings();
  const idx = data.skins.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Skin not found' });
  if (data.skins[idx].builtIn) return res.status(400).json({ error: 'Cannot modify built-in skin' });
  const { name, skin } = req.body;
  if (skin) {
    data.skins[idx] = { ...skin, id: req.params.id, name: name || data.skins[idx].name, builtIn: false };
  } else if (name) {
    data.skins[idx].name = name;
  }
  saveDisplaySettings(data);
  res.json({ success: true });
});

app.delete('/api/display-settings/skins/:id', (req, res) => {
  const data = loadDisplaySettings();
  const idx = data.skins.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Skin not found' });
  if (data.skins[idx].builtIn) return res.status(400).json({ error: 'Cannot delete built-in skin' });
  data.skins.splice(idx, 1);
  if (data.activeSkinId === req.params.id) {
    data.activeSkinId = 'swelldreams-default';
  }
  saveDisplaySettings(data);
  res.json({ success: true });
});

// Serve persisted skin images
app.get('/api/skins/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(SKINS_DIR, filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send('Not found');
});

// Upload skin background or modal image — save to /data/skins/ for persistence
const skinImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/display-settings/upload-image', skinImageUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Save file to skins directory
    const ext = path.extname(req.file.originalname) || '.png';
    const filename = `skin-${Date.now()}${ext}`;
    const filePath = path.join(SKINS_DIR, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const url = `/api/skins/${filename}`;
    res.json({ success: true, dataUrl: url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid flow id' });
  }
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
  if (req.body && req.body.nodes !== undefined && !Array.isArray(req.body.nodes)) {
    return res.status(400).json({ error: 'Flow nodes must be an array' });
  }
  if (req.body && req.body.edges !== undefined && !Array.isArray(req.body.edges)) {
    return res.status(400).json({ error: 'Flow edges must be an array' });
  }
  const newFlow = {
    ...req.body,
    id: uuidv4(),
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
  if (!isSafeId(flowId)) {
    return res.status(400).json({ error: 'Invalid flow id' });
  }
  let updatedFlow;

  if (isPerFlowStorageActive()) {
    const existingFlow = loadFlow(flowId);
    if (!existingFlow) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    updatedFlow = { ...existingFlow, ...req.body, id: flowId, updatedAt: Date.now() };
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
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    broadcast('characters_update', chars);
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
  if (!isSafeId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid flow id' });
  }
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

  // Strip portrait media - they are local-only and exported separately as zip
  delete exportCharacter.charStagedPortraits;
  delete exportCharacter.charPortraitMedia;
  delete exportCharacter.charPortraitCrop;

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

  // Load settings and character to get per-story session defaults
  const settings = loadData(DATA_FILES.settings);
  let storyDefaults = { capacity: 0, pain: 0, emotion: 'neutral', capacityModifier: 1.0 };

  // Persona disposition is the baseline emotion
  const activePersona = settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null;
  if (activePersona?.disposition) {
    storyDefaults.emotion = activePersona.disposition;
  }

  if (settings?.activeCharacterId) {
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    if (activeCharacter) {
      const activeStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
      if (activeStory) {
        storyDefaults.capacity = activeStory.startingCapacity || 0;
        storyDefaults.pain = activeStory.startingPain || 0;
        storyDefaults.capacityModifier = activeStory.startingCapacityModifier || 1.0;
        // Story overrides persona disposition only if explicitly enabled
        if (activeStory.overrideDisposition && activeStory.startingEmotion) {
          storyDefaults.emotion = activeStory.startingEmotion;
        }
      }
      // Legacy fallback: check old sessionDefaults if story fields are empty
      if (activeCharacter.sessionDefaults) {
        if (!activeStory?.startingCapacity && activeCharacter.sessionDefaults.capacity) storyDefaults.capacity = activeCharacter.sessionDefaults.capacity;
        if (!activeStory?.startingPain && activeCharacter.sessionDefaults.pain) storyDefaults.pain = activeCharacter.sessionDefaults.pain;
        if (!activeStory?.startingCapacityModifier && activeCharacter.sessionDefaults.capacityModifier) storyDefaults.capacityModifier = activeCharacter.sessionDefaults.capacityModifier;
      }
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

  // Use initial values if provided, otherwise use per-story defaults
  sessionState.capacity = initialValues.capacity ?? storyDefaults.capacity;
  sessionState.pain = initialValues.pain ?? storyDefaults.pain;
  sessionState.emotion = initialValues.emotion ?? storyDefaults.emotion;
  sessionState.capacityModifier = initialValues.capacityModifier ?? storyDefaults.capacityModifier;
  sessionState.chatHistory = [];
  sessionState.chatMemorySummary = null;
  sessionState.chatMemorySummaryUpTo = 0;
  firedCheckpointTriggers.clear();
  sessionState.firedTreeNodes.clear();
  sessionState.flowVariables = {};
  sessionState.flowAssignments = { personas: {}, characters: {}, global: [] };
  sessionState.executionHistory = {
    deliveredMessages: new Set(),
    deviceActions: {}
  };
  sessionState.pumpRuntimeTracker = {}; // Reset auto-capacity tracking
  sessionState.capacityOffset = 0; // Clear manual capacity offset
  stopCharacterInflation(); // Stop any active character inflation
  sessionState.characterCapacity = 0;
  sessionState.characterInflationBaseCapacity = 0;
  // Reset checkpoint-injection + instructor pre-req state
  sessionState.checkpointInjectionCounts = {};
  sessionState.messagesSincePumpOn = 0; // Auto-pump pacing counter
  sessionState.repliesSinceManualPump = 999; // Manual-pump pacing counter (high = not cooling)
  sessionState.activeCheckpointInjections = [];
  sessionState.pendingCheckpointChoice = null;
  sessionState.pendingTreeChoice = null;
  sessionState.pendingCheckpointResponse = null;
  sessionState.pendingPrereqs = null;
  sessionState.prereqsDone = false;
  sessionState.preFillActive = false;
  sessionState.preFillStepId = null;
  sessionState.preFillNote = null;
  sessionState.activeCheckpointProfileId = null;
  // Instructor pump state — counts zeroed each session; pump mode set below once the character is known.
  sessionState.bulbCurrent = 0;
  sessionState.bikeCurrent = 0;
  sessionState.pendingPumpContext = [];
  sessionState.pumpType = 'electric';
  sessionState.pumpInit = 'auto';

  console.log(`[Session Reset] Initial values - capacity: ${sessionState.capacity}, pain: ${sessionState.pain}, emotion: ${sessionState.emotion}, capacityModifier: ${sessionState.capacityModifier}`);

  // Reset welcome message lock and first message flag
  sendingWelcomeMessage = false;
  firstAiMessageFired = false;
  console.log('[Session Reset] Reset firstAiMessageFired to false');

  // Reset event engine state (clears "Only Once" conditions, flow states, etc.)
  eventEngine.cleanup();
  console.log('[Session Reset] Event engine cleanup complete');

  // Re-load flow assignments and re-activate
  loadFlowAssignments();
  activateAssignedFlows();

  broadcast('session_reset', sessionState);

  // Fire new_session triggers (for variable initialization etc.)
  await eventEngine.handleEvent('new_session', {});
  console.log('[Session Reset] new_session triggers fired');

  // Determine pre-inflation gate state and send welcome message
  if (settings?.activeCharacterId) {
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    let gateActive = false;

    if (activeCharacter && sessionState.capacity === 0) {
      const activeStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
      if (getPreFillConfig(activeCharacter)) {
        // Pre-Fill takes precedence for ALL card types — gate stays closed through the
        // entire gated intro; startPreFill() (below) manages the step state.
        sessionState.preInflationGateMet = false;
      } else if (isInstructor(activeCharacter)) {
        // Instructors gate on their pre-req sequence (the prereq choices ARE the gate)
        const hasPrereqs = Array.isArray(activeStory?.prereqs) && activeStory.prereqs.some(s => s?.choices?.some(c => c?.label));
        sessionState.preInflationGateMet = !hasPrereqs;
      } else {
        // The separate 0% pre-inflation gate is gone — without Pre-Fill, standard cards
        // start ungated (gating is now Pre-Fill's job).
        sessionState.preInflationGateMet = true;
      }
    } else {
      sessionState.preInflationGateMet = true;
    }

    // Apply character's custom skin if set, or revert to default
    const activeStoryForSkin = activeCharacter?.stories?.find(s => s.id === activeCharacter?.activeStoryId) || activeCharacter?.stories?.[0];
    const storySkinId = activeStoryForSkin?.skinId || 'swelldreams-default';
    const displayData = loadDisplaySettings();
    if (displayData.activeSkinId !== storySkinId) {
      const skin = displayData.skins?.find(s => s.id === storySkinId);
      if (skin) {
        displayData.activeSkinId = storySkinId;
        saveDisplaySettings(displayData);
        broadcast('skin_changed', { skinId: storySkinId, skin });
        console.log(`[Session Reset] Applied skin: "${skin.name}"`);
      }
    }

    // Send welcome message first
    if (activeCharacter) {
      // Session Start tree (ALL card types). Resolved BEFORE the welcome so its "Override
      // Character Welcome Message" tickbox can suppress the built-in welcome. resolveScopeRefs
      // reads the active checkpoint profile for instructors, the active story otherwise.
      const isInstr = isInstructor(activeCharacter);
      const aStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
      const ssTreeIndex = buildTreeIndex();
      // Session Start is always STORY-level (it runs at open, before any checkpoint profile is
      // necessarily active) — unlike Range/Always-On which are per-profile for instructors.
      const ssRef = aStory?.treeRefs?.sessionStart;
      const ssTree = resolveRefTree(ssRef, ssTreeIndex); // inline OR {treeId} library ref
      const overrideWelcome = !!(ssRef?.overrideWelcome && ssTree);

      if (!overrideWelcome) await sendWelcomeMessage(activeCharacter, settings);
      // Order: Welcome → Session Start → Pre-Fill (per plan). The Session Start tree runs
      // (after instructor setup vars) BEFORE Pre-Fill starts, so it can set the pump type / swap
      // the checkpoint profile that Pre-Fill and the gate then build on.
      if (isInstr) applyInstructorInitVars(activeCharacter); // seed session-start setup variables (instructor)
      // Standalone delivery: ai_message posts immediately, like the welcome.
      if (ssTree) await runTreeScope(ssTree, 'sessionStart', activeCharacter, settings, { delivery: 'standalone', treeIndex: ssTreeIndex });
      // Pre-Fill (gated intro) takes precedence for every card type. It closes the gate and
      // seeds the first step.
      const preFillStarted = startPreFill(activeCharacter);
      if (isInstr) {
        // Legacy modal pre-reqs only run when Pre-Fill is NOT in use — and NOT if the Session
        // Start tree already suspended on a player_choice (avoid two choice families armed at once).
        if (!preFillStarted && !sessionState.pendingTreeChoice && (aStory?.prereqTiming || 'session_start') === 'session_start') {
          startInstructorPrereqs(activeCharacter);
        }
        // Set the session pump mode from the active checkpoint profile (or the card default).
        applyActivePumpType(activeCharacter);
      }
    }

    // Then send the gate notice AFTER the welcome message so it isn't buried
    if (gateActive) {
      const { v4: uuidv4 } = require('uuid');
      const gateMessage = {
        id: uuidv4(),
        content: `Pre-Inflation Checkpoint is active. The AI cannot activate your pump until a human action (manual control, button, or flow) starts inflation for the first time.`,
        sender: 'system',
        excludeFromContext: true,
        timestamp: Date.now()
      };
      sessionState.chatHistory.push(gateMessage);
      broadcast('chat_message', gateMessage);
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
    flowAssignments: sessionState.flowAssignments,
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
  // Pre-inflation gate: if capacity > 0, gate is already met
  sessionState.preInflationGateMet = (sessionState.capacity > 0);

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

// Restore default characters and personas from the committed factory backups ONLY
// when an on-disk default is MISSING or fails to parse. Valid existing defaults
// (including legitimate user edits to defaults) are never force-overwritten on boot.
(function restoreFactoryDefaults() {
  const FACTORY_DIR = path.join(DATA_DIR, 'factory');
  const pairs = [
    { src: path.join(FACTORY_DIR, 'chars-default'), dest: CHARS_DEFAULT_DIR, jsonName: 'char.json' },
    { src: path.join(FACTORY_DIR, 'personas-default'), dest: PERSONAS_DEFAULT_DIR, jsonName: 'persona.json' }
  ];

  // Portable recursive copy (works on Node 18+)
  function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  // Does the on-disk default have a present, parseable JSON file?
  function defaultIsValid(destEntryDir, jsonName) {
    const jsonPath = path.join(destEntryDir, jsonName);
    if (!fs.existsSync(jsonPath)) return false;
    try {
      JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return true;
    } catch (e) {
      return false;
    }
  }

  for (const { src, dest, jsonName } of pairs) {
    if (!fs.existsSync(src)) continue;
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const srcEntryDir = path.join(src, id);
      const destEntryDir = path.join(dest, id);
      if (defaultIsValid(destEntryDir, jsonName)) {
        // Existing default is valid — leave it untouched.
        continue;
      }
      console.log(`[Startup] Restoring factory default '${id}' (missing or unparseable on disk)`);
      copyDirSync(srcEntryDir, destEntryDir);
    }
  }
  console.log('[Startup] Factory defaults checked; missing/corrupt defaults restored');

  // Clean up stale copies of default personas/chars in custom/ (from prior race condition bug)
  for (const [defaultDir, customDir] of [[CHARS_DEFAULT_DIR, CHARS_CUSTOM_DIR], [PERSONAS_DEFAULT_DIR, PERSONAS_CUSTOM_DIR]]) {
    if (!fs.existsSync(defaultDir) || !fs.existsSync(customDir)) continue;
    const defaultIds = fs.readdirSync(defaultDir);
    for (const id of defaultIds) {
      const stalePath = path.join(customDir, id);
      if (fs.existsSync(stalePath)) {
        fs.rmSync(stalePath, { recursive: true, force: true });
        console.log(`[Startup] Removed stale custom copy: ${id}`);
      }
    }
  }
})();

// Ensure all indexes exist and are valid before starting
ensureCharsIndex();
ensureFlowsIndex();
ensurePersonasIndex();
ensureActorsIndex();
ensurePlaysIndex();

// Now that factory defaults are restored and indexes rebuilt, initialize flows
loadFlowAssignments();
console.log('[Startup] Flow assignments loaded from persisted data');
activateAssignedFlows();
console.log('[Startup] Flows activated for current session');
syncAllButtonsOnStartup();

// Bind to localhost by default; only expose on all interfaces when the user has
// explicitly enabled remote access. Preserves the allowRemote toggle.
const BIND_REMOTE = !!(getRemoteSettings().allowRemote);
const BIND_HOST = BIND_REMOTE ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, BIND_HOST, () => {
  log.always(`SwellDreams server running on http://localhost:${PORT} (bound to ${BIND_HOST})`);
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
    clearAllServerTimedPumpTimers();
    stopPumpSafetyWatchdog();
    console.log('[FAILSAFE] Pump runtime tracking stopped');

    // 2. Stop all device cycles and turn off devices — CONCURRENTLY, with a
    //    per-device timeout so one offline device can't block the whole stop.
    const devices = loadData(DATA_FILES.devices) || [];
    const failsafeResults = await stopAllDevicesConcurrently(devices, '[FAILSAFE]');
    for (const r of failsafeResults) {
      if (r.ok) {
        console.log(`[FAILSAFE] Stopped device: ${r.name}`);
      } else {
        console.error(`[FAILSAFE] Failed to stop device ${r.name}: ${r.error}`);
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

// Classify whether a rejection/error originates from the device-control path,
// in which case a physical emergency stop is warranted. Stray application
// rejections (HTTP, JSON, LLM, etc.) should NOT pop pumps or kill the process.
function isDevicePathError(reason) {
  const err = reason instanceof Error ? reason : null;
  const text = `${err ? (err.stack || err.message) : String(reason)}`.toLowerCase();
  const deviceMarkers = [
    'device-service', 'deviceservice', 'pump', 'turnoff', 'turnon', 'startcycle',
    'pulsepump', 'kasa', 'tapo', 'tuya', 'govee', 'wyze', 'shelly', 'esphome',
    'tasmota', 'homeassistant', 'relay'
  ];
  return deviceMarkers.some(m => text.includes(m));
}

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  const reasonStr = reason instanceof Error ? reason.message : (typeof reason === 'string' ? reason : 'Unknown');
  console.error('[FAILSAFE] Unhandled Promise Rejection:', reasonStr);

  // Only escalate to a physical emergency stop for device-path failures. Other
  // stray rejections are logged and the process keeps running.
  if (!isDevicePathError(reason)) {
    console.error('[FAILSAFE] Non-device rejection — logging and continuing (no emergency stop).');
    return;
  }

  await triggerEmergencyStop(`Unhandled Rejection: ${reasonStr}`);

  // Give time for devices to stop, then exit
  setTimeout(() => {
    console.log('[FAILSAFE] Exiting process after device-path unhandled rejection');
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
