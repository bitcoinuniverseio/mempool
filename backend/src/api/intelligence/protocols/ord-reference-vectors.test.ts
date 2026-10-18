// Differential vectors for the inscription decoder. Each case reproduces a
// test from ord 0.29.0 (7e37a3bd3391044b39f5f11f20dfdb8b3764cd0e)
// src/inscriptions/envelope.rs, inscription_id.rs or inscription.rs, or a rule
// of OPI 7933f5d05d978fc226df8126026ed92f8c45d03b, with the expected values
// taken from those sources rather than from this implementation.
import {
  Brc20Observation, decodePointer, formatInscriptionId, InscriptionEnvelope, inscriptionIdFromValue, observeBrc20,
  parseInscriptionId, parseTransactionEnvelopes, tapscriptFromWitness,
} from './inscription-envelope';
import { protocolRegistryService } from './protocol-registry.service';

const OP_FALSE = 0x00;
const OP_IF = 0x63;
const OP_ENDIF = 0x68;
const OP_AND = 0x84;
const OP_CHECKSIG = 0xac;

type Item = Buffer | string | number[] | { op: number };
const op = (code: number): { op: number } => ({ op: code });

/** rust-bitcoin Builder::push_slice encoding (no small-integer shortcut). */
function pushSlice(data: Buffer): Buffer {
  if (data.length === 0) { return Buffer.from([0x00]); }
  if (data.length <= 75) { return Buffer.concat([Buffer.from([data.length]), data]); }
  if (data.length <= 0xff) { return Buffer.concat([Buffer.from([0x4c, data.length]), data]); }
  const length = Buffer.alloc(2);
  length.writeUInt16LE(data.length);
  return Buffer.concat([Buffer.from([0x4d]), length, data]);
}

function script(...items: Item[]): Buffer {
  return Buffer.concat(items.map(item => {
    if (typeof item === 'object' && 'op' in item) { return Buffer.from([item.op]); }
    return pushSlice(typeof item === 'string' ? Buffer.from(item, 'utf8') : Buffer.from(item as Buffer | number[]));
  }));
}

/** ord's test helper envelope(): OP_FALSE OP_IF <pushes> OP_ENDIF. */
const envelopeScript = (...pushes: Item[]): Buffer => script(op(OP_FALSE), op(OP_IF), ...pushes, op(OP_ENDIF));
/** A script-path witness: [tapscript, control block]. */
const witness = (tapscript: Buffer): Buffer[] => [tapscript, Buffer.alloc(0)];
const parseOne = (tapscript: Buffer): InscriptionEnvelope[] => parseTransactionEnvelopes([witness(tapscript)]);
const ord = 'ord';
const ORDINALS = (envelopes: InscriptionEnvelope[]): InscriptionEnvelope[] => envelopes.filter(e => e.ordRecognized);

const TXID_BYTES = Buffer.alloc(32, 0x11);
const TXID = '11'.repeat(32);
const idValue = (index: number[]): Buffer => Buffer.concat([TXID_BYTES, Buffer.from(index)]);

describe('tag identity (tag.rs)', () => {
  it('maps every known tag to its field', () => {
    const parent = idValue([1]);
    const delegate = idValue([2]);
    const [envelope] = parseOne(envelopeScript(ord,
      [1], 'text/plain;charset=utf-8',
      [2], [1],
      [3], parent,
      [5], [0xa0],
      [7], 'meta',
      [9], 'br',
      [11], delegate,
      [13], [0x2a],
      [15], 'a note',
      [17], [0xa1, 0x01],
      [19], 'br',
      [], 'ord'));
    expect(envelope.ordRecognized).toBe(true);
    expect(envelope.contentType).toBe('text/plain;charset=utf-8');
    expect(envelope.pointer).toBe(1n);
    expect(envelope.parents).toEqual([`${TXID}i1`]);
    expect(envelope.metadata?.toString('hex')).toBe('a0');
    expect(envelope.metaprotocol).toBe('meta');
    expect(envelope.contentEncoding).toBe('br');
    expect(envelope.delegate).toBe(`${TXID}i2`);
    expect(envelope.runeHex).toBe('2a');
    expect(envelope.properties?.toString('hex')).toBe('a101');
    expect(envelope.propertyEncoding).toBe(Buffer.from('br').toString('hex'));
    // ord never takes Note, so it stays as an odd unknown field and is ignored.
    expect(envelope.unknownFields).toEqual([{ tag: '0f', name: 'Note', values: [Buffer.from('a note').toString('hex')] }]);
    expect(envelope.body.toString()).toBe('ord');
    expect(envelope.flags).toEqual({ pushnum: false, stutter: false, incomplete_field: false, duplicate_field: false, unrecognized_even_field: false, pointer: true });
  });

  it('Note=15 and Properties=17 are not swapped', () => {
    const [noteOnly] = parseOne(envelopeScript(ord, [15], [0xaa]));
    expect(noteOnly.properties).toBeNull();
    const [propertiesOnly] = parseOne(envelopeScript(ord, [17], [0xbb]));
    expect(propertiesOnly.properties?.toString('hex')).toBe('bb');
    expect(propertiesOnly.unknownFields).toEqual([]);
  });

  it('unknown_odd_fields_are_ignored: odd tags are preserved without a flag', () => {
    const [envelope] = parseOne(envelopeScript(ord, [99], [0]));
    expect(envelope.unknownFields).toEqual([{ tag: '63', name: null, values: ['00'] }]);
    expect(envelope.flags.unrecognized_even_field).toBe(false);
    const [nop] = parseOne(envelopeScript(ord, [1], 'text/plain;charset=utf-8', [255], 'bar', [], 'ord'));
    expect(nop.contentType).toBe('text/plain;charset=utf-8');
    expect(nop.flaws).toEqual([]);
  });

  it('unknown_even_fields and tag 66 set unrecognized_even_field', () => {
    for (const tag of [[22], [66]]) {
      const [envelope] = parseOne(envelopeScript(ord, tag, [0]));
      expect(envelope.flags.unrecognized_even_field).toBe(true);
      expect(envelope.flaws).toEqual(['unrecognized_even_field']);
    }
  });

  it('padded tag bytes are not promoted to a known tag', () => {
    const [odd] = parseOne(envelopeScript(ord, [1, 0], 'text/plain'));
    expect(odd.contentType).toBeNull();
    expect(odd.unknownFields[0].tag).toBe('0100');
    expect(odd.flags.unrecognized_even_field).toBe(false);
    const [even] = parseOne(envelopeScript(ord, [2, 0], [1]));
    expect(even.pointer).toBeNull();
    expect(even.flags.unrecognized_even_field).toBe(true);
  });

  it('duplicate_pointer_field_makes_inscription_unbound', () => {
    const [envelope] = parseOne(envelopeScript(ord, [2], [1], [2], [0]));
    expect(envelope.pointer).toBe(1n);
    expect(envelope.flags.duplicate_field).toBe(true);
    expect(envelope.flags.unrecognized_even_field).toBe(true);
  });

  it('duplicate_field: a repeated odd tag', () => {
    const [envelope] = parseOne(envelopeScript(ord, [255], [], [255], []));
    expect(envelope.flaws).toEqual(['duplicate_field']);
    expect(envelope.repeatedFields).toEqual([{ tag: 'ff', name: 'Nop', count: 2 }]);
  });

  it('metadata_is_parsed_correctly_from_chunks and properties_are_parsed_correctly_from_chunks', () => {
    const [metadata] = parseOne(envelopeScript(ord, [5], [0], [5], [1]));
    expect(metadata.metadata?.toString('hex')).toBe('0001');
    expect(metadata.metadataBytes).toBe(2);
    expect(metadata.flags.duplicate_field).toBe(true);
    const [properties] = parseOne(envelopeScript(ord, [17], [0], [17], [1]));
    expect(properties.properties?.toString('hex')).toBe('0001');
    expect(properties.flags.duplicate_field).toBe(true);
    const [empty] = parseOne(envelopeScript(ord, [5], []));
    expect(empty.metadata?.length).toBe(0);
  });

  it('several parents are all collected', () => {
    const [envelope] = parseOne(envelopeScript(ord, [3], idValue([]), [3], idValue([1, 0])));
    expect(envelope.parentValues).toHaveLength(2);
    expect(envelope.parents).toEqual([`${TXID}i0`]); // [1, 0] has a trailing zero outside the 4-byte form
    expect(envelope.flags.duplicate_field).toBe(true);
  });

  it('incomplete_field: a tag with no value', () => {
    const [envelope] = parseOne(envelopeScript(ord, [99]));
    expect(envelope.ordRecognized).toBe(true);
    expect(envelope.flaws).toEqual(['incomplete_field']);
  });

  it('body handling: no body, empty body, multiple pushes, invalid UTF-8', () => {
    expect(parseOne(envelopeScript(ord, [1], 'text/plain'))[0].hasBody).toBe(false);
    const [empty] = parseOne(envelopeScript(ord, [1], 'text/plain', [], [], [], []));
    expect([empty.hasBody, empty.bodyBytes]).toEqual([true, 0]);
    expect(parseOne(envelopeScript(ord, [], 'foo', 'bar'))[0].body.toString()).toBe('foobar');
    const [binary] = parseOne(envelopeScript(ord, [1], 'text/plain;charset=utf-8', [], [0x80]));
    expect([binary.ordRecognized, binary.body.toString('hex')]).toEqual([true, '80']);
  });
});

describe('envelope traversal (envelope.rs)', () => {
  it('multiple_inscriptions_in_a_single_witness: two envelopes, offsets 0 and 1', () => {
    const tapscript = Buffer.concat([
      envelopeScript(ord, [1], 'text/plain;charset=utf-8', [], 'foo'),
      envelopeScript(ord, [1], 'text/plain;charset=utf-8', [], 'bar'),
    ]);
    const envelopes = parseOne(tapscript);
    expect(envelopes.map(e => [e.input, e.offset, e.inscriptionIndex, e.body.toString()])).toEqual([[0, 0, 0, 'foo'], [0, 1, 1, 'bar']]);
  });

  it('extract_from_second_input and envelopes spread over two inputs keep transaction order', () => {
    const one = parseTransactionEnvelopes([[], witness(envelopeScript(ord, [1], 'foo', [], Buffer.alloc(1040, 1)))]);
    expect(one.map(e => [e.input, e.offset, e.inscriptionIndex, e.bodyBytes])).toEqual([[1, 0, 0, 1040]]);
    const spread = parseTransactionEnvelopes([
      witness(Buffer.concat([envelopeScript(ord, [], 'a'), envelopeScript(ord, [], 'b')])),
      witness(envelopeScript(ord, [], 'c')),
    ]);
    expect(spread.map(e => [e.input, e.offset, e.inscriptionIndex])).toEqual([[0, 0, 0], [0, 1, 1], [1, 0, 2]]);
  });

  it('valid_ignore_preceding and valid_ignore_trailing', () => {
    const tapscript = Buffer.concat([script(op(OP_CHECKSIG)), envelopeScript(ord, [1], 'text/plain', [], 'ord'), script(op(OP_CHECKSIG))]);
    expect(ORDINALS(parseOne(tapscript))).toHaveLength(1);
  });

  it('pushnum_opcodes_are_parsed_correctly', () => {
    const pushnums: [number, number][] = [[0x4f, 0x81], ...Array.from({ length: 16 }, (_, i) => [0x51 + i, i + 1] as [number, number])];
    for (const [code, value] of pushnums) {
      const [envelope] = parseOne(script(op(OP_FALSE), op(OP_IF), ord, op(OP_FALSE), op(code), op(OP_ENDIF)));
      expect(envelope.body).toEqual(Buffer.from([value]));
      expect(envelope.flags.pushnum).toBe(true);
    }
  });

  it('stuttering', () => {
    const cases: [Buffer, boolean][] = [
      [script(op(OP_FALSE), op(OP_FALSE), op(OP_IF), ord, op(OP_ENDIF)), true],
      [script(op(OP_FALSE), op(OP_IF), op(OP_FALSE), op(OP_IF), ord, op(OP_ENDIF)), true],
      [script(op(OP_FALSE), op(OP_IF), op(OP_FALSE), op(OP_IF), op(OP_FALSE), op(OP_IF), ord, op(OP_ENDIF)), true],
      [script(op(OP_FALSE), op(OP_FALSE), op(OP_AND), op(OP_FALSE), op(OP_IF), ord, op(OP_ENDIF)), false],
    ];
    for (const [tapscript, stutter] of cases) {
      const envelopes = ORDINALS(parseOne(tapscript));
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0].flags.stutter).toBe(stutter);
    }
  });

  it('no_endif, no_op_false, wrong_protocol_identifier and empty_envelope give no ord envelope', () => {
    const noEndif = parseOne(script(op(OP_FALSE), op(OP_IF), ord));
    expect(noEndif.map(e => [e.ordRecognized, e.incomplete, e.offset, e.inscriptionIndex])).toEqual([[false, true, null, null]]);
    expect(parseOne(script(op(OP_IF), ord, op(OP_ENDIF)))).toEqual([]);
    expect(parseOne(envelopeScript('foo'))).toEqual([]);
    expect(parseOne(envelopeScript())).toEqual([]);
  });

  it('ignore_unparsable_scripts: a malformed push discards every envelope of that input', () => {
    const tapscript = Buffer.concat([envelopeScript(ord), Buffer.from([0x01])]);
    const envelopes = parseTransactionEnvelopes([witness(tapscript), witness(envelopeScript(ord))]);
    expect(envelopes.map(e => [e.input, e.ordRecognized, e.inscriptionIndex])).toEqual([[0, false, null], [1, true, 0]]);
    expect(envelopes[0].incompleteReason).toMatch(/ord discards every envelope/);
  });

  it('ignore_key_path_spends, with and without annex; annex is skipped for script paths', () => {
    const tapscript = envelopeScript(ord);
    expect(parseTransactionEnvelopes([[tapscript]])).toEqual([]);
    expect(parseTransactionEnvelopes([[tapscript, Buffer.from([0x50])]])).toEqual([]);
    expect(ORDINALS(parseTransactionEnvelopes([[tapscript, Buffer.alloc(0), Buffer.from([0x50])]]))).toHaveLength(1);
    expect(tapscriptFromWitness([tapscript, Buffer.alloc(0), Buffer.from([0x50, 1])])).toEqual(tapscript);
    expect(tapscriptFromWitness([Buffer.alloc(0), tapscript, Buffer.alloc(0)])).toEqual(tapscript);
    expect(tapscriptFromWitness([])).toBeNull();
  });
});

describe('inscription IDs and pointers are unsigned (inscription_id.rs, inscription.rs)', () => {
  it.each([
    [[], 0], [[0, 0, 0, 0], 0], [[0x80], 128], [[0xff, 0xff, 0xff, 0x7f], 2147483647],
    [[0, 0, 0, 0x80], 2147483648], [[0xff, 0xff, 0xff, 0xff], 4294967295],
  ])('index bytes %j decode to %d', (bytes, index) => {
    expect(inscriptionIdFromValue(idValue(bytes))).toBe(`${TXID}i${index}`);
  });

  it('rejects short, long and trailing-zero variable-length values', () => {
    expect(inscriptionIdFromValue(Buffer.alloc(31))).toBeNull();
    expect(inscriptionIdFromValue(idValue([1, 2, 3, 4, 5]))).toBeNull();
    expect(inscriptionIdFromValue(idValue([1, 0]))).toBeNull();
    expect(inscriptionIdFromValue(idValue([0]))).toBeNull();
  });

  it('reads the txid as displayed (byte reversed)', () => {
    const txid = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    expect(inscriptionIdFromValue(Buffer.concat([txid, Buffer.from([1])]))).toBe(`${Buffer.from(txid).reverse().toString('hex')}i1`);
  });

  it('formats and parses indices 2147483648 and 4294967295 exactly', () => {
    for (const index of [0, 2147483647, 2147483648, 4294967295]) {
      const id = formatInscriptionId(TXID, index);
      expect(id).toBe(`${TXID}i${index}`);
      expect(parseInscriptionId(id)).toEqual({ txid: TXID, index });
    }
    expect(parseInscriptionId(`${TXID}i4294967296`)).toBeNull();
    expect(parseInscriptionId(`${TXID}i-1`)).toBeNull();
    expect(parseInscriptionId(`${TXID}i`)).toBeNull();
    expect(parseInscriptionId(`${TXID}:0`)).toBeNull();
    expect(parseInscriptionId(`${TXID}i+5`)).toEqual({ txid: TXID, index: 5 });
    expect(() => formatInscriptionId(TXID, 4294967296)).toThrow(RangeError);
    expect(() => formatInscriptionId(TXID, -1)).toThrow(RangeError);
  });

  it('parent and delegate tags carry high indices unsigned', () => {
    const [envelope] = parseOne(envelopeScript(ord, [3], idValue([0, 0, 0, 0x80]), [11], idValue([0xff, 0xff, 0xff, 0xff])));
    expect(envelope.parents).toEqual([`${TXID}i2147483648`]);
    expect(envelope.delegate).toBe(`${TXID}i4294967295`);
  });

  it('pointer: empty is zero, little endian, zero padding accepted, overflow rejected', () => {
    expect(decodePointer(Buffer.alloc(0))).toBe(0n);
    expect(decodePointer(Buffer.from([0, 1]))).toBe(256n);
    expect(decodePointer(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(1n);
    expect(decodePointer(Buffer.alloc(8, 0xff))).toBe(2n ** 64n - 1n);
    expect(decodePointer(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 1]))).toBeNull();
  });
});

describe('BRC-20 marker grammar (OPI 7933f5d0)', () => {
  const body = (contentType: string, json: string | Buffer, ...extra: Item[]): InscriptionEnvelope =>
    parseOne(envelopeScript(ord, [1], contentType, ...extra, [], typeof json === 'string' ? Buffer.from(json) : json))[0];
  const observe = (contentType: string, json: string | Buffer, ...extra: Item[]): Brc20Observation | null => observeBrc20(body(contentType, json, ...extra));

  it('accepts a deploy with string fields and keeps quantities as given', () => {
    const observation = observe('application/json', '{"p":"brc-20","op":"deploy","tick":"ordi","max":"21000000","lim":"1000","dec":"2"}');
    expect(observation).toMatchObject({ syntax: 'valid', op: 'deploy', tick: 'ordi', tick_bytes: 4, max: '21000000', lim: '1000', dec: '2', acceptance: 'authority-required' });
    expect(observation?.context_required).toContain('whether the ticker is already deployed');
  });

  it.each([
    ['{"p":"brc-20","op":"deploy","tick":"ordi"}', /max missing/],
    ['{"p":"brc-20","op":"deploy","tick":"ordi","max":"1.234","dec":"2"}', /3 fractional digits, more than 2/],
    ['{"p":"brc-20","op":"deploy","tick":"ordi","max":"100","lim":"0"}', /lim must not be zero/],
    ['{"p":"brc-20","op":"deploy","tick":"ordi","max":"100","dec":"19"}', /dec must be/],
    ['{"p":"brc-20","op":"mint","tick":"ordi","amt":1000}', /amt missing or not a string/],
    ['{"p":"brc-20","op":"mint","tick":"ordi","amt":"0"}', /must not be zero/],
    ['{"p":"brc-20","op":"mint","tick":"ordi","amt":"-1"}', /not a positive decimal/],
    ['{"p":"brc-20","op":"transfer","tick":"ord","amt":"1"}', /tick is 3 bytes/],
    ['{"p":"brc-20","op":"burn","tick":"ordi"}', /outside the deploy\/mint\/transfer grammar/],
    ['{"p":"brc-20","tick":"ordi"}', /op missing/],
    ['{"p":"brc-20","op":"deploy","tick":"abcde","max":"1"}', /five-byte deploy requires self_mint/],
  ])('keeps %s as invalid marker evidence', (json, issue) => {
    const observation = observe('text/plain;charset=utf-8', json);
    expect(observation?.syntax).toBe('invalid');
    expect(observation?.issues.join('; ')).toMatch(issue);
  });

  it('MIME must match exactly; whitespace or case changes are invalid evidence, other types are not BRC-20', () => {
    const json = '{"p":"brc-20","op":"mint","tick":"ordi","amt":"1"}';
    expect(observe('text/plain', json)?.syntax).toBe('valid');
    expect(observe('application/json;charset=utf-8', json)?.syntax).toBe('valid');
    expect(observe('text/plain ', json)?.syntax).toBe('invalid');
    expect(observe('Text/Plain', json)?.syntax).toBe('invalid');
  });

  it('invalid UTF-8, a BOM, non-object JSON and other p values carry no marker', () => {
    expect(observe('text/plain', Buffer.concat([Buffer.from('{"p":"brc-20","op":"mint","tick":"or'), Buffer.from([0xff]), Buffer.from('i","amt":"1"}')]))).toBeNull();
    expect(observe('text/plain', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"p":"brc-20","op":"mint","tick":"ordi","amt":"1"}')]))).toBeNull();
    expect(observe('text/plain', '["brc-20"]')).toBeNull();
    expect(observe('text/plain', '{"p":"BRC-20","op":"mint","tick":"ordi","amt":"1"}')).toBeNull();
  });

  it('six-byte tickers and mint precision are left to the authority', () => {
    const six = observe('text/plain', '{"p":"brc-20","op":"mint","tick":"abc-12","amt":"1.5"}');
    expect(six?.syntax).toBe('valid');
    expect(six?.context_required).toEqual(expect.arrayContaining(['six-byte ticker activation height', 'deployment existence and its decimals for amt precision']));
  });

  it('a byte-visible curse condition makes it cursed_for_brc20', () => {
    const observation = observe('text/plain', '{"p":"brc-20","op":"mint","tick":"ordi","amt":"1"}', [2], [1]);
    expect(observation?.curse_conditions).toEqual(['pointer']);
    expect(observation?.syntax).toBe('invalid');
  });

  it('a body over 4096 bytes is reported not-inspected with its size, never as absent', () => {
    const big = `{"p":"brc-20","op":"mint","tick":"ordi","amt":"1","pad":"${'x'.repeat(5000)}"}`;
    const observation = observe('application/json', big);
    expect(observation).toMatchObject({ inspection: 'not-inspected', syntax: 'not-inspected', body_bytes: Buffer.byteLength(big), inspection_limit_bytes: 4096 });
    const results = protocolRegistryService.decodePayload(envelopeScript(ord, [1], 'application/json', [], big).toString('hex'));
    expect(results.map(r => [r.protocol_id, r.status])).toEqual([['ordinals', 'decoded'], ['brc20', 'incomplete']]);
    expect(results[1].operation_type).toBe('brc20_not_inspected');
    expect(results[1].issues[0]).toMatch(new RegExp(`${Buffer.byteLength(big)} bytes exceeds the 4096-byte`));
    expect(observe('image/png', big)).toBeNull();
  });
});

describe('classification keeps every observation and leaves ownership to the authority', () => {
  it('one inscription carries several classifications at once', () => {
    const tapscript = envelopeScript(ord, [1], 'text/plain;charset=utf-8', [3], idValue([0, 0, 0, 0x80]), [7], 'brc-20', [],
      '{"p":"brc-20","op":"mint","tick":"ordi","amt":"1000"}');
    const results = protocolRegistryService.decodePayload(tapscript.toString('hex'));
    expect(results.map(r => [r.protocol_id, r.operation_type, r.status])).toEqual([
      ['ordinals', 'inscription_reveal', 'decoded'],
      ['brc20', 'brc20_mint', 'decoded'],
    ]);
    expect(results[0].parameters.classifications).toEqual(['ordinals:inscription', 'ordinals:child_claim', 'metaprotocol:brc-20', 'brc20:mint']);
    expect(results[0].parameters.parents).toEqual([`${TXID}i2147483648`]);
    expect(results[0].parameters.authority_required).toMatchObject({ parent_provenance: expect.stringMatching(/spent in the reveal/) });
    expect(results[1].parameters.balance_effect).toMatch(/^none/);
  });

  it('parser flags are curse conditions, not invalid or unbound verdicts', () => {
    const [flagged] = protocolRegistryService.decodePayload(envelopeScript(ord, [1], 'text/plain', [1], 'text/html', [], 'x').toString('hex'));
    expect(flagged.status).toBe('decoded');
    expect(flagged.operation_type).toBe('inscription_reveal');
    expect(flagged.parameters.curse_conditions).toEqual(['duplicate_field']);
    expect(flagged.parameters.authority_required).toMatchObject({
      curse_state: expect.stringMatching(/authority-required/), binding: expect.stringMatching(/authority-required/), location: 'authority-required',
    });
    const [even] = protocolRegistryService.decodePayload(envelopeScript(ord, [22], [0]).toString('hex'));
    expect(even.status).toBe('decoded');
    expect((even.parameters.authority_required as Record<string, unknown>).binding).toMatch(/^unbound per ord/);
  });

  it('a transaction gives candidate IDs in input and envelope order with position curses', () => {
    const txid = 'ab'.repeat(32);
    const witnesses = [
      witness(Buffer.concat([envelopeScript(ord, [], 'a'), envelopeScript(ord, [], 'b')])),
      witness(envelopeScript(ord, [], 'c')),
    ].map(stack => stack.map(item => item.toString('hex')));
    const results = protocolRegistryService.decodeTransactionInscriptions(txid, witnesses);
    expect(results.map(r => r.parameters.inscription_id)).toEqual([`${txid}i0`, `${txid}i1`, `${txid}i2`]);
    expect(results.map(r => r.parameters.curse_conditions)).toEqual([[], ['not_at_offset_zero'], ['not_in_first_input']]);
    expect(results.every(r => (r.parameters.authority_required as Record<string, unknown>).indexed === 'authority-required')).toBe(true);
  });
});
