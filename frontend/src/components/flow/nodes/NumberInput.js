import React, { useState, useEffect, memo } from 'react';

/**
 * NumberInput - A better number input for flow nodes
 *
 * Fixes common UX issues:
 * - Prevents scroll wheel from changing values
 * - Allows empty field while typing (no forced 0)
 * - Only applies default value on blur if empty
 */
function NumberInput({
  value,
  onChange,
  defaultValue = 0,
  min,
  max,
  step,
  className = 'node-input small',
  placeholder,
  allowFloat = true,
  ...props
}) {
  // Local state to allow empty string while typing
  const [localValue, setLocalValue] = useState(value ?? '');

  // Sync with external value changes
  useEffect(() => {
    setLocalValue(value ?? '');
  }, [value]);

  const handleChange = (e) => {
    const val = e.target.value;
    setLocalValue(val);

    // Only call onChange with parsed value if it's a valid number
    if (val !== '' && val !== '-') {
      let parsed = allowFloat ? parseFloat(val) : parseInt(val, 10);
      if (!isNaN(parsed)) {
        // Clamp to min/max if specified
        if (min !== undefined && parsed < min) parsed = min;
        if (max !== undefined && parsed > max) parsed = max;
        onChange?.(parsed);
      }
    }
  };

  const handleBlur = (e) => {
    const val = e.target.value;
    if (val === '' || isNaN(parseFloat(val))) {
      // Apply default on blur if empty
      setLocalValue(defaultValue);
      onChange?.(defaultValue);
    } else {
      // Ensure final value is properly parsed and clamped
      let parsed = allowFloat ? parseFloat(val) : parseInt(val, 10);
      // Clamp to min/max if specified
      if (min !== undefined && parsed < min) parsed = min;
      if (max !== undefined && parsed > max) parsed = max;
      setLocalValue(parsed);
      onChange?.(parsed);
    }
  };

  const handleWheel = (e) => {
    // Prevent scroll wheel from changing the value
    e.target.blur();
  };

  const handleKeyDown = (e) => {
    // Prevent arrow keys from scrolling when focused
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.stopPropagation();
    }
  };

  return (
    <input
      type="number"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      min={min}
      max={max}
      step={step}
      className={className}
      placeholder={placeholder}
      {...props}
    />
  );
}

export default memo(NumberInput);
