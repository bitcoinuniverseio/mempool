import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const origin = 'http://localhost:4310';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Decode the downloaded test artifact independently of the Angular vault/store.
// This uses its declared KDF and native WebCrypto. Nothing decrypted is written.
async function inspectBackup(bytes, passphrase) {
  const backup = JSON.parse(bytes.toString('utf8'));
  assert.equal(backup.format, 'universe-portfolio');
  assert.equal(backup.formatVersion, 1);
  assert.equal(backup.kdf, 'argon2id');
  assert.ok(backup.records.length >= 2);
  assert.equal(digest(backup.records.map(record => record.ctB64).join('|')), backup.payloadChecksum);
  const { argon2id } = require('hash-wasm');
  const bits = await argon2id({
    password: passphrase, salt: Buffer.from(backup.saltB64, 'base64'),
    memorySize: backup.kdfParams.memoryKiB, iterations: backup.kdfParams.timeCost,
    parallelism: backup.kdfParams.parallelism, hashLength: 32, outputType: 'binary',
  });
  const key = await webcrypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  bits.fill(0);
  const records = [];
  for (const record of backup.records) {
    assert.equal('value' in record, false);
    const plaintext = new Uint8Array(await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(record.nonceB64, 'base64') },
      key, Buffer.from(record.ctB64, 'base64'),
    ));
    try { records.push({ id: record.id, type: record.type, value: JSON.parse(new TextDecoder().decode(plaintext)) }); }
    finally { plaintext.fill(0); }
  }
  return { records, recordCount: records.length, encryptedSha256: digest(bytes) };
}

/**
 * Requires the owner's one existing localhost page, an unlocked disposable
 * manual portfolio and its private passphrase. Does not create/clear a browser
 * context, start a server, fake API data or change production configuration.
 * On success the restored source portfolio is open under newPassphrase.
 */
export async function checkPortfolioLocalLifecycle(page, output, screenshots, { passphrase, newPassphrase, portfolioPath }) {
  // A long-lived single-page session may rerun a repaired helper. Bind the
  // current helper bytes instead of reusing Node's previous module instance.
  const atomicModule = new URL('./acceptance-vault-atomic-browser.mjs', import.meta.url);
  const atomicHash = digest(readFileSync(atomicModule));
  const { checkAtomicVaultUi } = await import(atomicModule.href + '?source=' + atomicHash);
  assert.equal(new URL(page.url()).origin, origin);
  assert.match(portfolioPath, /^\/portfolio\/p\/[^/]+\/overview$/);
  assert.equal(new URL(page.url()).pathname, portfolioPath);
  assert.equal(typeof passphrase, 'string');
  assert.equal(typeof newPassphrase, 'string');
  assert.ok(passphrase.length >= 8 && newPassphrase.length >= 8 && newPassphrase !== passphrase);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(screenshots, { recursive: true });
  const sourceId = portfolioPath.split('/')[3];
  const suffix = randomUUID().slice(0, 8);
  const renamed = 'Local acceptance ' + suffix;
  const copyName = renamed + ' - copy';
  const checks = [];
  const shell = page.locator('app-portfolio-shell');
  const manage = page.locator('app-manage-portfolios');
  const settings = page.locator('app-portfolio-settings');
  let phase = 'initial-manual-portfolio';
  let atomicOutput;
  const safe = value => String(value).split(newPassphrase).join('[redacted]').split(passphrase).join('[redacted]');
  const save = failure => writeFileSync(output, JSON.stringify({
    checkedAt: new Date().toISOString(), origin,
    scope: 'Actual disposable local vault/UI/download lifecycle; no chain data, durable shares or independent browser identity acceptance',
    portfolioPath, atomicEvidence: atomicOutput ?? null, checks, ...(failure ? { failure } : {}),
  }, null, 2) + '\n');
  const pass = (id, scope, evidence = {}) => { checks.push({ id, status: 'PASS LOCAL', scope, ...evidence }); save(); };
  const row = name => manage.locator('li').filter({ has: page.getByText(name, { exact: true }) });
  const openManage = async () => {
    await shell.getByRole('link', { name: 'Manage portfolios', exact: true }).click();
    await manage.getByRole('heading', { name: 'Manage portfolios', exact: true }).waitFor();
  };
  const openSettings = async () => {
    const host = await shell.count() ? shell : manage;
    await host.getByRole('link', { name: 'Settings', exact: true }).click();
    await settings.getByRole('heading', { name: 'Portfolio settings', exact: true }).waitFor();
  };
  const unlockRequested = async (path, phrase, expectedName) => {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await shell.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
    assert.equal(await page.locator('app-portfolio-overview').count(), 0);
    await shell.getByRole('link', { name: 'Open portfolios', exact: true }).click();
    await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
    await page.getByLabel('Passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    if (expectedName === null) {
      await shell.getByText('This portfolio is not available in this vault.', { exact: true }).waitFor();
      assert.equal(await page.locator('app-portfolio-overview').count(), 0);
    } else {
      await shell.locator('.selector strong').getByText(expectedName, { exact: true }).waitFor();
      await page.locator('app-portfolio-overview').waitFor();
    }
    assert.equal(new URL(page.url()).pathname, path);
  };
  const downloadBackup = async filename => {
    await settings.getByRole('button', { name: 'Export encrypted backup (.universe-portfolio)', exact: true }).click();
    const next = page.waitForEvent('download');
    await settings.getByRole('link', { name: 'Download backup', exact: true }).click();
    const download = await next;
    assert.match(download.suggestedFilename(), /\.universe-portfolio$/);
    const path = resolve(screenshots, filename);
    await download.saveAs(path);
    const bytes = readFileSync(path);
    return { path, bytes, decoded: await inspectBackup(bytes, newPassphrase) };
  };

  try {
    const originalName = await shell.locator('.selector strong').innerText();
    await page.locator('app-portfolio-overview').waitFor();
    phase = 'atomic-failure-regressions';
    await openSettings();
    atomicOutput = resolve(dirname(output), 'portfolio-lifecycle-atomic-' + suffix + '.json');
    const atomic = await checkAtomicVaultUi(page, atomicOutput, { passphrase });
    pass('Q05-P14-P16-ATOMIC', 'Actual IndexedDB failure/corruption checks through the built worker and settings UI', { localChecks: atomic.localVaultChecks });

    phase = 'change-passphrase';
    const passphraseDetails = settings.locator('details').first();
    if (!(await passphraseDetails.evaluate(element => element.open))) {
      await settings.getByText('Change passphrase', { exact: true }).click();
    }
    await settings.getByLabel('New passphrase', { exact: true }).fill(newPassphrase);
    await settings.getByRole('button', { name: 'Change', exact: true }).click();
    await settings.getByRole('status').filter({ hasText: 'Passphrase changed; every record was re-encrypted.' }).waitFor();
    await page.goto(origin + portfolioPath, { waitUntil: 'domcontentloaded' });
    await shell.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
    assert.equal(await page.locator('app-portfolio-overview').count(), 0);
    await shell.getByRole('link', { name: 'Open portfolios', exact: true }).click();
    await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
    await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page.getByRole('alert').getByText('That passphrase did not unlock the portfolio.', { exact: true }).waitFor();
    assert.equal(await page.locator('app-portfolio-overview').count(), 0);
    await page.getByLabel('Passphrase', { exact: true }).fill(newPassphrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await shell.locator('.selector strong').getByText(originalName, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, portfolioPath);
    pass('Q05-P14', 'Successful UI passphrase change; reload rejects old passphrase, accepts replacement and restores the exact requested portfolio');
    pass('Q05-P06-RELOAD', 'The existing UI-created empty manual portfolio survives encrypted-vault reload without manufacturing chain holdings');

    phase = 'explicit-lock';
    await shell.getByRole('button', { name: 'Lock', exact: true }).click();
    await shell.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
    assert.equal(await page.locator('app-portfolio-overview').count(), 0);
    await shell.getByRole('link', { name: 'Open portfolios', exact: true }).click();
    await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
    await page.getByLabel('Passphrase', { exact: true }).fill(newPassphrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await shell.locator('.selector strong').getByText(originalName, { exact: true }).waitFor();
    pass('Q05-P13-LOCK-UNLOCK', 'Actual Lock action removes child content and unlock restores the requested local record; independent identity isolation is checked separately');

    phase = 'rename';
    await openManage();
    await row(originalName).getByRole('button', { name: 'Rename', exact: true }).click();
    const editing = manage.locator('li').filter({ has: page.locator('input[type=text]') });
    await editing.locator('input[type=text]').fill(renamed);
    await editing.getByRole('button', { name: 'Save', exact: true }).click();
    await row(renamed).getByRole('button', { name: 'Rename', exact: true }).waitFor();
    await unlockRequested(portfolioPath, newPassphrase, renamed);
    pass('Q05-P08', 'Rename through Manage portfolios persists after a full reload and vault unlock');

    phase = 'duplicate-settings';
    await openManage();
    await row(renamed).getByRole('button', { name: 'Duplicate', exact: true }).click();
    await row(copyName).getByRole('link', { name: 'Open', exact: true }).waitFor();
    assert.match(await row(copyName).locator('.meta').innerText(), /^0 account\(s\)/);
    const copyPath = await row(copyName).getByRole('link', { name: 'Open', exact: true }).getAttribute('href');
    assert.match(copyPath, /^\/portfolio\/p\/[^/]+\/overview$/);
    const copyId = copyPath.split('/')[3];
    assert.notEqual(copyId, sourceId);
    await unlockRequested(copyPath, newPassphrase, copyName);
    await openManage();
    assert.match(await row(copyName).locator('.meta').innerText(), /^0 account\(s\)/);

    phase = 'archive-reload';
    await row(copyName).getByRole('button', { name: 'Archive', exact: true }).click();
    await row(copyName).getByRole('button', { name: 'Restore', exact: true }).waitFor();
    assert.equal(await row(copyName).getByRole('link', { name: 'Open', exact: true }).count(), 0);
    await unlockRequested(copyPath, newPassphrase, null);
    await openManage();
    await row(copyName).getByRole('button', { name: 'Restore', exact: true }).waitFor();
    assert.match(await row(copyName).locator('.meta').innerText(), /archived/);
    pass('Q05-P10', 'Archive persists after reload; the archived record is unavailable at its direct route and absent from open actions');

    phase = 'restore-archive';
    await row(copyName).getByRole('button', { name: 'Restore', exact: true }).click();
    await row(copyName).getByRole('link', { name: 'Open', exact: true }).waitFor();
    await unlockRequested(copyPath, newPassphrase, copyName);
    pass('Q05-P11', 'Restoring the archived record persists through reload and opens the same portfolio ID');

    phase = 'encrypted-backup-export';
    await openSettings();
    const exported = await downloadBackup('portfolio-local-lifecycle-' + suffix + '.universe-portfolio');
    const source = exported.decoded.records.find(record => record.type === 'portfolio' && record.id === sourceId)?.value;
    const copy = exported.decoded.records.find(record => record.type === 'portfolio' && record.id === copyId)?.value;
    assert.ok(source && copy, 'The actual downloaded backup must contain both persisted test portfolios.');
    assert.equal(source.name, renamed);
    assert.equal(copy.name, copyName);
    assert.deepEqual(copy.accounts, []);
    for (const field of ['groups', 'tags', 'quoteCurrency', 'privacy', 'snapshotPolicy']) {
      assert.deepEqual(copy[field], source[field], 'Duplicated setting ' + field);
    }
    assert.equal(copy.archived, false);
    pass('Q05-P09', 'Duplicate has its own persistent ID and zero accounts; independent decryption of the downloaded backup confirms all copied settings', { comparedFields: ['groups', 'tags', 'quoteCurrency', 'privacy', 'snapshotPolicy'] });
    pass('Q05-P15', 'Actual encrypted download passes its checksum and independent Argon2id/AES-GCM decoding; both saved definitions and restored archive state match', {
      artifact: exported.path, bytes: exported.bytes.length,
      sha256: exported.decoded.encryptedSha256, recordCount: exported.decoded.recordCount,
    });

    phase = 'delete-local-copy';
    await unlockRequested(portfolioPath, newPassphrase, renamed);
    await openManage();
    await row(copyName).getByRole('button', { name: 'Delete…', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete local data', exact: true }).click();
    await page.locator('app-portfolio-overview').waitFor();
    await unlockRequested(copyPath, newPassphrase, null);
    await openManage();
    assert.equal(await row(copyName).count(), 0);
    assert.equal(await row(renamed).count(), 1);
    pass('Q05-P12', 'Two-step deletion removes only the disposable copy; reload refuses its ID and the original definition remains available');

    phase = 'import-encrypted-backup';
    await openSettings();
    await settings.getByLabel('Import encrypted backup', { exact: true }).setInputFiles(exported.path);
    await settings.getByRole('status').filter({ hasText: 'Backup file loaded' }).waitFor();
    await settings.getByLabel('Backup passphrase', { exact: true }).fill(newPassphrase);
    await settings.getByRole('button', { name: 'Validate and import', exact: true }).click();
    await settings.getByRole('status').filter({ hasText: 'Imported ' + exported.decoded.recordCount + ' encrypted record(s)' }).waitFor();
    await unlockRequested(copyPath, newPassphrase, copyName);
    await openManage();
    assert.equal(await row(renamed).count(), 1);
    assert.equal(await row(copyName).count(), 1);
    assert.match(await row(copyName).locator('.meta').innerText(), /^0 account\(s\)/);
    await row(renamed).getByRole('link', { name: 'Open', exact: true }).click();
    await shell.locator('.selector strong').getByText(renamed, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, portfolioPath);
    pass('Q05-P16', 'Importing the actual encrypted backup restores the deleted copy and preserves the source; the restored route and records survive full reload/unlock', {
      importedRecordCount: exported.decoded.recordCount, inputArtifactSha256: exported.decoded.encryptedSha256,
    });
    await page.screenshot({ path: resolve(screenshots, 'portfolio-local-lifecycle-' + suffix + '.png'), fullPage: true });
    save();
    return { localPortfolioLifecycleChecks: checks.length, atomicChecks: atomic.localVaultChecks };
  } catch (error) {
    const failure = { phase, error: safe(error instanceof Error ? error.message : error) };
    save(failure);
    try { await page.screenshot({ path: resolve(screenshots, 'portfolio-local-lifecycle-failure-' + suffix + '.png'), fullPage: true }); }
    catch { /* The partial report remains available if the page itself failed. */ }
    throw new Error('Portfolio lifecycle failed at ' + phase + ': ' + failure.error);
  }
}
