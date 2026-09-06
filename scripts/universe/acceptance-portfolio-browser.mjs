import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Uses real browser IndexedDB/WebCrypto and actual UI controls. No authority
// response is intercepted, and an empty local portfolio is not chain evidence.
export async function checkLocalPortfolio(page, output, screenshots) {
  const checks = [];
  const runtimeErrors = [];
  const onConsole = message => {
    if (message.type() === 'error' && /ERROR.*(?:NG\d{4}|TypeError|ReferenceError)/s.test(message.text())) runtimeErrors.push(message.text());
  };
  page.on('console', onConsole);
  const passphrase = randomUUID();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:4310/portfolio', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: /Create from one address/ }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Repeat passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByRole('heading', { name: 'Add one public address', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Create a manual-only portfolio/ }).click();
  await page.locator('app-portfolio-shell .selector strong').getByText('Manual portfolio', { exact: true }).waitFor();
  await page.locator('app-portfolio-overview').getByText('Portfolio value', { exact: true }).waitFor();
  const firstPath = new URL(page.url()).pathname;
  assert.match(firstPath, /^\/portfolio\/p\/[^/]+\/overview$/);
  const persistence = await page.evaluate(async () => {
    const request = indexedDB.open('universe-portfolio-vault', 1);
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['meta', 'records'], 'readonly');
    const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [meta, records] = await Promise.all([read(tx.objectStore('meta').get('vault')), read(tx.objectStore('records').getAll())]);
    db.close();
    return { kdf: meta.kdf, recordCount: records.length,
      encryptedRecords: records.every(record => typeof record.envelope?.ctB64 === 'string' && typeof record.envelope?.nonceB64 === 'string' && !('value' in record)) };
  });
  assert.equal(persistence.kdf, 'argon2id');
  assert.ok(persistence.recordCount >= 2);
  assert.equal(persistence.encryptedRecords, true);
  checks.push({ id: 'PF-LOCAL-CREATE', status: 'PASS', path: firstPath, persistence, scope: 'Empty manual portfolio saved through encrypted vault UI' });

  await page.locator('app-portfolio-shell').getByRole('link', { name: 'Reports', exact: true }).click();
  await page.getByRole('heading', { name: 'Redacted report', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create encrypted link', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Refresh saved shares', exact: true }).click();
  checks.push({ id: 'PF-LOCAL-EMPTY-REPORT', status: 'PASS', scope: 'Empty report cannot create a fabricated share' });
  for (const [theme, width] of [['Light', 1440], ['Dark', 390], ['High contrast', 390]]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.locator('#theme-select').selectOption({ label: theme });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, theme + ' report overflow');
    await page.screenshot({ path: resolve(screenshots, 'portfolio-report-' + theme.toLowerCase().replace(' ', '-') + '.png'), fullPage: true });
    checks.push({ id: 'PF-LOCAL-REPORT-' + theme.toUpperCase().replace(' ', '-'), status: 'PASS', width, overflow });
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
  assert.equal(await page.locator('app-report-builder').count(), 0);
  await page.getByRole('link', { name: 'Open portfolios', exact: true }).click();
  await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
  await page.getByLabel('Passphrase', { exact: true }).fill('deliberately-wrong-local-test');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('alert').getByText('That passphrase did not unlock the portfolio.', { exact: true }).waitFor();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('app-portfolio-shell .selector strong').getByText('Manual portfolio', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, firstPath);
  checks.push({ id: 'PF-LOCAL-RELOAD-UNLOCK', status: 'PASS', scope: 'Actual persisted IndexedDB vault, wrong passphrase rejected, requested portfolio restored' });

  // A full navigation intentionally relocks the vault. Unlocking an unknown
  // requested identity must not show the previously active portfolio.
  await page.goto('http://localhost:4310/portfolio/p/nonexistent-local-acceptance/overview', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Open portfolios', exact: true }).click();
  await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('This portfolio is not available in this vault.', { exact: true }).waitFor();
  assert.equal(await page.locator('app-portfolio-overview').count(), 0);
  assert.equal(await page.locator('app-portfolio-shell .selector strong').innerText(), 'Portfolio');
  checks.push({ id: 'PF-LOCAL-UNKNOWN-IDENTITY', status: 'PASS', scope: 'Unknown requested portfolio cannot render the prior portfolio' });

  const unavailable = page.waitForResponse(response => response.url().includes('/api/v2/universe/portfolio-share/'));
  await page.goto('http://localhost:4310/portfolio/share/' + 'a'.repeat(64), { waitUntil: 'domcontentloaded' });
  assert.equal((await unavailable).status(), 503);
  await page.getByText('This share could not be opened.', { exact: true }).waitFor();
  checks.push({ id: 'PF-SHARE-UNAVAILABLE', status: 'PASS', scope: 'Unavailable sharing dependency is shown as a failure, without fabricating missing/expired/decrypted data' });
  assert.deepEqual(runtimeErrors, []);
  page.off('console', onConsole);
  writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), origin: 'http://localhost:4310',
    scope: 'Pure local UI workflows using actual IndexedDB/WebCrypto; no real share persistence or chain acceptance',
    realNetworkE2ePasses: 0, checks }, null, 2) + '\n');
  return { localPortfolioChecks: checks.length };
}
