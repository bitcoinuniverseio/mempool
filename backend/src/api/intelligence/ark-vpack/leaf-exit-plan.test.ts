import { address, networks, Psbt, Transaction } from 'bitcoinjs-lib';
import { AnchorReader } from './anchor-reader';
import { planLeafExit } from './leaf-exit-plan';
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
jest.mock('./anchor-reader', () => ({ ...jest.requireActual('./anchor-reader'), AnchorReader: jest.fn() }));
const tx = new Transaction(); tx.addInput(Buffer.alloc(32, 1), 0); tx.addOutput(Buffer.from('5120' + '11'.repeat(32), 'hex'), 10000);
const destination = address.toBech32(Buffer.alloc(20, 2), 0, 'bcrt');
const core = { network: 'regtest', call: jest.fn() };
const evidence = { engine: '@arkade-os/sdk 0.4.72', vtxo_id: tx.getId() + ':0', transactions: [tx.toHex()],
  exit_path: { sequence: 4, leaf_version: 192, signature_bytes: 64, script_hex: '54b27520' + '22'.repeat(32) + 'ac', control_block_hex: 'c0' + '33'.repeat(32) } };
let leaf: any;
beforeEach(() => { leaf = { outpoint_verified: true, script_pub_key: tx.outs[0].script.toString('hex'), amount_sats: 10000, block_height: 100, spend_status: 'unspent', source: { block_height: 101, block_hash: '44'.repeat(32) } }; (AnchorReader as jest.Mock).mockImplementation(() => ({ verify: async () => leaf })); });
it('binds a native CSV sweep to real bytes, fee rate and owned maturity', async () => {
  const low = await planLeafExit(evidence, destination, 2, core);
  expect(low.mature_for_next_block).toBe(false); expect(low.earliest_confirmation_height).toBe(104);
  leaf.source.block_height = 103;
  const high = await planLeafExit(evidence, destination, 5, core);
  expect(high.mature_for_next_block).toBe(true); expect(high.fee_sats).toBe(high.estimated_signed_vsize * 5);
  expect(high.recovery_amount_sats).toBeLessThan(low.recovery_amount_sats);
  const psbt = Psbt.fromBase64(high.unsigned_psbt), decoded = Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  expect(decoded.ins[0].sequence).toBe(4); expect(decoded.outs[0].value).toBe(10000 - high.fee_sats);
  expect(decoded.outs[0].script).toEqual(address.toOutputScript(destination, networks.regtest));
  expect(psbt.data.inputs[0].tapLeafScript![0].script.toString('hex')).toBe(evidence.exit_path.script_hex);
  expect(psbt.data.inputs[0].tapScriptSig).toBeUndefined(); expect(high.relay_accepted).toBeNull();
});
it('keeps unavailable confirmation and spent state separate from maturity', async () => {
  leaf.block_height = null; leaf.spend_status = 'unknown';
  expect((await planLeafExit(evidence, undefined, 2, core)).mature_for_next_block).toBeNull();
  leaf.block_height = 90; leaf.spend_status = 'spent';
  const result = await planLeafExit(evidence, undefined, 2, core); expect(result.mature_for_next_block).toBe(true); expect(result.spend_status).toBe('spent'); expect(result.unsigned_psbt).toBeNull();
});
it('rejects wrong network, unaffordable fee and changed owned output/checkpoint', async () => {
  await expect(planLeafExit(evidence, address.toBech32(Buffer.alloc(20), 0, 'bc'), 2, core)).rejects.toMatchObject({ status: 400 });
  await expect(planLeafExit(evidence, destination, 1000000, core)).rejects.toMatchObject({ code: 'insufficient-exit-value' });
  await expect(planLeafExit({ ...evidence, anchor: { source: { block_hash: '55'.repeat(32) } } }, destination, 2, core)).rejects.toMatchObject({ code: 'source-changed' });
  leaf.amount_sats++;
  await expect(planLeafExit(evidence, destination, 2, core)).rejects.toMatchObject({ code: 'inconsistent-leaf' });
});
