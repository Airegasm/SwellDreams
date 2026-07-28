/**
 * TTS Service (F2) — local text-to-speech via Piper (https://github.com/rhasspy/piper).
 * Config lives at settings.tts = { enabled, piperPath, voicesDir, defaultVoice, autoSpeak }.
 * Fully optional: everything degrades gracefully when Piper isn't installed/configured.
 * Synthesized WAVs cache by content hash under data/tmp/tts (swept with the upload tmp dir).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const log = createLogger('TTS');
const CACHE_DIR = path.join(__dirname, '..', 'data', 'tmp', 'tts');

function ensureCacheDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) { /* exists */ }
}

// Scan the configured voices dir for Piper voice models (*.onnx).
function listVoices(cfg) {
  if (!cfg?.voicesDir) return [];
  try {
    return fs.readdirSync(cfg.voicesDir)
      .filter(f => f.toLowerCase().endsWith('.onnx'))
      .map(f => ({ id: f, name: f.replace(/\.onnx$/i, '') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    log.warn(`voicesDir unreadable (${cfg.voicesDir}): ${e.message}`);
    return [];
  }
}

function isConfigured(cfg) {
  return !!(cfg?.enabled && cfg.piperPath && fs.existsSync(cfg.piperPath) && cfg.voicesDir);
}

// Prep prose for speech: drop *stage directions*, [device tags], markdown emphasis.
function speakableText(text) {
  return String(text || '')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Synthesize text with a voice. Returns the cache FILENAME (serve via /api/tts/audio/:file).
 * Throws with a human-readable message on misconfiguration/failure.
 */
async function synthesize(text, voiceId, cfg) {
  if (!isConfigured(cfg)) throw new Error('TTS not configured — set the Piper path and voices folder in Settings → Global → Voice');
  const clean = speakableText(text);
  if (!clean) throw new Error('Nothing speakable in that message');
  const voiceFile = path.basename(String(voiceId || cfg.defaultVoice || ''));
  if (!voiceFile) throw new Error('No voice selected');
  const voicePath = path.join(cfg.voicesDir, voiceFile);
  if (!fs.existsSync(voicePath)) throw new Error(`Voice model not found: ${voiceFile}`);

  ensureCacheDir();
  const hash = crypto.createHash('sha1').update(`${voiceFile}|${clean}`).digest('hex');
  const outName = `${hash}.wav`;
  const outPath = path.join(CACHE_DIR, outName);
  if (fs.existsSync(outPath)) return outName;

  await new Promise((resolve, reject) => {
    const proc = spawn(cfg.piperPath, ['--model', voicePath, '--output_file', outPath], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} reject(new Error('TTS timed out (60s)')); }, 60000);
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(new Error(`Piper failed to start: ${e.message}`)); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath)) resolve();
      else reject(new Error(`Piper exited ${code}: ${err.slice(-300)}`));
    });
    proc.stdin.write(clean);
    proc.stdin.end();
  });
  log.info(`Synthesized ${clean.length} chars with ${voiceFile} → ${outName}`);
  return outName;
}

function audioFilePath(file) {
  const p = path.join(CACHE_DIR, path.basename(String(file || '')));
  return p.startsWith(CACHE_DIR + path.sep) && p.toLowerCase().endsWith('.wav') ? p : null;
}

module.exports = { listVoices, isConfigured, synthesize, audioFilePath, speakableText };
