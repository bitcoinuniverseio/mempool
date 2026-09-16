import { Transaction } from 'bitcoinjs-lib';
import { checkBareCtv, ctvTemplateHashes } from './ctv';
const vectors: Array<{
  hex_tx: string;
  spend_index: number[];
  result: string[];
}> = require('./ctv-vectors.json').filter(
  (item) => item && typeof item === 'object' && item.hex_tx
);
describe('BIP119 official template hashes', () => {
  it.each(vectors)(
    'matches official transaction vector %# including every supplied index',
    (vector) => {
      expect(
        ctvTemplateHashes(vector.hex_tx, vector.spend_index).hashes
      ).toEqual(vector.result);
    }
  );
  it('checks the actual script commitment and reacts to output/sequence/locktime changes', () => {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(Buffer.alloc(32, 1), 0, 144);
    tx.addOutput(Buffer.from('51', 'hex'), 1000);
    const script = '20' + ctvTemplateHashes(tx.toHex(), [0]).hashes[0] + 'b3';
    expect(checkBareCtv(tx.toHex(), 0, script).template_matches).toBe(true);
    for (const mutate of [
      (t: Transaction) => {
        t.outs[0].value++;
      },
      (t: Transaction) => {
        t.ins[0].sequence++;
      },
      (t: Transaction) => {
        t.locktime++;
      },
    ]) {
      const changed = tx.clone();
      mutate(changed);
      expect(checkBareCtv(changed.toHex(), 0, script).template_matches).toBe(
        false
      );
    }
    expect(() => checkBareCtv(tx.toHex(), 1, script)).toThrow(/bounds/);
    expect(() => checkBareCtv(tx.toHex(), 0, 'OP_CHECKTEMPLATEVERIFY')).toThrow(
      /bare/
    );
    expect(() => ctvTemplateHashes(tx.toHex(), [0.5])).toThrow(/uint32/);
  });
});
