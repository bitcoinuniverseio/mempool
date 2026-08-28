#!/usr/bin/env node
/**
 * Built asset gate.
 *
 * The production build configuration overrode the asset list down to two
 * files. Everything else the application asks for at runtime was still
 * referenced and simply was not there: both alternative theme stylesheets
 * 404ed, so a visitor who chose dark or high contrast was silently returned to
 * the default theme, and every mining pool logo 404ed on every page that names
 * a pool. Nothing failed the build, because nothing was checking.
 *
 * So this checks. Every local asset the built index references, and every
 * theme the manifest promises, has to exist in the output.
 *
 * Usage:
 *   node scripts/universe/check-build-assets.mjs [dist directory]
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = resolve(process.argv[2] || join(ROOT, 'frontend/dist/mempool/browser'));

if (!existsSync(DIST)) {
  console.error(`No build output at ${DIST}. Build first.`);
  process.exit(1);
}

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`No index.html in ${DIST}.`);
  process.exit(1);
}

const index = readFileSync(indexPath, 'utf8');
const missing = [];
const checked = [];

/** Resolve a runtime reference to a path inside the build output. */
function resolveAsset(reference) {
  const clean = reference.split(/[?#]/)[0];
  if (!clean || /^(https?:|data:|blob:|mailto:|tel:|#|\/\/)/i.test(clean)) return null;
  return join(DIST, clean.replace(/^\//, ''));
}

function require(reference, why) {
  const path = resolveAsset(reference);
  if (!path) return;
  checked.push(reference);
  if (!existsSync(path)) missing.push({ reference, why });
}

// --- Everything index.html points at ---------------------------------------

for (const [, href] of index.matchAll(/<link[^>]+href="([^"]+)"/g)) require(href, 'linked from index.html');
for (const [, src] of index.matchAll(/<script[^>]+src="([^"]+)"/g)) require(src, 'script in index.html');
for (const [, content] of index.matchAll(/<meta[^>]+(?:property|name)="(?:og:image|twitter:image)"[^>]+content="([^"]+)"/g)) {
  require(content, 'social preview image');
}

// --- Every theme the manifest promises -------------------------------------
//
// This is the one that broke. The manifest is written into index.html at build
// time and read by the theme service at runtime, so a name in it that has no
// file behind it is a theme that silently does not exist.

const manifest = index.match(/THEME_FILES\s*=\s*(\{[^;]*\})/);
if (!manifest) {
  missing.push({ reference: 'THEME_FILES', why: 'no theme manifest in index.html' });
} else {
  let themes;
  try {
    themes = JSON.parse(manifest[1]);
  } catch {
    missing.push({ reference: 'THEME_FILES', why: 'theme manifest is not valid JSON' });
    themes = {};
  }
  for (const [name, file] of Object.entries(themes)) {
    require(file, `the "${name}" theme stylesheet`);
  }
  const promised = Object.keys(themes);
  if (!promised.includes('dark') || !promised.includes('contrast')) {
    missing.push({
      reference: 'THEME_FILES',
      why: `manifest promises [${promised.join(', ')}]; dark and contrast are both required`,
    });
  }
}

// --- Assets the application fetches by convention --------------------------
//
// The pool logo fallback is named in a directive rather than in the markup, so
// nothing above would notice it going missing.

require('/resources/mining-pools/default.svg', 'the mining pool logo fallback');
require('/resources/config.js', 'the runtime configuration the application reads on boot');

// --- Report ----------------------------------------------------------------

if (missing.length) {
  console.error(`${missing.length} asset(s) referenced by the build are not in the output:\n`);
  for (const m of missing) console.error(`  ${m.reference}\n    ${m.why}`);
  console.error(
    `\nOutput scanned: ${DIST}` +
      '\nCheck the asset list of the build configuration that produced it: a configuration' +
      '\nthat overrides "assets" replaces the base list rather than adding to it.',
  );
  process.exit(1);
}

const files = readdirSync(DIST).filter((f) => statSync(join(DIST, f)).isFile()).length;
console.log(`Asset gate passed: ${checked.length} referenced assets present, ${files} files at the output root.`);
