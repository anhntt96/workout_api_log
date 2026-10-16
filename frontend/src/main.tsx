import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { AppProviders, createQueryClient } from './providers';
import { AppRoutes } from './routes';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element');

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
