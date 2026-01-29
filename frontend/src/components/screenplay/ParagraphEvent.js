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
              <div className="pump-description">
                {PUMP_ACTION_DESCRIPTIONS[data.action || 'cycle']}
              </div>
            </div>
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
