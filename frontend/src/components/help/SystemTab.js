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
    autocapacity: false,
    remoteAccess: false,
    llmDeviceControl: false
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
                  <td><span className="variable-tag">[Gender]</span></td>
                  <td>Context-aware pronoun based on Persona gender (he/him/his, she/her/hers, they/them/their)</td>
                  <td>he, she, they</td>
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

            <h4 className="subsection-header">[Gender] Variable - Smart Pronoun System</h4>
            <p>
              The <span className="variable-tag">[Gender]</span> variable automatically resolves to the correct pronoun
              based on your persona's gender setting and the grammatical context. This makes writing character content
              much easier since you don't need separate versions for different pronouns.
            </p>

            <table className="help-table">
              <thead>
                <tr>
                  <th>Persona Gender</th>
                  <th>Subject Form</th>
                  <th>Object Form</th>
                  <th>Possessive Form</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>he/him</strong></td>
                  <td>he</td>
                  <td>him</td>
                  <td>his</td>
                </tr>
                <tr>
                  <td><strong>she/her</strong></td>
                  <td>she</td>
                  <td>her</td>
                  <td>hers</td>
                </tr>
                <tr>
                  <td><strong>they/them</strong></td>
                  <td>they</td>
                  <td>them</td>
                  <td>their</td>
                </tr>
              </tbody>
            </table>

            <div className="code-example">
              <strong>Example Usage:</strong><br/>
              "I can see [Gender] is nervous" → "I can see <em>he</em> is nervous" (for he/him persona)<br/>
              "Tell [Gender] to relax" → "Tell <em>her</em> to relax" (for she/her persona)<br/>
              "That belongs to [Gender]" → "That belongs to <em>them</em>" (for they/them persona)
            </div>

            <div className="info-box">
              <strong>💡 Best Practice:</strong> Use [Gender] in character descriptions, example dialogues, scenarios, and
              welcome messages. The AI automatically uses the correct form based on context, making your characters
              work seamlessly with any persona gender.
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

      {/* Remote Access */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('remoteAccess')}>
          Remote Access & IP Whitelist
          <span className="expand-icon">{expanded.remoteAccess ? '−' : '+'}</span>
        </h3>
        {expanded.remoteAccess && (
          <div className="section-content">
            <p>
              Access SwellDreams from other devices (like a phone or tablet) on your network
              or through Tailscale VPN. Useful for controlling sessions from a mobile device.
            </p>

            <h4 className="subsection-header">Enabling Remote Access</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Global</strong></li>
              <li>Find the <strong>Remote Access</strong> section</li>
              <li>Enable <strong>Allow Remote Connections</strong></li>
              <li>Add IP addresses to the whitelist</li>
            </ol>

            <h4 className="subsection-header">IP Whitelist</h4>
            <p>
              For security, only whitelisted IP addresses can connect remotely. You must add
              each device's IP address to the whitelist before it can access the application.
            </p>
            <ul className="help-list">
              <li><strong>Local Network:</strong> Add your phone/tablet's local IP (e.g., 192.168.1.x)</li>
              <li><strong>Tailscale:</strong> Add your device's Tailscale IP (e.g., 100.x.x.x)</li>
              <li><strong>Auto-Add:</strong> When accessing from a local machine, use the "Add Current IP" button</li>
            </ul>

            <h4 className="subsection-header">Finding Your Device's IP</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>How to Find IP</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>iPhone/iPad</strong></td>
                  <td>Settings → Wi-Fi → tap the (i) next to your network</td>
                </tr>
                <tr>
                  <td><strong>Android</strong></td>
                  <td>Settings → Network → Wi-Fi → tap your network</td>
                </tr>
                <tr>
                  <td><strong>Tailscale</strong></td>
                  <td>Open Tailscale app → your IP is shown at the top</td>
                </tr>
              </tbody>
            </table>

            <div className="warning-box">
              <strong>Security Note:</strong> Only add IPs you trust. Anyone with a whitelisted IP
              can access your SwellDreams instance and control connected devices.
            </div>

            <h4 className="subsection-header">Connecting from Mobile</h4>
            <ol className="help-list numbered">
              <li>Ensure remote access is enabled and your device IP is whitelisted</li>
              <li>Open a browser on your mobile device</li>
              <li>Navigate to <code>http://[server-ip]:3001</code></li>
              <li>The interface is optimized for mobile with touch-friendly controls</li>
            </ol>
          </div>
        )}
      </div>

      {/* LLM Direct Device Control */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('llmDeviceControl')}>
          LLM Direct Device Control
          <span className="expand-icon">{expanded.llmDeviceControl ? '−' : '+'}</span>
        </h3>
        {expanded.llmDeviceControl && (
          <div className="section-content">
            <p>
              When enabled, the AI character can directly control devices by including special
              command tags in their responses. Commands are automatically executed and stripped
              from the displayed message.
            </p>

            <h4 className="subsection-header">Available Commands</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>[pump on]</code></td>
                  <td>Turns on the primary pump device</td>
                </tr>
                <tr>
                  <td><code>[pump off]</code></td>
                  <td>Turns off the primary pump device</td>
                </tr>
                <tr>
                  <td><code>[vibe on]</code></td>
                  <td>Turns on the vibrator device</td>
                </tr>
                <tr>
                  <td><code>[vibe off]</code></td>
                  <td>Turns off the vibrator device</td>
                </tr>
                <tr>
                  <td><code>[tens on]</code></td>
                  <td>Turns on the TENS device</td>
                </tr>
                <tr>
                  <td><code>[tens off]</code></td>
                  <td>Turns off the TENS device</td>
                </tr>
              </tbody>
            </table>

            <h4 className="subsection-header">How It Works</h4>
            <ul className="help-list">
              <li>The AI includes commands naturally in its roleplay responses</li>
              <li>Commands are parsed out before displaying the message</li>
              <li>The corresponding device action executes automatically</li>
              <li>If no matching device is configured, the command is ignored</li>
            </ul>

            <h4 className="subsection-header">Enabling LLM Device Control</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Global</strong></li>
              <li>Find <strong>LLM Direct Device Control</strong></li>
              <li>Enable the toggle</li>
              <li>Configure your devices in <strong>Settings → Devices</strong></li>
            </ol>

            <div className="info-box">
              <strong>Character Prompting:</strong> For best results, include instructions in your
              character's personality or reminders like: "You can control the pump using [pump on]
              and [pump off] commands in your responses."
            </div>

            <div className="warning-box">
              <strong>Safety:</strong> The AI controls devices based on its interpretation of the
              roleplay. Always have a hardware disconnect within reach. The E-STOP button stops
              all device activity regardless of what the AI is doing.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SystemTab;
