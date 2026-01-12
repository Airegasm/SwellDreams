import React from 'react';
import { useNavigate } from 'react-router-dom';
import PersonaTab from '../components/settings/PersonaTab';
import './Settings.css';

function Personas() {
  const navigate = useNavigate();

  return (
    <div className="settings-page page">
      <div className="page-header">
        <h1>Personas - Experience Pressure From Any Perspective</h1>
        <button className="header-close-btn" onClick={() => navigate('/')} title="Back to Chat">
          &times;
        </button>
      </div>
      <div className="tab-content">
        <PersonaTab />
      </div>
    </div>
  );
}

export default Personas;
