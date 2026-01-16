import React, { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

// Capacity range definitions
const CAPACITY_RANGES = [
  { id: 'range_0_10', label: '0-10%', min: 0, max: 10 },
  { id: 'range_11_20', label: '11-20%', min: 11, max: 20 },
  { id: 'range_21_30', label: '21-30%', min: 21, max: 30 },
  { id: 'range_31_40', label: '31-40%', min: 31, max: 40 },
  { id: 'range_41_50', label: '41-50%', min: 41, max: 50 },
  { id: 'range_51_60', label: '51-60%', min: 51, max: 60 },
  { id: 'range_61_70', label: '61-70%', min: 61, max: 70 },
  { id: 'range_71_80', label: '71-80%', min: 71, max: 80 },
  { id: 'range_81_90', label: '81-90%', min: 81, max: 90 },
  { id: 'range_91_100', label: '91-100%', min: 91, max: 100 },
  { id: 'range_over_100', label: '>100%', min: 101, max: Infinity },
];

function CapacityMessageNode({ data, selected }) {
  const isPlayerMessage = data.messageType === 'player';
  const nodeIcon = isPlayerMessage ? '👤' : '🤖';
  const nodeClass = isPlayerMessage ? 'capacity-player-message-node' : 'capacity-ai-message-node';

  // Get ranges data from node data
  const ranges = data.ranges || {};

  // Calculate enabled outputs for handle positioning
  const enabledOutputs = useMemo(() => {
    return CAPACITY_RANGES.filter(range => ranges[range.id]?.enableOutput);
  }, [ranges]);

  // Update a range field
  const updateRange = (rangeId, field, value) => {
    const currentRanges = data.ranges || {};
    const currentRange = currentRanges[rangeId] || {};
    data.onChange?.('ranges', {
      ...currentRanges,
      [rangeId]: {
        ...currentRange,
        [field]: value
      }
    });
  };

  // Calculate output handle positions
  const getOutputHandleStyle = (index, total) => {
    // Global output is always at 15%, then enabled range outputs spread across the rest
    const startPercent = 25;
    const endPercent = 95;
    const spacing = (endPercent - startPercent) / Math.max(total, 1);
    return { left: `${startPercent + (index * spacing)}%` };
  };

  return (
    <div className={`custom-node ${nodeClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />

      <div className="node-header">
        <span className="node-icon">{nodeIcon}</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder={isPlayerMessage ? 'Capacity Player Message' : 'Capacity AI Message'}
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>

      <div className="node-body capacity-message-body">
        {/* Global Settings */}
        <div className="capacity-global-settings">
          <label className="node-checkbox">
            <input
              type="checkbox"
              checked={data.suppressLlm || false}
              onChange={(e) => data.onChange?.('suppressLlm', e.target.checked)}
            />
            Suppress LLM Enhancement
          </label>
          <div className="config-row">
            <label>Post Delay:</label>
            <input
              type="number"
              value={data.postDelay ?? 3}
              onChange={(e) => data.onChange?.('postDelay', parseFloat(e.target.value) || 0)}
              min={0}
              step={0.5}
              className="node-input small"
            />
            <span>s</span>
          </div>
        </div>

        {/* Capacity Range Fields */}
        <div className="capacity-ranges-container">
          {CAPACITY_RANGES.map((range) => {
            const rangeData = ranges[range.id] || {};
            return (
              <div key={range.id} className="capacity-range-row">
                <div className="capacity-range-header">
                  <span className="capacity-range-label">{range.label}</span>
                  <label className="node-checkbox small">
                    <input
                      type="checkbox"
                      checked={rangeData.enableOutput || false}
                      onChange={(e) => updateRange(range.id, 'enableOutput', e.target.checked)}
                    />
                    <span className="output-label">Output</span>
                  </label>
                </div>
                <textarea
                  value={rangeData.message || ''}
                  onChange={(e) => updateRange(range.id, 'message', e.target.value)}
                  placeholder={`Message for ${range.label}...`}
                  className="node-textarea capacity-textarea"
                  rows={1}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Output Handles */}
      {/* Global output - always present */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="global"
        style={{ left: '10%' }}
      />

      {/* Range-specific outputs - only when enabled */}
      {enabledOutputs.map((range, index) => (
        <Handle
          key={range.id}
          type="source"
          position={Position.Bottom}
          id={range.id}
          style={getOutputHandleStyle(index, enabledOutputs.length)}
        />
      ))}

      {/* Output Labels */}
      <div className="handle-labels capacity-handle-labels">
        <span className="handle-label" style={{ left: '10%' }}>Global</span>
        {enabledOutputs.map((range, index) => (
          <span
            key={range.id}
            className="handle-label"
            style={getOutputHandleStyle(index, enabledOutputs.length)}
          >
            {range.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(CapacityMessageNode);
