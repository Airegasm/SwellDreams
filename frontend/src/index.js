import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './context/AppContext';
import { ErrorProvider } from './context/ErrorContext';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/variables.css';
import './styles/App.css';
import './components/ErrorBoundary.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ErrorProvider>
          <AppProvider>
            <App />
          </AppProvider>
        </ErrorProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
