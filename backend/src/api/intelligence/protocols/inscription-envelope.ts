// Ordinals inscription envelope parser following ord's envelope.rs:
// OP_FALSE OP_IF "ord" <tag> <value> ... OP_0 <body chunks> OP_ENDIF.
// Tags are single pushes; odd tags are informational, unknown even tags make
// the inscription unbound. Body size and content type come from the bytes.
import { OP_0, OP_ENDIF, OP_IF, isPush, parseScript, ScriptInstruction } from './script-parser';

const PROTOCOL_ID = Buffer.from('ord', 'utf8');

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
