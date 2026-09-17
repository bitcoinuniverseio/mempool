import { createHash, generateKeyPairSync, KeyObject, sign } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BootstrapEnvironment } from '../bootstrap-config';
import { BootstrapCatalogue, BootstrapCatalogueSnapshot } from '../bootstrap.models';
import { deterministicSnapshotJson } from '../snapshot-catalogue';
import { SnapshotByteSource } from '../snapshot-verifier';

/** Test doubles shared by the bootstrap suites. Nothing here runs in production. */

export const FIXTURE_BYTES = Buffer.from(readFileSync(join(__dirname, 'regtest-105.snapshot.base64'), 'utf8'), 'base64');
export const FIXTURE = {
  baseHash: '0be30936f2332969e5dd82fe06d0c4d8d25d86351442ec813c2f70aa132c2acb',
  height: 105,
  coins: 107,
  hashSerialized3: '2fff9d5b75bf5539b20a99cbae5639819995d0b560d2cfda171aafed870418fc',
  sha256: createHash('sha256').update(FIXTURE_BYTES).digest('hex'),
  genesis: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};

export function producerKeys(): { privateKey: KeyObject; publicKeyHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { privateKey, publicKeyHex: Buffer.from(jwk.x, 'base64url').toString('hex') };
}

export function signSnapshot(snapshot: BootstrapCatalogueSnapshot, privateKey: KeyObject): string {
  return sign(null, deterministicSnapshotJson(snapshot), privateKey).toString('hex');
}

export function catalogueFor(
  privateKey: KeyObject,
  publicKeyHex: string,
  overrides: Partial<BootstrapCatalogueSnapshot> = {},
  pinned: Partial<BootstrapCatalogue['pinnedCommitments'][number]> = {}
): BootstrapCatalogue {
  const snapshot: BootstrapCatalogueSnapshot = {
    id: 'regtest-105',
    network: 'regtest',
    coreVersion: '28.0.0',
    height: FIXTURE.height,
    blockHash: FIXTURE.baseHash,
    sizeBytes: FIXTURE_BYTES.length,
    sha256: FIXTURE.sha256,
    source: '/allowed/regtest-105.dat',
    manifest: { producerId: 'lab', signature: '' },
    ...overrides,
  };
  snapshot.manifest = { producerId: snapshot.manifest.producerId, signature: snapshot.manifest.signature || signSnapshot(snapshot, privateKey) };
  return {
    producers: [{ id: 'lab', algorithm: 'ed25519', publicKey: publicKeyHex }],
    pinnedCommitments: [{ network: 'regtest', coreVersion: '28.0.0', height: FIXTURE.height, blockHash: FIXTURE.baseHash, utxoCommitment: FIXTURE.hashSerialized3, coinCount: FIXTURE.coins, ...pinned }],
    snapshots: [snapshot],
  };
}

export function testEnvironment(overrides: Partial<BootstrapEnvironment> = {}): BootstrapEnvironment {
  return {
    catalogueFile: undefined,
    sourceAllowlist: ['/allowed'],
    maxSnapshotBytes: 1 << 20,
    verifyDeadlineMs: 5000,
    snapshotDir: '/var/lib/bitcoin/snapshots',
    datadir: '/var/lib/bitcoin',
    capacityBytes: undefined,
    capacityMeasuredAt: undefined,
    capacityMaxAgeMs: 24 * 3600 * 1000,
    jobTimeoutMs: 5000,
    jobLeaseMs: 60000,
    jobPollMs: 60000,
    ...overrides,
  };
}

/** Serves a buffer in chunks; `stall` never ends, for deadline tests. */
export function byteSource(bytes: Buffer, options: { chunk?: number; stall?: boolean } = {}): SnapshotByteSource & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    async open(source): Promise<AsyncGenerator<Buffer> & { destroy?: () => void }> {
      opened.push(source);
      let destroyed = false;
      const chunk = options.chunk ?? 512;
      /** @asyncUnsafe Test double; the consumer owns the iteration. */
      async function* generate(): AsyncGenerator<Buffer> {
        for (let i = 0; i < bytes.length; i += chunk) {
          if (destroyed) {
            return;
          }
          yield bytes.subarray(i, Math.min(bytes.length, i + chunk));
        }
        if (options.stall) {
          while (!destroyed) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }
      }
      const iterable = generate() as AsyncGenerator<Buffer> & { destroy?: () => void };
      iterable.destroy = () => {
        destroyed = true;
      };
      return iterable;
    },
  };
}

export type CoreCall = (method: string, params: unknown[]) => Promise<any>;

/** A regtest Core 28.0 at the fixture height, fully validated, reachable through the reader RPCs. */
export function fakeCore(overrides: { blocks?: number; headers?: number; ibd?: boolean; subversion?: string; help?: string; chainstates?: any[]; calls?: string[] } = {}): { network: string; call: CoreCall; calls: string[] } {
  const calls = overrides.calls ?? [];
  const blocks = overrides.blocks ?? FIXTURE.height;
  const headers = overrides.headers ?? blocks;
  const hashes: Record<number, string> = { 0: FIXTURE.genesis, [FIXTURE.height]: FIXTURE.baseHash, 104: '0330fd86eb1429db0fd4dec8c659556aeb265f3c98ac9bd75d0f18c0204b10a3' };
  const hashAt = (h: number): string => hashes[h] ?? createHash('sha256').update('block' + h).digest('hex');
  const tip = hashAt(blocks);
  const chainstates = overrides.chainstates ?? [{ blocks, bestblockhash: tip, verificationprogress: 1, validated: true, coins_db_cache_bytes: 8388608, coins_tip_cache_bytes: 461373440 }];
  return {
    network: 'regtest',
    calls,
    async call(method, params) {
      calls.push(method);
      switch (method) {
        case 'getblockhash':
          return hashAt(Number(params[0]));
        case 'getblockheader': {
          const height = Object.keys(hashes).map(Number).find((h) => hashes[h] === params[0]);
          const found = height ?? [...Array(headers + 1).keys()].find((h) => hashAt(h) === params[0]);
          if (found === undefined) {
            throw new Error('Block not found');
          }
          return { hash: params[0], height: found, confirmations: blocks - found + 1 };
        }
        case 'getblockchaininfo':
          return { chain: 'regtest', blocks, headers, bestblockhash: tip, initialblockdownload: overrides.ibd ?? false, size_on_disk: 12345678 };
        case 'getnetworkinfo':
          return { version: 280000, subversion: overrides.subversion ?? '/Satoshi:28.0.0/' };
        case 'getchainstates':
          return { headers, chainstates };
        case 'help':
          return overrides.help ?? 'dumptxoutset "path"\ngetchainstates\nloadtxoutset "path"\n';
        case 'getbestblockhash':
          return tip;
        default:
          throw new Error('unexpected RPC ' + method);
      }
    },
  };
}
