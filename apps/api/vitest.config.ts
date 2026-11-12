import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests run against a real local D1 (workerd); seeding 120 days takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
