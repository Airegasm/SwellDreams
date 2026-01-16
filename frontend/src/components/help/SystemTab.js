import React, { useState } from 'react';
import './HelpTabs.css';

function SystemTab() {
  const [expanded, setExpanded] = useState({
    variables: false,
    flowvars: false,
    whereused: false,
    feelings: false,
    emotions: false,
    charcontrols: false,
    autocapacity: false
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

      {/* Global Character Controls */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('charcontrols')}>
          Global Character Controls
          <span className="expand-icon">{expanded.charcontrols ? '−' : '+'}</span>
        </h3>
        {expanded.charcontrols && (
          <div className="section-content">
            <p>
              Global Character Controls in Settings → Global allow automatic linking between
              capacity, pain, and emotion states. These create dynamic responses as your
              session progresses.
            </p>

            <h4 className="subsection-header">Auto-Link Capacity to Pain Scale</h4>
            <p>
              When enabled (default), the Pain Level automatically updates based on Capacity:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Capacity Range</th>
                  <th>Pain Level</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>0-10%</td><td>0 (No hurt)</td></tr>
                <tr><td>11-20%</td><td>1 (Hurts a tiny bit)</td></tr>
                <tr><td>21-30%</td><td>2 (Hurts a little bit)</td></tr>
                <tr><td>31-40%</td><td>3 (Hurts a little more)</td></tr>
                <tr><td>41-50%</td><td>4 (Hurts even more)</td></tr>
                <tr><td>51-60%</td><td>5 (Hurts a medium amount)</td></tr>
                <tr><td>61-70%</td><td>6 (Hurts a lot)</td></tr>
                <tr><td>71-80%</td><td>7 (Hurts a whole lot)</td></tr>
                <tr><td>81-90%</td><td>8 (Hurts really bad)</td></tr>
                <tr><td>91-100%</td><td>9-10 (Hurts worst possible)</td></tr>
              </tbody>
            </table>

            <h4 className="subsection-header">Emotional Decline</h4>
            <p>
              When enabled (default), emotions automatically shift as capacity increases,
              simulating the psychological effects of intense physical sensations:
            </p>
            <ul className="help-list">
              <li><strong>Below 75% capacity:</strong> Emotion remains under player control</li>
              <li><strong>At 75%+ capacity:</strong> Emotion locks to "Frightened" (😨)</li>
            </ul>
            <p>
              This creates realistic character reactions - as fullness increases, the persona
              naturally becomes more overwhelmed regardless of the starting emotional state.
            </p>

            <div className="tip-box">
              <p>
                <strong>Tip:</strong> Both features can be toggled independently in Settings → Global
                under "Global Character Controls". Disable them for full manual control over pain and emotion.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Auto-Capacity System */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('autocapacity')}>
          Auto-Capacity System
          <span className="expand-icon">{expanded.autocapacity ? '−' : '+'}</span>
        </h3>
        {expanded.autocapacity && (
          <div className="section-content">
            <p>
              The Auto-Capacity System automatically updates the capacity gauge based on actual pump
              runtime, creating realistic progression without manual adjustment.
            </p>

            <h4 className="subsection-header">How It Works</h4>
            <p>
              When a pump device is running, the system tracks elapsed time and increments the
              capacity gauge proportionally. This creates a direct link between device activity
              and the <code>[Capacity]</code> variable used in flows and AI prompts.
            </p>

            <h4 className="subsection-header">Pump Calibration</h4>
            <p>
              Before using auto-capacity, calibrate your pump to establish how long it takes to
              reach certain capacity levels:
            </p>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Devices</strong></li>
              <li>Select your pump device</li>
              <li>Click <strong>Calibrate</strong></li>
              <li>Run the pump and mark capacity checkpoints (e.g., 25%, 50%, 75%, 100%)</li>
              <li>The system records the time at each checkpoint</li>
              <li>Save the calibration</li>
            </ol>

            <h4 className="subsection-header">Calibration Data</h4>
            <p>
              Calibration data is stored per-device in <code>backend/data/calibrations.json</code>.
              Each device can have its own calibration profile, useful if you have pumps with
              different flow rates.
            </p>

            <h4 className="subsection-header">Auto-Capacity Multiplier</h4>
            <p>
              Fine-tune the auto-increment rate with the multiplier setting:
            </p>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Multiplier</th>
                  <th>Effect</th>
                  <th>Use Case</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>0.5x</strong></td>
                  <td>Half speed</td>
                  <td>Longer sessions, slower buildup</td>
                </tr>
                <tr>
                  <td><strong>1.0x</strong></td>
                  <td>Calibrated rate</td>
                  <td>Matches your calibration exactly</td>
                </tr>
                <tr>
                  <td><strong>1.5x</strong></td>
                  <td>50% faster</td>
                  <td>Quicker progression</td>
                </tr>
                <tr>
                  <td><strong>2.0x</strong></td>
                  <td>Double speed</td>
                  <td>Rapid sessions, testing</td>
                </tr>
              </tbody>
            </table>

            <div className="tip-box">
              <strong>Tip:</strong> The multiplier can be adjusted in Settings → Global under
              "Auto-Capacity Settings". You can also modify it mid-session to speed up or slow down progression.
            </div>

            <h4 className="subsection-header">Enabling Auto-Capacity</h4>
            <ol className="help-list numbered">
              <li>Calibrate your pump device (see above)</li>
              <li>Go to <strong>Settings → Global</strong></li>
              <li>Enable <strong>Auto-Capacity</strong></li>
              <li>Optionally adjust the multiplier</li>
              <li>The capacity gauge will now auto-increment when the pump runs</li>
            </ol>

            <div className="warning-box">
              <strong>Important:</strong> Auto-capacity only tracks forward progression. It does not
              automatically decrease capacity when pumps are off. You can manually decrease capacity
              using keyboard shortcuts or set it via flows.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SystemTab;
