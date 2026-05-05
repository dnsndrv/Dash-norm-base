import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base` must match the GitHub Pages path: https://<user>.github.io/Dash-norm-base/
// During local `vite dev`/`vite preview` we keep root-relative paths so the
// chart.js bundle and assets resolve cleanly without the trailing prefix.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === 'build' ? '/Dash-norm-base/' : '/',
}));
