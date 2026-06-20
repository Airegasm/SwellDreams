import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DictionaryManager from '../components/settings/DictionaryManager';
import './Settings.css';

// Standalone Dictionary page (global lorebook). Mirrors the Triggers/Settings modal-page chrome
// (entrance/exit animation + HamburgerMenu exit-modal handshake) and hosts the existing
// DictionaryManager — the same CRUD/import UI that previously lived inside the Global settings tab.
function Dictionary() {
  const navigate = useNavigate();
  const [animationState, setAnimationState] = useState('entering');
  const isExiting = useRef(false);

  // Entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setAnimationState('entered'), 50);
    return () => clearTimeout(timer);
  }, []);

  // Exit-modal event (from HamburgerMenu) — animate out, then navigate to the requested path.
  useEffect(() => {
    const handleExitModal = (event) => {
      if (isExiting.current) return;
      isExiting.current = true;
      const targetPath = event.detail?.path || '/';
      setAnimationState('exiting');
      setTimeout(() => navigate(targetPath), 500);
    };
    window.addEventListener('exit-modal', handleExitModal);
    return () => window.removeEventListener('exit-modal', handleExitModal);
  }, [navigate]);

  const close = () => {
    if (isExiting.current) return;
    isExiting.current = true;
    setAnimationState('exiting');
    setTimeout(() => navigate('/'), 500);
  };

  return (
    <>
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>
      <div className={`settings-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>Dictionary</h1>
          <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={close}>Close</button>
        </div>
        <div className="settings-tab-content" style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
          <DictionaryManager />
        </div>
      </div>
    </>
  );
}

export default Dictionary;
