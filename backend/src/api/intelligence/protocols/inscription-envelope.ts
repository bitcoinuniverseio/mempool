// Ordinals inscription envelope parser following ord's envelope.rs:
// OP_FALSE OP_IF "ord" <tag> <value> ... OP_0 <body chunks> OP_ENDIF.
// Every envelope in every input is returned as an observation. Whether ord
// would index it, and which flags it carries, come from the bytes; location,
// curse/vindication, binding and parent provenance need ord's chain context.
import { TextDecoder } from 'util';
import { OP_1, OP_16, OP_1NEGATE, OP_ENDIF, OP_IF, isPush, parseScript, ScriptInstruction } from './script-parser';

const PROTOCOL_ID = Buffer.from('ord', 'utf8');

/** Pinned reference revisions these rules were taken from. */
export const ORD_REFERENCE = 'ord 0.29.0 (7e37a3bd3391044b39f5f11f20dfdb8b3764cd0e)';
export const BRC20_REFERENCE = 'OPI 7933f5d05d978fc226df8126026ed92f8c45d03b';

/*
 * Tag identity follows ord 0.29.0 (7e37a3bd) src/inscriptions/tag.rs and envelope.rs: a tag is the raw
 * push bytes, so only an exact one-byte push matches a known tag. Fields left over after ord's takes
 * (including Note=15, Unbound=66 and Nop=255, which ord never takes) are kept as unknown fields; any
 * leftover whose first byte is even sets unrecognized_even_field. Metadata and Properties concatenate
 * repeated chunks, Parent collects every value, and any repeated tag still sets duplicate_field.
 */
export enum InscriptionTag {
  ContentType = 1,
  Pointer = 2,
  Parent = 3,
  Metadata = 5,
  Metaprotocol = 7,
  ContentEncoding = 9,
  Delegate = 11,
  Rune = 13,
  Note = 15,
  Properties = 17,
  PropertyEncoding = 19,
  Unbound = 66,
  Nop = 255,
}

export type EnvelopeFlag = 'pushnum' | 'stutter' | 'incomplete_field' | 'duplicate_field' | 'unrecognized_even_field' | 'pointer';

/** Curse conditions in the order ord's inscription_updater.rs checks them; reinscription needs chain state. */
export type CurseCondition = 'unrecognized_even_field' | 'duplicate_field' | 'incomplete_field' | 'not_in_first_input'
  | 'not_at_offset_zero' | 'pointer' | 'pushnum' | 'stutter';

export interface EnvelopeField {
  /** Raw tag bytes as hex; '01' is ContentType, '0100' is an unknown odd tag. */
  tag: string;
  name: string | null;
  values: string[];
}

export interface InscriptionEnvelope {
  /** Order of this observation among the envelopes seen in its script. */
  index: number;
  /** Transaction input index; null when a bare script was decoded. */
  input: number | null;
  /** ord's envelope offset within the input; null when ord would not return the envelope. */
  offset: number | null;
  /** Position among all ord-recognized envelopes of the transaction; null for a bare script or unrecognized envelope. */
  inscriptionIndex: number | null;
  /** ord's envelope parser would return this envelope (OP_ENDIF reached and the tapscript parses). */
  ordRecognized: boolean;
  /** The envelope did not close before the script stopped or a non-push opcode appeared. */
  incomplete: boolean;
  incompleteReason: string | null;
  contentType: string | null;
  contentTypeHex: string | null;
  contentEncoding: string | null;
  metaprotocol: string | null;
  /** Pointer decoded per ord's Inscription::pointer(); null when absent or not representable as u64. */
  pointer: bigint | null;
  pointerHex: string | null;
  /** Parent values that decode to inscription IDs; each is only a claim until the authority checks the reveal spends it. */
  parents: string[];
  parentValues: string[];
  delegate: string | null;
  delegateHex: string | null;
  runeField: boolean;
  runeHex: string | null;
  metadata: Buffer | null;
  metadataBytes: number;
  properties: Buffer | null;
  propertyEncoding: string | null;
  /** Fields ord does not take (Note, Unbound, Nop and unknown tags), preserved with their raw values. */
  unknownFields: EnvelopeField[];
  /** Tags pushed more than once; chunked Metadata/Properties are assembled but still listed here. */
  repeatedFields: { tag: string; name: string | null; count: number }[];
  hasBody: boolean;
  bodyBytes: number;
  body: Buffer;
  flags: Record<EnvelopeFlag, boolean>;
  /** Names of the set flags, in a stable order. */
  flaws: EnvelopeFlag[];
}

const TAG_NAMES: Record<number, string> = {
  1: 'ContentType', 2: 'Pointer', 3: 'Parent', 5: 'Metadata', 7: 'Metaprotocol', 9: 'ContentEncoding',
  11: 'Delegate', 13: 'Rune', 15: 'Note', 17: 'Properties', 19: 'PropertyEncoding', 66: 'Unbound', 255: 'Nop',
};

function tagName(tag: string): string | null {
  return tag.length === 2 ? TAG_NAMES[parseInt(tag, 16)] ?? null : null;
}

// ignoreBOM keeps a leading BOM in the text, as Rust's from_utf8 and serde_json see it.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function utf8OrNull(value: Buffer | null): string | null {
  if (value === null) { return null; }
  try { return strictUtf8.decode(value); } catch { return null; }
}

/*
 * Inscription IDs follow ord 0.29.0 (7e37a3bd) src/inscriptions/inscription_id.rs: the index is a u32,
 * written as txid + 'i' + decimal index. The tag value is the 32-byte txid plus 0 to 4 little-endian
 * index bytes; trailing zero bytes are accepted only in the fixed 4-byte form. Arithmetic is plain
 * unsigned multiplication so indices at or above 2^31 never turn negative.
 */
export const MAX_INSCRIPTION_INDEX = 4294967295;

export function formatInscriptionId(txid: string, index: number): string {
  if (!/^[0-9a-f]{64}$/.test(txid)) { throw new RangeError('txid must be 64 lowercase hex characters'); }
  if (!Number.isInteger(index) || index < 0 || index > MAX_INSCRIPTION_INDEX) { throw new RangeError('inscription index must be a u32'); }
  return `${txid}i${index}`;
}

/** Parses "<txid>i<index>" as ord's FromStr does: ASCII, 64 hex txid, 'i', then a u32 (Rust parse also accepts a leading '+'). */
export function parseInscriptionId(value: string): { txid: string; index: number } | null {
  if (value.length < 66 || [...value].some(char => char.charCodeAt(0) > 0x7f)) { return null; }
  const txid = value.slice(0, 64);
  if (!/^[0-9a-fA-F]{64}$/.test(txid) || value[64] !== 'i') { return null; }
  const digits = value.slice(65);
  if (!/^\+?[0-9]+$/.test(digits)) { return null; }
  const index = Number(digits.replace(/^\+/, ''));
  if (!Number.isSafeInteger(index) || index > MAX_INSCRIPTION_INDEX) { return null; }
  return { txid: txid.toLowerCase(), index };
}

export function inscriptionIdFromValue(data: Buffer): string | null {
  if (data.length < 32 || data.length > 36) { return null; }
  const indexBytes = data.subarray(32);
  if (indexBytes.length > 0 && indexBytes.length !== 4 && indexBytes[indexBytes.length - 1] === 0) { return null; }
  let index = 0;
  for (let i = 0; i < indexBytes.length; i++) { index += indexBytes[i] * 2 ** (8 * i); }
  return `${Buffer.from(data.subarray(0, 32)).reverse().toString('hex')}i${index}`;
}

/** ord's Inscription::pointer(): little endian u64, empty is zero, bytes past the eighth must be zero. */
export function decodePointer(value: Buffer): bigint | null {
  if (value.subarray(8).some(byte => byte !== 0)) { return null; }
  let pointer = 0n;
  for (let i = Math.min(value.length, 8) - 1; i >= 0; i--) { pointer = (pointer << 8n) | BigInt(value[i]); }
  return pointer;
}

/**
 * rust-bitcoin 0.32 Witness::tapscript() as ord calls it: one element, or two with an annex (last element
 * starting 0x50), is a key-path spend; otherwise the leaf script is third to last with an annex, else second to last.
 */
export function tapscriptFromWitness(witness: Buffer[]): Buffer | null {
  const hasAnnex = witness.length >= 2 && witness[witness.length - 1][0] === 0x50;
  if (witness.length < 2 || (hasAnnex && witness.length === 2)) { return null; }
  return witness[witness.length - (hasAnnex ? 3 : 2)];
}

interface RawEnvelope {
  payload: Buffer[];
  pushnum: boolean;
  stutter: boolean;
  offset: number | null;
  incompleteReason: string | null;
}

const isEmptyPush = (instruction: ScriptInstruction | undefined): boolean =>
  instruction !== undefined && isPush(instruction) && instruction.data.length === 0;

/** Mirrors RawEnvelope::from_tapscript, additionally keeping envelopes ord drops as incomplete observations. */
function rawEnvelopes(script: Buffer): RawEnvelope[] {
  const { instructions, error } = parseScript(script);
  const found: RawEnvelope[] = [];
  let completed = 0;
  let stuttered = false;
  let i = 0;
  while (i < instructions.length) {
    if (!isEmptyPush(instructions[i++])) { continue; }
    if (instructions[i]?.opcode !== OP_IF) { stuttered = isEmptyPush(instructions[i]); continue; }
    i++;
    const marker = instructions[i];
    if (!marker || !isPush(marker) || !marker.data.equals(PROTOCOL_ID)) { stuttered = isEmptyPush(marker); continue; }
    i++;
    const envelope: RawEnvelope = { payload: [], pushnum: false, stutter: stuttered, offset: null, incompleteReason: null };
    for (;;) {
      const instruction = instructions[i++];
      if (instruction === undefined) {
        envelope.incompleteReason = error ? `script error: ${error.reason} at byte ${error.offset}` : 'script ends before OP_ENDIF';
        stuttered = false;
        break;
      }
      if (isPush(instruction)) { envelope.payload.push(instruction.data); continue; }
      if (instruction.opcode === OP_ENDIF) { envelope.offset = completed++; break; }
      if (instruction.opcode === OP_1NEGATE) { envelope.pushnum = true; envelope.payload.push(Buffer.from([0x81])); continue; }
      if (instruction.opcode >= OP_1 && instruction.opcode <= OP_16) {
        envelope.pushnum = true;
        envelope.payload.push(Buffer.from([instruction.opcode - OP_1 + 1]));
        continue;
      }
      envelope.incompleteReason = `non-push opcode 0x${instruction.opcode.toString(16).padStart(2, '0')} inside the envelope`;
      stuttered = false;
      break;
    }
    found.push(envelope);
  }
  if (error) {
    // ord's instruction iterator fails on the malformed push, which discards every envelope of this input.
    for (const envelope of found) {
      if (envelope.offset !== null) {
        envelope.offset = null;
        envelope.incompleteReason = `script error: ${error.reason} at byte ${error.offset}; ord discards every envelope of this script`;
      }
    }
  }
  return found;
}

/** Mirrors ParsedEnvelope::from(RawEnvelope). */
function parseEnvelope(raw: RawEnvelope, index: number): InscriptionEnvelope {
  const bodyAt = raw.payload.findIndex((push, i) => i % 2 === 0 && push.length === 0);
  const head = bodyAt === -1 ? raw.payload : raw.payload.slice(0, bodyAt);
  const fields = new Map<string, Buffer[]>();
  let incompleteField = false;
  for (let i = 0; i < head.length; i += 2) {
    if (i + 1 >= head.length) { incompleteField = true; break; }
    const key = head[i].toString('hex');
    const values = fields.get(key);
    if (values) { values.push(head[i + 1]); } else { fields.set(key, [head[i + 1]]); }
  }
  const repeatedFields = [...fields].filter(([, values]) => values.length > 1)
    .map(([tag, values]) => ({ tag, name: tagName(tag), count: values.length }));
  const key = (tag: InscriptionTag): string => Buffer.from([tag]).toString('hex');
  const take = (tag: InscriptionTag): Buffer | null => {
    const values = fields.get(key(tag));
    const value = values?.shift();
    if (!values || value === undefined) { return null; }
    if (values.length === 0) { fields.delete(key(tag)); }
    return value;
  };
  const takeChunked = (tag: InscriptionTag): Buffer | null => {
    const values = fields.get(key(tag));
    fields.delete(key(tag));
    return values && values.length > 0 ? Buffer.concat(values) : null;
  };
  const takeArray = (tag: InscriptionTag): Buffer[] => {
    const values = fields.get(key(tag)) ?? [];
    fields.delete(key(tag));
    return values;
  };

  const contentEncoding = take(InscriptionTag.ContentEncoding);
  const contentType = take(InscriptionTag.ContentType);
  const delegate = take(InscriptionTag.Delegate);
  const metadata = takeChunked(InscriptionTag.Metadata);
  const metaprotocol = take(InscriptionTag.Metaprotocol);
  const parents = takeArray(InscriptionTag.Parent);
  const pointer = take(InscriptionTag.Pointer);
  const properties = takeChunked(InscriptionTag.Properties);
  const propertyEncoding = take(InscriptionTag.PropertyEncoding);
  const rune = take(InscriptionTag.Rune);

  const unknownFields = [...fields].map(([tag, values]) => ({ tag, name: tagName(tag), values: values.map(v => v.toString('hex')) }));
  const unrecognizedEvenField = [...fields.keys()].some(tag => parseInt(tag.slice(0, 2), 16) % 2 === 0);
  const body = bodyAt === -1 ? Buffer.alloc(0) : Buffer.concat(raw.payload.slice(bodyAt + 1));

  const flags: Record<EnvelopeFlag, boolean> = {
    pushnum: raw.pushnum,
    stutter: raw.stutter,
    incomplete_field: incompleteField,
    duplicate_field: repeatedFields.length > 0,
    unrecognized_even_field: unrecognizedEvenField,
    pointer: pointer !== null,
  };
  return {
    index,
    input: null,
    offset: raw.offset,
    inscriptionIndex: null,
    ordRecognized: raw.offset !== null,
    incomplete: raw.offset === null,
    incompleteReason: raw.incompleteReason,
    contentType: utf8OrNull(contentType),
    contentTypeHex: contentType ? contentType.toString('hex') : null,
    contentEncoding: utf8OrNull(contentEncoding),
    metaprotocol: utf8OrNull(metaprotocol),
    pointer: pointer ? decodePointer(pointer) : null,
    pointerHex: pointer ? pointer.toString('hex') : null,
    parents: parents.map(inscriptionIdFromValue).filter((id): id is string => id !== null),
    parentValues: parents.map(value => value.toString('hex')),
    delegate: delegate ? inscriptionIdFromValue(delegate) : null,
    delegateHex: delegate ? delegate.toString('hex') : null,
    runeField: rune !== null,
    runeHex: rune ? rune.toString('hex') : null,
    metadata,
    metadataBytes: metadata ? metadata.length : 0,
    properties,
    propertyEncoding: propertyEncoding ? propertyEncoding.toString('hex') : null,
    unknownFields,
    repeatedFields,
    hasBody: bodyAt !== -1,
    bodyBytes: body.length,
    body,
    flags,
    flaws: (Object.keys(flags) as EnvelopeFlag[]).filter(flag => flags[flag]),
  };
}

/** Every envelope in one tapscript, in order, including ones ord would drop (marked incomplete). */
export function parseInscriptionEnvelopes(script: Buffer): InscriptionEnvelope[] {
  return rawEnvelopes(script).map((raw, index) => parseEnvelope(raw, index));
}

/*
 * Transaction traversal follows ord 0.29.0 (7e37a3bd) ParsedEnvelope::from_transaction: every input's
 * script-path tapscript, every envelope in order. The transaction-wide inscription index counts only
 * envelopes ord returns. Location, curse/vindication, binding and parent provenance stay with the authority.
 */
export function parseTransactionEnvelopes(witnesses: Buffer[][]): InscriptionEnvelope[] {
  const all: InscriptionEnvelope[] = [];
  let next = 0;
  witnesses.forEach((witness, input) => {
    const script = tapscriptFromWitness(witness);
    if (!script) { return; }
    for (const envelope of parseInscriptionEnvelopes(script)) {
      envelope.input = input;
      if (envelope.ordRecognized) {
        if (next > MAX_INSCRIPTION_INDEX) { throw new RangeError('more envelopes than a u32 inscription index can number'); }
        envelope.inscriptionIndex = next++;
      }
      all.push(envelope);
    }
  });
  return all;
}

/** Curse conditions visible in the bytes; input position is unknown for a bare script. Reinscription needs chain state. */
export function observedCurseConditions(envelope: InscriptionEnvelope): CurseCondition[] {
  const conditions: CurseCondition[] = [];
  if (envelope.flags.unrecognized_even_field) { conditions.push('unrecognized_even_field'); }
  if (envelope.flags.duplicate_field) { conditions.push('duplicate_field'); }
  if (envelope.flags.incomplete_field) { conditions.push('incomplete_field'); }
  if (envelope.input !== null && envelope.input !== 0) { conditions.push('not_in_first_input'); }
  if (envelope.offset !== null && envelope.offset !== 0) { conditions.push('not_at_offset_zero'); }
  if (envelope.flags.pointer) { conditions.push('pointer'); }
  if (envelope.flags.pushnum) { conditions.push('pushnum'); }
  if (envelope.flags.stutter) { conditions.push('stutter'); }
  return conditions;
}

/*
 * BRC-20 marker grammar follows OPI 7933f5d0 (ord/db_reader is_valid_brc20, brc20_index utils.rs and
 * brc20_indexer.rs): exact text/plain or application/json MIME, a UTF-8 JSON object with p "brc-20",
 * string op/tick/amt/max/lim/dec and byte-counted tickers. Results are observations only; deployment
 * state and activation heights stay authority-required. The 4096-byte limit is a local inspection
 * bound reported as not-inspected, never as absence or invalidity.
 */
export const BRC20_INSPECTION_LIMIT_BYTES = 4096;
const BRC20_MAX_DECIMALS = 18;
const BRC20_MAX_AMOUNT = (2n ** 64n - 1n) * 10n ** 18n;

export interface Brc20Observation {
  ruleset: string;
  inspection: 'inspected' | 'not-inspected';
  body_bytes: number;
  inspection_limit_bytes: number;
  syntax: 'valid' | 'invalid' | 'not-inspected';
  op: string | null;
  tick: string | null;
  tick_bytes: number | null;
  amt: string | null;
  max: string | null;
  lim: string | null;
  dec: string | null;
  self_mint: string | null;
  /** Byte-visible conditions that make the pinned OPI treat the inscription as cursed_for_brc20. */
  curse_conditions: CurseCondition[];
  issues: string[];
  /** Checks only the BRC-20 authority can make (deployment, decimals, activation heights, parent proof). */
  context_required: string[];
  acceptance: 'authority-required';
}

function brc20MimeAccepted(contentType: string | null): boolean {
  return contentType !== null && (contentType === 'text/plain' || contentType.startsWith('text/plain;')
    || contentType === 'application/json' || contentType.startsWith('application/json;'));
}

/** OPI get_amount_value without the deployment-specific precision check; returns the issue or null. */
function brc20AmountIssue(name: string, value: unknown, decimals: number, allowZero: boolean): string | null {
  if (typeof value !== 'string') { return `${name} missing or not a string`; }
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) { return `${name} is not a positive decimal string`; }
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > decimals) { return `${name} has ${fraction.length} fractional digits, more than ${decimals}`; }
  const atomic = BigInt(integer + fraction.padEnd(18, '0'));
  if (atomic > BRC20_MAX_AMOUNT) { return `${name} exceeds the BRC-20 maximum amount`; }
  if (atomic === 0n && !allowZero) { return `${name} must not be zero`; }
  return null;
}

/** BRC-20 observation for one envelope, or null when the body carries no BRC-20 marker. */
export function observeBrc20(envelope: InscriptionEnvelope): Brc20Observation | null {
  if (!envelope.hasBody || envelope.bodyBytes === 0) { return null; }
  const mimeAccepted = brc20MimeAccepted(envelope.contentType);
  const observation: Brc20Observation = {
    ruleset: BRC20_REFERENCE, inspection: 'inspected', body_bytes: envelope.bodyBytes,
    inspection_limit_bytes: BRC20_INSPECTION_LIMIT_BYTES, syntax: 'valid', op: null, tick: null, tick_bytes: null,
    amt: null, max: null, lim: null, dec: null, self_mint: null,
    curse_conditions: observedCurseConditions(envelope), issues: [], context_required: [], acceptance: 'authority-required',
  };
  if (envelope.bodyBytes > BRC20_INSPECTION_LIMIT_BYTES) {
    if (!mimeAccepted) { return null; }
    observation.inspection = 'not-inspected';
    observation.syntax = 'not-inspected';
    observation.issues.push(`body of ${envelope.bodyBytes} bytes exceeds the ${BRC20_INSPECTION_LIMIT_BYTES}-byte local inspection limit; BRC-20 content not inspected`);
    return observation;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(strictUtf8.decode(envelope.body));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).p !== 'brc-20') { return null; }
  const json = parsed as Record<string, unknown>;
  const invalid = (issue: string): void => { observation.syntax = 'invalid'; observation.issues.push(issue); };
  const text = (value: unknown): string | null => typeof value === 'string' ? value : null;

  if (!mimeAccepted) { invalid(`content type ${JSON.stringify(envelope.contentType)} is not exactly text/plain or application/json`); }
  if (observation.curse_conditions.length > 0) {
    invalid(`cursed_for_brc20: ${observation.curse_conditions.join(', ')}`);
  }
  observation.context_required.push('reinscription and binding state of this inscription');

  observation.op = text(json.op);
  observation.tick = text(json.tick);
  observation.amt = text(json.amt);
  observation.max = text(json.max);
  observation.lim = text(json.lim);
  observation.dec = text(json.dec);
  observation.self_mint = text(json.self_mint);
  const op = observation.op;
  if (op === null) { invalid('op missing or not a string'); return observation; }
  if (op !== 'deploy' && op !== 'mint' && op !== 'transfer') { invalid(`op ${JSON.stringify(op)} is outside the deploy/mint/transfer grammar`); return observation; }
  const tick = observation.tick;
  if (tick === null) { invalid('tick missing or not a string'); return observation; }
  const tickBytes = Buffer.byteLength(tick, 'utf8');
  observation.tick_bytes = tickBytes;
  if (tick.includes('\x00')) {
    invalid('tick contains a NUL character');
  } else if (tickBytes === 6) {
    if (!/^[A-Za-z0-9-]+$/.test(tick)) { invalid('six-byte tick must be ASCII alphanumeric or dash'); }
    observation.context_required.push('six-byte ticker activation height');
  } else if (tickBytes !== 4 && tickBytes !== 5) {
    invalid(`tick is ${tickBytes} bytes; 4, 5 or 6 are accepted`);
  }

  if (op === 'deploy') {
    let decimals = BRC20_MAX_DECIMALS;
    if (observation.dec !== null) {
      if (!/^[0-9]+$/.test(observation.dec) || Number(observation.dec) > BRC20_MAX_DECIMALS) {
        invalid('dec must be a decimal integer string no greater than 18');
      } else {
        decimals = Number(observation.dec);
      }
    }
    const maxIssue = brc20AmountIssue('max', json.max, decimals, true);
    if (maxIssue) { invalid(maxIssue); }
    if (json.lim !== undefined) {
      const limIssue = brc20AmountIssue('lim', json.lim, decimals, false);
      if (limIssue) { invalid(limIssue); }
    }
    if (tickBytes === 5) {
      if (observation.self_mint !== 'true') { invalid('a five-byte deploy requires self_mint "true"'); }
      observation.context_required.push('self-mint activation height');
    }
    if (tickBytes === 6) { observation.context_required.push('salt, predeploy and parent proof for a six-byte deploy'); }
    observation.context_required.push('whether the ticker is already deployed');
  } else {
    const amtIssue = brc20AmountIssue('amt', json.amt, BRC20_MAX_DECIMALS, false);
    if (amtIssue) { invalid(amtIssue); }
    observation.context_required.push('deployment existence and its decimals for amt precision');
    if (op === 'mint') {
      observation.context_required.push(tickBytes === 5 ? 'remaining supply, lim and parent proof for self-mint' : 'remaining supply and lim');
    } else {
      observation.context_required.push('available balance of the inscribing script');
    }
  }
  return observation;
}

/** The fields of a syntactically valid BRC-20 deploy/mint/transfer, or null. */
export function parseBrc20(envelope: InscriptionEnvelope): { op: string; tick: string; amt?: string; max?: string; lim?: string; dec?: string } | null {
  const observation = observeBrc20(envelope);
  if (!observation || observation.syntax !== 'valid' || observation.op === null || observation.tick === null) { return null; }
  const out: { op: string; tick: string; amt?: string; max?: string; lim?: string; dec?: string } = { op: observation.op, tick: observation.tick };
  for (const key of ['amt', 'max', 'lim', 'dec'] as const) {
    const value = observation[key];
    if (value !== null) { out[key] = value; }
  }
  return out;
}
