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
          Both V2 and V3 formats are supported, with guided setup for SwellDreams-specific features.
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
          <div className="feature-item">
            <strong>Import Guidance Modal:</strong>
            <p>After import, an informative modal provides tips for adapting characters to SwellDreams' inflation theme</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Settings → Characters → "Convert V2/V3" button → Select JSON or PNG file → Follow the setup guidance
        </div>
        <div className="help-note warning">
          <strong>⚠️ Important:</strong> SwellDreams is built around inflation-themed content. The import guidance modal
          recommends adding inflation-specific reminders and using Flow Engine scripting to adapt imported characters
          for optimal compatibility.
        </div>
      </div>

      <div className="help-section">
        <h3>🪄 LLM-Powered Content Enhancement</h3>
        <p>
          New AI-powered enhancement feature helps you write better welcome messages and scenarios!
          Click the magic wand (🤖) button to automatically expand and improve your text.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Welcome Message Enhancement:</strong>
            <p>Transform short greetings into rich, immersive character introductions with proper formatting</p>
          </div>
          <div className="feature-item">
            <strong>Scenario Enhancement:</strong>
            <p>Expand basic scene descriptions into detailed scenarios with sensory details and context</p>
          </div>
          <div className="feature-item">
            <strong>Smart Formatting:</strong>
            <p>Automatically applies roleplay formatting with *actions* and "dialog"</p>
          </div>
          <div className="feature-item">
            <strong>Variable Integration:</strong>
            <p>Uses [Player] and [Gender] variables appropriately in enhanced text</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Character Editor → Basic Tab → Click the 🤖 robot icon next to Welcome Message or Scenario fields.
          The AI will enhance your text while preserving your intent.
        </div>
      </div>

      <div className="help-section">
        <h3>⚙️ Session Defaults Tab</h3>
        <p>
          New character editor tab allows you to configure starting values for each character.
          Perfect for scenarios that begin mid-session or with specific emotional states!
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Starting Capacity:</strong>
            <p>Set initial capacity level (0-100%) when starting a new session</p>
          </div>
          <div className="feature-item">
            <strong>Pain Level Preset:</strong>
            <p>Configure starting pain level (0-10 scale)</p>
          </div>
          <div className="feature-item">
            <strong>Initial Emotion:</strong>
            <p>Choose the persona's starting emotional state</p>
          </div>
          <div className="feature-item">
            <strong>Auto-Capacity Speed:</strong>
            <p>Set character-specific auto-capacity multiplier (0.25x to 2x)</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Character Editor → Session Defaults tab → Configure starting values for this character
        </div>
      </div>

      <div className="help-section">
        <h3>🔤 Chat Font Size Controls</h3>
        <p>
          Adjust chat text size on the fly with convenient +/- buttons in the upper right of the chat area.
        </p>
        <ul>
          <li><strong>Range:</strong> 10px to 32px</li>
          <li><strong>Persistent:</strong> Setting saves automatically and persists across sessions</li>
          <li><strong>Accessibility:</strong> Improve readability for your preferred viewing distance</li>
        </ul>
      </div>

      <div className="help-section">
        <h3>🎨 Enhanced Character Editor</h3>
        <p>The character editor has been upgraded with powerful new reminder management features and tabs.</p>
        <ul>
          <li><strong>Keyword Input Component:</strong> Tag-based interface for adding trigger keywords</li>
          <li><strong>Priority Badges:</strong> Visual indicators showing reminder priority and keyword count</li>
          <li><strong>Improved Validation:</strong> Ensures keyword-triggered reminders have at least one keyword</li>
          <li><strong>Better Organization:</strong> Reminders sorted by priority for easier management</li>
          <li><strong>Custom Scrollbars:</strong> Sleek dark-themed scrollbars match the UI aesthetic</li>
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
