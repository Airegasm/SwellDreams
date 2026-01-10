import React, { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import './Nodes.css';

function BranchNode({ data, selected }) {
  const [branches, setBranches] = useState(data.branches || [
    { label: 'Path A', weight: 50 },
    { label: 'Path B', weight: 50 }
  ]);

  const addBranch = () => {
    const newBranches = [...branches, { label: `Path ${String.fromCharCode(65 + branches.length)}`, weight: 0 }];
    setBranches(newBranches);
    data.onChange?.('branches', newBranches);
  };

  const updateBranch = (index, key, value) => {
    const newBranches = [...branches];
    newBranches[index][key] = value;
    setBranches(newBranches);
    data.onChange?.('branches', newBranches);
  };

  const removeBranch = (index) => {
    if (branches.length <= 2) return;
    const newBranches = branches.filter((_, i) => i !== index);
    setBranches(newBranches);
    data.onChange?.('branches', newBranches);
  };

  return (
    <div className={`custom-node branch-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-icon">⑃</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Branch"
        />
      </div>
      <div className="node-body">
        <div className="node-config">
          <div className="branch-type">
            <label>Type:</label>
            <select
              value={data.branchType || 'random'}
              onChange={(e) => data.onChange?.('branchType', e.target.value)}
              className="node-select"
            >
              <option value="random">Random (weighted)</option>
              <option value="sequential">Sequential</option>
            </select>
          </div>
          <div className="branches-list">
            {branches.map((branch, index) => (
              <div key={index} className="branch-item">
                <input
                  type="text"
                  value={branch.label}
                  onChange={(e) => updateBranch(index, 'label', e.target.value)}
                  className="node-input small"
                />
                {data.branchType !== 'sequential' && (
                  <>
                    <input
                      type="number"
                      value={branch.weight}
                      onChange={(e) => updateBranch(index, 'weight', parseInt(e.target.value))}
                      min={0}
                      max={100}
                      className="node-input tiny"
                    />
                    <span>%</span>
                  </>
                )}
                {branches.length > 2 && (
                  <button
                    className="branch-remove"
                    onClick={() => removeBranch(index)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="branch-add" onClick={addBranch}>
            + Add Branch
          </button>
        </div>
      </div>
      {branches.map((branch, index) => (
        <Handle
          key={index}
          type="source"
          position={Position.Bottom}
          id={`branch-${index}`}
          style={{ left: `${(index + 1) * (100 / (branches.length + 1))}%` }}
        />
      ))}
      <div className="handle-labels branch-labels">
        {branches.map((branch, index) => (
          <span
            key={index}
            className="handle-label"
            style={{ left: `${(index + 1) * (100 / (branches.length + 1))}%` }}
          >
            {branch.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(BranchNode);
