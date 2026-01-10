import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import GettingStartedTab from '../components/help/GettingStartedTab';
import SystemTab from '../components/help/SystemTab';
import FlowTab from '../components/help/FlowTab';
import './Help.css';

const TABS = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'system', label: 'System' },
  { id: 'flow', label: 'Flow' }
];

function Help() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(tab || 'getting-started');

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    navigate(`/help/${tabId}`);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'getting-started':
        return <GettingStartedTab />;
      case 'system':
        return <SystemTab />;
      case 'flow':
        return <FlowTab />;
      default:
        return <GettingStartedTab />;
    }
  };

  return (
    <div className="help-page page">
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

export default Help;
