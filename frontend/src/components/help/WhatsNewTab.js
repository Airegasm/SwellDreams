import React from 'react';
import './HelpTabs.css';

function WhatsNewTab() {
  return (
    <div className="help-tab">
      <div className="help-section">
        <h2>🎈 What's New in v4.0.0</h2>
        <p className="version-date">Released: April 2026</p>
      </div>

      <div className="help-section">
        <h3>🎨 Complete Skin System Overhaul</h3>
        <p>
          Every visual element in SwellDreams is now fully skinnable. Skins apply across
          the entire application — chat, settings, modals, sidebars, and all dropdown pages.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>8 Built-in Scene Skins:</strong>
            <p>Deep Forest, Abandoned Warehouse, Moonlit Embrace, The Red Room, Neon Arcade, The Laboratory, Observation Ward, and Slumber Party — each with custom background images, sidebar images, and coordinated color schemes.</p>
          </div>
          <div className="feature-item">
            <strong>Persistent Skin Images:</strong>
            <p>Uploaded background and sidebar images are saved to disk and served as files, so they persist even if the original source is deleted.</p>
          </div>
          <div className="feature-item">
            <strong>Bubble Transparency:</strong>
            <p>New opacity slider in Display settings controls chat bubble transparency (10-100%). Bubbles return to full opacity on hover. Scene skins default to 75%.</p>
          </div>
          <div className="feature-item">
            <strong>Per-Character Session Skins:</strong>
            <p>The skin dropdown in the character editor now shows all skins (built-in and custom). Switching characters automatically reverts to the default skin when the new character has no skin assigned.</p>
          </div>
          <div className="feature-item">
            <strong>Full Coverage:</strong>
            <p>Modal headers, settings section backgrounds, token switching popups, configured devices card, calibration modal, new session dialog, TOS content, and all center-modal overlay pages now respect the active skin.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🎯 36 Character-Specific Checkpoint Profiles</h3>
        <p>
          18 player profiles and 18 character profiles with pre-authored checkpoint text and
          triggers tailored to specific inflation scenarios and personality archetypes.
        </p>
      </div>

      <div className="help-section">
        <h3>🔧 Pump Control Improvements</h3>
        <p>
          When pressing "Use" on a non-pumpable character, any active AI pump controls are now
          automatically unloaded — stopping inflation timers, resetting capacity, and removing
          pump-related buttons from the persona.
        </p>
      </div>

      <div className="help-section">
        <h3>🛡️ Persona Data Integrity Fix</h3>
        <p>
          Fixed a race condition that could corrupt custom persona JSON files. Multiple concurrent
          writes (e.g. updating assigned flows while syncing auto-generated buttons) no longer
          compete — the system passes in-memory persona objects to avoid stale re-reads from disk.
        </p>
      </div>

      <div className="help-section">
        <h3>🔇 Quieter Device Checks</h3>
        <p>
          Unreachable devices that aren't the primary pump no longer trigger toast warnings on startup.
          Only simulation-mode-forcing failures (primary pump unreachable) produce a visible notification.
        </p>
      </div>

      <div className="help-section">
        <h3>🐛 Fixes</h3>
        <ul>
          <li>Fixed non-pumpable characters missing spoiler toggles and checkpoint triggers</li>
          <li>Fixed Use button navigating to exit-modal instead of chat</li>
          <li>Fixed character select not closing window and navigating to chat</li>
          <li>Fixed chat background not responding to skin changes</li>
          <li>Fixed persona action menu and character action menu backgrounds covering sidebar images</li>
          <li>Fixed skin not reverting to default when switching to a character with no custom skin</li>
          <li>Fixed token switching/replacement modal popups using unskinned headers</li>
          <li>Fixed configured devices header and section backgrounds ignoring skin</li>
        </ul>
      </div>

      <div className="help-section">
        <h2>🎈 What's New in v3.9.x</h2>
        <p className="version-date">Released: March–April 2026</p>
      </div>

      <div className="help-section">
        <h3>🎨 Display Settings &amp; Skin System</h3>
        <p>
          Full visual customization via Settings {'>'} Display. Create, save, and switch between custom skins
          that control every visual element of the chat interface.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Customizable:</strong>
            <p>Player/Character/System bubble colors, outlines, text colors, fonts, sizes. Background image, modal background, header and tab strip colors.</p>
          </div>
          <div className="feature-item">
            <strong>Per-Character Skins:</strong>
            <p>Assign a skin to each character story. It auto-loads when starting a session with that story.</p>
          </div>
          <div className="feature-item">
            <strong>Checkpoint Trigger:</strong>
            <p>"Set Display Skin" trigger type lets skins change dynamically based on capacity ranges.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🧠 Persona Disposition &amp; Checkpoint Triggers</h3>
        <p>
          Personas now have a General Disposition (baseline emotion) and full checkpoint trigger support
          matching the character system. 39 disposition options available.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Persona Checkpoint Triggers:</strong>
            <p>Full trigger system under each checkpoint range in persona editor. Triggers save with profiles.</p>
          </div>
          <div className="feature-item">
            <strong>Character Precedence:</strong>
            <p>If both character and persona checkpoints fire triggers for the same range and type, the character trigger takes priority.</p>
          </div>
          <div className="feature-item">
            <strong>6 Built-in Profiles:</strong>
            <p>Eager Submissive, Reluctant Curious, Defiant Brat (player). Fascinated Observer, Protective Caretaker, Sadistic Controller (character).</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🎬 Video Portrait System</h3>
        <p>
          Staged portraits now support video alongside images. Upload idle loop videos (MP4/WebM) for
          each capacity range, plus transition videos that play when crossing range boundaries. Videos
          play in reverse during deflation. All media is stored on disk and can be exported/imported as
          zip bundles separate from the character card.
        </p>
        <div className="feature-list">
          <div className="feature-item">
            <strong>Idle Videos:</strong>
            <p>Looping video portraits per capacity range — mix freely with static images</p>
          </div>
          <div className="feature-item">
            <strong>Transition Videos:</strong>
            <p>One-shot clips that play when capacity crosses into a new range. Plays in reverse for deflation.</p>
          </div>
          <div className="feature-item">
            <strong>Zip Export/Import:</strong>
            <p>Export all portrait media as a zip bundle. Import on another instance without touching the character card.</p>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>🛡️ Pre-Inflation Gate</h3>
        <p>
          When a character has a 0% checkpoint with text, the LLM cannot activate pumps until a human
          action (manual control, button, or flow) raises capacity above 0% for the first time.
        </p>
      </div>

      <div className="help-section">
        <h3>🔀 Token Switching</h3>
        <p>
          Prevent LLMs from falling into repetitive word patterns. Token switching scans every AI response
          and randomly replaces overused words with alternatives you define. Includes sentence-level removal rules.
        </p>
      </div>

      <div className="help-section">
        <h3>📋 Persona Checkpoint Profiles</h3>
        <p>
          The checkpoint profile system (load, save, update, delete) is now available in the Persona editor —
          matching the same workflow Characters already have. Shared profile library between editors.
        </p>
      </div>

      <div className="help-section">
        <h3>🧹 Clear Chat Menu</h3>
        <p>
          Gear button next to the font size controls: Clear Screen, Clear Context, Clear Both, and Summarize {'&'} Clear.
        </p>
      </div>

      <div className="help-section">
        <h3>📦 Batch V2/V3 Character Import</h3>
        <p>
          The "Convert V2/V3" button now accepts multiple files at once with per-file error handling.
        </p>
      </div>
    </div>
  );
}

export default WhatsNewTab;
