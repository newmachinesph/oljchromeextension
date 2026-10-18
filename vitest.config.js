import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.js: that config's root is src/options, which
 * would put the test directory out of scope.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
