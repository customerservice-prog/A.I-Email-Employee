const { defineConfig } = require('vitest/config');

/** Isolated process so PGlite dir + env are not shared with unit tests. */
module.exports = defineConfig({
  test: {
    testTimeout: 30_000,
    environment: 'node',
    include: ['tests/integration/**/*.test.mjs'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
