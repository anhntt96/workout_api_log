import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');

// Placeholder until Task 4 mounts the app.
createRoot(root).render(
  <StrictMode>
    <p className="p-8 font-semibold text-lime-300">Workout Log</p>
  </StrictMode>,
);
