#!/usr/bin/env node
/**
 * What a reader actually sees on the public chain pages, in a browser, against
 * the public origin, with nothing mocked.
 *
 * This is the gate that was missing. Every other check in this repository
 * either reads the API without a browser or renders the frontend against
 * fixtures, and all of them stayed green for as long as production served a
 * chain dashboard that ran its status facts together in one line, put a whole
 * opaque snapshot identifier in the primary interface, headed static
 * capability metadata "What is happening now", said Dogecoin was degraded
 * without a word about why, and published "Release development" to the public.
 * Nothing was broken in a way any of them could see: the API answered, the
 * fixtures rendered the newer build, and the older build was the one on the
 * origin.
 *
 * The judgements live in `chain-page-audit.mjs`, which is tested. This file
 * collects what the browser saw and hands it over.
 *
 * Usage:
 *   node chain-page-smoke.mjs [--origin=URL] [--release=SHA] [--out=DIR]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import playwright from 'playwright';

import { CHAIN_NAMES, auditChainPage, auditRelease } from './chain-page-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const ORIGIN = String(args.origin || 'https://explorer.bitcoinuniverse.io').replace(/\/$/, '');
const EXPECTED_RELEASE = typeof args.release === 'string' ? args.release : null;
const OUT = resolve(args.out || join(HERE, 'artifacts-chain-smoke'));
const REQUEST_TIMEOUT_MS = 20_000;

const failures = [];
const notes = [];

function record(result) {
  failures.push(...result.failures);
  notes.push(...result.notes);
}

async function readJson(path) {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/**
 * The commit the site publishes, which is the frontend's and not the overlay's.
 * They are different components and are allowed to differ; the point of reading
 * it here is to prove the origin serves the release this run was pointed at.
 */
async function frontendCommit() {
  const response = await fetch(`${ORIGIN}/resources/config.js`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  return body.match(/GIT_COMMIT_HASH\s*=\s*'([^']+)'/)?.[1] ?? null;
}

/**
 * Everything a reader sees before opening anything, and everything filed behind
 * the technical disclosure, kept apart.
 *
 * A closed disclosure renders only its summary, so its contents are read from
 * the markup and the primary text is read with the disclosures hidden. Reading
 * either one the other way makes the snapshot check meaningless, since the
 * whole assertion is that a value is in the second and not the first.
 *
 * Runs inside the page, so it may use no import from this file.
 */
function readPageText() {
  const root = document.querySelector('.chain-page');
  if (!root) {
    return null;
  }
  const disclosures = [...root.querySelectorAll('details')];
  const disclosure = disclosures.map((node) => node.textContent).join('\n');
  const restore = disclosures.map((node) => node.style.display);
  disclosures.forEach((node) => {
    node.style.display = 'none';
  });
  const primary = root.innerText;
  disclosures.forEach((node, index) => {
    node.style.display = restore[index];
  });
  const notReady = root.querySelector('.not-ready');
  return {
    primary,
    disclosure,
    rail: [...root.querySelectorAll('.status-rail .reading')].map((node) => ({
      label: node.querySelector('.reading-label')?.innerText?.trim() ?? '',
      value: node.querySelector('.universe-chip')?.innerText?.trim() ?? '',
    })),
    headings: [...root.querySelectorAll('h1, h2')].map((node) => node.innerText.trim()),
    notReadyReasons: notReady
      ? [...notReady.querySelectorAll('li')].map((node) => node.innerText.trim())
      : [],
    coverage: [...root.querySelectorAll('.history-coverage li')].map((node) => ({
      label: node.querySelector('.coverage-label')?.innerText?.trim() ?? '',
      state: node.querySelector('.universe-chip')?.innerText?.trim() ?? '',
    })),
    entries: [...root.querySelectorAll('.entry-actions a.entry')].map((node) => ({
      href: node.getAttribute('href'),
      title: node.querySelector('.entry-title')?.innerText?.trim() ?? '',
      detail: node.querySelector('.entry-detail')?.innerText?.trim() ?? '',
    })),
    horizontalOverflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

async function checkChain(browser, chain) {
  const { status, body: envelope } = await readJson(`/api/v1/${chain}/status`);
  if (status !== 200 || !envelope) {
    failures.push(
      `page:${chain}: /api/v1/${chain}/status answered HTTP ${status}, so there is nothing to hold the page to`,
    );
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const foreignRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(ORIGIN).origin && url.protocol !== 'data:') {
      foreignRequests.push(request.url());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.url()} HTTP ${response.status()}`);
    }
  });

  try {
    await page.goto(`${ORIGIN}/${chain}`, { waitUntil: 'networkidle', timeout: 45_000 });
    // The labelled status rail is this dashboard's own structure. An origin
    // still serving the dashboard it replaced loads perfectly and has no such
    // element, which is exactly the state that had to be caught by hand, so a
    // missing rail becomes a named finding rather than a thrown timeout.
    const rendered = await page
      .waitForSelector('.chain-page .status-rail', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    mkdirSync(OUT, { recursive: true });
    const seen = rendered ? await page.evaluate(readPageText) : null;
    await page.screenshot({
      path: join(OUT, rendered ? `${chain}.png` : `${chain}-unrecognised.png`),
      fullPage: true,
    });
    if (seen) {
      writeFileSync(join(OUT, `${chain}.txt`), seen.primary, 'utf8');
    }

    const entryStatus = {};
    for (const entry of seen?.entries ?? []) {
      if (!entry.href?.startsWith(`/${chain}/`)) {
        continue;
      }
      const response = await fetch(`${ORIGIN}${entry.href}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch(() => null);
      entryStatus[entry.href] = response ? response.status : 599;
    }

    record(
      auditChainPage({
        chain,
        envelope,
        seen,
        observations: { consoleErrors, failedRequests, foreignRequests, entryStatus },
      }),
    );
  } finally {
    await context.close();
  }
}

async function main() {
  console.log(`Chain page smoke against ${ORIGIN}`);
  record(auditRelease(await frontendCommit(), EXPECTED_RELEASE));

  const browser = await playwright.chromium.launch();
  try {
    for (const chain of Object.keys(CHAIN_NAMES)) {
      await checkChain(browser, chain);
    }
  } finally {
    await browser.close();
  }

  for (const note of notes) console.log(`  ok    ${note}`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  if (failures.length) {
    console.error(`\n${failures.length} chain page check(s) failed against ${ORIGIN}`);
    process.exit(1);
  }
  console.log(`\nAll chain page checks passed against ${ORIGIN}`);
}

main().catch((error) => {
  console.error(`Chain page smoke could not run: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
