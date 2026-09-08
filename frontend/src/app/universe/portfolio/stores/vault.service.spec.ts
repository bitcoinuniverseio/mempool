import { NgZone } from '@angular/core';
import { StateService } from '@app/services/state.service';
import {
  EncryptedBackup,
  PortfolioVaultService,
  VaultMeta,
  VaultRecord,
} from './vault.service';

const zone = {} as NgZone;
const VaultConstructor = PortfolioVaultService as unknown as new (
  zone: NgZone,
  state: StateService
) => PortfolioVaultService;

interface VaultInternals {
  meta: VaultMeta | null;
  key: CryptoKey | null;
  open(): Promise<IDBDatabase>;
  deriveKey(...args: unknown[]): Promise<CryptoKey>;
  decryptBytes(
    key: CryptoKey,
    envelope: { nonceB64: string; ctB64: string }
  ): Promise<Uint8Array>;
  encryptBytes(
    key: CryptoKey,
    plaintext: Uint8Array
  ): Promise<{ nonceB64: string; ctB64: string }>;
  putRecord(record: VaultRecord): Promise<void>;
  readAllRecords(): Promise<VaultRecord[]>;
  transaction(...args: unknown[]): Promise<unknown>;
}

interface FakeTransaction extends Pick<
  IDBTransaction,
  'abort' | 'objectStore'
> {
  error: DOMException | null;
  oncomplete: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onabort: ((event: Event) => unknown) | null;
}

function vaultMeta(saltB64 = 'old-salt'): VaultMeta {
  return {
    version: 1,
    kdf: 'pbkdf2',
    kdfParams: { iterations: 600_000 },
    saltB64,
    verifier: {
      nonceB64: 'old-verifier-nonce',
      ctB64: 'old-verifier-ciphertext',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function vaultRecord(id: string, type = 'portfolio'): VaultRecord {
  return {
    id,
    type,
    envelope: { nonceB64: `nonce-${id}`, ctB64: `ciphertext-${id}` },
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function encryptedBackup(
  ids: string[],
  formatVersion: 1 | 2 = 2
): Promise<EncryptedBackup> {
  const records = ids.map((id) => ({
    id,
    type: 'portfolio',
    nonceB64: `nonce-${id}`,
    ctB64: `ciphertext-${id}`,
  }));
  return {
    format: 'universe-portfolio',
    formatVersion,
    kdf: 'pbkdf2',
    kdfParams: { iterations: 600_000 },
    saltB64: 'imported-salt',
    records,
    recordCounts: { portfolio: records.length },
    payloadChecksum: await backupChecksum(records, formatVersion),
    createdAt: '2026-09-03T00:00:00.000Z',
    applicationRelease: 'backup-release',
    migrationCompatibilityRange: [1, 2],
  };
}

async function backupChecksum(
  records: readonly {
    readonly id: string;
    readonly type: string;
    readonly nonceB64: string;
    readonly ctB64: string;
  }[],
  formatVersion: 1 | 2
): Promise<string> {
  if (formatVersion === 1) {
    return sha256(records.map((record) => record.ctB64).join('|'));
  }
  return sha256(
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

function service(
  applicationRelease = 'frontend-release-sha'
): PortfolioVaultService {
  return new VaultConstructor(zone, {
    env: { GIT_COMMIT_HASH: applicationRelease },
  } as StateService);
}

function fakeDatabase(
  initialMeta: VaultMeta,
  initialRecords: VaultRecord[],
  failure?: { readonly id: string; readonly kind: 'abort' | 'throw' }
): {
  readonly db: IDBDatabase;
  readonly transaction: ReturnType<typeof vi.fn>;
  readonly snapshot: () => {
    readonly meta: VaultMeta | undefined;
    readonly records: VaultRecord[];
  };
} {
  const committedMeta = new Map<string, VaultMeta>([['vault', initialMeta]]);
  const committedRecords = new Map(
    initialRecords.map((record) => [record.id, record])
  );

  const transaction = vi.fn(
    (names: string[], mode: IDBTransactionMode): IDBTransaction => {
      expect(mode).toBe('readwrite');
      const stagedMeta = new Map(committedMeta);
      const stagedRecords = new Map(committedRecords);
      let aborted = false;
      let requestFailure: DOMException | null = null;

      const tx: FakeTransaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort: () => {
          aborted = true;
          tx.error ??= new DOMException('Transaction aborted.', 'AbortError');
        },
        objectStore: (name: string) => {
          if (!names.includes(name)) {
            throw new DOMException(
              `Store ${name} is outside this transaction.`,
              'NotFoundError'
            );
          }
          return {
            clear: () => {
              if (name === 'meta') {
                stagedMeta.clear();
              }
              if (name === 'records') {
                stagedRecords.clear();
              }
              return {} as IDBRequest<undefined>;
            },
            put: (value: VaultMeta | VaultRecord, key?: IDBValidKey) => {
              if (name === 'records') {
                const record = value as VaultRecord;
                if (failure?.id === record.id) {
                  const error = new DOMException(
                    'Simulated record write failure.',
                    'QuotaExceededError'
                  );
                  if (failure.kind === 'throw') {
                    throw error;
                  }
                  requestFailure = error;
                } else {
                  stagedRecords.set(record.id, record);
                }
              } else {
                stagedMeta.set(String(key), value as VaultMeta);
              }
              return {} as IDBRequest<IDBValidKey>;
            },
          } as IDBObjectStore;
        },
      };

      queueMicrotask(() =>
        queueMicrotask(() => {
          if (aborted || requestFailure !== null) {
            tx.error = requestFailure ?? tx.error;
            tx.onabort?.({ target: tx } as unknown as Event);
            return;
          }
          if (names.includes('meta')) {
            committedMeta.clear();
            for (const [key, value] of stagedMeta) {
              committedMeta.set(key, value);
            }
          }
          if (names.includes('records')) {
            committedRecords.clear();
            for (const [key, value] of stagedRecords) {
              committedRecords.set(key, value);
            }
          }
          tx.oncomplete?.({ target: tx } as unknown as Event);
        })
      );

      return tx as IDBTransaction;
    }
  );

  return {
    db: { transaction } as unknown as IDBDatabase,
    transaction,
    snapshot: () => ({
      meta: committedMeta.get('vault'),
      records: [...committedRecords.values()].sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
    }),
  };
}

function prepareImport(
  vault: PortfolioVaultService,
  database: IDBDatabase,
  currentMeta: VaultMeta,
  currentKey: CryptoKey,
  importedKey: CryptoKey
): VaultInternals {
  const internals = vault as unknown as VaultInternals;
  internals.meta = currentMeta;
  internals.key = currentKey;
  vi.spyOn(internals, 'open').mockResolvedValue(database);
  vi.spyOn(internals, 'deriveKey').mockResolvedValue(importedKey);
  vi.spyOn(internals, 'decryptBytes').mockResolvedValue(new Uint8Array([1]));
  vi.spyOn(internals, 'encryptBytes').mockResolvedValue({
    nonceB64: 'fresh-verifier-nonce',
    ctB64: 'fresh-verifier-ciphertext',
  });
  return internals;
}

describe('PortfolioVaultService encrypted backups', () => {
  it('exports the frontend release from runtime configuration', async () => {
    const vault = service('frontend-build-1234');
    const internals = vault as unknown as VaultInternals;
    internals.meta = vaultMeta();
    vi.spyOn(internals, 'readAllRecords').mockResolvedValue([
      vaultRecord('old'),
    ]);

    const backup = await vault.exportEncrypted();

    expect(backup.applicationRelease).toBe('frontend-build-1234');
    expect(backup.formatVersion).toBe(2);
    expect(backup.migrationCompatibilityRange).toEqual([1, 2]);
    expect(backup.payloadChecksum).toBe(
      await backupChecksum(backup.records, 2)
    );
  });

  it('zeros encoded record bytes when a put fails', async () => {
    const vault = service();
    const internals = vault as unknown as VaultInternals;
    internals.key = {} as CryptoKey;
    let encoded: Uint8Array | null = null;
    vi.spyOn(internals, 'encryptBytes').mockImplementation(
      async (_key, plaintext) => {
        encoded = plaintext;
        throw new Error('Simulated encryption failure.');
      }
    );
    const putRecord = vi
      .spyOn(internals, 'putRecord')
      .mockResolvedValue(undefined);

    await expect(
      vault.put('portfolio', 'private', { secret: 'value' })
    ).rejects.toThrow('Simulated encryption failure.');

    expect(encoded).not.toBeNull();
    expect([...(encoded as unknown as Uint8Array)]).toEqual(
      Array((encoded as unknown as Uint8Array).length).fill(0)
    );
    expect(putRecord).not.toHaveBeenCalled();
  });

  it('zeros decrypted record bytes after a get', async () => {
    const vault = service();
    const internals = vault as unknown as VaultInternals;
    internals.key = {} as CryptoKey;
    const plaintext = new TextEncoder().encode('{"secret":"value"}');
    vi.spyOn(internals, 'open').mockResolvedValue({} as IDBDatabase);
    vi.spyOn(internals, 'transaction').mockResolvedValue(
      vaultRecord('private')
    );
    vi.spyOn(internals, 'decryptBytes').mockResolvedValue(plaintext);

    await expect(vault.get('private')).resolves.toEqual({ secret: 'value' });

    expect([...plaintext]).toEqual(Array(plaintext.length).fill(0));
  });

  it('zeros decrypted record bytes after listing a type', async () => {
    const vault = service();
    const internals = vault as unknown as VaultInternals;
    internals.key = {} as CryptoKey;
    const plaintext = new TextEncoder().encode('{"secret":"value"}');
    vi.spyOn(internals, 'open').mockResolvedValue({} as IDBDatabase);
    vi.spyOn(internals, 'transaction').mockResolvedValue([
      vaultRecord('private'),
    ]);
    vi.spyOn(internals, 'decryptBytes').mockResolvedValue(plaintext);

    await expect(vault.listByType('portfolio')).resolves.toEqual([
      { id: 'private', value: { secret: 'value' } },
    ]);

    expect([...plaintext]).toEqual(Array(plaintext.length).fill(0));
  });

  it.each(['id', 'type', 'nonceB64', 'ctB64'] as const)(
    'rejects version 2 record %s tampering before key derivation',
    async (field) => {
      const backup = await encryptedBackup(['import-a']);
      const tampered = {
        ...backup,
        records: [
          {
            ...backup.records[0],
            [field]: `changed-${field}`,
          },
        ],
      };
      const vault = service();
      const internals = vault as unknown as VaultInternals;
      const deriveKey = vi
        .spyOn(internals, 'deriveKey')
        .mockResolvedValue({} as CryptoKey);

      await expect(
        vault.importEncrypted(tampered, 'passphrase')
      ).rejects.toThrow('integrity check');
      expect(deriveKey).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['memoryKiB', 8_191],
    ['memoryKiB', 131_073],
    ['timeCost', 0],
    ['timeCost', 11],
    ['parallelism', 0],
    ['parallelism', 9],
    ['iterations', 99_999],
    ['iterations', 2_000_001],
    ['iterations', 600_000.5],
  ] as const)(
    'rejects out-of-range KDF parameter %s=%s before key derivation',
    async (field, value) => {
      const backup = await encryptedBackup(['import-a']);
      const tampered = {
        ...backup,
        kdfParams: { ...backup.kdfParams, [field]: value },
      };
      const vault = service();
      const internals = vault as unknown as VaultInternals;
      const deriveKey = vi
        .spyOn(internals, 'deriveKey')
        .mockResolvedValue({} as CryptoKey);

      await expect(
        vault.importEncrypted(tampered, 'passphrase')
      ).rejects.toThrow('unsupported key derivation parameters');
      expect(deriveKey).not.toHaveBeenCalled();
    }
  );

  it('rejects an unsupported KDF before key derivation', async () => {
    const backup = await encryptedBackup(['import-a']);
    const vault = service();
    const internals = vault as unknown as VaultInternals;
    const deriveKey = vi
      .spyOn(internals, 'deriveKey')
      .mockResolvedValue({} as CryptoKey);

    await expect(
      vault.importEncrypted({ ...backup, kdf: 'unsupported' }, 'passphrase')
    ).rejects.toThrow('unsupported key derivation method');
    expect(deriveKey).not.toHaveBeenCalled();
  });

  it('changes the passphrase and every record in one readwrite transaction', async () => {
    const oldMeta = vaultMeta();
    const oldRecord = vaultRecord('old');
    const database = fakeDatabase(oldMeta, [oldRecord]);
    const vault = service();
    const internals = vault as unknown as VaultInternals;
    const currentKey = {} as CryptoKey;
    const nextKey = {} as CryptoKey;
    const plaintext = new Uint8Array([1, 2, 3]);
    internals.meta = oldMeta;
    internals.key = currentKey;
    vi.spyOn(internals, 'readAllRecords').mockResolvedValue([oldRecord]);
    vi.spyOn(internals, 'open').mockResolvedValue(database.db);
    vi.spyOn(internals, 'deriveKey').mockResolvedValue(nextKey);
    vi.spyOn(internals, 'decryptBytes').mockResolvedValue(plaintext);
    vi.spyOn(internals, 'encryptBytes')
      .mockResolvedValueOnce({
        nonceB64: 'next-verifier-nonce',
        ctB64: 'next-verifier-ciphertext',
      })
      .mockResolvedValueOnce({
        nonceB64: 'next-record-nonce',
        ctB64: 'next-record-ciphertext',
      });

    await expect(
      vault.changePassphrase('next passphrase')
    ).resolves.toBeUndefined();

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.transaction).toHaveBeenCalledWith(
      ['meta', 'records'],
      'readwrite'
    );
    expect(database.snapshot().meta).toMatchObject({
      verifier: {
        nonceB64: 'next-verifier-nonce',
        ctB64: 'next-verifier-ciphertext',
      },
    });
    expect(database.snapshot().records).toEqual([
      expect.objectContaining({
        id: 'old',
        envelope: {
          nonceB64: 'next-record-nonce',
          ctB64: 'next-record-ciphertext',
        },
      }),
    ]);
    expect(internals.meta).toEqual(database.snapshot().meta);
    expect(internals.key).toBe(nextKey);
    expect([...plaintext]).toEqual([0, 0, 0]);
    vault.lock();
  });

  it.each(['abort', 'throw'] as const)(
    'keeps the previous passphrase and ciphertext when a replacement write must %s',
    async (kind) => {
      const oldMeta = vaultMeta();
      const oldRecord = vaultRecord('old');
      const database = fakeDatabase(oldMeta, [oldRecord], { id: 'old', kind });
      const vault = service();
      const internals = vault as unknown as VaultInternals;
      const currentKey = {} as CryptoKey;
      internals.meta = oldMeta;
      internals.key = currentKey;
      vi.spyOn(internals, 'readAllRecords').mockResolvedValue([oldRecord]);
      vi.spyOn(internals, 'open').mockResolvedValue(database.db);
      vi.spyOn(internals, 'deriveKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(internals, 'decryptBytes').mockResolvedValue(
        new Uint8Array([1])
      );
      vi.spyOn(internals, 'encryptBytes')
        .mockResolvedValueOnce({
          nonceB64: 'next-verifier-nonce',
          ctB64: 'next-verifier-ciphertext',
        })
        .mockResolvedValueOnce({
          nonceB64: 'next-record-nonce',
          ctB64: 'next-record-ciphertext',
        });

      await expect(vault.changePassphrase('next passphrase')).rejects.toThrow();

      expect(database.snapshot()).toEqual({
        meta: oldMeta,
        records: [oldRecord],
      });
      expect(internals.meta).toBe(oldMeta);
      expect(internals.key).toBe(currentKey);
    }
  );

  it('replaces records and metadata in one readwrite transaction', async () => {
    const oldMeta = vaultMeta();
    const oldRecord = vaultRecord('old');
    const database = fakeDatabase(oldMeta, [oldRecord]);
    const vault = service();
    const importedKey = {} as CryptoKey;
    const internals = prepareImport(
      vault,
      database.db,
      oldMeta,
      {} as CryptoKey,
      importedKey
    );
    const firstPlaintext = new Uint8Array([7, 8]);
    const secondPlaintext = new Uint8Array([9, 10]);
    vi.spyOn(internals, 'decryptBytes')
      .mockReset()
      .mockResolvedValueOnce(firstPlaintext)
      .mockResolvedValueOnce(secondPlaintext);

    await expect(
      vault.importEncrypted(
        await encryptedBackup(['import-a', 'import-b']),
        'passphrase'
      )
    ).resolves.toEqual({
      importedRecords: 2,
    });

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.transaction).toHaveBeenCalledWith(
      ['meta', 'records'],
      'readwrite'
    );
    expect(database.snapshot().records.map((record) => record.id)).toEqual([
      'import-a',
      'import-b',
    ]);
    expect(database.snapshot().meta).toMatchObject({
      saltB64: 'imported-salt',
      verifier: {
        nonceB64: 'fresh-verifier-nonce',
        ctB64: 'fresh-verifier-ciphertext',
      },
    });
    expect(internals.meta).toEqual(database.snapshot().meta);
    expect(internals.key).toBe(importedKey);
    expect([...firstPlaintext]).toEqual([0, 0]);
    expect([...secondPlaintext]).toEqual([0, 0]);
    vault.lock();
  });

  it('imports a version 1 backup with its legacy checksum', async () => {
    const oldMeta = vaultMeta();
    const oldRecord = vaultRecord('old');
    const database = fakeDatabase(oldMeta, [oldRecord]);
    const vault = service();
    prepareImport(
      vault,
      database.db,
      oldMeta,
      {} as CryptoKey,
      {} as CryptoKey
    );

    await expect(
      vault.importEncrypted(
        await encryptedBackup(['legacy-import'], 1),
        'passphrase'
      )
    ).resolves.toEqual({ importedRecords: 1 });

    expect(database.snapshot().records.map((record) => record.id)).toEqual([
      'legacy-import',
    ]);
    vault.lock();
  });

  it.each(['abort', 'throw'] as const)(
    'keeps the previous vault when a record write must %s',
    async (kind) => {
      const oldMeta = vaultMeta();
      const oldRecord = vaultRecord('old');
      const database = fakeDatabase(oldMeta, [oldRecord], {
        id: 'import-b',
        kind,
      });
      const vault = service();
      const currentKey = {} as CryptoKey;
      const internals = prepareImport(
        vault,
        database.db,
        oldMeta,
        currentKey,
        {} as CryptoKey
      );

      await expect(
        vault.importEncrypted(
          await encryptedBackup(['import-a', 'import-b']),
          'passphrase'
        )
      ).rejects.toThrow();

      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(database.snapshot()).toEqual({
        meta: oldMeta,
        records: [oldRecord],
      });
      expect(internals.meta).toBe(oldMeta);
      expect(internals.key).toBe(currentKey);
    }
  );
});
