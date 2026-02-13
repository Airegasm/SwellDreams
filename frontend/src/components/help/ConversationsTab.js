import React, { useState } from 'react';
import './HelpTabs.css';

function ConversationsTab() {
  const [expanded, setExpanded] = useState({
    overview: false,
    chatInterface: false,
    mobileInterface: false,
    builtinCharacters: false,
    characters: false,
    characterFields: false,
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

            <div className="tip-box">
              <strong>Tip:</strong> Each builtin character comes with pre-assigned flows that demonstrate
              different node types. Open them in the Flow Editor to learn how flows work, then modify
              or create your own.
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
              <li><strong>Constant Reminders</strong> - Instructions the AI always remembers</li>
              <li><strong>Custom Buttons</strong> - Quick-action buttons for the chat interface</li>
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
              <li><strong>Robot icon</strong> - Toggle LLM Enhancement (when enabled, AI will expand/enhance your text)</li>
              <li><strong>Dropdown</strong> - Switch between versions</li>
            </ul>
            <div className="tip-box">
              <strong>Tip:</strong> Create multiple welcome messages for variety. The active one
              (shown in dropdown) will be used when starting a new conversation.
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
            </ul>

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
