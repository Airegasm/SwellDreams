# V2/V3 Character Card Import - COMPLETE ✅

## Overview

Full V2/V3 character card import functionality has been implemented for both characters and personas. Users can now import character cards from JSON or PNG files in standard V2/V3 format.

## Implementation Summary

### Backend (server.js)

#### 1. Multer Configuration for Card Uploads
**Location:** ~Line 207

```javascript
const cardUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
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
```

#### 2. Import Character Card Endpoint
**Endpoint:** `POST /api/import/character-card`
**Location:** ~Line 6775

**Features:**
- Accepts JSON or PNG files
- Extracts metadata from PNG (V2 tEXt "chara" or V3 tEXt "ccv3")
- Auto-detects V2 vs V3 format
- Converts to SwellDreams format using character-converter.js
- Preserves avatar from PNG
- Saves to custom characters folder
- Broadcasts update to all clients

**Response:**
```json
{
  "success": true,
  "character": { /* converted character */ },
  "message": "Successfully imported \"Character Name\" from V3 format"
}
```

#### 3. Import Persona Card Endpoint
**Endpoint:** `POST /api/import/persona-card`
**Location:** ~Line 6842

**Features:**
- Same as character import
- Converts V2/V3 cards to SwellDreams persona format
- Uses persona-converter.js
- Saves to personas folder

**Response:**
```json
{
  "success": true,
  "persona": { /* converted persona */ },
  "message": "Successfully imported \"Persona Name\" from V2 format"
}
```

### Frontend

#### 1. CharacterTab Import Button
**File:** `frontend/src/components/settings/CharacterTab.js`

**Added:**
- New state: `importingV2V3`
- New ref: `v2v3FileInputRef`
- Handler: `handleV2V3Import()` - Uploads file to `/api/import/character-card`
- Handler: `handleV2V3ImportClick()` - Triggers file picker
- Button: "Convert V2/V3" (next to existing Import button)
- File input: Accepts `.json,.png` files

**UI Location:**
```
Settings → Characters → "Convert V2/V3" button
```

#### 2. PersonaTab Import Button
**File:** `frontend/src/components/settings/PersonaTab.js`

**Added:**
- New state: `importingV2V3`
- New ref: `v2v3FileInputRef`
- Handler: `handleV2V3Import()` - Uploads file to `/api/import/persona-card`
- Handler: `handleV2V3ImportClick()` - Triggers file picker
- Button: "Convert V2/V3" (next to New Persona button)
- File input: Accepts `.json,.png` files

**UI Location:**
```
Settings → Personas → "Convert V2/V3" button
```

## Conversion Features

### Character Card → SwellDreams Character

**Mapped Fields:**
- ✅ `name` → `name`
- ✅ `description` → `description`
- ✅ `personality` → `personality`
- ✅ `first_mes` → `stories[0].welcomeMessages[0]`
- ✅ `alternate_greetings` → `stories[0].welcomeMessages[1..n]`
- ✅ `scenario` → `stories[0].scenarios[0]`
- ✅ `mes_example` → `stories[0].exampleDialogues[]` (parsed)
- ✅ PNG image → `avatar` (base64)

**Enhanced Reminder Conversion:**
- ✅ `creator_notes` → `constantReminders[]` with `constant: true`, `priority: 200`
- ✅ `character_book.entries[]` → `constantReminders[]` with full lorebook fields:
  - `constant` - From entry.constant
  - `keys` - From entry.keys
  - `caseSensitive` - From entry.case_sensitive
  - `priority` - From entry.priority or entry.insertion_order
  - `scanDepth` - From entry.scan_depth (default 10)

**Metadata Preservation:**
```javascript
extensions: {
  v2v3Import: {
    originalFormat: 'chara_card_v2' | 'chara_card_v3',
    importedAt: "2026-02-13T...",
    tags: [...],
    creator: "...",
    creatorNotes: "...",
    characterVersion: "..."
  }
}
```

### Character Card → SwellDreams Persona

**Mapped Fields:**
- ✅ `name` → `displayName`
- ✅ `description` → `appearance`
- ✅ `personality` → `personality`
- ✅ `scenario` → `relationshipWithInflation`
- ✅ PNG image → `avatar` (base64)
- ✅ Auto-inferred `pronouns` from personality/description text

**Metadata Preservation:**
Same as character, stored in `extensions.v2v3Import`

## User Flow

### Importing a Character Card

1. Navigate to **Settings → Characters**
2. Click **"Convert V2/V3"** button
3. Select a file:
   - **JSON:** Raw V2/V3 character card
   - **PNG:** Character card PNG with embedded metadata
4. System automatically:
   - Detects format (V2 or V3)
   - Extracts data (from JSON or PNG metadata)
   - Converts to SwellDreams format
   - Preserves lorebook with keyword triggers
   - Sets up default story structure
5. Success message: "Successfully imported \"Character Name\" from V3 format"
6. Character appears in list immediately

### Importing a Persona Card

1. Navigate to **Settings → Personas**
2. Click **"Convert V2/V3"** button
3. Select a file (JSON or PNG)
4. System converts to persona format
5. Success message: "Successfully imported \"Persona Name\" from V2 format"
6. Persona appears in list immediately

## Error Handling

**Validation Errors:**
- ❌ No file selected → "No file uploaded"
- ❌ Invalid file type → "Invalid file type. Only JSON and PNG files are allowed."
- ❌ PNG without metadata → "No character data found in PNG metadata"
- ❌ Invalid JSON → "Invalid JSON file"

**User Feedback:**
- ✅ Loading state: Button shows "Converting..." while processing
- ✅ Success toast: Shows imported character/persona name
- ✅ Error toast: Shows specific error message
- ✅ File input resets after completion (can import same file again)

## Testing Checklist

### Character Import
- [ ] Import V2 JSON → Character created with all fields
- [ ] Import V2 PNG → Character created with avatar
- [ ] Import V3 JSON → V3-specific fields preserved
- [ ] Import V3 PNG → Metadata extracted correctly
- [ ] Character book entries → Converted to enhanced reminders
- [ ] Constant entries → `constant: true`
- [ ] Keyed entries → `constant: false` with keywords
- [ ] Priority preserved from insertion_order
- [ ] Example dialogues parsed from `<START>` format
- [ ] Alternate greetings → Multiple welcome messages
- [ ] Invalid file → Error message shown
- [ ] Character appears in list after import
- [ ] Can chat with imported character

### Persona Import
- [ ] Import V2 JSON → Persona created
- [ ] Import V2 PNG → Avatar extracted
- [ ] Import V3 PNG → V3 fields handled
- [ ] Pronouns inferred correctly (he/she/they/it)
- [ ] Description → Appearance mapping
- [ ] Scenario → relationshipWithInflation mapping
- [ ] Invalid file → Error message
- [ ] Persona appears in list after import
- [ ] Can set as active persona

### Lorebook/Reminder Integration
- [ ] Constant reminder always appears in prompt
- [ ] Keyword-triggered reminder only appears when keyword in chat
- [ ] Priority ordering works (high priority first)
- [ ] Case sensitivity respected
- [ ] Scan depth limits keyword search
- [ ] Old characters still work (backward compatible)

## Files Modified

### Backend
- ✅ `backend/server.js` - Added endpoints and multer config
- ✅ `backend/services/character-converter.js` - Conversion logic
- ✅ `backend/services/persona-converter.js` - Persona conversion

### Frontend
- ✅ `frontend/src/components/settings/CharacterTab.js` - Import button
- ✅ `frontend/src/components/settings/PersonaTab.js` - Import button

### Supporting Services (Already Complete)
- ✅ `backend/services/reminder-engine.js` - Handles lorebook activation
- ✅ `frontend/src/components/common/KeywordInput.js` - UI for keywords
- ✅ `frontend/src/components/modals/CharacterEditorModal.js` - Enhanced reminder UI

## What's Complete ✅

- [x] Backend import endpoints for characters
- [x] Backend import endpoints for personas
- [x] PNG metadata extraction (V2 and V3)
- [x] JSON parsing and validation
- [x] Format auto-detection
- [x] Field mapping and conversion
- [x] Lorebook → Enhanced reminders conversion
- [x] Avatar extraction from PNG
- [x] Frontend import buttons (characters)
- [x] Frontend import buttons (personas)
- [x] Error handling and validation
- [x] Success/error notifications
- [x] File input reset after import
- [x] Backward compatibility with existing data

## Success! 🎉

Users can now:
1. Import V2/V3 character cards from **JSON or PNG files**
2. Use them as **characters** or **personas**
3. Get full **lorebook functionality** with keyword triggers
4. Preserve all metadata and attribution
5. Have characters appear instantly in the UI

The entire V2/V3 import pipeline is complete and ready for testing!
