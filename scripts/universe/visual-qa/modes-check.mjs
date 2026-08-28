#!/usr/bin/env node
/**
 * Two modes the route matrix does not cover: forced colours, and 200% zoom.
 *
 * Forced colours is what a reader using a high contrast operating system theme
 * actually sees. The browser replaces the palette wholesale, so the question is
 * not whether the brand survives, because it does not and should not. It is
 * whether the interface is still usable once the palette is gone: are controls
 * still bounded, is text still present, does anything end up painted on itself.
 *
 * 200% zoom is WCAG 1.4.4 and 1.4.10. At a 1280 viewport that leaves 640 CSS
 * pixels, and nothing may scroll horizontally at that width.
 *
 * Both run against the same REST fixtures as the matrix, so a page under review
 * has real content rather than an empty shell. The socket is not mocked here,
 * so the chain strip renders its placeholder blocks and the header reports
 * itself offline. That is deliberate: the questions this file asks are about
 * reflow and about surviving a replaced palette, and both are answered by the
 * page structure rather than by live chain data. The route matrix in
 * capture.mjs is what reviews the data surfaces.
 *
 * Usage:
 *   node scripts/universe/visual-qa/modes-check.mjs [--base=URL] [--out=DIR]
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import playwright from 'playwright';

import { addressFixtures, detailFixtures, fixtures, sampleIds } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const BASE = args.base || 'http://127.0.0.1:8171';
const OUT = resolve(args.out || join(HERE, 'artifacts-modes'));

const ROUTES = [
  ['home', '/'],
  ['tx', `/tx/${sampleIds.TXID_A}`],
  ['blocks', '/blocks'],
  ['protocols', '/protocols'],
  ['graphs', '/graphs/mempool'],
];

/** Answer every API call from the same table the matrix uses. */
async function installFixtures(context) {
  const table = { ...fixtures, ...detailFixtures, ...addressFixtures };
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = table[path] ?? Object.entries(table).find(([k]) => path.startsWith(k))?.[1];
    if (body === undefined) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

mkdirSync(OUT, { recursive: true });

const browser = await playwright.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const findings = [];

async function sweep(label, contextOptions, zoom) {
  const context = await browser.newContext(contextOptions);
  await installFixtures(context);
  for (const [id, path] of ROUTES) {
    const page = await context.newPage();
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    if (zoom) {
      await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
    }
    await page.waitForTimeout(1200);

    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      // A page whose own content scrolls sideways has failed reflow. A rounding
      // pixel is not a failure, so the tolerance is one.
      const overflow = doc.scrollWidth - doc.clientWidth;
      let painted = 0;
      for (const el of document.querySelectorAll('a, button, h1, h2, h3, td, th, p, label')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if ((el.textContent || '').trim() && style.color === style.backgroundColor) painted++;
      }
      return { overflow, painted, chars: (document.body.innerText || '').trim().length };
    });

    findings.push({ label, id, ...report });
    await page.screenshot({ path: join(OUT, `${id}__${label}.png`) });
    await page.close();
  }
  await context.close();
}

await sweep('forced-colors', {
  viewport: { width: 1280, height: 900 },
  forcedColors: 'active',
  colorScheme: 'light',
}, null);

await sweep('zoom-200', { viewport: { width: 1280, height: 900 } }, 2);

await browser.close();

console.log(`\n=== ${findings.length} checks -> ${OUT}\n`);
console.log('mode           route       overflow  text-on-itself  body chars');
const failures = [];
for (const f of findings) {
  const problems = [];
  if (f.overflow > 1) problems.push('OVERFLOW');
  if (f.painted > 0) problems.push('TEXT ON ITSELF');
  if (f.chars < 200) problems.push('NO CONTENT');
  if (problems.length) failures.push({ ...f, problems });
  console.log(
    `${f.label.padEnd(14)} ${f.id.padEnd(11)} ${String(f.overflow).padStart(8)} ` +
    `${String(f.painted).padStart(15)} ${String(f.chars).padStart(11)}` +
    (problems.length ? '   ' + problems.join(', ') : ''),
  );
}

if (failures.length) {
  console.error(`\n${failures.length} route(s) fail in a mode the product claims to support.`);
  process.exit(1);
}
console.log('\nForced colours and 200% zoom both hold on every route checked.');
