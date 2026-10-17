// Ordinals inscription envelope parser following ord 0.29.0 envelope.rs:
// OP_FALSE OP_IF "ord" <tag> <value> ... OP_0 <body chunks> OP_ENDIF.
// Tags are matched as raw bytes, so a padded tag such as 0x0200 is not the
// pointer tag. Field flags are recorded as ord records them; whether an
// inscription ends up cursed, unbound or at a given location depends on the
// transaction, the network and the height, so this parser never decides it.
import { OP_1, OP_16, OP_1NEGATE, OP_ENDIF, OP_IF, isPush, parseScript, ScriptInstruction } from './script-parser';

const PROTOCOL_ID = Buffer.from('ord', 'utf8');

/** One-byte tag values from ord 0.29.0 src/inscriptions/tag.rs. */
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
}

/** Flags ord sets while parsing an envelope. They are observations, not a final state. */
export type InscriptionFlag = 'duplicate_field' | 'incomplete_field' | 'unrecognized_even_field' | 'pushnum' | 'stutter';

export interface InscriptionField {
  tag: string;
  value: string;
}

export interface InscriptionEnvelope {
  /** Index of this envelope within the script, in order of appearance (ord's offset). */
  index: number;
  contentType: string | null;
  contentEncoding: string | null;
  metaprotocol: string | null;
  /** Decoded with ord's u64 little-endian rule; null when absent or out of range. */
  pointer: bigint | null;
  /** Parent IDs that decode under ord's rules. A tag is a claim, not proven parentage. */
  parents: string[];
  delegate: string | null;
  runeField: boolean;
  note: string | null;
  metadataBytes: number;
  propertiesBytes: number;
  propertyEncoding: string | null;
  /** Whether the envelope has a body tag at all; a missing body differs from an empty one. */
  hasBody: boolean;
  bodyBytes: number;
  body: Buffer;
  /** Every tag/value pair before the body, in order, as hex. */
  fields: InscriptionField[];
  /** Fields left after taking the recognized tags, as ord leaves them. */
  unrecognizedFields: (InscriptionField & { even: boolean })[];
  flaws: InscriptionFlag[];
  /** The script ended before OP_ENDIF, or a push in the script is truncated. */
  incomplete: boolean;
  /** How the envelope ended: OP_ENDIF, end of script, or another opcode that ord rejects. */
  termination: 'endif' | 'end_of_script' | 'non_push_opcode';
  /** True when ord would return this envelope: closed by OP_ENDIF in a script that parses fully. */
  ordRecognized: boolean;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function utf8OrNull(value: Buffer | null): string | null {
  if (value === null) { return null; }
  try { return utf8.decode(value); } catch { return null; }
}

/** ord Inscription::pointer: u64 little endian, zero bytes allowed past the eighth. */
export function decodePointer(value: Buffer): bigint | null {
  for (let i = 8; i < value.length; i++) {
    if (value[i] !== 0) { return null; }
  }
  let pointer = 0n;
  for (let i = Math.min(value.length, 8) - 1; i >= 0; i--) { pointer = (pointer << 8n) | BigInt(value[i]); }
  return pointer;
}

/**
 * ord InscriptionId::from_value: a 32-byte txid then 0 to 4 index bytes, little
 * endian. A short index must not end in a zero byte; the 4-byte form may. The
 * index is a u32, read without signed arithmetic.
 */
export function inscriptionIdFromBytes(data: Buffer): string | null {
  if (data.length < 32 || data.length > 36) { return null; }
  const indexBytes = data.subarray(32);
  if (indexBytes.length !== 4 && indexBytes.length > 0 && indexBytes[indexBytes.length - 1] === 0) { return null; }
  const padded = Buffer.alloc(4);
  indexBytes.copy(padded);
  const txid = Buffer.from(data.subarray(0, 32)).reverse().toString('hex');
  return `${txid}i${padded.readUInt32LE(0)}`;
}

const isEmptyPush = (instruction: ScriptInstruction | undefined): boolean =>
  instruction !== undefined && isPush(instruction) && instruction.data.length === 0;

/** ord treats OP_1NEGATE and OP_1..OP_16 inside an envelope as one-byte pushes and sets pushnum. */
function pushnumValue(opcode: number): number | null {
  if (opcode === OP_1NEGATE) { return 0x81; }
  if (opcode >= OP_1 && opcode <= OP_16) { return opcode - OP_1 + 1; }
  return null;
}

const CHUNKED = new Set<InscriptionTag>([InscriptionTag.Metadata, InscriptionTag.Properties]);

function buildEnvelope(index: number, payload: Buffer[], pushnum: boolean, stutter: boolean): InscriptionEnvelope {
  // The body tag is the first empty push in a tag position.
  let bodyAt = -1;
  for (let k = 0; k < payload.length; k += 2) {
    if (payload[k].length === 0) { bodyAt = k; break; }
  }
  const header = payload.slice(0, bodyAt === -1 ? payload.length : bodyAt);
  const fields = new Map<string, Buffer[]>();
  const ordered: InscriptionField[] = [];
  for (let k = 0; k + 1 < header.length; k += 2) {
    const key = header[k].toString('hex');
    if (!fields.has(key)) { fields.set(key, []); }
    fields.get(key)!.push(header[k + 1]);
    ordered.push({ tag: key, value: header[k + 1].toString('hex') });
  }
  const flaws: InscriptionFlag[] = [];
  if (Array.from(fields.values()).some(values => values.length > 1)) { flaws.push('duplicate_field'); }
  if (header.length % 2 === 1) { flaws.push('incomplete_field'); }

  const keyOf = (tag: InscriptionTag): string => Buffer.from([tag]).toString('hex');
  // Tag::take: chunked tags concatenate every value; the others take the first and leave the rest.
  const take = (tag: InscriptionTag): Buffer | null => {
    const values = fields.get(keyOf(tag));
    if (!values || values.length === 0) { return null; }
    if (CHUNKED.has(tag)) {
      fields.delete(keyOf(tag));
      return Buffer.concat(values);
    }
    const value = values.shift()!;
    if (values.length === 0) { fields.delete(keyOf(tag)); }
    return value;
  };
  const takeArray = (tag: InscriptionTag): Buffer[] => {
    const values = fields.get(keyOf(tag)) ?? [];
    fields.delete(keyOf(tag));
    return values;
  };

  const contentEncoding = take(InscriptionTag.ContentEncoding);
  const contentType = take(InscriptionTag.ContentType);
  const delegate = take(InscriptionTag.Delegate);
  const metadata = take(InscriptionTag.Metadata);
  const metaprotocol = take(InscriptionTag.Metaprotocol);
  const parents = takeArray(InscriptionTag.Parent);
  const pointer = take(InscriptionTag.Pointer);
  const properties = take(InscriptionTag.Properties);
  const propertyEncoding = take(InscriptionTag.PropertyEncoding);
  const rune = take(InscriptionTag.Rune);
  // ord does not take the note tag; it is odd, so taking it here changes no flag.
  const note = take(InscriptionTag.Note);

  const unrecognizedFields: (InscriptionField & { even: boolean })[] = [];
  for (const [tag, values] of fields) {
    const even = Buffer.from(tag, 'hex')[0] % 2 === 0;
    for (const value of values) { unrecognizedFields.push({ tag, value: value.toString('hex'), even }); }
  }
  if (unrecognizedFields.some(field => field.even)) { flaws.push('unrecognized_even_field'); }
  if (pushnum) { flaws.push('pushnum'); }
  if (stutter) { flaws.push('stutter'); }

  const body = bodyAt === -1 ? Buffer.alloc(0) : Buffer.concat(payload.slice(bodyAt + 1));
  return {
    index,
    contentType: utf8OrNull(contentType),
    contentEncoding: utf8OrNull(contentEncoding),
    metaprotocol: utf8OrNull(metaprotocol),
    pointer: pointer === null ? null : decodePointer(pointer),
    parents: parents.map(inscriptionIdFromBytes).filter((id): id is string => id !== null),
    delegate: delegate === null ? null : inscriptionIdFromBytes(delegate),
    runeField: rune !== null,
    note: utf8OrNull(note),
    metadataBytes: metadata?.length ?? 0,
    propertiesBytes: properties?.length ?? 0,
    propertyEncoding: utf8OrNull(propertyEncoding),
    hasBody: bodyAt !== -1,
    bodyBytes: body.length,
    body,
    fields: ordered,
    unrecognizedFields,
    flaws,
    incomplete: false,
    termination: 'endif',
    ordRecognized: false,
  };
}

/**
 * Every envelope in one tapscript, in order, following RawEnvelope::from_tapscript.
 * Envelopes ord would drop (no OP_ENDIF, a non-push opcode inside, or a script
 * that does not parse) are still returned with ordRecognized false, so the
 * caller keeps the evidence and the reason.
 */
export function parseInscriptionEnvelopes(script: Buffer): InscriptionEnvelope[] {
  const { instructions, error } = parseScript(script);
  const envelopes: InscriptionEnvelope[] = [];
  let stuttered = false;
  let i = 0;
  while (i < instructions.length) {
    if (!isEmptyPush(instructions[i])) { i++; continue; }
    if (instructions[i + 1]?.opcode !== OP_IF) {
      stuttered = isEmptyPush(instructions[i + 1]);
      i++;
      continue;
    }
    const marker = instructions[i + 2];
    if (!(marker && isPush(marker) && marker.data.equals(PROTOCOL_ID))) {
      stuttered = isEmptyPush(marker);
      i += 2;
      continue;
    }
    const payload: Buffer[] = [];
    let pushnum = false;
    let termination: InscriptionEnvelope['termination'] = 'end_of_script';
    let j = i + 3;
    for (; j < instructions.length; j++) {
      const instruction = instructions[j];
      if (instruction.opcode === OP_ENDIF) { termination = 'endif'; break; }
      if (isPush(instruction)) { payload.push(instruction.data); continue; }
      const value = pushnumValue(instruction.opcode);
      if (value === null) { termination = 'non_push_opcode'; break; }
      pushnum = true;
      payload.push(Buffer.from([value]));
    }
    const envelope = buildEnvelope(envelopes.length, payload, pushnum, stuttered);
    envelope.termination = termination;
    envelope.incomplete = termination === 'end_of_script';
    envelope.ordRecognized = termination === 'endif' && error === undefined;
    envelopes.push(envelope);
    i = j + 1;
  }
  if (error !== undefined) {
    for (const envelope of envelopes) { envelope.incomplete = true; }
  }
  return envelopes;
}

/**
 * The tapscript of a script-path spend: the second to last witness element,
 * or the third to last when the last element is an annex (starts with 0x50).
 */
export function tapscriptFromWitness(witness: string[] | undefined): Buffer | null {
  if (!witness || witness.length === 0) { return null; }
  const hasAnnex = witness.length >= 2 && witness[witness.length - 1].toLowerCase().startsWith('50');
  const position = witness.length - (hasAnnex ? 3 : 2);
  if (position < 0) { return null; }
  const script = witness[position];
  if (!/^[0-9a-fA-F]*$/.test(script) || script.length % 2 !== 0) { return null; }
  return Buffer.from(script, 'hex');
}

export interface TransactionEnvelope extends InscriptionEnvelope {
  input: number;
  /**
   * Position among the envelopes ord recognizes in this transaction, in input
   * order: the index ord would give the inscription ID. Null when ord would not
   * return the envelope.
   */
  transactionIndex: number | null;
}

/** Every envelope across every input of a transaction, in input then script order. */
export function parseTransactionEnvelopes(witnesses: (string[] | undefined)[]): TransactionEnvelope[] {
  const out: TransactionEnvelope[] = [];
  let next = 0;
  witnesses.forEach((witness, input) => {
    const script = tapscriptFromWitness(witness);
    if (!script) { return; }
    for (const envelope of parseInscriptionEnvelopes(script)) {
      out.push({ ...envelope, input, transactionIndex: envelope.ordRecognized ? next++ : null });
    }
  });
  return out;
}

/** Bodies above this size are not examined. It is a local resource limit, not a BRC-20 rule. */
export const BRC20_OBSERVATION_LIMIT_BYTES = 4096;

export type Brc20Observation =
  | { status: 'marker'; op: string; tick: string; amt?: string; max?: string; lim?: string }
  | { status: 'observation-truncated'; body_bytes: number; observation_limit_bytes: number };

/**
 * BRC-20 marker recognition: JSON in a text or JSON inscription with "p":"brc-20".
 * A marker is evidence only. Operation grammar, deployment precision and
 * acceptance belong to the BRC-20 authority, and no marker is a balance.
 * A body over the observation limit returns an explicit truncated observation
 * because not looking is not evidence that the marker is absent.
 */
export function parseBrc20(envelope: InscriptionEnvelope): Brc20Observation | null {
  const type = envelope.contentType?.split(';')[0].trim().toLowerCase();
  if (!type || !(type === 'text/plain' || type === 'application/json')) { return null; }
  if (envelope.bodyBytes === 0) { return null; }
  if (envelope.bodyBytes > BRC20_OBSERVATION_LIMIT_BYTES) {
    return { status: 'observation-truncated', body_bytes: envelope.bodyBytes, observation_limit_bytes: BRC20_OBSERVATION_LIMIT_BYTES };
  }
  try {
    const parsed = JSON.parse(envelope.body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.p !== 'brc-20') { return null; }
    if (typeof parsed.op !== 'string' || typeof parsed.tick !== 'string') { return null; }
    const out: Brc20Observation = { status: 'marker', op: parsed.op, tick: parsed.tick };
    for (const key of ['amt', 'max', 'lim'] as const) {
      if (typeof parsed[key] === 'string') { out[key] = parsed[key]; }
    }
    return out;
  } catch {
    return null;
  }
}
