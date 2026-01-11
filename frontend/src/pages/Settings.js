import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ModelTab from '../components/settings/ModelTab';
import GlobalTab from '../components/settings/GlobalTab';
import DeviceTab from '../components/settings/DeviceTab';
import './Settings.css';

const TABS = [
  { id: 'model', label: 'Model' },
  { id: 'global', label: 'Global' },
  { id: 'devices', label: 'Devices' }
];

function Settings() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab || 'model');

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    navigate(`/settings/${tabId}`);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'model':
        return <ModelTab />;
      case 'global':
        return <GlobalTab />;
      case 'devices':
        return <DeviceTab />;
      default:
        return <ModelTab />;
    }
  };

  return (
    <div className="settings-page page">
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
  );
}

export default Settings;
