import React from 'react';
import './HelpTabs.css';

function WhatsNewTab() {
  return (
    <div className="help-tab">
      <div className="help-section">
        <h2>🎉 What's New in Version 3.6</h2>
        <p className="version-date">Released: February 2026</p>
      </div>

      <div className="help-section">
        <h3>🔖 Dynamic Lorebook System</h3>
        <p>
          Reminders now support full lorebook functionality with keyword-based activation! Create context-aware
          reminders that only appear when relevant keywords are detected in the conversation.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Keyword Triggers:</strong>
            <p>Set keywords that activate reminders automatically when mentioned in chat</p>
          </div>
          <div className="feature-item">
            <strong>Priority System:</strong>
            <p>Control the order reminders appear in the AI's context (higher priority = earlier insertion)</p>
          </div>
          <div className="feature-item">
            <strong>Constant Mode:</strong>
            <p>Toggle between always-active reminders and keyword-triggered ones</p>
          </div>
          <div className="feature-item">
            <strong>Case Sensitivity:</strong>
            <p>Choose whether keyword matching is case-sensitive</p>
          </div>
          <div className="feature-item">
            <strong>Scan Depth:</strong>
            <p>Control how many recent messages to scan for keywords (0 = all messages)</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Edit any character → Custom Reminders tab → Create/Edit reminder →
          Uncheck "Always Active" to enable keyword triggers.
        </div>
      </div>

      <div className="help-section">
        <h3>📥 V2/V3 Character Card Import</h3>
        <p>
          Import character cards from other AI chat platforms (SillyTavern, TavernAI, etc.) with full compatibility!
          Both V2 and V3 formats are supported.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>JSON Import:</strong>
            <p>Import raw V2/V3 character card JSON files</p>
          </div>
          <div className="feature-item">
            <strong>PNG Import:</strong>
            <p>Import character card PNGs with embedded metadata</p>
          </div>
          <div className="feature-item">
            <strong>Lorebook Conversion:</strong>
            <p>Character book entries automatically convert to enhanced reminders with keyword triggers</p>
          </div>
          <div className="feature-item">
            <strong>Full Field Mapping:</strong>
            <p>Name, description, personality, scenarios, example dialogues, and alternate greetings preserved</p>
          </div>
          <div className="feature-item">
            <strong>Persona Import:</strong>
            <p>Convert V2/V3 cards to SwellDreams personas for role-playing as the character</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Settings → Characters → "Convert V2/V3" button → Select JSON or PNG file
        </div>
      </div>

      <div className="help-section">
        <h3>🎨 Enhanced Character Editor</h3>
        <p>The character editor has been upgraded with powerful new reminder management features.</p>
        <ul>
          <li><strong>Keyword Input Component:</strong> Tag-based interface for adding trigger keywords</li>
          <li><strong>Priority Badges:</strong> Visual indicators showing reminder priority and keyword count</li>
          <li><strong>Improved Validation:</strong> Ensures keyword-triggered reminders have at least one keyword</li>
          <li><strong>Better Organization:</strong> Reminders sorted by priority for easier management</li>
        </ul>
      </div>

      <div className="help-section">
        <h3>⚙️ Backend Improvements</h3>
        <ul>
          <li><strong>Reminder Engine:</strong> New service for dynamic reminder activation and management</li>
          <li><strong>PNG Metadata Extraction:</strong> Automatic extraction of character data from PNG tEXt chunks</li>
          <li><strong>Format Auto-Detection:</strong> Automatically detects V2 vs V3 character card format</li>
          <li><strong>Token Optimization:</strong> Selective reminder activation saves context space for conversation</li>
        </ul>
      </div>

      <div className="help-section">
        <h3>🔧 Technical Details</h3>
        <div className="code-block">
          <strong>Enhanced Reminder Structure:</strong>
          <pre>{`{
  id: "reminder-123",
  name: "Reminder Name",
  text: "Reminder content...",
  target: "character" | "player",
  enabled: true,
  constant: true,              // Always active if true
  keys: ["keyword1", "key2"],  // Trigger keywords
  caseSensitive: false,        // Case-sensitive matching
  priority: 100,               // Insertion order (default: 100)
  scanDepth: 10               // Messages to scan (0 = all)
}`}</pre>
        </div>
      </div>

      <div className="help-section">
        <h3>📖 Migration & Compatibility</h3>
        <div className="help-note success">
          <strong>✅ Backward Compatible:</strong> All existing characters and reminders work unchanged!
          Old reminders automatically default to constant mode (always active).
        </div>
        <ul>
          <li>Existing reminders default to <code>constant: true</code></li>
          <li>No data migration required</li>
          <li>New features are opt-in</li>
          <li>V2/V3 imports preserve all original metadata</li>
        </ul>
      </div>

      <div className="help-section">
        <h3>🐛 Bug Fixes & Refinements</h3>
        <ul>
          <li>Improved reminder prompt injection consistency across all generation modes</li>
          <li>Better error handling for character card imports</li>
          <li>Fixed edge cases in PNG metadata extraction</li>
          <li>Enhanced validation for reminder forms</li>
        </ul>
      </div>

      <div className="help-section">
        <h3>🚀 Coming Soon</h3>
        <ul>
          <li>Global Reminders management tab in Settings</li>
          <li>Advanced lorebook features (insertion position, cooldowns)</li>
          <li>Regex pattern support for keywords</li>
          <li>Export to V2/V3 format</li>
        </ul>
      </div>
    </div>
  );
}

export default WhatsNewTab;
