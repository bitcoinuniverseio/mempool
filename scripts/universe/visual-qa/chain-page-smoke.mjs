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

import {
  CHAIN_NAMES,
  auditChainPage,
  auditDashboardParity,
  auditRelease,
  auditSectionPage,
} from './chain-page-audit.mjs';

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

/**
 * The facts the dashboard parity judgement needs: whether a timeline was
 * drawn at all, how many cubes each side carries, whether every populated
 * cube names its height, whether the divider is there, and what the empty
 * sides say for themselves.
 *
 * Runs inside the page, so it may use no import from this file.
 */
function readDashboardFacts() {
  const region = document.querySelector('.timeline-panel .timeline-row');
  const populated = [
    ...document.querySelectorAll('.timeline-side.future .candidate-cube'),
    ...document.querySelectorAll('.timeline-side.confirmed .candidate-cube'),
  ];
  return {
    headings: [...document.querySelectorAll('h1, h2')].map((node) => node.textContent.trim()),
    timeline: {
      present: !!region,
      futureCubes: document.querySelectorAll('.timeline-side.future .candidate-cube').length,
      confirmedCubes: document.querySelectorAll('.timeline-side.confirmed .candidate-cube').length,
      heightsAboveCubes: populated.every(
        (cube) => (cube.querySelector('.cube-height')?.textContent ?? '').trim().length > 0,
      ),
      hasDivider: !!document.querySelector('.timeline-divider'),
      emptySides: [...document.querySelectorAll('.timeline-side .timeline-empty')].map((node) =>
        node.textContent.trim(),
      ),
    },
    panels: [...document.querySelectorAll('.chain-page section.panel h2')].map((node) =>
      node.textContent.trim(),
    ),
  };
}

/**
 * The facts a section page judgement needs. All three shapes are read on
 * every section page and the judgement picks the one it is about, so this
 * stays a single function the page can run.
 *
 * Runs inside the page, so it may use no import from this file.
 */
function readSectionFacts() {
  return {
    headings: [...document.querySelectorAll('h1, h2')].map((node) => node.textContent.trim()),
    chartNavLinks: document.querySelectorAll('.graph-nav .graph-nav-link').length,
    docsNavLinks: document.querySelectorAll('.docs-nav a').length,
    docsSections: document.querySelectorAll('.docs-section').length,
  };
}

/**
 * One navigation, one screenshot, one set of facts.
 *
 * Each route gets its own page so console errors and failed answers are
 * blamed on the page they happened on, not carried over from the previous
 * route. A failed answer here means a same-origin server error or a missing
 * API answer; a 404 on a document is the router's business and the app shell
 * answers 200 for unknown routes anyway.
 */
async function visitAndCollect(context, path, screenshotName, reader) {
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(ORIGIN).origin) {
      return;
    }
    if (response.status() >= 500 || (response.status() === 404 && url.pathname.startsWith('/api/'))) {
      failedRequests.push(`${response.url()} HTTP ${response.status()}`);
    }
  });
  try {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
    const facts = await page.evaluate(reader);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, screenshotName), fullPage: true });
    return { ...facts, consoleErrors, failedRequests, finalPath: new URL(page.url()).pathname };
  } finally {
    await page.close();
  }
}

/**
 * The rebuilt dashboard and the section routes under it, one context per
 * chain. This is additive to checkChain: that one holds the page to the
 * capability document, this one holds the page to being the dashboard at
 * all, and holds mining, graphs and docs to having rendered rather than
 * having redirected somewhere that did.
 */
async function checkChainSections(browser, chain) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    record(
      auditDashboardParity(
        chain,
        await visitAndCollect(context, `/${chain}`, `${chain}-dashboard.png`, readDashboardFacts),
      ),
    );
    const sections = [
      ['mining', `/${chain}/mining`, `${chain}-mining.png`],
      ['graphs', `/${chain}/graphs/mempool`, `${chain}-graphs-mempool.png`],
      ['docs', `/${chain}/docs`, `${chain}-docs.png`],
    ];
    for (const [section, path, screenshotName] of sections) {
      record(
        auditSectionPage(
          chain,
          section,
          await visitAndCollect(context, path, screenshotName, readSectionFacts),
        ),
      );
    }
  } finally {
    await context.close();
  }
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
      await checkChainSections(browser, chain);
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
