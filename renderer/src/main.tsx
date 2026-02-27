import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

window.onerror = (message, source, lineno, colno, error) => {
  const errStr = `Error: ${message} at ${source}:${lineno}:${colno}${error ? `\nStack: ${error.stack}` : ''}`;
  window.smdrInsight?.log('error', errStr);
};

window.onunhandledrejection = (event) => {
  window.smdrInsight?.log('warn', `Unhandled rejection: ${event.reason}`);
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
