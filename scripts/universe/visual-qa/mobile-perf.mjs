#!/usr/bin/env node
/**
 * What the shell costs on a phone.
 *
 * Not a benchmark. A benchmark on a shared runner measures the runner, and the
 * numbers move by more between two runs of the same commit than most changes
 * move them. What this measures is the part that is a property of the build
 * rather than of the machine, and it measures the machine-dependent part only
 * to say whether it is in the right order of magnitude.
 *
 * Three things, in decreasing order of how much they can be trusted:
 *
 *   bytes      what a phone has to download and parse before the shell exists.
 *              Deterministic: the same commit gives the same number on any
 *              machine, so this is the one worth gating on.
 *
 *   layout     cumulative layout shift, and every shift large enough to be
 *              worth naming, with the element that moved. Nearly deterministic
 *              once the page has settled, because it is a property of the
 *              stylesheet rather than of the clock.
 *
 *   paint      largest contentful paint under a throttled profile. Reported,
 *              and only failed on a wide margin, because it is the one that
 *              moves with the runner.
 *
 * The throttle is a low-end Android profile: four times slower than this
 * machine's CPU, and slow 4G. It is not any particular phone. It is a floor
 * that a phone somebody actually owns will be near.
 *
 * Usage:
 *   node mobile-perf.mjs --base=http://127.0.0.1:8080
 *   node mobile-perf.mjs --base=... --routes=home,tx --cpu=6
 */
import { chromium } from 'playwright';
import { gzipSync } from 'zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { ROUTES, installFixtures } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const BASE = args.base || 'http://localhost:4200';
const OUT = resolve(args.out || join(HERE, 'artifacts-perf'));
const DIST = resolve(args.dist || join(HERE, '..', '..', '..', 'frontend', 'dist', 'mempool', 'browser'));
const CPU_THROTTLE = Number(args.cpu || 4);

const PERF_ROUTE_IDS = args.routes ? String(args.routes).split(',') : ['home', 'tx', 'blocks', 'dogecoin-tx'];

/**
 * Budgets.
 *
 * The first two are the ones that fail a run. The eager payload is what the
 * browser must have before anything appears, and it is checked against a
 * ceiling rather than against the previous run, because a ratchet that only
 * ever compares to yesterday drifts upward one acceptable step at a time.
 *
 * CLS is the Core Web Vitals "good" threshold. The footer used to be the whole
 * budget on its own, which is what the viewport-height floor on the page column
 * exists to prevent, so this is the number that would catch that coming back.
 *
 * LCP is reported rather than gated at its own threshold: 2.5s is a field
 * number for a real device on a real network, and this is a throttled headless
 * browser on a shared runner. The gate here is a wide one, at four times the
 * field target, which catches a shell that has stopped painting rather than one
 * that is a few hundred milliseconds slower than last week.
 */
const BUDGETS = {
  // Compressed, because that is what crosses the network. The figure on disk
  // is four times larger and is not what anybody downloads.
  //
  // 480kB, from measuring both sides rather than picking a round number.
  //
  // develop at bea93c1ec is 463kB compressed, 1655kB raw. This branch is 464kB
  // compressed, 1659kB raw: one kilobyte, for the safe-area tokens, the
  // compact rules, the clear control and the viewport service. The ceiling sits
  // far enough above that ordinary drift does not trip it and a real regression
  // does, and when it needs raising, raise it deliberately and say what bought
  // the bytes.
  eagerBytesGzipped: 480_000,
  cls: 0.1,
};

/**
 * Routes that are over the layout budget for a reason that predates this gate.
 *
 * One entry, and it is here rather than quietly excluded because a budget
 * nobody can see is not a budget. The number is what develop measured at
 * bea93c1ec under the same throttle, so a route drifting further gets caught
 * even while it is over.
 *
 * The transaction route: at about three seconds, when the transaction's own
 * data arrives, `div.panel` grows from 46 to 193 pixels as the tracker bar and
 * the confirmations render into it. That pushes `div.bottom-panel` down by 148
 * and shrinks it by the same, which is the whole 0.103.
 *
 * Reserving that room means knowing how tall the panel will be before the
 * transaction is read, and it is not one height: a replaced transaction shows
 * an alert, a pending one a tracker bar, a confirmed one a confirmation count.
 * A single min-height would trade a measured shift for unmeasured dead space
 * on the states that are shorter. That is a piece of work on the tracker's
 * loading design rather than on the shell, so it is written down here with its
 * measurement instead of being fixed badly or hidden.
 */
const KNOWN_LAYOUT_DEBT = {
  tx: {
    cls: 0.103,
    note: 'div.panel grows 46 to 193px when the transaction arrives, pushing div.bottom-panel down 148px',
  },
};

/** How much worse than the recorded figure counts as a regression rather than
 *  noise. Two runs of the same commit moved this by 0.005. */
const DEBT_TOLERANCE = 0.02;

/**
 * The scripts and styles a browser must have before the shell can exist.
 *
 * Reported raw and gzipped. Raw is what the parser has to chew through, which
 * is the number that matters on a slow processor; gzipped is what the network
 * has to carry, which is the number that matters on a slow connection. The
 * budget is on the compressed figure because the gateway serves compressed and
 * because it is the one a visitor pays on every cold load.
 *
 * Gzip rather than brotli: it is in the standard library, it is within a few
 * percent of brotli for this content, and the point is a stable number to
 * compare against rather than a byte-exact prediction of the wire.
 */
function eagerPayload() {
  let total = 0;
  let gzipped = 0;
  const files = [];
  for (const name of readdirSync(DIST)) {
    if (!/^(runtime|polyfills|main|styles)\.[a-f0-9]+\.(js|css)$/.test(name)) continue;
    const size = statSync(join(DIST, name)).size;
    const gz = gzipSync(readFileSync(join(DIST, name)), { level: 9 }).length;
    files.push({ name, size, gz });
    total += size;
    gzipped += gz;
  }
  files.sort((a, b) => b.gz - a.gz);
  return { total, gzipped, files };
}

/**
 * Collected inside the page, before anything else runs.
 *
 * Registered as an init script rather than after load, because both of these
 * are buffered entry types: an observer registered after the fact with
 * `buffered: true` sees earlier entries, but only if it is registered before
 * the buffer is flushed, and the largest paint on a fast local server has
 * usually already happened.
 */
function observeVitals() {
  window.__vitals = { lcp: 0, cls: 0, shifts: [], longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vitals.lcp = Math.max(window.__vitals.lcp, entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* an engine without it reports zero, and the run says so */ }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Shifts the visitor caused by scrolling or typing are not the ones
        // this is about.
        if (entry.hadRecentInput) continue;
        window.__vitals.cls += entry.value;
        if (entry.value >= 0.01) {
          const sources = (entry.sources || []).map((s) => {
            const el = s.node;
            if (!el || !el.tagName) return '(anonymous)';
            const cls = typeof el.className === 'string' && el.className
              ? `.${el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 2).join('.')}`
              : '';
            return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
          });
          window.__vitals.shifts.push({ value: Math.round(entry.value * 1000) / 1000, sources: sources.slice(0, 3) });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* as above */ }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vitals.longTasks += 1;
        window.__vitals.longTaskMs += entry.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* as above */ }
}

async function run() {
  mkdirSync(OUT, { recursive: true });

  const probe = await fetch(BASE, { redirect: 'follow' }).catch((e) => {
    throw new Error(`cannot reach ${BASE}: ${e.message}`);
  });
  if (!probe.ok) throw new Error(`${BASE} answered ${probe.status}`);
  const html = await probe.text();
  if (!/<title>[^<]*Universe Explorer/i.test(html)) {
    throw new Error(`${BASE} is not serving Universe Explorer`);
  }
  const build = (html.match(/main\.([a-f0-9]{8,})\.js/) || [, 'unknown'])[1];

  const eager = eagerPayload();
  const routes = ROUTES.filter((r) => PERF_ROUTE_IDS.includes(r.id));
  if (routes.length !== PERF_ROUTE_IDS.length) {
    const missing = PERF_ROUTE_IDS.filter((id) => !routes.some((r) => r.id === id));
    throw new Error(`these route ids are not in the shared route list: ${missing.join(', ')}`);
  }

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const failures = [];
  const known = [];
  const rows = [];

  for (const route of routes) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });
    await installFixtures(context, 'populated');
    await context.addInitScript(observeVitals);
    const page = await context.newPage();

    // Slow 4G and a slow processor, through the devtools protocol, because
    // Playwright's own API has no throttle.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
      uploadThroughput: Math.round((750 * 1024) / 8),
      connectionType: 'cellular4g',
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    try {
      await page.goto(BASE + route.path, { waitUntil: 'load', timeout: 120_000 });
      // Long enough for the shell to finish arriving and for the late shifts
      // that matter, which are the ones a visitor sees rather than the ones
      // that happen before the first paint.
      await page.waitForTimeout(6_000);
      const vitals = await page.evaluate(() => window.__vitals);
      const nav = await page.evaluate(() => {
        const [entry] = performance.getEntriesByType('navigation');
        return entry
          ? { domContentLoaded: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd) }
          : { domContentLoaded: 0, load: 0 };
      });

      const row = {
        route: route.id,
        lcpMs: Math.round(vitals.lcp),
        cls: Math.round(vitals.cls * 1000) / 1000,
        shifts: vitals.shifts,
        longTasks: vitals.longTasks,
        longTaskMs: Math.round(vitals.longTaskMs),
        ...nav,
      };
      rows.push(row);

      if (row.cls > BUDGETS.cls) {
        const worst = row.shifts
          .sort((a, b) => b.value - a.value)
          .slice(0, 3)
          .map((s) => `${s.value} from ${s.sources.join(', ')}`)
          .join('; ');
        const debt = KNOWN_LAYOUT_DEBT[route.id];
        if (debt && row.cls <= debt.cls + DEBT_TOLERANCE) {
          known.push(`${route.id}: layout shifted ${row.cls} against a recorded ${debt.cls}. ${debt.note}`);
        } else if (debt) {
          failures.push(
            `${route.id}: layout shifted ${row.cls}, worse than the ${debt.cls} recorded for it`
            + ` by more than ${DEBT_TOLERANCE}${worst ? ` (${worst})` : ''}`,
          );
        } else {
          failures.push(`${route.id}: layout shifted ${row.cls}, over the ${BUDGETS.cls} budget${worst ? ` (${worst})` : ''}`);
        }
      }
      // Largest paint is reported and not gated on a threshold.
      //
      // It was, at four times the field target, and that was still wrong. This
      // runner builds, serves and drives several browsers at once, and a
      // measurement taken while it does reflects the queue rather than the
      // build: the same commit measured twelve seconds and twenty on two
      // routes whose shells are identical. A number that swings by eight
      // seconds between runs of the same code cannot be a gate; used as one it
      // would fail honest changes and pass slow ones depending on what else
      // the machine was doing.
      //
      // What is still worth failing on is a paint that never happens at all,
      // which is a shell that did not render rather than one that rendered
      // slowly, and that answer does not move with the load.
      if (row.lcpMs === 0) {
        failures.push(`${route.id}: no largest contentful paint was reported at all, so either nothing painted or the observer never ran`);
      }
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }

  await browser.close();

  if (eager.gzipped > BUDGETS.eagerBytesGzipped) {
    failures.push(
      `the eager payload is ${(eager.gzipped / 1024).toFixed(0)}kB compressed, over the ${(BUDGETS.eagerBytesGzipped / 1024).toFixed(0)}kB budget`
      + ` (${eager.files.map((f) => `${f.name} ${(f.gz / 1024).toFixed(0)}kB`).join(', ')})`,
    );
  }

  writeFileSync(join(OUT, 'perf-report.json'), JSON.stringify({ base: BASE, build, cpuThrottle: CPU_THROTTLE, budgets: BUDGETS, knownDebt: KNOWN_LAYOUT_DEBT, eager, rows, failures, known }, null, 2));

  console.log(`\nMobile performance, build ${build}, CPU throttled ${CPU_THROTTLE}x on slow 4G\n`);
  console.log(
    `Eager payload ${(eager.gzipped / 1024).toFixed(0)}kB compressed`
    + ` of a ${(BUDGETS.eagerBytesGzipped / 1024).toFixed(0)}kB budget,`
    + ` ${(eager.total / 1024).toFixed(0)}kB raw`,
  );
  for (const f of eager.files) {
    console.log(`  ${f.name.padEnd(34)} ${(f.gz / 1024).toFixed(0)}kB  (${(f.size / 1024).toFixed(0)}kB raw)`);
  }
  console.log('');
  console.log('Largest paint is reported, not gated. See the note beside the check.');
  console.log('route            LCP      CLS   long tasks');
  for (const r of rows) {
    console.log(
      `${r.route.padEnd(16)} ${String(r.lcpMs + 'ms').padEnd(8)} ${String(r.cls).padEnd(6)} ${r.longTasks} (${r.longTaskMs}ms)`,
    );
    for (const s of r.shifts.sort((a, b) => b.value - a.value).slice(0, 3)) {
      console.log(`                   shift ${s.value} from ${s.sources.join(', ')}`);
    }
  }
  console.log('');
  if (known.length) {
    // Printed every run, never suppressed. A route that is over budget for a
    // reason somebody wrote down is still over budget, and the way it stays
    // visible is by being printed rather than filtered.
    console.log('-- over budget for a recorded reason, and held to that figure --');
    for (const k of known) console.log(`  ${k}`);
    console.log('');
  }
  if (failures.length) {
    console.log(`-- ${failures.length} over budget --`);
    for (const f of failures) console.log(`  ${f}`);
    console.log('');
    process.exit(1);
  }
  console.log('Everything inside budget.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

export { BUDGETS, eagerPayload };
