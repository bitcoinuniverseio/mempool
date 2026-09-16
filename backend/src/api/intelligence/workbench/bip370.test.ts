import { Psbt, Transaction } from 'bitcoinjs-lib';
import { adaptWorkbenchPsbt } from './psbt-v2';
type Vector = { label: string; expected: boolean; hex: string; expectedLocktime: number | null };
const vectors: { vectors: Vector[] } = require('./bip370-vectors.json');

describe('Official BIP370 container and locktime vectors', () => {
  it.each(vectors.vectors.map(vector => [vector.label, vector] as [string, Vector]))('%s', (_label, vector) => {
    const run = () => adaptWorkbenchPsbt(Buffer.from(vector.hex, 'hex'));
    if (!vector.expected) { expect(run).toThrow(); return; }
    const result = run();
    expect(result.version).toBe(2);
    if (vector.expectedLocktime !== null) {
      const tx = Transaction.fromBuffer(Psbt.fromBuffer(result.bytes).data.globalMap.unsignedTx.toBuffer());
      expect(tx.locktime).toBe(vector.expectedLocktime);
    }
  });
});
