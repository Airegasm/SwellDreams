# SwellDreams v3.6.0 "Lorebook Edition" - Release Notes

## Release Date
February 13, 2026

## Overview
Version 3.6 introduces a powerful dynamic lorebook system and V2/V3 character card import functionality, making SwellDreams fully compatible with character cards from other AI chat platforms while adding advanced context management capabilities.

## 🎉 Major Features

### 1. Dynamic Lorebook System

Transform your characters with intelligent, context-aware reminders that activate based on conversation flow.

#### Features:
- **Keyword Triggers**: Set keywords that automatically activate reminders when mentioned
- **Priority System**: Control insertion order (higher priority = earlier in prompt)
- **Constant Mode**: Toggle between always-active and keyword-triggered
- **Case Sensitivity**: Choose case-sensitive or case-insensitive keyword matching
- **Scan Depth**: Control how many recent messages to scan (0 = all messages)
- **Token Optimization**: Only include relevant lore, saving context space

#### How It Works:
```javascript
// Constant Reminder (Always Active)
{
  name: "Core Personality",
  text: "Dr. Elena speaks with clinical precision",
  constant: true,
  priority: 150
}

// Keyword-Triggered Reminder
{
  name: "Dragon Lore",
  text: "Dragons breathe ice instead of fire",
  constant: false,
  keys: ["dragon", "Dragon", "drake"],
  caseSensitive: false,
  priority: 100,
  scanDepth: 10
}
```

#### Benefits:
- **Context-Aware**: Only relevant lore appears in prompts
- **Token Efficient**: More room for conversation
- **Flexible**: Mix constant and triggered reminders
- **Dynamic**: Adapts to conversation topics automatically

### 2. V2/V3 Character Card Import

Bring your existing characters from SillyTavern, TavernAI, and other platforms directly into SwellDreams.

#### Supported Formats:
- ✅ Character Card V2 (JSON)
- ✅ Character Card V2 (PNG with embedded metadata)
- ✅ Character Card V3 (JSON)
- ✅ Character Card V3 (PNG with embedded metadata)

#### What Gets Imported:
- **Basic Info**: Name, description, personality
- **Messages**: First message + alternate greetings → Multiple welcome messages
- **Scenarios**: Scenario text → SwellDreams scenarios
- **Example Dialogues**: `<START>` delimited examples → Parsed example dialogues
- **Character Book**: Lorebook entries → Enhanced reminders with keyword triggers
- **Avatar**: PNG image → Character avatar
- **Metadata**: Creator, tags, version preserved in extensions

#### Import Process:
1. Settings → Characters → "Convert V2/V3" button
2. Select JSON or PNG file
3. Automatic format detection (V2 vs V3)
4. Full lorebook conversion with keyword triggers
5. Character appears instantly in list

#### Persona Import:
You can also import V2/V3 cards as **personas** for role-reversal scenarios:
- Settings → Personas → "Convert V2/V3"
- Description → Appearance mapping
- Scenario → Relationship with Inflation
- Auto-inferred pronouns from text

### 3. Enhanced Character Editor

#### New Features:
- **Tag-Based Keyword Input**: Press Enter to add keywords, Backspace to remove
- **Visual Badges**: Shows keyword count and priority for each reminder
- **Priority Display**: Purple badge shows non-default priorities
- **Keyword Badge**: Yellow badge shows number of trigger keywords
- **Improved Validation**: Ensures keyword-triggered reminders have keywords
- **Better Organization**: Reminders sorted by priority

#### UI Improvements:
- Checkbox layout with descriptions for better readability
- Inline options for case sensitivity and scan depth
- Clear visual distinction between constant and triggered reminders
- Improved form validation with helpful error messages

## 🔧 Technical Improvements

### Backend

#### New Services:
- **`reminder-engine.js`**: Dynamic reminder activation and filtering
- **`character-converter.js`**: V2/V3 to SwellDreams conversion
- **`persona-converter.js`**: V2/V3 to persona conversion

#### New Endpoints:
- `POST /api/import/character-card` - Import V2/V3 character card
- `POST /api/import/persona-card` - Import V2/V3 card as persona

#### Multer Configuration:
- New file upload handler for card imports
- 10MB size limit
- Accepts JSON and PNG files
- PNG metadata extraction (tEXt chunks)

#### Prompt Integration:
Updated all 4 prompt building locations:
- Welcome message enhancement
- Impersonate mode
- Guided character mode
- Normal chat context

### Frontend

#### New Components:
- **`WhatsNewTab.js`**: Version 3.6 changelog and feature documentation
- **`KeywordInput.js`**: Reusable tag-based keyword input component
- **`KeywordInput.css`**: Styling for keyword tags

#### Updated Components:
- **`CharacterTab.js`**: Added "Convert V2/V3" import button
- **`PersonaTab.js`**: Added "Convert V2/V3" import button
- **`CharacterEditorModal.js`**: Enhanced reminder form with all new fields
- **`CharacterEditorModal.css`**: New badge styles and layouts
- **`Help.js`**: Added What's New tab (now default)
- **`ConversationsTab.js`**: Updated reminder documentation

## 📊 Data Structure Changes

### Enhanced Reminder Format:
```javascript
{
  id: "reminder-123",
  name: "Reminder Name",
  text: "Reminder content...",
  target: "character" | "player",
  enabled: true,

  // NEW FIELDS
  constant: true,              // Always active if true
  keys: ["keyword1", "key2"],  // Trigger keywords
  caseSensitive: false,        // Case-sensitive matching
  priority: 100,               // Insertion order (default: 100)
  scanDepth: 10               // Messages to scan (0 = all)
}
```

### Import Metadata Preservation:
```javascript
extensions: {
  v2v3Import: {
    originalFormat: "chara_card_v2" | "chara_card_v3",
    importedAt: "2026-02-13T...",
    tags: [...],
    creator: "...",
    creatorNotes: "...",
    characterVersion: "..."
  }
}
```

## ✅ Backward Compatibility

**All existing characters and reminders work unchanged!**

- Old reminders without new fields get defaults via `ensureReminderDefaults()`
- Default `constant: true` (always active)
- Default `keys: []` (no keywords)
- Default `priority: 100` (medium priority)
- Default `scanDepth: 10` (last 10 messages)

**No migration required** - everything continues to work as before.

## 📖 User Guide

### Creating a Keyword-Triggered Reminder:

1. Edit character → Custom Reminders tab
2. Click "+ Add Reminder"
3. Enter name and text
4. **Uncheck** "Always Active (Constant)"
5. Add keywords (press Enter after each)
6. Set priority (higher = earlier in prompt)
7. Adjust scan depth (how many messages to check)
8. Optional: Enable case sensitivity
9. Click "Create"

### Importing a V2/V3 Character Card:

1. Settings → Characters
2. Click "Convert V2/V3" button
3. Select your JSON or PNG file
4. Character imports automatically with:
   - All fields mapped correctly
   - Lorebook entries → Enhanced reminders
   - Keywords and priorities preserved
5. Success message shows character name
6. Character appears in list

### Testing Keyword Activation:

1. Create a reminder with keyword "dragon"
2. Set `constant: false`
3. Start a conversation
4. Mention "dragon" in your message
5. Check backend logs - reminder should activate
6. Continue without mentioning "dragon"
7. Reminder should NOT appear in next response

## 🐛 Bug Fixes

- Fixed reminder prompt injection consistency across generation modes
- Improved PNG metadata extraction error handling
- Enhanced validation for reminder forms
- Fixed edge cases in character book conversion
- Better error messages for failed imports

## 📦 Updated Files

### Version Numbers:
- `backend/package.json`: 3.5.1 → 3.6.0
- `frontend/package.json`: 3.5.2 → 3.6.0

### Backend:
- ✅ `server.js` - Import endpoints and reminder engine integration
- ✅ `services/reminder-engine.js` - NEW
- ✅ `services/character-converter.js` - NEW
- ✅ `services/persona-converter.js` - NEW

### Frontend:
- ✅ `components/help/WhatsNewTab.js` - NEW
- ✅ `components/common/KeywordInput.js` - NEW
- ✅ `components/common/KeywordInput.css` - NEW
- ✅ `components/modals/CharacterEditorModal.js` - Enhanced
- ✅ `components/modals/CharacterEditorModal.css` - Enhanced
- ✅ `components/settings/CharacterTab.js` - Import button
- ✅ `components/settings/PersonaTab.js` - Import button
- ✅ `pages/Help.js` - What's New tab
- ✅ `components/help/ConversationsTab.js` - Updated docs

### Documentation:
- ✅ `README.md` - Version 3.6 features
- ✅ `REMINDER_ENHANCEMENT_PLAN.md` - Technical specification
- ✅ `REMINDER_ENHANCEMENTS_COMPLETED.md` - Implementation summary
- ✅ `REMINDER_ENGINE_INTEGRATION_COMPLETE.md` - Integration details
- ✅ `V2V3_IMPORT_IMPLEMENTATION_COMPLETE.md` - Import feature docs

## 🚀 Coming Soon (Future Versions)

- Global Reminders management tab in Settings
- Advanced lorebook features (insertion position, cooldowns)
- Regex pattern support for keywords
- Export to V2/V3 format
- Multi-keyword logic (AND/OR operators)
- Reminder groups and folders
- Import from other formats (CAI, Pygmalion, etc.)

## 💬 Community

- **Issues**: [GitHub Issues](https://github.com/airegasm/swelldreams/issues)
- **Community**: [airegasm.com](https://airegasm.com)

## 🙏 Credits

Special thanks to the SillyTavern and TavernAI communities for establishing the V2/V3 character card standards that made cross-platform compatibility possible.

---

**SwellDreams v3.6.0 "Lorebook Edition"**
Made with care by the Airegasm team.
