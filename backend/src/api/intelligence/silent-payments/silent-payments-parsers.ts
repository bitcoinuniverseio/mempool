import { ECDH } from 'crypto';
import { bech32m } from 'bech32';
import { address as bitcoinAddress, networks, Psbt, script, Transaction } from 'bitcoinjs-lib';

export const MAX_PSBT_BYTES = 1024 * 1024;
export const SP_NETWORKS = ['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'];

export function compressedPoint(value: Buffer): boolean {
  if (value.length !== 33 || (value[0] !== 2 && value[0] !== 3)) {return false;}
  try {
    return Buffer.from(ECDH.convertKey(value, 'secp256k1', undefined, undefined, 'compressed')).equals(value);
  } catch { return false; }
}

/** Extract one BIP352 instruction. This inspector does not validate other payment methods. */
function silentPaymentUri(input: string): { address: string; fallback: string } {
  if (input.length > 4096 || !/^bitcoin:[A-Za-z0-9]*\?[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/i.test(input)) {throw new Error('Malformed Bitcoin payment URI. Use bitcoin:?sp=<address>.');}
  const queryAt = input.indexOf('?');
  const seen = new Set<string>();
  const instructions: string[] = [];
  for (const part of input.slice(queryAt + 1).split('&')) {
    if (!part) {continue;}
    const equals = part.indexOf('=');
    const key = decodeURIComponent(equals < 0 ? part : part.slice(0, equals)).toLowerCase();
    const encodedValue = equals < 0 ? '' : part.slice(equals + 1);
    const value = decodeURIComponent(encodedValue);
    if (!key || encodedValue.includes('=')) {throw new Error('Malformed payment URI parameter.');}
    if (key.startsWith('req-') && key !== 'req-sp') {throw new Error('Required URI parameter is not supported by this inspector.');}
    if (['amount', 'label', 'message', 'pop'].includes(key) && seen.has(key)) {throw new Error('Duplicate payment URI parameter.');}
    seen.add(key);
    if (key === 'amount' && !/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) {throw new Error('Payment URI amount must be decimal BTC.');}
    if (key === 'sp' || key === 'req-sp') {instructions.push(value);}
  }
  if (instructions.length !== 1) {throw new Error('This inspector requires one Silent Payment sp instruction. Paste a single address when a URI offers several.');}
  return { address: instructions[0], fallback: input.slice(8, queryAt) };
}

export function decodeSilentAddress(address: unknown, network?: string) {
  try {
    if (typeof address !== 'string' || !address.length) {throw new Error('Address or payment URI must be a nonempty string.');}
    if (network && !SP_NETWORKS.includes(network)) {throw new Error('Unsupported execution network.');}
    const uri = /^bitcoin:/i.test(address) ? silentPaymentUri(address) : undefined;
    const encodedAddress = uri ? uri.address : address;
    if (encodedAddress.length > 1023) {throw new Error('Address must contain at most 1023 characters.');}
    const decoded = bech32m.decode(encodedAddress, 1023);
    if (!['sp', 'tsp'].includes(decoded.prefix)) {throw new Error('Expected sp or tsp address prefix.');}
    const version = decoded.words[0];
    if (version === undefined || version === 31) {throw new Error('Unsupported Silent Payment address version.');}
    const bytes = Buffer.from(bech32m.fromWords(decoded.words.slice(1)));
    if (bytes.length < 66 || (version === 0 && bytes.length !== 66)) {throw new Error('Invalid public key payload length for this version.');}
    if (!compressedPoint(bytes.subarray(0, 33)) || !compressedPoint(bytes.subarray(33, 66))) {throw new Error('Invalid compressed secp256k1 public key.');}
    const family = decoded.prefix === 'sp' ? 'mainnet' : 'test-network';
    if (network && ((network === 'mainnet') !== (family === 'mainnet'))) {throw new Error('Address belongs to a different network family.');}
    if (uri?.fallback) {
      try { bitcoinAddress.toOutputScript(uri.fallback, family === 'mainnet' ? networks.bitcoin : network === 'regtest' ? networks.regtest : networks.testnet); }
      catch { throw new Error('URI fallback address is invalid for the selected network family.'); }
    }
    return { valid: true, version, supported: true, input_format: uri ? 'bip321' : 'address', inspection_scope: 'silent-payment-address', compatibility: version === 0 ? 'v0' : 'v0-compatible', network: network || family, network_family: family, scan_pubkey: bytes.subarray(0, 33).toString('hex'), spend_pubkey: bytes.subarray(33, 66).toString('hex') };
  } catch (error) {
    return { valid: false, supported: false, error: error instanceof Error ? error.message : 'Invalid address.', code: 'INVALID_ADDRESS' };
  }
}

class Reader {
  offset = 0;
  constructor(readonly bytes: Buffer) {}
  take(size: number): Buffer {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.bytes.length - this.offset) {throw new Error('Truncated PSBT or oversized length.');}
    const value = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }
  compact(): number {
    const tag = this.take(1)[0];
    if (tag < 253) {return tag;}
    const bytes = this.take(tag === 253 ? 2 : tag === 254 ? 4 : 8);
    const value = tag === 253 ? BigInt(bytes.readUInt16LE()) : tag === 254 ? BigInt(bytes.readUInt32LE()) : bytes.readBigUInt64LE();
    if (value < BigInt(tag === 253 ? 253 : tag === 254 ? 65536 : 4294967296) || value > BigInt(MAX_PSBT_BYTES)) {throw new Error('Nonminimal or oversized CompactSize.');}
    return Number(value);
  }
  map(): Map<string, Buffer> {
    const entries = new Map<string, Buffer>();
    while (true) {
      const size = this.compact();
      if (!size) {return entries;}
      const key = this.take(size);
      const keyReader = new Reader(key);
      keyReader.compact();
      const hex = key.toString('hex');
      if (entries.has(hex)) {throw new Error('Duplicate PSBT key.');}
      entries.set(hex, this.take(this.compact()));
    }
  }
}

function size(value: Buffer | undefined, length: number, name: string): Buffer {
  if (!value || value.length !== length) {throw new Error(`Missing or malformed ${name}.`);}
  return value;
}

function compactSize(value: number): Buffer {
  if (value < 253) {return Buffer.from([value]);}
  const result = Buffer.alloc(value <= 0xffff ? 3 : 5);
  result[0] = result.length === 3 ? 253 : 254;
  if (result.length === 3) {result.writeUInt16LE(value, 1);} else {result.writeUInt32LE(value, 1);}
  return result;
}

function encodeMap(map: Map<string, Buffer>): Buffer {
  return Buffer.concat([...map].flatMap(([key, value]) => {
    const bytes = Buffer.from(key, 'hex');
    return [compactSize(bytes.length), bytes, compactSize(value.length), value];
  }).concat([Buffer.from([0])]));
}

/** Reuse the installed BIP174/BIP371 decoders for ordinary fields in a v2 container. */
function inspectOrdinaryV2Fields(global: Map<string, Buffer>, inputs: Map<string, Buffer>[], outputs: Map<string, Buffer>[]): void {
  const tx = new Transaction();
  tx.version = global.get('02')!.readInt32LE();
  tx.locktime = global.get('03')?.readUInt32LE() || 0;
  inputs.forEach(map => tx.addInput(map.get('0e')!, map.get('0f')!.readUInt32LE(), map.get('10')?.readUInt32LE()));
  // An uncomputed BIP375 script is empty only in this in-memory parsing adapter.
  // This transaction is never returned, signed, exported or broadcast.
  outputs.forEach(map => tx.addOutput(map.get('04') || Buffer.alloc(0), Number(map.get('03')!.readBigUInt64LE())));
  const adapted = new Map(global);
  adapted.set('00', tx.toBuffer());
  Psbt.fromBuffer(Buffer.concat([Buffer.from('70736274ff', 'hex'), encodeMap(adapted), ...inputs.map(encodeMap), ...outputs.map(encodeMap)]));
}

/** Structural inspector only. Signatures, DLEQ proofs and payment derivation are not verified. */
export function inspectPsbt(encoded: unknown) {
  try {
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(MAX_PSBT_BYTES / 3) * 4) {throw new Error('PSBT must be Base64, at most 1 MiB decoded.');}
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {throw new Error('Malformed Base64.');}
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length > MAX_PSBT_BYTES) {throw new Error('Malformed or oversized Base64.');}
    const reader = new Reader(bytes);
    if (!reader.take(5).equals(Buffer.from('70736274ff', 'hex'))) {throw new Error('Invalid five-byte PSBT magic.');}
    const global = reader.map();
    const version = global.has('fb') ? size(global.get('fb'), 4, 'PSBT_GLOBAL_VERSION').readUInt32LE() : 0;
    if (version !== 0 && version !== 2) {throw new Error('Unsupported PSBT version.');}
    let inputCount: number;
    let outputCount: number;
    if (version === 0) {
      const unsigned = global.get('00');
      if (!unsigned) {throw new Error('Missing unsigned transaction.');}
      const tx = Transaction.fromBuffer(unsigned);
      if (tx.hasWitnesses() || tx.ins.some(input => input.script.length)) {throw new Error('Unsigned transaction must have empty scripts and no witness.');}
      inputCount = tx.ins.length;
      outputCount = tx.outs.length;
      if (['02', '03', '04', '05', '06'].some(key => global.has(key))) {throw new Error('PSBTv2 global fields are prohibited in v0.');}
    } else {
      if (global.has('00')) {throw new Error('Unsigned transaction is prohibited in PSBTv2.');}
      size(global.get('02'), 4, 'PSBT_GLOBAL_TX_VERSION');
      const count = (key: string) => {
        const r = new Reader(global.get(key) || Buffer.alloc(0));
        const n = r.compact();
        if (r.offset !== r.bytes.length) {throw new Error('Invalid input/output count.');}
        return n;
      };
      inputCount = count('04'); outputCount = count('05');
      if (global.has('03')) {size(global.get('03'), 4, 'fallback locktime');}
      if (global.has('06') && (size(global.get('06'), 1, 'modifiable flags')[0] & 0xf8)) {throw new Error('Reserved transaction modifiable flags are set.');}
    }
    if (inputCount + outputCount > bytes.length - reader.offset) {throw new Error('Truncated PSBT maps.');}
    const inputs = Array.from({ length: inputCount }, () => reader.map());
    const outputs = Array.from({ length: outputCount }, () => reader.map());
    if (reader.offset !== bytes.length) {throw new Error('Trailing bytes after PSBT maps.');}
    if (version === 0 && (inputs.some(map => ['0e', '0f', '10', '11', '12'].some(key => map.has(key))) || outputs.some(map => map.has('03') || map.has('04')))) {throw new Error('PSBTv2 input/output fields are prohibited in v0.');}
    if (version === 2) {
      inputs.forEach(map => {
        size(map.get('0e'), 32, 'input previous txid'); size(map.get('0f'), 4, 'input output index');
        ['10', '11', '12'].forEach(key => { if (map.has(key)) {size(map.get(key), 4, 'input sequence/locktime');} });
        if (map.has('11') && map.get('11')!.readUInt32LE() < 500000000) {throw new Error('Required time locktime must be a timestamp.');}
        if (map.has('12') && map.get('12')!.readUInt32LE() >= 500000000) {throw new Error('Required height locktime must be a block height.');}
      });
      outputs.forEach(map => {
        const amount = size(map.get('03'), 8, 'output amount').readBigUInt64LE();
        if (amount > 2100000000000000n) {throw new Error('Output amount exceeds Bitcoin money range.');}
        if (!map.has('04') && !map.has('09')) {throw new Error('Output requires script or Silent Payment info.');}
      });
    }
    const fields: { scope: string; type: string; well_formed: boolean; cryptographically_verified: boolean }[] = [];
    const check = (map: Map<string, Buffer>, scope: string, family: 'global' | 'input' | 'output') => {
      for (const [hex, value] of map) {
        const raw = Buffer.from(hex, 'hex');
        const keyReader = new Reader(raw); const type = keyReader.compact(); const key = raw.subarray(keyReader.offset);
        const sp = family === 'global' ? [7, 8] : family === 'input' ? [0x1d, 0x1e, 0x1f, 0x20] : [9, 10];
        const singleton = family === 'global' ? [0, 2, 3, 4, 5, 6, 0xfb] : family === 'input' ? [0, 1, 3, 4, 5, 7, 8, 9, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x17, 0x18, 0x20] : [0, 1, 3, 4, 5, 6, 9, 10];
        if (singleton.includes(type) && key.length) {throw new Error('Unexpected key data in singleton PSBT field.');}
        if (type === 0xfc) {
          const proprietary = new Reader(key);
          proprietary.take(proprietary.compact());
          proprietary.compact();
        }
        if (family === 'input' && type === 0) {Transaction.fromBuffer(value);}
        if (family === 'input' && type === 1) {
          const utxo = new Reader(value);
          if (utxo.take(8).readBigUInt64LE() > 2100000000000000n) {throw new Error('Witness UTXO amount exceeds money range.');}
          utxo.take(utxo.compact());
          if (utxo.offset !== value.length) {throw new Error('Malformed witness UTXO.');}
        }
        if (family === 'input' && type === 3) {size(value, 4, 'sighash type');}
        if (family === 'input' && type === 2) {script.signature.decode(value);}
        if (family === 'input' && [0x0a, 0x0b, 0x0c, 0x0d].includes(type)) {size(key, [0x0a, 0x0c].includes(type) ? 20 : 32, 'preimage hash key');}
        if (family === 'input' && [0x17, 0x18].includes(type)) {size(value, 32, 'Taproot key/root');}
        if (family === 'input' && type === 0x13 && ![64, 65].includes(value.length)) {throw new Error('Malformed Taproot key signature.');}
        if (!sp.includes(type)) {continue;}
        if (version !== 2) {throw new Error('BIP375/376 fields require PSBTv2.');}
        if ((family === 'global') || (family === 'input' && type !== 0x20)) {
          if (!compressedPoint(key)) {throw new Error('Invalid Silent Payment field public key.');}
        }
        if ((family === 'global' && type === 7) || (family === 'input' && type === 0x1d)) {
          if (!compressedPoint(value)) {throw new Error('Invalid ECDH share point.');}
        } else if ((family === 'global' && type === 8) || (family === 'input' && type === 0x1e)) {size(value, 64, 'DLEQ proof');}
        else if (family === 'input' && type === 0x1f) {
          if (value.length < 4 || value.length % 4) {throw new Error('Invalid spend derivation path.');}
        } else if (family === 'input' && type === 0x20) {size(value, 32, 'Silent Payment tweak');}
        else if (type === 9) {
          if (value.length !== 66 || !compressedPoint(value.subarray(0, 33)) || !compressedPoint(value.subarray(33))) {throw new Error('Invalid Silent Payment output public keys.');}
        } else if (type === 10) {
          size(value, 4, 'Silent Payment label');
          if (!map.has('09')) {throw new Error('Silent Payment label requires output info.');}
        }
        fields.push({ scope, type: `0x${type.toString(16)}`, well_formed: true, cryptographically_verified: false });
      }
    };
    check(global, 'global', 'global');
    inputs.forEach((map, i) => check(map, `input:${i}`, 'input'));
    outputs.forEach((map, i) => check(map, `output:${i}`, 'output'));
    if (version === 0) {Psbt.fromBuffer(bytes);} else {inspectOrdinaryV2Fields(global, inputs, outputs);}
    if (outputs.some(map => map.has('09') && map.has('04')) && ((global.get('06')?.[0] || 0) & 3)) {throw new Error('Computed Silent Payment outputs require fixed inputs and outputs.');}
    return { valid: true, psbt_version: version, bip375_present: fields.some(f => !['0x1f', '0x20'].includes(f.type)), bip376_present: fields.some(f => ['0x1f', '0x20'].includes(f.type)), supported: true, well_formed: true, cryptographically_verified: false, inspection_scope: 'container-and-field-structure', input_count: inputCount, output_count: outputCount, fields };
  } catch (error) {
    return { valid: false, bip375_present: false, bip376_present: false, well_formed: false, cryptographically_verified: false, code: 'INVALID_PSBT', error: error instanceof Error ? error.message : 'Invalid PSBT.' };
  }
}
