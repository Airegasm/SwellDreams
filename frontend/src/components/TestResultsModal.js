import React, { useState, useEffect } from 'react';
import '../pages/FlowEditor.css';

// Individual step display component
function TestStep({ step, index }) {
  const getStepIcon = () => {
    switch (step.type) {
      case 'test_start': return '▶';
      case 'test_complete': return '✓';
      case 'node':
        if (step.nodeType === 'trigger' || step.nodeType === 'button_press') return '⚡';
        if (step.nodeType === 'action') return '▶';
        if (step.nodeType === 'condition') return '?';
        if (step.nodeType === 'branch') return '⑃';
        if (step.nodeType === 'delay') return '⏱';
        if (step.nodeType === 'player_choice' || step.nodeType === 'simple_ab') return '⚐';
        return '◆';
      case 'broadcast': return '📢';
      case 'state_change': return '↑';
      case 'condition': return step.result ? '✓' : '✗';
      case 'challenge': return '🎲';
      case 'choice': return '❓';
      case 'choice_selected': return '✓';
      case 'device': return '⚡';
      case 'pending_completion': return '⏳';
      case 'error': return '✗';
      default: return '•';
    }
  };

  const getStepClass = () => {
    switch (step.type) {
      case 'test_start': return 'step-start';
      case 'test_complete': return 'step-complete';
      case 'error': return 'step-error';
      case 'state_change': return 'step-state';
      case 'challenge': return 'step-challenge';
      case 'choice':
      case 'choice_selected': return 'step-choice';
      case 'device': return 'step-device';
      case 'broadcast': return 'step-broadcast';
      case 'pending_completion': return 'step-pending';
      default: return '';
    }
  };

  return (
    <div className={`test-step ${getStepClass()}`}>
      <span className="step-number">{index + 1}</span>
      <span className="step-icon">{getStepIcon()}</span>
      <div className="step-content">
        <div className="step-label">{step.label}</div>
        {step.details && <div className="step-details">{step.details}</div>}
        {step.stateChange && (
          <div className="step-state-change">
            {Object.entries(step.stateChange).map(([key, change]) => (
              <span key={key} className="state-change-item">
                {key}: {change.from} → {change.to}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Mock state display with animated gauges
function TestStateDisplay({ testState, animating }) {
  const capacity = testState?.capacity ?? 0;
  const pain = testState?.pain ?? 0;
  const emotion = testState?.emotion ?? 'neutral';

  return (
    <div className="test-state-display">
      <div className="test-gauge">
        <label>Capacity</label>
        <div className="gauge-bar">
          <div
            className={`gauge-fill capacity ${animating ? 'animating' : ''}`}
            style={{ width: `${capacity}%` }}
          />
        </div>
        <span className="gauge-value">{capacity}%</span>
      </div>
      <div className="test-gauge">
        <label>Pain</label>
        <div className="gauge-bar pain">
          <div
            className={`gauge-fill ${animating ? 'animating' : ''}`}
            style={{ width: `${pain * 10}%` }}
          />
        </div>
        <span className="gauge-value">{pain}/10</span>
      </div>
      <div className="test-emotion">
        <label>Emotion</label>
        <span className={`emotion-value emotion-${emotion}`}>{emotion}</span>
      </div>
    </div>
  );
}

function TestResultsModal({ isOpen, onClose, results, loading }) {
  const [animatedState, setAnimatedState] = useState({ capacity: 0, pain: 0, emotion: 'neutral' });
  const [isAnimating, setIsAnimating] = useState(false);

  // Animate state changes when results come in
  useEffect(() => {
    if (!results?.steps) return;

    // Find final state from state changes
    let finalState = { capacity: 0, pain: 0, emotion: 'neutral' };
    results.steps.forEach(step => {
      if (step.stateChange) {
        Object.entries(step.stateChange).forEach(([key, change]) => {
          finalState[key] = change.to;
        });
      }
    });

    // Animate to final state
    setIsAnimating(true);
    const duration = 500;
    const startTime = Date.now();
    const startState = { ...animatedState };

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      setAnimatedState({
        capacity: Math.round(startState.capacity + (finalState.capacity - startState.capacity) * eased),
        pain: Math.round(startState.pain + (finalState.pain - startState.pain) * eased),
        emotion: progress >= 0.5 ? finalState.emotion : startState.emotion
      });

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
      }
    };

    requestAnimationFrame(animate);
  }, [results]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAnimatedState({ capacity: 0, pain: 0, emotion: 'neutral' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const stepCount = results?.steps?.length || 0;
  const hasError = results?.success === false;

  return (
    <div className="test-modal-overlay" onClick={onClose}>
      <div className="test-modal" onClick={(e) => e.stopPropagation()}>
        <div className="test-modal-header">
          <h3>Flow Test Results</h3>
          <button className="test-modal-close" onClick={onClose}>×</button>
        </div>

        <TestStateDisplay testState={animatedState} animating={isAnimating} />

        <div className="test-modal-body">
          {loading ? (
            <div className="test-loading">
              <div className="test-spinner"></div>
              <span>Running test...</span>
            </div>
          ) : results ? (
            <div className="test-steps">
              {results.steps?.map((step, i) => (
                <TestStep key={i} step={step} index={i} />
              ))}
              {hasError && results.error && (
                <div className="test-error-message">
                  Error: {results.error}
                </div>
              )}
            </div>
          ) : (
            <div className="test-empty">No test results yet</div>
          )}
        </div>

        <div className="test-modal-footer">
          <span className="test-step-count">
            {stepCount} step{stepCount !== 1 ? 's' : ''} executed
            {hasError && ' (with errors)'}
          </span>
          <button className="test-modal-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default TestResultsModal;
