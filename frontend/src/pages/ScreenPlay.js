import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PlaysTab from '../components/screenplay/PlaysTab';
import ActorsTab from '../components/screenplay/ActorsTab';
import StoryboardTab from '../components/screenplay/StoryboardTab';
import ControlsTab from '../components/screenplay/ControlsTab';
import './ScreenPlay.css';

const TABS = [
  { id: 'plays', label: 'Plays' },
  { id: 'actors', label: 'Actors' },
  { id: 'storyboard', label: 'Storyboard' },
  { id: 'controls', label: 'Controls' }
];

function ScreenPlay() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab || 'plays');
  const [animationState, setAnimationState] = useState('entering');
  const isExiting = useRef(false);

  // State for currently editing play (passed to Storyboard)
  const [editingPlayId, setEditingPlayId] = useState(null);

  // Trigger enter animation after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationState('entered');
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Sync activeTab with URL param when it changes
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
    navigate(`/screenplay/${tabId}`);
  };

  // Handler for editing a play from PlaysTab
  const handleEditPlay = (playId) => {
    setEditingPlayId(playId);
    handleTabChange('storyboard');
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'plays':
        return <PlaysTab onEditPlay={handleEditPlay} />;
      case 'actors':
        return <ActorsTab />;
      case 'storyboard':
        return <StoryboardTab editingPlayId={editingPlayId} setEditingPlayId={setEditingPlayId} />;
      case 'controls':
        return <ControlsTab />;
      default:
        return <PlaysTab onEditPlay={handleEditPlay} />;
    }
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
          {renderTabContent()}
        </div>
      </div>
    </>
  );
}

export default ScreenPlay;
