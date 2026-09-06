// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { NgZone } from '@angular/core';
import { PortfolioVaultService, VaultMeta, VaultRecord } from './vault.service';
import type { KdfRequest, KdfOk } from '../workers/vault-kdf.worker';

class WorkerFixture {
  static instances: WorkerFixture[] = [];
  listeners = new Map<string, (event: unknown) => void>();
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { WorkerFixture.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.set(type, listener); }
  emit(type: string, event = {}): void { this.listeners.get(type)?.(event); }
}

interface VaultInternals {
  runKdf(request: KdfRequest): Promise<KdfOk>;
  readMeta(): Promise<VaultMeta | null>;
  writeMeta(meta: VaultMeta): Promise<void>;
  canRunArgon2id(): Promise<boolean>;
  open(): Promise<IDBDatabase>;
  encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<VaultRecord['envelope']>;
}

describe('vault worker failure recovery and KDF identity', () => {
  const request: KdfRequest = { id: 1, op: 'argon2id', passphrase: 'test-owned-passphrase', saltB64: 'dGVzdC1zYWx0' };
  let service: PortfolioVaultService;
  let internals: VaultInternals;
  beforeEach(() => {
    WorkerFixture.instances = [];
    vi.stubGlobal('Worker', WorkerFixture);
    vi.stubGlobal('crypto', webcrypto);
    service = new PortfolioVaultService({} as NgZone);
    internals = service as unknown as VaultInternals;
  });
  afterEach(() => { service.ngOnDestroy(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(['error', 'messageerror'])('rejects pending derivation on %s and starts a fresh worker for retry', async (event) => {
    const failed = expect(internals.runKdf(request)).rejects.toThrow('worker');
    const first = WorkerFixture.instances[0];
    first.emit(event);
    await failed;
    expect(first.terminate).toHaveBeenCalledOnce();
    const retry = internals.runKdf({ ...request, id: 2 });
    const next = WorkerFixture.instances[1];
    next.emit('message', { data: { id: 2, ok: true, bitsB64: 'test-bits' } });
    await expect(retry).resolves.toEqual({ id: 2, ok: true, bitsB64: 'test-bits' });
  });

  it('rejects an unresponsive worker after the bounded timeout', async () => {
    vi.useFakeTimers();
    const failed = expect(internals.runKdf(request)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(WorkerFixture.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('cancels the timeout after a successful correlated reply', async () => {
    vi.useFakeTimers();
    const result = internals.runKdf(request);
    const worker = WorkerFixture.instances[0];
    worker.emit('message', { data: { id: 99, ok: true, bitsB64: 'other-request' } });
    worker.emit('message', { data: { id: 1, ok: true, bitsB64: 'test-bits' } });
    await expect(result).resolves.toMatchObject({ id: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('does not persist Argon2 metadata for a different fallback key when full derivation fails', async () => {
    vi.spyOn(internals, 'readMeta').mockResolvedValue(null);
    vi.spyOn(internals, 'canRunArgon2id').mockResolvedValue(true);
    const derive = vi.spyOn(internals, 'runKdf').mockRejectedValue(new Error('argon unavailable'));
    const write = vi.spyOn(internals, 'writeMeta');
    await expect(service.create('test-owned-passphrase')).rejects.toThrow('argon unavailable');
    expect(derive).toHaveBeenCalledOnce();
    expect(derive.mock.calls[0][0].op).toBe('argon2id');
    expect(write).not.toHaveBeenCalled();
    expect(service.isUnlocked()).toBe(false);
  });

  it('records PBKDF2 explicitly when the capability probe selects that fallback before creation', async () => {
    vi.spyOn(internals, 'readMeta').mockResolvedValue(null);
    vi.spyOn(internals, 'canRunArgon2id').mockResolvedValue(false);
    const derive = vi.spyOn(internals, 'runKdf').mockResolvedValue({ id: 1, ok: true, bitsB64: Buffer.alloc(32, 7).toString('base64') });
    const write = vi.spyOn(internals, 'writeMeta').mockResolvedValue();
    await service.create('test-owned-passphrase');
    expect(derive.mock.calls[0][0].op).toBe('pbkdf2');
    expect(write.mock.calls[0][0].kdf).toBe('pbkdf2');
    expect(service.isUnlocked()).toBe(true);
  });
});

// Controlled storage models commit/abort boundaries while the service's actual
// transaction helper and WebCrypto run. The browser acceptance helper separately
// repeats quota/abort failures against real IndexedDB and the built KDF worker.
describe('vault replacement persistence and malformed backups', () => {
  let service: PortfolioVaultService;
  let rows: Map<string, unknown>;
  let metadata: Map<string, unknown>;
  let failRecordWrite: boolean;
  let onRecordWrite: (() => void) | null;
  let internals: VaultInternals;

  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    rows = new Map(); metadata = new Map(); failRecordWrite = false; onRecordWrite = null;
    service = new PortfolioVaultService({} as NgZone);
    internals = service as unknown as VaultInternals;
    vi.spyOn(internals, 'canRunArgon2id').mockResolvedValue(false);
    vi.spyOn(internals, 'runKdf').mockImplementation(async request => ({
      id: request.id, ok: true,
      bitsB64: createHash('sha256').update(request.passphrase).update(request.saltB64).digest('base64'),
    }));
    vi.spyOn(internals, 'open').mockImplementation(async () => ({
      transaction: (_names: string[], mode: IDBTransactionMode) => {
        const pendingRows = new Map(rows);
        const pendingMeta = new Map(metadata);
        let aborted = false;
        let recordWrites = 0;
        const tx = {
          error: null,
          oncomplete: (() => undefined) as () => void,
          onabort: (() => undefined) as () => void,
          onerror: (() => undefined) as () => void,
          abort: () => { aborted = true; queueMicrotask(() => tx.onabort()); },
          objectStore: (name: string) => {
            const values = name === 'records' ? pendingRows : pendingMeta;
            const request = (result: unknown) => {
              const pending = { result, onsuccess: (() => undefined) as () => void };
              queueMicrotask(() => pending.onsuccess());
              return pending;
            };
            return {
              get: (id: string) => request(values.get(id)),
              getAll: () => request([...values.values()]),
              clear: () => { values.clear(); },
              delete: (id: string) => { values.delete(id); },
              put: (record: { id: string }, id?: string) => {
                if (name === 'records' && ++recordWrites === 2 && failRecordWrite) {
                  throw new DOMException('controlled quota failure', 'QuotaExceededError');
                }
                values.set(id ?? record.id, structuredClone(record));
                if (name === 'records') { onRecordWrite?.(); }
              },
            };
          },
        };
        setTimeout(() => {
          if (aborted) return;
          if (mode === 'readwrite') { rows = pendingRows; metadata = pendingMeta; }
          tx.oncomplete();
        }, 0);
        return tx;
      },
    } as unknown as IDBDatabase));
    await service.create('original-test-passphrase');
    await service.put('portfolio', 'portfolio-A', { name: 'Private A' });
    await service.put('preferences', 'preferences', { activePortfolioId: 'portfolio-A' });
  });
  afterEach(() => { service.ngOnDestroy(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function pauseNextKdf() {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.mocked(internals.runKdf).mockImplementationOnce(async request => {
      entered();
      await blocked;
      return { id: request.id, ok: true, bitsB64: createHash('sha256').update(request.passphrase).update(request.saltB64).digest('base64') };
    });
    return { release, started };
  }

  it('aborts synchronous record-write failures without changing the prior key, metadata or records', async () => {
    const before = JSON.stringify([[...metadata], [...rows]]);
    failRecordWrite = true;
    await expect(service.changePassphrase('replacement-test-passphrase')).rejects.toThrow('controlled quota failure');
    expect(JSON.stringify([[...metadata], [...rows]])).toBe(before);
    expect(await service.get('portfolio-A')).toEqual({ name: 'Private A' });
    service.lock();
    expect(await service.unlock('replacement-test-passphrase')).toBe(false);
    expect(await service.unlock('original-test-passphrase')).toBe(true);
  });

  it('keeps the entire previous vault when an imported replacement fails during a record write', async () => {
    const backup = await service.exportEncrypted();
    await service.put('portfolio', 'portfolio-B', { name: 'Preserve B' });
    const before = JSON.stringify([[...metadata], [...rows]]);
    failRecordWrite = true;
    await expect(service.importEncrypted(backup, 'original-test-passphrase')).rejects.toThrow('controlled quota failure');
    expect(JSON.stringify([[...metadata], [...rows]])).toBe(before);
    expect(await service.get('portfolio-B')).toEqual({ name: 'Preserve B' });
  });

  it('commits the new passphrase and all records together and reopens them under the replacement key', async () => {
    await service.changePassphrase('replacement-test-passphrase');
    service.lock();
    expect(await service.unlock('original-test-passphrase')).toBe(false);
    expect(await service.unlock('replacement-test-passphrase')).toBe(true);
    expect(await service.get('portfolio-A')).toEqual({ name: 'Private A' });
    expect(await service.get('preferences')).toEqual({ activePortfolioId: 'portfolio-A' });
  });

  it('validates and replaces a backup, including a verifier that survives lock and reopen', async () => {
    const backup = await service.exportEncrypted();
    await service.put('portfolio', 'portfolio-B', { name: 'Replace B' });
    await expect(service.importEncrypted(backup, 'original-test-passphrase')).resolves.toEqual({ importedRecords: 2 });
    service.lock();
    expect(await service.unlock('original-test-passphrase')).toBe(true);
    expect(await service.get('portfolio-A')).toEqual({ name: 'Private A' });
    expect(await service.get('portfolio-B')).toBeNull();
  });

  it.each(['empty', 'duplicate', 'unknown-kdf', 'missing-record-id'])('rejects %s backup structure before changing the vault', async variant => {
    const backup = await service.exportEncrypted();
    const changed = JSON.parse(JSON.stringify(backup));
    if (variant === 'empty') changed.records = [];
    if (variant === 'duplicate') changed.records.push(changed.records[0]);
    if (variant === 'unknown-kdf') changed.kdf = 'unsupported';
    if (variant === 'missing-record-id') delete changed.records[0].id;
    changed.payloadChecksum = createHash('sha256').update(changed.records.map((record: { ctB64: string }) => record.ctB64).join('|')).digest('hex');
    const before = JSON.stringify([[...metadata], [...rows]]);
    await expect(service.importEncrypted(changed, 'original-test-passphrase')).rejects.toThrow('incomplete or corrupted');
    expect(JSON.stringify([[...metadata], [...rows]])).toBe(before);
  });

  it('serializes insertion, same-ID update, deletion and export after a paused rotation', async () => {
    const gate = pauseNextKdf();
    const rotation = service.changePassphrase('replacement-test-passphrase');
    await gate.started;
    const insertion = service.put('portfolio', 'concurrent', { name: 'Inserted during rotation' });
    const update = service.put('portfolio', 'portfolio-A', { name: 'Updated during rotation' });
    const deletion = service.deleteRecord('preferences');
    const exported = service.exportEncrypted();
    expect(rows.has('concurrent')).toBe(false);
    gate.release();
    await Promise.all([rotation, insertion, update, deletion]);
    const backup = await exported;
    service.lock();
    expect(await service.unlock('replacement-test-passphrase')).toBe(true);
    expect(await service.get('concurrent')).toEqual({ name: 'Inserted during rotation' });
    expect(await service.get('portfolio-A')).toEqual({ name: 'Updated during rotation' });
    expect(await service.get('preferences')).toBeNull();
    await service.importEncrypted(backup, 'replacement-test-passphrase');
    expect(await service.get('concurrent')).toEqual({ name: 'Inserted during rotation' });
    expect(await service.get('portfolio-A')).toEqual({ name: 'Updated during rotation' });
  });

  it('drains a put already encrypting with the old key before rotation snapshots records', async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const originalEncrypt = internals.encryptBytes.bind(internals);
    vi.spyOn(internals, 'encryptBytes').mockImplementationOnce(async (key, bytes) => {
      entered(); await blocked;
      return originalEncrypt(key, bytes);
    });
    const writing = service.put('portfolio', 'in-flight', { name: 'Started before rotation' });
    await started;
    const rotation = service.changePassphrase('replacement-test-passphrase');
    release();
    await Promise.all([writing, rotation]);
    service.lock();
    expect(await service.unlock('replacement-test-passphrase')).toBe(true);
    expect(await service.get('in-flight')).toEqual({ name: 'Started before rotation' });
  });

  it('queues an update until an imported replacement has committed its matching key', async () => {
    const backup = await service.exportEncrypted();
    await service.changePassphrase('replacement-test-passphrase');
    const gate = pauseNextKdf();
    const importing = service.importEncrypted(backup, 'original-test-passphrase');
    await gate.started;
    const writing = service.put('portfolio', 'portfolio-A', { name: 'Updated after import' });
    gate.release();
    await Promise.all([importing, writing]);
    service.lock();
    expect(await service.unlock('original-test-passphrase')).toBe(true);
    expect(await service.get('portfolio-A')).toEqual({ name: 'Updated after import' });
  });

  it.each(['rotation', 'import', 'unlock', 'create'])('lock remains authoritative while %s derivation is pending', async operation => {
    const backup = await service.exportEncrypted();
    if (operation === 'unlock') { service.lock(); }
    if (operation === 'create') { await service.wipe(); }
    const before = JSON.stringify([[...metadata], [...rows]]);
    const gate = pauseNextKdf();
    const pending = operation === 'rotation' ? service.changePassphrase('replacement-test-passphrase') :
      operation === 'import' ? service.importEncrypted(backup, 'original-test-passphrase') :
      operation === 'unlock' ? service.unlock('original-test-passphrase') : service.create('replacement-test-passphrase');
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await gate.started;
    service.lock();
    gate.release();
    const result = await settled;
    if (operation === 'unlock') { expect(result).toEqual({ value: false }); }
    else { expect(result).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining('locked') }) }); }
    expect(service.isUnlocked()).toBe(false);
    expect(JSON.stringify([[...metadata], [...rows]])).toBe(before);
    if (operation !== 'create') {
      expect(await service.unlock('original-test-passphrase')).toBe(true);
      expect(await service.get('portfolio-A')).toEqual({ name: 'Private A' });
    }
  });

  it('discards writes queued before lock instead of applying them after a later unlock', async () => {
    const gate = pauseNextKdf();
    const rotating = service.changePassphrase('replacement-test-passphrase').catch(error => error);
    await gate.started;
    const writing = service.put('portfolio', 'stale', { name: 'Must not be written' }).catch(error => error);
    service.lock();
    gate.release();
    expect(await rotating).toBeInstanceOf(Error);
    expect(await writing).toBeInstanceOf(Error);
    expect(await service.unlock('original-test-passphrase')).toBe(true);
    expect(await service.get('stale')).toBeNull();
  });

  it('aborts an active write transaction when lock occurs after records have been queued', async () => {
    const before = JSON.stringify([[...metadata], [...rows]]);
    onRecordWrite = () => { onRecordWrite = null; queueMicrotask(() => service.lock()); };
    await expect(service.changePassphrase('replacement-test-passphrase')).rejects.toThrow('aborted');
    expect(service.isUnlocked()).toBe(false);
    expect(JSON.stringify([[...metadata], [...rows]])).toBe(before);
    expect(await service.unlock('original-test-passphrase')).toBe(true);
    expect(await service.get('portfolio-A')).toEqual({ name: 'Private A' });
  });
});
