import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { useError } from './context/ErrorContext';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import FlowEditor from './pages/FlowEditor';
import Help from './pages/Help';
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
  const { connected, api, controlMode, settings } = useApp();
  const { showError } = useError();
  const [stopping, setStopping] = useState(false);
  const [showTOS, setShowTOS] = useState(false);
  const [connectionProfiles, setConnectionProfiles] = useState([]);

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

  // Check if TOS was accepted this session
  useEffect(() => {
    const tosAccepted = sessionStorage.getItem('swelldreams_tos_accepted');
    if (!tosAccepted) {
      setShowTOS(true);
    }
  }, []);

  const handleAcceptTOS = () => {
    sessionStorage.setItem('swelldreams_tos_accepted', 'true');
    setShowTOS(false);
  };

  const handleDeclineTOS = () => {
    window.location.href = 'about:blank';
  };

  const handleEmergencyStop = async () => {
    setStopping(true);
    try {
      await api.emergencyStop();
    } catch (error) {
      console.error('Emergency stop failed:', error);
      showError('Emergency stop failed - check device connections!');
    }
    // Keep button disabled briefly to prevent double-clicks
    setTimeout(() => setStopping(false), 1000);
  };

  return (
    <div className="app">
      <nav className="nav-bar">
        <div className="nav-brand">
          <img src="/logo.png" alt="SwellDreams" />
          <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            {connected ? 'SD Server Live' : 'SD Server Offline'}
          </span>
          <span className={`connection-status ${isLlmConfigured() ? 'llm-connected' : 'llm-disconnected'}`}>
            {isLlmConfigured()
              ? `LLM: ${getActiveProfileName() || 'Connected'}`
              : 'No LLM Connected'}
          </span>
        </div>
        {controlMode === 'simulated' ? (
          <div
            className="simulation-mode-indicator"
            title="Simulation Mode - Device actions are simulated"
          >
            SIMULATION MODE
          </div>
        ) : (
          <button
            className="emergency-stop-btn"
            onClick={handleEmergencyStop}
            disabled={stopping}
            title="Emergency Stop - Immediately stops all pumps and cycles"
          >
            {stopping ? 'STOPPING...' : 'EMERGENCY STOP'}
          </button>
        )}
        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>
            Chat
          </NavLink>
          <NavLink to="/flows" className={({ isActive }) => isActive ? 'active' : ''}>
            Flows
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
            Settings
          </NavLink>
          <NavLink to="/help" className={({ isActive }) => isActive ? 'active' : ''}>
            Help
          </NavLink>
        </div>
      </nav>

      {/* Offline Banner */}
      {!connected && (
        <div className="offline-banner">
          <span className="offline-icon">&#x26A0;</span>
          <span>Backend Disconnected - Attempting to reconnect...</span>
        </div>
      )}

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/flows" element={<FlowEditor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:tab" element={<Settings />} />
          <Route path="/help" element={<Help />} />
          <Route path="/help/:tab" element={<Help />} />
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
    </div>
  );
}

export default App;
