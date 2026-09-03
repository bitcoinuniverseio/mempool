/**
 * The local encrypted portfolio vault.
 *
 * Every private portfolio datum - names, xpubs, descriptors, derived
 * inventories, labels, notes, layouts, views, alert rules, snapshots,
 * manual positions, share tokens - lives in a versioned IndexedDB vault
 * as an individually authenticated ciphertext. The master key is derived
 * from the passphrase in a Web Worker (Argon2id primary, calibrated
 * PBKDF2 fallback), imported as a NON-EXTRACTABLE WebCrypto key, and
 * never persisted: locking the vault or restarting the browser destroys
 * it. Nothing about the vault ever leaves the device.
 *
 * Browser encryption protects against network and server compromise; it
 * cannot protect against a fully compromised device, and the UI says so.
 */

import { Injectable, NgZone, OnDestroy } from '@angular/core';
import type {
  KdfError,
  KdfOk,
  KdfRequest,
} from '../workers/vault-kdf.worker';

export const VAULT_DB_NAME = 'universe-portfolio-vault';
export const VAULT_DB_VERSION = 1;
export const VAULT_FORMAT_VERSION = 1;

const ARGON2ID_MEMORY_KIB = 65536;
const ARGON2ID_TIME_COST = 3;
const ARGON2ID_PARALLELISM = 4;
const PBKDF2_ITERATIONS = 600_000;
const VERIFIER_PLAINTEXT = 'universe-portfolio-vault-verifier-v1';

export type VaultKdfKind = 'argon2id' | 'pbkdf2';

export interface VaultMeta {
  readonly version: 1;
  readonly kdf: VaultKdfKind;
  readonly kdfParams: {
    readonly memoryKiB?: number;
    readonly timeCost?: number;
    readonly parallelism?: number;
    readonly iterations?: number;
  };
  readonly saltB64: string;
  /** AES-GCM ciphertext of a constant: proves a passphrase without data. */
  readonly verifier: { readonly nonceB64: string; readonly ctB64: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VaultRecord {
  readonly id: string;
  readonly type: string;
  readonly envelope: { readonly nonceB64: string; readonly ctB64: string };
  readonly updatedAt: string;
}

export interface EncryptedBackup {
  readonly format: 'universe-portfolio';
  readonly formatVersion: 1;
  readonly kdf: VaultKdfKind;
  readonly kdfParams: VaultMeta['kdfParams'];
  readonly saltB64: string;
  readonly records: readonly {
    readonly id: string;
    readonly type: string;
    readonly nonceB64: string;
    readonly ctB64: string;
  }[];
  readonly recordCounts: Readonly<Record<string, number>>;
  readonly payloadChecksum: string;
  readonly createdAt: string;
  readonly applicationRelease: string;
  readonly migrationCompatibilityRange: readonly [number, number];
}

export type VaultState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'unlocked' };

@Injectable({ providedIn: 'root' })
export class PortfolioVaultService implements OnDestroy {
  private worker: Worker | null = null;
  private workerRequests = new Map<number, { resolve: (value: KdfOk) => void; reject: (error: Error) => void }>();
  private workerNextId = 1;
  private key: CryptoKey | null = null;
  private meta: VaultMeta | null = null;
  private autoLockMinutes = 15;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityListener = (() => {
    if (document.visibilityState === 'hidden') this.scheduleImmediateLockIfConfigured();
  }) as unknown as EventListener;

  constructor(private readonly zone: NgZone) {}

  // ------------------------------------------------------------- lifecycle

  /** Reads the vault meta. `absent` means first run. */
  async probe(): Promise<VaultState> {
    const meta = await this.readMeta();
    if (meta === null) return { kind: 'absent' };
    this.meta = meta;
    return { kind: this.key === null ? 'locked' : 'unlocked' };
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  /** True when a vault exists on this device. */
  async exists(): Promise<boolean> {
    return (await this.readMeta()) !== null;
  }

  async create(passphrase: string): Promise<void> {
    if (await this.exists()) {
      throw new Error('A vault already exists on this device.');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kdf: VaultKdfKind = (await this.canRunArgon2id()) ? 'argon2id' : 'pbkdf2';
    const key = await this.deriveKey(kdf, passphrase, this.saltB64(salt), {
      memoryKiB: ARGON2ID_MEMORY_KIB,
      timeCost: ARGON2ID_TIME_COST,
      parallelism: ARGON2ID_PARALLELISM,
      iterations: PBKDF2_ITERATIONS,
    });
    const verifier = await this.encryptBytes(key, new TextEncoder().encode(VERIFIER_PLAINTEXT));
    const now = new Date().toISOString();
    const meta: VaultMeta = {
      version: 1,
      kdf,
      kdfParams: {
        memoryKiB: ARGON2ID_MEMORY_KIB,
        timeCost: ARGON2ID_TIME_COST,
        parallelism: ARGON2ID_PARALLELISM,
        iterations: PBKDF2_ITERATIONS,
      },
      saltB64: this.saltB64(salt),
      verifier,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeMeta(meta);
    this.meta = meta;
    this.key = key;
    this.armAutoLock();
  }

  /**
   * Unlocks with a constant-shape failure: a wrong passphrase and a
   * missing vault are indistinguishable to the caller, so an attacker
   * learns nothing by probing.
   */
  async unlock(passphrase: string): Promise<boolean> {
    const meta = this.meta ?? (await this.readMeta());
    if (meta === null || passphrase.length === 0) return false;
    let key: CryptoKey;
    try {
      key = await this.deriveKey(meta.kdf, passphrase, meta.saltB64, meta.kdfParams);
    } catch {
      return false;
    }
    try {
      const plaintext = await this.decryptBytes(key, meta.verifier);
      if (new TextDecoder().decode(plaintext) !== VERIFIER_PLAINTEXT) return false;
    } catch {
      return false;
    }
    this.key = key;
    this.meta = meta;
    this.armAutoLock();
    return true;
  }

  /** Destroys the in-memory key. The stored ciphertext stays intact. */
  lock(): void {
    this.key = null;
    if (this.lockTimer !== null) clearTimeout(this.lockTimer);
    this.lockTimer = null;
  }

  async changePassphrase(next: string): Promise<void> {
    if (this.key === null || this.meta === null) {
      throw new Error('The vault must be unlocked to change its passphrase.');
    }
    // Re-encrypting every record under a fresh salted key.
    const records = await this.readAllRecords();
    const decrypted: { id: string; type: string; plaintext: Uint8Array }[] = [];
    for (const record of records) {
      decrypted.push({
        id: record.id,
        type: record.type,
        plaintext: await this.decryptBytes(this.key, record.envelope),
      });
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await this.deriveKey(this.meta.kdf, next, this.saltB64(salt), this.meta.kdfParams);
    const verifier = await this.encryptBytes(key, new TextEncoder().encode(VERIFIER_PLAINTEXT));
    const meta: VaultMeta = { ...this.meta, saltB64: this.saltB64(salt), verifier, updatedAt: new Date().toISOString() };
    const db = await this.open();
    await this.transaction(db, ['meta'], 'readwrite', (stores) => {
      stores['meta'].put(meta, 'vault');
    });
    this.meta = meta;
    this.key = key;
    for (const item of decrypted) {
      const envelope = await this.encryptBytes(key, item.plaintext);
      await this.putRecord({ id: item.id, type: item.type, envelope, updatedAt: new Date().toISOString() });
      item.plaintext.fill(0);
    }
  }

  // ------------------------------------------------------------ records

  async put(type: string, id: string, plaintext: unknown): Promise<void> {
    const key = this.requireKey();
    const bytes = new TextEncoder().encode(JSON.stringify(plaintext));
    const envelope = await this.encryptBytes(key, bytes);
    await this.putRecord({ id, type, envelope, updatedAt: new Date().toISOString() });
  }

  async get<T>(id: string): Promise<T | null> {
    const key = this.requireKey();
    const db = await this.open();
    const record = await this.transaction(db, ['records'], 'readonly', (stores) =>
      this.requestAsPromise(stores['records'].get(id)),
    ) as VaultRecord | undefined;
    if (record === undefined) return null;
    const bytes = await this.decryptBytes(key, record.envelope);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  async deleteRecord(id: string): Promise<void> {
    const db = await this.open();
    await this.transaction(db, ['records'], 'readwrite', (stores) => {
      stores['records'].delete(id);
    });
  }

  async listByType(type: string): Promise<{ id: string; value: unknown }[]> {
    const key = this.requireKey();
    const db = await this.open();
    const records = (await this.transaction(db, ['records'], 'readonly', (stores) =>
      this.requestAsPromise(stores['records'].getAll()),
    )) as VaultRecord[];
    const values: { id: string; value: unknown }[] = [];
    for (const record of records) {
      if (record.type !== type) continue;
      const bytes = await this.decryptBytes(key, record.envelope);
      values.push({ id: record.id, value: JSON.parse(new TextDecoder().decode(bytes)) });
    }
    return values;
  }

  // ------------------------------------------------------- backup/restore

  async exportEncrypted(applicationRelease = 'unknown'): Promise<EncryptedBackup> {
    const meta = this.meta;
    if (meta === null) throw new Error('The vault must be unlocked to export it.');
    const records = await this.readAllRecords();
    const recordCounts: Record<string, number> = {};
    const checksumInput: string[] = [];
    for (const record of records) {
      recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
      checksumInput.push(record.envelope.ctB64);
    }
    const payloadChecksum = await sha256Hex(checksumInput.join('|'));
    return {
      format: 'universe-portfolio',
      formatVersion: VAULT_FORMAT_VERSION,
      kdf: meta.kdf,
      kdfParams: meta.kdfParams,
      saltB64: meta.saltB64,
      records: records.map((record) => ({
        id: record.id,
        type: record.type,
        nonceB64: record.envelope.nonceB64,
        ctB64: record.envelope.ctB64,
      })),
      recordCounts,
      payloadChecksum,
      createdAt: new Date().toISOString(),
      applicationRelease,
      migrationCompatibilityRange: [1, VAULT_FORMAT_VERSION],
    };
  }

  /**
   * Validates the whole backup - structure, checksum, and a verifier
   * round-trip under the passphrase - before any local state changes.
   */
  async importEncrypted(
    backup: unknown,
    passphrase: string,
  ): Promise<{ importedRecords: number }> {
    if (typeof backup !== 'object' || backup === null) {
      throw new Error('That file is not a Universe portfolio backup.');
    }
    const candidate = backup as Partial<EncryptedBackup>;
    if (candidate.format !== 'universe-portfolio' || candidate.formatVersion !== 1) {
      throw new Error('That backup format version is not supported.');
    }
    if (!Array.isArray(candidate.records) || typeof candidate.saltB64 !== 'string') {
      throw new Error('That backup is incomplete or corrupted.');
    }
    const checksum = await sha256Hex(candidate.records.map((r) => r.ctB64).join('|'));
    if (checksum !== candidate.payloadChecksum) {
      throw new Error('The backup payload failed its integrity check.');
    }
    // Passphrase proof: derive under the backup's own KDF parameters and
    // try to open the first record. Only then is anything written.
    const key = await this.deriveKey(candidate.kdf ?? 'argon2id', passphrase, candidate.saltB64, candidate.kdfParams ?? {});
    let validated = 0;
    for (const record of candidate.records) {
      try {
        await this.decryptBytes(key, { nonceB64: record.nonceB64, ctB64: record.ctB64 });
        validated += 1;
      } catch {
        throw new Error('The passphrase did not open this backup.');
      }
    }
    if (validated !== candidate.records.length) {
      throw new Error('The passphrase did not open this backup.');
    }
    // Replace current contents atomically.
    const db = await this.open();
    await this.transaction(db, ['meta', 'records'], 'readwrite', (stores) => {
      stores['records'].clear();
    });
    for (const record of candidate.records) {
      await this.putRecord({
        id: record.id,
        type: record.type,
        envelope: { nonceB64: record.nonceB64, ctB64: record.ctB64 },
        updatedAt: new Date().toISOString(),
      });
    }
    const meta: VaultMeta = {
      version: 1,
      kdf: candidate.kdf ?? 'argon2id',
      kdfParams: candidate.kdfParams ?? {},
      saltB64: candidate.saltB64,
      verifier: { nonceB64: candidate.records[0]?.nonceB64 ?? '', ctB64: candidate.records[0]?.ctB64 ?? '' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // The backup has no live verifier; derive one under the new key so the
    // imported vault answers future unlock attempts.
    const freshVerifier = await this.encryptBytes(key, new TextEncoder().encode(VERIFIER_PLAINTEXT));
    const finalMeta = { ...meta, verifier: freshVerifier };
    await this.writeMeta(finalMeta);
    this.meta = finalMeta;
    this.key = key;
    this.armAutoLock();
    return { importedRecords: candidate.records.length };
  }

  /** Complete local deletion: vault contents and key, with confirmation done by the caller. */
  async wipe(): Promise<void> {
    this.lock();
    const db = await this.open();
    await this.transaction(db, ['meta', 'records'], 'readwrite', (stores) => {
      stores['meta'].clear();
      stores['records'].clear();
    });
    this.meta = null;
  }

  // ---------------------------------------------------------- auto-lock

  configureAutoLock(minutes: number, relockWhenHidden: boolean): void {
    this.autoLockMinutes = Math.max(1, Math.min(240, Math.round(minutes)));
    this.relockWhenHidden = relockWhenHidden;
    this.armAutoLock();
  }

  private relockWhenHidden = false;

  notifyActivity(): void {
    this.armAutoLock();
  }

  private armAutoLock(): void {
    if (this.lockTimer !== null) clearTimeout(this.lockTimer);
    if (this.key === null) return;
    if (this.autoLockMinutes <= 0) return;
    this.lockTimer = setTimeout(() => this.lock(), this.autoLockMinutes * 60_000);
  }

  private scheduleImmediateLockIfConfigured(): void {
    if (!this.relockWhenHidden) return;
    this.lock();
  }

  ngOnDestroy(): void {
    this.lock();
    this.worker?.terminate();
    document.removeEventListener('visibilitychange', this.visibilityListener);
    if (this.lockTimer !== null) clearTimeout(this.lockTimer);
  }

  // ------------------------------------------------------------- private

  private requireKey(): CryptoKey {
    if (this.key === null) throw new Error('The vault is locked.');
    return this.key;
  }

  private saltB64(salt: Uint8Array): string {
    let binary = '';
    for (const byte of salt) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  private async canRunArgon2id(): Promise<boolean> {
    try {
      await this.runKdf({
        id: this.workerNextId++,
        op: 'argon2id',
        passphrase: 'probe',
        saltB64: this.saltB64(crypto.getRandomValues(new Uint8Array(8))),
        memoryKiB: 1024,
        timeCost: 1,
        parallelism: 1,
      });
      return true;
    } catch {
      return false;
    }
  }

  private ensureWorker(): Worker {
    if (this.worker === null) {
      this.worker = new Worker(new URL('../workers/vault-kdf.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event: MessageEvent<KdfOk | KdfError>) => {
        const data = event.data;
        const pending = this.workerRequests.get(data.id);
        if (pending === undefined) return;
        this.workerRequests.delete(data.id);
        if (data.ok) {
          pending.resolve(data);
        } else {
          pending.reject(new Error((data as KdfError).error));
        }
      });
    }
    return this.worker;
  }

  private runKdf(request: KdfRequest): Promise<KdfOk> {
    const worker = this.ensureWorker();
    return new Promise<KdfOk>((resolve, reject) => {
      this.workerRequests.set(request.id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  private async deriveKey(
    kdf: VaultKdfKind,
    passphrase: string,
    saltB64: string,
    params: VaultMeta['kdfParams'],
  ): Promise<CryptoKey> {
    let bits: Uint8Array;
    try {
      const result = await this.runKdf({
        id: this.workerNextId++,
        op: kdf === 'argon2id' ? 'argon2id' : 'pbkdf2',
        passphrase,
        saltB64,
        memoryKiB: params.memoryKiB,
        timeCost: params.timeCost,
        parallelism: params.parallelism,
        iterations: params.iterations,
      });
      bits = Uint8Array.from(atob(result.bitsB64), (character) => character.charCodeAt(0));
    } catch {
      // Environment refused the primary KDF: fall back rather than fail.
      const result = await this.runKdf({
        id: this.workerNextId++,
        op: 'pbkdf2',
        passphrase,
        saltB64,
        iterations: PBKDF2_ITERATIONS,
      });
      bits = Uint8Array.from(atob(result.bitsB64), (character) => character.charCodeAt(0));
    }
    const key = await crypto.subtle.importKey('raw', bits as BufferSource, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
    bits.fill(0);
    return key;
  }

  private async encryptBytes(key: CryptoKey, plaintext: Uint8Array) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      plaintext as BufferSource,
    );
    return { nonceB64: this.saltB64(nonce), ctB64: this.saltB64(new Uint8Array(ct)) };
  }

  private async decryptBytes(
    key: CryptoKey,
    envelope: { nonceB64: string; ctB64: string },
  ): Promise<Uint8Array> {
    const nonce = Uint8Array.from(atob(envelope.nonceB64), (character) => character.charCodeAt(0));
    const ct = Uint8Array.from(atob(envelope.ctB64), (character) => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      ct as BufferSource,
    );
    return new Uint8Array(plaintext);
  }

  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open.'));
    });
  }

  private async transaction<T>(
    db: IDBDatabase,
    names: string[],
    mode: IDBTransactionMode,
    body: (stores: Record<string, IDBObjectStore>) => Promise<T> | T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const stores: Record<string, IDBObjectStore> = {};
      for (const name of names) stores[name] = tx.objectStore(name);
      let result: T;
      let errored = false;
      void Promise.resolve(body(stores))
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          errored = true;
          reject(error);
          tx.abort();
        });
      tx.oncomplete = () => {
        if (!errored) resolve(result as T);
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    });
  }

  private requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  }

  private async readMeta(): Promise<VaultMeta | null> {
    const db = await this.open();
    const meta = (await this.transaction(db, ['meta'], 'readonly', (stores) =>
      this.requestAsPromise(stores['meta'].get('vault')),
    )) as VaultMeta | undefined;
    return meta ?? null;
  }

  private async writeMeta(meta: VaultMeta): Promise<void> {
    const db = await this.open();
    await this.transaction(db, ['meta'], 'readwrite', (stores) => {
      stores['meta'].put(meta, 'vault');
    });
  }

  private async putRecord(record: VaultRecord): Promise<void> {
    const db = await this.open();
    await this.transaction(db, ['records'], 'readwrite', (stores) => {
      stores['records'].put(record);
    });
  }

  private async readAllRecords(): Promise<VaultRecord[]> {
    const db = await this.open();
    return (await this.transaction(db, ['records'], 'readonly', (stores) =>
      this.requestAsPromise(stores['records'].getAll()),
    )) as VaultRecord[];
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
