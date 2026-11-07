import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so unit tests run without starting the Workers runtime.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
