import React, { useState } from 'react';
import './HelpTabs.css';

function ScreenplayTab() {
  const [expanded, setExpanded] = useState({
    overview: false,
    structure: false,
    paragraphTypes: false,
    challenges: false,
    actors: false,
    variables: false,
    inflatees: false,
    continueMode: false,
    llmEnhancement: false,
    filmstrips: false,
    tips: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>ScreenPlay (Visual Novel System)</h2>

      {/* Overview */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('overview')}>
          Overview
          <span className="expand-icon">{expanded.overview ? '−' : '+'}</span>
        </h3>
        {expanded.overview && (
          <div className="section-content">
            <p>
              <strong>ScreenPlay</strong> is a visual novel-style storytelling system separate from
              the main chat. Create branching interactive stories with actors, dialogue, choices,
              and device integration.
            </p>
            <p>
              Unlike Flows which automate chat interactions, ScreenPlay creates standalone
              narrative experiences with their own interface, complete with character portraits,
              capacity tracking, and cinematic presentation.
            </p>

            <h4 className="subsection-header">Key Features</h4>
            <ul className="help-list">
              <li><strong>Branching Narratives</strong> - Create stories with multiple paths and endings</li>
              <li><strong>Device Integration</strong> - Control real devices during story playback</li>
              <li><strong>LLM Enhancement</strong> - Let AI expand your prompts into rich prose</li>
              <li><strong>Dual Inflatee System</strong> - Track two characters with capacity gauges</li>
              <li><strong>Interactive Challenges</strong> - Include mini-games that affect story outcomes</li>
              <li><strong>Visual Filmstrips</strong> - Show character avatars with dynamic expressions</li>
            </ul>

            <div className="info-box">
              <strong>Getting Started:</strong> Go to <strong>Automation → ScreenPlay</strong>,
              create a new Play, add actors, write your scenario, then click
              <strong> Storyboard</strong> to build your pages and paragraphs.
            </div>
          </div>
        )}
      </div>

      {/* Structure */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('structure')}>
          Plays, Pages & Paragraphs
          <span className="expand-icon">{expanded.structure ? '−' : '+'}</span>
        </h3>
        {expanded.structure && (
          <div className="section-content">
            <p>
              ScreenPlay content is organized in a three-level hierarchy:
            </p>

            <h4 className="subsection-header">Plays</h4>
            <p>
              A <strong>Play</strong> is a complete story containing all its pages, actors, and settings.
              Each play has:
            </p>
            <ul className="help-list">
              <li><strong>Name</strong> - Display title for the play</li>
              <li><strong>Scenario</strong> - Background context used by LLM enhancement</li>
              <li><strong>Author Mode</strong> - 2nd person ("You feel...") or 3rd person ("They feel...")</li>
              <li><strong>Actors</strong> - Characters that appear in the story</li>
              <li><strong>Inflatee Settings</strong> - Names and avatars for the two capacity-tracked characters</li>
              <li><strong>Playback Settings</strong> - Continue mode, text allowance, etc.</li>
            </ul>

            <h4 className="subsection-header">Pages</h4>
            <p>
              <strong>Pages</strong> are story segments (think of them as scenes). Each page contains
              a sequence of paragraphs that play in order. Pages are identified by unique IDs and
              can be jumped to via choices, conditions, or goto events.
            </p>
            <ul className="help-list">
              <li>Every play starts with a "start" page</li>
              <li>Create additional pages for branches and scenes</li>
              <li>Pages can loop back to themselves or other pages</li>
              <li>Use descriptive page names for easy navigation</li>
            </ul>

            <h4 className="subsection-header">Paragraphs</h4>
            <p>
              <strong>Paragraphs</strong> (also called events) are individual story elements within a page.
              They execute in sequence and can include narration, dialogue, player choices, device
              commands, and more.
            </p>

            <div className="tip-box">
              <strong>Tip:</strong> Think of pages as "where you are in the story" and paragraphs as
              "what happens while you're there."
            </div>
          </div>
        )}
      </div>

      {/* Paragraph Types */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('paragraphTypes')}>
          Paragraph/Event Types
          <span className="expand-icon">{expanded.paragraphTypes ? '−' : '+'}</span>
        </h3>
        {expanded.paragraphTypes && (
          <div className="section-content">
            <p>
              Each paragraph has a type that determines what it does. Here are all available types:
            </p>

            <h4 className="subsection-header">Story Content</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Narration</strong></td>
                  <td>Descriptive text (2nd or 3rd person based on author mode)</td>
                  <td>Text content, LLM enhancement toggle</td>
                </tr>
                <tr>
                  <td><strong>Dialogue</strong></td>
                  <td>Character speech with actor avatar and name</td>
                  <td>Actor selector, text, LLM enhancement</td>
                </tr>
                <tr>
                  <td><strong>Player Dialogue</strong></td>
                  <td>Speech attributed to the player character</td>
                  <td>Text content, LLM enhancement</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Player Interaction</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Choice</strong></td>
                  <td>Multiple options that branch to different pages</td>
                  <td>Choice labels, target pages for each option</td>
                </tr>
                <tr>
                  <td><strong>Inline Choice</strong></td>
                  <td>Questions/options that show responses without changing page</td>
                  <td>Options with inline response text</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Logic & Flow Control</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Condition</strong></td>
                  <td>Check a variable and branch to different pages</td>
                  <td>Variable, operator, value, true/false pages</td>
                </tr>
                <tr>
                  <td><strong>Set Variable</strong></td>
                  <td>Store or modify a play variable</td>
                  <td>Variable name, operation, value</td>
                </tr>
                <tr>
                  <td><strong>Go to Page</strong></td>
                  <td>Jump to another page in the play</td>
                  <td>Target page selector</td>
                </tr>
                <tr>
                  <td><strong>Weighted Random</strong></td>
                  <td>Randomly jump to one of several pages based on weights</td>
                  <td>Multiple outcomes with weight values and target pages</td>
                </tr>
                <tr>
                  <td><strong>Delay</strong></td>
                  <td>Pause before continuing to next paragraph</td>
                  <td>Duration in seconds</td>
                </tr>
                <tr>
                  <td><strong>End</strong></td>
                  <td>End the play with an outcome</td>
                  <td>Outcome type (good/bad/neutral), ending message</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Device & Visual Control</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Pump</strong></td>
                  <td>Control real devices</td>
                  <td>Mode (on/off/cycle/pulse/timed/until), device, duration. Timed mode accepts variables like <code>[Play:duration]</code></td>
                </tr>
                <tr>
                  <td><strong>Mock Pump</strong></td>
                  <td>Simulate pump for NPC/Inflatee 2 (visual only)</td>
                  <td>Mode (on/off/cycle/pulse/timed/until), target, duration. Timed mode accepts variables like <code>[Play:duration]</code></td>
                </tr>
                <tr>
                  <td><strong>Parallel Container</strong></td>
                  <td>Run multiple events simultaneously (non-blocking)</td>
                  <td>Contains Pump, Mock Pump, Set Variable, Delay, Set NPC Avatar events that all fire at once</td>
                </tr>
                <tr>
                  <td><strong>Capacity Gate</strong></td>
                  <td>Block progress until capacity threshold is met</td>
                  <td>Target (Player/Inflatee 2), threshold (1-100%), optional message</td>
                </tr>
                <tr>
                  <td><strong>Set NPC Avatar</strong></td>
                  <td>Change the right filmstrip avatar dynamically</td>
                  <td>Image URL or preset selector</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Notifications</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Popup</strong></td>
                  <td>Show a modal popup with custom message</td>
                  <td>Title, message, button text</td>
                </tr>
                <tr>
                  <td><strong>Toast</strong></td>
                  <td>Show a temporary notification</td>
                  <td>Message, duration, position</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Media</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Show Image</strong></td>
                  <td>Display an image from Media Album</td>
                  <td>Image tag, caption, display mode (inline/fullscreen/popup)</td>
                </tr>
                <tr>
                  <td><strong>Play Video</strong></td>
                  <td>Play a video from Media Album</td>
                  <td>Video tag, autoplay, loop, muted, blocking</td>
                </tr>
                <tr>
                  <td><strong>Play Audio</strong></td>
                  <td>Play audio from Media Album</td>
                  <td>Audio tag, loop, silent (no player), blocking</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Auto-Continue Blocking:</strong> Media events automatically block the
              auto-continue timer until the media finishes playing once. For images in
              fullscreen/popup mode, the timer resumes when the user dismisses the image.
            </div>

            <div className="info-box">
              <strong>Capacity Gate:</strong> This event blocks both manual and auto-continue
              until the target's capacity reaches the specified threshold. The gate shows a
              progress bar and automatically unlocks when the condition is met. Use Mock Pump
              events before the gate to increase capacity during the play.
            </div>
          </div>
        )}
      </div>

      {/* Challenge Types */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('challenges')}>
          Challenge Events (Mini-Games)
          <span className="expand-icon">{expanded.challenges ? '−' : '+'}</span>
        </h3>
        {expanded.challenges && (
          <div className="section-content">
            <p>
              Challenge events are interactive mini-games that pause the story until completed.
              Each challenge routes to different pages based on win/lose outcomes.
            </p>

            <table className="help-table">
              <thead>
                <tr>
                  <th>Challenge</th>
                  <th>Description</th>
                  <th>Configuration</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Prize Wheel</strong></td>
                  <td>Spin a wheel with customizable segments</td>
                  <td>Segment labels, colors, duplicates (distributed evenly), result variable, auto-spin option</td>
                </tr>
                <tr>
                  <td><strong>Dice Roll</strong></td>
                  <td>Roll dice and compare total to target</td>
                  <td>Number of dice, target number, comparison type</td>
                </tr>
                <tr>
                  <td><strong>Coin Flip</strong></td>
                  <td>Simple 50/50 coin toss</td>
                  <td>Win condition (heads/tails)</td>
                </tr>
                <tr>
                  <td><strong>Rock Paper Scissors</strong></td>
                  <td>Play RPS against the AI</td>
                  <td>Number of rounds (best of 1/3/5)</td>
                </tr>
                <tr>
                  <td><strong>Timer Challenge</strong></td>
                  <td>Press button before time runs out</td>
                  <td>Time limit, button label</td>
                </tr>
                <tr>
                  <td><strong>Number Guess</strong></td>
                  <td>Guess a number within a range</td>
                  <td>Min/max range, attempts, show hints toggle</td>
                </tr>
                <tr>
                  <td><strong>Slot Machine</strong></td>
                  <td>Spin 3 reels with emoji symbols</td>
                  <td>Symbols list, win patterns, auto-pull option</td>
                </tr>
                <tr>
                  <td><strong>Card Draw</strong></td>
                  <td>Draw a card from a deck</td>
                  <td>Deck type, output mode (suit/color/value), routing per result</td>
                </tr>
                <tr>
                  <td><strong>Simon Challenge</strong></td>
                  <td>Memory game - repeat colored sequences</td>
                  <td>Starting length, max length, max misses allowed</td>
                </tr>
                <tr>
                  <td><strong>Reflex Challenge</strong></td>
                  <td>Click targets as they appear</td>
                  <td>Number of rounds, time per target, target size</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Routing:</strong> All challenges have Win Page and Lose Page selectors.
              Some challenges (like Card Draw) support per-result routing for more granular branching.
            </div>
          </div>
        )}
      </div>

      {/* Actors */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('actors')}>
          Actors System
          <span className="expand-icon">{expanded.actors ? '−' : '+'}</span>
        </h3>
        {expanded.actors && (
          <div className="section-content">
            <p>
              <strong>Actors</strong> are characters that appear in your play. Each actor has a name,
              avatar, and personality that's used for dialogue and LLM enhancement.
            </p>

            <h4 className="subsection-header">Actor Properties</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Name</strong></td>
                  <td>Display name shown with dialogue</td>
                </tr>
                <tr>
                  <td><strong>Avatar</strong></td>
                  <td>Character portrait image</td>
                </tr>
                <tr>
                  <td><strong>Personality</strong></td>
                  <td>Description used by LLM when enhancing dialogue</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Using Actors</h4>
            <ul className="help-list">
              <li>Add actors in the play's Actors section before using them in paragraphs</li>
              <li>Select an actor when creating Dialogue paragraphs</li>
              <li>The actor's avatar appears next to their dialogue</li>
              <li>LLM enhancement uses the actor's personality for style</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> You can import characters from your main character list as actors,
              bringing over their avatar and personality automatically.
            </div>
          </div>
        )}
      </div>

      {/* Variables */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('variables')}>
          Variables in ScreenPlay
          <span className="expand-icon">{expanded.variables ? '−' : '+'}</span>
        </h3>
        {expanded.variables && (
          <div className="section-content">
            <p>
              Use variables in text and conditions to create dynamic, personalized stories.
            </p>

            <h4 className="subsection-header">Built-in Variables</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Description</th>
                  <th>Example Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>[Player]</code></td>
                  <td>Player character name from persona</td>
                  <td>Alex</td>
                </tr>
                <tr>
                  <td><code>[Capacity]</code> or <code>[Capacity1]</code></td>
                  <td>Inflatee 1 capacity (0-100)</td>
                  <td>45</td>
                </tr>
                <tr>
                  <td><code>[Capacity_mock]</code> or <code>[Capacity2]</code></td>
                  <td>Inflatee 2 capacity (0-100)</td>
                  <td>30</td>
                </tr>
                <tr>
                  <td><code>[Feeling]</code></td>
                  <td>Pain description based on Inflatee 1 capacity</td>
                  <td>stretched</td>
                </tr>
                <tr>
                  <td><code>[Feeling_mock]</code></td>
                  <td>Pain description for Inflatee 2</td>
                  <td>tight</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Custom Play Variables</h4>
            <p>
              Create your own variables using <strong>Set Variable</strong> events:
            </p>
            <div className="code-example">
              [Play:trustLevel] - Track relationship progression<br />
              [Play:itemCount] - Count collected items<br />
              [Play:chosenPath] - Remember player decisions<br />
              [Play:attempts] - Track retry attempts
            </div>

            <h4 className="subsection-header">Using Variables</h4>
            <ul className="help-list">
              <li>Include variables in narration and dialogue text</li>
              <li>Use in Condition events to branch the story</li>
              <li>Modify with Set Variable events</li>
              <li>Variables persist throughout the play session</li>
            </ul>
          </div>
        )}
      </div>

      {/* Inflatees */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('inflatees')}>
          Inflatees & Mock Pump System
          <span className="expand-icon">{expanded.inflatees ? '−' : '+'}</span>
        </h3>
        {expanded.inflatees && (
          <div className="section-content">
            <p>
              ScreenPlay can track two "inflatees" - characters whose capacity is visually
              displayed in the side filmstrips.
            </p>

            <h4 className="subsection-header">Inflatee 1 (Left Filmstrip)</h4>
            <ul className="help-list">
              <li>Represents the player character</li>
              <li>Controlled by real <strong>Pump</strong> events</li>
              <li>Capacity tracked via <code>[Capacity]</code> or <code>[Capacity1]</code></li>
              <li>Affected by actual device activation</li>
            </ul>

            <h4 className="subsection-header">Inflatee 2 (Right Filmstrip)</h4>
            <ul className="help-list">
              <li>Represents an NPC or second character</li>
              <li>Controlled by <strong>Mock Pump</strong> events (visual only)</li>
              <li>Capacity tracked via <code>[Capacity_mock]</code> or <code>[Capacity2]</code></li>
              <li>No actual device activation - purely narrative</li>
            </ul>

            <h4 className="subsection-header">Mock Pump Modes</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Set</strong></td>
                  <td>Set capacity to a specific value instantly</td>
                </tr>
                <tr>
                  <td><strong>Add</strong></td>
                  <td>Increase capacity by an amount</td>
                </tr>
                <tr>
                  <td><strong>Subtract</strong></td>
                  <td>Decrease capacity by an amount</td>
                </tr>
                <tr>
                  <td><strong>Animate</strong></td>
                  <td>Smoothly animate capacity change over time</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Configuration:</strong> Set inflatee names and avatars in the play's
              Inflatees section. The "Max Pain at 100%" toggle determines whether reaching
              full capacity triggers maximum pain state.
            </div>
          </div>
        )}
      </div>

      {/* Continue Mode */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('continueMode')}>
          Continue Mode & Playback
          <span className="expand-icon">{expanded.continueMode ? '−' : '+'}</span>
        </h3>
        {expanded.continueMode && (
          <div className="section-content">
            <p>
              Continue Mode controls how the story progresses between paragraphs.
            </p>

            <h4 className="subsection-header">Manual Mode</h4>
            <p>
              Player must click "Continue" or press Space to advance to the next paragraph.
              This gives full control over pacing.
            </p>

            <h4 className="subsection-header">Auto Mode</h4>
            <p>
              Story automatically advances after each paragraph. Configure timing:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Base Delay</strong></td>
                  <td>Minimum wait time between paragraphs (seconds)</td>
                </tr>
                <tr>
                  <td><strong>Per-Word Delay</strong></td>
                  <td>Additional time per word in the text</td>
                </tr>
                <tr>
                  <td><strong>Max Delay</strong></td>
                  <td>Maximum total delay cap</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Playback Controls</h4>
            <ul className="help-list">
              <li><strong>Play/Pause Button</strong> - Toggle auto-continue on/off</li>
              <li><strong>Speed Controls</strong> - Adjust timing multiplier</li>
              <li><strong>Skip</strong> - Jump to next interactive element</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> Even in Auto mode, the story pauses for choices, challenges,
              and other interactive elements that require player input.
            </div>
          </div>
        )}
      </div>

      {/* LLM Enhancement */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('llmEnhancement')}>
          LLM Enhancement
          <span className="expand-icon">{expanded.llmEnhancement ? '−' : '+'}</span>
        </h3>
        {expanded.llmEnhancement && (
          <div className="section-content">
            <p>
              Enable <strong>LLM Enhancement</strong> on narration or dialogue paragraphs to have
              the AI expand brief prompts into rich, detailed content.
            </p>

            <h4 className="subsection-header">How It Works</h4>
            <ol className="help-list numbered">
              <li>Write a brief prompt or outline for the paragraph</li>
              <li>Enable the "Enhance with LLM" toggle</li>
              <li>During playback, the AI generates expanded content</li>
              <li>The enhanced text replaces your prompt in the display</li>
            </ol>

            <h4 className="subsection-header">Enhancement Settings</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Text Allowance</strong></td>
                  <td>Maximum tokens for enhanced text (play-wide setting)</td>
                </tr>
                <tr>
                  <td><strong>Enhancement Allowance</strong></td>
                  <td>Additional tokens specifically for LLM-enhanced paragraphs</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Context Used</h4>
            <p>The AI considers when enhancing:</p>
            <ul className="help-list">
              <li>The play's scenario description</li>
              <li>The actor's personality (for dialogue)</li>
              <li>The author mode (2nd vs 3rd person)</li>
              <li>Current variable values</li>
              <li>Recent story context</li>
            </ul>

            <div className="info-box">
              <strong>Example:</strong> A prompt like "describe the pressure building" might become
              "You feel the relentless pressure mounting within you, each passing moment intensifying
              the sensation as your body struggles to accommodate the inexorable expansion..."
            </div>
          </div>
        )}
      </div>

      {/* Filmstrips */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('filmstrips')}>
          Filmstrips (Visual Display)
          <span className="expand-icon">{expanded.filmstrips ? '−' : '+'}</span>
        </h3>
        {expanded.filmstrips && (
          <div className="section-content">
            <p>
              Filmstrips are the visual sidebars that display character avatars and capacity gauges
              during play.
            </p>

            <h4 className="subsection-header">Left Filmstrip (Inflatee 1)</h4>
            <ul className="help-list">
              <li>Shows player character avatar</li>
              <li>Displays Capacity 1 gauge</li>
              <li>Updates based on real pump activity</li>
              <li>Can show multiple expression states</li>
            </ul>

            <h4 className="subsection-header">Right Filmstrip (Inflatee 2)</h4>
            <ul className="help-list">
              <li>Shows NPC/secondary character avatar</li>
              <li>Displays Capacity 2 gauge</li>
              <li>Updates based on mock pump events</li>
              <li>Avatar can be changed mid-story with Set NPC Avatar events</li>
            </ul>

            <h4 className="subsection-header">Avatar States</h4>
            <p>
              Configure multiple avatar images that change based on capacity level:
            </p>
            <ul className="help-list">
              <li><strong>Normal</strong> - Default expression (0-30%)</li>
              <li><strong>Concerned</strong> - Slight discomfort (31-60%)</li>
              <li><strong>Stressed</strong> - Visible strain (61-85%)</li>
              <li><strong>Critical</strong> - Maximum intensity (86-100%)</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> Upload avatar variations to the Media Album, then configure
              them in the play's Inflatee settings for dynamic visual feedback.
            </div>
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('tips')}>
          Tips & Best Practices
          <span className="expand-icon">{expanded.tips ? '−' : '+'}</span>
        </h3>
        {expanded.tips && (
          <div className="section-content">
            <ul className="help-list">
              <li>
                <strong>Plan Your Structure:</strong> Sketch out your story's branches before
                building in the Storyboard. Know your key decision points and endings.
              </li>
              <li>
                <strong>Use Meaningful Page Names:</strong> Names like "caught_sneaking" or
                "trust_gained" are easier to work with than "page_7" or "branch_a".
              </li>
              <li>
                <strong>Test Incrementally:</strong> Playtest after adding each major branch
                rather than building the entire story first.
              </li>
              <li>
                <strong>Balance LLM Enhancement:</strong> Use enhancement for key dramatic moments,
                but write important plot points explicitly to maintain control.
              </li>
              <li>
                <strong>Device Timing:</strong> Add short delays before pump events to build
                anticipation. Don't activate devices immediately after choices.
              </li>
              <li>
                <strong>Variable Hygiene:</strong> Initialize important variables early. Check
                variable values before branching to avoid undefined behavior.
              </li>
              <li>
                <strong>Challenge Placement:</strong> Put challenges at story decision points
                where outcomes feel meaningful, not randomly.
              </li>
            </ul>

            <div className="warning-box">
              <p>
                <strong>Safety Reminder:</strong> When including Pump events that control real devices,
                always include appropriate stopping conditions and provide story paths that don't
                require device activation for players who need to stop.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ScreenplayTab;
