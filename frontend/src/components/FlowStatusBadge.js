import React from 'react';
import { useApp } from '../context/AppContext';
import './FlowStatusBadge.css';

export default function FlowStatusBadge() {
  const { flowExecutionState, sessionState, playerChoiceData, challengeData, infiniteCycles } = useApp();
  const {
    isActive: flowIsActive,
    triggerType,
    triggerLabel,
    currentNodeLabel,
    isPaused,
    pauseReason,
    isResuming,
    resumingAt
  } = flowExecutionState;

  // Flow is considered active if:
  // 1. EventEngine says it's executing, OR
  // 2. LLM is generating (triggered by flow), OR
  // 3. Player choice/challenge modal is pending, OR
  // 4. Device cycles are running
  const hasActiveCycles = infiniteCycles && Object.keys(infiniteCycles).length > 0;
  const isActive = flowIsActive || sessionState?.isGenerating || playerChoiceData || challengeData || hasActiveCycles;

  // Determine badge state class
  const getStatusClass = () => {
    if (isPaused) return 'paused';
    if (isResuming) return 'resuming';
    if (isActive) return 'active';
    return 'idle';
  };

  // Format trigger type for display
  const formatTriggerType = (type) => {
    if (!type) return '';
    // Convert snake_case to Title Case
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  // Top line text
  const getTopLine = () => {
    if (isPaused) return `Paused @ ${currentNodeLabel || 'unknown'}:`;
    if (isResuming) return 'Attempting resume at';
    if (isActive) return `Flow: ${formatTriggerType(triggerType)} ${triggerLabel || ''}`;
    return 'Flow Idle';
  };

  // Bottom line text
  const getBottomLine = () => {
    if (isPaused) return pauseReason || 'Unknown';
    if (isResuming) return resumingAt || currentNodeLabel || 'unknown';
    if (isActive) {
      // Show specific status for async operations
      if (sessionState?.isGenerating) return 'Generating response...';
      if (playerChoiceData) return 'Waiting for player choice...';
      if (challengeData) return 'Challenge in progress...';
      if (hasActiveCycles) return 'Device cycle running...';
      return currentNodeLabel || 'Starting...';
    }
    return 'Listening...';
  };

  return (
    <div className={`flow-status-badge ${getStatusClass()}`}>
      <div className={`status-indicator ${getStatusClass()}`} />
      <div className="status-text">
        <span className="top-line">{getTopLine()}</span>
        <span className="bottom-line">{getBottomLine()}</span>
      </div>
    </div>
  );
}
