import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const origin = 'http://localhost:4310';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const timeout = 15000;

// Public output of the onboarding.component.spec.ts seed-1 account fixture.
// Only its public key is present here; no mnemonic/seed/private key enters UI.
const xpub = 'xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A';
const address = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const segwit = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const descriptor = `wpkh(${xpub}/0/*)#dedltr9v`;
const sources = [
  'frontend/src/app/universe/portfolio/onboarding/onboarding.component.spec.ts',
  'frontend/src/app/universe/portfolio/shared/derivation.spec.ts',
  'frontend/src/app/universe/portfolio/workspace/workspace-import.spec.ts',
];

/** Same public payload, with the declared mainnet SLIP-132 version. */
function publicVersion(version) {
  const { createBase58check } = require('@scure/base');
  const codec = createBase58check(bytes => createHash('sha256').update(bytes).digest());
  const payload = codec.decode(xpub);
  assert.equal(payload.length, 78);
  new DataView(payload.buffer, payload.byteOffset, payload.byteLength).setUint32(0, version);
  return codec.encode(payload);
}

export function portfolioOnboardingFixtures() {
  const publicAccount = (value, name, kind = 'address') => ({ kind, chain: 'bitcoin', network: 'mainnet', name, addresses: [value] });
  const listAccounts = [publicAccount(address, 'Legacy fixture', 'addresses'), publicAccount(segwit, 'SegWit fixture', 'addresses')];
  const rows = listAccounts.map(account => ({ address: account.addresses[0], chain: account.chain, network: account.network, label: account.name, group: '' }));
  const watch = (id, key, script) => ({ id, choice: 'Add a Bitcoin watch-only wallet', material: key,
    accounts: [{ kind: 'xpub', chain: 'bitcoin', network: 'mainnet', name: 'Watch-only wallet',
      xpub: { key, script, account: 0, gapLimit: 20, branches: ['external'] } }] });
  return [
    { id: 'P01', choice: 'Create from one address', material: address,
      accounts: [publicAccount(address, address.slice(0, 12) + '…')] },
    watch('P02-XPUB', xpub, 'p2pkh'),
    watch('P02-YPUB', publicVersion(0x049d7cb2), 'p2sh-p2wpkh'),
    watch('P02-ZPUB', publicVersion(0x04b24746), 'p2wpkh'),
    { id: 'P03', choice: 'Add a Bitcoin watch-only wallet', material: descriptor,
      accounts: [{ kind: 'descriptor', chain: 'bitcoin', network: 'mainnet', name: 'Descriptor wallet', descriptor: { value: descriptor, gapLimit: 20 } }] },
    { id: 'P04', choice: 'Import an address list', material: 'address,chain,network,label,group\n' + rows.map(row => [row.address, row.chain, row.network, row.label, row.group].join(',')).join('\n'), accounts: listAccounts },
    { id: 'P05', choice: 'Import an address list', material: JSON.stringify(rows, null, 2), accounts: listAccounts },
  ];
}

/** Compare decrypted definitions only; never infer chain state from a local record. */
export function assertOnboardingDefinition(portfolio, expected, name) {
  assert.ok(portfolio, expected.id + ' missing from the actual downloaded backup');
  assert.equal(portfolio.name, name);
  assert.equal(portfolio.archived, false);
  assert.equal(portfolio.accounts.length, expected.accounts.length);
  assert.equal(new Set(portfolio.accounts.map(account => account.id)).size, expected.accounts.length);
  for (const [index, account] of portfolio.accounts.entries()) {
    assert.equal(typeof account.id, 'string');
    assert.ok(account.id.length > 0);
    const wanted = expected.accounts[index];
    for (const [field, value] of Object.entries(wanted)) assert.deepEqual(account[field], value, expected.id + ' persisted ' + field);
    for (const field of ['addresses', 'xpub', 'descriptor']) {
      if (!(field in wanted)) assert.equal(account[field], undefined, expected.id + ' unexpected ' + field);
    }
  }
  return { accountCount: portfolio.accounts.length, kinds: portfolio.accounts.map(account => account.kind),
    contexts: portfolio.accounts.map(account => account.chain + ':' + account.network),
    definitionsSha256: digest(JSON.stringify(expected.accounts)) };
}

// Native WebCrypto and the backup's declared KDF, independently of Angular.
// Decrypted data stays in this call and is never written to evidence files.
async function inspectBackup(bytes, passphrase) {
  const backup = JSON.parse(bytes.toString('utf8'));
  assert.equal(backup.format, 'universe-portfolio');
  assert.equal(backup.formatVersion, 1);
  assert.equal(backup.kdf, 'argon2id');
  assert.ok(Array.isArray(backup.records) && backup.records.length >= 2);
  assert.equal(digest(backup.records.map(record => record.ctB64).join('|')), backup.payloadChecksum);
  const { argon2id } = require('hash-wasm');
  const bits = await argon2id({ password: passphrase, salt: Buffer.from(backup.saltB64, 'base64'),
    memorySize: backup.kdfParams.memoryKiB, iterations: backup.kdfParams.timeCost,
    parallelism: backup.kdfParams.parallelism, hashLength: 32, outputType: 'binary' });
  let key;
  try { key = await webcrypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']); }
  finally { bits.fill(0); }
  const records = [];
  for (const record of backup.records) {
    assert.equal('value' in record, false);
    const plaintext = new Uint8Array(await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(record.nonceB64, 'base64') }, key, Buffer.from(record.ctB64, 'base64')));
    try { records.push({ id: record.id, type: record.type, value: JSON.parse(new TextDecoder().decode(plaintext)) }); }
    finally { plaintext.fill(0); }
  }
  return records;
}

async function poll(read, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise(done => setTimeout(done, 75));
  }
  throw new Error('Timed out waiting for ' + description);
}

/**
 * Caller owns the one existing localhost page and unlocked disposable vault.
 * Creates seven public fixture definitions, retains them for review, restores
 * the original portfolio. No browser/server, API interception or direct store
 * mutation. Passphrase stays in the closure and actual password input only.
 */
export async function checkPortfolioOnboarding(page, output, screenshots, { passphrase, portfolioPath }) {
  assert.equal(new URL(page.url()).origin, origin);
  assert.match(portfolioPath, /^\/portfolio\/p\/[^/]+\/overview$/);
  assert.equal(new URL(page.url()).pathname, portfolioPath);
  assert.equal(typeof passphrase, 'string');
  assert.ok(passphrase.length >= 8);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(screenshots, { recursive: true });
  const suffix = randomUUID().slice(0, 8);
  const shell = page.locator('app-portfolio-shell');
  const manage = page.locator('app-manage-portfolios');
  const onboarding = page.locator('app-onboarding');
  const report = { schemaVersion: 'universe-portfolio-onboarding-local-v1', origin, portfolioPath,
    startedAt: new Date().toISOString(), realNetworkE2ePasses: 0, fixtureSources: sources,
    scope: 'Actual UI entry, encrypted local persistence, full reload/unlock and independently decoded downloaded definitions. CSV/JSON are pasted into the offered list input.',
    authorityReadback: { status: 'BLOCKED', reason: 'Local definitions do not establish address discovery, chain balances, holdings, transaction history or authority consistency.' },
    checks: [] };
  const safe = error => String(error instanceof Error ? error.message : error).split(passphrase).join('[redacted]');
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  const openManage = async () => {
    await shell.getByRole('link', { name: 'Manage portfolios', exact: true }).click({ timeout });
    await manage.getByRole('heading', { name: 'Manage portfolios', exact: true }).waitFor({ timeout });
  };
  const rowForPath = path => manage.locator('li').filter({ has: page.locator('a[href="' + path + '"]') });
  const reloadUnlock = async (path, name) => {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout });
    await shell.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor({ timeout });
    assert.equal(await page.locator('app-portfolio-overview').count(), 0);
    await shell.getByRole('link', { name: 'Open portfolios', exact: true }).click({ timeout });
    await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor({ timeout });
    await page.getByLabel('Passphrase', { exact: true }).fill(passphrase, { timeout });
    await page.getByRole('button', { name: 'Unlock', exact: true }).click({ timeout });
    await shell.locator('.selector strong').getByText(name, { exact: true }).waitFor({ timeout: 45000 });
    await page.locator('app-portfolio-overview').waitFor({ timeout });
    assert.equal(new URL(page.url()).pathname, path);
  };
  const fixtures = portfolioOnboardingFixtures();
  await page.locator('app-portfolio-overview').waitFor({ timeout });
  const originalName = await shell.locator('.selector strong').innerText();
  try {
    for (const fixture of fixtures) {
      const row = { id: fixture.id + '-LOCAL-INPUT', status: 'FAIL', name: 'Local ' + fixture.id + ' ' + suffix,
        inputSha256: digest(fixture.material), authorityStatus: 'BLOCKED' };
      report.checks.push(row);
      try {
        await openManage();
        await manage.getByRole('link', { name: 'New portfolio', exact: true }).click({ timeout });
        await onboarding.getByRole('button', { name: new RegExp('^' + fixture.choice) }).click({ timeout });
        await onboarding.locator('textarea').waitFor({ timeout });
        assert.equal(await onboarding.locator('input[type=password]').count(), 0, 'Use the current unlocked vault only');
        await onboarding.locator('textarea').fill(fixture.material, { timeout });
        const submit = onboarding.getByRole('button', { name: 'Save portfolio', exact: true });
        await poll(async () => await submit.isEnabled(), fixture.id + ' locally validated input');
        row.validation = await onboarding.locator('.ok').innerText();
        row.inputScreenshot = resolve(screenshots, 'portfolio-' + fixture.id.toLowerCase() + '-input-' + suffix + '.png');
        await page.screenshot({ path: row.inputScreenshot, fullPage: true });
        await submit.click({ timeout });
        row.path = await poll(() => {
          const path = new URL(page.url()).pathname;
          return /^\/portfolio\/p\/[^/]+\/overview$/.test(path) ? path : null;
        }, fixture.id + ' saved portfolio route');
        row.portfolioId = row.path.split('/')[3];
        assert.notEqual(row.path, portfolioPath);
        assert.equal(report.checks.filter(check => check.path === row.path).length, 1, 'Every created portfolio needs its own identity');
        await page.locator('app-portfolio-overview').waitFor({ timeout });
        await openManage();
        const entry = rowForPath(row.path);
        assert.match(await entry.locator('.meta').innerText(), new RegExp('^' + fixture.accounts.length + ' account\\(s\\)'));
        await entry.getByRole('button', { name: 'Rename', exact: true }).click({ timeout });
        await entry.locator('input[type=text]').fill(row.name, { timeout });
        await entry.getByRole('button', { name: 'Save', exact: true }).click({ timeout });
        await entry.getByText(row.name, { exact: true }).waitFor({ timeout });
        await reloadUnlock(row.path, row.name);
        row.reloadUnlocked = true;
        await openManage();
        row.accountCountText = (await rowForPath(row.path).locator('.meta').innerText()).trim();
        assert.match(row.accountCountText, new RegExp('^' + fixture.accounts.length + ' account\\(s\\)'));
        await rowForPath(row.path).getByRole('link', { name: 'Open', exact: true }).click({ timeout });
        await shell.locator('.selector strong').getByText(row.name, { exact: true }).waitFor({ timeout });
        row.reloadScreenshot = resolve(screenshots, 'portfolio-' + fixture.id.toLowerCase() + '-reload-' + suffix + '.png');
        await page.screenshot({ path: row.reloadScreenshot, fullPage: true });
        row.status = 'AWAITING BACKUP CHECK';
      } catch (error) {
        row.error = safe(error);
        row.rejection = await onboarding.getByRole('alert').allTextContents().catch(() => []);
        try { await reloadUnlock(portfolioPath, originalName); }
        catch (recoveryError) { row.recoveryError = safe(recoveryError); throw recoveryError; }
      }
      save();
    }
    await shell.getByRole('link', { name: 'Settings', exact: true }).click({ timeout });
    const settings = page.locator('app-portfolio-settings');
    await settings.getByRole('button', { name: 'Export encrypted backup (.universe-portfolio)', exact: true }).click({ timeout });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout }),
      settings.getByRole('link', { name: 'Download backup', exact: true }).click({ timeout }),
    ]);
    assert.match(download.suggestedFilename(), /\.universe-portfolio$/);
    const stream = await download.createReadStream();
    assert.ok(stream, 'Actual backup download must be readable');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const records = await inspectBackup(bytes, passphrase);
    report.encryptedBackup = { bytes: bytes.length, sha256: digest(bytes), recordCount: records.length,
      plaintextWritten: false, source: 'Actual settings download after every successful reload/unlock' };
    for (const [index, row] of report.checks.entries()) {
      if (row.status !== 'AWAITING BACKUP CHECK') continue;
      try {
        const recordsForId = records.filter(record => record.type === 'portfolio' && record.id === row.portfolioId);
        assert.equal(recordsForId.length, 1);
        row.persistence = assertOnboardingDefinition(recordsForId[0]?.value, fixtures[index], row.name);
        row.status = 'PASS LOCAL';
      } catch (error) { row.status = 'FAIL'; row.error = safe(error); }
    }
    assert.equal(report.checks.filter(row => row.status === 'PASS LOCAL').length, fixtures.length, 'Local input/persistence checks failed; see ' + output);
  } catch (error) {
    report.failure = safe(error);
  } finally {
    try { await reloadUnlock(portfolioPath, originalName); report.restoredOriginalPortfolio = true; }
    catch (error) { report.restorationError = safe(error); }
    report.completedAt = new Date().toISOString();
    save();
  }
  assert(!report.failure && !report.restorationError, 'Portfolio onboarding check failed; see ' + output);
  return report;
}
