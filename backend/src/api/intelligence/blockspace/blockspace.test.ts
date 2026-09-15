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

  it('removes orphan regimes and computes the median of retained fee samples', () => {
    blockspaceService.observeBlock(block(10, 1000, 5), [tx({})]);
    const detectedAt = blockspaceService.getRegimes()[0].detected_at;
    blockspaceService.observeBlock(block(11, 1600, 6), [tx({})]);
    blockspaceService.observeBlock(block(12, 2200, 28), [tx({})]);
    expect(blockspaceService.getRegimes()[0].median_feerate).toBe(6);
    blockspaceService.observeBlock(block(13, 2800, 120), [tx({})]);
    expect(blockspaceService.getRegimes()[0].regime_type).toBe('extreme_congestion');
    blockspaceService.observeBlock({ ...block(12, 2300, 7), id: 'f'.repeat(64) }, [tx({})]);
    expect(blockspaceService.getRegimes()).toHaveLength(1);
    expect(blockspaceService.getRegimes()[0]).toMatchObject({ start_height: 10, median_feerate: 6, detected_at: detectedAt });
    expect(blockspaceService.getOverview().checkpoint).toEqual({ height: 12, hash: 'f'.repeat(64) });
  });

  it('drops regimes outside the retained block window', () => {
    for (let height = 1; height <= 300; height++) blockspaceService.observeBlock(block(height, height * 600, height === 1 ? 120 : 2), [tx({})]);
    expect(blockspaceService.getRegimes()).toHaveLength(1);
    expect(blockspaceService.getRegimes()[0].start_height).toBe(13);
  });

  it('is unavailable until a block was observed', () => {
    for (const read of [() => blockspaceService.getOverview(), () => blockspaceService.getTaxonomy(), () => blockspaceService.getComposition(), () => blockspaceService.getRegimes()]) {
      expect(read).toThrow(BlockspaceUnavailableError);
    }
  });

  it('shares are exact fractions of the observed window and regimes follow median fee bands', () => {
    blockspaceService.observeBlock({ ...block(10, 1_000_000, 4, 4000, 1000), tx_count: 2 }, [tx({ vin: [{ is_coinbase: true }], weight: 1000, fee: 0 } as never), tx({ weight: 3000, fee: 1000 })]);
    blockspaceService.observeBlock({ ...block(11, 1_000_600, 40, 4000, 2000), tx_count: 1 }, [tx({ txid: 'b'.repeat(64), weight: 4000, fee: 2000, vout: [{ value: 0, scriptpubkey: EDICT, scriptpubkey_type: 'op_return' }] } as never)]);
    const taxonomy = blockspaceService.getTaxonomy();
    const find = (id: string) => taxonomy.find(c => c.class_id === id)!;
    expect(find('class-simple-payment')).toMatchObject({ tx_count_24h: 1, weight_share_percentage: 37.5, fee_share_percentage: 33.33 });
    expect(find('class-runes')).toMatchObject({ tx_count_24h: 1, weight_share_percentage: 50, fee_share_percentage: 66.67 });
    expect(find('class-coinbase')).toMatchObject({ tx_count_24h: 1, weight_share_percentage: 12.5, fee_share_percentage: 0 });
    const overview = blockspaceService.getOverview();
    expect(overview.window).toMatchObject({ blocks: 2, from_height: 10, to_height: 11, covers_24h: false });
    expect(overview.median_feerate_24h).toBe(22);
    const regimes = blockspaceService.getRegimes();
    expect(regimes.map(r => [r.start_height, r.end_height, r.regime_type])).toEqual([[11, undefined, 'data_minting_spike'], [10, 10, 'consolidation_friendly']]);
    const composition = blockspaceService.getComposition(1);
    expect(composition).toHaveLength(1);
    expect(composition[0]).toMatchObject({ block_height: 11, arbitrary_data_weight: 4000, monetary_weight: 0 });
  });

  it('transaction semantics come from the index and an unknown txid is null', async () => {
    jest.mocked(bitcoinApi.$getRawTransaction).mockRejectedValueOnce({ response: { status: 404, data: 'Transaction not found' } });
    expect(await blockspaceService.getTxSemantics('c'.repeat(64))).toBeNull();
    await expect(blockspaceService.getTxSemantics('not-a-txid')).rejects.toMatchObject({ status: 400 });
    jest.mocked(bitcoinApi.$getRawTransaction).mockResolvedValueOnce(tx({ txid: 'c'.repeat(64), weight: 564, fee: 1420, status: { confirmed: true, block_height: 5 } } as never) as never);
    const evidence = await blockspaceService.getTxSemantics('c'.repeat(64));
    expect(evidence).toMatchObject({ primary_class: 'Simple Payments', class_id: 'class-simple-payment', weight: 564, fee_sats: 1420, feerate_sats_vb: 10.07, confirmed: true, block_height: 5 });
  });
});

describe('blockspace unknown evidence and coverage boundaries', () => {
  beforeEach(() => { blockspaceService.reset(); jest.mocked(bitcoinApi.$getRawTransaction).mockReset(); });
  it.each([new Error('ECONNREFUSED'), { code: -5 }, { response: { status: 404, data: 'Route not found' } }, { response: { status: 503 } }])('keeps reader failure unavailable rather than absent', async error => {
    jest.mocked(bitcoinApi.$getRawTransaction).mockRejectedValueOnce(error);
    await expect(blockspaceService.getTxSemantics('a'.repeat(64))).rejects.toMatchObject({ code: 'unavailable-bitcoin-reader', status: 503 });
  });
  it('preserves missing fee/weight/status as null and asks Core conversion to calculate fees', async () => {
    jest.mocked(bitcoinApi.$getRawTransaction).mockResolvedValueOnce(tx({ fee: undefined, weight: undefined, status: undefined }) as never);
    expect(await blockspaceService.getTxSemantics('a'.repeat(64))).toMatchObject({ fee_sats: null, weight: null, feerate_sats_vb: null, confirmed: null, block_height: null });
    expect(bitcoinApi.$getRawTransaction).toHaveBeenCalledWith('a'.repeat(64), false, true);
  });
  it('rejects mismatched source transaction IDs', async () => {
    jest.mocked(bitcoinApi.$getRawTransaction).mockResolvedValueOnce(tx({ txid: 'b'.repeat(64) }) as never);
    await expect(blockspaceService.getTxSemantics('a'.repeat(64))).rejects.toMatchObject({ code: 'malformed-transaction-source' });
  });
  it('does not manufacture zero aggregate fees/weights or a current regime from missing observations', () => {
    blockspaceService.observeBlock({ ...block(1, 1000, 1), extras: {}, weight: undefined } as never, [tx({ fee: undefined, weight: undefined })]);
    const result = blockspaceService.getOverview();
    expect(result).toMatchObject({ median_feerate_24h: null, current_regime: null, fee_metric: 'median_of_observed_block_median_feerates' });
    expect(result.composition_timeseries[0]).toMatchObject({ total_fee_sats: null, total_weight: null, monetary_weight: null, layer2_weight: null });
    expect(result.taxonomy_classes.find(c => c.class_id === 'class-simple-payment')).toMatchObject({ weight_share_percentage: null, fee_share_percentage: null });
  });
  it('uses observation time, not read time, and does not call a gapped span complete', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T00:00:00Z'));
    try {
      blockspaceService.observeBlock(block(1, 1000, 1), [tx({})]);
      blockspaceService.observeBlock(block(3, 90000, 2), [tx({})]);
      const result = blockspaceService.getOverview();
      expect(result.window).toMatchObject({ covers_24h: false, contiguous: false });
      jest.setSystemTime(new Date('2026-09-15T01:00:00Z'));
      expect(blockspaceService.getOverview().last_updated).toBe(result.last_updated);
    } finally { jest.useRealTimers(); }
  });
  it('keeps chain completeness unknown without parent hashes or transaction counts', () => {
    blockspaceService.observeBlock(block(1, 1000, 1), [tx({})]);
    blockspaceService.observeBlock(block(2, 90000, 2), [tx({})]);
    expect(blockspaceService.getOverview().window).toMatchObject({ covers_24h: null, contiguous: null, transactions_complete: null });
  });
  it('establishes only the labeled timestamp span when actual parent links and counts are supplied', () => {
    const first = { ...block(1, 1000, 1), tx_count: 1 };
    const second = { ...block(2, 90000, 2), tx_count: 1, previousblockhash: first.id };
    blockspaceService.observeBlock(first, [tx({})]); blockspaceService.observeBlock(second, [tx({})]);
    expect(blockspaceService.getOverview().window).toMatchObject({ covers_24h: true, contiguous: true, transactions_complete: true, time_basis: 'block_timestamp_relative_to_observed_tip' });
  });
});

it.each([undefined,2])('does not infer exact class shares from unknown/incomplete transaction coverage %p',tx_count=>{
 blockspaceService.reset();blockspaceService.observeBlock({...block(5,1000,2),tx_count} as unknown as BlockExtended,[tx({})]);
 expect(blockspaceService.getTaxonomy().every(c=>c.weight_share_percentage===null&&c.fee_share_percentage===null)).toBe(true);
 expect(blockspaceService.getComposition()[0]).toMatchObject({monetary_weight:null,arbitrary_data_weight:null,consolidation_weight:null});
 expect(blockspaceService.getTaxonomy().find(c=>c.class_id==='class-simple-payment')?.tx_count_24h).toBe(1);
});
