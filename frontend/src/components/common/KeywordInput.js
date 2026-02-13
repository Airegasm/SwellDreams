import React, { useState } from 'react';
import './KeywordInput.css';

/**
 * Keyword Tag Input Component
 *
 * Allows users to add/remove keywords as tags.
 * Press Enter to add, Backspace to remove last tag.
 */
function KeywordInput({ values = [], onChange, placeholder = 'Type keyword and press Enter...' }) {
  const [input, setInput] = useState('');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      const newKeyword = input.trim();

      // Don't add duplicates
      if (!values.includes(newKeyword)) {
        onChange([...values, newKeyword]);
      }
      setInput('');
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      // Remove last tag when backspace on empty input
      onChange(values.slice(0, -1));
    }
  };

  const handleRemove = (index) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="keyword-input">
      <div className="keyword-tags">
        {values.map((keyword, index) => (
          <span key={index} className="keyword-tag">
            {keyword}
            <button
              type="button"
              className="keyword-tag-remove"
              onClick={() => handleRemove(index)}
              title="Remove keyword"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="keyword-input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ''}
        />
      </div>
    </div>
  );
}

export default KeywordInput;
