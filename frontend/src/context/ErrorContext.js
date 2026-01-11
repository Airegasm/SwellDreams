/**
 * Error Context - Provides toast notifications for errors and messages
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import './ErrorContext.css';

const ErrorContext = createContext(null);

// Toast types
export const TOAST_TYPES = {
  ERROR: 'error',
  WARNING: 'warning',
  SUCCESS: 'success',
  INFO: 'info',
};

/**
 * Error Provider Component
 */
export function ErrorProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  /**
   * Show a toast notification
   * @param {string} message - Message to display
   * @param {string} type - Toast type (error, warning, success, info)
   * @param {number} duration - Auto-dismiss duration in ms (0 = no auto-dismiss)
   * @returns {string} Toast ID for manual dismissal
   */
  const showToast = useCallback((message, type = TOAST_TYPES.ERROR, duration = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    setToasts(prev => [...prev, { id, message, type, timestamp: Date.now() }]);

    if (duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }

    return id;
  }, []);

  /**
   * Dismiss a specific toast
   */
  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  /**
   * Dismiss all toasts
   */
  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  /**
   * Convenience methods
   */
  const showError = useCallback((message, duration = 5000) => {
    return showToast(message, TOAST_TYPES.ERROR, duration);
  }, [showToast]);

  const showWarning = useCallback((message, duration = 5000) => {
    return showToast(message, TOAST_TYPES.WARNING, duration);
  }, [showToast]);

  const showSuccess = useCallback((message, duration = 3000) => {
    return showToast(message, TOAST_TYPES.SUCCESS, duration);
  }, [showToast]);

  const showInfo = useCallback((message, duration = 4000) => {
    return showToast(message, TOAST_TYPES.INFO, duration);
  }, [showToast]);

  const value = {
    toasts,
    showToast,
    showError,
    showWarning,
    showSuccess,
    showInfo,
    dismissToast,
    dismissAll,
  };

  return (
    <ErrorContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ErrorContext.Provider>
  );
}

/**
 * Toast Container Component
 */
function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * Individual Toast Component
 */
function Toast({ toast, onDismiss }) {
  const { id, message, type } = toast;

  const getIcon = () => {
    switch (type) {
      case TOAST_TYPES.ERROR:
        return '\u2716'; // X mark
      case TOAST_TYPES.WARNING:
        return '\u26A0'; // Warning triangle
      case TOAST_TYPES.SUCCESS:
        return '\u2714'; // Check mark
      case TOAST_TYPES.INFO:
      default:
        return '\u2139'; // Info circle
    }
  };

  return (
    <div className={`toast toast-${type}`} role="alert">
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{message}</span>
      <button
        className="toast-dismiss"
        onClick={() => onDismiss(id)}
        aria-label="Dismiss"
      >
        \u00D7
      </button>
    </div>
  );
}

/**
 * Hook to use error context
 */
export function useError() {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return context;
}

/**
 * Hook to use toast notifications (alias)
 */
export function useToast() {
  return useError();
}

export default ErrorContext;
