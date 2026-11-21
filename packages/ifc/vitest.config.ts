import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'ifc', environment: 'node', testTimeout: 30000 },
});
