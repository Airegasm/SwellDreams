import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import CharacterTab from '../components/settings/CharacterTab';
import InstructorSettingsTab from '../components/settings/InstructorSettingsTab';
import './Settings.css';

const CHARACTER_TABS = [
  { id: 'select', label: 'Character Select' },
  { id: 'instructor', label: 'Instructor Settings' },
];

function Characters() {
  const navigate = useNavigate();
  const [animationState, setAnimationState] = useState('entering');
  const [activeTab, setActiveTab] = useState('select');
  const isExiting = useRef(false);

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
      <div className={`settings-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>Characters - Bringing Fantasy Inflators to Life</h1>
          <button className="header-close-btn" onClick={handleClose} title="Back to Chat">
            &times;
          </button>
        </div>
        <div className="tabs">
          {CHARACTER_TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tab-content">
          {activeTab === 'select' ? <CharacterTab /> : <InstructorSettingsTab />}
        </div>
      </div>
    </>
  );
}

export default Characters;
