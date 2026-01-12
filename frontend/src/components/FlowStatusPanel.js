import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import './FlowStatusPanel.css';

export default function FlowStatusPanel() {
  const { flowExecutions, sessionState, playerChoiceData, challengeData, infiniteCycles } = useApp();
  const [expanded, setExpanded] = useState(false);

  // Check for additional "active" indicators beyond EventEngine tracking
  const hasActiveCycles = infiniteCycles && Object.keys(infiniteCycles).length > 0;
  const isLlmGenerating = sessionState?.isGenerating;
  const hasPendingChoice = !!playerChoiceData;
  const hasPendingChallenge = !!challengeData;

  // Total active count
  const activeCount = flowExecutions.length;
  const isActive = activeCount > 0 || hasActiveCycles || isLlmGenerating || hasPendingChoice || hasPendingChallenge;

  // Format trigger type for display
  const formatTriggerType = (type) => {
    if (!type) return '';
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Get header text
  const getHeaderText = () => {
    if (!isActive) return 'Flow: Idle';
    if (activeCount > 0) return `Active Flows (${activeCount})`;
    // Fallback for async ops without tracked execution
    if (isLlmGenerating) return 'Flow: Active (1)';
    if (hasPendingChoice) return 'Flow: Active (1)';
    if (hasPendingChallenge) return 'Flow: Active (1)';
    if (hasActiveCycles) return 'Flow: Active (1)';
    return 'Flow: Idle';
  };

  // Get status line for a flow execution
  const getFlowStatus = (execution) => {
    // Check for async operations on this specific flow
    if (isLlmGenerating) return 'Generating response...';
    if (hasPendingChoice) return 'Waiting for player choice...';
    if (hasPendingChallenge) return 'Challenge in progress...';
    return execution.currentNodeLabel || 'Running...';
  };

  // Limit displayed flows to 3
  const displayedFlows = flowExecutions.slice(0, 3);

  return (
    <div className={`flow-status-panel ${expanded ? 'expanded' : ''}`}>
      <button
        className="flow-panel-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`flow-indicator ${isActive ? 'active' : 'idle'}`} />
        <span className="flow-header-text">{getHeaderText()}</span>
        <span className={`flow-chevron ${expanded ? 'expanded' : ''}`}>›</span>
      </button>

      {expanded && (
        <div className="flow-panel-content">
          {!isActive ? (
            <div className="flow-item idle">
              <span className="flow-listening">Listening for triggers...</span>
            </div>
          ) : activeCount === 0 ? (
            // Show async operation without tracked execution
            <div className="flow-item">
              <div className="flow-item-header">
                <span className="flow-trigger">Async Operation</span>
              </div>
              <span className="flow-node">
                {isLlmGenerating && 'Generating response...'}
                {hasPendingChoice && 'Waiting for player choice...'}
                {hasPendingChallenge && 'Challenge in progress...'}
                {hasActiveCycles && 'Device cycle running...'}
              </span>
            </div>
          ) : (
            displayedFlows.map((execution, index) => (
              <div key={execution.flowId} className="flow-item">
                <span className="flow-trigger">
                  {formatTriggerType(execution.triggerType)}: {execution.triggerLabel}
                </span>
                <span className="flow-node">{getFlowStatus(execution)}</span>
              </div>
            ))
          )}
          {activeCount > 3 && (
            <div className="flow-more">+{activeCount - 3} more flows...</div>
          )}
        </div>
      )}
    </div>
  );
}
