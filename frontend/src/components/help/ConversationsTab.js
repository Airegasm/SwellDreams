import React, { useState } from 'react';
import './HelpTabs.css';

function ConversationsTab() {
  const [expanded, setExpanded] = useState({
    overview: true,
    characters: false,
    characterFields: false,
    personas: false,
    personaFields: false,
    buttons: false,
    constantReminders: false,
    globalReminders: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>Conversations</h2>

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
            <ul className="help-list">
              <li>Add pairs of user input and character response</li>
              <li>Show personality through dialogue style</li>
              <li>Demonstrate how character handles different situations</li>
            </ul>
            <div className="code-example">
              User: "How are you today?"<br/>
              Character: "*adjusts glasses* Oh! I didn't see you there. I'm doing well, thank you for asking."
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
          Constant Reminders (Character)
          <span className="expand-icon">{expanded.constantReminders ? '−' : '+'}</span>
        </h3>
        {expanded.constantReminders && (
          <div className="section-content">
            <p>
              Constant Reminders are instructions that are always included in the AI's context
              when generating responses. They're specific to a character and help maintain
              consistency in the roleplay.
            </p>

            <h4 className="subsection-header">When to Use Reminders</h4>
            <ul className="help-list">
              <li><strong>Character rules</strong> - Things the character should always do or never do</li>
              <li><strong>Ongoing state</strong> - "Remember that the player is currently restrained"</li>
              <li><strong>Tone guidance</strong> - "Always maintain a playful, teasing tone"</li>
              <li><strong>Plot points</strong> - Important facts that shouldn't be forgotten</li>
            </ul>

            <h4 className="subsection-header">Managing Reminders</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Feature</th>
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
                  <td><strong>Enable/Disable</strong></td>
                  <td>Toggle switch to temporarily disable without deleting</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Flow Integration:</strong> Flows can enable, disable, or update reminder
              text using the <strong>Toggle Reminder</strong> action. This allows dynamic
              story progression without manual editing.
            </div>

            <div className="code-example">
              <strong>Example Reminder:</strong><br/>
              Name: "Restraint State"<br/>
              Text: "The player is currently tied to a chair and cannot move freely. Reference this limitation when appropriate."
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
