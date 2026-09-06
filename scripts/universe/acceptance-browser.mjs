// Run against the one existing localhost app and an already-owned browser page.
// A rendered route never promotes its dependent operations to an E2E pass.
import { readFileSync, writeFileSync as writeOnce, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Antivirus/editor reads can briefly lock a generated report on Windows.
// Retry only those transient write errors; all other failures remain fatal.
function writeFileSync(path, value) {
  for (let attempt = 0; ; attempt++) {
    try { writeOnce(path, value); return; }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'UNKNOWN'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

export async function checkNavigation(page, root, output) {
  const origin = 'http://localhost:4310';
  if (new URL(page.url()).origin !== origin) throw new Error('Reuse the dedicated localhost:4310 page.');
  const inventory = JSON.parse(readFileSync(resolve(root, 'docs/acceptance/2026-09-05-inventory.json'), 'utf8').replace(/^\uFEFF/, ''));
  const report = { scope: 'Actual browser route rendering; dependent operations and authoritative identities remain separate',
    origin, startedAt: new Date().toISOString(), realNetworkE2ePasses: 0, checks: [] };
  const errors = [];
  const requests = [];
  const onError = error => errors.push(error.message);
  const onConsole = message => {
    // Angular catches some runtime exceptions itself, so they do not become
    // pageerror events. Keep dependency HTTP failures in their separate list.
    if (message.type() === 'error' && /ERROR.*(?:NG\d{4}|TypeError|ReferenceError)/s.test(message.text())) errors.push(message.text());
  };
  const onResponse = response => {
    const url = new URL(response.url());
    if (url.origin === origin && /\/api\//.test(url.pathname) && response.status() >= 400) {
      requests.push({ path: url.pathname, status: response.status() });
    }
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  try {
    for (const entry of inventory.navigation) {
      errors.length = 0;
      requests.length = 0;
      const parameterized = entry.path.includes(':');
      const path = entry.path.replace(/:[A-Za-z]+/g, 'invalid-acceptance-identity');
      const selectors = [...new Set(entry.componentInventory.flatMap(file => {
        const absolute = resolve(root, file);
        if (!existsSync(absolute)) return [];
        const selector = readFileSync(absolute, 'utf8').match(/selector:\s*['"]([^'"]+)['"]/)?.[1];
        return selector ? [selector] : [];
      }))];
      let result;
      try {
        await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (selectors.length) await page.locator(selectors.join(',')).first().waitFor({ state: 'attached', timeout: 1800 });
        else await page.waitForFunction(() => [...document.querySelectorAll('router-outlet')]
          .some(node => node.nextElementSibling?.tagName.startsWith('APP-') && node.nextElementSibling.tagName !== 'APP-MASTER-PAGE'), undefined, { timeout: 3000 });
        result = await page.evaluate(() => ({ path: location.pathname,
          headings: [...document.querySelectorAll('h1,h2')].map(node => node.textContent.trim()).slice(0, 8),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          renderedComponents: [...document.querySelectorAll('router-outlet')].map(node => node.nextElementSibling?.tagName).filter(Boolean),
        }));
        result.renderStatus = (result.path === path || entry.declarations.some(row => row.redirectTo !== null ||
          (row.lazyChildren && result.path.startsWith(path + '/')))
          ) && errors.length === 0 ? 'PASS' : 'FAIL';
      } catch (error) {
        result = { path: new URL(page.url()).pathname, renderStatus: 'NOT VERIFIED', reason: error.message.split('\n')[0] };
      }
      report.checks.push({ id: entry.id, requestedPath: entry.path, exercisedPath: path, parameterized,
        inputScope: parameterized ? 'Malformed identity only; an authority-supplied valid identity is still required' : 'Literal entry',
        expectedSelectors: selectors, ...result, errors: [...errors], unavailableRequests: [...requests],
        operationStatus: parameterized || requests.length ? 'BLOCKED' : 'NOT TESTED',
        checkedAt: new Date().toISOString() });
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      if (report.checks.length % 25 === 0) console.log('Browser navigation checked: ' + report.checks.length + '/351');
    }
    report.completedAt = new Date().toISOString();
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    return { checked: report.checks.length, rendered: report.checks.filter(row => row.renderStatus === 'PASS').length,
      needsReview: report.checks.filter(row => row.renderStatus !== 'PASS').map(row => ({ id: row.id, path: row.requestedPath, reason: row.reason })) };
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
}

export async function checkParserForms(page, root, output, screenshotDirectory) {
  const origin = 'http://localhost:4310';
  const address = 'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv';
  const scanKey = '0220bcfac5b99e04ad1a06ddfb016ee13582609d60b6291e98d01a9bc9a16c96d4';
  const spendKey = '025cc9856d6f8375350e123978daac200c260cb5b5ae83106cab90484dcd8fcf36';
  const vectors = JSON.parse(readFileSync(resolve(root, 'backend/src/api/intelligence/silent-payments/bip375-public-vectors.json'), 'utf8'));
  const report = { scope: 'Real forms and compiled HTTP handlers; offline parser acceptance only', origin,
    startedAt: new Date().toISOString(), realNetworkE2ePasses: 0, checks: [] };
  async function submit(id, input, kind, expected, network = 'mainnet') {
    const prefix = network === 'mainnet' ? '' : '/' + network;
    await page.goto(origin + prefix + '/payments/silent/' + kind, { waitUntil: 'domcontentloaded' });
    const host = page.locator('app-silent-payments-' + kind);
    await host.waitFor();
    await host.locator('textarea').fill(input);
    const received = page.waitForResponse(response => response.url().includes('/validate-' + (kind === 'address' ? 'address' : 'psbt')));
    await host.locator('button[type=submit]').click();
    const response = await received;
    const actual = await response.json();
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, id + ' ' + key);
    assert.equal(response.status(), expected.valid ? 200 : 400, id);
    if (!expected.valid) await host.locator('.alert-danger').waitFor();
    else if (kind === 'address') await host.getByText(scanKey, { exact: false }).waitFor();
    else await host.getByText('PSBT Structure Inspection Result', { exact: true }).waitFor();
    const rendered = await host.innerText();
    report.checks.push({ id, network, input, expected, actual, status: 'PASS',
      requestUrl: response.url(), requestId: response.headers()['x-request-id'] ?? null,
      httpStatus: response.status(), rendered, checkedAt: new Date().toISOString() });
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  await submit('SP-05-UI-PUNCTUATION', 'sp1q' + '!'.repeat(113), 'address', { valid: false });
  await submit('SP-05-UI-CHECKSUM', address.slice(0, -1) + 'x', 'address', { valid: false });
  await submit('SP-05-UI-MIXED-CASE', 'SP' + address.slice(2), 'address', { valid: false });
  await submit('SP-05-UI-WRONG-NETWORK', address, 'address', { valid: false }, 'signet');
  await submit('SP-05-UI-OFFICIAL-KEYS', address, 'address', { valid: true, scan_pubkey: scanKey, spend_pubkey: spendKey });
  await submit('SP-05-UI-BIP321', 'bitcoin:?sp=' + address, 'address', { valid: true, scan_pubkey: scanKey, spend_pubkey: spendKey });
  await page.screenshot({ path: resolve(screenshotDirectory, 'address-valid-desktop.png'), fullPage: true });
  for (const [index, input] of ['cHNidFg=', 'cHNidP8=', 'cHNidP8B', '!bad base64!'].entries()) {
    await submit('SP-06-UI-NEGATIVE-' + index, input, 'psbt', { valid: false });
  }
  await submit('SP-06-UI-STANDARD-VECTOR', vectors.valid[0].psbt, 'psbt', { valid: true, bip375_present: true, cryptographically_verified: false });
  await page.screenshot({ path: resolve(screenshotDirectory, 'psbt-valid-desktop.png'), fullPage: true });
  report.completedAt = new Date().toISOString();
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  return { passed: report.checks.length, scope: report.scope };
}

export async function checkResponsiveRoutes(page, root, output, screenshotDirectory) {
  const routes = [
    '/labs/consensus/compare', '/labs/consensus/conformance', '/labs/consensus/differential',
    '/labs/consensus/cases', '/labs/consensus/formal', '/labs/consensus/specifications', '/labs/consensus/corpora',
    '/protocols/bitcoin-staking', '/protocols/bitcoin-staking/delegations', '/protocols/ordinals',
    '/payments/silent', '/payments/silent/address', '/payments/silent/psbt', '/payments/silent/scan', '/payments/silent/coverage',
    '/swaps', '/swaps/submarine', '/swaps/reverse', '/swaps/chain', '/swaps/providers', '/swaps/provider/boltz',
    '/swaps/inspect', '/swaps/recover', '/swaps/simulate', '/signet/swaps/recover', '/signet/inscription/invalid-acceptance-identity',
  ];
  const capture = new Set(['/labs/consensus/compare', '/protocols/bitcoin-staking', '/payments/silent/address',
    '/payments/silent/psbt', '/payments/silent/scan', '/swaps/recover', '/swaps/simulate']);
  const report = { scope: 'Rendered responsive state, not authoritative operation acceptance', checks: [] };
  for (const mode of [{ theme: 'Light', width: 1440, height: 1000 }, { theme: 'Dark', width: 390, height: 844 },
    { theme: 'High contrast', width: 390, height: 844 }]) {
    await page.setViewportSize({ width: mode.width, height: mode.height });
    for (const route of routes) {
      await page.goto('http://localhost:4310' + route, { waitUntil: 'domcontentloaded' });
      await page.locator('#theme-select').selectOption({ label: mode.theme });
      // Authority failures can replace the title with an error state. Record
      // that state without treating missing data as a successful operation.
      await page.locator('router-outlet + *').first().waitFor({ state: 'attached' });
      await page.evaluate(() => window.scrollTo(0, 0));
      const result = await page.evaluate(() => ({ finalPath: location.pathname,
        title: document.querySelector('h1')?.textContent.trim(),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        width: innerWidth, bodyClasses: document.body.className,
        followupLinks: [...document.querySelectorAll('.intelligence-page a[href]')].map(a => a.getAttribute('href')),
      }));
      const screenshot = capture.has(route) ? route.slice(1).replaceAll('/', '-') + '-' + mode.theme.toLowerCase().replace(' ', '-') + '.png' : null;
      if (screenshot) await page.screenshot({ path: resolve(screenshotDirectory, screenshot), fullPage: false });
      report.checks.push({ route, mode, ...result, screenshot, checkedAt: new Date().toISOString() });
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
    console.log('Responsive routes checked: ' + mode.theme + ' ' + mode.width);
  }
  return { checked: report.checks.length, overflow: report.checks.filter(row => row.overflow).map(row => ({ route: row.route, mode: row.mode })) };
}
