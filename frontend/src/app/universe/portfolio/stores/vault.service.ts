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
import { StateService } from '@app/services/state.service';
import type { KdfError, KdfOk, KdfRequest } from '../workers/vault-kdf.worker';

export const VAULT_DB_NAME = 'universe-portfolio-vault';
export const VAULT_DB_VERSION = 1;
export const VAULT_FORMAT_VERSION = 2;

const ARGON2ID_MEMORY_KIB = 65536;
const ARGON2ID_TIME_COST = 3;
const ARGON2ID_PARALLELISM = 4;
const PBKDF2_ITERATIONS = 600_000;
const ARGON2ID_MEMORY_KIB_MIN = 8_192;
const ARGON2ID_MEMORY_KIB_MAX = 131_072;
const ARGON2ID_TIME_COST_MIN = 1;
const ARGON2ID_TIME_COST_MAX = 10;
const ARGON2ID_PARALLELISM_MIN = 1;
const ARGON2ID_PARALLELISM_MAX = 8;
const PBKDF2_ITERATIONS_MIN = 100_000;
const PBKDF2_ITERATIONS_MAX = 2_000_000;
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
  readonly formatVersion: 1 | 2;
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
  private workerRequests = new Map<
    number,
    { resolve: (value: KdfOk) => void; reject: (error: Error) => void }
  >();
  private workerNextId = 1;
  private key: CryptoKey | null = null;
  private meta: VaultMeta | null = null;
  private autoLockMinutes = 15;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityListener = (() => {
    if (document.visibilityState === 'hidden')
      this.scheduleImmediateLockIfConfigured();
  }) as unknown as EventListener;

  constructor(
    private readonly zone: NgZone,
    private readonly stateService: StateService
  ) {}

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
    const kdf: VaultKdfKind = (await this.canRunArgon2id())
      ? 'argon2id'
      : 'pbkdf2';
    const key = await this.deriveKey(kdf, passphrase, this.saltB64(salt), {
      memoryKiB: ARGON2ID_MEMORY_KIB,
      timeCost: ARGON2ID_TIME_COST,
      parallelism: ARGON2ID_PARALLELISM,
      iterations: PBKDF2_ITERATIONS,
    });
    const verifier = await this.encryptVerifier(key);
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
      key = await this.deriveKey(
        meta.kdf,
        passphrase,
        meta.saltB64,
        meta.kdfParams
      );
    } catch {
      return false;
    }
    let plaintext: Uint8Array | null = null;
    try {
      plaintext = await this.decryptBytes(key, meta.verifier);
      if (new TextDecoder().decode(plaintext) !== VERIFIER_PLAINTEXT)
        return false;
    } catch {
      return false;
    } finally {
      plaintext?.fill(0);
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
    const previousMeta = this.meta;
    // Prepare every replacement before opening the write transaction. A
    // failed derivation or encryption therefore leaves the existing vault
    // untouched and readable with its existing key.
    const records = await this.readAllRecords();
    const decrypted: { id: string; type: string; plaintext: Uint8Array }[] = [];
    try {
      for (const record of records) {
        decrypted.push({
          id: record.id,
          type: record.type,
          plaintext: await this.decryptBytes(this.key, record.envelope),
        });
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await this.deriveKey(
        previousMeta.kdf,
        next,
        this.saltB64(salt),
        previousMeta.kdfParams
      );
      const verifier = await this.encryptVerifier(key);
      const now = new Date().toISOString();
      const meta: VaultMeta = {
        ...previousMeta,
        saltB64: this.saltB64(salt),
        verifier,
        updatedAt: now,
      };
      const replacements: VaultRecord[] = [];
      for (const item of decrypted) {
        replacements.push({
          id: item.id,
          type: item.type,
          envelope: await this.encryptBytes(key, item.plaintext),
          updatedAt: now,
        });
      }
      const db = await this.open();
      await this.transaction(db, ['meta', 'records'], 'readwrite', (stores) => {
        stores['meta'].put(meta, 'vault');
        for (const record of replacements) {
          stores['records'].put(record);
        }
      });
      this.meta = meta;
      this.key = key;
      this.armAutoLock();
    } finally {
      for (const item of decrypted) {
        item.plaintext.fill(0);
      }
    }
  }

  // ------------------------------------------------------------ records

  async put(type: string, id: string, plaintext: unknown): Promise<void> {
    const key = this.requireKey();
    const bytes = new TextEncoder().encode(JSON.stringify(plaintext));
    try {
      const envelope = await this.encryptBytes(key, bytes);
      await this.putRecord({
        id,
        type,
        envelope,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      bytes.fill(0);
    }
  }

  async get<T>(id: string): Promise<T | null> {
    const key = this.requireKey();
    const db = await this.open();
    const record = (await this.transaction(
      db,
      ['records'],
      'readonly',
      (stores) => this.requestAsPromise(stores['records'].get(id))
    )) as VaultRecord | undefined;
    if (record === undefined) return null;
    const bytes = await this.decryptBytes(key, record.envelope);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } finally {
      bytes.fill(0);
    }
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
    const records = (await this.transaction(
      db,
      ['records'],
      'readonly',
      (stores) => this.requestAsPromise(stores['records'].getAll())
    )) as VaultRecord[];
    const values: { id: string; value: unknown }[] = [];
    for (const record of records) {
      if (record.type !== type) continue;
      const bytes = await this.decryptBytes(key, record.envelope);
      try {
        values.push({
          id: record.id,
          value: JSON.parse(new TextDecoder().decode(bytes)),
        });
      } finally {
        bytes.fill(0);
      }
    }
    return values;
  }

  // ------------------------------------------------------- backup/restore

  async exportEncrypted(): Promise<EncryptedBackup> {
    const meta = this.meta;
    if (meta === null)
      throw new Error('The vault must be unlocked to export it.');
    const records = await this.readAllRecords();
    const recordCounts: Record<string, number> = {};
    for (const record of records) {
      recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
    }
    const exportRecords = records.map((record) => ({
      id: record.id,
      type: record.type,
      nonceB64: record.envelope.nonceB64,
      ctB64: record.envelope.ctB64,
    }));
    const payloadChecksum = await backupPayloadChecksum(
      exportRecords,
      VAULT_FORMAT_VERSION
    );
    return {
      format: 'universe-portfolio',
      formatVersion: VAULT_FORMAT_VERSION,
      kdf: meta.kdf,
      kdfParams: meta.kdfParams,
      saltB64: meta.saltB64,
      records: exportRecords,
      recordCounts,
      payloadChecksum,
      createdAt: new Date().toISOString(),
      applicationRelease: this.stateService.env.GIT_COMMIT_HASH,
      migrationCompatibilityRange: [1, VAULT_FORMAT_VERSION],
    };
  }

  /**
   * Validates the whole backup - structure, checksum, and a verifier
   * round-trip under the passphrase - before any local state changes.
   */
  async importEncrypted(
    backup: unknown,
    passphrase: string
  ): Promise<{ importedRecords: number }> {
    if (typeof backup !== 'object' || backup === null) {
      throw new Error('That file is not a Universe portfolio backup.');
    }
    const candidate = backup as Partial<EncryptedBackup>;
    if (
      candidate.format !== 'universe-portfolio' ||
      (candidate.formatVersion !== 1 && candidate.formatVersion !== 2)
    ) {
      throw new Error('That backup format version is not supported.');
    }
    if (
      !Array.isArray(candidate.records) ||
      !candidate.records.every(isEncryptedBackupRecord) ||
      typeof candidate.saltB64 !== 'string' ||
      typeof candidate.payloadChecksum !== 'string'
    ) {
      throw new Error('That backup is incomplete or corrupted.');
    }
    const checksum = await backupPayloadChecksum(
      candidate.records,
      candidate.formatVersion
    );
    if (checksum !== candidate.payloadChecksum) {
      throw new Error('The backup payload failed its integrity check.');
    }
    const { kdf, kdfParams } = this.normalizeImportedKdf(
      candidate.kdf,
      candidate.kdfParams
    );
    // Passphrase proof: derive under bounded backup KDF parameters and try
    // to open every record. Only then is anything written.
    const key = await this.deriveKey(
      kdf,
      passphrase,
      candidate.saltB64,
      kdfParams
    );
    let validated = 0;
    for (const record of candidate.records) {
      let plaintext: Uint8Array | null = null;
      try {
        plaintext = await this.decryptBytes(key, {
          nonceB64: record.nonceB64,
          ctB64: record.ctB64,
        });
        validated += 1;
      } catch {
        throw new Error('The passphrase did not open this backup.');
      } finally {
        plaintext?.fill(0);
      }
    }
    if (validated !== candidate.records.length) {
      throw new Error('The passphrase did not open this backup.');
    }
    const now = new Date().toISOString();
    const meta: VaultMeta = {
      version: 1,
      kdf,
      kdfParams,
      saltB64: candidate.saltB64,
      verifier: {
        nonceB64: candidate.records[0]?.nonceB64 ?? '',
        ctB64: candidate.records[0]?.ctB64 ?? '',
      },
      createdAt: now,
      updatedAt: now,
    };
    // The backup has no live verifier; derive one under the new key so the
    // imported vault answers future unlock attempts.
    const freshVerifier = await this.encryptVerifier(key);
    const finalMeta = { ...meta, verifier: freshVerifier };
    const records: VaultRecord[] = candidate.records.map((record) => ({
      id: record.id,
      type: record.type,
      envelope: { nonceB64: record.nonceB64, ctB64: record.ctB64 },
      updatedAt: now,
    }));
    const db = await this.open();
    await this.transaction(db, ['meta', 'records'], 'readwrite', (stores) => {
      stores['records'].clear();
      for (const record of records) {
        stores['records'].put(record);
      }
      stores['meta'].put(finalMeta, 'vault');
    });
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
    this.lockTimer = setTimeout(
      () => this.lock(),
      this.autoLockMinutes * 60_000
    );
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

  private normalizeImportedKdf(
    inputKdf: unknown,
    inputParams: unknown
  ): { kdf: VaultKdfKind; kdfParams: VaultMeta['kdfParams'] } {
    const kdf = inputKdf ?? 'argon2id';
    if (kdf !== 'argon2id' && kdf !== 'pbkdf2') {
      throw new Error('That backup uses an unsupported key derivation method.');
    }
    if (
      inputParams !== undefined &&
      inputParams !== null &&
      (typeof inputParams !== 'object' || Array.isArray(inputParams))
    ) {
      throw new Error('That backup has unsupported key derivation parameters.');
    }
    const params = (inputParams ?? {}) as Record<string, unknown>;
    const memoryKiB = boundedKdfInteger(
      params['memoryKiB'],
      ARGON2ID_MEMORY_KIB_MIN,
      ARGON2ID_MEMORY_KIB_MAX
    );
    const timeCost = boundedKdfInteger(
      params['timeCost'],
      ARGON2ID_TIME_COST_MIN,
      ARGON2ID_TIME_COST_MAX
    );
    const parallelism = boundedKdfInteger(
      params['parallelism'],
      ARGON2ID_PARALLELISM_MIN,
      ARGON2ID_PARALLELISM_MAX
    );
    const iterations = boundedKdfInteger(
      params['iterations'],
      PBKDF2_ITERATIONS_MIN,
      PBKDF2_ITERATIONS_MAX
    );
    const kdfParams: {
      memoryKiB?: number;
      timeCost?: number;
      parallelism?: number;
      iterations?: number;
    } = {};
    if (memoryKiB !== undefined) {
      kdfParams.memoryKiB = memoryKiB;
    }
    if (timeCost !== undefined) {
      kdfParams.timeCost = timeCost;
    }
    if (parallelism !== undefined) {
      kdfParams.parallelism = parallelism;
    }
    if (iterations !== undefined) {
      kdfParams.iterations = iterations;
    }
    if (kdf === 'argon2id') {
      kdfParams.memoryKiB ??= ARGON2ID_MEMORY_KIB;
      kdfParams.timeCost ??= ARGON2ID_TIME_COST;
      kdfParams.parallelism ??= ARGON2ID_PARALLELISM;
    } else {
      kdfParams.iterations ??= PBKDF2_ITERATIONS;
    }
    return { kdf, kdfParams };
  }

  private async encryptVerifier(
    key: CryptoKey
  ): Promise<{ nonceB64: string; ctB64: string }> {
    const plaintext = new TextEncoder().encode(VERIFIER_PLAINTEXT);
    try {
      return await this.encryptBytes(key, plaintext);
    } finally {
      plaintext.fill(0);
    }
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
      this.worker = new Worker(
        new URL('../workers/vault-kdf.worker', import.meta.url),
        {
          type: 'module',
        }
      );
      this.worker.addEventListener(
        'message',
        (event: MessageEvent<KdfOk | KdfError>) => {
          const data = event.data;
          const pending = this.workerRequests.get(data.id);
          if (pending === undefined) return;
          this.workerRequests.delete(data.id);
          if (data.ok) {
            pending.resolve(data);
          } else {
            pending.reject(new Error((data as KdfError).error));
          }
        }
      );
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
    params: VaultMeta['kdfParams']
  ): Promise<CryptoKey> {
    let bits: Uint8Array | null = null;
    try {
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
        bits = Uint8Array.from(atob(result.bitsB64), (character) =>
          character.charCodeAt(0)
        );
      } catch {
        // Environment refused the primary KDF: fall back rather than fail.
        const result = await this.runKdf({
          id: this.workerNextId++,
          op: 'pbkdf2',
          passphrase,
          saltB64,
          iterations: PBKDF2_ITERATIONS,
        });
        bits = Uint8Array.from(atob(result.bitsB64), (character) =>
          character.charCodeAt(0)
        );
      }
      return await crypto.subtle.importKey(
        'raw',
        bits as BufferSource,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
      );
    } finally {
      bits?.fill(0);
    }
  }

  private async encryptBytes(key: CryptoKey, plaintext: Uint8Array) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      plaintext as BufferSource
    );
    return {
      nonceB64: this.saltB64(nonce),
      ctB64: this.saltB64(new Uint8Array(ct)),
    };
  }

  private async decryptBytes(
    key: CryptoKey,
    envelope: { nonceB64: string; ctB64: string }
  ): Promise<Uint8Array> {
    const nonce = Uint8Array.from(atob(envelope.nonceB64), (character) =>
      character.charCodeAt(0)
    );
    const ct = Uint8Array.from(atob(envelope.ctB64), (character) =>
      character.charCodeAt(0)
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      ct as BufferSource
    );
    return new Uint8Array(plaintext);
  }

  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('records'))
          db.createObjectStore('records', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB refused to open.'));
    });
  }

  private async transaction<T>(
    db: IDBDatabase,
    names: string[],
    mode: IDBTransactionMode,
    body: (stores: Record<string, IDBObjectStore>) => Promise<T> | T
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const stores: Record<string, IDBObjectStore> = {};
      for (const name of names) stores[name] = tx.objectStore(name);
      let result: T;
      let errored = false;
      let bodyResult: Promise<T> | T;
      try {
        bodyResult = body(stores);
      } catch (error) {
        errored = true;
        try {
          tx.abort();
        } catch {
          // The transaction already failed; keep the original write error.
        }
        reject(error);
        return;
      }
      void Promise.resolve(bodyResult)
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          errored = true;
          try {
            tx.abort();
          } catch {
            // The transaction already failed; keep the original body error.
          }
          reject(error);
        });
      tx.oncomplete = () => {
        if (!errored) resolve(result as T);
      };
      tx.onerror = () =>
        reject(tx.error ?? new Error('IndexedDB transaction failed.'));
      tx.onabort = () =>
        reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    });
  }

  private requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  }

  private async readMeta(): Promise<VaultMeta | null> {
    const db = await this.open();
    const meta = (await this.transaction(db, ['meta'], 'readonly', (stores) =>
      this.requestAsPromise(stores['meta'].get('vault'))
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
      this.requestAsPromise(stores['records'].getAll())
    )) as VaultRecord[];
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } finally {
    bytes.fill(0);
  }
}

function boundedKdfInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new Error('That backup has unsupported key derivation parameters.');
  }
  return value as number;
}

type EncryptedBackupRecord = EncryptedBackup['records'][number];

function isEncryptedBackupRecord(
  value: unknown
): value is EncryptedBackupRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['type'] === 'string' &&
    typeof record['nonceB64'] === 'string' &&
    typeof record['ctB64'] === 'string'
  );
}

async function backupPayloadChecksum(
  records: readonly EncryptedBackupRecord[],
  formatVersion: 1 | 2
): Promise<string> {
  if (formatVersion === 1) {
    // Version 1 covered ciphertext only. Keep reading it so existing backups
    // remain importable while every new export uses the stronger version 2.
    return sha256Hex(records.map((record) => record.ctB64).join('|'));
  }
  return sha256Hex(
    JSON.stringify(
      records.map((record) => [
        record.id,
        record.type,
        record.nonceB64,
        record.ctB64,
      ])
    )
  );
}
