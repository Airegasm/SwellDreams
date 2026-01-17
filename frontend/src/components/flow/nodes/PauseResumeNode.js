import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function PauseResumeNode({ data, selected }) {
  return (
    <div className={`custom-node pause-resume-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">||</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Pause/Resume"
        />
        <button
          className="node-test-btn"
          onClick={(e) => { e.stopPropagation(); data.onTest?.(); }}
          title="Test from this node"
        >
          Test
        </button>
      </div>
      <div className="node-body">
        <div className="node-config">
          <div className="pause-resume-config">
            <div className="form-group inline">
              <label>Resume after</label>
              <input
                type="number"
                min="1"
                max="100"
                value={data.resumeAfterValue || 4}
                onChange={(e) => data.onChange?.('resumeAfterValue', parseInt(e.target.value) || 1)}
                className="node-input narrow"
              />
              <select
                value={data.resumeAfterType || 'messages'}
                onChange={(e) => data.onChange?.('resumeAfterType', e.target.value)}
                className="node-select"
              >
                <option value="messages">messages</option>
              </select>
            </div>
          </div>
          <div className="pause-resume-description">
            <small>PAUSE output executes immediately. RESUME output executes after the specified number of messages.</small>
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-pause"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-resume"
        style={{ left: '70%' }}
      />
      <div className="handle-labels ab-labels">
        <span className="handle-label" style={{ left: '30%' }}>PAUSE</span>
        <span className="handle-label" style={{ left: '70%' }}>RESUME</span>
      </div>
    </div>
  );
}

export default memo(PauseResumeNode);
