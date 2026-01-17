import React, { useState } from 'react';
import './HelpTabs.css';

function FlowTab() {
  const [expanded, setExpanded] = useState({
    overview: false,
    triggers: false,
    actions: false,
    logic: false,
    challenges: false,
    patterns: false,
    priority: false,
    flowSettings: false,
    screenplay: false,
    tips: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>Go With the Flow! (Internal Node Scripting Engine)</h2>

      {/* Overview */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('overview')}>
          What Are Flows?
          <span className="expand-icon">{expanded.overview ? '−' : '+'}</span>
        </h3>
        {expanded.overview && (
          <div className="section-content">
            <p>
              Flows are a visual automation system that lets you create event-driven behaviors.
              Connect nodes together to define what happens when certain events occur.
            </p>
            <p>
              Each flow starts with a <strong>Trigger Node</strong> that defines when the flow
              activates, followed by <strong>Action Nodes</strong> that define what happens.
              Use <strong>Condition</strong> and <strong>Branch</strong> nodes to add logic.
            </p>
            <p>
              Flows can be assigned to specific characters (only active when chatting with them),
              or run globally across all conversations.
            </p>
          </div>
        )}
      </div>

      {/* Trigger Nodes */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('triggers')}>
          Trigger Nodes
          <span className="expand-icon">{expanded.triggers ? '−' : '+'}</span>
        </h3>
        {expanded.triggers && (
          <div className="section-content">
            <p>
              <span className="node-type trigger">Trigger</span> nodes are entry points that start a flow when conditions are met.
            </p>
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
                  <td><strong>First Chat Message</strong></td>
                  <td>Fires on the first chat message of a session</td>
                  <td>-</td>
                </tr>
                <tr>
                  <td><strong>New Session</strong></td>
                  <td>Fires at the start of each new session</td>
                  <td>-</td>
                </tr>
                <tr>
                  <td><strong>Player Speaks</strong></td>
                  <td>Fires when player message matches keywords</td>
                  <td>Keywords list with pattern matching</td>
                </tr>
                <tr>
                  <td><strong>AI Speaks</strong></td>
                  <td>Fires when AI message matches keywords</td>
                  <td>Keywords list with pattern matching</td>
                </tr>
                <tr>
                  <td><strong>Device Turns On</strong></td>
                  <td>Fires when a specific device turns on</td>
                  <td>Device selector</td>
                </tr>
                <tr>
                  <td><strong>Device Turns Off</strong></td>
                  <td>Fires when a specific device turns off</td>
                  <td>Device selector</td>
                </tr>
                <tr>
                  <td><strong>Timer</strong></td>
                  <td>Fires after a delay, optionally repeating</td>
                  <td>Delay (seconds), Repeat toggle</td>
                </tr>
                <tr>
                  <td><strong>Random</strong></td>
                  <td>Fires based on probability each tick</td>
                  <td>Probability (0-100%)</td>
                </tr>
                <tr>
                  <td><strong>Idle</strong></td>
                  <td>Fires after player inactivity threshold</td>
                  <td>Threshold (seconds)</td>
                </tr>
                <tr>
                  <td><strong>Player State Change</strong></td>
                  <td>Fires when persona state changes</td>
                  <td>State type (Capacity, Pain Level, Emotion), comparison operator, value</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Button Press Node</h4>
            <p>
              <span className="node-type button">Button</span> A special trigger linked to character buttons.
              When a character button with "Link to Flow" action is clicked, the connected flow executes.
              Configure buttons in the Character Editor under Custom Buttons tab.
            </p>
          </div>
        )}
      </div>

      {/* Action Nodes */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('actions')}>
          Action Nodes
          <span className="expand-icon">{expanded.actions ? '−' : '+'}</span>
        </h3>
        {expanded.actions && (
          <div className="section-content">
            <p>
              <span className="node-type action">Action</span> nodes perform operations when triggered.
            </p>

            <h4 className="subsection-header">Message Actions</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Send AI Message</strong></td>
                  <td>AI character speaks (LLM generates response)</td>
                  <td>Message prompt, Suppress LLM toggle</td>
                </tr>
                <tr>
                  <td><strong>Send Player Message</strong></td>
                  <td>Auto-generate a player message</td>
                  <td>Message prompt, Suppress LLM toggle</td>
                </tr>
                <tr>
                  <td><strong>System Message</strong></td>
                  <td>Display a system notification in chat</td>
                  <td>Message text</td>
                </tr>
                <tr>
                  <td><strong>Capacity AI Message</strong></td>
                  <td>AI message with content varying by capacity level</td>
                  <td>Multiple prompts for different capacity ranges</td>
                </tr>
                <tr>
                  <td><strong>Capacity Player Message</strong></td>
                  <td>Player message with content varying by capacity level</td>
                  <td>Multiple prompts for different capacity ranges</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Capacity-Based Messages:</strong> These special nodes let you define different
              message content for different capacity ranges (e.g., 0-25%, 26-50%, etc.). The node
              automatically selects the appropriate prompt based on current capacity when triggered.
            </div>

            <h4 className="subsection-header">Device Actions</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Turn Device On</strong></td>
                  <td>Turn on a device with optional stop condition</td>
                  <td>Device, Until condition (forever, capacity, time)</td>
                </tr>
                <tr>
                  <td><strong>Turn Device Off</strong></td>
                  <td>Turn off a device immediately</td>
                  <td>Device selector</td>
                </tr>
                <tr>
                  <td><strong>Start Cycle</strong></td>
                  <td>Start an on/off pump cycle pattern</td>
                  <td>Device, Duration, Interval, Cycle count, Until condition</td>
                </tr>
                <tr>
                  <td><strong>Stop Cycle</strong></td>
                  <td>Stop an active pump cycle</td>
                  <td>Device selector</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Variable & State Actions</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Description</th>
                  <th>Options</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Declare Variable</strong></td>
                  <td>Create a new custom flow variable</td>
                  <td>Variable name, Initial value</td>
                </tr>
                <tr>
                  <td><strong>Set Variable</strong></td>
                  <td>Update a system or flow variable</td>
                  <td>Variable type, Variable name, New value</td>
                </tr>
                <tr>
                  <td><strong>Toggle Reminder</strong></td>
                  <td>Enable, disable, or update a reminder</td>
                  <td>Reminder selector, Action (enable/disable/update), New text</td>
                </tr>
                <tr>
                  <td><strong>Toggle Button</strong></td>
                  <td>Enable or disable a character button</td>
                  <td>Button selector, Action (enable/disable)</td>
                </tr>
              </tbody>
            </table>

            <div className="tip-box">
              <p>
                <strong>Dual Outputs:</strong> <code>Turn Device On</code> and <code>Start Cycle</code> have
                two outputs: <em>Immediate</em> (fires right away) and <em>Completion</em> (fires when
                the "until" condition is met or cycle finishes).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Logic Nodes */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('logic')}>
          Logic & Control Nodes
          <span className="expand-icon">{expanded.logic ? '−' : '+'}</span>
        </h3>
        {expanded.logic && (
          <div className="section-content">
            <p>
              Logic nodes control flow execution based on conditions, timing, and player input.
            </p>

            <table className="help-table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Description</th>
                  <th>Outputs</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="node-type condition">Condition</span></td>
                  <td>Evaluates conditions and routes accordingly. Multiple conditions use AND logic. Compare capacity, pain level, emotion, or flow variables.</td>
                  <td>True / False</td>
                </tr>
                <tr>
                  <td><span className="node-type branch">Conditional Branch</span></td>
                  <td>Routes to different paths based on multiple conditions. First matching condition wins.</td>
                  <td>Multiple conditional outputs</td>
                </tr>
                <tr>
                  <td><span className="node-type branch">Random Branch</span></td>
                  <td>Randomly selects a path based on weighted percentages.</td>
                  <td>Multiple weighted outputs</td>
                </tr>
                <tr>
                  <td><span className="node-type delay">Delay</span></td>
                  <td>Pauses flow execution for a specified duration before continuing.</td>
                  <td>Single output after delay</td>
                </tr>
                <tr>
                  <td><span className="node-type choice">Player Choice</span></td>
                  <td>Shows a modal popup with multiple choices. Can include a prompt message and descriptions for each option.</td>
                  <td>One output per choice</td>
                </tr>
                <tr>
                  <td><span className="node-type choice">Simple A/B</span></td>
                  <td>Quick two-button popup for binary decisions. Silent (no chat message) - great for branching without output.</td>
                  <td>Option A / Option B</td>
                </tr>
                <tr>
                  <td><span className="node-type action">Input</span></td>
                  <td>Collects text or number input from the player via modal popup. Stores the value in a flow variable for later use.</td>
                  <td>Input type (text/number), variable name, prompt text, validation</td>
                </tr>
                <tr>
                  <td><span className="node-type action">Random Number</span></td>
                  <td>Generates a random integer within a range and stores it in a flow variable. Useful for randomized behavior.</td>
                  <td>Min/max values, variable name to store result</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <p>
                <strong>Condition Variables:</strong> You can check <code>[Capacity]</code> (0-100),
                <code>[Feeling]</code> (pain level 0-10), <code>[Emotion]</code> (emoji state),
                or any <code>[Flow:varName]</code> custom variable.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Challenge Nodes */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('challenges')}>
          Challenge Nodes (Interactive Games)
          <span className="expand-icon">{expanded.challenges ? '−' : '+'}</span>
        </h3>
        {expanded.challenges && (
          <div className="section-content">
            <p>
              Challenge nodes are interactive game elements that pause flow execution until the player
              completes a mini-game. Each has a <strong>Win</strong> and <strong>Lose</strong> output
              for branching based on the result.
            </p>

            <table className="help-table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Description</th>
                  <th>Configuration</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="node-type challenge">Prize Wheel</span></td>
                  <td>Spin a wheel with customizable segments. Each segment can have different weights.</td>
                  <td>Segment labels, weights, win/lose designation per segment</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Dice Roll</span></td>
                  <td>Roll dice and compare total to a target number.</td>
                  <td>Number of dice, target number, comparison (over/under/exact)</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Coin Flip</span></td>
                  <td>Simple 50/50 coin toss with heads or tails.</td>
                  <td>Win condition (heads/tails)</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Rock Paper Scissors</span></td>
                  <td>Play RPS against the AI. Best of 1, 3, or 5 rounds.</td>
                  <td>Number of rounds</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Timer Challenge</span></td>
                  <td>Press a button before time runs out. Creates tension and urgency.</td>
                  <td>Time limit (seconds), button label</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Number Guess</span></td>
                  <td>Guess a number within a range. Configurable attempts and hints.</td>
                  <td>Min/max range, number of attempts, show hints toggle</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Slot Machine</span></td>
                  <td>Spin 3 reels with symbols. Match patterns to win.</td>
                  <td>Symbols list, win patterns (3 match, 2 match, specific combos)</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Card Draw</span></td>
                  <td>Draw a card from a deck. Configure winning suits/values.</td>
                  <td>Win conditions (specific suits, value ranges, face cards)</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Simon Challenge</span></td>
                  <td>Memory game - repeat an increasingly long sequence of colored buttons.</td>
                  <td>Starting length, max length, max misses, penalty/reward devices</td>
                </tr>
                <tr>
                  <td><span className="node-type challenge">Reflex Challenge</span></td>
                  <td>Click targets as they appear before time runs out. Tests reaction speed.</td>
                  <td>Time per target, number of rounds, target size, penalty/reward devices</td>
                </tr>
              </tbody>
            </table>

            <div className="tip-box">
              <p>
                <strong>Game Flow:</strong> When a challenge node executes, a modal appears for the player.
                The flow pauses until the game completes, then continues down the Win or Lose path based on the result.
              </p>
            </div>

            <h4 className="subsection-header">Example Use Cases</h4>
            <ul className="help-list">
              <li><strong>Gambling scenarios:</strong> Use Dice Roll or Card Draw where losing increases intensity</li>
              <li><strong>Timed pressure:</strong> Timer Challenge to add urgency - fail to stop in time and consequences occur</li>
              <li><strong>Random rewards:</strong> Prize Wheel with different outcomes (device actions, messages, etc.)</li>
              <li><strong>Competitive play:</strong> Rock Paper Scissors against the character for stakes</li>
            </ul>
          </div>
        )}
      </div>

      {/* Pattern Matching */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('patterns')}>
          Pattern Matching
          <span className="expand-icon">{expanded.patterns ? '−' : '+'}</span>
        </h3>
        {expanded.patterns && (
          <div className="section-content">
            <p>
              Trigger nodes like <code>player_speaks</code> and <code>ai_speaks</code> use
              pattern matching to detect specific text.
            </p>

            <h4 className="subsection-header">Wildcards</h4>
            <p>
              Use <code>*</code> to match any text (including nothing).
            </p>
            <div className="code-example">
              *hello* - matches "hello", "say hello", "hello there"<br />
              start* - matches "start", "starting", "start the pump"
            </div>

            <h4 className="subsection-header">Alternatives</h4>
            <p>
              Use <code>[option1/option2/option3]</code> to match any of the listed words.
            </p>
            <div className="code-example">
              *[pump/inflate/fill]* - matches "turn on the pump", "inflate me", "fill it up"
            </div>

            <h4 className="subsection-header">Combined Example</h4>
            <div className="code-example">
              *start*[pump/inflation/filling]* <br />
              Matches: "let's start the pump", "start inflation now", "please start filling"
            </div>
          </div>
        )}
      </div>

      {/* Flow Priority */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('priority')}>
          Flow Priority
          <span className="expand-icon">{expanded.priority ? '−' : '+'}</span>
        </h3>
        {expanded.priority && (
          <div className="section-content">
            <p>
              Each flow has a configurable priority level (1-5) that determines execution order
              when multiple flows trigger on the same event. Lower numbers execute first.
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Suggested Use</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>1</strong> (Highest)</td>
                  <td>Critical / Safety</td>
                  <td>Emergency responses, safety checks - always run first</td>
                </tr>
                <tr>
                  <td><strong>2</strong></td>
                  <td>High Priority</td>
                  <td>Important game mechanics, core interactions</td>
                </tr>
                <tr>
                  <td><strong>3</strong></td>
                  <td>Normal (Default)</td>
                  <td>Standard flows, typical automation</td>
                </tr>
                <tr>
                  <td><strong>4</strong></td>
                  <td>Low Priority</td>
                  <td>Background effects, ambient responses</td>
                </tr>
                <tr>
                  <td><strong>5</strong> (Lowest)</td>
                  <td>Fallback</td>
                  <td>Catch-all behaviors, defaults when nothing else fires</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Flow Scope</h4>
            <p>In addition to priority, flows have a scope that determines when they're active:</p>
            <ul className="help-list">
              <li><strong>Global Flows</strong> - Always active regardless of which character is selected</li>
              <li><strong>Character Flows</strong> - Only active when chatting with the assigned character</li>
              <li><strong>Persona Flows</strong> - Only active when using the assigned persona</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> Set priority in the flow editor's settings panel. Flows with the
              same priority execute in the order they were created.
            </div>
          </div>
        )}
      </div>

      {/* Flow Settings */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('flowSettings')}>
          Flow Settings (Unblockable & Notifications)
          <span className="expand-icon">{expanded.flowSettings ? '−' : '+'}</span>
        </h3>
        {expanded.flowSettings && (
          <div className="section-content">
            <p>
              Each flow has additional settings that control its behavior during execution.
            </p>

            <h4 className="subsection-header">Unblockable Flows</h4>
            <p>
              When a flow is marked as <strong>Unblockable</strong>, it cannot be interrupted by
              other flows or user actions (except E-STOP). Use this for critical sequences that
              must complete.
            </p>
            <ul className="help-list">
              <li>Other flows wait until the unblockable flow completes</li>
              <li>User input during execution is queued, not ignored</li>
              <li>E-STOP always works, even during unblockable flows</li>
            </ul>

            <div className="warning-box">
              <strong>Use Sparingly:</strong> Unblockable flows can lock up the interface if they
              contain long delays or complex sequences. Reserve them for genuinely critical automation.
            </div>

            <h4 className="subsection-header">Selective Notifications</h4>
            <p>
              By default, flows display system notifications when they trigger. You can disable
              notifications per-flow to create silent automation:
            </p>
            <ul className="help-list">
              <li><strong>Notifications On</strong> - Shows "Flow triggered: [name]" in chat</li>
              <li><strong>Notifications Off</strong> - Flow runs silently, no system message</li>
            </ul>
            <p>
              Silent flows are useful for background automation that shouldn't interrupt the
              roleplay narrative, such as ambient device control or hidden state tracking.
            </p>
          </div>
        )}
      </div>

      {/* ScreenPlay */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('screenplay')}>
          ScreenPlay Page
          <span className="expand-icon">{expanded.screenplay ? '−' : '+'}</span>
        </h3>
        {expanded.screenplay && (
          <div className="section-content">
            <p>
              The <strong>ScreenPlay</strong> page (found under Automation in the menu) displays
              content generated by flows in a dedicated view, separate from the main chat.
            </p>

            <h4 className="subsection-header">Use Cases</h4>
            <ul className="help-list">
              <li><strong>Story Scripts</strong> - View narrative content generated by AI message nodes</li>
              <li><strong>Game Logs</strong> - Track flow-generated events and outcomes</li>
              <li><strong>Debug View</strong> - Monitor what your flows are producing</li>
            </ul>

            <h4 className="subsection-header">How to Send Content to ScreenPlay</h4>
            <p>
              Use the <strong>Send to ScreenPlay</strong> action node in your flows. Any text
              sent to ScreenPlay appears in the dedicated viewer without affecting the main chat.
            </p>

            <div className="info-box">
              <strong>Note:</strong> ScreenPlay content persists until cleared. You can review
              the full history of flow-generated content during a session.
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
                <strong>Fire Only Once:</strong> Enable this on triggers that should only
                activate once per session (like first_message or one-time events).
              </li>
              <li>
                <strong>Dual Outputs:</strong> Remember that <code>device_on</code> and
                <code>start_cycle</code> have two outputs - use Immediate for actions
                that should happen right away, Completion for after the device stops.
              </li>
              <li>
                <strong>Until Conditions:</strong> Use "until" on device actions to
                automatically stop when a condition is met (e.g., capacity reaches 80).
              </li>
              <li>
                <strong>Test in Simulation:</strong> Always test new flows in Simulation
                Mode first to verify behavior without affecting real hardware.
              </li>
              <li>
                <strong>Use Variables:</strong> Track state with custom variables to create
                more complex, multi-stage flows and story progression.
              </li>
              <li>
                <strong>Delays for Pacing:</strong> Add Delay nodes between actions for
                more natural pacing and dramatic effect.
              </li>
            </ul>

            <div className="warning-box">
              <p>
                <strong>Safety Reminder:</strong> When creating flows that control devices,
                always include appropriate stopping conditions and never rely solely on
                software for safety. Have a hardware disconnect within reach.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FlowTab;
