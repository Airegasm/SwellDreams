import React, { useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { useError } from './context/ErrorContext';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import FlowEditor from './pages/FlowEditor';
import ScreenPlay from './pages/ScreenPlay';
import Help from './pages/Help';
import Personas from './pages/Personas';
import Characters from './pages/Characters';
import HamburgerMenu from './components/HamburgerMenu';
import SaveSessionModal from './components/modals/SaveSessionModal';
import LoadSessionModal from './components/modals/LoadSessionModal';
import { EMOTIONS } from './constants/stateValues';
import './styles/App.css';
import './styles/mobile.css';

const TERMS_OF_SERVICE = `# SwellDreams - Terms of Service

**Effective Date: January 2026**

## 1. Acceptance of Terms

By accessing or using the SwellDreams application ("the Service") provided by Airegasm.com, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service. If you do not agree to these terms, you must not use the Service.

## 2. Disclaimer of Liability

**Airegasm.com, its owners, operators, affiliates, and partners are not liable for any injury, harm, death, or damage of any kind** resulting from the irresponsible, unsafe, uneducated, negligent, or ignorant use of the SwellDreams application or any associated equipment, devices, or practices.

## 3. Assumption of Risk

You acknowledge and accept that body inflation activities carry inherent risks, including but not limited to physical injury, discomfort, or other adverse effects. By using this Service, you voluntarily assume all risks associated with such activities.

## 4. User Responsibility

The burden of responsible usage rests solely on the willing participants. Users are expected to:

- Educate themselves on safe practices before engaging in any inflation activities
- Use appropriate equipment that is designed and rated for such purposes
- Never exceed safe pressure limits or durations
- Immediately stop any activity that causes pain, discomfort, or distress
- Consult with medical professionals if they have any health concerns
- Never engage in activities while impaired by alcohol, drugs, or medication
- Ensure all participants are consenting adults

## 5. Safety Warning

**The EMERGENCY STOP button in this software should NOT be relied upon as your primary safety mechanism.** You should ALWAYS have a hardware disconnect (such as an inline shutoff valve or power disconnect) within arm's reach at all times during use. Software can fail, freeze, or experience delays - only a physical hardware disconnect provides reliable immediate safety.

## 6. Prohibited Conduct

Airegasm.com does not condone, support, or encourage any act that may cause bodily harm, injury, or death. The Service is intended for use by educated, responsible adults who understand the risks involved and take appropriate precautions.

## 7. No Medical Advice

The Service does not provide medical advice. Any information provided is for educational and entertainment purposes only. Always consult with qualified healthcare professionals regarding any health-related questions or concerns.

## 8. Indemnification

You agree to indemnify, defend, and hold harmless Airegasm.com and its owners, operators, employees, and affiliates from any claims, damages, losses, or expenses arising from your use of the Service or violation of these Terms.

## 9. Age Requirement

You must be at least 18 years of age (or the age of majority in your jurisdiction) to use this Service. By using the Service, you represent and warrant that you meet this requirement.

## 10. Modifications

Airegasm.com reserves the right to modify these Terms at any time. Continued use of the Service after any changes constitutes acceptance of the modified Terms.

## 11. Governing Law

These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.

---

**BY USING SWELLDREAMS, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS OF SERVICE AND ACCEPT FULL RESPONSIBILITY FOR YOUR ACTIONS AND SAFETY.**`;

function App() {
  const location = useLocation();
  const isModalOpen = location.pathname !== '/' && location.pathname !== '/flows';
  const isFlowsPage = location.pathname === '/flows';
  const { connected, api, controlMode, settings, messages, characters, personas, sessionState, startNewSession, flowExecutions } = useApp();
  const { showError, showWarning, showSuccess } = useError();
  const [stopping, setStopping] = useState(false);
  const [showTOS, setShowTOS] = useState(false);
  const [connectionProfiles, setConnectionProfiles] = useState([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Session management state (lifted from Chat.js)
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedSessions, setSavedSessions] = useState([]);

  // New session "Real Time Data" popup state
  const [showNewSessionPopup, setShowNewSessionPopup] = useState(false);
  const [newSessionData, setNewSessionData] = useState({
    capacity: 0,
    pain: 0,
    emotion: 'neutral',
    capacityModifier: 1.0
  });

  // Get active character and persona
  const activeCharacter = characters.find(c => c.id === settings?.activeCharacterId);
  const activePersona = personas.find(p => p.id === settings?.activePersonaId);

  // Check if there are messages beyond welcome message
  const hasUnsavedChanges = messages.length > 1;

  // Generate default session name
  const getDefaultSessionName = () => {
    const personaName = activePersona?.displayName || 'Player';
    const charName = activeCharacter?.name || 'Character';
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${personaName}-${charName}-${timestamp}`;
  };

  // Session handlers
  const handleNewSession = () => {
    // Reset form data and show popup
    setNewSessionData({ capacity: 0, pain: 0, emotion: 'neutral', capacityModifier: 1.0 });
    setShowNewSessionPopup(true);
  };

  const handleConfirmNewSession = async () => {
    setShowNewSessionPopup(false);
    await startNewSession(newSessionData);
  };

  const handleCancelNewSession = () => {
    setShowNewSessionPopup(false);
  };

  const handleSaveSession = async (name) => {
    try {
      await api.saveSession({
        name,
        personaId: settings?.activePersonaId,
        characterId: settings?.activeCharacterId
      });
      setShowSaveModal(false);
    } catch (error) {
      console.error('Failed to save session:', error);
      showError('Failed to save session');
    }
  };

  const handleOpenLoadModal = async () => {
    try {
      const sessions = await api.listSessions(
        settings?.activePersonaId,
        settings?.activeCharacterId
      );
      setSavedSessions(sessions);
      setShowLoadModal(true);
    } catch (error) {
      console.error('Failed to list sessions:', error);
      showError('Failed to load sessions list');
    }
  };

  const handleLoadSession = async (sessionId) => {
    try {
      await api.loadSession(sessionId);
      setShowLoadModal(false);
    } catch (error) {
      console.error('Failed to load session:', error);
      showError('Failed to load session');
    }
  };

  // Load connection profiles
  useEffect(() => {
    api.getConnectionProfiles()
      .then(setConnectionProfiles)
      .catch(err => {
        console.error('Failed to load connection profiles:', err);
        // Don't show error toast on initial load failure - might just be starting up
      });
  }, [api]);

  // Check if LLM is configured
  const isLlmConfigured = () => {
    const llm = settings?.llm;
    if (!llm) return false;
    return llm.llmUrl || (llm.endpointStandard === 'openrouter' && llm.openRouterApiKey);
  };

  // Get active profile name
  const getActiveProfileName = () => {
    const activeId = settings?.llm?.activeProfileId;
    if (!activeId) return null;
    const profile = connectionProfiles.find(p => p.id === activeId);
    return profile?.name || null;
  };

  // Get LLM status for badge
  const getLlmStatus = () => {
    if (!isLlmConfigured()) {
      return { text: 'LLM: Offline', className: 'llm-offline' };
    }
    if (sessionState?.isGenerating) {
      return { text: 'LLM: Generating', className: 'llm-generating' };
    }
    return { text: 'LLM: Idle', className: 'llm-idle' };
  };

  // Check if TOS was accepted this session
  useEffect(() => {
    const tosAccepted = sessionStorage.getItem('swelldreams_tos_accepted');
    if (!tosAccepted) {
      setShowTOS(true);
    }
  }, []);

  // Reset banner dismissed state when connection is restored
  useEffect(() => {
    if (connected) {
      setBannerDismissed(false);
    }
  }, [connected]);

  // Listen for mobile menu session events
  useEffect(() => {
    const handleMobileNewSession = () => handleNewSession();
    const handleMobileSaveSession = () => setShowSaveModal(true);
    const handleMobileLoadSession = () => handleOpenLoadModal();

    window.addEventListener('mobile-new-session', handleMobileNewSession);
    window.addEventListener('mobile-save-session', handleMobileSaveSession);
    window.addEventListener('mobile-load-session', handleMobileLoadSession);

    return () => {
      window.removeEventListener('mobile-new-session', handleMobileNewSession);
      window.removeEventListener('mobile-save-session', handleMobileSaveSession);
      window.removeEventListener('mobile-load-session', handleMobileLoadSession);
    };
  }, []);

  const handleAcceptTOS = () => {
    sessionStorage.setItem('swelldreams_tos_accepted', 'true');
    setShowTOS(false);
  };

  const handleDeclineTOS = () => {
    window.location.href = 'about:blank';
  };

  // E-STOP / ABORT button handler
  const handleEmergencyStop = async () => {
    if (controlMode === 'simulated' || stopping) return;

    setStopping(true);
    const hasActiveFlows = flowExecutions && flowExecutions.length > 0;

    try {
      const response = await fetch('/api/emergency-stop', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        if (hasActiveFlows) {
          // Show flow abort message with flow name
          const flowInfo = flowExecutions[0];
          const flowLabel = flowInfo?.triggerLabel || flowInfo?.flowName || 'Flow';
          showWarning(`Flow Aborted: ${flowLabel}`, 5000);
        } else {
          // Show simple shutoff message
          showWarning('Shutoff Initiated', 3000);
        }
      } else {
        showError('Emergency stop failed');
      }
    } catch (error) {
      console.error('Emergency stop error:', error);
      showError('Emergency stop failed: ' + error.message);
    } finally {
      setStopping(false);
    }
  };

  // Determine E-STOP button state
  const getEstopState = () => {
    if (controlMode === 'simulated') {
      return { text: 'SIM MODE', className: 'estop-simulated', disabled: true };
    }
    const hasActiveFlows = flowExecutions && flowExecutions.length > 0;
    if (hasActiveFlows) {
      return { text: 'ABORT', className: 'estop-abort', disabled: false };
    }
    return { text: 'E-STOP', className: 'estop-active', disabled: false };
  };

  const estopState = getEstopState();

  return (
    <div className={`app chat-layout ${isModalOpen ? 'modal-open' : ''} ${isFlowsPage ? 'flows-page' : ''}`}>
      <span className="version-badge">v1.5b</span>
      {/* Top metallic frame border */}
      <div className="top-frame-border"></div>

      {/* Column top bars - contain logo and nav elements */}
      <div className="left-column-top-bar">
        <img src="/logo.png" alt="SwellDreams" className="nav-logo" />
      </div>
      <div className="right-column-top-bar">
        <div className="nav-badges">
          <span className={`connection-status ${getLlmStatus().className}`}>
            🤖
          </span>
        </div>
        <button
          className={`estop-btn ${estopState.className} ${stopping ? 'stopping' : ''}`}
          onClick={handleEmergencyStop}
          disabled={estopState.disabled || stopping}
          title={estopState.disabled ? 'Simulation mode active' : 'Emergency stop - stops all devices, flows, and LLM'}
        >
          {stopping ? '...' : estopState.text}
        </button>
      </div>

      {/* Hamburger menu floats independently on top of everything */}
      <HamburgerMenu
        onNewSession={handleNewSession}
        onSaveSession={() => setShowSaveModal(true)}
        onLoadSession={handleOpenLoadModal}
      />

      {/* Bottom metallic frame border */}
      <div className="bottom-frame-border"></div>

      {/* Column bottom bars */}
      <div className="left-column-bottom-bar"></div>
      <div className="right-column-bottom-bar"></div>

      {/* Offline Banner */}
      {!connected && !bannerDismissed && (
        <div className="offline-banner">
          <span className="offline-icon">&#x26A0;</span>
          <div className="offline-message">
            <strong>Server Disconnected</strong>
            <span className="offline-hint">Run <code>start.bat</code> (Windows) or <code>./start.sh</code> (Linux/Mac) to start the server</span>
          </div>
          <button
            className="offline-banner-close"
            onClick={() => setBannerDismissed(true)}
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      <main className="main-content">
        {/* Always render Chat in background */}
        <Chat />

        {/* Center Modal Overlays - positioned over middle section only */}
        <Routes>
          <Route path="/" element={null} />
          <Route path="/personas" element={
            <div className="center-modal-overlay">
              <Personas />
            </div>
          } />
          <Route path="/characters" element={
            <div className="center-modal-overlay">
              <Characters />
            </div>
          } />
          <Route path="/flows" element={<FlowEditor />} />
          <Route path="/screenplay" element={
            <div className="center-modal-overlay">
              <ScreenPlay />
            </div>
          } />
          <Route path="/settings" element={
            <div className="center-modal-overlay">
              <Settings />
            </div>
          } />
          <Route path="/settings/:tab" element={
            <div className="center-modal-overlay">
              <Settings />
            </div>
          } />
          <Route path="/help" element={
            <div className="center-modal-overlay">
              <Help />
            </div>
          } />
          <Route path="/help/:tab" element={
            <div className="center-modal-overlay">
              <Help />
            </div>
          } />
        </Routes>
      </main>

      {/* Terms of Service Modal */}
      {showTOS && (
        <div className="tos-overlay">
          <div className="tos-modal">
            <div className="tos-header">
              <h2>Terms of Service</h2>
            </div>
            <div className="tos-content">
              <pre className="tos-text">{TERMS_OF_SERVICE}</pre>
            </div>
            <div className="tos-footer">
              <p className="tos-agreement">
                By clicking "I Agree" you acknowledge that you have read, understood, and agree to the Terms of Service,
                and certify that you are at least 18 years of age.
              </p>
              <div className="tos-buttons">
                <button className="btn btn-danger tos-exit-btn" onClick={handleDeclineTOS}>
                  Exit
                </button>
                <button className="btn btn-primary tos-agree-btn" onClick={handleAcceptTOS}>
                  I Agree
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session Modals */}
      <SaveSessionModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSaveSession}
        defaultName={getDefaultSessionName()}
      />

      <LoadSessionModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onLoad={handleLoadSession}
        onSaveFirst={handleSaveSession}
        sessions={savedSessions}
        hasUnsavedChanges={hasUnsavedChanges}
        defaultSaveName={getDefaultSessionName()}
      />

      {/* New Session Modal */}
      {showNewSessionPopup && (
        <div className="modal-overlay" onClick={handleCancelNewSession}>
          <div className="modal new-session-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header new-session-header">
              <h3>New Session</h3>
              <button className="modal-close" onClick={handleCancelNewSession}>&times;</button>
            </div>

            <div className="modal-body new-session-body">
              <p className="new-session-subtitle">Set starting values for the new session</p>

              <div className="form-group">
                <div className="form-label-row">
                  <label>Starting Capacity</label>
                  <span className="form-value">{newSessionData.capacity}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={newSessionData.capacity}
                  onChange={(e) => setNewSessionData(prev => ({ ...prev, capacity: parseInt(e.target.value) }))}
                />
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label>Pain Level</label>
                  <span className="form-value">{newSessionData.pain}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={newSessionData.pain}
                  onChange={(e) => setNewSessionData(prev => ({ ...prev, pain: parseInt(e.target.value) }))}
                />
              </div>

              <div className="form-group">
                <label>Emotion</label>
                <div className="emotion-select-row">
                  <span className="emotion-preview">
                    {EMOTIONS.find(e => e.key === newSessionData.emotion)?.emoji}
                  </span>
                  <select
                    value={newSessionData.emotion}
                    onChange={(e) => setNewSessionData(prev => ({ ...prev, emotion: e.target.value }))}
                  >
                    {EMOTIONS.map(emotion => (
                      <option key={emotion.key} value={emotion.key}>
                        {emotion.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div className="form-label-row">
                  <label>Auto-Capacity Speed</label>
                  <span className="form-value">{newSessionData.capacityModifier.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="2"
                  step="0.25"
                  value={newSessionData.capacityModifier}
                  onChange={(e) => setNewSessionData(prev => ({ ...prev, capacityModifier: parseFloat(e.target.value) }))}
                />
                <div className="form-hint">Affects how fast capacity increases during auto-mode</div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCancelNewSession}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmNewSession}>
                Start Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
