import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@fixtures': fixtures } },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] }, // fixtures/ lives beside frontend/
    // Browser calls /api/* on :5173; Vite forwards to Express on :4000.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
