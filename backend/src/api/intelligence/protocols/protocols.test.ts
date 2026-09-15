import { readFileSync } from 'fs';
import { join } from 'path';
import { protocolRegistryService, ProtocolDecodeError, MAX_DECODE_HEX_CHARS } from './protocol-registry.service';
import { decodeLeb128, decodeRunestone, encodeLeb128, encodeRunestoneScript, runeName, spacedRuneName } from './runestone';
import { parseInscriptionEnvelopes, parseBrc20 } from './inscription-envelope';
import { parseScript } from './script-parser';
import { ProtocolActivityObserver, classifyTransaction } from './protocol-activity';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';

// Expected values below are computed by hand from the protocol grammars, not
// copied from the implementation. LEB128(840000) = c0 a2 33 because
// 840000 = 6562*128 + 64, 6562 = 51*128 + 34; LEB128(10000) = 90 4e because
// 10000 = 78*128 + 16.
const EDICT_SCRIPT = '6a5d0800c0a23301904e01';     // [Body, 840000, 1, 10000, 1]
const MINT_SCRIPT = '6a5d0614c0a2331401';           // [Mint, 840000, Mint, 1]
const ETCHING_SCRIPT = '6a5d0b0201041b0102052406f403'; // [Flags 1, Rune 27, Divisibility 2, Symbol 36, Premine 500]

const pushed = (bytes: Buffer): Buffer => Buffer.concat([Buffer.from([bytes.length]), bytes]);
const envelope = (contentType: string, body: string): string => Buffer.concat([
  Buffer.from('0063036f7264', 'hex'), Buffer.from('0101', 'hex'), pushed(Buffer.from(contentType, 'utf8')),
  Buffer.from('00', 'hex'), pushed(Buffer.from(body, 'utf8')), Buffer.from('68', 'hex'),
]).toString('hex');

describe('protocol registry catalogue', () => {
  it('lists the six registered identities and says what each can do here', () => {
    const protocols = protocolRegistryService.getAdapters();
    expect(protocols.map(p => p.protocol_id).sort()).toEqual(['bip352_silent_payments', 'brc20', 'lightning', 'opentimestamps', 'ordinals', 'runes']);
    expect(protocols.find(p => p.protocol_id === 'runes')?.capabilities).toEqual({ decode: true, metrics: true });
    expect(protocols.find(p => p.protocol_id === 'lightning')?.capabilities).toEqual({ decode: false, metrics: false });
  });
});

describe('LEB128 and rune names', () => {
  it('round-trips integers and matches the hand-computed bytes', () => {
    expect(encodeLeb128(840000n).toString('hex')).toBe('c0a233');
    expect(encodeLeb128(10000n).toString('hex')).toBe('904e');
    expect(decodeLeb128(Buffer.from('c0a233904e', 'hex')).integers).toEqual([840000n, 10000n]);
  });
  it('reports a truncated varint instead of guessing', () => {
    expect(decodeLeb128(Buffer.from('e8', 'hex')).flaw).toBe('varint');
  });
  it('names runes with the modified base-26 alphabet', () => {
    expect(runeName(0n)).toBe('A');
    expect(runeName(25n)).toBe('Z');
    expect(runeName(26n)).toBe('AA');
    expect(runeName(27n)).toBe('AB');
    expect(spacedRuneName(27n, 0b1)).toBe('A•B');
  });
});

describe('runestone decoding', () => {
  it('decodes an edict with the ID, amount and output from the bytes', () => {
    const [result] = protocolRegistryService.decodePayload(EDICT_SCRIPT);
    expect(result.protocol_id).toBe('runes');
    expect(result.operation_type).toBe('edict_transfer');
    expect(result.status).toBe('decoded');
    expect(result.decoding_level).toBe('syntactic');
    expect(result.confidence).toBeLessThan(1);
    expect(result.parameters.edicts).toEqual([{ rune_id: '840000:1', amount: '10000', output_index: 1 }]);
    expect(result.parameters.rune_names).toMatch(/not resolved/);
  });

  it('decodes a mint and an etching, with different values for different inputs', () => {
    const [mint] = protocolRegistryService.decodePayload(MINT_SCRIPT);
    expect(mint.operation_type).toBe('mint');
    expect(mint.parameters.mint).toBe('840000:1');
    expect(mint.parameters.edicts).toEqual([]);

    const [etching] = protocolRegistryService.decodePayload(ETCHING_SCRIPT);
    expect(etching.operation_type).toBe('etching');
    expect(etching.parameters.etching).toEqual({
      rune: 'AB', divisibility: 2, spacers: null, symbol: '$', premine: '500', turbo: false, terms: null,
    });

    const second = encodeRunestoneScript([0n, 2n, 7n, 42n, 3n]).toString('hex');
    const [other] = protocolRegistryService.decodePayload(second);
    expect(other.parameters.edicts).toEqual([{ rune_id: '2:7', amount: '42', output_index: 3 }]);
  });

  it('applies delta encoding across edicts', () => {
    const script = encodeRunestoneScript([0n, 840000n, 1n, 5n, 0n, 0n, 2n, 6n, 1n, 10n, 4n, 7n, 2n]).toString('hex');
    const [result] = protocolRegistryService.decodePayload(script);
    expect(result.parameters.edicts).toEqual([
      { rune_id: '840000:1', amount: '5', output_index: 0 },
      { rune_id: '840000:3', amount: '6', output_index: 1 },
      { rune_id: '840010:4', amount: '7', output_index: 2 },
    ]);
  });

  it.each([
    ['6a5d', 'runestone with no payload is an empty runestone, not a transfer', 'runestone', []],
    ['6a5d0102030405', 'a 7-byte push with 5 bytes left is an invalid script', 'cenotaph', ['invalid_script']],
    ['6a5d027e01', 'tag 126 is an unrecognised even tag', 'cenotaph', ['unrecognized_even_tag']],
    ['6a5d01ff', 'a varint that never terminates', 'cenotaph', ['varint']],
    ['6a5d0400010101', 'a body that is not a multiple of four integers', 'cenotaph', ['trailing_integers']],
    ['6a5d51', 'a non-push opcode after OP_13', 'cenotaph', ['opcode']],
    ['6a5d0102', 'a tag without a value', 'cenotaph', ['truncated_field']],
  ])('%s: %s', (hex, _title, operation, flaws) => {
    const [result] = protocolRegistryService.decodePayload(hex);
    expect(result.protocol_id).toBe('runes');
    expect(result.operation_type).toBe(operation);
    expect(result.parameters.cenotaph_flaws).toEqual(flaws);
    expect(result.parameters.edicts).toEqual([]);
    if (flaws.length) {
      expect(result.status).toBe('invalid');
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    }
  });

  it('the old sample payload is malformed and says so', () => {
    const [result] = protocolRegistryService.decodePayload('6a5d04140105e80702');
    expect(result.operation_type).toBe('cenotaph');
    expect(result.status).toBe('invalid');
  });

  it('a runestone marker inside unrelated pushed data is not a runestone', () => {
    // OP_RETURN with one push whose data happens to contain 6a5d.
    expect(decodeRunestone(Buffer.from('6a046a5d0102', 'hex'))).toBeNull();
    const [result] = protocolRegistryService.decodePayload('6a046a5d0102');
    expect(result.protocol_id).toBe('generic_op_return');
    expect(result.parameters).toMatchObject({ push_count: 1, push_sizes: [4], data_hex: '6a5d0102', length: 4 });
  });
});

describe('inscription envelopes', () => {
  it('reads the content type and body size from the envelope', () => {
    const [result] = protocolRegistryService.decodePayload(envelope('text/plain', 'hello'));
    expect(result.protocol_id).toBe('ordinals');
    expect(result.operation_type).toBe('inscription_reveal');
    expect(result.parameters).toMatchObject({ content_type: 'text/plain', body_size_bytes: 5, envelope_index: 0 });
    expect(result.status).toBe('decoded');
  });

  it('two envelopes give two different results', () => {
    const script = envelope('image/webp', 'abc') + envelope('text/plain', 'a much longer body here');
    const results = protocolRegistryService.decodePayload(script);
    expect(results.map(r => r.parameters.content_type)).toEqual(['image/webp', 'text/plain']);
    expect(results.map(r => r.parameters.body_size_bytes)).toEqual([3, 23]);
  });

  it('a body split over several pushes is summed', () => {
    const script = Buffer.concat([
      Buffer.from('0063036f72640101', 'hex'), pushed(Buffer.from('text/plain')), Buffer.from('00', 'hex'),
      pushed(Buffer.alloc(70, 1)), pushed(Buffer.alloc(75, 2)), Buffer.from('68', 'hex'),
    ]).toString('hex');
    const [result] = protocolRegistryService.decodePayload(script);
    expect(result.parameters.body_size_bytes).toBe(145);
  });

  it('a truncated envelope is reported incomplete with nothing invented', () => {
    const [result] = protocolRegistryService.decodePayload('0063036f7264');
    expect(result.operation_type).toBe('inscription_envelope_incomplete');
    expect(result.status).toBe('incomplete');
    expect(result.parameters.content_type).toBeNull();
    expect(result.parameters.body_size_bytes).toBeNull();
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it('a BRC-20 body inside a text inscription yields a BRC-20 operation too', () => {
    const body = '{"p":"brc-20","op":"mint","tick":"ordi","amt":"1000"}';
    const results = protocolRegistryService.decodePayload(envelope('text/plain;charset=utf-8', body));
    expect(results.map(r => r.protocol_id)).toEqual(['ordinals', 'brc20']);
    expect(results[1].operation_type).toBe('brc20_mint');
    expect(results[1].parameters).toMatchObject({ op: 'mint', tick: 'ordi', amt: '1000', inscription_index: 0 });
  });

  it('a JSON body that is not BRC-20 is only an inscription', () => {
    const results = protocolRegistryService.decodePayload(envelope('application/json', '{"p":"other"}'));
    expect(results.map(r => r.protocol_id)).toEqual(['ordinals']);
    expect(parseBrc20(parseInscriptionEnvelopes(Buffer.from(envelope('image/png', '{"p":"brc-20"}'), 'hex'))[0])).toBeNull();
  });
});

describe('OpenTimestamps and generic data', () => {
  it('parses a detached proof given as hex and reports its attestations', () => {
    const proof = readFileSync(join(__dirname, '..', 'opentimestamps', '__fixtures__', 'hello-world.txt.ots'));
    const [result] = protocolRegistryService.decodePayload(proof.toString('hex'));
    expect(result.protocol_id).toBe('opentimestamps');
    expect(result.operation_type).toBe('bitcoin_attestation');
    expect(result.parameters.bitcoin_block_heights).toEqual([358391]);
    expect(result.parameters.verification).toMatch(/not performed/);
  });

  it('an incidental byte sequence is not an OpenTimestamps attestation', () => {
    expect(protocolRegistryService.decodePayload('0109f91102')).toEqual([]);
    expect(protocolRegistryService.decodePayload('6a0b0109f91102aabbccddee')[0].protocol_id).toBe('generic_op_return');
  });

  it('OP_RETURN data length is the pushed data, not the script length', () => {
    const [result] = protocolRegistryService.decodePayload('6a0401020304');
    expect(result.parameters).toMatchObject({ push_count: 1, data_hex: '01020304', length: 4 });
    expect(result.status).toBe('decoded');
    const [truncated] = protocolRegistryService.decodePayload('6a0401');
    expect(truncated.status).toBe('incomplete');
    expect(truncated.issues[0]).toMatch(/push of 4 bytes but only 1 remain/);
  });

  it('a script with no known marker decodes to nothing', () => {
    expect(protocolRegistryService.decodePayload('76a914' + '00'.repeat(20) + '88ac')).toEqual([]);
  });
});

describe('input validation', () => {
  it.each([
    ['not-a-script op_13 not-hex', 'invalid_hex'],
    ['6a1', 'invalid_hex'],
    ['', 'invalid_input'],
    ['   ', 'invalid_input'],
    ['6'.repeat(MAX_DECODE_HEX_CHARS + 2), 'too_large'],
  ])('rejects %j with %s', (input, code) => {
    expect(() => protocolRegistryService.decodePayload(input)).toThrow(ProtocolDecodeError);
    try { protocolRegistryService.decodePayload(input); } catch (e) { expect((e as ProtocolDecodeError).code).toBe(code); }
  });

  it('rejects non-string bodies rather than coercing them', () => {
    for (const value of [123, ['6a5d'], { hex: '6a5d' }, null, undefined]) {
      expect(() => protocolRegistryService.decodePayload(value)).toThrow(ProtocolDecodeError);
    }
  });

  it('script parser reports the offset of a truncated push', () => {
    expect(parseScript(Buffer.from('4c', 'hex')).error).toEqual({ offset: 0, reason: 'OP_PUSHDATA1 without a length byte' });
    expect(parseScript(Buffer.from('004d0300ab', 'hex')).error?.offset).toBe(1);
  });
});

describe('activity metrics come from observed blocks', () => {
  const tx = (overrides: Partial<TransactionExtended>): TransactionExtended => ({
    txid: 'a'.repeat(64), fee: 100, weight: 400, vin: [], vout: [], ...overrides,
  } as unknown as TransactionExtended);
  const runesTx = tx({ txid: 'b'.repeat(64), fee: 300, weight: 600, vout: [{ scriptpubkey: EDICT_SCRIPT, scriptpubkey_type: 'op_return' }] as never });
  const inscriptionTx = tx({ txid: 'c'.repeat(64), fee: 500, weight: 1000, vin: [{ witness: ['00', envelope('text/plain', '{"p":"brc-20","op":"deploy","tick":"test"}'), 'c0'] }] as never });
  const block = (height: number, timestamp: number, weight: number, fees: number): BlockExtended => ({ height, id: height.toString(16).padStart(64, '0'), timestamp, weight, extras: { totalFees: fees } } as unknown as BlockExtended);

  it('classifies transactions by what their scripts actually contain', () => {
    expect(classifyTransaction(runesTx)).toEqual({ op_return: 1, runes: 1 });
    expect(classifyTransaction(inscriptionTx)).toEqual({ ordinals: 1, brc20: 1 });
    expect(classifyTransaction(tx({}))).toEqual({});
  });

  it('unknown protocol IDs are null and unobservable protocols are unavailable, never numbers', () => {
    const fresh = new ProtocolActivityObserver('signet');
    protocolRegistryService.attachObserver(fresh);
    expect(protocolRegistryService.getMetrics('definitely-not-registered')).toBeNull();
    expect(protocolRegistryService.getMetrics('lightning')).toEqual({ unavailable: expect.stringMatching(/needs its own authority/) });
    expect(protocolRegistryService.getMetrics('runes')).toEqual({ unavailable: expect.stringMatching(/no block has been observed/) });
  });

  it('shares are exact fractions of the observed window and the window is labelled partial', () => {
    const observer = new ProtocolActivityObserver('signet');
    protocolRegistryService.attachObserver(observer);
    observer.observeBlock(block(100, 1_000_000, 4000, 1000), [tx({}), runesTx, inscriptionTx]);
    observer.observeBlock(block(101, 1_000_600, 2000, 500), [tx({})]);
    const runes = protocolRegistryService.getMetrics('runes');
    expect(runes).toEqual({ metrics: expect.objectContaining({
      protocol_id: 'runes', network: 'signet', tx_count: 1, operation_count: 1,
      weight_share_percent: 10, // 600 of 6000
      fee_share_percent: 20,    // 300 of 1500
      window: { blocks: 2, from_height: 100, to_height: 101, from_timestamp: 1_000_000, to_timestamp: 1_000_600, covers_24h: false },
      checkpoint: { height: 101, hash: (101).toString(16).padStart(64, '0') },
      completeness: 'partial',
    }) });
    const brc20 = protocolRegistryService.getMetrics('brc20');
    expect(brc20).toEqual({ metrics: expect.objectContaining({ tx_count: 1, weight_share_percent: 16.67, fee_share_percent: 33.33 }) });
  });

  it('a block older than a day marks the window complete and a reorged height is replaced', () => {
    const observer = new ProtocolActivityObserver('signet');
    observer.observeBlock(block(1, 0, 4000, 10), [runesTx]);
    observer.observeBlock(block(2, 90_000, 4000, 10), [runesTx]);
    observer.observeBlock(block(3, 90_600, 4000, 10), []);
    const metrics = observer.getMetrics('runes');
    expect(metrics?.window).toEqual({ blocks: 2, from_height: 2, to_height: 3, from_timestamp: 90_000, to_timestamp: 90_600, covers_24h: true });
    expect(metrics?.completeness).toBe('complete');
    expect(metrics?.tx_count).toBe(1);
    // Height 3 arrives again on a different hash with a runes transaction.
    observer.observeBlock({ ...block(3, 90_700, 4000, 10), id: 'f'.repeat(64) }, [runesTx]);
    expect(observer.blocksObserved()).toBe(3);
    expect(observer.getMetrics('runes')?.tx_count).toBe(2);
    expect(observer.getMetrics('runes')?.checkpoint.hash).toBe('f'.repeat(64));
  });
});
