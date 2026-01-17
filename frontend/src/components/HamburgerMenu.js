import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import '../styles/HamburgerMenu.css';

function HamburgerMenu({ onNewSession, onSaveSession, onLoadSession, onHelpOpen }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSessionSubmenuOpen, setIsSessionSubmenuOpen] = useState(false);
  const [isAutomationSubmenuOpen, setIsAutomationSubmenuOpen] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

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

  // Modal pages that need exit animation before navigation
  const MODAL_PAGES = ['/personas', '/characters', '/settings', '/screenplay'];

  // Check if current page is a modal page
  const isOnModalPage = () => {
    return MODAL_PAGES.some(page => location.pathname.startsWith(page));
  };

  // Handle navigation with proper exit animations
  const navigateWithAnimation = (targetPath) => {
    setIsOpen(false);
    setIsSessionSubmenuOpen(false);
    setIsAutomationSubmenuOpen(false);

    if (location.pathname === '/flows') {
      // Dispatch exit event for FlowEditor to animate out
      window.dispatchEvent(new CustomEvent('exit-flows', { detail: { path: targetPath } }));
    } else if (isOnModalPage()) {
      // Dispatch exit event for modal pages to animate out
      window.dispatchEvent(new CustomEvent('exit-modal', { detail: { path: targetPath } }));
    } else {
      navigate(targetPath);
    }
  };

  // Handle ScreenPlay navigation
  const handleScreenPlayClick = (e) => {
    e.preventDefault();
    navigateWithAnimation('/screenplay');
  };

  // Handle generic nav click that needs exit animation
  const handleNavClick = (e, targetPath) => {
    if (location.pathname === '/flows' || isOnModalPage()) {
      e.preventDefault();
      navigateWithAnimation(targetPath);
    }
    // Otherwise let NavLink handle it normally
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
          onClick={(e) => handleNavClick(e, '/')}
          end
        >
          Chat
        </NavLink>

        <NavLink
          to="/personas"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
          onClick={(e) => handleNavClick(e, '/personas')}
        >
          Personas
        </NavLink>

        <NavLink
          to="/characters"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
          onClick={(e) => handleNavClick(e, '/characters')}
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
                onClick={(e) => handleNavClick(e, '/flows')}
              >
                Flows
              </NavLink>
              <button
                className={`automation-submenu-item ${location.pathname === '/screenplay' ? 'active' : ''}`}
                onClick={handleScreenPlayClick}
              >
                ScreenPlay
              </button>
            </div>
          )}
        </div>

        <NavLink
          to="/settings"
          className={({ isActive }) => `hamburger-menu-item ${isActive ? 'active' : ''}`}
          onClick={(e) => handleNavClick(e, '/settings')}
        >
          Settings
        </NavLink>

        <button
          className="hamburger-menu-item"
          onClick={() => {
            setIsOpen(false);
            onHelpOpen?.();
          }}
        >
          Help
        </button>

        <a
          href="https://github.com/airegasm/swelldreams/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="hamburger-menu-item report-issue"
        >
          Report Issue
        </a>

        {/* Logo at bottom of menu */}
        <a
          href="https://www.airegasm.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hamburger-menu-logo"
        >
          <img src="/logo.png" alt="SwellDreams" />
        </a>
      </div>
    </div>
  );
}

export default HamburgerMenu;
