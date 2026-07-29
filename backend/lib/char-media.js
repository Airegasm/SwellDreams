/**
 * Per-character media (E1 extraction): the editor's Media tab — plain files under
 * data/chars/custom/<id>/media/<type>/, NEVER base64 in the card JSON. Travels via the
 * character ZIP export. Extracted verbatim from server.js; helpers are returned because the
 * export/import ZIP paths and the media variable resolver use them too.
 */
const fs = require('fs');
const path = require('path');

module.exports = function initCharMedia(ctx) {
  const { app, isSafeId, mediaUpload, cleanupUpload, mediaStorage } = ctx;

  // --- Per-character media (the editor's Media tab) ---
  // Plain files under the character's personal directory — data/chars/custom/<id>/media/<type>/ —
  // NEVER base64 in the card JSON. Travels via the character ZIP export (image|video|audio folders).
  const CHAR_MEDIA_TYPES = new Set(['image', 'video', 'audio']);
  function charMediaDir(charId, type) {
    return path.join(__dirname, '..', 'data', 'chars', 'custom', charId, 'media', type);
  }
  function sanitizeMediaName(name) {
    const base = path.basename(String(name || 'file'));
    const clean = base.replace(/[^a-zA-Z0-9._ ()-]/g, '_').replace(/^\.+/, '_').slice(0, 120);
    return clean || 'file';
  }
  function listCharMedia(charId) {
    const out = { image: [], video: [], audio: [] };
    for (const t of CHAR_MEDIA_TYPES) {
      const dir = charMediaDir(charId, t);
      try {
        for (const f of fs.readdirSync(dir)) {
          const st = fs.statSync(path.join(dir, f));
          if (st.isFile()) out[t].push({ name: f, size: st.size, mtime: st.mtimeMs, url: `/api/characters/${charId}/media/${t}/${encodeURIComponent(f)}/file` });
        }
      } catch (e) { /* no media dir yet — empty list */ }
      out[t].sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }
  // Write one media file into the character's dir; auto-suffixes on name collision. Returns the name used.
  function writeCharMediaFile(charId, type, name, buffer) {
    const dir = charMediaDir(charId, type);
    fs.mkdirSync(dir, { recursive: true });
    let finalName = sanitizeMediaName(name);
    const ext = path.extname(finalName), stem = finalName.slice(0, finalName.length - ext.length);
    for (let n = 2; fs.existsSync(path.join(dir, finalName)); n++) finalName = `${stem} (${n})${ext}`;
    fs.writeFileSync(path.join(dir, finalName), buffer);
    return finalName;
  }
  // Path variant for disk-staged uploads: renames the temp file into place (copy fallback), so
  // the media never round-trips through RAM.
  function writeCharMediaFileFromPath(charId, type, name, srcPath) {
    const dir = charMediaDir(charId, type);
    fs.mkdirSync(dir, { recursive: true });
    let finalName = sanitizeMediaName(name);
    const ext = path.extname(finalName), stem = finalName.slice(0, finalName.length - ext.length);
    for (let n = 2; fs.existsSync(path.join(dir, finalName)); n++) finalName = `${stem} (${n})${ext}`;
    try { fs.renameSync(srcPath, path.join(dir, finalName)); }
    catch (e) { fs.copyFileSync(srcPath, path.join(dir, finalName)); }
    return finalName;
  }
  // Resolve + validate a char-media file path (id/type/name all attacker-controlled URL parts).
  function charMediaFilePath(charId, type, name) {
    if (!isSafeId(charId) || !CHAR_MEDIA_TYPES.has(type)) return null;
    const dir = charMediaDir(charId, type);
    const p = path.join(dir, path.basename(String(name || '')));
    return p.startsWith(dir + path.sep) ? p : null;
  }

  app.get('/api/characters/:id/media', (req, res) => {
    if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid character id' });
    res.json(listCharMedia(req.params.id));
  });

  app.post('/api/characters/:id/media/:type', mediaUpload.single('file'), (req, res) => {
    try {
      if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid character id' });
      if (!CHAR_MEDIA_TYPES.has(req.params.type)) return res.status(400).json({ error: 'Invalid media type' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const name = writeCharMediaFileFromPath(req.params.id, req.params.type, req.file.originalname, req.file.path);
      res.json({ success: true, name });
    } catch (e) { res.status(500).json({ error: e.message || 'Upload failed' }); }
    finally { cleanupUpload(req); }
  });

  // Clone an item from the MAIN media library into the character's personal directory.
  app.post('/api/characters/:id/media/:type/clone', async (req, res) => {
    try {
      if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid character id' });
      const type = req.params.type;
      if (!CHAR_MEDIA_TYPES.has(type)) return res.status(400).json({ error: 'Invalid media type' });
      const mediaId = req.body?.mediaId;
      const item = type === 'image' ? await mediaStorage.getMediaImage(mediaId)
        : type === 'video' ? await mediaStorage.getMediaVideo(mediaId)
        : await mediaStorage.getMediaAudio(mediaId);
      if (!item) return res.status(404).json({ error: 'Library item not found' });
      const src = type === 'image' ? mediaStorage.getMediaImageFilePath(item.filename)
        : type === 'video' ? mediaStorage.getMediaVideoFilePath(item.filename)
        : mediaStorage.getMediaAudioFilePath(item.filename);
      if (!src || !fs.existsSync(src)) return res.status(404).json({ error: 'Library file missing on disk' });
      // Keep the human name, the library file's real extension.
      const name = `${item.name || item.tag || 'media'}${path.extname(item.filename)}`;
      const finalName = writeCharMediaFile(req.params.id, type, name, fs.readFileSync(src));
      res.json({ success: true, name: finalName });
    } catch (e) { res.status(500).json({ error: e.message || 'Clone failed' }); }
  });

  app.delete('/api/characters/:id/media/:type/:name', (req, res) => {
    const p = charMediaFilePath(req.params.id, req.params.type, req.params.name);
    if (!p) return res.status(400).json({ error: 'Invalid path' });
    try { fs.unlinkSync(p); res.json({ success: true }); }
    catch (e) { res.status(404).json({ error: 'File not found' }); }
  });

  app.get('/api/characters/:id/media/:type/:name/file', (req, res) => {
    const p = charMediaFilePath(req.params.id, req.params.type, req.params.name);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(p);
  });

  // Open a character media file with the OS-associated app (double-click in the Media tab).
  // Only meaningful when the backend runs on the same machine as the person clicking.
  app.post('/api/characters/:id/media/open', (req, res) => {
    const p = charMediaFilePath(req.params.id, req.body?.type, req.body?.name);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', p] : [p];
    try {
      require('child_process').spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message || 'Open failed' }); }
  });


  return { CHAR_MEDIA_TYPES, charMediaDir, sanitizeMediaName, listCharMedia, writeCharMediaFile, writeCharMediaFileFromPath, charMediaFilePath };
};
