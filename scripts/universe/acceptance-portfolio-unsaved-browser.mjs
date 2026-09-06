import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function checkUnsavedPortfolioEntry(page, output, screenshots) {
  const origin = 'http://localhost:4310';
  const checks = [];
  const snapshot = () => page.evaluate(async () => {
    const request = indexedDB.open('universe-portfolio-vault', 1);
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(['meta', 'records'], 'readonly');
      const read = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const values = await Promise.all([read(tx.objectStore('meta').get('vault')), read(tx.objectStore('records').getAll())]);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
      return { count: values[1].length, sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') };
    } finally { db.close(); }
  });
  const before = await snapshot();
  const cases = [
    ['bitcoin', 'BC1QCR8TE4KR609GCAWUTMRZA0J4XV80JY8Z306FYU'],
    ['dogecoin', 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'],
    ['zcash', 't1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv'],
  ];
  for (const [chain, address] of cases) {
    await page.goto(origin + '/portfolio/new?mode=ephemeral', { waitUntil: 'domcontentloaded' });
    const form = page.locator('app-onboarding');
    await form.getByRole('heading', { name: 'Look up one public address', exact: true, level: 1 }).waitFor();
    await form.getByLabel('Chain and network', { exact: true }).selectOption(chain + ':mainnet');
    const input = form.locator('textarea');
    const open = form.getByRole('button', { name: 'Open without saving', exact: true });
    await input.fill(address.slice(0, -1) + (address.endsWith('1') ? '2' : '1'));
    assert.equal(await open.isDisabled(), true);
    await form.getByRole('alert').waitFor();
    await input.fill(address);
    assert.equal(await open.isEnabled(), true);
    await open.click();
    await page.waitForURL(url => url.pathname === '/portfolio/' + chain + '/mainnet/' + address);
    assert.deepEqual(await snapshot(), before);
    checks.push({ id: 'Q05-P07-' + chain.toUpperCase() + '-LOCAL', status: 'PASS LOCAL',
      scope: 'Checksum/version validation and real unsaved route selection preserve all encrypted bytes. Public authority readback remains BLOCKED PRE-03.',
      entry: '/portfolio/new?mode=ephemeral', actualPath: new URL(page.url()).pathname,
      invalidChecksumRejected: true, vaultBefore: before, vaultAfter: before });
  }
  await page.goto(origin + '/portfolio/new?mode=ephemeral', { waitUntil: 'domcontentloaded' });
  const form = page.locator('app-onboarding');
  await form.getByRole('heading', { name: 'Look up one public address', exact: true, level: 1 }).waitFor();
  const writes = [];
  const observe = request => { if (request.method() !== 'GET' && request.method() !== 'HEAD') writes.push(new URL(request.url()).pathname); };
  page.on('request', observe);
  try {
    await form.locator('textarea').fill('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    await form.getByRole('alert').waitFor();
    assert.equal(await form.locator('textarea').inputValue(), '');
    assert.equal(await form.getByRole('button', { name: 'Open without saving', exact: true }).isDisabled(), true);
    assert.deepEqual(await snapshot(), before);
    assert.equal(writes.length, 0);
  } finally { page.off('request', observe); }
  checks.push({ id: 'Q05-P07-PRIVATE-REJECTION', status: 'PASS LOCAL', scope: 'Public test mnemonic rejected and erased in the real form before transmission or persistence', outboundWriteRequests: 0 });
  await page.screenshot({ path: resolve(screenshots, 'portfolio-unsaved-private-rejection.png'), fullPage: true });
  writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), origin, scope: 'Local entry only; no authority or network acceptance', checks }, null, 2) + '\n');
  return { localChecks: checks.length };
}

