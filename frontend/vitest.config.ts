import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests for the code this product owns.
 *
 * The suite exercises component, service, and pipe logic directly rather than
 * through the Angular TestBed: the pieces that carry risk here are the evidence
 * derivations, label vocabulary, API contract handling, and the small pure
 * helpers the templates lean on, none of which need a DOM. Template correctness
 * is covered by the AOT production build, which fails on any template error.
 *
 * The two inherited Lightning specs are deliberately outside the include. They
 * are TestBed specs that need a browser environment and an Angular testing
 * module this configuration does not set up, and they cover a feature this
 * deployment does not enable.
 *
 * `src/app/components` is included for the shell: the adaptive behaviour that
 * could not be expressed in CSS lives there, and it is exactly the sort of
 * thing that is cheap to test directly and expensive to find in a browser.
 * Only files this product owns are under it; the inherited components in that
 * tree ship no specs.
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
    include: [
      'src/app/universe/**/*.spec.ts',
      'src/app/shared/**/*.spec.ts',
      'src/app/components/**/*.spec.ts',
    ],
    reporters: ['default'],
  },
});
