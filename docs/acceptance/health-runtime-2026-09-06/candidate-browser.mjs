import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('D:/universe/mempool/mempool/scripts/universe/visual-qa/package.json');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4310';
const owned = JSON.parse(fs.readFileSync(new URL('owned-public-read-evidence.json', import.meta.url), 'utf8')).bitcoin;
const evidence = { startedAt: new Date().toISOString(), scope: 'one headless Chromium page; actual local candidate; approved public Bitcoin GET upstream; no request interception', revisions: { mempool: '64d9ebccd6deb1da07c14fbb3fe77596af1f3646', overlay: '8b2aea3afd4b2f26e2ee5f1275171a937515cbc2' }, checks: [], api: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), args: ['--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', error => evidence.pageErrors.push(error.message));
page.on('response', async response => {
  const url = new URL(response.url());
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) {
    evidence.api.push({ path: url.pathname + url.search, status: response.status() });
  }
});
async function check(name, run) {
  const startedAt = new Date().toISOString();
  try { evidence.checks.push({ name, status: 'PASS', startedAt, details: await run() }); }
  catch (error) { evidence.checks.push({ name, status: 'FAIL', startedAt, error: error.message }); }
  fs.writeFileSync(new URL('candidate-browser-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence.checks.at(-1)));
}
async function visit(path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.chain-toggle').waitFor({ timeout: 25000 });
}
async function capture(name) {
  const body = await page.locator('body').innerText();
  fs.writeFileSync(new URL(`${name}.txt`, import.meta.url), body);
  await page.screenshot({ path: new URL(`${name}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: false });
  return body;
}
try {
  await check('block actual data and refresh', async () => {
    await visit(`/block/${owned.blockHash}`);
    await capture('candidate-block-initial');
    await page.waitForFunction(height => document.body.innerText.replace(/[\s,]/g, '').includes(String(height)), owned.height, { timeout: 25000 });
    const body = await capture('candidate-block-desktop');
    if (!body.includes(String(owned.height)) && !body.includes(owned.height.toLocaleString('en-US'))) throw new Error('Authoritative height absent');
    if (!body.replace(/\s/g, '').includes(owned.blockHash)) throw new Error('Authoritative block hash absent');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(height => document.body.innerText.replace(/[\s,]/g, '').includes(String(height)), owned.height, { timeout: 25000 });
    return { height: owned.height, blockHash: owned.blockHash, reload: true };
  });
  await check('synced node and separate service details', async () => {
    await page.waitForFunction(() => document.querySelector('.chain-current-state')?.textContent?.trim() === 'Synced', { timeout: 20000 });
    await page.getByRole('button', { name: 'Select blockchain' }).click();
    await page.locator('.chain-menu app-chain-health-details summary').click();
    const text = await page.locator('.chain-menu').innerText();
    await capture('candidate-health-desktop');
    if (!text.includes('Synced') || !text.includes('unavailable') || !text.includes('mempool-backend')) throw new Error('Missing independent node/service/authority detail');
    await page.keyboard.press('Escape');
    if (await page.locator('.chain-menu').isVisible()) throw new Error('Escape did not close chain menu');
    return { text, escapeCloses: true };
  });
  await check('transaction actual identity and confirmation', async () => {
    await visit(`/tx/${owned.txid}`);
    await page.locator('app-transaction').waitFor({ timeout: 25000 });
    await page.waitForFunction(id => document.body.innerText.replace(/\s/g, '').includes(id), owned.txid, { timeout: 25000 });
    const text = await capture('candidate-transaction-desktop');
    if (!/confirmed|confirmation/i.test(text)) throw new Error('No confirmation state rendered');
    return { txid: owned.txid, authoritativeConfirmation: owned.transaction.status, expectedFeeSats: owned.transaction.fee, renderedText: text.slice(-14000) };
  });
  await check('address actual identity and history', async () => {
    await visit(`/address/${owned.address}`);
    await page.waitForFunction(address => document.body.innerText.replace(/\s/g, '').includes(address), owned.address, { timeout: 25000 });
    await page.waitForFunction(() => /Total received|Total Received|Transactions/.test(document.body.innerText), { timeout: 25000 });
    const text = await capture('candidate-address-desktop');
    return { address: owned.address, expectedState: owned.addressState, renderedText: text.slice(-12000) };
  });
  for (const theme of ['default', 'dark']) for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await check(`health layout ${theme} ${viewport.width}x${viewport.height}`, async () => {
      await page.evaluate(theme => localStorage.setItem('theme-preference', theme), theme);
      await page.setViewportSize(viewport);
      await visit(`/block/${owned.blockHash}`);
      await page.getByRole('button', { name: 'Select blockchain' }).click();
      await page.locator('.chain-menu app-chain-health-details summary').click();
      const layout = await page.evaluate(() => {
        const rect = document.querySelector('.chain-menu').getBoundingClientRect();
        const summary = document.querySelector('.chain-menu app-chain-health-details summary').getBoundingClientRect();
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, menu: { left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height }, viewportHeight: innerHeight, summaryHeight: summary.height, theme: localStorage.getItem('theme-preference') };
      });
      await capture(`candidate-health-${theme}-${viewport.width}`);
      if (layout.documentWidth > viewport.width + 1 || layout.menu.left < -1 || layout.menu.right > viewport.width + 1 || layout.menu.bottom > viewport.height + 1 || layout.summaryHeight < 44) throw new Error(JSON.stringify(layout));
      await page.keyboard.press('Escape');
      return layout;
    });
  }
  await check('Signet context survives reload with DOGE/ZEC mainnet', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const start = evidence.api.length;
    await visit('/signet');
    await page.waitForResponse(r => r.url().includes('/api/v1/chains?network=signet'), { timeout: 20000 }).catch(() => undefined);
    await page.getByRole('button', { name: 'Select blockchain' }).click();
    const first = await page.locator('.chain-menu').innerText();
    await capture('candidate-signet-desktop');
    if (!/Bitcoin.*signet/i.test(first) || !/Dogecoin.*mainnet/i.test(first) || !/Zcash.*mainnet/i.test(first)) throw new Error(first);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.chain-toggle').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Select blockchain' }).click();
    const second = await page.locator('.chain-menu').innerText();
    if (!/Bitcoin.*signet/i.test(second)) throw new Error('Reload lost selected context');
    return { before: first, after: second, requests: evidence.api.slice(start), limit: 'No configured Signet authority; no real Signet functional PASS' };
  });
} finally {
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(new URL('candidate-browser-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2));
  await browser.close();
}
