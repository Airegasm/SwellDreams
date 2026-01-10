import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import GettingStartedTab from '../components/help/GettingStartedTab';
import ConversationsTab from '../components/help/ConversationsTab';
import SystemTab from '../components/help/SystemTab';
import FlowTab from '../components/help/FlowTab';
import ExternalApisTab from '../components/help/ExternalApisTab';
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
