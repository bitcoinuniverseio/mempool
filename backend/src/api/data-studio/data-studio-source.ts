import { createHash } from 'crypto';
import { Block } from 'bitcoinjs-lib';
import config from '../../config';
import bitcoinClient from '../bitcoin/bitcoin-client';
import { GENESIS } from '../intelligence/utxo/utxo-evidence';
export class DataStudioEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 503
  ) {
    super(message);
  }
}
export const LIMITS = {
  headers: 32,
  mempool: 10000,
  snapshots: 8,
  events: 64,
  queryRows: 1000,
  filters: 8,
  sourceFreshMs: 30000,
  sourceTimeoutMs: 15000,
};
export const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export interface DataSnapshot {
  schema: 'owned-data-v1';
  id: string;
  network: string;
  genesis: string;
  observedAt: string;
  tipHash: string;
  tipHeight: number;
  mempoolSequence: string | null;
  datasets: Record<string, Record<string, unknown>[]>;
  unavailable: Record<string, string>;
  scope: string;
}
export interface DataSource {
  network: string;
  read(): Promise<DataSnapshot>;
}
export function snapshotDigest(s: Omit<DataSnapshot, 'id'> | DataSnapshot) {
  const { id: _, ...body } = s as DataSnapshot;
  return sha(JSON.stringify(body));
}
export function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
    throw new DataStudioEvidenceError('invalid-owned-data', 'Owned source returned an invalid integer.');
  return v;
}
export class OwnedDataSource implements DataSource {
  constructor(
    private client: any = bitcoinClient,
    public network = config.MEMPOOL.NETWORK
  ) {}
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  async read(): Promise<DataSnapshot> {
    const deadline = Date.now() + LIMITS.sourceTimeoutMs;
    const genesis = await this.client.getBlockHash(0);
    if (!GENESIS[this.network] || genesis !== GENESIS[this.network])
      throw new DataStudioEvidenceError(
        'data-network-mismatch',
        'Owned node genesis differs from the selected backend network.'
      );
    const expectedChain = (
      { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' } as Record<
        string,
        string
      >
    )[this.network];
    const info = await this.client.getBlockchainInfo();
    if (!info || info.chain !== expectedChain || info.initialblockdownload !== false)
      throw new DataStudioEvidenceError(
        'data-chain-state-invalid',
        'Owned chain identity and completed initial-sync state must match the selected network.'
      );
    const tipHeight = integer(info.blocks, 0x7fffffff),
      tipHash = info.bestblockhash;
    if (!/^[a-f0-9]{64}$/.test(tipHash)) throw Error('Invalid tip hash');
    const headers: Record<string, unknown>[] = [];
    let hash = tipHash;
    for (let height = tipHeight; height >= 0 && headers.length < LIMITS.headers; height--) {
      if (Date.now() > deadline)
        throw new DataStudioEvidenceError('data-source-timeout', 'Owned header collection exceeded its deadline.');
      const raw = await this.client.getBlockHeader(hash, false);
      if (typeof raw !== 'string' || !/^[0-9a-f]{160}$/i.test(raw))
        throw new DataStudioEvidenceError('invalid-owned-data', 'Owned header serialization is invalid.');
      const block = Block.fromHex(raw);
      if (block.getId() !== hash)
        throw new DataStudioEvidenceError(
          'invalid-owned-data',
          'Owned header hash does not match its requested identity.'
        );
      headers.push({
        height,
        hash,
        previous_hash: block.prevHash!.reverse().toString('hex'),
        merkle_root: block.merkleRoot!.reverse().toString('hex'),
        time: block.timestamp,
        version: block.version,
        bits: block.bits,
        nonce: block.nonce,
        header_hex: raw.toLowerCase(),
      });
      hash = headers[headers.length - 1].previous_hash as string;
    }
    const datasets: DataSnapshot['datasets'] = { 'bitcoin.blocks': headers.reverse() },
      unavailable: Record<string, string> = {};
    let mempoolSequence: string | null = null;
    try {
      const poolInfo = await this.client.getMempoolInfo();
      if (integer(poolInfo.size) > LIMITS.mempool)
        throw new DataStudioEvidenceError(
          'data-mempool-bound',
          'Mempool exceeds the complete10000-row snapshot bound.'
        );
      const pool = await this.client.getRawMemPool(false, true);
      if (!Array.isArray(pool?.txids) || !Number.isSafeInteger(pool.mempool_sequence) || pool.mempool_sequence < 0)
        throw Error('Mempool sequence unsupported');
      if (pool.txids.length > LIMITS.mempool)
        throw new DataStudioEvidenceError(
          'data-mempool-bound',
          'Mempool exceeds the complete10000-row snapshot bound.'
        );
      if (
        pool.txids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) ||
        new Set(pool.txids).size !== pool.txids.length
      )
        throw Error('Invalid mempool IDs');
      mempoolSequence = String(pool.mempool_sequence);
      datasets['bitcoin.mempool'] = pool.txids.sort().map((txid) => ({ txid }));
    } catch (e) {
      unavailable['bitcoin.mempool'] =
        e instanceof DataStudioEvidenceError ? e.code : 'data-mempool-source-unavailable';
    }
    const finalInfo = await this.client.getBlockchainInfo();
    if (
      !finalInfo ||
      finalInfo.chain !== expectedChain ||
      finalInfo.initialblockdownload !== false ||
      finalInfo.blocks !== tipHeight ||
      finalInfo.bestblockhash !== tipHash
    )
      throw new DataStudioEvidenceError(
        'data-tip-changed',
        'Owned chain tip changed during export; retry a fresh snapshot.'
      );
    const body: Omit<DataSnapshot, 'id'> = {
      schema: 'owned-data-v1',
      network: this.network,
      genesis,
      observedAt: new Date().toISOString(),
      tipHash,
      tipHeight,
      mempoolSequence,
      datasets,
      unavailable,
      scope:
        'Latest32 canonical block headers and, when available, the complete bounded owned mempool transaction-ID set at the recorded observation. Not a full blockchain or protocol catalog.',
    };
    return { ...body, id: snapshotDigest(body) };
  }
}
