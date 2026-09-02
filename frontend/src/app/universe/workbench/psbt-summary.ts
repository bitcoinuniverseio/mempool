/**
 * The money and the signers inside a PSBT.
 *
 * `psbt-inspect` reads the container. This reads what the container is about:
 * how much every input is worth, how much every output pays, what the fee
 * therefore is, and which keys the file says have to sign.
 *
 * Two rules run through all of it.
 *
 * Amounts are `bigint` from the first byte to the last. A satoshi total for a
 * large transaction passes the range a double can hold exactly, and a fee
 * derived from two rounded totals is a wrong fee presented with the same
 * confidence as a right one.
 *
 * An amount that is not in the file is absent, not zero. A PSBT is allowed to
 * omit the previous output of an input, and a reader that fills the gap with
 * zero reports a fee far larger than the real one. Every gap here is named,
 * and a total with a gap in it is not a total.
 */

import { PsbtInspection, PsbtRecord } from './psbt-inspect';

/** Where an input's value came from, or why it is missing. */
export type AmountSource = 'witness-utxo' | 'non-witness-utxo' | 'psbt-amount' | 'unsigned-tx';

export interface InputAmount {
  readonly index: number;
  /** The previous output this input spends, when the file says. */
  readonly previousTxid: string | null;
  readonly previousIndex: number | null;
  /** Exact satoshis, or null when the file does not carry the value. */
  readonly amount: bigint | null;
  readonly scriptPubKeyHex: string | null;
  readonly source: AmountSource | null;
  /** Set when the amount could not be read, saying why. */
  readonly missingReason: string | null;
}

export interface OutputAmount {
  readonly index: number;
  readonly amount: bigint | null;
  readonly scriptPubKeyHex: string | null;
  readonly source: AmountSource | null;
  readonly missingReason: string | null;
}

export interface FeeSummary {
  readonly inputs: readonly InputAmount[];
  readonly outputs: readonly OutputAmount[];
  /** Sum of the input amounts that are present. */
  readonly inputTotal: bigint;
  readonly outputTotal: bigint;
  /** The fee, or null when any amount is missing or the fee is negative. */
  readonly fee: bigint | null;
  /** Inputs whose value the file does not carry. */
  readonly inputsMissingAmount: readonly number[];
  readonly outputsMissingAmount: readonly number[];
  /**
   * True when the outputs pay more than the inputs hold. The file is either
   * incomplete or wrong, and either way no fee can be stated.
   */
  readonly outputsExceedInputs: boolean;
  /** Set when the fee is null, saying which condition caused it. */
  readonly feeUnknownReason: string | null;
}

export interface Derivation {
  readonly scope: 'global' | 'input' | 'output';
  readonly index: number;
  /** The key this derivation is for, as hex. An xpub for a global record. */
  readonly keyHex: string;
  readonly masterFingerprint: string;
  /** Rendered as m/84'/0'/0'/0/5, hardened steps marked with an apostrophe. */
  readonly path: string;
  /** True for a Taproot derivation record, which also carries leaf hashes. */
  readonly taproot: boolean;
  /** Leaf hashes a Taproot derivation names, empty for a key path only entry. */
  readonly leafHashes: readonly string[];
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex ?? '';
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) { out += byte.toString(16).padStart(2, '0'); }
  return out;
}

/**
 * Reads an eight byte little endian amount as a bigint.
 *
 * Built up byte by byte rather than through a DataView, because the shift
 * that a DataView would let us avoid is exactly the step where a naive
 * implementation silently loses the top bits.
 */
function readAmountLe(bytes: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > bytes.length) { return null; }
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    value = (value << 8n) | BigInt(bytes[offset + i]);
  }
  return value;
}

function readUint32Le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) { return null; }
  return bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000;
}

function readCompactSize(bytes: Uint8Array, offset: number): [number, number] | null {
  if (offset >= bytes.length) { return null; }
  const first = bytes[offset];
  if (first < 0xfd) { return [first, offset + 1]; }
  if (first === 0xfd) {
    if (offset + 3 > bytes.length) { return null; }
    return [bytes[offset + 1] | (bytes[offset + 2] << 8), offset + 3];
  }
  if (first === 0xfe) {
    const value = readUint32Le(bytes, offset + 1);
    return value === null ? null : [value, offset + 5];
  }
  // Eight byte lengths do not occur in a transaction this reader can hold in
  // memory, and accepting one truncated would misreport every later offset.
  return null;
}

interface RawTxOutput { readonly amount: bigint; readonly scriptHex: string; }
interface RawTxInput { readonly txid: string; readonly vout: number; }
interface RawTx { readonly inputs: RawTxInput[]; readonly outputs: RawTxOutput[]; }

/**
 * Reads the inputs and outputs of a raw transaction.
 *
 * Only what this module needs: the previous outputs the inputs point at, and
 * the value and script of each output. Scripts and witnesses are skipped over
 * rather than decoded, because the explorer already has one decoder and a
 * second one here could disagree with it.
 */
export function readRawTransaction(hex: string): RawTx | null {
  const bytes = hexToBytes(hex);
  if (bytes.length < 10) { return null; }
  let offset = 4;
  let segwit = false;
  if (bytes[offset] === 0x00 && bytes[offset + 1] === 0x01) {
    segwit = true;
    offset += 2;
  }
  const inputCount = readCompactSize(bytes, offset);
  if (!inputCount) { return null; }
  offset = inputCount[1];
  const inputs: RawTxInput[] = [];
  for (let i = 0; i < inputCount[0]; i++) {
    if (offset + 36 > bytes.length) { return null; }
    // A txid is stored in reverse order of how it is displayed.
    const txid = toHex(bytes.slice(offset, offset + 32).reverse());
    const vout = readUint32Le(bytes, offset + 32);
    if (vout === null) { return null; }
    offset += 36;
    const scriptLen = readCompactSize(bytes, offset);
    if (!scriptLen) { return null; }
    offset = scriptLen[1] + scriptLen[0] + 4;
    inputs.push({ txid, vout });
  }
  const outputCount = readCompactSize(bytes, offset);
  if (!outputCount) { return null; }
  offset = outputCount[1];
  const outputs: RawTxOutput[] = [];
  for (let i = 0; i < outputCount[0]; i++) {
    const amount = readAmountLe(bytes, offset);
    if (amount === null) { return null; }
    offset += 8;
    const scriptLen = readCompactSize(bytes, offset);
    if (!scriptLen) { return null; }
    const scriptStart = scriptLen[1];
    const scriptEnd = scriptStart + scriptLen[0];
    if (scriptEnd > bytes.length) { return null; }
    outputs.push({ amount, scriptHex: toHex(bytes.slice(scriptStart, scriptEnd)) });
    offset = scriptEnd;
  }
  // The witness and locktime that follow are not read. Nothing here needs
  // them, and stopping short cannot make the values above wrong.
  void segwit;
  return { inputs, outputs };
}

/** Reads a witness utxo record, which is one output: amount then script. */
function readWitnessUtxo(valueHex: string): RawTxOutput | null {
  const bytes = hexToBytes(valueHex);
  const amount = readAmountLe(bytes, 0);
  if (amount === null) { return null; }
  const scriptLen = readCompactSize(bytes, 8);
  if (!scriptLen) { return null; }
  const end = scriptLen[1] + scriptLen[0];
  if (end > bytes.length) { return null; }
  return { amount, scriptHex: toHex(bytes.slice(scriptLen[1], end)) };
}

function find(records: readonly PsbtRecord[], keyType: number): PsbtRecord | undefined {
  return records.find((record) => record.keyType === keyType);
}

function reversedTxid(hex: string): string | null {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) { return null; }
  return toHex(bytes.reverse());
}

/**
 * Works out what every input is worth and what every output pays.
 *
 * The two container versions carry this in different places, so each is read
 * on its own terms rather than through a shared guess.
 */
export function summarizeAmounts(inspection: PsbtInspection): FeeSummary {
  const unsignedTx = inspection.version === 0
    ? readRawTransaction(find(inspection.globals, 0x00)?.valueHex ?? '')
    : null;

  const inputs: InputAmount[] = inspection.inputs.map((records, index) => {
    const fromUnsigned = unsignedTx?.inputs[index] ?? null;
    let previousTxid = fromUnsigned?.txid ?? null;
    let previousIndex = fromUnsigned?.vout ?? null;

    if (previousTxid === null) {
      const txidRecord = find(records, 0x0e);
      if (txidRecord) { previousTxid = reversedTxid(txidRecord.valueHex); }
    }
    if (previousIndex === null) {
      const indexRecord = find(records, 0x0f);
      if (indexRecord) { previousIndex = readUint32Le(hexToBytes(indexRecord.valueHex), 0); }
    }

    const witnessUtxo = find(records, 0x01);
    if (witnessUtxo) {
      const output = readWitnessUtxo(witnessUtxo.valueHex);
      if (output) {
        return {
          index,
          previousTxid,
          previousIndex,
          amount: output.amount,
          scriptPubKeyHex: output.scriptHex,
          source: 'witness-utxo' as const,
          missingReason: null,
        };
      }
      return {
        index, previousTxid, previousIndex, amount: null, scriptPubKeyHex: null, source: null,
        missingReason: 'The witness utxo record for this input is malformed.',
      };
    }

    const nonWitnessUtxo = find(records, 0x00);
    if (nonWitnessUtxo) {
      const prev = readRawTransaction(nonWitnessUtxo.valueHex);
      if (!prev) {
        return {
          index, previousTxid, previousIndex, amount: null, scriptPubKeyHex: null, source: null,
          missingReason: 'The previous transaction recorded for this input could not be read.',
        };
      }
      if (previousIndex === null || previousIndex >= prev.outputs.length) {
        return {
          index, previousTxid, previousIndex, amount: null, scriptPubKeyHex: null, source: null,
          missingReason: 'The previous transaction is present but the file does not say which of its outputs this input spends.',
        };
      }
      const output = prev.outputs[previousIndex];
      return {
        index,
        previousTxid,
        previousIndex,
        amount: output.amount,
        scriptPubKeyHex: output.scriptHex,
        source: 'non-witness-utxo' as const,
        missingReason: null,
      };
    }

    return {
      index, previousTxid, previousIndex, amount: null, scriptPubKeyHex: null, source: null,
      missingReason: 'This input carries neither the previous output nor the previous transaction, so its value is not in the file.',
    };
  });

  const outputs: OutputAmount[] = inspection.outputs.map((records, index) => {
    if (unsignedTx) {
      const output = unsignedTx.outputs[index];
      if (output) {
        return {
          index,
          amount: output.amount,
          scriptPubKeyHex: output.scriptHex,
          source: 'unsigned-tx' as const,
          missingReason: null,
        };
      }
      return {
        index, amount: null, scriptPubKeyHex: null, source: null,
        missingReason: 'The unsigned transaction has fewer outputs than the file declares.',
      };
    }
    const amountRecord = find(records, 0x03);
    const scriptRecord = find(records, 0x04);
    const amount = amountRecord ? readAmountLe(hexToBytes(amountRecord.valueHex), 0) : null;
    if (amount === null) {
      return {
        index, amount: null, scriptPubKeyHex: scriptRecord?.valueHex ?? null, source: null,
        missingReason: 'This output carries no amount record.',
      };
    }
    return {
      index,
      amount,
      scriptPubKeyHex: scriptRecord?.valueHex ?? null,
      source: 'psbt-amount' as const,
      missingReason: null,
    };
  });

  let inputTotal = 0n;
  const inputsMissingAmount: number[] = [];
  for (const input of inputs) {
    if (input.amount === null) { inputsMissingAmount.push(input.index); } else { inputTotal += input.amount; }
  }
  let outputTotal = 0n;
  const outputsMissingAmount: number[] = [];
  for (const output of outputs) {
    if (output.amount === null) { outputsMissingAmount.push(output.index); } else { outputTotal += output.amount; }
  }

  const outputsExceedInputs = inputsMissingAmount.length === 0
    && outputsMissingAmount.length === 0
    && outputTotal > inputTotal;

  let fee: bigint | null = null;
  let feeUnknownReason: string | null = null;
  if (inputsMissingAmount.length) {
    feeUnknownReason = 'The value of at least one input is not in the file, so the fee cannot be worked out. It is not zero, it is unknown.';
  } else if (outputsMissingAmount.length) {
    feeUnknownReason = 'At least one output carries no amount, so the fee cannot be worked out.';
  } else if (outputsExceedInputs) {
    feeUnknownReason = 'The outputs pay more than the inputs hold. This file is incomplete or wrong, and no fee can be stated for it.';
  } else {
    fee = inputTotal - outputTotal;
  }

  return {
    inputs,
    outputs,
    inputTotal,
    outputTotal,
    fee,
    inputsMissingAmount,
    outputsMissingAmount,
    outputsExceedInputs,
    feeUnknownReason,
  };
}

/** Formats a derivation path from little endian index words. */
function formatPath(bytes: Uint8Array, offset: number): string {
  let path = 'm';
  for (let i = offset; i + 4 <= bytes.length; i += 4) {
    const raw = readUint32Le(bytes, i);
    if (raw === null) { break; }
    const hardened = raw >= 0x80000000;
    const index = hardened ? raw - 0x80000000 : raw;
    path += `/${index}${hardened ? "'" : ''}`;
  }
  return path;
}

/**
 * Lists every key the file says must sign, and where it comes from.
 *
 * This is derivation information only. A fingerprint and a path say which
 * wallet and which position, and nothing here can produce or recover the key
 * itself.
 */
export function readDerivations(inspection: PsbtInspection): Derivation[] {
  const out: Derivation[] = [];

  const push = (
    scope: Derivation['scope'],
    index: number,
    record: PsbtRecord,
    taproot: boolean,
  ): void => {
    const bytes = hexToBytes(record.valueHex);
    if (bytes.length < 4) { return; }
    let offset = 0;
    const leafHashes: string[] = [];
    if (taproot) {
      const count = readCompactSize(bytes, 0);
      if (!count) { return; }
      offset = count[1];
      for (let i = 0; i < count[0]; i++) {
        if (offset + 32 > bytes.length) { return; }
        leafHashes.push(toHex(bytes.slice(offset, offset + 32)));
        offset += 32;
      }
    }
    if (offset + 4 > bytes.length) { return; }
    out.push({
      scope,
      index,
      keyHex: record.keyDataHex,
      masterFingerprint: toHex(bytes.slice(offset, offset + 4)),
      path: formatPath(bytes, offset + 4),
      taproot,
      leafHashes,
    });
  };

  for (const record of inspection.globals) {
    // A global xpub carries the fingerprint and path of the xpub itself,
    // which is what tells a signer whether the file is addressed to it.
    if (record.keyType === 0x01) { push('global', -1, record, false); }
  }
  inspection.inputs.forEach((records, index) => {
    for (const record of records) {
      if (record.keyType === 0x06) { push('input', index, record, false); }
      if (record.keyType === 0x16) { push('input', index, record, true); }
    }
  });
  inspection.outputs.forEach((records, index) => {
    for (const record of records) {
      if (record.keyType === 0x02) { push('output', index, record, false); }
      if (record.keyType === 0x07) { push('output', index, record, true); }
    }
  });
  return out;
}

/**
 * Formats exact satoshis as a bitcoin amount.
 *
 * String arithmetic on the bigint rather than division, so the result is the
 * value and not the nearest double to it.
 */
export function formatSats(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(9, '0');
  const whole = digits.slice(0, digits.length - 8);
  const fraction = digits.slice(digits.length - 8);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
