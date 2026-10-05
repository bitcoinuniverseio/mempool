// Exercise the actual Blocks polling loop with bounded native API responses.
// External indexing side effects are stubbed; the hub and History are real.
const lockState = { locks: 0 };
jest.mock('../api/disk-cache', () => ({
  __esModule: true,
  default: {
    lock: jest.fn(() => { lockState.locks++; }),
    unlock: jest.fn(() => { lockState.locks = Math.max(0, lockState.locks - 1); }),
    $saveCacheToDisk: jest.fn(),
  },
}));
const tip = { $getBlockHeightTip: jest.fn(), $getBlockHash: jest.fn() };
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: {},
  bitcoinCoreApi: tip,
}));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getBlockchainInfo: jest.fn(async () => ({ blocks: 1, headers: 2 })) } }));
jest.mock('../api/bitcoin/bitcoin-second-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-api', () => ({ __esModule: true, default: { convertBlock: jest.fn() } }));
jest.mock('../api/common', () => ({ Common: { indexingEnabled: () => false, blocksSummariesIndexingEnabled: () => false } }));
jest.mock('../api/transaction-utils', () => ({ __esModule: true, default: {} }));
jest.mock('../api/loading-indicators', () => ({ __esModule: true, default: {} }));
jest.mock('../api/websocket-handler', () => ({ __esModule: true, default: {} }));
jest.mock('../api/redis-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/rbf-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/chain-tips', () => ({ __esModule: true, default: {} }));
jest.mock('../api/cpfp', () => ({ calculateFastBlockCpfp: jest.fn(), calculateGoodBlockCpfp: jest.fn() }));
jest.mock('../api/difficulty-adjustment', () => ({ calcBitsDifference: jest.fn() }));
jest.mock('../api/mining/mining', () => ({ __esModule: true, default: {} }));
jest.mock('../api/pools-parser', () => ({ __esModule: true, default: {} }));
jest.mock('../api/services/acceleration', () => ({ __esModule: true, default: {} }));
jest.mock('../indexer', () => ({ __esModule: true, default: { reindex: jest.fn(), scheduleSingleTask: jest.fn() } }));
jest.mock('../database', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: {} }));
jest.mock('../utils/bitcoin-script', () => ({ parseDATUMTemplateCreator: jest.fn() }));
jest.mock('../utils/file-read', () => ({ getBlockFirstSeenFromLogs: jest.fn(), getOldestLogTimestampFromLogs: jest.fn(), scanLogsForBlocksFirstSeen: jest.fn() }));
for (const repo of ['Pools', 'Blocks', 'Hashrates', 'BlocksSummaries', 'BlocksAudits', 'Cpfp', 'DifficultyAdjustments', 'Prices', 'Acceleration']) {
  jest.mock(`../repositories/${repo}Repository`, () => ({ __esModule: true, default: {} }));
}

import blocks from '../api/blocks';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import BitcoinApi from '../api/bitcoin/bitcoin-api';
import { calculateGoodBlockCpfp } from '../api/cpfp';
import chainTips from '../api/chain-tips';
import mempool from '../api/mempool';
import { CanonicalPollFence } from '../api/intelligence/time-machine/canonical-poll-fence';

import config from '../config';
import { BlockObservationHub } from '../api/intelligence/observation/block-observation-hub';
import { TimeMachineService } from '../api/intelligence/time-machine/time-machine.service';
const hash = (n: number) => n.toString(16).padStart(64, '0');
const block = (height: number) => ({ height, id: hash(height), previousblockhash: hash(Math.max(0, height - 1)), weight: 1000, extras: { totalFees: 1000 } } as any);
const tx = { txid: 'a'.repeat(64), weight: 437, vsize: 110, fee: 1000 } as any;
describe('actual Blocks polling canonical observation', () => {
  let history: TimeMachineService;
  let checkpoint: any;
  let changes: any[];
  let pool: any;
  beforeEach(() => {
    jest.clearAllMocks();
    pool = {};
    history = new TimeMachineService({ store: null, network: config.MEMPOOL.NETWORK, now: 1000, feed: () => pool });
    history.observeBlock(block(1), [], 1000); checkpoint = history.observeBlock(block(2), [tx], 1100);
    changes = []; const hub = new BlockObservationHub();
    hub.subscribeCanonical('history', change => { changes.push(change); history.observeCanonicalChange(change); });
    const state = blocks as any;
    state.canonicalChangeCallbacks = []; state.canonicalRestorationReaders = []; state.lastCanonicalChange = null;
    state.lastDifficultyAdjustmentTime = 1; state.quarterEpochBlockTime = 1;
    blocks.setBlocks([block(1), block(2)]);
    blocks.setCanonicalChangeCallback(change => hub.dispatchCanonical(change));
    tip.$getBlockHash.mockImplementation(async (height: number) => hash(height));
  });
  it('observes actual lower canonical tip without redispatching or rewinding indexed cache', async () => {
    tip.$getBlockHeightTip.mockResolvedValue(1);
    await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['verified-rollback']);
    expect(history.getStateByHash(checkpoint.state_hash)).toBeNull();
    expect(blocks.getBlocks().map(cached => cached.id)).toEqual([hash(1), hash(2)]);
    history.observePoll([tx], [], true, Date.now() + 1);
    pool[tx.txid] = tx;
    history.observeVerifiedReentries([tx.txid], { height: 1, hash: hash(1) }, history.getPollGeneration() - 1, Date.now() + 2);
    expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('reaccepted_after_reorg');
  });
  it('observes same-height replacement through actual polling', async () => {
    tip.$getBlockHeightTip.mockResolvedValue(2);
    tip.$getBlockHash.mockImplementation(async (height: number) => height === 2 ? 'f'.repeat(64) : hash(height));
    await blocks.$updateBlocks();
    expect(changes[0].commonAncestor).toEqual({ height: 1, hash: hash(1) });
    expect(history.getStateByHash(checkpoint.state_hash)).toBeNull();
  });
  it('refuses ancestry when native tip changes during fencing', async () => {
    tip.$getBlockHeightTip.mockResolvedValueOnce(1).mockResolvedValue(2);
    await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['unavailable']);
    expect(history.getStateByHash(checkpoint.state_hash)).toBeNull();
    history.observePoll([tx], [], true, Date.now() + 1);
    expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('accepted');
  });
  it('does not infer an ancestor from discontinuous cached blocks', async () => {
    blocks.setBlocks([block(0), block(2)]); tip.$getBlockHeightTip.mockResolvedValue(1);
    await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['unavailable']);
  });
  it('bounds native ancestry acquisition to the last128 cached blocks', async () => {
    blocks.setBlocks(Array.from({ length: 130 }, (_, index) => block(index + 1)));
    tip.$getBlockHeightTip.mockResolvedValue(0);
    await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['unavailable']);
    expect(tip.$getBlockHash.mock.calls.length).toBeLessThanOrEqual(128);
  });
  it('rejects cached parent hash mismatch without guessing the ancestor', async () => {
    blocks.setBlocks([block(1), { ...block(2), previousblockhash: 'f'.repeat(64) }]);
    tip.$getBlockHeightTip.mockResolvedValue(1); await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['unavailable']);
  });
  it('does not add native hash queries when no canonical observer is registered', async () => {
    (blocks as any).canonicalChangeCallbacks = []; tip.$getBlockHeightTip.mockResolvedValue(1);
    await blocks.$updateBlocks(); expect(tip.$getBlockHash).not.toHaveBeenCalled();
  });
  it('observes restored cached canonical tip and retires nonreentering provenance without redispatching a block', async () => {
    const state = blocks as any;
    state.canonicalChangeCallbacks = [];
    const hub = new BlockObservationHub();
    hub.subscribeCanonical('history-restoration', change => { changes.push(change); history.observeCanonicalChange(change); });
    blocks.setCanonicalChangeCallback(change => hub.dispatchCanonical(change), () => history.getCanonicalRecoveryRequest());
    tip.$getBlockHeightTip.mockResolvedValue(1);
    await blocks.$updateBlocks();
    expect(history.getPendingCanonicalTip()).not.toBeNull();
    const priorEvents = history.getTransactionLifecycle(tx.txid);
    tip.$getBlockHeightTip.mockResolvedValue(2);
    await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['verified-rollback', 'verified-restoration']);
    expect(history.getPendingCanonicalTip()).toBeNull();
    expect(history.getCanonicalRestorationTarget()).toBeNull();
    expect(history.getStateByHash(checkpoint.state_hash)).toBeNull();
    expect(history.getTransactionLifecycle(tx.txid)).toEqual(priorEvents);
    expect(blocks.getBlocks().map(cached => cached.id)).toEqual([hash(1), hash(2)]);
  });
  it('keeps a gap and refuses restoration when actual tip changes during its sequential fence', async () => {
    (blocks as any).canonicalChangeCallbacks = [];
    const hub = new BlockObservationHub();
    hub.subscribeCanonical('history-restoration', change => { changes.push(change); history.observeCanonicalChange(change); });
    blocks.setCanonicalChangeCallback(change => hub.dispatchCanonical(change), () => history.getCanonicalRecoveryRequest());
    tip.$getBlockHeightTip.mockResolvedValue(1); await blocks.$updateBlocks();
    tip.$getBlockHeightTip.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValue(1);
    await blocks.$updateBlocks();
    expect(changes.map(change => change.status)).toEqual(['verified-rollback', 'unavailable']);
    expect(history.getCanonicalRestorationTarget()).toEqual({ height: 2, hash: hash(2) });
    expect(history.getStateByHash(checkpoint.state_hash)).toBeNull();
  });
  it('processes an alternative canonical new block then verifies reentry only on the next fresh complete poll', async () => {
    (blocks as any).canonicalChangeCallbacks = [];
    const hub = new BlockObservationHub();
    hub.subscribeCanonical('history-progression', change => { changes.push(change); history.observeCanonicalChange(change); });
    blocks.setCanonicalChangeCallback(change => hub.dispatchCanonical(change), () => history.getCanonicalRecoveryRequest());
    tip.$getBlockHeightTip.mockResolvedValue(1); await blocks.$updateBlocks();
    const oldExpected = history.getPendingCanonicalTip();
    // Existing cache cleanup can already have retained only the common ancestor.
    // The actual producer loop must handle replacement blocks, not a manual hub dispatch.
    blocks.setBlocks([block(1)]);
    const canonicalHash = (height: number) => height === 1 ? hash(1) : hash(height + 10);
    tip.$getBlockHeightTip.mockResolvedValue(3); tip.$getBlockHash.mockImplementation(async height => canonicalHash(height));
    const readTip = async () => ({ height: await tip.$getBlockHeightTip(), hash: await tip.$getBlockHash(3) });
    const staleFence = await CanonicalPollFence.begin(oldExpected, readTip);
    const cacheEnabled = config.MEMPOOL.CACHE_ENABLED; config.MEMPOOL.CACHE_ENABLED = false;
    const state = blocks as any;
    try {
      jest.spyOn(state, 'updateQuarterEpochBlockTime').mockResolvedValue(undefined);
      jest.spyOn(state, '$getBlockExtended').mockImplementation(async (b: any) => b);
      jest.spyOn(state, 'summarizeBlockTransactions').mockReturnValue({ transactions: [] });
      (chainTips as any).updateOrphanedBlocks = jest.fn();
      (mempool as any).getAccelerations = jest.fn(() => ({}));
      (bitcoinClient as any).getBlock = jest.fn(async (id: string) => {
        const height = id === canonicalHash(2) ? 2 : 3;
        return { id, height, weight: 100, timestamp: height, previousblockhash: canonicalHash(height - 1), extras: { totalFees: 0 }, tx: [{ txid: hash(100 + height), fee: 0 }] };
      });
      (BitcoinApi.convertBlock as jest.Mock).mockImplementation(b => b);
      jest.spyOn(state, '$getTransactionsExtended').mockImplementation(async (_id: unknown, height: any) => [{ txid: hash(100 + height), weight: 100, vsize: 25, fee: 0, vin: [{ is_coinbase: true }] }]);
      (calculateGoodBlockCpfp as jest.Mock).mockImplementation((_height, transactions) => ({ transactions }));
      blocks.setNewAsyncBlockCallback(async (b, _ids, transactions) => { await hub.dispatch(b, transactions); });
      hub.subscribe('history-new-block', (b, transactions) => { history.observeBlock(b, transactions); });
      expect(await blocks.$updateBlocks()).toBe(2);
      expect(changes.some(change => change.status === 'verified-progression')).toBe(true);
      expect(history.getPendingCanonicalTip()).toEqual({ height: 3, hash: canonicalHash(3) });
      pool[tx.txid] = tx;
      history.observePoll([tx], [], true, Date.now());
      expect(await staleFence.verify()).toBe(false);
      history.markObservationFailure();
      expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('accepted');
      const fresh = await CanonicalPollFence.begin(history.getPendingCanonicalTip(), readTip);
      const generation = history.getPollGeneration(); history.observePoll([], [], true, Date.now());
      expect(await fresh.verify()).toBe(true);
      expect(history.observeVerifiedReentries([tx.txid], { height: 3, hash: canonicalHash(3) }, generation, Date.now())).toBe(true);
      expect(history.getTransactionLifecycle(tx.txid).slice(-1)[0].event_type).toBe('reaccepted_after_reorg');
    } finally { jest.restoreAllMocks(); config.MEMPOOL.CACHE_ENABLED = cacheEnabled; (blocks as any).newAsyncBlockCallbacks = []; }
  });
  it('refuses canonical progression if the retained prior native point is no longer an ancestor', async () => {
    (blocks as any).canonicalChangeCallbacks = [];
    const hub = new BlockObservationHub();
    hub.subscribeCanonical('history-progression', change => { changes.push(change); history.observeCanonicalChange(change); });
    blocks.setCanonicalChangeCallback(change => hub.dispatchCanonical(change), () => history.getCanonicalRecoveryRequest());
    tip.$getBlockHeightTip.mockResolvedValue(1); await blocks.$updateBlocks();
    blocks.setBlocks([block(3)]);
    tip.$getBlockHeightTip.mockResolvedValue(3);
    tip.$getBlockHash.mockImplementation(async height => height === 1 ? 'f'.repeat(64) : hash(height));
    jest.spyOn(blocks as any, 'updateQuarterEpochBlockTime').mockResolvedValue(undefined);
    try {
      await blocks.$updateBlocks();
      expect(changes.map(change => change.status)).toEqual(['verified-rollback', 'unavailable']);
      expect(history.getCanonicalRestorationTarget()).not.toBeNull();
      expect(history.getStateByHash(checkpoint.state_hash)).toBeNull();
      expect(history.getTransactionLifecycle(tx.txid).some(event => event.event_type === 'reaccepted_after_reorg')).toBe(false);
    } finally { jest.restoreAllMocks(); }
  });
});
