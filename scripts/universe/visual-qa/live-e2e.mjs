#!/usr/bin/env node
/**
 * The locally built frontend, loaded against the live API.
 *
 * The matrix beside this one answers every request from fixtures, which is
 * what makes it fast and deterministic and also what makes it blind to a
 * bound the real service enforces. A fixture answers whatever it is asked.
 * A chain does not: Dogecoin returns up to a thousand pending transactions
 * and Zcash refuses anything above two hundred as a bad request rather than
 * trimming it. The dashboard asked both for four hundred, so the Zcash lens
 * and arrivals list were empty on every real load while every fixture and
 * every unit test passed.
 *
 * So this loads the build that is about to ship and sends its API calls to
 * a deployed origin. It is the cheapest check that can see a contract the
 * two sides disagree about, and it belongs between a green matrix and a
 * cutover rather than after one.
 *
 * It reports what each page rendered rather than asserting: the deployment
 * it reads is live, so a chain in a genuine outage would fail assertions
 * for telling the truth. Read the output, and the screenshots beside it.
 *
 * Usage:
 *   node live-e2e.mjs [--local=URL] [--live=URL] [--out=DIR] <path>...
 *   node live-e2e.mjs dogecoin zcash dogecoin/mining zcash/graphs/mempool
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import playwright from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = [];
const options = {};
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/.exec(argument);
  if (match) {
    options[match[1]] = match[2];
  } else {
    args.push(argument.replace(/^\/+/, ''));
  }
}

const LOCAL = (options.local || 'http://127.0.0.1:8123').replace(/\/+$/, '');
const LIVE = (options.live || 'https://explorer.bitcoinuniverse.io').replace(/\/+$/, '');
const OUT = resolve(options.out || join(HERE, 'artifacts-live'));
const PATHS = args.length ? args : ['dogecoin', 'zcash'];

mkdirSync(OUT, { recursive: true });

const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Only the API is forwarded. The page, its chunks and its assets come from
// the local build, which is the half being tested.
await context.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  try {
    const response = await fetch(LIVE + url.pathname + url.search, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      body: await response.text(),
    });
  } catch {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'live-origin-unreachable' }),
    });
  }
});

/**
 * What a chain page rendered. Counted rather than judged, for the reason in
 * the header: this reads a live deployment.
 */
function readPage() {
  const text = (node) => node.textContent.trim();
  return {
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
    panels: [...document.querySelectorAll('section.panel h2')].map(text).slice(0, 12),
    futureCubes: document.querySelectorAll('.timeline-side.future .candidate-cube').length,
    confirmedCubes: document.querySelectorAll('.timeline-side.confirmed .candidate-cube').length,
    heights: [...document.querySelectorAll('.cube-height')].slice(0, 6).map(text),
    miners: [...document.querySelectorAll('.miner-name')].slice(0, 4).map(text),
    charts: document.querySelectorAll('div[_echarts_instance_]').length,
    lensRects: document.querySelectorAll('canvas.block-overview-canvas').length,
    notices: [...document.querySelectorAll('.notice.empty, .notice.failure')]
      .map((node) => text(node).slice(0, 80))
      .slice(0, 5),
  };
}

console.log(`local ${LOCAL}, API from ${LIVE}`);
for (const path of PATHS) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    // A websocket to the local gateway has no upstream here and its refusal
    // is a fact about this harness, not about the build.
    const text = message.text();
    if (message.type() === 'error' && !/WebSocket connection to/.test(text)) {
      errors.push(text.slice(0, 140));
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error).slice(0, 140)}`));
  try {
    await page.goto(`${LOCAL}/${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(3_500);
    const facts = await page.evaluate(readPage);
    await page.screenshot({
      path: join(OUT, `${path.replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`),
    });
    console.log(`\n--- /${path}`);
    console.log(JSON.stringify(facts, null, 1));
  } catch (error) {
    console.log(`\n--- /${path}`);
    console.log(`  did not load: ${String(error).slice(0, 140)}`);
  }
  if (errors.length) {
    console.log('  console errors:', errors.slice(0, 4));
  }
  await page.close();
}

await browser.close();
console.log(`\nscreenshots in ${OUT}`);
