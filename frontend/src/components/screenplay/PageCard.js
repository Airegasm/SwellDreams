import React, { useState } from 'react';
import ParagraphEvent from './ParagraphEvent';
import './ScreenPlayTabs.css';

const PARAGRAPH_TYPES = [
  { type: 'narration', label: 'Narration', icon: '📖' },
  { type: 'dialogue', label: 'Dialogue', icon: '💬' },
  { type: 'player_dialogue', label: 'Player Dialogue', icon: '🗣️' },
  { type: 'choice', label: 'Choice', icon: '❓' },
  { type: 'inline_choice', label: 'Inline Choice', icon: '💭' },
  { type: 'goto_page', label: 'Go to Page', icon: '➡️' },
  { type: 'condition', label: 'Condition', icon: '⚡' },
  { type: 'set_variable', label: 'Set Variable', icon: '📝' },
  { type: 'set_npc_actor_avatar', label: 'Set NPC Avatar', icon: '🎭' },
  { type: 'delay', label: 'Delay', icon: '⏱️' },
  { type: 'pump', label: 'Pump (Real)', icon: '⛽' },
  { type: 'mock_pump', label: 'Mock Pump', icon: '🎈' },
  { type: 'end', label: 'End', icon: '🏁' }
];

function PageCard({ page, pageIndex, isStartPage, allPages, actors, mediaImages, onUpdate, onDelete, onSetStart, onEnhanceText }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Handle drag over
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Handle drop from palette
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const type = e.dataTransfer.getData('paragraphType');
    if (type) {
      handleAddParagraph(type);
    }
  };

  const handleTitleChange = (e) => {
    onUpdate({ title: e.target.value });
  };

  const handleAddParagraph = (type) => {
    const newParagraph = {
      id: `para-${Date.now()}`,
      type,
      data: getDefaultDataForType(type)
    };

    onUpdate({
      paragraphs: [...(page.paragraphs || []), newParagraph]
    });
    setShowAddMenu(false);
  };

  const handleUpdateParagraph = (paraId, updates) => {
    onUpdate({
      paragraphs: page.paragraphs.map(p =>
        p.id === paraId ? { ...p, ...updates } : p
      )
    });
  };

  const handleDeleteParagraph = (paraId) => {
    onUpdate({
      paragraphs: page.paragraphs.filter(p => p.id !== paraId)
    });
  };

  const handleMoveParagraph = (paraId, direction) => {
    const paragraphs = [...page.paragraphs];
    const index = paragraphs.findIndex(p => p.id === paraId);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= paragraphs.length) return;

    [paragraphs[index], paragraphs[newIndex]] = [paragraphs[newIndex], paragraphs[index]];
    onUpdate({ paragraphs });
  };

  const getDefaultDataForType = (type) => {
    switch (type) {
      case 'narration':
        return { text: '', llmEnhance: false };
      case 'dialogue':
        return { actorId: '', text: '', llmEnhance: false };
      case 'player_dialogue':
        return { text: '', llmEnhance: false };
      case 'choice':
        return {
          prompt: '',
          choices: [
            { text: 'Option 1', targetPageId: '' },
            { text: 'Option 2', targetPageId: '' }
          ]
        };
      case 'goto_page':
        return { targetPageId: '' };
      case 'condition':
        return { variable: '', operator: 'equals', value: '', truePageId: '', falsePageId: '' };
      case 'set_variable':
        return { variableName: '', value: '' };
      case 'inline_choice':
        return {
          prompt: '',
          options: [
            { text: 'Question 1', response: '', responseActorId: '' }
          ],
          continueText: 'Continue',
          continueTargetPageId: '',
          requireAllOptions: false
        };
      case 'set_npc_actor_avatar':
        return { sourceType: 'actor', actorId: '', imageTag: '' };
      case 'delay':
        return { duration: 1000 };
      case 'pump':
        return { device: 'Primary Pump', action: 'cycle', duration: 5, interval: 10, cycles: 0, pulses: 3 };
      case 'mock_pump':
        return { target: 'inflatee1', action: 'cycle', duration: 5000, intensity: 50 };
      case 'end':
        return { endingType: 'normal', message: 'The End' };
      default:
        return {};
    }
  };

  return (
    <div
      className={`page-card ${isStartPage ? 'start-page' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="page-card-header">
        <button
          className="collapse-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <input
          type="text"
          className="page-title-input"
          value={page.title || ''}
          onChange={handleTitleChange}
          placeholder="Page title..."
        />
        {isStartPage && <span className="start-badge">START</span>}
        <div className="page-actions">
          {!isStartPage && (
            <button
              className="btn btn-secondary btn-xs"
              onClick={onSetStart}
              title="Set as start page"
            >
              Set Start
            </button>
          )}
          <button
            className="btn btn-danger btn-xs"
            onClick={onDelete}
            title="Delete page"
          >
            ✕
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="page-card-content">
          <div className="paragraphs-list">
            {(page.paragraphs || []).map((paragraph, index) => (
              <ParagraphEvent
                key={paragraph.id}
                paragraph={paragraph}
                index={index}
                totalCount={page.paragraphs.length}
                allPages={allPages}
                actors={actors}
                mediaImages={mediaImages}
                onUpdate={(updates) => handleUpdateParagraph(paragraph.id, updates)}
                onDelete={() => handleDeleteParagraph(paragraph.id)}
                onMove={(dir) => handleMoveParagraph(paragraph.id, dir)}
                onEnhanceText={onEnhanceText}
              />
            ))}
          </div>

          <div className="add-paragraph-container">
            {showAddMenu ? (
              <div className="add-paragraph-menu">
                {PARAGRAPH_TYPES.map(({ type, label, icon }) => (
                  <button
                    key={type}
                    className="add-para-option"
                    onClick={() => handleAddParagraph(type)}
                  >
                    {icon} {label}
                  </button>
                ))}
                <button
                  className="add-para-cancel"
                  onClick={() => setShowAddMenu(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="add-paragraph-btn"
                onClick={() => setShowAddMenu(true)}
              >
                + Add Paragraph
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PageCard;
