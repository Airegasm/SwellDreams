import React, { useState } from 'react';

function MediaReferenceCard() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="media-reference-card">
      <div className="media-reference-header" onClick={() => setExpanded(!expanded)}>
        <span>Media Variables Reference</span>
        <span className="collapse-icon">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="media-reference-body">
          <p className="media-reference-hint">
            Use these variables in character messages, welcome messages, flow actions, or any text field to embed media into chat.
            The <strong>tag</strong> is the unique label you assign when uploading media.
          </p>
          <table className="media-reference-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>[Image:tag]</code></td>
                <td>Display an image in the chat message</td>
              </tr>
              <tr>
                <td><code>[Video:tag]</code></td>
                <td>Play a video once (auto-plays inline)</td>
              </tr>
              <tr>
                <td><code>[Video:tag:loop]</code></td>
                <td>Play a video on loop</td>
              </tr>
              <tr>
                <td><code>[Video:tag:blocking]</code></td>
                <td>Play video and block chat until it finishes</td>
              </tr>
              <tr>
                <td><code>[Audio:tag]</code></td>
                <td>Play audio with a visible player in chat</td>
              </tr>
              <tr>
                <td><code>[Audio:tag:nomsg]</code></td>
                <td>Play audio silently in the background (no bubble)</td>
              </tr>
            </tbody>
          </table>
          <div className="media-reference-example">
            <strong>Example:</strong>
            <code>*She turns on the machine* [Audio:pump-hum:nomsg] [Image:gauge-rising]</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default MediaReferenceCard;
