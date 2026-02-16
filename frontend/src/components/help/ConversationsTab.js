import React, { useState } from 'react';
import './HelpTabs.css';

function ConversationsTab() {
  const [expanded, setExpanded] = useState({
    overview: false,
    chatInterface: false,
    mobileInterface: false,
    builtinCharacters: false,
    multiCharCards: false,
    characters: false,
    characterFields: false,
    importExport: false,
    sessionDefaults: false,
    characterAttributes: false,
    capacityCheckpoints: false,
    storyProgression: false,
    builtinPersonas: false,
    personas: false,
    personaFields: false,
    stagedPortraits: false,
    buttons: false,
    constantReminders: false,
    globalReminders: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>Characters, Personas, and Interactions Explained</h2>

      {/* Overview */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('overview')}>
          Overview
          <span className="expand-icon">{expanded.overview ? '−' : '+'}</span>
        </h3>
        {expanded.overview && (
          <div className="section-content">
            <p>
              SwellDreams uses a <strong>Character</strong> and <strong>Persona</strong> system
              to create dynamic roleplay conversations. Understanding how these work together
              is key to getting the best experience.
            </p>

            <h4 className="subsection-header">Characters vs Personas</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Characters</th>
                  <th>Personas</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>The AI-controlled participant in the conversation</td>
                  <td>Your player character - who you're roleplaying as</td>
                </tr>
                <tr>
                  <td>Has personality, description, and behavior</td>
                  <td>Has appearance, personality, and pronouns</td>
                </tr>
                <tr>
                  <td>Sends the first message (welcome message)</td>
                  <td>Responds to the character</td>
                </tr>
                <tr>
                  <td>Can have buttons for quick actions</td>
                  <td>Simpler configuration</td>
                </tr>
                <tr>
                  <td>Can have constant reminders</td>
                  <td>Background info for AI context</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Quick Start:</strong> Create at least one Character and one Persona,
              then select both on the main Chat page to begin a conversation.
            </div>
          </div>
        )}
      </div>

      {/* Chat Interface */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('chatInterface')}>
          Chat Interface
          <span className="expand-icon">{expanded.chatInterface ? '−' : '+'}</span>
        </h3>
        {expanded.chatInterface && (
          <div className="section-content">
            <p>
              The Chat page features a three-column layout with your <strong>Persona</strong> on the left,
              the <strong>conversation</strong> in the center, and the <strong>Character</strong> on the right.
            </p>

            <h4 className="subsection-header">Status Badges (Persona Column)</h4>
            <p>
              Below your persona's portrait are three interactive status badges that track your
              character's current state:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Badge</th>
                  <th>Purpose</th>
                  <th>Usage</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Emotion</strong></td>
                  <td>Your persona's current emotional state</td>
                  <td>Click to open emoji selector. Choose from 20 emotions including neutral, excited, aroused, submissive, confused, drunk, and more. Sets the <code>[Emotion]</code> variable.</td>
                </tr>
                <tr>
                  <td><strong>Pain Level</strong></td>
                  <td>Physical sensation intensity (0-10 scale)</td>
                  <td>Click to open the pain chart selector. Based on the Wong-Baker FACES scale. Sets the <code>[Feeling]</code> variable as a number 0-10.</td>
                </tr>
                <tr>
                  <td><strong>Capacity Gauge</strong></td>
                  <td>Visual pressure/capacity indicator (0-100%)</td>
                  <td>Displays current capacity with an animated needle. Use keyboard shortcuts to adjust. Sets the <code>[Capacity]</code> variable.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Keyboard Shortcuts</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Keys</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>↑ Up Arrow</strong></td>
                  <td>Increase capacity by 1%</td>
                </tr>
                <tr>
                  <td><strong>↓ Down Arrow</strong></td>
                  <td>Decrease capacity by 1%</td>
                </tr>
                <tr>
                  <td><strong>Shift + ↑</strong></td>
                  <td>Increase capacity by 5%</td>
                </tr>
                <tr>
                  <td><strong>Shift + ↓</strong></td>
                  <td>Decrease capacity by 5%</td>
                </tr>
              </tbody>
            </table>
            <div className="tip-box">
              <strong>Note:</strong> Keyboard shortcuts only work when you're not typing in a text field.
            </div>

            <h4 className="subsection-header">Action Buttons (Send & Generate)</h4>
            <p>
              To the right of the text input area is a 2x2 button cluster for sending messages and generating AI content:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Button</th>
                  <th>Icon</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Guided Impersonate</strong></td>
                  <td>🤖 (green background)</td>
                  <td>AI generates text as YOUR persona. The result appears in your text input for editing before sending. Optionally type guidance text first to steer the generation.</td>
                </tr>
                <tr>
                  <td><strong>Guided Response</strong></td>
                  <td>🤖 (red background)</td>
                  <td>AI generates a character response immediately. Optionally type guidance text first (e.g., "have them check on the player") to influence the generation.</td>
                </tr>
                <tr>
                  <td><strong>Send as Persona</strong></td>
                  <td>↖ (green background)</td>
                  <td>Sends your typed text as a player message. This is the standard way to chat - your message goes to the character who then responds.</td>
                </tr>
                <tr>
                  <td><strong>Send as Character</strong></td>
                  <td>↖ (red background)</td>
                  <td>Sends your typed text as the character's message (not the player). Useful for manually writing character dialogue or continuing a scene.</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Color Coding:</strong> Green buttons are for player/persona actions. Red buttons are for character/AI actions.
            </div>

            <div className="tip-box">
              <strong>Pro Tip:</strong> Use "Guided Impersonate" during intense scenes to auto-generate realistic player reactions. Type a hint like "reluctant but aroused" before clicking to guide the generation, then edit the result before sending.
            </div>

            <h4 className="subsection-header">Character Column</h4>
            <p>
              The right column shows the active character's portrait along with:
            </p>
            <ul className="help-list">
              <li><strong>Actions</strong> - Expandable panel with character-specific action buttons</li>
              <li><strong>Devices</strong> - Quick access to connected device controls and status indicators</li>
            </ul>

            <h4 className="subsection-header">Font Size Controls</h4>
            <p>
              In the upper right corner of the chat area, you'll find +/− buttons to adjust text size on the fly.
            </p>
            <ul className="help-list">
              <li><strong>Range:</strong> 10px to 32px</li>
              <li><strong>Persistent:</strong> Your font size preference saves automatically</li>
              <li><strong>Accessibility:</strong> Make text larger for easier reading or smaller to see more messages at once</li>
            </ul>
            <div className="tip-box">
              <strong>Tip:</strong> Adjust font size based on your viewing distance. Larger sizes work great
              when viewing from across the room during a session!
            </div>
          </div>
        )}
      </div>

      {/* Mobile Interface */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('mobileInterface')}>
          Mobile Interface
          <span className="expand-icon">{expanded.mobileInterface ? '−' : '+'}</span>
        </h3>
        {expanded.mobileInterface && (
          <div className="section-content">
            <p>
              On mobile devices, SwellDreams uses a streamlined single-column layout optimized for
              touch interaction.
            </p>

            <h4 className="subsection-header">Navigation</h4>
            <ul className="help-list">
              <li><strong>Hamburger Menu (☰)</strong> - Access all pages, settings, and the app logo</li>
              <li><strong>Persona Drawer (🎈)</strong> - Slide-out panel showing your persona portrait and status badges</li>
              <li><strong>Character Drawer (😈)</strong> - Slide-out panel showing the character portrait, actions, and devices</li>
            </ul>

            <h4 className="subsection-header">Floating Status Badges</h4>
            <p>
              On mobile, the status badges (capacity gauge, emotion, and pain level) float above the
              chat input area for constant visibility. Tap them to adjust values just like on desktop.
            </p>

            <h4 className="subsection-header">Emergency Stop</h4>
            <p>
              The E-STOP button is prominently centered in the chat input area on mobile, ensuring
              quick access during sessions.
            </p>

            <div className="tip-box">
              <strong>Tip:</strong> Swipe from the left edge to open the persona drawer, or from the
              right edge to open the character drawer. You can also tap the 🎈 and 😈 buttons in the header.
            </div>
          </div>
        )}
      </div>

      {/* Builtin Characters */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('builtinCharacters')}>
          Builtin Characters
          <span className="expand-icon">{expanded.builtinCharacters ? '−' : '+'}</span>
        </h3>
        {expanded.builtinCharacters && (
          <div className="section-content">
            <p>
              SwellDreams includes four pre-made characters, each with distinct personalities
              and assigned flows that showcase different aspects of the system. Use them as-is
              or as inspiration for your own creations.
            </p>

            <h4 className="subsection-header">Luna - The Sensual Girlfriend</h4>
            <p>
              <strong>Personality:</strong> Loving, intimate, teasing, affectionate. Uses pet names
              and focuses on pleasure and connection.
            </p>
            <ul className="help-list">
              <li><strong>Best For:</strong> Romantic, caring scenarios with gentle pacing</li>
              <li><strong>Flows:</strong> Intimate Choices, Comfort Check, Reward System</li>
              <li><strong>Key Features:</strong> Player choice nodes, capacity-based check-ins, random rewards</li>
            </ul>

            <h4 className="subsection-header">Mistress Scarlett - The Demanding Dominatrix</h4>
            <p>
              <strong>Personality:</strong> Strict, commanding, elegant cruelty. Expects absolute
              obedience and punishes failure while rewarding submission.
            </p>
            <ul className="help-list">
              <li><strong>Best For:</strong> D/s dynamics, discipline scenarios, rule enforcement</li>
              <li><strong>Flows:</strong> Obedience Protocol, Punishment Sequence, Rule Enforcement</li>
              <li><strong>Key Features:</strong> A/B choice consequences, timer challenges, keyword triggers</li>
            </ul>

            <h4 className="subsection-header">Vex - The Sadistic Gameshow Host</h4>
            <p>
              <strong>Personality:</strong> Chaotic, theatrical, gleefully cruel. Treats everything
              as entertainment with heavy focus on games and challenges.
            </p>
            <ul className="help-list">
              <li><strong>Best For:</strong> Gamified sessions, challenge-based progression, high stakes</li>
              <li><strong>Flows:</strong> Wheel of Fate, Dice of Destiny, Challenge Gauntlet, Bonus Round</li>
              <li><strong>Key Features:</strong> Uses all challenge nodes (wheel, dice, coin flip, RPS, slots, etc.)</li>
            </ul>

            <h4 className="subsection-header">Dr. Iris Chen - The Clinical Researcher</h4>
            <p>
              <strong>Personality:</strong> Methodical, detached, scientific curiosity. Treats the
              subject as data with precise, analytical observation.
            </p>
            <ul className="help-list">
              <li><strong>Best For:</strong> Medical/research roleplay, systematic progression, data collection</li>
              <li><strong>Flows:</strong> Data Collection Protocol, Capacity Study, Threshold Testing</li>
              <li><strong>Key Features:</strong> Input nodes for ratings, capacity messages, condition-based phases</li>
            </ul>

            <h4 className="subsection-header">Research Team Alpha - Medical Research Team (Multi-Char)</h4>
            <p>
              <strong>Type:</strong> Multi-Character Card — 3-person medical research team
            </p>
            <ul className="help-list">
              <li><strong>Dr. Evelyn Marsh</strong> — Lead researcher, directs the experiment and makes clinical decisions</li>
              <li><strong>Nurse Priya Vasquez</strong> — Pump operator, handles device control and equipment</li>
              <li><strong>Nurse Dani Reeves</strong> — Vitals monitor, tracks patient status and reactions</li>
            </ul>
            <ul className="help-list">
              <li><strong>Best For:</strong> Multi-character dynamics, medical/research scenarios, device control demonstrations</li>
              <li><strong>Key Features:</strong> Multi-char card, pump tag examples in dialogues, role-enforced team dynamics</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> Each builtin character comes with pre-assigned flows that demonstrate
              different node types. Open them in the Flow Editor to learn how flows work, then modify
              or create your own.
            </div>
          </div>
        )}
      </div>

      {/* Multi-Character Cards */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('multiCharCards')}>
          Multi-Character Cards
          <span className="expand-icon">{expanded.multiCharCards ? '−' : '+'}</span>
        </h3>
        {expanded.multiCharCards && (
          <div className="section-content">
            <p>
              Multi-character cards contain <strong>multiple AI characters who share a single scene</strong>.
              Unlike single-character cards where you chat with one AI persona, multi-char cards create
              group dynamics — a team, a family, a panel of judges, or any group scenario.
            </p>

            <h4 className="subsection-header">How Multi-Char Differs from Single-Char</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Single-Char Card</th>
                  <th>Multi-Char Card</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>One AI character</td>
                  <td>2+ AI characters (no upper limit)</td>
                </tr>
                <tr>
                  <td>One name, one personality</td>
                  <td>Group name + individual names, descriptions, and personalities</td>
                </tr>
                <tr>
                  <td>AI always responds as that character</td>
                  <td>LLM writes for contextually relevant characters each turn</td>
                </tr>
                <tr>
                  <td>Example dialogues use Player/Character format</td>
                  <td>Example dialogues use a <code>response</code> field with <code>CharName: "dialogue"</code> format</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">How Responses Work</h4>
            <p>
              The LLM doesn't write for all characters in every message. Instead, it determines which
              characters are contextually relevant to the current situation and writes for those.
              Role enforcement via constant reminders keeps each character's voice distinct.
            </p>

            <h4 className="subsection-header">Example Dialogue Format</h4>
            <p>
              Multi-char example dialogues use a different format than single-char. Each character's
              lines are prefixed with their name:
            </p>
            <div className="code-example">
              <strong>Example (response field):</strong><br/>
              Dr. Marsh: *adjusts her clipboard* "Increase the rate by 10%, Priya."<br/>
              Nurse Priya: *turns the dial carefully* "Rate increased, Doctor. [pump:timed:30]"<br/>
              Nurse Dani: *checks the monitor* "Vitals are stable, [Player] is doing well."
            </div>

            <h4 className="subsection-header">Creating a Multi-Char Card</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Characters</strong></li>
              <li>Click <strong>"+ New Multi-Char"</strong></li>
              <li>The <strong>MultiCharEditorModal</strong> opens</li>
              <li>Enter a group name (e.g., "Research Team Alpha")</li>
              <li>Add at least 2 characters with individual names, descriptions, and personalities</li>
              <li>Add stories with welcome messages, scenarios, and example dialogues</li>
              <li>Save the card</li>
            </ol>

            <h4 className="subsection-header">Editing Multi-Char Cards</h4>
            <p>
              Click any multi-char card in the character list — the MultiCharEditorModal opens
              automatically. Multi-char cards display a <strong>"Multi-Char" badge</strong> in the
              character list so they're easy to identify.
            </p>

            <div className="info-box">
              <strong>Minimum Requirement:</strong> Multi-char cards require at least 2 characters.
              There is no upper limit, but keep in mind that more characters use more context tokens.
            </div>

            <div className="tip-box">
              <strong>Tip:</strong> Try the builtin <strong>Research Team Alpha</strong> card to see
              multi-char in action. It demonstrates team dynamics, pump tag usage in dialogues, and
              role-enforced character voices.
            </div>
          </div>
        )}
      </div>

      {/* Characters Overview */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('characters')}>
          Creating Characters
          <span className="expand-icon">{expanded.characters ? '−' : '+'}</span>
        </h3>
        {expanded.characters && (
          <div className="section-content">
            <p>
              Characters are the AI-controlled participants in your roleplay. They have
              personalities, backgrounds, and behaviors that the AI uses to generate responses.
            </p>

            <h4 className="subsection-header">Character Editor Tabs</h4>
            <ul className="help-list">
              <li><strong>Basic</strong> - Core character information (name, description, personality, messages)</li>
              <li><strong>Custom Reminders</strong> - Lorebook-style instructions (constant or keyword-triggered)</li>
              <li><strong>Custom Buttons</strong> - Quick-action buttons for the chat interface</li>
              <li><strong>Session Defaults</strong> - Starting values for capacity, pain, emotion, and auto-capacity speed</li>
            </ul>

            <h4 className="subsection-header">Tips for Good Characters</h4>
            <ul className="checklist">
              <li><strong>Be specific:</strong> Instead of "friendly," describe how they show friendliness</li>
              <li><strong>Include quirks:</strong> Small habits or speech patterns make characters memorable</li>
              <li><strong>Set boundaries:</strong> Describe what the character would and wouldn't do</li>
              <li><strong>Use scenarios:</strong> Create multiple scenarios for variety</li>
            </ul>
          </div>
        )}
      </div>

      {/* Character Fields */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('characterFields')}>
          Character Fields Explained
          <span className="expand-icon">{expanded.characterFields ? '−' : '+'}</span>
        </h3>
        {expanded.characterFields && (
          <div className="section-content">
            <h4 className="subsection-header">Basic Tab Fields</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Purpose</th>
                  <th>Tips</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Name</strong></td>
                  <td>The character's display name, used in chat and prompts</td>
                  <td>Required. Keep it simple and memorable.</td>
                </tr>
                <tr>
                  <td><strong>Description</strong></td>
                  <td>Brief overview of who the character is</td>
                  <td>1-3 sentences. Background, role, relationship to player.</td>
                </tr>
                <tr>
                  <td><strong>Personality</strong></td>
                  <td>Detailed personality traits and behaviors</td>
                  <td>Include speech patterns, quirks, likes/dislikes, goals.</td>
                </tr>
                <tr>
                  <td><strong>Starting Persona Emotion</strong></td>
                  <td>The player's initial emotional state when conversation begins</td>
                  <td>Sets the [Emotion] variable. Options: neutral, curious, nervous, excited, etc.</td>
                </tr>
                <tr>
                  <td><strong>Avatar</strong></td>
                  <td>Visual representation of the character</td>
                  <td>Upload an image. Will be cropped to 3:4 portrait ratio.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Welcome Message</h4>
            <p>
              The first message the character sends when starting a new conversation.
              You can create multiple versions and switch between them.
            </p>
            <ul className="help-list">
              <li><strong>+ button</strong> - Add a new welcome message version</li>
              <li><strong>Trash icon</strong> - Delete the current version</li>
              <li><strong>🤖 Robot icon (Magic Wand)</strong> - Use LLM to enhance and expand your text</li>
              <li><strong>Dropdown</strong> - Switch between versions</li>
            </ul>

            <div className="help-note info">
              <strong>🪄 LLM Enhancement Feature:</strong><br/>
              Click the 🤖 magic wand button to have AI automatically enhance your welcome message!
              <ul style={{marginTop: '8px', marginBottom: 0}}>
                <li>Transforms short text into rich, immersive greetings</li>
                <li>Adds proper roleplay formatting with *actions* and "dialog"</li>
                <li>Includes sensory details and character voice</li>
                <li>Automatically uses [Player] and [Gender] variables where appropriate</li>
                <li>You can enhance blank messages or improve existing ones</li>
              </ul>
            </div>

            <div className="tip-box">
              <strong>Tip:</strong> Create multiple welcome messages for variety. The active one
              (shown in dropdown) will be used when starting a new conversation. Use the magic wand
              to quickly generate professional-quality greetings!
            </div>

            <h4 className="subsection-header">Scenario</h4>
            <p>
              Describes the current situation or context for the roleplay.
              Like welcome messages, you can have multiple scenario versions.
            </p>
            <ul className="help-list">
              <li>Sets the scene and establishes the starting point</li>
              <li>Included in every AI prompt as context</li>
              <li>Should describe where, when, and what's happening</li>
              <li><strong>🤖 Magic Wand:</strong> Click the robot icon to use LLM enhancement for richer scenario descriptions</li>
            </ul>

            <div className="tip-box">
              <strong>Pro Tip:</strong> Use the LLM enhancement feature to transform simple scenario descriptions
              like "In a medical lab" into detailed, immersive scene-setters with atmosphere, sensory details,
              and proper context.
            </div>

            <h4 className="subsection-header">Example Dialogues</h4>
            <p>
              Sample exchanges that show how the character speaks and responds.
              These help the AI understand the character's voice and behavior.
            </p>

            <div className="warning-box">
              <strong>Why Example Dialogues Matter:</strong> AI models can get confused about
              who "you", "I", "she", etc. refer to. Good example dialogues establish clear
              subject-object relationships so the AI knows who's who.
            </div>

            <h4 className="subsection-header">Rules for Good Example Dialogues</h4>
            <ul className="checklist">
              <li><strong>Player mentions [Char]:</strong> The player's message should reference the character by name at least once</li>
              <li><strong>Character mentions [Player]:</strong> The character's response should reference the player at least once</li>
              <li><strong>Mix dialogue and actions:</strong> Use "quoted speech" for spoken words and *asterisks* for actions/narration</li>
              <li><strong>Show personality:</strong> The character's response should demonstrate their unique voice and mannerisms</li>
            </ul>

            <div className="code-example">
              <strong>Good Example:</strong><br/>
              Player: *Shifts nervously on the chair* "Dr. Vance, I'm a little nervous about this."<br/>
              Character: *She nods professionally, making a note* "That's perfectly normal, [Player]. Deep breaths. You're in capable hands."
            </div>

            <div className="code-example" style={{borderColor: '#ff6b6b', backgroundColor: 'rgba(255, 107, 107, 0.1)'}}>
              <strong>Bad Example (avoid):</strong><br/>
              Player: "I'm nervous"<br/>
              Character: "That's normal. Take deep breaths."<br/>
              <em style={{color: '#ff6b6b'}}>Problem: No names used - AI may confuse who "you" and "I" refer to</em>
            </div>

            <div className="tip-box">
              <strong>Pro Tip:</strong> The <code>[Player]</code> token gets replaced with your persona's
              actual name during conversations. Characters should use it naturally in their responses.
            </div>

            <h4 className="subsection-header">Using [Gender] Variable for Pronouns</h4>
            <p>
              The <code>[Gender]</code> variable is a powerful tool for creating gender-neutral character content.
              It automatically resolves to the correct pronoun (he/she/they) based on the active persona's gender
              setting and grammatical context.
            </p>

            <div className="code-example">
              <strong>Example in Character Description:</strong><br/>
              "I notice [Gender] is nervous about this experiment."<br/>
              <br/>
              <strong>Resolves to:</strong><br/>
              • "I notice <em>he</em> is nervous..." (he/him persona)<br/>
              • "I notice <em>she</em> is nervous..." (she/her persona)<br/>
              • "I notice <em>they</em> are nervous..." (they/them persona)
            </div>

            <div className="info-box">
              <strong>💡 Best Practice:</strong> Use <code>[Gender]</code> in example dialogues, scenarios, and
              personality descriptions so your character works seamlessly with all persona genders. This is
              especially helpful when using the LLM enhancement feature, which automatically includes [Gender]
              where appropriate.
            </div>
          </div>
        )}
      </div>

      {/* Importing & Exporting Characters */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('importExport')}>
          Importing &amp; Exporting Characters
          <span className="expand-icon">{expanded.importExport ? '−' : '+'}</span>
        </h3>
        {expanded.importExport && (
          <div className="section-content">

            <h4 className="subsection-header">Importing Characters</h4>
            <p>
              SwellDreams can import character cards from other AI chat platforms as well as its own exports.
            </p>

            <table className="help-table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Extension</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>V2 Card</strong></td>
                  <td>.png</td>
                  <td>SillyTavern, TavernAI, Chub.ai</td>
                </tr>
                <tr>
                  <td><strong>V3 Card</strong></td>
                  <td>.png</td>
                  <td>SillyTavern (newer)</td>
                </tr>
                <tr>
                  <td><strong>SwellDreams Card</strong></td>
                  <td>.png</td>
                  <td>SwellDreams export</td>
                </tr>
                <tr>
                  <td><strong>SwellDreams JSON</strong></td>
                  <td>.json</td>
                  <td>SwellDreams export</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">How to Import</h4>
            <ul className="help-list">
              <li><strong>SwellDreams formats:</strong> Settings → Characters → <strong>"Import"</strong> button → select PNG or JSON file</li>
              <li><strong>V2/V3 cards:</strong> Settings → Characters → <strong>"Convert V2/V3"</strong> button → select PNG or JSON file</li>
            </ul>

            <h4 className="subsection-header">What Gets Converted (V2/V3)</h4>
            <p>When importing V2 or V3 cards, the following fields are mapped:</p>
            <ul className="help-list">
              <li><strong>name</strong> → character name</li>
              <li><strong>description</strong> → character description</li>
              <li><strong>personality</strong> → character personality</li>
              <li><strong>first_mes</strong> → welcome message</li>
              <li><strong>alternate_greetings</strong> → additional welcome messages</li>
              <li><strong>scenario</strong> → scenario</li>
              <li><strong>mes_example</strong> → example dialogues</li>
              <li><strong>character_book</strong> → keyword-triggered reminders</li>
            </ul>
            <p>
              PNG avatars are automatically used as the character's avatar. After V2/V3 import, an
              <strong> Import Guidance Modal</strong> appears with tips for adapting the character to SwellDreams.
            </p>

            <h4 className="subsection-header">Exporting Characters</h4>
            <p>
              Export your characters in three formats, each suited for different purposes:
            </p>

            <table className="help-table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Description</th>
                  <th>Best For</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>SwellDreams PNG</strong></td>
                  <td>Full-fidelity native format. Embeds complete character data + optional flows in PNG metadata. Adds SwellDreams logo overlay.</td>
                  <td>Sharing between SwellDreams users</td>
                </tr>
                <tr>
                  <td><strong>V3 PNG</strong></td>
                  <td>SillyTavern-compatible export. Embeds both V2 (chara) and V3 (ccv3) chunks for maximum cross-platform compatibility. Lorebook entries generated from reminders.</td>
                  <td>Sharing to other platforms</td>
                </tr>
                <tr>
                  <td><strong>JSON</strong></td>
                  <td>Raw SwellDreams character data with embedded avatar.</td>
                  <td>Backups</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">How to Export</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Characters</strong></li>
              <li>Click on the character you want to export</li>
              <li>Click the <strong>Export</strong> button</li>
              <li>Choose your export format</li>
              <li>Optionally select which stories to include</li>
              <li>For SwellDreams PNG, optionally embed assigned flows</li>
            </ol>

            <h4 className="subsection-header">Full Backup</h4>
            <p>
              For a complete backup of everything, use <strong>Settings → export full backup</strong>.
              This exports all characters, personas, flows, and settings in a single file. API keys
              are excluded for security.
            </p>

            <div className="tip-box">
              <strong>Tip:</strong> Use SwellDreams PNG for the richest exports — it preserves everything
              including flows, all stories, and multi-char data. Use V3 PNG when sharing to users on
              other platforms like SillyTavern.
            </div>
          </div>
        )}
      </div>

      {/* Session Defaults */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('sessionDefaults')}>
          Session Defaults
          <span className="expand-icon">{expanded.sessionDefaults ? '−' : '+'}</span>
        </h3>
        {expanded.sessionDefaults && (
          <div className="section-content">
            <p>
              The Session Defaults tab in the Character Editor lets you configure the starting state
              for new conversations with each character. Perfect for scenarios that begin mid-session
              or with specific conditions already in effect!
            </p>

            <h4 className="subsection-header">Configurable Settings</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Range</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Starting Capacity</strong></td>
                  <td>0-100% (5% increments)</td>
                  <td>Initial capacity gauge value when starting a new session</td>
                </tr>
                <tr>
                  <td><strong>Pain Level</strong></td>
                  <td>0-10</td>
                  <td>Initial Wong-Baker pain scale rating</td>
                </tr>
                <tr>
                  <td><strong>Emotion</strong></td>
                  <td>Dropdown selection</td>
                  <td>Starting emotional state for the persona</td>
                </tr>
                <tr>
                  <td><strong>Auto-Capacity Speed</strong></td>
                  <td>0.25x to 2.0x (0.25x increments)</td>
                  <td>Character-specific multiplier for auto-capacity progression</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Use Cases</h4>
            <ul className="help-list">
              <li><strong>In Media Res Scenarios:</strong> Start characters mid-session (e.g., already at 50% capacity)</li>
              <li><strong>Specific Emotional States:</strong> Begin with the persona nervous, excited, or uncomfortable</li>
              <li><strong>Custom Progression Rates:</strong> Give some characters faster/slower auto-capacity for variety</li>
              <li><strong>Testing:</strong> Quickly jump to high capacity levels to test dialogue and flows</li>
            </ul>

            <div className="info-box">
              <strong>💡 Example:</strong> Dr. Iris Chen could default to 0% capacity with clinical setup, while
              Mistress Scarlett might default to 25% capacity with a "submissive" emotion, creating an immediate
              power dynamic from the first message.
            </div>

            <div className="tip-box">
              <strong>Note:</strong> Session defaults only apply when starting a NEW conversation. They don't
              affect existing saved sessions or mid-conversation reloads.
            </div>
          </div>
        )}
      </div>

      {/* Character Attributes */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('characterAttributes')}>
          Character Attributes (Personality Drives)
          <span className="expand-icon">{expanded.characterAttributes ? '−' : '+'}</span>
        </h3>
        {expanded.characterAttributes && (
          <div className="section-content">
            <p>
              Character Attributes are personality traits with <strong>probability-based activation</strong>.
              Each attribute has a percentage chance (0-100%) of firing on every AI message. When an attribute
              activates, it injects personality-driving instructions into the AI's response, making each
              message feel dynamic and varied.
            </p>

            <h4 className="subsection-header">The Five Attributes</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th>When Active</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Dominant</strong></td>
                  <td>Take control of the situation. Be assertive, commanding, and decisive.</td>
                </tr>
                <tr>
                  <td><strong>Sadistic</strong></td>
                  <td>Be cruel, teasing, and take pleasure in discomfort. Push boundaries.</td>
                </tr>
                <tr>
                  <td><strong>Psychopathic</strong></td>
                  <td>Be unhinged, unpredictable, and unsettling. Disregard normal boundaries.</td>
                </tr>
                <tr>
                  <td><strong>Sensual</strong></td>
                  <td>Be caring, tender, and amorous. Focus on intimacy and emotional connection.</td>
                </tr>
                <tr>
                  <td><strong>Sexual</strong></td>
                  <td>Be overtly aroused and flirtatious. Express desire and attraction openly.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">How Rolls Work</h4>
            <p>
              Before each AI response, the system rolls for every attribute with a chance above 0%.
              A random number (0-100) is generated — if it's below the attribute's percentage, the
              attribute activates for that message. Multiple attributes can activate simultaneously.
            </p>
            <div className="code-example">
              <strong>Example:</strong> Dominant at 90%, Sadistic at 60%, Psychopathic at 15%<br/>
              → Roll: Dominant 23 {'<'} 90 (active), Sadistic 72 {'>'} 60 (inactive), Psychopathic 8 {'<'} 15 (active)<br/>
              → This message will be driven by Dominant + Psychopathic traits
            </div>

            <h4 className="subsection-header">Configuring Attributes</h4>
            <ol className="help-list numbered">
              <li>Open the <strong>Character Editor</strong></li>
              <li>Select the story you want to configure</li>
              <li>Go to the <strong>Attributes</strong> tab</li>
              <li>Adjust each slider (0-100% in 5% increments)</li>
              <li>Save the character</li>
            </ol>

            <div className="info-box">
              <strong>Per-Story Setting:</strong> Attributes are configured per-story, so the same
              character can have very different personality dynamics across different scenarios.
            </div>

            <h4 className="subsection-header">Dynamic Attribute Changes</h4>
            <p>
              Attributes can be changed mid-session using the <strong>Set Attribute</strong> flow action
              node. This lets you create flows that shift a character's personality as the story progresses
              — for example, gradually increasing a character's sadistic trait as tension escalates.
            </p>

            <div className="tip-box">
              <strong>Tip:</strong> Set attributes to 0% to disable them entirely, or 100% for traits
              that should always be present. Values in between create natural variation — a character
              at 60% dominant won't be commanding in every single message, which feels more realistic.
            </div>
          </div>
        )}
      </div>

      {/* Capacity Checkpoints */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('capacityCheckpoints')}>
          Capacity Checkpoints
          <span className="expand-icon">{expanded.capacityCheckpoints ? '−' : '+'}</span>
        </h3>
        {expanded.capacityCheckpoints && (
          <div className="section-content">
            <p>
              Capacity Checkpoints are <strong>author instructions injected into the AI prompt at different
              capacity ranges</strong>. They guide the character's behavior as the session progresses through
              different intensity levels, ensuring the AI's tone and actions evolve naturally with capacity.
            </p>

            <h4 className="subsection-header">How They Work</h4>
            <p>
              Each checkpoint is tied to a capacity range (e.g., 1-10%, 21-30%). When the player's
              capacity falls within a range that has a checkpoint, that text is included in the AI's
              system prompt as a <code>CHARACTER CHECKPOINT</code> instruction. The AI uses it to shape
              its next response.
            </p>

            <h4 className="subsection-header">Capacity Ranges</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Range</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>0% — Pre-Inflation</strong></td>
                  <td>Special range: requirements that must be met <em>before</em> inflation begins. The AI is told not to activate the pump until these conditions are satisfied.</td>
                </tr>
                <tr>
                  <td><strong>1-10%</strong></td>
                  <td>Early stage guidance</td>
                </tr>
                <tr>
                  <td><strong>11-20%</strong></td>
                  <td>Low capacity guidance</td>
                </tr>
                <tr>
                  <td><strong>21-30%</strong></td>
                  <td>Building intensity</td>
                </tr>
                <tr>
                  <td><strong>31-40%</strong></td>
                  <td>Mid-low range</td>
                </tr>
                <tr>
                  <td><strong>41-50%</strong></td>
                  <td>Midpoint guidance</td>
                </tr>
                <tr>
                  <td><strong>51-60%</strong></td>
                  <td>Past halfway</td>
                </tr>
                <tr>
                  <td><strong>61-70%</strong></td>
                  <td>High intensity</td>
                </tr>
                <tr>
                  <td><strong>71-80%</strong></td>
                  <td>Critical range</td>
                </tr>
                <tr>
                  <td><strong>81-90%</strong></td>
                  <td>Near limit</td>
                </tr>
                <tr>
                  <td><strong>91-100%</strong></td>
                  <td>Maximum / endgame</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Configuring Checkpoints</h4>
            <ol className="help-list numbered">
              <li>Open the <strong>Character Editor</strong></li>
              <li>Select the story you want to configure</li>
              <li>Go to the <strong>Checkpoints</strong> tab</li>
              <li>Fill in guidance text for the ranges you want — blank ranges are ignored</li>
              <li>Save the character</li>
            </ol>

            <h4 className="subsection-header">Example</h4>
            <div className="code-example">
              <strong>Dr. Iris Chen checkpoints:</strong><br/>
              0%: "Pre-inflation baseline readings. Calibrate instruments. Explain the protocol."<br/>
              1-10%: "Note initial responses. 'Minimal distension. Subject responsive.'"<br/>
              41-50%: "Genuinely fascinated by the data. 'Remarkable accommodation.'"<br/>
              91-100%: "Pure scientific euphoria. 'Unprecedented! We must document everything!'"
            </div>

            <div className="info-box">
              <strong>Per-Story Setting:</strong> Checkpoints are configured per-story, so the same
              character can have different progression guidance for different scenarios.
            </div>

            <div className="tip-box">
              <strong>Tip:</strong> You don't need to fill in every range. Only fill the ones where you
              want the AI to shift its behavior. The 0% pre-inflation checkpoint is especially useful
              for characters that should establish a scene before anything physical begins.
            </div>
          </div>
        )}
      </div>

      {/* Story Progression Mode */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('storyProgression')}>
          Story Progression Mode
          <span className="expand-icon">{expanded.storyProgression ? '−' : '+'}</span>
        </h3>
        {expanded.storyProgression && (
          <div className="section-content">
            <p>
              Story Progression Mode automatically generates player reply suggestions after each AI
              response. Instead of typing from scratch, you choose from several emotionally-varied
              options that reflect your persona's current state.
            </p>

            <h4 className="subsection-header">How It Works</h4>
            <ol className="help-list numbered">
              <li>The AI character sends a message</li>
              <li>A "Generating responses..." overlay appears briefly</li>
              <li>A panel of reply options appears, each with a different emotional angle</li>
              <li>Click an option to load it into your text input</li>
              <li>Edit it if you want, then send</li>
            </ol>

            <h4 className="subsection-header">Enabling Story Progression</h4>
            <ol className="help-list numbered">
              <li>Open the <strong>Character Editor</strong></li>
              <li>Select a story from the <strong>Story</strong> dropdown</li>
              <li>Toggle the <strong>Story Progression</strong> switch on</li>
              <li>Set the <strong>Max Suggestions</strong> count (2-5, default 3)</li>
              <li>Save the character</li>
            </ol>

            <div className="info-box">
              <strong>Per-Story Setting:</strong> Story Progression is configured per-story, not
              per-character. Different stories on the same character can have it enabled or disabled.
            </div>

            <h4 className="subsection-header">What Influences the Suggestions</h4>
            <p>
              Each suggestion is generated using your persona's full context, so the options
              feel authentic and situationally appropriate:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Effect on Suggestions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Current Emotion</strong></td>
                  <td>The first option uses your current emotion. Remaining options draw from adjacent emotions on the emotion wheel (e.g., "shy" produces options for shy, embarrassed, fearful, submissive).</td>
                </tr>
                <tr>
                  <td><strong>Capacity (%)</strong></td>
                  <td>Replies reflect the persona's physical state. At high capacity, options include physical reactions like strain, discomfort, or awareness of fullness.</td>
                </tr>
                <tr>
                  <td><strong>Pain Level</strong></td>
                  <td>Options incorporate pain/discomfort language matching the current pain rating, from no mention at 0 to intense reactions at higher levels.</td>
                </tr>
                <tr>
                  <td><strong>Recent Conversation</strong></td>
                  <td>The last 4 messages provide context so replies are relevant to what just happened.</td>
                </tr>
                <tr>
                  <td><strong>Persona Profile</strong></td>
                  <td>Your persona's personality, appearance, and relationship with inflation shape the voice and reactions.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Panel Behavior</h4>
            <ul className="help-list">
              <li><strong>Clicking an option</strong> loads the text into your input for review and editing before sending</li>
              <li><strong>Typing in the input</strong> dismisses the panel (you're writing your own reply)</li>
              <li><strong>Sending a message</strong> dismisses the panel</li>
              <li><strong>Next AI response</strong> generates a fresh set of options</li>
            </ul>

            <h4 className="subsection-header">Flow Interaction</h4>
            <p>
              Story Progression is automatically suppressed when a flow is actively running
              (e.g., during a player choice node, device cycle, or challenge). This prevents
              conflicting UI elements from appearing simultaneously.
            </p>

            <div className="tip-box">
              <strong>Tip:</strong> Story Progression works best when your persona has a detailed
              personality and "Relationship with Inflation" field filled in. The more context the
              AI has about your character, the more distinct and in-character the options will be.
            </div>
          </div>
        )}
      </div>

      {/* Personas */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('personas')}>
          Creating Personas
          <span className="expand-icon">{expanded.personas ? '−' : '+'}</span>
        </h3>
        {expanded.personas && (
          <div className="section-content">
            <p>
              Personas represent <strong>you</strong> - the player character in the roleplay.
              They're simpler than characters because the AI uses this information as background
              context rather than controlling the persona directly.
            </p>

            <h4 className="subsection-header">Why Use Personas?</h4>
            <ul className="help-list">
              <li>The AI knows who it's talking to and can reference your appearance</li>
              <li>Characters can react appropriately to your persona's traits</li>
              <li>When flows generate player messages, they match your persona's voice</li>
              <li>Immersion - you have a defined character to roleplay as</li>
            </ul>

            <div className="info-box">
              <strong>Note:</strong> You can switch personas mid-conversation if you want to
              roleplay as someone else. The AI will adapt to the new persona.
            </div>
          </div>
        )}
      </div>

      {/* Builtin Personas */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('builtinPersonas')}>
          Builtin Personas
          <span className="expand-icon">{expanded.builtinPersonas ? '−' : '+'}</span>
        </h3>
        {expanded.builtinPersonas && (
          <div className="section-content">
            <p>
              SwellDreams includes two pre-made personas with contrasting personalities to get you
              started quickly. Each has assigned flows that generate automatic player reactions
              based on capacity levels.
            </p>

            <h4 className="subsection-header">Marcus - The Eager Subject (Male)</h4>
            <p>
              <strong>Pronouns:</strong> he/him
            </p>
            <p>
              <strong>Personality:</strong> Willing, excited, enjoys being controlled. Enthusiastic
              about new experiences and expresses gratitude and pleasure openly.
            </p>
            <ul className="help-list">
              <li><strong>Relationship with Inflation:</strong> Has fantasized about this for years and can barely contain his excitement. Deeply submissive and eager to please.</li>
              <li><strong>Flow:</strong> Eager Reactions - capacity-based player messages expressing enthusiasm and gratitude</li>
              <li><strong>Best For:</strong> Submissive scenarios, enthusiastic consent roleplay</li>
            </ul>

            <h4 className="subsection-header">Zara - The Bratty Subject (Female)</h4>
            <p>
              <strong>Pronouns:</strong> she/her
            </p>
            <p>
              <strong>Personality:</strong> Playful resistance, needs convincing, talks back. Enjoys
              the push-and-pull dynamic. Secretly loves it but won't admit it easily.
            </p>
            <ul className="help-list">
              <li><strong>Relationship with Inflation:</strong> Acts like she doesn't want this but keeps coming back. Challenges authority while secretly craving the loss of control.</li>
              <li><strong>Flow:</strong> Bratty Reactions - capacity-based player messages with resistance, complaints, and reluctant enjoyment</li>
              <li><strong>Best For:</strong> Brat-taming scenarios, reluctant participant roleplay</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> Persona flows use <code>buttonTarget: 'persona'</code> to generate
              player messages automatically. This creates immersive reactions without you needing to
              type responses manually during intense moments.
            </div>
          </div>
        )}
      </div>

      {/* Persona Fields */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('personaFields')}>
          Persona Fields Explained
          <span className="expand-icon">{expanded.personaFields ? '−' : '+'}</span>
        </h3>
        {expanded.personaFields && (
          <div className="section-content">
            <table className="help-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Purpose</th>
                  <th>Tips</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Display Name</strong></td>
                  <td>Your character's name, used in <code>[Player]</code> variable</td>
                  <td>Required. This is how the AI refers to you.</td>
                </tr>
                <tr>
                  <td><strong>Pronouns</strong></td>
                  <td>he/him, she/her, they/them, or it/its</td>
                  <td>AI will use correct pronouns when generating player messages.</td>
                </tr>
                <tr>
                  <td><strong>Physical Appearance</strong></td>
                  <td>How you look - the character will know this</td>
                  <td>Be as detailed as you like. Height, build, hair, clothing, etc.</td>
                </tr>
                <tr>
                  <td><strong>Personality</strong></td>
                  <td>Your character's personality traits</td>
                  <td>Used when flows generate messages from your perspective.</td>
                </tr>
                <tr>
                  <td><strong>Relationship with Inflation</strong></td>
                  <td>How your character relates to the inflation theme</td>
                  <td>Experience level, feelings about it, history, knowledge.</td>
                </tr>
                <tr>
                  <td><strong>Avatar</strong></td>
                  <td>Visual representation of your persona</td>
                  <td>Upload an image. Will be cropped to 3:4 portrait ratio.</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Staged Portraits */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('stagedPortraits')}>
          Staged Portraits
          <span className="expand-icon">{expanded.stagedPortraits ? '−' : '+'}</span>
        </h3>
        {expanded.stagedPortraits && (
          <div className="section-content">
            <p>
              Staged portraits allow your persona's avatar to change dynamically based on capacity level,
              creating visual progression as sessions intensify.
            </p>

            <h4 className="subsection-header">How It Works</h4>
            <p>
              Instead of a single avatar, you can upload multiple images that represent different
              stages of capacity. The portrait automatically transitions as the capacity gauge changes.
            </p>

            <h4 className="subsection-header">Setting Up Staged Portraits</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Persona</strong></li>
              <li>Enable <strong>Staged Portraits</strong></li>
              <li>Upload images for each stage you want</li>
              <li>Configure the capacity thresholds for each transition</li>
            </ol>

            <h4 className="subsection-header">Example Configuration</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Threshold</th>
                  <th>Portrait Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td>0%</td>
                  <td>Normal/relaxed appearance</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td>25%</td>
                  <td>Slight change, mild expression</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td>50%</td>
                  <td>More visible progression</td>
                </tr>
                <tr>
                  <td>4</td>
                  <td>75%</td>
                  <td>Intense/maximum stage</td>
                </tr>
              </tbody>
            </table>

            <div className="tip-box">
              <strong>Tip:</strong> Portrait transitions are smooth and automatic. The system
              interpolates between stages based on the current capacity value.
            </div>
          </div>
        )}
      </div>

      {/* Character Buttons */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('buttons')}>
          Character Buttons
          <span className="expand-icon">{expanded.buttons ? '−' : '+'}</span>
        </h3>
        {expanded.buttons && (
          <div className="section-content">
            <p>
              Character Buttons appear above the chat input and provide quick actions you can
              trigger during conversations. Each button can execute multiple actions in sequence.
            </p>

            <h4 className="subsection-header">Creating Buttons</h4>
            <ol className="help-list numbered">
              <li>Open the character editor</li>
              <li>Go to the <strong>Custom Buttons</strong> tab</li>
              <li>Click <strong>+ Add Button</strong></li>
              <li>Give it a name (displayed on the button)</li>
              <li>Add one or more actions</li>
              <li>Save the button, then save the character</li>
            </ol>

            <h4 className="subsection-header">Button Action Types</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Action Type</th>
                  <th>What It Does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Send Message</strong></td>
                  <td>Generates an AI message using your instruction text. Use <code>[Player]</code> for persona name.</td>
                </tr>
                <tr>
                  <td><strong>Turn On Device</strong></td>
                  <td>Turns on a smart device by IP address.</td>
                </tr>
                <tr>
                  <td><strong>Cycle Device</strong></td>
                  <td>Runs a device cycle (on/off pattern) with duration and interval settings.</td>
                </tr>
                <tr>
                  <td><strong>Link to Flow</strong></td>
                  <td>Triggers a Button Press FlowAction in a flow. Select the flow and which FlowAction to trigger.</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Button Features</h4>
            <ul className="help-list">
              <li><strong>Enable/Disable Toggle</strong> - Disabled buttons are hidden in chat</li>
              <li><strong>Button ID</strong> - Auto-assigned number, used for flow linking</li>
              <li><strong>Action Order</strong> - Actions execute top-to-bottom, use arrows to reorder</li>
              <li><strong>Flow Control</strong> - Toggle Button action in flows can enable/disable buttons dynamically</li>
            </ul>

            <div className="tip-box">
              <strong>Pro Tip:</strong> Link buttons to flows for complex multi-step sequences.
              The button triggers the flow, and the flow can do anything - send messages,
              control devices, show choices, and more.
            </div>
          </div>
        )}
      </div>

      {/* Constant Reminders */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('constantReminders')}>
          Custom Reminders (Lorebook System)
          <span className="expand-icon">{expanded.constantReminders ? '−' : '+'}</span>
        </h3>
        {expanded.constantReminders && (
          <div className="section-content">
            <p>
              Custom Reminders are context-aware instructions included in the AI's prompts.
              They can be <strong>always active</strong> or <strong>keyword-triggered</strong>,
              mimicking full lorebook functionality from other AI platforms.
            </p>

            <h4 className="subsection-header">Reminder Modes</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>When It Activates</th>
                  <th>Best For</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Constant (Always Active)</strong></td>
                  <td>Every single response</td>
                  <td>Core character traits, permanent rules, ongoing states</td>
                </tr>
                <tr>
                  <td><strong>Keyword-Triggered</strong></td>
                  <td>Only when keywords appear in recent messages</td>
                  <td>Contextual lore, character knowledge, situational rules</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Reminder Fields</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Name</strong></td>
                  <td>Short identifier for the reminder (for your reference)</td>
                </tr>
                <tr>
                  <td><strong>Text</strong></td>
                  <td>The actual instruction sent to the AI</td>
                </tr>
                <tr>
                  <td><strong>Always Active</strong></td>
                  <td>✓ Checked = Always included | ✗ Unchecked = Keyword-triggered</td>
                </tr>
                <tr>
                  <td><strong>Trigger Keywords</strong></td>
                  <td>Words that activate the reminder (only if not constant)</td>
                </tr>
                <tr>
                  <td><strong>Case Sensitive</strong></td>
                  <td>Whether "Dragon" and "dragon" are treated differently</td>
                </tr>
                <tr>
                  <td><strong>Priority</strong></td>
                  <td>Higher priority = appears earlier in prompt (default: 100)</td>
                </tr>
                <tr>
                  <td><strong>Scan Depth</strong></td>
                  <td>How many recent messages to scan (0 = all messages)</td>
                </tr>
                <tr>
                  <td><strong>Enable/Disable</strong></td>
                  <td>Toggle switch to temporarily disable without deleting</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Example Reminders</h4>

            <div className="code-example">
              <strong>Constant Reminder (Always Active):</strong><br/>
              Name: "Core Personality"<br/>
              Text: "Dr. Elena is methodical and speaks with clinical precision."<br/>
              Always Active: ✓ Checked<br/>
              Priority: 150
            </div>

            <div className="code-example">
              <strong>Keyword-Triggered Reminder:</strong><br/>
              Name: "Dragon Lore"<br/>
              Text: "Dragons in this world breathe ice instead of fire and live in mountain caves."<br/>
              Always Active: ✗ Unchecked<br/>
              Keywords: "dragon", "Dragon", "drake", "wyrm"<br/>
              Case Sensitive: ✗ Unchecked<br/>
              Scan Depth: 10 (last 10 messages)<br/>
              Priority: 100
            </div>

            <div className="info-box">
              <strong>💡 Pro Tip:</strong> Use high-priority constant reminders for core traits,
              and keyword-triggered reminders for world lore that's only relevant in context.
              This saves tokens for more conversation!
            </div>

            <div className="info-box">
              <strong>Flow Integration:</strong> Flows can enable, disable, or update reminder
              text using the <strong>Toggle Reminder</strong> action. This allows dynamic
              story progression without manual editing.
            </div>
          </div>
        )}
      </div>

      {/* Global Reminders */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('globalReminders')}>
          Global Reminders
          <span className="expand-icon">{expanded.globalReminders ? '−' : '+'}</span>
        </h3>
        {expanded.globalReminders && (
          <div className="section-content">
            <p>
              Global Reminders are similar to Constant Reminders, but they apply to
              <strong> all characters</strong> rather than just one. They're configured in
              <strong> Settings → Global</strong>.
            </p>

            <h4 className="subsection-header">Global vs Character Reminders</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Global Reminders</th>
                  <th>Character Reminders</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Apply to ALL characters</td>
                  <td>Apply to ONE specific character</td>
                </tr>
                <tr>
                  <td>Configured in Settings → Global</td>
                  <td>Configured in Character Editor</td>
                </tr>
                <tr>
                  <td>Good for universal rules</td>
                  <td>Good for character-specific info</td>
                </tr>
                <tr>
                  <td>Prefixed with "Global-" in UI</td>
                  <td>No prefix</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">When to Use Global Reminders</h4>
            <ul className="help-list">
              <li><strong>Safety rules</strong> - Boundaries that should always be respected</li>
              <li><strong>Writing style</strong> - "Always use third person" or "Include sensory details"</li>
              <li><strong>World rules</strong> - Universal facts about your roleplay setting</li>
              <li><strong>Format preferences</strong> - Response length, formatting style</li>
            </ul>

            <div className="warning-box">
              <strong>Note:</strong> Both Global Reminders AND Character Reminders are included
              in prompts when both exist. Be careful not to create conflicting instructions.
            </div>

            <h4 className="subsection-header">Author Note / System Instructions</h4>
            <p>
              In addition to Global Reminders, the <strong>Settings → Global</strong> page has
              an <strong>Author Note</strong> field. This is similar to reminders but appears
              at an even higher priority in the prompt. Use it for your most important
              persistent instructions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConversationsTab;
