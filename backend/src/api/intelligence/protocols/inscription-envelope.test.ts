// Differential vectors for the inscription envelope parser, taken from the
// tests in ord 0.29.0: src/inscriptions/envelope.rs, inscription.rs and
// inscription_id.rs. Each case names the ord test it reproduces. Scripts are
// built the way rust-bitcoin's Builder::push_slice builds them.
import {
  BRC20_INSPECTION_LIMIT_BYTES, decodePointer, InscriptionEnvelope, InscriptionTag, inscriptionIdFromValue,
  observeBrc20, parseBrc20, parseInscriptionEnvelopes, parseTransactionEnvelopes,
} from './inscription-envelope';
import { protocolRegistryService } from './protocol-registry.service';

const OP_FALSE = 0x00;
const OP_IF = 0x63;
const OP_ENDIF = 0x68;
const OP_AND = 0x84;
const OP_CHECKSIG = 0xac;
const OP_1NEGATE = 0x4f;
const OP_1 = 0x51;

type Part = number | Buffer | string | number[];

function push(data: Buffer): Buffer {
  if (data.length === 0) { return Buffer.from([0x00]); }
  if (data.length <= 75) { return Buffer.concat([Buffer.from([data.length]), data]); }
  if (data.length <= 255) { return Buffer.concat([Buffer.from([0x4c, data.length]), data]); }
  const length = Buffer.alloc(2);
  length.writeUInt16LE(data.length);
  return Buffer.concat([Buffer.from([0x4d]), length, data]);
}

const bytes = (part: Exclude<Part, number>): Buffer =>
  typeof part === 'string' ? Buffer.from(part, 'utf8') : Buffer.isBuffer(part) ? part : Buffer.from(part);

/** A number is an opcode; anything else is pushed as data. */
const script = (...parts: Part[]): Buffer =>
  Buffer.concat(parts.map(part => typeof part === 'number' ? Buffer.from([part]) : push(bytes(part))));

/** ord test helper `envelope`: OP_FALSE OP_IF <each payload push> OP_ENDIF. */
const envelope = (...payload: Exclude<Part, number>[]): Buffer => script(OP_FALSE, OP_IF, ...payload, OP_ENDIF);

const tag = (t: InscriptionTag): number[] => [t];

/** What ord's ParsedEnvelope::from_transaction would return for one tapscript. */
const ord = (tapscript: Buffer): InscriptionEnvelope[] => parseInscriptionEnvelopes(tapscript).filter(e => e.ordRecognized);

/** The fields of ord's Inscription that each vector asserts. */
const view = (e: InscriptionEnvelope) => ({
  offset: e.index,
  contentType: e.contentType,
  contentEncoding: e.contentEncoding,
  body: e.hasBody ? e.body.toString('hex') : null,
  pointer: e.pointer,
  metadataBytes: e.metadataBytes,
  propertiesBytes: e.properties?.length ?? 0,
  flags: e.flaws,
});

const plain = (contentType: string | null, body: string | null, extra: Partial<ReturnType<typeof view>> = {}) => ({
  offset: 0, contentType, contentEncoding: null, body, pointer: null, metadataBytes: 0, propertiesBytes: 0, flags: [], ...extra,
});

const hex = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

/** Fields ord leaves untaken, one entry per value, with ord's even/odd rule on the first tag byte. */
const unknown = (e: InscriptionEnvelope) => e.unknownFields.flatMap(f =>
  f.values.map(value => ({ tag: f.tag, value, even: parseInt(f.tag.slice(0, 2), 16) % 2 === 0 })));

const note = (e: InscriptionEnvelope): string | null => {
  const field = e.unknownFields.find(f => f.tag === '0f');
  return field ? Buffer.from(field.values[0], 'hex').toString('utf8') : null;
};

describe('tag identity follows ord tag.rs', () => {
  it('assigns each tag its ord 0.29.0 byte', () => {
    expect({ ...InscriptionTag }).toMatchObject({
      ContentType: 1, Pointer: 2, Parent: 3, Metadata: 5, Metaprotocol: 7, ContentEncoding: 9,
      Delegate: 11, Rune: 13, Note: 15, Properties: 17, PropertyEncoding: 19,
    });
  });

  it('tag 15 is the note and tag 17 is properties', () => {
    const [e] = ord(envelope('ord', [15], 'a note', [17], [1, 2, 3]));
    expect(note(e)).toBe('a note');
    expect(e.properties?.length).toBe(3);
    expect(unknown(e).filter(f => f.tag !== '0f')).toEqual([]);
  });

  it('a padded tag is not the one-byte tag it pads', () => {
    const [e] = ord(envelope('ord', [2, 0], [1]));
    expect(e.pointer).toBeNull();
    expect(e.flaws).toEqual(['unrecognized_even_field']);
    expect(unknown(e)).toEqual([{ tag: '0200', value: '01', even: true }]);
  });
});

describe('ord envelope.rs vectors', () => {
  it.each<[string, Buffer[]]>([
    ['empty', []],
    ['ignore_key_path_spends', [envelope('ord')]],
  ])('%s: a key-path witness has no tapscript', (_name, witness) => {
    expect(parseTransactionEnvelopes([witness])).toEqual([]);
  });

  it('ignore_key_path_spends_with_annex', () => {
    expect(parseTransactionEnvelopes([[envelope('ord'), Buffer.from([0x50])]])).toEqual([]);
  });

  it('parse_from_tapscript', () => {
    expect(ord(envelope('ord')).map(view)).toEqual([plain(null, null)]);
  });

  it('ignore_unparsable_scripts: ord drops the input, the observation is kept', () => {
    const s = Buffer.concat([envelope('ord'), Buffer.from([0x01])]);
    expect(ord(s)).toEqual([]);
    const [seen] = parseInscriptionEnvelopes(s);
    expect(seen).toMatchObject({ ordRecognized: false, incompleteReason: expect.stringMatching(/ord discards every envelope/) });
  });

  it('no_inscription', () => {
    expect(parseInscriptionEnvelopes(Buffer.alloc(0))).toEqual([]);
  });

  it('duplicate_field', () => {
    expect(ord(envelope('ord', [255], [], [255], [])).map(view)).toEqual([plain(null, null, { flags: ['duplicate_field'] })]);
  });

  it('with_content_type', () => {
    expect(ord(envelope('ord', tag(InscriptionTag.ContentType), 'text/plain;charset=utf-8', [], 'ord')).map(view))
      .toEqual([plain('text/plain;charset=utf-8', hex('ord'))]);
  });

  it('with_content_encoding', () => {
    expect(ord(envelope('ord', [1], 'text/plain;charset=utf-8', [9], 'br', [], 'ord')).map(view))
      .toEqual([plain('text/plain;charset=utf-8', hex('ord'), { contentEncoding: 'br' })]);
  });

  it('with_unknown_tag: an odd unknown tag is ignored but kept as an observation', () => {
    const [e] = ord(envelope('ord', [1], 'text/plain;charset=utf-8', [255], 'bar', [], 'ord'));
    expect(view(e)).toEqual(plain('text/plain;charset=utf-8', hex('ord')));
    expect(unknown(e)).toEqual([{ tag: 'ff', value: hex('bar'), even: false }]);
  });

  it('no_body', () => {
    expect(ord(envelope('ord', [1], 'text/plain;charset=utf-8')).map(view)).toEqual([plain('text/plain;charset=utf-8', null)]);
  });

  it('no_content_type', () => {
    expect(ord(envelope('ord', [], 'foo')).map(view)).toEqual([plain(null, hex('foo'))]);
  });

  it('valid_body_in_multiple_pushes', () => {
    expect(ord(envelope('ord', [1], 'text/plain;charset=utf-8', [], 'foo', 'bar')).map(view))
      .toEqual([plain('text/plain;charset=utf-8', hex('foobar'))]);
  });

  it('valid_body_in_zero_pushes', () => {
    expect(ord(envelope('ord', [1], 'text/plain;charset=utf-8', [])).map(view)).toEqual([plain('text/plain;charset=utf-8', '')]);
  });

  it('valid_body_in_multiple_empty_pushes', () => {
    expect(ord(envelope('ord', [1], 'text/plain;charset=utf-8', [], [], [], [], [], [])).map(view))
      .toEqual([plain('text/plain;charset=utf-8', '')]);
  });

  it('valid_ignore_trailing', () => {
    const s = script(OP_FALSE, OP_IF, 'ord', [1], 'text/plain;charset=utf-8', [], 'ord', OP_ENDIF, OP_CHECKSIG);
    expect(ord(s).map(view)).toEqual([plain('text/plain;charset=utf-8', hex('ord'))]);
  });

  it('valid_ignore_preceding', () => {
    const s = script(OP_CHECKSIG, OP_FALSE, OP_IF, 'ord', [1], 'text/plain;charset=utf-8', [], 'ord', OP_ENDIF);
    expect(ord(s).map(view)).toEqual([plain('text/plain;charset=utf-8', hex('ord'))]);
  });

  it('multiple_inscriptions_in_a_single_witness', () => {
    const s = Buffer.concat([
      envelope('ord', [1], 'text/plain;charset=utf-8', [], 'foo'),
      envelope('ord', [1], 'text/plain;charset=utf-8', [], 'bar'),
    ]);
    expect(ord(s).map(view)).toEqual([
      plain('text/plain;charset=utf-8', hex('foo')),
      plain('text/plain;charset=utf-8', hex('bar'), { offset: 1 }),
    ]);
  });

  it('invalid_utf8_does_not_render_inscription_invalid', () => {
    expect(ord(envelope('ord', [1], 'text/plain;charset=utf-8', [], [0b10000000])).map(view))
      .toEqual([plain('text/plain;charset=utf-8', '80')]);
  });

  it('no_endif: ord returns nothing, the observation is incomplete', () => {
    const s = script(OP_FALSE, OP_IF, 'ord');
    expect(ord(s)).toEqual([]);
    expect(parseInscriptionEnvelopes(s)[0]).toMatchObject({ incomplete: true, incompleteReason: 'script ends before OP_ENDIF', ordRecognized: false });
  });

  it.each<[string, Buffer]>([
    ['no_op_false', script(OP_IF, 'ord', OP_ENDIF)],
    ['empty_envelope', envelope()],
    ['wrong_protocol_identifier', envelope('foo')],
  ])('%s', (_name, s) => {
    expect(parseInscriptionEnvelopes(s)).toEqual([]);
  });

  it('a non-push opcode inside the envelope makes ord drop it', () => {
    const s = script(OP_FALSE, OP_IF, 'ord', [1], 'text/plain', OP_CHECKSIG, OP_ENDIF);
    expect(ord(s)).toEqual([]);
    expect(parseInscriptionEnvelopes(s)[0]).toMatchObject({ incompleteReason: expect.stringMatching(/non-push opcode 0xac/), ordRecognized: false });
  });

  it('extract_from_second_input and chunked_data_is_parsable', () => {
    // Inscription::append_reveal_script splits the body into 520-byte pushes.
    const reveal = script(OP_FALSE, OP_IF, 'ord', [1], 'foo', [], Buffer.alloc(520, 1), Buffer.alloc(520, 1), OP_ENDIF);
    const [e] = parseTransactionEnvelopes([[], [reveal, Buffer.alloc(0)]]);
    expect(e).toMatchObject({ input: 1, index: 0, inscriptionIndex: 0, contentType: 'foo', bodyBytes: 1040, flaws: [] });
    expect(e.body.equals(Buffer.alloc(1040, 1))).toBe(true);
  });

  it('extract_from_second_envelope', () => {
    const s = Buffer.concat([
      script(OP_FALSE, OP_IF, 'ord', [1], 'foo', [], Buffer.alloc(100, 1), OP_ENDIF),
      script(OP_FALSE, OP_IF, 'ord', [1], 'bar', [], Buffer.alloc(100, 1), OP_ENDIF),
    ]);
    expect(ord(s).map(e => [e.index, e.contentType, e.bodyBytes])).toEqual([[0, 'foo', 100], [1, 'bar', 100]]);
  });

  it('round_trip_with_no_fields', () => {
    expect(ord(envelope('ord')).map(view)).toEqual([plain(null, null)]);
  });

  it('unknown_odd_fields_are_ignored', () => {
    expect(ord(envelope('ord', [255], [0])).map(view)).toEqual([plain(null, null)]);
  });

  it('unknown_even_fields', () => {
    expect(ord(envelope('ord', [22], [0])).map(view)).toEqual([plain(null, null, { flags: ['unrecognized_even_field'] })]);
  });

  it('pointer_field_is_recognized', () => {
    expect(ord(envelope('ord', [2], [1])).map(view)).toEqual([plain(null, null, { pointer: 1n, flags: ['pointer'] })]);
  });

  it('duplicate_pointer_field_makes_inscription_unbound: the second value is left as an even field', () => {
    const [e] = ord(envelope('ord', [2], [1], [2], [0]));
    expect(view(e)).toEqual(plain(null, null, { pointer: 1n, flags: ['duplicate_field', 'unrecognized_even_field', 'pointer'] }));
    expect(unknown(e)).toEqual([{ tag: '02', value: '00', even: true }]);
  });

  it('tag_66_makes_inscriptions_unbound', () => {
    expect(ord(envelope('ord', [66], [1])).map(view)).toEqual([plain(null, null, { flags: ['unrecognized_even_field'] })]);
  });

  it('incomplete_field', () => {
    expect(ord(envelope('ord', [99])).map(view)).toEqual([plain(null, null, { flags: ['incomplete_field'] })]);
  });

  it('metadata_is_parsed_correctly', () => {
    const [e] = ord(envelope('ord', [5], []));
    expect(view(e)).toEqual(plain(null, null));
    expect(e.metadata).toEqual(Buffer.alloc(0));
  });

  it('metadata_is_parsed_correctly_from_chunks', () => {
    expect(ord(envelope('ord', [5], [0], [5], [1])).map(view)).toEqual([plain(null, null, { metadataBytes: 2, flags: ['duplicate_field'] })]);
  });

  it('properties_are_parsed_correctly', () => {
    expect(ord(envelope('ord', [17], [1, 2, 3])).map(view)).toEqual([plain(null, null, { propertiesBytes: 3 })]);
  });

  it('properties_are_parsed_correctly_from_chunks', () => {
    expect(ord(envelope('ord', [17], [0], [17], [1])).map(view)).toEqual([plain(null, null, { propertiesBytes: 2, flags: ['duplicate_field'] })]);
  });

  it('repeated parents are all kept and, as in ord, set duplicate_field', () => {
    const a = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from([1, 2, 3, 4])]);
    const b = Buffer.concat([Buffer.alloc(32, 0xff), Buffer.from([0, 2, 3, 4])]);
    const [e] = ord(envelope('ord', [3], a, [3], b));
    expect(e.parents).toEqual([`${'ff'.repeat(32)}i67305985`, `${'ff'.repeat(32)}i67305984`]);
    expect(e.flaws).toEqual(['duplicate_field']);
  });

  it('pushnum_opcodes_are_parsed_correctly', () => {
    const pushnums: [number, number][] = [[OP_1NEGATE, 0x81], ...Array.from({ length: 16 }, (_, n): [number, number] => [OP_1 + n, n + 1])];
    for (const [op, value] of pushnums) {
      const s = script(OP_FALSE, OP_IF, 'ord', OP_FALSE, op, OP_ENDIF);
      expect(ord(s).map(view)).toEqual([plain(null, Buffer.from([value]).toString('hex'), { flags: ['pushnum'] })]);
    }
  });

  it.each<[string, Buffer, boolean]>([
    ['OP_FALSE OP_FALSE OP_IF', script(OP_FALSE, OP_FALSE, OP_IF, 'ord', OP_ENDIF), true],
    ['OP_FALSE OP_IF OP_FALSE OP_IF', script(OP_FALSE, OP_IF, OP_FALSE, OP_IF, 'ord', OP_ENDIF), true],
    ['three nested OP_FALSE OP_IF', script(OP_FALSE, OP_IF, OP_FALSE, OP_IF, OP_FALSE, OP_IF, 'ord', OP_ENDIF), true],
    ['OP_FALSE OP_FALSE OP_AND OP_FALSE OP_IF', script(OP_FALSE, OP_FALSE, OP_AND, OP_FALSE, OP_IF, 'ord', OP_ENDIF), false],
  ])('stuttering: %s', (_name, s, stutter) => {
    expect(ord(s).map(view)).toEqual([plain(null, null, { flags: stutter ? ['stutter'] : [] })]);
  });
});

describe('ord inscription.rs pointer vectors', () => {
  it.each<[number[], bigint | null]>([
    [[0], 0n],
    [[], 0n],
    [[1, 2, 3, 4, 5, 6, 7, 8], 0x0807060504030201n],
    [[1, 2, 3, 4, 5, 6], 0x0000060504030201n],
    [[1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0], 0x0807060504030201n],
    [[1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 1], null],
    [[1, 2, 3, 4, 5, 6, 7, 8, 1], null],
    [[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 18446744073709551615n],
  ])('pointer_decode %j', (value, expected) => {
    expect(decodePointer(Buffer.from(value))).toBe(expected);
  });
});

describe('ord inscription_id.rs and parent/delegate vectors', () => {
  const seq = Buffer.from(Array.from({ length: 32 }, (_, n) => n));
  const ff = Buffer.alloc(32, 0xff);
  const ffTxid = 'ff'.repeat(32);

  it.each<[string, Buffer, string | null]>([
    ['parent field shorter than a txid', Buffer.alloc(0), null],
    ['parent field longer than txid and index', Buffer.alloc(37, 1), null],
    ['fixed 4-byte index with a trailing zero', Buffer.concat([Buffer.alloc(35, 1), Buffer.from([0])]), `${'01'.repeat(32)}i65793`],
    ['variable index with a trailing zero', Buffer.concat([Buffer.alloc(34, 1), Buffer.from([0])]), null],
    ['txid bytes are reversed for display', seq, '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100i0'],
    ['zero-byte index', Buffer.alloc(32, 1), `${'01'.repeat(32)}i0`],
    ['one-byte index', Buffer.concat([ff, Buffer.from([1])]), `${ffTxid}i1`],
    ['two-byte index', Buffer.concat([ff, Buffer.from([1, 2])]), `${ffTxid}i513`],
    ['three-byte index', Buffer.concat([ff, Buffer.from([1, 2, 3])]), `${ffTxid}i197121`],
    ['four-byte index', Buffer.concat([ff, Buffer.from([1, 2, 3, 4])]), `${ffTxid}i67305985`],
    ['index 2147483647', Buffer.concat([ff, Buffer.from([0xff, 0xff, 0xff, 0x7f])]), `${ffTxid}i2147483647`],
    ['index 2147483648 stays unsigned', Buffer.concat([ff, Buffer.from([0x00, 0x00, 0x00, 0x80])]), `${ffTxid}i2147483648`],
    ['index 4294967295', Buffer.concat([ff, Buffer.from([0xff, 0xff, 0xff, 0xff])]), `${ffTxid}i4294967295`],
    ['index 0 in the fixed 4-byte form', Buffer.concat([ff, Buffer.from([0, 0, 0, 0])]), `${ffTxid}i0`],
  ])('%s', (_name, value, expected) => {
    expect(inscriptionIdFromValue(value)).toBe(expected);
  });

  it('a delegate tag decodes to the same ID form', () => {
    const [e] = ord(envelope('ord', [11], Buffer.concat([ff, Buffer.from([0x00, 0x00, 0x00, 0x80])])));
    expect(e.delegate).toBe(`${ffTxid}i2147483648`);
  });
});

describe('transaction traversal', () => {
  it('assigns ord indexes across every input and envelope, skipping ones ord drops', () => {
    const two = Buffer.concat([envelope('ord', [], 'a'), envelope('ord', [], 'b')]);
    const broken = script(OP_FALSE, OP_IF, 'ord');
    const one = envelope('ord', [], 'c');
    const h = (x: string): Buffer => Buffer.from(x, 'hex');
    const result = parseTransactionEnvelopes([[two, h('c0')], [broken, h('c0')], [], [one, h('c0'), h('50aa')]]);
    expect(result.map(e => [e.input, e.index, e.inscriptionIndex, e.body.toString()])).toEqual([
      [0, 0, 0, 'a'], [0, 1, 1, 'b'], [1, 0, null, ''], [3, 0, 2, 'c'],
    ]);
  });
});

describe('classification keeps flags as observations', () => {
  it.each<[string, Buffer, string[]]>([
    ['unrecognized even field', envelope('ord', [1], 'text/plain', [22], [0], [], 'x'), ['unrecognized_even_field']],
    ['duplicate field', envelope('ord', [1], 'text/plain', [1], 'text/html', [], 'x'), ['duplicate_field']],
    ['incomplete field', envelope('ord', [1], 'text/plain', [99]), ['incomplete_field']],
    ['pushnum', script(OP_FALSE, OP_IF, 'ord', OP_FALSE, OP_1, OP_ENDIF), ['pushnum']],
  ])('%s is reported, not turned into an invalid or unbound result', (_name, s, flags) => {
    const [result] = protocolRegistryService.decodePayload(s.toString('hex'));
    expect(result.operation_type).toBe('inscription_reveal');
    expect(result.status).toBe('decoded');
    const set = result.parameters.flags as Record<string, boolean>;
    expect(Object.keys(set).filter(flag => set[flag])).toEqual(flags);
    const authority = result.parameters.authority_required as Record<string, string>;
    // Only an unrecognized even field settles binding from the bytes, exactly as ord does.
    expect(authority.binding).toMatch(flags.includes('unrecognized_even_field') ? /unbound per ord/ : /authority-required/);
    expect(authority.curse_state).toMatch(/authority-required/);
    expect(authority.location).toMatch(/authority-required/);
    expect(result.issues).toEqual(flags.map(flag => `envelope: ${flag}`));
  });

  it('every envelope in the script is returned in order', () => {
    const s = Buffer.concat([envelope('ord', [22], [0]), envelope('ord', [1], 'text/plain', [], 'ok'), script(OP_FALSE, OP_IF, 'ord', OP_CHECKSIG)]);
    const results = protocolRegistryService.decodePayload(s.toString('hex'));
    expect(results.map(r => [r.parameters.envelope_index, r.operation_type, r.status])).toEqual([
      [0, 'inscription_reveal', 'decoded'],
      [1, 'inscription_reveal', 'decoded'],
      [2, 'inscription_envelope_incomplete', 'incomplete'],
    ]);
  });
});

describe('BRC-20 marker observation limit', () => {
  const brcEnvelope = (body: string): InscriptionEnvelope =>
    parseInscriptionEnvelopes(envelope('ord', [1], 'text/plain', [], ...chunks(Buffer.from(body))))[0];
  const chunks = (data: Buffer): Buffer[] => {
    const out: Buffer[] = [];
    for (let k = 0; k < data.length; k += 520) { out.push(data.subarray(k, k + 520)); }
    return out;
  };
  const marker = '{"p":"brc-20","op":"transfer","tick":"ordi","amt":"1"}';

  it('a body within the limit yields a marker', () => {
    expect(parseBrc20(brcEnvelope(marker))).toMatchObject({ op: 'transfer', tick: 'ordi', amt: '1' });
  });

  it('a body over the limit yields an explicit truncated observation, not silence', () => {
    const big = marker.slice(0, -1) + ',"pad":"' + 'x'.repeat(BRC20_INSPECTION_LIMIT_BYTES) + '"}';
    expect(observeBrc20(brcEnvelope(big))).toMatchObject({
      inspection: 'not-inspected', body_bytes: Buffer.byteLength(big), inspection_limit_bytes: BRC20_INSPECTION_LIMIT_BYTES,
    });
    const s = envelope('ord', [1], 'text/plain', [], ...chunks(Buffer.from(big)));
    const results = protocolRegistryService.decodePayload(s.toString('hex'));
    expect(results.map(r => [r.protocol_id, r.operation_type, r.status])).toEqual([
      ['ordinals', 'inscription_reveal', 'decoded'],
      ['brc20', 'brc20_not_inspected', 'incomplete'],
    ]);
    expect(results[1].issues[0]).toMatch(/BRC-20 content not inspected/);
  });

  it('a valid marker is syntactic with acceptance left to the authority, never a balance', () => {
    const results = protocolRegistryService.decodePayload(envelope('ord', [1], 'text/plain', [], marker).toString('hex'));
    expect(results[1]).toMatchObject({
      protocol_id: 'brc20', operation_type: 'brc20_transfer', decoding_level: 'syntactic',
      parameters: { op: 'transfer', tick: 'ordi', amt: '1', acceptance: 'authority-required' },
    });
    expect(results[1].parameters).not.toHaveProperty('balance');
  });
});
