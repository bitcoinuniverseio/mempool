import { defaultMock, isolatedBackend, quietLogger } from '../../test-support/isolated-backend-helper';
import { bitcoinObservationMatches } from '../api/bitcoin/bitcoin-source-observation';

const HASH = 'a'.repeat(64);
function fixture() {
  const state = { synced: true, network: 'main', tip: { height: 123, id: HASH }, poll: Date.now(), minimum: 0.000001,
    nodeHash: HASH, nodeHeight: 123, nodeObserved: Date.now(), nodeIbd: false };
  const config = { MEMPOOL: { NETWORK: 'mainnet', INITIAL_BLOCKS_AMOUNT: 8 }, FIAT_PRICE: {}, STATISTICS: {}, DATABASE: {}, WALLETS: {} };
  const info = { getBackendInfo: () => ({ chainSync: { chain: state.network, blocks: state.nodeHeight, headers: state.nodeHeight,
    initialBlockDownload: state.nodeIbd, blockHash: state.nodeHash, checkedAt: new Date(state.nodeObserved).toISOString(), verificationProgress: 1 } }) };
  const mempool = { isInSync: () => state.synced, getLastMempoolUpdateAt: () => state.poll,
    getMempoolInfo: () => ({ mempoolminfee: state.minimum }), getLatestTransactions: () => [], getVBytesPerSecond: () => 0 };
  const blocks = { getBlocks: () => [state.tip] };
  const projected = { getMempoolBlocks: () => [], getMempoolBlocksWithTransactions: () => [], getMempoolBlockDeltas: () => [],
    $updateBlockTemplates: async () => {}, $makeBlockTemplates: async () => {} };
  Object.assign(mempool, { getMempool: () => ({}), getMempoolCandidates: () => ({}), getSpendMap: () => new Map(),
    handleRbfTransactions: () => {}, removeFromSpendMap: () => {}, addToSpendMap: () => {} });
  const fees = isolatedBackend('api/fee-api.ts', {
    '../config': defaultMock(config), './mempool': defaultMock(mempool), './blocks': defaultMock(blocks), './mempool-blocks': defaultMock(projected),
    './backend-info': defaultMock(info), './bitcoin/bitcoin-source-observation': { bitcoinObservationMatches },
  }).default;
  const websocket = isolatedBackend('api/websocket-handler.ts', {
    '../config': defaultMock(config), './mempool': defaultMock(mempool), './blocks': defaultMock(blocks), './mempool-blocks': defaultMock(projected),
    './fee-api': { ...defaultMock(fees), FEE_ESTIMATE_MAX_AGE_MS: 120_000 }, '../logger': quietLogger,
    './difficulty-adjustment': defaultMock({ getDifficultyAdjustment: () => null }),
    './backend-info': defaultMock(info), './bitcoin/bitcoin-source-observation': { bitcoinObservationMatches },
    '../tasks/price-updater': defaultMock({ getAdvertisedPrices: () => ({}) }),
    './loading-indicators': defaultMock({ getLoadingIndicators: () => ({}) }),
    './common': { Common: { findRbfTransactions: () => ({}), findMinedRbfTransactions: () => ({}) } },
    './rbf-cache': defaultMock({ getRbfChanges: () => ({ trees: {} }), getRbfTrees: () => ({}), getLatestRbfSummary: () => [] }),
    './services/acceleration': defaultMock({ getAccelerations: () => ({}), getAccelerationDelta: () => [] }),
  }).default;
  const messages: any[] = [];
  websocket.addWebsocketServer({ clients: new Set([{ readyState: 1, 'want-stats': true, send: (value: string) => messages.push(JSON.parse(value)) }]) });
  const routes = isolatedBackend('api/bitcoin/bitcoin.routes.ts', {
    '../../config': defaultMock(config), '../mempool': defaultMock(mempool), '../fee-api': defaultMock(fees),
  }).default;
  return { state, config, fees, websocket, messages, routes };
}

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000));
afterEach(() => jest.restoreAllMocks());

test('bootstrap requires producer proof, empty indicators cannot qualify cached fees, and restored sync needs a new poll', () => {
  const { state, fees, websocket, messages } = fixture();
  expect(fees.getFeeEstimate()).toMatchObject({ status: 'unavailable', values: null, observedAt: null });
  websocket.handleMempoolObservation(true);
  const ready = JSON.parse(websocket.getSerializedInitData());
  expect(ready.feeEstimate).toMatchObject({ status: 'ready', tip: { height: 123, hash: HASH }, reason: null });
  expect(ready.fees).toEqual(ready.feeEstimate.values);
  expect(ready.liveObservation).toMatchObject({ status: 'ready', schemaVersion: 'universe-live-observation-v1' });
  state.synced = false;
  websocket.handleLoadingChanged({});
  expect(messages.at(-1)).toMatchObject({ loadingIndicators: {}, fees: null, feeEstimate: { status: 'syncing', values: null } });
  expect(JSON.parse(websocket.getSerializedInitData()).fees).toBeUndefined();
  state.synced = true;
  expect(fees.getFeeEstimate().status).toBe('syncing');
  websocket.handleMempoolObservation(true);
  expect(fees.getFeeEstimate().status).toBe('ready');
});

test('both incremental and block socket paths emit null fees and an explicit envelope after synchronization loss', async () => {
  const { state, websocket, messages } = fixture();
  websocket.handleMempoolObservation(true);
  state.synced = false;
  await websocket.$handleMempoolChange({}, 0, [], [], []);
  expect(messages.at(-1)).toMatchObject({ fees: null, feeEstimate: { status: 'syncing', values: null } });
  await websocket.handleNewBlock(state.tip, [], []);
  expect(messages.at(-1)).toMatchObject({ fees: null, feeEstimate: { status: 'syncing', values: null } });
});

test('bootstrap and shared publications refresh existing node metadata without renewing its observation', () => {
  const { state, websocket, messages } = fixture();
  websocket.handleMempoolObservation(true);
  const initial = JSON.parse(websocket.getSerializedInitData()).backendInfo.chainSync;
  state.nodeHeight = state.tip.height = 124;
  state.nodeObserved += 30_000;
  jest.spyOn(Date, 'now').mockReturnValue(state.nodeObserved);
  websocket.handleMempoolObservation(true);
  expect(messages.at(-1).backendInfo.chainSync).toMatchObject({ blocks: 124, checkedAt: new Date(state.nodeObserved).toISOString() });
  const current = JSON.parse(websocket.getSerializedInitData()).backendInfo.chainSync;
  expect(current.checkedAt).not.toBe(initial.checkedAt);
  expect(current.blocks).toBe(124);
  jest.spyOn(Date, 'now').mockReturnValue(state.nodeObserved + 120_001);
  const expired = JSON.parse(websocket.getSerializedInitData());
  expect(expired.backendInfo.chainSync).toEqual(current);
  expect(expired.liveObservation.status).toBe('stale');
  expect(expired.feeEstimate.values).toBeNull();
});

test('readers cannot renew observation age, stale bootstrap clears fees, and a stale block cannot renew stalled mempool', () => {
  const { state, fees, websocket } = fixture();
  websocket.handleMempoolObservation(true);
  const original = fees.getFeeEstimate().observedAt;
  const observed = Date.parse(original);
  jest.spyOn(Date, 'now').mockReturnValue(observed + 120_001);
  state.poll = observed;
  const cached = JSON.parse(websocket.getSerializedInitData());
  expect(cached.feeEstimate).toMatchObject({ status: 'stale', values: null, observedAt: original });
  expect(cached.liveObservation.status).toBe('stale');
  expect(cached.fees).toBeUndefined();
  expect(fees.observeBlock(state.tip).status).toBe('stale');
});

test('network change and invalid checkpoint cannot reuse prior successful fees', () => {
  const { config, state, fees, websocket } = fixture();
  websocket.handleMempoolObservation(true);
  config.MEMPOOL.NETWORK = 'testnet';
  expect(fees.getFeeEstimate()).toMatchObject({ network: 'testnet', status: 'unavailable', observedAt: null, tip: null, values: null });
  expect(JSON.parse(websocket.getSerializedInitData()).liveObservation).toMatchObject({ network: 'testnet', status: 'unavailable', observedAt: null });
  state.tip.id = 'invalid';
  expect(fees.observe().status).toBe('unavailable');
  state.tip.id = HASH;
  config.MEMPOOL.NETWORK = 'mainnet';
  state.minimum = NaN;
  expect(fees.observe()).toMatchObject({ status: 'unavailable', values: null, reason: 'invalid-fee-calculation' });
});

test('a block near poll expiry cannot extend fee freshness, and partial polls cannot renew it', () => {
  const { state, fees, websocket } = fixture();
  websocket.handleMempoolObservation(true);
  const pollAt = Date.parse(fees.getFeeEstimate().observedAt);
  jest.spyOn(Date, 'now').mockReturnValue(pollAt + 119_000);
  state.tip.height = state.nodeHeight = 124;
  state.nodeObserved = pollAt + 119_000;
  expect(fees.observeBlock(state.tip).status).toBe('ready');
  expect(Date.parse(fees.getFeeEstimate().observedAt)).toBe(pollAt);
  // The general mempool timestamp can advance after partial work. It is not
  // the producer's complete-poll freshness anchor.
  state.poll = pollAt + 120_000;
  jest.spyOn(Date, 'now').mockReturnValue(pollAt + 120_000);
  expect(fees.getFeeEstimate()).toMatchObject({ status: 'stale', values: null });
  expect(fees.observeBlock({ height: 125, id: HASH }).status).toBe('stale');
  websocket.handleMempoolObservation(false);
  expect(fees.getFeeEstimate()).toMatchObject({ status: 'syncing', values: null });
  expect(fees.observeBlock(state.tip).status).toBe('stale');
  state.nodeObserved = pollAt + 120_000;
  websocket.handleMempoolObservation(true);
  expect(fees.getFeeEstimate().status).toBe('ready');
});

test('actual wrong-network or forked Core evidence cannot qualify fees or live bootstrap', () => {
  const { state, fees, websocket } = fixture();
  state.network = 'signet';
  websocket.handleMempoolObservation(true);
  expect(fees.getFeeEstimate()).toMatchObject({ status: 'syncing', values: null, reason: 'node-checkpoint-unverified' });
  expect(JSON.parse(websocket.getSerializedInitData()).liveObservation.status).not.toBe('ready');
  state.network = 'main';
  state.nodeHash = 'b'.repeat(64);
  websocket.handleMempoolObservation(true);
  expect(fees.getFeeEstimate().values).toBeNull();
  state.nodeHash = HASH;
  websocket.handleMempoolObservation(true);
  expect(fees.getFeeEstimate().status).toBe('ready');
  state.nodeIbd = true;
  expect(fees.getFeeEstimate().values).toBeNull();
  expect(JSON.parse(websocket.getSerializedInitData()).liveObservation.status).not.toBe('ready');
});

test.each(['getRecommendedFees', 'getPreciseRecommendedFees'])('REST %s retains synchronization guard and rejects stale observations', method => {
  const { fees, websocket, state, routes } = fixture();
  const res = { statusCode: 200, status: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn() };
  routes[method]({}, res);
  expect(res.status).toHaveBeenCalledWith(503);
  websocket.handleMempoolObservation(true);
  routes[method]({}, res);
  expect(res.json).toHaveBeenCalledWith(fees.getObservedRecommendedFee(method === 'getPreciseRecommendedFees'));
  const observed = Date.parse(fees.getFeeEstimate().observedAt);
  jest.spyOn(Date, 'now').mockReturnValue(observed + 120_001);
  res.json.mockClear();
  res.status.mockClear();
  routes[method]({}, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).not.toHaveBeenCalled();
  state.synced = false;
  res.json.mockClear();
  routes[method]({}, res);
  expect(res.statusCode).toBe(503);
  expect(res.json).not.toHaveBeenCalled();
});
