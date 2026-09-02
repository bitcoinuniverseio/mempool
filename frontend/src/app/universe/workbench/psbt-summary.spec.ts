import { describe, expect, it } from 'vitest';
import { inspectPsbt } from './psbt-inspect';
import {
  formatSats,
  readDerivations,
  readRawTransaction,
  summarizeAmounts,
} from './psbt-summary';

/**
 * Builders that say what the file contains, so a failing test names a field
 * rather than an offset into a blob.
 */
function compactSize(value: number): number[] {
  if (value < 0xfd) { return [value]; }
  if (value <= 0xffff) { return [0xfd, value & 0xff, (value >> 8) & 0xff]; }
  return [0xfe, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff,
    Math.floor(value / 0x1000000) & 0xff];
}

function record(keyType: number, keyData: number[], value: number[]): number[] {
  return [
    ...compactSize(1 + keyData.length),
    keyType,
    ...keyData,
    ...compactSize(value.length),
    ...value,
  ];
}

/** Eight byte little endian, built from a bigint so nothing rounds. */
function amountLe(value: bigint): number[] {
  const out: number[] = [];
  let rest = value;
  for (let i = 0; i < 8; i++) {
    out.push(Number(rest & 0xffn));
    rest >>= 8n;
  }
  return out;
}

function uint32Le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, Math.floor(value / 0x1000000) & 0xff];
}

interface TxOut { readonly amount: bigint; readonly script: number[]; }
interface TxIn { readonly txid: number[]; readonly vout: number; }

function rawTx(inputs: TxIn[], outputs: TxOut[]): number[] {
  const bytes: number[] = [2, 0, 0, 0, ...compactSize(inputs.length)];
  for (const input of inputs) {
    bytes.push(...input.txid);
    bytes.push(...uint32Le(input.vout));
    bytes.push(0);
    bytes.push(0xff, 0xff, 0xff, 0xff);
  }
  bytes.push(...compactSize(outputs.length));
  for (const output of outputs) {
    bytes.push(...amountLe(output.amount));
    bytes.push(...compactSize(output.script.length), ...output.script);
  }
  bytes.push(0, 0, 0, 0);
  return bytes;
}

function psbtV0(
  inputs: TxIn[],
  outputs: TxOut[],
  inputRecords: number[][] = [],
  outputRecords: number[][] = [],
  extraGlobals: number[] = [],
): Uint8Array {
  const bytes: number[] = [0x70, 0x73, 0x62, 0x74, 0xff];
  bytes.push(...record(0x00, [], rawTx(inputs, outputs)));
  bytes.push(...extraGlobals);
  bytes.push(0x00);
  for (let i = 0; i < inputs.length; i++) {
    bytes.push(...(inputRecords[i] ?? []));
    bytes.push(0x00);
  }
  for (let i = 0; i < outputs.length; i++) {
    bytes.push(...(outputRecords[i] ?? []));
    bytes.push(0x00);
  }
  return new Uint8Array(bytes);
}

function psbtV2(
  inputRecords: number[][],
  outputRecords: number[][],
  extraGlobals: number[] = [],
): Uint8Array {
  const bytes: number[] = [0x70, 0x73, 0x62, 0x74, 0xff];
  bytes.push(...record(0xfb, [], uint32Le(2)));
  bytes.push(...record(0x02, [], uint32Le(2)));
  bytes.push(...record(0x04, [], [inputRecords.length]));
  bytes.push(...record(0x05, [], [outputRecords.length]));
  bytes.push(...extraGlobals);
  bytes.push(0x00);
  for (const section of inputRecords) { bytes.push(...section, 0x00); }
  for (const section of outputRecords) { bytes.push(...section, 0x00); }
  return new Uint8Array(bytes);
}

/** A witness utxo record value: amount then script. */
function witnessUtxo(amount: bigint, script: number[]): number[] {
  return [...amountLe(amount), ...compactSize(script.length), ...script];
}

const P2WPKH = [0x00, 0x14, ...new Array(20).fill(0xab)];
const P2TR = [0x51, 0x20, ...new Array(32).fill(0xcd)];
const TXID_A = new Array(32).fill(0x11);
const TXID_B = new Array(32).fill(0x22);

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('readRawTransaction', () => {
  it('reads the previous outputs the inputs point at, in display order', () => {
    const tx = readRawTransaction(toHex(rawTx(
      [{ txid: TXID_A, vout: 3 }],
      [{ amount: 1000n, script: P2WPKH }],
    )));
    expect(tx?.inputs).toEqual([{ txid: '11'.repeat(32), vout: 3 }]);
  });

  it('reads exact amounts past the range a double holds', () => {
    // 2^53 satoshis is larger than Number.MAX_SAFE_INTEGER, so a reader
    // that went through a double would return the wrong value here.
    const huge = 9007199254740993n;
    const tx = readRawTransaction(toHex(rawTx(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: huge, script: P2WPKH }],
    )));
    expect(tx?.outputs[0].amount).toBe(huge);
  });

  it('reads a segwit serialized transaction', () => {
    const legacy = rawTx([{ txid: TXID_A, vout: 0 }], [{ amount: 500n, script: P2WPKH }]);
    const segwit = [...legacy.slice(0, 4), 0x00, 0x01, ...legacy.slice(4)];
    const tx = readRawTransaction(toHex(segwit));
    expect(tx?.outputs[0].amount).toBe(500n);
  });

  it('returns null rather than a partial answer when the bytes run out', () => {
    const truncated = rawTx([{ txid: TXID_A, vout: 0 }], [{ amount: 500n, script: P2WPKH }]);
    expect(readRawTransaction(toHex(truncated.slice(0, 20)))).toBeNull();
  });

  it('returns null for something far too short to be a transaction', () => {
    expect(readRawTransaction('0200')).toBeNull();
  });
});

describe('summarizeAmounts, version 0', () => {
  it('takes output values from the unsigned transaction', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 90000n, script: P2WPKH }, { amount: 5000n, script: P2TR }],
      [record(0x01, [], witnessUtxo(100000n, P2WPKH))],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.outputs.map((o) => o.amount)).toEqual([90000n, 5000n]);
    expect(summary.outputs[0].source).toBe('unsigned-tx');
    expect(summary.outputTotal).toBe(95000n);
  });

  it('states the fee when every value is present', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 90000n, script: P2WPKH }],
      [record(0x01, [], witnessUtxo(100000n, P2WPKH))],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.inputTotal).toBe(100000n);
    expect(summary.fee).toBe(10000n);
    expect(summary.feeUnknownReason).toBeNull();
  });

  it('takes an input value from the previous transaction when there is no witness utxo', () => {
    const prev = rawTx(
      [{ txid: TXID_B, vout: 0 }],
      [{ amount: 111n, script: P2WPKH }, { amount: 70000n, script: P2WPKH }],
    );
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 1 }],
      [{ amount: 60000n, script: P2WPKH }],
      [record(0x00, [], prev)],
    ));
    const summary = summarizeAmounts(psbt);
    // Output 1 of the previous transaction, because the input spends index 1.
    expect(summary.inputs[0].amount).toBe(70000n);
    expect(summary.inputs[0].source).toBe('non-witness-utxo');
    expect(summary.fee).toBe(10000n);
  });

  it('leaves the fee unknown rather than treating a missing input value as zero', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }, { txid: TXID_B, vout: 0 }],
      [{ amount: 90000n, script: P2WPKH }],
      [record(0x01, [], witnessUtxo(100000n, P2WPKH))],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.inputsMissingAmount).toEqual([1]);
    expect(summary.fee).toBeNull();
    expect(summary.feeUnknownReason).toContain('unknown');
    // The partial total is still reported, because it is a real sum of the
    // values that are present. It is simply not the input total.
    expect(summary.inputTotal).toBe(100000n);
  });

  it('names a malformed witness utxo instead of skipping the input', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 90000n, script: P2WPKH }],
      [record(0x01, [], [1, 2, 3])],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.inputs[0].amount).toBeNull();
    expect(summary.inputs[0].missingReason).toContain('malformed');
  });

  it('refuses to state a fee when the outputs pay more than the inputs hold', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 200000n, script: P2WPKH }],
      [record(0x01, [], witnessUtxo(100000n, P2WPKH))],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.outputsExceedInputs).toBe(true);
    expect(summary.fee).toBeNull();
  });

  it('reports a zero fee as zero, which is a fee and not a gap', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 100000n, script: P2WPKH }],
      [record(0x01, [], witnessUtxo(100000n, P2WPKH))],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.fee).toBe(0n);
    expect(summary.feeUnknownReason).toBeNull();
  });

  it('keeps a total exact past the range a double holds', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }, { txid: TXID_B, vout: 0 }],
      [{ amount: 9007199254740992n, script: P2WPKH }],
      [
        record(0x01, [], witnessUtxo(9007199254740992n, P2WPKH)),
        record(0x01, [], witnessUtxo(1n, P2WPKH)),
      ],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.inputTotal).toBe(9007199254740993n);
    expect(summary.fee).toBe(1n);
  });
});

describe('summarizeAmounts, version 2', () => {
  it('takes output values from the amount records', () => {
    const psbt = inspectPsbt(psbtV2(
      [[
        ...record(0x0e, [], TXID_A),
        ...record(0x0f, [], uint32Le(0)),
        ...record(0x01, [], witnessUtxo(80000n, P2TR)),
      ]],
      [[
        ...record(0x03, [], amountLe(75000n)),
        ...record(0x04, [], P2TR),
      ]],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.outputs[0].amount).toBe(75000n);
    expect(summary.outputs[0].source).toBe('psbt-amount');
    expect(summary.fee).toBe(5000n);
  });

  it('reads the previous outpoint from the input records', () => {
    const psbt = inspectPsbt(psbtV2(
      [[
        ...record(0x0e, [], TXID_A),
        ...record(0x0f, [], uint32Le(7)),
        ...record(0x01, [], witnessUtxo(80000n, P2TR)),
      ]],
      [[...record(0x03, [], amountLe(75000n))]],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.inputs[0].previousTxid).toBe('11'.repeat(32));
    expect(summary.inputs[0].previousIndex).toBe(7);
  });

  it('names an output with no amount record rather than calling it zero', () => {
    const psbt = inspectPsbt(psbtV2(
      [[...record(0x01, [], witnessUtxo(80000n, P2TR))]],
      [[...record(0x04, [], P2TR)]],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.outputs[0].amount).toBeNull();
    expect(summary.outputsMissingAmount).toEqual([0]);
    expect(summary.fee).toBeNull();
  });

  it('says an input carries no value at all when neither utxo record is present', () => {
    const psbt = inspectPsbt(psbtV2(
      [[...record(0x0e, [], TXID_A), ...record(0x0f, [], uint32Le(0))]],
      [[...record(0x03, [], amountLe(75000n))]],
    ));
    const summary = summarizeAmounts(psbt);
    expect(summary.inputs[0].missingReason).toContain('neither');
  });
});

describe('readDerivations', () => {
  const FINGERPRINT = [0xde, 0xad, 0xbe, 0xef];
  const PUBKEY = new Array(33).fill(0x02);

  it('renders a path with hardened steps marked', () => {
    const value = [
      ...FINGERPRINT,
      ...uint32Le(0x80000054),  // 84'
      ...uint32Le(0x80000000),  // 0'
      ...uint32Le(0x80000000),  // 0'
      ...uint32Le(0),
      ...uint32Le(5),
    ];
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 1n, script: P2WPKH }],
      [record(0x06, PUBKEY, value)],
    ));
    const derivations = readDerivations(psbt);
    expect(derivations).toHaveLength(1);
    expect(derivations[0].masterFingerprint).toBe('deadbeef');
    expect(derivations[0].path).toBe("m/84'/0'/0'/0/5");
    expect(derivations[0].keyHex).toBe(toHex(PUBKEY));
    expect(derivations[0].taproot).toBe(false);
  });

  it('reads a taproot derivation with its leaf hashes', () => {
    const leaf = new Array(32).fill(0x7f);
    const value = [
      ...compactSize(1),
      ...leaf,
      ...FINGERPRINT,
      ...uint32Le(0x80000056),
      ...uint32Le(0),
    ];
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 1n, script: P2TR }],
      [record(0x16, new Array(32).fill(0x03), value)],
    ));
    const derivations = readDerivations(psbt);
    expect(derivations[0].taproot).toBe(true);
    expect(derivations[0].leafHashes).toEqual([toHex(leaf)]);
    expect(derivations[0].path).toBe("m/86'/0");
  });

  it('reads a taproot key path derivation, which names no leaf', () => {
    const value = [...compactSize(0), ...FINGERPRINT, ...uint32Le(0x80000056)];
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 1n, script: P2TR }],
      [record(0x16, new Array(32).fill(0x03), value)],
    ));
    expect(readDerivations(psbt)[0].leafHashes).toEqual([]);
  });

  it('reads a global xpub, which is how a file says who it is addressed to', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 1n, script: P2WPKH }],
      [],
      [],
      record(0x01, new Array(78).fill(0x04), [...FINGERPRINT, ...uint32Le(0x80000054)]),
    ));
    const derivations = readDerivations(psbt);
    expect(derivations[0].scope).toBe('global');
    expect(derivations[0].path).toBe("m/84'");
  });

  it('reads an output derivation, which is how a change output is claimed', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 1n, script: P2WPKH }],
      [],
      [record(0x02, PUBKEY, [...FINGERPRINT, ...uint32Le(1), ...uint32Le(9)])],
    ));
    const derivations = readDerivations(psbt);
    expect(derivations[0].scope).toBe('output');
    expect(derivations[0].path).toBe('m/1/9');
  });

  it('drops a derivation record too short to carry a fingerprint', () => {
    const psbt = inspectPsbt(psbtV0(
      [{ txid: TXID_A, vout: 0 }],
      [{ amount: 1n, script: P2WPKH }],
      [record(0x06, PUBKEY, [0x01, 0x02])],
    ));
    expect(readDerivations(psbt)).toEqual([]);
  });
});

describe('formatSats', () => {
  it('places the point without dividing', () => {
    expect(formatSats(100000000n)).toBe('1.00000000');
    expect(formatSats(1n)).toBe('0.00000001');
    expect(formatSats(0n)).toBe('0.00000000');
  });

  it('holds a value past the range a double represents exactly', () => {
    expect(formatSats(2100000000000001n)).toBe('21000000.00000001');
  });

  it('marks a negative amount rather than losing the sign', () => {
    expect(formatSats(-5000n)).toBe('-0.00005000');
  });
});
