import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import GettingStartedTab from '../components/help/GettingStartedTab';
import ConversationsTab from '../components/help/ConversationsTab';
import SystemTab from '../components/help/SystemTab';
import FlowTab from '../components/help/FlowTab';
import ExternalApisTab from '../components/help/ExternalApisTab';
import './Settings.css';
import './Help.css';

const TABS = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'external-apis', label: 'External APIs' },
  { id: 'system', label: 'System' },
  { id: 'flow', label: 'Flow' }
];

function Help() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab || 'getting-started');
  const [animationState, setAnimationState] = useState('entering');
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

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    navigate(`/help/${tabId}`);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'getting-started':
        return <GettingStartedTab />;
      case 'conversations':
        return <ConversationsTab />;
      case 'external-apis':
        return <ExternalApisTab />;
      case 'system':
        return <SystemTab />;
      case 'flow':
        return <FlowTab />;
      default:
        return <GettingStartedTab />;
    }
  };

  return (
    <>
      {/* Sidebar dimming that animates with page */}
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>
      <div className={`help-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>Help</h1>
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

export default Help;
