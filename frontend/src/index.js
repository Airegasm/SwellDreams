import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './context/AppContext';
import { ErrorProvider } from './context/ErrorContext';
import './styles/variables.css';
import './styles/App.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ErrorProvider>
    </BrowserRouter>
  </React.StrictMode>
);
