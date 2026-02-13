import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useDraft, getDraftKey } from '../../hooks/useDraft';
import { STAGED_PORTRAIT_RANGES } from '../../utils/stagedPortraits';
import './PersonaEditorModal.css';

function PersonaEditorModal({ isOpen, onClose, onSave, persona }) {
  const { flows, devices } = useApp();

  // Helper to filter out flow IDs that no longer exist
  const validFlowIds = useMemo(() => new Set((flows || []).map(f => f.id)), [flows]);
  const filterValidFlows = useCallback((flowIds) => {
    if (!flowIds || !Array.isArray(flowIds)) return [];
    return flowIds.filter(id => validFlowIds.has(id));
  }, [validFlowIds]);

  // Calculate initial data from persona prop
  const initialData = useMemo(() => {
    if (persona) {
      return {
        displayName: persona.displayName || '',
        pronouns: persona.pronouns || 'they/them',
        appearance: persona.appearance || '',
        personality: persona.personality || '',
        relationshipWithInflation: persona.relationshipWithInflation || '',
        avatar: persona.avatar || '',
        stagedPortraits: persona.stagedPortraits || {},
        // New fields for buttons and flows
        assignedFlows: filterValidFlows(persona.assignedFlows),
        buttons: persona.buttons || [],
        assignedButtons: persona.assignedButtons || []
      };
    }
    // New persona defaults
    return {
      displayName: '',
      pronouns: 'they/them',
      appearance: '',
      personality: '',
      relationshipWithInflation: '',
      avatar: '',
      stagedPortraits: {},
      assignedFlows: [],
      buttons: [],
      assignedButtons: []
    };
  }, [persona, filterValidFlows]);

  // Use draft persistence - survives accidental modal dismissal
  const draftKey = getDraftKey('persona', persona?.id);
  const { formData, setFormData, clearDraft, hasDraft } = useDraft(draftKey, initialData, isOpen);

  // Tab state
  const [activeTab, setActiveTab] = useState('basic');

  // Button management state
  const [showButtonForm, setShowButtonForm] = useState(false);
  const [editingButtonId, setEditingButtonId] = useState(null);
  const [buttonForm, setButtonForm] = useState({ name: '', buttonId: null, actions: [], enabled: true });

  // Dropdown selections
  const [selectedFlowToAdd, setSelectedFlowToAdd] = useState('');
  const [selectedButtonToAdd, setSelectedButtonToAdd] = useState('');

  const [showCropModal, setShowCropModal] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);
  const fileInputRef = React.useRef(null);

  // Staged portraits state
  const [stagedCropModal, setStagedCropModal] = useState(false);
  const [stagedUploadedImage, setStagedUploadedImage] = useState(null);
  const [currentStagedRange, setCurrentStagedRange] = useState(null);
  const stagedFileInputRefs = useRef({});

  // Memoize computed values
  const buttons = useMemo(() => formData.buttons || [], [formData.buttons]);

  // Memoize dropdown options to prevent closing on re-render
  const availableFlows = useMemo(() => {
    if (!flows) return [];
    const assignedFlows = formData.assignedFlows || [];
    return flows.filter(f => !assignedFlows.includes(f.id));
  }, [flows, formData.assignedFlows]);

  const availableButtons = useMemo(() => {
    const assignedButtons = formData.assignedButtons || [];
    return buttons.filter(b => !assignedButtons.includes(b.buttonId));
  }, [buttons, formData.assignedButtons]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.displayName.trim()) {
      alert('Display name is required');
      return;
    }

    // Clear draft on successful save
    clearDraft();
    onSave(formData);
  };

  const handleCancel = () => {
    onClose();
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      // Always show resize modal to fit to 3:4 portrait aspect ratio
      setUploadedImage(event.target.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropSave = (croppedImageData) => {
    setFormData({ ...formData, avatar: croppedImageData });
    setShowCropModal(false);
    setUploadedImage(null);
  };

  const handleCropCancel = () => {
    setShowCropModal(false);
    setUploadedImage(null);
  };

  // Staged portrait handlers
  const handleStagedImageClick = (rangeId) => {
    stagedFileInputRefs.current[rangeId]?.click();
  };

  const handleStagedImageUpload = (e, rangeId) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setStagedUploadedImage(event.target.result);
      setCurrentStagedRange(rangeId);
      setStagedCropModal(true);
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be selected again
    e.target.value = '';
  };

  const handleStagedCropSave = (croppedImageData) => {
    if (!currentStagedRange) return;
    setFormData({
      ...formData,
      stagedPortraits: {
        ...formData.stagedPortraits,
        [currentStagedRange]: croppedImageData
      }
    });
    setStagedCropModal(false);
    setStagedUploadedImage(null);
    setCurrentStagedRange(null);
  };

  const handleStagedCropCancel = () => {
    setStagedCropModal(false);
    setStagedUploadedImage(null);
    setCurrentStagedRange(null);
  };

  const handleRemoveStagedPortrait = (rangeId) => {
    const updatedPortraits = { ...formData.stagedPortraits };
    delete updatedPortraits[rangeId];
    setFormData({
      ...formData,
      stagedPortraits: updatedPortraits
    });
  };

  // Flow assignment handlers
  const handleAddFlow = () => {
    if (!selectedFlowToAdd) return;

    const currentFlows = formData.assignedFlows || [];
    if (currentFlows.includes(selectedFlowToAdd)) return;

    // Find buttons created by this flow
    const flowButtons = buttons.filter(b => b.sourceFlowId === selectedFlowToAdd);
    const flowButtonIds = flowButtons.map(b => b.buttonId);

    const currentButtons = formData.assignedButtons || [];
    const newButtons = [...currentButtons, ...flowButtonIds.filter(id => !currentButtons.includes(id))];

    setFormData({
      ...formData,
      assignedFlows: [...currentFlows, selectedFlowToAdd],
      assignedButtons: newButtons
    });
    setSelectedFlowToAdd('');
  };

  const handleRemoveFlow = (flowId) => {
    const currentFlows = formData.assignedFlows || [];

    // Find buttons created by this flow
    const flowButtons = buttons.filter(b => b.sourceFlowId === flowId);
    const flowButtonIds = flowButtons.map(b => b.buttonId);

    const currentButtons = formData.assignedButtons || [];
    const newButtons = currentButtons.filter(id => !flowButtonIds.includes(id));

    setFormData({
      ...formData,
      assignedFlows: currentFlows.filter(id => id !== flowId),
      assignedButtons: newButtons
    });
  };

  // Button assignment handlers
  const handleAddButtonAssignment = () => {
    if (!selectedButtonToAdd) return;
    const currentButtons = formData.assignedButtons || [];
    const buttonIdNum = parseInt(selectedButtonToAdd, 10);
    if (!currentButtons.includes(buttonIdNum)) {
      setFormData({
        ...formData,
        assignedButtons: [...currentButtons, buttonIdNum]
      });
    }
    setSelectedButtonToAdd('');
  };

  const handleRemoveButtonAssignment = (buttonId) => {
    const currentButtons = formData.assignedButtons || [];
    setFormData({
      ...formData,
      assignedButtons: currentButtons.filter(id => id !== buttonId)
    });
  };

  // Button management handlers
  const getNextButtonId = () => {
    const existingIds = buttons.map(b => b.buttonId).filter(id => typeof id === 'number');
    return existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
  };

  const handleAddButton = () => {
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: getNextButtonId(), actions: [], enabled: true });
    setShowButtonForm(true);
  };

  const handleToggleButton = (buttonId, enabled) => {
    const updatedButtons = buttons.map(b =>
      b.buttonId === buttonId ? { ...b, enabled } : b
    );
    setFormData({ ...formData, buttons: updatedButtons });
  };

  const handleEditButton = (button) => {
    setEditingButtonId(button.buttonId);
    setButtonForm({ ...button });
    setShowButtonForm(true);
  };

  const handleDeleteButton = (buttonId) => {
    if (window.confirm('Delete this button?')) {
      const updatedButtons = buttons.filter(b => b.buttonId !== buttonId);
      // Also remove from assigned buttons
      const updatedAssigned = (formData.assignedButtons || []).filter(id => id !== buttonId);
      setFormData({ ...formData, buttons: updatedButtons, assignedButtons: updatedAssigned });
    }
  };

  const handleSaveButton = () => {
    if (!buttonForm.name.trim()) {
      alert('Button name is required');
      return;
    }

    if (editingButtonId !== null) {
      const updatedButtons = buttons.map(b =>
        b.buttonId === editingButtonId ? buttonForm : b
      );
      setFormData({ ...formData, buttons: updatedButtons });
    } else {
      setFormData({ ...formData, buttons: [...buttons, buttonForm] });
    }

    setShowButtonForm(false);
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: null, actions: [] });
  };

  const handleCancelButtonEdit = () => {
    setShowButtonForm(false);
    setEditingButtonId(null);
    setButtonForm({ name: '', buttonId: null, actions: [] });
  };

  const handleAddAction = () => {
    setButtonForm({
      ...buttonForm,
      actions: [...buttonForm.actions, { type: 'message', config: {} }]
    });
  };

  const handleUpdateAction = (index, field, value) => {
    const updatedActions = [...buttonForm.actions];
    if (field === 'type') {
      updatedActions[index] = { type: value, config: {} };
    } else {
      updatedActions[index].config[field] = value;
    }
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleDeleteAction = (index) => {
    const updatedActions = buttonForm.actions.filter((_, i) => i !== index);
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  const handleMoveAction = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === buttonForm.actions.length - 1) return;
    const updatedActions = [...buttonForm.actions];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [updatedActions[index], updatedActions[newIndex]] = [updatedActions[newIndex], updatedActions[index]];
    setButtonForm({ ...buttonForm, actions: updatedActions });
  };

  return (
    <div className="modal-overlay">
      <div className="modal persona-editor-modal">
        <div className="modal-header persona-modal-header">
          <h3>{persona ? 'Edit Persona' : 'New Persona'}</h3>
          {hasDraft && (
            <span className="draft-indicator" title="Unsaved changes restored from previous session">
              Draft restored
            </span>
          )}
          <button className="modal-close" onClick={handleCancel}>&times;</button>
        </div>

        {/* Tab Navigation */}
        <div className="modal-tabs persona-modal-tabs">
          <button
            type="button"
            className={`modal-tab ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            Basic
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'portraits' ? 'active' : ''}`}
            onClick={() => setActiveTab('portraits')}
          >
            Staged Portraits
          </button>
          <button
            type="button"
            className={`modal-tab ${activeTab === 'buttons' ? 'active' : ''}`}
            onClick={() => setActiveTab('buttons')}
          >
            Custom Buttons
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Basic Tab */}
          <div className="modal-body persona-modal-body" style={{ display: activeTab === 'basic' ? 'block' : 'none' }}>
            <div className="editor-layout">
              {/* Left Column - Basic Info */}
              <div className="editor-left">
                <div className="form-group">
                  <label>Display Name *</label>
                  <input
                    type="text"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                    placeholder="Your character name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Pronouns</label>
                  <select
                    value={formData.pronouns}
                    onChange={(e) => setFormData({ ...formData, pronouns: e.target.value })}
                  >
                    <option value="he/him">he/him</option>
                    <option value="she/her">she/her</option>
                    <option value="they/them">they/them</option>
                    <option value="it/its">it/its</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Physical Appearance</label>
                  <textarea
                    value={formData.appearance}
                    onChange={(e) => setFormData({ ...formData, appearance: e.target.value })}
                    placeholder="Describe your character's appearance..."
                    rows={4}
                  />
                </div>

                <div className="form-group">
                  <label>Personality</label>
                  <textarea
                    value={formData.personality}
                    onChange={(e) => setFormData({ ...formData, personality: e.target.value })}
                    placeholder="Describe your character's personality..."
                    rows={4}
                  />
                </div>

                <div className="form-group">
                  <label>Relationship with Inflation</label>
                  <textarea
                    value={formData.relationshipWithInflation}
                    onChange={(e) => setFormData({ ...formData, relationshipWithInflation: e.target.value })}
                    placeholder="Describe their knowledge, experience, or lack thereof regarding the inflation process..."
                    rows={4}
                  />
                </div>
              </div>

              {/* Right Column - Avatar Upload */}
              <div className="editor-right">
                <label>Persona Avatar</label>
                <div
                  className="avatar-upload-area"
                  onClick={handleImageClick}
                >
                  {formData.avatar ? (
                    <img src={formData.avatar} alt="Persona avatar" className="avatar-preview" />
                  ) : (
                    <div className="avatar-placeholder">
                      <span className="upload-icon">📷</span>
                      <span className="upload-text">Click to upload</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                {formData.avatar && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFormData({ ...formData, avatar: '' });
                    }}
                    style={{ marginTop: '0.5rem', width: '100%' }}
                  >
                    Remove Avatar
                  </button>
                )}
              </div>
            </div>

            {/* Associated Flows Section */}
            <div className="associations-section">
              <div className="form-group">
                <label>Associated Flows</label>
                <div className="dropdown-add-row">
                  <select
                    value={selectedFlowToAdd}
                    onChange={(e) => setSelectedFlowToAdd(e.target.value)}
                    className="association-dropdown"
                  >
                    <option value="">Select a flow...</option>
                    {availableFlows.map(flow => (
                      <option key={flow.id} value={flow.id}>{flow.name}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-icon btn-add-assoc" onClick={handleAddFlow} disabled={!selectedFlowToAdd}>+</button>
                </div>
                <div className="association-badges">
                  {(formData.assignedFlows || []).length === 0 ? (
                    <span className="empty-hint">No flows assigned</span>
                  ) : (
                    (formData.assignedFlows || []).map(flowId => {
                      const flow = flows?.find(f => f.id === flowId);
                      return flow ? (
                        <span key={flowId} className="assoc-badge">
                          {flow.name}
                          <button type="button" className="badge-remove" onClick={() => handleRemoveFlow(flowId)}>−</button>
                        </span>
                      ) : null;
                    })
                  )}
                </div>
              </div>

              {/* Associated Custom Buttons Section */}
              <div className="form-group">
                <label>Associated Custom Buttons</label>
                <div className="dropdown-add-row">
                  <select
                    value={selectedButtonToAdd}
                    onChange={(e) => setSelectedButtonToAdd(e.target.value)}
                    className="association-dropdown"
                  >
                    <option value="">Select a button...</option>
                    {availableButtons.map(btn => (
                      <option key={btn.buttonId} value={btn.buttonId}>{btn.name} #{btn.buttonId}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-icon btn-add-assoc" onClick={handleAddButtonAssignment} disabled={!selectedButtonToAdd}>+</button>
                </div>
                <div className="association-badges">
                  {(formData.assignedButtons || []).length === 0 ? (
                    <span className="empty-hint">No buttons assigned - add them in the Custom Buttons tab</span>
                  ) : (
                    (formData.assignedButtons || []).map(buttonId => {
                      const btn = buttons.find(b => b.buttonId === buttonId);
                      return btn ? (
                        <span key={buttonId} className="assoc-badge">
                          {btn.name}
                          <button type="button" className="badge-remove" onClick={() => handleRemoveButtonAssignment(buttonId)}>−</button>
                        </span>
                      ) : null;
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Staged Portraits Tab */}
          <div className="modal-body persona-modal-body" style={{ display: activeTab === 'portraits' ? 'block' : 'none' }}>
            <div className="staged-portraits-section">
              <p className="section-hint">
                Upload different portraits for capacity ranges. The portrait changes automatically as capacity increases.
                Capacity below 5% uses the default avatar. If a range has no portrait, the nearest lower range is used.
              </p>
              <div className="staged-portraits-grid">
                {STAGED_PORTRAIT_RANGES.map((range) => (
                  <div key={range.id} className={`staged-portrait-card ${range.isPop ? 'pop-range' : ''}`}>
                    <div className="staged-portrait-label">{range.label}</div>
                    <div
                      className="staged-portrait-upload"
                      onClick={() => handleStagedImageClick(range.id)}
                    >
                      {formData.stagedPortraits?.[range.id] ? (
                        <img
                          src={formData.stagedPortraits[range.id]}
                          alt={`Portrait for ${range.label}`}
                          className="staged-portrait-preview"
                        />
                      ) : (
                        <div className="staged-portrait-placeholder">
                          <span className="upload-icon">+</span>
                        </div>
                      )}
                    </div>
                    <input
                      ref={(el) => stagedFileInputRefs.current[range.id] = el}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleStagedImageUpload(e, range.id)}
                      style={{ display: 'none' }}
                    />
                    {formData.stagedPortraits?.[range.id] && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm staged-portrait-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveStagedPortrait(range.id);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Custom Buttons Tab */}
          <div className="modal-body persona-modal-body" style={{ display: activeTab === 'buttons' ? 'block' : 'none' }}>
            <div className="events-editor">
              {!showButtonForm ? (
                <>
                  <div className="events-header">
                    <h4>Custom Buttons</h4>
                    <div className="events-header-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleAddButton} disabled={buttons.length >= 12}>+ Add Button</button>
                      {buttons.length >= 12 && <span className="limit-warning">Maximum 12 buttons</span>}
                    </div>
                  </div>
                  <p className="section-hint">Create persona buttons here, then assign them in the Basic tab.</p>

                  <div className="events-list-editor">
                    {buttons.length === 0 ? (
                      <p className="empty-message">No buttons yet.</p>
                    ) : (
                      buttons.map((button) => (
                        <div key={button.buttonId} className={`event-item ${button.enabled === false ? 'disabled' : ''} ${button.autoGenerated ? 'auto-generated' : ''}`}>
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={button.enabled !== false}
                              onChange={(e) => handleToggleButton(button.buttonId, e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="event-info">
                            <div className={`event-name ${button.enabled === false ? 'strikethrough' : ''}`}>
                              {button.name} <span style={{color: '#666'}}>#{button.buttonId}</span>
                              {button.autoGenerated && <span className="auto-badge">Auto</span>}
                            </div>
                            <div className="event-meta">{button.autoGenerated ? 'Linked to flow' : `${button.actions?.length || 0} action(s)`}</div>
                          </div>
                          <div className="event-actions">
                            {!button.autoGenerated ? (
                              <>
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleEditButton(button)}>Edit</button>
                                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteButton(button.buttonId)}>Delete</button>
                              </>
                            ) : (
                              <span className="auto-managed-hint">Managed by flow</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="event-form">
                  <h4>{editingButtonId !== null ? `Edit Button #${editingButtonId}` : `New Button #${buttonForm.buttonId}`}</h4>
                  <div className="form-group">
                    <label>Button Name *</label>
                    <input
                      type="text"
                      value={buttonForm.name}
                      onChange={(e) => setButtonForm({ ...buttonForm, name: e.target.value })}
                      placeholder="e.g., 'Quick Action'"
                    />
                  </div>
                  <div className="form-group">
                    <div className="actions-header">
                      <label>Actions (execute in order)</label>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={handleAddAction}>+ Add Action</button>
                    </div>
                    <div className="actions-list">
                      {buttonForm.actions.length === 0 ? (
                        <p className="empty-message">No actions yet.</p>
                      ) : (
                        buttonForm.actions.map((action, index) => (
                          <div key={index} className="action-item">
                            <div className="action-reorder">
                              <button type="button" className="btn-icon-small" onClick={() => handleMoveAction(index, 'up')} disabled={index === 0}>▲</button>
                              <button type="button" className="btn-icon-small" onClick={() => handleMoveAction(index, 'down')} disabled={index === buttonForm.actions.length - 1}>▼</button>
                            </div>
                            <div className="action-config">
                              <select value={action.type} onChange={(e) => handleUpdateAction(index, 'type', e.target.value)}>
                                <option value="message">Send Message</option>
                                <option value="turn_on">Turn On Device</option>
                                <option value="cycle">Cycle Device</option>
                                <option value="link_to_flow">Link to Flow</option>
                              </select>
                              {action.type === 'message' && (
                                <textarea
                                  value={action.config.text || ''}
                                  onChange={(e) => handleUpdateAction(index, 'text', e.target.value)}
                                  placeholder="Instruction for AI..."
                                  rows={2}
                                />
                              )}
                              {(action.type === 'turn_on' || action.type === 'cycle') && (
                                <select value={action.config.device || ''} onChange={(e) => handleUpdateAction(index, 'device', e.target.value)}>
                                  <option value="">Select Device...</option>
                                  <option value="primary_pump">Primary Pump</option>
                                  {devices?.map(d => (
                                    <option key={d.ip || d.deviceId} value={d.brand === 'govee' ? `govee:${d.deviceId}` : d.brand === 'tuya' ? `tuya:${d.deviceId}` : d.childId ? `${d.ip}:${d.childId}` : d.ip}>
                                      {d.name || d.alias || d.ip || d.deviceId}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {action.type === 'cycle' && (
                                <div className="cycle-inputs">
                                  <input type="number" value={action.config.duration || 5} onChange={(e) => handleUpdateAction(index, 'duration', parseInt(e.target.value))} placeholder="Duration (s)" min="1" />
                                  <input type="number" value={action.config.interval || 2} onChange={(e) => handleUpdateAction(index, 'interval', parseInt(e.target.value))} placeholder="Interval (s)" min="1" />
                                </div>
                              )}
                              {action.type === 'link_to_flow' && (
                                <select value={action.config.flowId || ''} onChange={(e) => handleUpdateAction(index, 'flowId', e.target.value)}>
                                  <option value="">Select Flow...</option>
                                  {flows?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                              )}
                            </div>
                            <button type="button" className="btn-icon-small" onClick={() => handleDeleteAction(index)} title="Delete">🗑️</button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="event-form-buttons">
                    <button type="button" className="btn btn-secondary" onClick={handleCancelButtonEdit}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={handleSaveButton}>{editingButtonId !== null ? 'Update' : 'Create'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer persona-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {persona ? 'Update' : 'Create'} Persona
            </button>
          </div>
        </form>
      </div>

      {/* Image Crop Modal */}
      {showCropModal && (
        <ImageCropModal
          image={uploadedImage}
          onSave={handleCropSave}
          onCancel={handleCropCancel}
        />
      )}

      {/* Staged Portrait Crop Modal */}
      {stagedCropModal && (
        <ImageCropModal
          image={stagedUploadedImage}
          onSave={handleStagedCropSave}
          onCancel={handleStagedCropCancel}
        />
      )}
    </div>
  );
}

// Interactive Crop Modal Component (3:4 aspect ratio)
function ImageCropModal({ image, onSave, onCancel }) {
  const containerRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [imageObj, setImageObj] = React.useState(null);
  const [displayScale, setDisplayScale] = React.useState(1);
  const [crop, setCrop] = React.useState({ x: 0, y: 0, width: 100, height: 133 });
  const [dragging, setDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

  // Output dimensions: 3:4 portrait aspect ratio
  const OUTPUT_WIDTH = 512;
  const OUTPUT_HEIGHT = 683;
  const ASPECT_RATIO = 3 / 4;

  // Load image
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);

      // Calculate display scale to fit in modal (max 500px wide)
      const maxDisplayWidth = 500;
      const scale = img.width > maxDisplayWidth ? maxDisplayWidth / img.width : 1;
      setDisplayScale(scale);

      // Initialize crop box - as large as possible while maintaining aspect ratio
      const maxCropWidth = img.width;
      const maxCropHeight = img.height;
      let cropWidth, cropHeight;

      if (maxCropWidth / maxCropHeight > ASPECT_RATIO) {
        // Image is wider - constrain by height
        cropHeight = maxCropHeight;
        cropWidth = cropHeight * ASPECT_RATIO;
      } else {
        // Image is taller - constrain by width
        cropWidth = maxCropWidth;
        cropHeight = cropWidth / ASPECT_RATIO;
      }

      // Center the crop
      setCrop({
        x: (img.width - cropWidth) / 2,
        y: (img.height - cropHeight) / 2,
        width: cropWidth,
        height: cropHeight
      });
    };
    img.src = image;
  }, [image]);

  // Handle mouse down on crop box
  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragging(true);
    setDragStart({
      x: e.clientX - rect.left - crop.x * displayScale,
      y: e.clientY - rect.top - crop.y * displayScale
    });
  };

  // Handle mouse move
  React.useEffect(() => {
    if (!dragging || !imageObj) return;

    const handleMouseMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      let newX = (e.clientX - rect.left - dragStart.x) / displayScale;
      let newY = (e.clientY - rect.top - dragStart.y) / displayScale;

      // Constrain to image bounds
      newX = Math.max(0, Math.min(newX, imageObj.width - crop.width));
      newY = Math.max(0, Math.min(newY, imageObj.height - crop.height));

      setCrop(prev => ({ ...prev, x: newX, y: newY }));
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStart, displayScale, imageObj, crop.width, crop.height]);

  const handleSave = () => {
    if (!imageObj) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;

    // Draw cropped portion scaled to output size
    ctx.drawImage(
      imageObj,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT
    );

    const croppedData = canvas.toDataURL('image/jpeg', 0.9);
    onSave(croppedData);
  };

  if (!imageObj) return null;

  const displayWidth = imageObj.width * displayScale;
  const displayHeight = imageObj.height * displayScale;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Crop Avatar</h3>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="text-muted" style={{ marginBottom: '1rem' }}>Drag the crop area to select portion</p>
          <div
            ref={containerRef}
            className="crop-container"
            style={{
              width: displayWidth,
              height: displayHeight,
              position: 'relative',
              margin: '0 auto',
              overflow: 'hidden'
            }}
          >
            {/* Base image */}
            <img
              src={image}
              alt="Crop source"
              style={{
                width: displayWidth,
                height: displayHeight,
                display: 'block'
              }}
            />
            {/* Darkened overlay */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              pointerEvents: 'none'
            }} />
            {/* Crop window (shows through) */}
            <div
              onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                left: crop.x * displayScale,
                top: crop.y * displayScale,
                width: crop.width * displayScale,
                height: crop.height * displayScale,
                border: '2px solid #4CAF50',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                cursor: dragging ? 'grabbing' : 'grab',
                backgroundImage: `url(${image})`,
                backgroundSize: `${displayWidth}px ${displayHeight}px`,
                backgroundPosition: `-${crop.x * displayScale}px -${crop.y * displayScale}px`
              }}
            />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default PersonaEditorModal;
