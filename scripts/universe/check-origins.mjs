#!/usr/bin/env node
/**
 * Third-party data origin gate.
 *
 * Every figure this explorer publishes comes from infrastructure Bitcoin
 * Universe runs. A single call to a hosted blockchain API, public explorer, or
 * analytics service breaks that promise, and it is the kind of thing that slips
 * in through a well-meaning fallback. So it is checked.
 *
 * Usage:
 *   node scripts/universe/check-origins.mjs [path ...]
 *
 * The release workflow runs it over the source tree and over `frontend/dist`.
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

/**
 * Hosts that must never appear as a runtime data source.
 *
 * Public blockchain APIs and explorers, hosted protocol indexers, analytics,
 * and remote font and script CDNs.
 */
const FORBIDDEN_HOSTS = [
  'mempool.space',
  'blockstream.info',
  'blockchain.info',
  'blockchair.com',
  'btc.com',
  'oklink.com',
  'unisat.io',
  'ordiscan.com',
  'ordinals.com',
  'hiro.so',
  'geniidata.com',
  'bestinslot.xyz',
  'openstamp.io',
  'stampchain.io',
  'magiceden.io',
  'esplora.blockstream.com',
  'google-analytics.com',
  'googletagmanager.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
];

/**
 * Places a host name may legitimately appear: research that names competitors,
 * fork provenance, this gate's own list, and documentation about the policy.
 */
const ALLOWED = [
  'frontend/src/app/docs/api-docs/api-docs.component.html',
  'docs/research/',
  'docs/legal/',
  'docs/architecture/',
  'docs/operations/UPSTREAM-SYNC.md',
  'UPSTREAM.md',
  'upstream-base.json',
  'COPYING.md',
  'CONTRIBUTING.md',
  'README.md',
  'contributors/',
  'audits/',
  'scripts/universe/check-origins.mjs',
  'scripts/universe/check-branding.mjs',
  'frontend/src/locale/',
  'backend/README.md',
  'frontend/README.md',
  'production/',
  'docker/',
  'rust/',
  // Upstream test fixtures and sample configuration, never a runtime path.
  'backend/src/__fixtures__/',
  'frontend/cypress/',
  '.github/workflows/',
  'nginx.conf',
  'nginx-mempool.conf',
];

/**
 * Sentences that name a host in order to disclaim it rather than call it.
 * Recognised as whole phrases so a bundle scan still sees them after
 * minification.
 */
const DISCLAIMER_PHRASES = [
  'It is not affiliated with or endorsed by mempool.space.',
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.scss', '.css',
  '.md', '.yml', '.yaml', '.txt', '.sh', '.rs', '.sql', '.conf', '.map',
]);

/** Character ranges covered by a disclaimer sentence in this file. */
function disclaimerSpans(contents) {
  const spans = [];
  for (const phrase of DISCLAIMER_PHRASES) {
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

function isAllowed(relativePath) {
  const posix = relativePath.split(sep).join('/');
  return ALLOWED.some((prefix) => posix.startsWith(prefix));
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
  if (isAllowed(relativePath)) return [];
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const spans = disclaimerSpans(contents);
  const hits = [];
  for (const host of FORBIDDEN_HOSTS) {
    // A host only counts when it stands on its own. Without the boundaries a
    // filename like `btc.component.html` reads as the host `btc.com`, and a
    // spec citation like `docs.ordinals.com` reads as `ordinals.com`.
    const pattern = new RegExp(
      `(?<![A-Za-z0-9.-])${host.replace(/\./g, '\\.')}(?![A-Za-z0-9-])`,
      'g',
    );
    for (const match of contents.matchAll(pattern)) {
      if (spans.some(([start, end]) => match.index >= start && match.index < end)) {
        continue;
      }
      const line = contents.slice(0, match.index).split('\n').length;
      hits.push({ file: relativePath, line, host });
      if (hits.length > 20) return hits;
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
for (const target of targets(explicitTargets)) {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    console.error(`Origin gate: ${target} does not exist.`);
    process.exit(1);
  }
  if (stats.isDirectory()) {
    for (const file of walk(target, explicitTargets.length === 0)) problems.push(...findings(file));
  } else {
    problems.push(...findings(target));
  }
}

if (problems.length > 0) {
  console.error(`Third-party origins found in ${problems.length} place(s):`);
  for (const problem of problems.slice(0, 50)) {
    console.error(`  ${problem.file}:${problem.line}: ${problem.host}`);
  }
  console.error('\nRuntime data must come from Bitcoin Universe infrastructure only.');
  process.exit(1);
}

console.log('Origin gate passed: no third-party data origins found.');
