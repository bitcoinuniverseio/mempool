#!/usr/bin/env node
/**
 * What a reader actually sees on an address page, in a browser, against the
 * public origin, with nothing mocked.
 *
 * This is the gate whose absence let the defect reach the public. Every other
 * check in this repository either reads the API without a browser or renders
 * the frontend against fixtures, and neither can see what production served:
 * an address page reading "Error loading address data. (405 OK: Address
 * lookups cannot be used with bitcoind as backend.) There are too many
 * transactions on this address."
 *
 * The judgements live in `address-page-audit.mjs`, which is tested without a
 * browser. This file collects what the browser saw and hands it over.
 *
 * Usage:
 *   node address-page-smoke.mjs [--origin=URL] [--out=DIR] [--browser=chromium]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import playwright from 'playwright';

import { auditAddressPage, auditMalformedAddressPage } from './address-page-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const ORIGIN = String(args.origin || args.base || 'https://explorer.bitcoinuniverse.io').replace(/\/$/, '');
const BROWSER = String(args.browser || 'chromium');
const OUT = resolve(args.out || join(HERE, 'artifacts-address-smoke'));
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The addresses opened in a browser.
 *
 * One of each script type, all of them outputs of block 900,000 except the
 * first, so their confirmed history is settled and needs no maintenance. The
 * genesis coinbase is here because an address with an enormous history is the
 * case that used to be indistinguishable from a broken backend.
 */
const ADDRESSES = [
  '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3',
  '1PuJjnF476W3zXfVYmJfGnouzFDAXakkL4',
  '33mapDgyY1XMs6wEts36p1ucR5e6irwRLv',
  'bc1qntndgqfx46wks63jep34cjk3pw63es86kp45c6',
  'bc1pgtdpjs0l3l54l6072f9mh962g4nu5r500rfzsv39twxlalejjrjsq6u69p',
  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
];

/** The exact string from the production screenshot. Its checksum does not verify. */
const MALFORMED = 'bc1qcx70rmarfudyct7lx0ptrat2c5kgstghx2j69';

const failures = [];
const notes = [];

function record(result) {
  for (const failure of result.failures) failures.push(`${failure.check}: ${failure.detail}`);
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
 * Opens one address page and reports what a reader could see on it.
 *
 * The transactions table is looked for by its own rows rather than by counting
 * words, because the failure worth catching is a page that renders its frame
 * and nothing inside it.
 */
async function openAddress(context, address) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    await page.goto(`${ORIGIN}/address/${address}`, {
      waitUntil: 'networkidle',
      timeout: REQUEST_TIMEOUT_MS,
    });
    // The address panel resolves asynchronously. Wait for either the data or
    // the error state rather than for a fixed time, so a slow index is not
    // reported as an empty page.
    await page
      .waitForFunction(
        () => !document.querySelector('.skeleton-loader'),
        undefined,
        { timeout: REQUEST_TIMEOUT_MS },
      )
      .catch(() => undefined);

    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
    // The transaction list marks each row with data-cy="tx-<index>". That
    // attribute is the row itself, present on every page the list appears on,
    // which the per-row transaction link is not: it is hidden when the list is
    // rendered inside a transaction page. Counting the rows measures the table
    // having content; counting the links would measure which page it is on.
    const transactionsRendered = await page.evaluate(
      () => document.querySelectorAll('app-transactions-list [data-cy^="tx-"]').length > 0,
    );
    return { text, consoleErrors, transactionsRendered, page };
  } catch (error) {
    return { text: '', consoleErrors: [...consoleErrors, String(error)], transactionsRendered: false, page };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`Address page smoke against ${ORIGIN} in ${BROWSER}`);

  const capabilities = await readJson('/api/v1/capabilities');
  const feature = capabilities.body?.features?.addressLookup;
  if (!feature) {
    failures.push('address-page: this origin publishes no address capability, so nothing states whether it can serve one');
  }
  const indexState = feature?.state ?? 'unavailable';

  const browser = await playwright[BROWSER].launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  try {
    for (const address of ADDRESSES) {
      const summary = await readJson(`/api/address/${address}`);
      const seen = await openAddress(context, address);
      const result = auditAddressPage({
        address,
        text: seen.text,
        consoleErrors: seen.consoleErrors,
        transactionsRendered: seen.transactionsRendered,
        indexState,
        summary: summary.status === 200 ? summary.body : null,
      });
      record(result);
      if (result.failures.length) {
        await seen.page.screenshot({ path: join(OUT, `${address}.png`), fullPage: true });
        writeFileSync(join(OUT, `${address}.txt`), seen.text, 'utf8');
      }
      await seen.page.close();
    }

    const malformed = await openAddress(context, MALFORMED);
    const malformedResult = auditMalformedAddressPage({ text: malformed.text });
    record(malformedResult);
    if (malformedResult.failures.length) {
      await malformed.page.screenshot({ path: join(OUT, 'malformed.png'), fullPage: true });
      writeFileSync(join(OUT, 'malformed.txt'), malformed.text, 'utf8');
    }
    await malformed.page.close();
  } finally {
    await context.close();
    await browser.close();
  }

  for (const note of notes) console.log(`  ok    ${note}`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);

  if (failures.length) {
    console.error(`\n${failures.length} address page check(s) failed against ${ORIGIN}; artifacts in ${OUT}`);
    process.exit(1);
  }
  console.log(`\nEvery address page check passed against ${ORIGIN}`);
}

main().catch((error) => {
  console.error(`Address page smoke could not run: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
