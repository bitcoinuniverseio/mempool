jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../../mempool-blocks', () => ({ __esModule: true, default: { getMempoolBlocksWithTransactions: () => [] } }));

import { templateCollectorService } from './template-collector.service';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';

const gbt = (height: number, txs: { txid: string; fee: number; weight: number }[]) => ({ height, previousblockhash: 'p'.repeat(64), transactions: txs.map(tx => ({ ...tx, hash: tx.txid, sigops: 1 })), coinbasevalue: 5000 });
const block = (height: number, id: string, fees: number, txids: string[]): [BlockExtended, TransactionExtended[]] => [
  { height, id, previousblockhash: 'p'.repeat(64), timestamp: 2_000_000, weight: 4000, extras: { totalFees: fees } } as unknown as BlockExtended,
  [{ txid: 'coinbase', vin: [{ is_coinbase: true }], fee: 0 }, ...txids.map(txid => ({ txid, vin: [{}], fee: 10 }))] as unknown as TransactionExtended[],
];

describe('template collector: real sources only', () => {
  beforeEach(() => {
    templateCollectorService.resetForTests();
    templateCollectorService.readProjection = () => null;
  });

  it('updates projection parent on a block and refuses an in-flight response for the old tip', async () => {
    templateCollectorService.fetchCoreTemplate = async () => gbt(100, []);
    await templateCollectorService.collectCoreTemplate(1000);
    let resolveTemplate!: (value: ReturnType<typeof gbt>) => void;
    templateCollectorService.fetchCoreTemplate = () => new Promise(resolve => { resolveTemplate = resolve; });
    const pending = templateCollectorService.collectCoreTemplate(1500);
    templateCollectorService.observeBlock(...block(100, '1'.repeat(64), 0, []), 2000);
    resolveTemplate(gbt(100, []));
    expect(await pending).toBeNull();
    templateCollectorService.readProjection = () => ({ transactionIds: [], totalFees: 0, blockVSize: 0, nTx: 0 });
    expect(templateCollectorService.collectProjection(2100)).toMatchObject({ height: 101, prev_block_hash: '1'.repeat(64) });
    expect(templateCollectorService.compareMinedBlock('1'.repeat(64))?.template_age_seconds).toBe(1);
  });

  it('excludes a higher-fee template from a competing parent and a future observation', async () => {
    templateCollectorService.fetchCoreTemplate = async () => gbt(100, [{ txid: 'a'.repeat(64), fee: 100, weight: 400 }]);
    const eligible = (await templateCollectorService.collectCoreTemplate(1000))!;
    await templateCollectorService.collectCoreTemplate(5000);
    templateCollectorService.fetchCoreTemplate = async () => ({ ...gbt(100, [{ txid: 'b'.repeat(64), fee: 1000, weight: 400 }]), previousblockhash: 'q'.repeat(64) });
    await templateCollectorService.collectCoreTemplate(2000);
    const [mined, txs] = block(100, '1'.repeat(64), 100, ['a'.repeat(64)]);
    expect(templateCollectorService.observeBlock(mined, txs, 3000)?.best_template_id).toBe(eligible.template_id);
    expect(templateCollectorService.observeBlock({ ...mined, previousblockhash: 'r'.repeat(64) }, txs, 3000)).toBeNull();
  });

  it('lists the two sources this deployment has, uncollected until something was fetched', () => {
    const sources = templateCollectorService.getSources();
    expect(sources.map(s => s.source_type).sort()).toEqual(['core_gbt', 'mempool_projection']);
    expect(sources.every(s => s.status === 'not_collected' && s.last_template_at === null)).toBe(true);
    expect(templateCollectorService.getTemplatesForHeight()).toEqual([]);
    expect(templateCollectorService.getPolicyFingerprints().every(f => f.fingerprint_hash === null)).toBe(true);
    expect(templateCollectorService.compareMinedBlock('x'.repeat(64))).toBeNull();
    expect(templateCollectorService.computeTemplateDiff('a', 'b')).toBeNull();
  });

  it('a getblocktemplate answer becomes a template with derived totals; a failure marks the source offline', async () => {
    templateCollectorService.fetchCoreTemplate = async () => gbt(100, [{ txid: 'a'.repeat(64), fee: 100, weight: 400 }, { txid: 'b'.repeat(64), fee: 300, weight: 800 }]);
    const template = (await templateCollectorService.collectCoreTemplate(1_000_000))!;
    expect(template).toMatchObject({ height: 100, tx_count: 2, total_fees_sats: 400, total_weight: 1200, sigops_count: 2, coinbase_value_sats: 5000, source_type: 'core_gbt' });
    expect(templateCollectorService.getSources().find(s => s.source_type === 'core_gbt')).toMatchObject({ status: 'active', last_error: null });
    templateCollectorService.fetchCoreTemplate = async () => { throw new Error('401 Unauthorized'); };
    expect(await templateCollectorService.collectCoreTemplate()).toBeNull();
    expect(templateCollectorService.getSources().find(s => s.source_type === 'core_gbt')).toMatchObject({ status: 'offline', last_error: '401 Unauthorized' });
  });

  it('the projection is a template for the height Core reported and diffs against Core are real set differences', async () => {
    templateCollectorService.fetchCoreTemplate = async () => gbt(100, [{ txid: 'a'.repeat(64), fee: 100, weight: 400 }, { txid: 'b'.repeat(64), fee: 300, weight: 800 }, { txid: 'c'.repeat(64), fee: 50, weight: 400 }]);
    const core = (await templateCollectorService.collectCoreTemplate())!;
    templateCollectorService.readProjection = () => ({ transactionIds: ['b'.repeat(64), 'a'.repeat(64), 'd'.repeat(64)], totalFees: 420, blockVSize: 400, nTx: 3 });
    const projection = templateCollectorService.collectProjection()!;
    expect(projection).toMatchObject({ height: 100, source_type: 'mempool_projection', total_fees_sats: 420, total_weight: 1600 });
    const diff = templateCollectorService.computeTemplateDiff(core.template_id, projection.template_id)!;
    expect(diff).toMatchObject({ added_to_b: ['d'.repeat(64)], removed_from_b: ['c'.repeat(64)], reordered_count: 1, fee_delta_sats: -30, similarity_score: 0.6667 });
  });

  it('a mined block is compared against the best template for its height, and only then', async () => {
    templateCollectorService.fetchCoreTemplate = async () => gbt(100, [{ txid: 'a'.repeat(64), fee: 100, weight: 400 }, { txid: 'b'.repeat(64), fee: 300, weight: 800 }]);
    const template = (await templateCollectorService.collectCoreTemplate(1_000_000_000))!;
    expect(templateCollectorService.observeBlock(...block(99, '9'.repeat(64), 5, ['z'.repeat(64)]))).toBeNull();
    const comparison = templateCollectorService.observeBlock(...block(100, '1'.repeat(64), 350, ['a'.repeat(64), 'e'.repeat(64)]))!;
    expect(comparison).toMatchObject({ best_template_id: template.template_id, mined_tx_count: 2, mined_fees_sats: 350, template_fees_sats: 400, fee_differential_sats: -50, omitted_txids: ['b'.repeat(64)], unexpected_txids: ['e'.repeat(64)] });
    expect(templateCollectorService.compareMinedBlock('1'.repeat(64))).toEqual(comparison);
    expect(templateCollectorService.getPolicyFingerprints().find(f => f.source_id === 'src-core-gbt')?.fingerprint_hash).toBe(template.fingerprint_hash);
  });
});
