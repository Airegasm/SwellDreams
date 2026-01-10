import React, { useState } from 'react';
import './HelpTabs.css';

function SystemTab() {
  const [expanded, setExpanded] = useState({
    variables: true,
    flowvars: false,
    whereused: false,
    feelings: false,
    emotions: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>System Variables</h2>

      {/* Built-in Variables */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('variables')}>
          Built-in Variables
          <span className="expand-icon">{expanded.variables ? '−' : '+'}</span>
        </h3>
        {expanded.variables && (
          <div className="section-content">
            <p>
              System variables are placeholders that get replaced with dynamic values at runtime.
              Use them in prompts, messages, reminders, and flow nodes.
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Description</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="variable-tag">[Player]</span></td>
                  <td>Player's display name from Persona</td>
                  <td>Alex</td>
                </tr>
                <tr>
                  <td><span className="variable-tag">[Char]</span></td>
                  <td>Active character's name</td>
                  <td>Dr. Elena</td>
                </tr>
                <tr>
                  <td><span className="variable-tag">[Capacity]</span></td>
                  <td>Current physical capacity (0-100)</td>
                  <td>45</td>
                </tr>
                <tr>
                  <td><span className="variable-tag">[Feeling]</span></td>
                  <td>Current physical sensation state</td>
                  <td>stretched</td>
                </tr>
                <tr>
                  <td><span className="variable-tag">[Emotion]</span></td>
                  <td>Current emotional state</td>
                  <td>nervous</td>
                </tr>
              </tbody>
            </table>

            <div className="tip-box">
              <p>
                <strong>Tip:</strong> Variables are case-sensitive. Use exactly as shown: <span className="variable-tag">[Player]</span> not [player] or [PLAYER].
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Custom Flow Variables */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('flowvars')}>
          Custom Flow Variables
          <span className="expand-icon">{expanded.flowvars ? '−' : '+'}</span>
        </h3>
        {expanded.flowvars && (
          <div className="section-content">
            <p>
              Create your own variables using the Flow system. Custom variables persist throughout
              a session and can be used to track state, counts, or any custom data.
            </p>

            <h4 className="subsection-header">Syntax</h4>
            <p>
              Custom flow variables use the format: <span className="variable-tag">[Flow:variableName]</span>
            </p>

            <h4 className="subsection-header">Creating Variables</h4>
            <p>
              Use an <strong>Action Node</strong> with type <code>declare_variable</code> to create a new variable.
              Specify the variable name and initial value.
            </p>

            <h4 className="subsection-header">Setting Values</h4>
            <p>
              Use an <strong>Action Node</strong> with type <code>set_variable</code> to update a variable's value.
              You can set it to a specific value or perform math operations.
            </p>

            <h4 className="subsection-header">Examples</h4>
            <div className="code-example">
              [Flow:visitCount] - Track how many times something occurred<br />
              [Flow:questPhase] - Track story progression<br />
              [Flow:intensity] - Store a numeric value for device control<br />
              [Flow:playerChoice] - Remember a player's decision
            </div>
          </div>
        )}
      </div>

      {/* Where Variables Work */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('whereused')}>
          Where Variables Work
          <span className="expand-icon">{expanded.whereused ? '−' : '+'}</span>
        </h3>
        {expanded.whereused && (
          <div className="section-content">
            <p>Variables are substituted in the following locations:</p>
            <ul className="help-list">
              <li><strong>Chat Messages</strong> - In AI prompts and generated responses</li>
              <li><strong>Global Reminders</strong> - Persistent context reminders</li>
              <li><strong>Character Reminders</strong> - Character-specific reminders</li>
              <li><strong>Flow Node Text</strong> - Message content, conditions, etc.</li>
              <li><strong>Device Until Conditions</strong> - Stop conditions for device actions</li>
            </ul>
          </div>
        )}
      </div>

      {/* Feeling States */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('feelings')}>
          Feeling States
          <span className="expand-icon">{expanded.feelings ? '−' : '+'}</span>
        </h3>
        {expanded.feelings && (
          <div className="section-content">
            <p>
              The <span className="variable-tag">[Feeling]</span> variable reflects physical sensation
              and changes based on capacity level:
            </p>
            <div style={{ marginTop: 'var(--spacing-sm)' }}>
              <span className="state-tag">normal</span>
              <span className="state-tag">slightly tight</span>
              <span className="state-tag">comfortably full</span>
              <span className="state-tag">stretched</span>
              <span className="state-tag">very tight</span>
              <span className="state-tag">painfully tight</span>
            </div>
            <p style={{ marginTop: 'var(--spacing-md)' }}>
              These states progress naturally as capacity increases, providing context for AI responses.
            </p>
          </div>
        )}
      </div>

      {/* Emotion States */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('emotions')}>
          Emotion States
          <span className="expand-icon">{expanded.emotions ? '−' : '+'}</span>
        </h3>
        {expanded.emotions && (
          <div className="section-content">
            <p>
              The <span className="variable-tag">[Emotion]</span> variable represents the player's
              current emotional state. Available emotions:
            </p>
            <div style={{ marginTop: 'var(--spacing-sm)' }}>
              <span className="state-tag">neutral</span>
              <span className="state-tag">nervous</span>
              <span className="state-tag">anxious</span>
              <span className="state-tag">scared</span>
              <span className="state-tag">curious</span>
              <span className="state-tag">excited</span>
              <span className="state-tag">aroused</span>
              <span className="state-tag">embarrassed</span>
              <span className="state-tag">humiliated</span>
              <span className="state-tag">resigned</span>
              <span className="state-tag">defiant</span>
              <span className="state-tag">submissive</span>
              <span className="state-tag">blissful</span>
              <span className="state-tag">overwhelmed</span>
            </div>
            <p style={{ marginTop: 'var(--spacing-md)' }}>
              Emotions can be set via Flow actions or change based on game events, allowing
              the AI to respond appropriately to the player's emotional context.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SystemTab;
