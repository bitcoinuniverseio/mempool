import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the Universe module.
 *
 * The suite exercises component and service logic directly rather than through
 * the Angular TestBed: the pieces that carry risk here are the evidence
 * derivations, label vocabulary, and API contract handling, none of which need
 * a DOM. Template correctness is covered by the AOT production build, which
 * fails on any template error.
 */
export default defineConfig({
  // The root tsconfig.json is solution-style and carries no compiler options,
  // so esbuild has to be told that Angular uses legacy TypeScript decorators.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
        target: 'ES2022',
      },
    },
  },
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/app/components', import.meta.url)),
      '@environments': fileURLToPath(new URL('./src/environments', import.meta.url)),
      '@interfaces': fileURLToPath(new URL('./src/app/interfaces', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/universe-test-setup.ts'],
    include: ['src/app/universe/**/*.spec.ts', 'src/app/shared/**/*.spec.ts'],
    reporters: ['default'],
  },
});
