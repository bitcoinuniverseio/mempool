// Public-origin acceptance pass for the parity release.
//
// Loads the deployed origin in a real browser, with nothing mocked, and
// reports what each required route rendered. Run after the frontend cutover.
//
//   node acceptance.mjs [origin]
import playwright from 'playwright';

const ORIGIN = (process.argv[2] || 'https://explorer.bitcoinuniverse.io').replace(/\/+$/, '');

const ROUTES = [
  // Bitcoin, which must not regress.
  { path: '', expect: 'bitcoin' },
  { path: 'mining', expect: 'bitcoin' },
  { path: 'graphs/mempool', expect: 'bitcoin' },
  { path: 'docs', expect: 'bitcoin' },
  // The parity surfaces.
  { path: 'dogecoin', expect: 'chain', timeline: true },
  { path: 'dogecoin/mining', expect: 'chain', timeline: true },
  { path: 'dogecoin/mempool', expect: 'chain' },
  { path: 'dogecoin/protocols', expect: 'chain' },
  { path: 'dogecoin/graphs/mempool', expect: 'charts' },
  { path: 'dogecoin/graphs/mining/pools', expect: 'charts' },
  { path: 'dogecoin/docs', expect: 'docs' },
  { path: 'zcash', expect: 'chain', timeline: true },
  { path: 'zcash/mining', expect: 'chain', timeline: true },
  { path: 'zcash/mempool', expect: 'chain' },
  { path: 'zcash/protocols', expect: 'chain' },
  { path: 'zcash/graphs/mempool', expect: 'charts' },
  { path: 'zcash/graphs/mining/hashrate-difficulty', expect: 'charts' },
  { path: 'zcash/docs', expect: 'docs' },
];

const failures = [];
const notes = [];

const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

for (const route of ROUTES) {
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 120));
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(ORIGIN).origin && (r.status() >= 500 || (r.status() === 404 && u.pathname.startsWith('/api/')))) {
      failed.push(`${r.status()} ${u.pathname}`);
    }
  });
  const where = `/${route.path}`;
  try {
    await page.goto(`${ORIGIN}/${route.path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(3_000);
    const facts = await page.evaluate(() => ({
      finalPath: location.pathname,
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      navItems: [...document.querySelectorAll('.primary-nav .nav-label')].map((n) => n.textContent.trim()),
      timelineRow: !!document.querySelector('.timeline-row'),
      future: document.querySelectorAll('.timeline-side.future .candidate-cube').length,
      confirmed: document.querySelectorAll('.timeline-side.confirmed .candidate-cube').length,
      heightsShown: [...document.querySelectorAll('.cube-height')].filter((n) => n.textContent.trim()).length,
      charts: document.querySelectorAll('div[_echarts_instance_]').length,
      docsSections: document.querySelectorAll('.docs-section').length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));

    // Landing deeper is fine: Bitcoin's /docs redirects to /docs/faq by
    // design. Landing outside the section is the failure this catches, and
    // it is what /dogecoin/mining did before this release, by serving the
    // Bitcoin dashboard.
    const wanted = `/${route.path}`.replace(/\/+$/, '') || '/';
    const landed = facts.finalPath.replace(/\/+$/, '') || '/';
    if (wanted !== '/' && landed !== wanted && !landed.startsWith(`${wanted}/`)) {
      failures.push(`${where}: redirected to ${facts.finalPath}`);
    }
    if (facts.overflow) failures.push(`${where}: page scrolls sideways`);
    if (errors.length) failures.push(`${where}: console errors ${JSON.stringify(errors.slice(0, 2))}`);
    if (failed.length) failures.push(`${where}: failed requests ${JSON.stringify(failed.slice(0, 3))}`);

    const required = ['Dashboard', 'Mining', 'Mempool', 'Protocols', 'Charts', 'Docs'];
    const missing = required.filter((r) => !facts.navItems.includes(r));
    if (missing.length) failures.push(`${where}: navigation missing ${missing.join(', ')}`);

    if (route.timeline) {
      if (!facts.timelineRow) failures.push(`${where}: no block timeline`);
      else if (facts.future + facts.confirmed === 0) failures.push(`${where}: timeline drew no cubes`);
      else if (facts.heightsShown === 0) failures.push(`${where}: cubes carry no heights`);
      else notes.push(`${where}: ${facts.future} future + ${facts.confirmed} confirmed cubes, ${facts.heightsShown} heights`);
    }
    if (route.expect === 'charts' && facts.charts === 0) {
      failures.push(`${where}: no chart drew`);
    } else if (route.expect === 'charts') {
      notes.push(`${where}: ${facts.charts} chart(s)`);
    }
    if (route.expect === 'docs') {
      if (facts.docsSections === 0) failures.push(`${where}: no docs sections`);
      else notes.push(`${where}: ${facts.docsSections} sections`);
    }
    if (!route.timeline && route.expect !== 'charts' && route.expect !== 'docs') {
      notes.push(`${where}: "${facts.h1 ?? 'no h1'}"`);
    }
  } catch (error) {
    failures.push(`${where}: did not load (${String(error).slice(0, 100)})`);
  }
  await page.close();
}

await browser.close();

for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.error(`  FAIL  ${failure}`);
console.log(
  failures.length
    ? `\n${failures.length} acceptance failure(s) against ${ORIGIN}`
    : `\nAll ${ROUTES.length} routes passed against ${ORIGIN}`,
);
process.exitCode = failures.length ? 1 : 0;
