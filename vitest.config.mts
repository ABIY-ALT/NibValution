import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Native tsconfig path resolution: `@/*` maps to `src/*` exactly as it does
    // for the application build, so a test cannot pass against a different
    // module graph than production uses.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    globals: false,
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one PostgreSQL database, so they run in a single
    // file-sequential pass rather than racing each other over the same rows.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/server/domain/**', 'src/lib/**'],
      thresholds: {
        // The valuation and workflow logic is what an auditor will scrutinise;
        // it is held to a materially higher bar than the UI.
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
});
