const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    exclude: ['tests/integration/**'],
  },
});
