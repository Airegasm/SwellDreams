import React, { useState } from 'react';
import './HelpTabs.css';

function ExternalApisTab() {
  const [expanded, setExpanded] = useState({
    overview: false,
    security: false,
    koboldcpp: false,
    llamacpp: false,
    openrouter: false,
    freemodels: false,
    kasa: false,
    tapo: false,
    tuya: false,
    govee: false,
    wyze: false
  });

  const toggle = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="help-tab">
      <h2>LLM and Smart Device Guides</h2>

      {/* Overview */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('overview')}>
          Overview
          <span className="expand-icon">{expanded.overview ? '−' : '+'}</span>
        </h3>
        {expanded.overview && (
          <div className="section-content">
            <p>
              SwellDreams connects to external services for AI chat and smart device control.
              This guide covers how to set up each integration.
            </p>
            <h4 className="subsection-header">AI/LLM Options</h4>
            <ul className="help-list">
              <li><strong>KoboldCpp</strong> - Run AI models locally on your own hardware (free, private)</li>
              <li><strong>Llama.cpp</strong> - Lightweight local LLM server for GGUF models (free, private, headless-friendly)</li>
              <li><strong>OpenRouter</strong> - Cloud API with access to many models (some free, some paid)</li>
              <li><strong>Custom Endpoint</strong> - Any OpenAI-compatible API endpoint</li>
            </ul>
            <h4 className="subsection-header">Smart Device Options</h4>
            <ul className="help-list">
              <li><strong>TP-Link Kasa</strong> - Local network discovery, no cloud account needed</li>
              <li><strong>TP-Link Tapo</strong> - Local network control, requires device IP and Tapo cloud credentials</li>
              <li><strong>Govee</strong> - Cloud API, requires free Govee account and API key</li>
              <li><strong>Tuya/Smart Life</strong> - Cloud API for Tuya, Smart Life, Geeni, Globe, Treatlife, Gosund, Teckin, etc.</li>
              <li><strong>Wyze</strong> - Cloud API, requires Wyze account and developer API credentials</li>
            </ul>
          </div>
        )}
      </div>

      {/* API Security */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('security')}>
          API Key Security & Encryption
          <span className="expand-icon">{expanded.security ? '−' : '+'}</span>
        </h3>
        {expanded.security && (
          <div className="section-content">
            <p>
              SwellDreams automatically encrypts all API keys stored on your system using
              AES-256-GCM encryption with a unique machine-specific key.
            </p>

            <h4 className="subsection-header">How It Works</h4>
            <ul className="help-list">
              <li>A unique encryption key is generated for your machine on first run</li>
              <li>All API keys (OpenRouter, Tuya, Govee, Wyze) are encrypted before saving</li>
              <li>Keys are decrypted only when needed for API requests</li>
              <li>Encrypted keys appear as <code>enc:v1:...</code> in configuration files</li>
            </ul>

            <h4 className="subsection-header">What This Means For You</h4>
            <ul className="help-list">
              <li><strong>Safe to commit:</strong> Settings files can be backed up without exposing raw API keys</li>
              <li><strong>Machine-bound:</strong> Encrypted keys only work on the machine that created them</li>
              <li><strong>Transparent:</strong> Encryption/decryption happens automatically - just enter your keys normally</li>
            </ul>

            <div className="info-box">
              <p>
                <strong>Note:</strong> If you move SwellDreams to a new machine, you'll need to re-enter
                your API keys since the encryption is tied to the original machine's unique identifier.
              </p>
            </div>

            <h4 className="subsection-header">Machine Key Location</h4>
            <p>
              The encryption key is stored at <code>backend/data/.machine-key</code>. This file
              is automatically added to <code>.gitignore</code> and should never be shared or
              committed to version control.
            </p>
          </div>
        )}
      </div>

      {/* KoboldCpp */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('koboldcpp')}>
          KoboldCpp (Local LLM)
          <span className="expand-icon">{expanded.koboldcpp ? '−' : '+'}</span>
        </h3>
        {expanded.koboldcpp && (
          <div className="section-content">
            <p>
              KoboldCpp lets you run AI models locally on your own computer. This is free, private,
              and works offline. Requires a decent GPU (8GB+ VRAM recommended).
            </p>

            <h4 className="subsection-header">Installation</h4>
            <ol className="help-list numbered">
              <li>
                Download KoboldCpp from{' '}
                <a href="https://github.com/LostRuins/koboldcpp/releases" target="_blank" rel="noopener noreferrer">
                  github.com/LostRuins/koboldcpp
                </a>
              </li>
              <li>Download a GGUF model file (e.g., from HuggingFace)</li>
              <li>Run KoboldCpp and load your model</li>
              <li>Note the API URL (usually <code>http://localhost:5001</code>)</li>
            </ol>

            <h4 className="subsection-header">Recommended Models</h4>
            <ul className="help-list">
              <li><strong>Mistral 7B</strong> - Good balance of quality and speed</li>
              <li><strong>Llama 3.1 8B</strong> - Excellent for roleplay</li>
              <li><strong>Qwen 2.5 7B</strong> - Great instruction following</li>
            </ul>

            <h4 className="subsection-header">SwellDreams Configuration</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Model</strong></li>
              <li>Set Endpoint Standard to <strong>Kobold</strong></li>
              <li>Enter your KoboldCpp URL (e.g., <code>http://localhost:5001</code>)</li>
              <li>Click <strong>Connect</strong></li>
            </ol>

            <div className="info-box">
              <strong>Tip:</strong> For roleplay, look for models with "RP" or "roleplay" in the name,
              or uncensored variants for more creative freedom.
            </div>
          </div>
        )}
      </div>

      {/* Llama.cpp */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('llamacpp')}>
          Llama.cpp (Local LLM)
          <span className="expand-icon">{expanded.llamacpp ? '−' : '+'}</span>
        </h3>
        {expanded.llamacpp && (
          <div className="section-content">
            <p>
              Llama.cpp is a lightweight, efficient C++ inference server for running GGUF models locally.
              It's simpler than KoboldCpp — ideal for headless servers, Docker containers, or minimal setups
              where you just need a fast local LLM endpoint.
            </p>

            <h4 className="subsection-header">Installation</h4>
            <ol className="help-list numbered">
              <li>
                Download a release build from{' '}
                <a href="https://github.com/ggerganov/llama.cpp/releases" target="_blank" rel="noopener noreferrer">
                  github.com/ggerganov/llama.cpp
                </a>
              </li>
              <li>Download a GGUF model file (e.g., from HuggingFace)</li>
              <li>
                Run the server: <code>llama-server -m your-model.gguf</code>
              </li>
              <li>Default URL: <code>http://localhost:8080/completion</code></li>
            </ol>

            <h4 className="subsection-header">SwellDreams Configuration</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Model</strong></li>
              <li>Set Endpoint Standard to <strong>Llama.cpp</strong></li>
              <li>Enter your llama.cpp server URL (e.g., <code>http://localhost:8080/completion</code>)</li>
              <li>Click <strong>Connect</strong></li>
            </ol>

            <h4 className="subsection-header">Auto-Detection</h4>
            <p>
              When you connect, SwellDreams automatically queries the <code>/props</code> endpoint
              to detect the model name and context size. No manual configuration needed.
            </p>

            <h4 className="subsection-header">Prompt Templates</h4>
            <p>
              Since llama.cpp doesn't apply chat templates automatically, you need to select the correct
              prompt template for your model:
            </p>
            <ul className="help-list">
              <li><strong>ChatML</strong> — For models trained with ChatML format (Qwen, OpenHermes, etc.)</li>
              <li><strong>Llama 3</strong> — For Meta's Llama 3 family</li>
              <li><strong>Mistral</strong> — For Mistral/Mixtral models</li>
              <li><strong>Alpaca</strong> — For Alpaca-style instruction-tuned models</li>
              <li><strong>Vicuna</strong> — For Vicuna-style models</li>
              <li><strong>None</strong> — Raw completion, no template wrapping</li>
            </ul>

            <div className="tip-box">
              <strong>Tip:</strong> Llama.cpp is lighter weight than KoboldCpp — it doesn't bundle a UI
              or extra features. If you just need a fast, headless LLM server, llama.cpp is the way to go.
            </div>

            <div className="info-box">
              <strong>Note:</strong> Llama.cpp supports GBNF grammar for structured output. This enables
              constrained generation for consistent formatting in device tags and other structured responses.
            </div>
          </div>
        )}
      </div>

      {/* OpenRouter */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('openrouter')}>
          OpenRouter (Cloud LLM)
          <span className="expand-icon">{expanded.openrouter ? '−' : '+'}</span>
        </h3>
        {expanded.openrouter && (
          <div className="section-content">
            <p>
              OpenRouter provides access to many AI models through a single API. Some models are
              free, others require credits. Great for trying different models without local setup.
            </p>

            <h4 className="subsection-header">Creating an Account</h4>
            <ol className="help-list numbered">
              <li>
                Go to{' '}
                <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">
                  openrouter.ai
                </a>
              </li>
              <li>Click <strong>Sign Up</strong> (you can use Google, GitHub, or email)</li>
              <li>Verify your email if required</li>
            </ol>

            <h4 className="subsection-header">Getting Your API Key</h4>
            <ol className="help-list numbered">
              <li>Log in to OpenRouter</li>
              <li>Click your profile icon → <strong>Keys</strong></li>
              <li>Click <strong>Create Key</strong></li>
              <li>Give it a name (e.g., "SwellDreams")</li>
              <li>Copy the key (starts with <code>sk-or-</code>)</li>
            </ol>

            <h4 className="subsection-header">SwellDreams Configuration</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Model</strong></li>
              <li>Set Endpoint Standard to <strong>OpenRouter</strong></li>
              <li>Paste your API key</li>
              <li>Click <strong>Connect</strong></li>
              <li>Select a model from the dropdown</li>
            </ol>

            <div className="warning-box">
              <strong>Note:</strong> Keep your API key secret! Anyone with your key can use your credits.
              If compromised, delete it and create a new one.
            </div>
          </div>
        )}
      </div>

      {/* Free Models */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('freemodels')}>
          Recommended Free Models
          <span className="expand-icon">{expanded.freemodels ? '−' : '+'}</span>
        </h3>
        {expanded.freemodels && (
          <div className="section-content">
            <p>
              These OpenRouter models are free to use (as of writing). Quality and availability may vary.
            </p>

            <h4 className="subsection-header">Best Free Options</h4>
            <table className="help-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Best For</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Qwen 2.5 7B Instruct</strong></td>
                  <td>General chat, roleplay</td>
                  <td>Excellent quality for a free model. Recommended starting point.</td>
                </tr>
                <tr>
                  <td><strong>Llama 3.1 8B Instruct</strong></td>
                  <td>Roleplay, creative writing</td>
                  <td>Meta's open model. Good creativity.</td>
                </tr>
                <tr>
                  <td><strong>Mistral 7B Instruct</strong></td>
                  <td>Fast responses</td>
                  <td>Quick and capable. Good for testing.</td>
                </tr>
                <tr>
                  <td><strong>Gemma 2 9B</strong></td>
                  <td>Longer conversations</td>
                  <td>Google's model. Good context handling.</td>
                </tr>
              </tbody>
            </table>

            <div className="info-box">
              <strong>Recommendation:</strong> Start with <strong>Qwen 2.5 7B Instruct</strong> - it offers
              the best balance of quality, speed, and availability among free models.
            </div>

            <h4 className="subsection-header">Paid Models Worth Considering</h4>
            <p>If you want better quality and are willing to pay (usually pennies per conversation):</p>
            <ul className="help-list">
              <li><strong>Claude 3.5 Sonnet</strong> - Excellent roleplay, very creative</li>
              <li><strong>GPT-4o</strong> - OpenAI's flagship, great at following complex instructions</li>
              <li><strong>Llama 3.1 70B</strong> - Larger Llama model, much better than 8B</li>
            </ul>
          </div>
        )}
      </div>

      {/* TP-Link Kasa */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('kasa')}>
          TP-Link Kasa (Local)
          <span className="expand-icon">{expanded.kasa ? '−' : '+'}</span>
        </h3>
        {expanded.kasa && (
          <div className="section-content">
            <p>
              TP-Link Kasa devices (smart plugs, switches, power strips) can be controlled locally
              over your network without any cloud account. This is the simplest device integration.
            </p>

            <h4 className="subsection-header">Prerequisites</h4>
            <ul className="help-list">
              <li>TP-Link Kasa devices set up in the Kasa app</li>
              <li>Devices connected to the same network as SwellDreams</li>
              <li>Python 3.8+ installed (used for device discovery)</li>
            </ul>

            <h4 className="subsection-header">SwellDreams Configuration</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Devices</strong></li>
              <li>In the Kasa section, click <strong>Scan Kasa</strong></li>
              <li>Wait for device discovery to complete</li>
              <li>Click <strong>Add</strong> next to each device you want to control</li>
            </ol>

            <div className="info-box">
              <strong>Tip:</strong> Kasa devices are discovered by IP address. If your router
              assigns new IPs, you may need to re-scan. Consider setting static IPs for your
              Kasa devices in your router settings.
            </div>
          </div>
        )}
      </div>

      {/* TP-Link Tapo */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('tapo')}>
          TP-Link Tapo
          <span className="expand-icon">{expanded.tapo ? '−' : '+'}</span>
        </h3>
        {expanded.tapo && (
          <div className="section-content">
            <p>
              TP-Link Tapo devices (smart plugs, power strips, etc.) require your Tapo cloud
              credentials for authentication, but are controlled locally over your network.
            </p>

            <div className="warning-box">
              <strong>Important:</strong> Tapo devices require you to manually enter the device's
              local IP address. The cloud API cannot discover IPs automatically.
            </div>

            <h4 className="subsection-header">Prerequisites</h4>
            <ul className="help-list">
              <li>TP-Link Tapo devices set up in the Tapo app</li>
              <li>Tapo cloud account (email and password)</li>
              <li><strong>Third-Party Compatibility enabled</strong> (see below)</li>
              <li>Device local IP address (see "Finding Your Device IP" below)</li>
            </ul>

            <h4 className="subsection-header">Enable Third-Party Compatibility</h4>
            <div className="warning-box">
              <strong>Required:</strong> Tapo devices must have Third-Party Compatibility enabled
              to work with SwellDreams. Without this, you'll get a "FORBIDDEN" error.
            </div>
            <ol className="help-list numbered">
              <li>Open the <strong>Tapo app</strong> on your phone</li>
              <li>Tap <strong>Me</strong> (bottom right corner)</li>
              <li>Tap <strong>Third-Party Services</strong></li>
              <li>Enable the <strong>Third-Party Compatibility</strong> toggle</li>
              <li>If already enabled, toggle it <strong>off then on again</strong></li>
            </ol>

            <h4 className="subsection-header">Finding Your Device IP</h4>
            <p>You can find your Tapo device's IP address in several ways:</p>
            <ol className="help-list numbered">
              <li>
                <strong>Tapo App:</strong> Open the Tapo app → tap on your device →
                tap the gear icon (settings) → scroll down to "Device Info" → find "IP Address"
              </li>
              <li>
                <strong>Router Admin:</strong> Log into your router's admin page and look
                for connected devices. The Tapo device will appear with its name and IP.
              </li>
              <li>
                <strong>Network Scanner:</strong> Use an app like "Fing" on your phone to
                scan your network and find TP-Link devices.
              </li>
            </ol>

            <h4 className="subsection-header">SwellDreams Configuration</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Devices</strong></li>
              <li>In the Tapo section, enter your <strong>Tapo email</strong> and <strong>password</strong></li>
              <li>Click <strong>Connect</strong> to verify your credentials</li>
              <li>Enter your device's <strong>IP address</strong> (e.g., <code>192.168.1.135</code>)</li>
              <li>Click <strong>Add Device</strong></li>
              <li>The device should appear in your device list</li>
            </ol>

            <div className="tip-box">
              <strong>Static IP Recommended:</strong> To prevent your Tapo device IP from changing,
              set up a DHCP reservation (static IP) in your router. This ensures the IP stays
              the same after reboots.
            </div>

            <h4 className="subsection-header">Troubleshooting</h4>
            <ul className="help-list">
              <li>
                <strong>"FORBIDDEN" error:</strong> Enable Third-Party Compatibility in the Tapo app
                (Me → Third-Party Services). If already enabled, toggle it off then on again.
              </li>
              <li>
                <strong>Authentication fails:</strong> Double-check your Tapo email and password.
                These are the same credentials you use to log into the Tapo app.
              </li>
              <li>
                <strong>Device not responding:</strong> Verify the IP address is correct and the
                device is online. Try controlling it with the Tapo app first.
              </li>
              <li>
                <strong>Connection timeout:</strong> Ensure SwellDreams is running on the same
                network as your Tapo device (not a VPN or different subnet).
              </li>
              <li>
                <strong>IP changed:</strong> If your device stopped working, the IP may have
                changed. Check your router or Tapo app for the new address.
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Tuya */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('tuya')}>
          Tuya / Smart Life API
          <span className="expand-icon">{expanded.tuya ? '−' : '+'}</span>
        </h3>
        {expanded.tuya && (
          <div className="section-content">
            <p>
              Tuya powers many smart home brands including Smart Life, <strong>Globe</strong>, Treatlife,
              Gosund, Teckin, and dozens more. If your device uses the Smart Life, Tuya, or Globe app,
              it likely works with this API.
            </p>

            <div className="warning-box">
              <strong>Critical:</strong> You must use the official <strong>"Smart Life"</strong> app by{' '}
              <strong>Volcano Technology Limited</strong> (or the official Tuya Smart app). Third-party apps
              like "SmartLife" (one word, by other developers) will NOT work with the Tuya IoT Platform.
              Check the app developer in your app store before proceeding.
            </div>

            <h4 className="subsection-header">Supported Brands</h4>
            <p>Devices from these brands typically use Tuya's platform:</p>
            <ul className="help-list">
              <li>Smart Life</li>
              <li><strong>Geeni / iHome</strong></li>
              <li><strong>Globe Electric</strong></li>
              <li>Treatlife</li>
              <li>Gosund</li>
              <li>Teckin</li>
              <li>Lumary</li>
              <li>Avatar Controls</li>
              <li>Many others (if it uses Smart Life app, it's Tuya-based)</li>
            </ul>

            <h4 className="subsection-header">Step 1: Set Up Your Devices in a Tuya-Compatible App</h4>
            <ol className="help-list numbered">
              <li>
                Install the official <strong>Smart Life</strong> app by Volcano Technology Limited
                from the{' '}
                <a href="https://apps.apple.com/app/smart-life-smart-living/id1115101477" target="_blank" rel="noopener noreferrer">
                  App Store
                </a>
                {' '}or{' '}
                <a href="https://play.google.com/store/apps/details?id=com.tuya.smartlife" target="_blank" rel="noopener noreferrer">
                  Google Play
                </a>
              </li>
              <li>Create an account and add your devices to the app</li>
              <li>Make sure your devices work in the app before proceeding</li>
            </ol>
            <div className="info-box">
              <strong>Using Geeni or iHome devices?</strong> You can keep using the Geeni app instead
              of Smart Life. In Step 6, select "Geeni" from the app list when linking your account
              to the Tuya IoT Platform.
            </div>

            <h4 className="subsection-header">Step 2: Create a Tuya IoT Account</h4>
            <ol className="help-list numbered">
              <li>
                Go to{' '}
                <a href="https://iot.tuya.com" target="_blank" rel="noopener noreferrer">
                  iot.tuya.com
                </a>
              </li>
              <li>Click <strong>Sign Up</strong> and create a developer account</li>
              <li>Verify your email</li>
              <li>Complete any required profile information</li>
            </ol>

            <h4 className="subsection-header">Step 3: Create a Cloud Project</h4>
            <ol className="help-list numbered">
              <li>Log in to Tuya IoT Platform</li>
              <li>Go to <strong>Cloud → Development → My Cloud Projects</strong></li>
              <li>Click <strong>Create Cloud Project</strong></li>
              <li>Fill in project details:
                <ul className="help-list">
                  <li><strong>Project Name:</strong> anything (e.g., "SwellDreams")</li>
                  <li><strong>Industry:</strong> Smart Home</li>
                  <li><strong>Development Method:</strong> Smart Home</li>
                  <li><strong>Data Center:</strong> Choose based on your location:
                    <ul className="help-list">
                      <li>USA West Coast → Western America</li>
                      <li>USA East Coast → Eastern America</li>
                      <li>Europe → Central Europe</li>
                      <li>China → China</li>
                      <li>India → India</li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li>Click <strong>Create</strong></li>
            </ol>

            <h4 className="subsection-header">Step 4: Authorize API Services</h4>
            <p>During setup, you'll be asked to authorize API services. You need these:</p>
            <ul className="help-list">
              <li><strong>IoT Core</strong> (Free Basic Resource Pack) - Required for API access</li>
              <li><strong>Authorization Token Management</strong> - Required for authentication</li>
              <li><strong>Smart Home Basic Service</strong> - Required for device control</li>
            </ul>
            <p>You can remove others like "Data Dashboard Service" - they're not needed.</p>

            <h4 className="subsection-header">Step 5: Get Your API Credentials</h4>
            <ol className="help-list numbered">
              <li>Open your project</li>
              <li>Go to the <strong>Overview</strong> tab</li>
              <li>Find <strong>Access ID/Client ID</strong> and <strong>Access Secret/Client Secret</strong></li>
              <li>Copy both values</li>
            </ol>

            <h4 className="subsection-header">Step 6: Link Your Smart Life Account</h4>
            <ol className="help-list numbered">
              <li>In your project, go to <strong>Devices → Link Tuya App Account</strong></li>
              <li>Click <strong>Add App Account</strong></li>
              <li>Scan the QR code with your <strong>Smart Life</strong> app</li>
              <li>Confirm linking in the app</li>
              <li>Your devices should now appear in the <strong>All Devices</strong> tab</li>
            </ol>

            <h4 className="subsection-header">Step 7: Get Your Device IDs</h4>
            <div className="info-box">
              <strong>Note:</strong> Tuya's Cloud Authorization API does not support automatic device discovery.
              You must manually add each device using its Device ID from the Tuya IoT Platform.
            </div>
            <ol className="help-list numbered">
              <li>In your Tuya IoT project, go to <strong>Devices → All Devices</strong></li>
              <li>Find your device in the list</li>
              <li>Copy the <strong>Device ID</strong> (a long alphanumeric string like <code>eb7ea012e9d2b4fb43lk1c</code>)</li>
              <li>Keep this ID handy for SwellDreams configuration</li>
            </ol>

            <h4 className="subsection-header">Step 8: Configure SwellDreams</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Devices</strong></li>
              <li>In the Tuya section, click <strong>Connect</strong></li>
              <li>Enter your Access ID and Access Secret</li>
              <li>Select your region (must match your Tuya project data center)</li>
              <li>Click <strong>Connect</strong></li>
              <li>Click <strong>+ Add Device</strong></li>
              <li>Paste your Device ID from Step 7</li>
              <li>Click <strong>Add</strong> to fetch the device</li>
              <li>Repeat for each device you want to control</li>
            </ol>

            <div className="warning-box">
              <strong>Troubleshooting:</strong>
              <ul className="help-list" style={{marginTop: '8px', marginBottom: 0}}>
                <li><strong>Authentication fails:</strong> Make sure your Data Center region in Tuya IoT matches
                  the region you selected in SwellDreams (us, eu, cn, or in).</li>
                <li><strong>Device not found:</strong> Verify the Device ID is correct by checking the Tuya IoT
                  Platform → Devices → All Devices tab.</li>
                <li><strong>Devices not appearing in Tuya IoT:</strong> Make sure you're using the official
                  Smart Life app (by Volcano Technology Limited), not a third-party app.</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Govee */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('govee')}>
          Govee API
          <span className="expand-icon">{expanded.govee ? '−' : '+'}</span>
        </h3>
        {expanded.govee && (
          <div className="section-content">
            <p>
              Govee makes smart lights, plugs, and other devices. Their API is simpler to set up
              than Tuya - you just need an API key from the Govee Home app.
            </p>

            <h4 className="subsection-header">Prerequisites</h4>
            <ul className="help-list">
              <li>Govee Home app installed on your phone</li>
              <li>Govee account created</li>
              <li>Your Govee devices set up in the app</li>
            </ul>

            <h4 className="subsection-header">Getting Your API Key</h4>
            <ol className="help-list numbered">
              <li>Open the <strong>Govee Home</strong> app</li>
              <li>Tap your <strong>Profile</strong> icon (bottom right)</li>
              <li>Tap <strong>Settings</strong> (gear icon)</li>
              <li>Tap <strong>About Us</strong></li>
              <li>Tap <strong>Apply for API Key</strong></li>
              <li>Enter your name and reason (e.g., "Home automation")</li>
              <li>Submit the request</li>
              <li>Check your email - the API key is usually sent within minutes</li>
            </ol>

            <h4 className="subsection-header">SwellDreams Configuration</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Devices</strong></li>
              <li>In the Govee section, click <strong>Connect</strong></li>
              <li>Paste your API key</li>
              <li>Click <strong>Connect</strong></li>
              <li>Click <strong>Scan Devices</strong> to discover your Govee devices</li>
            </ol>

            <div className="info-box">
              <strong>Tip:</strong> Govee's API has rate limits. If you get errors when scanning or
              controlling devices rapidly, wait a few seconds and try again.
            </div>
          </div>
        )}
      </div>

      {/* Wyze */}
      <div className="help-section">
        <h3 className="section-header" onClick={() => toggle('wyze')}>
          Wyze API
          <span className="expand-icon">{expanded.wyze ? '−' : '+'}</span>
        </h3>
        {expanded.wyze && (
          <div className="section-content">
            <p>
              Wyze makes affordable smart home devices including plugs, cameras, and sensors.
              Their API requires developer credentials from the Wyze Developer Portal.
            </p>

            <h4 className="subsection-header">Prerequisites</h4>
            <ul className="help-list">
              <li>Wyze account with devices set up in the Wyze app</li>
              <li>Wyze developer account (separate from regular account)</li>
              <li>API Key and Key ID from the Wyze Developer Portal</li>
            </ul>

            <h4 className="subsection-header">Step 1: Create a Wyze Developer Account</h4>
            <ol className="help-list numbered">
              <li>
                Go to{' '}
                <a href="https://developer-api-console.wyze.com" target="_blank" rel="noopener noreferrer">
                  developer-api-console.wyze.com
                </a>
              </li>
              <li>Sign up for a developer account (this is separate from your regular Wyze account)</li>
              <li>Verify your email</li>
            </ol>

            <h4 className="subsection-header">Step 2: Create an API Key</h4>
            <ol className="help-list numbered">
              <li>Log in to the Wyze Developer Console</li>
              <li>Navigate to <strong>API Keys</strong></li>
              <li>Click <strong>Create New Key</strong></li>
              <li>Give it a name (e.g., "SwellDreams")</li>
              <li>Copy both the <strong>API Key</strong> and <strong>Key ID</strong></li>
            </ol>

            <div className="warning-box">
              <strong>Important:</strong> Save your API Key immediately - you won't be able to see it again
              after closing the creation dialog. If you lose it, you'll need to create a new one.
            </div>

            <h4 className="subsection-header">Step 3: Configure SwellDreams</h4>
            <ol className="help-list numbered">
              <li>Go to <strong>Settings → Devices</strong></li>
              <li>Expand the <strong>Wyze</strong> section</li>
              <li>Enter your Wyze account email and password</li>
              <li>Enter your API Key ID and API Key</li>
              <li>If you have 2FA enabled, enter your TOTP key (optional)</li>
              <li>Click <strong>Connect</strong></li>
              <li>Click <strong>Scan Devices</strong> to discover your Wyze plugs</li>
            </ol>

            <h4 className="subsection-header">Two-Factor Authentication (2FA)</h4>
            <p>
              If you have 2FA enabled on your Wyze account, you have two options:
            </p>
            <ul className="help-list">
              <li><strong>TOTP Key:</strong> Enter your TOTP secret key (the code you used to set up your authenticator app) to automate 2FA</li>
              <li><strong>Disable 2FA:</strong> Temporarily disable 2FA on your Wyze account for SwellDreams</li>
            </ul>

            <div className="info-box">
              <strong>Supported Devices:</strong> Currently only Wyze Plugs are supported. Cameras, sensors,
              and other device types may be added in future updates.
            </div>

            <h4 className="subsection-header">Troubleshooting</h4>
            <ul className="help-list">
              <li><strong>Login fails:</strong> Double-check your Wyze account email and password. These are your regular Wyze app credentials, not your developer account.</li>
              <li><strong>API errors:</strong> Make sure your API Key and Key ID are correct and haven't been revoked.</li>
              <li><strong>No devices found:</strong> Ensure your plugs are set up and online in the Wyze app.</li>
              <li><strong>2FA issues:</strong> If using TOTP, make sure you're entering the secret key, not the 6-digit code.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExternalApisTab;
