import React, { useState } from 'react';
import './ScreenPlayTabs.css';

const TYPE_ICONS = {
  narration: '📖',
  dialogue: '💬',
  player_dialogue: '🗣️',
  choice: '❓',
  inline_choice: '💭',
  goto_page: '➡️',
  condition: '⚡',
  set_variable: '📝',
  set_npc_actor_avatar: '🎭',
  delay: '⏱️',
  pump: '⛽',
  mock_pump: '🎈',
  parallel_container: '⚙️',
  popup: '🔔',
  toast: '📢',
  challenge_wheel: '🎡',
  challenge_dice: '🎲',
  challenge_coin: '🪙',
  challenge_rps: '✊',
  challenge_number_guess: '🔢',
  challenge_slots: '🎰',
  challenge_card: '🃏',
  challenge_simon: '🎮',
  challenge_reflex: '⚡',
  end: '🏁'
};

const PUMP_ACTION_DESCRIPTIONS = {
  cycle: 'Continuous pumping with regular intervals',
  pulse: 'Quick bursts of pressure with pauses',
  timed: 'Pump for a specific duration then stop',
  on: 'Turn pump on (stays on)',
  off: 'Turn pump off'
};

function ParagraphEvent({ paragraph, index, totalCount, allPages, actors, mediaImages, onUpdate, onDelete, onMove, onEnhanceText }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancingOptionIdx, setEnhancingOptionIdx] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDataChange = (field, value) => {
    onUpdate({
      data: { ...paragraph.data, [field]: value }
    });
  };

  // Handle LLM enhance button click
  const handleEnhanceClick = async (e) => {
    e.stopPropagation();
    if (!onEnhanceText || isEnhancing) return;

    const text = paragraph.data?.text;
    if (!text) return;

    setIsEnhancing(true);
    try {
      const enhancedText = await onEnhanceText(text, paragraph.type, paragraph.data?.actorId);
      if (enhancedText && enhancedText !== text) {
        handleDataChange('text', enhancedText);
      }
    } catch (err) {
      console.error('Enhance failed:', err);
    }
    setIsEnhancing(false);
  };

  // Check if this paragraph type supports enhancement
  const canEnhance = ['narration', 'dialogue', 'player_dialogue'].includes(paragraph.type);

  // Handle LLM enhance for inline choice responses
  const handleEnhanceOptionResponse = async (optionIdx, actorId) => {
    if (!onEnhanceText || enhancingOptionIdx !== null) return;

    const options = paragraph.data?.options || [];
    const option = options[optionIdx];
    if (!option?.response) return;

    setEnhancingOptionIdx(optionIdx);
    try {
      // Use dialogue type for actor responses, narration for narrator
      const type = actorId ? 'dialogue' : 'narration';
      const enhancedText = await onEnhanceText(option.response, type, actorId);
      if (enhancedText && enhancedText !== option.response) {
        const newOptions = [...options];
        newOptions[optionIdx] = { ...option, response: enhancedText };
        handleDataChange('options', newOptions);
      }
    } catch (err) {
      console.error('Enhance option failed:', err);
    }
    setEnhancingOptionIdx(null);
  };

  const renderEditor = () => {
    const { type, data } = paragraph;

    switch (type) {
      case 'narration':
        return (
          <div className="para-editor">
            <textarea
              value={data.text || ''}
              onChange={(e) => handleDataChange('text', e.target.value)}
              placeholder="Narration text... Use [Play:varname] for variables"
              rows={3}
            />
            <div className="enhance-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={data.llmEnhance || false}
                  onChange={(e) => handleDataChange('llmEnhance', e.target.checked)}
                />
                LLM Enhance
              </label>
              {data.llmEnhance && (
                <label className="token-limit-label">
                  Tokens:
                  <input
                    type="number"
                    value={data.maxTokens || 120}
                    onChange={(e) => handleDataChange('maxTokens', parseInt(e.target.value) || 120)}
                    min={20}
                    max={500}
                    className="token-input"
                  />
                </label>
              )}
              <span className="var-hint-inline">Variables: [Play:name], [Player], [Capacity]</span>
            </div>
          </div>
        );

      case 'dialogue':
        return (
          <div className="para-editor">
            <div className="form-row">
              <select
                value={data.actorId || ''}
                onChange={(e) => handleDataChange('actorId', e.target.value)}
                className="actor-select"
              >
                <option value="">Select Actor...</option>
                {actors.map(actor => (
                  <option key={actor.id} value={actor.id}>{actor.name}</option>
                ))}
              </select>
            </div>
            <textarea
              value={data.text || ''}
              onChange={(e) => handleDataChange('text', e.target.value)}
              placeholder="Dialogue text..."
              rows={3}
            />
            <div className="enhance-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={data.llmEnhance || false}
                  onChange={(e) => handleDataChange('llmEnhance', e.target.checked)}
                />
                LLM Enhance
              </label>
              {data.llmEnhance && (
                <label className="token-limit-label">
                  Tokens:
                  <input
                    type="number"
                    value={data.maxTokens || 120}
                    onChange={(e) => handleDataChange('maxTokens', parseInt(e.target.value) || 120)}
                    min={20}
                    max={500}
                    className="token-input"
                  />
                </label>
              )}
            </div>
          </div>
        );

      case 'player_dialogue':
        return (
          <div className="para-editor">
            <textarea
              value={data.text || ''}
              onChange={(e) => handleDataChange('text', e.target.value)}
              placeholder="Player's dialogue text..."
              rows={3}
            />
            <div className="enhance-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={data.llmEnhance || false}
                  onChange={(e) => handleDataChange('llmEnhance', e.target.checked)}
                />
                LLM Enhance
              </label>
              {data.llmEnhance && (
                <label className="token-limit-label">
                  Tokens:
                  <input
                    type="number"
                    value={data.maxTokens || 120}
                    onChange={(e) => handleDataChange('maxTokens', parseInt(e.target.value) || 120)}
                    min={20}
                    max={500}
                    className="token-input"
                  />
                </label>
              )}
            </div>
          </div>
        );

      case 'choice':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Choice prompt..."
              className="choice-prompt"
            />
            <div className="choices-list">
              {(data.choices || []).map((choice, idx) => (
                <div key={idx} className="choice-item">
                  <div className="choice-row">
                    <input
                      type="text"
                      value={choice.text || ''}
                      onChange={(e) => {
                        const newChoices = [...data.choices];
                        newChoices[idx] = { ...choice, text: e.target.value };
                        handleDataChange('choices', newChoices);
                      }}
                      placeholder={`Choice ${idx + 1}...`}
                    />
                    <select
                      value={choice.targetPageId || ''}
                      onChange={(e) => {
                        const newChoices = [...data.choices];
                        newChoices[idx] = { ...choice, targetPageId: e.target.value };
                        handleDataChange('choices', newChoices);
                      }}
                    >
                      <option value="">→ Select Page</option>
                      {Object.values(allPages).map(page => (
                        <option key={page.id} value={page.id}>{page.title}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-danger btn-xs"
                      onClick={() => {
                        const newChoices = data.choices.filter((_, i) => i !== idx);
                        handleDataChange('choices', newChoices);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="choice-extras">
                    <div className="choice-extra-row">
                      <span className="extra-label">Set var:</span>
                      <input
                        type="text"
                        value={choice.setVar || ''}
                        onChange={(e) => {
                          const newChoices = [...data.choices];
                          newChoices[idx] = { ...choice, setVar: e.target.value };
                          handleDataChange('choices', newChoices);
                        }}
                        placeholder="variable"
                        className="var-input"
                      />
                      <span>=</span>
                      <input
                        type="text"
                        value={choice.setVal || ''}
                        onChange={(e) => {
                          const newChoices = [...data.choices];
                          newChoices[idx] = { ...choice, setVal: e.target.value };
                          handleDataChange('choices', newChoices);
                        }}
                        placeholder="value"
                        className="var-input"
                      />
                    </div>
                    <div className="choice-extra-row">
                      <span className="extra-label">Show if:</span>
                      <input
                        type="text"
                        value={choice.condVar || ''}
                        onChange={(e) => {
                          const newChoices = [...data.choices];
                          newChoices[idx] = { ...choice, condVar: e.target.value };
                          handleDataChange('choices', newChoices);
                        }}
                        placeholder="variable"
                        className="var-input"
                      />
                      <select
                        value={choice.condOp || 'equals'}
                        onChange={(e) => {
                          const newChoices = [...data.choices];
                          newChoices[idx] = { ...choice, condOp: e.target.value };
                          handleDataChange('choices', newChoices);
                        }}
                        className="cond-op-select"
                      >
                        <option value="equals">=</option>
                        <option value="not_equals">≠</option>
                        <option value="exists">exists</option>
                        <option value="not_exists">!exists</option>
                      </select>
                      <input
                        type="text"
                        value={choice.condVal || ''}
                        onChange={(e) => {
                          const newChoices = [...data.choices];
                          newChoices[idx] = { ...choice, condVal: e.target.value };
                          handleDataChange('choices', newChoices);
                        }}
                        placeholder="value"
                        className="var-input"
                        disabled={choice.condOp === 'exists' || choice.condOp === 'not_exists'}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  handleDataChange('choices', [
                    ...(data.choices || []),
                    { text: '', targetPageId: '' }
                  ]);
                }}
              >
                + Add Choice
              </button>
            </div>
          </div>
        );

      case 'inline_choice':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Prompt (e.g., 'What would you like to ask?')..."
              className="choice-prompt"
            />

            <div className="inline-options-list">
              <label className="subsection-label">Questions/Options (removed after selecting)</label>
              {(data.options || []).map((option, idx) => (
                <div key={idx} className="inline-option-row">
                  <div className="option-main">
                    <input
                      type="text"
                      value={option.text || ''}
                      onChange={(e) => {
                        const newOptions = [...data.options];
                        newOptions[idx] = { ...option, text: e.target.value };
                        handleDataChange('options', newOptions);
                      }}
                      placeholder={`Option ${idx + 1}...`}
                    />
                    <select
                      value={option.responseActorId || ''}
                      onChange={(e) => {
                        const newOptions = [...data.options];
                        newOptions[idx] = { ...option, responseActorId: e.target.value };
                        handleDataChange('options', newOptions);
                      }}
                      className="actor-select-sm"
                    >
                      <option value="">Narrator</option>
                      {actors.map(actor => (
                        <option key={actor.id} value={actor.id}>{actor.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-danger btn-xs"
                      onClick={() => {
                        const newOptions = data.options.filter((_, i) => i !== idx);
                        handleDataChange('options', newOptions);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="response-row">
                    <textarea
                      value={option.response || ''}
                      onChange={(e) => {
                        const newOptions = [...data.options];
                        newOptions[idx] = { ...option, response: e.target.value };
                        handleDataChange('options', newOptions);
                      }}
                      placeholder="Response text..."
                      rows={2}
                      className="option-response"
                    />
                    <button
                      className="enhance-btn enhance-btn-inline"
                      onClick={() => handleEnhanceOptionResponse(idx, option.responseActorId)}
                      disabled={enhancingOptionIdx !== null || !option.response}
                      title="LLM Enhance response"
                    >
                      {enhancingOptionIdx === idx ? '...' : '🤖'}
                    </button>
                  </div>
                  <div className="choice-extras">
                    <div className="choice-extra-row">
                      <span className="extra-label">Set var:</span>
                      <input
                        type="text"
                        value={option.setVar || ''}
                        onChange={(e) => {
                          const newOptions = [...data.options];
                          newOptions[idx] = { ...option, setVar: e.target.value };
                          handleDataChange('options', newOptions);
                        }}
                        placeholder="variable"
                        className="var-input"
                      />
                      <span>=</span>
                      <input
                        type="text"
                        value={option.setVal || ''}
                        onChange={(e) => {
                          const newOptions = [...data.options];
                          newOptions[idx] = { ...option, setVal: e.target.value };
                          handleDataChange('options', newOptions);
                        }}
                        placeholder="value"
                        className="var-input"
                      />
                    </div>
                    <div className="choice-extra-row">
                      <span className="extra-label">Show if:</span>
                      <input
                        type="text"
                        value={option.condVar || ''}
                        onChange={(e) => {
                          const newOptions = [...data.options];
                          newOptions[idx] = { ...option, condVar: e.target.value };
                          handleDataChange('options', newOptions);
                        }}
                        placeholder="variable"
                        className="var-input"
                      />
                      <select
                        value={option.condOp || 'equals'}
                        onChange={(e) => {
                          const newOptions = [...data.options];
                          newOptions[idx] = { ...option, condOp: e.target.value };
                          handleDataChange('options', newOptions);
                        }}
                        className="cond-op-select"
                      >
                        <option value="equals">=</option>
                        <option value="not_equals">≠</option>
                        <option value="exists">exists</option>
                        <option value="not_exists">!exists</option>
                      </select>
                      <input
                        type="text"
                        value={option.condVal || ''}
                        onChange={(e) => {
                          const newOptions = [...data.options];
                          newOptions[idx] = { ...option, condVal: e.target.value };
                          handleDataChange('options', newOptions);
                        }}
                        placeholder="value"
                        className="var-input"
                        disabled={option.condOp === 'exists' || option.condOp === 'not_exists'}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  handleDataChange('options', [
                    ...(data.options || []),
                    { text: '', response: '', responseActorId: '' }
                  ]);
                }}
              >
                + Add Option
              </button>
            </div>

            <div className="continue-section">
              <label className="subsection-label">Continue Option</label>
              <div className="continue-row">
                <input
                  type="text"
                  value={data.continueText || 'Continue'}
                  onChange={(e) => handleDataChange('continueText', e.target.value)}
                  placeholder="Continue button text..."
                />
                <select
                  value={data.continueTargetPageId || ''}
                  onChange={(e) => handleDataChange('continueTargetPageId', e.target.value)}
                >
                  <option value="">→ Select Page</option>
                  {Object.values(allPages).map(page => (
                    <option key={page.id} value={page.id}>{page.title}</option>
                  ))}
                </select>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={data.requireAllOptions || false}
                  onChange={(e) => handleDataChange('requireAllOptions', e.target.checked)}
                />
                Require all options before continue
              </label>
            </div>
          </div>
        );

      case 'goto_page':
        return (
          <div className="para-editor">
            <select
              value={data.targetPageId || ''}
              onChange={(e) => handleDataChange('targetPageId', e.target.value)}
            >
              <option value="">Select Page...</option>
              {Object.values(allPages).map(page => (
                <option key={page.id} value={page.id}>{page.title}</option>
              ))}
            </select>
          </div>
        );

      case 'condition':
        return (
          <div className="para-editor">
            <div className="condition-row">
              <input
                type="text"
                value={data.variable || ''}
                onChange={(e) => handleDataChange('variable', e.target.value)}
                placeholder="Variable name"
              />
              <select
                value={data.operator || 'equals'}
                onChange={(e) => handleDataChange('operator', e.target.value)}
              >
                <option value="equals">equals</option>
                <option value="not_equals">not equals</option>
                <option value="greater">greater than</option>
                <option value="less">less than</option>
                <option value="contains">contains</option>
                <option value="exists">exists</option>
                <option value="not_exists">not exists</option>
              </select>
              <input
                type="text"
                value={data.value || ''}
                onChange={(e) => handleDataChange('value', e.target.value)}
                placeholder="Value or [Play:var]"
                disabled={data.operator === 'exists' || data.operator === 'not_exists'}
              />
            </div>
            <div className="condition-branches">
              <div className="branch">
                <span>If TRUE →</span>
                <select
                  value={data.truePageId || ''}
                  onChange={(e) => handleDataChange('truePageId', e.target.value)}
                >
                  <option value="">Continue</option>
                  {Object.values(allPages).map(page => (
                    <option key={page.id} value={page.id}>{page.title}</option>
                  ))}
                </select>
              </div>
              <div className="branch">
                <span>If FALSE →</span>
                <select
                  value={data.falsePageId || ''}
                  onChange={(e) => handleDataChange('falsePageId', e.target.value)}
                >
                  <option value="">Continue</option>
                  {Object.values(allPages).map(page => (
                    <option key={page.id} value={page.id}>{page.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        );

      case 'set_variable':
        return (
          <div className="para-editor">
            <div className="form-row">
              <input
                type="text"
                value={data.variableName || ''}
                onChange={(e) => handleDataChange('variableName', e.target.value)}
                placeholder="Variable name"
              />
              <span>=</span>
              <input
                type="text"
                value={data.value || ''}
                onChange={(e) => handleDataChange('value', e.target.value)}
                placeholder="Value or expression"
              />
            </div>
            <div className="var-hints">
              Use in text: <code>[Play:varname]</code> · Math: <code>[Play:count] + 1</code>
            </div>
          </div>
        );

      case 'set_npc_actor_avatar':
        return (
          <div className="para-editor">
            <div className="form-row">
              <label>Source:</label>
              <select
                value={data.sourceType || 'actor'}
                onChange={(e) => handleDataChange('sourceType', e.target.value)}
                className="source-type-select"
              >
                <option value="actor">Actor Avatar</option>
                <option value="image">Media Image</option>
              </select>
            </div>
            {(data.sourceType || 'actor') === 'actor' ? (
              <div className="form-row">
                <label>Actor:</label>
                <select
                  value={data.actorId || ''}
                  onChange={(e) => handleDataChange('actorId', e.target.value)}
                >
                  <option value="">Select actor...</option>
                  {actors.map(actor => (
                    <option key={actor.id} value={actor.id}>{actor.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-row image-selector">
                <label>Image:</label>
                <select
                  value={data.imageTag || ''}
                  onChange={(e) => handleDataChange('imageTag', e.target.value)}
                >
                  <option value="">Select image...</option>
                  {(mediaImages || []).map(img => (
                    <option key={img.id} value={img.tag}>{img.tag} - {img.description}</option>
                  ))}
                </select>
                {data.imageTag && mediaImages?.find(i => i.tag === data.imageTag) && (
                  <div className="image-preview-small">
                    <img
                      src={`/api/media/images/${mediaImages.find(i => i.tag === data.imageTag)?.filename}`}
                      alt={data.imageTag}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="var-hints">
              Changes the right filmstrip avatar
            </div>
          </div>
        );

      case 'delay':
        return (
          <div className="para-editor">
            <div className="form-row">
              <input
                type="number"
                value={data.duration || 1000}
                onChange={(e) => handleDataChange('duration', parseInt(e.target.value) || 0)}
                min={0}
                step={100}
              />
              <span>ms</span>
            </div>
          </div>
        );

      case 'pump':
        return (
          <div className="para-editor">
            <div className="pump-settings">
              <div className="pump-row">
                <label>Device:</label>
                <input
                  type="text"
                  value={data.device || 'Primary Pump'}
                  onChange={(e) => handleDataChange('device', e.target.value)}
                  placeholder="Device alias (e.g., Primary Pump)"
                  className="pump-device-input"
                />
              </div>
              <div className="pump-row">
                <label>Action:</label>
                <select
                  value={data.action || 'cycle'}
                  onChange={(e) => handleDataChange('action', e.target.value)}
                  className="pump-action-select"
                >
                  <option value="cycle">Cycle</option>
                  <option value="pulse">Pulse</option>
                  <option value="timed">Timed</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
              {data.action === 'cycle' && (
                <>
                  <div className="pump-row">
                    <label>Duration:</label>
                    <input
                      type="number"
                      value={data.duration || 5}
                      onChange={(e) => handleDataChange('duration', parseInt(e.target.value) || 5)}
                      min={1}
                      className="pump-value-input"
                    />
                    <span className="pump-unit">sec on</span>
                  </div>
                  <div className="pump-row">
                    <label>Interval:</label>
                    <input
                      type="number"
                      value={data.interval || 10}
                      onChange={(e) => handleDataChange('interval', parseInt(e.target.value) || 10)}
                      min={1}
                      className="pump-value-input"
                    />
                    <span className="pump-unit">sec between</span>
                  </div>
                  <div className="pump-row">
                    <label>Cycles:</label>
                    <input
                      type="number"
                      value={data.cycles || 0}
                      onChange={(e) => handleDataChange('cycles', parseInt(e.target.value) || 0)}
                      min={0}
                      className="pump-value-input"
                    />
                    <span className="pump-unit">(0 = infinite)</span>
                  </div>
                </>
              )}
              {data.action === 'pulse' && (
                <div className="pump-row">
                  <label>Pulses:</label>
                  <input
                    type="number"
                    value={data.pulses || 3}
                    onChange={(e) => handleDataChange('pulses', parseInt(e.target.value) || 3)}
                    min={1}
                    className="pump-value-input"
                  />
                </div>
              )}
              {data.action === 'timed' && (
                <div className="pump-row">
                  <label>Duration:</label>
                  <input
                    type="number"
                    value={data.duration || 5}
                    onChange={(e) => handleDataChange('duration', parseInt(e.target.value) || 5)}
                    min={1}
                    className="pump-value-input"
                  />
                  <span className="pump-unit">seconds</span>
                </div>
              )}
              {data.action === 'on' && (
                <div className="pump-row pump-until-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={data.untilEnabled || false}
                      onChange={(e) => handleDataChange('untilEnabled', e.target.checked)}
                    />
                    Until
                  </label>
                  <select
                    value={data.untilType || 'capacity'}
                    onChange={(e) => handleDataChange('untilType', e.target.value)}
                    disabled={!data.untilEnabled}
                    className="pump-until-select"
                  >
                    <option value="capacity">Capacity</option>
                  </select>
                  <input
                    type="number"
                    value={data.untilValue || 50}
                    onChange={(e) => handleDataChange('untilValue', Math.max(1, Math.min(100, parseInt(e.target.value) || 50)))}
                    min={1}
                    max={100}
                    disabled={!data.untilEnabled}
                    className="pump-until-input"
                  />
                  <span className="pump-unit">%</span>
                </div>
              )}
              <div className="pump-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={data.blockContinue || false}
                    onChange={(e) => handleDataChange('blockContinue', e.target.checked)}
                    disabled={data.action === 'on' && !data.untilEnabled}
                  />
                  Block Continue
                </label>
                <span className="pump-hint">
                  {data.action === 'on' && !data.untilEnabled ? '(requires Until for On)' : '(prevents page change until complete)'}
                </span>
              </div>
              <div className="pump-description">
                {PUMP_ACTION_DESCRIPTIONS[data.action || 'cycle']} (controls actual device)
              </div>
            </div>
          </div>
        );

      case 'mock_pump':
        return (
          <div className="para-editor">
            <div className="pump-settings">
              <div className="pump-row">
                <label>Target:</label>
                <select
                  value={data.target || 'inflatee1'}
                  onChange={(e) => handleDataChange('target', e.target.value)}
                  className="pump-target-select"
                >
                  <option value="inflatee1">Inflatee 1 (Player)</option>
                  <option value="inflatee2">Inflatee 2 (NPC)</option>
                </select>
              </div>
              <div className="pump-row">
                <label>Action:</label>
                <select
                  value={data.action || 'cycle'}
                  onChange={(e) => handleDataChange('action', e.target.value)}
                  className="pump-action-select"
                >
                  <option value="cycle">Cycle</option>
                  <option value="pulse">Pulse</option>
                  <option value="timed">Timed</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
              {(data.action === 'timed' || data.action === 'cycle' || data.action === 'pulse') && (
                <div className="pump-row">
                  <label>Duration:</label>
                  <input
                    type="number"
                    value={data.duration || 5000}
                    onChange={(e) => handleDataChange('duration', parseInt(e.target.value) || 5000)}
                    min={1000}
                    step={1000}
                    className="pump-value-input"
                  />
                  <span className="pump-unit">ms</span>
                </div>
              )}
              {(data.action === 'cycle' || data.action === 'pulse') && (
                <div className="pump-row">
                  <label>Intensity:</label>
                  <input
                    type="number"
                    value={data.intensity || 50}
                    onChange={(e) => handleDataChange('intensity', Math.max(1, Math.min(100, parseInt(e.target.value) || 50)))}
                    min={1}
                    max={100}
                    className="pump-value-input"
                  />
                  <span className="pump-unit">%</span>
                </div>
              )}
              {data.action === 'on' && (
                <div className="pump-row pump-until-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={data.untilEnabled || false}
                      onChange={(e) => handleDataChange('untilEnabled', e.target.checked)}
                    />
                    Until
                  </label>
                  <select
                    value={data.untilType || 'capacity'}
                    onChange={(e) => handleDataChange('untilType', e.target.value)}
                    disabled={!data.untilEnabled}
                    className="pump-until-select"
                  >
                    <option value="capacity">Capacity</option>
                  </select>
                  <input
                    type="number"
                    value={data.untilValue || 50}
                    onChange={(e) => handleDataChange('untilValue', Math.max(1, Math.min(100, parseInt(e.target.value) || 50)))}
                    min={1}
                    max={100}
                    disabled={!data.untilEnabled}
                    className="pump-until-input"
                  />
                  <span className="pump-unit">%</span>
                </div>
              )}
              <div className="pump-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={data.blockContinue || false}
                    onChange={(e) => handleDataChange('blockContinue', e.target.checked)}
                    disabled={data.action === 'on' && !data.untilEnabled}
                  />
                  Block Continue
                </label>
                <span className="pump-hint">
                  {data.action === 'on' && !data.untilEnabled ? '(requires Until for On)' : '(prevents page change until complete)'}
                </span>
              </div>
              <div className="pump-description">
                {PUMP_ACTION_DESCRIPTIONS[data.action || 'cycle']}
              </div>
            </div>
          </div>
        );

      case 'parallel_container':
        // Helper to create default data for child types
        const getDefaultChildData = (type) => {
          switch (type) {
            case 'pump':
              return { device: 'Primary Pump', action: 'on', duration: 5, interval: 10 };
            case 'mock_pump':
              return { target: 'inflatee1', action: 'cycle', duration: 5000, intensity: 50 };
            case 'set_variable':
              return { variableName: '', value: '' };
            case 'delay':
              return { duration: 1000 };
            case 'set_npc_actor_avatar':
              return { sourceType: 'actor', actorId: '', imageTag: '', targetActorId: '' };
            default:
              return {};
          }
        };

        // Handle drag over
        const handleContainerDragOver = (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setIsDragOver(true);
        };

        const handleContainerDragLeave = (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
        };

        // Handle drop from palette
        const handleContainerDrop = (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          const type = e.dataTransfer.getData('paragraphType');

          // Only allow certain types in parallel containers
          const allowedTypes = ['pump', 'mock_pump', 'set_variable', 'delay', 'set_npc_actor_avatar'];
          if (type && allowedTypes.includes(type)) {
            const newChild = {
              id: `child-${Date.now()}`,
              type,
              data: getDefaultChildData(type)
            };
            handleDataChange('children', [...(data.children || []), newChild]);
          }
        };

        return (
          <div className="para-editor">
            <div className="parallel-container-note">
              ⚙️ Events in this container run simultaneously. Drag events from the palette or use + buttons below.
            </div>
            <div
              className={`parallel-children-list ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={handleContainerDragOver}
              onDragLeave={handleContainerDragLeave}
              onDrop={handleContainerDrop}
            >
              {(data.children || []).map((child, idx) => {
                const updateChild = (updates) => {
                  const newChildren = [...(data.children || [])];
                  newChildren[idx] = { ...child, ...updates };
                  handleDataChange('children', newChildren);
                };
                const updateChildData = (field, value) => {
                  const newChildren = [...(data.children || [])];
                  newChildren[idx] = { ...child, data: { ...child.data, [field]: value } };
                  handleDataChange('children', newChildren);
                };

                return (
                  <div key={child.id || idx} className="parallel-child-item">
                    <div className="parallel-child-header">
                      <span className="para-icon">{TYPE_ICONS[child.type] || '?'}</span>
                      <span className="child-type-label">{child.type}</span>
                      <button
                        className="delete-child-btn"
                        onClick={() => {
                          const newChildren = [...(data.children || [])];
                          newChildren.splice(idx, 1);
                          handleDataChange('children', newChildren);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {child.type === 'pump' && (
                      <div className="parallel-child-editor">
                        <select
                          value={child.data.device || 'Primary Pump'}
                          onChange={(e) => updateChildData('device', e.target.value)}
                        >
                          <option value="Primary Pump">Primary Pump</option>
                          <option value="Secondary Pump">Secondary Pump</option>
                        </select>
                        <select
                          value={child.data.action || 'on'}
                          onChange={(e) => updateChildData('action', e.target.value)}
                        >
                          <option value="on">On</option>
                          <option value="off">Off</option>
                          <option value="cycle">Cycle</option>
                          <option value="pulse">Pulse</option>
                          <option value="until">Until</option>
                        </select>
                        {(child.data.action === 'cycle' || child.data.action === 'pulse') && (
                          <>
                            <input
                              type="number"
                              value={child.data.duration || 5}
                              onChange={(e) => updateChildData('duration', parseInt(e.target.value) || 5)}
                              placeholder="Duration"
                              className="short-input"
                            />
                            {child.data.action === 'cycle' && (
                              <input
                                type="number"
                                value={child.data.interval || 10}
                                onChange={(e) => updateChildData('interval', parseInt(e.target.value) || 10)}
                                placeholder="Interval"
                                className="short-input"
                              />
                            )}
                          </>
                        )}
                        {child.data.action === 'until' && (
                          <>
                            <input
                              type="number"
                              value={child.data.targetCapacity || 50}
                              onChange={(e) => updateChildData('targetCapacity', parseInt(e.target.value) || 50)}
                              placeholder="Target %"
                              className="short-input"
                              min="1"
                              max="100"
                            />
                            <span>%</span>
                          </>
                        )}
                      </div>
                    )}
                    {child.type === 'mock_pump' && (
                      <div className="parallel-child-editor">
                        <select
                          value={child.data.target || 'inflatee1'}
                          onChange={(e) => updateChildData('target', e.target.value)}
                        >
                          <option value="inflatee1">Player</option>
                          <option value="inflatee2">Inflatee 2</option>
                        </select>
                        <select
                          value={child.data.action || 'cycle'}
                          onChange={(e) => updateChildData('action', e.target.value)}
                        >
                          <option value="on">On</option>
                          <option value="off">Off</option>
                          <option value="cycle">Cycle</option>
                          <option value="pulse">Pulse</option>
                          <option value="timed">Timed</option>
                          <option value="until">Until</option>
                        </select>
                        {child.data.action !== 'off' && child.data.action !== 'on' && child.data.action !== 'until' && (
                          <>
                            <input
                              type="number"
                              value={child.data.duration || 5000}
                              onChange={(e) => updateChildData('duration', parseInt(e.target.value) || 5000)}
                              placeholder="Duration (ms)"
                              className="short-input"
                            />
                            <span>ms</span>
                          </>
                        )}
                        {child.data.action === 'until' && (
                          <>
                            <input
                              type="number"
                              value={child.data.targetCapacity || 50}
                              onChange={(e) => updateChildData('targetCapacity', parseInt(e.target.value) || 50)}
                              placeholder="Target %"
                              className="short-input"
                              min="1"
                              max="100"
                            />
                            <span>%</span>
                          </>
                        )}
                      </div>
                    )}
                    {child.type === 'set_variable' && (
                      <div className="parallel-child-editor">
                        <input
                          type="text"
                          value={child.data.variableName || ''}
                          onChange={(e) => updateChildData('variableName', e.target.value)}
                          placeholder="Variable name"
                        />
                        <input
                          type="text"
                          value={child.data.value || ''}
                          onChange={(e) => updateChildData('value', e.target.value)}
                          placeholder="Value"
                        />
                      </div>
                    )}
                    {child.type === 'delay' && (
                      <div className="parallel-child-editor">
                        <label>Wait:</label>
                        <input
                          type="number"
                          value={child.data.duration || 1000}
                          onChange={(e) => updateChildData('duration', parseInt(e.target.value) || 1000)}
                          placeholder="Duration (ms)"
                          className="short-input"
                        />
                        <span>ms</span>
                      </div>
                    )}
                    {child.type === 'set_npc_actor_avatar' && (
                      <div className="parallel-child-editor">
                        <select
                          value={child.data.targetActorId || ''}
                          onChange={(e) => updateChildData('targetActorId', e.target.value)}
                        >
                          <option value="">Target Actor...</option>
                          {actors.map(actor => (
                            <option key={actor.id} value={actor.id}>{actor.name}</option>
                          ))}
                        </select>
                        <select
                          value={child.data.sourceType || 'actor'}
                          onChange={(e) => updateChildData('sourceType', e.target.value)}
                        >
                          <option value="actor">From Actor</option>
                          <option value="image">From Image</option>
                        </select>
                        {child.data.sourceType === 'actor' ? (
                          <select
                            value={child.data.actorId || ''}
                            onChange={(e) => updateChildData('actorId', e.target.value)}
                          >
                            <option value="">Select actor...</option>
                            {actors.map(actor => (
                              <option key={actor.id} value={actor.id}>{actor.name}</option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={child.data.imageTag || ''}
                            onChange={(e) => updateChildData('imageTag', e.target.value)}
                          >
                            <option value="">Select image...</option>
                            {(mediaImages || []).map(img => (
                              <option key={img.tag} value={img.tag}>{img.tag}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {(data.children || []).length === 0 && (
                <div className="empty-container-hint">No events yet - click + buttons below to add</div>
              )}
            </div>
            <div className="add-parallel-child-row">
              <button
                className="add-parallel-child-btn"
                onClick={() => {
                  const newChild = {
                    id: `child-${Date.now()}`,
                    type: 'pump',
                    data: { device: 'Primary Pump', action: 'on' }
                  };
                  handleDataChange('children', [...(data.children || []), newChild]);
                }}
              >
                + Pump
              </button>
              <button
                className="add-parallel-child-btn"
                onClick={() => {
                  const newChild = {
                    id: `child-${Date.now()}`,
                    type: 'mock_pump',
                    data: { target: 'inflatee1', action: 'cycle', duration: 5000, intensity: 50 }
                  };
                  handleDataChange('children', [...(data.children || []), newChild]);
                }}
              >
                + Mock Pump
              </button>
              <button
                className="add-parallel-child-btn"
                onClick={() => {
                  const newChild = {
                    id: `child-${Date.now()}`,
                    type: 'set_variable',
                    data: { variableName: '', value: '' }
                  };
                  handleDataChange('children', [...(data.children || []), newChild]);
                }}
              >
                + Set Variable
              </button>
              <button
                className="add-parallel-child-btn"
                onClick={() => {
                  const newChild = {
                    id: `child-${Date.now()}`,
                    type: 'delay',
                    data: { duration: 1000 }
                  };
                  handleDataChange('children', [...(data.children || []), newChild]);
                }}
              >
                + Delay
              </button>
              <button
                className="add-parallel-child-btn"
                onClick={() => {
                  const newChild = {
                    id: `child-${Date.now()}`,
                    type: 'set_npc_actor_avatar',
                    data: { sourceType: 'actor', actorId: '', imageTag: '', targetActorId: '' }
                  };
                  handleDataChange('children', [...(data.children || []), newChild]);
                }}
              >
                + Set Avatar
              </button>
            </div>
          </div>
        );

      case 'popup':
        return (
          <div className="para-editor">
            <textarea
              value={data.message || ''}
              onChange={(e) => handleDataChange('message', e.target.value)}
              placeholder="Popup message (supports variables)..."
              rows="4"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="para-hint">
              OK button proceeds to next paragraph, Cancel button exits play
            </div>
          </div>
        );

      case 'toast':
        return (
          <div className="para-editor">
            <textarea
              value={data.message || ''}
              onChange={(e) => handleDataChange('message', e.target.value)}
              placeholder="Toast message (supports variables)..."
              rows="2"
              style={{ width: '100%', resize: 'vertical' }}
            />
            <div className="form-row">
              <label>Duration:</label>
              <input
                type="number"
                value={data.duration || 2000}
                onChange={(e) => handleDataChange('duration', parseInt(e.target.value) || 2000)}
                min={500}
                max={10000}
                step={500}
                className="short-input"
              />
              <span>ms</span>
            </div>
            <div className="para-hint">
              Auto-advances immediately - toast shows briefly then fades
            </div>
          </div>
        );

      case 'challenge_coin':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Prompt text..."
              style={{ width: '100%', marginBottom: '10px' }}
            />

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Heads → Go to page:</label>
              <select
                value={data.headsPageId || ''}
                onChange={(e) => handleDataChange('headsPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Tails → Go to page:</label>
              <select
                value={data.tailsPageId || ''}
                onChange={(e) => handleDataChange('tailsPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                value={data.resultVariable || ''}
                onChange={(e) => handleDataChange('resultVariable', e.target.value)}
                placeholder="Variable to store result (optional)"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Skip → Go to page:</label>
              <select
                value={data.skipTargetPageId || ''}
                onChange={(e) => handleDataChange('skipTargetPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <label>
              <input
                type="checkbox"
                checked={data.autoFlip || false}
                onChange={(e) => handleDataChange('autoFlip', e.target.checked)}
              />
              {' '}Auto-flip on load
            </label>
          </div>
        );

      case 'challenge_dice':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Prompt text..."
              style={{ width: '100%', marginBottom: '10px' }}
            />

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Dice Type:</label>
              <select
                value={data.diceType || 6}
                onChange={(e) => handleDataChange('diceType', parseInt(e.target.value))}
                style={{ width: '100%' }}
              >
                <option value={4}>d4 (1-4)</option>
                <option value={6}>d6 (1-6)</option>
                <option value={8}>d8 (1-8)</option>
                <option value={10}>d10 (1-10)</option>
                <option value={12}>d12 (1-12)</option>
                <option value={20}>d20 (1-20)</option>
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Mode:</label>
              <select
                value={data.mode || 'ranges'}
                onChange={(e) => handleDataChange('mode', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="ranges">Ranges (e.g., 1-2 = Low, 3-4 = High)</option>
                <option value="direct">Direct (separate page for each value)</option>
              </select>
            </div>

            {data.mode === 'ranges' && (
              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Ranges:</label>
                {(data.ranges || []).map((range, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '5px', marginBottom: '5px', alignItems: 'center' }}>
                    <input
                      type="number"
                      value={range.min}
                      onChange={(e) => {
                        const newRanges = [...data.ranges];
                        newRanges[idx].min = parseInt(e.target.value);
                        handleDataChange('ranges', newRanges);
                      }}
                      placeholder="Min"
                      style={{ width: '60px' }}
                    />
                    <span>-</span>
                    <input
                      type="number"
                      value={range.max}
                      onChange={(e) => {
                        const newRanges = [...data.ranges];
                        newRanges[idx].max = parseInt(e.target.value);
                        handleDataChange('ranges', newRanges);
                      }}
                      placeholder="Max"
                      style={{ width: '60px' }}
                    />
                    <input
                      type="text"
                      value={range.label}
                      onChange={(e) => {
                        const newRanges = [...data.ranges];
                        newRanges[idx].label = e.target.value;
                        handleDataChange('ranges', newRanges);
                      }}
                      placeholder="Label"
                      style={{ flex: 1 }}
                    />
                    <select
                      value={range.targetPageId || ''}
                      onChange={(e) => {
                        const newRanges = [...data.ranges];
                        newRanges[idx].targetPageId = e.target.value;
                        handleDataChange('ranges', newRanges);
                      }}
                      style={{ flex: 1 }}
                    >
                      <option value="">Continue...</option>
                      {Object.keys(allPages).map(pageId => (
                        <option key={pageId} value={pageId}>
                          {allPages[pageId].title}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const newRanges = data.ranges.filter((_, i) => i !== idx);
                        handleDataChange('ranges', newRanges);
                      }}
                      style={{ padding: '4px 8px' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const newRanges = [...(data.ranges || []), { min: 1, max: 2, label: '', targetPageId: '' }];
                    handleDataChange('ranges', newRanges);
                  }}
                  style={{ marginTop: '5px' }}
                >
                  + Add Range
                </button>
              </div>
            )}

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                value={data.resultVariable || ''}
                onChange={(e) => handleDataChange('resultVariable', e.target.value)}
                placeholder="Variable to store result (optional)"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Skip → Go to page:</label>
              <select
                value={data.skipTargetPageId || ''}
                onChange={(e) => handleDataChange('skipTargetPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <label>
              <input
                type="checkbox"
                checked={data.autoRoll || false}
                onChange={(e) => handleDataChange('autoRoll', e.target.checked)}
              />
              {' '}Auto-roll on load
            </label>
          </div>
        );

      case 'challenge_wheel':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Prompt text..."
              style={{ width: '100%', marginBottom: '10px' }}
            />

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Wheel Segments:</label>
              {(data.segments || []).map((seg, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '5px', marginBottom: '5px', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={seg.label}
                    onChange={(e) => {
                      const newSegments = [...data.segments];
                      newSegments[idx].label = e.target.value;
                      handleDataChange('segments', newSegments);
                    }}
                    placeholder="Label"
                    style={{ flex: 1 }}
                  />
                  <input
                    type="color"
                    value={seg.color || '#ccc'}
                    onChange={(e) => {
                      const newSegments = [...data.segments];
                      newSegments[idx].color = e.target.value;
                      handleDataChange('segments', newSegments);
                    }}
                    style={{ width: '50px' }}
                  />
                  <input
                    type="number"
                    value={seg.weight || 1}
                    onChange={(e) => {
                      const newSegments = [...data.segments];
                      newSegments[idx].weight = parseInt(e.target.value) || 1;
                      handleDataChange('segments', newSegments);
                    }}
                    placeholder="Weight"
                    style={{ width: '70px' }}
                    min="1"
                  />
                  <select
                    value={seg.targetPageId || ''}
                    onChange={(e) => {
                      const newSegments = [...data.segments];
                      newSegments[idx].targetPageId = e.target.value;
                      handleDataChange('segments', newSegments);
                    }}
                    style={{ flex: 1 }}
                  >
                    <option value="">Continue...</option>
                    {Object.keys(allPages).map(pageId => (
                      <option key={pageId} value={pageId}>
                        {allPages[pageId].title}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const newSegments = data.segments.filter((_, i) => i !== idx);
                      handleDataChange('segments', newSegments);
                    }}
                    style={{ padding: '4px 8px' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];
                  const randomColor = colors[Math.floor(Math.random() * colors.length)];
                  const newSegments = [...(data.segments || []), { label: '', color: randomColor, weight: 1, targetPageId: '' }];
                  handleDataChange('segments', newSegments);
                }}
                style={{ marginTop: '5px' }}
              >
                + Add Segment
              </button>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                value={data.resultVariable || ''}
                onChange={(e) => handleDataChange('resultVariable', e.target.value)}
                placeholder="Variable to store result (optional)"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Skip → Go to page:</label>
              <select
                value={data.skipTargetPageId || ''}
                onChange={(e) => handleDataChange('skipTargetPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <label>
              <input
                type="checkbox"
                checked={data.autoSpin || false}
                onChange={(e) => handleDataChange('autoSpin', e.target.checked)}
              />
              {' '}Auto-spin on load
            </label>
          </div>
        );

      case 'challenge_rps':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Prompt text..."
              style={{ width: '100%', marginBottom: '10px' }}
            />

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Opponent Choice:</label>
              <select
                value={data.opponentChoice || 'random'}
                onChange={(e) => handleDataChange('opponentChoice', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="random">Random</option>
                <option value="rock">Always Rock</option>
                <option value="paper">Always Paper</option>
                <option value="scissors">Always Scissors</option>
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Win → Go to page:</label>
              <select
                value={data.winPageId || ''}
                onChange={(e) => handleDataChange('winPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Lose → Go to page:</label>
              <select
                value={data.losePageId || ''}
                onChange={(e) => handleDataChange('losePageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Tie → Go to page:</label>
              <select
                value={data.tiePageId || ''}
                onChange={(e) => handleDataChange('tiePageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                value={data.resultVariable || ''}
                onChange={(e) => handleDataChange('resultVariable', e.target.value)}
                placeholder="Result variable (win/lose/tie)"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                value={data.playerChoiceVariable || ''}
                onChange={(e) => handleDataChange('playerChoiceVariable', e.target.value)}
                placeholder="Player choice variable (rock/paper/scissors)"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Skip → Go to page:</label>
              <select
                value={data.skipTargetPageId || ''}
                onChange={(e) => handleDataChange('skipTargetPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <label>
              <input
                type="checkbox"
                checked={data.showOpponentChoice !== false}
                onChange={(e) => handleDataChange('showOpponentChoice', e.target.checked)}
              />
              {' '}Show opponent's choice
            </label>
          </div>
        );

      case 'challenge_number_guess':
        return (
          <div className="para-editor">
            <input
              type="text"
              value={data.prompt || ''}
              onChange={(e) => handleDataChange('prompt', e.target.value)}
              placeholder="Prompt text..."
              style={{ width: '100%', marginBottom: '10px' }}
            />

            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Min Number:</label>
                <input
                  type="number"
                  value={data.minNumber || 1}
                  onChange={(e) => handleDataChange('minNumber', parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Max Number:</label>
                <input
                  type="number"
                  value={data.maxNumber || 10}
                  onChange={(e) => handleDataChange('maxNumber', parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Attempts (0 = unlimited):</label>
              <input
                type="number"
                value={data.attempts || 3}
                onChange={(e) => handleDataChange('attempts', parseInt(e.target.value))}
                style={{ width: '100%' }}
                min="0"
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Correct → Go to page:</label>
              <select
                value={data.correctPageId || ''}
                onChange={(e) => handleDataChange('correctPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Incorrect → Go to page:</label>
              <select
                value={data.incorrectPageId || ''}
                onChange={(e) => handleDataChange('incorrectPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <input
                type="text"
                value={data.resultVariable || ''}
                onChange={(e) => handleDataChange('resultVariable', e.target.value)}
                placeholder="Variable to store guessed number"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px' }}>Skip → Go to page:</label>
              <select
                value={data.skipTargetPageId || ''}
                onChange={(e) => handleDataChange('skipTargetPageId', e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">Continue to next paragraph...</option>
                {Object.keys(allPages).map(pageId => (
                  <option key={pageId} value={pageId}>
                    {allPages[pageId].title}
                  </option>
                ))}
              </select>
            </div>

            <label style={{ display: 'block', marginBottom: '5px' }}>
              <input
                type="checkbox"
                checked={data.showHints !== false}
                onChange={(e) => handleDataChange('showHints', e.target.checked)}
              />
              {' '}Show hints (higher/lower)
            </label>

            <label>
              <input
                type="checkbox"
                checked={data.continueOnFail !== false}
                onChange={(e) => handleDataChange('continueOnFail', e.target.checked)}
              />
              {' '}Allow continue after failure
            </label>
          </div>
        );

      case 'end':
        return (
          <div className="para-editor">
            <select
              value={data.endingType || 'normal'}
              onChange={(e) => handleDataChange('endingType', e.target.value)}
            >
              <option value="normal">Normal Ending</option>
              <option value="good">Good Ending</option>
              <option value="bad">Bad Ending</option>
              <option value="secret">Secret Ending</option>
            </select>
            <input
              type="text"
              value={data.message || ''}
              onChange={(e) => handleDataChange('message', e.target.value)}
              placeholder="Ending message..."
            />
          </div>
        );

      default:
        return <div className="para-editor">Unknown type: {type}</div>;
    }
  };

  const getSummary = () => {
    const { type, data } = paragraph;
    switch (type) {
      case 'narration':
        return data.text ? `"${data.text.substring(0, 50)}..."` : 'Empty narration';
      case 'dialogue':
        const actor = actors.find(a => a.id === data.actorId);
        return `${actor?.name || 'Unknown'}: "${(data.text || '').substring(0, 40)}..."`;
      case 'player_dialogue':
        return `Player: "${(data.text || '').substring(0, 40)}..."`;
      case 'choice':
        return `${data.choices?.length || 0} choices`;
      case 'inline_choice':
        return `${data.options?.length || 0} options${data.requireAllOptions ? ' (required)' : ''}`;
      case 'goto_page':
        const page = allPages[data.targetPageId];
        return `→ ${page?.title || 'Unknown page'}`;
      case 'condition':
        return `${data.variable} ${data.operator} ${data.value}`;
      case 'set_variable':
        return `${data.variableName} = ${data.value}`;
      case 'set_npc_actor_avatar':
        if (data.sourceType === 'image') {
          return `Show image: ${data.imageTag || 'None'}`;
        }
        const npcActor = actors.find(a => a.id === data.actorId);
        return `Show: ${npcActor?.name || 'None'}`;
      case 'delay':
        return `Wait ${data.duration}ms`;
      case 'pump':
        return `${data.device || 'Pump'}: ${data.action || 'cycle'}`;
      case 'mock_pump':
        const targetLabel = data.target === 'inflatee2' ? 'Inflatee 2' : 'Player';
        return `${targetLabel}: ${data.action || 'cycle'}${data.duration ? ` (${data.duration}ms)` : ''}`;
      case 'parallel_container':
        const childCount = (data.children || []).length;
        return `${childCount} event${childCount !== 1 ? 's' : ''} run simultaneously`;
      case 'popup':
        const msg = data.message || 'Popup';
        return msg.length > 30 ? msg.substring(0, 30) + '...' : msg;
      case 'toast':
        const toastMsg = data.message || 'Toast';
        return toastMsg.length > 30 ? toastMsg.substring(0, 30) + '...' : toastMsg;
      case 'challenge_coin':
        return '🪙 Coin Flip: Heads or Tails';
      case 'challenge_dice':
        return `🎲 Dice: d${data.diceType || 6} (${data.mode || 'ranges'})`;
      case 'challenge_wheel':
        return `🎡 Wheel: ${data.segments?.length || 0} segments`;
      case 'challenge_rps':
        return `✊ Rock Paper Scissors`;
      case 'challenge_number_guess':
        return `🔢 Guess ${data.minNumber || 1}-${data.maxNumber || 10} (${data.attempts || 3} attempts)`;
      case 'end':
        return `${data.endingType} ending`;
      default:
        return type;
    }
  };

  return (
    <div className="paragraph-event">
      <div className="para-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="para-icon">{TYPE_ICONS[paragraph.type] || '?'}</span>
        <span className="para-summary">{getSummary()}</span>
        <div className="para-controls">
          {canEnhance && (
            <button
              className="enhance-btn"
              onClick={handleEnhanceClick}
              disabled={isEnhancing || !paragraph.data?.text}
              title="LLM Enhance text"
            >
              {isEnhancing ? '...' : '🤖'}
            </button>
          )}
          <button
            className="move-btn"
            onClick={(e) => { e.stopPropagation(); onMove('up'); }}
            disabled={index === 0}
          >
            ↑
          </button>
          <button
            className="move-btn"
            onClick={(e) => { e.stopPropagation(); onMove('down'); }}
            disabled={index === totalCount - 1}
          >
            ↓
          </button>
          <button
            className="delete-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            ✕
          </button>
        </div>
      </div>
      {isExpanded && renderEditor()}
    </div>
  );
}

export default ParagraphEvent;
