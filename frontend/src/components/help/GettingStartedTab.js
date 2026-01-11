import React, { useState } from 'react';
import './HelpTabs.css';

function GettingStartedTab() {
  const [expanded, setExpanded] = useState({
    welcome: false,
    quickstart: false,
    concepts: false,
    safety: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>Let's Get Down to Pumping!</h2>

      {/* Welcome Section */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('welcome')}>
          Welcome to SwellDreams
          <span className="expand-icon">{expanded.welcome ? '−' : '+'}</span>
        </h3>
        {expanded.welcome && (
          <div className="section-content">
            <p>
              SwellDreams is an AI-powered roleplay application with integrated device control capabilities.
              Chat with AI characters, create immersive scenarios, and optionally connect hardware devices
              for interactive experiences.
            </p>
            <p>
              The application combines natural language AI with a visual flow system that lets you
              create automated behaviors, triggers, and responses based on events and conditions.
            </p>
          </div>
        )}
      </div>

      {/* Quick Start */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('quickstart')}>
          Quick Start Checklist
          <span className="expand-icon">{expanded.quickstart ? '−' : '+'}</span>
        </h3>
        {expanded.quickstart && (
          <div className="section-content">
            <ul className="checklist">
              <li>
                <strong>1. Configure LLM Connection</strong><br />
                Go to Settings → Model and set up your LLM endpoint or OpenRouter API key.
              </li>
              <li>
                <strong>2. Create a Persona</strong><br />
                Go to Settings → Persona to create your player identity. This defines who you are in conversations.
              </li>
              <li>
                <strong>3. Select a Character</strong><br />
                Go to Settings → Characters to choose or create an AI character to chat with.
              </li>
              <li>
                <strong>4. Configure Devices (Optional)</strong><br />
                If using hardware, go to Settings → Devices to add and configure your equipment.
              </li>
              <li>
                <strong>5. Start Chatting!</strong><br />
                Navigate to the Chat page and begin your conversation. Use the Flows page to add automation.
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Core Concepts */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('concepts')}>
          Core Concepts
          <span className="expand-icon">{expanded.concepts ? '−' : '+'}</span>
        </h3>
        {expanded.concepts && (
          <div className="section-content">
            <h4 className="subsection-header">Characters</h4>
            <p>
              AI personalities you interact with. Each character has their own personality,
              backstory, and behavior defined through system prompts and reminders.
            </p>

            <h4 className="subsection-header">Personas</h4>
            <p>
              Your player identity in conversations. The persona defines your name, description,
              and how the AI should perceive and interact with you.
            </p>

            <h4 className="subsection-header">Flows</h4>
            <p>
              Visual automation system using connected nodes. Create triggers that respond to
              events (messages, device states, timers) and chain them to actions (send messages,
              control devices, set variables).
            </p>

            <h4 className="subsection-header">Device Control Modes</h4>
            <p>
              <strong>Interactive Mode:</strong> Connected to real hardware. Commands control actual devices.<br />
              <strong>Simulation Mode:</strong> No hardware connected. Device actions are simulated for testing and safe roleplay.
            </p>
          </div>
        )}
      </div>

      {/* Safety */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('safety')}>
          Safety Information
          <span className="expand-icon">{expanded.safety ? '−' : '+'}</span>
        </h3>
        {expanded.safety && (
          <div className="section-content">
            <div className="warning-box">
              <p>
                <strong>IMPORTANT:</strong> The Emergency Stop button in this software should NOT be
                relied upon as your primary safety mechanism. Software can fail, freeze, or experience delays.
              </p>
            </div>

            <h4 className="subsection-header">Hardware Disconnect</h4>
            <p>
              <strong>ALWAYS</strong> have a hardware disconnect (such as an inline shutoff valve or power
              disconnect) within arm's reach at all times during use. Only a physical hardware disconnect
              provides reliable immediate safety.
            </p>

            <h4 className="subsection-header">Emergency Stop Button</h4>
            <p>
              The red Emergency Stop button in the navigation bar will attempt to immediately halt
              all pumps and cycles. Use it as a backup, but never as your only safety measure.
            </p>

            <h4 className="subsection-header">Safe Practices</h4>
            <ul className="help-list">
              <li>Never exceed safe pressure limits or durations</li>
              <li>Immediately stop any activity that causes pain or distress</li>
              <li>Never engage in activities while impaired</li>
              <li>Test flows in Simulation Mode first</li>
              <li>Always have physical safety controls within reach</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default GettingStartedTab;
