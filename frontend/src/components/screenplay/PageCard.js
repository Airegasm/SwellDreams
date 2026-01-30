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
  { type: 'parallel_container', label: 'Parallel Container', icon: '⚙️' },
  { type: 'popup', label: 'Popup', icon: '🔔' },
  { type: 'toast', label: 'Toast', icon: '📢' },
  { type: 'challenge_wheel', label: 'Prize Wheel', icon: '🎡' },
  { type: 'challenge_dice', label: 'Dice Roll', icon: '🎲' },
  { type: 'challenge_coin', label: 'Coin Flip', icon: '🪙' },
  { type: 'challenge_rps', label: 'Rock Paper Scissors', icon: '✊' },
  { type: 'challenge_timer', label: 'Timer Challenge', icon: '⏱️' },
  { type: 'challenge_number_guess', label: 'Number Guess', icon: '🔢' },
  { type: 'challenge_slots', label: 'Slot Machine', icon: '🎰' },
  { type: 'challenge_card', label: 'Card Draw', icon: '🃏' },
  { type: 'challenge_simon', label: 'Simon Says', icon: '🎮' },
  { type: 'challenge_reflex', label: 'Reflex Challenge', icon: '⚡' },
  { type: 'end', label: 'End', icon: '🏁' }
];

function PageCard({ page, pageIndex, isStartPage, allPages, actors, mediaImages, onUpdate, onDelete, onSetStart, onEnhanceText }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Handle drag over
  const handleDragOver = (e) => {
    // Check if drag is over a parallel container - if so, ignore it
    let target = e.target;
    while (target && target !== e.currentTarget) {
      if (target.classList && target.classList.contains('parallel-children-list')) {
        // This drag is over a parallel container, don't highlight page
        return;
      }
      target = target.parentElement;
    }

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
    // Check if drop is within a parallel container - if so, ignore it
    let target = e.target;
    while (target && target !== e.currentTarget) {
      if (target.classList && target.classList.contains('parallel-children-list')) {
        // This drop is for a parallel container, don't handle it here
        return;
      }
      target = target.parentElement;
    }

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
        return { device: 'Primary Pump', action: 'cycle', duration: 5, interval: 10, cycles: 0, pulses: 3, untilEnabled: false, untilType: 'capacity', untilValue: 50, blockContinue: false };
      case 'mock_pump':
        return { target: 'inflatee1', action: 'cycle', duration: 5000, intensity: 50, untilEnabled: false, untilType: 'capacity', untilValue: 50, blockContinue: false };
      case 'parallel_container':
        return { children: [] };
      case 'popup':
        return { message: 'Are you sure you want to continue?' };
      case 'challenge_wheel':
        return {
          prompt: 'Spin the wheel!',
          segments: [
            { label: 'Prize 1', color: '#ff6b6b', weight: 1, targetPageId: '' },
            { label: 'Prize 2', color: '#4ecdc4', weight: 1, targetPageId: '' },
            { label: 'Prize 3', color: '#ffe66d', weight: 1, targetPageId: '' }
          ],
          resultVariable: '',
          autoSpin: false
        };
      case 'challenge_dice':
        return {
          prompt: 'Roll the dice!',
          diceType: 6,
          mode: 'ranges',
          ranges: [
            { min: 1, max: 2, label: 'Low', targetPageId: '' },
            { min: 3, max: 4, label: 'Medium', targetPageId: '' },
            { min: 5, max: 6, label: 'High', targetPageId: '' }
          ],
          directOutcomes: [],
          resultVariable: '',
          autoRoll: false
        };
      case 'challenge_coin':
        return {
          prompt: 'Flip the coin!',
          headsPageId: '',
          tailsPageId: '',
          resultVariable: '',
          autoFlip: false
        };
      case 'challenge_rps':
        return {
          prompt: 'Rock, Paper, Scissors!',
          opponentChoice: 'random',
          winPageId: '',
          losePageId: '',
          tiePageId: '',
          resultVariable: '',
          playerChoiceVariable: '',
          showOpponentChoice: true
        };
      case 'challenge_timer':
        return {
          prompt: 'Stop the timer!',
          targetTime: 5.0,
          tolerance: 0.5,
          maxTime: 10.0,
          successPageId: '',
          failPageId: '',
          resultVariable: '',
          showTargetTime: true
        };
      case 'challenge_number_guess':
        return {
          prompt: 'Guess the number!',
          minNumber: 1,
          maxNumber: 10,
          correctPageId: '',
          incorrectPageId: '',
          attempts: 3,
          resultVariable: '',
          showHints: true,
          continueOnFail: true
        };
      case 'challenge_slots':
        return {
          prompt: 'Pull the lever!',
          symbols: ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'],
          reels: 3,
          winCondition: 'all_match',
          specificPattern: ['💎', '💎', '💎'],
          winPageId: '',
          losePageId: '',
          resultVariable: '',
          autoPull: false
        };
      case 'challenge_card':
        return {
          prompt: 'Draw a card!',
          deckType: 'standard',
          mode: 'ranges',
          ranges: [
            { min: 1, max: 5, label: 'Low', targetPageId: '' },
            { min: 6, max: 10, label: 'Mid', targetPageId: '' },
            { min: 11, max: 13, label: 'Face', targetPageId: '' }
          ],
          suitOutcomes: [],
          resultVariable: '',
          resultValueVariable: '',
          resultSuitVariable: '',
          autoDraw: false
        };
      case 'challenge_simon':
        return {
          prompt: 'Repeat the pattern!',
          sequenceLength: 5,
          colors: ['red', 'blue', 'green', 'yellow'],
          speed: 'normal',
          successPageId: '',
          failPageId: '',
          resultVariable: '',
          allowRetry: false,
          retries: 0
        };
      case 'challenge_reflex':
        return {
          prompt: 'Click when you see the signal!',
          targetTime: 500,
          waitMin: 1000,
          waitMax: 3000,
          successPageId: '',
          failPageId: '',
          resultVariable: '',
          showReactionTime: true,
          penalizeFalseStart: true
        };
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
