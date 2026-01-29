import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ImagesTab from '../components/media/ImagesTab';
import VideosTab from '../components/media/VideosTab';
import AudioTab from '../components/media/AudioTab';
import './Settings.css';
import './MediaAlbum.css';

const TABS = [
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' }
];

function MediaAlbum() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab || 'images');
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
    navigate(`/media-album/${tabId}`);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'images':
        return <ImagesTab />;
      case 'videos':
        return <VideosTab />;
      case 'audio':
        return <AudioTab />;
      default:
        return <ImagesTab />;
    }
  };

  return (
    <>
      <div className={`modal-sidebar-dimming ${animationState}`}>
        <div className="modal-dim-left" />
        <div className="modal-dim-right" />
      </div>
      <div className={`settings-page page modal-slide-down ${animationState}`}>
        <div className="page-header">
          <h1>Media Album</h1>
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

export default MediaAlbum;
