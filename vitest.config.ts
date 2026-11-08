import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so unit tests run without starting the Workers runtime.
export default defineConfig({
  resolve: {
    alias: {
      // The production entry embeds the built web app; tests use a small fixture instead.
      'virtual:client-assets': new URL('./src/worker/__fixtures__/client-assets.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
