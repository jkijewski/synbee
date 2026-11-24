import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'material-symbols/outlined.css';
import './styles.css';

// Bootstrap's dark theme follows the system setting.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const theme = () => document.documentElement.setAttribute('data-bs-theme', dark.matches ? 'dark' : 'light');
theme();
dark.addEventListener('change', theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
