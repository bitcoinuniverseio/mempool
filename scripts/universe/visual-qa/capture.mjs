#!/usr/bin/env node
/**
 * Universe Explorer visual, accessibility, and cross-browser matrix.
 *
 * Drives the running application across routes, themes, viewports, and data
 * states, and records what it finds. Every API call is answered from fixtures,
 * so a difference between two runs means the interface changed, not that the
 * chain moved or that a backend went down mid-review.
 *
 * What each run asserts, per route and state:
 *   - no horizontal overflow at the viewport width
 *   - no console errors
 *   - no images that failed to load
 *   - no accessibility violations at WCAG 2.2 A/AA
 *   - no loader or skeleton still on screen once the page has settled
 *   - no chart panel that drew nothing while its fixture has data
 *   - an explicit status panel in every failure state, rather than a wait
 * and writes a screenshot for the visual comparison.
 *
 * The last three exist because a Charts page that never resolved and a Mining
 * dashboard full of skeletons passed every other check in this list and
 * shipped.
 *
 * Usage:
 *   node capture.mjs                      full matrix, chromium
 *   node capture.mjs --browser=firefox    another engine
 *   node capture.mjs --routes=home,tx     a subset while iterating
 *   node capture.mjs --states=populated   skip the failure states
 *   node capture.mjs --out=<dir>          where to write
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import * as playwright from 'playwright';
import { addressFixtures, detailFixtures, fixtures, sampleIds, stateOverrides } from './fixtures.mjs';
import { chainFixtures, chainSampleIds, chainStateOverrides, chainStateScope } from './chain-fixtures.mjs';
import { assetFixtures, assetSampleIds, savedStorageSeed } from './asset-fixtures.mjs';
import { contrastProbe } from './contrast-probe.mjs';
import { progressProbe } from './progress-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const BASE = args.base || 'http://localhost:4200';
const OUT = resolve(args.out || join(HERE, 'artifacts'));
const BROWSER = args.browser || 'chromium';

/** Routes under review. `wide` marks pages that legitimately scroll a table. */
const ROUTES = [
  { id: 'home', path: '/', name: 'Homepage' },
  { id: 'blocks', path: '/blocks', name: 'Blocks list' },
  { id: 'block', path: `/block/${sampleIds.BLOCK_HASH}`, name: 'Block detail' },
  { id: 'mempool-block', path: '/mempool-block/0', name: 'Projected block' },
  { id: 'tx', path: `/tx/${sampleIds.TXID_A}`, name: 'Transaction detail' },
  { id: 'address', path: `/address/${sampleIds.ADDRESS}`, name: 'Address' },
  { id: 'protocols', path: '/protocols', name: 'Protocol directory' },
  { id: 'pulse', path: '/pulse', name: 'Universe Pulse' },
  { id: 'rbf', path: '/rbf', name: 'Replacements' },
  { id: 'graphs', path: '/graphs/mempool', name: 'Graphs' },
  { id: 'mining', path: '/mining', name: 'Mining dashboard' },
  { id: 'docs', path: '/docs/api', name: 'API docs' },
  { id: 'source', path: '/source', name: 'Source and licenses' },

  // The chain-domain routes. They shipped with no coverage here at all, which
  // is how eleven routes reached production without one screenshot, contrast
  // probe or unfinished-page check ever looking at them.
  { id: 'dogecoin', path: '/dogecoin', name: 'Dogecoin overview' },
  { id: 'dogecoin-mempool', path: '/dogecoin/mempool', name: 'Dogecoin pending' },
  { id: 'dogecoin-tx', path: `/dogecoin/tx/${chainSampleIds.DOGE_TXID}`, name: 'Dogecoin transaction' },
  { id: 'dogecoin-block', path: `/dogecoin/block/${chainSampleIds.DOGE_BLOCK}`, name: 'Dogecoin block' },
  { id: 'dogecoin-address', path: `/dogecoin/address/${chainSampleIds.DOGE_ADDRESS}`, name: 'Dogecoin address' },
  { id: 'dogecoin-protocols', path: '/dogecoin/protocols', name: 'Dogecoin protocols' },
  { id: 'dogecoin-drc20', path: '/dogecoin/protocols/drc20', name: 'DRC-20 assets' },
  { id: 'zcash', path: '/zcash', name: 'Zcash overview' },
  { id: 'zcash-mempool', path: '/zcash/mempool', name: 'Zcash pending' },
  { id: 'zcash-tx', path: `/zcash/tx/${chainSampleIds.ZEC_TXID}`, name: 'Zcash transaction' },
  { id: 'zcash-protocols', path: '/zcash/protocols', name: 'Zcash protocols' },

  // Universe-authored routes that had no coverage either. The saved page is
  // seeded through localStorage below, because its state was never a request.
  { id: 'outpoint', path: `/outpoint/${assetSampleIds.OUTPOINT_TXID}/1`, name: 'Output' },
  { id: 'inscription', path: `/inscription/${assetSampleIds.INSCRIPTION_ID}`, name: 'Inscription' },
  { id: 'rune', path: `/rune/${assetSampleIds.RUNE_NAME}`, name: 'Rune' },
  { id: 'sat', path: `/sat/${assetSampleIds.SAT_NUMBER}`, name: 'Sat' },
  { id: 'saved', path: '/saved', name: 'Saved in this browser' },
];

const VIEWPORTS = [
  { id: '320', width: 320, height: 900 },
  { id: '375', width: 375, height: 900 },
  { id: '768', width: 768, height: 1024 },
  { id: '1024', width: 1024, height: 900 },
  { id: '1280', width: 1280, height: 900 },
  { id: '1440', width: 1440, height: 900 },
  { id: '1920', width: 1920, height: 1080 },
];

const THEMES = ['default', 'dark', 'contrast'];

/**
 * How long a page may take to stop showing loaders before the run calls it
 * unfinished. Generous, because a loaded CI machine is slower than a laptop
 * and the thing being measured is whether the page ever finishes, not how
 * fast the machine is.
 */
const SETTLE_DEADLINE_MS = 15_000;

/**
 * A failure fixture has nothing to fetch, so it should reach its terminal
 * state almost at once. Waiting the full budget on every one of those turned
 * a matrix that used to take minutes into one that could not finish.
 */
const FAILURE_SETTLE_DEADLINE_MS = 4_000;

const ALL_OVERRIDES = { ...stateOverrides, ...chainStateOverrides };

const STATES = ['populated', ...Object.keys(ALL_OVERRIDES)];

/** True when a state is worth measuring on a route. Unscoped states run everywhere. */
function stateApplies(state, routeId) {
  const scope = chainStateScope[state];
  return !scope || scope.some((prefix) => routeId === prefix || routeId.startsWith(`${prefix}-`));
}

function pick(list, key, idKey = 'id') {
  if (!args[key]) return list;
  const wanted = String(args[key]).split(',');
  return list.filter((entry) => wanted.includes(typeof entry === 'string' ? entry : entry[idKey]));
}

/** Answer every API call from fixtures, applying the state's overrides. */
async function installFixtures(context, state) {
  const overrides = ALL_OVERRIDES[state] || {};
  const table = { ...fixtures, ...detailFixtures, ...addressFixtures, ...chainFixtures, ...assetFixtures };

  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (overrides['**']?.hang) return; // never fulfil: hold the loading state

    const override =
      overrides[path] ??
      Object.entries(overrides).find(([k]) => k !== '**' && path.startsWith(k))?.[1];

    if (override) {
      if (override.hang) return;
      if (override.status) {
        return route.fulfill({ status: override.status, contentType: 'text/plain', body: 'fixture error' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(override.body) });
    }

    const exact = table[path];
    if (exact !== undefined) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(exact) });
    }

    const prefix = Object.keys(table).find((k) => path.startsWith(k));
    if (prefix) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(table[prefix]) });
    }

    // Anything not pinned returns an empty list rather than reaching the
    // network, so a run is never at the mercy of a live backend.
    if (process.env.LOG_UNMATCHED) console.log('unmatched: ' + path);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Most live surfaces on this product are fed by the socket, not by REST, so
  // a screenshot with the socket cut is a screenshot of skeletons. Answer it
  // from the same fixtures instead: the client sends {action:'want'}, and one
  // push carries the whole initial state.
  const down = state === 'chain-down' || overrides['**']?.hang;
  await context.routeWebSocket('**/api/v1/ws', (ws) => {
    if (down) return; // connected but silent: the reconnecting and loading states
    const push = () => ws.send(JSON.stringify(socketState(state)));
    ws.onMessage((raw) => {
      push();
      // The Lens only draws once it is handed the contents of the block it is
      // tracking. Without this the product's signature view is a grey square in
      // every screenshot, which is the one thing a design review cannot skip.
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const index = message?.['track-mempool-block'];
      if (typeof index === 'number' && index >= 0) {
        ws.send(JSON.stringify({
          'projected-block-transactions': {
            index,
            sequence: 1,
            blockTransactions: projectedBlockTransactions(),
          },
        }));
      }
    });
    push();
  });

  // The chain pages open their own socket, and nothing answered it: every
  // chain screenshot carried a failed-handshake console error, which is noise
  // that would hide a real one, and the live path itself went unexercised.
  //
  // The client subscribes to three channels at once and expects one envelope
  // per channel. Sequence numbers stay fixed so a rerun produces the same
  // screenshot; the client only uses them to resume after a drop.
  await context.routeWebSocket('**/api/v1/universe/ws', (ws) => {
    if (down) return; // connected but silent, which is the reconnecting state
    ws.onMessage((raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message?.type !== 'subscribe' || !Array.isArray(message.subscriptions)) {
        return;
      }
      for (const subscription of message.subscriptions) {
        const chain = subscription?.chain;
        const channel = subscription?.channel;
        if (!chain || !channel) continue;
        ws.send(JSON.stringify({
          schemaVersion: 'universe-websocket-v1',
          chain,
          network: 'mainnet',
          channel,
          snapshotId: 'snap-4812',
          sequenceAtomic: '148201',
          observedAt: '2026-08-29T05:03:00.000Z',
          tip: chainFixtures[`/api/v1/${chain}/status`]?.tip ?? null,
          reorg: null,
          completeness: 'complete',
          data: {},
        }));
      }
    });
  });
}

/**
 * A projected block's contents, in the compressed tuple form the socket uses:
 * [txid, fee, vsize, value, rate, flags, time, acc].
 *
 * Sized and spread so the Lens has something honest to draw: a long tail of
 * small transactions, a few large ones, and a spread of fee rates.
 */
function projectedBlockTransactions() {
  const txs = [];
  for (let i = 0; i < 1400; i++) {
    const big = i % 97 === 0;
    const vsize = big ? 2200 + (i % 11) * 400 : 140 + (i % 17) * 24;
    const rate = 2 + ((i * 7) % 46) + (big ? 12 : 0);
    txs.push([
      (i.toString(16).padStart(8, '0')).repeat(8).slice(0, 64),
      Math.round(rate * vsize),
      vsize,
      50_000 + (i % 53) * 90_000,
      rate,
      i % 13 === 0 ? 2 : 0,
      1_772_100_000 - (i % 900),
      0,
    ]);
  }
  return txs;
}

/** One socket push carrying the initial live state, from the same fixtures. */
function socketState(state) {
  // A node that is still verifying the chain. The explorer qualifies every
  // number on the page against this, so it has to be exercised: without it the
  // synchronisation notice never renders and never gets reviewed.
  const chainSync =
    state === 'catching-up'
      ? { blocks: 819_435, headers: 887_412, initialBlockDownload: true, verificationProgress: 0.663316, checkedAt: '2026-08-27T00:00:00.000Z' }
      : { blocks: 887_412, headers: 887_412, initialBlockDownload: false, verificationProgress: 1, checkedAt: '2026-08-27T00:00:00.000Z' };
  return {
    mempoolInfo: { loaded: true, size: 31_204, bytes: 118_442_881, usage: 118_442_881, maxmempool: 300_000_000, mempoolminfee: 0.00001, minrelaytxfee: 0.00001, fullrbf: true },
    vBytesPerSecond: 1_884,
    fees: fixtures['/api/v1/fees/recommended'],
    da: fixtures['/api/v1/difficulty-adjustment'],
    blocks: fixtures['/api/v1/blocks'],
    'mempool-blocks': fixtures['/api/v1/fees/mempool-blocks'],
    transactions: fixtures['/api/mempool/recent'],
    rbfLatestSummary: fixtures['rbf-latest-summary'],
    conversions: { USD: 96_400, EUR: 89_100, time: 1_772_100_000 },
    loadingIndicators: {
      mempool: 100,
      blocks: 100,
      // How far along the address's transaction history is. The address page
      // only draws its progress bar when the socket reports progress for that
      // address, so without this the one state that reaches the
      // transaction-list wait would render its skeletons and no bar at all,
      // and the bar would go on being unreviewed for the same reason the
      // branch itself was.
      ...(state === 'address-txs-loading' ? { [`address-${sampleIds.ADDRESS}`]: 62 } : {}),
    },
    backendInfo: { hostname: 'universe-explorer', version: '3.3.1', gitCommit: 'fixture0', lightning: false, chainSync },
  };
}

async function run() {
  const routes = pick(ROUTES, 'routes');
  const viewports = pick(VIEWPORTS, 'viewports');
  const themes = pick(THEMES.map((id) => ({ id })), 'themes').map((t) => t.id);
  const states = pick(STATES.map((id) => ({ id })), 'states').map((s) => s.id);

  // Confirm the base URL is actually serving this application before measuring
  // anything. A run against a blank page, a stale build, or something else that
  // happens to be on the port reports zero failures everywhere, which is
  // indistinguishable from success and considerably more dangerous. This has
  // happened: a port collision put a different product on the address and the
  // matrix cheerfully passed 39 blank screenshots.
  {
    const probe = await fetch(BASE, { redirect: 'follow' }).catch((e) => {
      throw new Error(`cannot reach ${BASE}: ${e.message}`);
    });
    if (!probe.ok) throw new Error(`${BASE} answered ${probe.status}`);
    const html = await probe.text();
    if (!/<title>[^<]*Universe Explorer/i.test(html)) {
      const title = (html.match(/<title>([^<]*)/i) || [, '(none)'])[1].trim();
      throw new Error(
        `${BASE} is not serving Universe Explorer (title: "${title}").` +
          ' Check the port, and that the build under test is the one being served.',
      );
    }
    if (!/(runtime|main)\.[a-f0-9]{8,}\.js/.test(html)) {
      throw new Error(`${BASE} served no hashed application bundle; the build output looks incomplete.`);
    }
  }

  mkdirSync(OUT, { recursive: true });
  // The Lens is drawn with WebGL. Headless Chromium has no GPU, so without a
  // software rasteriser the product's signature view is a grey rectangle in
  // every screenshot and the one thing worth reviewing goes unreviewed.
  const browser = await playwright[BROWSER].launch({
    args: BROWSER === 'chromium'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [],
  });
  const findings = [];
  let shots = 0;

  for (const state of states) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: args.reducedMotion ? 'reduce' : 'no-preference',
        });
        await installFixtures(context, state);
        await context.addInitScript(([t, saved]) => {
          try {
            localStorage.setItem('theme-preference', t);
            // The saved page has an empty face and a populated one, and only
            // the empty one appears without this. Its state lives in the
            // browser, so the fixture goes in the browser.
            for (const [key, value] of Object.entries(saved)) {
              localStorage.setItem(key, JSON.stringify(value));
            }
          } catch { /* private mode: the default theme is fine */ }

          // A WebGL drawing buffer is cleared once the frame is presented, so
          // reading the Lens back afterwards returns nothing at all. Asking for
          // it to be preserved is what makes the product's signature view
          // measurable rather than a rectangle nobody checks. This only ever
          // runs in the harness; the application asks for the default.
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, attributes) {
            if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
              return getContext.call(this, type, { ...(attributes || {}), preserveDrawingBuffer: true });
            }
            return getContext.call(this, type, attributes);
          };
        }, [theme, savedStorageSeed]);

        for (const route of routes) {
          if (!stateApplies(state, route.id)) continue;
          const page = await context.newPage();
          const consoleErrors = [];
          page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
          page.on('pageerror', (e) => consoleErrors.push(String(e)));

          const label = `${route.id}__${state}__${theme}__${viewport.id}`;
          try {
            await page.goto(BASE + route.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await page.waitForTimeout(state === 'loading' ? 1_200 : 2_600);

            const overflow = await page.evaluate(() => {
              const d = document.documentElement;
              return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
            });
            const overflowBy = overflow.scrollWidth - overflow.clientWidth;

            const brokenImages = await page.evaluate(() =>
              Array.from(document.images)
                .filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc)
                .map((i) => i.currentSrc),
            );

            let violations = [];
            if (!args.skipAxe) {
              try {
                const axe = await new AxeBuilder({ page })
                  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                  .analyze();
                violations = axe.violations.map((v) => ({
                  id: v.id,
                  impact: v.impact,
                  count: v.nodes.length,
                  help: v.help,
                  sample: v.nodes[0]?.target?.join(' ') ?? '',
                  // Every failing node, not just the first. A rule that reports
                  // "25 places" cannot be acted on without knowing which 25.
                  nodes: v.nodes.slice(0, 40).map((n) => ({
                    target: (n.target ?? []).join(' '),
                    detail: (n.any?.[0]?.message ?? n.failureSummary ?? '').slice(0, 200),
                  })),
                }));
              } catch (e) {
                violations = [{ id: 'axe-failed', impact: 'unknown', count: 0, help: String(e).slice(0, 200), sample: '' }];
              }
            }

            // Measured contrast against whatever is actually painted. This is
            // the check an accessibility engine cannot make: text on a fee
            // gradient, on a block face, or over the Lens canvas.
            let contrast;
            try {
              contrast = await page.evaluate(contrastProbe);
            } catch (e) {
              contrast = { text: [], painted: [], canvas: [], sampled: 0, error: String(e).slice(0, 200) };
            }

            // Trigger anything the page defers until it is scrolled to.
            //
            // Angular's `@defer (on viewport)` loads a section when it
            // intersects the viewport, and the block page defers its
            // transaction list that way. A harness that never scrolls sees the
            // placeholder forever and reports a page that never finished, which
            // is the opposite of the truth: the page is deferring correctly.
            // The probe's own viewport margin is more generous than the zero
            // margin an IntersectionObserver uses, so at some widths it counted
            // a placeholder Angular had rightly not replaced yet.
            //
            // Scrolling to the bottom and back resolves both. Deferred content
            // loads, the view returns to the top so the screenshot is unchanged,
            // and a skeleton still showing afterwards is genuinely stuck.
            try {
              await page.evaluate(async () => {
                const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
                for (let y = 0; y < document.body.scrollHeight; y += step) {
                  window.scrollTo(0, y);
                  await new Promise((done) => setTimeout(done, 90));
                }
                window.scrollTo(0, 0);
                await new Promise((done) => setTimeout(done, 250));
              });
            } catch { /* a page that navigated mid-scroll is judged as it lands */ }

            // A fixed pause is a race, not a deadline: on a loaded machine a
            // page that finishes perfectly well can still be mid-render when
            // the probe fires. Wait for it to settle, up to a real deadline,
            // and record how long it took. What fails the run is a page that
            // never settles, which is the actual requirement.
            let progress;
            let settledAfterMs = null;
            try {
              const budget = state === 'populated' ? SETTLE_DEADLINE_MS : FAILURE_SETTLE_DEADLINE_MS;
              const deadline = Date.now() + budget;
              for (;;) {
                progress = await page.evaluate(progressProbe);
                const busy = (progress.spinners?.length ?? 0) > 0 || (progress.skeletons ?? 0) > 0;
                if (!busy || Date.now() >= deadline) {
                  settledAfterMs = busy ? null : Date.now() - (deadline - budget);
                  break;
                }
                await page.waitForTimeout(250);
              }
            } catch (e) {
              progress = { spinners: [], skeletons: 0, charts: [], statusPanels: [], loadingAnnouncements: [], textLength: 0, error: String(e).slice(0, 200) };
            }

            await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: Boolean(args.fullPage) });
            shots++;

            findings.push({
              route: route.id, routeName: route.name, state, theme, viewport: viewport.id,
              overflowBy, consoleErrors, brokenImages, violations, contrast, progress, settledAfterMs,
            });
          } catch (error) {
            // A server that has gone away is not a page that failed. Reporting
            // it as one buries the actual event under a hundred identical
            // lines and sends the reader looking at the application.
            if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(error))) {
              await page.close().catch(() => undefined);
              await context.close().catch(() => undefined);
              await browser.close().catch(() => undefined);
              console.error(
                `\nThe server at ${BASE} stopped answering partway through the run ` +
                  `(at ${route.id}/${state}/${theme}@${viewport.id}). ` +
                  `Nothing was measured after that point, so this run proves nothing.`,
              );
              process.exit(2);
            }
            findings.push({
              route: route.id, routeName: route.name, state, theme, viewport: viewport.id,
              error: String(error).slice(0, 400),
            });
          } finally {
            await page.close();
          }
        }
        await context.close();
      }
    }
  }

  await browser.close();

  const report = { browser: BROWSER, base: BASE, screenshots: shots, findings };
  writeFileSync(join(OUT, `report-${BROWSER}.json`), JSON.stringify(report, null, 2));
  const stuck = summarise(report);
  if (stuck.length > 0) {
    console.error(`${stuck.length} page(s) never finished loading. This is the failure that shipped last time, so it fails the run.`);
    process.exitCode = 1;
  }
}

/**
 * Turns the progress probe into failures.
 *
 * A populated fixture leaves no excuse: the data is there, so a loader still
 * on screen or a chart that drew nothing is the interface failing to finish.
 * A failure fixture has the opposite obligation: the page must say what
 * happened rather than wait.
 */

/**
 * Routes whose request lifecycle has been reviewed and is expected to reach a
 * terminal state. A finding on one of these fails the run.
 *
 * The gate reports findings on every route, but only blocks on these. Adding a
 * route here is how a finding on an uncovered route gets finished: fix the
 * page, add the route, and the gate holds it forever after. Home, blocks,
 * transaction and address joined once their waiting and failure states said
 * something instead of holding a bare placeholder.
 */
export const GATED_ROUTES = new Set([
  'graphs', 'mining', 'protocols', 'home', 'blocks', 'tx', 'address',
  // The chain routes join once their status rail, their failure copy and their
  // empty state all say something. Every one of them reaches a terminal state:
  // the rail renders all five readings even with no status at all, and a
  // failed lookup prints why rather than waiting.
  'dogecoin', 'dogecoin-mempool', 'dogecoin-tx', 'dogecoin-block',
  'dogecoin-address', 'dogecoin-protocols', 'dogecoin-drc20',
  'zcash', 'zcash-mempool', 'zcash-tx', 'zcash-protocols',
  // The single-asset pages and the local-state page, for the same reason.
  'outpoint', 'inscription', 'rune', 'sat', 'saved',
]);

/**
 * Fixtures that hold a request open on purpose, to photograph a wait.
 *
 * These are judged on whether the wait is announced, not on having finished,
 * and they are not failure states: nothing has gone wrong, so demanding a
 * status panel would be demanding the page report a fault it does not have.
 * `loading` holds every request; `address-txs-loading` holds only the address
 * transaction list, which is the wait pagination leaves behind and the one the
 * blanket fixture can never reach.
 */
const WAITING_STATES = new Set(['loading', 'address-txs-loading']);

export function progressFailures(report) {
  const failures = [];
  for (const f of report.findings) {
    const progress = f.progress;
    if (!progress) continue;
    const where = `${f.route}/${f.state}/${f.theme}@${f.viewport}`;

    if (f.state === 'populated') {
      if (progress.spinners?.length) {
        failures.push(`${where}: never stopped loading (${progress.spinners.join(', ')})`);
      }
      if (progress.skeletons > 0) {
        failures.push(`${where}: ${progress.skeletons} skeleton(s) never resolved`);
      }
      if (progress.skeletonOnly) {
        failures.push(`${where}: the page is placeholders and almost no text`);
      }
      for (const chart of progress.charts ?? []) {
        if (chart.drewNothing) {
          failures.push(`${where}: chart ${chart.selector} (${chart.width}x${chart.height}) drew nothing`);
        }
      }
    } else if (WAITING_STATES.has(f.state)) {
      // These fixtures hold requests open on purpose, to photograph the
      // waiting state. Asking them to have finished would be asking the wrong
      // question; what matters is that the wait is announced rather than being
      // a blank rectangle. The deadline itself is covered by the unit tests
      // around the request lifecycle, which run far longer than this harness
      // waits.
      // Only a page that is actually holding placeholders is waiting. A page
      // with nothing to fetch renders normally under this fixture and owes the
      // reader no loader at all.
      const waiting = (progress.skeletons ?? 0) > 0;
      const announced = progress.spinners?.length
        || progress.statusPanels?.length
        || progress.loadingAnnouncements?.length;
      if (waiting && !announced) {
        failures.push(`${where}: waiting with nothing on screen that says so`);
      }
    } else {
      // Every failure fixture must reach a state that says something. A page
      // that is still spinning has not answered the user at all.
      if (progress.spinners?.length || progress.skeletons > 0) {
        if (!progress.statusPanels?.length) {
          failures.push(`${where}: still waiting with nothing said about why`);
        }
      }
    }
  }
  return failures;
}

function summarise(report) {
  const overflow = report.findings.filter((f) => f.overflowBy > 0);
  const errors = report.findings.filter((f) => f.consoleErrors?.length);
  const images = report.findings.filter((f) => f.brokenImages?.length);
  const failed = report.findings.filter((f) => f.error);
  const a11y = report.findings.filter((f) => f.violations?.length);

  const contrastFailures = [];
  const blankCanvases = [];
  for (const f of report.findings) {
    for (const row of f.contrast?.text ?? []) {
      contrastFailures.push({ ...row, route: f.route, state: f.state, theme: f.theme, viewport: f.viewport });
    }
    for (const c of f.contrast?.canvas ?? []) {
      if (c.blank) blankCanvases.push({ ...c, route: f.route, state: f.state, theme: f.theme, viewport: f.viewport });
    }
  }
  contrastFailures.sort((a, b) => a.ratio - b.ratio);

  const byRule = new Map();
  for (const f of a11y) {
    for (const v of f.violations) {
      const e = byRule.get(v.id) || { id: v.id, impact: v.impact, help: v.help, places: 0, routes: new Set() };
      e.places += v.count;
      e.routes.add(f.route);
      byRule.set(v.id, e);
    }
  }

  console.log(`\n=== ${report.browser} : ${report.screenshots} screenshots -> ${OUT}\n`);
  console.log(`horizontal overflow : ${overflow.length}`);
  console.log(`console errors      : ${errors.length}`);
  console.log(`broken images       : ${images.length}`);
  console.log(`navigation failures : ${failed.length}`);
  console.log(`a11y rules violated : ${byRule.size}\n`);

  console.log(`contrast failures   : ${contrastFailures.length}`);
  console.log(`blank canvases      : ${blankCanvases.length}`);

  if (contrastFailures.length) {
    console.log();
    console.log('-- measured contrast failures, worst first --');
    for (const f of contrastFailures.slice(0, 40)) {
      console.log(
        `  ${String(f.ratio).padStart(6)}:1 (needs ${f.required}:1)  ` +
          `${f.route}/${f.state}/${f.theme}@${f.viewport}` +
          `${f.overPaintedSurface ? '  [over a painted surface]' : ''}`,
      );
      console.log(`         "${f.text}"`);
      console.log(`         ${f.foreground} on ${f.background}   ${f.selector}`);
    }
    if (contrastFailures.length > 40) {
      console.log(`  ... and ${contrastFailures.length - 40} more, see the report`);
    }
  }

  if (blankCanvases.length) {
    console.log();
    console.log('-- canvases that drew nothing --');
    for (const c of blankCanvases.slice(0, 10)) {
      console.log(`  ${c.route}/${c.state}/${c.theme}@${c.viewport}  ${c.selector}  ${c.w}x${c.h}`);
    }
  }
  if (overflow.length) {
    console.log('-- overflow --');
    for (const f of overflow.slice(0, 20)) {
      console.log(`  ${f.route} ${f.state} ${f.theme} @${f.viewport}px overflows by ${f.overflowBy}px`);
    }
  }
  if (byRule.size) {
    console.log('\n-- accessibility --');
    for (const r of [...byRule.values()].sort((a, b) => b.places - a.places)) {
      console.log(`  ${String(r.impact).padEnd(8)} ${r.id.padEnd(34)} ${String(r.places).padStart(4)} places  [${[...r.routes].join(', ')}]`);
      console.log(`           ${r.help}`);
    }
  }
  if (errors.length) {
    console.log('\n-- console --');
    const seen = new Set();
    for (const f of errors) {
      for (const e of f.consoleErrors) {
        const key = e.slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  [${f.route}] ${key}`);
      }
    }
  }
  if (failed.length) {
    console.log('\n-- navigation --');
    for (const f of failed.slice(0, 15)) console.log(`  ${f.route} ${f.state} ${f.theme} @${f.viewport}: ${f.error}`);
  }

  const stuck = progressFailures(report);
  const blocking = stuck.filter((line) => GATED_ROUTES.has(line.split('/')[0]));
  const known = stuck.filter((line) => !GATED_ROUTES.has(line.split('/')[0]));

  console.log(`\nunfinished pages    : ${stuck.length}  (blocking ${blocking.length})`);
  if (blocking.length) {
    console.log('-- pages that never finished, on routes this gate holds --');
    for (const line of blocking.slice(0, 40)) console.log(`  ${line}`);
    if (blocking.length > 40) console.log(`  ... and ${blocking.length - 40} more, see the report`);
  }
  if (known.length) {
    // Printed every run, never suppressed. These are real, they were found by
    // this gate, and they are waiting for the same treatment the gated routes
    // have had.
    console.log('-- the same fault on routes not yet covered, known work --');
    for (const line of known.slice(0, 40)) console.log(`  ${line}`);
    if (known.length > 40) console.log(`  ... and ${known.length - 40} more, see the report`);
  }
  console.log('');
  return blocking;
}

// Only drive browsers when this file is the program. Importing it, as the
// gate's own test does, must not launch the matrix.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
