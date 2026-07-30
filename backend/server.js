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

// Constant-time-ish comparison for the remote auth token (length mismatch short-circuits, which
// leaks only the length — acceptable for a LAN shared secret).
function timingSafeTokenMatch(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || given.length !== expected.length || !expected.length) return false;
  try { return require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(expected)); }
  catch (e) { return false; }
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
    // Cross-site WebSocket hijack guard: browsers ALWAYS send an Origin on WS upgrades, and WS
    // is NOT protected by CORS — without this check, any webpage open in a browser on this (or a
    // whitelisted) machine could silently open ws://localhost:8889 and drive physical devices.
    // Allow: same-host origins (the served frontend), local origins (dev servers), whitelisted
    // hosts. Non-browser clients send no Origin and are gated by IP/token below.
    if (info.origin) {
      const originHost = extractHost(info.origin);
      const sameHost = originHost && extractHost(info.req.headers && info.req.headers.host) === originHost;
      if (!sameHost && !isAllowedHost(originHost, remoteSettings)) {
        console.warn(`[WS] Rejected upgrade from disallowed Origin "${info.origin}" (client ${remoteAddr})`);
        return done(false, 403, 'Origin not allowed');
      }
    }
    // Always allow strictly-local connections.
    if (isLocalAddress(remoteAddr)) {
      return done(true);
    }
    if (!remoteSettings.allowRemote) {
      return done(false, 403, 'Remote access disabled');
    }
    const cleanIp = String(remoteAddr || '').replace(/^::ffff:/, '');
    if (!(Array.isArray(remoteSettings.whitelistedIps) && remoteSettings.whitelistedIps.includes(cleanIp))) {
      return done(false, 403, 'IP not in whitelist');
    }
    // Remote auth token — OPT-IN (see the HTTP middleware note): enforced only when
    // "Require access token" is enabled in remote settings.
    if (remoteSettings.requireToken === true && remoteSettings.authToken) {
      let given = '';
      try { given = new URL(info.req.url, 'http://x').searchParams.get('token') || ''; } catch (e) { /* no token */ }
      if (!timingSafeTokenMatch(given, remoteSettings.authToken)) {
        return done(false, 401, 'Auth token required');
      }
    }
    return done(true);
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
  if (!(Array.isArray(remoteSettings.whitelistedIps) && remoteSettings.whitelistedIps.includes(cleanIp))) {
    return res.status(403).json({ success: false, error: 'IP not in whitelist' });
  }
  // Remote auth token — OPT-IN (user ruling: whitelisted IPs are trusted by default; the token
  // is an extra layer only when "Require access token" is enabled in remote settings). Only the
  // API is token-gated — static app files still serve so the remote frontend can load and prompt.
  if (remoteSettings.requireToken === true && remoteSettings.authToken && (req.path === '/api' || req.path.startsWith('/api/'))) {
    const given = req.headers['x-swelld-token'] || (req.query && req.query.token) || '';
    if (!timingSafeTokenMatch(String(given), remoteSettings.authToken)) {
      return res.status(401).json({ success: false, error: 'Remote auth token required', code: 'TOKEN_REQUIRED' });
    }
  }
  return next();
});

// Flow engine REMOVED (remediation E3, user-approved 2026-07-28): the entire flow API answers
// 410 Gone. The legacy route handlers below in this file are now unreachable dead code and get
// physically deleted during the E1 modularization pass. Trigger Trees are the replacement.
app.all(['/api/flows', '/api/flows/:id', '/api/export/flow/:id', '/api/import/flow'], (req, res) =>
  res.status(410).json({ error: 'The flow engine was removed — use Trigger Trees instead.' }));

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

// Disk-backed upload staging: big files (portrait videos, media videos, card ZIPs) land in a
// temp dir instead of RAM. Every consuming handler must cleanupUpload(req) in a finally.
const UPLOAD_TMP_DIR = path.join(__dirname, 'data', 'tmp', 'uploads');
try { fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true }); } catch (e) { /* exists */ }
// Sweep any temp files stranded by a crash (older than an hour) at boot.
try {
  for (const f of fs.readdirSync(UPLOAD_TMP_DIR)) {
    const p = path.join(UPLOAD_TMP_DIR, f);
    if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.unlinkSync(p);
  }
} catch (e) { /* best-effort */ }
const diskUploadStorage = multer.diskStorage({
  destination: UPLOAD_TMP_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`)
});
function cleanupUpload(req) {
  if (req?.file?.path) { try { fs.unlinkSync(req.file.path); } catch (e) { /* already gone */ } }
}

// Multer config for portrait media uploads (now genuinely disk-based — the old comment claimed
// this while using memoryStorage)
const portraitUpload = multer({
  storage: diskUploadStorage,
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
    const url = await imageStorage.savePortraitMedia(type, id, isDefault, slot, fs.readFileSync(req.file.path), ext);

    console.log(`[PortraitMedia] Saved ${slot}.${ext} for ${type}/${folder}/${id}`);
    res.json({ url, slot, isVideo: imageStorage.isVideoFile(`${slot}.${ext}`) });
  } catch (error) {
    console.error('[PortraitMedia] Upload error:', error);
    res.status(500).json({ error: 'Failed to save portrait media' });
  } finally { cleanupUpload(req); }
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

    const zip = new AdmZip(req.file.path); // path ctor — entries decompress lazily, never the whole archive in RAM
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
  } finally { cleanupUpload(req); }
});

// ==================== MEDIA ALBUM API ====================

// Initialize media directories on startup
mediaStorage.initMediaDirectories().catch(err => {
  console.error('Failed to initialize media directories:', err);
});

// Configure multer for video/audio uploads (memory storage for processing)
const mediaUpload = multer({
  storage: diskUploadStorage,
  limits: {
    fileSize: mediaStorage.VIDEO_SIZE_LIMIT // Use the larger limit (500MB)
  }
});

// Configure multer for character card imports (JSON/PNG, or a ZIP bundling card + media)
const cardUpload = multer({
  storage: diskUploadStorage,
  limits: {
    // ZIP imports carry the character's media (video allowance dominates); bare cards stay tiny.
    fileSize: 600 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/json', 'image/png', 'image/jpeg', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    if (allowedTypes.includes(file.mimetype) || /\.(zip|swelld)$/i.test(file.originalname || '')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JSON, PNG, and ZIP files are allowed.'));
    }
  }
});

// ---- Per-character media (E1: extracted to lib/char-media.js — helpers + Media-tab routes) ----
const { CHAR_MEDIA_TYPES, charMediaDir, sanitizeMediaName, listCharMedia, writeCharMediaFile, writeCharMediaFileFromPath, charMediaFilePath } =
  require('./lib/char-media')({ app, isSafeId, mediaUpload, cleanupUpload, mediaStorage });

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
      { path: req.file.path }, // disk-staged — copied into place, never buffered whole in RAM
      req.file.originalname,
      req.file.mimetype,
      tag,
      description,
      folder
    );
    res.json(video);
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally { cleanupUpload(req); }
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
      { path: req.file.path }, // disk-staged — copied into place, never buffered whole in RAM
      req.file.originalname,
      req.file.mimetype,
      tag,
      description,
      folder || null
    );
    res.json(audio);
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally { cleanupUpload(req); }
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
      // Fallback (audit D6): the ACTIVE character's own media directory, matched by filename or
      // stem (case-insensitive). Lets [Image:x]/[Video:x]/[Audio:x] in a card's trees resolve to
      // the media that travelled WITH the card (ZIP export) on installs whose library lacks the
      // tag. Library tags win on collision.
      const luSettings = loadData(DATA_FILES.settings) || {};
      const activeCharId = luSettings.activeCharacterId;
      if (activeCharId && isSafeId(activeCharId)) {
        const files = listCharMedia(activeCharId)[type] || [];
        const want = String(tag).toLowerCase();
        const hit = files.find(f => f.name.toLowerCase() === want)
          || files.find(f => f.name.toLowerCase().replace(/\.[^.]+$/, '') === want);
        if (hit) {
          return res.json({
            id: `charmedia:${hit.name}`,
            tag,
            description: `${activeCharId} card media`,
            orientation: null,
            type,
            charMedia: true,
            fileUrl: hit.url
          });
        }
      }
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
  triggerSets: path.join(DATA_DIR, 'trigger-sets.json'),
  // Automatic Pumps (#30): named pump entities that OWN the calibration + device-control limits and
  // BIND to a device/outlet. Additive layer — binding pushes calibrationTime/isPrimaryPump onto the
  // bound device so the device-keyed capacity engine is untouched.
  pumps: path.join(DATA_DIR, 'pumps.json')
};

// Helper to get calibration/label key for a device (ip or ip:childId)
function getDeviceKey(device) {
  if (device.childId) {
    return `${device.ip}:${device.childId}`;
  }
  return device.ip;
}

// ===== Automatic Pumps (#30) =====
// Per-pump device-control limit fields (mirror the per-story llmMax* fields).
const PUMP_LIMIT_FIELDS = ['llmMaxOnDuration', 'llmMaxCycleOnDuration', 'llmMaxCycleRepetitions', 'llmMaxPulseRepetitions', 'llmMaxTimedDuration'];
// Factory defaults applied to every pump (existing on migration + newly created). A permissive but
// real per-pump CEILING — generous enough not to clamp typical per-story limits, low enough to be a
// meaningful safety bound users can tighten per pump. Keep in sync with FACTORY_PUMP_LIMITS in DeviceTab.js.
const FACTORY_PUMP_LIMITS = {
  llmMaxOnDuration: 30,
  llmMaxCycleOnDuration: 15,
  llmMaxCycleRepetitions: 10,
  llmMaxPulseRepetitions: 20,
  llmMaxTimedDuration: 60,
  latchPumpUntilOff: false,
};
function loadPumps() { return loadData(DATA_FILES.pumps) || []; }
function savePumps(pumps) { saveData(DATA_FILES.pumps, pumps); }

// A short "last-known device/ip" reference for a device, shown when a pump's bound outlet changes.
function deviceRef(device) {
  if (!device) return null;
  return { deviceId: device.id, label: device.label || device.name || '', ip: device.ip || device.deviceId || '' };
}

// Push a pump's calibration + primary flag onto its bound device so the existing capacity engine
// (which reads device.calibrationTime / device.isPrimaryPump) keeps working unchanged. The pump is
// the source of truth; the device gets a synced copy. Returns true if any device was mutated.
function syncPumpsToDevices(pumps, devices) {
  let changed = false;
  // Exactly one primary pump; its bound device becomes the primary pump device.
  const primary = pumps.find(p => p.isPrimary);
  for (const p of pumps) {
    if (!p.boundDeviceId) continue;
    const dev = devices.find(d => d.id === p.boundDeviceId);
    if (!dev) continue;
    if (p.calibrationTime != null && dev.calibrationTime !== p.calibrationTime) { dev.calibrationTime = p.calibrationTime; changed = true; }
    if (p.calibrationCapacity != null && dev.calibrationCapacity !== p.calibrationCapacity) { dev.calibrationCapacity = p.calibrationCapacity; changed = true; }
    if (p.calibrationPainAtMax != null && dev.calibrationPainAtMax !== p.calibrationPainAtMax) { dev.calibrationPainAtMax = p.calibrationPainAtMax; changed = true; }
    if (dev.deviceType !== 'PUMP') { dev.deviceType = 'PUMP'; changed = true; }
  }
  if (primary?.boundDeviceId) {
    for (const d of devices) {
      const want = d.id === primary.boundDeviceId;
      if (!!d.isPrimaryPump !== want) { d.isPrimaryPump = want; changed = true; }
    }
  }
  return changed;
}

// Ensure every calibrated device is represented by a pump (back-compat migration), then sync all
// pumps to their bound devices. Idempotent; persists only when something actually changes.
function migrateAndSyncPumps() {
  const devices = loadData(DATA_FILES.devices) || [];
  let pumps = loadPumps();
  let pumpsChanged = false;
  const boundIds = new Set(pumps.map(p => p.boundDeviceId).filter(Boolean));
  for (const d of devices) {
    const isPump = d.deviceType === 'PUMP' || d.isPrimaryPump;
    if (isPump && d.calibrationTime > 0 && !boundIds.has(d.id)) {
      pumps.push({
        id: uuidv4(),
        name: d.label || d.name || 'Automatic Pump',
        calibrationTime: d.calibrationTime,
        calibrationCapacity: d.calibrationCapacity ?? null,
        calibrationPainAtMax: d.calibrationPainAtMax ?? null,
        calibratedAt: d.calibratedAt ?? Date.now(),
        boundDeviceId: d.id,
        lastSeen: deviceRef(d),
        isPrimary: !!d.isPrimaryPump,
        limits: { ...FACTORY_PUMP_LIMITS },
      });
      boundIds.add(d.id);
      pumpsChanged = true;
    }
  }
  // Backfill factory limits onto any existing pump that predates them (or had limits cleared).
  for (const p of pumps) {
    if (!p.limits || typeof p.limits !== 'object') { p.limits = { ...FACTORY_PUMP_LIMITS }; pumpsChanged = true; }
  }
  // Guarantee at most one primary; if none and pumps exist, promote the first.
  const primaries = pumps.filter(p => p.isPrimary);
  if (primaries.length > 1) { pumps.forEach((p, i) => { p.isPrimary = p.id === primaries[0].id; }); pumpsChanged = true; }
  if (primaries.length === 0 && pumps.length) { pumps[0].isPrimary = true; pumpsChanged = true; }
  if (pumpsChanged) savePumps(pumps);
  const devChanged = syncPumpsToDevices(pumps, devices);
  if (devChanged) saveData(DATA_FILES.devices, devices);
  return pumps;
}

// The active primary pump's effective limits — used as the UPPER CEILING over per-story limits.
function getPrimaryPumpLimits() {
  const primary = loadPumps().find(p => p.isPrimary);
  return primary?.limits || null;
}

// Resolve the ONE primary pump DEVICE from the devices list. A user can have several devices flagged
// deviceType==='PUMP'; the primary is the one explicitly flagged isPrimaryPump===true. A bare
// find(d => d.deviceType==='PUMP' || d.isPrimaryPump) returns the FIRST pump instead — wrong when the
// primary isn't listed first (or is offline). Always prefer the flagged primary, then fall back to the
// first pump. Used everywhere a single "the pump" is needed (balloon toggle, firing, calibration).
function getPrimaryPumpDevice(devices) {
  const list = Array.isArray(devices) ? devices : [];
  return list.find(d => d.isPrimaryPump === true) || list.find(d => d.deviceType === 'PUMP') || null;
}

// Alias for backwards compatibility
function getCalibrationKey(device) {
  return getDeviceKey(device);
}

// Canonical primary-pump RUN STATE line for the system prompt. Without it the model invents
// whether the pump is running (it only ever saw capacity numbers + transition notes). Ground
// truth: the live gauge-tracking interval (calibrated pumps) OR the device-state map (covers
// uncalibrated outlets driven by triggers/manual buttons).
function primaryPumpStateLine(playerLabel) {
  try {
    const devices = loadData(DATA_FILES.devices) || [];
    const pump = getPrimaryPumpDevice(devices);
    if (!pump) return '';
    const key = getDeviceKey(pump);
    const running = deviceService.pumpRuntimeIntervals?.has(key)
      || sessionState.executionHistory?.deviceActions?.[key]?.state === 'on';
    return `\n=== PUMP STATE (CANONICAL) ===\nThe air pump is ${running ? `ON — actively inflating ${playerLabel} RIGHT NOW` : 'OFF — NOT running right now'}. This is ground truth from the hardware. Never state or imply the opposite.\n=== END PUMP STATE ===\n`;
  } catch (e) { return ''; }
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

// Late-bound resolver for [CharCapacity:member] inside event-engine substitutions (tree
// conditions, Set CharVar values, flow text). Injected so the engine needs no knowledge of
// per-char storage; called lazily only when the :member form actually appears. Returns the
// member's capacity, or null when the key matches nobody on the active card.
eventEngine.resolveMemberCapacity = (key) => {
  try {
    const settings = loadData(DATA_FILES.settings) || {};
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const card = chars.find(c => c.id === settings.activeCharacterId);
    const mm = card?.multiChar?.characters || [];
    const k = String(key).trim().toLowerCase();
    const idx = mm.findIndex(m => m && ((m.name || '').toLowerCase() === k || m.id === String(key).trim()));
    if (idx >= 0) return idx === 0 ? Math.round(sessionState.characterCapacity ?? 0) : Math.round(sessionState.memberCapacities?.[mm[idx].id] ?? 0);
    // Base character by card name — single cards have no members array (parity with server-side).
    if ((card?.name || '').trim().toLowerCase() === k || (sessionState.characterName || '').trim().toLowerCase() === k) {
      return Math.round(sessionState.characterCapacity ?? 0);
    }
    return null;
  } catch (e) { return null; }
};
// [Group] for event-engine substitutions (tree conditions, Set CharVar values, flow text).
eventEngine.resolveGroupList = () => resolveGroupListString();
// [Secs2Pct:N] for event-engine substitutions — pump-rate math lives server-side.
eventEngine.resolveSecs2Pct = (secs) => resolveSecs2Pct(secs);

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
// ---- Custom Devices (E1: extracted to lib/custom-devices.js — store, actuation, LLM-tag hook, routes) ----
const { loadCustomDevices, executeCustomDeviceControl, clearAllCustomDeviceTimers } =
  require('./lib/custom-devices')({ app, readJsonCached, loadData, DATA_FILES, resolveControlId, MAX_ON_SECONDS, deviceService, aiDeviceControl });

const serverTimedPumpTimers = new Map();

function clearServerTimedPumpTimer(id) {
  const t = serverTimedPumpTimers.get(id);
  if (t) {
    clearTimeout(t);
    serverTimedPumpTimers.delete(id);
  }
  forcedPumpExemptions.delete(id); // an explicit off ends the forced-run freeze exemption
}

function clearAllServerTimedPumpTimers() {
  for (const t of serverTimedPumpTimers.values()) {
    try { clearTimeout(t); } catch (e) { /* ignore */ }
  }
  serverTimedPumpTimers.clear();
  clearPctPumpFollowUps(); // percentage-mode shortfall checks die with the pump timers
}

// Percentage-mode shortfall compensation (audit D7): if the gauge froze mid-run (a popup or ">>"
// gate opened), part of the physical run wasn't banked and the increase comes up short of the
// request. After the timed run ends — and once the gauge can bank again — extend ONCE by the
// shortfall, capped at the original run length so a pathological freeze can never more than
// double the physical pump time. Cleared alongside the pump timers on emergency stop.
const pctPumpFollowUps = new Map(); // pumpId -> timeout
// FORCED pump runs BANK THROUGH the gauge freeze (user ruling): the freeze exists for scene
// pacing (message generation, ">>" gates) and still applies to AMBIENT running (LLM [pump on]
// tags idling across stalls) — but any deliberate actuation (trigger actions in any mode,
// pulses, cycles, buttons, manual presses) is physical delivery and must tick the gauge live.
// Keyed by the device's tracker key; timed runs expire shortly after their scheduled end,
// latch/cycle runs stay exempt until the device turns off (device_off cleans up).
// True (unrounded) capacity. The displayed gauge is Math.round()ed — percentage runs aim at an
// INTEGER target computed from this, otherwise fractional drift makes a +2 request display as
// +1 or +3 depending on where the rounding boundaries fall.
function computeTrueCapacityUnrounded() {
  const devices = loadData(DATA_FILES.devices) || [];
  let total = 0;
  for (const [key, tracker] of Object.entries(sessionState.pumpRuntimeTracker || {})) {
    const d = devices.find(dd => dd.ip === key || `${dd.ip}:${dd.childId}` === key || dd.deviceId === key);
    if (!d?.calibrationTime) continue;
    const eff = tracker.effectiveSeconds !== undefined ? tracker.effectiveSeconds : (tracker.totalSeconds || 0);
    total += (eff / d.calibrationTime) * 100;
  }
  return Math.max(0, total + (sessionState.capacityOffset || 0));
}

const forcedPumpExemptions = new Map(); // deviceKey -> exemptUntilMs (Infinity for latch/cycle)
function exemptForcedRun(id, seconds) {
  const secs = Number(seconds);
  const until = (Number.isFinite(secs) && secs > 0) ? Date.now() + (Math.min(secs, MAX_ON_SECONDS) + 5) * 1000 : Infinity;
  forcedPumpExemptions.set(id, until);
}
function clearPctPumpFollowUps() {
  for (const t of pctPumpFollowUps.values()) { try { clearTimeout(t); } catch (e) { /* ignore */ } }
  pctPumpFollowUps.clear();
  forcedPumpExemptions.clear();
}
function schedulePctShortfallCheck(id, pump, startCap, requestedInc, origSecs, retries = 0) {
  const prior = pctPumpFollowUps.get(id);
  if (prior) clearTimeout(prior);
  const delay = retries === 0 ? (origSecs * 1000 + 750) : 2000;
  pctPumpFollowUps.set(id, setTimeout(() => {
    pctPumpFollowUps.delete(id);
    try {
      if (isGaugeFrozen()) { // still stalled — measure once banking resumes (bounded ~5 min)
        if (retries < 150) schedulePctShortfallCheck(id, pump, startCap, requestedInc, origSecs, retries + 1);
        return;
      }
      const now = Math.min(100, Math.max(0, sessionState.capacity || 0));
      const banked = now - startCap;
      const shortfallPct = Math.min(requestedInc - banked, 100 - now);
      if (!(shortfallPct > 0.5)) return; // delivered (or ceiling) — nothing to make up
      if (!(pump.calibrationTime > 0)) return;
      const sfSettings = loadData(DATA_FILES.settings) || {};
      const modifier = sfSettings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
      const extraSecs = Math.min((shortfallPct / 100) * pump.calibrationTime / (modifier || 1), origSecs);
      if (extraSecs < 0.5) return;
      console.log(`[Trigger/pump_on] Percentage shortfall: banked +${banked.toFixed(1)}% of the requested ${requestedInc}% (gauge froze mid-run) — extending once by ${extraSecs.toFixed(1)}s`);
      timedPumpOn(id, pump, extraSecs).catch(e => console.error('[pump_on] shortfall extension failed:', e?.message || e));
    } catch (e) { console.error('[pump_on] shortfall check failed:', e?.message || e); }
  }, delay));
}

/**
 * Turn a pump on for a bounded duration, scheduling a tracked turn-off that
 * emergency stop / the watchdog will cancel. Duration is clamped to MAX_ON_SECONDS.
 */
async function timedPumpOn(id, device, durationSeconds) {
  const dur = Math.max(1, Math.min(Number(durationSeconds) || 1, MAX_ON_SECONDS));
  clearServerTimedPumpTimer(id);
  exemptForcedRun(id, dur); // every timedPumpOn caller is a deliberate actuation — gauge banks through any freeze
  // durationInfo lets the frontend pump timer count DOWN instead of up.
  const onResult = await deviceService.turnOn(id, device, { untilType: 'timer', untilValue: dur });
  // A failed physical turn-on used to vanish here — the UI showed "pump on" while nothing ran and
  // the gauge (tracking starts only on SUCCESS) never moved. Surface it loudly instead.
  if (onResult && onResult.ok === false) {
    console.error(`[timedPumpOn] turnOn FAILED for ${id}: ${onResult.error || 'unknown'} — pump did not start, gauge will not move`);
    try { broadcast('trigger_toast', { text: `⚠ Pump failed to start: ${onResult.error || 'device unreachable'}`, preset: 'crimson' }); } catch (e) { /* boot */ }
  }
  const timer = setTimeout(() => {
    serverTimedPumpTimers.delete(id);
    deviceService.turnOff(id, device).catch((err) => {
      console.error(`[timedPumpOn] turnOff failed for ${id}:`, err && err.message ? err.message : err);
    });
  }, dur * 1000);
  serverTimedPumpTimers.set(id, timer);
}

// Await a timed pump run's completion ("await completion before continuing tree" tickbox):
// resolves when the tracked auto-off timer is gone — normal expiry, an explicit pump-off, or
// emergency stop all release it. Percentage-mode shortfall extensions re-arm the same timer id,
// so the wait naturally covers them. Deadline guard = run length + 10s so nothing hangs forever.
async function awaitTimedPumpCompletion(id, secs) {
  const deadline = Date.now() + Math.min(Number(secs) || 1, MAX_ON_SECONDS) * 1000 + 10000;
  while (serverTimedPumpTimers.has(id) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
  }
}

// Effective max pump-ON seconds for automated/checkpoint/trigger pump firing. The PRIMARY pump's
// own limit (per-device, via getCharacterLimits) takes priority, then it is capped by the global
// LLM device-control max. Mirrors the clamp the LLM [pump on] path already applies.
function effectiveMaxOnSeconds(settings) {
  const s = settings || loadData(DATA_FILES.settings) || {};
  const globalMax = Number(s.globalCharacterControls?.llmDeviceControlMaxSeconds) || 30;
  const deviceMax = Number(getCharacterLimits(null)?.llmMaxOnDuration) || 5;
  // Checkpoint range LIMIT SWITCH takes precedence when set and lower: checkpoint → per-pump → global.
  let eff = Math.max(1, Math.min(deviceMax, globalMax));
  const rangeCap = sessionState.rangePumpCapSecs;
  if (Number.isFinite(rangeCap) && rangeCap > 0) eff = Math.max(1, Math.min(eff, rangeCap));
  return eff;
}

// A pump must NOT start when capacity is at/above 100% and over-inflation is not allowed.
function pumpBlockedByCapacity(settings) {
  const s = settings || loadData(DATA_FILES.settings) || {};
  if (s.globalCharacterControls?.allowOverInflation) return false;
  return (sessionState.capacity || 0) >= 100;
}

// Latched-pump re-assertion (per-char latchPumpUntilOff). When sessionState.playerIsInflating is
// set, keep the primary pump ON every reply turn — tagged or not — until [pump off]. Deliberately
// schedules NO auto-off timer and clears any stray one, so the latch overrides time-based limits.
// The capacity/pop watchdog still applies. Called from runReplyScopes each turn.
async function reassertLatchedPump() {
  if (!sessionState.playerIsInflating) return;
  try {
    const devices = loadData(DATA_FILES.devices) || [];
    const pump = getPrimaryPumpDevice(devices);
    if (!pump) return;
    const id = resolveControlId(pump);
    clearServerTimedPumpTimer(id); // a latch must never be ended by a leftover auto-off timer
    await deviceService.turnOn(id, pump);
    console.log('[LatchedPump] Re-asserted pump ON (playerIsInflating) — awaiting [pump off]');
  } catch (e) { console.error('[LatchedPump] re-assert failed:', e?.message || e); }
}

// Fire the primary pump for a checkpoint-injection action ({mode:'timed'|'cycle', duration, cycles}).
async function firePrimaryPump(action) {
  if (!action) return;
  // Never fire past the capacity ceiling unless over-inflation is enabled (matches the other paths).
  if (pumpBlockedByCapacity()) {
    console.log('[FirePump] Blocked — capacity at ceiling and over-inflation not allowed');
    return;
  }
  const devices = loadData(DATA_FILES.devices) || [];
  const pump = getPrimaryPumpDevice(devices);
  if (!pump) return;
  const id = resolveControlId(pump);
  // Clamp the on-time to the effective limit (per-device first, then global).
  const dur = Math.min(Number(action.duration) || 5, effectiveMaxOnSeconds());
  if (action.mode === 'cycle') {
    const cycles = Number(action.cycles) || 3;
    await deviceService.startCycle(id, { duration: dur, interval: dur, cycles }, pump);
    exemptForcedRun(id); // checkpoint-fired cycle = forced run
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
  // RETIRED as an auto-initiator. Pump pacing must NEVER guarantee the pump turns on — the pump fires
  // ONLY when the story/AI explicitly calls for it (a [pump on] tag, a checkpoint trigger, or a manual
  // control). The old behavior auto-fired a timed [pump on] every `messagesBetweenOn` replies, turning
  // the pump on for no narrative reason. `messagesBetweenOn` / `maxPumpOnSecs` remain a per-range hint
  // for how LONG / how OFTEN the story SHOULD pump (a throttle, not a scheduler); nothing auto-fires.
  return;
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

// Resolve a Trigger Tree device reference (ip / deviceId / id / name) to { id, device } for
// deviceService calls. Used by the device_on/off/start_cycle/stop_cycle/pulse_pump tree actions.
function resolveTriggerDevice(ref) {
  if (!ref) return null;
  const devices = loadData(DATA_FILES.devices) || [];
  const device = devices.find(d => d.ip === ref || d.deviceId === ref || d.id === ref || d.name === ref || resolveControlId(d) === ref);
  return device ? { id: resolveControlId(device), device } : null;
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

// ---- mtime-checked JSON read cache (audit C1) ----
// A single chat turn re-reads settings/devices/characters many times over; each used to be a
// full disk read + JSON.parse. Parsed values cache by path and invalidate purely by stat
// (mtime+size), so ANY writer — saveData, atomic writers, even hand-edits — is picked up on the
// next read with no invalidation hooks. Returns a structuredClone each time, so the pervasive
// "mutate the loaded object, maybe save it" call pattern can never poison the cache.
const _jsonCache = new Map(); // absolute path -> { mtimeMs, size, value }
function readJsonCached(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { _jsonCache.delete(file); return undefined; } // missing file
  const hit = _jsonCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return structuredClone(hit.value);
  const value = JSON.parse(fs.readFileSync(file, 'utf8')); // throws on corrupt JSON — callers keep their recovery paths
  _jsonCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
  return structuredClone(value);
}

function loadData(file) {
  try {
    const cached = readJsonCached(file);
    if (cached !== undefined) return cached;
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

// True if this id belongs to a SHIPPED default character (folder or flat form in default/). Default
// characters are read-only; the editor/API refuse to overwrite them (duplicate-to-edit instead).
function isDefaultCharacterId(charId) {
  if (!isSafeId(charId)) return false;
  return fs.existsSync(path.join(CHARS_DEFAULT_DIR, charId, 'char.json'))
      || fs.existsSync(path.join(CHARS_DEFAULT_DIR, `${charId}.json`));
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
    try {
      const char = readJsonCached(charPath); // clone — the mutations below never touch the cache
      if (char === undefined) continue;
      char._isDefault = isDefault;
      return migrateCharPortraitMedia(char);
    } catch (e) {
      console.error(`Error loading character ${charId}:`, e);
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

  // COPY-ON-WRITE: a default character's normal save goes to custom/ so the git-tracked default stays
  // pristine (gameplay/edits never dirty the repo, which would block start.sh auto-updates). Only an
  // explicit "save as factory default" (syncFactory) writes into default/ + the factory backup.
  const writeToDefault = isDefault && syncFactory;

  // Process any base64 images and save them to disk (to the same tree we persist the JSON in)
  const processedChar = await imageStorage.processCharacterImages(char, writeToDefault);

  // Save to new folder structure
  await imageStorage.saveCharacterJson(processedChar, writeToDefault);
  updateCharIndex(processedChar, writeToDefault ? 'default' : 'custom');

  // Only an explicit "save as factory default" syncs into the git-tracked factory tree.
  if (writeToDefault) {
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
  const isDefaultId = !forceCustom && (
    fs.existsSync(path.join(CHARS_DEFAULT_DIR, char.id, 'char.json')) ||
    fs.existsSync(path.join(CHARS_DEFAULT_DIR, `${char.id}.json`))
  );
  // COPY-ON-WRITE: normal saves of a default character go to custom/ (keeps the git-tracked default
  // pristine); only an explicit "save as factory default" (syncFactory) writes default/ + factory.
  const writeToDefault = isDefaultId && syncFactory;

  const charDir = path.join(writeToDefault ? CHARS_DEFAULT_DIR : CHARS_CUSTOM_DIR, char.id);
  if (!fs.existsSync(charDir)) {
    fs.mkdirSync(charDir, { recursive: true });
  }

  // Strip runtime-only fields so they never get persisted (or pushed to factory).
  const { _isDefault, ...toPersist } = char;
  const targetPath = path.join(charDir, 'char.json');
  atomicWriteJson(targetPath, toPersist);
  updateCharIndex(char, writeToDefault ? 'default' : 'custom');

  // Sync default characters to factory backup (whole dir, including img/) ONLY on
  // explicit request — never during normal gameplay/startup.
  if (writeToDefault) {
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

  // Dedup by id — a custom copy of a default id (copy-on-write) overrides the pristine default entry
  // (custom is scanned last, so it wins the Map).
  const deduped = [...new Map(index.map(c => [c.id, c])).values()];
  saveCharsIndex(deduped);
  console.log(`[Server] Rebuilt characters index: ${deduped.length} characters found`);
  return deduped;
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
  // Pump/device + capacity controls (edited in Settings → Pump Data → Automatic Pumps → Settings,
  // plus the Characters page for startNewSessionOnSelect). AI Pump Control + Auto-Capacity on by
  // default; Pump Trigger Phrase Assist off by default.
  globalCharacterControls: {
    // Off by default: loading a character restores its most-recent chat; "New" wipes it.
    startNewSessionOnSelect: false,
    allowLlmDeviceControl: true,
    useAutoCapacity: true,
    allowProseReinforcement: false,
    autoCapacityMultiplier: 1.0,
    llmDeviceControlMaxSeconds: 30,
    llmDeviceControlPulseDuration: 3,
    allowOverInflation: false,
    enableAutoPopRoleplay: false,
    autoPopMode: 'fixed',
    autoPopFixedPercent: 110,
    autoPopRandomMin: 100,
    autoPopRandomMax: 150,
    hidePlayerBurstFromDetails: true,
    // Group "Individual Responses" mode: hold behind the ">>" Next gate between each member's reply
    // (same UX as consecutive sequential-trigger messages) so the player reads each before the next
    // generates. On by default; set false for rapid-fire individual replies.
    pauseBetweenIndividualReplies: true,
    // Strip model scaffolding (scene headers like "# NEW SCENE", analysis/OOC preambles) that wraps the
    // actual roleplay reply. Only trims clearly-meta text outside the first/last "/* markers. On by default.
    stripModelScaffolding: true,
    // Remove stray [bracketed] stage directions/meta the model emits (preserving [pump on] etc. device
    // tags) from both the chat bubble and the stored context. On by default.
    stripBracketsFromReplies: true,
  },
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
      // === RECOMMENDED MODEL — llama.cpp / LlamaHerder ===
      // Cydonia 24B (TheDrummer) — a Mistral-Small-24B roleplay finetune, the preferred model for
      // SwellDreams. This preset targets a llama.cpp server (default port 8080, /completion). LlamaHerder
      // users point llmUrl at their host/IP. text_completion so the FULL sampler set is delivered
      // (min-p/DRY/temp-last — the chat-completion path only sends temp/top_p/penalties). Mistral V7
      // "Tekken" template, temperature-last, light DRY, min-p — a coherent, characterful baseline.
      id: 'default-cydonia24b-llamacpp',
      samplerRev: 3,
      name: 'Cydonia 24B — llama.cpp / LlamaHerder (Recommended)',
      llmUrl: 'http://localhost:8080/',
      apiType: 'text_completion',
      endpointStandard: 'llamacpp',
      promptTemplate: 'mistral-tekken',
      supportsSystemRole: true,
      maxTokens: 400,
      contextTokens: 16384,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 175,
      temperature: 1.0,
      topK: 0,
      topP: 1,
      typicalP: 1,
      minP: 0.05,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.05,
      repPenRange: 2048,
      repPenSlope: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      neutralizeSamplers: false,
      samplerOrder: [],
      dryMultiplier: 0.8,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: 0,
      drySequenceBreakers: ['\n', ':', '"', '*'],
      dynaTempRange: 0,
      dynaTempExponent: 1,
      xtcProbability: 0,
      xtcThreshold: 0.1,
      smoothingFactor: 0,
      smoothingCurve: 1,
      mirostat: 0,
      mirostatTau: 5,
      mirostatEta: 0.1,
      minKeep: 0,
      temperatureLast: true,
      noRepeatNgramSize: 0,
      skew: 0,
      repPenDecay: 0,
      stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
      bannedTokens: [],
      grammar: '',
      isDefault: false
    },
    {
      // === RECOMMENDED MODEL — KoboldCpp ===
      // Same Cydonia 24B baseline, but for a KoboldCpp server (default port 5001, /api/v1/generate).
      // Point llmUrl at your host if not local. Same Mistral-Tekken + temp-last + min-p + DRY tuning.
      id: 'default-cydonia24b-kobold',
      samplerRev: 3,
      name: 'Cydonia 24B — KoboldCpp (Recommended)',
      llmUrl: 'http://localhost:5001/api/v1/generate',
      apiType: 'text_completion',
      endpointStandard: 'kobold',
      promptTemplate: 'mistral-tekken',
      supportsSystemRole: true,
      maxTokens: 400,
      contextTokens: 16384,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 175,
      temperature: 1.0,
      topK: 0,
      topP: 1,
      typicalP: 1,
      minP: 0.05,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.05,
      repPenRange: 2048,
      repPenSlope: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      neutralizeSamplers: false,
      samplerOrder: [],
      dryMultiplier: 0.8,
      dryBase: 1.75,
      dryAllowedLength: 2,
      dryPenaltyLastN: 0,
      drySequenceBreakers: ['\n', ':', '"', '*'],
      dynaTempRange: 0,
      dynaTempExponent: 1,
      xtcProbability: 0,
      xtcThreshold: 0.1,
      smoothingFactor: 0,
      smoothingCurve: 1,
      mirostat: 0,
      mirostatTau: 5,
      mirostatEta: 0.1,
      minKeep: 0,
      temperatureLast: true,
      noRepeatNgramSize: 0,
      skew: 0,
      repPenDecay: 0,
      stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
      bannedTokens: [],
      grammar: '',
      isDefault: false
    },
    {
      // Cloud inference via OpenRouter. Ships blank — add your own key + model in
      // Settings -> Model. Chat-completion endpoint (system role supported).
      id: 'default-openrouter',
      name: 'OpenRouter',
      llmUrl: '',
      apiType: 'chat_completion',
      endpointStandard: 'openrouter',
      promptTemplate: 'chatml',
      supportsSystemRole: true,
      maxTokens: 320,
      contextTokens: 8192,
      streaming: true,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 1,
      topK: 0,
      topP: 1,
      typicalP: 1,
      minP: 0,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1,
      repPenRange: 0,
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
      maxTokens: 200,
      contextTokens: 4096,
      streaming: false,
      trimIncompleteSentences: true,
      impersonateMaxTokens: 150,
      temperature: 0.75,
      topK: 0,
      topP: 0.92,
      typicalP: 1,
      minP: 0.05,
      topA: 0,
      tfs: 1,
      topNsigma: 0,
      repetitionPenalty: 1.1,
      repPenRange: 1024,
      repPenSlope: 0.7,
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
      isDefault: true
    }
  ];

  const profiles = loadData(DATA_FILES.connectionProfiles) || [];
  let added = false;

  // Drop the superseded single Cydonia preset (v6.6.33) — replaced by split llama.cpp / KoboldCpp
  // presets in v6.6.34. Safe: it only existed briefly and used chat_completion (dropped most samplers).
  const staleCyd = profiles.findIndex(p => p.id === 'default-cydonia24b');
  if (staleCyd >= 0) { profiles.splice(staleCyd, 1); added = true; console.log('[Startup] Removed superseded Cydonia preset (split into llama.cpp / KoboldCpp)'); }

  // REVERT (v6.6.94): the v6.6.93 "v4-line" sampler retune made things worse — restore the original
  // Cydonia baseline (temp 1.0, top_p 1, min_p 0.05, rep-pen 1.05, dynatemp/XTC off). samplerRev bumped
  // to 3 so this reverses the runtime whether or not the rev-2 retune already ran, without re-clobbering
  // a user's own later tweaks.
  const CYDONIA_SAMPLER_REV = 3;
  const CYDONIA_SAMPLERS = {
    temperature: 1.0, topK: 0, topP: 1, typicalP: 1, minP: 0.05, topA: 0, tfs: 1, topNsigma: 0,
    repetitionPenalty: 1.05, dynaTempRange: 0, dynaTempExponent: 1, xtcProbability: 0, xtcThreshold: 0.1,
  };
  const isCydoniaProfile = (id) => id === 'default-cydonia24b-llamacpp' || id === 'default-cydonia24b-kobold';
  for (const p of profiles) {
    if (isCydoniaProfile(p.id) && p.samplerRev !== CYDONIA_SAMPLER_REV) {
      Object.assign(p, CYDONIA_SAMPLERS, { samplerRev: CYDONIA_SAMPLER_REV });
      added = true;
      console.log(`[Startup] Restored original Cydonia samplers: ${p.name || p.id}`);
    }
  }
  // settings.llm is a COPY of the active profile, so also restore the LIVE session if it's a Cydonia one.
  try {
    const st = loadData(DATA_FILES.settings);
    if (st?.llm && isCydoniaProfile(st.llm.activeProfileId) && st.llm.samplerRev !== CYDONIA_SAMPLER_REV) {
      st.llm = { ...st.llm, ...CYDONIA_SAMPLERS, samplerRev: CYDONIA_SAMPLER_REV };
      saveData(DATA_FILES.settings, st);
      console.log('[Startup] Restored original ACTIVE Cydonia samplers');
    }
  } catch (e) { console.error('[Startup] Cydonia sampler restore failed:', e?.message || e); }

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
    // Drop the now-migrated top-level example dialogues so they can't shadow story-level edits made
    // later in the unified editor (buildChatContext prefers top-level when present).
    delete character.exampleDialogues;

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
  memberCapacities: {}, // Per-member simulated inflation for group cards, keyed by member id (base member 0 uses characterCapacity)
  characterInflationBaseCapacity: 0, // capacity when inflation started (to add to)
  preInflationGateMet: true, // When false, blocks LLM-initiated pump commands until capacity > 0
  firedTreeNodes: new Set(), // Per-session Trigger Tree "once" set; key: `${treeId}::${scopeKey}::${nodeId}`
  checkpointControl: null, // Session overrides from Checkpoint Control blocks: { ranges: {key:'on'|'off'}, events: 'on'|'off'|null }; null slot = card default
  pendingIntroStart: null, // Gated intro deferred behind a suspended Session Start tree: { welcomePosted }
  suppressReplyThisTurn: false, // set by a keyword gate/event with "Suppress AI reply" — this turn generates nothing
  sessionStartActive: false, // true while the session-start chain (incl. suspensions) is still running — event triggers stay silent
  eventTriggerOverrides: null, // Event Trigger Toggle blocks: { all: 'on'|'off'|null, byName: {name: 'on'|'off'} }
  btnTreeRunSeq: 0, // Monotonic press counter — gives each button "Run Tree" press a unique once-scope (btn:<id>#<seq>)
  selectedChar: null, // Tree Select Member pick (member NAME) for [SelectedChar]; null resolves to the
                      // base character at read time, and every runTreeScope resets it so trees stay agnostic
  playerInputs: {}, // Tree Player Input popup values, 1-based per form ([PlayerInput:Row#]); replaced wholesale on each OK
  pendingTreeChoice: null, // Armed when a tree player_choice/choose_multi suspends; { choices, ctxSnapshot, after }
  pendingTreeResume: null, // Armed when a tree pause_resume suspends; { remaining, body, ctxSnapshot, after }
  pendingTreeGame: null, // Armed when a tree call_minigame suspends; { miniGameId, exitGotos, ctxSnapshot, after }
  pendingTreeNext: null, // Armed when a tree holds on the ">>" gate between back-to-back standalone messages; { ctxSnapshot, after }
  playerIsInflating: false, // Latched-pump mode (per-char latchPumpUntilOff): [pump on] latches the pump
                           // ON across every reply until [pump off]; overrides time-based auto-off + limits.
                           // Exposed as the [PlayerIsInflating] system variable. Capacity/pop ceiling still applies.
  awaitingGoRelease: false, // Manual "GO!" gate hold: intro/profile-assign waits for a player button press
  releaseButtonLabel: null, // Label for the release button ('GO!' default, 'READY!' for intro READY-exit)
  pendingGoProfileId: null, // checkpoint profile to load when GO! is pressed (stashed by the manual-release path)
  pendingRangeAwait: null,  // A paused checkpoint-trigger sequence waiting on an await gate:
                            // { kind:'pump'|'input', target?, count?, words?, rest:[triggers], source, characterId }
  pendingCapacityGate: null, // A Fire% gate holding a checkpoint sequence until capacity reaches target.
                            // SEPARATE slot from pendingRangeAwait so a message/next-gate WAIT can't clobber
                            // it. Resolves when capacity >= target AND no message-gate is open (queued behind
                            // the WAIT). { kind:'capacity', type, target, rest:[triggers], source, characterId }
  groupRotation: 0,         // Round-robin lead counter for group "Individual Responses" mode
  // PUMP-READY: who is connected to a pump and may be described being inflated. Live per-session
  // (reset on new session / character switch). Persona defaults ON; character/members default OFF
  // (enabled manually). members keyed by member id.
  pumpReady: { persona: true, character: false, members: {} },
  soloSpeaker: null         // when set (member id), buildMultiCharSystemPrompt constrains the cast to
                            // just this member (used by Individual Responses + member-targeted triggers/guided)
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

// ---- Checkpoint group on/off (per range group + the Event Triggers group) ----
// Card default: profile.treeRefs.rangeDisabled = { '1-10': true, ... } / treeRefs.eventsDisabled
// (absent = ON — new cards start all-enabled). A Checkpoint Control tree block writes a
// SESSION-scoped override ('on'|'off') that wins over the card until session reset — so an
// endgame tree can silence range checkpoints/events for the rest of the session (or re-arm them).
const CHECKPOINT_RANGE_KEYS = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '100+'];
function checkpointGroupEnabled(kind, key, character) {
  const cc = sessionState.checkpointControl;
  if (kind === 'events') {
    if (cc?.events) return cc.events === 'on';
    return character ? resolveScopeRefs(character).eventsDisabled !== true : true;
  }
  const ov = cc?.ranges?.[key];
  if (ov) return ov === 'on';
  return character ? !(resolveScopeRefs(character).rangeDisabled || {})[key] : true;
}
// Strip the axis prefix off a checkpoint-sequence source ('player-41-50' → '41-50').
function rangeKeyOfSource(source) {
  return String(source || '').replace(/^(p-)?(player|char)-/, '');
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
// Fire a sequential list of checkpoint triggers from startIdx. On hitting an await gate
// (await_pump / await_input), stash the REMAINING triggers in pendingRangeAwait and PAUSE —
// handleManualPump (pump) or a matching player message (input) resumes the rest. Mirrors the
// tree pause_resume pattern. resumeTriggerSequence() continues a paused sequence.
async function fireTriggerSequence(triggers, startIdx, source, character, settings) {
  // Gauge freeze while the chain executes (incl. its LLM generations): nested calls
  // (capacity_inrange) stack the counter; the finally + outermost check below unwind it.
  sessionState.triggerChainDepth = (sessionState.triggerChainDepth || 0) + 1;
  try {
    return await fireTriggerSequenceInner(triggers, startIdx, source, character, settings);
  } finally {
    sessionState.triggerChainDepth = Math.max(0, (sessionState.triggerChainDepth || 1) - 1);
    // Outermost chain finished: if a Fire% gate is armed and its target was already met while we
    // were frozen, fire it now (tryResumeCapacityGate self-guards on gate/freeze/capacity).
    if (sessionState.triggerChainDepth === 0) {
      Promise.resolve(tryResumeCapacityGate()).catch(e => console.error('[Fire% resume] post-chain failed:', e?.message || e));
    }
  }
}

async function fireTriggerSequenceInner(triggers, startIdx, source, character, settings) {
  const seqEpoch = triggerSeqEpoch; // a Cancel Current block bumps the epoch — this run stops at its next step
  // Whose capacity a Fire% gate compares against (player vs character), derived from the range key.
  // includes() so persona keys ('p-char-11-20') resolve to the char axis too, not just 'char-…'.
  const gateType = String(source || '').includes('char-') ? 'char' : 'player';
  // "Next" (>>) gate: when a sequence fires two+ GENERATED messages back-to-back, pause between them so
  // the player can read one before the next starts (they take time to generate and can spam). Only
  // message actions gate. lastWasMessage is per-run: on resume the first action already got the >>
  // press, so it fires immediately and never re-gates.
  const isMsgAction = (t) => t && (t.type === 'ai_message' || t.type === 'ai_message_member' || t.type === 'impersonate');
  let lastWasMessage = false;
  for (let i = startIdx; i < (triggers || []).length; i++) {
    if (seqEpoch !== triggerSeqEpoch) { console.log(`[Trigger/${source}] sequence aborted — Cancel Current fired`); return; }
    const trg = triggers[i];
    // Fire% gate: pause the sequence until capacity reaches this trigger's exact %. No-Fire%
    // triggers fire as soon as the sequence reaches them; a Fire% trigger holds the rest of the
    // sequence until that % is hit, then fires and continues (resumed by executeCheckpointTriggers).
    const fp = Number(trg.firePercent);
    if (Number.isFinite(fp) && fp > 0) {
      const cap = gateType === 'char' ? (sessionState.characterCapacity || 0) : (sessionState.capacity || 0);
      if (cap < fp) {
        sessionState.pendingCapacityGate = { kind: 'capacity', type: gateType, target: fp, rest: triggers.slice(i), source, characterId: character.id };
        broadcast('capacity_gate', { active: true, target: fp, gateType, now: cap });
        console.log(`[Trigger/${source}] Fire% gate — holding sequence until capacity reaches ${fp}% (now ${cap}%)`);
        return;
      }
    }
    // Capacity In-Range block: a synchronous branch. Runs its NESTED triggers only when current
    // capacity is in [min,max]; otherwise the block is skipped. Stack several with non-overlapping
    // ranges to switch behaviour by capacity (exactly one block applies).
    if (trg.type === 'capacity_inrange') {
      const lo = Number.isFinite(Number(trg.min)) ? Number(trg.min) : 0;
      const hi = Number.isFinite(Number(trg.max)) ? Number(trg.max) : 200;
      const cap = gateType === 'char' ? (sessionState.characterCapacity || 0) : (sessionState.capacity || 0);
      const block = Array.isArray(trg.triggers) ? trg.triggers : [];
      if (cap >= lo && cap <= hi) {
        console.log(`[Trigger/${source}] Capacity In-Range [${lo}-${hi}] — ${cap}% in range, running ${block.length} nested action(s)`);
        const awaitBefore = sessionState.pendingRangeAwait, gateBefore = sessionState.pendingCapacityGate;
        await fireTriggerSequence(block, 0, source, character, settings);
        // If the nested block ARMED a gate (await/Fire%/next), STOP this outer sequence — continuing
        // would fire outer triggers over the armed gate, and a later outer await would clobber the
        // single pendingRangeAwait slot (the nested rest would be silently lost).
        if ((sessionState.pendingRangeAwait && sessionState.pendingRangeAwait !== awaitBefore) ||
            (sessionState.pendingCapacityGate && sessionState.pendingCapacityGate !== gateBefore)) {
          console.log(`[Trigger/${source}] Nested In-Range block armed a gate — halting the outer sequence (place outer follow-ups inside the block)`);
          return;
        }
      } else {
        console.log(`[Trigger/${source}] Capacity In-Range [${lo}-${hi}] — ${cap}% out of range, skipping block`);
      }
      continue;
    }
    if (trg.type === 'await_pump') {
      const target = Math.max(1, parseInt(trg.count, 10) || 1);
      sessionState.pendingRangeAwait = { kind: 'pump', target, count: 0, rest: triggers.slice(i + 1), source, characterId: character.id };
      broadcast('await_state', { kind: 'pump', target, count: 0 });
      console.log(`[Trigger/${source}] Await Pump Amount armed — needs ${target} pump(s)`);
      return;
    }
    if (trg.type === 'await_input') {
      const words = String(trg.words || '').split(',').map(w => w.trim()).filter(Boolean);
      // Who may satisfy the keyword gate: 'player' (default), 'char', or 'either'.
      const speaker = ['player', 'char', 'either'].includes(trg.speaker) ? trg.speaker : 'player';
      sessionState.pendingRangeAwait = { kind: 'input', words, speaker, rest: triggers.slice(i + 1), source, characterId: character.id };
      broadcast('await_state', { kind: 'input', words, speaker });
      console.log(`[Trigger/${source}] Await Input armed — words: ${words.join(', ')} (speaker: ${speaker})`);
      return;
    }
    // Next gate: hold before a message that follows another message in this run, until the player hits >>.
    if (isMsgAction(trg) && lastWasMessage) {
      sessionState.pendingRangeAwait = { kind: 'next', rest: triggers.slice(i), source, characterId: character.id };
      broadcast('next_gate', { active: true });
      console.log(`[Trigger/${source}] Next gate — holding before a consecutive message; waiting for player >>`);
      return;
    }
    await executeTrigger(trg, source, character, settings);
    if (isMsgAction(trg)) lastWasMessage = true;
  }
}

// Resume a paused await sequence (the stashed `rest` triggers). Reloads the character fresh.
async function resumeTriggerSequence(pending) {
  if (!pending) return;
  sessionState.pendingRangeAwait = null;
  broadcast('await_state', null);
  const settings = loadData(DATA_FILES.settings);
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === pending.characterId);
  if (!character) return;
  await fireTriggerSequence(pending.rest, 0, pending.source, character, settings);
}

// ---- WAIT / next-gate coordination: keep the Fire% gate and the pump paused while a ">>" gate is open ----
// True while a ">>" message/next-gate is holding a sequence (checkpoint 'next', individual 'next-individual',
// or a tree/intro pendingTreeNext). While open, capacity must NOT advance the Fire% gate or tick the pump.
function isNextGatePending() {
  const pa = sessionState.pendingRangeAwait;
  return !!(sessionState.pendingTreeNext || (pa && (pa.kind === 'next' || pa.kind === 'next-individual')));
}

// FULL gauge-freeze predicate: true whenever the SCENE is stalled — waiting on the player or on a
// trigger chain's LLM generations — so pump runtime (and char inflation) must NOT advance capacity.
// Covers, beyond the ">>" gates:
//   • pendingTreeChoice  — a Player Choice / Choose Multiple is on screen (human interaction)
//   • pendingTreeGame    — a MiniGame is open (human interaction)
//   • pendingRangeAwait 'input' — an Await Input keyword gate is armed (pump may have been left ON)
//   • triggerChainDepth  — a checkpoint trigger sequence is EXECUTING (incl. its LLM generation time)
// Deliberately NOT frozen:
//   • pendingCapacityGate (Fire%) — it WAITS for capacity to rise; freezing would deadlock it
//   • pendingTreeResume (Wait / Pause blocks) — they defer by REPLY TURNS of live play; scene time
//     is supposed to advance while they count down
//   • pendingRangeAwait 'pump' — the gate ASKS the player to pump; their pumping must register
function isGaugeFrozen() {
  return isNextGatePending()
    || !!sessionState.pendingTreeChoice
    || !!sessionState.pendingTreeGame
    || sessionState.pendingRangeAwait?.kind === 'input'
    || (sessionState.triggerChainDepth || 0) > 0;
}

// NOTE: the pump is NOT stopped during a WAIT — it keeps physically running (realistic). Instead the
// GAUGE is frozen in handlePumpRuntime (wait-period runtime is discarded, never banked), so capacity
// holds where it froze and resumes there when the WAIT clears — never a catch-up jump.

// After a WAIT clears, fire a queued Fire% gate whose capacity target is now met (queued behind the WAIT).
async function tryResumeCapacityGate() {
  const cg = sessionState.pendingCapacityGate;
  if (!cg || isGaugeFrozen()) return; // still stalled (>>/choice/game/input gate or an executing chain)
  const cap = cg.type === 'char' ? (sessionState.characterCapacity || 0) : (sessionState.capacity || 0);
  if (cap < cg.target) return; // not reached yet
  sessionState.pendingCapacityGate = null;
  broadcast('capacity_gate', { active: false });
  console.log(`[CheckpointTriggers] Fire% gate (${cg.target}%) resuming — WAIT cleared, capacity ${cap}%`);
  await resumeTriggerSequence(cg).catch(err => console.error('[Fire% resume] failed:', err?.message || err));
}

// Try to satisfy a pending Await Input keyword gate from a message. `speaker` is who spoke
// ('player' or 'char'); the gate only resolves if its configured speaker allows it.
async function tryResolveAwaitInput(content, speaker) {
  const pa = sessionState.pendingRangeAwait;
  if (!pa || pa.kind !== 'input') return;
  const allowed = pa.speaker || 'player';
  if (allowed !== 'either' && allowed !== speaker) return;
  const lc = String(content || '').toLowerCase();
  if ((pa.words || []).some(w => w && lc.includes(w.toLowerCase()))) {
    console.log(`[AwaitInput] matched by ${speaker} — resuming sequence`);
    await resumeTriggerSequence(pa).catch(err => console.error('[AwaitInput] resume failed:', err?.message || err));
  }
}

async function executeCheckpointTriggers(type, oldCapacity, newCapacity) {
  // Get the active character and story
  const settings = loadData(DATA_FILES.settings);
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  if (!activeCharacter) return;

  const activeStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
  if (activeStory?.checkpointsEnabled === false) return; // "Enable Checkpoints" tickbox off → no checkpoint triggers
  // All card types: checkpoint triggers come from the active checkpoint profile (legacy cards
  // fall back to the story-level set inside getActiveCheckpointProfile).
  const checkpointTriggers = getActiveProfileRangeTriggers(getActiveCheckpointProfile(activeCharacter)) || {};
  if (!checkpointTriggers) return;

  const newRange = capacityToRangeKey(newCapacity);
  const triggerKey = `${type}-${newRange}`;
  // Group toggle: a disabled range group fires NOTHING on entry (card default or session override).
  if (!checkpointGroupEnabled('range', newRange, activeCharacter)) {
    console.log(`[CheckpointTriggers] Range group ${newRange} is toggled OFF — skipping its sequence`);
    return;
  }
  const triggers = normalizeRangeTriggers(checkpointTriggers[triggerKey]).sequential;

  // (1) First time we're in this range (entered from another band OR rising from 0 within the first
  //     band): run its sequence IN ORDER. No-Fire% triggers fire immediately; a Fire% trigger holds
  //     the rest until its % is hit (fireTriggerSequence stashes a 'capacity' await). A new populated
  //     range takes priority over any pending await from a previous range (#21).
  if (triggers.length > 0 && !firedCheckpointTriggers.has(triggerKey)) {
    if (sessionState.pendingRangeAwait) {
      console.log('[CheckpointTriggers] New populated range — aborting pending await from a previous range');
      if (sessionState.pendingRangeAwait.kind === 'next' || sessionState.pendingRangeAwait.kind === 'next-individual') broadcast('next_gate', { active: false });
      sessionState.pendingRangeAwait = null;
      broadcast('await_state', null);
    }
    // Same precedence for an armed Fire% gate: the new range's sequence supersedes it. Abort LOUDLY
    // instead of letting the new sequence overwrite the slot mid-run (rest silently lost).
    if (sessionState.pendingCapacityGate) {
      const cg = sessionState.pendingCapacityGate;
      console.log(`[CheckpointTriggers] New populated range — aborting a pending Fire% gate (${cg.target}%, ${cg.rest?.length ?? 0} queued trigger(s)) from a previous range`);
      sessionState.pendingCapacityGate = null;
      broadcast('capacity_gate', { active: false });
    }
    firedCheckpointTriggers.add(triggerKey);
    tlRecord('range', { key: triggerKey });
    console.log(`[CheckpointTriggers] Starting sequence for ${triggerKey} (${triggers.length} trigger(s))`);
    await fireTriggerSequence(triggers, 0, triggerKey, activeCharacter, settings);
    return;
  }

  // (2) Resume a sequence paused at a Fire% gate once capacity reaches that gate's % — but only when no
  // message/next-gate WAIT is open. If one is, stay queued and let tryResumeCapacityGate() fire it when
  // the WAIT clears, so the gated message plays first (and pump-pause keeps capacity from overshooting).
  const cg = sessionState.pendingCapacityGate;
  if (cg && cg.type === type && newCapacity >= cg.target) {
    // The paused sequence's own group may have been toggled off since it armed — drop it.
    if (!checkpointGroupEnabled('range', rangeKeyOfSource(cg.source), activeCharacter)) {
      console.log(`[CheckpointTriggers] Fire% gate's source group (${cg.source}) is toggled OFF — dropping the queued sequence`);
      sessionState.pendingCapacityGate = null;
      broadcast('capacity_gate', { active: false });
      return;
    }
    if (isGaugeFrozen()) {
      console.log(`[CheckpointTriggers] Fire% gate (${cg.target}%) met at ${newCapacity}% — queued behind an open stall (gate/choice/game/chain)`);
    } else {
      sessionState.pendingCapacityGate = null;
      broadcast('capacity_gate', { active: false });
      console.log(`[CheckpointTriggers] Capacity reached Fire% gate (${cg.target}%) — resuming sequence`);
      await resumeTriggerSequence(cg).catch(err => console.error('[CheckpointTriggers] Fire% resume failed:', err?.message || err));
    }
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
  // Session-scoped Checkpoint Control override applies to persona ranges too (card defaults don't —
  // persona checkpoints are persona-level, so only the runtime kill-switch reaches them).
  if (!checkpointGroupEnabled('range', newRange, null)) {
    console.log(`[PersonaCheckpoints] Range group ${newRange} is toggled OFF — skipping`);
    return;
  }

  const prefix = type === 'player' ? 'p-player' : 'p-char';
  const triggerKey = `${prefix}-${newRange}`;
  if (firedCheckpointTriggers.has(triggerKey)) return;

  const settings = loadData(DATA_FILES.settings);
  const persona = settings?.activePersonaId ? loadPersona(settings.activePersonaId) : null;
  if (!persona?.checkpointTriggers) return;

  const triggers = normalizeRangeTriggers(persona.checkpointTriggers[triggerKey]).sequential;
  if (!triggers || triggers.length === 0) return;

  // Character checkpoint precedence: if a character checkpoint trigger already fired
  // for this range with the same trigger type, skip the persona version of that type.
  // Read from the ACTIVE CHECKPOINT PROFILE (same source executeCheckpointTriggers uses) —
  // this used to read the legacy story-level set, so precedence compared against stale data.
  const charTriggerKey = `${type}-${newRange}`;
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const charRangeTriggers = activeCharacter ? (getActiveProfileRangeTriggers(getActiveCheckpointProfile(activeCharacter)) || {}) : {};
  const charTriggers = normalizeRangeTriggers(charRangeTriggers[charTriggerKey]).sequential;
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

  // Route through the REAL sequence walker (this was a plain executeTrigger loop, so persona
  // scripts silently lost Fire%, Await Pump/Input, Capacity In-Range, and next-gates).
  await fireTriggerSequence(filteredTriggers, 0, triggerKey, activeCharacter, settings);
}

/**
 * Execute a single trigger action. Shared by post-welcome, checkpoint, and future trigger sources.
 */
// Declarative required-parameter contracts for trigger actions (audit B3). Field names verified
// against each case's reads. A missing required param used to silently no-op deep inside the case;
// now it logs ONE loud, actionable line and skips — so a misconfigured action is visible instantly.
const TRIGGER_REQUIRED_PARAMS = {
  device_on: ['device'], device_off: ['device'],
  play_audio: ['tag'], play_video: ['tag'], show_image: ['tag'],
  flow_var: ['variable'],
  toggle_button: ['buttonId'],
  // toggle_library_entry/toggle_reminder validate in-case (new triggers carry groupId/termId,
  // legacy ones only reminderId — a fixed required list would skip one shape or the other).
  set_instructor_profile: ['value'],
  char_capacity: ['value'],
  toggle_dictionary: ['groupId'],
};

// Wrap a message action's final text with its optional Prepend/Append Verbatim blocks: literal
// author text in the SAME bubble, before/after whatever was generated (or typed, for verbatim
// messages). Variables resolve at fire time. Applied BEFORE the message is stored/broadcast, so
// the combined text is exactly what lands in chat history — i.e. it is IN CONTEXT for later
// prompts, not display-only.
// LLM Enhance + verbatim wraps: tell the model about the fixed frame lines that will be added
// programmatically around its generated text, so the middle flows into them — and so it doesn't
// re-state them itself. Used by the standalone ai_message paths AND (via pendingReplyWraps) the
// in-reply weave in buildChatContext.
function wrapAwarenessNote(pre, app) {
  if (!pre && !app) return '';
  let n = `\n=== FIXED FRAME (added automatically around your reply) ===\n`;
  if (pre) n += `Your reply will be displayed OPENING with this exact text (do NOT repeat or paraphrase it): "${pre}"\n`;
  if (app) n += `Your reply will be displayed ENDING with this exact text (do NOT repeat or paraphrase it): "${app}"\n`;
  n += `Write your reply so it reads naturally with ${pre && app ? 'both lines' : 'that line'} in place. Never quote or mention this note.\n=== END FIXED FRAME ===\n`;
  return n;
}

function applyVerbatimWraps(text, trigger) {
  let out = text ?? '';
  const pre = trigger.prependVerbatim && String(trigger.prependText || '').trim() !== '' ? substituteAllVariables(trigger.prependText) : null;
  const app = trigger.appendVerbatim && String(trigger.appendText || '').trim() !== '' ? substituteAllVariables(trigger.appendText) : null;
  if (pre) out = `${pre}\n${out}`;
  if (app) out = `${out}\n${app}`;
  return out;
}

// Natural-language name list: "X" / "X and Y" / "X, Y, and Z" (Oxford comma). For [Group].
function formatNameList(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

// [Group] — everyone in the active card as a natural list; single cards resolve to the character.
function resolveGroupListString() {
  try {
    const settings = loadData(DATA_FILES.settings) || {};
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const card = chars.find(c => c.id === settings.activeCharacterId);
    const names = (card?.multiChar?.enabled ? (card.multiChar.characters || []) : []).map(m => m?.name).filter(Boolean);
    return formatNameList(names.length ? names : [card?.name || sessionState.characterName || '']);
  } catch (e) { return sessionState.characterName || ''; }
}

// [Secs2Pct:N] — how much capacity N seconds of the CURRENT (primary) pump adds, using the same
// math handlePumpRuntime banks with: seconds × autoCapacityMultiplier / calibrationTime × 100.
// Returns a "2%" / "2.5%" string, or null when no calibrated primary pump exists (callers leave
// the tag visible so the author sees the gap).
function resolveSecs2Pct(seconds) {
  try {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) return null;
    const devices = loadData(DATA_FILES.devices) || [];
    const pump = getPrimaryPumpDevice(devices);
    if (!pump || !(pump.calibrationTime > 0)) return null;
    const settings = loadData(DATA_FILES.settings) || {};
    const modifier = settings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
    const pct = (n * modifier / pump.calibrationTime) * 100;
    return `${Math.round(pct * 10) / 10}%`;
  } catch (e) { return null; }
}

// Resolve a trigger's member reference: a raw member id, a member NAME, or a variable like
// [SelectedChar] (substituted first, so the Select Member pick routes actions). Returns '' for
// the base character (empty ref, base id, or base name all normalize), a member id for others,
// or null when a non-empty ref matches nobody (caller should warn + fall back).
function resolveMemberRef(ref, character) {
  const raw = substituteAllVariables(String(ref ?? ''), { isPromptText: true }).trim();
  if (!raw) return '';
  const mm = character?.multiChar?.characters || [];
  let idx = mm.findIndex(m => m && m.id === raw);
  if (idx < 0) idx = mm.findIndex(m => m && (m.name || '').toLowerCase() === raw.toLowerCase());
  if (idx >= 0) return idx === 0 ? '' : mm[idx].id;
  // No member match — the BASE CHARACTER by card name (single cards have no members array;
  // [SelectedChar] resolves to the card name there, so 'into Luna' must mean the base char).
  if ((character?.name || '').trim().toLowerCase() === raw.toLowerCase()) return '';
  return null;
}

async function executeTrigger(trigger, source, character, settings) {
  const personas = loadAllPersonas() || [];
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  // Required-param gate (loud skip instead of a silent deep no-op)
  const reqParams = TRIGGER_REQUIRED_PARAMS[trigger?.type];
  if (reqParams) {
    const missing = reqParams.filter(f => trigger[f] === undefined || trigger[f] === null || trigger[f] === '');
    if (missing.length) {
      console.warn(`[Trigger/${source}] SKIPPED '${trigger.type}' — missing required parameter(s): ${missing.join(', ')} (fix the action in the editor)`);
      return;
    }
  }

  try {
    console.log(`[Trigger/${source}] Executing: ${trigger.type}`);

    switch (trigger.type) {
      case 'impersonate': {
        await waitForLlmIdle(); // queue behind any in-progress generation
        const { v4: uuidv4 } = require('uuid');
        broadcast('generating_start', { characterName: activePersona?.displayName || sessionState.playerName || 'Player', isPlayerVoice: true });
        const mode = trigger.context ? 'guided_impersonate' : 'impersonate';
        const impContext = buildSpecialContext(mode, trigger.context ? substituteAllVariables(trigger.context) : null, character, activePersona, settings);
        const impSettings = { ...settings.llm };
        if (settings.llm?.impersonateMaxTokens) impSettings.maxTokens = settings.llm.impersonateMaxTokens;
        // Optional per-action "Max Response Tokens" override (takes precedence over the impersonate default).
        const impMaxTok = Number(trigger.maxTokens);
        if (impMaxTok > 0) impSettings.maxTokens = clampMaxTokens(impMaxTok);
        impSettings.stopSequences = [...(settings.llm?.stopSequences || []), ...(impContext.stopSequences || [])];
        // Stream the impersonated player message into a bubble up-front (same as the char paths); the
        // impersonate action ALWAYS posts as the player without an AI reply (suppress is the immutable
        // default), so we post the message directly + fire the player-turn side effects, no handleChatMessage.
        const impStreaming = settings.llm?.streaming === true;
        // Live prepend: with Prepend Verbatim set, the bubble appears IMMEDIATELY with the literal
        // text so the player reads it while generation runs (streamed tokens land under it).
        const impPre = (trigger.prependVerbatim && String(trigger.prependText || '').trim() !== '') ? substituteAllVariables(trigger.prependText) : null;
        let impStreamMsg = null;
        let impResult;
        if (impStreaming || impPre) {
          impStreamMsg = { id: uuidv4(), content: impPre || '', sender: 'player', timestamp: Date.now(), streaming: impStreaming };
          sessionState.chatHistory.push(impStreamMsg);
          broadcast('chat_message', impStreamMsg);
        }
        if (impStreaming) {
          impResult = await llmService.generateStream({ prompt: impContext.prompt, messages: impContext.messages, systemPrompt: impContext.systemPrompt, settings: impSettings,
            onToken: (token, fullText) => { const live = impPre ? `${impPre}\n${fullText}` : fullText; impStreamMsg.content = live; broadcast('stream_token', { messageId: impStreamMsg.id, token, fullText: live }); } });
        } else {
          impResult = await llmService.generate({ prompt: impContext.prompt, messages: impContext.messages, systemPrompt: impContext.systemPrompt, settings: impSettings });
        }
        broadcast('generating_stop', {});
        let impText = impResult?.text ? substituteAllVariables(stripCrossRoleContent(impResult.text, impContext.stopSequences, false)).trim() : '';
        if (impText) impText = applyVerbatimWraps(impText, trigger);
        if (impText) {
          if (impStreamMsg) {
            impStreamMsg.content = impText;
            impStreamMsg.streaming = false;
            broadcast('stream_complete', { messageId: impStreamMsg.id, content: impText });
          } else {
            const pmsg = { id: uuidv4(), content: impText, sender: 'player', timestamp: Date.now() };
            sessionState.chatHistory.push(pmsg);
            broadcast('chat_message', pmsg);
          }
          autosaveSession();
          // Player-turn side effects (keyword gates / event trees) — like a real send, but no AI reply.
          await eventEngine.handleEvent('player_speaks', { content: impText }).catch(() => {});
          await tryResolveAwaitInput(impText, 'player').catch(() => {});
        } else if (impStreamMsg) {
          // Empty generation: with a live prepend keep the bubble (the literal text stands alone);
          // otherwise drop the placeholder.
          if (impPre) {
            impStreamMsg.content = applyVerbatimWraps('', trigger).trim();
            impStreamMsg.streaming = false;
            broadcast('stream_complete', { messageId: impStreamMsg.id, content: impStreamMsg.content });
            autosaveSession();
          } else {
            sessionState.chatHistory = sessionState.chatHistory.filter(m => m.id !== impStreamMsg.id);
            broadcast('message_deleted', { id: impStreamMsg.id });
          }
        }
        break;
      }

      case 'ai_message': {
        // LLM Enhance off → post the message text verbatim (no generation).
        if (trigger.llmEnhance === false) {
          const vtext = (trigger.context || '').trim();
          if (vtext) {
            const { v4: uuidv4 } = require('uuid');
            const vmsg = { id: uuidv4(), content: applyVerbatimWraps(substituteAllVariables(vtext), trigger), sender: 'character', characterName: character.name, displayName: groupBubbleName(character), timestamp: Date.now() };
            sessionState.chatHistory.push(vmsg);
            broadcast('chat_message', vmsg);
            autosaveSession();
          }
          break;
        }
        await waitForLlmIdle(); // queue behind any in-progress generation
        broadcast('generating_start', { characterName: groupBubbleName(character) || character.name });
        // Character-voice guided generation — use the unified normal builder
        // + single guidance injection (same path as guided response/swipe)
        const aiContext = applyCharacterGuidance(buildChatContext(character, settings, { ignoreHistory: trigger.ignoreHistory === true }), character, substituteAllVariables(trigger.context || 'Continue the conversation naturally.'));
        {
          const preN = trigger.prependVerbatim && String(trigger.prependText || '').trim() !== '' ? substituteAllVariables(trigger.prependText) : null;
          const appN = trigger.appendVerbatim && String(trigger.appendText || '').trim() !== '' ? substituteAllVariables(trigger.appendText) : null;
          aiContext.systemPrompt += wrapAwarenessNote(preN, appN);
        }
        // Optional per-action "Max Response Tokens" — restricts this generation; blank falls through
        // to the character/global token limit.
        const aiGenSettings = { ...settings.llm };
        const aiMaxTok = Number(trigger.maxTokens);
        if (aiMaxTok > 0) aiGenSettings.maxTokens = clampMaxTokens(aiMaxTok);
        const { v4: uuidv4 } = require('uuid');
        // Stream the trigger-driven message (intro / checkpoint char messages) when streaming is on —
        // create the bubble up-front and stream tokens in, mirroring the normal reply path.
        const aiStreaming = settings.llm?.streaming === true;
        // Live prepend: bubble appears immediately with the literal text; tokens land under it.
        const aiPre = (trigger.prependVerbatim && String(trigger.prependText || '').trim() !== '') ? substituteAllVariables(trigger.prependText) : null;
        let aiStreamMsg = null;
        let aiResult;
        if (aiStreaming || aiPre) {
          aiStreamMsg = { id: uuidv4(), content: aiPre || '', sender: 'character', characterName: character.name, displayName: groupBubbleName(character), timestamp: Date.now(), streaming: aiStreaming };
          sessionState.chatHistory.push(aiStreamMsg);
          broadcast('chat_message', aiStreamMsg);
        }
        if (aiStreaming) {
          aiResult = await llmService.generateStream({ prompt: aiContext.prompt, messages: aiContext.messages, systemPrompt: aiContext.systemPrompt, settings: aiGenSettings,
            onToken: (token, fullText) => { const live = aiPre ? `${aiPre}\n${fullText}` : fullText; aiStreamMsg.content = live; broadcast('stream_token', { messageId: aiStreamMsg.id, token, fullText: live }); } });
        } else {
          aiResult = await llmService.generate({ prompt: aiContext.prompt, messages: aiContext.messages, systemPrompt: aiContext.systemPrompt, settings: aiGenSettings });
        }
        if (aiResult.text) {
          const rawAtxt = substituteAllVariables(aiResult.text);
          let atxt = stripLeakedDirectives(rawAtxt); // always drop leaked === MANDATORY === echoes
          if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) atxt = stripStrayBrackets(atxt);
          logTagDiag('trigger:ai_message', rawAtxt, atxt);
          // Execute + strip device tags ([pump on] etc.) like every other reply path — this path
          // used to skip it, so a trigger/checkpoint/button message that emitted [pump on] left the
          // tag visible AND never fired the pump. (stripStrayBrackets PRESERVES device tags on purpose;
          // processLlmOutput is what runs and then strips them.)
          try {
            const dvcs = loadData(DATA_FILES.devices) || [];
            const reinf = aiDeviceControl.reinforcePumpControl(atxt, dvcs, sessionState, settings, getCharacterLimits(character));
            if (reinf.reinforced) atxt = reinf.text;
            const ctrl = await aiDeviceControl.processLlmOutput(atxt, dvcs, deviceService, { settings, sessionState, broadcast, characterLimits: getCharacterLimits(character), injectContext: () => {} });
            if (ctrl.commands?.length) atxt = ctrl.text;
          } catch (e) { console.error('[trigger:ai_message] device processing failed:', e?.message || e); }
          atxt = applyVerbatimWraps(atxt, trigger); // after device processing — wrap text stays literal
          if (aiStreamMsg) {
            aiStreamMsg.content = atxt;
            aiStreamMsg.streaming = false;
            broadcast('stream_complete', { messageId: aiStreamMsg.id, content: atxt });
          } else {
            const msg = { id: uuidv4(), content: atxt, sender: 'character', characterName: character.name, displayName: groupBubbleName(character), timestamp: Date.now() };
            sessionState.chatHistory.push(msg);
            broadcast('chat_message', msg);
          }
          autosaveSession();
        } else if (aiStreamMsg) {
          // Empty generation: keep the bubble when a live prepend already shows; else drop it.
          if (aiPre) {
            aiStreamMsg.content = applyVerbatimWraps('', trigger).trim();
            aiStreamMsg.streaming = false;
            broadcast('stream_complete', { messageId: aiStreamMsg.id, content: aiStreamMsg.content });
            autosaveSession();
          } else {
            sessionState.chatHistory = sessionState.chatHistory.filter(m => m.id !== aiStreamMsg.id);
            broadcast('message_deleted', { id: aiStreamMsg.id });
          }
        }
        broadcast('generating_stop', {});
        break;
      }

      case 'ai_message_member': {
        // Individual-mode Char AI Message: generate/post as ONE selected group member. The target
        // may be a member id, a name, or [SelectedChar]; a non-empty ref resolving to the base
        // char speaks AS the base member (only an EMPTY ref means "whole group").
        const mm = character?.multiChar?.characters || [];
        const memRef = trigger.targetMember ? resolveMemberRef(trigger.targetMember, character) : null;
        let tgt = memRef ? mm.find(m => m.id === memRef) : (memRef === '' ? mm[0] || null : null);
        // SAFETY: a solo member message only makes sense in Individual-Responses mode. On a
        // blended-mode group card, force the whole-group path (group bubble, no solo constraint)
        // so a member-targeted action can't break the blended flow. Verbatim text still names
        // the member, so narrative attribution survives.
        const isGroupCard = !!character?.multiChar?.enabled && mm.length > 1;
        if (isGroupCard && character.multiChar.responseMode !== 'individual' && tgt) {
          console.log(`[Trigger/${source}] ai_message_member: card is in group-response mode — posting as the whole group instead of ${tgt.name}`);
          tgt = null;
        }
        const speakerName = tgt?.name || character.name;
        if (trigger.llmEnhance === false) {
          const vtext = (trigger.context || '').trim();
          if (vtext) {
            const { v4: uuidv4 } = require('uuid');
            const vmsg = { id: uuidv4(), content: applyVerbatimWraps(substituteAllVariables(vtext), trigger), sender: 'character', characterId: character.id, characterName: speakerName, displayName: tgt ? null : groupBubbleName(character), memberId: tgt?.id, timestamp: Date.now() };
            sessionState.chatHistory.push(vmsg);
            broadcast('chat_message', vmsg);
            autosaveSession();
          }
          break;
        }
        await waitForLlmIdle();
        broadcast('generating_start', { characterName: speakerName });
        sessionState.soloSpeaker = tgt?.id || null; // constrain the group prompt to this member alone
        let baseCtx;
        try {
          baseCtx = applyCharacterGuidance(buildChatContext(character, settings, { ignoreHistory: trigger.ignoreHistory === true }), character, substituteAllVariables(trigger.context || 'Continue the conversation naturally.'));
        } finally {
          sessionState.soloSpeaker = null; // a throw must not leave the solo constraint latched (audit H5)
        }
        {
          const preN = trigger.prependVerbatim && String(trigger.prependText || '').trim() !== '' ? substituteAllVariables(trigger.prependText) : null;
          const appN = trigger.appendVerbatim && String(trigger.appendText || '').trim() !== '' ? substituteAllVariables(trigger.appendText) : null;
          baseCtx.systemPrompt += wrapAwarenessNote(preN, appN);
        }
        const soloSys = tgt
          ? `${baseCtx.systemPrompt}\n\n=== INDIVIDUAL RESPONSE (MANDATORY) ===\nRespond ONLY as ${tgt.name}. Do NOT write, voice, narrate, or speak for any other character — not even briefly. Begin DIRECTLY with the reply — do NOT acknowledge these instructions, announce what you will do, or restate any instruction text. Output a single, in-character reply from ${tgt.name} alone.\n=== END INDIVIDUAL RESPONSE ===\n`
          : baseCtx.systemPrompt;
        // Stop the model from starting another speaker's turn (parity with the group individual path).
        const otherStopN = (character.multiChar?.characters || []).filter(m => m.id !== tgt?.id && m.name).map(m => `\n${m.name}:`);
        const memGenSettings = { ...settings.llm, stopSequences: [...(settings.llm?.stopSequences || []), ...(baseCtx.stopSequences || []), ...otherStopN] };
        // Token precedence mirrors the group individual-reply path: trigger override → member → card → global.
        const memMaxTok = Number(trigger.maxTokens) || Number(tgt?.responseTokens) || Number(character?.individualResponseTokens) || 0;
        if (memMaxTok > 0) memGenSettings.maxTokens = clampMaxTokens(memMaxTok);
        const { v4: uuidv4 } = require('uuid');
        // Stream the member's trigger-driven message when streaming is on (bubble up-front, tokens in).
        const memStreaming = settings.llm?.streaming === true;
        // Live prepend: bubble appears immediately with the literal text; tokens land under it.
        const memPre = (trigger.prependVerbatim && String(trigger.prependText || '').trim() !== '') ? substituteAllVariables(trigger.prependText) : null;
        let memStreamMsg = null;
        let memRes;
        if (memStreaming || memPre) {
          memStreamMsg = { id: uuidv4(), content: memPre || '', sender: 'character', characterId: character.id, characterName: speakerName, displayName: tgt ? null : groupBubbleName(character), memberId: tgt?.id, timestamp: Date.now(), streaming: memStreaming };
          sessionState.chatHistory.push(memStreamMsg);
          broadcast('chat_message', memStreamMsg);
        }
        if (memStreaming) {
          memRes = await llmService.generateStream({ prompt: baseCtx.prompt, messages: baseCtx.messages, systemPrompt: soloSys, settings: memGenSettings,
            onToken: (token, fullText) => { const live = memPre ? `${memPre}\n${fullText}` : fullText; memStreamMsg.content = live; broadcast('stream_token', { messageId: memStreamMsg.id, token, fullText: live }); } });
        } else {
          memRes = await llmService.generate({ prompt: baseCtx.prompt, messages: baseCtx.messages, systemPrompt: soloSys, settings: memGenSettings });
        }
        if (memRes.text) {
          const rawMemText = substituteAllVariables(memRes.text);
          let memText = stripLeakedDirectives(rawMemText); // always drop leaked === MANDATORY === echoes
          if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) memText = stripStrayBrackets(memText);
          logTagDiag('trigger:member_message', rawMemText, memText);
          if (tgt) { // solo member reply — strip any echoed "Name:" speaker labels
            const otherN = (character.multiChar?.characters || []).filter(m => m.id !== tgt.id && m.name).map(m => m.name);
            memText = stripSpeakerPrefixes(memText, [tgt.name, ...otherN, character.name, character.multiChar?.groupName].filter(Boolean));
          }
          // Execute + strip device tags ([pump on] etc.) like every other reply path.
          try {
            const dvcs = loadData(DATA_FILES.devices) || [];
            const reinf = aiDeviceControl.reinforcePumpControl(memText, dvcs, sessionState, settings, getCharacterLimits(character));
            if (reinf.reinforced) memText = reinf.text;
            const ctrl = await aiDeviceControl.processLlmOutput(memText, dvcs, deviceService, { settings, sessionState, broadcast, characterLimits: getCharacterLimits(character), injectContext: () => {} });
            if (ctrl.commands?.length) memText = ctrl.text;
          } catch (e) { console.error('[ai_message_member] device processing failed:', e?.message || e); }
          memText = applyVerbatimWraps(memText, trigger); // after device processing — wrap text stays literal
          if (memStreamMsg) {
            memStreamMsg.content = memText;
            memStreamMsg.streaming = false;
            broadcast('stream_complete', { messageId: memStreamMsg.id, content: memText });
          } else {
            const msg = { id: uuidv4(), content: memText, sender: 'character', characterId: character.id, characterName: speakerName, displayName: tgt ? null : groupBubbleName(character), memberId: tgt?.id, timestamp: Date.now() };
            sessionState.chatHistory.push(msg);
            broadcast('chat_message', msg);
          }
          autosaveSession();
        } else if (memStreamMsg) {
          // Empty generation: keep the bubble when a live prepend already shows; else drop it.
          if (memPre) {
            memStreamMsg.content = applyVerbatimWraps('', trigger).trim();
            memStreamMsg.streaming = false;
            broadcast('stream_complete', { messageId: memStreamMsg.id, content: memStreamMsg.content });
            autosaveSession();
          } else {
            sessionState.chatHistory = sessionState.chatHistory.filter(m => m.id !== memStreamMsg.id);
            broadcast('message_deleted', { id: memStreamMsg.id });
          }
        }
        broadcast('generating_stop', {});
        break;
      }

      case 'char_inflate_start': {
        // Target-aware mock pump ON: ''/base → the original base-char engine (characterCapacity);
        // a member id / name / [SelectedChar] / [CharVar:x] → that member's own independent ticker.
        const ciTgt = resolveMemberRef(trigger.targetMember, character);
        if (ciTgt === null) { console.warn(`[Trigger/${source}] char_inflate_start: target '${trigger.targetMember}' matches no member — skipped`); break; }
        const ciCalTime = getCharacterCalibrationTime(character);
        if (!ciCalTime) break;
        const ciMembers = character?.multiChar?.characters || [];
        if (!ciTgt) {
          // Base char: card-level flag (single cards) or the group base member's per-member flag.
          const basePumpable = character?.isPumpable || (character?.multiChar?.enabled && ciMembers[0]?.isPumpable);
          if (basePumpable) startCharacterInflation(ciCalTime, character.charBurstPercent || 100);
          else console.log(`[Trigger/${source}] char_inflate_start: base character is not pumpable — skipped`);
        } else {
          const ciMember = ciMembers.find(m => m.id === ciTgt);
          if (ciMember?.isPumpable) startMemberInflation(ciTgt, ciMember.name, ciCalTime, character.charBurstPercent || 100);
          else console.log(`[Trigger/${source}] char_inflate_start: member '${ciMember?.name || ciTgt}' is not pumpable — skipped`);
        }
        break;
      }

      case 'char_inflate_stop': {
        const csTgt = resolveMemberRef(trigger.targetMember, character);
        if (csTgt === null) { console.warn(`[Trigger/${source}] char_inflate_stop: target '${trigger.targetMember}' matches no member — skipped`); break; }
        if (!csTgt) stopCharacterInflation();
        else stopMemberInflation(csTgt);
        break;
      }

      case 'pump_on': {
        // Optional timer (trigger.duration, seconds): runs for that long then auto-offs (capped by the
        // primary-pump / global / range limit switches). Blank/0 = latch-style on (ended by pump_off).
        // Lets game outcomes fire different pump intervals (e.g. a prize-wheel segment → pump on 3s vs 8s).
        if (pumpBlockedByCapacity()) {
          console.log('[Trigger/pump_on] Blocked — capacity at ceiling and over-inflation not allowed');
          break;
        }
        const devices = loadData(DATA_FILES.devices) || [];
        const pump = getPrimaryPumpDevice(devices);
        if (pump) {
          const id = resolveControlId(pump);
          // Duration may be a number OR a variable ("[CharVar:GameResult]" — e.g. a dice total drives
          // the seconds). An AUTHORED trigger duration is capped only by the hard MAX_ON_SECONDS safety
          // (via timedPumpOn), NOT the small per-reply LLM limit — that limit is for model [pump on]
          // spam, and would gut an intentional 6–36s dice roll or an 8s wheel prize.
          const dur = Number(substituteAllVariables(String(trigger.duration ?? '')));
          if (trigger.durationMode === 'percent') {
            // Percentage mode: run until `dur`% of capacity has been ADDED, hard-capped at 100%
            // total (at 70% a 50% request only adds 30%). Converted to seconds by inverting the
            // exact auto-capacity banking math (seconds × multiplier / calibrationTime × 100), so
            // the same timedPumpOn safety rails apply (30-min hard cap, emergency-stop cancel).
            if (!(pump.calibrationTime > 0)) {
              console.warn(`[Trigger/${source}] pump_on percentage mode needs a CALIBRATED primary pump — skipped`);
              break;
            }
            const req = Math.min(100, Math.max(0, dur));
            if (!Number.isFinite(dur) || req <= 0) { console.warn(`[Trigger/${source}] pump_on percentage mode: '${trigger.duration}' is not a usable % — skipped`); break; }
            // Integer targeting: displayed delta must equal the request exactly. Aim the run at
            // round(true)+req and deliver the TRUE distance to it, so fractional drift between
            // runs can never make a +2 show as +1 or +3.
            const trueCap = Math.min(100, computeTrueCapacityUnrounded());
            const cap = Math.max(0, Math.round(trueCap)); // what the gauge shows
            const target = Math.min(100, cap + req);
            const incTrue = target - trueCap;
            if (incTrue <= 0) { console.log(`[Trigger/${source}] pump_on percentage mode: already at/above target ${target}% — skipped`); break; }
            const pctSettings = loadData(DATA_FILES.settings) || {};
            const modifier = pctSettings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
            const secs = (incTrue / 100) * pump.calibrationTime / (modifier || 1);
            await timedPumpOn(id, pump, secs);
            schedulePctShortfallCheck(id, pump, cap, target - cap, Math.min(secs, MAX_ON_SECONDS)); // belt-and-braces if anything still discards
            broadcast('ai_device_control', { device: 'pump', action: 'on', deviceName: pump.label || pump.name || 'Pump', durationInfo: { type: 'timer', value: Math.min(secs, MAX_ON_SECONDS) } });
            console.log(`[Trigger/${source}] pump_on percentage mode: +${req}% → target ${target}% (true ${trueCap.toFixed(2)}%, shown ${cap}%) → ${secs.toFixed(1)}s`);
            if (trigger.awaitCompletion === true) {
              console.log(`[Trigger/${source}] pump_on holding the tree/sequence until the +${req}% run completes`);
              await awaitTimedPumpCompletion(id, secs + 15); // headroom for a shortfall extension
            }
          } else if (Number.isFinite(dur) && dur > 0) {
            await timedPumpOn(id, pump, dur);
            broadcast('ai_device_control', { device: 'pump', action: 'on', deviceName: pump.label || pump.name || 'Pump', durationInfo: { type: 'timer', value: Math.min(dur, MAX_ON_SECONDS) } });
            if (trigger.awaitCompletion === true) {
              console.log(`[Trigger/${source}] pump_on holding the tree/sequence until the ${dur}s run completes`);
              await awaitTimedPumpCompletion(id, dur);
            }
          } else {
            await deviceService.turnOn(id, pump);
            exemptForcedRun(id); // latch-style forced on — exempt until the device turns off
            broadcast('ai_device_control', { device: 'pump', action: 'on', deviceName: pump.label || pump.name || 'Pump' });
          }
        }
        break;
      }

      case 'pump_off': {
        sessionState.playerIsInflating = false; // an explicit off ends any latched-pump mode
        const devices = loadData(DATA_FILES.devices) || [];
        const pump = getPrimaryPumpDevice(devices);
        if (pump) {
          const id = resolveControlId(pump);
          clearServerTimedPumpTimer(id);
          await deviceService.turnOff(id, pump);
          broadcast('ai_device_control', { device: 'pump', action: 'off', deviceName: pump.label || pump.name || 'Pump' });
        }
        break;
      }

      case 'custom_device': {
        // Drive a named Custom Device (Settings → Devices → Custom Devices). Name and seconds both
        // accept variables. Authored triggers are NOT gated by the AI-control master switch (same
        // rule as device_on/off actions) — only LLM-emitted [CustomDevice:...] tags are.
        const cdName = substituteAllVariables(String(trigger.deviceName ?? ''), { isPromptText: true });
        const cdMode = trigger.mode === 'off' ? 'off' : trigger.mode === 'timed' ? 'timed' : 'on';
        const cdSecs = cdMode === 'timed' ? Number(substituteAllVariables(String(trigger.seconds ?? ''))) : undefined;
        await executeCustomDeviceControl(cdName, cdMode, cdSecs, source);
        break;
      }

      case 'toggle_pump_always': {
        // RETIRED — the "pump on every reply" feature is dead (isPumpOnEveryReply hard-returns false).
        // This trigger no longer re-bakes the pumpOnEveryReply flag into card data (which then lingered
        // and fired the pump on older builds). No-op.
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

      case 'set_range_set': {
        // Switch the active Range Set within the current checkpoint profile (story switch-ups).
        // Matches by range-set id or name (case-insensitive).
        if (trigger.value) {
          const profile = getActiveCheckpointProfile(character);
          const target = (profile?.rangeSets || []).find(rs => rs.id === trigger.value || (rs.name || '').toLowerCase() === String(trigger.value).toLowerCase());
          if (target) {
            sessionState.activeRangeSetId = target.id;
            console.log(`[Trigger/${source}] Switched range set to ${target.name} (${target.id})`);
          } else {
            console.log(`[Trigger/${source}] Range set "${trigger.value}" not found in active profile`);
          }
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

      case 'char_capacity': {
        // Char Capacity action: set/inc/dec the base character's or a pumpable member's capacity.
        // No targetMember (or the base member's id) → base char (sessionState.characterCapacity,
        // same 0-200 headroom as set_char_capacity); other members ride memberCapacities (0-100,
        // same clamp as their manual WS path). Deliberately does NOT fire char state-change events
        // (matches set_char_capacity — avoids trigger→event→trigger cascades).
        const ccOp = (trigger.operation === 'inc' || trigger.operation === 'dec') ? trigger.operation : 'set';
        // Amount accepts variables and math ("[CharVar:PumpPct]", "[PlayerInput:1] * 50 / 80"):
        // substitute, evaluate, then round + clamp.
        const ccRaw = eventEngine.evaluateExpression(eventEngine.substituteVariables(String(trigger.value ?? '')));
        const ccAmt = Math.max(0, Math.min(100, Math.round(parseFloat(ccRaw) || 0)));
        // Ref may be an id, a name, or [SelectedChar] — '' = base char; null = unresolvable.
        const ccTgt = resolveMemberRef(trigger.targetMember, character);
        if (ccTgt === null) { console.warn(`[Trigger/${source}] char_capacity: target '${trigger.targetMember}' matches no member — skipped`); break; }
        const ccApply = (cur) => ccOp === 'set' ? ccAmt : ccOp === 'inc' ? cur + ccAmt : cur - ccAmt;
        if (!ccTgt) {
          sessionState.characterCapacity = Math.max(0, Math.min(200, ccApply(sessionState.characterCapacity ?? 0)));
          broadcast('character_capacity_update', { characterCapacity: sessionState.characterCapacity, elapsed: 0, inflating: !!charInflationTimer });
          console.log(`[Trigger/${source}] char_capacity ${ccOp} ${ccAmt} → base char at ${sessionState.characterCapacity}%`);
        } else {
          if (!sessionState.memberCapacities) sessionState.memberCapacities = {};
          const ccNext = Math.max(0, Math.min(100, ccApply(sessionState.memberCapacities[ccTgt] ?? 0)));
          sessionState.memberCapacities[ccTgt] = ccNext;
          broadcast('member_capacity_update', { memberId: ccTgt, capacity: ccNext, memberCapacities: sessionState.memberCapacities });
          console.log(`[Trigger/${source}] char_capacity ${ccOp} ${ccAmt} → member ${ccTgt} at ${ccNext}%`);
        }
        break;
      }

      case 'toggle_device_control': {
        const s = loadData(DATA_FILES.settings) || {};
        s.globalCharacterControls = s.globalCharacterControls || {};
        s.globalCharacterControls.allowLlmDeviceControl = !!trigger.enabled;
        saveData(DATA_FILES.settings, s);
        break;
      }

      case 'set_pump_mode': {
        // Never fire past the capacity ceiling unless over-inflation is enabled.
        if (pumpBlockedByCapacity()) {
          console.log('[Trigger/set_pump_mode] Blocked — capacity at ceiling and over-inflation not allowed');
          break;
        }
        const devices = loadData(DATA_FILES.devices) || [];
        const pump = getPrimaryPumpDevice(devices);
        if (pump) {
          const id = resolveControlId(pump);
          const maxOn = effectiveMaxOnSeconds();
          const dur = Math.min(trigger.duration || 5, maxOn);
          // 'on' previously turned the pump on with NO auto-off and no clamp (unbounded run while the
          // safety watchdog is disabled). Route it through the tracked timed mechanism so it always
          // auto-offs at the effective limit (per-device first, then global) and emergency stop clears it.
          if (trigger.mode === 'on') await timedPumpOn(id, pump, maxOn);
          else if (trigger.mode === 'pulse') await deviceService.pulsePump(id, dur, pump);
          else if (trigger.mode === 'cycle') await deviceService.startCycle(id, { duration: dur, interval: dur, cycles: 3 }, pump);
          else if (trigger.mode === 'timed') await timedPumpOn(id, pump, dur);
          broadcast('ai_device_control', { device: 'pump', action: trigger.mode, deviceName: pump.label || pump.name || 'Pump' });
        }
        break;
      }

      case 'toggle_auto_reply':
        sessionState.autoReply = !!trigger.enabled;
        broadcast('auto_reply_update', { enabled: sessionState.autoReply });
        break;

      case 'player_pump_ready':
      case 'char_pump_ready':
      case 'groupmem_pump_ready': {
        if (!sessionState.pumpReady) sessionState.pumpReady = { persona: true, character: false, members: {} };
        const on = !!trigger.enabled;
        if (trigger.type === 'player_pump_ready') sessionState.pumpReady.persona = on;
        else if (trigger.type === 'char_pump_ready') sessionState.pumpReady.character = on;
        else if (trigger.targetMember) sessionState.pumpReady.members[trigger.targetMember] = on;
        else { console.warn(`[Trigger/${source}] groupmem_pump_ready with no member selected — skipped`); break; }
        broadcast('pump_ready_update', { pumpReady: sessionState.pumpReady });
        console.log(`[Trigger/${source}] ${trigger.type}${trigger.targetMember ? ':' + trigger.targetMember : ''} -> ${on ? 'READY' : 'not ready'}`);
        break;
      }

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

      case 'toggle_library_entry':
      case 'toggle_reminder': { // toggle_reminder kept as a back-compat alias for old cards
        // Targets the LIBRARY system (instructor-library.json groups), which replaced the old
        // per-card constantReminders. Params: groupId + termId ('' = the whole group). Legacy
        // triggers carry only reminderId — resolved as a term id/name across all groups, with a
        // final fallback to constantReminders for ancient cards that still have them.
        const tlOn = !!trigger.enabled;
        const tlLib = loadInstructorLibrary();
        const tlGroups = tlLib.groups || [];
        const tlMatch = (t, key) => t && (t.id === key || (t.term || '').toLowerCase() === String(key || '').trim().toLowerCase());
        let tlTouched = '';
        if (trigger.groupId) {
          const g = tlGroups.find(x => x.id === trigger.groupId);
          if (g) {
            if (trigger.termId) {
              const t = (g.terms || []).find(x => tlMatch(x, trigger.termId));
              if (t) { t.enabled = tlOn; tlTouched = `term '${t.term}'`; }
            } else { g.enabled = tlOn; tlTouched = `group '${g.name}'`; }
          }
        } else if (trigger.reminderId) {
          for (const g of tlGroups) {
            const t = (g.terms || []).find(x => tlMatch(x, trigger.reminderId));
            if (t) { t.enabled = tlOn; tlTouched = `term '${t.term}'`; break; }
          }
        }
        if (tlTouched) {
          saveInstructorLibrary(tlLib);
          console.log(`[Trigger/${source}] toggle_library_entry: ${tlTouched} → ${tlOn ? 'ON' : 'OFF'}`);
        } else if (trigger.reminderId && character?.constantReminders) {
          const entry = character.constantReminders.find(r => r.id === trigger.reminderId);
          if (entry) { entry.enabled = tlOn; await saveCharacterAsync(character); }
        } else {
          console.warn(`[Trigger/${source}] toggle_library_entry: no matching library group/term — skipped`);
        }
        break;
      }

      case 'toggle_dictionary': {
        // Enable/disable a global Dictionary item — or a whole group when no term is picked.
        const tdOn = !!trigger.enabled;
        const tdDict = loadDictionary();
        const tdGroup = (tdDict.groups || []).find(g => g.id === trigger.groupId);
        if (!tdGroup) { console.warn(`[Trigger/${source}] toggle_dictionary: group '${trigger.groupId}' not found — skipped`); break; }
        if (trigger.termId) {
          const t = (tdGroup.terms || []).find(x => x && (x.id === trigger.termId || (x.term || '').toLowerCase() === String(trigger.termId).trim().toLowerCase()));
          if (!t) { console.warn(`[Trigger/${source}] toggle_dictionary: term '${trigger.termId}' not found in '${tdGroup.name}' — skipped`); break; }
          t.enabled = tdOn;
          console.log(`[Trigger/${source}] toggle_dictionary: term '${t.term}' → ${tdOn ? 'ON' : 'OFF'}`);
        } else {
          tdGroup.enabled = tdOn;
          console.log(`[Trigger/${source}] toggle_dictionary: group '${tdGroup.name}' → ${tdOn ? 'ON' : 'OFF'}`);
        }
        saveDictionary(tdDict);
        break;
      }

      case 'system_message': {
        const content = substituteAllVariables(trigger.content || '');
        if (content) {
          // includeInHistory (tickbox): system notes are display-only by design, but a flagged one
          // rides the LLM transcript as a bracketed [System] line (and the memory summarizer input).
          const msg = { id: uuidv4(), content, sender: 'system', includeInContext: trigger.includeInHistory === true, characterId: character?.id, characterName: character?.name, timestamp: Date.now() };
          sessionState.chatHistory.push(msg);
          broadcast('chat_message', msg);
          autosaveSession();
        }
        break;
      }

      case 'toast': {
        // On-screen toast note (top-right, auto-dismisses): pure UI feedback — never enters
        // chatHistory or the LLM context. Multi-line text renders its newlines; the frontend
        // maps the preset key to its color combo.
        const toastText = substituteAllVariables(String(trigger.text ?? '')).trim();
        if (toastText) {
          broadcast('trigger_toast', { text: toastText, preset: trigger.preset || 'midnight' });
          console.log(`[Trigger/${source}] Toast (${trigger.preset || 'midnight'}): ${toastText.split('\n')[0].slice(0, 60)}`);
        }
        break;
      }

      case 'flow_var': {
        if (trigger.variable) {
          // sourceVar (optional) = left operand for the math: X = [sourceVar] op value. Name and
          // value both accept CharVars / system vars / nested combos; value accepts arithmetic.
          eventEngine.applySetVariable('custom', trigger.variable, trigger.operation || 'set', trigger.value, null, trigger.sourceVar ?? null);
          console.log(`[Trigger/${source}] flow_var ${trigger.variable} ${trigger.operation || 'set'}${trigger.sourceVar ? ` (from ${trigger.sourceVar})` : ''} ${trigger.value}`);
        }
        break;
      }

      // ---- Flow-parity media (posted as the same [Image|Video|Audio:tag] tokens flows use) ----
      case 'show_image': {
        const tag = (trigger.tag || '').trim();
        if (tag) await eventEngine.broadcast('ai_message', { content: `[Image:${tag}]`, suppressLlm: true });
        break;
      }
      case 'play_video': {
        const tag = (trigger.tag || '').trim();
        if (tag) {
          const mod = trigger.loop ? ':loop' : trigger.blocking ? ':blocking' : '';
          await eventEngine.broadcast('ai_message', { content: `[Video:${tag}${mod}]`, suppressLlm: true });
        }
        break;
      }
      case 'play_audio': {
        const tag = (trigger.tag || '').trim();
        if (tag) {
          const mod = trigger.noBubble ? ':nomsg' : '';
          await eventEngine.broadcast('ai_message', { content: `[Audio:${tag}${mod}]`, suppressLlm: true });
        }
        break;
      }

      // ---- Post a player-voice message (verbatim when llmEnhance===false) ----
      case 'send_player_message': {
        const text = (trigger.message || trigger.context || '').trim();
        // This variant IS the verbatim mode (the generated one is 'impersonate'), so it always
        // suppresses generation — except legacy triggers that explicitly opted INTO enhancement
        // via the since-removed LLM tickbox (llmEnhance === true).
        if (text) await eventEngine.broadcast('player_message', { content: applyVerbatimWraps(substituteAllVariables(text), trigger), suppressLlm: trigger.llmEnhance !== true });
        break;
      }

      // ---- Roll a random number into a Flow variable ----
      case 'random_number': {
        if (trigger.variable) {
          const lo = Math.min(Number(trigger.min ?? 1), Number(trigger.max ?? 100));
          const hi = Math.max(Number(trigger.min ?? 1), Number(trigger.max ?? 100));
          const n = Math.floor(Math.random() * (hi - lo + 1)) + lo;
          eventEngine.applySetVariable('custom', trigger.variable, 'set', n);
          console.log(`[Trigger/${source}] random_number ${trigger.variable} = ${n} (${lo}-${hi})`);
        }
        break;
      }

      // ---- Arbitrary-device control (reuses deviceService, same as flows) ----
      case 'device_on': {
        const r = resolveTriggerDevice(trigger.device);
        if (r) { await deviceService.turnOn(r.id, r.device); exemptForcedRun(r.id); } // authored on — banks through any freeze
        break;
      }
      case 'device_off': {
        const r = resolveTriggerDevice(trigger.device);
        if (r) { try { await deviceService.stopCycle(r.id, r.device); } catch (e) {} await deviceService.turnOff(r.id, r.device); }
        break;
      }
      case 'start_cycle': {
        const r = resolveTriggerDevice(trigger.device);
        if (r) {
          await deviceService.startCycle(r.id, { duration: Number(trigger.duration) || 5, interval: Number(trigger.interval) || 10, cycles: Number(trigger.cycles) || 0 }, r.device);
          exemptForcedRun(r.id); // cycles are forced runs — exempt until the device goes off
        }
        break;
      }
      case 'stop_cycle': {
        const r = resolveTriggerDevice(trigger.device);
        if (r) await deviceService.stopCycle(r.id, r.device);
        break;
      }
      case 'pulse_pump': {
        const r = resolveTriggerDevice(trigger.device);
        if (r) {
          await deviceService.pulsePump(r.id, Number(trigger.pulses) || 3, r.device);
          exemptForcedRun(r.id, (Number(trigger.pulses) || 3) * 3 + 10); // pulses are forced — cover the burst
        }
        break;
      }

      // ---- Enable/disable a card button (mirrors the flow toggle_button) ----
      case 'toggle_button': {
        if (trigger.buttonId != null && trigger.buttonId !== '') {
          const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
          const ch = chars.find(c => c.id === settings?.activeCharacterId);
          const btn = ch?.buttons?.find(b => String(b.buttonId) === String(trigger.buttonId));
          if (btn) {
            btn.enabled = trigger.action !== 'disable';
            saveCharacter(ch);
            broadcastCharacterDelta(ch);
            console.log(`[Trigger/${source}] toggle_button #${trigger.buttonId} -> ${btn.enabled ? 'enabled' : 'disabled'}`);
          }
        }
        break;
      }

      // ---- Wait N seconds (capped so a tree can't hang the turn forever) ----
      case 'delay': {
        const secs = Math.max(0, Math.min(Number(trigger.duration) || 0, 120));
        if (secs > 0) await new Promise(res => setTimeout(res, secs * 1000));
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

  let charInflationLastTick = Date.now();
  charInflationTimer = setInterval(async () => {
    // GAUGE PAUSE (char axis): while the scene is stalled (>>/choice/game/input gate or an executing
    // trigger chain), shift the start time forward by the frozen tick so elapsed — and therefore the
    // character's capacity — holds exactly where it froze and resumes there. Wall-clock elapsed would
    // otherwise bank the whole stall on resume as one catch-up jump.
    const nowTick = Date.now();
    const tickMs = nowTick - charInflationLastTick;
    charInflationLastTick = nowTick;
    if (isGaugeFrozen()) { charInflationStartTime += tickMs; return; }
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

// ---- Per-member mock auto-pumps ---------------------------------------------------------------
// Independent simulated inflation per GROUP MEMBER (the base member keeps riding the original
// engine above via characterCapacity). Each member gets its own ticker writing
// sessionState.memberCapacities[id], with the same gauge-freeze hold and burst auto-stop
// semantics as the base engine. Keyed by member id; restart-safe per member.
const memberInflationTimers = new Map(); // memberId -> { timer, startTime, lastTick, startCap, calTime, burstPercent, name }

function startMemberInflation(memberId, memberName, calibrationTime, burstPercent = 100) {
  stopMemberInflation(memberId);
  if (!sessionState.memberCapacities) sessionState.memberCapacities = {};
  const startCap = sessionState.memberCapacities[memberId] ?? 0;
  const st = { startTime: Date.now(), lastTick: Date.now(), startCap, calTime: calibrationTime, burstPercent, name: memberName || memberId };
  console.log(`[MemberInflation] ${st.name}: starting — calibration=${calibrationTime}s from ${startCap}%, burst@${burstPercent}%`);
  broadcast('member_inflate_state', { memberId, active: true, elapsed: 0, capacity: startCap });
  st.timer = setInterval(() => {
    const now = Date.now();
    const tickMs = now - st.lastTick;
    st.lastTick = now;
    if (isGaugeFrozen()) { st.startTime += tickMs; return; } // hold exactly where it froze (same as base engine)
    const elapsed = (now - st.startTime) / 1000;
    const newCap = Math.min(st.burstPercent, Math.round(st.startCap + (elapsed / st.calTime) * 100));
    if (newCap !== (sessionState.memberCapacities[memberId] ?? 0)) {
      sessionState.memberCapacities[memberId] = newCap;
    }
    broadcast('member_capacity_update', { memberId, capacity: newCap, memberCapacities: sessionState.memberCapacities, elapsed: Math.round(elapsed), inflating: true });
    if (newCap >= st.burstPercent) {
      console.log(`[MemberInflation] ${st.name} reached ${st.burstPercent}% — auto-stopping (POP!)`);
      stopMemberInflation(memberId);
      broadcast('member_burst', { memberId, capacity: newCap, burstPercent: st.burstPercent });
    }
  }, 1000);
  memberInflationTimers.set(memberId, st);
}

function stopMemberInflation(memberId) {
  const st = memberInflationTimers.get(memberId);
  if (!st) return;
  clearInterval(st.timer);
  memberInflationTimers.delete(memberId);
  const cap = sessionState.memberCapacities?.[memberId] ?? 0;
  console.log(`[MemberInflation] ${st.name} stopped at ${cap}%`);
  broadcast('member_inflate_state', { memberId, active: false, elapsed: 0, capacity: cap });
}

function stopAllMemberInflation() {
  for (const id of [...memberInflationTimers.keys()]) stopMemberInflation(id);
}

// Per-member inflation lines for group cards: members with a manually-set capacity
// (sessionState.memberCapacities) get a compact belly-state line so the model tracks each
// body separately. The base member (index 0) rides characterCapacity via the card-level block.
function buildMemberInflationLines(character) {
  if (!character?.multiChar?.enabled) return '';
  const caps = sessionState.memberCapacities || {};
  const lines = [];
  (character.multiChar.characters || []).forEach((m, idx) => {
    if (!m?.name || !m.isPumpable) return;
    // Base member (idx 0) rides characterCapacity. The card-level block covers it ONLY when the
    // card-level isPumpable flag is set (single-mode legacy) — group cards use per-member flags,
    // so without this line a group's pumpable base member was reported nowhere.
    if (idx === 0 && character.isPumpable) return;
    const cap = Math.round(idx === 0 ? (sessionState.characterCapacity || 0) : (caps[m.id] || 0));
    if (cap <= 0) return;
    let desc;
    if (cap <= 10) desc = 'very slight fullness, barely noticeable';
    else if (cap <= 25) desc = 'mildly bloated, noticeably rounder';
    else if (cap <= 40) desc = 'visibly swollen, belly pushing outward';
    else if (cap <= 55) desc = 'significantly inflated, round and taut';
    else if (cap <= 70) desc = 'heavily inflated, stretched drum-tight';
    else if (cap <= 85) desc = 'massively distended, skin pulled tight';
    else if (cap <= 95) desc = 'enormous, straining at maximum capacity';
    else desc = 'beyond full, dangerously over-inflated';
    lines.push(`${m.name}'s belly is at ${cap}% capacity: ${desc}. Describe ${m.name} at exactly this level — no more, no less.`);
  });
  if (!lines.length) return '';
  return `\n=== GROUP MEMBER INFLATION STATES ===\n${lines.join('\n')}\n=== END GROUP MEMBER INFLATION STATES ===\n`;
}

/**
 * Build character inflation context for the AI system prompt.
 * Card-level block when the character is pumpable and capacity > 0, plus
 * per-member lines for group members with their own capacity set.
 */
function buildCharacterInflationContext(character) {
  const memberLines = buildMemberInflationLines(character);
  if (!character?.isPumpable) return memberLines;
  const cap = sessionState.characterCapacity || 0;
  if (cap <= 0) return memberLines;

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

  return context + memberLines;
}

/**
 * Get the effective calibration time for a pumpable character.
 * If synced with player, uses the primary pump's calibration time.
 */
function getCharacterCalibrationTime(character) {
  if (character?.charSyncCalibrationWithPlayer) {
    const devices = loadData(DATA_FILES.devices) || [];
    const pump = getPrimaryPumpDevice(devices);
    if (pump?.calibrationTime) return pump.calibrationTime;
  }
  return character?.characterCalibrationTime || 60;
}

// LLM State - tracks busy state and queues flow messages when LLM is busy
const llmState = {
  isGenerating: false,
  queuedFlowMessage: null // { type, data } - single queued flow message to process when LLM is free
};

// Queue behind the current generation: if the LLM is busy (e.g. mid-reply), wait for it to finish
// before a trigger-driven generation starts, so it fires immediately after instead of concurrently.
// Bounded by a timeout so a stuck flag can never hard-block.
// ---- Live engine debug snapshot (audit D3): everything a trigger author needs to see to answer
// "why did my tree stop" — armed suspensions, in-flight runs, session overrides, gates, vars. ----
let _engineDbgSubs = 0, _engineDbgTimer = null;
function engineDebugSnapshot() {
  const pc = sessionState.pendingTreeChoice;
  return {
    pendings: {
      choice: pc ? {
        kind: pc.multi ? 'choose_multi' : pc.selectMember ? 'select_member' : pc.playerInput ? 'player_input' : 'player_choice',
        tree: pc.ctxSnapshot?.treeId || null, scope: pc.ctxSnapshot?.scopeKey || null
      } : null,
      wait: sessionState.pendingTreeResume ? { remaining: sessionState.pendingTreeResume.remaining, tree: sessionState.pendingTreeResume.ctxSnapshot?.treeId || null } : null,
      game: sessionState.pendingTreeGame ? { gameId: sessionState.pendingTreeGame.miniGameId, tree: sessionState.pendingTreeGame.ctxSnapshot?.treeId || null } : null,
      nextGate: !!sessionState.pendingTreeNext,
      rangeAwait: sessionState.pendingRangeAwait ? { kind: sessionState.pendingRangeAwait.kind, source: sessionState.pendingRangeAwait.source || null } : null,
      capacityGate: sessionState.pendingCapacityGate ? { target: sessionState.pendingCapacityGate.target, source: sessionState.pendingCapacityGate.source || null } : null,
    },
    activeRuns: [...activeTreeRuns].map(f => ({ tree: f.treeId, scope: f.scopeKey, cancelled: !!f.cancelled })),
    checkpointControl: sessionState.checkpointControl || null,
    capacity: { player: sessionState.capacity || 0, char: sessionState.characterCapacity || 0, members: sessionState.memberCapacities || {} },
    gaugeFrozen: isGaugeFrozen(),
    llmBusy: !!llmState.isGenerating,
    introActive: !!sessionState.introActive,
    selectedChar: sessionState.selectedChar || null,
    triggerChainDepth: sessionState.triggerChainDepth || 0,
    vars: sessionState.flowVariables || {},
  };
}

// Player turns SERIALIZE (audit H7): two rapid sends used to interleave two generation loops
// over shared session state (soloSpeaker, per-turn injections, chatHistory ordering — worst in
// group Individual mode where each loop walks the members). Every chat turn queues behind the
// previous one; a failed turn never breaks the chain.
let _chatTurnChain = Promise.resolve();
function enqueueChatTurn(fn) {
  const run = _chatTurnChain.catch(() => {}).then(fn);
  _chatTurnChain = run.catch(() => {});
  return run;
}

async function waitForLlmIdle(timeoutMs = 90000) {
  if (!llmState.isGenerating) return;
  console.log('[Trigger] LLM busy — queueing this generation until the current one completes...');
  const start = Date.now();
  while (llmState.isGenerating && (Date.now() - start) < timeoutMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (llmState.isGenerating) console.log('[Trigger] LLM wait timed out — proceeding anyway');
}

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

  // Player name — support both [Player] and SillyTavern {{user}} macro. Fall back to a generic
  // label so the raw tags never leak into displayed output when no persona is active.
  const playerName = context.playerName || sessionState.playerName || 'the player';
  result = result.replace(/\[Player\]/gi, playerName);
  result = result.replace(/\{\{user\}\}/gi, playerName);

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
  // Selected member — set by the tree Select Member popup; resolves to the BASE character's name
  // whenever nothing is selected (runTreeScope resets it per tree run). Substituted BEFORE the
  // [CharCapacity:...] block so the nested form [CharCapacity:[SelectedChar]] collapses first.
  result = result.replace(/\[SelectedChar\]/gi, sessionState.selectedChar || charName || sessionState.characterName || '');
  // Player Input popup values — [PlayerInput:1], [PlayerInput:2], … (1-based row numbers of the
  // most recent Player Input form). Unknown row → tag left visible so the author sees the gap.
  result = result.replace(/\[PlayerInput:(\d+)\]/gi, (match, n) => {
    const v = sessionState.playerInputs?.[n];
    return v !== undefined ? v : match;
  });
  // [Group] — every member of the active card as a natural list ("X, Y, and Z"); single cards
  // resolve to the character's name. Lazy (card loaded only when the tag appears).
  result = result.replace(/\[Group\]/gi, () => resolveGroupListString());
  // Char capacity — [CharCapacity] = the base character; [CharCapacity:Name] (or :memberId) = a
  // group member. The base member rides characterCapacity; other members read memberCapacities.
  // Unknown member → tag left visible so the author sees the typo. Member lookup loads the active
  // card lazily (only when the :member form is actually present).
  result = result.replace(/\[CharCapacity(?::([^\]\r\n]+))?\]/gi, (match, memberKey) => {
    if (!memberKey) return Math.round(sessionState.characterCapacity ?? 0);
    try {
      const ccChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const ccCard = ccChars.find(c => c.id === settings?.activeCharacterId);
      const mm = ccCard?.multiChar?.characters || [];
      const key = memberKey.trim().toLowerCase();
      const idx = mm.findIndex(m => m && ((m.name || '').toLowerCase() === key || m.id === memberKey.trim()));
      if (idx >= 0) return idx === 0 ? Math.round(sessionState.characterCapacity ?? 0) : Math.round(sessionState.memberCapacities?.[mm[idx].id] ?? 0);
      // No member match — the BASE CHARACTER itself (single cards have no members array, and
      // [SelectedChar] resolves to the card name there): match by card/session name → base capacity.
      if ((ccCard?.name || '').trim().toLowerCase() === key || (sessionState.characterName || '').trim().toLowerCase() === key) {
        return Math.round(sessionState.characterCapacity ?? 0);
      }
      return match;
    } catch (e) { return match; }
  });
  result = result.replace(/\[PlayerIsInflating\]/gi, sessionState.playerIsInflating ? 'true' : 'false');
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

  // Character variables — [CharVar:varname] (documented) / [Flow:varname] (legacy alias)
  result = result.replace(/\[(?:CharVar|Flow):(\w+)\]/gi, (match, varName) => {
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

  // [Secs2Pct:N] — the capacity % that N seconds of the current (primary) pump adds. Runs AFTER
  // the CharVar/System passes above so nested forms like [Secs2Pct:[CharVar:TotalSecs]] collapse
  // from the inside out (this function is single-pass — order is the nesting mechanism, same as
  // [CharCapacity:[SelectedChar]]). Unresolvable (no calibrated pump / non-numeric seconds) →
  // tag left visible so the author sees the gap.
  result = result.replace(/\[Secs2Pct:([^\[\]]+)\]/gi, (match, secs) => resolveSecs2Pct(secs) ?? match);

  // Instructor pump session variables
  result = result.replace(/\[BulbCurrent\]/gi, sessionState.bulbCurrent ?? 0);
  result = result.replace(/\[BikeCurrent\]/gi, sessionState.bikeCurrent ?? 0);
  result = result.replace(/\[PumpType\]/gi, sessionState.pumpType || 'electric');
  result = result.replace(/\[PumpInit\]/gi, sessionState.pumpInit || 'auto');

  // Token Switching/Removal — rewrite overused words in generated OUTPUT only. NEVER apply to
  // prompt text (callers building the system prompt pass { isPromptText: true }); otherwise these
  // rules would randomly rewrite or delete the instructor mission, safety rules, and card fields.
  if (!context.isPromptText) {
    result = applyTokenSwitching(result, settings);
    result = applyTokenRemovals(result, settings);
  }

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
  // Honor the instructor "Ignore token swapping" opt-out for removals too (it already covers switching).
  if (activeCharIgnoresTokenSwap(settings)) return text;

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
    // Per-character continuity: keep this character's most-recent chat current after every message.
    saveCharSession(settings?.activeCharacterId);
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
      sessionState.messageInputHistory = (autosaveData.messageInputHistory || []).slice(-100); // trim legacy unbounded buffers
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
// Per-character session continuity
// ============================================
// Each character keeps its own most-recent chat on disk (one file per character, so saving after
// every message only rewrites the active character's file). Switching characters saves the
// outgoing chat and restores the incoming one; "New" wipes the active character's saved chat.
const CHAR_SESSIONS_DIR = path.join(DATA_DIR, 'char-sessions');
function charSessionPath(charId) {
  return path.join(CHAR_SESSIONS_DIR, `${String(charId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}
function snapshotSessionState() {
  return {
    capacity: sessionState.capacity,
    pain: sessionState.pain,
    emotion: sessionState.emotion,
    chatHistory: sessionState.chatHistory,
    chatMemorySummary: sessionState.chatMemorySummary,
    chatMemorySummaryUpTo: sessionState.chatMemorySummaryUpTo,
    messageInputHistory: sessionState.messageInputHistory,
    flowVariables: sessionState.flowVariables,
    updatedAt: Date.now(),
  };
}
function saveCharSession(charId) {
  if (!charId) return;
  try {
    if (!fs.existsSync(CHAR_SESSIONS_DIR)) fs.mkdirSync(CHAR_SESSIONS_DIR, { recursive: true });
    atomicWriteJson(charSessionPath(charId), snapshotSessionState());
  } catch (e) { console.error('[CharSession] save failed:', e?.message || e); }
}
function loadCharSession(charId) {
  if (!charId) return null;
  try {
    const p = charSessionPath(charId);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error('[CharSession] load failed:', e?.message || e); }
  return null;
}
function clearCharSession(charId) {
  if (!charId) return;
  try {
    const p = charSessionPath(charId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) { console.error('[CharSession] clear failed:', e?.message || e); }
}
// Seed a character's Character Variables (Library tab) into the live variable store — each gets its
// default value at the start of a NEW session. Reference them anywhere with [CharVar:Name]; triggers
// (Set CharVar) mutate them from there. Restored/saved sessions keep their saved values instead.
function seedCharVariables(character) {
  const vars = character?.charVariables;
  if (!Array.isArray(vars) || !vars.length) return;
  let n = 0;
  for (const v of vars) {
    const name = String(v?.name || '').trim();
    if (!name) continue;
    eventEngine.applySetVariable('custom', name, 'set', v.value ?? '');
    n++;
  }
  if (n) console.log(`[Session] Seeded ${n} character variable default(s) for ${character.name}`);
}

// Clear the live chat/context (no device side-effects) before restoring or starting a session on a
// character switch — prevents the previous character's context from bleeding into the new one.
function clearSessionContextForSwitch() {
  sessionState.chatHistory = [];
  sessionState.chatMemorySummary = null;
  sessionState.chatMemorySummaryUpTo = 0;
  firedCheckpointTriggers.clear();
  sessionState.firedTreeNodes.clear();
  resetEventTriggerState();
  sessionState.checkpointControl = null; // Checkpoint Control overrides die with the session
  sessionState.pendingIntroStart = null; // a deferred intro from the old session must not fire into the new one
  sessionState.eventTriggerOverrides = null; // Event Trigger Toggle overrides die with the session
  sessionState.sessionStartActive = false;
  sessionState.pendingTreeResume = null;
  sessionState.pendingTreeGame = null;
  sessionState.pendingCheckpointChoice = null;
  sessionState.pendingTreeChoice = null;
  sessionState.pendingTreeNext = null;
  sessionState.selectedChar = null; // [SelectedChar] back to "resolves to the base char"
  sessionState.playerInputs = {}; // Player Input values belong to the outgoing session
  sessionState.activeCheckpointInjections = [];
  sessionState.checkpointInjectionCounts = {};
  sessionState.playerIsInflating = false;
  sessionState.awaitingGoRelease = false;
  sessionState.releaseButtonLabel = null;
  sessionState.pendingGoProfileId = null;
  sessionState.pendingRangeAwait = null;
  sessionState.pendingCapacityGate = null;   // clear any queued Fire% gate
  sessionState.triggerChainDepth = 0;        // never leave the gauge frozen across a reset
  broadcast('next_gate', { active: false }); // clear any stuck ">>" gate on reset
  broadcast('capacity_gate', { active: false }); // clear the Fire% status chip too
  sessionState.groupRotation = 0;
  sessionState.pumpReady = pumpReadyDefaults();
  sessionState.soloSpeaker = null;
  sessionState.flowVariables = {};
  eventEngine.variables = {}; // canonical [CharVar:] map — without this the OLD character's variables leaked across a switch
  sessionState.preFillActive = false;
  sessionState.preFillStepId = null;
  setIntroActive(false);
  sessionState.pendingPrereqs = null;
  sessionState.prereqsDone = false;
  sessionState.bulbCurrent = 0;
  sessionState.bikeCurrent = 0;
  sessionState.pendingPumpContext = [];
  sessionState.pumpRuntimeTracker = {};
  sendingWelcomeMessage = false;
  firstAiMessageFired = false;
}

// ============================================
// WebSocket Management
// ============================================

const wsClients = new Set();

// ---- Session timeline (F4): a ring buffer of engine events for the 📈 panel — capacity
// samples, tree runs, event-binding fires, range entries, games, device actions. Cheap by
// design (plain pushes); a 'marker' event notes session resets instead of wiping history.
const TIMELINE_MAX = 2500;
const sessionTimeline = [];
let _tlLastCapacity = null;
function tlRecord(kind, info = {}) {
  sessionTimeline.push({ t: Date.now(), kind, ...info });
  if (sessionTimeline.length > TIMELINE_MAX) sessionTimeline.shift();
}

function broadcastNow(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Broadcast coalescing (audit C4/C2): high-frequency or heavyweight message types where clients
// only ever need the LATEST payload get a trailing-edge throttle — capacity_update fires several
// times a second during pump runtime; characters_update ships the full ~2MB library and bursts
// on multi-save operations. Every other type broadcasts immediately.
const COALESCED_BROADCASTS = { capacity_update: 400, characters_update: 1000 };
const _coalesceState = new Map(); // type -> { timer, lastSent, payload }
// Delta character broadcast (E2 slimming): the full library rides only on the initial REST
// load — WS updates carry just the changed/deleted characters (~KB instead of ~2MB per toggle).
// The frontend still accepts the legacy full-array shape (bulk flow-era sync sites use it).
function broadcastCharacterDelta(changed, deleted = []) {
  const list = (Array.isArray(changed) ? changed : [changed]).filter(Boolean);
  broadcast('characters_update', { delta: true, changed: list, deleted });
}

function broadcast(type, data) {
  // Timeline taps (F4): capacity samples on >=1% moves; every device actuation.
  if (type === 'capacity_update' && typeof data?.capacity === 'number') {
    if (_tlLastCapacity === null || Math.abs(data.capacity - _tlLastCapacity) >= 1) {
      _tlLastCapacity = data.capacity;
      tlRecord('capacity', { v: Math.round(data.capacity) });
    }
  } else if (type === 'ai_device_control') {
    tlRecord('device', { device: data?.deviceName || data?.device || '?', action: data?.action || '?' });
  }
  const win = COALESCED_BROADCASTS[type];
  if (!win) return broadcastNow(type, data);
  let st = _coalesceState.get(type);
  if (!st) { st = { timer: null, lastSent: 0, payload: null }; _coalesceState.set(type, st); }
  st.payload = data;
  const now = Date.now();
  if (now - st.lastSent >= win) {
    st.lastSent = now;
    return broadcastNow(type, st.payload);
  }
  if (!st.timer) {
    st.timer = setTimeout(() => {
      st.timer = null;
      st.lastSent = Date.now();
      broadcastNow(type, st.payload);
    }, win - (now - st.lastSent));
  }
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

let consoleBroadcastEnabled = false; // streams only while an engine-debug (🔧) panel is open — always-on flooded every client with a WS frame per console line

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
    sessionState.pumpRuntimeTracker[ip] = { totalSeconds: 0, baseSeconds: 0, effectiveSeconds: 0, lastAccountedSeconds: 0 };
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
  // GAUGE PAUSE: while the scene is stalled (">>" WAIT, player choice/minigame open, await-input
  // keyword gate, or a trigger chain executing/generating), the pump keeps physically running but its
  // runtime must NOT count toward capacity — the gauge freezes where it is (e.g. 4%) and resumes at that
  // exact value when the stall clears, no matter how long the wait/triggers take. We do this by advancing
  // the accounting pointer (consuming the seconds) WITHOUT banking them into effectiveSeconds, so the
  // stall-period pumping is discarded rather than deferred (no catch-up jump).
  const gaugeFrozen = isGaugeFrozen();
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

    // Accrue capacity INCREMENTALLY at the current modifier: only the new seconds since the last
    // accounting are scaled by the modifier, then banked into effectiveSeconds. Changing the modifier
    // therefore only changes the RATE of future capacity — it never retroactively recalculates what
    // has already accrued. (Back-compat: a tracker without effectiveSeconds banks its existing
    // totalSeconds at the current modifier on first pass, matching the old value.)
    if (tracker.effectiveSeconds === undefined) { tracker.effectiveSeconds = 0; tracker.lastAccountedSeconds = 0; }
    const newSeconds = Math.max(0, tracker.totalSeconds - (tracker.lastAccountedSeconds || 0));
    if (newSeconds > 0) {
      // Bank into capacity ONLY when not frozen. While a WAIT holds, we still advance lastAccountedSeconds
      // so the wait-period runtime is discarded (consumed, never banked) — the gauge resumes where it froze.
      // EXCEPTION: an active percentage-mode run banks through the freeze (deliberate physical
      // delivery must tick the gauge live even while a trigger chain generates messages).
      const pctExempt = (forcedPumpExemptions.get(deviceKey) || 0) > Date.now();
      if (!gaugeFrozen || pctExempt) {
        if (gaugeFrozen && pctExempt) console.log(`[AutoCapacity] ${deviceKey}: banking ${newSeconds.toFixed(1)}s THROUGH the gauge freeze (forced run)`);
        tracker.effectiveSeconds += newSeconds * capacityModifier;
      }
      tracker.lastAccountedSeconds = tracker.totalSeconds;
    }
    const deviceCapacity = (tracker.effectiveSeconds / deviceData.calibrationTime) * 100;
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

  if (eventType === 'device_off') {
    forcedPumpExemptions.delete(data.ip); // a stopped device can't be a forced run anymore
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

  // Phase 3 (Flow→Trigger): fire any per-card device_on/device_off event-bound trees. This is
  // the tree-side equivalent of a flow's device trigger node — device events don't pass through
  // eventEngine.handleEvent, so we dispatch directly off the same sink the broadcasts use.
  if (eventType === 'device_on' || eventType === 'device_off') {
    Promise.resolve(runEventTrees(eventType, data))
      .catch(e => console.error('[EventTrees] device dispatch failed:', e?.message || e));
  }
});

// Phase 3 (Flow→Trigger): route the flow engine's state-change detections to event-bound trees.
// The idle timer (startTreeIdleCheck) is started from the server.listen block instead — its
// `let treeIdleTimer` is declared later in the file, so it's in the temporal dead zone here at
// module-load time and calling it now throws "Cannot access 'treeIdleTimer' before initialization".
eventEngine.setTreeEventSink((eventType, eventData) => runEventTrees(eventType, eventData));

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
// Per-device count of consecutive UNCONFIRMED force-offs. An unreachable/stale pump can never
// confirm OFF; without a cap its pumpActiveSince entry would live forever, keeping the watchdog
// "a pump is on" → it would force-off every healthy pump every second (the working pump then only
// stays on ~1s). After a few attempts we give up on the phantom so the watchdog can settle.
const forceOffAttempts = {};
const MAX_FORCE_OFF_ATTEMPTS = 3;

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
  sessionState.playerIsInflating = false; // any forced-off (capacity ceiling, emergency, watchdog) ends the latch
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
        delete forceOffAttempts[stateKey];
        if (sessionState.executionHistory?.deviceActions?.[stateKey]) {
          sessionState.executionHistory.deviceActions[stateKey].state = 'off';
        }
      } else {
        forceOffAttempts[stateKey] = (forceOffAttempts[stateKey] || 0) + 1;
        if (forceOffAttempts[stateKey] >= MAX_FORCE_OFF_ATTEMPTS) {
          // Unreachable/phantom pump — we've sent OFF several times. Stop believing it's on so it
          // can't keep the watchdog firing and force-offing the healthy pumps every second.
          console.error(`[PumpWatchdog] Pump ${id} OFF unconfirmed ${forceOffAttempts[stateKey]}× — giving up; clearing its stale ON state so it stops force-offing other pumps`);
          delete pumpActiveSince[stateKey];
          delete pumpActiveSince[id];
          delete forceOffAttempts[stateKey];
          if (sessionState.executionHistory?.deviceActions?.[stateKey]) {
            sessionState.executionHistory.deviceActions[stateKey].state = 'off';
          }
        } else {
          console.error(`[PumpWatchdog] Force-off of pump ${id} NOT confirmed (attempt ${forceOffAttempts[stateKey]}/${MAX_FORCE_OFF_ATTEMPTS}) — will retry`);
        }
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

    // Latched-pump mode overrides the time-based ceiling (per the per-char latchPumpUntilOff
    // setting). The capacity/pop ceiling below STILL fires — that's overfill/burst protection,
    // not a timer. Only [pump off] / emergency stop end the time-unbounded latch.
    if (!sessionState.playerIsInflating && onSeconds >= MAX_ON_SECONDS) {
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

// The periodic pump safety watchdog is DISABLED. It force-offed every pump on a 1s interval when
// it believed a pump had been on too long or capacity hit the ceiling — which, with an unreachable/
// stale pump, killed the working pump every second. Per-command auto-off timers, explicit
// [pump off], the capacity gate, and Emergency Stop still apply.
const PUMP_SAFETY_WATCHDOG_ENABLED = false;

function startPumpSafetyWatchdog() {
  if (!PUMP_SAFETY_WATCHDOG_ENABLED) return;
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
  // Per-character / per-story pump limits were removed. The PRIMARY automatic pump's own limits
  // (Settings → Devices → pump → "Limits") are the SINGLE global source of truth for every card.
  // Any field the pump doesn't set falls back to the factory default. `character` is unused (kept
  // for call-site compatibility).
  const pumpLimits = getPrimaryPumpLimits() || {};
  const pick = (field) => {
    const v = Number(pumpLimits[field]);
    return (Number.isFinite(v) && v > 0) ? v : FACTORY_PUMP_LIMITS[field];
  };
  return {
    llmMaxOnDuration: pick('llmMaxOnDuration'),
    llmMaxCycleOnDuration: pick('llmMaxCycleOnDuration'),
    llmMaxCycleRepetitions: pick('llmMaxCycleRepetitions'),
    llmMaxPulseRepetitions: pick('llmMaxPulseRepetitions'),
    llmMaxTimedDuration: pick('llmMaxTimedDuration'),
    // When true, a model [pump on] latches on until [pump off] — overriding time-based auto-off.
    latchPumpUntilOff: pumpLimits.latchPumpUntilOff === true,
    // Per-story "AI Pump Control" tickbox (audit H1 — the UI has shown this switch for months
    // while the backend never read it). Explicit false = this card BLOCKS model-driven device
    // control even when the global switch is on; undefined inherits (legacy cards keep working).
    llmDeviceAccessOff: (() => {
      const story = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
      return story?.allowLlmDeviceAccess === false;
    })(),
  };
}

/**
 * Build the LLM device-control instruction block.
 *
 * Uses a "strict output anatomy" (narrative first, the device tag ALONE on the final
 * line, nothing after) — the most reliable way to get instruction-following RP models
 * (Cydonia/Mistral-Small, Gemma, Qwen, Llama-3) to actually append the tag instead of
 * burying or dropping it. Tags stay CONDITIONAL (only when a device changes state) so
 * the model never fabricates an activation just to fill the slot.
 *
 * `template` tunes only the lead emphasis per model family; the tag syntax is identical
 * across templates, so there is intentionally little other per-template variation.
 */
function buildDeviceControlInstruction(template, maxSeconds, charLimits, capacityMod, playerName) {
  const fam = String(template || '').toLowerCase();
  const who = playerName || 'the player';
  // Gemma / ChatML-family models obey explicit rule-lists very literally; the rest do
  // best with a terse imperative. Core format is identical either way.
  const lead = (fam.startsWith('gemma') || fam === 'chatml')
    ? 'Follow this output format EXACTLY.'
    : 'Strict output format.';

  // Cydonia/Mistral-Small (and Llama) follow worked demonstrations far better than a bare
  // rule; gemma/chatml already obey the terse rule-list, so they keep the one-line example.
  // Examples are player-scoped (air-flow into ${who}) and contrast active (inflaTING) vs
  // static (inflaTED) so the model only tags real state changes to the player's body.
  const examples = (fam.startsWith('gemma') || fam === 'chatml')
    ? 'Example final line: [pump on]'
    : `Examples — tag ONLY when air-flow into ${who} changes: starting, CONTINUING, or increasing = [pump on] (re-emit each such reply); stopping = [pump off].
She flips the toggle and the motor roars to life, air hissing into ${who}.
[pump on]
She twists the dial higher; the motor climbs to a harder, faster rhythm, driving more air into ${who}.
[pump on]
${who}'s belly keeps swelling, rounder by the second as the pump forces in more air.
[pump on]
She cups ${who}'s inflating belly, feeling it push outward with every pulse.
[pump on]
She flips the switch and cranks the dial up a notch; the pump kicks on, steadily filling ${who}.
[pump on]
(ANY operating of the pump on ${who} = [pump on]: flips/throws the switch, hits the power button, adjusts/cranks the dial up, squeezes the bulb, works the handle/lever, starts the compressor, opens the valve, holds the trigger.)
She slaps the kill switch; the hum dies and the pressure bleeds away.
[pump off]
NO tag — no change to ${who}'s air-flow (pump only mentioned, ${who} already inflated and merely described or held, OR someone other than ${who} is being pumped):
She runs a hand over ${who}'s inflated belly, taut and full, the pump sitting quiet on the cart.`;

  let s = `\nDEVICE CONTROL — ${lead} The pump is physically connected to ${who}. You drive it through hidden tags.
1) Write your narrative reply.
2) The tag tracks ONLY air-flow into ${who}'s body. IF this reply starts, continues, or increases air filling ${who}, the VERY LAST LINE must be ONLY [pump on] — nothing after it. IF it stops, write [pump off]. Pumping anyone other than ${who}, or no change in ${who}'s air-flow, gets NO tag.
Without the tag the pump does NOT move, so emit it in the SAME reply you narrate ${who} being filled. The pump auto-stops after ${maxSeconds}s — re-emit [pump on] every reply you want it to keep running; [pump off] stops it.
Tags: [pump on] / [pump off]
${examples}`;

  if (charLimits) {
    const scaledMaxOn = charLimits.llmMaxOnDuration ?? 5;
    const scaledMaxTimed = charLimits.llmMaxTimedDuration ?? 10;
    const scaledMaxCycleOn = charLimits.llmMaxCycleOnDuration ?? 2;
    s += `\nLimits: max ON ${scaledMaxOn}s, max pulse ${charLimits.llmMaxPulseRepetitions ?? 5}x, max timed ${scaledMaxTimed}s, max cycle ON ${scaledMaxCycleOn}s x${charLimits.llmMaxCycleRepetitions ?? 2}`;
  }
  return s + '\n';
}

// RETIRED FEATURE — fully torn out (audit finding #7). "Pump on every reply" (card flag
// `pumpOnEveryReply` + the `toggle_pump_always` trigger) was UI-removed long ago and its gate
// hard-returned false since v6.6.x; the dead executor (executePumpOnEveryReply), its timers, and
// all call sites are now deleted. The `toggle_pump_always` executeTrigger case remains as an inert
// tombstone so old card data referencing it logs nothing scary. Stale `pumpOnEveryReply` flags on
// disk are ignored entirely.

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
    displayName: groupBubbleName(character),
    content: '...', // Placeholder
    timestamp: Date.now()
  };
  sessionState.chatHistory.push(placeholderMessage);

  let messageContent = welcomeMsg.text;

  // If LLM enhancement is enabled, process through LLM
  if (welcomeMsg.llmEnhanced) {
    try {
      // Notify UI that AI is generating (group cards show the group name)
      broadcast('generating_start', { characterName: groupBubbleName(character) || character.name });

      // Build system prompt with constant reminders
      const playerName = settings?.activePersonaId ?
        (loadAllPersonas() || []).find(p => p.id === settings.activePersonaId)?.displayName || 'the player' :
        'the player';
      const substituteVarsWelcome = (text) => substituteAllVariables(text, { playerName, characterName: character.name, isPromptText: true });
      let systemPrompt;
      if (isInstructor(character)) {
        systemPrompt = buildInstructorSystemPrompt(character, playerName, substituteVarsWelcome);
      } else if (character.multiChar?.enabled) {
        systemPrompt = buildMultiCharSystemPrompt(character, playerName, substituteVarsWelcome);
      } else {
        systemPrompt = `You are ${character.name}. ${substituteVarsWelcome(character.description)}\n`;
        systemPrompt += `IMPORTANT WRITING STYLE: Use "I/my/me" in DIALOGUE, but use "${character.name}" (third person) for ACTIONS.\nExample: "I'll turn this up," ${character.name} says, reaching for the dial.\n\n`;
        systemPrompt += `CRITICAL ROLE RULE: You are ONLY ${character.name}. NEVER write dialogue or actions for ${playerName}. NEVER include "${playerName}:" in your response. Stop immediately if you're about to write as ${playerName}.\n\n`;
        if (character.personality) {
          systemPrompt += `Personality: ${substituteVarsWelcome(character.personality)}\n\n`;
        }
      }

      const scenario = getActiveScenario(character);
      if (scenario) {
        systemPrompt += `Scenario: ${substituteVarsWelcome(scenario)}\n\n`;
      }

      // Always-on global dictionary, unless this instructor opts out (Use Card Library Only)
      if (!(isInstructor(character) && character.ignoreDictionary)) {
        systemPrompt += buildDictionaryPrompt(character);
      }

      // Add active reminders (using reminder engine for keyword-based activation)
      const memSettingsAutoReply = getChatMemorySettings(settings);
      const recentMessages = reminderEngine.extractRecentMessages(sessionState.chatHistory, memSettingsAutoReply.reminderScanDepth);
      const activeReminders = reminderEngine.getMergedActiveReminders(
        character.constantReminders || [],
        getSharedLibraryTermEntries(character),
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

      // (removed) preInflation prompt block — getActiveCheckpoint hardcodes preInflation:null
      // (the 0% gate was replaced by Pre-Fill/Gated Intro), so the block could never render.

      if (isInstructor(character)) {
        systemPrompt += `Deliver the opening instruction to the player. Stay terse, direct, and on-mission — do not embellish. Base it on this template:\n\n"${welcomeMsg.text}"`;
      } else {
        systemPrompt += `Write an engaging, in-character first message to greet the player. Base it on this template but expand and enhance it. Keep roleplay formatting: put *actions and narration in asterisks* and "spoken dialogue in quotes" — do not flatten actions into plain prose.\n\n"${welcomeMsg.text}"`;
      }

      const result = await llmService.generate({
        prompt: `${character.name}:`,
        systemPrompt,
        settings: { ...settings.llm, ...charTokenOverride(character) }
      });

      console.log('[WELCOME] LLM result:', JSON.stringify(result).substring(0, 200));

      if (result && result.text) {
        messageContent = result.text.trim();
        // Instructors speak in plain directives — strip any RP prose the model added.
        if (isInstructor(character)) messageContent = stripInstructorRoleplay(messageContent);
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

        // Check if generation was aborted (emergency stop)
        if (eventEngine.aborted) {
          console.log('[EventEngine] Generation aborted - emergency stop');
          llmState.isGenerating = false;
          broadcast('generating_stop', {});
          broadcast('message_deleted', { id: placeholderMessage.id });
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
            // Strip trailing speaker tag before adding our own. Group cards end with "[Characters]:",
            // not "<Name>:", so cover both or the primer got duplicated.
            const charTagPattern = new RegExp(`(\\n?${activeCharacter.name}:|\\n?\\[Characters\\]:)\\s*$`);
            variationContext.prompt = variationContext.prompt.replace(charTagPattern, '');
            const varPrimer = activeCharacter.multiChar?.enabled ? '[Characters]:' : `${activeCharacter.name}:`;
            variationContext.prompt += `\n\n[Write a unique variation of: ${data.content}]\n${varPrimer}`;
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
        const rawForTagDiag = finalText;
        // Strip model scaffolding (scene headers / analysis preambles) around the reply — roleplay only
        // (instructors have their own stripInstructorRoleplay below; their non-marked text is untouched).
        if (!isInstructor(activeCharacter) && settings?.globalCharacterControls?.stripModelScaffolding !== false) {
          finalText = stripModelScaffolding(finalText);
        }
        // Remove stray [bracketed] stage directions/meta (device tags preserved for the pass below).
        if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) finalText = stripStrayBrackets(finalText);
        logTagDiag('main-reply', rawForTagDiag, finalText);
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
        // Strip the primer buildSpecialContext already added so we don't leave an empty "${playerName}:"
        // turn before our instruction (the sibling ai_message path does the same).
        context.prompt = context.prompt.replace(new RegExp(`(\\n?\\[Player\\]:|\\n?\\[Char\\]:|\\n?${playerName}:)\\s*$`), '');
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

        // Check if generation was aborted (emergency stop)
        if (eventEngine.aborted) {
          console.log('[EventEngine] Player message generation aborted - emergency stop');
          llmState.isGenerating = false;
          broadcast('generating_stop', {});
          broadcast('message_deleted', { id: placeholderMessage.id });
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
  loadPersonas: () => loadAllPersonas() || [],
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
  }

  // Load character flow assignments (consider story-level flows for active story)
  characters.forEach(char => {
    // Get flows from active story, falling back to character-level flows
    const activeStory = char.stories?.find(s => s.id === char.activeStoryId) || char.stories?.[0];
    const flows = activeStory?.assignedFlows || char.assignedFlows || [];
    if (flows.length > 0) {
      sessionState.flowAssignments.characters[char.id] = flows;
    }
  });

  // Load persona flow assignments
  personas.forEach(persona => {
    if (persona.assignedFlows && persona.assignedFlows.length > 0) {
      sessionState.flowAssignments.personas[persona.id] = persona.assignedFlows;
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
    // Sync the card's effective auto-reply (active story → card fallback; instructors
    // default on) to session state.
    sessionState.autoReply = resolveCardAutoReply(activeCharacter);
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

  // Re-sync the ">>" next-gate to THIS (re)connecting client. nextGateActive is a FRONTEND-only field,
  // so the init above (setSessionState) clears it — which on a background/app-switch reconnect used to
  // strand a live WAIT sequence (the intro >> chain), leaving UNLOCK locked forever. The backend's
  // pendingTreeNext / pendingRangeAwait is the source of truth; re-broadcast it so the gate survives.
  const _nextGateActive = !!(sessionState.pendingTreeNext
    || (sessionState.pendingRangeAwait && (sessionState.pendingRangeAwait.kind === 'next' || sessionState.pendingRangeAwait.kind === 'next-individual')));
  ws.send(JSON.stringify({ type: 'next_gate', data: { active: _nextGateActive }, timestamp: Date.now() }));

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

  // testConnection can take seconds (a real short generation). RE-LOAD settings AFTER the await and
  // write only the detectedModelName field, so a concurrent profile-switch / settings save during the
  // probe isn't clobbered by this stale snapshot.
  const applyDetectedModel = (modelName) => {
    const fresh = loadData(DATA_FILES.settings);
    if (!fresh?.llm) return;
    fresh.llm.detectedModelName = modelName;
    saveData(DATA_FILES.settings, fresh);
    broadcast('settings_update', maskSettingsForResponse(fresh));
  };

  try {
    const result = await llmService.testConnection(settings.llm);
    if (result.success && result.modelName) {
      if (result.modelName !== lastDetectedModel) {
        lastDetectedModel = result.modelName;
        applyDetectedModel(result.modelName);
        log.info(`[LLM] Detected model: ${result.modelName}`);
      }
    }
  } catch (e) {
    if (lastDetectedModel !== null) {
      lastDetectedModel = null;
      applyDetectedModel(null);
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
      stopAllMemberInflation();
      stopPumpSafetyWatchdog();
      clearAllServerTimedPumpTimers();
      clearAllCustomDeviceTimers();
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
      // Serialized (audit H7): rapid double-sends queue instead of interleaving generations.
      await enqueueChatTurn(async () => {
        // Multichar with girls ticked in the responder dropdown → reply as each ticked girl
        // individually (in order), not the group. Falls back to the normal path otherwise.
        if (Array.isArray(data.respondAs) && data.respondAs.length) {
          const cmSettings = loadData(DATA_FILES.settings);
          const cmChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
          const cmChar = cmChars.find(c => c.id === cmSettings?.activeCharacterId);
          const cmPersonas = loadAllPersonas() || [];
          const cmPersona = cmPersonas.find(p => p.id === cmSettings?.activePersonaId);
          // Respect the same send gates as the normal path: don't reply while a blocking video plays or
          // when the message itself carries one; route the rest through handleChatMessage.
          const hasBlockingVideo = /\[Video:([^\]:]+):blocking\]/i.test(data.content || '');
          if (cmChar?.multiChar?.enabled && !cmSettings?.mediaBlocking && !sessionState.mediaBlocking && !hasBlockingVideo) {
            await handleIndividualResponses(data, cmChar, cmSettings, cmPersona, data.respondAs);
            return;
          }
        }
        await handleChatMessage(data);
      });
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

        // "Send as Character" can target a specific group member (data.memberId): post under that
        // member's OWN name (no group-name override). Otherwise the card / group speaks.
        const amTarget = (data.memberId && activeCharacter.multiChar?.enabled)
          ? (activeCharacter.multiChar.characters || []).find(m => m.id === data.memberId)
          : null;
        const message = {
          id: uuidv4(),
          content: data.content,
          sender: 'character',
          characterId: activeCharacter.id,
          characterName: amTarget?.name || activeCharacter.name,
          displayName: amTarget ? null : groupBubbleName(activeCharacter),
          memberId: amTarget?.id,
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
            // Mirror the auto-capacity ENGINE exactly (see handlePumpRuntime): capacity accrues from
            // effectiveSeconds (the modifier already banked in per-second as it ran), NOT
            // totalSeconds*currentModifier. With a modifier ≠ 1.0 (this session: 0.67) the two disagree,
            // so the old formula set a wrong offset and the next pump tick snapped the manual value to
            // the wrong number. Using effectiveSeconds makes offset = manual - engineValue precisely,
            // so engineValue + offset == the manual value you set, and it holds.
            const effSeconds = tracker.effectiveSeconds !== undefined
              ? tracker.effectiveSeconds
              : (tracker.totalSeconds || 0) * recalModifier;
            autoCapacity += (effSeconds / dev.calibrationTime) * 100;
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

      // Emotional Decline feature removed entirely — capacity no longer auto-degrades emotion.

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

    case 'update_auto_capacity': {
      const enabled = !!data.enabled;
      const acSettings = loadData(DATA_FILES.settings) || {};
      if (!acSettings.globalCharacterControls) acSettings.globalCharacterControls = {};
      acSettings.globalCharacterControls.useAutoCapacity = enabled;
      saveData(DATA_FILES.settings, acSettings);
      console.log(`[AutoCapacity] Automatic tracking ${enabled ? 'ENABLED' : 'DISABLED'} on the fly`);
      broadcast('auto_capacity_update', { useAutoCapacity: enabled });
      break;
    }

    case 'set_pump_ready': {
      // Live per-session pump-connection state. data: { entity:'persona'|'character'|'member', id?, ready }
      if (!sessionState.pumpReady) sessionState.pumpReady = { persona: true, character: false, members: {} };
      const ready = !!data.ready;
      if (data.entity === 'persona') sessionState.pumpReady.persona = ready;
      else if (data.entity === 'character') sessionState.pumpReady.character = ready;
      else if (data.entity === 'member' && data.id) sessionState.pumpReady.members[data.id] = ready;
      else break;
      broadcast('pump_ready_update', { pumpReady: sessionState.pumpReady });
      console.log(`[PumpReady] ${data.entity}${data.id ? ':' + data.id : ''} -> ${ready ? 'READY' : 'not ready'}`);
      break;
    }

    case 'update_character_capacity':
      sessionState.characterCapacity = Math.max(0, Math.min(100, parseInt(data.characterCapacity) || 0));
      broadcast('character_capacity_update', { characterCapacity: sessionState.characterCapacity });
      eventEngine.checkCharacterStateChanges({ characterCapacity: sessionState.characterCapacity });
      console.log(`[CharCapacity] Manually set to ${sessionState.characterCapacity}%`);
      break;

    case 'update_member_capacity': {
      // Manual per-member capacity for group cards (non-base members; the base member
      // rides sessionState.characterCapacity via update_character_capacity).
      if (!data.memberId) break;
      if (!sessionState.memberCapacities) sessionState.memberCapacities = {};
      const memberCap = Math.max(0, Math.min(100, parseInt(data.capacity) || 0));
      sessionState.memberCapacities[data.memberId] = memberCap;
      broadcast('member_capacity_update', { memberId: data.memberId, capacity: memberCap, memberCapacities: sessionState.memberCapacities });
      console.log(`[MemberCapacity] ${data.memberId} manually set to ${memberCap}%`);
      break;
    }

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

    case 'toggle_member_auto_pump': {
      // AUTO-PUMP header buttons: start/stop the mock auto-inflation engine for ONE body.
      // memberId '' / 'base' / the group base member's id → the classic base-char engine
      // (characterCapacity); any other member id → that member's independent ticker.
      const apSettings = loadData(DATA_FILES.settings) || {};
      const apChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const apChar = apChars.find(c => c.id === apSettings.activeCharacterId);
      if (!apChar) break;
      const apCal = getCharacterCalibrationTime(apChar);
      const apBurst = apChar.charBurstPercent || 100;
      const apMm = apChar.multiChar?.characters || [];
      const apId = String(data.memberId || '');
      const apIsBase = !apId || apId === 'base' || (apMm[0] && apMm[0].id === apId);
      if (apIsBase) {
        const basePumpable = apChar.isPumpable || (apChar.multiChar?.enabled && apMm[0]?.isPumpable);
        if (data.enabled) { if (basePumpable && apCal) startCharacterInflation(apCal, apBurst); }
        else stopCharacterInflation();
      } else {
        const apMem = apMm.find(m => m.id === apId);
        if (data.enabled) { if (apMem?.isPumpable && apCal) startMemberInflation(apId, apMem.name, apCal, apBurst); }
        else stopMemberInflation(apId);
      }
      break;
    }

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
      // Cap the input-recall buffer: it is autosaved and rides in every WS init frame — unbounded
      // it grew to >1MB (2k entries), stalling reconnects on slow WiFi and bloating every autosave.
      sessionState.messageInputHistory = (data.history || []).slice(-100);
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

        const personaButtonsUpdated = false; // flow-linked auto buttons retired (E3)

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
      const buttonsUpdated = false; // flow-linked auto buttons retired (E3)
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

    case 'tree_select_member_response':
      // OK carries the picked memberId; Cancel carries null → the whole tree run aborts.
      await resumeTreeSelectMember(data.memberId || null);
      break;

    case 'tree_player_input_response':
      // OK carries values (array aligned with the armed rows); Cancel carries null → tree aborts.
      await resumeTreePlayerInput(Array.isArray(data.values) ? data.values : null);
      break;

    case 'tree_choose_multi_response':
      await resumeTreeChooseMulti(data.selectedIds);
      break;

    case 'tree_minigame_result':
      await resumeTreeGame(data.exit, data.winner, data.pick);
      break;

    case 'tree_minigame_miss': {
      // Mid-game miss (game still running — no resume). Fires 'minigame_miss' event bindings AND,
      // when the Call MiniGame block bound a goto to its 'Miss' exit, SIDE-RUNS the tree from that
      // label: the game overlay stays open and pendingTreeGame stays armed for the real
      // Completed/Failed exit. Runs per wrong move (once-nodes inside still fire once per session).
      await runEventTrees('minigame_miss', {
        gameId: sessionState.pendingTreeGame?.miniGameId || null,
        misses: Number(data.misses) || 0,
        maxMisses: Number(data.maxMisses) || 0
      });
      const missPend = sessionState.pendingTreeGame;
      const missGoto = missPend?.exitGotos?.Miss;
      if (missGoto && Array.isArray(missPend.rootNodes)) {
        const missIdx = missPend.rootNodes.findIndex(n => isGotoTarget(n, missGoto));
        if (missIdx < 0) {
          console.warn(`[Tree] Miss goto target '${missGoto}' not found at the tree's top level — skipping (place Miss Labels/named Groups at the top level)`);
        } else {
          const snap = missPend.ctxSnapshot || {};
          const settings = loadData(DATA_FILES.settings) || {};
          const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
          const character = characters.find(c => c.id === settings?.activeCharacterId) || null;
          const ctx = {
            character, settings,
            treeId: snap.treeId, scopeKey: `${snap.scopeKey || 'default'}>miss`, // own once-scope for the side-run
            depth: snap.childDepth || 0, delivery: 'standalone',
            source: snap.source || `tree:${snap.treeId}`,
            visited: new Set(snap.visited || [snap.treeId]),
            firedSet: sessionState.firedTreeNodes,
            rootNodes: missPend.rootNodes,
            labels: new Map()
          };
          try {
            const sig = await runTree(missPend.rootNodes.slice(gotoResumeIndex(missPend.rootNodes, missIdx)), ctx);
            if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
          } catch (e) { console.error('[Tree] Miss goto side-run failed:', e?.message || e); }
        }
      }
      break;
    }

    case 'checkpoint_choice_response':
      await handleCheckpointChoice(data.choiceId);
      break;

    case 'manual_pump':
      await handleManualPump();
      break;

    case 'primary_pump_on': {
      // Manual toggle of the primary pump from the chat UI (balloon button). Honors the capacity
      // ceiling; stays on until primary_pump_off (a deliberate manual control).
      if (pumpBlockedByCapacity()) {
        console.log('[PrimaryPump] ON blocked — capacity at ceiling and over-inflation not allowed');
        break;
      }
      const ppDevices = loadData(DATA_FILES.devices) || [];
      const ppPump = getPrimaryPumpDevice(ppDevices);
      if (ppPump) {
        const id = resolveControlId(ppPump);
        await deviceService.turnOn(id, ppPump);
        exemptForcedRun(id); // manual on — banks through any freeze until turned off
        broadcast('ai_device_control', { device: 'pump', action: 'on', deviceName: ppPump.label || ppPump.name || 'Pump' });
      }
      break;
    }

    case 'primary_pump_off': {
      sessionState.playerIsInflating = false; // an explicit off ends any latched-pump mode
      const ppDevices = loadData(DATA_FILES.devices) || [];
      const ppPump = getPrimaryPumpDevice(ppDevices);
      if (ppPump) {
        const id = resolveControlId(ppPump);
        clearServerTimedPumpTimer(id);
        await deviceService.turnOff(id, ppPump);
        broadcast('ai_device_control', { device: 'pump', action: 'off', deviceName: ppPump.label || ppPump.name || 'Pump' });
      }
      break;
    }

    case 'gate_release':
      await handleGateRelease();
      break;

    case 'engine_debug_subscribe': {
      // Live engine debug panel (audit D3): while any client has the panel open, push a snapshot
      // every 1.5s. Subscribing sends an immediate first frame.
      _engineDbgSubs = Math.max(0, _engineDbgSubs + (data?.on ? 1 : -1));
      consoleBroadcastEnabled = _engineDbgSubs > 0; // server_log piggybacks on the debug panel
      if (_engineDbgSubs > 0 && !_engineDbgTimer) {
        _engineDbgTimer = setInterval(() => {
          // Self-heal a leaked subscription (tab closed without unsubscribing): no clients, no timer.
          if (wsClients.size === 0) { clearInterval(_engineDbgTimer); _engineDbgTimer = null; _engineDbgSubs = 0; return; }
          try { broadcast('engine_debug', engineDebugSnapshot()); } catch (e) { /* never let debug kill the loop */ }
        }, 1500);
      }
      if (_engineDbgSubs === 0 && _engineDbgTimer) { clearInterval(_engineDbgTimer); _engineDbgTimer = null; }
      if (data?.on) { try { broadcast('engine_debug', engineDebugSnapshot()); } catch (e) { /* ignore */ } }
      break;
    }

    case 'next_gate_advance': {
      // Player pressed ">>" (Next) — release the paused message sequence and continue with the next one.
      const pa = sessionState.pendingRangeAwait;
      if (pa && pa.kind === 'next') {
        broadcast('next_gate', { active: false });
        await resumeTriggerSequence(pa).catch(err => console.error('[NextGate] resume failed:', err?.message || err));
      } else if (pa && pa.kind === 'next-individual') {
        sessionState.pendingRangeAwait = null;
        broadcast('next_gate', { active: false });
        await resumeIndividualSequence(pa).catch(err => console.error('[NextGate/Individual] resume failed:', err?.message || err));
      } else if (sessionState.pendingTreeNext) {
        // Tree (e.g. gated intro) holding between back-to-back standalone messages.
        await resumeTreeNext().catch(err => console.error('[NextGate/Tree] resume failed:', err?.message || err));
      }
      // WAIT resolved — fire any queued Fire% gate now that no message gate is open (the gauge also
      // unfreezes automatically: handlePumpRuntime banks runtime again once isGaugeFrozen() is false).
      await tryResumeCapacityGate().catch(() => {});
      break;
    }

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

    case 'execute_button':
    case 'execute_event':  // Keep for backwards compatibility
      // Lock the action buttons for the WHOLE button run (its generations, its WAIT/delay, the gaps
      // between nodes) so a second press can't overlap. Frontend disables on sessionState.actionBusy.
      sessionState.actionBusy = true;
      broadcast('action_busy', { active: true });
      try { await handleExecuteButton(data); }
      finally { sessionState.actionBusy = false; broadcast('action_busy', { active: false }); }
      break;

    case 'flow_pause':
    case 'flow_resume':
      // Flow engine removed (E3) — stale clients may still send these; ignore.
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
      if (msg.excludeFromContext || (msg.sender === 'system' && msg.includeInContext !== true)) return;
      const speaker = msg.sender === 'system' ? 'System' : msg.sender === 'player' ? playerName : (msg.characterName || charName);
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
    resetEventTriggerState();
    sessionState.checkpointControl = null; // Checkpoint Control overrides die with the session
  sessionState.pendingIntroStart = null; // a deferred intro from the old session must not fire into the new one
  sessionState.eventTriggerOverrides = null; // Event Trigger Toggle overrides die with the session
  sessionState.sessionStartActive = false;
    sessionState.pendingTreeResume = null;
    sessionState.pendingTreeGame = null;
    sessionState.pendingTreeChoice = null;
    sessionState.pendingTreeNext = null;
    sessionState.pendingCheckpointChoice = null;
    broadcast('next_gate', { active: false });      // don't leave a stuck ">>" gate pointing at wiped context
    broadcast('checkpoint_choice_clear', {});       // dismiss any armed choice panel (its continuation is void)
    sessionState.playerIsInflating = false;

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
    resetEventTriggerState();
    sessionState.checkpointControl = null; // Checkpoint Control overrides die with the session
  sessionState.pendingIntroStart = null; // a deferred intro from the old session must not fire into the new one
  sessionState.eventTriggerOverrides = null; // Event Trigger Toggle overrides die with the session
  sessionState.sessionStartActive = false;
    sessionState.pendingTreeResume = null;
    sessionState.pendingTreeGame = null;
    sessionState.pendingTreeChoice = null;
    sessionState.pendingTreeNext = null;
    sessionState.pendingCheckpointChoice = null;
    broadcast('next_gate', { active: false });      // don't leave a stuck ">>" gate pointing at wiped context
    broadcast('checkpoint_choice_clear', {});       // dismiss any armed choice panel (its continuation is void)
    sessionState.playerIsInflating = false;
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
    resetEventTriggerState();
    sessionState.checkpointControl = null; // Checkpoint Control overrides die with the session
  sessionState.pendingIntroStart = null; // a deferred intro from the old session must not fire into the new one
  sessionState.eventTriggerOverrides = null; // Event Trigger Toggle overrides die with the session
  sessionState.sessionStartActive = false;
    sessionState.pendingTreeResume = null;
    sessionState.pendingTreeGame = null;
    sessionState.pendingTreeChoice = null;
    sessionState.pendingTreeNext = null;
    sessionState.pendingCheckpointChoice = null;
    broadcast('next_gate', { active: false });      // don't leave a stuck ">>" gate pointing at wiped context
    broadcast('checkpoint_choice_clear', {});       // dismiss any armed choice panel (its continuation is void)
    sessionState.playerIsInflating = false;
    autosaveSession();
    broadcast('chat_cleared', { messages: [] });
    console.log('[ClearChat] Both screen and context cleared');
  }
}

function handleEditMessage(data) {
  const { id, content } = data;
  const msgIndex = sessionState.chatHistory.findIndex(m => m.id === id);
  if (msgIndex !== -1) {
    const m = sessionState.chatHistory[msgIndex];
    m.content = content;
    m.edited = true;
    // Keep the active swipe in sync — otherwise paging swipes away and back restores the old text
    // from swipeHistory and silently reverts the edit.
    if (Array.isArray(m.swipeHistory) && typeof m.activeSwipeIndex === 'number' && m.swipeHistory[m.activeSwipeIndex] !== undefined) {
      m.swipeHistory[m.activeSwipeIndex] = content;
    }
    broadcast('message_updated', m);
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

  // Snapshot the FULL transcript up front and guarantee it is restored on EVERY exit path
  // (success, abort, verbatim, or error). Previously only the success path restored it, so an
  // abort/verbatim/throw left chatHistory permanently truncated to before the swiped message.
  const originalContent = msg.content;
  if (!msg.swipeHistory) {
    msg.swipeHistory = [originalContent];
    msg.activeSwipeIndex = 0;
  }
  const fullHistory = [...sessionState.chatHistory];
  let historyRestored = false;
  const restoreHistory = () => { if (!historyRestored) { sessionState.chatHistory = fullHistory; historyRestored = true; } };

  try {
    // Notify UI that AI is generating
    const isPlayerVoice = msg.sender === 'player';
    const generatingFor = isPlayerVoice ? (activePersona?.displayName || 'Player') : activeCharacter.name;
    broadcast('generating_start', { characterName: generatingFor, isPlayerVoice });

    // Placeholder while generating
    if (useStreaming) {
      sessionState.chatHistory[msgIndex].content = '';
      sessionState.chatHistory[msgIndex].streaming = true;
    } else {
      sessionState.chatHistory[msgIndex].content = '...';
    }
    broadcast('message_updated', sessionState.chatHistory[msgIndex]);
    await new Promise(resolve => setTimeout(resolve, 50));

    const isPlayerMsg = msg.sender === 'player';
    let systemPrompt, prompt, swipeMessages, swipeStops;

    if (isPlayerMsg) {
      // For player messages, use impersonate with guidance if provided.
      const mode = guidanceText ? 'guided_impersonate' : 'impersonate';
      // Truncate to before this message for context building.
      sessionState.chatHistory = fullHistory.slice(0, msgIndex);
      const impersonateContext = buildSpecialContext(mode, guidanceText, activeCharacter, activePersona, settings);
      systemPrompt = impersonateContext.systemPrompt;
      prompt = impersonateContext.prompt;
      swipeMessages = impersonateContext.messages;
      swipeStops = impersonateContext.stopSequences;
    } else {
      // For character messages, roll personality attributes on the FULL history first.
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      await runReplyScopes(activeCharacter);
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'swipe' });
      if (await deliverPendingVerbatimReply()) { restoreHistory(); return; } // verbatim injection replaces this reply
      // Truncate to before this message for context building.
      sessionState.chatHistory = fullHistory.slice(0, msgIndex);
      const context = applyCharacterGuidance(
        buildChatContext(activeCharacter, settings),
        activeCharacter,
        guidanceText
      );
      systemPrompt = context.systemPrompt;
      prompt = context.prompt;
      swipeMessages = context.messages;
      swipeStops = context.stopSequences;
    }

    let resultText;
    // A player-voice swipe is impersonation — honor impersonateMaxTokens, not the character's budget.
    const swipeTokenSettings = isPlayerMsg
      ? (settings.llm?.impersonateMaxTokens ? { maxTokens: settings.llm.impersonateMaxTokens } : {})
      : charTokenOverride(activeCharacter);

    if (useStreaming) {
      const result = await llmService.generateStream({
        prompt,
        messages: swipeMessages,
        systemPrompt,
        settings: { ...settings.llm, ...swipeTokenSettings, stopSequences: [...(settings.llm?.stopSequences || []), ...(swipeStops || [])] },
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
        settings: { ...settings.llm, ...swipeTokenSettings, stopSequences: [...(settings.llm?.stopSequences || []), ...(swipeStops || [])] }
      });
      resultText = result.text;
    }

    // Restore the full transcript before any post-processing / device activation.
    restoreHistory();

    // Abort guard: if an emergency stop fired while the LLM was generating, do NOT
    // activate any device from this (now-stale) response.
    if (eventEngine.aborted) {
      console.log('[Swipe] Aborted after generation - skipping device activation');
      sessionState.chatHistory[msgIndex].content = originalContent;
      sessionState.chatHistory[msgIndex].streaming = false;
      broadcast('generating_stop', {});
      broadcast('message_updated', sessionState.chatHistory[msgIndex]);
      return;
    }

    // Strip cross-role bleed (and instructor RP prose) like the normal reply path — a swipe must not
    // generate the other speaker's lines or leave *actions*/quotes in instructor output. Device tags
    // are brackets, so they survive these strips and are executed below.
    resultText = stripCrossRoleContent(resultText, swipeStops || [], !isPlayerMsg);
    if (!isPlayerMsg && isInstructor(activeCharacter)) resultText = stripInstructorRoleplay(resultText);
    // Remove stray [bracketed] meta (device tags preserved for the pass below).
    if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) resultText = stripStrayBrackets(resultText);

    // Process AI device commands (e.g., [pump on], [vibe off]).
    const devices = loadData(DATA_FILES.devices) || [];
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
        // Append to this message so LLM thinks they said it.
        resultText += ` ${text}`;
      }
    });
    if (aiControlResult.commands.length > 0) {
      console.log(`[Swipe] AIDeviceControl executed ${aiControlResult.commands.length} device command(s)`);
      resultText = aiControlResult.text;
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

    // Update the swiped message (apply variable substitution).
    const finalContent = applyPendingReplyWraps(substituteAllVariables(resultText));
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
    restoreHistory(); // never leave the transcript truncated
    if (sessionState.chatHistory[msgIndex]) {
      sessionState.chatHistory[msgIndex].content = originalContent;
      sessionState.chatHistory[msgIndex].streaming = false;
      broadcast('message_updated', sessionState.chatHistory[msgIndex]);
    }
    broadcast('generating_stop', {});
  } finally {
    restoreHistory(); // final safety net
  }
}

function handleDeleteMessage(data) {
  const { id } = data;
  const msgIndex = sessionState.chatHistory.findIndex(m => m.id === id);
  if (msgIndex !== -1) {
    sessionState.chatHistory.splice(msgIndex, 1);
    // chatMemorySummaryUpTo is an absolute index into chatHistory. Deleting a message BEFORE the
    // summary boundary shifts everything down by one; without rebasing, an unsummarized message would
    // slide under the boundary and fall out of the context window forever (permanent memory hole).
    if (typeof sessionState.chatMemorySummaryUpTo === 'number' && msgIndex < sessionState.chatMemorySummaryUpTo) {
      sessionState.chatMemorySummaryUpTo = Math.max(0, sessionState.chatMemorySummaryUpTo - 1);
    }
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
// it standalone (ai_message posts immediately, like other button actions). scopeKey btn:<id>#<seq>:
// each press gets a FRESH once-scope, so `once` still guards loops/re-entry WITHIN a run but a new
// press re-runs the whole tree. (With a press-stable scope, the editor's default-ON `once` flag made
// every button tree fire exactly once per session — pressed once, then dead until a new session.)
async function handleButtonRunTree(action, characterId) {
  if (sessionState.introActive || sessionState.preFillActive) { console.log('[Button] run_tree blocked — gated intro active'); return; }
  const ref = action.config?.treeRef || (action.config?.treeId ? { treeId: action.config.treeId } : action.config?.inline ? { inline: action.config.inline } : null);
  if (!ref) { console.log('[Button] run_tree: no tree ref configured'); return; }
  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === (characterId || settings?.activeCharacterId)) || null;
  const treeIndex = buildTreeIndex(character);
  const tree = resolveRefTree(ref, treeIndex);
  if (!tree) { console.log('[Button] run_tree: ref did not resolve to a tree'); return; }
  sessionState.btnTreeRunSeq = (sessionState.btnTreeRunSeq || 0) + 1;
  await runTreeScope(tree, `btn:${action.config?.buttonId || action.id || 'x'}#${sessionState.btnTreeRunSeq}`, character, settings, { delivery: 'standalone', treeIndex });
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

  // Multi-char button targeting: a 'message' action may name the member who speaks.
  const targetMember = (character.multiChar?.enabled && action.config?.memberId)
    ? (character.multiChar.characters || []).find(m => m.id === action.config.memberId)
    : null;
  const speakerName = targetMember?.name || character.name;

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
      characterName: speakerName,
      // Exclude from the prompt while it's just the "..." placeholder — otherwise buildChatContext
      // below sees "SpeakerName: ..." as the last turn and primes duplicate/confused output.
      excludeFromContext: true,
      ...(targetMember ? { memberId: targetMember.id } : {}),
      timestamp: Date.now()
    };

    sessionState.chatHistory.push(placeholderMessage);
    broadcast('chat_message', placeholderMessage);

    // Notify UI that AI is generating
    llmState.isGenerating = true;
    broadcast('generating_start', { characterName: speakerName });

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
      const soloDirective = targetMember
        ? `\nRespond ONLY as ${speakerName}. Do NOT write, voice, or narrate any other character — just ${speakerName}.`
        : '';
      context.systemPrompt += `\n\n=== CRITICAL INSTRUCTION ===\nYour next response MUST be ${targetMember ? speakerName : 'the character'} performing this specific action: "${instructionText}"\nIgnore previous conversation flow. Do NOT respond to what the player said. Simply perform the action described above.${soloDirective}\n=== END CRITICAL INSTRUCTION ===`;

      // Append instruction to the prompt so it's the last thing before generation
      context.prompt += `\n\n${instruction}\n${speakerName}:`;

      console.log('[Button] Generating LLM message based on:', instructionText);

      // Generate enhanced response
      const result = await llmService.generate({
        prompt: context.prompt,
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        settings: { ...settings.llm, ...charTokenOverride(character) }
      });

      // Update placeholder message with actual content (apply variable substitution + instructor strip)
      let guidedText = isInstructor(character)
        ? stripInstructorRoleplay(substituteAllVariables(result.text))
        : substituteAllVariables(result.text);
      if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) guidedText = stripStrayBrackets(guidedText);
      placeholderMessage.content = guidedText;
      delete placeholderMessage.excludeFromContext; // now a real reply — include it in future context

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
      delete placeholderMessage.excludeFromContext;

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
  exemptForcedRun(deviceId); // button press = forced run — banks through any freeze
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
  exemptForcedRun(deviceId); // button cycle = forced run
}

async function handleButtonLinkToFlow(action, characterId, buttonId) {
  // Flow engine removed (E3). Stale link_to_flow buttons log and do nothing.
  console.log(`[Button] link_to_flow ignored (flows removed) — button #${buttonId}`);
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

// Multichar individual responses: when the responder dropdown has girls ticked, reply as EACH
// ticked girl one at a time, IN ORDER (the tick order), each as ONLY herself — N ticks = N
// back-to-back generations, each capped at the card's Individual Response Tokens (default 150).
// Skips the normal group reply. Muted girls never speak. Reuses buildChatContext for the full
// per-turn context (so each later girl sees the earlier girls' replies) + a hard solo directive.
// Kept SEPARATE from handleChatMessage so the central reply path is untouched.
// Chat-bubble name for a group card's blended reply: the Group Name if set. Bubble-only (display),
// so it does NOT touch [Char] substitution. Returns null for single cards (bubble falls back to name).
function groupBubbleName(character) {
  return (character?.multiChar?.enabled && character.multiChar.groupName) ? character.multiChar.groupName : null;
}

// Compute the speaking order for a group in "Individual Responses" mode (SillyTavern-style natural
// order, minus talkativeness randomness): members named in the player's latest message speak FIRST
// (in list order), then everyone else in a ROUND-ROBIN whose lead rotates each turn. All non-muted
// members speak exactly once. Returns an ordered array of member ids.
function computeSpeakingOrder(members, mutedSet, playerText) {
  const active = (members || []).filter(m => m && m.id && m.name && !mutedSet.has(m.id));
  if (active.length === 0) return [];
  const text = String(playerText || '');
  const wordChar = /[\p{L}\p{N}_]/u;
  const isMentioned = (m) => {
    const raw = String(m.name);
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Only apply a \b boundary where the name's edge is itself a word char — otherwise punctuation,
    // accented, or non-Latin names (e.g. "Zoë", "Луна", "K.O.") would never match.
    const left = wordChar.test(raw[0]) ? '\\b' : '';
    const right = wordChar.test(raw[raw.length - 1]) ? '\\b' : '';
    try { return new RegExp(`${left}${esc}${right}`, 'iu').test(text); } catch { return false; }
  };
  const mentioned = active.filter(isMentioned);
  const rest = active.filter(m => !isMentioned(m));
  const rot = rest.length ? ((sessionState.groupRotation || 0) % rest.length + rest.length) % rest.length : 0;
  const rotated = rest.slice(rot).concat(rest.slice(0, rot));
  if (rest.length) sessionState.groupRotation = (sessionState.groupRotation || 0) + 1; // advance only when consumed
  return [...mentioned, ...rotated].map(m => m.id);
}

// Strip leading "SpeakerName:" labels the model echoed from the transcript format (e.g. a solo reply
// that came back as "Jess: Jess (Copy): *...*"). Only removes prefixes matching a KNOWN name.
function stripSpeakerPrefixes(text, names) {
  if (!text) return text;
  const escaped = (names || []).filter(Boolean).map(n => String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return text.trimStart();
  const re = new RegExp('^(?:\\s*(?:' + escaped.join('|') + ')\\s*:\\s*)+', 'i');
  return text.replace(re, '').trimStart();
}

// Some models (notably Cydonia) prepend a scene header / analysis ("# NEW SCENE", "Analysis: ...", a
// paragraph of meta-commentary) — or append trailing notes — instead of a clean in-character reply.
// Roleplay replies are wrapped in dialogue quotes ("...") and action asterisks (*...*); the real reply
// runs from the FIRST such marker to the LAST. This trims scaffolding OUTSIDE that span, but ONLY when
// the outside text is clearly meta (a markdown header, or a known scene/analysis/OOC opener) — never
// plain prose — so it can't eat a legitimate 'She walked in. "Hi."' lead-in. No markers → left untouched.
// Some models echo the "=== MANDATORY — … ===" SYSTEM directives (director's note, stage direction,
// pre-inflation requirement, critical instruction, individual-response) straight into the reply,
// despite the "do NOT quote this note" line. Strip any leaked block — complete (header … === END … ===)
// or truncated (header … end of output, when the model ran out of tokens before the END marker).
function stripLeakedDirectives(text) {
  if (!text) return text;
  const KEYS = 'MANDATORY|CRITICAL INSTRUCTION|DIRECTOR|STAGE DIRECTION|PRE-INFLATION|INDIVIDUAL RESPONSE';
  const src = String(text);
  // RESCUE: capture real actuation tags — device/media tags ALONE on the trailing lines (the
  // instructed "tag alone on the final line" anatomy) — so an echoed-directive strip can never
  // silently kill the pump command. Tags merely MENTIONED inside an echoed block ("do not use
  // [pump on] until…") sit mid-sentence, not alone on trailing lines, so they are never resurrected.
  const TAG_LINE = /^\[\s*(?:pump|vibe|tens)\b[^\]]*\]$|^\[\s*(?:video|audio|image|img|sound)\s*:[^\]]*\]$/i;
  const tailTags = [];
  {
    const lines = src.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0 && tailTags.length < 4; i--) {
      const ln = lines[i].trim();
      if (!ln) continue;
      if (TAG_LINE.test(ln)) { tailTags.unshift(ln); continue; }
      break;
    }
  }
  // 1) Complete echoed blocks (header … === END … ===) — removed wherever they appear.
  let out = src.replace(new RegExp(`\\n*={2,}\\s*(?:${KEYS})[\\s\\S]*?={2,}\\s*END[^\\n=]*={2,}\\n*`, 'gi'), '\n');
  // 2) Truncated TRAILING echo (header … end of output, model ran out of tokens before END).
  //    Only cut when the remainder is SHORT — the old header-to-EOF nuke destroyed entire replies
  //    (story AND the final [pump on]) whenever a header leaked early. A long remainder is real
  //    story: leave it (cosmetic leak beats a destroyed reply).
  const trunc = new RegExp(`={2,}\\s*(?:${KEYS})`, 'gi');
  let m, lastIdx = -1;
  while ((m = trunc.exec(out)) !== null) lastIdx = m.index;
  if (lastIdx >= 0 && out.length - lastIdx <= 800 && !/={2,}\s*END/i.test(out.slice(lastIdx))) {
    out = out.slice(0, lastIdx);
  }
  // 3) Echoed physical-state preface — the one injected block that is NOT ===-fenced
  //    ('[Current physical reality — …]'); observed replayed verbatim at the end of real replies.
  //    Handled HERE (not only stripStrayBrackets) so it dies on every path that runs this cleaner,
  //    including with the brackets toggle off. Unterminated tail form included.
  out = out.replace(/\[Current physical reality[\s\S]*?(?:\]|$)/gi, '');
  // 4) Leading "obedience preamble" — '[Understood. I will write ONLY as X, following all
  //    instructions…]' acknowledgment (+ a trailing --- rule) emitted before the actual reply.
  //    Keyed to instruction-y phrases so genuine in-fiction brackets survive.
  out = out.replace(/^\s*\[[^\]]{0,800}?(?:follow(?:ing)?\s+(?:all\s+)?instructions|write\s+ONLY\s+as|stay\s+in\s+character|portray\s+[\w\s]{1,40}?(?:realistically|accurately))[^\]]*\]\s*(?:[-–]{2,}\s*)?/i, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  for (const t of tailTags) if (!out.includes(t)) out += `\n${t}`;
  return out;
}

// Diagnostic: did the model emit device tags, and did they survive the cleanup chain?
// Distinguishes "model never sent a tag" (prompt/sampler problem) from "tag eaten by a stripper"
// (cleanup bug) at a glance in the backend log. Cheap; logs one line per reply.
function logTagDiag(where, rawText, cleanText) {
  try {
    const TAG = /\[\s*(?:pump|vibe|tens)\b[^\]]*\]/gi;
    const norm = (s) => (String(s || '').match(TAG) || []).map(t => t.toLowerCase().replace(/\s+/g, ' '));
    const raw = norm(rawText);
    const clean = norm(cleanText);
    if (!raw.length) { console.log(`[TagDiag] ${where}: model emitted NO device tag`); return; }
    const lost = raw.filter(t => !clean.includes(t));
    if (lost.length) console.log(`[TagDiag] ${where}: TAG LOST IN CLEANUP raw=[${raw.join(' ')}] clean=[${clean.join(' ') || 'none'}]`);
    else console.log(`[TagDiag] ${where}: tags ok [${clean.join(' ')}]`);
  } catch { /* diagnostics must never break the reply path */ }
}

function stripModelScaffolding(text) {
  if (!text) return text;
  text = stripLeakedDirectives(text);
  const s = String(text);
  const firsts = ['"', '*'].map(ch => s.indexOf(ch)).filter(i => i >= 0);
  const lasts = ['"', '*'].map(ch => s.lastIndexOf(ch)).filter(i => i >= 0);
  if (!firsts.length || !lasts.length) return text; // not a marked-up roleplay reply — leave it alone
  const start = Math.min(...firsts);
  const end = Math.max(...lasts);
  if (end < start) return text;

  // Precise meta/scaffolding signals so real narration is never stripped: a markdown header, a
  // <think> block, or a known scene/analysis/OOC/label opener.
  const SCAFFOLD = /(?:^|\n)\s*#{1,6}\s|\banalysis\b|\bnew scene\b|\bscene\s+(?:break|transition|change|shift)\b|<\/?think|(?:^|\n)\s*(?:scene|setting|summary|context|ooc|note|thoughts?)\s*[:#\-–]/i;

  const lead = s.slice(0, start);
  const tail = s.slice(end + 1);
  // LEAD: strip EVERYTHING before the first " or * (whichever comes first) — that's where the roleplay
  // actually begins; anything ahead of it is meta-preamble ("I'll roleplay as … Here is my reply:").
  const stripLead = !!lead.trim();
  // TAIL: only strip trailing text that matches a scaffolding signal (don't eat real closing narration).
  const stripTail = tail.trim() && SCAFFOLD.test(tail);
  if (!stripLead && !stripTail) return text;
  // RESCUE device/media command tags that live in the zones we're about to drop — device control
  // (reinforcePumpControl / processLlmOutput) parses these DOWNSTREAM of this strip, so a [pump on] the
  // model placed in the lead/tail must survive or the pump silently never fires.
  const DEVICE_TAG = /\[\s*(?:pump|vibe|tens)\b[^\]]*\]|\[\s*(?:video|audio|image|img|sound)\s*:[^\]]*\]/gi;
  const rescued = [];
  if (stripLead) rescued.push(...(lead.match(DEVICE_TAG) || []));
  if (stripTail) rescued.push(...(tail.match(DEVICE_TAG) || []));
  let cleaned = ((stripLead ? '' : lead) + s.slice(start, end + 1) + (stripTail ? '' : tail)).trim();
  if (rescued.length) cleaned += '\n' + rescued.join('\n');
  return cleaned || text;
}

// Remove stray [square-bracket] content the model injects (Cydonia loves "[He pauses]" / "[Scene]" /
// "[continues]" stage directions). Device/media command tags ([pump on], [vibe:pulse:3], [Video:...])
// are PRESERVED so device control still fires — it strips them downstream after executing, so they
// never reach the bubble/context anyway. Applied to BOTH the displayed reply and the stored history.
function stripStrayBrackets(text) {
  if (!text) return text;
  text = stripLeakedDirectives(text);
  const PRESERVE = /^\[\s*(?:pump|vibe|tens)\b|^\[\s*(?:video|audio|image|img|sound)\s*:/i;
  return String(text)
    // Multi-line aware: [^\]] (not the newline-excluding [^\]\n]) so the big meta blocks Cydonia wraps
    // across several lines — "[Understood, as Tempest I will stay dominant and...]" — get removed too,
    // not just single-line stage directions. Device tags ([pump on] etc.) are still preserved.
    .replace(/\[[^\]]*\]/g, (m) => PRESERVE.test(m) ? m : '')
    // Also kill an UNTERMINATED meta block: a '[' that opens an acknowledgement and never closes (model
    // kept going / we truncated) — only when it's clearly NOT the start of a device tag.
    .replace(/\[(?!\s*(?:pump|vibe|tens)\b|\s*(?:video|audio|image|img|sound)\s*:)[^\]]*$/i, '')
    // Drop any line that starts with '#' — markdown headers / "# Scene" section labels the model emits.
    .replace(/^[ \t]*#.*(?:\r?\n|$)/gm, '')
    // Drop separator lines that are ONLY dashes ("--" / "---" markdown rules) — inline em-dashes in
    // prose ("she paused -- then smiled") are untouched because those lines still have text.
    .replace(/^[ \t]*-{2,}[ \t]*(?:\r?\n|$)/gm, '')
    // Drop lines that are ONLY asterisks ("*", "**", "***") — stray/orphaned *action* markers with no
    // text on the line. Real "*she smiles*" keeps its text so it never matches.
    .replace(/^[ \t]*\*+[ \t]*(?:\r?\n|$)/gm, '')
    .replace(/[ \t]{2,}/g, ' ')          // collapse the gap a removed tag leaves
    .replace(/[ \t]+([.,!?;:])/g, '$1')  // no space before punctuation
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function handleIndividualResponses(data, activeCharacter, settings, activePersona, orderedIds) {
  const content = data.content;
  // Player message — pushed once, before any individual reply.
  const playerMessage = { id: uuidv4(), content, sender: 'player', timestamp: Date.now() };
  sessionState.chatHistory.push(playerMessage);
  broadcast('chat_message', playerMessage);
  autosaveSession();
  await eventEngine.handleEvent('player_speaks', { content })
    .catch(e => console.error('[Individual] player_speaks failed:', e?.message || e));
  // Resolve a player-keyword Await Input checkpoint gate, same as the blended path.
  await tryResolveAwaitInput(content, 'player').catch(e => console.error('[Individual] awaitInput failed:', e?.message || e));
  // Card-level pump behaviors fire once per player turn, matching the blended path (these are driven by
  // card/checkpoint config, not LLM tags, so they'd otherwise be lost in individual mode).
  await executeAutoPumpPacing(activeCharacter, false).catch(e => console.error('[Individual] autoPumpPacing failed:', e?.message || e));

  // Roll each member's attributes ONCE this turn — buildMultiCharSystemPrompt reads
  // sessionState.multiCharAttributes[memberId] per member. Without this, individual replies use a
  // stale/empty roll (the blended path's rollAttributes is skipped for individual turns).
  try { const ir = rollAttributes(activeCharacter); if (ir?.rolls?.length) broadcast('attribute_rolls', { rolls: ir.rolls, source: 'individual' }); }
  catch (e) { console.error('[Individual] rollAttributes failed:', e?.message || e); }

  // Force the member-name generation primer when there's no player text anchoring the turn:
  // EVERY auto reply, and manual (forceReply) replies with a blank input box. With player text
  // present on a manual send, the model keys off it, so the generic group primer stays.
  const forcePrimer = !data.forceReply || !String(content || '').trim();
  await runIndividualSequence(orderedIds, activeCharacter, settings, activePersona, '', forcePrimer);
}

// Whether any id in the list is a member who can still speak (exists, named, not muted).
function hasSpeakableMember(ids, members, muted) {
  return (ids || []).some(id => { const m = members.find(mm => mm.id === id); return m && m.name && !muted.has(id); });
}

// Generate individual-mode member replies one at a time. When "pause between individual replies" is on,
// hold behind the ">>" Next gate after each member (same UX as consecutive sequential-trigger messages)
// so the player reads each girl's reply before the next generates. Resumable: the remaining member ids +
// last reply are stashed in pendingRangeAwait (kind 'next-individual'), continued by next_gate_advance.
async function runIndividualSequence(orderedIds, activeCharacter, settings, activePersona, prevLastReply, forcePrimer = false) {
  const members = activeCharacter.multiChar?.characters || [];
  const muted = new Set(sessionState.mutedMembers || []);
  const indTokens = clampMaxTokens(Number(activeCharacter.individualResponseTokens) || 150, 150);
  const devices = loadData(DATA_FILES.devices) || [];
  const charLimits = getCharacterLimits(activeCharacter);
  const pauseBetween = settings?.globalCharacterControls?.pauseBetweenIndividualReplies !== false;
  let lastReplyContent = prevLastReply || '';

  const queue = Array.isArray(orderedIds) ? [...orderedIds] : [];
  while (queue.length) {
    if (eventEngine.aborted) break;
    const memberId = queue.shift();
    const member = members.find(m => m.id === memberId);
    if (!member || !member.name || muted.has(memberId)) continue; // muted girls don't speak

    // Per-member response tokens: this member's own value, else the card's Individual Response
    // Tokens, else the global LLM max. (User: "their member response tokens, or global if blank.")
    const memberTokens = clampMaxTokens(
      Number(member.responseTokens) || Number(activeCharacter.individualResponseTokens) || Number(settings.llm?.maxTokens),
      indTokens
    );

    // Full per-turn context, then force a SINGLE-member reply. buildChatContext re-reads the live
    // chatHistory, so each girl after the first sees the earlier individual replies. soloSpeaker makes
    // buildMultiCharSystemPrompt itself constrain the cast to just this member (all others silent).
    sessionState.soloSpeaker = memberId;
    let context;
    try {
      context = buildChatContext(activeCharacter, settings);
    } finally {
      // Clear immediately after building the solo context — soloSpeaker must NOT stay set during
      // generation, device processing, or ai_speaks (nested trigger/flow generations would inherit
      // it and be wrongly constrained to one member), and a throw here must not leave it latched.
      sessionState.soloSpeaker = null;
    }
    const soloSystem = `${context.systemPrompt}\n\n=== INDIVIDUAL RESPONSE (MANDATORY) ===\nRespond ONLY as ${member.name}. Do NOT write, voice, narrate, or speak for any other character — not even briefly. Begin DIRECTLY with the reply — do NOT acknowledge these instructions, announce what you will do, or restate any instruction text. Output a single, in-character reply from ${member.name} alone.\n=== END INDIVIDUAL RESPONSE ===\n`;

    // Speaker-forcing primer: with no player text anchoring the turn (auto replies; blank-input
    // manual replies) the generic '[Characters]:' primer lets the model pick the wrong member.
    // Swap it for 'MemberName:' so the generation IS this member's line, and tell the
    // chat-completions shape the same thing as a final user turn.
    if (forcePrimer && member.name) {
      if (typeof context.prompt === 'string') {
        context.prompt = context.prompt.replace(/\[Characters\]:\s*$/, `${member.name}:`);
      }
      if (Array.isArray(context.messages)) {
        context.messages.push({ role: 'user', content: `[Respond now as ${member.name} — this reply is ${member.name}'s alone.]` });
      }
    }

    // Stop generation if the model tries to start ANOTHER speaker's turn ("\nOther:") — keeps the
    // reply to this member only. Also collect known names to strip any leading label it emits anyway.
    const otherNames = members.filter(m => m.id !== memberId && m.name).map(m => m.name);
    const knownNames = [member.name, ...otherNames, activeCharacter.name, activeCharacter.multiChar?.groupName, activePersona?.displayName].filter(Boolean);
    const stopLabels = [...otherNames, activeCharacter.name, activePersona?.displayName].filter(Boolean).map(n => `\n${n}:`);

    broadcast('generating_start', { characterName: member.name });
    const useStreaming = settings.llm?.streaming === true;
    const memGenSettings = { ...settings.llm, maxTokens: memberTokens, stopSequences: [...(settings.llm?.stopSequences || []), ...stopLabels] };
    // Streaming mode (parity with the blended path): create this member's bubble up-front and stream
    // tokens into it, then finalize with stream_complete. Non-streaming falls back to a single generate.
    let streamMsg = null;
    let result;
    try {
      if (useStreaming) {
        streamMsg = { id: uuidv4(), content: '', sender: 'character', characterId: activeCharacter.id, characterName: member.name, memberId, timestamp: Date.now(), streaming: true };
        sessionState.chatHistory.push(streamMsg);
        broadcast('chat_message', streamMsg);
        result = await llmService.generateStream({
          prompt: context.prompt, messages: context.messages, systemPrompt: soloSystem, settings: memGenSettings,
          onToken: (token, fullText) => { streamMsg.content = fullText; broadcast('stream_token', { messageId: streamMsg.id, token, fullText }); }
        });
      } else {
        result = await llmService.generate({ prompt: context.prompt, messages: context.messages, systemPrompt: soloSystem, settings: memGenSettings });
      }
    } catch (e) {
      console.error(`[Individual] generation failed for ${member.name}:`, e?.message || e);
      if (streamMsg) { sessionState.chatHistory = sessionState.chatHistory.filter(m => m.id !== streamMsg.id); broadcast('message_deleted', { id: streamMsg.id }); }
      broadcast('generating_stop', {});
      continue;
    }
    broadcast('generating_stop', {});
    if (eventEngine.aborted) break;

    let finalText = stripSpeakerPrefixes(substituteAllVariables((result?.text || '').trim()), knownNames);
    const rawForTagDiag = finalText;
    if (settings?.globalCharacterControls?.stripModelScaffolding !== false) finalText = stripModelScaffolding(finalText);
    if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) finalText = stripStrayBrackets(finalText);
    logTagDiag(`individual:${member.name}`, rawForTagDiag, finalText);
    if (!finalText) {
      if (streamMsg) { sessionState.chatHistory = sessionState.chatHistory.filter(m => m.id !== streamMsg.id); broadcast('message_deleted', { id: streamMsg.id }); }
      continue;
    }

    // Drive devices from this girl's reply (pump/vibe/tens tags), same as the normal path.
    try {
      const reinf = aiDeviceControl.reinforcePumpControl(finalText, devices, sessionState, settings, charLimits);
      if (reinf.reinforced) finalText = reinf.text;
      const ctrl = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService, {
        settings, sessionState, broadcast, characterLimits: charLimits, injectContext: () => {},
      });
      if (ctrl.commands?.length) finalText = ctrl.text;
    } catch (e) { console.error('[Individual] device processing failed:', e?.message || e); }

    // Finalize: reuse the streamed placeholder (stream_complete), or create the bubble now (non-streaming).
    finalText = applyPendingReplyWraps(finalText);
    let aiMessage;
    if (streamMsg) {
      streamMsg.content = finalText;
      streamMsg.streaming = false;
      aiMessage = streamMsg;
      broadcast('stream_complete', { messageId: streamMsg.id, content: finalText });
    } else {
      aiMessage = { id: uuidv4(), content: finalText, sender: 'character', characterId: activeCharacter.id, characterName: member.name, memberId, timestamp: Date.now() };
      sessionState.chatHistory.push(aiMessage);
      broadcast('chat_message', aiMessage);
    }
    autosaveSession();
    await eventEngine.handleEvent('ai_speaks', { content: finalText }).catch(() => {});
    lastReplyContent = finalText;

    // Next gate: hold before the NEXT member's reply until the player hits ">>", mirroring the
    // sequential-trigger next gate. Only pause when a reply just landed and a speakable member remains.
    if (pauseBetween && !eventEngine.aborted && hasSpeakableMember(queue, members, muted)) {
      sessionState.pendingRangeAwait = { kind: 'next-individual', rest: queue, characterId: activeCharacter.id, lastReplyContent, forcePrimer };
      broadcast('next_gate', { active: true });
      console.log('[Individual] Next gate — holding before the next member reply; waiting for player >>');
      return;
    }
  }
  sessionState.soloSpeaker = null; // release the solo constraint so the next turn isn't stuck on one member

  // Parity with the blended path: fire ai_speaks trigger TREES and resolve Char/Either Await-Input
  // gates once after the round (individual mode previously fired neither, so ai_speaks-bound trees and
  // checkpoint keyword gates never triggered for group cards in Individual Responses mode).
  if (lastReplyContent) {
    runEventTrees('ai_speaks', { content: lastReplyContent });
    await tryResolveAwaitInput(lastReplyContent, 'char').catch(e => console.error('[Individual] awaitInput(char) failed:', e?.message || e));
  }
}

// Resume a paused individual-response sequence (the stashed remaining member ids), reloading fresh state
// — mirrors resumeTriggerSequence. Continues generating from where the ">>" gate paused.
async function resumeIndividualSequence(pending) {
  if (!pending) return;
  const settings = loadData(DATA_FILES.settings);
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === pending.characterId);
  if (!character) return;
  const persona = (loadAllPersonas() || []).find(p => p.id === settings?.activePersonaId);
  await runIndividualSequence(pending.rest, character, settings, persona, pending.lastReplyContent, !!pending.forcePrimer);
}

async function handleChatMessage(data) {
  const { content, sender = 'player' } = data;
  console.log(`[Chat] Message received. autoReply=${sessionState.autoReply}`);

  // Load settings and personas for speaker validation
  const settings = loadData(DATA_FILES.settings);
  const personas = loadAllPersonas() || [];
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  // A speaker-validation retry re-enters this function only to re-generate the AI reply. Skip every
  // player-turn side effect (message push, events, pump firing) so the retry never duplicates them.
  const isSpeakerRetry = !!data._speakerRetryCount;

  // Instructor pre-reqs configured to start after the first player message
  if (activeCharacter && sender === 'player' && !isSpeakerRetry && isInstructor(activeCharacter)
      && !sessionState.prereqsDone && !sessionState.pendingPrereqs) {
    const aStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
    if (aStory?.prereqTiming === 'after_first_message') {
      startInstructorPrereqs(activeCharacter);
    }
  }

  // Pre-Fill: a player message may advance/branch/exit the gated intro before we generate,
  // so the reply reflects the new step (or the freshly-started pump phase).
  if (activeCharacter && sender === 'player' && !isSpeakerRetry && sessionState.preFillActive) {
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

  // One-off @-mention override: force the NEXT auto-reply to come from ONE named member, for BOTH
  // blended and individual response modes. Does not touch groupRotation (bypasses computeSpeakingOrder);
  // it's inherently one-shot because the client only sends forceMember for a single turn.
  if (sender === 'player'
      && activeCharacter?.multiChar?.enabled
      && data.forceMember
      && !data.suppressReply
      && (sessionState.autoReply || data.forceReply)
      && !sessionState.mediaBlocking
      && !/\[Video:([^\]:]+):blocking\]/i.test(content)) {
    const fm = (activeCharacter.multiChar.characters || []).find(m => m.id === data.forceMember);
    const muted = new Set(sessionState.mutedMembers || []);
    if (fm && fm.name && !muted.has(fm.id)) {
      await handleIndividualResponses(data, activeCharacter, settings, activePersona, [data.forceMember]);
      return;
    }
  }

  // Group card in "Individual Responses" mode: route the normal player turn to round-robin individual
  // replies (each member in their own named bubble) instead of the blended group reply. Respects Auto
  // Reply (or forceReply) and suppressReply, and defers to the blocking-video / mediaBlocking handling
  // below (so it mirrors the blended path's gates). handleIndividualResponses pushes the player message,
  // fires player_speaks, resolves await-input, and drives pump-on-every-reply itself, so we route BEFORE
  // the push below and ALWAYS return once the branch matches (an all-muted turn yields silence, not a
  // fall-through to a blended reply).
  if (sender === 'player'
      && activeCharacter?.multiChar?.enabled
      && activeCharacter.multiChar.responseMode === 'individual'
      && !data.suppressReply
      && (sessionState.autoReply || data.forceReply)
      && !sessionState.mediaBlocking
      && !/\[Video:([^\]:]+):blocking\]/i.test(content)) {
    const muted = new Set(sessionState.mutedMembers || []);
    const orderedIds = computeSpeakingOrder(activeCharacter.multiChar.characters || [], muted, content);
    await handleIndividualResponses(data, activeCharacter, settings, activePersona, orderedIds);
    return;
  }

  // Add to chat history (not on a re-generation retry — the player message is already in history).
  const playerMessage = {
    id: uuidv4(),
    content,
    sender,
    timestamp: Date.now()
  };
  if (!isSpeakerRetry) {
    sessionState.chatHistory.push(playerMessage);
    broadcast('chat_message', playerMessage);
    autosaveSession();
    // player_speaks event bindings: fire on every player message (keyword filter optional —
    // blank keywords = any). Standalone delivery, dispatched before the reply generates.
    await runEventTrees('player_speaks', { content });
  }

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

  // Trigger player speaks event for flow engine (not on a re-generation retry — already fired).
  if (!isSpeakerRetry) {
    await eventEngine.handleEvent('player_speaks', { content });

    // #19 Await Input: if a checkpoint sequence is paused waiting on a keyword and the PLAYER said one
    // of the words (and the gate allows Player / Either), resume the gated triggers.
    await tryResolveAwaitInput(content, 'player');
  }

  // Player Impersonate "Suppress auto reply": the message is sent and player_speaks fires above,
  // but no AI reply is generated.
  if (data.suppressReply) {
    console.log('[Chat] suppressReply set — player message sent, skipping AI response');
    return;
  }

  // Check if auto-reply is enabled (forceReply bypasses it — e.g. a Player Impersonate action that
  // sends AND wants the AI to respond, regardless of the global Auto Reply toggle). An armed
  // every-reply EVENT TRIGGER also bypasses it: the event owns the turn (its tree weaves into or
  // replaces the reply), so Auto Reply off must not silence it.
  if (!sessionState.autoReply && !data.forceReply) {
    if (hasEligibleEveryReplyEvent(activeCharacter)) {
      console.log('[Chat] Auto Reply disabled, but an enabled every-reply event trigger takes precedence — generating');
    } else {
      console.log('[Chat] Auto Reply disabled, skipping AI response');
      return;
    }
  }

  // Check if LLM is configured (either llmUrl for OpenAI/KoboldCPP, or OpenRouter with API key)
  const hasLlmConfig = settings?.llm?.llmUrl ||
    (settings?.llm?.endpointStandard === 'openrouter' && settings?.llm?.openRouterApiKey) ||
      (settings?.llm?.endpointStandard === 'aihorde');

  console.log(`[Chat] activeCharacter=${activeCharacter?.name || 'none'}, hasLlmConfig=${hasLlmConfig ? 'yes' : 'no'}`);

  if (activeCharacter && hasLlmConfig) {
    // Notify UI that AI is generating (group cards show the group name, not the base/Main name)
    broadcast('generating_start', { characterName: groupBubbleName(activeCharacter) || activeCharacter.name });

    // Card-level pump pacing — fire before LLM generates so pump runs during generation.
    // Skip on a speaker-validation retry so the pump never fires twice for one player turn.
    if (!isSpeakerRetry) {
      // Per-range auto-pump pacing (electric instructor ranges)
      await executeAutoPumpPacing(activeCharacter, false);
    }

    try {
      // Roll personality attributes for this message
      const attrResult = rollAttributes(activeCharacter);
      sessionState.activeAttributes = attrResult.active;
      await runReplyScopes(activeCharacter);
      if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'chat' });
      if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply

      // Mark the LLM busy ONLY around the actual generation below (NOT runReplyScopes above, whose
      // event/checkpoint trees may themselves generate and would otherwise deadlock on this flag) so
      // capacity-triggered generations during this reply queue behind it instead of running concurrently.
      llmState.isGenerating = true;

      // Build context
      const context = buildChatContext(activeCharacter, settings, { consumePumpContext: true });

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
          characterName: activeCharacter.name, displayName: groupBubbleName(activeCharacter),
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
        const personas = loadAllPersonas() || [];
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

            // Retry generation (recursive call with retry tracking)
            if (!data._speakerRetryCount || data._speakerRetryCount < 3) {
              console.log(`[Chat/Stream] Retrying generation (attempt ${(data._speakerRetryCount || 0) + 1}/3)`);
              await handleChatMessage({
                ...data,
                _speakerRetryCount: (data._speakerRetryCount || 0) + 1
              });
            } else {
              console.log('[Chat/Stream] Max speaker validation retries reached - giving up');
              // 'generating_end' is not a real event (the UI only handles 'generating_stop'); without
              // this the typing indicator stuck on forever after a give-up.
              broadcast('generating_stop', {});
              broadcast('chat_validation_error', {
                reason: 'AI repeatedly spoke as wrong character',
                message: 'AI generation failed speaker validation after multiple attempts.'
              });
            }
            return; // Exit this generation attempt
          }
        }

        // Broadcast final message state
        aiMessage.content = applyPendingReplyWraps(aiMessage.content);
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
      const personas = loadAllPersonas() || [];
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
          // Keep the anti-role-bleed stop sequences on the retry too (the retry exists precisely to
          // fix wrong-speaker/duplicate output, so dropping the name-guards made it worse).
          settings: { ...settings.llm, ...charTokenOverride(activeCharacter), stopSequences: [...(settings.llm?.stopSequences || []), ...(retryContext.stopSequences || [])] }
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
        finalText = applyPendingReplyWraps(finalText);
        const aiMessage = {
          id: uuidv4(),
          content: finalText,
          sender: 'character',
          characterId: activeCharacter.id,
          characterName: activeCharacter.name, displayName: groupBubbleName(activeCharacter),
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
      runEventTrees('ai_speaks', { content: lastMsg?.content }); // Phase 4: ai_speaks event-bound trees
      // Await Input keyword gate — resolve from the CHARACTER's message (Char / Either gates).
      await tryResolveAwaitInput(lastMsg?.content, 'char');

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
    } finally {
      llmState.isGenerating = false;
    }
  }
}

/**
 * Generate story progression suggestions - player reply options with different emotional angles
 */
async function generateStoryProgressionSuggestions(activeCharacter, settings) {
  return; // Story Progression permanently disabled (feature removed; superseded by checkpoints/triggers).
  // eslint-disable-next-line
  try { // eslint-disable-line
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

  // Notify UI that AI is generating (group cards show the group name)
  broadcast('generating_start', { characterName: groupBubbleName(activeCharacter) || activeCharacter.name });

  try {
    // Roll personality attributes for post-blocking response
    const attrResult = rollAttributes(activeCharacter);
    sessionState.activeAttributes = attrResult.active;
    await runReplyScopes(activeCharacter);
    if (attrResult.rolls.length > 0) broadcast('attribute_rolls', { rolls: attrResult.rolls, source: 'post-block' });
    if (await deliverPendingVerbatimReply()) return; // verbatim injection replaces this reply

    const context = buildChatContext(activeCharacter, settings, { consumePumpContext: true });
    console.log('[Media] Generating AI response after blocking ended...');

    // Match the normal reply path: correct streaming key, real result.text (not the {text} object),
    // stop sequences, cross-role strip, instructor strip, and device-tag execution.
    const useStreaming = settings?.llm?.streaming === true;
    const llmSettings = {
      ...settings.llm,
      ...charTokenOverride(activeCharacter),
      stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
    };
    let finalText = '';
    let streamMsgId = null;

    if (useStreaming) {
      streamMsgId = uuidv4();
      const aiMessage = {
        id: streamMsgId,
        content: '',
        sender: 'character',
        characterId: activeCharacter.id,
        characterName: activeCharacter.name, displayName: groupBubbleName(activeCharacter),
        timestamp: Date.now(),
        streaming: true
      };
      sessionState.chatHistory.push(aiMessage);
      broadcast('chat_message', aiMessage);

      const result = await llmService.generateStream({
        prompt: context.prompt,
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        settings: llmSettings,
        onToken: (token, fullText) => {
          const sm = sessionState.chatHistory.find(m => m.id === streamMsgId);
          if (sm) { sm.content = fullText; broadcast('stream_token', { messageId: streamMsgId, token, fullText }); }
        }
      });
      finalText = result.text;
    } else {
      const result = await llmService.generate({
        prompt: context.prompt,
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        settings: llmSettings
      });
      finalText = result.text;
    }

    // Abort guard — do not activate devices from a now-stale response.
    if (eventEngine.aborted) {
      broadcast('generating_stop', {});
      return;
    }

    // Post-process exactly like the normal reply path.
    finalText = stripCrossRoleContent(finalText, context.stopSequences, true);
    finalText = substituteAllVariables(finalText);
    if (isInstructor(activeCharacter)) finalText = stripInstructorRoleplay(finalText);

    const devices = loadData(DATA_FILES.devices) || [];
    const reinforceResult = aiDeviceControl.reinforcePumpControl(finalText, devices, sessionState, settings, getCharacterLimits(activeCharacter));
    if (reinforceResult.reinforced) finalText = reinforceResult.text;
    const aiControlResult = await aiDeviceControl.processLlmOutput(finalText, devices, deviceService, {
      settings,
      sessionState,
      broadcast,
      characterLimits: getCharacterLimits(activeCharacter),
      injectContext: (text) => {
        const lastAiMsg = sessionState.chatHistory.filter(m => m.sender === 'character').pop();
        if (lastAiMsg) lastAiMsg.content += ` ${text}`;
      }
    });
    if (aiControlResult.commands.length > 0) {
      finalText = aiControlResult.text;
      aiControlResult.results.forEach(r => {
        if (r.success) broadcast('ai_device_control', { device: r.command.device, action: r.command.action, deviceName: r.device?.label || r.device?.name || r.command.device });
      });
    }

    finalText = applyPendingReplyWraps(finalText);
    if (useStreaming) {
      const sm = sessionState.chatHistory.find(m => m.id === streamMsgId);
      if (sm) { sm.content = finalText; sm.streaming = false; broadcast('stream_complete', { messageId: streamMsgId, content: finalText }); }
    } else {
      const aiMessage = {
        id: uuidv4(),
        content: finalText,
        sender: 'character',
        characterId: activeCharacter.id,
        characterName: activeCharacter.name, displayName: groupBubbleName(activeCharacter),
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
    runEventTrees('ai_speaks', { content: lastMsg?.content }); // Phase 4: ai_speaks event-bound trees
    // Await Input keyword gate — resolve from the CHARACTER's message (Char / Either gates).
    await tryResolveAwaitInput(lastMsg?.content, 'char');

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

  // Guided Response can target ONE group member (data.memberId) in Individual-Responses mode: reply
  // as that member alone (own name/tokens + a solo directive), not the blended group.
  const smTarget = (data.memberId && activeCharacter?.multiChar?.enabled)
    ? (activeCharacter.multiChar.characters || []).find(m => m.id === data.memberId)
    : null;
  const smBubbleName = smTarget?.name || activeCharacter.name;
  const smDisplayName = smTarget ? null : groupBubbleName(activeCharacter);
  const smSolo = smTarget
    ? `\n\n=== INDIVIDUAL RESPONSE (MANDATORY) ===\nRespond ONLY as ${smTarget.name}. Do NOT write, voice, narrate, or speak for any other character — not even briefly. Begin DIRECTLY with the reply — do NOT acknowledge these instructions, announce what you will do, or restate any instruction text. Output a single, in-character reply from ${smTarget.name} alone.\n=== END INDIVIDUAL RESPONSE ===\n`
    : '';
  const smTokens = smTarget
    ? clampMaxTokens(Number(smTarget.responseTokens) || Number(activeCharacter.individualResponseTokens) || Number(settings.llm?.maxTokens), clampMaxTokens(Number(activeCharacter.individualResponseTokens) || 150, 150))
    : null;

  // Determine who is generating based on mode
  const isPlayerVoice = mode === 'impersonate' || mode === 'guided_impersonate';
  const generatingFor = isPlayerVoice ? (activePersona?.displayName || 'Player') : smBubbleName;

  // Notify UI that we're generating
  broadcast('generating_start', { characterName: generatingFor, isPlayerVoice });

  // Per-range auto-pump pacing — fire before LLM generates
  if (!isPlayerVoice) {
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
      if (smTarget) sessionState.soloSpeaker = smTarget.id; // constrain the group prompt to this member
      try {
        context = applyCharacterGuidance(
          buildChatContext(activeCharacter, settings),
          activeCharacter,
          guidedText
        );
      } finally {
        sessionState.soloSpeaker = null; // throw-safe (audit H5)
      }
      if (smSolo) context.systemPrompt = (context.systemPrompt || '') + smSolo; // single-member guided reply
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
        characterName: isPlayerVoice ? null : smBubbleName,
        displayName: isPlayerVoice ? undefined : smDisplayName,
        memberId: smTarget?.id,
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
          ...(smTokens ? { maxTokens: smTokens } : {}),
          stopSequences: [...(settings.llm?.stopSequences || []), ...(context.stopSequences || [])]
        },
        onToken: (token, fullText) => {
          message.content = fullText;
          broadcast('stream_token', { messageId: message.id, token, fullText });
        }
      });

      finalText = stripCrossRoleContent(result.text, context.stopSequences, !isPlayerVoice);
      if (!isPlayerVoice && isInstructor(activeCharacter)) finalText = stripInstructorRoleplay(finalText);
      // Guided replies echo directives like every other reply — run the standard cleaner chain,
      // BEFORE device processing (an echoed device-instruction example must never fire the pump).
      // This was the ONE reply route that skipped it: the real in-session leaks ('[Understood.
      // I will write ONLY as X…]' preambles, verbatim state-preface echoes) both came from here.
      finalText = stripLeakedDirectives(finalText);
      if (!isPlayerVoice) {
        if (!isInstructor(activeCharacter) && settings?.globalCharacterControls?.stripModelScaffolding !== false) finalText = stripModelScaffolding(finalText);
        if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) finalText = stripStrayBrackets(finalText);
      }
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
      message.content = applyPendingReplyWraps(message.content);

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
          ...(smTokens ? { maxTokens: smTokens } : {}),
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
        if (smTarget) sessionState.soloSpeaker = smTarget.id;
        try {
          retryContext = applyCharacterGuidance(
            buildChatContext(activeCharacter, settings),
            activeCharacter,
            guidedText
          );
        } finally {
          sessionState.soloSpeaker = null; // throw-safe (audit H5)
        }
        if (smSolo) retryContext.systemPrompt = (retryContext.systemPrompt || '') + smSolo;
      }
      retryContext.systemPrompt += '\n\nIMPORTANT: Write a UNIQUE response. Do not repeat previous messages.';

      const retryResult = await llmService.generate({
        prompt: retryContext.prompt,
        messages: retryContext.messages,
        systemPrompt: retryContext.systemPrompt,
        settings: {
          ...settings.llm,
          ...(smTokens ? { maxTokens: smTokens } : {}),
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

    // Strip cross-role bleed and (for instructor cards) roleplay prose, then substitute.
    finalText = stripCrossRoleContent(finalText, context.stopSequences, !isPlayerVoice);
    if (!isPlayerVoice && isInstructor(activeCharacter)) finalText = stripInstructorRoleplay(finalText);
    // Same cleaner chain as the streaming branch (and every other reply path) — see note there.
    finalText = stripLeakedDirectives(finalText);
    if (!isPlayerVoice) {
      if (!isInstructor(activeCharacter) && settings?.globalCharacterControls?.stripModelScaffolding !== false) finalText = stripModelScaffolding(finalText);
      if (settings?.globalCharacterControls?.stripBracketsFromReplies !== false) finalText = stripStrayBrackets(finalText);
    }
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
      characterName: isPlayerVoice ? null : smBubbleName,
      displayName: isPlayerVoice ? undefined : smDisplayName,
      memberId: smTarget?.id,
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
  // Resolve {{user}}/{{char}}/[Player]/[Char] in card + persona prose (prompt text — no token rules).
  const sub = (t) => substituteAllVariables(t || '', { playerName, characterName: character.name, isPromptText: true });

  // Minimal system prompt - just character identity and current state
  let systemPrompt = isPlayerVoice
    ? `You are writing as ${playerName}, a player character.\n`
    : `You are ${character.name}. ${sub(character.description)}\n`;

  systemPrompt += `\nPersonality: ${isPlayerVoice ? (sub(persona?.personality) || 'a willing participant') : sub(character.personality)}\n`;

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
  const sub = (t) => substituteAllVariables(t || '', { playerName, characterName: character.name, isPromptText: true });

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
  submissive: 'Yield and defer. Be eager to please, obedient, and responsive to direction rather than leading the scene.',
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
    const TRAIT_KEYS = ['dominant', 'submissive', 'sadistic', 'psychopathic', 'sensual', 'sexual'];
    for (const m of (character.multiChar.characters || [])) {
      // Fall back to the shared card attributes unless this member has a NON-ZERO trait chance of its
      // own. (memberAttributes[id] also holds dispositions/zeroed sliders, so Object.keys length would
      // wrongly defeat the fallback the moment any disposition is set.)
      const ma = memberAttrs[m.id];
      const hasOwnTrait = ma && TRAIT_KEYS.some(k => Number(ma[k]) > 0);
      const attrs = hasOwnTrait ? ma : fallback;
      const active = [];
      for (const trait of TRAIT_KEYS) {
        const chance = Number(attrs[trait]) || 0;
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
  const mm = character?.multiChar?.characters || [];
  const isGroup = !!character?.multiChar?.enabled && mm.length > 1;

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

  const bellyDescFor = (cap) => cap <= 5 ? 'normal-looking — inflation has just barely started'
    : cap <= 15 ? 'mostly flat with a very faint hint of fullness'
    : cap <= 30 ? 'slightly bloated, subtly rounder than normal'
    : cap <= 50 ? 'noticeably rounded and swollen'
    : cap <= 70 ? 'very swollen, visibly inflated and taut'
    : cap <= 85 ? 'hugely distended, skin tight and shiny'
    : cap <= 95 ? 'enormous, about to burst, straining at the absolute limit'
    : 'impossibly over-inflated, about to pop';

  const bellyFeelFor = (cap) => cap <= 5 ? 'barely aware of anything'
    : cap <= 15 ? 'a faint warmth and subtle pressure'
    : cap <= 30 ? 'mild fullness and growing pressure'
    : cap <= 50 ? 'persistent tightness and real pressure'
    : cap <= 70 ? 'intense pressure, hard to ignore'
    : cap <= 85 ? 'overwhelming tightness, real pain'
    : cap <= 95 ? 'pure agony, feeling like they could burst any second'
    : 'beyond agony, seconds from popping';

  // EVERY valid pumpable body gets its state EVERY reply — single card → the card-level flag
  // (characterCapacity); group → every member flagged isPumpable (the base member rides
  // characterCapacity, the rest ride memberCapacities). 0% bodies are stated flat explicitly,
  // so the model never invents a size for an unmentioned member.
  const bodies = isGroup
    ? mm.filter(m => m?.isPumpable && m?.name).map(m => ({
        name: m.name,
        cap: Math.round(m.id === mm[0].id ? charCap : (sessionState.memberCapacities?.[m.id] ?? 0))
      }))
    : (character?.isPumpable ? [{ name: charName, cap: Math.round(charCap) }] : []);

  let preface = `[Current physical reality — use this, not your imagination:\n`;
  preface += `${playerName}'s belly (${playerCap}%) is ${playerDesc}. ${playerName} feels ${playerFeeling}.\n`;

  for (const b of bodies) {
    if (b.cap > 0) {
      preface += `${b.name}'s belly (${b.cap}%) is ${bellyDescFor(b.cap)}. ${b.name} feels ${bellyFeelFor(b.cap)}.\n`;
      preface += `${playerName} can see that ${b.name}'s belly looks ${bellyDescFor(b.cap)}.\n`;
    } else {
      preface += `${b.name}'s belly is completely flat and normal — not inflated at all.\n`;
    }
  }
  const inflatedBodies = bodies.filter(b => b.cap > 0);
  if (inflatedBodies.length || playerCap > 0) {
    preface += `${charName} can see that ${playerName}'s belly looks ${playerDesc}.\n`;
  }

  // HARD failsafe — the size/sensation lines above only STATE reality; this FORBIDS escalation.
  // Without it, an aggressive card (maxed attributes, an "obsessed" inflator, "pump to the limit",
  // an author's note to "drive the plot forward / avoid positivity bias") narrates a belly far ahead
  // of the gauge — the model plays the character's goal instead of the current number. Injected at
  // depth-0 (right before the primer), so it's the last thing the model reads before generating.
  const guarded = [playerName, ...inflatedBodies.map(b => b.name)];
  preface += `This is the ONLY size and sensation that exists right now — describe exactly this and nothing further. Do NOT depict ${guarded.join(' or ')} as bigger, fuller, rounder, or further along than the percentage stated above, no matter what any character wants, intends, or is "eager" to do. The belly grows ONLY as the number rises, never in narration or imagination. If you state a number, use ONLY the exact percentage above.\n`;
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

// PUMP-READY prompt steering: tell the LLM exactly who is connected to a pump and may be described
// being inflated. Persona/character/members are gated by the live per-session sessionState.pumpReady.
// PUMP-READY session defaults: persona ON; a single pumpable character is pump-connected by default
// (that's the card's purpose); group members default OFF (enabled manually to disambiguate targets).
function pumpReadyDefaults() {
  try {
    const s = loadData(DATA_FILES.settings) || {};
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const ch = chars.find(c => c.id === s.activeCharacterId);
    return { persona: true, character: !!(ch?.isPumpable && !ch?.multiChar?.enabled), members: {} };
  } catch (e) { return { persona: true, character: false, members: {} }; }
}

function buildPumpReadyDirective(character, activePersona) {
  const pr = sessionState.pumpReady || { persona: true, character: false, members: {} };
  const names = [];
  // Persona pump-eligibility is independent of persona SELECTION (default ON), so fall back to a
  // generic label when no persona is chosen.
  if (pr.persona) names.push(activePersona?.displayName || 'the player');
  if (character?.multiChar?.enabled) {
    for (const m of (character.multiChar.characters || [])) {
      if (m?.name && pr.members?.[m.id]) names.push(m.name);
    }
  } else if (character?.name && (pr.character || (sessionState.characterCapacity || 0) > 0)) {
    // Single character: pump-ready, OR actively inflating (capacity > 0) so we never contradict a
    // character-capacity checkpoint stage direction telling the model to describe their inflation.
    names.push(character.name);
  }
  if (!names.length) {
    return `\n=== PUMP CONNECTIONS (WHO MAY BE INFLATED) ===\nNo one is currently connected to a pump. Do NOT describe anyone being inflated, pumped, growing, or filled with air.\n=== END PUMP CONNECTIONS ===\n`;
  }
  return `\n=== PUMP CONNECTIONS (WHO MAY BE INFLATED) ===\nOnly the following are connected to a pump and may be described being inflated, pumped, or growing: ${names.join(', ')}.\nDo NOT describe pumping, inflating, or filling anyone who is not on this list — they have no pump connected and their bodies do not change.\n=== END PUMP CONNECTIONS ===\n`;
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
  if (!checkpointsEnabledFor(character)) return null; // Enable Checkpoints off → no character stage directions
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
function deliverTreeMsg(text, llmEnhance, wraps) {
  const t = (text || '').trim();
  // Verbatim wraps (prepend/append) in-reply: a verbatim message carries them inline; an
  // enhanced one queues them onto pendingReplyWraps so the turn's FINAL reply gets framed.
  // (They used to be silently dropped in-reply — the standalone path always honored them.)
  const pre = wraps?.prependVerbatim && String(wraps.prependText || '').trim() !== '' ? substituteAllVariables(wraps.prependText) : null;
  const app = wraps?.appendVerbatim && String(wraps.appendText || '').trim() !== '' ? substituteAllVariables(wraps.appendText) : null;
  if (llmEnhance === false) {
    const whole = [pre, t, app].filter(Boolean).join('\n');
    if (!whole) return;
    sessionState.pendingVerbatimReply = sessionState.pendingVerbatimReply ? `${sessionState.pendingVerbatimReply}\n${whole}` : whole;
    return;
  }
  if (t) sessionState.activeCheckpointInjections.push(t);
  if (pre || app) {
    const w = sessionState.pendingReplyWraps = sessionState.pendingReplyWraps || { pre: [], app: [] };
    if (pre) w.pre.push(pre);
    if (app) w.app.push(app);
  }
}

// Consume the turn's queued reply wraps (in-reply ai_message prepend/append verbatim) around the
// final generated reply text. One-shot: clears the slot. No-op when nothing queued.
function applyPendingReplyWraps(text) {
  const w = sessionState.pendingReplyWraps;
  if (!w || (!w.pre.length && !w.app.length)) return text;
  sessionState.pendingReplyWraps = null;
  let out = text ?? '';
  if (w.pre.length) out = `${w.pre.join('\n')}\n${out}`;
  if (w.app.length) out = `${out}\n${w.app.join('\n')}`;
  return out;
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
  // Scope tree-refs (sessionStart/intro/alwaysOn/events) come from the active checkpoint profile;
  // the per-range trees (.ranges) come from that profile's active Range Set.
  const profile = getActiveCheckpointProfile(character);
  const tr = profile?.treeRefs || {};
  return { ...tr, ranges: getActiveProfileRangeTreeRefs(profile) };
}

// Per-turn index of the global tree library (id -> Tree). Built ONCE per turn in runReplyScopes
// and threaded via ctx so {treeId} scope refs and fire_tree hops resolve without re-reading disk.
function buildTreeIndex(character) {
  const m = new Map();
  for (const t of (loadTriggerTrees().trees || [])) m.set(t.id, t);
  // Card-baked trees (character.treeLibrary — closure deps captured by the editor's fork-to-card)
  // overlay the global library, so a forked button/scope tree's fire_tree hops resolve on any
  // install the card lands on. Fork-time ids are freshly minted, so collisions don't arise; on a
  // tie the card's copy wins, which is what "the character's version of the tree" means.
  for (const t of (character?.treeLibrary || [])) if (t?.id && Array.isArray(t.nodes)) m.set(t.id, t);
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

// ============================================
// Event-Trigger layer (Phase 3 of Flow→Trigger migration)
// ============================================
//
// The thing that replaces a flow's trigger node. Each card stores event bindings at
// resolveScopeRefs(character).events = [{ id, event, filter, ref }]:
//   event  ∈ {device_on, device_off, player_state_change, char_state_change, idle, random}
//   filter = { deviceId } | { stateType, operator, value, fireOnce } | { idleSeconds } | { probability }
//            (any binding may also carry { cooldown } = min messages between fires)
//   ref    = the usual {inline}|{treeId} tree ref
// A binding fires its tree via runTreeScope with scopeKey `event:<id>` (so `once` nodes are
// stable per-binding). device/state/idle fire 'standalone'; random weaves 'inReply'.

// Resolve the active character + settings for a push-style (async) event dispatch.
function getActiveCharacterAndSettings() {
  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === settings?.activeCharacterId) || null;
  return { character, settings };
}

// Numeric comparison for state-change thresholds. Unknown operator => false (never fire).
function compareEventOp(actual, operator, target) {
  const a = Number(actual), t = Number(target);
  if (Number.isNaN(a) || Number.isNaN(t)) return false;
  switch (operator) {
    case '>': return a > t;
    case '>=': return a >= t;
    case '<': return a < t;
    case '<=': return a <= t;
    case '==': return a === t;
    case '!=': return a !== t;
    default: return false;
  }
}

// "Enable prose pump guidance after Intro" resolver — reads the ACTIVE PROFILE's treeRefs first
// (where the Intro section now lives/writes), falling back to the legacy story-level flag for old
// cards. Default ON (only an explicit false opts out). The story-level read alone was orphaned:
// the UI checkbox moved to per-profile treeRefs, so the opt-out silently never applied.
function prosePumpAfterIntroOff(character, story) {
  const profRefs = character ? resolveScopeRefs(character) : {};
  const v = (profRefs?.introEnableProsePumpAfter !== undefined)
    ? profRefs.introEnableProsePumpAfter
    : story?.treeRefs?.introEnableProsePumpAfter;
  return v === false;
}

// Per-session event-trigger runtime: fireOnce latches + message-cooldown stamps + idle latches.
// Reset alongside firedTreeNodes (session/chat clear, new_session) via resetEventTriggerState.
function resetEventTriggerState() {
  sessionState.eventLatch = {};    // bindingId -> true while a fireOnce condition stays true
  sessionState.eventCooldown = {}; // bindingId -> eventEngine.messageCount at last fire
  sessionState.idleFired = {};     // bindingId -> the lastActivity stamp it last fired against
  sessionState.priorityFired = {}; // bindingId -> true once a priority binding has fired (then steps aside)
}
resetEventTriggerState();

// Does a binding's filter match this event payload? Has the side effect of maintaining the
// fireOnce latch for state-change bindings (arms on condition-false, blocks while true).
function eventBindingMatches(b, eventType, data) {
  const f = b.filter || {};
  switch (eventType) {
    case 'device_on':
    case 'device_off': {
      if (!f.deviceId) return true; // blank = any device
      const ids = [data.ip, data.device?.ip, data.device?.deviceId, data.device?.id].filter(Boolean);
      return ids.includes(f.deviceId);
    }
    case 'player_state_change':
    case 'char_state_change': {
      if (f.stateType && data.stateType !== f.stateType) return false;
      const cond = compareEventOp(data.newValue, f.operator || '>=', f.value);
      if (!cond) { if (f.fireOnce) delete sessionState.eventLatch[b.id]; return false; }
      if (f.fireOnce) {
        if (sessionState.eventLatch[b.id]) return false; // already fired during this true-period
        sessionState.eventLatch[b.id] = true;            // latch until the condition flips false
      }
      return true;
    }
    case 'ai_speaks': {
      const kw = (f.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!kw.length) return true; // any AI message
      const text = data.content || latestAiText();
      return reminderEngine._matchKeys(
        { keys: kw, secondaryKeys: [], caseSensitive: !!f.caseSensitive, matchWholeWords: f.matchWholeWords !== false, logic: 'and_any' },
        text);
    }
    case 'player_speaks': {
      const kw = (f.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!kw.length) return true; // no keywords = fires on ANY player message
      const text = data.content || latestPlayerText();
      return reminderEngine._matchKeys(
        { keys: kw, secondaryKeys: [], caseSensitive: !!f.caseSensitive, matchWholeWords: f.matchWholeWords !== false, logic: 'and_any' },
        text);
    }
    case 'minigame_miss': // any miss in any tree-called minigame (no filter yet)
      return true;
    case 'idle':   // gated by the idle timer (per-binding idleSeconds)
    case 'random': // gated by the per-reply probability roll
      return true;
    default: return false;
  }
}

// Optional per-binding message cooldown (mirrors the flow player_speaks cooldown): suppress if
// the binding fired within `cooldown` messages. Message count is the flow engine's shared counter.
function eventBindingCooldownOk(b) {
  const cd = Number(b.filter?.cooldown) || 0;
  if (cd <= 0) return true;
  const last = sessionState.eventCooldown[b.id];
  if (last === undefined) return true;
  return (eventEngine.messageCount || 0) - last >= cd;
}

// Effective enabled state for a binding: session Event Trigger Toggle overrides (by name, then
// All) win over the card's own enabled tickbox (default ON when unset).
function eventBindingEnabled(b) {
  const ov = sessionState.eventTriggerOverrides;
  if (ov) {
    if (b.name && ov.byName && ov.byName[b.name]) return ov.byName[b.name] === 'on';
    if (ov.all) return ov.all === 'on';
  }
  return b.enabled !== false;
}

// Run one event binding's tree. Stamps the cooldown clock at fire time.
async function fireEventBinding(b, character, settings, treeIndex, delivery) {
  if (!checkpointsEnabledFor(character)) return; // Enable Checkpoints off → no event bindings (incl. idle)
  // Event triggers are IGNORED while session start is still running (incl. a suspended chain) and
  // during the gated intro/pre-fill (user ruling) — and per-binding enabled/toggles apply.
  if (sessionState.sessionStartActive || sessionState.pendingIntroStart || sessionState.introActive || sessionState.preFillActive) return;
  if (!eventBindingEnabled(b)) return;
  if (!checkpointGroupEnabled('events', null, character)) return; // Events group toggled off (card default or Checkpoint Control) — single choke point for push/idle/every-reply/random dispatch
  const tree = resolveRefTree(b.ref, treeIndex);
  if (!tree) return;
  sessionState.eventCooldown[b.id] = eventEngine.messageCount || 0;
  tlRecord('event', { event: b.event, tree: tree.name || b.ref?.treeId || 'inline' });
  await runTreeScope(tree, `event:${b.id}`, character, settings, { delivery: delivery || 'standalone', treeIndex });
}

// Push-style dispatch for discrete events (device_on/off, player/char_state_change). Resolves the
// active card's bindings, filters by payload + cooldown, and runs each match. Never throws.
async function runEventTrees(eventType, eventData = {}, opts = {}) {
  try {
    if (sessionState.introActive || sessionState.preFillActive) return; // gated intro blocks event triggers
    const ctx = opts.character ? opts : getActiveCharacterAndSettings();
    const character = ctx.character, settings = ctx.settings;
    if (!character) return;
    if (!checkpointsEnabledFor(character)) return; // Enable Checkpoints off → no event triggers
    const bindings = (resolveScopeRefs(character).events || []).filter(b => b && b.event === eventType);
    if (!bindings.length) return;
    const treeIndex = opts.treeIndex || buildTreeIndex(character);
    const delivery = opts.delivery || 'standalone';

    // Priority pass: a binding marked "priority" fires FIRST and, while still eligible, wins the
    // turn — suppressing the other matching bindings so they don't also fire. A priority binding is
    // one-shot: once it fires it latches (priorityFired) and permanently steps aside, letting the
    // conflicting non-priority binding(s) take over on later matches. (Cooldown/match are checked in
    // order, so a suppressed binding is never match-tested — its fireOnce latch stays untouched.)
    let priorityFiredThisTurn = false;
    for (const b of bindings) {
      if (!b.priority || sessionState.priorityFired?.[b.id]) continue; // not priority, or already spent
      try {
        if (!eventBindingEnabled(b)) continue;
        if (!eventBindingCooldownOk(b)) continue;
        if (!eventBindingMatches(b, eventType, eventData)) continue;
        sessionState.priorityFired[b.id] = true; // spent — steps aside on future matches
        await fireEventBinding(b, character, settings, treeIndex, delivery);
        priorityFiredThisTurn = true;
      } catch (e) { console.error(`[runEventTrees] priority binding ${b?.id} (${eventType}) failed:`, e?.message || e); }
    }
    // A priority binding fired → it owns this turn; skip the rest.
    if (priorityFiredThisTurn) return;

    for (const b of bindings) {
      if (b.priority) continue; // handled (or suppressed) above
      try {
        // Cooldown first: it's read-only, so checking it before eventBindingMatches (which mutates
        // the fireOnce latch) avoids latching a binding we then suppress.
        if (!eventBindingEnabled(b)) continue;
        if (!eventBindingCooldownOk(b)) continue;
        if (!eventBindingMatches(b, eventType, eventData)) continue;
        await fireEventBinding(b, character, settings, treeIndex, delivery);
      } catch (e) { console.error(`[runEventTrees] binding ${b?.id} (${eventType}) failed:`, e?.message || e); }
    }
  } catch (e) { console.error(`[runEventTrees] ${eventType} dispatch failed:`, e?.message || e); }
}

// Per-reply random event bindings: roll each one's probability and weave a hit IN-REPLY. Called
// from runReplyScopes (after always-on) so a hit composes into the same turn like other scopes.
async function runRandomEventTrees(character, settings, treeIndex) {
  const bindings = (resolveScopeRefs(character).events || []).filter(b => b && b.event === 'random');
  for (const b of bindings) {
    try {
      const p = Number(b.filter?.probability) || 0;
      if (!(p > 0) || Math.random() * 100 >= p) continue;
      if (!eventBindingCooldownOk(b)) continue;
      await fireEventBinding(b, character, settings, treeIndex, 'inReply');
    } catch (e) { console.error(`[runRandomEventTrees] binding ${b?.id} failed:`, e?.message || e); }
  }
}

// Would an every_reply event binding fire on this turn? Mirrors the fireEventBinding gates
// (checkpoints master, session-start/intro silence, events group, enabled/override, cooldown,
// resolvable tree). Used by the Auto Reply gate: an armed every-reply event trigger takes
// precedence over Auto Reply being off — the turn still generates so the event can deliver.
function hasEligibleEveryReplyEvent(character) {
  if (!character || !checkpointsEnabledFor(character)) return false;
  if (sessionState.sessionStartActive || sessionState.pendingIntroStart || sessionState.introActive || sessionState.preFillActive) return false;
  if (!checkpointGroupEnabled('events', null, character)) return false;
  const bindings = (resolveScopeRefs(character).events || []).filter(b => b && b.event === 'every_reply');
  if (!bindings.length) return false;
  const treeIndex = buildTreeIndex(character);
  return bindings.some(b => eventBindingEnabled(b) && eventBindingCooldownOk(b) && resolveRefTree(b.ref, treeIndex));
}

// every_reply event bindings — the Always-On replacement. Fire each one's tree IN-REPLY every
// reply, unconditionally (no filter). Called from runReplyScopes alongside always-on/random.
async function runEveryReplyEventTrees(character, settings, treeIndex) {
  const bindings = (resolveScopeRefs(character).events || []).filter(b => b && b.event === 'every_reply');
  for (const b of bindings) {
    try { await fireEventBinding(b, character, settings, treeIndex, 'inReply'); }
    catch (e) { console.error(`[runEveryReplyEventTrees] binding ${b?.id} failed:`, e?.message || e); }
  }
}

// Server-side idle timer for idle event bindings (mirrors the dormant eventEngine.idleTimer but
// is independent of active flows). Fires each idle binding once per idle period: it latches on
// the current lastActivity stamp and re-arms when lastActivity advances (i.e. on new activity).
let treeIdleTimer = null;
function startTreeIdleCheck() {
  if (treeIdleTimer) clearInterval(treeIdleTimer);
  treeIdleTimer = setInterval(() => {
    try {
      const { character, settings } = getActiveCharacterAndSettings();
      if (!character) return;
      const bindings = (resolveScopeRefs(character).events || []).filter(b => b && b.event === 'idle');
      if (!bindings.length) return;
      const lastActivity = eventEngine.lastActivity || 0;
      const idleSec = (Date.now() - lastActivity) / 1000;
      const treeIndex = buildTreeIndex(character);
      for (const b of bindings) {
        const threshold = Number(b.filter?.idleSeconds) || 300;
        if (idleSec < threshold) continue;
        if (sessionState.idleFired[b.id] === lastActivity) continue; // already fired this idle period
        if (!eventBindingCooldownOk(b)) continue;
        sessionState.idleFired[b.id] = lastActivity;
        Promise.resolve(fireEventBinding(b, character, settings, treeIndex, 'standalone'))
          .catch(e => console.error(`[treeIdle] binding ${b?.id} failed:`, e?.message || e));
      }
    } catch (e) { console.error('[treeIdle] tick failed:', e?.message || e); }
  }, 5000);
}

// Run the Always-On tree scope(s) IN-REPLY every reply (recurring ambient guidance/triggers),
// composed after the range trees. alwaysOn may be a SINGLE ref (legacy) OR an ARRAY of refs
// (multi-trigger). Each array entry runs under a distinct scopeKey (alwaysOn:i) so their "once"
// nodes don't collide. Resolves inline OR {treeId} library refs.
async function runActiveAlwaysOn(character, settings, treeIndex) {
  const refs = resolveScopeRefs(character).alwaysOn;
  const list = Array.isArray(refs) ? refs : (refs ? [refs] : []);
  for (let i = 0; i < list.length; i++) {
    const tree = resolveRefTree(list[i], treeIndex);
    if (!tree) continue;
    const scopeKey = (Array.isArray(refs) && list.length > 1) ? `alwaysOn:${i}` : 'alwaysOn';
    await runTreeScope(tree, scopeKey, character, settings, { delivery: 'inReply', treeIndex });
  }
}

// Run the active Capacity-Range tree scope(s) IN-REPLY (woven/verbatim into this turn).
// Carry-over matches the legacy roll (nearest DEFINING range <= current capacity; a defining
// ref = an inline OR {treeId} ref resolving to a non-empty tree). Player axis always; char axis
// only for pumpable non-instructors.
async function runActiveRangeTrees(character, settings, treeIndex, opts = {}) {
  if (!character) return;
  const ORDER = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '100+'];
  const refs = resolveScopeRefs(character).ranges || {};

  const runAxis = async (prefix, capacity) => {
    // STRICT range binding (carry-over removed 2026-07-29): a range tree fires ONLY while the
    // gauge is inside its own band. Trees take ACTIONS (pumps, messages, gotos) — inheriting the
    // nearest lower tree into empty higher ranges re-fired a 0-10% tree at 11-20%. Checkpoint
    // THEMES keep their carry-over (guidance persisting is a different contract).
    const key = capacityToRangeKey(capacity || 0);
    if (!ORDER.includes(key)) return;
    if (!checkpointGroupEnabled('range', key, character)) return; // group off → silent band
    const tree = resolveRefTree(refs[`${prefix}-${key}`], treeIndex);
    if (!tree) return; // no tree authored for THIS range — nothing inherits
    await runTreeScope(tree, `range:${prefix}:${key}`, character, settings, { delivery: opts.delivery || 'inReply', treeIndex });
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
  sessionState.pendingReplyWraps = null; // stale in-reply wraps must never frame a later reply
  sessionState.suppressReplyThisTurn = false; // stale suppression must never eat a later reply
  if (!character) return;
  const settings = loadData(DATA_FILES.settings) || {};
  try { await checkPendingTreeResume(); } // tick any deferred pause_resume before this turn's scopes
  catch (e) { console.error('[runReplyScopes] tree resume failed:', e?.message || e); }
  await reassertLatchedPump(); // keep a latched pump ON every reply until [pump off]
  const treeIndex = buildTreeIndex(character); // one library read per turn; threaded into every scope/fire_tree hop
  // Gated intro (Part 4): while active it OWNS the turn — run only the intro tree and block every
  // other scope/event/button until an end_intro action opens the gate.
  if (sessionState.introActive) {
    // Suspended on a player_choice or ">>" next-gate: the continuation is stashed and resumes on the
    // player's pick / >> press. Do NOT restart the intro tree from the top — that re-fires its
    // messages and re-arms the choice AHEAD of the (non-blocking, in-reply) generations, which is the
    // out-of-order "choice popped first" bug. (Group Individual mode never hits runReplyScopes, so it
    // only ran the intro once at session start — that's why it appeared to work there.)
    if (sessionState.pendingTreeChoice || sessionState.pendingTreeNext) return;
    try { await runIntroScope(character, settings, treeIndex); }
    catch (e) { console.error('[runReplyScopes] intro failed:', e?.message || e); }
    return;
  }
  // Enable Checkpoints off → skip ALL checkpoint scopes (range trees, always-on, every-reply, random
  // events). The latched-pump reassert above is device safety, not a checkpoint, so it stays.
  if (!checkpointsEnabledFor(character)) return;
  rollCheckpointRandomTriggers(character); // legacy producer (sync; no longer self-resets)
  try { await runActiveRangeTrees(character, settings, treeIndex); }
  catch (e) { console.error('[runReplyScopes] range trees failed:', e?.message || e); }
  if (sessionState.pendingTreeChoice) return; // a player_choice suspended the turn — stop further scopes
  try { await runActiveAlwaysOn(character, settings, treeIndex); } // legacy alwaysOn refs (back-compat)
  catch (e) { console.error('[runReplyScopes] always-on failed:', e?.message || e); }
  if (sessionState.pendingTreeChoice) return;
  try { await runEveryReplyEventTrees(character, settings, treeIndex); } // every_reply event bindings (Always-On replacement)
  catch (e) { console.error('[runReplyScopes] every-reply events failed:', e?.message || e); }
  if (sessionState.pendingTreeChoice) return; // always-on may have suspended — don't roll random events
  try { await runRandomEventTrees(character, settings, treeIndex); } // Phase 3: per-reply random event bindings
  catch (e) { console.error('[runReplyScopes] random events failed:', e?.message || e); }
}

// block-set carries over into higher ranges that define no blocks of their own.
// ai_message triggers weave into (or verbatim-replace) this reply via the same plumbing
// injections used; every other trigger fires through executeTrigger.
function rollCheckpointRandomTriggers(character) {
  // NOTE: does NOT reset activeCheckpointInjections — runReplyScopes owns the single per-turn
  // reset so this roller and the range-tree scope compose into one array. Pure co-producer.
  if (!character) return;
  const settings = loadData(DATA_FILES.settings) || {};
  // All card types: random checkpoint triggers come from the active profile (legacy fallback inside).
  const ct = getActiveProfileRangeTriggers(getActiveCheckpointProfile(character)) || {};

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
      if (!checkpointGroupEnabled('range', ORDER[i], character)) continue; // group off → as if undefined
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
  if (text) {
    sessionState.pendingVerbatimReply = null;
    await eventEngine.broadcast('ai_message', { content: text, suppressLlm: true });
    broadcast('generating_stop', {});
    // a suppress flag set alongside a verbatim reply is already satisfied by the verbatim
    sessionState.suppressReplyThisTurn = false;
    return true;
  }
  // Keyword gate/event with "Suppress AI reply" ticked: the tree handled this player message —
  // skip generation entirely this turn (all five gen-loop call sites share this gate).
  if (sessionState.suppressReplyThisTurn) {
    sessionState.suppressReplyThisTurn = false;
    console.log('[Reply] suppressed — a keyword gate/event with "Suppress AI reply" fired this turn');
    broadcast('generating_stop', {});
    return true;
  }
  return false;
}

// Render the rolled injections as a prompt block (empty when none rolled).
function checkpointInjectionsBlock() {
  const inj = sessionState.activeCheckpointInjections || [];
  if (!inj.length) return '';
  // "MANDATORY —" header: puts this block under the same enforcement shape the model already obeys
  // for checkpoints AND makes an echoed copy strippable (stripLeakedDirectives keys on MANDATORY;
  // the old "STAGE EVENTS" header matched no strip key). "Weave naturally" alone let events get
  // alluded to or dropped; each listed event is authored to HAPPEN in this reply.
  return `\n=== MANDATORY — STAGE EVENTS (THIS MESSAGE) ===\nEVERY event below MUST happen in this reply — depict each one explicitly, in scene, now:\n${inj.map(t => `- ${t}`).join('\n')}\nWeave them in naturally but unmistakably. Do NOT skip, postpone, or merely allude to any of them. Do NOT quote this list.\n=== END STAGE EVENTS ===\n`;
}

// (GC step 6) fireCheckpointInjectionAction + presentCheckpointChoice removed — dead with
// rollCheckpointInjections; player_choice is now handled by the Trigger Tree walker.

// Resume a suspended Trigger Tree player_choice on the player's pick. Runs the chosen option's
// body, then the post-choice same-level continuation (`after`) captured at suspend time — both
// in 'standalone' delivery (post immediately, like the legacy choice response). Clears the armed
// state FIRST so a nested player_choice in the body can re-arm cleanly and a double-click can't
// double-fire. Same entry the real WS click takes (via handleCheckpointChoice dispatch).
// Backward-goto support for resumed trees: a resume continuation is a SLICE of the suspending
// frame, so every label behind the suspend point is invisible to it — a `goto` targeting one
// (e.g. "on Failed, jump back and replay the minigame") bubbles out of the frame and used to die
// silently. When that happens, re-enter the tree's TOP-LEVEL node list (captured at suspend time
// as pend.rootNodes, threaded through ctx.rootNodes) at the target label and keep running. Loops
// so label-to-label hops and replay cycles keep working; bounded like MAX_GOTO_ITERS. Labels
// inside container bodies stay frame-local — only top-level labels are re-enterable after a
// resume. Returns undefined, or the sentinel of a nested suspend that re-armed mid-re-entry.
const MAX_RESUME_GOTO_HOPS = 100;

// A Go To target is a Label marker OR a NAMED Group container — jumping to a group runs the
// group's body, then falls through to whatever follows it.
function isGotoTarget(n, name) {
  return !!(n && n.params?.name === name &&
    ((n.kind === 'action' && n.type === 'label') || (n.kind === 'container' && n.type === 'group')));
}
// Where to resume relative to a matched target: AFTER a Label (pure marker), AT a Group (so it executes).
function gotoResumeIndex(list, idx) {
  return list[idx]?.kind === 'container' ? idx : idx + 1;
}

async function reenterResumedGoto(sig, ctx) {
  for (let hops = 0; sig && sig.__control === 'goto'; hops++) {
    if (hops >= MAX_RESUME_GOTO_HOPS) { console.warn(`[Tree] resume goto re-entry cap hit at '${sig.name}' — stopping`); return; }
    if (!sig.name) { console.warn('[Tree] resume goto with empty name — stopping'); return; }
    const root = Array.isArray(ctx.rootNodes) ? ctx.rootNodes : [];
    const idx = root.findIndex(n => isGotoTarget(n, sig.name));
    if (idx < 0) { console.warn(`[Tree] goto target '${sig.name}' not found at the tree's top level after resume — stopping (place jump-back Labels/named Groups at the top level)`); return; }
    try { sig = await runTree(root.slice(gotoResumeIndex(root, idx)), ctx); }
    catch (e) { console.error('[Tree] resume goto re-entry failed:', e?.message || e); return; }
  }
  return sig;
}

async function resumeTreeChoice(choiceId) {
  const pend = sessionState.pendingTreeChoice;
  if (!pend) return;
  if (pend.multi || pend.selectMember || pend.playerInput) return; // wrong channel — a stray single-choice click must not clear these
  if (choiceId === '__cancel__') { // the popup's Cancel button — ABORT the whole tree run (body + continuation discarded)
    sessionState.pendingTreeChoice = null;
    broadcast('checkpoint_choice_clear', {});
    console.log('[Tree] Player Choice cancelled — aborting the tree run');
    await tryResumeCapacityGate().catch(() => {}); // the stall is cleared even though the tree died
    return;
  }
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
    rootNodes: pend.rootNodes,
    labels: new Map()
  };
  let sig;
  try { sig = await runTree(chosen.body || [], ctx); }
  catch (e) { console.error('[resumeTreeChoice] body failed:', e?.message || e); }
  if (sig?.__control === 'goto') { // body jumped to a label behind the choice — re-enter; skip `after` (the jump repositioned the flow)
    await reenterResumedGoto(sig, ctx);
  } else if (sig) {
    return; // body re-armed a nested choice — stop here
  } else if (chosen.gotoName) {
    // Option's built-in "then go to": resolve at the choice's level (the `after` slice) like the
    // MiniGame exit gotos; a target BEHIND the choice re-enters the top level. Replaces fall-through.
    const list = Array.isArray(after) ? after : [];
    const idx = list.findIndex(n => isGotoTarget(n, chosen.gotoName));
    try {
      if (idx >= 0) sig = await runTree(list.slice(gotoResumeIndex(list, idx)), ctx);
      else sig = { __control: 'goto', name: chosen.gotoName };
      if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
    } catch (e) { console.error('[resumeTreeChoice] option goto failed:', e?.message || e); }
  } else if (Array.isArray(after) && after.length) {
    try { sig = await runTree(after, ctx); } // post-choice fall-through at the choice's own level
    catch (e) { console.error('[resumeTreeChoice] continuation failed:', e?.message || e); }
    if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
  }
  // If the intro ended ON this choice (its options have no follow-up and nothing re-armed), the intro
  // is done — arm the UNLOCK gate. A player_choice with empty option bodies must NOT strand it. force=true:
  // we ran to the end, so an end_intro on an untaken branch no longer gates us.
  if (snap.scopeKey === 'intro') finalizeIntroSequence(character, true);
  await tryResumeCapacityGate().catch(() => {}); // choice stall cleared — fire a queued Fire% gate if met
}

// Resume a tree paused on the ">>" Next gate between back-to-back standalone messages. Rebuilds the
// ctx from the snapshot (mirrors resumeTreeChoice) and runs the stashed continuation.
async function resumeTreeNext() {
  const pend = sessionState.pendingTreeNext;
  if (!pend) return;
  const after = pend.after, snap = pend.ctxSnapshot || {};
  sessionState.pendingTreeNext = null;
  broadcast('next_gate', { active: false });
  if (!Array.isArray(after) || !after.length) return;
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
    firedSet: sessionState.firedTreeNodes,
    rootNodes: pend.rootNodes,
    labels: new Map()
  };
  try {
    const sig = await runTree(after, ctx);
    if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
  }
  catch (e) { console.error('[resumeTreeNext] continuation failed:', e?.message || e); }
  // If this was the intro sequence and it just finished (nothing new pending), arm the UNLOCK gate.
  if (snap.scopeKey === 'intro') finalizeIntroSequence(character, true);
}

// Resume a suspended Trigger Tree choose_multi on the player's confirmed selection. Runs EACH
// picked option's body in author order, then the same-level continuation — all in one shared ctx
// ('standalone' delivery), mirroring resumeTreeChoice. Clears the armed state FIRST so a nested
// choice inside a body re-arms cleanly. A suspend/goto bubbling out of any body stops the rest.
async function resumeTreeChooseMulti(selectedIds) {
  const pend = sessionState.pendingTreeChoice;
  if (!pend || !pend.multi) return;
  const ids = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const picked = (pend.choices || []).filter(c => ids.has(c.id));
  const after = pend.after, snap = pend.ctxSnapshot || {};
  sessionState.pendingTreeChoice = null;
  broadcast('checkpoint_choice_clear', {});
  if (!picked.length) return; // nothing checked — dismissed without firing

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
    firedSet: sessionState.firedTreeNodes,
    rootNodes: pend.rootNodes,
    labels: new Map()
  };
  let jumped = false; // a body's goto re-entered the frame — the jump owns the rest, skip `after`
  for (const opt of picked) {
    let sig;
    try { sig = await runTree(opt.body || [], ctx); }
    catch (e) { console.error('[resumeTreeChooseMulti] body failed:', e?.message || e); continue; }
    if (sig?.__control === 'goto') { await reenterResumedGoto(sig, ctx); jumped = true; break; }
    if (sig) return; // a body re-armed a nested choice — stop here
  }
  if (!jumped && Array.isArray(after) && after.length) {
    try {
      const sig = await runTree(after, ctx); // post-selection fall-through at the node's own level
      if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
    }
    catch (e) { console.error('[resumeTreeChooseMulti] continuation failed:', e?.message || e); }
  }
  if (snap.scopeKey === 'intro') finalizeIntroSequence(character, true); // intro finished on this choice → arm UNLOCK
  await tryResumeCapacityGate().catch(() => {}); // choice stall cleared — fire a queued Fire% gate if met
}

// Resume a suspended Select Member popup. OK (memberId) → store the member's NAME in
// sessionState.selectedChar ([SelectedChar]) and run the node's body, then the same-level
// continuation. Cancel (null/stale id) → ABORT the entire tree run: body + continuation discarded.
async function resumeTreeSelectMember(memberId) {
  const pend = sessionState.pendingTreeChoice;
  if (!pend || !pend.selectMember) return;
  const chosen = memberId ? (pend.choices || []).find(c => c.id === memberId) : null;
  const body = pend.body, after = pend.after, snap = pend.ctxSnapshot || {};
  sessionState.pendingTreeChoice = null;
  broadcast('tree_select_member_clear', {});
  if (!chosen) {
    console.log('[Tree] Select Member cancelled — aborting the tree run');
    await tryResumeCapacityGate().catch(() => {}); // the stall is cleared even though the tree died
    return;
  }
  sessionState.selectedChar = chosen.label; // member NAME → [SelectedChar] / [CharCapacity:[SelectedChar]]
  console.log(`[Tree] Select Member → [SelectedChar] = ${chosen.label}`);

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
    firedSet: sessionState.firedTreeNodes,
    rootNodes: pend.rootNodes,
    labels: new Map()
  };
  let sig;
  try { sig = await runTree(body || [], ctx); }
  catch (e) { console.error('[resumeTreeSelectMember] body failed:', e?.message || e); }
  if (sig?.__control === 'goto') { // body jumped behind the suspend point — re-enter; the jump owns the rest
    await reenterResumedGoto(sig, ctx);
  } else if (sig) {
    return; // body re-armed a nested suspend — stop here
  } else if (Array.isArray(after) && after.length) {
    try { sig = await runTree(after, ctx); } // post-selection fall-through at the node's own level
    catch (e) { console.error('[resumeTreeSelectMember] continuation failed:', e?.message || e); }
    if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
  }
  if (snap.scopeKey === 'intro') finalizeIntroSequence(character, true);
  await tryResumeCapacityGate().catch(() => {});
}

// Resume a suspended Player Input popup. OK (values array, index-aligned with the armed rows)
// → store each as [PlayerInput:Row#] (sessionState.playerInputs, 1-based) and run the node's
// body + same-level continuation. Cancel (null) → ABORT the entire tree run.
async function resumeTreePlayerInput(values) {
  const pend = sessionState.pendingTreeChoice;
  if (!pend || !pend.playerInput) return;
  const body = pend.body, after = pend.after, snap = pend.ctxSnapshot || {}, rows = pend.rows || [];
  sessionState.pendingTreeChoice = null;
  broadcast('tree_player_input_clear', {});
  if (!Array.isArray(values)) {
    console.log('[Tree] Player Input cancelled — aborting the tree run');
    await tryResumeCapacityGate().catch(() => {});
    return;
  }
  const stored = {};
  rows.forEach((r, i) => {
    let v = values[i];
    if (r.type === 'num') {
      const n = parseFloat(v);
      const fallback = r.def !== '' && r.def != null ? Number(r.def) : r.min;
      v = Number.isFinite(n) ? Math.max(r.min, Math.min(r.max, n)) : fallback;
    } else {
      v = String(v ?? r.def ?? '');
    }
    stored[r.n] = v;
  });
  sessionState.playerInputs = stored; // whole map replaced per popup — row numbers are per-form
  // Rows flagged "Store as CharVar" also land in the named variable (via applySetVariable so the
  // canonical map + sessionState.flowVariables mirror + logging stay consistent).
  for (const r of rows) {
    if (r.varName) eventEngine.applySetVariable('custom', r.varName, 'set', String(stored[r.n]));
  }
  console.log(`[Tree] Player Input → ${rows.map(r => `[PlayerInput:${r.n}]=${stored[r.n]}${r.varName ? ` (→ [CharVar:${r.varName}])` : ''}`).join(' ')}`);

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
    firedSet: sessionState.firedTreeNodes,
    rootNodes: pend.rootNodes,
    labels: new Map()
  };
  let sig;
  try { sig = await runTree(body || [], ctx); }
  catch (e) { console.error('[resumeTreePlayerInput] body failed:', e?.message || e); }
  if (sig?.__control === 'goto') { // body jumped behind the suspend point — re-enter; the jump owns the rest
    await reenterResumedGoto(sig, ctx);
  } else if (sig) {
    return; // body re-armed a nested suspend — stop here
  } else if (Array.isArray(after) && after.length) {
    try { sig = await runTree(after, ctx); }
    catch (e) { console.error('[resumeTreePlayerInput] continuation failed:', e?.message || e); }
    if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
  }
  if (snap.scopeKey === 'intro') finalizeIntroSequence(character, true);
  await tryResumeCapacityGate().catch(() => {});
}

// Resume a suspended Trigger Tree call_minigame on the played exit (Phase 5). Sets the GameResult /
// GameWinner Flow vars, then runs the same-level continuation captured at suspend time. If the fired
// exit is bound to a goto label, the continuation is sliced to resume AFTER that label (reusing the
// engine's "jump to label in this list" semantics); an unbound exit just falls through. Clears the
// armed state FIRST so a nested suspend in the continuation can re-arm cleanly.
async function resumeTreeGame(firedExit, winner, pick) {
  const pend = sessionState.pendingTreeGame;
  if (!pend) return;
  const after = pend.after, snap = pend.ctxSnapshot || {}, exitGotos = pend.exitGotos || {};
  sessionState.pendingTreeGame = null;
  broadcast('tree_minigame_clear', {});

  // Expose the outcome to the continuation/branches via [CharVar:GameResult] / [CharVar:GameWinner],
  // plus [CharVar:GamePick] = what the PLAYER chose (coin call / RPS throw) so a player-impersonation
  // or the character's reaction knows their move, not just the outcome. (Blank for no-choice games.)
  try {
    eventEngine.applySetVariable('custom', 'GameResult', 'set', firedExit || '');
    eventEngine.applySetVariable('custom', 'GameWinner', 'set', winner || '');
    eventEngine.applySetVariable('custom', 'GamePick', 'set', pick || '');
  } catch (e) { console.error('[resumeTreeGame] set vars failed:', e?.message || e); }

  const settings = loadData(DATA_FILES.settings) || {};
  const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const character = characters.find(c => c.id === settings?.activeCharacterId) || null;

  // Concede: the game's optional "custom concede action" fires its configured tree ALONGSIDE the
  // clean exit (standalone run, own scope) — the Conceded goto/continuation below still runs too.
  if (firedExit === 'Conceded') {
    try {
      const cGame = (loadMiniGames().games || []).find(g => g.id === pend.miniGameId)
        || (character?.miniGames || []).find(g => g.id === pend.miniGameId);
      const cTreeId = cGame?.config?.concedeCustom ? cGame?.config?.concedeTreeId : null;
      if (cTreeId) {
        const cTree = buildTreeIndex(character).get(cTreeId);
        if (cTree) {
          console.log(`[resumeTreeGame] Conceded — firing custom concede tree '${cTree.name || cTreeId}'`);
          await runTreeScope(cTree, `concede:${pend.miniGameId}`, character, settings, { delivery: 'standalone' });
        } else {
          console.warn(`[resumeTreeGame] custom concede tree '${cTreeId}' not found`);
        }
      }
    } catch (e) { console.error('[resumeTreeGame] custom concede action failed:', e?.message || e); }
  }

  const ctx = {
    character, settings,
    treeId: snap.treeId, scopeKey: snap.scopeKey,
    depth: snap.childDepth || 0,
    delivery: snap.delivery || 'standalone',
    source: snap.source || `tree:${snap.treeId}`,
    visited: new Set(snap.visited || [snap.treeId]),
    firedSet: sessionState.firedTreeNodes,
    rootNodes: pend.rootNodes,
    labels: new Map()
  };

  let list = Array.isArray(after) ? after : [];
  let sig = null;
  const gotoName = exitGotos[firedExit];
  if (gotoName) {
    const idx = list.findIndex(n => isGotoTarget(n, gotoName));
    if (idx >= 0) list = list.slice(gotoResumeIndex(list, idx)); // resume AFTER a bound Label / AT a named Group (same-level only — like choice resume)
    else { sig = { __control: 'goto', name: gotoName }; list = null; } // target sits BEHIND the call node (e.g. a replay loop) — re-enter the top level
  }
  try {
    if (list) sig = await runTree(list, ctx);
    if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
  }
  catch (e) { console.error('[resumeTreeGame] continuation failed:', e?.message || e); }
  if (snap.scopeKey === 'intro') finalizeIntroSequence(character, true); // intro finished on this minigame → arm UNLOCK
  await tryResumeCapacityGate().catch(() => {}); // game stall cleared — fire a queued Fire% gate if met
}

// Tick a pending pause_resume down by one reply turn; when it reaches zero, run the deferred body
// then the same-level continuation (standalone delivery), mirroring the choice resumes. Called once
// at the top of each reply turn (runReplyScopes) so a pause armed this turn first ticks next turn.
async function checkPendingTreeResume() {
  const pend = sessionState.pendingTreeResume;
  if (!pend) return;
  if (--pend.remaining > 0) return; // still waiting
  const body = pend.body, after = pend.after, snap = pend.ctxSnapshot || {};
  sessionState.pendingTreeResume = null;
  // (fixed) this used to also clear pendingTreeGame — a Wait resolving would silently dismiss an
  // armed MiniGame (its UI stayed open but the resume found nothing → dead buttons). They are
  // independent channels; never cross-clear.

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
    firedSet: sessionState.firedTreeNodes,
    rootNodes: pend.rootNodes,
    labels: new Map()
  };
  let sig;
  try { sig = await runTree(body || [], ctx); }
  catch (e) { console.error('[checkPendingTreeResume] body failed:', e?.message || e); }
  if (sig?.__control === 'goto') { // body jumped behind the suspend point — re-enter; the jump owns the rest
    await reenterResumedGoto(sig, ctx);
  } else if (sig) {
    return; // body re-armed a pause/choice — stop here
  } else if (Array.isArray(after) && after.length) {
    try { sig = await runTree(after, ctx); } // post-pause fall-through at the node's own level
    catch (e) { console.error('[checkPendingTreeResume] continuation failed:', e?.message || e); }
    if (sig?.__control === 'goto') await reenterResumedGoto(sig, ctx);
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

// ===== Gated Intro (tree scope) — the trigger-based replacement for Pre-Fill (Part 4) =====
// A card-level Trigger Tree at activeStory.treeRefs.intro. While active it closes the inflation
// gate and (in runReplyScopes) blocks ALL other scopes/events/buttons until an `end_intro` action
// fires — which opens the gate and optionally loads a checkpoint profile, dropping into normal play.
function getIntroTree(character, treeIndex) {
  if (!checkpointsEnabledFor(character)) return null; // Enable Checkpoints off → no intro either
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const scopeRefs = resolveScopeRefs(character);
  // "Enable Intro" toggle (per profile, legacy story fallback): when explicitly OFF, the intro —
  // and therefore its pre-inflation gating — is disabled entirely. Default ON for back-compat.
  const introEnabled = (scopeRefs?.introEnabled ?? activeStory?.treeRefs?.introEnabled) !== false;
  if (!introEnabled) return null;
  // Intro is now PER-PROFILE (active checkpoint profile's treeRefs.intro); fall back to the legacy
  // card-level treeRefs.intro for un-migrated cards.
  const ref = scopeRefs?.intro || activeStory?.treeRefs?.intro;
  return resolveRefTree(ref, treeIndex);
}
function hasIntroTree(character) { return !!getIntroTree(character); }
// Set + broadcast the intro-active flag so the frontend can show "Intro - Pump Locked Off" on the
// mobile pump timer while the gated intro holds inflation shut.
function setIntroActive(val) {
  sessionState.introActive = !!val;
  // introUnlockFlow: whether THIS intro uses the UNLOCK flow (the card's "Press UNLOCK to exit
  // intro" tickbox) — the frontend only shows the UNLOCK overlay/notice when it does.
  broadcast('intro_state', { introActive: !!val, introUnlockFlow: sessionState.introUnlockFlow === true });
}
// Enter the gated intro at session start (opening line posted standalone). Returns true if started.
// welcomePosted: when true, the intro's first standalone message waits behind the ">>" gate so the
// player reads the welcome message first.
async function startIntroScope(character, settings, treeIndex, welcomePosted = false) {
  const tree = getIntroTree(character, treeIndex);
  if (!tree) { setIntroActive(false); return false; }
  // "Press READY/UNLOCK to exit intro" (intro-section checkbox) — computed BEFORE setIntroActive
  // so the intro_state broadcast carries whether this intro uses the UNLOCK flow at all.
  const introStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const readyExit = !!(resolveScopeRefs(character)?.introReadyExit ?? introStory?.treeRefs?.introReadyExit);
  sessionState.introUnlockFlow = readyExit;
  setIntroActive(true);
  sessionState.preInflationGateMet = false; // no pumping during the gated intro
  sessionState.prosePumpGuidanceOff = true; // no pump-prose guidance/reinforcement during the intro
  if (readyExit) {
    sessionState.awaitingGoRelease = true;
    sessionState.releaseButtonLabel = 'READY!';
    broadcast('gate_release_state', { awaitingGoRelease: true, releaseButtonLabel: 'READY!' });
  }
  try { await runTreeScope(tree, 'intro', character, settings, { delivery: 'standalone', treeIndex, gateFirstMsg: welcomePosted }); }
  catch (e) { console.error('[Intro] start failed:', e?.message || e); }
  finalizeIntroSequence(character); // no-WAIT case: the whole sequence ran here → arm UNLOCK now
  return true;
}
// Does the intro tree contain an explicit end_intro action anywhere (incl. nested blocks)?
function treeHasEndIntro(tree) {
  if (!tree || !Array.isArray(tree.nodes)) return false;
  const scan = (arr) => Array.isArray(arr) && arr.some(n => n && (
    (n.kind === 'action' && n.type === 'end_intro') ||
    scan(n.children) || scan(n.nodes) || scan(n.then) || scan(n.else) || scan(n.blocks)));
  return scan(tree.nodes);
}
// Called when a gated intro's STANDALONE tree run finishes. A pure message-sequence intro (no explicit
// end_intro) would otherwise leave introActive stuck true and the UNLOCK gate never armed — so once the
// last message has posted (nothing pending), arm the manual-release gate so UNLOCK lights up.
function finalizeIntroSequence(character, force = false) {
  if (!sessionState.introActive) { console.log('[Intro] finalize skip — not active'); return; } // already ended via end_intro
  // NOTE: do NOT early-return on awaitingGoRelease. The "Press UNLOCK to exit intro" option arms
  // awaitingGoRelease at intro START (while introActive is still true) — bailing here would leave
  // introActive stuck true forever, so UNLOCK (ready = awaitingGoRelease && !introActive) never lit.
  // We MUST fall through to clear introActive on completion even when the gate was pre-armed.
  if (sessionState.pendingTreeNext || sessionState.pendingTreeChoice || sessionState.pendingTreeResume || sessionState.pendingTreeGame) {
    console.log('[Intro] finalize deferred — still pending', { next: !!sessionState.pendingTreeNext, choice: !!sessionState.pendingTreeChoice, resume: !!sessionState.pendingTreeResume, game: !!sessionState.pendingTreeGame });
    return; // genuinely mid-sequence (>> / choice / minigame armed) — wait for it
  }
  // `force`: a suspended node (choice/next/minigame) just resolved and the sequence ran to its end
  // WITHOUT firing end_intro. We've empirically hit the end, so arm UNLOCK even if an end_intro sits on
  // some OTHER, untaken branch (it can never fire now). Only startIntroScope's initial standalone pass
  // (force=false) still defers to a tree that owns an end_intro (keyword-gated / weave-style ends).
  if (!force && treeHasEndIntro(getIntroTree(character))) {
    console.log('[Intro] finalize deferred — tree owns an end_intro elsewhere (relying on it to fire)');
    return;
  }
  setIntroActive(false);
  const introStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  sessionState.prosePumpGuidanceOff = prosePumpAfterIntroOff(character, introStory);
  // The UNLOCK hold is OPT-IN: only when the card's "Press UNLOCK to exit intro" tickbox
  // (treeRefs.introReadyExit) is on — or the gate was already pre-armed (GO!/READY paths).
  // Unticked cards previously got an UNLOCK button they never asked for, stranding the pump
  // gate closed behind a UI element.
  const readyExit = !!(resolveScopeRefs(character)?.introReadyExit ?? introStory?.treeRefs?.introReadyExit);
  if (readyExit || sessionState.awaitingGoRelease) {
    sessionState.preInflationGateMet = false;           // still gated until UNLOCK is pressed
    sessionState.awaitingGoRelease = true;
    sessionState.releaseButtonLabel = 'UNLOCK';
    broadcast('gate_release_state', { awaitingGoRelease: true, releaseButtonLabel: 'UNLOCK' });
    broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: false });
    console.log(`[Intro] sequence complete${force ? ' (forced after a node resolved)' : ''} → armed UNLOCK gate`);
  } else {
    sessionState.preInflationGateMet = true;            // no UNLOCK tickbox → gate opens with the intro's end
    sessionState.awaitingGoRelease = false;
    sessionState.releaseButtonLabel = null;
    broadcast('gate_release_state', { awaitingGoRelease: false, releaseButtonLabel: null });
    broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: true });
    console.log(`[Intro] sequence complete${force ? ' (forced after a node resolved)' : ''} → pump gate OPEN (no UNLOCK tickbox)`);
  }
}
// Re-run the intro tree each reply while active (weaves guidance in-reply; its keyword/choice gates
// fire end_intro when the player meets the condition).
// Gated-intro deferral: when the Session Start tree SUSPENDS (choice/wait/>>/game/input), its
// runTreeScope returns immediately with the continuation parked — the intro must NOT start until
// that whole chain completes (the reported bug: intro talking over an unfinished session start).
// A light watcher beats instrumenting every resume path: it waits until no suspension from the
// 'sessionStart' scope remains (and no generation is in flight), then starts the intro (or the
// legacy Pre-Fill fallback). Session resets null pendingIntroStart, which self-clears the timer.
let _deferredIntroTimer = null;
function deferIntroUntilSessionStartCompletes(welcomePosted) {
  sessionState.pendingIntroStart = { welcomePosted };
  if (_deferredIntroTimer) clearInterval(_deferredIntroTimer);
  _deferredIntroTimer = setInterval(async () => {
    const d = sessionState.pendingIntroStart;
    if (!d) { clearInterval(_deferredIntroTimer); _deferredIntroTimer = null; return; }
    const stillPending = ['pendingTreeChoice', 'pendingTreeResume', 'pendingTreeGame', 'pendingTreeNext']
      .some(k => String(sessionState[k]?.ctxSnapshot?.scopeKey || '').startsWith('sessionStart'));
    if (stillPending || llmState.isGenerating) return;
    clearInterval(_deferredIntroTimer); _deferredIntroTimer = null;
    sessionState.pendingIntroStart = null;
    sessionState.sessionStartActive = false; // chain complete — events may fire again (unless the intro gates them)
    try {
      const { character, settings } = getActiveCharacterAndSettings();
      if (!character) return;
      console.log('[SessionStart] chain complete — starting the deferred gated intro');
      const treeIndex = buildTreeIndex(character);
      const introStarted = await startIntroScope(character, settings, treeIndex, d.welcomePosted);
      if (!introStarted) startPreFill(character);
    } catch (e) { console.error('[SessionStart] deferred intro start failed:', e?.message || e); }
  }, 500);
}

async function runIntroScope(character, settings, treeIndex) {
  const tree = getIntroTree(character, treeIndex);
  if (!tree) {
    // Intro vanished mid-session (e.g. Enable Checkpoints/Enable Intro toggled OFF while a gated intro
    // was live). Reopen the pre-inflation gate so pump control isn't stranded closed.
    if (sessionState.introActive) {
      sessionState.preInflationGateMet = true;
      sessionState.prosePumpGuidanceOff = false;
      broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: true });
    }
    setIntroActive(false);
    return;
  }
  try { await runTreeScope(tree, 'intro', character, settings, { delivery: 'inReply', treeIndex }); }
  catch (e) { console.error('[Intro] run failed:', e?.message || e); }
}
// Hard "no pumping" directive injected every turn while the gated intro is active OR while the
// session is holding on a manual "GO!" release (intro finished, but the player hasn't pressed GO!).
function introBlock(character) {
  if (sessionState.awaitingGoRelease) {
    return `\n=== AWAITING GO (MANDATORY — NO PUMPING) ===\nThe buildup is complete but inflation has NOT been authorized yet — the player must press GO! first. Do NOT pump, do NOT instruct the player to pump, never use [pump on]. Keep the scene holding/ready until release.\n=== END AWAITING GO ===\n`;
  }
  if (!sessionState.introActive) return '';
  // Card-authored intro rules (treeRefs.introInstructions); falls back to the default no-pump rule.
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const custom = (activeStory?.treeRefs?.introInstructions || '').trim();
  const body = custom || "Inflation has NOT started. DO NOT turn on or operate any pumps yet — no [pump on], and do not instruct the player to pump. Set the scene and converse toward the intro's goal; this phase ends only when its End Gated Intro trigger fires.";
  return `\n=== GATED INTRO (MANDATORY) ===\n${body}\n=== END GATED INTRO ===\n`;
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
  if (instr.text) s += `Current goal: ${substituteAllVariables(instr.text, { isPromptText: true })}\n`;
  s += `Converse naturally toward that goal. This phase only advances when the player says the required phrase — never advance it yourself.\n`;
  if (sessionState.preFillNote) {
    s += `A transition just happened — work this into your reply: ${substituteAllVariables(sessionState.preFillNote, { isPromptText: true })}\n`;
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
  // NOTE: the prereq Q&A no longer closes the pump gate — instructor device control should work
  // like regular mode. Use a gated-intro tree / Pre-Fill if you want to hold the pump during setup.
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
// in named profiles selected at runtime).
// GENERALIZED (all card types): the active checkpoint profile drives generation for Instructor,
// Character, AND MultiChar cards. If a story has no checkpointProfiles (legacy/un-migrated), we
// synthesize a "Default" profile from its flat checkpoints/checkpointTriggers/treeRefs so every
// caller is uniform and legacy behavior is preserved (no isInstructor branch needed at call sites).
// Resolve the story-shaped object that supplies CAPACITY-RANGE checkpoints (profiles / ranges /
// range-triggers / range-treeRefs). For a single card this is just the active story. For a GROUP
// card the Base character governs by default, UNLESS a non-base member is marked Primary
// (character.primaryCheckpointMemberId) and carries its own authored checkpointStore — then that
// member's checkpoints drive the chat context. Intro/session-start trees (activeStory.treeRefs.intro
// / .sessionStart) are read directly from the base story elsewhere, so they are preserved here.
function getCheckpointStory(character) {
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  if (!activeStory) return activeStory;
  if (character?.multiChar?.enabled) {
    const members = character.multiChar.characters || [];
    const primaryId = character.primaryCheckpointMemberId;
    if (primaryId && members[0]?.id !== primaryId) {
      const m = members.find(x => x.id === primaryId);
      const cs = m?.checkpointStore;
      const hasProfiles = cs && Array.isArray(cs.checkpointProfiles) && cs.checkpointProfiles.length;
      const hasLegacy = cs && cs.checkpoints && Object.keys(cs.checkpoints).length;
      if (hasProfiles || hasLegacy) {
        return {
          ...activeStory,
          checkpointProfiles: cs.checkpointProfiles,
          defaultCheckpointProfileId: cs.defaultCheckpointProfileId,
          checkpoints: cs.checkpoints || activeStory.checkpoints,
          checkpointTriggers: cs.checkpointTriggers || activeStory.checkpointTriggers,
          // Take the member's range trees but keep the base story's intro/session-start trees.
          treeRefs: cs.treeRefs ? { ...activeStory.treeRefs, ...cs.treeRefs } : activeStory.treeRefs,
        };
      }
    }
  }
  return activeStory;
}

function getActiveCheckpointProfile(character) {
  const activeStory = getCheckpointStory(character);
  if (!activeStory) return null;
  const profiles = Array.isArray(activeStory.checkpointProfiles) ? activeStory.checkpointProfiles : [];
  if (profiles.length) {
    const activeId = sessionState.activeCheckpointProfileId || activeStory.defaultCheckpointProfileId || profiles[0].id;
    return profiles.find(p => p.id === activeId) || profiles[0];
  }
  // Legacy fallback: wrap the story's flat fields as a synthetic Default profile.
  const ranges = {};
  const cps = activeStory.checkpoints || {};
  for (const k of Object.keys(cps)) { if (k !== '0') ranges[k] = cps[k]; }
  return {
    id: 'default', name: 'Default', ranges,
    checkpointTriggers: activeStory.checkpointTriggers || {},
    treeRefs: activeStory.treeRefs || {},
  };
}
// Range Sets: a profile's 1–100% range data (ranges / checkpointTriggers / treeRefs.ranges) lives
// in a switchable Range Set. Resolve the active set (sessionState.activeRangeSetId → profile
// default → first). Legacy profiles with no rangeSets fall back to the profile's flat fields.
function getActiveRangeSet(profile) {
  const sets = profile?.rangeSets;
  if (!Array.isArray(sets) || !sets.length) return null;
  // active id (if it belongs to THIS profile) → profile default → first
  const aid = sessionState.activeRangeSetId;
  return (aid && sets.find(rs => rs.id === aid)) || sets.find(rs => rs.id === profile.defaultRangeSetId) || sets[0];
}
function getActiveProfileRanges(profile) {
  const rs = getActiveRangeSet(profile);
  return rs ? (rs.ranges || {}) : (profile?.ranges || {});
}
function getActiveProfileRangeTriggers(profile) {
  const rs = getActiveRangeSet(profile);
  return rs ? (rs.checkpointTriggers || {}) : (profile?.checkpointTriggers || {});
}
function getActiveProfileRangeTreeRefs(profile) {
  const rs = getActiveRangeSet(profile);
  return rs ? (rs.treeRefs?.ranges || {}) : (profile?.treeRefs?.ranges || {});
}
function getActiveCheckpointProfileRanges(character) {
  return getActiveProfileRanges(getActiveCheckpointProfile(character));
}

// Instructor-specific wrappers retained for existing call sites — now thin aliases over the
// generalized resolver (instructors always have profiles, so behavior is identical).
function getInstructorActiveProfileRanges(character) {
  if (!isInstructor(character)) return null;
  return getActiveCheckpointProfileRanges(character);
}
function getInstructorActiveProfile(character) {
  if (!isInstructor(character)) return null;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const profiles = Array.isArray(activeStory?.checkpointProfiles) ? activeStory.checkpointProfiles : [];
  if (!profiles.length) return null; // instructors without profiles keep the prior null contract
  return getActiveCheckpointProfile(character);
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
  if (sessionState.introActive || sessionState.preFillActive || sessionState.awaitingGoRelease) { console.log('[ManualPump] Blocked — gated intro / awaiting GO! (no pumping)'); return; }
  const type = sessionState.pumpType;
  if (type !== 'bulb' && type !== 'bike') return;
  const sv = (loadData(DATA_FILES.settings) || {}).systemVariables || {};
  const max = type === 'bulb' ? Number(sv.BulbMax) : Number(sv.BikeMax);
  const perPump = max > 0 ? 100 / max : 0;
  if (type === 'bulb') sessionState.bulbCurrent = (sessionState.bulbCurrent || 0) + 1;
  else sessionState.bikeCurrent = (sessionState.bikeCurrent || 0) + 1;
  const before = sessionState.capacity || 0;
  // Round to 1 decimal so the bulb/bike pump shows clean values (e.g. 4.2%), not a 15-digit float
  // from 100/max (e.g. 100/120 = 0.8333…).
  sessionState.capacity = Math.round(Math.max(0, Math.min(100, before + perPump)) * 10) / 10;
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

  // Advance a pending Await Pump Amount gate (#20). Done AFTER checkpoint triggers so that if this
  // press crossed into a new populated range, that range's #21 abort takes precedence.
  if (sessionState.pendingRangeAwait?.kind === 'pump') {
    const pa = sessionState.pendingRangeAwait;
    pa.count = (pa.count || 0) + 1;
    if (pa.count >= pa.target) {
      console.log(`[ManualPump] Await Pump Amount satisfied (${pa.count}/${pa.target}) — resuming sequence`);
      await resumeTriggerSequence(pa).catch(err => console.error('[ManualPump] await resume failed:', err?.message || err));
    } else {
      broadcast('await_state', { kind: 'pump', target: pa.target, count: pa.count });
    }
  }
  autosaveSession();
}

// GO! gate-release: the player presses GO! to leave a manual-release intro hold (set by an
// end_intro with manualRelease, or a profile-assign action with the manual-gate tickbox). Opens
// the pump gate and loads the stashed checkpoint profile so pumping + checkpoints begin now.
async function handleGateRelease() {
  if (!sessionState.awaitingGoRelease) return;
  const wasReady = sessionState.releaseButtonLabel === 'READY!';
  sessionState.awaitingGoRelease = false;
  sessionState.releaseButtonLabel = null;
  sessionState.preInflationGateMet = true;
  // READY! exits an active intro directly (no End Gated Intro action needed): end the intro and
  // restore normal pump-prose guidance per the card's after-intro setting.
  const profId = sessionState.pendingGoProfileId;
  sessionState.pendingGoProfileId = null;
  try {
    const s = loadData(DATA_FILES.settings) || {};
    const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const ch = chars.find(c => c.id === s.activeCharacterId);
    const story = ch?.stories?.find(x => x.id === ch.activeStoryId) || ch?.stories?.[0];
    if (sessionState.introActive) {
      setIntroActive(false);
      sessionState.prosePumpGuidanceOff = prosePumpAfterIntroOff(ch, story);
    }
    if (profId) sessionState.activeCheckpointProfileId = profId;
    // Always resolve the pump mode so the button reverts to the correct E-STOP / PUMP for this session.
    if (ch) applyActivePumpType(ch);
  } catch (e) { /* best-effort */ }
  broadcast('gate_release_state', { awaitingGoRelease: false, releaseButtonLabel: null });
  broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: true });
  autosaveSession();
  console.log(`[GateRelease] ${wasReady ? 'READY! pressed → intro exited' : 'GO! pressed'} → pump gate open${profId ? `, loaded profile ${profId}` : ''}`);
  // Checkpoints engage on the press (this is where a manual-release exit actually opens the gate
  // and loads the stashed profile): fire the active range tree(s) for the current gauge now.
  try {
    const { character, settings } = getActiveCharacterAndSettings();
    if (character && checkpointsEnabledFor(character)) {
      await runActiveRangeTrees(character, settings, buildTreeIndex(character), { delivery: 'standalone' });
    }
  } catch (e) { console.error('[GateRelease] range-tree fire failed:', e?.message || e); }
}

// The "Enable Checkpoints" tickbox (base story) gates the WHOLE checkpoint system — intro, session
// start, welcome pre-inflation, range themes/triggers, always-on, and event triggers — not just the
// capacity-range triggers. Off = none of it fires.
function checkpointsEnabledFor(character) {
  const story = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  return story?.checkpointsEnabled !== false;
}

// Gated by "Enable Checkpoints" — use for NARRATIVE content (themes, pre-inflation, stage directions).
function getActiveCheckpoint(character, capacity) {
  if (!checkpointsEnabledFor(character)) return null;
  return getActiveCheckpointRaw(character, capacity);
}

// UN-gated resolver — returns the active range regardless of the tickbox. Used by device pump PACING
// (automation, not narrative), which must keep working even when checkpoints are disabled.
function getActiveCheckpointRaw(character, capacity) {
  // All card types resolve range content from the active checkpoint profile; the 0 range
  // (pre-inflation) is handled by the pre-req/intro sequence, not text. Legacy cards fall back
  // to flat checkpoints inside getActiveCheckpointProfileRanges.
  const checkpoints = getActiveCheckpointProfileRanges(character);
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

// Resolve the active range's pump LIMIT SWITCHES and stash them on sessionState so the cross-module
// pump-on paths (AI [pump on] in ai-device-control; timedPumpOn / effectiveMaxOnSeconds) can read
// them. Both are independent and OPTIONAL — blank/unset → null (does not apply, never forces a pump):
//   • rangePumpCapSecs      — caps a pump-ON's duration in this range (min'd with pump + global limits)
//   • rangePumpCooldownMsgs — minimum CHAT MESSAGES (player + every character/member bubble) between
//                             pump-ONs; a pump-on that arrives sooner is blocked.
function refreshRangePumpGates(character) {
  const cp = character ? getActiveCheckpointRaw(character, sessionState.capacity) : null;
  const cap = Number(cp?.maxPumpOnSecs);
  const cool = Number(cp?.messagesBetweenOn);
  sessionState.rangePumpCapSecs = (Number.isFinite(cap) && cap > 0) ? cap : null;
  sessionState.rangePumpCooldownMsgs = (Number.isFinite(cool) && cool > 0) ? cool : null;
}

// Manual-pump pacing directive for the active range (bulb/bike instructors only).
// Tells the LLM how many pump operations it may request per batch and how long to
// wait between batches. Returns '' for electric/auto pumps or when no limits are set.
function manualPumpBatchBlock(cp) {
  if (!cp) return '';
  // Suppressed during the gated intro / awaiting-GO, and after it when the card opted out.
  if (sessionState.introActive || sessionState.awaitingGoRelease || sessionState.prosePumpGuidanceOff) return '';
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

  // Use the SAME effective window the prompt uses (a card may override the global depth). Summarizing
  // against the global depth while the context uses a smaller card depth left the gap between them
  // neither summarized nor in-window — a silent memory hole.
  const activeChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const activeChar = activeChars.find(c => c.id === settings?.activeCharacterId);
  const cardDepth = Number(activeChar?.historyDepth);
  const depth = cardDepth > 0 ? cardDepth : memSettings.chatHistoryDepth;
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
 * The author note is injected at `authorNoteDepth` from the end
 * (SillyTavern-style) in both representations. depth>=length => top of transcript.
 * Source is the per-card character.authorsNote, falling back to settings.globalPrompt
 * (the global default acts as a seed/fallback for cards without their own note).
 *
 * @param {Array}  recentMessages - already sliced/ordered oldest->newest
 * @param {Object} opts
 * @param {string} opts.playerName     - real persona/player display name
 * @param {string} opts.characterName  - real character name
 * @param {boolean} opts.isPlayerVoice - true when generating AS the player (impersonate)
 * @param {string} [opts.authorNote]   - per-card authorsNote, else globalPrompt (undefined/empty => no note)
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

  // Filter to displayable turns, preserving order. System notes are excluded UNLESS the
  // system_message action flagged them includeInContext (rendered as a bracketed [System] line).
  const turns = recentMessages.filter(
    m => !m.excludeFromContext && (m.sender !== 'system' || m.includeInContext === true)
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
    if (msg.sender === 'system') {
      // Flagged system note: neutral narrator line, user-role in chat-completion shape.
      const sysLine = `[System: ${msg.content}]`;
      flat += `${sysLine}\n`;
      messages.push({ role: 'user', content: sysLine });
      return;
    }
    const name = isPlayerTurn ? playerName : (msg.characterName || characterName);
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
  const substituteVars = (text) => substituteAllVariables(text, { playerName, characterName: character.name, isPromptText: true });

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
      // Include pronouns so the model writing AS the player does not misgender them.
      if (persona.pronouns) systemPrompt += `Pronouns: ${persona.pronouns}\n`;
      if (persona.personality) systemPrompt += `Personality: ${substituteVars(persona.personality)}\n`;
      if (persona.appearance) systemPrompt += `Appearance: ${substituteVars(persona.appearance)}\n`;
      if (persona.relationshipWithInflation) systemPrompt += `Additional inflation context: ${substituteVars(persona.relationshipWithInflation)}\n`;
      systemPrompt += buildPersonaInflationContext(persona, playerName);
      systemPrompt += '\n';
    }

    // Keep the character card text exactly as written; frame it as context about the
    // OTHER party so the model never adopts the character's voice. For group cards, list every
    // member so the model writing AS the player knows who else is in the scene (the transcript is
    // full of their named lines).
    if (character.multiChar?.enabled) {
      const others = (character.multiChar.characters || []).filter(m => m?.name);
      systemPrompt += `You are ${playerName}. You are interacting with a group; the members follow for context (do NOT write as any of them):\n`;
      for (const m of others) {
        systemPrompt += `- ${m.name}${m.gender ? ` (${genderPronoun(m.gender)})` : ''}: ${substituteAllVariables(m.description || '', { playerName, characterName: m.name, isPromptText: true })}\n`;
      }
    } else {
      systemPrompt += `You are ${playerName}. ${character.name} is the one you are interacting with; `;
      systemPrompt += `their description follows for context (do NOT write as ${character.name}):\n`;
      systemPrompt += `${substituteVars(character.description)}\n`;
    }
    const scenario = getActiveScenario(character);
    if (scenario) systemPrompt += `Scenario: ${substituteVars(scenario)}\n`;
    systemPrompt += '\n';

    // Add active reminders (using reminder engine for keyword-based activation)
    const recentMessagesImp = reminderEngine.extractRecentMessages(sessionState.chatHistory, getChatMemorySettings(settings).reminderScanDepth);
    const activeRemindersImp = reminderEngine.getMergedActiveReminders(
      character.constantReminders || [],
      getSharedLibraryTermEntries(character),
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
      getSharedLibraryTermEntries(character),
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
      const scaledMaxOn = charLimits?.llmMaxOnDuration ?? 5;
      const maxSeconds = charLimits ? Math.min(globalMax, scaledMaxOn) : globalMax;
      systemPrompt += buildDeviceControlInstruction(settings.llm?.promptTemplate, maxSeconds, charLimits, capacityMod, playerName);
    }

    // Inject personality attributes if rolled (character voice only, for guided response)
    if (mode !== 'impersonate' && mode !== 'guided_impersonate') {
      if (sessionState.activeAttributes?.length > 0) {
        systemPrompt += buildAttributeBlock(sessionState.activeAttributes);
      }
      systemPrompt += buildInflationDispositionContext(character);
      systemPrompt += buildPumpReadyDirective(character, persona); // same who-may-be-inflated rule as the main reply
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
    // (removed) preInflation block — always null since the 0% gate became Pre-Fill/Gated Intro.
    if (checkpointSpecial?.text) {
      systemPrompt += `\n=== MANDATORY — INFLATION STAGE DIRECTION (${sessionState.capacity}%) ===\nYou MUST follow this guidance. Do NOT describe inflation beyond what ${sessionState.capacity}% represents:\n${checkpointSpecial.text}\n=== END STAGE DIRECTION ===\n`;
    }
    systemPrompt += manualPumpBatchBlock(checkpointSpecial);
    systemPrompt += checkpointInjectionsBlock();
    systemPrompt += introBlock(character);
    systemPrompt += preFillBlock(character);
    const charCheckpointSpecial = getActiveCharacterCheckpoint(character);
    if (charCheckpointSpecial) {
      systemPrompt += `\n=== MANDATORY — ${character.name.toUpperCase()}'S STAGE DIRECTION (${sessionState.characterCapacity}%) ===\nYou MUST follow this. Do NOT describe ${character.name}'s inflation beyond what ${sessionState.characterCapacity}% represents:\n${charCheckpointSpecial}\n=== END STAGE DIRECTION ===\n`;
    }

    // Inject persona checkpoints for impersonate mode (gated by Enable Checkpoints)
    const isPlayerVoice = (mode === 'impersonate' || mode === 'guided_impersonate');
    if (isPlayerVoice && persona && checkpointsEnabledFor(character)) {
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
    authorNote: (character?.authorsNote ?? settings?.globalPrompt),
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
    const speaker = isPlayerVoicePrimer ? playerName : character.name;
    // Statement + explicit prohibition (the v6.7.6 lesson: a bare "center on X" gets treated as a
    // theme and drifts; forbidding the escape hatches — postpone/summarize/substitute — is what
    // makes the model actually perform the direction).
    guidanceDirective = `\n=== MANDATORY — DIRECTOR'S NOTE FOR THIS REPLY ===\n${speaker}'s next message MUST act this out as the MAIN EVENT of the reply, happening now:\n"${guidedText}"\nThis is a hard requirement, not a theme: depict it explicitly, in ${speaker}'s own voice. Do NOT postpone it, summarize it, water it down, or substitute something similar. Everything else in the reply is secondary to it. Stay in character. Do NOT quote or mention this note.\n=== END NOTE ===\n`;
    prompt += guidanceDirective;
    // Reinforcement in the system block too (helps ChatML-style models).
    systemPrompt += `\n[MANDATORY director's note — the next reply must explicitly act out: ${guidedText}]`;
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
// Per-member inflation disposition phrasing (compact, for the multichar CHARACTERS list). null =
// default/omit. Mirrors the single-char desire wording (see buildInflationDispositionContext).
const MEMBER_DISPOSITION_PHRASES = {
  charInflateDesire: { terrified: 'dreads being inflated', reluctant: 'is reluctant about being inflated', nervous: 'is nervous about being inflated', neutral: null, curious: 'is curious about being inflated', eager: 'eagerly wants to be inflated', obsessed: 'is obsessed with being inflated' },
  charPopDesire: { terrified: 'is terrified of popping', dreading: 'dreads popping', anxious: 'is anxious about popping', resigned: 'is resigned to possibly popping', indifferent: null, curious: 'is curious about popping', willing: 'is willing to pop', eager: 'wants to pop' },
  desireToInflateOthers: { none: null, reluctant: 'is reluctant to inflate others', indifferent: null, willing: 'is willing to inflate others', eager: 'eagerly inflates others', obsessed: 'is obsessed with inflating others', sadistic: 'sadistically inflates others to cause discomfort' },
  desireToPopOthers: { none: null, avoidant: 'avoids popping others', careless: 'is careless about popping others', curious: 'is curious about popping others', willing: 'is willing to let others pop', eager: 'tries to push others to pop', sadistic: 'sadistically wants to pop others' },
};
function buildMemberDispositionLine(name, ma) {
  if (!ma) return '';
  const phrases = [];
  for (const field of ['charInflateDesire', 'charPopDesire', 'desireToInflateOthers', 'desireToPopOthers']) {
    const p = MEMBER_DISPOSITION_PHRASES[field]?.[ma[field]];
    if (p) phrases.push(p);
  }
  return phrases.length ? `  Disposition: ${name} ${phrases.join('; ')}.\n` : '';
}

function buildMultiCharSystemPrompt(character, playerName, substituteVars) {
  const rawChars = character.multiChar.characters || [];
  // The BASE member (index 0) IS the base character — always mirror the card's own identity onto it
  // (covers cards saved before this was enforced in the editor). Added members are untouched.
  const chars = rawChars.length
    ? [{ ...rawChars[0],
         name: character.name || rawChars[0].name,
         description: character.description || rawChars[0].description,
         personality: character.personality || rawChars[0].personality,
         gender: character.gender || rawChars[0].gender,
         portrait: character.avatar || rawChars[0].portrait },
       ...rawChars.slice(1)]
    : rawChars;
  const activeStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const memberAttrs = activeStory?.memberAttributes || {};
  const muted = new Set(sessionState?.mutedMembers || []);
  // SOLO mode (Individual Responses / member-targeted trigger/guided): only the solo speaker may
  // speak — everyone else is forced silent so the prompt itself constrains the model to one voice.
  const soloId = sessionState?.soloSpeaker || null;
  if (soloId && chars.some(c => c.id === soloId)) {
    for (const c of chars) if (c.id !== soloId) muted.add(c.id);
    // The solo speaker must ALWAYS be able to speak — even if they were muted. Otherwise targeting a
    // muted member (trigger/guided) muted everyone and produced an empty, self-contradictory cast.
    muted.delete(soloId);
  }
  const activeChars = chars.filter(c => !muted.has(c.id));
  const silentChars = chars.filter(c => muted.has(c.id));
  // If every member is muted, fall back to all (avoid an empty cast) — but NOT in solo mode, where a
  // single speaker is the whole point.
  const speakable = (activeChars.length || soloId) ? activeChars : chars;
  const names = speakable.map(c => c.name).join(', ');

  let prompt = `You are a collaborative fiction writer portraying: ${names}.\n`;
  prompt += `Write realistic, natural roleplay. Use "dialogue in quotes" and *actions/descriptions in asterisks*. Break responses into short paragraphs.\n\n`;
  prompt += `CHARACTERS:\n`;
  for (const c of chars) {
    const pron = genderPronoun(c.gender);
    const silent = muted.has(c.id) && speakable !== chars;
    prompt += `- ${c.name}${pron ? ` (${pron})` : ''}${silent ? ' [PRESENT BUT SILENT THIS TURN]' : ''}: ${substituteAllVariables(c.description || '', { playerName, characterName: c.name, isPromptText: true })}\n`;
    if (c.personality) {
      prompt += `  Personality: ${substituteAllVariables(c.personality || '', { playerName, characterName: c.name, isPromptText: true })}\n`;
    }
    // Per-member current personality drive (rolled this turn)
    const active = sessionState?.multiCharAttributes?.[c.id] || [];
    if (active.length && !silent) {
      const labels = active.map(t => t.charAt(0).toUpperCase() + t.slice(1));
      prompt += `  RIGHT NOW ${c.name} is driven by ${labels.join(', ')}: ${active.map(t => ATTRIBUTE_PROMPTS[t]).filter(Boolean).join(' ')}\n`;
    }
    // Per-member inflation disposition (always-on; from memberAttributes desires)
    prompt += buildMemberDispositionLine(c.name, memberAttrs[c.id]);
    // Per-member voice examples
    if (Array.isArray(c.exampleDialogues) && c.exampleDialogues.length) {
      const ex = c.exampleDialogues.slice(0, 2)
        .filter(e => e && (e.user || e.character))
        .map(e => `    ${playerName}: ${substituteAllVariables(e.user || '', { playerName, characterName: c.name, isPromptText: true })}\n    ${c.name}: ${substituteAllVariables(e.character || '', { playerName, characterName: c.name, isPromptText: true })}`)
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
  prompt += `- NEVER restate, list, or summarize the CHARACTERS section above — no cast introductions, no "*Name:* description" lines. Begin INSIDE the scene with action or dialogue.\n`;
  prompt += `- Keep dialogue natural and concise — people speak in short sentences, not paragraphs.\n`;
  if (soloId) {
    const me = chars.find(c => c.id === soloId);
    const others = chars.filter(c => c.id !== soloId).map(c => c.name).filter(Boolean);
    prompt += `\n=== SOLO RESPONSE (MANDATORY) ===\n`;
    prompt += `You are writing ONLY as ${me?.name || 'this character'} this turn. Output a single in-character reply from ${me?.name || 'them'} alone.\n`;
    if (others.length) prompt += `Do NOT write dialogue, actions, thoughts, or narration for ${others.join(', ')} — they may be present, but this turn is ${me?.name}'s alone. You may reference them, but never voice or act for them.\n`;
    prompt += `Begin DIRECTLY with the reply — do NOT acknowledge these instructions or announce what you will do.\n`;
    prompt += `=== END SOLO RESPONSE ===\n\n`;
  } else {
    prompt += `\nCONVERSATION DYNAMICS (important):\n`;
    prompt += `- Vary which characters speak each turn. 1-2 characters per response is ideal; only use 3+ when genuinely needed.\n`;
    prompt += `- Characters who just spoke recently can stay silent while others take the lead.\n`;
    prompt += `- Let conversations shift naturally — a character can initiate a new topic, react to something unexpected, or redirect the scene.\n`;
    prompt += `- Characters can disagree, interrupt, go off on tangents, or have side conversations.\n`;
    prompt += `- Sometimes only ONE character responds — the others are busy, distracted, or simply have nothing to add.\n`;
    prompt += `- Avoid the pattern of every character commenting on the same thing in sequence. Real groups don't take orderly turns.\n`;
    prompt += `\n`;
  }
  return prompt;
}

// ===== Instructor character type =====
// Instructor cards are stored as ordinary characters marked with instructor.enabled.
// They speak only in direct, non-embellished, mission-specific instructions (no RP prose).
function isInstructor(character) {
  return !!character?.instructor?.enabled;
}

// The card's effective auto-reply default. The unified editor stores this PER-STORY
// (activeStory.autoReplyEnabled); older cards carry it at card level. Read the active
// story first, fall back to the card flag. Instructors default ON unless explicitly off.
function resolveCardAutoReply(character) {
  if (!character) return false;
  const story = character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0];
  const val = story?.autoReplyEnabled ?? character.autoReplyEnabled;
  if (isInstructor(character)) return val ?? true;
  return val ?? false;
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
  // Instructor disposition toward inflating the player (card setting).
  const instrDispMap = {
    'knowledgeable': `Your disposition toward ${playerName}: knowledgeable — a true expert who is technically precise and fully in control, guiding inflation with confident mastery.`,
    'sadistic': `Your disposition toward ${playerName}: sadistic — you deliberately push ${playerName}'s limits and take pleasure in their discomfort, while staying in control.`,
    // Legacy combined value (kept so existing cards still resolve).
    'knowledgeable-sadistic': `Your disposition toward ${playerName}: knowledgeable and sadistic — a true expert who deliberately pushes ${playerName}'s limits and takes pleasure in their discomfort, while staying technically precise and in control.`,
    'careful': `Your disposition toward ${playerName}: careful — prioritize ${playerName}'s safety and comfort, pace inflation cautiously, check in often, and never push past clear limits.`,
    'scientific': `Your disposition toward ${playerName}: scientific — clinical and detached; run the session like a controlled experiment, narrating measurements, observations, and procedure without emotional investment.`,
  };
  const instrDisp = instrDispMap[character.instructorDisposition || 'knowledgeable'];
  if (instrDisp) p += `${instrDisp}\n`;
  // Instructor brief lives ON THE CARD now (character.instructorBrief — editable in Instructor
  // Settings); the old shared instructor-profiles store remains only as a legacy fallback for
  // cards the rev-1 migration hasn't touched.
  const instrBrief = (character.instructorBrief || '').trim();
  if (instrBrief) {
    p += `\n${substituteVars(instrBrief)}\n`;
  } else if (character.instructorProfileId) {
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

// Shared card-Library pool: the instructor-library.json groups a card opts into via
// `activeStory.libraryGroupIds`. Generalizes the instructor library to ALL card types — returns
// raw reminder-shaped entries (term + extra keys trigger; constant => always-on) for the unified
// engine. Fed into the global-pool slot of getMergedActiveReminders, which runs the activation.
function getSharedLibraryTermEntries(character) {
  const story = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const ids = Array.isArray(story?.libraryGroupIds) ? story.libraryGroupIds : [];
  if (!ids.length) return [];
  const groups = loadInstructorLibrary().groups || [];
  const out = [];
  for (const g of groups) {
    if (!ids.includes(g.id)) continue;
    if (g.enabled === false) continue; // group-level toggle (Toggle Library Entry with no term picked)
    for (const t of (g.terms || [])) {
      if (!t || !t.definition || !t.term) continue;
      const keys = [t.term, ...(Array.isArray(t.keys) ? t.keys : [])].filter(Boolean);
      out.push({ name: t.term, text: `${t.term}: ${t.definition}`, constant: !!t.constant, keys, caseSensitive: !!t.caseSensitive, enabled: t.enabled !== false });
    }
  }
  return out;
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
function buildDictionaryPrompt(character) {
  const groups = loadDictionary().groups || [];
  // Card Dictionary selection: if the active story names specific dictionaryGroupIds, only those
  // groups apply; otherwise ALL groups stay always-on (prior behavior — backward compatible).
  const story = character && (character.stories?.find(s => s.id === character.activeStoryId) || character.stories?.[0]);
  const selected = (story && Array.isArray(story.dictionaryGroupIds) && story.dictionaryGroupIds.length) ? new Set(story.dictionaryGroupIds) : null;
  const entries = [];
  for (const g of groups) {
    if (g.enabled === false) continue;
    if (selected && !selected.has(g.id)) continue;
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

// One-time migration: fold the retired system-wide settings.globalReminders into a Dictionary
// group ("Migrated Reminders") so the lore survives. The always-on Dictionary then injects them
// for all cards, preserving prior behavior. Constant (keyless) reminders stay always-on; keyworded
// ones keep their keys. Guarded by settings.migratedGlobalReminders so it runs exactly once.
function migrateGlobalRemindersToDictionary() {
  const settings = loadData(DATA_FILES.settings) || {};
  if (settings.migratedGlobalReminders) return;
  const reminders = Array.isArray(settings.globalReminders) ? settings.globalReminders : [];
  if (reminders.length) {
    const data = loadDictionary();
    if (!Array.isArray(data.groups)) data.groups = [];
    const GROUP_ID = 'dict-migrated-reminders';
    if (!data.groups.some(g => g.id === GROUP_ID)) {
      const terms = reminders.map((r, i) => {
        const keys = Array.isArray(r.keys) ? r.keys
          : (typeof r.keys === 'string' ? r.keys.split(',').map(s => s.trim()).filter(Boolean) : []);
        return {
          id: `migrem-${r.id || i}`,
          term: r.name || r.title || `Reminder ${i + 1}`,
          definition: r.text || r.content || r.definition || '',
          keys,
          constant: r.constant === true || keys.length === 0, // keyless reminder => always-on
          enabled: r.enabled !== false,
        };
      }).filter(t => t.definition);
      if (terms.length) {
        data.groups.push({ id: GROUP_ID, name: 'Migrated Reminders', enabled: true, terms });
        saveDictionary(data);
        console.log(`[Startup] Migrated ${terms.length} global reminder(s) -> Dictionary group "Migrated Reminders"`);
      }
    }
  }
  settings.migratedGlobalReminders = true;
  saveData(DATA_FILES.settings, settings);
}

// Ships-with-the-app manual pump Trigger Trees. Flow: Player Input (pump count) → Select
// Member(s) → var math (ml → % of the 8000ml max capacity) → Char Capacity inc → verbatim
// message. [SelectedChar] resolves to the base char on single cards (Select Member skips
// there), so all four trees work on any pumpable card without if/else. The (Char) variants
// pick the PUMPER first and stash them in [CharVar:Pumper] before the target selection
// overwrites [SelectedChar]; the message posts as that member (Group Member Message).
function ensureDefaultPumpTrees() {
  const data = loadTriggerTrees();
  if (!Array.isArray(data.trees)) data.trees = [];
  // Seed revision: bumping this replaces the four stock trees with the new revision. Rev is
  // recorded in the trees file, so once seeded the user may EDIT or DELETE them freely (they
  // ship unlocked, builtIn: false) and neither restarts nor deletions resurrect/clobber them.
  const SEED_REV = 2;
  if ((data.pumpTreesSeedRev || 0) >= SEED_REV) return;
  const MAX_ML = 8000; // full capacity — ml / 80 = % of max
  const defs = [
    { id: 'tree-builtin-bulb-pump-persona', name: 'Bulb Pump (Persona)', ml: 50, def: 10, charMode: false,
      action: 'squeezes the bulb pump [PlayerInput:1] time(s), pumping a total of' },
    { id: 'tree-builtin-bike-pump-persona', name: 'Bike Pump (Persona)', ml: 200, def: 3, charMode: false,
      action: 'drives the bike pump through [PlayerInput:1] full stroke(s), forcing a total of' },
    { id: 'tree-builtin-bulb-pump-char', name: 'Bulb Pump (Char)', ml: 50, def: 10, charMode: true,
      action: 'squeezes the bulb pump [PlayerInput:1] time(s), pumping a total of' },
    { id: 'tree-builtin-bike-pump-char', name: 'Bike Pump (Char)', ml: 200, def: 3, charMode: true,
      action: 'drives the bike pump through [PlayerInput:1] full stroke(s), forcing a total of' },
  ];
  let added = 0;
  for (const d of defs) {
    // Rev upgrade: replace the previous stock revision of this tree outright (v1 shipped locked,
    // so there are no user edits to preserve in it).
    data.trees = data.trees.filter(t => t.id !== d.id);
    const bodyTail = `[CharVar:PumpMl]ml of air into [SelectedChar], raising their capacity to [CharCapacity:[SelectedChar]]%.*`;
    const siblings = [];
    if (d.charMode) {
      // Pumper first (any member may pump), stashed before the target select overwrites [SelectedChar].
      siblings.push(
        { id: `${d.id}-selp`, kind: 'container', type: 'select_member', once: false,
          params: { prompt: 'Who does the pumping?', pumpableOnly: false }, children: [] },
        { id: `${d.id}-pumper`, kind: 'action', type: 'flow_var', once: false,
          params: { variable: 'Pumper', operation: 'set', value: '[SelectedChar]' } }
      );
    }
    siblings.push(
      { id: `${d.id}-sel`, kind: 'container', type: 'select_member', once: false,
        params: { prompt: d.charMode ? 'Who gets pumped?' : 'Who do you pump?', pumpableOnly: true }, children: [] },
      { id: `${d.id}-ml`, kind: 'action', type: 'flow_var', once: false,
        params: { variable: 'PumpMl', operation: 'set', value: `[PlayerInput:1] * ${d.ml}` } },
      { id: `${d.id}-pct`, kind: 'action', type: 'flow_var', once: false,
        params: { variable: 'PumpPct', operation: 'set', value: `[CharVar:PumpMl] / ${MAX_ML / 100}` } },
      { id: `${d.id}-cap`, kind: 'action', type: 'char_capacity', once: false,
        params: { targetMember: '[SelectedChar]', operation: 'inc', value: '[CharVar:PumpPct]' } },
      d.charMode
        ? { id: `${d.id}-msg`, kind: 'action', type: 'ai_message_member', once: false,
            params: { targetMember: '[CharVar:Pumper]', llmEnhance: false, context: `*[CharVar:Pumper] ${d.action} ${bodyTail}` } }
        // Persona: the exact-numbers line is a LIVE PREPEND (shows before generation starts),
        // then a guided impersonate writes the player's in-character reaction under it.
        : { id: `${d.id}-msg`, kind: 'action', type: 'impersonate', once: false,
            params: {
              prependVerbatim: true,
              prependText: `*[Player] ${d.action} ${bodyTail}`,
              context: `You just used the pump on [SelectedChar]: narrate, as [Player], the effort of those [PlayerInput:1] pump(s) and your reaction to [SelectedChar]'s belly now sitting at [CharCapacity:[SelectedChar]]% capacity. React to the change only — do NOT continue pumping or invent new pumps.`
            } }
    );
    data.trees.push({
      id: d.id, name: d.name, builtIn: false, tag: 'pump',
      nodes: [{
        id: `${d.id}-input`, kind: 'container', type: 'player_input', once: false,
        params: { rows: [{ id: `${d.id}-r1`, label: 'Number of pumps', type: 'num', min: 1, max: Math.floor(MAX_ML / d.ml), def: d.def }] },
        children: siblings
      }]
    });
    added++;
  }
  data.pumpTreesSeedRev = SEED_REV;
  saveTriggerTrees(data);
  console.log(`[Startup] Seeded ${added} stock pump tree(s) (rev ${SEED_REV}, editable)`);
}

ensureDefaultInstructorProfiles();
ensureDefaultDictionary();
// ensureDefaultPumpTrees() runs in the server.listen callback — it reads TRIGGER_TREES_PATH,
// a const declared further down (calling it here at module-eval time is a TDZ ReferenceError).
// Global-reminder→Dictionary migration retired: cards default to the "Inflation Tools" group and
// author their own Library; the "Migrated Reminders" group is no longer created.
// migrateGlobalRemindersToDictionary();

function buildChatContext(character, settings, opts = {}) {
  const personas = loadAllPersonas() || [];
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);
  const playerName = activePersona?.displayName || 'the player';

  // In SOLO mode (Individual Responses / member-targeted), [Char] and the transcript speaker resolve to
  // the responding MEMBER, not the card/Main name.
  const soloMember = sessionState?.soloSpeaker
    ? (character.multiChar?.characters || []).find(m => m.id === sessionState.soloSpeaker)
    : null;
  const effectiveCharName = soloMember?.name || character.name;

  // Substitute variables in character fields (uses global substituteAllVariables)
  const substituteVars = (text) => substituteAllVariables(text, { playerName, characterName: effectiveCharName, isPromptText: true });

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
    systemPrompt = `You are ${character.name}${character.gender ? `, ${character.gender}` : ''}. ${substituteVars(character.description)}\n`;
    systemPrompt += `Write ONLY as ${character.name} — never write for ${playerName}. Use first person in dialogue, third person for actions.\n`;
    systemPrompt += `Personality: ${substituteVars(character.personality)}\n\n`;
  }
  const scenario = getActiveScenario(character);
  if (scenario) {
    systemPrompt += `Scenario: ${substituteVars(scenario)}\n\n`;
  }

  // Always-on global dictionary, unless this instructor opts out (Use Card Library Only)
  if (!(isInstructor(character) && character.ignoreDictionary)) {
    systemPrompt += buildDictionaryPrompt(character);
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
        systemPrompt += `Player appearance: ${substituteVars(activePersona.appearance)}\n`;
      }
      if (activePersona.personality) {
        systemPrompt += `Player personality: ${substituteVars(activePersona.personality)}\n`;
      }
      if (activePersona.relationshipWithInflation) {
        systemPrompt += `Player's additional inflation context: ${substituteVars(activePersona.relationshipWithInflation)}\n`;
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

    // Manual pump activity since the last reply. Only CONSUME it on the real reply build (opts
    // .consumePumpContext) — swipes/guided/retries build context too and would otherwise steal it
    // from the next genuine reply. They still SEE it (just don't clear it).
    if (sessionState.pendingPumpContext?.length) {
      systemPrompt += `\nPump activity since your last reply:\n${sessionState.pendingPumpContext.map(s => `- ${s}`).join('\n')}\n`;
      if (opts.consumePumpContext) sessionState.pendingPumpContext = [];
    }

    const activeTerms = getInstructorActiveTerms(character, recentMessagesChat);
    if (activeTerms.length > 0) {
      systemPrompt += '\n' + substituteVars(reminderEngine.buildReminderPrompt(activeTerms, 'Known Terms'));
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
      getSharedLibraryTermEntries(character),
      recentMessagesChat
    );
    if (activeRemindersChat.length > 0) {
      systemPrompt += '\n' + substituteVars(reminderEngine.buildReminderPrompt(activeRemindersChat, 'Active Lore'));
    }
  }

  // Author note is injected into the chat history at configurable depth (see below),
  // not appended to the system prompt.

  // Canonical primary-pump run state — every message, both card modes.
  systemPrompt += primaryPumpStateLine(playerName);

  // Add LLM device control instructions if enabled
  if (settings?.globalCharacterControls?.allowLlmDeviceControl) {
    const globalMax = settings.globalCharacterControls.llmDeviceControlMaxSeconds || 30;
    const charLimits = getCharacterLimits(character);
    const capacityMod2 = settings.globalCharacterControls?.autoCapacityMultiplier || sessionState.capacityModifier || 1.0;
    const scaledMaxOn2 = charLimits?.llmMaxOnDuration ?? 5;
    const maxSeconds = charLimits ? Math.min(globalMax, scaledMaxOn2) : globalMax;
    systemPrompt += buildDeviceControlInstruction(settings.llm?.promptTemplate, maxSeconds, charLimits, capacityMod2, playerName);
  }

  // Inject personality attributes if rolled
  if (sessionState.activeAttributes?.length > 0) {
    systemPrompt += buildAttributeBlock(sessionState.activeAttributes);
  }
  systemPrompt += buildInflationDispositionContext(character);
  systemPrompt += buildPumpReadyDirective(character, activePersona); // who may be described being inflated

  // Inject checkpoints at end of system prompt (recency = higher priority for LLM)
  refreshRangePumpGates(character); // stash this range's pump limit-switches for the pump-on paths
  const checkpointChat = getActiveCheckpoint(character, sessionState.capacity);
  // (removed) preInflation block — always null since the 0% gate became Pre-Fill/Gated Intro.
  if (checkpointChat?.text) {
    console.log(`[Checkpoints] Injecting PLAYER checkpoint at ${sessionState.capacity}%: ${checkpointChat.text.substring(0, 60)}...`);
    systemPrompt += `\n=== MANDATORY — PLAYER INFLATION STAGE DIRECTION (${sessionState.capacity}%) ===\nYou MUST follow this guidance for the player's current inflation level. Do NOT describe inflation beyond what ${sessionState.capacity}% represents:\n${substituteVars(checkpointChat.text)}\n=== END STAGE DIRECTION ===\n`;
  }
  systemPrompt += manualPumpBatchBlock(checkpointChat);

  const charCheckpointChat = getActiveCharacterCheckpoint(character);
  if (charCheckpointChat) {
    console.log(`[Checkpoints] Injecting CHARACTER checkpoint at ${sessionState.characterCapacity}%: ${charCheckpointChat.substring(0, 60)}...`);
    systemPrompt += `\n=== MANDATORY — ${character.name.toUpperCase()}'S INFLATION STAGE DIRECTION (${sessionState.characterCapacity}%) ===\nYou MUST follow this guidance for ${character.name}'s current inflation level. Do NOT describe their inflation beyond what ${sessionState.characterCapacity}% represents:\n${substituteVars(charCheckpointChat)}\n=== END STAGE DIRECTION ===\n`;
  }

  // Checkpoint injections rolled for this generation (pop-up stage events)
  systemPrompt += checkpointInjectionsBlock();

  // In-reply verbatim wraps queued this turn (tree ai_message prepend/append): let the model see
  // the fixed frame it will be wrapped in. Non-consuming — the reply finalize applies the wraps.
  {
    const w = sessionState.pendingReplyWraps;
    if (w && (w.pre.length || w.app.length)) systemPrompt += wrapAwarenessNote(w.pre.join('\n'), w.app.join('\n'));
  }

  // Gated-intro directive (no pumping) — tree-based intro, then legacy Pre-Fill
  systemPrompt += introBlock(character);
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
  // opts.ignoreHistory (the AI-message action's "Ignore Chat History" tickbox): generate from the
  // card + guidance alone — no transcript and no rolling summary of it.
  const recentMessages = opts.ignoreHistory ? [] : sessionState.chatHistory.slice(-effectiveDepth);
  let prompt = '';

  // Inject rolling summary of older messages if available
  if (sessionState.chatMemorySummary && !opts.ignoreHistory) {
    prompt += `[Summary of earlier conversation: ${sessionState.chatMemorySummary}]\n\n`;
  }

  // Example dialogues: legacy cards carry them top-level; cards authored in the unified editor
  // store them on the active story. Prefer top-level, fall back to the story, so both reach the
  // prompt. For group cards each entry's blended reply (ex.response/ex.character) is injected
  // verbatim — multiple members' lines in one block ("dialog" + *actions*), no per-name prefix.
  const ctxStory = character?.stories?.find(s => s.id === character.activeStoryId) || character?.stories?.[0];
  const exampleDialoguesSrc = (Array.isArray(character.exampleDialogues) && character.exampleDialogues.length)
    ? character.exampleDialogues
    : (ctxStory?.exampleDialogues || []);

  if (exampleDialoguesSrc.length > 0) {
    if (character.multiChar?.enabled) {
      exampleDialoguesSrc.forEach(ex => {
        prompt += `<START>\n${playerLabel}: ${substituteVars(ex.user)}\n${substituteVars(ex.response || ex.character)}\n`;
      });
    } else {
      exampleDialoguesSrc.forEach(ex => {
        prompt += `<START>\n${playerLabel}: ${substituteVars(ex.user)}\n${character.name}: ${substituteVars(ex.character)}\n`;
      });
    }
    prompt += '\nCurrent conversation:\n';
  }

  const history = buildHistoryRepresentations(recentMessages, {
    playerName: playerLabel,
    characterName: effectiveCharName,
    isPlayerVoice: false,
    // Instructors hide the Author's Note field (it's swapped for the instructor prompt), so don't
    // inject the global RP-flavored default into their terse, on-mission context.
    authorNote: isInstructor(character) ? '' : (character?.authorsNote ?? settings?.globalPrompt),
    authorNoteDepth: settings?.llm?.authorNoteDepth ?? 4,
  });
  prompt += history.flat;

  // Instructors get no RP-flavored physical-state preface (they already have a terse capacity line).
  const statePreface = isInstructor(character) ? '' : buildStatePreface(playerLabel, character.name, character);

  if (character.multiChar?.enabled) {
    // Analyze recent speaker frequency to encourage diversity (skip in solo mode — the quiet-member
    // hint contradicts the "write ONLY as X" constraint the solo prompt already imposes).
    const chars = sessionState.soloSpeaker ? null : character.multiChar.characters;
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
    prompt += statePreface;
    prompt += `[Characters]:`;
  } else {
    prompt += statePreface;
    prompt += `${character.name}:`;
  }

  // Build stop sequences to prevent role confusion (like SillyTavern's names_as_stop_strings). Include
  // BOTH the resolved persona name AND the literal [Player]: macro — the globalPrompt trains models on
  // the [Player]:/[Char]: format, so a model that writes "[Player]: <line>" (rather than "Cora: <line>")
  // would otherwise slip a persona turn through unstopped → "characters speaking for the persona".
  const stopSequences = [
    `\n${playerLabel}:`,
    `${playerLabel}:`,
    `\n[Player]:`,
    `[Player]:`,
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
  if (exampleDialoguesSrc.length > 0) {
    if (character.multiChar?.enabled) {
      exampleDialoguesSrc.forEach(ex => {
        leadIn.push(`<START>\n${playerLabel}: ${substituteVars(ex.user)}\n${substituteVars(ex.response || ex.character)}`);
      });
    } else {
      exampleDialoguesSrc.forEach(ex => {
        leadIn.push(`<START>\n${playerLabel}: ${substituteVars(ex.user)}\n${character.name}: ${substituteVars(ex.character)}`);
      });
    }
  }
  if (leadIn.length > 0) {
    messages.push({ role: 'user', content: leadIn.join('\n') });
  }
  // Conversation turns + author note at depth (from the shared helper).
  messages.push(...history.messages);
  // Final state preface as a system-style instruction at depth 0 (right before generation).
  if (statePreface) messages.push({ role: 'user', content: statePreface.trim() });

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
  const instructor = isInstructor(character);

  // Guidance at DEPTH 0, in the same "=== MANDATORY ===" shape the model already
  // obeys for checkpoints. Mistral/Tekken-family models weight the most recent
  // instruction far above the system block, so this must sit right before the
  // primer (and as the final chat message) — not buried in the system prompt.
  // Statement + explicit prohibition (v6.7.6 lesson): "center on X" reads as a theme and drifts;
  // naming the escape hatches — postpone/summarize/substitute — and forbidding them is what makes
  // the model actually perform the direction instead of gesturing at it.
  // INSTRUCTOR cards get their own wording: "act this out / in character / depict" is roleplay
  // language, and at depth 0 it outweighs the instructor style anchor — guided responses came out
  // as a human performing *actions* instead of the computerized agent. Same enforcement shape,
  // agent voice restated inside the note itself.
  const directive = instructor
    ? `\n=== MANDATORY — DIRECTOR'S NOTE FOR THIS REPLY ===\n${subject} next message MUST carry out this direction as the MAIN CONTENT of the reply, now:\n"${guidanceText}"\nThis is a hard requirement: do NOT postpone it, summarize it, water it down, or substitute something similar. Deliver it in your normal operating voice — a computerized agent speaking aloud: direct statements, commands, and answers. No "quoted dialogue", no *asterisk actions*, no narration, no roleplay prose, no human mannerisms. Do NOT quote or mention this note.\n=== END NOTE ===\n`
    : `\n=== MANDATORY — DIRECTOR'S NOTE FOR THIS REPLY ===\n${subject} next message MUST act this out as the MAIN EVENT of the reply, happening now:\n"${guidanceText}"\nThis is a hard requirement, not a theme: depict it explicitly, in character. Do NOT postpone it, summarize it, water it down, or substitute something similar. Everything else in the reply is secondary to it. Stay in character. Do NOT quote or mention this note.\n=== END NOTE ===\n`;

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

  // Reinforcement in the system block too (helps ChatML-style models). This lands AFTER the final
  // style anchor, so for instructors it must not reintroduce roleplay verbs — and the agent-voice
  // anchor is re-asserted so the last line of the system block stays the instructor style.
  context.systemPrompt += instructor
    ? `\n[MANDATORY director's note — the next reply must explicitly carry out: ${guidanceText}]\nRespond ONLY as the instructor speaking aloud: direct commands, corrections, and answers. No "quoted dialogue", no *asterisk actions*, no narration, no prose.`
    : `\n[MANDATORY director's note — the next reply must explicitly act out: ${guidanceText}]`;
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

  // Per-character session continuity. On a character switch: save the OUTGOING character's chat,
  // fully clear the live context (so nothing bleeds across), then EITHER restore the incoming
  // character's most-recent saved chat (default) OR leave it cleared for a fresh start when the
  // "Use Begins New Chat Session" toggle is on (the client then calls /api/session/reset).
  let switchRestored = false;
  const startFreshOnSwitch = !!settings.globalCharacterControls?.startNewSessionOnSelect;
  if (charChanged) {
    if (oldSettings.activeCharacterId) saveCharSession(oldSettings.activeCharacterId);
    clearSessionContextForSwitch();
    if (!startFreshOnSwitch && settings.activeCharacterId) {
      const snap = loadCharSession(settings.activeCharacterId);
      if (snap && Array.isArray(snap.chatHistory) && snap.chatHistory.length) {
        sessionState.capacity = snap.capacity || 0;
        sessionState.pain = snap.pain || 0;
        sessionState.emotion = snap.emotion || 'neutral';
        sessionState.chatHistory = snap.chatHistory;
        sessionState.chatMemorySummary = snap.chatMemorySummary || null;
        sessionState.chatMemorySummaryUpTo = snap.chatMemorySummaryUpTo || 0;
        sessionState.flowVariables = snap.flowVariables || {};
        eventEngine.variables = { ...(snap.flowVariables || {}) }; // keep the canonical [CharVar:] map in step with the restore
        switchRestored = true;
      }
    }
    if (!switchRestored) {
      // Fresh start for this character: reset capacity to the active story's starting value.
      const _chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const _ch = _chars.find(c => c.id === settings.activeCharacterId);
      const _st = _ch?.stories?.find(s => s.id === _ch.activeStoryId) || _ch?.stories?.[0];
      sessionState.capacity = _st?.startingCapacity || 0;
      sessionState.pain = 0;
      seedCharVariables(_ch); // Character Variables load their defaults with the new session
    }
    // Set the pre-inflation gate for the NEW character (mirrors /api/session/reset). Without this,
    // a switch inherits a stale gate from a previous instructor/intro/pre-fill session, which would
    // silently strip every model [pump on] to off-only on a standard/group card.
    const gChars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const gChar = gChars.find(c => c.id === settings.activeCharacterId);
    const gStory = gChar?.stories?.find(s => s.id === gChar.activeStoryId) || gChar?.stories?.[0];
    // Only a deliberate gated-intro tree / Pre-Fill keeps the pump gate closed. Standard, group,
    // AND instructor cards all start UNGATED so the AI's first [pump on] activates devices (an
    // instructor with prereqs no longer deadlocks: it was blocking [pump on], but capacity can't
    // rise without pumping, so it never opened).
    if (sessionState.capacity > 0) {
      sessionState.preInflationGateMet = true;
    } else if (gChar && (hasIntroTree(gChar) || getPreFillConfig(gChar))) {
      sessionState.preInflationGateMet = false;            // gated intro / pre-fill keeps it closed
    } else {
      sessionState.preInflationGateMet = true;             // standard / group / instructor → ungated
    }
    broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: sessionState.preInflationGateMet });
  }

  if (charChanged || personaChanged) {
    // Update sessionState names for variable substitution
    if (charChanged && settings.activeCharacterId) {
      const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
      sessionState.characterName = activeCharacter?.name || null;
      // Sync the card's effective auto-reply (active story → card fallback; instructor default on)
      sessionState.autoReply = resolveCardAutoReply(activeCharacter);
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
    if (personaChanged) {
      // Checkpoint-trigger fired-ranges are not persona-scoped, so a new persona would otherwise
      // inherit the outgoing persona's already-fired ranges (their triggers suppressed all session).
      firedCheckpointTriggers.clear();
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
      // Member mock pumps never survive a character switch — their ids belong to the old card.
      stopAllMemberInflation();
      // Member capacities belong to the previous card's members — always reset on switch
      sessionState.memberCapacities = {};
      broadcast('member_capacity_update', { memberCapacities: {} });
    }

    if (charChanged || personaChanged) {
      broadcast('flow_assignments_update', sessionState.flowAssignments);
    }

    activateAssignedFlows();
  }

  // Broadcast masked settings to clients
  broadcast('settings_update', maskSettingsForResponse(settings));

  // Push the cleared/restored chat to the client so the view reflects the switch immediately.
  if (charChanged) broadcast('session_loaded', sessionState);

  // Send the welcome message on a fresh switch (no restored chat) UNLESS the client is starting a
  // new session itself (toggle on → it calls /api/session/reset, which sends the welcome there).
  if (charChanged && !startFreshOnSwitch && !switchRestored && sessionState.chatHistory.length === 0 && settings.activeCharacterId) {
    // Use per-char storage if active, otherwise fall back to legacy
    const characters = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
    const activeCharacter = characters.find(c => c.id === settings.activeCharacterId);
    if (activeCharacter) {
      await sendWelcomeMessage(activeCharacter, decryptSettings(settings));
    }
  }

  res.json(maskSettingsForResponse(settings));
});

// Flow engine removed (E3). The auto-activation entry point survives as a no-op because
// session-lifecycle paths still call it; flows never execute.
function activateAssignedFlows() {}
app.post('/api/settings/llm', (req, res) => {
  const settings = loadData(DATA_FILES.settings) || DEFAULT_SETTINGS;
  // The client receives masked (blank) API keys, so it sends '' when a key field is untouched.
  // Dropping empty key fields prevents a save from wiping the stored key.
  const incoming = { ...req.body };
  for (const k of ['openRouterApiKey', 'hordeApiKey', 'apiKey']) {
    if (incoming[k] === '' || incoming[k] == null) delete incoming[k];
  }
  settings.llm = { ...settings.llm, ...incoming };

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
  res.json(maskSettingsForResponse(settings).llm); // never echo the plaintext key back
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
const MAX_LOOP_ITERS = 1000; // hard cap on a `repeat` container's iterations
const TREE_STUB_TYPES = new Set(); // (repeat now implemented; fire_tree/fire_flow shipped earlier)

// ---- Cancel Current support ----
// Every TOP-LEVEL runTree entry (a scope start OR a resume continuation) registers a shared
// cancellation flag on its ctx; nested frames (containers, fire_tree hops, goto re-entries)
// inherit the same object. A cancel_current block marks every OTHER registered flag cancelled —
// each run then aborts at its next node boundary (a node mid-LLM-generation finishes first).
const activeTreeRuns = new Set(); // Set<{cancelled, treeId, scopeKey}>
let triggerSeqEpoch = 0; // bumped by cancel_current; an executing checkpoint sequence re-checks it per step

// The cancel_current tree block: abort every OTHER in-flight tree run and executing checkpoint
// sequence, void every suspended continuation (choice/multi/select-member/input/minigame/wait/
// ">>"/await/Fire%), and dismiss their blocking popups. The run that contains the block
// (ctx.runFlag) survives and continues.
function cancelOtherTreeWork(ctx) {
  let aborted = 0;
  for (const flag of activeTreeRuns) {
    if (flag !== ctx.runFlag && !flag.cancelled) { flag.cancelled = true; aborted++; }
  }
  triggerSeqEpoch++; // executing fireTriggerSequenceInner loops stop at their next step
  sessionState.pendingTreeChoice = null;
  sessionState.pendingTreeResume = null;
  sessionState.pendingTreeGame = null;
  sessionState.pendingTreeNext = null;
  sessionState.pendingCheckpointChoice = null;
  sessionState.pendingRangeAwait = null;
  sessionState.pendingCapacityGate = null;
  broadcast('checkpoint_choice_clear', {}); // dismisses choice/multi/select-member/input popups
  broadcast('tree_minigame_clear', {});     // closes an open tree-called minigame
  broadcast('next_gate', { active: false });
  broadcast('await_state', null);
  broadcast('capacity_gate', { active: false });
  console.log(`[Tree] Cancel Current — aborted ${aborted} other run(s); all pending gates/popups cleared`);
}

// A tree hit a suspension point (choice/popup/wait/game/next) whose single channel is already
// armed by ANOTHER run. The new suspension can't arm, so the rest of that branch is dropped when
// the suspend bubbles out with nothing to capture it. This used to be completely silent — now
// the author sees it in the console AND as an on-screen toast, so "my tree just stopped" is
// diagnosable. Returns the suspend sentinel so guard sites stay one-liners.
function suspendCollision(kind, ctx) {
  const msg = `Tree '${ctx.treeId}' (${ctx.scopeKey}) hit a ${kind} while another is already active — that branch stopped there.`;
  console.warn(`[Tree] SUSPEND COLLISION: ${msg}`);
  try { broadcast('trigger_toast', { text: `⚠ ${msg}`, preset: 'amber' }); } catch (e) { /* pre-broadcast boot */ }
  return { __control: 'suspend', reason: kind };
}

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

// Sibling of latestPlayerText for ai_speaks event bindings (Phase 4): the AI's last output.
function latestAiText() {
  const hist = sessionState.chatHistory || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const m = hist[i];
    if (m && (m.sender === 'ai' || m.sender === 'assistant' || m.sender === 'character')) return m.content || m.text || '';
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
  // Who has to say the keyword: player (default), character (the AI's last message), or either.
  const who = node.params?.speaker || 'player';
  const hitPlayer = (who === 'player' || who === 'either') && reminderEngine._matchKeys(entry, latestPlayerText());
  const hitChar = (who === 'char' || who === 'character' || who === 'either') && reminderEngine._matchKeys(entry, latestAiText());
  return !!(hitPlayer || hitChar);
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
  if (type === 'goto_if') { // conditional jump — sugar for If → branch → Go To in one leaf
    if (!node.params?.name) return;
    let pass = false;
    try { pass = evalTreeCondition(node.params?.condition); }
    catch (e) { console.error('[runTree] goto_if condition failed:', e?.message || e); }
    if (!pass) return; // condition false → fall through, no once consumed (keeps re-checking like a gate)
    if (node.once) markTreeOnce(node, ctx); // jumping IS the effect; a once goto_if jumps once per session
    return { __control: 'goto', name: node.params.name };
  }

  // ----- fire_tree: run another library tree as a subroutine (cycle-guarded recursion) -----
  if (type === 'fire_tree') {
    const targetId = node.params?.treeId;
    if (!targetId) { console.warn(`[runTree] fire_tree node ${node.id} has no treeId`); return; }
    if (ctx.visited.has(targetId)) { console.warn(`[runTree] fire_tree cycle: '${targetId}' already on the stack — skipping`); return; } // skip, do not consume once
    const target = (ctx.treeIndex || buildTreeIndex(ctx.character)).get(targetId);
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
      rootNodes: target.nodes, // re-root the resume-goto anchor too — the fired tree's own top level
      labels: new Map() // labels are scope-local — fired tree gets a fresh frame
    };
    return await runTree(target.nodes, child); // inherits delivery/character/settings/firedSet; sentinels bubble
  }

  // ----- fire_flow: RETIRED (flow engine removed, E3). Legacy trees may still carry the node —
  // warn-skip so they keep running; the editor shows a retirement hint on these blocks. -----
  if (type === 'fire_flow') {
    console.warn(`[runTree] fire_flow node ${node.id} skipped — the flow engine was removed; rebuild as a trigger tree`);
    return;
  }

  // ----- call_minigame: suspend the tree to play a MiniGame, resume on the fired exit (Phase 5) -----
  // Leaf action (no option bodies): the player plays the game, then GameResult/GameWinner Flow vars
  // are set and the bound goto (if any) repositions in the same-level continuation. Mirrors the
  // player_choice suspend plumbing but on its own pendingTreeGame channel (resume: resumeTreeGame).
  if (type === 'call_minigame') {
    if (sessionState.pendingTreeGame || sessionState.pendingTreeChoice) return suspendCollision('call_minigame', ctx);
    const gameId = node.params?.miniGameId;
    // Master list first (live edits win on the author's machine), then the card's baked copies
    // (character.miniGames — how an imported card's games resolve without touching the master list).
    const game = gameId
      ? ((loadMiniGames().games || []).find(g => g.id === gameId) || (ctx.character?.miniGames || []).find(g => g.id === gameId))
      : null;
    if (!game) { console.warn(`[runTree] call_minigame node ${node.id}: miniGameId '${gameId}' not found — skipping`); return; } // no game -> clean fall-through, no once
    markTreeOnce(node, ctx); // presenting the game IS the effect
    sessionState.pendingTreeGame = {
      miniGameId: gameId,
      exitGotos: node.params?.exitGotos || {},
      ctxSnapshot: {
        // childDepth = ctx.depth (NOT +1): the continuation runs at the call node's OWN level.
        treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth,
        delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
      },
      after: null // innermost sibling tail, filled by runTree as the suspend bubbles
    };
    tlRecord('game', { name: game.name });
    broadcast('tree_minigame', { gameId, type: game.type, name: game.name, config: game.config || {} });
    return { __control: 'suspend', reason: 'call_minigame' };
  }

  // ----- wait: a sequence "spacer" — defer the rest of this branch N reply turns, then continue.
  // Reuses the pause_resume channel with an EMPTY body (no children), so after the wait only the
  // captured same-level continuation runs. Lets an author force a gap between triggers. -----
  if (type === 'wait') {
    if (sessionState.pendingTreeResume) return suspendCollision('wait', ctx);
    const n = Math.max(1, Number(node.params?.messages ?? 1) || 1);
    markTreeOnce(node, ctx);
    sessionState.pendingTreeResume = {
      remaining: n,
      body: [], // no body — only the same-level continuation resumes
      ctxSnapshot: {
        treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth,
        delivery: ctx.delivery || 'inReply', source: ctx.source, visited: Array.from(ctx.visited || [])
      },
      after: null
    };
    return { __control: 'suspend', reason: 'wait' };
  }

  // ----- next_button: force a ">>" (Next) hold at this point — everything after this block waits
  // until the player presses Next. Rides the same pendingTreeNext channel as the auto-gate between
  // back-to-back generated messages, so the >> button lights and next_gate_advance resumes; the
  // suspend handler in runTree captures the continuation + rootNodes for backward gotos. -----
  if (type === 'next_button') {
    if (sessionState.pendingTreeNext) return suspendCollision('next-button', ctx);
    markTreeOnce(node, ctx);
    sessionState.pendingTreeNext = {
      ctxSnapshot: {
        treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth,
        delivery: 'standalone', // resumes OUTSIDE a generation — inReply would have nothing to weave into
        source: ctx.source, visited: Array.from(ctx.visited || [])
      }
    };
    broadcast('next_gate', { active: true });
    console.log('[Tree] Next Button block — holding until the player presses >>');
    return { __control: 'suspend', reason: 'next-button' };
  }

  // ----- cancel_current: abort every OTHER running trigger tree / checkpoint sequence and close
  // their popups (Player Choice, Player Input, Select Member, MiniGame, ">>"/await/Fire% gates).
  // THIS tree keeps running — place it first so the tree claims the session before doing its work. -----
  if (type === 'cancel_current') {
    markTreeOnce(node, ctx);
    cancelOtherTreeWork(ctx);
    return;
  }

  // ----- checkpoint_control: session-scoped on/off for a checkpoint range group, the Event
  // Triggers group, or All. Overrides the card's saved toggles until session reset — so a
  // long-running endgame tree can silence range/event interference (or re-arm it later).
  // Turning a group OFF also drops any await/Fire% sequence that group left pending. -----
  if (type === 'checkpoint_control') {
    markTreeOnce(node, ctx);
    const mode = node.params?.mode === 'on' ? 'on' : 'off';
    const target = node.params?.target || 'all';
    const cc = sessionState.checkpointControl = sessionState.checkpointControl || { ranges: {}, events: null };
    if (target === 'all') {
      for (const k of CHECKPOINT_RANGE_KEYS) cc.ranges[k] = mode;
      cc.events = mode;
    } else if (target === 'events') {
      cc.events = mode;
    } else if (CHECKPOINT_RANGE_KEYS.includes(target)) {
      cc.ranges[target] = mode;
    } else {
      console.warn(`[Tree] checkpoint_control: unknown target '${target}' — skipping`);
      return;
    }
    if (mode === 'off') {
      // Kill in-flight interference from the silenced group(s): a paused await gate or queued
      // Fire% sequence whose source range is now off must not resume later.
      const hits = (src) => target === 'all' || (target !== 'events' && rangeKeyOfSource(src) === target);
      const pa = sessionState.pendingRangeAwait;
      if (pa && hits(pa.source)) {
        sessionState.pendingRangeAwait = null;
        broadcast('await_state', null);
        if (pa.kind === 'next' || pa.kind === 'next-individual') broadcast('next_gate', { active: false });
        console.log(`[Tree] Checkpoint Control — dropped the pending await gate from ${pa.source}`);
      }
      const cg = sessionState.pendingCapacityGate;
      if (cg && hits(cg.source)) {
        sessionState.pendingCapacityGate = null;
        broadcast('capacity_gate', { active: false });
        console.log(`[Tree] Checkpoint Control — dropped the queued Fire% sequence from ${cg.source}`);
      }
    }
    console.log(`[Tree] Checkpoint Control — ${target === 'all' ? 'ALL groups' : target === 'events' ? 'Event Triggers' : `range ${target}`} → ${mode.toUpperCase()} (session override)`);
    return;
  }

  // ----- event_toggle: session-scoped on/off for ONE named event trigger or All of them.
  // Overrides the bindings' own enabled tickboxes until session reset (mirror of
  // checkpoint_control, but per-binding by the author-given event name). -----
  if (type === 'event_toggle') {
    markTreeOnce(node, ctx);
    const mode = node.params?.mode === 'on' ? 'on' : 'off';
    const target = String(node.params?.target || 'all').trim();
    const ov = sessionState.eventTriggerOverrides = sessionState.eventTriggerOverrides || { all: null, byName: {} };
    if (!target || target.toLowerCase() === 'all') {
      ov.all = mode;
      ov.byName = {}; // an All ruling supersedes earlier per-name overrides
    } else {
      ov.byName[target] = mode;
    }
    console.log(`[Tree] Event Trigger Toggle — ${!target || target.toLowerCase() === 'all' ? 'ALL event triggers' : `'${target}'`} → ${mode.toUpperCase()} (session override)`);
    return;
  }

  // ----- end_intro: leave the gated intro phase, open the pump gate, optionally load a profile (Part 4) -----
  if (type === 'end_intro') {
    markTreeOnce(node, ctx);
    setIntroActive(false); // intro is logically done (stop re-running its tree)
    // Prose pump guidance after the intro: on unless the card opted out ("Enable prose pump
    // guidance after Intro" unchecked). Applies once the gate actually opens (incl. after GO!).
    const introStory = ctx.character?.stories?.find(s => s.id === ctx.character.activeStoryId) || ctx.character?.stories?.[0];
    sessionState.prosePumpGuidanceOff = prosePumpAfterIntroOff(ctx.character, introStory);
    const profId = node.params?.loadProfileId || '';
    // Manual-release ("GO!") gate: keep the pump gate CLOSED and wait for a player button press
    // before opening it / loading the profile / entering checkpoints. Prevents premature pumping
    // during long buildups if the wrong keywords land. The stashed profile loads on the GO! press.
    if (node.params?.manualRelease) {
      sessionState.preInflationGateMet = false;
      sessionState.awaitingGoRelease = true;
      sessionState.pendingGoProfileId = profId || null;
      broadcast('gate_release_state', { awaitingGoRelease: true });
      broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: false });
      console.log('[Intro] end_intro (manual) → awaiting GO! press before opening the pump gate');
      return;
    }
    sessionState.preInflationGateMet = true;
    if (profId) {
      sessionState.activeCheckpointProfileId = profId; // jump straight into this checkpoint profile
      try { applyActivePumpType(ctx.character); } catch (e) { /* best-effort */ }
    }
    broadcast('capacity_update', { capacity: sessionState.capacity, preInflationGateMet: true });
    console.log(`[Intro] end_intro → gate open${profId ? `, loaded profile ${profId}` : ''}`);
    // Checkpoints engage NOW, not on the next reply: fire the active range tree(s) for the current
    // gauge (post-profile-load, so a loaded profile's range fires). Delivery inherits this run's —
    // a standalone intro posts instantly; an in-reply end_intro weaves into the same turn.
    if (checkpointsEnabledFor(ctx.character)) {
      try { await runActiveRangeTrees(ctx.character, ctx.settings, ctx.treeIndex || buildTreeIndex(ctx.character), { delivery: ctx.delivery || 'standalone' }); }
      catch (e) { console.error('[Intro] end_intro range-tree fire failed:', e?.message || e); }
    }
    return;
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
          deliverTreeMsg(p.context, p.llmEnhance, p);
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

      case 'switch': {
        // Switch/Case: resolve the switch VALUE (substitutions collapse first — [CharVar:x],
        // [SelectedChar], [Capacity], …), then run the FIRST case whose match value equals it:
        // numeric compare when both sides parse numeric, else case-insensitive trimmed string
        // (mirrors evalTreeCondition '=='). A case flagged default catches everything a literal
        // case didn't, wherever it sits. No match and no default → run nothing, fall through.
        const cases = (node.children || []).filter(c => c && c.type === 'case');
        if (!cases.length) return;
        // A bare name (no brackets) means a CharVar — lets authors switch on a variable that
        // doesn't exist yet. Unset CharVars leave the tag unresolved → no literal case matches
        // → the Default case (if any) catches it.
        const rawVal = String(node.params?.value ?? '').trim();
        const expr = rawVal && !rawVal.includes('[') ? `[CharVar:${rawVal}]` : rawVal;
        const valR = String(eventEngine.substituteVariables(expr)).trim();
        const vn = parseFloat(valR);
        const hit = cases.find(c => {
          if (c.params?.default === true) return false; // literal cases win over the default
          const m = String(eventEngine.substituteVariables(String(c.params?.match ?? ''))).trim();
          const mn = parseFloat(m);
          const bothNum = !isNaN(vn) && !isNaN(mn) && valR !== '' && m !== '';
          return bothNum ? vn === mn : valR.toLowerCase() === m.toLowerCase();
        }) || cases.find(c => c.params?.default === true);
        if (!hit) return; // once not consumed — the switch retries next walk
        const child = enterChild(node, ctx); // once on the switch consumed only when a case runs
        if (!child) return;
        return await runTree(hit.children || [], child); // sentinels (suspend/goto) bubble
      }

      case 'keyword_gate': {
        if (!treeKeywordMatches(node)) return;
        if (node.params?.suppressReply === true) sessionState.suppressReplyThisTurn = true; // tree owns this turn — no AI auto-response // closed gate does not consume once
        const child = enterChild(node, ctx);
        if (!child) return;
        return await runTree(node.children || [], child);
      }

      case 'player_choice': {
        // Re-entrancy guard: if a tree choice is already armed (the walker may re-run before the
        // click), suspend again without clobbering it.
        if (sessionState.pendingTreeChoice) return suspendCollision('player_choice', ctx);
        const opts = (node.children || [])
          .filter(c => c && c.kind === 'container' && c.type === 'choice' && c.params?.label)
          .slice(0, 4);
        if (!opts.length) return; // nothing to present — clean fall-through, do not consume once/suspend
        markTreeOnce(node, ctx); // presenting IS the effect; a once choice presents once per session
        sessionState.pendingTreeChoice = {
          // gotoName: the option's built-in "then go to" — resolved in resumeTreeChoice after the body runs
          choices: opts.map(c => ({ id: c.id, label: c.params.label, body: c.children || [], gotoName: c.params?.gotoName || null })),
          ctxSnapshot: {
            treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth + 1,
            delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
          },
          after: null // innermost sibling tail, filled by runTree as the suspend bubbles
        };
        broadcast('checkpoint_choice', {
          description: node.params?.prompt || '',
          choices: opts.map(c => ({ id: c.id, label: c.params.label })),
          tree: true,
          addRandom: !!node.params?.addRandom, // popup shows a "Random" button that picks one option as if clicked
          addCancel: !!node.params?.addCancel  // popup shows a "Cancel" button that aborts the whole tree run
        });
        return { __control: 'suspend', reason: 'player_choice' };
      }

      case 'choose_multi': {
        // Multi-select sibling of player_choice: the player checks any subset; on confirm EVERY
        // picked option's body runs (in author order), then the same-level fall-through. Reuses
        // the pendingTreeChoice suspend plumbing (marked multi) so the scope-blocking + after-
        // capture machinery is shared; resume routes to resumeTreeChooseMulti.
        if (sessionState.pendingTreeChoice) return suspendCollision('choose_multi', ctx);
        const opts = (node.children || [])
          .filter(c => c && c.kind === 'container' && c.type === 'choice' && c.params?.label)
          .slice(0, 8);
        if (!opts.length) return; // nothing to present — clean fall-through, do not consume once/suspend
        markTreeOnce(node, ctx); // presenting IS the effect
        sessionState.pendingTreeChoice = {
          multi: true,
          choices: opts.map(c => ({ id: c.id, label: c.params.label, body: c.children || [] })),
          ctxSnapshot: {
            treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth + 1,
            delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
          },
          after: null
        };
        broadcast('tree_choose_multi', { description: node.params?.prompt || '', choices: opts.map(c => ({ id: c.id, label: c.params.label })) });
        return { __control: 'suspend', reason: 'choose_multi' };
      }

      case 'select_member': {
        // Popup member picker — GROUP MODE ONLY. Suspends the tree; OK stores the pick's NAME in
        // [SelectedChar] and runs the body + same-level continuation, Cancel ABORTS the entire
        // tree run (body and continuation are discarded). Single mode: skip silently (children
        // too, once not consumed) — [SelectedChar] already resolves to the base char there.
        const smAll = ctx.character?.multiChar?.characters || [];
        if (!(ctx.character?.multiChar?.enabled && smAll.length > 1)) return;
        const smList = (node.params?.pumpableOnly ? smAll.filter(m => m?.isPumpable) : smAll).filter(m => m?.name);
        if (!smList.length) { console.warn(`[runTree] select_member node ${node.id}: no eligible members — skipping`); return; }
        if (node.params?.pumpableOnly && smList.length === 1) {
          // Exactly one eligible pick — no popup: auto-select it and run the body inline, no suspend.
          const child = enterChild(node, ctx); // consumes once, depth-bumps for the body
          if (!child) return;
          sessionState.selectedChar = smList[0].name;
          console.log(`[Tree] Select Member auto-pick (single pumpable member) → [SelectedChar] = ${smList[0].name}`);
          return await runTree(node.children || [], child);
        }
        if (sessionState.pendingTreeChoice) return suspendCollision('select_member', ctx);
        markTreeOnce(node, ctx); // presenting IS the effect
        sessionState.pendingTreeChoice = {
          selectMember: true,
          choices: smList.map(m => ({ id: m.id, label: m.name })),
          body: node.children || [],
          ctxSnapshot: {
            treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth + 1,
            delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
          },
          after: null // innermost sibling tail, filled by runTree as the suspend bubbles
        };
        broadcast('tree_select_member', {
          prompt: node.params?.prompt || '',
          members: smList.map(m => ({ id: m.id, name: m.name, portrait: m.portrait || null }))
        });
        return { __control: 'suspend', reason: 'select_member' };
      }

      case 'player_input': {
        // Popup form: one input row per configured row (label + numbox/text). Suspends the tree;
        // OK stores each row's value as [PlayerInput:Row#] and runs the body + continuation,
        // Cancel ABORTS the entire tree run. Rides the pendingTreeChoice channel like
        // select_member (same scope-blocking + after-capture machinery).
        if (sessionState.pendingTreeChoice) return suspendCollision('player_input', ctx);
        const piRows = (node.params?.rows || []).filter(r => r && typeof r === 'object');
        if (!piRows.length) { console.warn(`[runTree] player_input node ${node.id}: no rows configured — skipping`); return; }
        markTreeOnce(node, ctx); // presenting IS the effect
        sessionState.pendingTreeChoice = {
          playerInput: true,
          rows: piRows.map((r, i) => ({
            n: i + 1,
            label: r.label || `Value ${i + 1}`,
            type: r.type === 'text' ? 'text' : 'num',
            min: Number(r.min ?? 0), max: Number(r.max ?? 100),
            def: r.def ?? '',
            varName: (r.storeVar && (r.varName || '').trim()) ? r.varName.trim() : null // also store as this CharVar
          })),
          body: node.children || [],
          ctxSnapshot: {
            treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth + 1,
            delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
          },
          after: null // innermost sibling tail, filled by runTree as the suspend bubbles
        };
        broadcast('tree_player_input', { prompt: node.params?.prompt || '', rows: sessionState.pendingTreeChoice.rows });
        return { __control: 'suspend', reason: 'player_input' };
      }

      case 'pause_resume': {
        // Defer the rest of THIS tree for N reply turns, then run this node's body + the same-level
        // continuation. Non-blocking: uses pendingTreeResume (NOT pendingTreeChoice) so other scopes
        // keep running this turn. checkPendingTreeResume ticks it down at the top of each reply.
        if (sessionState.pendingTreeResume) return suspendCollision('pause_resume', ctx);
        const n = Math.max(1, Number(node.params?.resumeAfterValue ?? 4) || 4);
        markTreeOnce(node, ctx);
        sessionState.pendingTreeResume = {
          remaining: n,
          body: node.children || [],
          ctxSnapshot: {
            treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth + 1,
            delivery: 'standalone', source: ctx.source, visited: Array.from(ctx.visited || [])
          },
          after: null
        };
        return { __control: 'suspend', reason: 'pause_resume' };
      }

      case 'repeat': {
        const child = enterChild(node, ctx);
        if (!child) return;
        const mode = node.params?.mode === 'until' ? 'until' : 'fixed';
        const body = node.children || [];
        const cap = Math.min(Number(node.params?.maxIterations ?? node.params?.iterations ?? 1) || 0, MAX_LOOP_ITERS);
        for (let i = 0; i < (mode === 'until' ? MAX_LOOP_ITERS : cap); i++) {
          if (mode === 'until' && node.params?.condition && evalTreeCondition(node.params.condition)) break; // stop once the condition holds
          const sig = await runTree(body, child);
          if (sig) return sig; // a suspend/goto inside the loop bubbles out and stops it
          if (mode === 'until' && node.params?.maxIterations && i + 1 >= Number(node.params.maxIterations)) break;
        }
        return;
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
      if (node.params?.suppressReply === true) sessionState.suppressReplyThisTurn = true; // tree owns this turn — no AI auto-response
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
// A tree node that posts a generated AI message (the kind worth gating between back-to-back).
function isTreeMsgNode(n) {
  return !!(n && n.kind === 'action' && (n.type === 'ai_message' || n.type === 'ai_message_member' || n.type === 'impersonate'));
}

// Cancellation wrapper: nested frames of a live run pass straight through (their flag is already
// registered); a top-level entry — runTreeScope, every resume path, a goto re-entry — registers a
// fresh flag so cancel_current can reach it. The finally-dispose keeps the registry leak-free.
async function runTree(nodes, ctx) {
  if (ctx.runFlag && activeTreeRuns.has(ctx.runFlag)) return runTreeInner(nodes, ctx);
  const flag = { cancelled: false, treeId: ctx.treeId, scopeKey: ctx.scopeKey };
  ctx.runFlag = flag;
  activeTreeRuns.add(flag);
  try { return await runTreeInner(nodes, ctx); }
  finally { activeTreeRuns.delete(flag); }
}

async function runTreeInner(nodes, ctx) {
  if (ctx.depth > MAX_TREE_DEPTH) { console.warn('[runTree] max depth exceeded — aborting subtree'); return; }
  if (!Array.isArray(nodes)) return;
  let i = 0, gotoBudget = 0;
  while (i < nodes.length) {
    // A cancel_current in another tree marked this run — abort the whole frame stack. The
    // 'cancelled' sentinel bubbles like any non-goto/non-suspend sentinel: every enclosing
    // frame returns it unchanged, and the resume paths treat it as a hard stop.
    if (ctx.runFlag?.cancelled) {
      console.log(`[Tree] '${ctx.treeId}' (${ctx.scopeKey}) aborted — Cancel Current fired`);
      return { __control: 'cancelled' };
    }
    const node = nodes[i];
    if (!node || typeof node !== 'object') { i++; continue; }

    // WAIT before the FIRST auto-generated (standalone) message — so the player reads the welcome
    // message before the intro's opening message generates. One-shot (ctx.gateFirstMsg is only set on
    // the intro's initial standalone run); any non-message nodes before it (variable-sets, etc.) run
    // first, then the whole remaining tree from this message on is stashed and replays on ">>".
    if (ctx.gateFirstMsg && ctx.delivery === 'standalone' && isTreeMsgNode(node)) {
      ctx.gateFirstMsg = false;
      sessionState.pendingTreeNext = {
        ctxSnapshot: { treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth, delivery: ctx.delivery, source: ctx.source, visited: Array.from(ctx.visited || []) },
        after: nodes.slice(i),
        rootNodes: ctx.rootNodes || nodes
      };
      broadcast('next_gate', { active: true });
      console.log('[Tree] Next gate — holding the intro before its first message (player reads the welcome first); waiting for >>');
      return { __control: 'suspend', reason: 'next-gate-first' };
    }

    let sig;
    try { sig = await runNode(node, ctx); }
    catch (e) { console.error(`[runTree] node ${node?.id}(${node?.type}) failed:`, e?.message || e); i++; continue; }

    // Auto Next-gate: after a just-posted STANDALONE message, if the NEXT node is also a message,
    // hold on the ">>" button so the player reads each before the next generates (same UX as the
    // sequential-trigger and individual-reply next gates). Only standalone delivery posts separate
    // bubbles worth gating; inReply weaves everything into one reply. The suspend handler below stashes
    // the continuation (nodes.slice(i+1)) into pendingTreeNext.after; next_gate_advance resumes it.
    if (!sig && ctx.delivery === 'standalone' && isTreeMsgNode(node) && isTreeMsgNode(nodes[i + 1])) {
      sessionState.pendingTreeNext = {
        ctxSnapshot: { treeId: ctx.treeId, scopeKey: ctx.scopeKey, childDepth: ctx.depth, delivery: ctx.delivery, source: ctx.source, visited: Array.from(ctx.visited || []) }
      };
      broadcast('next_gate', { active: true });
      console.log('[Tree] Next gate — holding before the next back-to-back message; waiting for player >>');
      sig = { __control: 'suspend', reason: 'next-gate' };
    }

    if (sig) {
      if (sig.__control === 'goto') {
        if (!sig.name) { console.warn('[runTree] goto with empty name — skipping'); i++; continue; } // never match a blank label
        const target = nodes.findIndex(n => isGotoTarget(n, sig.name));
        if (target >= 0) {
          if (++gotoBudget > MAX_GOTO_ITERS) { console.warn(`[runTree] goto loop cap hit for '${sig.name}' — aborting frame`); return; }
          i = gotoResumeIndex(nodes, target); // AFTER a Label marker; AT a named Group (so it executes)
          continue;
        }
        return sig; // target not in THIS list — bubble up to an enclosing frame
      }
      if (sig.__control === 'suspend') {
        // Capture the innermost same-level continuation for post-resume fall-through. A choice/
        // choose_multi fills pendingTreeChoice; a pause_resume fills pendingTreeResume; a
        // call_minigame fills pendingTreeGame. Also stash the tree's TOP-LEVEL list: the sliced
        // continuation loses every label behind the suspend point, so backward gotos (e.g. a
        // "replay the minigame" loop) re-enter rootNodes after the resume.
        const pend = sessionState.pendingTreeChoice || sessionState.pendingTreeResume || sessionState.pendingTreeGame || sessionState.pendingTreeNext;
        if (pend && pend.after == null) { pend.after = nodes.slice(i + 1); pend.rootNodes = ctx.rootNodes || nodes; }
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
  // [SelectedChar] resets at the start of EVERY tree run (back to "resolves to the base char"),
  // so trees can reference it unconditionally without inheriting a stale pick from a prior tree.
  // A Select Member node inside this run (or a resume of this run's suspend) re-fills it.
  sessionState.selectedChar = null;
  const treeId = tree.id || `inline:${scopeKey || 'default'}`;
  tlRecord('tree', { tree: tree.name || treeId, scope: scopeKey || 'default' });
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
    gateFirstMsg: !!opts.gateFirstMsg, // one-shot: hold the ">>" gate BEFORE the tree's first standalone
                                       // message (used by the intro so the player reads the welcome first)
    rootNodes: tree.nodes, // the tree's TOP-LEVEL list — resume paths re-enter it on backward gotos
    labels: new Map() // scope-local label/goto frame
  };
  try {
    const sig = await runTree(tree.nodes, ctx);
    // A goto that bubbled out of the top frame names a label that isn't at the tree's top level —
    // a typo or a label buried in a container body. Silent before; surface it for the author.
    if (sig?.__control === 'goto') console.warn(`[runTree] goto label '${sig.name}' not found anywhere up the frame stack of tree '${treeId}' — nothing to jump to`);
  }
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
// ---- Character-card import (E1: extracted to lib/card-import.js) ----
require('./lib/card-import')({ app, cardUpload, cleanupUpload, characterConverter, saveCharacterAsync, saveData, loadData, DATA_FILES, isPerCharStorageActive, broadcastCharacterDelta, writeCharMediaFile, uuidv4 });


// Convert a V2/V3/SwellD character-card file to a SwellD character WITHOUT persisting it.
// Used by the unified editor's "Import V2/V3" member flow to seed a NEW MEMBER from a file
// (the caller cherry-picks identity fields). Mirrors /api/import/character-card's extraction
// + conversion but never saves, so importing a member can't spawn a stray standalone card.
app.post('/api/convert/character-card', cardUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileBuffer = fs.readFileSync(req.file.path); // disk-staged (bare cards are small)
    const fileType = req.file.mimetype;
    let characterData = null;
    let avatarData = null;
    let swelldExportData = null;
    let isSwellDImport = false;

    if (fileType === 'image/png' || fileType === 'image/jpeg') {
      swelldExportData = characterConverter.extractPNGMetadata(fileBuffer, 'swelld');
      if (swelldExportData && swelldExportData.type === 'swelldreams-character') {
        isSwellDImport = true;
        characterData = swelldExportData;
      } else {
        characterData = characterConverter.extractPNGMetadata(fileBuffer, 'v3')
          || characterConverter.extractPNGMetadata(fileBuffer, 'v2');
      }
      if (!characterData) return res.status(400).json({ error: 'No character data found in PNG metadata' });
      if (!isSwellDImport) avatarData = `data:${fileType};base64,${fileBuffer.toString('base64')}`;
    } else if (fileType === 'application/json') {
      try { characterData = JSON.parse(fileBuffer.toString('utf-8')); }
      catch (e) { return res.status(400).json({ error: 'Invalid JSON file' }); }
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Use a .png or .json character card.' });
    }

    let convertedCharacter;
    if (isSwellDImport) {
      convertedCharacter = swelldExportData.data;
      if (convertedCharacter.avatarData) { convertedCharacter.avatar = convertedCharacter.avatarData; delete convertedCharacter.avatarData; }
      else if (!convertedCharacter.avatar) convertedCharacter.avatar = `data:${fileType};base64,${fileBuffer.toString('base64')}`;
    } else {
      const format = characterConverter.detectFormat(characterData);
      convertedCharacter = format === 'v3'
        ? characterConverter.convertV3ToSwellD(characterData)
        : characterConverter.convertV2ToSwellD(characterData);
      if (avatarData) convertedCharacter.avatar = avatarData;
    }
    res.json({ success: true, character: convertedCharacter, format: isSwellDImport ? 'swelld' : (characterConverter.detectFormat(characterData) || 'v2') });
  } catch (error) {
    console.error('[Convert] Character card convert failed:', error.message || error);
    res.status(500).json({ error: error.message || 'Failed to convert character card' });
  } finally { cleanupUpload(req); }
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
  // REPLACE the connection config with the activated profile's settings — do NOT merge over the
  // previously-active profile. Merging leaked stale fields (endpoint type, samplers, model, URL) from
  // the old profile, so the endpoint actually connected to would not match the one selected in the
  // dropdown. Start from DEFAULT_SETTINGS.llm so any field the profile omits still has a sane value.
  // Net effect: the profile chosen in the dropdown IS the connection, exactly, until changed.
  // (detectedModelName is re-detected by detectLlmModel() at the end of this handler.)
  settings.llm = {
    ...(DEFAULT_SETTINGS.llm || {}),
    ...llmSettings,
    activeProfileId: profile.id,
    // Generation reads settings.llm.openRouterApiKey (plaintext working copy) — sync it to this profile.
    openRouterApiKey: openRouterApiKey || '',
  };

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
  // The auth token is only ever revealed to LOCAL requests — the host reads it from Settings and
  // hands it to remote clients out-of-band. Remote clients get the rest of the settings.
  const local = isLocalRequest(req);
  const { authToken, ...pub } = settings;
  res.json({
    ...(local ? settings : pub),
    isLocalRequest: local
  });
});

app.post('/api/remote-settings', (req, res) => {
  // Only allow modifications from localhost
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Remote settings can only be modified from the host machine' });
  }

  const currentSettings = getRemoteSettings();
  const { allowRemote, whitelistedIps, requireToken } = req.body;

  const newSettings = {
    allowRemote: allowRemote !== undefined ? allowRemote : currentSettings.allowRemote,
    whitelistedIps: whitelistedIps !== undefined ? whitelistedIps : currentSettings.whitelistedIps,
    requireToken: requireToken !== undefined ? requireToken === true : currentSettings.requireToken === true,
    authToken: currentSettings.authToken // preserved; minted when the opt-in turns on
  };
  // Turning the token requirement ON mints a token if one doesn't exist yet.
  if (newSettings.requireToken && !newSettings.authToken) {
    newSettings.authToken = require('crypto').randomBytes(24).toString('base64url');
    log.info('Remote token requirement enabled — generated a remote auth token');
  }

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
      broadcastCharacterDelta(savedChar);
      res.json(savedChar);
    } else {
      const characters = loadData(DATA_FILES.characters) || [];
      characters.push(newCharacter);
      saveData(DATA_FILES.characters, characters);
      broadcastCharacterDelta(newCharacter);
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

    // Default characters are READ-ONLY — reject edits (the UI offers "Duplicate to Edit" instead).
    // Guards the API directly so a stale client or a direct call can't mutate a shipped default.
    if (isDefaultCharacterId(req.params.id)) {
      return res.status(403).json({ error: 'Default characters are read-only. Duplicate it to make an editable copy.' });
    }

    if (isPerCharStorageActive()) {
      const existingCharacter = loadCharacter(req.params.id);
      if (!existingCharacter) {
        return res.status(404).json({ error: 'Character not found' });
      }
      const charToSave = { ...existingCharacter, ...req.body, id: req.params.id, updatedAt: Date.now() };
      // Normal editor save → custom/ only (never default/ or the factory tree; defaults are immutable).
      updatedCharacter = await saveCharacterAsync(charToSave, false, false);
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
      const buttonsUpdated = false; // flow-linked auto buttons retired (E3)
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

    // Broadcast just this character (delta shape); reload from disk so image processing
    // (avatar URL rewrites) is reflected, not the raw request body.
    {
      const fresh = (isPerCharStorageActive() ? loadCharacter(req.params.id) : (loadData(DATA_FILES.characters) || []).find(c => c.id === req.params.id));
      broadcastCharacterDelta(fresh || updatedCharacter);
    }

    // If this is the active character, re-sync auto-reply from the SAVED card (the editor
    // writes the flag per-story, so recompute from the whole character, not req.body).
    const settings = loadData(DATA_FILES.settings);
    if (settings?.activeCharacterId === req.params.id) {
      const savedChar = (isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []))
        .find(c => c.id === req.params.id);
      if (savedChar) {
        sessionState.autoReply = resolveCardAutoReply(savedChar);
        broadcast('auto_reply_update', { enabled: sessionState.autoReply });
      }
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
  } else {
    let characters = loadData(DATA_FILES.characters) || [];
    characters = characters.filter(c => c.id !== req.params.id);
    saveData(DATA_FILES.characters, characters);
  }
  broadcastCharacterDelta([], [req.params.id]);
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

    // #30: calibrating an outlet OWNS the calibration on an automatic-pump entity. Spawn a pump for
    // this device if none is bound yet (so the calibration "becomes" a pump), else update the bound
    // pump's calibration (recalibration). The pump is the source of truth going forward.
    if (devices[index].calibrationTime > 0) {
      const pumps = loadPumps();
      let pump = pumps.find(p => p.boundDeviceId === devices[index].id);
      const cal = {
        calibrationTime: devices[index].calibrationTime,
        calibrationCapacity: devices[index].calibrationCapacity ?? null,
        calibrationPainAtMax: devices[index].calibrationPainAtMax ?? null,
        calibratedAt: devices[index].calibratedAt ?? Date.now(),
      };
      if (pump) {
        Object.assign(pump, cal, { lastSeen: deviceRef(devices[index]) });
      } else {
        pump = {
          id: uuidv4(),
          name: devices[index].label || devices[index].name || 'Automatic Pump',
          ...cal,
          boundDeviceId: devices[index].id,
          lastSeen: deviceRef(devices[index]),
          isPrimary: pumps.length === 0,
          limits: { ...FACTORY_PUMP_LIMITS },
        };
        pumps.push(pump);
      }
      savePumps(pumps);
    }
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

// ===== Automatic Pumps (#30) =====
// GET runs the back-compat migration (seed pumps from calibrated devices) + syncs pumps→devices.
app.get('/api/pumps', (req, res) => {
  try {
    res.json(migrateAndSyncPumps());
  } catch (e) {
    console.error('[Pumps] list failed:', e?.message || e);
    res.status(500).json({ error: 'Failed to load pumps' });
  }
});

app.post('/api/pumps', (req, res) => {
  const pumps = loadPumps();
  const pump = {
    id: uuidv4(),
    name: req.body?.name || 'Automatic Pump',
    calibrationTime: req.body?.calibrationTime ?? null,
    calibrationCapacity: req.body?.calibrationCapacity ?? null,
    calibrationPainAtMax: req.body?.calibrationPainAtMax ?? null,
    calibratedAt: req.body?.calibratedAt ?? null,
    boundDeviceId: req.body?.boundDeviceId ?? null,
    lastSeen: req.body?.lastSeen ?? null,
    isPrimary: pumps.length === 0 ? true : !!req.body?.isPrimary,
    limits: req.body?.limits ?? { ...FACTORY_PUMP_LIMITS },
  };
  if (pump.isPrimary) pumps.forEach(p => { p.isPrimary = false; });
  pumps.push(pump);
  savePumps(pumps);
  const devices = loadData(DATA_FILES.devices) || [];
  if (syncPumpsToDevices(pumps, devices)) { saveData(DATA_FILES.devices, devices); broadcast('devices_update', devices); }
  res.json(pump);
});

app.put('/api/pumps/:id', (req, res) => {
  const pumps = loadPumps();
  const idx = pumps.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Pump not found' });
  const devices = loadData(DATA_FILES.devices) || [];

  // If the bound device changed, refresh the last-known device/ip reference.
  if (req.body.boundDeviceId !== undefined && req.body.boundDeviceId !== pumps[idx].boundDeviceId) {
    const dev = devices.find(d => d.id === req.body.boundDeviceId);
    if (dev) req.body.lastSeen = deviceRef(dev);
  }
  pumps[idx] = { ...pumps[idx], ...req.body };
  // Single primary: setting this pump primary clears the others.
  if (req.body.isPrimary === true) pumps.forEach((p, i) => { if (i !== idx) p.isPrimary = false; });

  savePumps(pumps);
  if (syncPumpsToDevices(pumps, devices)) { saveData(DATA_FILES.devices, devices); broadcast('devices_update', devices); }
  res.json(pumps[idx]);
});

app.delete('/api/pumps/:id', (req, res) => {
  let pumps = loadPumps();
  const removed = pumps.find(p => p.id === req.params.id);
  pumps = pumps.filter(p => p.id !== req.params.id);
  // If we deleted the primary, promote the first remaining pump.
  if (removed?.isPrimary && pumps.length && !pumps.some(p => p.isPrimary)) pumps[0].isPrimary = true;
  savePumps(pumps);
  res.json({ success: true });
});

// --- Custom Devices: named 120V appliances bound to a Custom Device Control outlet ---
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
  sessionState.playerIsInflating = false; // emergency stop always ends latched-pump mode
  sessionState.awaitingGoRelease = false; sessionState.pendingGoProfileId = null; sessionState.pendingRangeAwait = null; sessionState.pendingCapacityGate = null; sessionState.triggerChainDepth = 0;
  deviceService.stopAllPumpRuntimeTracking();
  stopCharacterInflation();
  stopAllMemberInflation();
  clearAllServerTimedPumpTimers();
  clearAllCustomDeviceTimers();
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
  try { return readJsonCached(TRIGGER_TREES_PATH) ?? { trees: [] }; } catch (e) { return { trees: [] }; }
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

// ============================================
// MiniGames store + API (Phase 5 of Flow→Trigger migration)
// ============================================
// Server-side store of reusable MiniGame templates = { id, name, type, config }. Authoring lives
// in the MiniGames page; the Call MiniGame tree action resolves a template by id at runtime
// (loadMiniGames in runNode). Modeled on the trigger-trees store above.
const MINIGAMES_PATH = path.join(DATA_DIR, 'minigames.json');
function loadMiniGames() {
  try { return readJsonCached(MINIGAMES_PATH) ?? { games: [] }; } catch (e) { return { games: [] }; }
}
function saveMiniGames(data) { fs.writeFileSync(MINIGAMES_PATH, JSON.stringify(data, null, 2)); }

// Ship one of every MiniGame type as a stable-id default (minigames.json is gitignored runtime
// data, so we seed like ensureDefaultConnectionProfiles rather than commit the file). Default cards
// reference these ids in Call MiniGame nodes. Only ADDS missing ids — a user's own games and edits
// to a seeded game are untouched; a deleted default re-appears on next start (matches profiles).
const DEFAULT_MINIGAMES = [
  { id: 'mg-default-wheel', name: 'Prize Wheel', type: 'prize_wheel', config: { segments: [
    { id: 'seg-a', label: 'Double Puff', color: '#fb923c', weight: 1 },
    { id: 'seg-b', label: 'Hold Pressure', color: '#3b82f6', weight: 1 },
    { id: 'seg-c', label: 'Contestant’s Choice', color: '#22c55e', weight: 1 },
    { id: 'seg-d', label: 'Mystery Box', color: '#a855f7', weight: 1 },
  ] } },
  { id: 'mg-default-dice', name: 'Dice Roll', type: 'dice_roll', config: { diceCount: 6, characterAdvantage: 0 } },
  { id: 'mg-default-coin', name: 'Coin Flip', type: 'coin_flip', config: { headsLabel: 'Heads', tailsLabel: 'Tails', headsWeight: 50, bestOf: 1 } },
  { id: 'mg-default-rps', name: 'Rock Paper Scissors', type: 'rps', config: { bestOf: 1, characterBias: 0 } },
  { id: 'mg-default-slots', name: 'Slots', type: 'slot_machine', config: { symbols: ['🍒', '🍋', '🔔', '⭐', '7️⃣'], exits: [
    { id: 'ex-a', label: 'Jackpot', pattern: 'three-of-a-kind' },
    { id: 'ex-b', label: 'Small Win', pattern: 'two-of-a-kind' },
    { id: 'ex-c', label: 'No Matches', pattern: 'no-match' },
  ] } },
  { id: 'mg-default-blackjack', name: 'Blackjack', type: 'card_draw', config: { target: 21, charStandsAt: 17 } },
  { id: 'mg-default-simon', name: 'Simon', type: 'simon_challenge', config: { startingLength: 3, maxLength: 8, maxMisses: 3, penaltyDevice: '', penaltyDuration: 3, grandPenaltyDevice: '', grandPenaltyDuration: 10, rewardDevice: '', rewardDuration: 5 } },
];
function ensureDefaultMiniGames() {
  const data = loadMiniGames();
  if (!Array.isArray(data.games)) data.games = [];
  let added = false;
  for (const g of DEFAULT_MINIGAMES) {
    const existing = data.games.find(x => x.id === g.id);
    if (!existing) {
      data.games.push({ ...g, config: JSON.parse(JSON.stringify(g.config)), createdAt: Date.now(), updatedAt: Date.now() });
      added = true;
      console.log(`[Startup] Added default MiniGame: ${g.name} (${g.type})`);
    } else if (JSON.stringify(existing.config) !== JSON.stringify(g.config) || existing.type !== g.type) {
      // Keep the shipped defaults canonical (e.g. dice must be 6 dice → 6–36s). Refresh config/type
      // for the reserved default ids so a new app version's tuning lands. Custom games are untouched.
      existing.config = JSON.parse(JSON.stringify(g.config));
      existing.type = g.type;
      existing.updatedAt = Date.now();
      added = true;
      console.log(`[Startup] Refreshed default MiniGame config: ${g.name} (${g.type})`);
    }
  }
  if (added) saveMiniGames(data);
}
ensureDefaultMiniGames();

// Shipped, read-only CHECKPOINT PRESET PROFILES — generic capacity-pacing sets a player can apply to
// ANY character in one click (great for imported cards with no checkpoints, which otherwise let the
// prose run ahead of the gauge). Applying one COPIES it onto the character as a normal, editable
// profile; the presets themselves live only here (can't be edited or deleted). Pure per-range Plot
// Steer — no character-specific triggers — so they layer cleanly onto any card. Each range's text is
// injected as a MANDATORY stage direction ("Do NOT describe inflation beyond what X% represents").
const CHECKPOINT_PRESET_PROFILES = [
  {
    id: 'preset-standard', name: 'Standard Pacing',
    description: 'Even, realistic escalation from flat to full across 1–100%. The safe default — bind any card\'s description to the gauge.',
    ranges: {
      '1-10':  { mainTheme: "Inflation has barely begun — the belly looks essentially normal, only a faint internal warmth or subtle awareness of fullness. Keep physical description minimal; focus on the scene, dialogue, and anticipation, not the body." },
      '11-20': { mainTheme: "Very early. A slight, soft fullness — like after a big meal. Clothes still fit the same. One brief physical mention at most, then back to the interaction." },
      '21-30': { mainTheme: "Mild, visible bloating begins — a gentle roundness, the waistband snug. Still understated; the belly is subtly rounder than normal, nothing dramatic." },
      '31-40': { mainTheme: "Clearly rounding now — a noticeable dome, skin starting to feel taut. Pressure is present but comfortable. Balance physical description with dialogue." },
      '41-50': { mainTheme: "Firmly swollen and round — obvious inflation, tightness building, clothes straining. About half full. Sensations are noticeable but manageable." },
      '51-60': { mainTheme: "Heavily rounded and taut — the belly dominates now, movement affected, real pressure building. Reactions should match the growing intensity." },
      '61-70': { mainTheme: "Very full and drum-tight — stretched skin, laboured movement, pressure hard to ignore. The body is clearly working." },
      '71-80': { mainTheme: "Hugely distended — skin shiny and stretched, every motion an effort, genuine strain. Discomfort is real and constant." },
      '81-90': { mainTheme: "Massive and straining — near the limit, creaking pressure, difficulty breathing deeply. This is the intense stretch of the scene." },
      '91-100':{ mainTheme: "At absolute capacity — impossibly full, at the very edge of what's safe. The climax; every detail is strained to the maximum." },
      '100+':  { mainTheme: "Beyond full — over-inflated, past safe limits, dangerously tight. Extreme tension throughout." },
    },
  },
  {
    id: 'preset-slowburn', name: 'Slow Burn',
    description: 'Stays understated far longer — the belly reads small well past the halfway mark, with the big payoff reserved for the top ranges. Great for long, teasing scenes.',
    ranges: {
      '1-10':  { mainTheme: "Nothing visible at all — at most a faint warmth or a private awareness of the tube. Do not describe any size change. This is pure build-up and conversation." },
      '11-20': { mainTheme: "Still looks completely normal. Perhaps the faintest hint of fullness that only the character notices. Keep it entirely subtextual." },
      '21-30': { mainTheme: "Barely-there softness — a slight give under a hand, nothing anyone would notice at a glance. Understate everything." },
      '31-40': { mainTheme: "A small, soft roundness at last — like a light meal. Mention it lightly, once, then move on. Still early days." },
      '41-50': { mainTheme: "Gently rounded and noticeably fuller — the first point where it's clearly visible. Snug, not tight. Savour the slow reveal." },
      '51-60': { mainTheme: "Clearly swollen and firm now, pressure beginning in earnest. The belly is finally becoming the focus." },
      '61-70': { mainTheme: "Round, taut, and heavy — real tightness, movement affected. The slow build is paying off." },
      '71-80': { mainTheme: "Very full and drum-tight — stretched skin, strain in every motion, pressure hard to ignore." },
      '81-90': { mainTheme: "Hugely distended and straining — near the limit, creaking, laboured breathing. Intense." },
      '91-100':{ mainTheme: "At absolute capacity — impossibly full, at the edge of safe. The long-awaited climax, maximum strain." },
      '100+':  { mainTheme: "Beyond full — over-inflated and dangerously tight, far past any comfortable limit." },
    },
  },
  {
    id: 'preset-intense', name: 'Quick & Intense',
    description: 'Ramps fast and leans into strain and pressure early — for scenes that want the payoff sooner. Still bound to the gauge, just a steeper curve.',
    ranges: {
      '1-10':  { mainTheme: "The very start — a faint warmth and the first hint of pressure, belly still flat but the sensation is already there and building fast." },
      '11-20': { mainTheme: "Quickly softening and filling — a clear, growing fullness, the pressure noticeable and rising. The pace is brisk." },
      '21-30': { mainTheme: "Visibly rounding already — a firm dome, tightness setting in early, clothes beginning to strain. The body is filling eagerly." },
      '31-40': { mainTheme: "Swollen and taut — obvious inflation, real pressure, movement starting to be affected. Sensations are front and centre." },
      '41-50': { mainTheme: "Heavily rounded and tight — the belly dominates, pressure hard to ignore, breathing a little deliberate. Halfway and intense." },
      '51-60': { mainTheme: "Very full and drum-tight — stretched skin, laboured movement, constant pressure. The strain is real." },
      '61-70': { mainTheme: "Hugely distended — shiny stretched skin, every motion an effort, genuine discomfort throughout." },
      '71-80': { mainTheme: "Massive and straining — near the limit, creaking pressure, hard to breathe deeply. Overwhelming tightness." },
      '81-90': { mainTheme: "At the edge — impossibly full, skin creaking, pure strain, on the verge. Maximum intensity." },
      '91-100':{ mainTheme: "Absolute capacity — beyond full, at the breaking point of what's safe, every second on the edge of too much." },
      '100+':  { mainTheme: "Past the limit — dangerously over-inflated, extreme pressure, could give at any moment." },
    },
  },
];
app.get('/api/checkpoint-presets', (req, res) => res.json({ presets: CHECKPOINT_PRESET_PROFILES }));

// ---- Voice / TTS (F2): local Piper synthesis, optional + graceful when unconfigured ----
const ttsService = require('./services/tts-service');
const portraitService = require('./services/portrait-service'); // F3: SD auto staged portraits

app.get('/api/timeline', (req, res) => res.json({ events: sessionTimeline }));

app.get('/api/tts/voices', (req, res) => {
  const cfg = (loadData(DATA_FILES.settings) || {}).tts || {};
  res.json({
    enabled: cfg.enabled === true,
    configured: ttsService.isConfigured(cfg),
    autoSpeak: cfg.autoSpeak === true,
    defaultVoice: cfg.defaultVoice || '',
    voices: ttsService.listVoices(cfg)
  });
});

app.post('/api/tts/speak', async (req, res) => {
  try {
    const settings = loadData(DATA_FILES.settings) || {};
    const cfg = settings.tts || {};
    // Per-speaker voice resolution (F2b): explicit voice > the speaking member's ttsVoice >
    // the card's ttsVoice > the configured default (synthesize falls back to cfg.defaultVoice).
    let voice = req.body?.voice;
    if (!voice) {
      const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      const ch = chars.find(c => c.id === (req.body?.characterId || settings.activeCharacterId)) || null;
      const member = req.body?.memberId ? (ch?.multiChar?.characters || []).find(m => m.id === req.body.memberId) : null;
      voice = member?.ttsVoice || ch?.ttsVoice || '';
    }
    const file = await ttsService.synthesize(req.body?.text, voice, cfg);
    res.json({ success: true, url: `/api/tts/audio/${file}` });
  } catch (e) {
    res.status(400).json({ error: e.message || 'TTS failed' });
  }
});

app.get('/api/tts/audio/:file', (req, res) => {
  const p = ttsService.audioFilePath(req.params.file);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Audio not found' });
  res.sendFile(p);
});

// --- Auto staged portraits (F3): A1111-compatible Stable Diffusion hook ---
app.post('/api/portraits/test', async (req, res) => {
  try { res.json(await portraitService.testConnection(req.body?.url || (loadData(DATA_FILES.settings) || {}).sdApi?.url)); }
  catch (e) { res.status(400).json({ success: false, error: e.message || 'SD connection failed' }); }
});

// Generate ONE staged-portrait slot and save it onto the card. Per-range calls keep HTTP
// timeouts sane and let the author retry a single range without redoing the set.
app.post('/api/portraits/generate-range', async (req, res) => {
  try {
    const { type, folder, id, slot, prompt, negativePrompt, refSlot, options } = req.body || {};
    if (!['chars', 'personas'].includes(type) || !['default', 'custom'].includes(folder)) {
      return res.status(400).json({ error: 'Invalid type or folder' });
    }
    if (!slot || !prompt) return res.status(400).json({ error: 'slot and prompt required' });
    const settings = loadData(DATA_FILES.settings) || {};
    const url = req.body?.url || settings.sdApi?.url;

    // Optional reference image: an existing portrait slot (e.g. the avatar or a completed range)
    // steered via img2img so the set keeps one identity.
    let refImageBase64 = null;
    if (refSlot) {
      const p = imageStorage.portraitMediaFilePathAny?.(type, id, folder === 'default', refSlot);
      if (p && fs.existsSync(p)) refImageBase64 = fs.readFileSync(p).toString('base64');
    }

    const b64 = await portraitService.generate({
      url, prompt, negativePrompt, refImageBase64,
      width: options?.width, height: options?.height, steps: options?.steps,
      cfgScale: options?.cfgScale, seed: options?.seed, denoise: options?.denoise,
    });
    const outUrl = await imageStorage.savePortraitMedia(type, id, folder === 'default', slot, Buffer.from(b64, 'base64'), 'png');
    console.log(`[Portraits] generated ${slot} for ${type}/${folder}/${id}`);
    res.json({ success: true, url: outUrl, slot });
  } catch (e) {
    console.error('[Portraits] generate failed:', e.message);
    res.status(500).json({ error: e.message || 'Portrait generation failed' });
  }
});

app.get('/api/minigames', (req, res) => res.json(loadMiniGames()));

app.post('/api/minigames', (req, res) => {
  const { name, type, config } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (!type || typeof type !== 'string') return res.status(400).json({ error: 'type required' });
  const data = loadMiniGames();
  if (!Array.isArray(data.games)) data.games = [];
  // Optional stable id (the MiniGames tab's "Add to library" for card-baked games) — keeping the
  // id means the card's Call MiniGame nodes resolve to the library copy. Falls back to a fresh id
  // when absent or already taken.
  const reqId = typeof req.body.id === 'string' && req.body.id.trim() ? req.body.id.trim() : null;
  const id = (reqId && !data.games.some(g => g.id === reqId)) ? reqId : `mg-${Date.now()}`;
  data.games.push({ id, name, type, config: config && typeof config === 'object' ? config : {}, createdAt: Date.now(), updatedAt: Date.now() });
  saveMiniGames(data);
  res.json({ success: true, id });
});

app.put('/api/minigames/:id', (req, res) => {
  const { name, type, config } = req.body;
  const data = loadMiniGames();
  const idx = (data.games || []).findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'MiniGame not found' });
  if (name !== undefined) data.games[idx].name = name;
  if (type !== undefined) data.games[idx].type = type;
  if (config !== undefined) data.games[idx].config = config && typeof config === 'object' ? config : {};
  data.games[idx].updatedAt = Date.now();
  saveMiniGames(data);
  res.json({ success: true });
});

app.delete('/api/minigames/:id', (req, res) => {
  const data = loadMiniGames();
  const idx = (data.games || []).findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'MiniGame not found' });
  data.games.splice(idx, 1);
  saveMiniGames(data);
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

// (Legacy /api/flows* + flow export/import route handlers deleted — the tombstone middleware near the top of the file answers 410 for all of them.)

// Get single flow by ID




// ============================================
// Data Export/Import
// ============================================

const EXPORT_VERSION = '1.5';

// ---- Community card pipeline (F6 v1): browse a git-backed card repo + one-click import ----
// Config: settings.cardRepo = { repo: 'owner/name', branch, dir } — defaults below. Listing goes
// through the GitHub contents API server-side (no CORS, one place to swap providers later).
const COMMUNITY_DEFAULTS = { repo: 'AireGasm/swelldreams-cards', branch: 'main', dir: 'cards' };
app.get('/api/community/cards', async (req, res) => {
  try {
    const cfg = { ...COMMUNITY_DEFAULTS, ...((loadData(DATA_FILES.settings) || {}).cardRepo || {}) };
    const url = `https://api.github.com/repos/${cfg.repo}/contents/${cfg.dir}?ref=${encodeURIComponent(cfg.branch)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'SwellDreams', Accept: 'application/vnd.github+json' } });
    if (r.status === 404) return res.json({ repo: cfg.repo, cards: [], note: 'Repo or folder not found — set Settings.cardRepo or create the repo.' });
    if (!r.ok) return res.status(502).json({ error: `GitHub API ${r.status}` });
    const items = await r.json();
    const cards = (Array.isArray(items) ? items : [])
      .filter(f => f.type === 'file' && /\.(png|zip|json)$/i.test(f.name))
      .map(f => ({ name: f.name, size: f.size, url: f.download_url }));
    res.json({ repo: cfg.repo, branch: cfg.branch, cards });
  } catch (e) { res.status(500).json({ error: e.message || 'Community listing failed' }); }
});

// Import one community card by URL: download server-side, then feed the normal import pipeline
// (self-POST keeps PNG/ZIP/JSON handling + media placement in ONE code path).
app.post('/api/community/import', async (req, res) => {
  try {
    const url = String(req.body?.url || '');
    const cfg = { ...COMMUNITY_DEFAULTS, ...((loadData(DATA_FILES.settings) || {}).cardRepo || {}) };
    if (!/^https:\/\/(raw\.githubusercontent\.com|objects\.githubusercontent\.com)\//.test(url)) {
      return res.status(400).json({ error: 'Only GitHub raw download URLs are accepted' });
    }
    const dl = await fetch(url, { headers: { 'User-Agent': 'SwellDreams' } });
    if (!dl.ok) return res.status(502).json({ error: `Download failed (${dl.status})` });
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.length > 300 * 1024 * 1024) return res.status(413).json({ error: 'Card exceeds 300MB' });
    const name = path.basename(new URL(url).pathname) || 'card.png';
    const form = new FormData();
    form.append('file', new Blob([buf]), name);
    const r = await fetch('http://127.0.0.1:8889/api/import/character-card', { method: 'POST', body: form });
    const out = await r.json().catch(() => ({}));
    res.status(r.status).json(out);
  } catch (e) { res.status(500).json({ error: e.message || 'Community import failed' }); }
});

// ---- Card/persona/backup transfer (E1: extracted to lib/card-transfer.js — export/import/backup routes + withBakedMiniGames) ----
require('./lib/card-transfer')({ app, DATA_FILES, EXPORT_VERSION, _jsonCache, broadcast, broadcastCharacterDelta, cardUpload, characterExporter, cleanupUpload, imageStorage, isLocalRequest, isPerCharStorageActive, isPerFlowStorageActive, loadAllCharacters, loadAllPersonas, loadCharacter, loadData, loadFlows, loadFlowsIndex, loadMiniGames, runDataMigrations, saveCharacter, saveData, saveFlow, savePersonaAsync, listCharMedia, charMediaDir, uuidv4 });


// --- Session ---

app.get('/api/session', (req, res) => {
  res.json(sessionState);
});

// Reset the session's ONCE memory only (script-testing aid): fired tree nodes, fired range
// sequences, random-block budgets, and event latches — WITHOUT touching the chat, capacity, or
// gates. Lets an author re-test triggers/checkpoints without starting a whole new session.
app.post('/api/session/reset-once', (req, res) => {
  firedCheckpointTriggers.clear();
  sessionState.firedTreeNodes?.clear?.();
  sessionState.randomBlockBudget = {};
  resetEventTriggerState();
  sessionState.checkpointControl = null; // Checkpoint Control overrides die with the session
  sessionState.pendingIntroStart = null; // a deferred intro from the old session must not fire into the new one
  sessionState.eventTriggerOverrides = null; // Event Trigger Toggle overrides die with the session
  sessionState.sessionStartActive = false;
  console.log('[Session] once-memory reset (fired nodes/ranges, random budgets, event latches)');
  res.json({ ok: true });
});

app.post('/api/session/reset', async (req, res) => {
  // Get initial values from request body (if provided)
  const initialValues = req.body?.initialValues || {};

  // Load settings and character to get per-story session defaults
  const settings = loadData(DATA_FILES.settings);
  // "New" wipes this character's saved chat so switching back starts fresh too.
  clearCharSession(settings?.activeCharacterId);
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
  resetEventTriggerState();
  sessionState.checkpointControl = null; // Checkpoint Control overrides die with the session
  sessionState.pendingIntroStart = null; // a deferred intro from the old session must not fire into the new one
  sessionState.eventTriggerOverrides = null; // Event Trigger Toggle overrides die with the session
  sessionState.sessionStartActive = false;
  sessionState.pendingTreeResume = null;
  sessionState.pendingTreeGame = null;
  sessionState.playerIsInflating = false;
  sessionState.awaitingGoRelease = false;
  sessionState.releaseButtonLabel = null;
  sessionState.pendingGoProfileId = null;
  sessionState.pendingRangeAwait = null;
  sessionState.pendingCapacityGate = null;   // clear any queued Fire% gate
  sessionState.triggerChainDepth = 0;        // never leave the gauge frozen across a reset
  broadcast('next_gate', { active: false }); // clear any stuck ">>" gate on reset
  broadcast('capacity_gate', { active: false }); // clear the Fire% status chip too
  sessionState.groupRotation = 0;
  sessionState.pumpReady = pumpReadyDefaults();
  sessionState.soloSpeaker = null;
  sessionState.flowVariables = {};
  eventEngine.variables = {}; // canonical [CharVar:] map — reset with the session, reseeded from charVariables below
  sessionState.flowAssignments = { personas: {}, characters: {}, global: [] };
  sessionState.executionHistory = {
    deliveredMessages: new Set(),
    deviceActions: {}
  };
  sessionState.pumpRuntimeTracker = {}; // Reset auto-capacity tracking
  sessionState.capacityOffset = 0; // Clear manual capacity offset
  // Clear believed-on pump state (all devices were turned off above) so a stale/unconfirmed entry
  // can't make the safety watchdog think a pump is still on into the new session.
  for (const k of Object.keys(pumpActiveSince)) delete pumpActiveSince[k];
  for (const k of Object.keys(forceOffAttempts)) delete forceOffAttempts[k];
  stopCharacterInflation(); // Stop any active character inflation
  stopAllMemberInflation(); // Per-member mock pumps die with the session too
  sessionState.characterCapacity = 0;
  sessionState.memberCapacities = {};
  sessionState.characterInflationBaseCapacity = 0;
  // Reset checkpoint-injection + instructor pre-req state
  sessionState.checkpointInjectionCounts = {};
  sessionState.messagesSincePumpOn = 0; // Auto-pump pacing counter
  sessionState.repliesSinceManualPump = 999; // Manual-pump pacing counter (high = not cooling)
  sessionState.activeCheckpointInjections = [];
  sessionState.pendingCheckpointChoice = null;
  sessionState.pendingTreeChoice = null;
  sessionState.pendingTreeResume = null;
  sessionState.pendingTreeGame = null;
  sessionState.pendingTreeNext = null;
  sessionState.playerIsInflating = false;
  sessionState.pendingCheckpointResponse = null;
  sessionState.pendingPrereqs = null;
  sessionState.prereqsDone = false;
  sessionState.preFillActive = false;
  sessionState.preFillStepId = null;
  setIntroActive(false);
  sessionState.prosePumpGuidanceOff = false;
  sessionState.preFillNote = null;
  sessionState.activeCheckpointProfileId = null;
  sessionState.activeRangeSetId = null;
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
    seedCharVariables(activeCharacter); // Character Variables (Library tab) load their defaults on New Session
    let gateActive = false;

    if (activeCharacter && sessionState.capacity === 0) {
      const activeStory = activeCharacter.stories?.find(s => s.id === activeCharacter.activeStoryId) || activeCharacter.stories?.[0];
      if (hasIntroTree(activeCharacter) || getPreFillConfig(activeCharacter)) {
        // A gated intro (tree scope, or legacy Pre-Fill) closes the gate for ALL card types until
        // it completes. The intro tree takes precedence; startIntroScope()/startPreFill() below
        // manage the active state.
        sessionState.preInflationGateMet = false;
      } else {
        // Standard, group, AND instructor cards start UNGATED so the AI's first [pump on]
        // activates devices. (Instructors used to gate on their prereqs, which deadlocked device
        // control: [pump on] was blocked, but capacity can't rise without pumping. Gating is now
        // solely the job of a deliberate gated-intro tree / Pre-Fill.)
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
      const ssTreeIndex = buildTreeIndex(activeCharacter);
      // Session Start is now PER-PROFILE (active checkpoint profile's treeRefs.sessionStart — the
      // default profile at session open). Falls back to the legacy card-level ref for un-migrated cards.
      const cpEnabled = checkpointsEnabledFor(activeCharacter); // Enable Checkpoints off → no session-start/intro
      const ssRef = resolveScopeRefs(activeCharacter)?.sessionStart || aStory?.treeRefs?.sessionStart;
      const ssTree = cpEnabled ? resolveRefTree(ssRef, ssTreeIndex) : null; // inline OR {treeId} library ref
      const overrideWelcome = !!(ssRef?.overrideWelcome && ssTree);

      sessionState.sessionStartActive = true; // event triggers stay silent until the whole session-start chain completes
      if (!overrideWelcome) await sendWelcomeMessage(activeCharacter, settings);
      // Order: Welcome → Session Start → Pre-Fill (per plan). The Session Start tree runs
      // (after instructor setup vars) BEFORE Pre-Fill starts, so it can set the pump type / swap
      // the checkpoint profile that Pre-Fill and the gate then build on.
      if (isInstr) applyInstructorInitVars(activeCharacter); // seed session-start setup variables (instructor)
      // Standalone delivery: ai_message posts immediately, like the welcome.
      if (ssTree) await runTreeScope(ssTree, 'sessionStart', activeCharacter, settings, { delivery: 'standalone', treeIndex: ssTreeIndex });
      // Gated intro: prefer the Intro TREE scope; fall back to legacy Pre-Fill if no intro tree.
      // Either closes the gate and blocks other scopes until it completes.
      // welcomePosted (!overrideWelcome) → the intro's first message waits behind ">>" so the player
      // reads the welcome first.
      // If the Session Start tree SUSPENDED, the intro must wait for its whole chain — defer.
      const ssStillPending = ['pendingTreeChoice', 'pendingTreeResume', 'pendingTreeGame', 'pendingTreeNext']
        .some(k => String(sessionState[k]?.ctxSnapshot?.scopeKey || '').startsWith('sessionStart'));
      let introStarted;
      if (ssStillPending) {
        console.log('[SessionStart] Session Start tree suspended — deferring the gated intro until it completes');
        deferIntroUntilSessionStartCompletes(!overrideWelcome); // the watcher clears sessionStartActive when done
        introStarted = true; // gates the Pre-Fill/prereq fallbacks exactly like a live intro
      } else {
        sessionState.sessionStartActive = false; // chain ran to completion inline
        introStarted = await startIntroScope(activeCharacter, settings, ssTreeIndex, !overrideWelcome);
      }
      const preFillStarted = introStarted ? false : startPreFill(activeCharacter);
      if (isInstr) {
        // Legacy modal pre-reqs only run when Pre-Fill is NOT in use — and NOT if the Session
        // Start tree already suspended on a player_choice (avoid two choice families armed at once).
        if (!preFillStarted && !sessionState.pendingTreeChoice && (aStory?.prereqTiming || 'session_start') === 'session_start') {
          startInstructorPrereqs(activeCharacter);
        }
      }
      // Set the session pump mode from the card's default pump type (instructors additionally
      // overlay the active checkpoint profile's pumpType inside applyActivePumpType). Runs for
      // ALL card types so the Character/MultiChar Pump Type dropdown takes effect.
      applyActivePumpType(activeCharacter);
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
    // Trigger-era state (audit D4): char/member gauges, capacity offset, runtime tracker, and the
    // chat memory summary all belong to the snapshot too — without them a load resumed the player
    // gauge but reset every character to 0% and dropped the rolling summary.
    characterCapacity: sessionState.characterCapacity || 0,
    memberCapacities: sessionState.memberCapacities || {},
    capacityOffset: sessionState.capacityOffset || 0,
    pumpRuntimeTracker: sessionState.pumpRuntimeTracker,
    chatMemorySummary: sessionState.chatMemorySummary || null,
    chatMemorySummaryUpTo: sessionState.chatMemorySummaryUpTo || 0,
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
  sessionState.playerIsInflating = false; // never resume into a latched-pump state
  sessionState.awaitingGoRelease = false; sessionState.pendingGoProfileId = null; sessionState.pendingRangeAwait = null; sessionState.pendingCapacityGate = null; sessionState.triggerChainDepth = 0;
  // Trigger-era rehydration (audit D4): restore char/member gauges + summary, and void every tree
  // suspension / session override — their continuations point at the PRE-load context and must
  // not resume into the snapshot. Popup UI is dismissed via the standard clear broadcasts.
  sessionState.characterCapacity = session.characterCapacity || 0;
  sessionState.memberCapacities = session.memberCapacities || {};
  sessionState.capacityOffset = session.capacityOffset || 0;
  sessionState.chatMemorySummary = session.chatMemorySummary || null;
  sessionState.chatMemorySummaryUpTo = session.chatMemorySummaryUpTo || 0;
  sessionState.pendingTreeChoice = null;
  sessionState.pendingTreeResume = null;
  sessionState.pendingTreeGame = null;
  sessionState.pendingTreeNext = null;
  sessionState.pendingCheckpointChoice = null;
  sessionState.checkpointControl = null;
  sessionState.selectedChar = null;
  sessionState.firedTreeNodes.clear();
  firedCheckpointTriggers.clear();
  resetEventTriggerState();
  broadcast('checkpoint_choice_clear', {});
  broadcast('tree_minigame_clear', {});
  broadcast('next_gate', { active: false });
  broadcast('await_state', null);
  broadcast('capacity_gate', { active: false });

  // Pre-inflation gate: mirror fresh-session gating so a resumed STANDARD card isn't
  // wrongly re-gated at 0% (which silently strips every model [pump on] to off-only).
  // capacity>0 always opens it; only Pre-Fill / instructor prereqs keep it closed.
  const _gateSettings = loadData(DATA_FILES.settings) || {};
  const _chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
  const _activeChar = _chars.find(c => c.id === _gateSettings?.activeCharacterId) || null;
  const _activeStory = _activeChar?.stories?.find(s => s.id === _activeChar.activeStoryId) || _activeChar?.stories?.[0];
  if (sessionState.capacity > 0) {
    sessionState.preInflationGateMet = true;
  } else if (getPreFillConfig(_activeChar)) {
    sessionState.preInflationGateMet = false;            // pre-fill intro still gates
  } else {
    sessionState.preInflationGateMet = true;             // standard / group / instructor → ungated on resume
  }

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
    // No favicon asset ships — short-circuit the browser's auto /favicon.ico poll with 204 instead of
    // falling through to index.html (which otherwise logged a bogus ENOENT while a rebuild was in flight).
    if (req.path === '/favicon.ico') {
      return res.status(204).end();
    }
    // `npm run build` wipes+rewrites build/, so index.html can vanish for a moment mid-rebuild. Handle
    // the sendFile error gracefully (503 "refresh in a sec") instead of throwing an uncaught ENOENT.
    res.sendFile(path.join(FRONTEND_BUILD_PATH, 'index.html'), (err) => {
      if (err && !res.headersSent) {
        res.status(503).type('text/plain').send('Frontend is rebuilding — refresh in a moment.');
      }
    });
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

})();

// Default CHARACTERS are read-only and AUTHORITATIVE. On every startup, delete any custom/ shadow of
// a default character id so the git-tracked default/ (which ships fresh with each app version) always
// wins — this is how "the new version overwrites everyone's copy" is enforced. Editing a default is
// blocked at the API (duplicate-to-edit instead), so a shadow is only ever a stale pre-immutability
// override; removing it is safe. Genuine custom characters (unique ids not present in default/) are
// never touched. (Personas intentionally NOT included — only characters were made immutable.)
(function resetDefaultCharacterShadows() {
  try {
    if (!fs.existsSync(CHARS_DEFAULT_DIR) || !fs.existsSync(CHARS_CUSTOM_DIR)) return;
    let removed = 0;
    for (const entry of fs.readdirSync(CHARS_DEFAULT_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const shadowDir = path.join(CHARS_CUSTOM_DIR, id);
      const shadowFlat = path.join(CHARS_CUSTOM_DIR, `${id}.json`);
      if (fs.existsSync(shadowDir)) { fs.rmSync(shadowDir, { recursive: true, force: true }); removed++; }
      if (fs.existsSync(shadowFlat)) { fs.rmSync(shadowFlat, { force: true }); removed++; }
    }
    if (removed) {
      console.log(`[Startup] Removed ${removed} stale custom override(s) of default character(s) — defaults are read-only and refreshed from the shipped version`);
      try { rebuildCharsIndex(); } catch (e) { /* ensureCharsIndex below will handle it */ }
    }
  } catch (e) { console.error('[Startup] resetDefaultCharacterShadows failed:', e?.message || e); }
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
// syncAllButtonsOnStartup() removed (E3) — flow-linked auto buttons are stripped by migration rev 2

// Bind to localhost by default; only expose on all interfaces when the user has
// explicitly enabled remote access. Preserves the allowRemote toggle.
// ---- Data schema versioning ----
// One stamped revision for the whole data/ dir + an append-only migration registry that runs
// once, in order, at boot. New data-shape changes get an entry here instead of another ad-hoc
// self-guarded migration scattered through the code (the existing ones — samplerRev, pump
// seeding, reminder→dictionary — stay self-guarded and are grandfathered as rev 0 behavior).
const SCHEMA_VERSION_PATH = path.join(__dirname, 'data', 'schema-version.json');
const DATA_MIGRATIONS = [
  {
    rev: 1,
    name: 'fold instructor-profile briefs onto the cards (character.instructorBrief)',
    run: () => {
      const profs = (loadInstructorProfiles().profiles || []);
      const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      let migrated = 0;
      for (const c of chars) {
        if (!c?.instructor?.enabled || c.instructorBrief || !c.instructorProfileId) continue;
        const prof = profs.find(pr => pr.id === c.instructorProfileId);
        if (!prof?.prompt) continue;
        c.instructorBrief = prof.prompt;
        if (isPerCharStorageActive()) saveCharacter(c); else saveData(DATA_FILES.characters, chars);
        migrated++;
      }
      console.log(`[Schema] instructorBrief migration: ${migrated} card(s) updated`);
    }
  },
  {
    rev: 2,
    name: 'strip flow-spawned autoGenerated buttons (flow engine removed; they were undeletable no-ops)',
    run: () => {
      let n = 0;
      const chars = isPerCharStorageActive() ? loadAllCharacters() : (loadData(DATA_FILES.characters) || []);
      for (const c of chars) {
        if (!Array.isArray(c?.buttons) || !c.buttons.some(b => b?.autoGenerated)) continue;
        c.buttons = c.buttons.filter(b => !b?.autoGenerated);
        if (isPerCharStorageActive()) saveCharacter(c); else saveData(DATA_FILES.characters, chars);
        n++;
      }
      for (const p of (loadAllPersonas() || [])) {
        if (!Array.isArray(p?.buttons) || !p.buttons.some(b => b?.autoGenerated)) continue;
        p.buttons = p.buttons.filter(b => !b?.autoGenerated);
        imageStorage.savePersonaJson(p, !!p._isDefault).catch?.(() => {});
        n++;
      }
      console.log(`[Schema] autoGenerated-button strip: ${n} card(s)/persona(s) cleaned`);
    }
  },
];
function runDataMigrations() {
  let cur = 0;
  try { cur = JSON.parse(fs.readFileSync(SCHEMA_VERSION_PATH, 'utf8')).rev || 0; } catch (e) { /* fresh install */ }
  const pending = DATA_MIGRATIONS.filter(m => m.rev > cur).sort((a, b) => a.rev - b.rev);
  for (const m of pending) {
    console.log(`[Schema] Running data migration ${m.rev}: ${m.name}`);
    try { m.run(); } catch (e) {
      // Stop at the failed migration — later ones may depend on it; rev stays put so it retries next boot.
      console.error(`[Schema] Migration ${m.rev} FAILED (halting migration run):`, e?.message || e);
      return;
    }
    cur = m.rev;
    fs.writeFileSync(SCHEMA_VERSION_PATH, JSON.stringify({ rev: cur, updatedAt: new Date().toISOString() }, null, 2));
  }
  console.log(`[Schema] Data schema at rev ${cur} (${DATA_MIGRATIONS.length} registered migration(s))`);
}
runDataMigrations();

// Legacy remote configs predate the auth token — mint one at boot so token enforcement is
// always active whenever the server binds beyond loopback. (The host reads it from Settings.)
{
  const rs = getRemoteSettings();
  if (rs.allowRemote && rs.requireToken === true && !rs.authToken) {
    rs.authToken = require('crypto').randomBytes(24).toString('base64url');
    saveData(DATA_FILES.remoteSettings, rs);
    console.log('[Remote] Generated a remote auth token for this install (Settings → Global → Remote Access).');
  }
}
const BIND_REMOTE = !!(getRemoteSettings().allowRemote);
const BIND_HOST = BIND_REMOTE ? '0.0.0.0' : '127.0.0.1';
server.listen(PORT, BIND_HOST, () => {
  log.always(`SwellDreams server running on http://localhost:${PORT} (bound to ${BIND_HOST})`);
  // Detect model name from active LLM endpoint on startup
  detectLlmModel();
  startTreeIdleCheck(); // Phase 3 idle event-binding timer — started here, after all module-level decls init
  ensureDefaultPumpTrees(); // built-in Bulb/Bike pump trees — here so TRIGGER_TREES_PATH is initialized
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
    clearAllCustomDeviceTimers();
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
