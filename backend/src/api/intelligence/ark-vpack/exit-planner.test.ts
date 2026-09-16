import { Psbt, Transaction } from 'bitcoinjs-lib';
import { planVpackExit } from './exit-planner';
import { reconstructVpack } from './vpack-reconstruction';
jest.mock('./vpack-reconstruction', () => ({ reconstructVpack: jest.fn() }));
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
const tx = new Transaction(); tx.version = 3; tx.addInput(Buffer.alloc(32, 1), 0, 144); tx.addOutput(Buffer.from('51', 'hex'), 900); tx.addOutput(Buffer.from('51024e73', 'hex'), 0);
describe('Actual-byte exit package planning', () => {
  beforeEach(() => (reconstructVpack as jest.Mock).mockResolvedValue({ vtxo_id: tx.getId(), transactions: [tx.toHex()],
    anchor: { amount_sats: 1000, script_pub_key: '5120' + '11'.repeat(32) }, transaction_checks: [{ signature_valid: null, fee_sats: 100 }] }));
  it('prepares an unsigned PSBT preserving the real transaction and identifies its actual fee anchor', async () => {
    const result = await planVpackExit({ target_feerate_sat_vb: 25 }); const stage = result.stages[0];
    const psbt = Psbt.fromBase64(stage.unsigned_psbt!);
    expect(psbt.data.globalMap.unsignedTx.toBuffer()).toEqual(tx.toBuffer());
    expect(stage.sequence_delay).toEqual({ unit: 'blocks', value: 144 });
    expect(stage.fee_anchor_outputs).toEqual([{ output_index: 1, amount_sats: 0, script_type: 'pay-to-anchor' }]);
    expect(result.additional_fee_required_sats).toBeNull(); expect(result.exit_viable).toBeNull();
  });
  it('rejects invalid scenario inputs before reconstruction', async () => {
    (reconstructVpack as jest.Mock).mockClear();
    await expect(planVpackExit({ target_feerate_sat_vb: -1 })).rejects.toMatchObject({ status: 400 });
    expect(reconstructVpack).not.toHaveBeenCalled();
  });
});
