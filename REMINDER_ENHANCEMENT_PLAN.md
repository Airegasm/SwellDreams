# Reminder Enhancement Plan - Lorebook/Worldbook Style

## Current Reminder Structure

```javascript
{
  id: "reminder-123",
  name: "Reminder Name",
  text: "Reminder content...",
  target: "character" | "player",  // Display position in UI
  enabled: true
}
```

## Enhanced Reminder Structure

```javascript
{
  id: "reminder-123",
  name: "Reminder Name",
  text: "Reminder content...",
  target: "character" | "player",
  enabled: true,

  // NEW LOREBOOK FEATURES:
  constant: true,              // Always active (ignores keys)
  keys: ["keyword1", "keyword2"],  // Trigger keywords
  caseSensitive: false,        // Case-sensitive key matching
  priority: 100,               // Insertion priority (higher = earlier in prompt)
  scanDepth: 10,              // How many recent messages to scan for keys (0 = scan all)

  // OPTIONAL ADVANCED FEATURES (for future):
  secondaryKeys: [],          // Alternative trigger words
  insertionPosition: "after_character",  // Where to inject in prompt
  minActivations: 1,          // Min key matches needed to activate
  cooldown: 0                 // Messages to wait before re-activating
}
```

## Field Descriptions

### Core Fields (Existing)
- **id**: Unique identifier
- **name**: Brief label for UI display
- **text**: The actual reminder content injected into prompt
- **target**: Display position ('player' or 'character') - UI only
- **enabled**: Master toggle to enable/disable reminder

### Lorebook Fields (New - Priority 1)
- **constant**: `boolean` - If true, always active (like current behavior). If false, only activates when keys are found.
- **keys**: `string[]` - Array of trigger keywords. When any key is found in recent messages, the reminder activates.
- **caseSensitive**: `boolean` - Whether key matching is case-sensitive (default: false)
- **priority**: `number` - Insertion order (higher priority = inserted earlier in prompt, default: 100)
- **scanDepth**: `number` - How many recent messages to scan for keys (0 = all messages, default: 10)

### Advanced Fields (New - Priority 2 - Optional for later)
- **secondaryKeys**: `string[]` - Alternative keywords (ORed with primary keys)
- **insertionPosition**: `string` - Precise control over where in prompt ('after_character', 'after_scenario', 'end')
- **minActivations**: `number` - Minimum number of key matches required (default: 1)
- **cooldown**: `number` - Number of messages before reminder can re-activate after deactivating

## Implementation Plan

### Phase 1: Data Structure & Migration

**File**: `backend/services/reminder-migration.js` (NEW)

Create migration service to update existing reminders:

```javascript
function migrateReminderToEnhanced(oldReminder) {
  return {
    ...oldReminder,
    constant: true,          // Existing reminders are always active
    keys: [],               // No keys by default
    caseSensitive: false,
    priority: 100,
    scanDepth: 10
  };
}
```

**File**: `backend/server.js`

Add migration on server startup:
- Load characters and settings
- Check if reminders have new fields
- If not, migrate them automatically
- Save migrated data

### Phase 2: Backend Prompt Building Logic

**File**: `backend/services/reminder-engine.js` (NEW)

Create reminder activation service:

```javascript
class ReminderEngine {
  /**
   * Get active reminders based on conversation history
   * @param {Array} reminders - All reminders
   * @param {Array} messages - Recent conversation messages
   * @returns {Array} Active reminders sorted by priority
   */
  getActiveReminders(reminders, messages) {
    const enabledReminders = reminders.filter(r => r.enabled !== false);

    const activeReminders = enabledReminders.filter(reminder => {
      // If constant, always include
      if (reminder.constant) return true;

      // If no keys, treat as constant
      if (!reminder.keys || reminder.keys.length === 0) return true;

      // Check if any key matches in recent messages
      return this.hasKeyMatch(reminder, messages);
    });

    // Sort by priority (descending)
    return activeReminders.sort((a, b) => (b.priority || 100) - (a.priority || 100));
  }

  /**
   * Check if reminder keys match in message history
   */
  hasKeyMatch(reminder, messages) {
    const scanDepth = reminder.scanDepth || 10;
    const messagesToScan = scanDepth === 0 ? messages : messages.slice(-scanDepth);
    const keys = reminder.keys || [];
    const caseSensitive = reminder.caseSensitive || false;

    for (const message of messagesToScan) {
      const text = caseSensitive ? message.content : message.content.toLowerCase();

      for (const key of keys) {
        const searchKey = caseSensitive ? key : key.toLowerCase();
        if (text.includes(searchKey)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Build reminder section for prompt
   */
  buildReminderPrompt(reminders, label = 'Constant Reminders') {
    if (reminders.length === 0) return '';

    let prompt = `${label}:\n`;
    for (const reminder of reminders) {
      prompt += `- ${reminder.text}\n`;
    }
    return prompt + '\n';
  }
}
```

**File**: `backend/server.js`

Update all prompt building locations (chat, improve, guided):

```javascript
// OLD:
const charReminders = (character.constantReminders || []).filter(r => r.enabled !== false);
const globalReminders = (settings.globalReminders || []).filter(r => r.enabled !== false);

// NEW:
const reminderEngine = require('./services/reminder-engine');
const charReminders = reminderEngine.getActiveReminders(
  character.constantReminders || [],
  recentMessages  // Last N messages from conversation
);
const globalReminders = reminderEngine.getActiveReminders(
  settings.globalReminders || [],
  recentMessages
);

const activeReminders = [...globalReminders, ...charReminders]
  .sort((a, b) => (b.priority || 100) - (a.priority || 100));

systemPrompt += reminderEngine.buildReminderPrompt(activeReminders, 'Active Reminders');
```

### Phase 3: Frontend UI Updates

**File**: `frontend/src/components/modals/CharacterEditorModal.js`

Update reminder form to include new fields:

```jsx
<div className="form-group">
  <label className="checkbox-label">
    <input
      type="checkbox"
      checked={reminderForm.constant}
      onChange={(e) => setReminderForm({ ...reminderForm, constant: e.target.checked })}
    />
    <span>Always Active (Constant)</span>
  </label>
  <span className="field-hint">If unchecked, only activates when keywords are detected</span>
</div>

{!reminderForm.constant && (
  <div className="form-group">
    <label>Trigger Keywords</label>
    <KeywordInput
      values={reminderForm.keys || []}
      onChange={(keys) => setReminderForm({ ...reminderForm, keys })}
      placeholder="Type keyword and press Enter..."
    />
    <span className="field-hint">Reminder activates when any keyword appears in recent messages</span>

    <div className="inline-options">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={reminderForm.caseSensitive}
          onChange={(e) => setReminderForm({ ...reminderForm, caseSensitive: e.target.checked })}
        />
        <span>Case Sensitive</span>
      </label>

      <div className="number-input-group">
        <label>Scan Depth:</label>
        <input
          type="number"
          value={reminderForm.scanDepth || 10}
          onChange={(e) => setReminderForm({ ...reminderForm, scanDepth: parseInt(e.target.value) })}
          min="0"
          max="100"
          style={{ width: '80px' }}
        />
        <span className="field-hint">(0 = all messages)</span>
      </div>
    </div>
  </div>
)}

<div className="form-group">
  <label>Priority (Insertion Order)</label>
  <input
    type="number"
    value={reminderForm.priority || 100}
    onChange={(e) => setReminderForm({ ...reminderForm, priority: parseInt(e.target.value) })}
    min="0"
    max="1000"
  />
  <span className="field-hint">Higher priority reminders appear earlier in prompt (default: 100)</span>
</div>
```

**File**: `frontend/src/components/common/KeywordInput.js` (NEW)

Create reusable keyword tag input component:

```jsx
function KeywordInput({ values, onChange, placeholder }) {
  const [input, setInput] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!values.includes(input.trim())) {
        onChange([...values, input.trim()]);
      }
      setInput('');
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const handleRemove = (index) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="keyword-input">
      <div className="keyword-tags">
        {values.map((keyword, index) => (
          <span key={index} className="keyword-tag">
            {keyword}
            <button type="button" onClick={() => handleRemove(index)}>×</button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ''}
        />
      </div>
    </div>
  );
}
```

**File**: `frontend/src/components/common/KeywordInput.css` (NEW)

Style the keyword input component.

### Phase 4: Settings Page for Global Reminders

**File**: `frontend/src/components/settings/RemindersTab.js` (NEW)

Create dedicated tab for managing global reminders (same UI as character reminders).

Update `SettingsModal.js` to include Reminders tab.

### Phase 5: V2/V3 Import Integration

**File**: `backend/services/character-converter.js`

Update to create enhanced reminders from character book:

```javascript
// Convert character_book entries to enhanced reminders
constantReminders: [
  // Creator notes
  v2.data.creator_notes ? {
    id: uuidv4(),
    name: 'Creator Notes',
    text: v2.data.creator_notes,
    target: 'character',
    enabled: true,
    constant: true,  // Always show creator notes
    keys: [],
    caseSensitive: false,
    priority: 200,  // High priority for creator notes
    scanDepth: 10
  } : null,

  // Character book entries
  ...(v2.data.character_book?.entries || [])
    .filter(e => e.enabled)
    .map(e => ({
      id: uuidv4(),
      name: e.name || 'Lorebook Entry',
      text: e.content,
      target: 'character',
      enabled: true,
      constant: e.constant || false,
      keys: e.keys || [],
      caseSensitive: e.case_sensitive || false,
      priority: e.priority || e.insertion_order || 100,
      scanDepth: e.scan_depth || 10
    }))
].filter(Boolean)
```

## Migration Strategy

### Backward Compatibility

All existing reminders should continue to work:
- Old reminders without new fields get defaults
- `constant: true` makes them behave like current system
- Empty `keys: []` means always active

### Default Values

```javascript
{
  constant: true,      // Backwards compatible - always active
  keys: [],           // No keywords
  caseSensitive: false,
  priority: 100,      // Medium priority
  scanDepth: 10       // Last 10 messages
}
```

## Testing Checklist

### Data Migration
- [ ] Existing characters load correctly
- [ ] Old reminders get default values
- [ ] No data loss during migration

### Constant Reminders
- [ ] Constant reminders always appear
- [ ] Work same as before enhancement

### Keyword Activation
- [ ] Reminders activate when keywords found
- [ ] Case sensitivity respected
- [ ] Scan depth limits work correctly
- [ ] Inactive when keywords not present

### Priority Ordering
- [ ] Higher priority appears first
- [ ] Global and character reminders merge correctly
- [ ] Priority ties maintain stable order

### UI
- [ ] Keyword input component works
- [ ] Toggle constant mode
- [ ] All fields save correctly
- [ ] Form validation works

### Import
- [ ] V2/V3 character books convert correctly
- [ ] Constant entries marked as constant
- [ ] Keyed entries have correct keys
- [ ] Priorities preserved

## Benefits

1. **Full V2/V3 Compatibility**: Character books import with full functionality
2. **Dynamic Context**: Only relevant lore appears in prompts
3. **Token Efficiency**: Fewer constant reminders = more room for conversation
4. **Flexible Control**: Users can choose constant or keyword-triggered
5. **Priority Control**: Important reminders can be prioritized
6. **Backward Compatible**: Existing setups continue working unchanged
