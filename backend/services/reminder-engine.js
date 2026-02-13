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

        if (text.includes(searchKey)) {
          return true;
        }
      }
    }

    return false;
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
    const charActive = this.getActiveReminders(characterReminders || [], messages);
    const globalActive = this.getActiveReminders(globalReminders || [], messages);

    // Merge and re-sort by priority
    const merged = [...globalActive, ...charActive];
    return merged.sort((a, b) => {
      const priorityA = a.priority !== undefined ? a.priority : 100;
      const priorityB = b.priority !== undefined ? b.priority : 100;
      return priorityB - priorityA;
    });
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
