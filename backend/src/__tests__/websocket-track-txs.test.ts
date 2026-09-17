const mempoolState: { txs: Record<string, any> } = { txs: {} };
const rbfState: { replaced: Record<string, string> } = { replaced: {} };
const nodeState = { getRawTransaction: jest.fn() };

jest.mock('../config', () => ({
  __esModule: true,
  default: {
    MEMPOOL: { NETWORK: 'signet', BACKEND: 'electrum', INITIAL_BLOCKS_AMOUNT: 8, MAX_TRACKED_ADDRESSES: 1, API_URL_PREFIX: '/api/v1/' },
    FIAT_PRICE: { ENABLED: false },
    DATABASE: { ENABLED: false },
    REDIS: { ENABLED: false },
    STATISTICS: { ENABLED: false },
    MEMPOOL_SERVICES: { ACCELERATIONS: false },
  },
}));
jest.mock('../api/mempool', () => ({
  __esModule: true,
  default: { getMempool: () => mempoolState.txs, getMempoolInfo: () => ({}), getVBytesPerSecond: () => 0, getLatestTransactions: () => [], getAccelerationPositions: () => undefined, isInSync: () => true },
}));
jest.mock('../api/rbf-cache', () => ({
  __esModule: true,
  default: { getReplacedBy: (txid: string) => rbfState.replaced[txid] },
}));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getRawTransaction: (...args: unknown[]) => nodeState.getRawTransaction(...args), getHealthStatus: () => [] },
}));
jest.mock('../api/blocks', () => ({ __esModule: true, default: { getBlocks: () => [], getCurrentBlockHeight: () => 0 } }));
jest.mock('../api/backend-info', () => ({ __esModule: true, default: { getBackendInfo: () => ({}) } }));
jest.mock('../api/mempool-blocks', () => ({ __esModule: true, default: { getMempoolBlocks: () => [] } }));
jest.mock('../api/loading-indicators', () => ({ __esModule: true, default: { getLoadingIndicators: () => ({}) } }));
jest.mock('../api/transaction-utils', () => ({ __esModule: true, default: {} }));
jest.mock('../api/difficulty-adjustment', () => ({ __esModule: true, default: { getDifficultyAdjustment: () => null } }));
jest.mock('../api/fee-api', () => ({ __esModule: true, default: { getPreciseRecommendedFee: () => ({}) } }));
jest.mock('../repositories/BlocksAuditsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/BlocksSummariesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/AccelerationRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../api/audit', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: { getLatestPrices: () => ({}), getAdvertisedPrices: () => ({}), getPriceObservation: () => ({}) } }));
jest.mock('../api/services/acceleration', () => ({ __esModule: true, default: {} }));
jest.mock('../api/statistics/statistics', () => ({ __esModule: true, default: {} }));
jest.mock('../api/services/wallets', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-second-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/cpfp', () => ({ calculateMempoolTxCpfp: () => undefined }));
jest.mock('../api/services/stratum', () => ({ __esModule: true, default: {} }));

import websocketHandler from '../api/websocket-handler';

const TXID_MEMPOOL = '1'.repeat(64);
const TXID_REPLACED = '2'.repeat(64);
const TXID_CONFIRMED = '3'.repeat(64);
const TXID_UNKNOWN = '4'.repeat(64);
const TXID_DOWN = '5'.repeat(64);
const TXID_NODE_MEMPOOL = '6'.repeat(64);
const HASH = 'a'.repeat(64);

function connect(): { send: (message: Record<string, unknown>) => Promise<Record<string, any>[]> } {
  const events: Record<string, any> = {};
  const clientEvents: Record<string, any> = {};
  const messages: Record<string, any>[] = [];
  const server = { on: (name: string, fn: any) => { events[name] = fn; } };
  (websocketHandler as any).webSocketServers = [];
  websocketHandler.addWebsocketServer(server as any);
  websocketHandler.setupConnectionHandling();
  const client = { on: (name: string, fn: any) => { clientEvents[name] = fn; }, send: (data: string) => messages.push(JSON.parse(data)), close: () => { throw new Error('unexpected close'); } };
  events.connection(client, { headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  return {
    send: /** @asyncUnsafe test helper */ async (message) => {
      messages.length = 0;
      await clientEvents.message(JSON.stringify(message));
      return messages;
    },
  };
}

describe('websocket track-txs initial status', () => {
  beforeEach(() => {
    mempoolState.txs = { [TXID_MEMPOOL]: { txid: TXID_MEMPOOL, position: { block: 0, vsize: 100 } } };
    rbfState.replaced = { [TXID_REPLACED]: 'b'.repeat(64) };
    nodeState.getRawTransaction.mockReset().mockImplementation(async (txid: string) => {
      if (txid === TXID_CONFIRMED) {
        return { txid, status: { confirmed: true, block_height: 250_000, block_hash: HASH } };
      }
      if (txid === TXID_NODE_MEMPOOL) {
        return { txid, status: { confirmed: false } };
      }
      if (txid === TXID_DOWN) {
        throw new Error('ECONNREFUSED');
      }
      throw new Error('No such mempool or blockchain transaction');
    });
  });

  it('never reports a never-seen transaction as confirmed', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const socket = connect();
    const [message] = await socket.send({ 'track-txs': [TXID_UNKNOWN] });
    expect(message['tracked-txs'][TXID_UNKNOWN]).toEqual({ confirmed: false, status: 'unknown' });
    expect(nodeState.getRawTransaction).toHaveBeenCalledWith(TXID_UNKNOWN, true, false);
  });

  it('distinguishes mempool, replaced, confirmed, node-mempool and unavailable', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const socket = connect();
    const [message] = await socket.send({
      'track-txs': [TXID_MEMPOOL, TXID_REPLACED, TXID_CONFIRMED, TXID_NODE_MEMPOOL, TXID_DOWN],
    });
    const tracked = message['tracked-txs'];
    expect(tracked[TXID_MEMPOOL]).toEqual({ confirmed: false, status: 'mempool', position: { block: 0, vsize: 100 } });
    expect(tracked[TXID_REPLACED]).toEqual({ confirmed: false, status: 'replaced', replacedBy: 'b'.repeat(64) });
    expect(tracked[TXID_CONFIRMED]).toEqual({ confirmed: true, status: 'confirmed', blockHeight: 250_000, blockHash: HASH });
    expect(tracked[TXID_NODE_MEMPOOL]).toEqual({ confirmed: false, status: 'mempool' });
    expect(tracked[TXID_DOWN]).toEqual({ status: 'unavailable' });
    expect(tracked[TXID_DOWN].confirmed).toBeUndefined();
    // Local and replaced transactions never reach the node.
    expect(nodeState.getRawTransaction).toHaveBeenCalledTimes(3);
  });

  it('does not confirm on a node answer without a real block identity', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    nodeState.getRawTransaction.mockResolvedValueOnce({ txid: TXID_CONFIRMED, status: { confirmed: true } });
    const socket = connect();
    const [message] = await socket.send({ 'track-txs': [TXID_CONFIRMED] });
    expect(message['tracked-txs'][TXID_CONFIRMED].confirmed).toBe(false);
  });

  it('deduplicates ids and refuses an oversized request', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const socket = connect();
    const [message] = await socket.send({ 'track-txs': [TXID_UNKNOWN, TXID_UNKNOWN, 'not-a-txid'] });
    expect(Object.keys(message['tracked-txs'])).toEqual([TXID_UNKNOWN]);
    expect(nodeState.getRawTransaction).toHaveBeenCalledTimes(1);

    const many = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, '0'));
    const [refused] = await socket.send({ 'track-txs': many });
    expect(refused['track-txs-error']).toContain('maximum of 100');
    expect(refused['tracked-txs']).toBeUndefined();
    expect(nodeState.getRawTransaction).toHaveBeenCalledTimes(1);
  });
});
