import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    // In development the API Worker runs under `wrangler dev` on :8787.
    // In production the Pages Function in functions/api forwards /api/* to it.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: {
    target: 'es2022',
  },
});
