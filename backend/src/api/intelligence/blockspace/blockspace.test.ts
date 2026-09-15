jest.mock('../../bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: { $getRawTransaction: jest.fn() }, bitcoinCoreApi: {} }));

import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import { blockspaceService, BlockspaceUnavailableError, classifyBlockspace, CLASSES } from './blockspace.service';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';

const EDICT = '6a5d0800c0a23301904e01';
const tx = (over: Partial<TransactionExtended>): TransactionExtended => ({ txid: 'a'.repeat(64), weight: 400, fee: 100, vin: [{}], vout: [{ value: 1 }, { value: 2 }], ...over } as unknown as TransactionExtended);
const block = (height: number, timestamp: number, medianFee: number, weight = 4000, fees = 1000): BlockExtended => ({ height, id: height.toString(16).padStart(64, '0'), timestamp, weight, extras: { medianFee, totalFees: fees } } as unknown as BlockExtended);

describe('blockspace classification reads the transaction', () => {
  it.each([
    ['coinbase', tx({ vin: [{ is_coinbase: true }] } as never), 'class-coinbase'],
    ['runes', tx({ vout: [{ value: 0, scriptpubkey: EDICT, scriptpubkey_type: 'op_return' }] } as never), 'class-runes'],
    ['data carrier', tx({ vout: [{ value: 0, scriptpubkey: '6a0401020304', scriptpubkey_type: 'op_return' }] } as never), 'class-op-return'],
    ['coinjoin-like', tx({ vin: [{}, {}, {}, {}, {}], vout: [1, 1, 1, 1, 1, 2].map(value => ({ value })) } as never), 'class-coinjoin-like'],
    ['batched payout', tx({ vin: [{}], vout: Array.from({ length: 12 }, (_, i) => ({ value: i })) } as never), 'class-batched-payout'],
    ['consolidation', tx({ vin: [{}, {}, {}, {}, {}, {}], vout: [{ value: 5 }] } as never), 'class-consolidation'],
    ['simple payment', tx({}), 'class-simple-payment'],
    ['other', tx({ vin: [{}, {}, {}], vout: [{ value: 1 }, { value: 2 }, { value: 3 }] } as never), 'class-other-monetary'],
  ])('%s', (_name, transaction, classId) => {
    expect(classifyBlockspace(transaction).class_id).toBe(classId);
    expect(CLASSES.some(c => c.class_id === classId)).toBe(true);
  });

  it('tags rbf signaling and segwit from the inputs', () => {
    const tags = classifyBlockspace(tx({ vin: [{ sequence: 0xfffffffd, witness: ['00'] }] } as never)).tags;
    expect(tags).toEqual(expect.arrayContaining(['rbf_signaling', 'segwit']));
  });
});

describe('blockspace reads come from observed blocks', () => {
  beforeEach(() => blockspaceService.reset());

  it('is unavailable until a block was observed', () => {
    for (const read of [() => blockspaceService.getOverview(), () => blockspaceService.getTaxonomy(), () => blockspaceService.getComposition(), () => blockspaceService.getRegimes()]) {
      expect(read).toThrow(BlockspaceUnavailableError);
    }
  });

  it('shares are exact fractions of the observed window and regimes follow median fee bands', () => {
    blockspaceService.observeBlock(block(10, 1_000_000, 4, 4000, 1000), [tx({ vin: [{ is_coinbase: true }], weight: 1000, fee: 0 } as never), tx({ weight: 3000, fee: 1000 })]);
    blockspaceService.observeBlock(block(11, 1_000_600, 40, 4000, 2000), [tx({ txid: 'b'.repeat(64), weight: 4000, fee: 2000, vout: [{ value: 0, scriptpubkey: EDICT, scriptpubkey_type: 'op_return' }] } as never)]);
    const taxonomy = blockspaceService.getTaxonomy();
    const find = (id: string) => taxonomy.find(c => c.class_id === id)!;
    expect(find('class-simple-payment')).toMatchObject({ tx_count_24h: 1, weight_share_percentage: 37.5, fee_share_percentage: 33.33 });
    expect(find('class-runes')).toMatchObject({ tx_count_24h: 1, weight_share_percentage: 50, fee_share_percentage: 66.67 });
    expect(find('class-coinbase')).toMatchObject({ tx_count_24h: 1, weight_share_percentage: 12.5, fee_share_percentage: 0 });
    const overview = blockspaceService.getOverview();
    expect(overview.window).toEqual({ blocks: 2, from_height: 10, to_height: 11, covers_24h: false });
    expect(overview.median_feerate_24h).toBe(40);
    const regimes = blockspaceService.getRegimes();
    expect(regimes.map(r => [r.start_height, r.end_height, r.regime_type])).toEqual([[11, undefined, 'data_minting_spike'], [10, 10, 'consolidation_friendly']]);
    const composition = blockspaceService.getComposition(1);
    expect(composition).toHaveLength(1);
    expect(composition[0]).toMatchObject({ block_height: 11, arbitrary_data_weight: 4000, monetary_weight: 0 });
  });

  it('transaction semantics come from the index and an unknown txid is null', async () => {
    jest.mocked(bitcoinApi.$getRawTransaction).mockRejectedValueOnce(new Error('404'));
    expect(await blockspaceService.getTxSemantics('c'.repeat(64))).toBeNull();
    expect(await blockspaceService.getTxSemantics('not-a-txid')).toBeNull();
    jest.mocked(bitcoinApi.$getRawTransaction).mockResolvedValueOnce(tx({ weight: 564, fee: 1420, status: { confirmed: true, block_height: 5 } } as never) as never);
    const evidence = await blockspaceService.getTxSemantics('c'.repeat(64));
    expect(evidence).toMatchObject({ primary_class: 'Simple Payments', class_id: 'class-simple-payment', weight: 564, fee_sats: 1420, feerate_sats_vb: 10.07, confirmed: true, block_height: 5 });
  });
});
