// One localhost application, one headless browser, one page for the entire run.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { checkNavigation, checkParserForms, checkResponsiveRoutes } from './acceptance-browser.mjs';
import { checkLocalPortfolio } from './acceptance-portfolio-browser.mjs';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'scripts/universe/visual-qa/package.json'));
const { chromium } = require('playwright');
const output = resolve(root, 'docs/acceptance');
const screenshots = resolve(root, '../audits/acceptance-20260905');
mkdirSync(screenshots, { recursive: true });
const host = await fetch('http://localhost:4310/__acceptance').then(response => response.json());
assert.equal(host.realNetworkE2ePasses, 0);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('http://localhost:4310/payments/silent/address', { waitUntil: 'domcontentloaded' });
  await page.locator('app-silent-payments-address').waitFor();
  const configuration = await page.evaluate(() => ({
    STRATUM_ENABLED: window.__env?.STRATUM_ENABLED ?? null,
    OFFICIAL_MEMPOOL_SPACE: window.__env?.OFFICIAL_MEMPOOL_SPACE ?? null,
    isMempoolSpaceBuild: window.isMempoolSpaceBuild ?? null,
    BASE_MODULE: window.__env?.BASE_MODULE ?? null,
    widgets: window.__env?.customize?.dashboard?.widgets?.map(widget => widget.component) ?? [],
    routerConditions: {
      stratum: Boolean(window.__env?.STRATUM_ENABLED),
      officialMempool: Boolean(window.__env?.OFFICIAL_MEMPOOL_SPACE),
      mempoolSpaceBuild: Boolean(window.isMempoolSpaceBuild),
      simpleproof: Boolean(window.__env?.customize?.dashboard?.widgets?.some(widget => widget.component === 'simpleproof')),
      simpleproofCubo: Boolean(window.__env?.customize?.dashboard?.widgets?.some(widget => widget.component === 'simpleproof_cubo')),
    },
  }));
  writeFileSync(resolve(output, 'browser-feature-config-2026-09-05.json'), JSON.stringify(configuration, null, 2) + '\n');
  console.log(await checkNavigation(page, root, resolve(output, 'browser-navigation-2026-09-05.json')));
  console.log(await checkParserForms(page, root, resolve(output, 'browser-parser-2026-09-05.json'), screenshots));
  console.log(await checkResponsiveRoutes(page, root, resolve(output, 'browser-responsive-2026-09-05.json'), screenshots));
  const checks = [];
  await page.goto('http://localhost:4310/signet/swaps/recover', { waitUntil: 'domcontentloaded' });
  await page.locator('app-swaps-recover').waitFor();
  await page.locator('#swap-package').fill('{"private_key":"non-secret-negative-test"}');
  await page.locator('#swap-destination').fill('invalid');
  await page.locator('#swap-fee').fill('500');
  let sent = 0;
  const listener = request => { if (request.url().includes('/swaps/chain-context')) sent++; };
  page.on('request', listener);
  await page.getByRole('button', { name: 'Generate unsigned refund PSBT', exact: true }).click();
  await page.locator('[role=alert]').waitFor();
  assert.equal(sent, 0);
  checks.push({ id: 'SW-12-UI-PRIVATE-FIELDS', status: 'PASS', sentRequests: sent, rendered: await page.locator('[role=alert]').innerText() });
  page.off('request', listener);
  await page.goto('http://localhost:4310/swaps/simulate', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Run local simulation', exact: true }).click();
  const result = page.locator('section[aria-live]');
  await result.waitFor();
  const rendered = await result.innerText();
  for (const expected of ['height: 197', 'confirmations: 0', 'restored: 3']) assert.ok(rendered.includes(expected));
  checks.push({ id: 'SW-SIM-UI', status: 'PASS', scope: 'hypothetical calculation only', rendered });
  await page.locator('#sim-depth').fill('201');
  await page.getByRole('button', { name: 'Run local simulation', exact: true }).click();
  await page.locator('[role=alert]').waitFor();
  checks.push({ id: 'SW-SIM-UI-INVALID', status: 'PASS', rendered: await page.locator('[role=alert]').innerText() });
  await page.getByRole('link', { name: 'Recovery Planner', exact: true }).click();
  await page.locator('app-swaps-recover').waitFor();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.locator('app-swaps-simulate').waitFor();
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await page.locator('app-swaps-recover').waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('app-swaps-recover').waitFor();
  await page.locator('#swap-package').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'swap-file');
  checks.push({ id: 'SW-12-RELOAD-HISTORY-KEYBOARD', status: 'PASS', keyboardFocus: 'swap-file' });
  writeFileSync(resolve(output, 'browser-workflows-2026-09-05.json'), JSON.stringify({
    origin: 'http://localhost:4310', revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    realNetworkE2ePasses: 0, checkedAt: new Date().toISOString(), checks,
  }, null, 2) + '\n');
  console.log({ workflowChecks: checks.length, browserPages: context.pages().length,
    navigationRows: JSON.parse(readFileSync(resolve(output, 'browser-navigation-2026-09-05.json'), 'utf8')).checks.length });
  console.log(await checkLocalPortfolio(page, resolve(output, 'browser-portfolio-2026-09-05.json'), screenshots));
} finally { await browser.close(); }
