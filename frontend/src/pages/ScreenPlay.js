import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ScreenPlay.css';

function ScreenPlay() {
  const navigate = useNavigate();

  return (
    <div className="screenplay-page page">
      <div className="page-header">
        <h1>ScreenPlay</h1>
        <button className="header-close-btn" onClick={() => navigate('/')} title="Back to Chat">
          &times;
        </button>
      </div>

      <div className="screenplay-content">
        <div className="screenplay-placeholder">
          <p>ScreenPlay editor coming soon...</p>
        </div>
      </div>
    </div>
  );
}

export default ScreenPlay;
