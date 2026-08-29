#!/usr/bin/env node
/**
 * Text gate: no em dash anywhere, and no "canonical" in our own vocabulary.
 *
 * U+2014 is banned in this repository's source, copy, documentation, tests,
 * fixtures, and metadata. The rule is easy to break by accident, so it is
 * enforced rather than remembered.
 *
 * The word "canonical" is banned inside the Universe-authored source, where we
 * choose the vocabulary. It is not policed across the inherited upstream tree,
 * which uses the term for the HTML rel=canonical link standard and elsewhere.
 *
 * Usage:
 *   node scripts/universe/check-text.mjs [path ...]
 *
 * With no arguments it scans the whole repository, skipping directories that
 * are not ours to police (dependencies, build output, git internals).
 *
 * Pass `frontend/dist` to scan the built output instead. Source being clean
 * does not prove the output is: copy reaches the bundle from templates, from
 * generated configuration, and from metadata, and the rule is about what a
 * reader actually sees. CI runs both.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..');

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.angular',
  '.cache',
]);

/**
 * Files we do not author. Upstream translation catalogues carry the upstream
 * copy verbatim, including its punctuation; they are not shipped by this
 * deployment's build and are regenerated when locales are re-enabled.
 *
 * The third-party licence notice in the build output is the licence text of
 * every dependency, reproduced exactly as its authors wrote it. Editing
 * somebody's licence to satisfy our punctuation rule is not an option, and it
 * is the only file in the output that carries the character.
 */
const ALLOWED_PATHS = [
  'frontend/src/locale/',
  'frontend/dist/mempool/browser/3rdpartylicenses.txt',
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.scss', '.css',
  '.md', '.yml', '.yaml', '.txt', '.sh', '.rs', '.sql', '.conf', '.xlf',
]);

// Built from its code point so this file does not contain the character it bans.
const EM_DASH = String.fromCharCode(0x2014);

// The word is only policed where we author the vocabulary. Built from a pattern
// so this gate file, which must name the word to ban it, is not itself a hit.
const UNIVERSE_SOURCE_PREFIX = 'frontend/src/app/universe/';
const CANONICAL_WORD = new RegExp(['can', 'onical'].join(''), 'i');

function isSkipped(name) {
  return SKIPPED_DIRECTORIES.has(name);
}

function isAllowed(relativePath) {
  const posix = relativePath.split(sep).join('/');
  return ALLOWED_PATHS.some((prefix) => posix.startsWith(prefix));
}

function hasTextExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot));
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isSkipped(entry.name)) continue;
      yield* walk(full);
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
  const posix = relativePath.split(sep).join('/');
  const policeCanonical = posix.startsWith(UNIVERSE_SOURCE_PREFIX);
  if (!contents.includes(EM_DASH) && !(policeCanonical && CANONICAL_WORD.test(contents))) {
    return [];
  }
  const hits = [];
  contents.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(EM_DASH)) {
      hits.push({ kind: 'em dash', file: relativePath, line: index + 1, text: line.trim().slice(0, 120) });
    }
    if (policeCanonical && CANONICAL_WORD.test(line)) {
      hits.push({ kind: 'canonical', file: relativePath, line: index + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

function targets(argv) {
  if (argv.length === 0) return [REPOSITORY_ROOT];
  return argv.map((entry) => resolve(REPOSITORY_ROOT, entry));
}

const problems = [];
let scanned = 0;
for (const target of targets(process.argv.slice(2))) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const file of walk(target)) {
      scanned += 1;
      problems.push(...findings(file));
    }
  } else {
    scanned += 1;
    problems.push(...findings(target));
  }
}

// A run that read nothing finds nothing, and used to say so in the same words
// as a clean one. `frontend/dist` exists as an empty directory for the whole
// of an Angular build, which empties its output before rewriting it, and the
// silent build failure this repository has already hit twice leaves it that
// way. This gate also guards the release artifact, so a pass it did not earn
// is the expensive kind.
if (scanned === 0) {
  console.error('Text gate read no files. There was nothing to check, which is not the same as nothing to find.');
  console.error(`Targets: ${targets(process.argv.slice(2)).join(', ')}`);
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`Text gate found ${problems.length} banned item(s):`);
  for (const problem of problems.slice(0, 50)) {
    console.error(`  ${problem.kind} ${problem.file}:${problem.line}: ${problem.text}`);
  }
  if (problems.length > 50) {
    console.error(`  ... and ${problems.length - 50} more`);
  }
  console.error('Replace an em dash with a colon, a comma, or two sentences. Rename anything using "canonical".');
  process.exit(1);
}

console.log('Text gate passed: no em dash, no "canonical" in Universe source.');
