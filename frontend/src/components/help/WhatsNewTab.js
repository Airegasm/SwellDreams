import React from 'react';
import './HelpTabs.css';

function WhatsNewTab() {
  return (
    <div className="help-tab">
      <div className="help-section">
        <h2>🎈 What's New in v3.9.6</h2>
        <p className="version-date">Released: April 2026</p>
      </div>

      <div className="help-section">
        <h3>🎨 Display Settings &amp; Skin System</h3>
        <p>
          Full visual customization via Settings {'>'} Display. Create, save, and switch between custom skins
          that control every visual element of the chat interface.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Customizable:</strong>
            <p>Player/Character/System bubble colors, outlines, text colors, fonts, sizes. Background image, modal background, header and tab strip colors.</p>
          </div>
          <div className="feature-item">
            <strong>Per-Character Skins:</strong>
            <p>Assign a skin to each character story. It auto-loads when starting a session with that story.</p>
          </div>
          <div className="feature-item">
            <strong>Checkpoint Trigger:</strong>
            <p>"Set Display Skin" trigger type lets skins change dynamically based on capacity ranges.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🧠 Persona Disposition &amp; Checkpoint Triggers</h3>
        <p>
          Personas now have a General Disposition (baseline emotion) and full checkpoint trigger support
          matching the character system. 39 disposition options available.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Persona Checkpoint Triggers:</strong>
            <p>Full trigger system under each checkpoint range in persona editor. Triggers save with profiles.</p>
          </div>
          <div className="feature-item">
            <strong>Character Precedence:</strong>
            <p>If both character and persona checkpoints fire triggers for the same range and type, the character trigger takes priority.</p>
          </div>
          <div className="feature-item">
            <strong>6 Built-in Profiles:</strong>
            <p>Eager Submissive, Reluctant Curious, Defiant Brat (player). Fascinated Observer, Protective Caretaker, Sadistic Controller (character).</p>
          </div>
          <div className="feature-item">
            <strong>New Trigger Types:</strong>
            <p>Set/Nudge Player Attribute, Set Player Disposition, Set Player Desires, Set Display Skin, and more.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🧹 Clear Chat Menu</h3>
        <p>
          Gear button next to the font size controls opens a clear menu with four options:
          Clear Screen, Clear Context, Clear Both, and Summarize {'&'} Clear.
          Summarize generates an AI narrative summary, clears everything, then shows the summary
          as a blue bubble with the session state preserved in LLM memory.
        </p>
      </div>

      <div className="help-section">
        <h3>🛡️ Pre-Inflation Gate</h3>
        <p>
          When a character has a 0% checkpoint with text, the LLM cannot activate pumps until a human
          action (manual control, button, or flow) raises capacity above 0% for the first time.
          A system notice appears after the welcome message, and the Devices panel shows "Checkpoint Gated."
        </p>
      </div>

      <div className="help-section">
        <h3>🔀 Token Switching</h3>
        <p>
          Prevent LLMs from falling into repetitive word patterns. Token switching scans every AI response
          and randomly replaces overused words with alternatives you define.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Trigger → Replacements:</strong>
            <p>Map a trigger word (e.g. "delve") to comma-separated alternatives (e.g. "explore, dig into, examine"). Each occurrence is replaced randomly.</p>
          </div>
          <div className="feature-item">
            <strong>Case Preservation:</strong>
            <p>Replacements match the original capitalization — Title Case, ALL CAPS, or lowercase.</p>
          </div>
          <div className="feature-item">
            <strong>Toggle Per Rule:</strong>
            <p>Enable/disable individual rules without deleting them.</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Settings → Global → Token Switching → Add New → Enter trigger word and comma-separated replacements.
        </div>
      </div>

      <div className="help-section">
        <h3>📋 Persona Checkpoint Profiles</h3>
        <p>
          The checkpoint profile system (load, save, update, delete) is now available in the Persona editor —
          matching the same workflow Characters already have. Save checkpoint sets as reusable profiles and
          load them across different personas.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Shared Profile Library:</strong>
            <p>Player and Character checkpoint profiles are shared between the Character and Persona editors.</p>
          </div>
          <div className="feature-item">
            <strong>Dirty Tracking:</strong>
            <p>The Update button shows "!" when checkpoint text has changed since the profile was loaded.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🎲 Random Welcome Message Version</h3>
        <p>
          New toggle button (R) in the Welcome Message version controls. When active, a random version is
          selected from the dropdown on each new session start instead of always using the same one.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Toggle:</strong>
            <p>Red "R" = off (uses selected version). Blue "R" = on (random version per session).</p>
          </div>
          <div className="feature-item">
            <strong>Per-Story:</strong>
            <p>The setting is stored per story, so different stories can have different behavior.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>📦 Batch V2/V3 Character Import</h3>
        <p>
          The "Convert V2/V3" button now accepts multiple files at once. Select as many PNG or JSON character
          cards as you want and they'll be imported sequentially. Failed files are skipped with individual
          error toasts — the rest continue importing.
        </p>
      </div>

      <div className="help-section">
        <h3>🐛 Recent Fixes (v3.9.3–v3.9.5)</h3>
        <ul>
          <li>Fixed circular JSON crash from inflation timer on sessionState</li>
          <li>Fixed AI pump buttons not loading on fresh installs and custom personas</li>
          <li>Fixed portrait fallback at burst/over-100% — now searches backward from highest range</li>
          <li>Fixed exaggeration at low capacity levels</li>
          <li>Added startup migration to backfill new fields on all characters and personas</li>
          <li>Hardcoded state preface with positive-framing guardrails</li>
          <li>Persona attributes tab with inflation knowledge/desire dropdowns</li>
        </ul>
      </div>

      <div className="help-section">
        <h2>🎈 What's New in v3.9.x</h2>
        <p className="version-date">Released: March 2026</p>
      </div>

      <div className="help-section">
        <h3>🎬 Video Portrait System</h3>
        <p>
          Staged portraits now support video alongside images. Upload idle loop videos (MP4/WebM) for
          each capacity range, plus transition videos that play when crossing range boundaries. Videos
          play in reverse during deflation. All media is stored on disk and can be exported/imported as
          zip bundles separate from the character card.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Idle Videos:</strong>
            <p>Looping video portraits per capacity range — mix freely with static images</p>
          </div>
          <div className="feature-item">
            <strong>Transition Videos:</strong>
            <p>One-shot clips that play when capacity crosses into a new range. Plays in reverse for deflation.</p>
          </div>
          <div className="feature-item">
            <strong>Batch Crop/Position:</strong>
            <p>Scale and offset controls that apply uniformly to all portrait media</p>
          </div>
          <div className="feature-item">
            <strong>Zip Export/Import:</strong>
            <p>Export all portrait media as a zip bundle. Import on another instance without touching the character card.</p>
          </div>
          <div className="feature-item">
            <strong>9:16 Aspect Ratio:</strong>
            <p>Portrait containers and image cropper updated to 9:16 for Wan video model compatibility</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🧠 Chat Memory & Summarization</h3>
        <p>
          Configurable chat history depths and automatic summarization of older messages so the AI
          retains long-term memory of the conversation.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>History Depth Controls:</strong>
            <p>Settings {'>'} Global {'>'} Chat Memory — configure how many messages are included in main chat, impersonate, and reminder scan contexts</p>
          </div>
          <div className="feature-item">
            <strong>Auto-Summarize:</strong>
            <p>When messages overflow the context window, older messages are summarized by the LLM and injected as a rolling summary</p>
          </div>
          <div className="feature-item">
            <strong>Editable Summary:</strong>
            <p>View and edit the rolling summary directly in Settings {'>'} Global {'>'} Chat Memory</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>⚡ Expanded Trigger System (25+ Actions)</h3>
        <p>
          Post-welcome triggers and checkpoint triggers now support a comprehensive set of actions
          for controlling devices, modifying session state, toggling settings, and managing reminders.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Post-Welcome Triggers:</strong>
            <p>Ordered list of actions that fire after the welcome message. Drag to reorder, add/remove freely.</p>
          </div>
          <div className="feature-item">
            <strong>Checkpoint Triggers:</strong>
            <p>Same trigger system under each capacity checkpoint. Fire once per session when capacity first enters a range.</p>
          </div>
          <div className="feature-item">
            <strong>Action Types:</strong>
            <p>Player Impersonate, AI Message, AI Pump ON/OFF, Primary Pump ON/OFF, Toggle Pump Always,
            Change Attribute, Set Capacity/Pain/Emotion, Toggle Device Control, Pump Mode/Timer,
            Toggle Auto-Reply, Toggle Pumpable, Set Burst Limits, Character Desires, Toggle/Equip Reminders</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>📋 Character & Persona Checkpoints</h3>
        <p>
          Checkpoints now split into sub-tabs for pumpable characters: Player Capacity and Character
          Capacity. Persona editor also has checkpoints for guiding impersonate responses. All checkpoints
          feature spoiler blur toggles.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Character Capacity Checkpoints:</strong>
            <p>How the AI character should react to their own inflation at each capacity range</p>
          </div>
          <div className="feature-item">
            <strong>Persona Checkpoints:</strong>
            <p>"My Inflation" — how the persona reacts to being inflated. "Character's Inflation" — how the persona reacts to the AI character being inflated.</p>
          </div>
          <div className="feature-item">
            <strong>Spoiler Blur:</strong>
            <p>Checkpoint text is blurred by default — click the eyeball icon to reveal</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🔧 Device Control Improvements</h3>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Send Pump On Every Reply:</strong>
            <p>Per-story toggle that programmatically activates the pump before every AI response (excluding flow chains). Configurable % chance.</p>
          </div>
          <div className="feature-item">
            <strong>Character Inflation Auto-Stop:</strong>
            <p>AI Pump ON now respects the character's max-on-duration device control limit</p>
          </div>
          <div className="feature-item">
            <strong>Toast Notifications:</strong>
            <p>Visual notifications when the AI character's pump turns on/off</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🐛 Fixes</h3>
        <ul>
          <li>Fixed KoboldCpp text completion missing template stop tokens (ChatML, Alpaca, Vicuna)</li>
          <li>Fixed generic chat completion paths not handling models without system role support</li>
          <li>Fixed persona staged portraits never extracting from base64 to disk</li>
          <li>Fixed new character editor opening with previous character's data</li>
          <li>Fixed checkpoint sub-tab buttons submitting the form (closing modal)</li>
          <li>Fixed draft system localStorage quota overflow from base64 image data</li>
          <li>SillyTavern {'{{user}}'}/{'{{char}}'} macros now work at runtime</li>
          <li>Impersonate now sends explicit perspective instruction with player name</li>
          <li>Impersonate input text saved to history for up-arrow retry</li>
          <li>Megan added as default character with staged portraits</li>
        </ul>
      </div>

      <div className="help-section">
        <h2>🎈 What's New in v3.8.2–3.8.5</h2>
        <p className="version-date">Released: March 2026</p>
      </div>

      <div className="help-section">
        <h3>🏠 Home Assistant Device Integration</h3>
        <p>
          Connect to Home Assistant to control Tapo outlets and any other HA-managed switch entities
          via the HA REST API. This replaces direct Tapo KLAP protocol control which is currently broken
          on Tapo's end.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>REST API Bridge:</strong>
            <p>Pure HTTP control — no Python bridge, no KLAP protocol headaches</p>
          </div>
          <div className="feature-item">
            <strong>Device Discovery:</strong>
            <p>Automatically discovers all switch entities from your HA instance</p>
          </div>
          <div className="feature-item">
            <strong>Full Logging:</strong>
            <p>Comprehensive console logging with request timing, error details, and entity state tracking</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 Setup:</strong> Settings → Devices → Home Assistant → Enter HA URL + Long-Lived Access Token → Discover Devices
        </div>
      </div>

      <div className="help-section">
        <h3>🎈 Character Inflation System ("Pumpable")</h3>
        <p>
          Characters can now be inflation targets with their own capacity gauge, pain emoji,
          staged portraits, and AI context awareness. No real devices are triggered — this is
          purely simulated visual inflation driven by flow nodes and timer-based progression.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Pumpable Toggle:</strong>
            <p>Enable per-character in the new "Pumpable" tab of the character editor</p>
          </div>
          <div className="feature-item">
            <strong>Capacity Gauge:</strong>
            <p>Mini gauge on the character's portrait (top-left) with clickable slider for manual adjustment</p>
          </div>
          <div className="feature-item">
            <strong>Pain Emoji:</strong>
            <p>Emoji below the gauge that maps character capacity (0-100%) across the 11-level pain scale</p>
          </div>
          <div className="feature-item">
            <strong>Staged Portraits:</strong>
            <p>Upload different portraits for capacity ranges — portrait changes automatically as inflation increases. Local only, not exported with character cards.</p>
          </div>
          <div className="feature-item">
            <strong>Burst Threshold:</strong>
            <p>Configurable pop percentage (50-200%). Inflation auto-stops and fires a burst event at the threshold.</p>
          </div>
          <div className="feature-item">
            <strong>AI Awareness:</strong>
            <p>When character capacity {'>'} 0%, every AI prompt includes: current capacity, belly description, pain level, pump on/off, knowledge level, desire level, pop proximity, and pop desire (at 60%+).</p>
          </div>
          <div className="feature-item">
            <strong>Knowledge & Desire:</strong>
            <p>Dropdowns for character's knowledge of inflation (unaware→expert) and desire to be inflated (terrified→obsessed), plus desire to be popped (terrified→eager)</p>
          </div>
          <div className="feature-item">
            <strong>Auto Load Controls:</strong>
            <p>One-click toggle to assign the "Basic Character Inflation Controls" flow with Inflate, Stop, Reset, and 50% buttons</p>
          </div>
          <div className="feature-item">
            <strong>Pumpable Badge:</strong>
            <p>Red "Pumpable" badge on character cards in the selector, and a red "PUMPABLE" info section below the portrait in chat showing Auto-Pop threshold</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 System Variables:</strong> <code>[CharCapacity]</code> or <code>{'{{charCapacity}}'}</code> — character's current inflation % (0-100). Also available as <code>characterCapacity</code> in flow conditions.
        </div>
      </div>

      <div className="help-section">
        <h3>🔧 Character Inflation Flow Nodes</h3>
        <p>New flow node types for controlling character inflation:</p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Actions:</strong>
            <p><em>Start Character Inflation</em> — begins timer-based inflation using the character's calibration time.
            <em>Stop Character Inflation</em> — stops the timer at current capacity.
            <em>Set Character Capacity</em> — directly set capacity to a specific value (0-100%).</p>
          </div>
          <div className="feature-item">
            <strong>Trigger:</strong>
            <p><em>Character State Change</em> — fires when character capacity crosses a threshold (=, {'>=', '>', '<', '<='} comparisons)</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>⚡ Capacity Modifier Scaling</h3>
        <p>
          The capacity modifier now affects LLM device control limits. Time-based limits (max ON duration,
          max timed, max cycle ON) scale proportionally with the modifier. A new live modifier slider
          appears next to the player's capacity slider for on-the-fly adjustment during sessions.
        </p>
      </div>

      <div className="help-section">
        <h3>🖼️ Media Variables Reference</h3>
        <p>
          The Media Album now includes a collapsible reference card showing all 6 media variable formats
          for embedding images, video, and audio into chat messages and flow actions.
        </p>
      </div>

      <div className="help-section">
        <h3>🐛 Fixes & Improvements</h3>
        <ul>
          <li>Fixed capacity slider persistence — manual adjustments now properly offset from auto-capacity</li>
          <li>Bypassed descriptive filter for explicit device phrases ("pump continues", "turns dial")</li>
          <li>Added SillyTavern {'{{user}}'}/{'{{char}}'} macro support in variable substitution</li>
          <li>Removed Matter/Thread service (unimplemented)</li>
        </ul>
      </div>

      <div className="help-section">
        <h2>🎉 What's New in Version 4.0</h2>
        <p className="version-date">Released: February 2026</p>
      </div>

      <div className="help-section">
        <h3>👥 Multi-Character Cards</h3>
        <p>
          Create cards with multiple AI characters who share a scene! Each character has independent
          personality, description, and behavior while the LLM writes for contextually relevant
          characters each turn.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Group Dynamics:</strong>
            <p>2+ AI characters in a single card, each with their own name, description, and personality</p>
          </div>
          <div className="feature-item">
            <strong>Contextual Responses:</strong>
            <p>Characters respond when contextually relevant — not all characters in every message</p>
          </div>
          <div className="feature-item">
            <strong>Full Story Support:</strong>
            <p>Welcome messages, scenarios, and example dialogues per story — just like single-char cards</p>
          </div>
          <div className="feature-item">
            <strong>Dedicated Editor:</strong>
            <p>MultiCharEditorModal for creating and editing multi-character cards with per-character fields</p>
          </div>
          <div className="feature-item">
            <strong>Builtin Example:</strong>
            <p>Research Team Alpha — 3-person medical team demonstrating multi-char dynamics and pump tag usage</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Settings → Characters → "+ New Multi-Char" → fill in group name and individual character details
        </div>
      </div>

      <div className="help-section">
        <h3>📤 Character Export</h3>
        <p>
          Export your characters in multiple formats for sharing and backup! Full-fidelity native export,
          cross-platform V3 compatibility, and JSON backup options.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>SwellDreams PNG:</strong>
            <p>Full-fidelity native format with optional embedded flows and SwellDreams logo overlay</p>
          </div>
          <div className="feature-item">
            <strong>V3 PNG:</strong>
            <p>SillyTavern-compatible export with both V2 (chara) and V3 (ccv3) chunks for maximum compatibility</p>
          </div>
          <div className="feature-item">
            <strong>JSON Backup:</strong>
            <p>Raw SwellDreams character data with embedded avatar — ideal for backups</p>
          </div>
          <div className="feature-item">
            <strong>Story Selection:</strong>
            <p>Export all stories or selected stories only</p>
          </div>
          <div className="feature-item">
            <strong>Full Backup:</strong>
            <p>Export all characters, personas, flows, and settings (minus API keys) from Settings</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Settings → Characters → click character → Export → choose format
        </div>
      </div>

      <div className="help-section">
        <h3>🦙 Llama.cpp Support</h3>
        <p>
          Native llama.cpp server endpoint support for running local LLMs with minimal overhead.
          Lighter than KoboldCpp, ideal for headless and server deployments.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Auto-Detection:</strong>
            <p>Model name and context size automatically detected from the llama.cpp server</p>
          </div>
          <div className="feature-item">
            <strong>Prompt Templates:</strong>
            <p>Select from ChatML, Llama 3, Mistral, Alpaca, Vicuna, or None</p>
          </div>
          <div className="feature-item">
            <strong>GBNF Grammar:</strong>
            <p>Supports GBNF grammar for structured output generation</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 How to Use:</strong> Settings → Model → Endpoint = "Llama.cpp" → enter server URL → Connect
        </div>
      </div>

      <div className="help-section">
        <h3>🏷️ Advanced Device Tags</h3>
        <p>
          New device command modes give the LLM fine-grained control over pumps, vibrators, and TENS units
          beyond simple on/off.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Pulse Mode:</strong>
            <p><code>[pump:pulse:N]</code> — N quick on/off bursts (0.5s each)</p>
          </div>
          <div className="feature-item">
            <strong>Timed Mode:</strong>
            <p><code>[pump:timed:SECONDS]</code> — run for exact duration then auto-off</p>
          </div>
          <div className="feature-item">
            <strong>Cycle Mode:</strong>
            <p><code>[pump:cycle:ON:OFF:CYCLES]</code> — repeated on/off pattern (0 = infinite)</p>
          </div>
        </div>
        <div className="help-note info">
          <strong>💡 Works for all devices:</strong> pump, vibe, and tens — e.g. <code>[vibe:pulse:5]</code>, <code>[tens:timed:30]</code>
        </div>
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
          <li>Advanced lorebook features (insertion position, cooldowns)</li>
          <li>Regex pattern support for keywords</li>
        </ul>
      </div>
    </div>
  );
}

export default WhatsNewTab;
