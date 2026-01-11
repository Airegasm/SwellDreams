import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import '../styles/HamburgerMenu.css';

function HamburgerMenu({ onNewSession, onSaveSession, onLoadSession }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSessionSubmenuOpen, setIsSessionSubmenuOpen] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setIsSessionSubmenuOpen(false);
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
  }, [location]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (isOpen) {
      setIsSessionSubmenuOpen(false);
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
        }}
      />

      {/* Menu Panel */}
      <div className={`hamburger-menu-panel ${isOpen ? 'open' : ''}`}>
        {/* Session with submenu */}
        <div
          className={`hamburger-menu-item has-submenu ${isSessionSubmenuOpen ? 'submenu-active' : ''}`}
          onClick={() => setIsSessionSubmenuOpen(!isSessionSubmenuOpen)}
        >
          <span className="submenu-arrow">&#9664;</span>
          <span>Session</span>

          {/* Session Submenu - opens to the left */}
          <div className={`session-submenu ${isSessionSubmenuOpen ? 'open' : ''}`}>
            <button
              className="session-submenu-item"
              onClick={(e) => {
                e.stopPropagation();
                handleSessionAction(onNewSession);
              }}
            >
              New
            </button>
            <button
              className="session-submenu-item"
              onClick={(e) => {
                e.stopPropagation();
                handleSessionAction(onSaveSession);
              }}
            >
              Save
            </button>
            <button
              className="session-submenu-item"
              onClick={(e) => {
                e.stopPropagation();
                handleSessionAction(onLoadSession);
              }}
            >
              Load
            </button>
          </div>
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

        <NavLink
          to="/flows"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
        >
          Flows
        </NavLink>

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
      </div>
    </div>
  );
}

export default HamburgerMenu;
