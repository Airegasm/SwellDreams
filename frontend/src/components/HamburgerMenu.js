import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import '../styles/HamburgerMenu.css';

function HamburgerMenu({ onNewSession, onSaveSession, onLoadSession }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSessionSubmenuOpen, setIsSessionSubmenuOpen] = useState(false);
  const [isAutomationSubmenuOpen, setIsAutomationSubmenuOpen] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setIsSessionSubmenuOpen(false);
        setIsAutomationSubmenuOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close menu on route change
  useEffect(() => {
    setIsOpen(false);
    setIsSessionSubmenuOpen(false);
    setIsAutomationSubmenuOpen(false);
  }, [location]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (isOpen) {
      setIsSessionSubmenuOpen(false);
      setIsAutomationSubmenuOpen(false);
    }
  };

  const handleSessionAction = (action) => {
    action();
    setIsOpen(false);
    setIsSessionSubmenuOpen(false);
  };

  return (
    <div className="hamburger-menu" ref={menuRef}>
      <button
        className={`hamburger-button ${isOpen ? 'open' : ''}`}
        onClick={handleToggle}
        aria-label="Toggle menu"
        aria-expanded={isOpen}
      >
        <span className="hamburger-bar"></span>
        <span className="hamburger-bar"></span>
        <span className="hamburger-bar"></span>
      </button>

      {/* Overlay */}
      <div
        className={`hamburger-overlay ${isOpen ? 'visible' : ''}`}
        onClick={() => {
          setIsOpen(false);
          setIsSessionSubmenuOpen(false);
          setIsAutomationSubmenuOpen(false);
        }}
      />

      {/* Menu Panel */}
      <div className={`hamburger-menu-panel ${isOpen ? 'open' : ''}`}>
        {/* Session with expandable submenu */}
        <div className="session-section">
          <div
            className={`hamburger-menu-item has-submenu ${isSessionSubmenuOpen ? 'submenu-active' : ''}`}
            onClick={() => setIsSessionSubmenuOpen(!isSessionSubmenuOpen)}
          >
            <span className={`submenu-arrow ${isSessionSubmenuOpen ? 'expanded' : ''}`}>›</span>
            <span>Session</span>
          </div>

          {/* Session Submenu - expands below */}
          {isSessionSubmenuOpen && (
            <div className="session-submenu-inline">
              <button
                className="session-submenu-item"
                onClick={() => handleSessionAction(onNewSession)}
              >
                New
              </button>
              <button
                className="session-submenu-item"
                onClick={() => handleSessionAction(onSaveSession)}
              >
                Save
              </button>
              <button
                className="session-submenu-item"
                onClick={() => handleSessionAction(onLoadSession)}
              >
                Load
              </button>
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <NavLink
          to="/"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
          end
        >
          Chat
        </NavLink>

        <NavLink
          to="/personas"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
        >
          Personas
        </NavLink>

        <NavLink
          to="/characters"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
        >
          Characters
        </NavLink>

        {/* Automation with expandable submenu */}
        <div className="automation-section">
          <div
            className={`hamburger-menu-item has-submenu ${isAutomationSubmenuOpen ? 'submenu-active' : ''}`}
            onClick={() => setIsAutomationSubmenuOpen(!isAutomationSubmenuOpen)}
          >
            <span className={`submenu-arrow ${isAutomationSubmenuOpen ? 'expanded' : ''}`}>›</span>
            <span>Automation</span>
          </div>

          {/* Automation Submenu - expands below */}
          {isAutomationSubmenuOpen && (
            <div className="automation-submenu-inline">
              <NavLink
                to="/flows"
                className={({ isActive }) => `automation-submenu-item ${isActive ? 'active' : ''}`}
              >
                Flows
              </NavLink>
              <NavLink
                to="/screenplay"
                className={({ isActive }) => `automation-submenu-item ${isActive ? 'active' : ''}`}
              >
                ScreenPlay
              </NavLink>
            </div>
          )}
        </div>

        <NavLink
          to="/settings"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
        >
          Settings
        </NavLink>

        <NavLink
          to="/help"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
        >
          Help
        </NavLink>

        <a
          href="https://github.com/airegasm/swelldreams/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="hamburger-menu-item report-issue"
        >
          Report Issue
        </a>
      </div>
    </div>
  );
}

export default HamburgerMenu;
