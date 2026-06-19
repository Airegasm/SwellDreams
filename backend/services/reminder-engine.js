/**
 * Reminder Engine - Lorebook/Worldbook Style Activation
 *
 * Handles dynamic activation of reminders based on keywords, priorities, and context.
 * Supports both constant (always-on) and selective (keyword-triggered) reminders.
 */

class ReminderEngine {
  /**
   * Get active reminders based on conversation history
   * @param {Array} reminders - All reminders (character or global)
   * @param {Array} messages - Recent conversation messages [{role, content}]
   * @returns {Array} Active reminders sorted by priority (descending)
   */
  getActiveReminders(reminders, messages = []) {
    if (!Array.isArray(reminders)) return [];

    // Filter to enabled reminders only
    const enabledReminders = reminders.filter(r => r && r.enabled !== false);

    // Determine which reminders should be active
    const activeReminders = enabledReminders.filter(reminder => {
      // Migrate old reminders on the fly (add default fields if missing)
      reminder = this.ensureReminderDefaults(reminder);

      // If marked as constant, always include
      if (reminder.constant === true) return true;

      // If no keys defined, treat as constant (backward compat)
      if (!reminder.keys || reminder.keys.length === 0) return true;

      // Check if any key matches in recent messages
      return this.hasKeyMatch(reminder, messages);
    });

    // Sort by priority (descending - higher priority first)
    return activeReminders.sort((a, b) => {
      const priorityA = a.priority !== undefined ? a.priority : 100;
      const priorityB = b.priority !== undefined ? b.priority : 100;
      return priorityB - priorityA;
    });
  }

  /**
   * Ensure reminder has all required fields (for backward compatibility)
   * @param {Object} reminder - Reminder object (possibly old format)
   * @returns {Object} Reminder with all fields
   */
  ensureReminderDefaults(reminder) {
    return {
      constant: true,      // Default: always active (backward compatible)
      keys: [],           // Default: no keywords
      caseSensitive: false,
      priority: 100,      // Default: medium priority
      scanDepth: 10,      // Default: last 10 messages
      ...reminder         // Override with actual reminder data
    };
  }

  /**
   * Check if reminder keys match in message history
   * @param {Object} reminder - Reminder with keys
   * @param {Array} messages - Conversation messages
   * @returns {boolean} True if any key found in messages
   */
  hasKeyMatch(reminder, messages) {
    if (!messages || messages.length === 0) return false;

    const scanDepth = reminder.scanDepth !== undefined ? reminder.scanDepth : 10;
    const keys = reminder.keys || [];
    const caseSensitive = reminder.caseSensitive || false;

    // Determine which messages to scan
    const messagesToScan = scanDepth === 0 ? messages : messages.slice(-scanDepth);

    // Check each message for key matches
    for (const message of messagesToScan) {
      if (!message || !message.content) continue;

      const text = caseSensitive ? message.content : message.content.toLowerCase();

      // Check if any key appears in this message
      for (const key of keys) {
        if (!key) continue;
        const searchKey = caseSensitive ? key : key.toLowerCase();

        // Single-word keys must match on word boundaries to avoid false
        // positives (e.g. 'ass' inside 'class'). Multi-word keys (containing
        // whitespace) fall back to substring matching.
        if (/\s/.test(searchKey)) {
          if (text.includes(searchKey)) {
            return true;
          }
        } else {
          const escaped = searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`\\b${escaped}\\b`, caseSensitive ? '' : 'i');
          if (wordRegex.test(text)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ============================================================
  // Canonical lorebook engine (Library + Dictionary unified)
  // ============================================================
  // One entry format, one activation pipeline. Accepts legacy reminder shape
  // ({name,text,keys,constant}), dictionary-term shape ({term,definition,keys}),
  // and the canonical shape below — normalizeEntry() folds them all in.

  /**
   * Normalize any supported entry shape into the canonical lorebook entry.
   */
  normalizeEntry(e) {
    if (!e || typeof e !== 'object') return { enabled: false };
    const toArr = (v) => Array.isArray(v)
      ? v.map(s => String(s).trim()).filter(Boolean)
      : (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

    const keys = toArr(e.keys ?? e.key);
    const secondaryKeys = toArr(e.secondaryKeys ?? e.keysecondary);
    const content = e.content ?? e.text ?? e.definition ?? '';
    const title = e.title ?? e.name ?? e.term ?? e.comment ?? '';

    return {
      id: e.id || e.uid || title || String(content).slice(0, 24),
      title,
      content,
      text: content, // back-compat for buildReminderPrompt
      keys,
      secondaryKeys,
      logic: e.logic || this._stLogic(e.selectiveLogic) || 'and_any',
      // Blank keys (and explicit constant) = always-on.
      constant: e.constant === true || keys.length === 0,
      enabled: e.enabled !== false && e.disable !== true,
      probability: (e.probability == null || e.useProbability === false) ? 100 : Number(e.probability),
      order: e.order != null ? Number(e.order) : (e.priority != null ? Number(e.priority) : 100),
      scanDepth: (e.scanDepth == null) ? null : Number(e.scanDepth),
      caseSensitive: !!e.caseSensitive,
      matchWholeWords: e.matchWholeWords, // undefined => default whole-word for single words
      group: (e.group || '').trim(),
      groupWeight: e.groupWeight != null ? Number(e.groupWeight) : 100,
      recurse: e.recurse !== false && e.preventRecursion !== true,
      excludeRecursion: !!e.excludeRecursion,
      scope: e.scope || 'global',
    };
  }

  _stLogic(v) {
    // Map SillyTavern world_info_logic numbers → our string logic.
    return ({ 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' })[v];
  }

  // Build the text window an entry scans (its own scanDepth slice of messages).
  _scanText(messages, scanDepth) {
    if (!Array.isArray(messages) || !messages.length) return '';
    const d = (scanDepth == null || scanDepth === 0) ? messages.length : scanDepth;
    return messages.slice(-d).map(m => (m && (m.content || m.text)) || '').join('\n');
  }

  // Does a single key appear in text? Single words match on word boundaries
  // (so 'ass' doesn't hit 'class'); phrases / matchWholeWords:false use substring.
  _keyInText(key, text, caseSensitive, wholeWords) {
    if (!key || !text) return false;
    const t = caseSensitive ? text : text.toLowerCase();
    const k = caseSensitive ? key : key.toLowerCase();
    if (/\s/.test(k) || wholeWords === false) return t.includes(k);
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, caseSensitive ? '' : 'i').test(t);
  }

  // Direct key/logic activation against a text blob (constant/blank handled by caller).
  _matchKeys(entry, text) {
    if (!entry.keys.length) return false;
    const cs = entry.caseSensitive, ww = entry.matchWholeWords;
    if (!entry.keys.some(k => this._keyInText(k, text, cs, ww))) return false; // primary OR
    const sec = entry.secondaryKeys;
    if (!sec.length) return true;
    const anySec = sec.some(k => this._keyInText(k, text, cs, ww));
    const allSec = sec.every(k => this._keyInText(k, text, cs, ww));
    switch (entry.logic) {
      case 'and_all': return allSec;
      case 'not_any': return !anySec;
      case 'not_all': return !allSec;
      case 'and_any':
      default: return anySec;
    }
  }

  _rollProbability(entry) {
    const p = entry.probability;
    if (p == null || p >= 100) return true;
    if (p <= 0) return false;
    return Math.random() * 100 < p;
  }

  // Inclusion groups: among activated entries sharing a non-empty group, keep ONE,
  // chosen by weighted random (groupWeight). Ungrouped entries all pass.
  _resolveGroups(entries) {
    const groups = {};
    const out = [];
    for (const e of entries) {
      if (!e.group) { out.push(e); continue; }
      (groups[e.group] = groups[e.group] || []).push(e);
    }
    for (const list of Object.values(groups)) {
      if (list.length === 1) { out.push(list[0]); continue; }
      const total = list.reduce((s, e) => s + (e.groupWeight || 100), 0);
      let r = Math.random() * total, pick = list[0];
      for (const e of list) { r -= (e.groupWeight || 100); if (r <= 0) { pick = e; break; } }
      out.push(pick);
    }
    return out;
  }

  /**
   * Full lorebook activation pipeline.
   * @param {Array} entries - Any-shape entries (normalized internally).
   * @param {Array} messages - Recent conversation [{role, content}].
   * @param {Object} opts - { maxRecursion = 3 }
   * @returns {Array} Active canonical entries, group-resolved, sorted by order desc.
   */
  getActiveEntries(entries, messages = [], opts = {}) {
    if (!Array.isArray(entries)) return [];
    const maxRecursion = opts.maxRecursion ?? 3;
    const norm = entries.map(e => this.normalizeEntry(e)).filter(e => e.enabled && (e.content || e.text));

    const activated = new Map();
    let recursionContent = [];

    // Round 0 — scan the conversation.
    for (const e of norm) {
      const on = e.constant || this._matchKeys(e, this._scanText(messages, e.scanDepth));
      if (on && this._rollProbability(e)) {
        activated.set(e.id, e);
        if (e.recurse && e.content) recursionContent.push(e.content);
      }
    }

    // Recursion rounds — scan injected content for more entries.
    let depth = 0;
    while (depth < maxRecursion && recursionContent.length) {
      const buf = recursionContent.join('\n');
      recursionContent = [];
      for (const e of norm) {
        if (activated.has(e.id) || e.excludeRecursion || !e.keys.length) continue;
        if (this._matchKeys(e, buf) && this._rollProbability(e)) {
          activated.set(e.id, e);
          if (e.recurse && e.content) recursionContent.push(e.content);
        }
      }
      depth++;
    }

    return this._resolveGroups([...activated.values()])
      .sort((a, b) => (b.order ?? 100) - (a.order ?? 100));
  }

  /**
   * Build reminder section for prompt
   * @param {Array} reminders - Active reminders (already filtered and sorted)
   * @param {string} label - Section label (default: 'Active Reminders')
   * @returns {string} Formatted prompt section
   */
  buildReminderPrompt(reminders, label = 'Active Reminders') {
    if (!reminders || reminders.length === 0) return '';

    let prompt = `${label}:\n`;
    for (const reminder of reminders) {
      if (reminder && reminder.text) {
        prompt += `- ${reminder.text}\n`;
      }
    }
    return prompt + '\n';
  }

  /**
   * Merge and sort character + global reminders
   * @param {Array} characterReminders - Character-level reminders
   * @param {Array} globalReminders - Global (system) reminders
   * @param {Array} messages - Conversation history
   * @returns {Array} Merged and sorted active reminders
   */
  getMergedActiveReminders(characterReminders, globalReminders, messages) {
    // Run character + global through the unified lorebook pipeline so they get
    // secondary-key logic, probability, recursion, and inclusion groups too. Recursion
    // works across both pools (a global entry can pull in a character entry and vice versa).
    return this.getActiveEntries([...(globalReminders || []), ...(characterReminders || [])], messages, { maxRecursion: 3 });
  }

  /**
   * Extract recent messages from conversation history
   * @param {Array} history - Full conversation history
   * @param {number} count - Number of recent messages to extract
   * @returns {Array} Recent messages [{role, content}]
   */
  extractRecentMessages(history, count = 20) {
    if (!Array.isArray(history)) return [];

    return history.slice(-count).map(msg => ({
      role: msg.role || 'user',
      content: msg.content || msg.text || ''
    }));
  }
}

// Export singleton instance
module.exports = new ReminderEngine();
