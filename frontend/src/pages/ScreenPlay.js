import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './ScreenPlay.css';

function ScreenPlay() {
  const navigate = useNavigate();
  const [animationState, setAnimationState] = useState('entering');
  const isExiting = useRef(false);

  // Trigger enter animation after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationState('entered');
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Listen for exit-modal event from HamburgerMenu
  useEffect(() => {
    const handleExitModal = (event) => {
      if (isExiting.current) return;
      isExiting.current = true;
      const targetPath = event.detail?.path || '/';
      setAnimationState('exiting');
      setTimeout(() => {
        navigate(targetPath);
      }, 500);
    };

    window.addEventListener('exit-modal', handleExitModal);
    return () => window.removeEventListener('exit-modal', handleExitModal);
  }, [navigate]);

  const handleClose = () => {
    if (isExiting.current) return;
    isExiting.current = true;
    setAnimationState('exiting');
    // Wait for exit animation to complete before navigating
    setTimeout(() => {
      navigate('/');
    }, 500);
  };

  return (
    <>
      {/* Sidebar dimming that animates with page */}
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>

      {/* Film strip overlays - render outside the modal */}
      <div className={`filmstrip-overlay ${animationState}`}>
        <div className="filmstripleft">
          <img src="/filmstrip.png" alt="" />
        </div>
        <div className="filmstripright">
          <img src="/filmstrip.png" alt="" />
        </div>
      </div>

      {/* Standard page content with slide-down animation */}
      <div className={`screenplay-page page slide-down ${animationState}`}>
        <div className="page-header">
          <h1>ScreenPlay</h1>
          <button className="header-close-btn" onClick={handleClose} title="Back to Chat">
            &times;
          </button>
        </div>

        <div className="screenplay-content">
          <div className="screenplay-placeholder">
            <p>ScreenPlay editor coming soon...</p>
          </div>
        </div>
      </div>
    </>
  );
}

export default ScreenPlay;
