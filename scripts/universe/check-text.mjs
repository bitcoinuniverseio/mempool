#!/usr/bin/env node
/**
 * Text gate: no em dash anywhere.
 *
 * U+2014 is banned in this repository's source, copy, documentation, tests,
 * fixtures, and metadata. The rule is easy to break by accident, so it is
 * enforced rather than remembered.
 *
 * Usage:
 *   node scripts/universe/check-text.mjs [path ...]
 *
 * With no arguments it scans the whole repository, skipping directories that
 * are not ours to police (dependencies, build output, git internals).
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
 */
const ALLOWED_PATHS = [
  'frontend/src/locale/',
];

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.scss', '.css',
  '.md', '.yml', '.yaml', '.txt', '.sh', '.rs', '.sql', '.conf', '.xlf',
]);

// Built from its code point so this file does not contain the character it bans.
const EM_DASH = String.fromCharCode(0x2014);

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
  if (!contents.includes(EM_DASH)) return [];
  const hits = [];
  contents.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(EM_DASH)) {
      hits.push({ file: relativePath, line: index + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

function targets(argv) {
  if (argv.length === 0) return [REPOSITORY_ROOT];
  return argv.map((entry) => resolve(REPOSITORY_ROOT, entry));
}

const problems = [];
for (const target of targets(process.argv.slice(2))) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const file of walk(target)) problems.push(...findings(file));
  } else {
    problems.push(...findings(target));
  }
}

if (problems.length > 0) {
  console.error(`Em dash found in ${problems.length} place(s). Use a colon, a comma, or two sentences.`);
  for (const problem of problems.slice(0, 50)) {
    console.error(`  ${problem.file}:${problem.line}: ${problem.text}`);
  }
  if (problems.length > 50) {
    console.error(`  ... and ${problems.length - 50} more`);
  }
  process.exit(1);
}

console.log('Text gate passed: no em dash found.');
