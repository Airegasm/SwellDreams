import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CharacterTab from '../components/settings/CharacterTab';
import PersonaTab from '../components/settings/PersonaTab';
import './Settings.css';

const TABS = [
  { id: 'characters', label: 'Characters' },
  { id: 'personas', label: 'Personas' },
];

function CharactersPersonas() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab || 'characters');
  const [animationState, setAnimationState] = useState('entering');
  const isExiting = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationState('entered');
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [tab, activeTab]);

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

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    navigate(`/characters-personas/${tabId}`);
  };

  const title =
    activeTab === 'personas'
      ? 'Personas - Experience Pressure From Any Perspective'
      : 'Characters - Bringing Fantasy Inflators to Life';

  return (
    <>
      {/* Sidebar dimming that animates with page */}
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>
      <div className={`settings-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>{title}</h1>
          <button className="header-close-btn" onClick={handleClose} title="Back to Chat">
            &times;
          </button>
        </div>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => handleTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tab-content">
          {activeTab === 'personas' ? <PersonaTab /> : <CharacterTab />}
        </div>
      </div>
    </>
  );
}

export default CharactersPersonas;
