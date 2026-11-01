import { defineConfig } from 'vitest/config';

const ARCHITECTURE_TESTS = 'tests/architecture/**/*.test.ts';
const ALL_TESTS = 'tests/**/*.test.ts';
const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    testTimeout: TEST_TIMEOUT_MS,
    projects: [
      {
        extends: true,
        test: { name: 'behaviour', include: [ALL_TESTS], exclude: [ARCHITECTURE_TESTS] },
      },
      {
        extends: true,
        test: { name: 'architecture', include: [ARCHITECTURE_TESTS] },
      },
    ],
  },
});
