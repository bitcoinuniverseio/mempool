import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The Explorer never had an administration panel of its own. Its operations
 * live in the unified Bitcoin Universe Control Center, and `/admin` on this
 * host has to say so rather than falling through to the Angular not-found
 * page, which reads to an operator as "the panel is broken".
 *
 * The redirect belongs in nginx rather than in the application: it has to
 * answer before the bundle loads, and it has to answer for a request that
 * never reaches Angular at all.
 */

const config = readFileSync(
  fileURLToPath(new URL('../../nginx-mempool.conf', import.meta.url)),
  'utf8',
);

function adminBlock() {
  const start = config.indexOf('location ~ ^/admin');
  assert.notEqual(start, -1, 'nginx has no /admin location block');
  const end = config.indexOf('\n\t}', start);
  assert.notEqual(end, -1, 'the /admin location block is not closed');
  return config.slice(start, end);
}

test('nginx answers /admin before Angular ever loads', () => {
  const block = adminBlock();
  assert.match(block, /return\s+301\s+https:\/\/inscribe\.bitcoinuniverse\.io\/admin\//u);
});

test('the redirect is permanent, because this address is not coming back', () => {
  assert.match(adminBlock(), /return\s+301\b/u);
  assert.doesNotMatch(adminBlock(), /return\s+30[27]\b/u);
});

test('the redirect never downgrades to plain http', () => {
  const block = adminBlock();
  const targets = [...block.matchAll(/return\s+301\s+(\S+);/gu)].map((match) => match[1]);
  assert.ok(targets.length > 0, 'the block returns nothing');
  for (const target of targets) {
    assert.ok(target.startsWith('https://'), `${target} is not https`);
  }
});

test('the redirect lands on the Explorer, not on a generic overview', () => {
  assert.match(adminBlock(), /application=explorer/u);
});

test('the redirect stays out of search results and caches', () => {
  const block = adminBlock();
  assert.match(block, /X-Robots-Tag\s+"noindex, nofollow, noarchive"/u);
  assert.match(block, /Cache-Control\s+"no-store"/u);
});

test('every /admin path is covered, not only the exact root', () => {
  const block = adminBlock();
  // `location = /admin` would leave /admin/anything falling through to the
  // Angular not-found page, which is the state this gate exists to prevent.
  assert.match(block, /location\s+~\s+\^\/admin\(\/\.\*\)\?\$/u);
});

test('the block is declared before the catch-all that would swallow it', () => {
  const admin = config.indexOf('location ~ ^/admin');
  const fallback = config.indexOf('location / {');
  assert.ok(
    admin < fallback,
    'the /admin redirect must be declared before the site fallback',
  );
});
