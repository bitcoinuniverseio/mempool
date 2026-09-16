// Minimal Bitcoin script instruction parser. It turns raw script bytes into
// pushes and opcodes and reports exactly where a truncated push begins, so
// callers can tell a decoded envelope from an incomplete one.

export const OP_0 = 0x00;
export const OP_PUSHDATA1 = 0x4c;
export const OP_PUSHDATA2 = 0x4d;
export const OP_PUSHDATA4 = 0x4e;
export const OP_1NEGATE = 0x4f;
export const OP_1 = 0x51;
export const OP_16 = 0x60;
export const OP_IF = 0x63;
export const OP_ENDIF = 0x68;
export const OP_RETURN = 0x6a;
export const OP_13 = 0x5d;

export interface ScriptInstruction {
  offset: number;
  opcode: number;
  /** Present for every push, including the empty push produced by OP_0. */
  data?: Buffer;
}

export interface ParsedScript {
  instructions: ScriptInstruction[];
  /** Set when the script ends inside a push; instructions before it are valid. */
  error?: { offset: number; reason: string };
}

export function isPush(instruction: ScriptInstruction): instruction is ScriptInstruction & { data: Buffer } {
  return instruction.data !== undefined;
}

/** OP_1 through OP_16 as their numeric values; null for anything else. */
export function smallInteger(instruction: ScriptInstruction): number | null {
  if (instruction.opcode >= OP_1 && instruction.opcode <= OP_16) {
    return instruction.opcode - OP_1 + 1;
  }
  return null;
}

export function parseScript(script: Buffer): ParsedScript {
  const instructions: ScriptInstruction[] = [];
  let i = 0;
  while (i < script.length) {
    const offset = i;
    const opcode = script[i++];
    let length = -1;
    if (opcode === OP_0) {
      length = 0;
    } else if (opcode >= 0x01 && opcode <= 0x4b) {
      length = opcode;
    } else if (opcode === OP_PUSHDATA1) {
      if (i + 1 > script.length) { return { instructions, error: { offset, reason: 'OP_PUSHDATA1 without a length byte' } }; }
      length = script[i];
      i += 1;
    } else if (opcode === OP_PUSHDATA2) {
      if (i + 2 > script.length) { return { instructions, error: { offset, reason: 'OP_PUSHDATA2 without a length' } }; }
      length = script.readUInt16LE(i);
      i += 2;
    } else if (opcode === OP_PUSHDATA4) {
      if (i + 4 > script.length) { return { instructions, error: { offset, reason: 'OP_PUSHDATA4 without a length' } }; }
      length = script.readUInt32LE(i);
      i += 4;
    }
    if (length === -1) {
      instructions.push({ offset, opcode });
      continue;
    }
    if (i + length > script.length) {
      return { instructions, error: { offset, reason: `push of ${length} bytes but only ${script.length - i} remain` } };
    }
    instructions.push({ offset, opcode, data: script.subarray(i, i + length) });
    i += length;
  }
  return { instructions };
}

/** Strict hex: even length, hex digits only, case-insensitive. */
export function hexToBuffer(hex: string): Buffer | null {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    return null;
  }
  return Buffer.from(clean, 'hex');
}
