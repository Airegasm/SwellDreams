import React from 'react';
import CharacterTab from '../components/settings/CharacterTab';
import './Settings.css';

function Characters() {
  return (
    <div className="settings-page page">
      <div className="page-header">
        <h1>Characters - Bringing Fantasy Inflators to Life</h1>
      </div>
      <div className="tab-content">
        <CharacterTab />
      </div>
    </div>
  );
}

export default Characters;
