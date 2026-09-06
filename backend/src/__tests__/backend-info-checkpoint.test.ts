jest.mock('../api/websocket-handler', () => ({}));
jest.mock('../api/fee-api', () => ({}));
jest.mock('../api/mempool-blocks', () => ({}));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({}));
jest.mock('../api/common', () => ({ Common: {} }));
jest.mock('../api/backend-info', () => ({ getBackendInfo: jest.fn() }));
jest.mock('../api/transaction-utils', () => ({}));
jest.mock('../api/loading-indicators', () => ({}));
jest.mock('../api/blocks', () => ({ getBlocks: jest.fn() }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({}));
jest.mock('../api/difficulty-adjustment', () => ({}));
jest.mock('../repositories/TransactionRepository', () => ({}));
jest.mock('../api/cpfp', () => ({}));
jest.mock('../tasks/pools-updater', () => ({}));
jest.mock('../api/chain-tips', () => ({}));

import { Request, Response } from 'express';
import config from '../config';
import backendInfo from '../api/backend-info';
import blocks from '../api/blocks';
import bitcoinRoutes from '../api/bitcoin/bitcoin.routes';
import { BlockExtended, IBackendInfo } from '../mempool.interfaces';

const indexedHash = 'a'.repeat(64);
const observedAt = '2026-09-06T13:00:00.000Z';
const info: IBackendInfo = {
  hostname: 'local', gitCommit: 'candidate', version: '1', lightning: false,
  coreVersion: '/Satoshi/', osVersion: 'local', backend: 'electrum',
  chainSync: {
    blocks: 965768, headers: 965768, initialBlockDownload: false,
    verificationProgress: 1, checkedAt: '2026-09-06T12:59:45.000Z',
  },
};

function readResponse(): { body: IBackendInfo & { checkpoint?: unknown }; response: Response } {
  const response = { json: jest.fn(), setHeader: jest.fn() } as unknown as Response;
  const route = bitcoinRoutes as unknown as { getBackendInfo(req: Request, res: Response): void };
  route.getBackendInfo({} as Request, response);
  return { body: jest.mocked(response.json).mock.calls[0][0], response };
}

describe('backend metadata indexed checkpoint', () => {
  const initialNetwork = config.MEMPOOL.NETWORK;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(observedAt));
    config.MEMPOOL.NETWORK = 'mainnet';
    jest.mocked(backendInfo.getBackendInfo).mockReturnValue(info);
    jest.mocked(blocks.getBlocks).mockReset().mockReturnValue([
      { height: 965554, id: 'b'.repeat(64) },
      { height: 965555, id: indexedHash },
    ] as BlockExtended[]);
  });

  afterEach(() => {
    config.MEMPOOL.NETWORK = initialNetwork;
    jest.useRealTimers();
  });

  it('pairs height and hash from one indexed block instead of the newer Core tip', () => {
    const { body } = readResponse();
    expect(body.checkpoint).toEqual({
      chain: 'bitcoin', network: 'mainnet', heightAtomic: '965555',
      blockHash: indexedHash, observedAt,
    });
    expect(body.chainSync).toEqual(info.chainSync);
    expect(info).not.toHaveProperty('checkpoint');
    expect(blocks.getBlocks).toHaveBeenCalledTimes(1);
  });

  it.each(['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'] as const)(
    'scopes the cached checkpoint to Bitcoin %s', (network) => {
      config.MEMPOOL.NETWORK = network;
      expect(readResponse().body.checkpoint).toMatchObject({ chain: 'bitcoin', network });
    },
  );

  it.each([
    ['liquid', 'mainnet'], ['liquidtestnet', 'testnet'],
  ] as const)('preserves the %s chain context', (configured, network) => {
    config.MEMPOOL.NETWORK = configured;
    expect(readResponse().body.checkpoint).toMatchObject({ chain: 'liquid', network });
  });

  it.each([
    { cached: [] }, { cached: [{ height: 965555, id: 'malformed' }] },
    { cached: [{ height: -1, id: indexedHash }] }, { cached: [{ height: 1.5, id: indexedHash }] },
    { cached: [{ height: Number.MAX_SAFE_INTEGER + 1, id: indexedHash }] },
  ])('does not invent an indexed checkpoint from an unusable cache: %j', ({ cached }) => {
    jest.mocked(blocks.getBlocks).mockReturnValue(cached as BlockExtended[]);
    expect(readResponse().body.checkpoint).toBeNull();
  });

  it('records when the cache was read, independently of Core sampling and block time', () => {
    jest.setSystemTime(new Date('2026-09-06T13:00:10.000Z'));
    expect(readResponse().body.checkpoint).toMatchObject({ observedAt: '2026-09-06T13:00:10.000Z' });
    expect(readResponse().body.chainSync?.checkedAt).toBe('2026-09-06T12:59:45.000Z');
  });

  it('publishes genesis and prevents response caching', () => {
    jest.mocked(blocks.getBlocks).mockReturnValue([{ height: 0, id: indexedHash }] as BlockExtended[]);
    const { body, response } = readResponse();
    expect(body.checkpoint).toMatchObject({ heightAtomic: '0', blockHash: indexedHash });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
