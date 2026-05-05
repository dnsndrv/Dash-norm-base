import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import Research from './Research';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <Research />
      </main>
    </div>
  </StrictMode>,
);
