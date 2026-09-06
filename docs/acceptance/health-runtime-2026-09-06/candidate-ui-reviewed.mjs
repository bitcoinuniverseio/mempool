import fs from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('D:/universe/mempool/mempool/scripts/universe/visual-qa/package.json');
const { chromium } = require('playwright');
const mode = process.argv[2] || 'block';
const base = 'http://127.0.0.1:4310';
const owned = JSON.parse(fs.readFileSync(new URL('owned-public-read-evidence.json', import.meta.url), 'utf8')).bitcoin;
const file = new URL(`candidate-ui-${mode}.json`, import.meta.url);
const result = { startedAt: new Date().toISOString(), scope: 'real candidate DOM; one page; actual GET data; no intercepted responses', mode, requests: [], assertions: [] };
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const healthResponses = [];
page.on('response', async response => {
  if (response.url().includes('/api/')) result.requests.push({ path: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status() });
  if (response.url().includes('/api/v1/chains?')) { try { healthResponses.push({ url: response.url(), rows: await response.json() }); } catch {} }
});
async function poll(fn, duration = 10000) {
  const until = Date.now() + duration;
  while (Date.now() < until) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('DOM/response assertion did not settle within bounded wait');
}
async function capture(suffix) {
  result.body = await page.locator('body').innerText();
  fs.writeFileSync(new URL(`candidate-ui-${mode}-${suffix}.txt`, import.meta.url), result.body);
  await page.screenshot({ path: new URL(`candidate-ui-${mode}-${suffix}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
}
try {
  const path = mode === 'signet' ? '/signet' : mode === 'transaction' ? `/tx/${owned.txid}` : mode === 'address' ? `/address/${owned.address}` : `/block/${owned.blockHash}`;
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.locator('.chain-toggle').waitFor({ timeout: 15000 });
  if (mode === 'signet') {
    await poll(() => healthResponses.some(r => r.url.includes('network=signet')));
    for (const phase of ['initial', 'reload']) {
      if (phase === 'reload') {
        const count = healthResponses.length;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.chain-toggle').waitFor();
        await poll(() => healthResponses.length > count && healthResponses.at(-1).url.includes('network=signet'));
      }
      await page.getByRole('button', { name: 'Select blockchain' }).click();
      const labels = await page.locator('.chain-option-title').allTextContents();
      assert.match(labels[0], /Bitcoin.*Signet/i); assert.match(labels[1], /Dogecoin.*Mainnet/i); assert.match(labels[2], /Zcash.*Mainnet/i);
      assert.equal((await page.locator('.chain-option-state').first().innerText()).trim(), 'Status unknown');
      const rows = healthResponses.at(-1).rows;
      assert.deepEqual(rows.map(r => [r.chain, r.network]), [['bitcoin', 'signet'], ['dogecoin', 'mainnet'], ['zcash', 'mainnet']]);
      await capture(phase); result.assertions.push({ phase, labels, apiContexts: rows.map(r => [r.chain, r.network]) });
      await page.keyboard.press('Escape');
    }
    result.limit = 'Context behavior only; no configured Signet authority or Signet data acceptance';
  } else if (mode === 'block') {
    const identity = page.locator(`app-block a[title="${owned.blockHash}"]`).first();
    await identity.waitFor({ timeout: 15000 });
    assert.equal(await identity.getAttribute('href'), `/block/${owned.blockHash}`);
    assert.equal((await page.locator('.block-link').innerText()).trim(), String(owned.height));
    assert.match(await page.locator('app-block').innerText(), /4,012 transactions/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await identity.waitFor({ timeout: 15000 });
    assert.equal((await page.locator('.block-link').innerText()).trim(), String(owned.height));
    await capture('reload');
    result.assertions.push({ blockHash: owned.blockHash, height: owned.height, txCount: 4012, reload: true });
    await poll(() => healthResponses.length > 0);
    await page.getByRole('button', { name: 'Select blockchain' }).click();
    await page.locator('.chain-menu app-chain-health-details summary').click();
    const node = healthResponses.at(-1).rows[0].health.node;
    const displayed = (await page.locator('.chain-current-state').innerText()).trim();
    const expected = node.synced === true && !node.stale ? 'Synced' : node.synced === false && !node.stale ? 'Syncing' : 'Status unknown';
    assert.equal(displayed, expected);
    const details = await page.locator('.chain-menu app-chain-health-details').innerText();
    assert.match(details, /Node · mempool-backend/); assert.match(details, /Confirmed history · mempool-backend/); assert.match(details, /unavailable/i);
    await capture('health');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.chain-menu').isVisible(), false);
    result.assertions.push({ displayed, node, details, escapeCloses: true });
  } else if (mode === 'transaction') {
    await poll(async () => {
      const text = await page.locator('app-transaction').innerText();
      return !text.includes('Loading transaction') && /Fee/.test(text) && /Confirmed|confirmations/.test(text);
    }, 15000);
    await capture('loaded');
    const text = await page.locator('app-transaction').innerText();
    assert.ok(text.replace(/\s/g, '').includes(owned.txid));
    result.assertions.push({ txid: owned.txid, loadedText: text });
    result.limit = 'Real displayed transaction requires correct source block height; public height inconsistency remains failure';
    result.status = 'BLOCKED';
  } else if (mode === 'address') {
    await poll(async () => {
      const text = await page.locator('app-address').innerText();
      return text.replace(/\s/g, '').includes(owned.address) && /164/.test(text);
    }, 15000);
    await capture('loaded');
    result.assertions.push({ address: owned.address, txCount: 164, expectedState: owned.addressState });
    result.limit = 'Identity and summary only; pagination, UTXO semantics and full address acceptance remain unverified';
  }
  result.status ??= 'PASS SCOPED ASSERTIONS';
} catch (error) {
  result.status = 'FAIL'; result.error = error.message;
  if (!page.isClosed()) await capture('failure').catch(() => undefined);
} finally {
  result.healthResponses = healthResponses;
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ mode, status: result.status, error: result.error, assertions: result.assertions.length }));
}
