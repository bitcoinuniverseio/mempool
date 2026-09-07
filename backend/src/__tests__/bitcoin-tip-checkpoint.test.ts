jest.mock('../api/websocket-handler', () => ({}));
jest.mock('../api/fee-api', () => ({}));
jest.mock('../api/mempool-blocks', () => ({}));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getBlockHashTip: jest.fn(async () => 'c'.repeat(64)) },
  bitcoinCoreApi: {},
}));
jest.mock('../api/common', () => ({ Common: {} }));
jest.mock('../api/backend-info', () => ({ getBackendInfo: jest.fn() }));
jest.mock('../api/transaction-utils', () => ({}));
jest.mock('../api/loading-indicators', () => ({}));
jest.mock('../api/blocks', () => ({ getBlocks: jest.fn(), getCurrentBlockHeight: jest.fn() }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({}));
jest.mock('../api/difficulty-adjustment', () => ({}));
jest.mock('../repositories/TransactionRepository', () => ({}));
jest.mock('../api/cpfp', () => ({}));
jest.mock('../tasks/pools-updater', () => ({}));
jest.mock('../api/chain-tips', () => ({}));

import { Request, Response } from 'express';
import config from '../config';
import blocks from '../api/blocks';
import bitcoinApi from '../api/bitcoin/bitcoin-api-factory';
import bitcoinRoutes from '../api/bitcoin/bitcoin.routes';
import { BlockExtended } from '../mempool.interfaces';

type TipRoutes = {
  getBlockTipHeight(req: Request, res: Response): void;
  getBlockTipHash(req: Request, res: Response): void;
};

function request(): Request {
  return { accepts: () => false } as unknown as Request;
}

function response() {
  const res = {
    send: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn(),
    header: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  jest.mocked(res.status).mockReturnValue(res);
  return res;
}

function cached(heights: number[]): BlockExtended[] {
  return heights.map((height) => ({ height, id: height.toString(16).padStart(64, '0') })) as BlockExtended[];
}

describe('legacy tip routes read one completed block', () => {
  const routes = bitcoinRoutes as unknown as TipRoutes;
  const initialNetwork = config.MEMPOOL.NETWORK;

  beforeEach(() => {
    config.MEMPOOL.NETWORK = 'mainnet';
    // The cache trails Core; Core's best hash is not the cache tip.
    jest.mocked(blocks.getBlocks).mockReset().mockReturnValue(cached([965903, 965904, 965905]));
    jest.mocked(blocks.getCurrentBlockHeight).mockReset().mockReturnValue(965905);
  });

  afterAll(() => {
    config.MEMPOOL.NETWORK = initialNetwork;
  });

  it('answers the height and the hash of the same cached block', () => {
    const height = response();
    const hash = response();
    routes.getBlockTipHeight(request(), height);
    routes.getBlockTipHash(request(), hash);
    expect(jest.mocked(height.send).mock.calls[0][0]).toBe('965905');
    expect(jest.mocked(hash.send).mock.calls[0][0]).toBe((965905).toString(16).padStart(64, '0'));
    expect(jest.mocked(bitcoinApi.$getBlockHashTip)).not.toHaveBeenCalled();
    expect(jest.mocked(hash.setHeader)).toHaveBeenCalledWith('content-type', 'text/plain');
  });

  it('answers 503 for both routes when no completed block is cached', () => {
    jest.mocked(blocks.getBlocks).mockReturnValue([]);
    const height = response();
    const hash = response();
    routes.getBlockTipHeight(request(), height);
    routes.getBlockTipHash(request(), hash);
    expect(jest.mocked(height.status)).toHaveBeenCalledWith(503);
    expect(jest.mocked(hash.status)).toHaveBeenCalledWith(503);
    expect(jest.mocked(hash.send).mock.calls[0][0]).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats the genesis block as a valid checkpoint rather than an empty cache', () => {
    jest.mocked(blocks.getBlocks).mockReturnValue(cached([0]));
    const height = response();
    routes.getBlockTipHeight(request(), height);
    expect(jest.mocked(height.status)).not.toHaveBeenCalledWith(503);
    expect(jest.mocked(height.send).mock.calls[0][0]).toBe('0');
  });

  it('follows a new completed block and a replaced tip', () => {
    const before = response();
    routes.getBlockTipHash(request(), before);
    jest.mocked(blocks.getBlocks).mockReturnValue(cached([965904, 965905, 965906]));
    const after = response();
    routes.getBlockTipHash(request(), after);
    expect(jest.mocked(after.send).mock.calls[0][0]).toBe((965906).toString(16).padStart(64, '0'));
    // A one-block reorganization replaces the tip with a different hash.
    const reorg = [...cached([965904, 965905]), { height: 965906, id: 'f'.repeat(64) } as BlockExtended];
    jest.mocked(blocks.getBlocks).mockReturnValue(reorg);
    const replaced = response();
    routes.getBlockTipHash(request(), replaced);
    expect(jest.mocked(replaced.send).mock.calls[0][0]).toBe('f'.repeat(64));
  });
});
