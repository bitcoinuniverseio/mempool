import { scanRbfCompactClosure } from '../api/rbf-compact-closure';
import { validateRbfSnapshot } from '../api/rbf-snapshot';
const id = (n: number): string => n.toString(16).padStart(64, '0');
async function* chunks(value: unknown, size = 64): AsyncIterable<Buffer> {
  const bytes = Buffer.from(JSON.stringify(value));
  for (let offset = 0; offset < bytes.length; offset += size) { yield bytes.subarray(offset, offset + size); }
}
const fixture = (): any => ({ network: 'signet', rbfCacheSchemaVersion: 1, rbf: {
  txs: [0, 1, 2].map(n => [id(n), { txid: id(n), weight: 400, fee: 2, firstSeen: 123,
    vin: [{ sequence: 1, txid: id(10), vout: n, witness: ['x'.repeat(200_000)] }],
    vout: [{ value: n + 1, scriptpubkey_asm: 'z'.repeat(200_000) }], arbitrary: { preserveRaw: true } }]),
  trees: [{ root: id(0), [id(0)]: { tx: id(0), time: 123.5, fullRbf: false, replaces: [id(1)] },
    [id(1)]: { tx: id(1), time: 122, fullRbf: true, replaces: [], arbitrary: 'ignored by original validator' } }],
  expiring: [[id(0), 1_000_000]],
} });
describe('streamed compact closure uses original graph and expiry validation', () => {
  it.each([7, 65536])('preserves compact logic fields and all complete raw bodies at chunk size %i', async size => {
    const value = fixture(); const bytes = Buffer.from(JSON.stringify(value));
    const result = await scanRbfCompactClosure(chunks(value, size), 'signet');
    expect(result.qualified).toBe(false); expect(result.metadataValidated).toBe(true);
    expect(result.internalProjection.txs).toHaveLength(3);
    expect(result.internalProjection.txs[0][1]).toEqual({ txid: id(0), weight: 400, fee: 2, firstSeen: 123,
      vin: [{ sequence: 1, txid: id(10), vout: 0 }], vout: [{ value: 1 }] });
    expect(result.internalProjection.trees[0][id(0)]).toEqual(value.rbf.trees[0][id(0)]);
    expect(result.internalProjection.expiring).toEqual(value.rbf.expiring);
    for (let n = 0; n < 3; n++) {
      const range = result.raw.bodies[n];
      expect(JSON.parse(bytes.subarray(range.offset, range.offset + range.bytes).toString())).toEqual(value.rbf.txs[n][1]);
    }
    // Original validator permits unreferenced bodies and absent expiry; retain that behavior.
    expect(validateRbfSnapshot(value, 'signet').txs).toHaveLength(3);
  });
  it.each(['cycle', 'missing', 'extra', 'duplicate-node', 'expiry', 'vin', 'vout', 'weight'])('rejects %s closure just like the original validator', async kind => {
    const value = fixture(); const tree = value.rbf.trees[0];
    if (kind === 'cycle') { tree[id(1)].replaces = [id(0)]; }
    if (kind === 'missing') { tree[id(0)].replaces = [id(99)]; }
    if (kind === 'extra') { tree[id(2)] = { tx: id(2), time: 1, fullRbf: false, replaces: [] }; }
    if (kind === 'duplicate-node') { value.rbf.trees.push({ root: id(1), [id(1)]: tree[id(1)] }); }
    if (kind === 'expiry') { value.rbf.expiring.push([id(0), 2]); }
    if (kind === 'vin') { value.rbf.txs[0][1].vin[0].sequence = -1; }
    if (kind === 'vout') { value.rbf.txs[0][1].vout[0].value = 0.1; }
    if (kind === 'weight') { value.rbf.txs[0][1].weight = null; }
    expect(() => validateRbfSnapshot(value, 'signet')).toThrow();
    await expect(scanRbfCompactClosure(chunks(value, 65536), 'signet')).rejects.toThrow();
  });
  it('does not publish a candidate after source failure or cancellation', async () => {
    async function* failed(): AsyncIterable<Buffer> { yield Buffer.from('{'); throw new Error('source failed'); }
    await expect(scanRbfCompactClosure(failed(), 'signet')).rejects.toThrow('source failed');
    const controller = new AbortController(); controller.abort();
    await expect(scanRbfCompactClosure(chunks(fixture()), 'signet', controller.signal)).rejects.toThrow();
  });
  it('validates metadata budget before input and rejects excess without a partial candidate', async () => {
    let read = false;
    async function* source(): AsyncIterable<Buffer> { read = true; yield Buffer.from('{}'); }
    for (const budget of [0, -1, 1.5, 16 * 1024 * 1024 + 1]) {
      await expect(scanRbfCompactClosure(source(), 'signet', undefined, budget)).rejects.toThrow('budget invalid');
      expect(read).toBe(false);
    }
    await expect(scanRbfCompactClosure(chunks(fixture()), 'signet', undefined, 1024)).rejects.toThrow('budget exceeded');
  });
});
