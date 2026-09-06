// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { NgZone } from '@angular/core';
import { PortfolioVaultService, VaultMeta } from './vault.service';
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
