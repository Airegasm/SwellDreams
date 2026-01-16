import React from 'react';

/**
 * Reusable AI Message Fields for Challenge Nodes
 * Provides optional AI message generation at start, win, and lose events
 */
function AIMessageFields({ data }) {
  const handleChange = (field, value) => {
    data.onChange?.(field, value);
  };

  return (
    <div className="ai-message-fields">
      <div className="ai-message-section">
        <label className="node-checkbox">
          <input
            type="checkbox"
            checked={data.aiMessageStartEnabled !== false}
            onChange={(e) => handleChange('aiMessageStartEnabled', e.target.checked)}
          />
          AI Intro Message
        </label>
        {data.aiMessageStartEnabled !== false && (
          <>
            <textarea
              value={data.aiMessageStart || ''}
              onChange={(e) => handleChange('aiMessageStart', e.target.value)}
              placeholder="Prompt for AI when challenge starts... (e.g., 'Challenge [Player] to a game and explain the rules')"
              className="node-textarea"
              rows={2}
            />
            <label className="node-checkbox suppress-llm">
              <input
                type="checkbox"
                checked={data.aiMessageStartSuppressLlm || false}
                onChange={(e) => handleChange('aiMessageStartSuppressLlm', e.target.checked)}
              />
              Suppress LLM Enhancement
            </label>
          </>
        )}
      </div>

      <div className="ai-message-section">
        <label className="node-checkbox">
          <input
            type="checkbox"
            checked={data.aiMessageWinEnabled || false}
            onChange={(e) => handleChange('aiMessageWinEnabled', e.target.checked)}
          />
          AI Message (Char Wins)
        </label>
        {data.aiMessageWinEnabled && (
          <textarea
            value={data.aiMessageWin || ''}
            onChange={(e) => handleChange('aiMessageWin', e.target.value)}
            placeholder="Prompt for AI when character wins... (e.g., 'Celebrate winning and tease [Player]')"
            className="node-textarea"
            rows={2}
          />
        )}
      </div>

      <div className="ai-message-section">
        <label className="node-checkbox">
          <input
            type="checkbox"
            checked={data.aiMessageLoseEnabled || false}
            onChange={(e) => handleChange('aiMessageLoseEnabled', e.target.checked)}
          />
          AI Message (Char Loses)
        </label>
        {data.aiMessageLoseEnabled && (
          <textarea
            value={data.aiMessageLose || ''}
            onChange={(e) => handleChange('aiMessageLose', e.target.value)}
            placeholder="Prompt for AI when character loses... (e.g., 'React to losing and congratulate [Player]')"
            className="node-textarea"
            rows={2}
          />
        )}
      </div>

      <div className="ai-message-section">
        <label className="node-checkbox">
          <input
            type="checkbox"
            checked={data.aiMessageResultEnabled || false}
            onChange={(e) => handleChange('aiMessageResultEnabled', e.target.checked)}
          />
          AI Message (Result)
        </label>
        {data.aiMessageResultEnabled && (
          <>
            <textarea
              value={data.aiMessageResult || ''}
              onChange={(e) => handleChange('aiMessageResult', e.target.value)}
              placeholder="Message announcing the result. Use [Result] for the outcome (e.g., 'The wheel lands on... [Result]!')"
              className="node-textarea"
              rows={2}
            />
            <label className="node-checkbox suppress-llm">
              <input
                type="checkbox"
                checked={data.aiMessageResultSuppressLlm || false}
                onChange={(e) => handleChange('aiMessageResultSuppressLlm', e.target.checked)}
              />
              Suppress LLM Enhancement
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export default AIMessageFields;
