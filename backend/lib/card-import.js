/**
 * Character-card import route (E1 extraction): /api/import/character-card — accepts SwellD PNG,
 * V2/V3 PNG, raw JSON, or a .zip (card + media folders). Disk-staged uploads (A3): magic bytes
 * sniffed from the temp file; zips decompress lazily per entry. Extracted verbatim from server.js.
 */
const fs = require('fs');
const path = require('path');

module.exports = function initCardImport(ctx) {
  const { app, cardUpload, cleanupUpload, characterConverter, saveCharacterAsync, saveData, loadData,
          DATA_FILES, isPerCharStorageActive, broadcastCharacterDelta, writeCharMediaFile, uuidv4 } = ctx;

  app.post('/api/import/character-card', cardUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      let fileType = req.file.mimetype;
      let characterData = null;
      let avatarData = null;
      let isSwellDImport = false;
      let swelldExportData = null;
      let zipMediaFiles = null; // [{type:'image'|'video'|'audio', name, entry}] from a ZIP import (lazy — data read at write time)

      // Uploads are disk-staged (see diskUploadStorage) — sniff the magic bytes from disk so a
      // 600MB zip is never read wholesale into RAM.
      const head = Buffer.alloc(4);
      { const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd); }
      let fileBuffer = null;

      // ZIP import: a card (.png/.json at the archive root) + the character's media in
      // image/ video/ audio/ folders. Unwrap to the card and stash the media for after the save.
      const looksZip = head[0] === 0x50 && head[1] === 0x4b
        && (fileType.includes('zip') || /\.zip$/i.test(req.file.originalname || ''));
      if (looksZip) {
        const AdmZip = require('adm-zip');
        const entries = new AdmZip(req.file.path).getEntries().filter(e => !e.isDirectory); // path ctor = lazy per-entry decompression
        const isMediaEntry = (n) => /^(image|video|audio)\//i.test(n);
        const cardEntry = entries.find(e => !isMediaEntry(e.entryName) && /\.png$/i.test(e.entryName))
          || entries.find(e => !isMediaEntry(e.entryName) && /\.(json|swelld)$/i.test(e.entryName));
        if (!cardEntry) return res.status(400).json({ error: 'ZIP contains no character card (.png/.json) at its root' });
        fileBuffer = cardEntry.getData();
        // Sniff the card's real type — a .swelld extension may wrap either a PNG or JSON payload.
        fileType = (fileBuffer.length > 3 && fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) ? 'image/png' : 'application/json';
        zipMediaFiles = entries
          .map(e => { const m = e.entryName.match(/^(image|video|audio)\/(.+)$/i); return m ? { type: m[1].toLowerCase(), name: m[2], entry: e } : null; })
          .filter(Boolean);
        console.log(`[Import] ZIP unwrapped: card "${cardEntry.entryName}" + ${zipMediaFiles.length} media file(s)`);
      } else {
        fileBuffer = fs.readFileSync(req.file.path); // bare cards (PNG/JSON) are small
      }

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

      // After the character is saved: move a ZIP's media into its personal media subfolders.
      const importZipMedia = (charId) => {
        if (!zipMediaFiles?.length || !charId) return 0;
        let n = 0;
        for (const f of zipMediaFiles) {
          try { writeCharMediaFile(charId, f.type, f.name, f.entry.getData()); n++; } // one file's data in RAM at a time
          catch (e) { console.error(`[Import] media '${f.name}' failed:`, e?.message || e); }
        }
        if (n) console.log(`[Import] Placed ${n} media file(s) into the imported character's media folders`);
        return n;
      };

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

        // Flow engine removed (E3): legacy cards with embedded flows import WITHOUT them.
        if (importData.flows && importData.flows.length > 0) {
          console.log(`[Import] Card embeds ${importData.flows.length} legacy flow(s) — flow engine removed, skipping (rebuild as trigger trees)`);
        }
        // (Embedded-flow import path deleted — legacy cards import without their flows.)
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

      // Broadcast just the imported character (delta shape)
      broadcastCharacterDelta(convertedCharacter);

      const formatLabel = isSwellDImport ? 'SwellDreams PNG' : (characterConverter.detectFormat(characterData) || 'V2').toUpperCase();
      const zipMediaN = importZipMedia(convertedCharacter.id);

      res.json({
        success: true,
        character: convertedCharacter,
        message: `Successfully imported "${convertedCharacter.name}" from ${formatLabel} format${zipMediaN ? ` + ${zipMediaN} media file(s)` : ''}`
      });

    } catch (error) {
      const fileName = req.file?.originalname || 'unknown';
      console.error(`[Import] Character card import failed for "${fileName}":`, error.message || error);
      res.status(500).json({ error: error.message || 'Failed to import character card' });
    } finally { cleanupUpload(req); }
  });
};
