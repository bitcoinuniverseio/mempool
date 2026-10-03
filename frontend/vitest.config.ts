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
  /**
   * IMPLEMENTATION-HANDOFF [WP-FE-001] | D-FE-001 | C-FE-CI-01..03 | 2026-10-03.
   * GitHub run 37009333065, job 110845029936, fails three 5000ms tests:
   * ark-backup-crypto.spec.ts wrong-passphrase/tamper; consensus-conformance.spec.ts
   * SSR evidence render; portfolio-shell.component.spec.ts real overview route.
   * 2513 assertions passed; the log proves timeouts, not a broken cipher or UI.
   * Governing runner: Vitest 3.2.7, https://v3.vitest.dev/config/#testtimeout and
   * #maxworkers. Handoff evidence/frontend-ci-job-110845029936-excerpts.txt.
   * 1. Reproduce all three on the pinned CI runner with CPU/memory allocation
   *    recorded; compare a bounded two-worker run with the present default.
   *    Start with maxWorkers=2 in the implementation change; retain the real
   *    authenticated decrypt, Angular renderer and routed chart dependency.
   * 2. Measure crypto-case duration with its real 600000 PBKDF2 rounds. If a
   *    case exceeds the measured budget, give only that case a finite explicit
   *    timeout with a documented margin. Never lower KDF cost, skip negative
   *    assertions, disable timeouts globally or replace the renderer with a stub.
   * 3. Diagnose unresolved teardown/worker handles before increasing budgets:
   *    this sandbox printed passing files but the isolated runner did not exit
   *    inside 45s. A printed test success is not a successful command exit.
   * 4. Update the three named specs and .github/workflows/universe-ci.yml only
   *    as required by measured runner constraints. Run npm test -- --maxWorkers=2
   *    for the three files, then three full suite runs and npm run build:universe
   *    on the release runner. Require all assertions, clean exits and artifacts.
   * Prerequisites: pinned Node/npm install, writable TMPDIR, CI runner access.
   * Acceptance is a stable CI gate, separate from Signet feature acceptance.
   * Rollback only the runner/test policy change; preserve cryptographic behavior.
   */
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/universe-test-setup.ts'],
    include: [
      'src/app/universe/**/*.spec.ts',
      'src/app/shared/**/*.spec.ts',
      'src/app/components/**/*.spec.ts',
      // The shared request cache the three API services use. Its two faults
      // were only reachable through a network switch and through a retry, so
      // they are asserted here rather than in a browser check.
      'src/app/services/**/*.spec.ts',
    ],
    reporters: ['default'],
  },
});
