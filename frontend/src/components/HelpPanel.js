import React, { useState, useRef, useEffect } from 'react';
import GettingStartedTab from './help/GettingStartedTab';
import ConversationsTab from './help/ConversationsTab';
import SystemTab from './help/SystemTab';
import FlowTab from './help/FlowTab';
import ExternalApisTab from './help/ExternalApisTab';
import './HelpPanel.css';

const TABS = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'external-apis', label: 'External APIs' },
  { id: 'system', label: 'System' },
  { id: 'flow', label: 'Flow' }
];

function HelpPanel({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('getting-started');
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef(null);

  // Handle drag start
  const handleMouseDown = (e) => {
    if (e.target.closest('.help-panel-close') || e.target.closest('.help-panel-tabs') || e.target.closest('.help-panel-content')) {
      return;
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle drag move
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Reset position when opening
  useEffect(() => {
    if (isOpen) {
      // Center horizontally, offset from top
      const centerX = Math.max(100, (window.innerWidth - 700) / 2);
      setPosition({ x: centerX, y: 80 });
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={`help-panel ${isDragging ? 'dragging' : ''}`}
      style={{
        left: position.x,
        top: position.y
      }}
    >
      <div className="help-panel-header" onMouseDown={handleMouseDown}>
        <h2>Help</h2>
        <button className="help-panel-close" onClick={onClose} title="Close">
          &times;
        </button>
      </div>

      <div className="help-panel-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`help-panel-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="help-panel-content">
        {renderTabContent()}
      </div>
    </div>
  );
}

export default HelpPanel;
