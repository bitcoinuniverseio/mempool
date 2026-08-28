#!/usr/bin/env node
/**
 * Every filled surface that carries text has to declare the ink on it.
 *
 * `check-palettes.mjs` proves that the token pairs are readable: white on the
 * brand fill, near black on the dark theme's brand, the block ink on a block
 * face. It cannot see whether a component actually uses them together. A rule
 * that paints a brand background and says nothing about colour inherits the
 * page ink, which on the light theme is near black on hot pink.
 *
 * That failure is invisible in review whenever the surface belongs to a feature
 * this deployment disables, which is exactly where it was found: an accelerate
 * button and four menu badges, none of which render here, all of which would
 * have been wrong the day someone turned them on.
 *
 * A fill that carries no text needs no ink, so the check only looks at rules
 * that also set a text property. A dot, a bar, a rule and a toggle track are
 * all correctly left alone.
 *
 * Usage:
 *   node scripts/universe/check-fills.mjs [path ...]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SKIPPED = new Set(['node_modules', 'dist', '.angular', '.git']);

/**
 * Backgrounds that are strong enough that page ink cannot be assumed to read on
 * them. Tints such as --u-brand-subtle are not here: they are designed to carry
 * normal text, and check-palettes measures them.
 */
const STRONG_FILLS = [
  'u-brand', 'u-brand-hover', 'u-brand-active', 'u-gradient-brand',
  'u-magenta', 'u-fuchsia', 'u-lavender',
  'u-state-proven', 'u-state-partial', 'u-state-pending', 'u-state-unavailable',
  'title-fg', 'primary', 'tertiary',
];

/** Declaring any of these means the rule made a deliberate choice of ink. */
const DECLARES_INK = /(?:^|[\s;{])color\s*:/;

/** A rule that sets one of these is laying out text. */
const CARRIES_TEXT = /(?:padding|font-size|font-weight|font-family|line-height|text-align|text-transform|letter-spacing)\s*:/;

function* walk(path) {
  const stats = statSync(path);
  if (stats.isFile()) { yield path; return; }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED.has(entry.name)) continue;
      yield* walk(join(path, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.scss')) {
      yield join(path, entry.name);
    }
  }
}

const args = process.argv.slice(2);
const targets = args.length ? args.map((a) => resolve(ROOT, a)) : [resolve(ROOT, 'frontend/src')];

const findings = [];
let checked = 0;

for (const target of targets) {
  for (const file of walk(target)) {
    const css = readFileSync(file, 'utf8');
    // Innermost blocks only, so a declaration is judged against its own rule.
    for (const match of css.matchAll(/\{([^{}]*)\}/g)) {
      const body = match[1];
      const fills = STRONG_FILLS.filter((token) =>
        new RegExp(`(?:background|background-color|background-image)\\s*:[^;]*var\\(--${token}\\s*[),]`).test(body));
      if (!fills.length) continue;
      checked++;
      if (DECLARES_INK.test(body)) continue;
      if (!CARRIES_TEXT.test(body)) continue;
      findings.push({
        file: relative(ROOT, file).split(sep).join('/'),
        line: css.slice(0, match.index).split(/\r?\n/).length,
        fills: fills.join(', '),
        snippet: body.trim().replace(/\s+/g, ' ').slice(0, 96),
      });
    }
  }
}

if (!findings.length) {
  console.log(`Every strong fill that carries text declares its ink (${checked} fills checked).`);
  process.exit(0);
}

console.error(`${findings.length} filled surface(s) carrying text without a declared ink:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.fills}]`);
  console.error(`    ${f.snippet}`);
}
console.error(
  '\nA filled surface inherits the page ink unless it says otherwise, which on the' +
    '\nlight theme is near black on a saturated fill. Add the foreground the fill' +
    '\ndeclares: --u-brand-contrast for a brand fill, --u-text-inverse for a state.',
);
process.exit(1);
