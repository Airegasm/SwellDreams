/**
 * Card/persona/backup transfer (E1 extraction): export routes (JSON / ZIP-with-media / SwellD PNG,
 * persona, whole-library backup), their import counterparts, whole-app backup/restore (D5), and
 * the export-time minigame baking (withBakedMiniGames). Extracted verbatim from server.js.
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

module.exports = function initCardTransfer(ctx) {
  const { app, DATA_FILES, EXPORT_VERSION, _jsonCache, broadcast, broadcastCharacterDelta, cardUpload,
          characterExporter, cleanupUpload, imageStorage, isLocalRequest, isPerCharStorageActive,
          isPerFlowStorageActive, loadAllCharacters, loadAllPersonas, loadCharacter, loadData,
          loadFlows, loadFlowsIndex, loadMiniGames, runDataMigrations, saveCharacter, saveData,
          saveFlow, savePersonaAsync, listCharMedia, charMediaDir, uuidv4 } = ctx;

  // Every call_minigame reference anywhere in a character's data (baked trees, inline button/scope
  // trees, profile refs — a generic deep walk, so no structure is ever missed).
  function collectMiniGameIdsDeep(obj, out) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { for (const o of obj) collectMiniGameIdsDeep(o, out); return; }
    if (obj.type === 'call_minigame' && obj.params?.miniGameId) out.add(obj.params.miniGameId);
    for (const v of Object.values(obj)) collectMiniGameIdsDeep(v, out);
  }

  // Export enrichment: make sure every minigame the card's trees reference is baked into
  // character.miniGames (snapshots from the master list), so Call MiniGame nodes keep working on
  // installs that don't have the game. Games the author already added via the MiniGames tab are
  // kept as-is; only missing ones are pulled in. Returns the character unchanged when complete.
  function withBakedMiniGames(character) {
    try {
      const ids = new Set();
      collectMiniGameIdsDeep(character, ids);
      const have = new Set((character.miniGames || []).map(g => g && g.id).filter(Boolean));
      const missing = [...ids].filter(id => !have.has(id));
      if (!missing.length) return character;
      const master = loadMiniGames().games || [];
      const add = missing.map(id => master.find(g => g.id === id)).filter(Boolean);
      if (!add.length) return character;
      console.log(`[Export] Baking ${add.length} referenced minigame(s) into the card: ${add.map(g => g.name).join(', ')}`);
      return { ...character, miniGames: [...(character.miniGames || []), ...add.map(g => JSON.parse(JSON.stringify(g)))] };
    } catch (e) { console.error('[Export] minigame baking failed:', e?.message || e); return character; }
  }

  // ---- Whole-app backup/restore (audit D5) ----
  // GET /api/backup streams a zip of the entire data/ dir (minus tmp/); POST /api/backup/restore
  // extracts an uploaded backup over data/ and re-runs schema migrations. Both are HOST-ONLY —
  // restore is destructive and backup contains every secret.
  app.get('/api/backup', (req, res) => {
    if (!isLocalRequest(req)) return res.status(403).json({ error: 'Backup is host-only' });
    try {
      const archiver = require('archiver');
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="swelldreams-backup-${stamp}.zip"`);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err) => { console.error('[Backup]', err); try { res.destroy(); } catch (e) {} });
      archive.pipe(res);
      archive.glob('**/*', { cwd: path.join(__dirname, 'data'), ignore: ['tmp/**'], dot: false });
      archive.finalize();
    } catch (error) {
      console.error('[Backup] Error:', error);
      if (!res.headersSent) res.status(500).json({ error: error.message || 'Backup failed' });
    }
  });

  app.post('/api/backup/restore', cardUpload.single('file'), (req, res) => {
    try {
      if (!isLocalRequest(req)) return res.status(403).json({ error: 'Restore is host-only' });
      if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(req.file.path);
      const dataDir = path.join(__dirname, 'data');
      let restored = 0, skipped = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        // Path-traversal guard: resolved target must stay inside data/; tmp/ never restores.
        const rel = entry.entryName.replace(/\\/g, '/');
        if (rel.startsWith('tmp/') || rel.includes('..')) { skipped++; continue; }
        const target = path.join(dataDir, rel);
        if (!target.startsWith(dataDir + path.sep)) { skipped++; continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.getData());
        restored++;
      }
      _jsonCache.clear(); // every cached file may have changed under us
      runDataMigrations();
      console.log(`[Restore] Backup restored: ${restored} file(s) written, ${skipped} skipped`);
      res.json({ success: true, restored, skipped, message: `Restored ${restored} file(s). Restart the backend to load everything cleanly.` });
    } catch (error) {
      console.error('[Restore] Error:', error);
      res.status(500).json({ error: error.message || 'Restore failed' });
    } finally { cleanupUpload(req); }
  });

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

    // Clone character data for export (with every tree-referenced minigame baked in)
    const exportCharacter = { ...withBakedMiniGames(character) };

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

  // Export character as ZIP: the SwellD PNG card + the character's personal media, in
  // image/ video/ audio/ folders. Media stays as real files — never base64 inside the card JSON.
  app.get('/api/export/character/:id/zip', async (req, res) => {
    try {
      if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid character id' });
      let character;
      if (isPerCharStorageActive()) character = loadCharacter(req.params.id);
      else character = (loadData(DATA_FILES.characters) || []).find(c => c.id === req.params.id);
      if (!character) return res.status(404).json({ error: 'Character not found' });

      const pngBuffer = await characterExporter.exportCharacterPNG(withBakedMiniGames(character), 'swelld', {
        selectedStories: character.stories || [], flows: [], embedFlows: false
      });
      const safeName = (character.name || 'Character').replace(/[^a-z0-9]/gi, '_');
      const archiver = require('archiver');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err) => { console.error('[Export ZIP]', err); try { res.destroy(); } catch (e) {} });
      archive.pipe(res);
      archive.append(pngBuffer, { name: `${safeName}.png` });
      const media = listCharMedia(character.id);
      for (const t of CHAR_MEDIA_TYPES) {
        for (const f of media[t]) archive.file(path.join(charMediaDir(character.id, t), f.name), { name: `${t}/${f.name}` });
      }
      await archive.finalize();
    } catch (error) {
      console.error('[Export ZIP] Error:', error);
      if (!res.headersSent) res.status(500).json({ error: error.message || 'Failed to export character zip' });
    }
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

      // Generate PNG (swelld embeds the full character — bake tree-referenced minigames in first)
      const pngBuffer = await characterExporter.exportCharacterPNG(
        format === 'swelld' ? withBakedMiniGames(character) : character, format, {
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
    const personaFileLabel = (persona.displayName || persona.name || 'persona').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${personaFileLabel}_persona.json"`);
    res.json(exportData);
  });

  // Export single flow

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
      } else {
        const characters = loadData(DATA_FILES.characters) || [];
        characters.push(newCharacter);
        saveData(DATA_FILES.characters, characters);
      }
      broadcastCharacterDelta(newCharacter);

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
};
