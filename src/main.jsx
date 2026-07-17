import React from 'react';
import { createRoot } from 'react-dom/client';
import PomodoroApp from './PomodoroApp.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PomodoroApp />
  </React.StrictMode>
);
