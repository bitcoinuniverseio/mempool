#!/usr/bin/env node
/**
 * Branding gate: no obsolete upstream product marks.
 *
 * This fork keeps the upstream code and the upstream licence. It does not keep
 * the upstream product identity. This gate fails when a Mempool Holdings mark
 * appears anywhere except the small set of places where it is legally required
 * or factually necessary.
 *
 * Usage:
 *   node scripts/universe/check-branding.mjs [path ...]
 *
 * The release workflow runs it twice: once over the source tree, and once over
 * `frontend/dist`, because an unreachable lazy chunk still ships.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..');

const SKIPPED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'target', 'coverage', '.angular', '.cache',
]);

/**
 * Build output is skipped when scanning the tree, because a stale bundle from a
 * previous build would fail the gate for code that no longer exists. Scanning a
 * bundle is a separate, explicit run against a named directory.
 */
const SKIPPED_WHEN_WALKING_ROOT = new Set(['dist', 'build']);

/** Product marks that must not appear in Universe Explorer's own surface. */
const FORBIDDEN = [
  'mempool.space',
  'Mempool Open Source Project',
  'Mempool Enterprise',
  'Mempool Accelerator',
  'Mempool Wallet',
  'Mempool Goggles',
  'Be your own explorer',
  'Explore the full Bitcoin ecosystem',
  'stats.mempool.space',
];

/**
 * Where an upstream reference is allowed, and why.
 *
 * Each entry is a path prefix plus the reason it is exempt. Nothing outside
 * this list may name an upstream product, so a new exemption is a deliberate,
 * reviewable act.
 */
const ALLOWED = [
  { prefix: 'COPYING.md', reason: 'upstream licence text, preserved verbatim' },
  { prefix: 'LICENSE', reason: 'licence text' },
  { prefix: 'UPSTREAM.md', reason: 'fork provenance record' },
  { prefix: 'upstream-base.json', reason: 'fork provenance record' },
  { prefix: 'CONTRIBUTING.md', reason: 'inherited contribution guide' },
  { prefix: 'contributors/', reason: 'upstream contributor records' },
  { prefix: 'docs/legal/', reason: 'trademark and licence compliance records' },
  { prefix: 'docs/research/', reason: 'competitor research naming the competitor' },
  { prefix: 'docs/operations/UPSTREAM-SYNC.md', reason: 'upstream synchronization procedure' },
  { prefix: 'docs/architecture/', reason: 'records which upstream subsystems are modified' },
  { prefix: 'scripts/universe/check-branding.mjs', reason: 'this gate lists the marks it bans' },
  { prefix: 'frontend/src/locale/', reason: 'upstream translation catalogues, not built by this deployment' },
  { prefix: 'frontend/src/app/docs/api-docs/api-docs.component.html', reason: 'fork attribution statement required by the licence' },
  { prefix: 'backend/README.md', reason: 'inherited developer notes' },
  { prefix: 'frontend/README.md', reason: 'inherited developer notes' },
  { prefix: 'production/', reason: 'inherited operator notes for upstream-style deployments' },
  { prefix: 'docker/', reason: 'inherited container notes' },
  { prefix: 'rust/', reason: 'inherited crate notes' },
  { prefix: 'audits/', reason: 'dated audit records' },
  { prefix: 'README.md', reason: 'fork attribution required by the licence' },
  { prefix: 'scripts/universe/check-origins.mjs', reason: 'the origin gate lists the hosts it bans' },
  { prefix: 'frontend/cypress/', reason: 'inherited upstream end-to-end suite and recorded fixtures, not shipped' },
  { prefix: '.github/workflows/', reason: 'inherited upstream CI definitions; Universe CI is separate' },
];

/**
 * Attribution sentences this product deliberately publishes.
 *
 * The licence requires that the upstream work be credited and that the
 * corresponding source be available. Naming the upstream project inside one of
 * these exact sentences is the point of them. They are listed here as whole
 * phrases so that a bundle scan can recognise them after minification, where
 * the source file they came from is no longer knowable.
 */
const ATTRIBUTION_PHRASES = [
  'an independent instance of the AGPL-licensed Mempool Open Source Project codebase, operated for the Bitcoin Universe ecosystem. It is not affiliated with or endorsed by mempool.space.',
  'Universe Explorer is free software built on the Mempool Open Source Project.',
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.scss', '.css',
  '.md', '.yml', '.yaml', '.txt', '.sh', '.rs', '.sql', '.conf', '.xlf', '.map',
]);

/** Character ranges covered by an attribution sentence in this file. */
function attributionSpans(contents) {
  const spans = [];
  for (const phrase of ATTRIBUTION_PHRASES) {
    let index = contents.indexOf(phrase);
    while (index !== -1) {
      spans.push([index, index + phrase.length]);
      index = contents.indexOf(phrase, index + phrase.length);
    }
  }
  return spans;
}

function hasTextExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot));
}

function allowanceFor(relativePath) {
  const posix = relativePath.split(sep).join('/');
  return ALLOWED.find((entry) => posix.startsWith(entry.prefix)) ?? null;
}

function* walk(directory, skipBuildOutput) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (skipBuildOutput && SKIPPED_WHEN_WALKING_ROOT.has(entry.name)) continue;
      yield* walk(full, skipBuildOutput);
    } else if (entry.isFile() && hasTextExtension(entry.name)) {
      yield full;
    }
  }
}

function findings(file) {
  const relativePath = relative(REPOSITORY_ROOT, file);
  if (allowanceFor(relativePath)) return [];
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const spans = attributionSpans(contents);
  const inAttribution = (index) =>
    spans.some(([start, end]) => index >= start && index < end);

  const hits = [];
  for (const mark of FORBIDDEN) {
    let index = contents.indexOf(mark);
    while (index !== -1) {
      if (!inAttribution(index)) {
        const line = contents.slice(0, index).split('\n').length;
        hits.push({ file: relativePath, line, mark });
        if (hits.length > 20) return hits;
      }
      index = contents.indexOf(mark, index + mark.length);
    }
  }
  return hits;
}

const explicitTargets = process.argv.slice(2);

function targets(argv) {
  if (argv.length === 0) return [REPOSITORY_ROOT];
  return argv.map((entry) => resolve(REPOSITORY_ROOT, entry));
}

const problems = [];
let scanned = 0;
for (const target of targets(explicitTargets)) {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    console.error(`Branding gate: ${target} does not exist.`);
    process.exit(1);
  }
  if (stats.isDirectory()) {
    for (const file of walk(target, explicitTargets.length === 0)) {
      scanned += 1;
      problems.push(...findings(file));
    }
  } else {
    scanned += 1;
    problems.push(...findings(target));
  }
}

// The target existing is not the same as the target holding anything. An
// Angular build empties its output directory before rewriting it, so a run
// against `frontend/dist` at the wrong moment, or after a build that failed
// without saying so, reads zero files and reports the same pass as a clean
// output. This gate guards the release artifact too.
if (scanned === 0) {
  console.error('Branding gate read no files. There was nothing to check, which is not the same as nothing to find.');
  console.error(`Targets: ${targets(explicitTargets).join(', ')}`);
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`Obsolete upstream product marks found in ${problems.length} place(s):`);
  for (const problem of problems.slice(0, 50)) {
    console.error(`  ${problem.file}:${problem.line}: ${problem.mark}`);
  }
  console.error('\nIf a reference is legally required or names a competitor in research,');
  console.error('add it to ALLOWED in scripts/universe/check-branding.mjs with a reason.');
  process.exit(1);
}

console.log('Branding gate passed: no obsolete upstream product marks outside the allowlist.');
