/**
 * A complete PSBT reader.
 *
 * The explorer already decodes a PSBT far enough to show the transaction
 * inside it. This reads the container itself: every global, input and output
 * record, including the ones this code does not recognise.
 *
 * Three things make that worth having separately.
 *
 * First, an unknown record is not noise. A PSBT carrying a proprietary field
 * from some other tool is still a valid PSBT, and a reader that drops the
 * field cannot tell its owner what the file actually contains. Every record
 * here keeps its exact bytes, and `serialize` puts them back in the order
 * they arrived, so a round trip is byte for byte identical.
 *
 * Second, version 2 is a different container, not a variant of version 0. It
 * has no unsigned transaction; the inputs and outputs describe themselves. A
 * reader written for version 0 does not fail on a version 2 file, it reports
 * an empty one, which is worse.
 *
 * Third, a sighash flag is the difference between a signature that commits to
 * a transaction and one that commits to a fragment of it. That belongs in
 * front of whoever is about to sign, in words, before they sign.
 *
 * Nothing here signs, derives a key, or touches secret material. It reads
 * bytes and describes them.
 */

const MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

/** Key types this reader knows names for. Anything else is reported as unknown. */
export const GLOBAL_TYPES: Record<number, string> = {
  0x00: 'PSBT_GLOBAL_UNSIGNED_TX',
  0x01: 'PSBT_GLOBAL_XPUB',
  0x02: 'PSBT_GLOBAL_TX_VERSION',
  0x03: 'PSBT_GLOBAL_FALLBACK_LOCKTIME',
  0x04: 'PSBT_GLOBAL_INPUT_COUNT',
  0x05: 'PSBT_GLOBAL_OUTPUT_COUNT',
  0x06: 'PSBT_GLOBAL_TX_MODIFIABLE',
  0xfb: 'PSBT_GLOBAL_VERSION',
  0xfc: 'PSBT_GLOBAL_PROPRIETARY',
};

export const INPUT_TYPES: Record<number, string> = {
  0x00: 'PSBT_IN_NON_WITNESS_UTXO',
  0x01: 'PSBT_IN_WITNESS_UTXO',
  0x02: 'PSBT_IN_PARTIAL_SIG',
  0x03: 'PSBT_IN_SIGHASH_TYPE',
  0x04: 'PSBT_IN_REDEEM_SCRIPT',
  0x05: 'PSBT_IN_WITNESS_SCRIPT',
  0x06: 'PSBT_IN_BIP32_DERIVATION',
  0x07: 'PSBT_IN_FINAL_SCRIPTSIG',
  0x08: 'PSBT_IN_FINAL_SCRIPTWITNESS',
  0x09: 'PSBT_IN_POR_COMMITMENT',
  0x0a: 'PSBT_IN_RIPEMD160',
  0x0b: 'PSBT_IN_SHA256',
  0x0c: 'PSBT_IN_HASH160',
  0x0d: 'PSBT_IN_HASH256',
  0x0e: 'PSBT_IN_PREVIOUS_TXID',
  0x0f: 'PSBT_IN_OUTPUT_INDEX',
  0x10: 'PSBT_IN_SEQUENCE',
  0x11: 'PSBT_IN_REQUIRED_TIME_LOCKTIME',
  0x12: 'PSBT_IN_REQUIRED_HEIGHT_LOCKTIME',
  0x13: 'PSBT_IN_TAP_KEY_SIG',
  0x14: 'PSBT_IN_TAP_SCRIPT_SIG',
  0x15: 'PSBT_IN_TAP_LEAF_SCRIPT',
  0x16: 'PSBT_IN_TAP_BIP32_DERIVATION',
  0x17: 'PSBT_IN_TAP_INTERNAL_KEY',
  0x18: 'PSBT_IN_TAP_MERKLE_ROOT',
  0xfc: 'PSBT_IN_PROPRIETARY',
};

export const OUTPUT_TYPES: Record<number, string> = {
  0x00: 'PSBT_OUT_REDEEM_SCRIPT',
  0x01: 'PSBT_OUT_WITNESS_SCRIPT',
  0x02: 'PSBT_OUT_BIP32_DERIVATION',
  0x03: 'PSBT_OUT_AMOUNT',
  0x04: 'PSBT_OUT_SCRIPT',
  0x05: 'PSBT_OUT_TAP_INTERNAL_KEY',
  0x06: 'PSBT_OUT_TAP_TREE',
  0x07: 'PSBT_OUT_TAP_BIP32_DERIVATION',
  0xfc: 'PSBT_OUT_PROPRIETARY',
};

export type RecordScope = 'global' | 'input' | 'output';

export interface PsbtRecord {
  readonly scope: RecordScope;
  /** Index of the input or output this record belongs to, or -1 for global. */
  readonly index: number;
  readonly keyType: number;
  /** The name from the specification, or null when this reader does not know it. */
  readonly typeName: string | null;
  /** Key bytes after the type, as hex. Empty for a record with no key data. */
  readonly keyDataHex: string;
  readonly valueHex: string;
  /** True for the proprietary type 0xfc, which is reserved for other tools. */
  readonly proprietary: boolean;
  /** True when neither the specification nor the proprietary rule names it. */
  readonly unknown: boolean;
}

export type PsbtVersion = 0 | 2;

export interface SighashFinding {
  readonly inputIndex: number;
  readonly value: number;
  readonly name: string;
  /** True when the flag leaves part of the transaction unsigned. */
  readonly permissive: boolean;
  readonly explanation: string;
}

export interface PsbtInspection {
  readonly version: PsbtVersion;
  /** The version byte the file declares, if it declares one. */
  readonly declaredVersion: number | null;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly records: PsbtRecord[];
  readonly globals: PsbtRecord[];
  /** Records for each input, indexed by input position. */
  readonly inputs: PsbtRecord[][];
  readonly outputs: PsbtRecord[][];
  readonly unknownRecords: PsbtRecord[];
  readonly proprietaryRecords: PsbtRecord[];
  readonly sighashFindings: SighashFinding[];
  /** Inputs that already carry a final script, so nothing more is needed. */
  readonly finalizedInputs: number[];
  /** Inputs carrying at least one signature but not yet final. */
  readonly signedInputs: number[];
  /** The exact bytes that were read, for a round trip check. */
  readonly byteLength: number;
}

export class PsbtParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(message);
    this.name = 'PsbtParseError';
  }
}

/** Reads hex or base64 into bytes, refusing anything that is neither. */
export function decodePsbtInput(raw: string): Uint8Array {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, '');
  if (!trimmed) { throw new PsbtParseError('Nothing was supplied.', 0); }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const out = new Uint8Array(trimmed.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    // The pattern above is necessary but not sufficient: a run of hex
    // characters of odd length also matches it, and `atob` then throws a
    // DOM error whose message means nothing to whoever pasted the value.
    // Converting it here keeps every failure on this path one kind of error
    // with one kind of message.
    let binary: string;
    try {
      binary = atob(trimmed);
    } catch {
      throw new PsbtParseError('This is neither valid hexadecimal nor valid base64.', 0);
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) { out[i] = binary.charCodeAt(i); }
    return out;
  }
  throw new PsbtParseError('This is neither hexadecimal nor base64.', 0);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) { out += byte.toString(16).padStart(2, '0'); }
  return out;
}

/**
 * Reads a compact size integer.
 *
 * The upper encodings are refused rather than accepted and truncated: a
 * length that cannot be represented here is a length this reader must not
 * pretend to have understood.
 */
function readCompactSize(bytes: Uint8Array, offset: number): [number, number] {
  if (offset >= bytes.length) {
    throw new PsbtParseError('The file ends in the middle of a length.', offset);
  }
  const first = bytes[offset];
  if (first < 0xfd) { return [first, offset + 1]; }
  if (first === 0xfd) {
    if (offset + 3 > bytes.length) {
      throw new PsbtParseError('The file ends in the middle of a length.', offset);
    }
    return [bytes[offset + 1] | (bytes[offset + 2] << 8), offset + 3];
  }
  if (first === 0xfe) {
    if (offset + 5 > bytes.length) {
      throw new PsbtParseError('The file ends in the middle of a length.', offset);
    }
    const value = bytes[offset + 1]
      | (bytes[offset + 2] << 8)
      | (bytes[offset + 3] << 16)
      | (bytes[offset + 4] * 0x1000000);
    return [value, offset + 5];
  }
  throw new PsbtParseError('A length in this file is too large to read.', offset);
}

/** Reads a little endian unsigned integer of `size` bytes from hex. */
function hexToUint(hex: string): number | null {
  if (!hex || hex.length % 2 !== 0) { return null; }
  let value = 0;
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    value = value * 256 + parseInt(hex.slice(i, i + 2), 16);
  }
  return Number.isFinite(value) ? value : null;
}

function typeNameFor(scope: RecordScope, keyType: number): string | null {
  const table = scope === 'global' ? GLOBAL_TYPES
    : scope === 'input' ? INPUT_TYPES
      : OUTPUT_TYPES;
  return table[keyType] ?? null;
}

interface Section {
  readonly records: PsbtRecord[];
  readonly offset: number;
}

/**
 * Reads one key-value section up to its terminating separator.
 *
 * A section that runs to the end of the file without a separator is an
 * incomplete file, and is reported as one rather than treated as finished.
 */
function readSection(
  bytes: Uint8Array,
  start: number,
  scope: RecordScope,
  index: number,
): Section {
  const records: PsbtRecord[] = [];
  let offset = start;
  while (true) {
    if (offset >= bytes.length) {
      throw new PsbtParseError('The file ends before a section was closed.', offset);
    }
    const [keyLen, afterKeyLen] = readCompactSize(bytes, offset);
    if (keyLen === 0) { return { records, offset: afterKeyLen }; }
    if (afterKeyLen + keyLen > bytes.length) {
      throw new PsbtParseError('A key runs past the end of the file.', afterKeyLen);
    }
    const key = bytes.slice(afterKeyLen, afterKeyLen + keyLen);
    const [valueLen, afterValueLen] = readCompactSize(bytes, afterKeyLen + keyLen);
    if (afterValueLen + valueLen > bytes.length) {
      throw new PsbtParseError('A value runs past the end of the file.', afterValueLen);
    }
    const value = bytes.slice(afterValueLen, afterValueLen + valueLen);
    const keyType = key[0];
    const typeName = typeNameFor(scope, keyType);
    records.push({
      scope,
      index,
      keyType,
      typeName,
      keyDataHex: toHex(key.slice(1)),
      valueHex: toHex(value),
      proprietary: keyType === 0xfc,
      unknown: typeName === null,
    });
    offset = afterValueLen + valueLen;
  }
}

/** Names a sighash flag and says what it leaves unsigned. */
export function describeSighash(value: number, inputIndex: number): SighashFinding {
  const anyoneCanPay = (value & 0x80) !== 0;
  const base = value & 0x7f;
  const baseName = base === 1 ? 'ALL' : base === 2 ? 'NONE' : base === 3 ? 'SINGLE' : null;
  const name = value === 0
    ? 'DEFAULT'
    : `${baseName ?? `UNKNOWN(0x${base.toString(16)})`}${anyoneCanPay ? ' | ANYONECANPAY' : ''}`;

  if (value === 0 || (base === 1 && !anyoneCanPay)) {
    return {
      inputIndex,
      value,
      name,
      permissive: false,
      explanation: 'Signs every input and every output. A signature made this way cannot be reused in a different transaction.',
    };
  }
  if (base === 2) {
    return {
      inputIndex,
      value,
      name,
      permissive: true,
      explanation: 'Signs no outputs at all. Whoever holds this signature can send the money anywhere.',
    };
  }
  if (base === 3) {
    return {
      inputIndex,
      value,
      name,
      permissive: true,
      explanation: anyoneCanPay
        ? 'Signs only this input and the one output at the same position. Every other input and output can be changed.'
        : 'Signs only the output at the same position as this input. The other outputs can be changed.',
    };
  }
  if (base === 1 && anyoneCanPay) {
    return {
      inputIndex,
      value,
      name,
      permissive: true,
      explanation: 'Signs every output but only this input. Other inputs can be added without invalidating the signature.',
    };
  }
  return {
    inputIndex,
    value,
    name,
    permissive: true,
    explanation: 'This is not a sighash value the rules define. Treat any signature made with it as unpredictable.',
  };
}

/**
 * Reads a PSBT of either version into records that keep their exact bytes.
 */
export function inspectPsbt(bytes: Uint8Array): PsbtInspection {
  if (bytes.length < MAGIC.length) {
    throw new PsbtParseError('This is too short to be a PSBT.', 0);
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new PsbtParseError('This does not start with the PSBT magic bytes.', i);
    }
  }

  const globalSection = readSection(bytes, MAGIC.length, 'global', -1);
  const globals = globalSection.records;

  const declaredVersionRecord = globals.find((r) => r.keyType === 0xfb);
  const declaredVersion = declaredVersionRecord
    ? hexToUint(declaredVersionRecord.valueHex)
    : null;
  const unsignedTx = globals.find((r) => r.keyType === 0x00);

  // Version 0 is identified by the unsigned transaction, not by the version
  // byte, because the byte is optional in version 0 files.
  const version: PsbtVersion = unsignedTx ? 0 : 2;

  let inputCount: number;
  let outputCount: number;
  if (version === 0) {
    const counts = countsFromUnsignedTx(unsignedTx.valueHex);
    inputCount = counts.inputs;
    outputCount = counts.outputs;
  } else {
    const inputRecord = globals.find((r) => r.keyType === 0x04);
    const outputRecord = globals.find((r) => r.keyType === 0x05);
    if (!inputRecord || !outputRecord) {
      throw new PsbtParseError(
        'This has no unsigned transaction and no input and output counts, so how many inputs it has cannot be established.',
        0,
      );
    }
    inputCount = hexToUint(inputRecord.valueHex) ?? 0;
    outputCount = hexToUint(outputRecord.valueHex) ?? 0;
  }

  let offset = globalSection.offset;
  const inputs: PsbtRecord[][] = [];
  for (let i = 0; i < inputCount; i++) {
    const section = readSection(bytes, offset, 'input', i);
    inputs.push(section.records);
    offset = section.offset;
  }
  const outputs: PsbtRecord[][] = [];
  for (let i = 0; i < outputCount; i++) {
    const section = readSection(bytes, offset, 'output', i);
    outputs.push(section.records);
    offset = section.offset;
  }

  const records = [...globals, ...inputs.flat(), ...outputs.flat()];
  const sighashFindings: SighashFinding[] = [];
  const finalizedInputs: number[] = [];
  const signedInputs: number[] = [];

  inputs.forEach((section, index) => {
    const sighash = section.find((r) => r.keyType === 0x03);
    if (sighash) {
      const value = hexToUint(sighash.valueHex);
      if (value !== null) { sighashFindings.push(describeSighash(value, index)); }
    }
    const final = section.some((r) => r.keyType === 0x07 || r.keyType === 0x08);
    if (final) { finalizedInputs.push(index); }
    const signed = section.some(
      (r) => r.keyType === 0x02 || r.keyType === 0x13 || r.keyType === 0x14,
    );
    if (signed && !final) { signedInputs.push(index); }
  });

  return {
    version,
    declaredVersion,
    inputCount,
    outputCount,
    records,
    globals,
    inputs,
    outputs,
    unknownRecords: records.filter((r) => r.unknown),
    proprietaryRecords: records.filter((r) => r.proprietary),
    sighashFindings,
    finalizedInputs,
    signedInputs,
    byteLength: bytes.length,
  };
}

/**
 * Counts the inputs and outputs of a version 0 file's unsigned transaction.
 *
 * Only the counts are read. The transaction itself is decoded elsewhere by
 * the decoder the rest of the explorer already uses, and duplicating that
 * here would give two answers that could disagree.
 */
function countsFromUnsignedTx(hex: string): { inputs: number; outputs: number } {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // version(4), then either the segwit marker or the input count.
  let offset = 4;
  if (bytes[offset] === 0x00) {
    // An unsigned transaction inside a version 0 PSBT must not be segwit
    // serialized, but a malformed file can still say so, and skipping the
    // marker reads it rather than misreporting the counts.
    offset += 2;
  }
  const [inputs, afterInputs] = readCompactSize(bytes, offset);
  offset = afterInputs;
  for (let i = 0; i < inputs; i++) {
    offset += 36;
    const [scriptLen, afterScriptLen] = readCompactSize(bytes, offset);
    offset = afterScriptLen + scriptLen + 4;
  }
  const [outputs] = readCompactSize(bytes, offset);
  return { inputs, outputs };
}

function writeCompactSize(value: number): number[] {
  if (value < 0xfd) { return [value]; }
  if (value <= 0xffff) { return [0xfd, value & 0xff, (value >> 8) & 0xff]; }
  return [
    0xfe,
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    Math.floor(value / 0x1000000) & 0xff,
  ];
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Writes an inspection back out.
 *
 * This exists so the reader can be held to its own promise. A record whose
 * bytes were altered, reordered or dropped shows up as a serialization that
 * does not match what was read, and the tests assert exactly that against
 * files carrying fields this code does not recognise.
 */
export function serialize(inspection: PsbtInspection): Uint8Array {
  const out: number[] = [...MAGIC];
  const writeSection = (records: readonly PsbtRecord[]): void => {
    for (const record of records) {
      const keyData = hexToBytes(record.keyDataHex);
      out.push(...writeCompactSize(1 + keyData.length));
      out.push(record.keyType);
      out.push(...keyData);
      const value = hexToBytes(record.valueHex);
      out.push(...writeCompactSize(value.length));
      out.push(...value);
    }
    out.push(0x00);
  };
  writeSection(inspection.globals);
  for (const section of inspection.inputs) { writeSection(section); }
  for (const section of inspection.outputs) { writeSection(section); }
  return new Uint8Array(out);
}

export type DiffKind = 'added' | 'removed' | 'changed';

export interface PsbtDiffEntry {
  readonly kind: DiffKind;
  readonly scope: RecordScope;
  readonly index: number;
  readonly typeName: string | null;
  readonly keyType: number;
  readonly keyDataHex: string;
  readonly beforeHex: string | null;
  readonly afterHex: string | null;
}

function recordKey(record: PsbtRecord): string {
  return `${record.scope}:${record.index}:${record.keyType}:${record.keyDataHex}`;
}

/**
 * Compares two PSBTs record by record.
 *
 * The comparison is on the container, not on the transaction inside it,
 * because that is where signing actually shows up: a signed file differs from
 * its unsigned self by the records that were added, and seeing exactly those
 * is how someone confirms a signer did what it said and nothing else.
 */
export function diffPsbt(
  before: PsbtInspection,
  after: PsbtInspection,
): PsbtDiffEntry[] {
  const beforeMap = new Map(before.records.map((r) => [recordKey(r), r]));
  const afterMap = new Map(after.records.map((r) => [recordKey(r), r]));
  const entries: PsbtDiffEntry[] = [];

  for (const [key, record] of beforeMap) {
    const other = afterMap.get(key);
    if (!other) {
      entries.push({
        kind: 'removed',
        scope: record.scope,
        index: record.index,
        typeName: record.typeName,
        keyType: record.keyType,
        keyDataHex: record.keyDataHex,
        beforeHex: record.valueHex,
        afterHex: null,
      });
    } else if (other.valueHex !== record.valueHex) {
      entries.push({
        kind: 'changed',
        scope: record.scope,
        index: record.index,
        typeName: record.typeName,
        keyType: record.keyType,
        keyDataHex: record.keyDataHex,
        beforeHex: record.valueHex,
        afterHex: other.valueHex,
      });
    }
  }
  for (const [key, record] of afterMap) {
    if (beforeMap.has(key)) { continue; }
    entries.push({
      kind: 'added',
      scope: record.scope,
      index: record.index,
      typeName: record.typeName,
      keyType: record.keyType,
      keyDataHex: record.keyDataHex,
      beforeHex: null,
      afterHex: record.valueHex,
    });
  }

  // A stable order so the same pair of files always produces the same list.
  entries.sort((a, b) => {
    const scopeOrder = ['global', 'input', 'output'];
    const byScope = scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope);
    if (byScope !== 0) { return byScope; }
    if (a.index !== b.index) { return a.index - b.index; }
    if (a.keyType !== b.keyType) { return a.keyType - b.keyType; }
    return a.keyDataHex < b.keyDataHex ? -1 : a.keyDataHex > b.keyDataHex ? 1 : 0;
  });
  return entries;
}

/**
 * Refuses anything that looks like secret key material before it goes
 * anywhere near a parser or a network request.
 *
 * The check is on shape, not on validity, and it is deliberately broad. A
 * string that merely resembles a private key is not something this product
 * should be holding at all, so the answer is to refuse it and say so rather
 * than to work out whether it was real.
 */
export function looksLikeSecret(raw: string): string | null {
  const value = (raw ?? '').trim();
  if (!value) { return null; }
  if (/^(xprv|yprv|zprv|tprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{50,}$/.test(value)) {
    return 'That is an extended private key. This product never accepts one, and nothing was sent anywhere.';
  }
  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(value)) {
    return 'That is a private key in wallet import format. This product never accepts one, and nothing was sent anywhere.';
  }
  const words = value.split(/\s+/);
  if (words.length >= 12 && words.every((word) => /^[a-z]{3,8}$/.test(word))) {
    return 'That looks like a recovery phrase. This product never accepts one, and nothing was sent anywhere.';
  }
  return null;
}
