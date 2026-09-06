import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const origin = 'http://localhost:4310';

async function encryptedSnapshot(page) {
  return page.evaluate(async () => {
    const opened = indexedDB.open('universe-portfolio-vault', 1);
    const db = await new Promise((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const tx = db.transaction(['meta', 'records'], 'readonly');
      const read = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [meta, records] = await Promise.all([
        read(tx.objectStore('meta').get('vault')),
        read(tx.objectStore('records').getAll()),
      ]);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ meta, records })));
      return { count: records.length, kdf: meta.kdf,
        sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') };
    } finally { db.close(); }
  });
}

/**
 * Uses the existing browser only. At most one page is open at every step.
 * A's context is retained unchanged; B's disposable context is closed at end.
 * Always adopt result.activePage, including when result.passed is false.
 */
export async function checkPortfolioIdentityIsolation(page, output, screenshots, { passphrase, portfolioPath }) {
  assert.equal(new URL(page.url()).origin, origin);
  assert.equal(new URL(page.url()).pathname, portfolioPath);
  assert.match(portfolioPath, /^\/portfolio\/p\/[^/]+\/overview$/);
  assert.equal(typeof passphrase, 'string');
  assert.ok(passphrase.length >= 8);
  const contextA = page.context();
  const browser = contextA.browser();
  assert.ok(browser, 'The supplied page must belong to the existing dedicated browser.');
  const openPages = () => browser.contexts().flatMap(context => context.pages()).filter(candidate => !candidate.isClosed());
  assert.equal(openPages().length, 1, 'Only the supplied acceptance page may be open.');
  const originalName = await page.locator('app-portfolio-shell .selector strong').innerText();
  const beforeA = await encryptedSnapshot(page);
  assert.equal(beforeA.kdf, 'argon2id');
  assert.ok(beforeA.count >= 2);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(screenshots, { recursive: true });
  const passphraseB = randomUUID();
  const labelB = 'Isolation B ' + randomUUID().slice(0, 8);
  const checks = [];
  let phase = 'create-independent-B';
  let failure = null;
  let contextB = null;
  let pageB = null;
  let activePage = page;
  let secretInRequest = false;
  const runtimeErrors = [];
  const monitor = request => {
    const text = request.url() + '\n' + (request.postData() ?? '');
    if (text.includes(passphrase) || text.includes(passphraseB)) { secretInRequest = true; }
  };
  const safe = value => String(value).split(passphraseB).join('[redacted]').split(passphrase).join('[redacted]');
  const save = () => writeFileSync(output, JSON.stringify({
    checkedAt: new Date().toISOString(), origin,
    scope: 'Independent disposable browser vaults with one existing browser and at most one open page; no account/session server or chain acceptance',
    checks, failure, runtimeErrors,
  }, null, 2) + '\n');
  const record = check => { checks.push(check); save(); };

  try {
    await page.close();
    assert.equal(openPages().length, 0);
    contextB = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    contextB.setDefaultTimeout(15000);
    pageB = await contextB.newPage();
    pageB.on('pageerror', error => runtimeErrors.push(safe(error.message)));
    activePage = pageB;
    pageB.on('request', monitor);
    assert.equal(openPages().length, 1);
    await pageB.goto(origin + '/portfolio', { waitUntil: 'domcontentloaded' });
    await pageB.getByRole('link', { name: 'Get started', exact: true }).click();
    await pageB.getByRole('button', { name: /Create a manual-only portfolio/ }).click();
    await pageB.getByLabel('Passphrase', { exact: true }).fill(passphraseB);
    await pageB.getByLabel('Repeat passphrase', { exact: true }).fill(passphraseB);
    await pageB.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
    const shellB = pageB.locator('app-portfolio-shell');
    await shellB.locator('.selector strong').getByText('Manual portfolio', { exact: true }).waitFor();
    const portfolioBPath = new URL(pageB.url()).pathname;
    assert.notEqual(portfolioBPath, portfolioPath);
    await shellB.getByRole('link', { name: 'Manage portfolios', exact: true }).click();
    const manageB = pageB.locator('app-manage-portfolios');
    await manageB.getByRole('heading', { name: 'Manage portfolios', exact: true }).waitFor();
    assert.equal(await manageB.locator('li').count(), 1);
    await manageB.getByRole('button', { name: 'Rename', exact: true }).click();
    await manageB.locator('input[type=text]').fill(labelB);
    await manageB.getByRole('button', { name: 'Save', exact: true }).click();
    await manageB.getByText(labelB, { exact: true }).waitFor();
    const beforeB = await encryptedSnapshot(pageB);
    assert.equal(beforeB.kdf, 'argon2id');
    assert.ok(beforeB.count >= 2);
    assert.notEqual(beforeB.sha256, beforeA.sha256);
    record({ id: 'Q05-P13-INDEPENDENT-VAULT-B', status: 'PASS LOCAL',
      scope: 'Direct manual entry in a fresh context created its own real Argon2id vault and durable definition using actual controls',
      recordCount: beforeB.count, distinctEncryptedVault: true });

    phase = 'B-refuses-A-passphrase-and-definition';
    await pageB.goto(origin + portfolioPath, { waitUntil: 'domcontentloaded' });
    await shellB.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
    assert.equal(await pageB.locator('app-portfolio-overview').count(), 0);
    await shellB.getByRole('link', { name: 'Open portfolios', exact: true }).click();
    await pageB.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
    await pageB.getByLabel('Passphrase', { exact: true }).fill(passphrase);
    await pageB.getByRole('button', { name: 'Unlock', exact: true }).click();
    await pageB.getByRole('alert').getByText('That passphrase did not unlock the portfolio.', { exact: true }).waitFor();
    await pageB.getByLabel('Passphrase', { exact: true }).fill(passphraseB);
    await pageB.getByRole('button', { name: 'Unlock', exact: true }).click();
    await shellB.getByText('This portfolio is not available in this vault.', { exact: true }).waitFor();
    assert.equal(await pageB.locator('app-portfolio-overview').count(), 0);
    assert.equal(await shellB.locator('.selector strong').innerText(), 'Portfolio');
    await pageB.screenshot({ path: resolve(screenshots, 'portfolio-identity-B-refuses-A.png'), fullPage: true });
    await shellB.getByRole('link', { name: 'Manage portfolios', exact: true }).click();
    await manageB.getByRole('heading', { name: 'Manage portfolios', exact: true }).waitFor();
    assert.equal(await manageB.locator('li').count(), 1);
    await manageB.getByText(labelB, { exact: true }).waitFor();
    assert.equal(await manageB.getByText(originalName, { exact: true }).count(), 0);
    assert.equal(await manageB.locator('a').filter({ hasText: 'Open' }).getAttribute('href'), portfolioBPath);
    assert.equal(await manageB.locator(`a[href="${portfolioPath}"]`).count(), 0);
    record({ id: 'Q05-P13-B-REFUSES-A', status: 'PASS LOCAL',
      scope: 'A passphrase fails in B; B unlocks with its own passphrase, refuses A route ID and exposes only its own definition/actions' });
    assert.equal(secretInRequest, false, 'Vault passphrases must not appear in observed request URLs or bodies.');
    const secretInStorage = await pageB.evaluate(needles => {
      const text = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
      return needles.some(needle => text.includes(needle));
    }, [passphrase, passphraseB]);
    assert.equal(secretInStorage, false);
  } catch (error) {
    failure = { phase, error: safe(error instanceof Error ? error.message : error) };
    if (pageB && !pageB.isClosed()) {
      await pageB.screenshot({ path: resolve(screenshots, 'portfolio-identity-failure.png'), fullPage: true });
    }
    save();
  } finally {
    if (pageB && !pageB.isClosed()) { pageB.off('request', monitor); await pageB.close(); }
    if (contextB) { await contextB.close(); }
    try {
      phase = 'restore-original-A-page';
      assert.equal(openPages().length, 0);
      activePage = await contextA.newPage();
      activePage.setDefaultTimeout(15000);
      activePage.on('pageerror', error => runtimeErrors.push(safe(error.message)));
      activePage.on('request', monitor);
      assert.equal(openPages().length, 1);
      await activePage.goto(origin + portfolioPath, { waitUntil: 'domcontentloaded' });
      const shellA = activePage.locator('app-portfolio-shell');
      await shellA.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
      await shellA.getByRole('link', { name: 'Open portfolios', exact: true }).click();
      await activePage.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
      await activePage.getByLabel('Passphrase', { exact: true }).fill(passphrase);
      await activePage.getByRole('button', { name: 'Unlock', exact: true }).click();
      await shellA.locator('.selector strong').getByText(originalName, { exact: true }).waitFor();
      await activePage.locator('app-portfolio-overview').waitFor();
      assert.equal(new URL(activePage.url()).pathname, portfolioPath);
      const afterA = await encryptedSnapshot(activePage);
      assert.deepEqual(afterA, beforeA, 'B operations must not mutate any byte of A encrypted vault.');
      assert.equal(secretInRequest, false);
      record({ id: 'Q05-P13-A-UNCHANGED-AFTER-B', status: 'PASS LOCAL',
        scope: 'After closing B, A reopens in its original context with its own passphrase and requested ID; all encrypted bytes remain unchanged',
        beforeSha256: beforeA.sha256, afterSha256: afterA.sha256, recordCount: afterA.count,
        maximumOpenPages: 1, secretsInObservedRequests: false });
      await activePage.screenshot({ path: resolve(screenshots, 'portfolio-identity-A-restored.png'), fullPage: true });
    } catch (error) {
      const restoreFailure = { phase, error: safe(error instanceof Error ? error.message : error) };
      failure = failure ? { ...failure, restoreFailure } : restoreFailure;
      save();
    } finally { if (!activePage.isClosed()) { activePage.off('request', monitor); } }
  }
  save();
  return { activePage, passed: failure === null, localIdentityIsolationChecks: checks.length, failure };
}
