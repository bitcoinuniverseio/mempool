import { Transaction } from 'bitcoinjs-lib';
import { inspectPsbt } from '../silent-payments/silent-payments-parsers';

/** Validate the entire container first, then adapt BIP370 fields to an in-memory BIP174 view. */
export function adaptWorkbenchPsbt(bytes: Buffer): { bytes: Buffer; version: 0 | 2; psbt_id?: string } {
  const checked = inspectPsbt(bytes.toString('base64'));
  if (!checked.valid) throw new Error('Malformed PSBT container or fields.');
  if (checked.psbt_version === 0) return { bytes, version: 0 };
  if (checked.input_count! > 1000 || checked.output_count! > 1000) throw new Error('PSBT has too many maps.');
  let offset = 5;
  const take = (count: number): Buffer => {
    if (offset + count > bytes.length) throw new Error('Truncated PSBT.');
    const result = bytes.subarray(offset, offset + count); offset += count; return result;
  };
  const compact = (): number => {
    const tag = take(1)[0];
    return tag < 253 ? tag : tag === 253 ? take(2).readUInt16LE() : tag === 254 ? take(4).readUInt32LE() : Number(take(8).readBigUInt64LE());
  };
  const readMap = (): Map<string, Buffer> => {
    const map = new Map<string, Buffer>();
    while (true) { const size = compact(); if (!size) return map; const key = take(size).toString('hex'); map.set(key, take(compact())); }
  };
  const global = readMap();
  const inputs = Array.from({ length: checked.input_count! }, readMap);
  const outputs = Array.from({ length: checked.output_count! }, readMap);
  const tx = new Transaction(); tx.version = global.get('02')!.readInt32LE();
  const constrained = inputs.filter(input => input.has('11') || input.has('12'));
  if (!constrained.length) tx.locktime = global.get('03')?.readUInt32LE() ?? 0;
  else {
    // BIP370: choose the type supported by every constrained input; height wins ties.
    const type = constrained.every(input => input.has('12')) ? '12' : constrained.every(input => input.has('11')) ? '11' : null;
    if (!type) throw new Error('PSBT inputs require incompatible locktime types.');
    const values = constrained.map(input => input.get(type)!.readUInt32LE());
    if (type === '12' && values.some(value => value === 0)) throw new Error('Required height locktime must be positive.');
    tx.locktime = Math.max(...values);
  }
  for (const input of inputs) tx.addInput(input.get('0e')!, input.get('0f')!.readUInt32LE(), input.get('10')?.readUInt32LE() ?? 0xffffffff);
  for (const output of outputs) {
    if (!output.has('04')) throw new Error('Silent Payment output script has not yet been computed.');
    tx.addOutput(output.get('04')!, Number(output.get('03')!.readBigUInt64LE()));
  }
  const identity = tx.clone(); identity.ins.forEach(input => { input.sequence = 0; });
  for (const key of ['02', '03', '04', '05', '06', 'fb']) global.delete(key);
  global.set('00', tx.toBuffer());
  inputs.forEach(map => ['0e', '0f', '10', '11', '12'].forEach(key => map.delete(key)));
  outputs.forEach(map => ['03', '04'].forEach(key => map.delete(key)));
  const encodeCompact = (n: number): Buffer => {
    if (n < 253) return Buffer.from([n]);
    const result = Buffer.alloc(n <= 65535 ? 3 : 5); result[0] = n <= 65535 ? 253 : 254;
    if (n <= 65535) result.writeUInt16LE(n, 1); else result.writeUInt32LE(n, 1);
    return result;
  };
  const encodeMap = (map: Map<string, Buffer>): Buffer => Buffer.concat([...map].flatMap(([key, value]) => {
    const rawKey = Buffer.from(key, 'hex'); return [encodeCompact(rawKey.length), rawKey, encodeCompact(value.length), value];
  }).concat([Buffer.from([0])]));
  return { bytes: Buffer.concat([bytes.subarray(0, 5), encodeMap(global), ...inputs.map(encodeMap), ...outputs.map(encodeMap)]), version: 2, psbt_id: identity.getId() };
}
