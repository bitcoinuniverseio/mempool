import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// The integration owner supplies its one existing page, on portfolio settings,
// with an unlocked disposable vault. Secrets remain in this call's closure.
// No browser/server is launched and no backend response is intercepted.
export async function checkAtomicVaultUi(page, output, { passphrase }) {
  assert.equal(new URL(page.url()).origin, 'http://localhost:4310');
  assert.equal(new URL(page.url()).pathname, '/portfolio/settings');
  assert.equal(typeof passphrase, 'string');
  const checks = [];
  let phase = 'vault-snapshot';
  let lastFault = null;
  mkdirSync(dirname(output), { recursive: true });
  const save = failure => writeFileSync(output, JSON.stringify({
    checkedAt: new Date().toISOString(), origin: 'http://localhost:4310',
    scope: 'Disposable local vault only; no chain or durable share acceptance', checks,
    ...(failure ? { failure } : {}),
  }, null, 2) + '\n');
  const record = check => { checks.push(check); save(); };
  try {
  const settings = page.locator('app-portfolio-settings');
  await settings.getByRole('heading', { name: 'Portfolio settings', exact: true }).waitFor();
  const snapshot = () => page.evaluate(async () => {
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
  const original = await snapshot();
  assert.ok(original.count >= 2, 'The disposable vault needs at least two records for interrupted-write checks.');
  assert.equal(original.kdf, 'argon2id');

  await settings.getByRole('button', { name: 'Export encrypted backup (.universe-portfolio)', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await settings.getByRole('link', { name: 'Download backup', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  assert.ok(stream, 'The actual backup download must be readable.');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backupBytes = Buffer.concat(chunks);
  const backup = JSON.parse(backupBytes.toString('utf8'));
  assert.equal(backup.format, 'universe-portfolio');
  assert.equal(backup.records.length, original.count);
  assert.ok(backup.records.every(record => typeof record.ctB64 === 'string' && !('value' in record)));
  record({ id: 'P15-ATOMIC-BACKUP-ARTIFACT', status: 'PASS',
    scope: 'Actual encrypted backup download inspected; no private plaintext retained',
    bytes: backupBytes.length, sha256: createHash('sha256').update(backupBytes).digest('hex'), recordCount: backup.records.length });

  const loadBackup = async bytes => {
    await settings.getByLabel('Import encrypted backup', { exact: true }).setInputFiles({
      name: 'disposable-vault.universe-portfolio', mimeType: 'application/json', buffer: bytes,
    });
  };
  const loaded = () => settings.getByRole('status').filter({ hasText: 'Backup file loaded' }).waitFor();
  await settings.getByLabel('Backup passphrase', { exact: true }).fill(passphrase);
  if (!(await settings.locator('details').first().evaluate(element => element.open))) {
    await settings.getByText('Change passphrase', { exact: true }).click();
  }
  await settings.getByLabel('New passphrase', { exact: true }).fill(passphrase + '-replacement');

  for (const operation of ['passphrase', 'import']) {
    for (const failure of ['quota', 'abort']) {
      phase = operation + '-' + failure;
      lastFault = null;
      if (operation === 'import') { await loadBackup(backupBytes); await loaded(); }
      const before = await snapshot();
      const faultId = randomUUID();
      await page.evaluate(({ kind, id }) => {
        const originalPut = IDBObjectStore.prototype.put;
        const fault = { id, count: 0, fired: false, transactionStarted: false, transactionOutcome: 'pending' };
        let observedTransaction = null;
        window.__acceptanceVaultFault = fault;
        window.__acceptanceRestoreVaultPut = () => { IDBObjectStore.prototype.put = originalPut; };
        IDBObjectStore.prototype.put = function (...args) {
          if (this.transaction.db.name === 'universe-portfolio-vault' && this.name === 'records') {
            if (observedTransaction === null) {
              observedTransaction = this.transaction;
              fault.transactionStarted = true;
              observedTransaction.addEventListener('abort', () => { fault.transactionOutcome = 'aborted'; }, { once: true });
              observedTransaction.addEventListener('complete', () => { fault.transactionOutcome = 'committed'; }, { once: true });
            }
            if (this.transaction !== observedTransaction) return originalPut.apply(this, args);
            fault.count++;
            if (fault.count === 2) {
              fault.fired = true;
              if (kind === 'quota') throw new DOMException('Controlled disposable-vault quota fault', 'QuotaExceededError');
              const result = originalPut.apply(this, args);
              const transaction = this.transaction;
              queueMicrotask(() => transaction.abort());
              return result;
            }
          }
          return originalPut.apply(this, args);
        };
      }, { kind: failure, id: faultId });
      try {
        await settings.getByRole('button', { name: operation === 'passphrase' ? 'Change' : 'Validate and import', exact: true }).click();
        // The prior case can leave identical status text visible during a new
        // asynchronous KDF. Wait for this case's actual write/abort event first.
        const deadline = Date.now() + 45_000;
        while (true) {
          const done = await page.evaluate(id => {
            const fault = window.__acceptanceVaultFault;
            return fault?.id === id && fault.transactionStarted && fault.transactionOutcome !== 'pending';
          }, faultId);
          if (done) break;
          if (Date.now() > deadline) throw new Error('Timeout waiting for fault transaction');
          await page.waitForTimeout(50);
        }
        const fault = await page.evaluate(() => ({ ...window.__acceptanceVaultFault }));
        lastFault = fault;
        assert.equal(fault.fired, true, operation + ' must reach the injected write fault');
        assert.equal(fault.transactionOutcome, 'aborted', operation + ' must finish aborting the observed transaction');
        const message = settings.getByRole('status');
        if (operation === 'passphrase') {
          await message.filter({ hasText: 'The passphrase could not be changed.' }).waitFor();
        } else {
          await message.filter({ hasText: /Controlled disposable-vault quota fault|IndexedDB transaction (aborted|failed)/ }).waitFor();
        }
        assert.deepEqual(await snapshot(), before, operation + ' must preserve every stored byte after ' + failure);
        record({ id: `P${operation === 'passphrase' ? '14' : '16'}-ATOMIC-${failure.toUpperCase()}`, status: 'PASS',
          scope: 'Actual built UI/KDF and IndexedDB; controlled failure on second record write; complete prior encrypted vault preserved',
          observedFault: fault,
          recordCount: before.count, beforeSha256: before.sha256, afterSha256: before.sha256 });
      } finally {
        lastFault = await page.evaluate(() => window.__acceptanceVaultFault ? { ...window.__acceptanceVaultFault } : null).catch(() => lastFault);
        await page.evaluate(() => {
          window.__acceptanceRestoreVaultPut?.();
          delete window.__acceptanceRestoreVaultPut;
          delete window.__acceptanceVaultFault;
        });
      }
    }
  }

  // A rejected replacement selection must never reuse a prior valid file.
  phase = 'malformed-backup-selection';
  await loadBackup(backupBytes); await loaded();
  await loadBackup(Buffer.from('{broken'));
  await settings.getByRole('status').filter({ hasText: 'That file is not a valid backup.' }).waitFor();
  const beforeMalformed = await snapshot();
  await settings.getByRole('button', { name: 'Validate and import', exact: true }).click();
  assert.deepEqual(await snapshot(), beforeMalformed);
  assert.match(await settings.getByRole('status').innerText(), /not a valid backup/);
  record({ id: 'P16-REJECT-REPLACEMENT-SELECTION', status: 'PASS', scope: 'Actual file input rejects malformed JSON and cannot import its previously selected backup' });

  phase = 'corrupt-backup-checksum';
  const corrupt = { ...backup, payloadChecksum: '0'.repeat(64) };
  await loadBackup(Buffer.from(JSON.stringify(corrupt))); await loaded();
  const beforeCorrupt = await snapshot();
  await settings.getByRole('button', { name: 'Validate and import', exact: true }).click();
  await settings.getByRole('status').filter({ hasText: 'The backup payload failed its integrity check.' }).waitFor();
  assert.deepEqual(await snapshot(), beforeCorrupt);
  record({ id: 'P16-REJECT-CORRUPT-BACKUP', status: 'PASS', scope: 'Actual file input and vault checksum rejection preserve all prior encrypted bytes' });

  save();
  return { localVaultChecks: checks.length };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error)
      .split(passphrase + '-replacement').join('[redacted]').split(passphrase).join('[redacted]');
    save({ phase, error: message, observedFault: lastFault });
    throw new Error('Atomic vault check failed at ' + phase + ': ' + message);
  }
}
