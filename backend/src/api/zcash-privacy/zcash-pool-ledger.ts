import { createHash } from 'crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, isAbsolute } from 'path';
import { observeZcashPools } from './zcash-pool-observation';
import { ZcashPublicReader, ZCASH_GENESIS } from './zcash-owned-reader';
import { ZcashPrivacyEvidenceError } from './zcash-source-error';

const IDS = ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'];
const HASH = /^[0-9a-f]{64}$/;
const WINDOW = 144;
const PAGE = 16;
const LIMIT = 524288;
type Pool = { id: string; balanceZat: string; netChangeZat: string; monitored: boolean };
export type ZcashPoolLedgerBlock = { height: number; hash: string; parent: string; timestamp: number; supplyZat: string; pools: Pool[] };
type State = { schema: 'zcash-pool-ledger-storage-v1'; network: string; genesis: string; implementation: string; blocks: ZcashPoolLedgerBlock[] };
export type ZcashPoolHistory = {
  schema: 'zcash-pool-history-v1'; network: string;
  status: 'PARTIAL' | 'COMPLETE_WINDOW_AT_OBSERVED_TIP';
  source: { implementation: string; genesis: string; tipHash: string; branchId: string; nextBranchId: string; observedAt: string };
  tipHeight: number; windowSize: 144; pageSize: 16; nextHeight: number | null;
  verifiedThrough: { height: number; hash: string };
  coverage: { fromHeight: number; throughHeight: number; wholeChainHistory: false; grossFlows: 'unavailable'; poolTransactionCounts: 'unavailable' };
  blocks: ZcashPoolLedgerBlock[]; reorgRecovered: boolean; priorSnapshotArchivedThisRequest: boolean; interruptedWriteRecovered: boolean;
};
const invalid = () => new ZcashPrivacyEvidenceError('invalid-pool-history', 'Pool history is incomplete or inconsistent; no checkpoint was advanced.');
function amount(value: unknown, signed = false): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && (signed || value >= 0)) return BigInt(value);
  if (typeof value === 'string' && (signed ? /^-?(0|[1-9][0-9]{0,15})$/ : /^(0|[1-9][0-9]{0,15})$/).test(value) && value !== '-0') return BigInt(value);
  throw invalid();
}
function decode(raw: any, height: number, implementation: string): ZcashPoolLedgerBlock {
  if (!Number.isSafeInteger(height) || height < 0 || !raw || raw.height !== height || !HASH.test(raw.hash) || height > 0 && !HASH.test(raw.previousblockhash)
    || !Number.isSafeInteger(raw.time) || raw.time < 0 || !Array.isArray(raw.valuePools) || raw.valuePools.length < 5 || raw.valuePools.length > 6) throw invalid();
  const seen = new Set<string>();
  const pools = raw.valuePools.map((pool: any) => {
    if (!pool || !IDS.includes(pool.id) || seen.has(pool.id) || typeof pool.monitored !== 'boolean') throw invalid();
    seen.add(pool.id);
    return { id: pool.id, balanceZat: amount(pool.chainValueZat).toString(), netChangeZat: amount(pool.valueDeltaZat, true).toString(), monitored: pool.monitored };
  }).sort((a: Pool, b: Pool) => a.id.localeCompare(b.id));
  if (IDS.slice(0, 5).some(id => !seen.has(id)) || implementation === 'zebra' && !seen.has('ironwood')) throw invalid();
  const supply = amount(raw.chainSupply?.chainValueZat);
  if (pools.reduce((total: bigint, pool: Pool) => total + BigInt(pool.balanceZat), 0n) !== supply) throw invalid();
  return { height, hash: raw.hash, parent: height === 0 ? '0'.repeat(64) : raw.previousblockhash, timestamp: raw.time, supplyZat: supply.toString(), pools };
}
function follows(previous: ZcashPoolLedgerBlock, next: ZcashPoolLedgerBlock): void {
  if (next.height !== previous.height + 1 || next.parent !== previous.hash || next.pools.length !== previous.pools.length) throw invalid();
  for (const pool of next.pools) {
    const prior = previous.pools.find(row => row.id === pool.id);
    if (!prior || BigInt(pool.balanceZat) - BigInt(prior.balanceZat) !== BigInt(pool.netChangeZat)) throw invalid();
  }
  if (BigInt(next.supplyZat) - BigInt(previous.supplyZat) !== next.pools.reduce((total, pool) => total + BigInt(pool.netChangeZat), 0n)) throw invalid();
}
function load(file: string, network: string, implementation: string): State | null {
  if (!existsSync(file)) return null;
  if (!statSync(file).isFile() || statSync(file).size > LIMIT) throw invalid();
  const bytes = readFileSync(file);
  if (bytes.length > LIMIT) throw invalid();
  let state: State;
  try { state = JSON.parse(bytes.toString('utf8')); } catch { throw invalid(); }
  if (state?.schema !== 'zcash-pool-ledger-storage-v1' || state.network !== network || state.genesis !== ZCASH_GENESIS[network]
    || state.implementation !== implementation || !Array.isArray(state.blocks) || !state.blocks.length || state.blocks.length > WINDOW + 1) throw invalid();
  state.blocks = state.blocks.map(block => decode({ height: block.height, hash: block.hash, previousblockhash: block.parent, time: block.timestamp,
    chainSupply: { chainValueZat: block.supplyZat }, valuePools: block.pools?.map(pool => ({id: pool.id, chainValueZat: pool.balanceZat, valueDeltaZat: pool.netChangeZat, monitored: pool.monitored})) }, block.height, implementation));
  for (let i = 1; i < state.blocks.length; i++) follows(state.blocks[i - 1], state.blocks[i]);
  return state;
}
function acquire(lockPath: string): number {
  // Serialize even dead-owner recovery across different server processes.
  // An interrupted recovery remains fail-closed for operator inspection.
  const recoveryPath = lockPath + '.recovery';
  try { mkdirSync(recoveryPath, { mode: 0o700 }); }
  catch { throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned ledger lock is being inspected or recovered.'); }
  try {
  if (existsSync(lockPath)) {
    if (!statSync(lockPath).isFile() || statSync(lockPath).size > 1024) throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned ledger lock cannot be verified.');
    const prior = readFileSync(lockPath);
    let owner: { pid: number };
    try { owner = JSON.parse(prior.toString()); } catch { throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned ledger lock cannot be verified.'); }
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || prior.length > 1024) throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned ledger lock cannot be verified.');
    try {
      process.kill(owner.pid, 0);
      throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned ledger writer is still running.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned ledger writer may still be running.');
    }
    // Recover only a proven dead process. Retain exact lock evidence before
    // releasing its path; PID reuse or inaccessible ownership fails closed.
    const archive = lockPath + '.dead-' + createHash('sha256').update(prior).digest('hex');
    if (!existsSync(archive)) writeFileSync(archive, prior, { flag: 'wx', mode: 0o600 });
    unlinkSync(lockPath);
  }
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); }
    catch (error) { closeSync(fd); throw error; }
    return fd;
  } catch { throw new ZcashPrivacyEvidenceError('pool-history-busy', 'The owned pool ledger is locked.'); }
  } finally { rmdirSync(recoveryPath); }
}

/** Operator-owned file only; one atomic checkpoint contains a bounded canonical suffix.
 * Each explicit request advances at most16 blocks. Net changes are node accounting,
 * never gross inflows/outflows or counts. Old reorg/gap snapshots remain archived.
 */
export class ZcashPoolLedger {
  private active = false;
  constructor(private readonly reader: ZcashPublicReader, private readonly file: string | undefined) {}

  /** @asyncUnsafe Strict bounded source/persistence failures propagate to the route. */
  public async advance(network: string): Promise<ZcashPoolHistory> {
    if (!['mainnet', 'testnet'].includes(network)) throw new ZcashPrivacyEvidenceError('invalid-network', 'Choose mainnet or testnet.', 400);
    if (!this.file || !isAbsolute(this.file)) throw new ZcashPrivacyEvidenceError('unavailable-pool-ledger', 'An absolute operator-owned pool ledger path is not configured.');
    if (this.active) throw new ZcashPrivacyEvidenceError('pool-history-busy', 'A bounded history observation is already running.');
    this.active = true;
    const file = this.file + '.' + network + '.json', lockPath = file + '.lock';
    let lock: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const guard = () => { if (controller.signal.aborted) throw new ZcashPrivacyEvidenceError('source-timeout', 'Pool history exceeded its15-second budget.'); };
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      lock = acquire(lockPath);
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ZcashPrivacyEvidenceError('source-timeout', 'Pool history exceeded its15-second budget.')); }, 15000); });
      return await Promise.race([deadline, (async () => {
        const before = await observeZcashPools(this.reader, network); guard();
        if (before.tipHeight < 1) throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'A non-genesis checkpoint is required for net pool history.');
        const read = async (method: string, params: unknown[]) => { guard(); const result = await this.reader.call(method, params, controller.signal); guard(); return result; };
        const old = load(file, network, before.source.implementation);
        let blocks = old ? old.blocks.slice() : [];
        let reorgRecovered = false, archived = false;
        // Verify the persisted suffix against the actual selected node. A displaced
        // suffix is rolled back, without deleting its durable historical snapshot.
        while (blocks.length && (blocks[blocks.length - 1].height > before.tipHeight || await read('getblockhash', [blocks[blocks.length - 1].height]) !== blocks[blocks.length - 1].hash)) { blocks.pop(); reorgRecovered = true; }
        const base = Math.max(0, before.tipHeight - WINDOW);
        if (!blocks.length || blocks[blocks.length - 1].height < base) {
          const hash = await read('getblockhash', [base]);
          const first = decode(await read('getblock', [hash, 1]), base, before.source.implementation);
          if (first.hash !== hash) throw invalid();
          blocks = [first];
          archived = old !== null;
        }
        const end = Math.min(before.tipHeight, blocks[blocks.length - 1].height + PAGE);
        for (let height = blocks[blocks.length - 1].height + 1; height <= end; height++) {
          const hash = await read('getblockhash', [height]);
          const block = decode(await read('getblock', [hash, 1]), height, before.source.implementation);
          if (block.hash !== hash) throw invalid();
          follows(blocks[blocks.length - 1], block); blocks.push(block);
        }
        blocks = blocks.slice(-(WINDOW + 1));
        const after = await observeZcashPools(this.reader, network); guard();
        if (after.tipHeight !== before.tipHeight || after.source.tipHash !== before.source.tipHash || after.source.genesis !== before.source.genesis
          || after.source.implementation !== before.source.implementation || after.source.branchId !== before.source.branchId || after.source.nextBranchId !== before.source.nextBranchId
          || after.nodeAccountedSupplyZat !== before.nodeAccountedSupplyZat || JSON.stringify(after.pools) !== JSON.stringify(before.pools)) throw new ZcashPrivacyEvidenceError('source-changed', 'The Zcash source checkpoint changed; no history was committed.', 409);
        const last = blocks[blocks.length - 1];
        if (await read('getblockhash', [last.height]) !== last.hash) throw new ZcashPrivacyEvidenceError('source-changed', 'The final history checkpoint was displaced.', 409);
        if (last.height === before.tipHeight && (last.hash !== before.source.tipHash || last.supplyZat !== before.nodeAccountedSupplyZat
          || last.pools.some(pool => before.pools.find(row => row.id === pool.id)?.balanceZat !== pool.balanceZat))) throw invalid();
        const state: State = { schema: 'zcash-pool-ledger-storage-v1', network, genesis: before.source.genesis, implementation: before.source.implementation, blocks };
        const bytes = Buffer.from(JSON.stringify(state) + '\n'); if (bytes.length > LIMIT) throw invalid();
        guard();
        if (old && (reorgRecovered || archived)) {
          const prior = readFileSync(file), archive = file + '.superseded-' + createHash('sha256').update(prior).digest('hex');
          if (!existsSync(archive)) writeFileSync(archive, prior, { flag: 'wx', mode: 0o600 });
          archived = true;
        }
        const temporary = file + '.pending';
        let interruptedWriteRecovered = false;
        if (existsSync(temporary)) {
          if (!statSync(temporary).isFile() || statSync(temporary).size > LIMIT) throw invalid();
          const interrupted = readFileSync(temporary);
          const archive = temporary + '.superseded-' + createHash('sha256').update(interrupted).digest('hex');
          if (!existsSync(archive)) renameSync(temporary, archive);
          else {
            if (statSync(archive).size !== interrupted.length || !readFileSync(archive).equals(interrupted)) throw invalid();
            unlinkSync(temporary);
          }
          interruptedWriteRecovered = true;
        }
        const fd = openSync(temporary, 'wx', 0o600);
        try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
        // Synchronous commit has no await boundary where a deadline could publish
        // late state. On write/rename failure preserve pending bytes for inspection.
        guard(); renameSync(temporary, file);
        return { schema: 'zcash-pool-history-v1' as const, network, status: last.height === before.tipHeight ? 'COMPLETE_WINDOW_AT_OBSERVED_TIP' as const : 'PARTIAL' as const,
          source: before.source, tipHeight: before.tipHeight, windowSize: WINDOW as 144, pageSize: PAGE as 16, nextHeight: last.height < before.tipHeight ? last.height + 1 : null,
          verifiedThrough: { height: last.height, hash: last.hash }, coverage: { fromHeight: blocks[0].height + 1, throughHeight: last.height,
            wholeChainHistory: false as const, grossFlows: 'unavailable' as const, poolTransactionCounts: 'unavailable' as const },
          blocks: blocks.slice(1), reorgRecovered, priorSnapshotArchivedThisRequest: archived, interruptedWriteRecovered };
      })()]);
    } catch (error) {
      if (error instanceof ZcashPrivacyEvidenceError) throw error;
      throw new ZcashPrivacyEvidenceError('pool-history-persistence', 'The owned pool history could not be committed. Its previous checkpoint and any pending bytes are preserved.');
    } finally {
      if (timer) clearTimeout(timer); controller.abort();
      if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
      this.active = false;
    }
  }
}
