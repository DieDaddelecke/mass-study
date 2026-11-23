import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    // whole-building layouts (duplex, variant comparison) run several seconds under coverage
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
