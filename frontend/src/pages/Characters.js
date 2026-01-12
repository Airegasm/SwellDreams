import React from 'react';
import { useNavigate } from 'react-router-dom';
import CharacterTab from '../components/settings/CharacterTab';
import './Settings.css';

function Characters() {
  const navigate = useNavigate();

  return (
    <div className="settings-page page">
      <div className="page-header">
        <h1>Characters - Bringing Fantasy Inflators to Life</h1>
        <button className="header-close-btn" onClick={() => navigate('/')} title="Back to Chat">
          &times;
        </button>
      </div>
      <div className="tab-content">
        <CharacterTab />
      </div>
    </div>
  );
}

export default Characters;
