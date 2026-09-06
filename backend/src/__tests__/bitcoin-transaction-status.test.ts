jest.mock('../api/blocks', () => ({
  __esModule: true,
  default: { getCurrentBlockHeight: jest.fn(() => 965555) },
}));
jest.mock('../api/mempool', () => ({
  __esModule: true,
  default: { getMempool: () => ({}), isInSync: () => true },
}));
jest.mock('../api/transaction-utils', () => ({
  __esModule: true,
  default: { convertScriptSigAsm: () => '' },
}));
jest.mock('../api/common', () => ({ Common: {} }));

import BitcoinApi from '../api/bitcoin/bitcoin-api';
import blocks from '../api/blocks';

const TXID = '203612a2ba2fb9303cd170b4b794b74bcfde55b100725d4b7c46cf89286c850a';
const HASH = '00000000000000000001014ea6d7cc2bceaa744c0a57001db6150f7e6d95769d';
const BLOCK = { hash: HASH, height: 965545, time: 1788571675, confirmations: 224 };
const RAW = {
  txid: TXID, version: 2, locktime: 0, size: 151, weight: 400,
  vin: [{ coinbase: '00', sequence: 4294967295 }],
  vout: [{ value: 0.00062817, scriptPubKey: { hex: '', type: 'scripthash' } }],
  blockhash: HASH, blocktime: BLOCK.time, confirmations: 224,
};

function fixture(transaction = RAW) {
  const client = {
    getRawTransaction: jest.fn().mockResolvedValue(transaction),
    getBlockHeader: jest.fn().mockResolvedValue(BLOCK),
    getBlock: jest.fn().mockResolvedValue({ ...BLOCK, tx: [transaction] }),
    getBlockHash: jest.fn().mockResolvedValue(HASH),
    getMempoolEntry: jest.fn().mockResolvedValue({ fees: { base: 0.00000199 } }),
  };
  return { client, api: new BitcoinApi(client) };
}

describe('Bitcoin Core transaction confirmation identity', () => {
  beforeEach(() => jest.mocked(blocks.getCurrentBlockHeight).mockReturnValue(965555));

  it('keeps a transaction at its block header height while node confirmations advance ahead of the index', async () => {
    const { api, client } = fixture();
    client.getRawTransaction.mockResolvedValueOnce({ ...RAW, confirmations: 222 });
    const first = await api.$getRawTransaction(TXID);
    const second = await api.$getRawTransaction(TXID);
    for (const transaction of [first, second]) {
      expect(transaction.status).toEqual({ confirmed: true, block_height: 965545, block_hash: HASH, block_time: BLOCK.time });
      expect(transaction.vout[0].value).toBe(62817);
    }
    expect(client.getBlockHeader).toHaveBeenCalledWith(HASH, true);
  });

  it('does not infer a height when the block header read fails', async () => {
    const { api, client } = fixture();
    client.getBlockHeader.mockRejectedValue(new Error('header unavailable'));
    await expect(api.$getRawTransaction(TXID)).rejects.toThrow('header unavailable');
  });

  it.each([
    { ...BLOCK, hash: 'f'.repeat(64) },
    { ...BLOCK, height: -1 },
    { ...BLOCK, height: 965545.5 },
    { ...BLOCK, height: undefined },
  ])('rejects a block header that cannot identify the confirmation: %j', async header => {
    const { api, client } = fixture();
    client.getBlockHeader.mockResolvedValue(header);
    await expect(api.$getRawTransaction(TXID)).rejects.toThrow('Invalid transaction block header');
  });

  it('does not confirm a block that left the active chain between the two RPC reads', async () => {
    const { api, client } = fixture();
    client.getBlockHeader.mockResolvedValue({ ...BLOCK, confirmations: -1 });
    expect((await api.$getRawTransaction(TXID)).status).toEqual({ confirmed: false });
  });

  it('keeps an unconfirmed transaction unconfirmed and reads its mempool fee without a header request', async () => {
    const { api, client } = fixture({ ...RAW, confirmations: 0 });
    const transaction = await api.$getRawTransaction(TXID);
    expect(transaction.status).toEqual({ confirmed: false });
    expect(transaction.fee).toBe(199);
    expect(client.getBlockHeader).not.toHaveBeenCalled();
  });

  it('uses an already fetched verbose block for block transaction pages without per-transaction header requests', async () => {
    const { api, client } = fixture();
    const [transaction] = await api.$getTxsForBlock(HASH);
    expect(transaction.status).toEqual({ confirmed: true, block_height: BLOCK.height, block_hash: HASH, block_time: BLOCK.time });
    expect(client.getBlockHeader).not.toHaveBeenCalled();
  });

  it('preserves the genesis transaction block identity without deriving confirmations from the index tip', async () => {
    const { api, client } = fixture();
    client.getRawTransaction.mockRejectedValue(new Error('The genesis block coinbase is not considered an ordinary transaction'));
    client.getBlock.mockResolvedValue({ ...BLOCK, height: 0, tx: [{ ...RAW, confirmations: undefined, blockhash: undefined }] });
    const transaction = await api.$getRawTransaction(TXID);
    expect(transaction.status).toEqual({ confirmed: true, block_height: 0, block_hash: HASH, block_time: BLOCK.time });
    expect(client.getBlockHeader).not.toHaveBeenCalled();
  });
});
