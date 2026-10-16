// Ordinals inscription envelope parser following ord's envelope.rs:
// OP_FALSE OP_IF "ord" <tag> <value> ... OP_0 <body chunks> OP_ENDIF.
// Tags are single pushes; odd tags are informational, unknown even tags make
// the inscription unbound. Body size and content type come from the bytes.
import { OP_0, OP_ENDIF, OP_IF, isPush, parseScript, ScriptInstruction } from './script-parser';

const PROTOCOL_ID = Buffer.from('ord', 'utf8');

/*
 * IMPLEMENTATION-HANDOFF [WP-DECODE] | AN-DECODE-ORD-TAGS
 * Coverage: C-DECODE-ORD-TAGS; defects: F-DECODE-ORD-TAGS. Preparation only.
 * Verified gap at mempool aef1d00038b7c3b438ad6264e1d6b3f13ccf84e7: this table assigns Properties=15 and Note=17; ord 0.29.0 (7e37a3bd3391044b39f5f11f20dfdb8b3764cd0e) assigns Note=15, Properties=17, PropertyEncoding=19. The parser also converts tag bytes into integers and shares that conversion with pointer values.
 * Implementation after WP-BE-CONTRACT:
 * 1. Match the pinned Ord raw byte-tag map. Do not recognize padded tag bytes as a known one-byte tag; preserve unknown even tags and their effect.
 * 2. Reproduce repeated/chunked field assembly and all flags from the reference parser. Repeated metadata/properties can be assembled while still setting the duplicate-field flag; a flag does not alone establish final location.
 * 3. Decode pointers with the reference unsigned little-endian rules, including empty zero, accepted zero padding, and overflow rejection. Keep pointer parsing separate from tag identity.
 * 4. Cover pushnum/stutter and multiple envelopes against the pinned reference vectors. Preserve raw evidence and incomplete status when parsing stops.
 * Related: script-parser.ts, protocols.test.ts, and protocol-registry.service.ts in this directory. Do not change state interpretation without network/height/ordered input context.
 * Validation: from backend, npm test -- --runInBand src/api/intelligence/protocols/protocols.test.ts and npm run tsc, after backend dependencies and required Rust build prerequisites are installed. Add T-ORD-ENVELOPES fixtures from the pinned reference. All execution remains NOT TESTED in this preparation.
 * Governing source IDs: SPEC-ORD, SPEC-ORD-POINTER; pinned URLs/revisions and assertions are in protocol-research.json and this repository's docs/ordinal-assets-implementation-handoff.md.
 * Rollback: retain the prior decoder/versioned response contract; revert parser and dependent consumers together if differential vectors fail. These parser fixes need no ledger migration and must not rewrite authoritative holdings.
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
  Properties = 15,
  Note = 17,
}

export interface InscriptionEnvelope {
  /** Index of this envelope within the script, in order of appearance. */
  index: number;
  contentType: string | null;
  contentEncoding: string | null;
  metaprotocol: string | null;
  pointer: bigint | null;
  parents: string[];
  delegate: string | null;
  runeField: boolean;
  metadataBytes: number;
  bodyBytes: number;
  body: Buffer;
  /** Set when the envelope violates the protocol rules. */
  flaws: ('duplicate_field' | 'incomplete_field' | 'unrecognized_even_field' | 'not_at_offset_zero')[];
  /** The script ended before OP_ENDIF. */
  incomplete: boolean;
}

function tagNumber(data: Buffer): bigint | null {
  if (data.length === 0 || data.length > 16) { return null; }
  let value = 0n;
  for (let i = data.length - 1; i >= 0; i--) { value = (value << 8n) | BigInt(data[i]); }
  return value;
}

/*
 * IMPLEMENTATION-HANDOFF [WP-DECODE] | AN-DECODE-ORD-ID
 * Coverage: C-DECODE-ORD-ID; defects: F-DECODE-ORD-ID. Preparation only.
 * Verified arithmetic gap: the bitwise shift/or below coerces the inscription index to signed 32-bit. Values at or above 2147483648 can render as a negative index even though the reference serialized index is unsigned.
 * 1. Replace the conversion with explicit unsigned arithmetic or BigInt while matching the pinned Ord 32-to-36-byte representation and byte order. Validate the reference's accepted length/padding cases; do not accept malformed IDs by normalizing them silently. Parent tags remain claims until the authority verifies that the parent was spent in the reveal transaction.
 * 2. Add zero, 2147483647, 2147483648, 4294967295, short/long and trailing-zero vectors to protocols.test.ts. Assert exact decimal strings and stable parent/delegate identifiers.
 * Dependencies: WP-BE-CONTRACT identity and provenance fields, plus AN-DECODE-ORD-TAGS. Run the targeted backend Jest command documented in T-ORD-ENVELOPES and npm run tsc. No runtime validation has occurred.
 * Governing source IDs: SPEC-ORD, SPEC-ORD-PARENT; pinned URLs/revisions and assertions are in protocol-research.json and this repository's docs/ordinal-assets-implementation-handoff.md.
 * Rollback: retain the prior decoder/versioned response contract; revert parser and dependent consumers together if differential vectors fail. These parser fixes need no ledger migration and must not rewrite authoritative holdings.
 */
function inscriptionIdFromBytes(data: Buffer): string | null {
  if (data.length < 32 || data.length > 36) { return null; }
  const txid = Buffer.from(data.subarray(0, 32)).reverse().toString('hex');
  let index = 0;
  for (let i = data.length - 1; i >= 32; i--) { index = (index << 8) | data[i]; }
  return `${txid}i${index}`;
}

export function parseInscriptionEnvelopes(script: Buffer): InscriptionEnvelope[] {
  const { instructions, error } = parseScript(script);
  const envelopes: InscriptionEnvelope[] = [];
  let i = 0;
  while (i < instructions.length) {
    if (!(isPush(instructions[i]) && instructions[i].data!.length === 0 && instructions[i + 1]?.opcode === OP_IF &&
          instructions[i + 2] && isPush(instructions[i + 2]) && instructions[i + 2].data!.equals(PROTOCOL_ID))) {
      i++;
      continue;
    }
    const envelope: InscriptionEnvelope = {
      index: envelopes.length,
      contentType: null, contentEncoding: null, metaprotocol: null, pointer: null,
      parents: [], delegate: null, runeField: false, metadataBytes: 0, bodyBytes: 0,
      body: Buffer.alloc(0), flaws: [], incomplete: false,
    };
    const seen = new Set<bigint>();
    const bodyChunks: Buffer[] = [];
    let inBody = false;
    let closed = false;
    let j = i + 3;
    for (; j < instructions.length; j++) {
      const instruction: ScriptInstruction = instructions[j];
      if (instruction.opcode === OP_ENDIF) { closed = true; j++; break; }
      if (!isPush(instruction)) {
        // Any other opcode inside the envelope makes it invalid; ord skips it.
        break;
      }
      if (inBody) { bodyChunks.push(instruction.data); continue; }
      if (instruction.data.length === 0 && instruction.opcode === OP_0) { inBody = true; continue; }
      const tag = tagNumber(instruction.data);
      const valueInstruction = instructions[j + 1];
      if (!valueInstruction || !isPush(valueInstruction)) {
        envelope.flaws.push('incomplete_field');
        break;
      }
      j++;
      const value = valueInstruction.data;
      if (tag === null) { continue; }
      const repeatable = tag === BigInt(InscriptionTag.Parent) || tag === BigInt(InscriptionTag.Metadata);
      if (seen.has(tag) && !repeatable) { envelope.flaws.push('duplicate_field'); }
      seen.add(tag);
      switch (Number(tag)) {
        case InscriptionTag.ContentType: envelope.contentType = value.toString('utf8'); break;
        case InscriptionTag.ContentEncoding: envelope.contentEncoding = value.toString('utf8'); break;
        case InscriptionTag.Metaprotocol: envelope.metaprotocol = value.toString('utf8'); break;
        case InscriptionTag.Pointer: envelope.pointer = tagNumber(value); break;
        case InscriptionTag.Metadata: envelope.metadataBytes += value.length; break;
        case InscriptionTag.Delegate: envelope.delegate = inscriptionIdFromBytes(value); break;
        case InscriptionTag.Parent: { const id = inscriptionIdFromBytes(value); if (id) { envelope.parents.push(id); } break; }
        case InscriptionTag.Rune: envelope.runeField = true; break;
        case InscriptionTag.Properties: case InscriptionTag.Note: break;
        default:
          if (tag % 2n === 0n) { envelope.flaws.push('unrecognized_even_field'); }
      }
    }
    envelope.body = Buffer.concat(bodyChunks);
    envelope.bodyBytes = envelope.body.length;
    envelope.incomplete = !closed;
    if (!closed && error === undefined && j >= instructions.length) { envelope.incomplete = true; }
    envelopes.push(envelope);
    i = Math.max(j, i + 3);
  }
  return envelopes;
}

/** BRC-20 is JSON inside a text or JSON inscription with "p":"brc-20". */
/*
 * IMPLEMENTATION-HANDOFF [WP-DECODE] | AN-DECODE-BRC-GRAMMAR
 * Coverage: C-DECODE-BRC-GRAMMAR; defects: F-DECODE-BRC-GRAMMAR. Preparation only.
 * Verified gap: this function accepts arbitrary op strings, omits operation-specific required fields and deployment precision, drops self-mint data, and trims MIME whitespace. The caller then advertises every returned object as syntactically decoded. A p marker is insufficient.
 * 1. Implement a versioned BRC grammar result that distinguishes marker recognition, syntactic validity, missing context and authority acceptance. Match the L1F MIME/string/UTF-8-byte rules and operation requirements. Keep quantities as decimal strings; BRC precision rejects excess fraction digits. Retain deployment decimals, self_mint and parent evidence for the active profile. Do not reuse this parser for SNS JSON5 or TAP, whose amount rule differs.
 * 2. Use the owned BRC authority for deployment existence, minted capacity, account/reservation state, provenance and height-gated modules. Frozen original documentation alone does not define all deployed upgrades; attest the active OPI/ruleset revision first.
 * Related: decodePayload in protocol-registry.service.ts, protocols.test.ts, index-brc20 authority, and WP-BE-CONTRACT. Add T-BRC-SYNTAX for wrong MIME whitespace, invalid UTF-8, numeric fields, unknown op, missing amount/max, byte-length tickers, excess precision and profile-gated fields. Preserve invalid marker evidence without manufacturing a balance.
 * Validation: targeted backend Jest plus npm run tsc after required dependencies. Status NOT TESTED.
 * 3. Keep the 4096-byte/resource guard bounded, but return an explicit size-limited observation. A local resource cutoff is not a BRC validity rule or evidence of protocol absence.
 * Governing source IDs: SPEC-BRC-INDEX, SPEC-BRC-OPI, SPEC-BRC-SELF; pinned URLs/revisions and assertions are in protocol-research.json and this repository's docs/ordinal-assets-implementation-handoff.md.
 * Rollback: retain the prior decoder/versioned response contract; revert parser and dependent consumers together if differential vectors fail. These parser fixes need no ledger migration and must not rewrite authoritative holdings.
 */
export function parseBrc20(envelope: InscriptionEnvelope): { op: string; tick: string; amt?: string; max?: string; lim?: string } | null {
  const type = envelope.contentType?.split(';')[0].trim().toLowerCase();
  if (!type || !(type === 'text/plain' || type === 'application/json')) { return null; }
  if (envelope.bodyBytes === 0 || envelope.bodyBytes > 4096) { return null; }
  try {
    const parsed = JSON.parse(envelope.body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.p !== 'brc-20') { return null; }
    if (typeof parsed.op !== 'string' || typeof parsed.tick !== 'string') { return null; }
    const out: { op: string; tick: string; amt?: string; max?: string; lim?: string } = { op: parsed.op, tick: parsed.tick };
    for (const key of ['amt', 'max', 'lim'] as const) {
      if (typeof parsed[key] === 'string') { out[key] = parsed[key]; }
    }
    return out;
  } catch {
    return null;
  }
}
