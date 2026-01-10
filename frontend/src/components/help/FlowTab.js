import React, { useState } from 'react';
import './HelpTabs.css';

function FlowTab() {
  const [expanded, setExpanded] = useState({
    overview: true,
    triggers: false,
    actions: false,
    logic: false,
    patterns: false,
    priority: false,
    tips: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>Flow System</h2>

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
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>first_message</strong></td>
                  <td>Fires on the first chat message of a session</td>
                </tr>
                <tr>
                  <td><strong>player_speaks</strong></td>
                  <td>Fires when player message matches a pattern</td>
                </tr>
                <tr>
                  <td><strong>ai_speaks</strong></td>
                  <td>Fires when AI message matches a pattern</td>
                </tr>
                <tr>
                  <td><strong>device_on</strong></td>
                  <td>Fires when a device turns on</td>
                </tr>
                <tr>
                  <td><strong>device_off</strong></td>
                  <td>Fires when a device turns off</td>
                </tr>
                <tr>
                  <td><strong>timer</strong></td>
                  <td>Fires after a delay, optionally repeating</td>
                </tr>
                <tr>
                  <td><strong>random</strong></td>
                  <td>Fires based on probability (0-100%)</td>
                </tr>
                <tr>
                  <td><strong>idle</strong></td>
                  <td>Fires after player inactivity threshold</td>
                </tr>
                <tr>
                  <td><strong>new_session</strong></td>
                  <td>Fires at the start of each session</td>
                </tr>
                <tr>
                  <td><strong>player_state_change</strong></td>
                  <td>Fires when capacity, feeling, or emotion changes</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Button Press Node</h4>
            <p>
              <span className="node-type button">Button</span> A special trigger that creates a clickable
              button in the chat UI. When clicked, the connected flow executes.
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
            <table className="help-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>send_message</strong></td>
                  <td>AI character speaks the specified text</td>
                </tr>
                <tr>
                  <td><strong>send_player_message</strong></td>
                  <td>Player automatically says the specified text</td>
                </tr>
                <tr>
                  <td><strong>system_message</strong></td>
                  <td>Display a system notification in chat</td>
                </tr>
                <tr>
                  <td><strong>device_on</strong></td>
                  <td>Turn on a device with optional settings</td>
                </tr>
                <tr>
                  <td><strong>device_off</strong></td>
                  <td>Turn off a device</td>
                </tr>
                <tr>
                  <td><strong>start_cycle</strong></td>
                  <td>Start a pump cycle with on/off timing</td>
                </tr>
                <tr>
                  <td><strong>stop_cycle</strong></td>
                  <td>Stop an active pump cycle</td>
                </tr>
                <tr>
                  <td><strong>declare_variable</strong></td>
                  <td>Create a new custom flow variable</td>
                </tr>
                <tr>
                  <td><strong>set_variable</strong></td>
                  <td>Update a variable's value</td>
                </tr>
                <tr>
                  <td><strong>toggle_reminder</strong></td>
                  <td>Enable or disable a reminder</td>
                </tr>
              </tbody>
            </table>

            <div className="tip-box">
              <p>
                <strong>Note:</strong> <code>device_on</code> and <code>start_cycle</code> actions have
                two outputs: <em>Immediate</em> (fires right away) and <em>Completion</em> (fires when
                the action finishes, e.g., "until" condition met).
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
            <h4 className="subsection-header">
              <span className="node-type condition">Condition</span> Condition Node
            </h4>
            <p>
              Evaluates one or more conditions and routes to True or False outputs.
              Multiple conditions use AND logic (all must be true).
            </p>
            <ul className="help-list">
              <li>Compare variables to values</li>
              <li>Check capacity, feeling, emotion states</li>
              <li>Test custom flow variables</li>
            </ul>

            <h4 className="subsection-header">
              <span className="node-type branch">Branch</span> Branch Node
            </h4>
            <p>
              Splits flow into multiple paths. Can be configured for:
            </p>
            <ul className="help-list">
              <li><strong>Weighted Random:</strong> Each path has a percentage chance</li>
              <li><strong>Sequential:</strong> Cycles through paths in order</li>
            </ul>

            <h4 className="subsection-header">
              <span className="node-type delay">Delay</span> Delay Node
            </h4>
            <p>
              Pauses flow execution for a specified time (seconds or minutes)
              before continuing to the next node.
            </p>

            <h4 className="subsection-header">
              <span className="node-type choice">Choice</span> Player Choice Node
            </h4>
            <p>
              Shows a modal popup with multiple choices. Optionally displays a
              character message first. Each choice connects to its own output path.
            </p>

            <h4 className="subsection-header">
              <span className="node-type choice">A/B</span> Simple A/B Node
            </h4>
            <p>
              Shows a two-button popup for quick binary choices. Silent choice
              (no message generated) - useful for branching without chat output.
            </p>
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
              When multiple flows could trigger on the same event, priority determines
              which executes first:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>0</strong> (Highest)</td>
                  <td>Global Flows</td>
                  <td>Always active, execute first</td>
                </tr>
                <tr>
                  <td><strong>1</strong></td>
                  <td>Character Flows</td>
                  <td>Only active for assigned character</td>
                </tr>
                <tr>
                  <td><strong>2</strong> (Lowest)</td>
                  <td>Persona Flows</td>
                  <td>Player-specific flows</td>
                </tr>
              </tbody>
            </table>
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
