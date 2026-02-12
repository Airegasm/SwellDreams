import React, { useState, useCallback, useEffect, useRef } from 'react';
import { substituteVariables } from '../../utils/variableSubstitution';

function InputModal({ inputData, onSubmit, subContext, compact = false }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const {
    prompt,
    placeholder,
    inputType = 'text',
    minValue,
    maxValue,
    required = true,
    variableName = 'Input'
  } = inputData || {};

  // Auto-focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Reset value when inputData changes
  useEffect(() => {
    setValue('');
    setError(null);
  }, [inputData?.nodeId]);

  const validateInput = useCallback((val) => {
    // For 1Button type, no validation needed
    if (inputType === '1button') {
      return null;
    }

    if (required && (!val || val.toString().trim() === '')) {
      return 'Value is required';
    }

    if (inputType === 'number') {
      const numVal = parseFloat(val);
      if (isNaN(numVal)) {
        return 'Please enter a valid number';
      }
      if (minValue !== null && minValue !== undefined && numVal < minValue) {
        return `Value must be at least ${minValue}`;
      }
      if (maxValue !== null && maxValue !== undefined && numVal > maxValue) {
        return `Value must be at most ${maxValue}`;
      }
    }

    return null;
  }, [inputType, minValue, maxValue, required]);

  const handleSubmit = useCallback(() => {
    // For 1Button type, submit the placeholder text as the value
    if (inputType === '1button') {
      onSubmit(placeholder || 'Continue');
      return;
    }

    const validationError = validateInput(value);
    if (validationError) {
      setError(validationError);
      return;
    }

    const finalValue = inputType === 'number' ? parseFloat(value) : value;
    onSubmit(finalValue);
  }, [value, inputType, validateInput, onSubmit, placeholder]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  if (!inputData) return null;

  const isValid = !validateInput(value);

  return (
    <div className={`player-choice-panel input-modal ${compact ? 'compact' : ''}`}>
      <div className="player-choice-panel-header">
        <h3>Input Required</h3>
      </div>
      <div className="player-choice-panel-body">
        {prompt && (
          <p className="choice-description input-prompt">
            {substituteVariables(prompt, subContext)}
          </p>
        )}
        {/* Only show input field for text/number types */}
        {inputType !== '1button' && (
          <div className="input-container">
            {inputType === 'number' ? (
              <input
                ref={inputRef}
                type="number"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder || 'Enter a number...'}
                min={minValue}
                max={maxValue}
                className="input-field number"
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder || 'Enter your response...'}
                className="input-field text"
              />
            )}
            {error && <div className="input-error">{error}</div>}
            {inputType === 'number' && (minValue !== null || maxValue !== null) && (
              <div className="input-hint">
                {minValue !== null && maxValue !== null
                  ? `Range: ${minValue} - ${maxValue}`
                  : minValue !== null
                  ? `Minimum: ${minValue}`
                  : `Maximum: ${maxValue}`
                }
              </div>
            )}
          </div>
        )}
        <div className="input-actions">
          <button
            className="btn btn-primary btn-large"
            onClick={handleSubmit}
            disabled={required && !isValid}
          >
            {inputType === '1button' ? (placeholder || 'Continue') : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InputModal;
