import React, { memo } from 'react';
import './Nodes.css';

const COLORS = [
  { value: 'yellow', label: 'Yellow', bg: '#fef3c7', border: '#f59e0b' },
  { value: 'blue', label: 'Blue', bg: '#dbeafe', border: '#3b82f6' },
  { value: 'green', label: 'Green', bg: '#d1fae5', border: '#10b981' },
  { value: 'red', label: 'Red', bg: '#fee2e2', border: '#ef4444' },
  { value: 'purple', label: 'Purple', bg: '#ede9fe', border: '#8b5cf6' }
];

function CommentNode({ data, selected }) {
  const colorConfig = COLORS.find(c => c.value === data.color) || COLORS[0];

  return (
    <div
      className={`custom-node comment-node ${selected ? 'selected' : ''}`}
      style={{
        backgroundColor: colorConfig.bg,
        borderColor: colorConfig.border,
        borderWidth: '2px',
        borderStyle: 'dashed'
      }}
    >
      {/* No handles - comment nodes cannot connect */}
      <div className="node-header comment-header" style={{ borderBottom: `1px dashed ${colorConfig.border}` }}>
        <span className="node-icon">📝</span>
        <input
          type="text"
          className="node-title-input"
          value={data.label || ''}
          onChange={(e) => data.onChange?.('label', e.target.value)}
          placeholder="Note"
          style={{ color: '#1f2937' }}
        />
      </div>
      <div className="node-body comment-body">
        <textarea
          value={data.text || ''}
          onChange={(e) => data.onChange?.('text', e.target.value)}
          placeholder="Add your notes here..."
          className="comment-textarea"
          rows={3}
          style={{ color: '#1f2937', backgroundColor: 'transparent' }}
        />
        <div className="comment-color-picker">
          {COLORS.map(c => (
            <button
              key={c.value}
              className={`color-swatch ${data.color === c.value ? 'active' : ''}`}
              style={{ backgroundColor: c.border }}
              onClick={() => data.onChange?.('color', c.value)}
              title={c.label}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(CommentNode);
