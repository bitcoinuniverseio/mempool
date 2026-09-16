import { Transaction } from 'bitcoinjs-lib';
import { signSchnorr, pointFromScalar } from 'tiny-secp256k1';
import { verifyReconstructedTransactions } from './vpack-reconstruction';
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
const id = '11'.repeat(32);
const privateFixture = Buffer.alloc(32, 1);
const key = Buffer.from(pointFromScalar(privateFixture, true)!).subarray(1);
const script = Buffer.concat([Buffer.from('5120', 'hex'), key]);
function fixture() {
  const tx = new Transaction(); tx.version = 3; tx.addInput(Buffer.from(id, 'hex').reverse(), 0); tx.addOutput(Buffer.from('51', 'hex'), 900);
  tx.setWitness(0, [Buffer.from(signSchnorr(tx.hashForWitnessV1(0, [script], [1000], 0), privateFixture))]);
  return tx;
}
const anchor = { anchor_outpoint: id + ':0', amount_sats: 1000, script_pub_key: script.toString('hex') };
describe('Independent V-PACK reconstructed transaction checks', () => {
  it('verifies the first-hop signature against the actual anchor key', () => {
    expect(verifyReconstructedTransactions([fixture().toHex()], anchor)[0]).toMatchObject({ fee_sats: 100, signature_valid: true });
  });
  it('rejects a signature on another anchor value', () => {
    expect(verifyReconstructedTransactions([fixture().toHex()], { ...anchor, amount_sats: 1001 })[0].signature_valid).toBe(false);
  });
  it('reports missing signatures as unknown', () => {
    const tx = fixture(); tx.setWitness(0, []);
    expect(verifyReconstructedTransactions([tx.toHex()], anchor)[0].signature_valid).toBeNull();
  });
  it('rejects invented links and excess output values', () => {
    expect(() => verifyReconstructedTransactions([fixture().toHex()], { ...anchor, anchor_outpoint: id + ':1' })).toThrow('preceding output');
    expect(() => verifyReconstructedTransactions([fixture().toHex()], { ...anchor, amount_sats: 800 })).toThrow('input value');
  });
});
