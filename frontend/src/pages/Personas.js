import React from 'react';
import PersonaTab from '../components/settings/PersonaTab';
import './Settings.css';

function Personas() {
  return (
    <div className="settings-page page">
      <div className="page-header">
        <h1>Personas - Experience Pressure From Any Perspective</h1>
      </div>
      <div className="tab-content">
        <PersonaTab />
      </div>
    </div>
  );
}

export default Personas;
