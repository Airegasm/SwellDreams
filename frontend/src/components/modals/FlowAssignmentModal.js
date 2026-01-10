import React, { useState, useEffect } from 'react';
import './SessionModals.css';

function FlowAssignmentModal({
  isOpen,
  onClose,
  onSave,
  flows,
  assignedFlowIds,
  category,
  title
}) {
  const [selectedFlows, setSelectedFlows] = useState([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedFlows(assignedFlowIds || []);
    }
  }, [isOpen, assignedFlowIds]);

  if (!isOpen) return null;

  // Filter flows by category
  const filteredFlows = flows.filter(f => f.category === category);

  const handleToggle = (flowId) => {
    setSelectedFlows(prev => {
      if (prev.includes(flowId)) {
        return prev.filter(id => id !== flowId);
      } else {
        return [...prev, flowId];
      }
    });
  };

  const handleSave = () => {
    onSave(selectedFlows);
    onClose();
  };

  const handleCancel = () => {
    setSelectedFlows(assignedFlowIds || []);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal session-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>
        <div className="modal-body">
          {filteredFlows.length === 0 ? (
            <p className="text-muted">No {category} flows available. Create one in the Flows editor.</p>
          ) : (
            <div className="flow-assignment-list">
              {filteredFlows.map(flow => (
                <label key={flow.id} className="flow-assignment-item">
                  <input
                    type="checkbox"
                    checked={selectedFlows.includes(flow.id)}
                    onChange={() => handleToggle(flow.id)}
                  />
                  <span className="flow-name">{flow.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default FlowAssignmentModal;
