import React, { useState } from 'react';
import './HelpTabs.css';

function SystemTab() {
  const [expanded, setExpanded] = useState({
    variables: false,
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
      <h2>Variables and Persistent States</h2>

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

      {/* Pain Level */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('feelings')}>
          Pain Level (Wong-Baker Scale)
          <span className="expand-icon">{expanded.feelings ? '−' : '+'}</span>
        </h3>
        {expanded.feelings && (
          <div className="section-content">
            <p>
              The <span className="variable-tag">[Feeling]</span> variable reflects physical sensation
              using the Wong-Baker FACES Pain Rating Scale (0-10). Click the pain badge in the persona
              column to select your current level.
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Face</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>0</td><td>😊</td><td>No hurt</td></tr>
                <tr><td>1</td><td>🙂</td><td>Hurts a tiny bit</td></tr>
                <tr><td>2</td><td>😐</td><td>Hurts a little bit</td></tr>
                <tr><td>3</td><td>😕</td><td>Hurts a little more</td></tr>
                <tr><td>4</td><td>😟</td><td>Hurts even more</td></tr>
                <tr><td>5</td><td>😣</td><td>Hurts a medium amount</td></tr>
                <tr><td>6</td><td>😫</td><td>Hurts a lot</td></tr>
                <tr><td>7</td><td>😖</td><td>Hurts a whole lot</td></tr>
                <tr><td>8</td><td>😭</td><td>Hurts really bad</td></tr>
                <tr><td>9</td><td>🤮</td><td>Hurts terribly</td></tr>
                <tr><td>10</td><td>😵</td><td>Hurts worst possible</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 'var(--spacing-md)' }}>
              The AI uses this value to understand your persona's current physical state and respond appropriately.
            </p>
          </div>
        )}
      </div>

      {/* Emotion States */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('emotions')}>
          Emotion States (Emoji Selector)
          <span className="expand-icon">{expanded.emotions ? '−' : '+'}</span>
        </h3>
        {expanded.emotions && (
          <div className="section-content">
            <p>
              The <span className="variable-tag">[Emotion]</span> variable represents your persona's
              current emotional state. Click the emotion badge in the persona column to select from
              20 available emotions:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Emoji</th>
                  <th>Emotion</th>
                  <th>Emoji</th>
                  <th>Emotion</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>😐</td><td>Neutral</td><td>😊</td><td>Happy</td></tr>
                <tr><td>🤩</td><td>Excited</td><td>😏</td><td>Aroused</td></tr>
                <tr><td>🔥</td><td>Horny</td><td>🥰</td><td>Loving</td></tr>
                <tr><td>😳</td><td>Submissive</td><td>😈</td><td>Dominant</td></tr>
                <tr><td>🫣</td><td>Shy</td><td>🥲</td><td>Embarrassed</td></tr>
                <tr><td>😕</td><td>Confused</td><td>🤔</td><td>Curious</td></tr>
                <tr><td>😨</td><td>Frightened</td><td>😰</td><td>Anxious</td></tr>
                <tr><td>😢</td><td>Sad</td><td>😠</td><td>Angry</td></tr>
                <tr><td>🥴</td><td>Drunk</td><td>😵</td><td>Dazed</td></tr>
                <tr><td>😮‍💨</td><td>Exhausted</td><td>😍</td><td>Blissful</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 'var(--spacing-md)' }}>
              Emotions can also be set via Flow actions, allowing dynamic story progression
              and letting the AI respond appropriately to your persona's emotional context.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default SystemTab;
