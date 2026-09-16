// Runestone decoder following the ord reference implementation
// (crates/ordinals/src/runestone.rs): OP_RETURN OP_13, data pushes joined
// into one payload, LEB128 integers, tag/value fields, delta-encoded edicts,
// and cenotaph flaws for anything the protocol says makes the message
// invalid. Every field here is derived from the input bytes.
import { OP_13, OP_RETURN, isPush, parseScript, ScriptInstruction } from './script-parser';

export enum Tag {
  Body = 0,
  Flags = 2,
  Rune = 4,
  Premine = 6,
  Cap = 8,
  Amount = 10,
  HeightStart = 12,
  HeightEnd = 14,
  OffsetStart = 16,
  OffsetEnd = 18,
  Mint = 20,
  Pointer = 22,
  Cenotaph = 126,
  Divisibility = 1,
  Spacers = 3,
  Symbol = 5,
  Nop = 127,
}

const FLAG_ETCHING = 1n << 0n;
const FLAG_TERMS = 1n << 1n;
const FLAG_TURBO = 1n << 2n;

export type CenotaphFlaw =
  | 'edict_output'
  | 'edict_rune_id'
  | 'invalid_script'
  | 'opcode'
  | 'supply_overflow'
  | 'trailing_integers'
  | 'truncated_field'
  | 'unrecognized_even_tag'
  | 'unrecognized_flag'
  | 'varint';

export interface RuneId { block: bigint; tx: bigint; }

export interface Edict { id: RuneId; amount: bigint; output: bigint; }

export interface Etching {
  rune: string | null;
  divisibility: number | null;
  spacers: number | null;
  symbol: string | null;
  premine: bigint | null;
  turbo: boolean;
  terms: { amount: bigint | null; cap: bigint | null; height: [bigint | null, bigint | null]; offset: [bigint | null, bigint | null] } | null;
}

export interface Runestone {
  edicts: Edict[];
  etching: Etching | null;
  mint: RuneId | null;
  pointer: bigint | null;
  flaws: CenotaphFlaw[];
}

const U128_MAX = (1n << 128n) - 1n;

export function decodeLeb128(payload: Buffer): { integers: bigint[]; flaw?: 'varint' } {
  const integers: bigint[] = [];
  let i = 0;
  while (i < payload.length) {
    let value = 0n;
    let shift = 0n;
    let done = false;
    for (let j = 0; j < 19 && i < payload.length; j++) {
      const byte = payload[i++];
      if (j === 18 && byte > 0x03) { return { integers, flaw: 'varint' }; }
      value |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
      if ((byte & 0x80) === 0) { done = true; break; }
    }
    if (!done) { return { integers, flaw: 'varint' }; }
    integers.push(value);
  }
  return { integers };
}

/** Rune name from its integer per the modified base-26 encoding. */
export function runeName(value: bigint): string {
  let n = value + 1n;
  let out = '';
  while (n > 0n) {
    n -= 1n;
    out = String.fromCharCode(65 + Number(n % 26n)) + out;
    n /= 26n;
  }
  return out;
}

export function spacedRuneName(value: bigint, spacers: number): string {
  const name = runeName(value);
  let out = '';
  for (let i = 0; i < name.length; i++) {
    out += name[i];
    if (i < name.length - 1 && (spacers & (1 << i)) !== 0) { out += '•'; }
  }
  return out;
}

/** Extracts the runestone payload from a scriptPubKey, or null when the script is not OP_RETURN OP_13. */
export function runestonePayload(instructions: ScriptInstruction[], parseError: boolean): { payload: Buffer; flaw?: CenotaphFlaw } | null {
  if (instructions.length < 2 || instructions[0].opcode !== OP_RETURN || instructions[1].opcode !== OP_13) {
    return null;
  }
  const chunks: Buffer[] = [];
  for (const instruction of instructions.slice(2)) {
    if (!isPush(instruction)) {
      return { payload: Buffer.concat(chunks), flaw: 'opcode' };
    }
    chunks.push(instruction.data);
  }
  if (parseError) {
    return { payload: Buffer.concat(chunks), flaw: 'invalid_script' };
  }
  return { payload: Buffer.concat(chunks) };
}

export function decodeRunestone(script: Buffer): Runestone | null {
  const parsed = parseScript(script);
  const extracted = runestonePayload(parsed.instructions, parsed.error !== undefined);
  if (!extracted) { return null; }
  const flaws: CenotaphFlaw[] = [];
  if (extracted.flaw) {
    flaws.push(extracted.flaw);
    return { edicts: [], etching: null, mint: null, pointer: null, flaws };
  }
  const { integers, flaw } = decodeLeb128(extracted.payload);
  if (flaw) {
    flaws.push(flaw);
    return { edicts: [], etching: null, mint: null, pointer: null, flaws };
  }

  const fields = new Map<bigint, bigint[]>();
  const edicts: Edict[] = [];
  for (let i = 0; i < integers.length; i += 2) {
    const tag = integers[i];
    if (tag === BigInt(Tag.Body)) {
      const body = integers.slice(i + 1);
      let id: RuneId = { block: 0n, tx: 0n };
      for (let j = 0; j + 4 <= body.length; j += 4) {
        const [block, tx, amount, output] = body.slice(j, j + 4);
        let next: RuneId;
        if (block === 0n) {
          next = { block: id.block, tx: id.tx + tx };
        } else {
          next = { block: id.block + block, tx };
        }
        if (next.block > U128_MAX || next.tx > U128_MAX) { flaws.push('edict_rune_id'); break; }
        if (output > 0xffff_ffffn) { flaws.push('edict_output'); break; }
        edicts.push({ id: next, amount, output });
        id = next;
      }
      if (body.length % 4 !== 0) { flaws.push('trailing_integers'); }
      break;
    }
    if (i + 1 >= integers.length) { flaws.push('truncated_field'); break; }
    const list = fields.get(tag) ?? [];
    list.push(integers[i + 1]);
    fields.set(tag, list);
  }

  const take = (tag: Tag): bigint | null => {
    const list = fields.get(BigInt(tag));
    if (!list || list.length === 0) { return null; }
    const value = list.shift() as bigint;
    if (list.length === 0) { fields.delete(BigInt(tag)); }
    return value;
  };

  const flags = take(Tag.Flags) ?? 0n;
  let etching: Etching | null = null;
  if ((flags & FLAG_ETCHING) !== 0n) {
    const spacersRaw = take(Tag.Spacers);
    const divisibilityRaw = take(Tag.Divisibility);
    const symbolRaw = take(Tag.Symbol);
    const rune = take(Tag.Rune);
    const spacers = spacersRaw !== null && spacersRaw <= 0b00000111_11111111_11111111_11111111n ? Number(spacersRaw) : null;
    const divisibility = divisibilityRaw !== null && divisibilityRaw <= 38n ? Number(divisibilityRaw) : null;
    let symbol: string | null = null;
    if (symbolRaw !== null && symbolRaw <= 0x10ffffn) {
      try { symbol = String.fromCodePoint(Number(symbolRaw)); } catch { symbol = null; }
    }
    etching = {
      rune: rune !== null ? (spacers !== null ? spacedRuneName(rune, spacers) : runeName(rune)) : null,
      divisibility,
      spacers,
      symbol,
      premine: take(Tag.Premine),
      turbo: (flags & FLAG_TURBO) !== 0n,
      terms: (flags & FLAG_TERMS) !== 0n ? {
        amount: take(Tag.Amount),
        cap: take(Tag.Cap),
        height: [take(Tag.HeightStart), take(Tag.HeightEnd)],
        offset: [take(Tag.OffsetStart), take(Tag.OffsetEnd)],
      } : null,
    };
  }

  let mint: RuneId | null = null;
  const mintBlock = take(Tag.Mint);
  const mintTx = take(Tag.Mint);
  if (mintBlock !== null && mintTx !== null) {
    mint = { block: mintBlock, tx: mintTx };
  }
  const pointer = take(Tag.Pointer);

  if (etching !== null && etching.premine !== null && etching.terms !== null) {
    const { amount, cap } = etching.terms;
    if (amount !== null && cap !== null && etching.premine + amount * cap > U128_MAX) { flaws.push('supply_overflow'); }
  }
  if ((flags & ~(FLAG_ETCHING | FLAG_TERMS | FLAG_TURBO)) !== 0n) { flaws.push('unrecognized_flag'); }
  for (const tag of fields.keys()) {
    if (tag % 2n === 0n) { flaws.push('unrecognized_even_tag'); break; }
  }

  return { edicts, etching, mint, pointer, flaws: Array.from(new Set(flaws)) };
}

/** LEB128 encoder, used by tests and by the sample payload builder. */
export function encodeLeb128(value: bigint): Buffer {
  const bytes: number[] = [];
  let n = value;
  for (;;) {
    const byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n === 0n) { bytes.push(byte); break; }
    bytes.push(byte | 0x80);
  }
  return Buffer.from(bytes);
}

/** Builds an OP_RETURN OP_13 script from integers, for fixtures and samples. */
export function encodeRunestoneScript(integers: bigint[]): Buffer {
  const payload = Buffer.concat(integers.map(encodeLeb128));
  const pushes: Buffer[] = [];
  for (let i = 0; i < payload.length; i += 520) {
    const chunk = payload.subarray(i, i + 520);
    const prefix = chunk.length <= 0x4b ? Buffer.from([chunk.length]) : Buffer.from([0x4d, chunk.length & 0xff, chunk.length >> 8]);
    pushes.push(prefix, chunk);
  }
  return Buffer.concat([Buffer.from([OP_RETURN, OP_13]), ...pushes]);
}
