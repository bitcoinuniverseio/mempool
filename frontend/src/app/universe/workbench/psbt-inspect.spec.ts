import {
  decodePsbtInput,
  describeSighash,
  diffPsbt,
  inspectPsbt,
  looksLikeSecret,
  PsbtParseError,
  serialize,
} from './psbt-inspect';

/**
 * Builders, so a test can say what a file contains rather than carrying an
 * opaque blob whose meaning a reader has to reverse engineer.
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

/** A minimal legacy transaction with the given input and output counts. */
function unsignedTx(inputs: number, outputs: number): number[] {
  const bytes: number[] = [2, 0, 0, 0, ...compactSize(inputs)];
  for (let i = 0; i < inputs; i++) {
    bytes.push(...new Array(32).fill(0));   // previous txid
    bytes.push(0, 0, 0, 0);                 // previous index
    bytes.push(0);                          // empty script
    bytes.push(0xff, 0xff, 0xff, 0xff);     // sequence
  }
  bytes.push(...compactSize(outputs));
  for (let i = 0; i < outputs; i++) {
    bytes.push(...new Array(8).fill(0));    // value
    bytes.push(0);                          // empty script
  }
  bytes.push(0, 0, 0, 0);                   // locktime
  return bytes;
}

function psbtV0(options: {
  inputs?: number;
  outputs?: number;
  extraGlobals?: number[];
  inputRecords?: number[][];
  outputRecords?: number[][];
} = {}): Uint8Array {
  const inputs = options.inputs ?? 1;
  const outputs = options.outputs ?? 1;
  const bytes: number[] = [0x70, 0x73, 0x62, 0x74, 0xff];
  bytes.push(...record(0x00, [], unsignedTx(inputs, outputs)));
  bytes.push(...(options.extraGlobals ?? []));
  bytes.push(0x00);
  for (let i = 0; i < inputs; i++) {
    bytes.push(...(options.inputRecords?.[i] ?? []));
    bytes.push(0x00);
  }
  for (let i = 0; i < outputs; i++) {
    bytes.push(...(options.outputRecords?.[i] ?? []));
    bytes.push(0x00);
  }
  return new Uint8Array(bytes);
}

function psbtV2(inputs = 1, outputs = 1, extraGlobals: number[] = []): Uint8Array {
  const bytes: number[] = [0x70, 0x73, 0x62, 0x74, 0xff];
  bytes.push(...record(0xfb, [], [2, 0, 0, 0]));       // version 2
  bytes.push(...record(0x02, [], [2, 0, 0, 0]));       // tx version
  bytes.push(...record(0x04, [], [inputs]));           // input count
  bytes.push(...record(0x05, [], [outputs]));          // output count
  bytes.push(...extraGlobals);
  bytes.push(0x00);
  for (let i = 0; i < inputs; i++) { bytes.push(0x00); }
  for (let i = 0; i < outputs; i++) { bytes.push(0x00); }
  return new Uint8Array(bytes);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('decodePsbtInput', () => {
  it('reads hexadecimal', () => {
    expect([...decodePsbtInput('70736274ff')]).toEqual([0x70, 0x73, 0x62, 0x74, 0xff]);
  });

  it('reads base64', () => {
    expect([...decodePsbtInput('cHNidP8=')]).toEqual([0x70, 0x73, 0x62, 0x74, 0xff]);
  });

  it('ignores whitespace, including a value pasted across lines', () => {
    expect([...decodePsbtInput(' 7073\n6274 ff ')]).toEqual([0x70, 0x73, 0x62, 0x74, 0xff]);
  });

  it('refuses odd length hex rather than dropping a character', () => {
    expect(() => decodePsbtInput('70736274f')).toThrow(PsbtParseError);
  });

  it('refuses an empty value with a reason', () => {
    expect(() => decodePsbtInput('   ')).toThrow(/Nothing was supplied/);
  });

  it('refuses something that is neither encoding', () => {
    expect(() => decodePsbtInput('this is not a psbt!')).toThrow(/neither hexadecimal nor base64/);
  });
});

describe('inspectPsbt magic and framing', () => {
  it('refuses a file that does not start with the magic bytes', () => {
    expect(() => inspectPsbt(new Uint8Array([1, 2, 3, 4, 5, 6])))
      .toThrow(/magic bytes/);
  });

  it('refuses a file too short to hold the magic bytes', () => {
    expect(() => inspectPsbt(new Uint8Array([0x70, 0x73]))).toThrow(/too short/);
  });

  it('refuses a truncated file rather than reporting an empty one', () => {
    // A reader that stopped at the end of the buffer and called the result
    // complete would report a PSBT with no inputs, which is a different file.
    const truncated = psbtV0().slice(0, 20);
    expect(() => inspectPsbt(truncated)).toThrow(PsbtParseError);
  });

  it('reports where in the file a failure happened', () => {
    try {
      inspectPsbt(new Uint8Array([0x70, 0x73, 0x62, 0x74, 0x00]));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PsbtParseError);
      expect((e as PsbtParseError).offset).toBe(4);
    }
  });
});

describe('inspectPsbt version 0', () => {
  it('takes its input and output counts from the unsigned transaction', () => {
    const inspection = inspectPsbt(psbtV0({ inputs: 3, outputs: 2 }));
    expect(inspection.version).toBe(0);
    expect(inspection.inputCount).toBe(3);
    expect(inspection.outputCount).toBe(2);
    expect(inspection.inputs).toHaveLength(3);
    expect(inspection.outputs).toHaveLength(2);
  });

  it('names the fields the specification defines', () => {
    const inspection = inspectPsbt(psbtV0({
      inputRecords: [record(0x03, [], [0x01, 0, 0, 0])],
    }));
    expect(inspection.inputs[0][0].typeName).toBe('PSBT_IN_SIGHASH_TYPE');
    expect(inspection.inputs[0][0].unknown).toBe(false);
  });

  it('is version 0 even without a version record, since the byte is optional', () => {
    expect(inspectPsbt(psbtV0()).declaredVersion).toBeNull();
    expect(inspectPsbt(psbtV0()).version).toBe(0);
  });
});

describe('inspectPsbt version 2', () => {
  it('reads a file that has no unsigned transaction at all', () => {
    // A reader written only for version 0 answers "no inputs" here, which is
    // worse than failing, because it looks like a valid empty file.
    const inspection = inspectPsbt(psbtV2(2, 3));
    expect(inspection.version).toBe(2);
    expect(inspection.declaredVersion).toBe(2);
    expect(inspection.inputCount).toBe(2);
    expect(inspection.outputCount).toBe(3);
  });

  it('refuses a file with neither an unsigned transaction nor counts', () => {
    const bytes = new Uint8Array([
      0x70, 0x73, 0x62, 0x74, 0xff,
      ...record(0xfb, [], [2, 0, 0, 0]),
      0x00,
    ]);
    expect(() => inspectPsbt(bytes)).toThrow(/how many inputs/);
  });
});

describe('unknown and proprietary records', () => {
  it('keeps a record whose type this reader does not know', () => {
    const inspection = inspectPsbt(psbtV0({
      extraGlobals: record(0x7e, [0xaa], [0xde, 0xad, 0xbe, 0xef]),
    }));
    expect(inspection.unknownRecords).toHaveLength(1);
    expect(inspection.unknownRecords[0].keyType).toBe(0x7e);
    expect(inspection.unknownRecords[0].keyDataHex).toBe('aa');
    expect(inspection.unknownRecords[0].valueHex).toBe('deadbeef');
    expect(inspection.unknownRecords[0].typeName).toBeNull();
  });

  it('separates a proprietary record from a merely unknown one', () => {
    // 0xfc is reserved for other tools by the specification, so it is named
    // rather than reported as something nobody understands.
    const inspection = inspectPsbt(psbtV0({
      extraGlobals: record(0xfc, [0x01], [0x02]),
    }));
    expect(inspection.proprietaryRecords).toHaveLength(1);
    expect(inspection.proprietaryRecords[0].typeName).toBe('PSBT_GLOBAL_PROPRIETARY');
    expect(inspection.proprietaryRecords[0].unknown).toBe(false);
  });

  it('keeps unknown records in inputs and outputs too', () => {
    const inspection = inspectPsbt(psbtV0({
      inputRecords: [record(0x60, [], [1])],
      outputRecords: [record(0x61, [], [2])],
    }));
    expect(inspection.unknownRecords.map((r) => r.scope)).toEqual(['input', 'output']);
  });
});

describe('serialize', () => {
  it('reproduces a file byte for byte', () => {
    const original = psbtV0({ inputs: 2, outputs: 2 });
    expect(toHex(serialize(inspectPsbt(original)))).toBe(toHex(original));
  });

  it('reproduces a file carrying fields this reader does not recognise', () => {
    // The promise the whole reader rests on. A tool that dropped a field it
    // did not understand would hand back a different file than it was given.
    const original = psbtV0({
      extraGlobals: [
        ...record(0x7e, [0xaa, 0xbb], [0xde, 0xad]),
        ...record(0xfc, [0x01, 0x02], [0xbe, 0xef]),
      ],
      inputRecords: [record(0x55, [0x09], [0x11, 0x22, 0x33])],
      outputRecords: [record(0x66, [], [0x44])],
    });
    expect(toHex(serialize(inspectPsbt(original)))).toBe(toHex(original));
  });

  it('reproduces a version 2 file', () => {
    const original = psbtV2(2, 1);
    expect(toHex(serialize(inspectPsbt(original)))).toBe(toHex(original));
  });

  it('reproduces a record whose value is empty', () => {
    const original = psbtV0({ inputRecords: [record(0x07, [], [])] });
    expect(toHex(serialize(inspectPsbt(original)))).toBe(toHex(original));
  });

  it('reproduces a record long enough to need a wider length prefix', () => {
    const long = new Array(400).fill(0x5a);
    const original = psbtV0({ inputRecords: [record(0x00, [], long)] });
    expect(toHex(serialize(inspectPsbt(original)))).toBe(toHex(original));
  });
});

describe('describeSighash', () => {
  it('calls ALL safe, because it commits to the whole transaction', () => {
    const finding = describeSighash(0x01, 0);
    expect(finding.name).toBe('ALL');
    expect(finding.permissive).toBe(false);
  });

  it('calls taproot DEFAULT safe', () => {
    expect(describeSighash(0x00, 0).name).toBe('DEFAULT');
    expect(describeSighash(0x00, 0).permissive).toBe(false);
  });

  it('flags NONE, which signs no outputs at all', () => {
    const finding = describeSighash(0x02, 1);
    expect(finding.name).toBe('NONE');
    expect(finding.permissive).toBe(true);
    expect(finding.explanation).toContain('anywhere');
  });

  it('flags SINGLE and names what it leaves changeable', () => {
    expect(describeSighash(0x03, 0).permissive).toBe(true);
    expect(describeSighash(0x03, 0).name).toBe('SINGLE');
  });

  it('flags ANYONECANPAY even alongside ALL', () => {
    const finding = describeSighash(0x81, 0);
    expect(finding.name).toBe('ALL | ANYONECANPAY');
    expect(finding.permissive).toBe(true);
    expect(finding.explanation).toContain('Other inputs can be added');
  });

  it('names the combined flags', () => {
    expect(describeSighash(0x83, 0).name).toBe('SINGLE | ANYONECANPAY');
  });

  it('flags a value the rules do not define rather than guessing at it', () => {
    const finding = describeSighash(0x7f, 0);
    expect(finding.permissive).toBe(true);
    expect(finding.name).toContain('UNKNOWN');
  });

  it('carries the input index so a finding points somewhere', () => {
    expect(describeSighash(0x02, 4).inputIndex).toBe(4);
  });
});

describe('signing state', () => {
  it('reports an input with a final script as finalized', () => {
    const inspection = inspectPsbt(psbtV0({
      inputRecords: [record(0x07, [], [0x51])],
    }));
    expect(inspection.finalizedInputs).toEqual([0]);
    expect(inspection.signedInputs).toEqual([]);
  });

  it('reports an input with a partial signature as signed but not final', () => {
    // The difference matters: a signed input still needs a finalizer, and
    // calling it finished would tell someone the file was ready to broadcast.
    const inspection = inspectPsbt(psbtV0({
      inputRecords: [record(0x02, new Array(33).fill(0x02), [0x30, 0x44])],
    }));
    expect(inspection.signedInputs).toEqual([0]);
    expect(inspection.finalizedInputs).toEqual([]);
  });

  it('counts a taproot key signature as a signature', () => {
    const inspection = inspectPsbt(psbtV0({
      inputRecords: [record(0x13, [], new Array(64).fill(0x01))],
    }));
    expect(inspection.signedInputs).toEqual([0]);
  });

  it('reports an unsigned input as neither', () => {
    const inspection = inspectPsbt(psbtV0());
    expect(inspection.signedInputs).toEqual([]);
    expect(inspection.finalizedInputs).toEqual([]);
  });

  it('collects a sighash finding for each input that declares one', () => {
    const inspection = inspectPsbt(psbtV0({
      inputs: 2,
      inputRecords: [
        record(0x03, [], [0x01, 0, 0, 0]),
        record(0x03, [], [0x83, 0, 0, 0]),
      ],
    }));
    expect(inspection.sighashFindings).toHaveLength(2);
    expect(inspection.sighashFindings[1].permissive).toBe(true);
    expect(inspection.sighashFindings[1].inputIndex).toBe(1);
  });
});

describe('diffPsbt', () => {
  it('finds nothing between a file and itself', () => {
    const one = inspectPsbt(psbtV0());
    expect(diffPsbt(one, one)).toEqual([]);
  });

  it('reports a signature added by a signer', () => {
    const before = inspectPsbt(psbtV0());
    const after = inspectPsbt(psbtV0({
      inputRecords: [record(0x02, new Array(33).fill(0x02), [0x30, 0x44])],
    }));
    const diff = diffPsbt(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe('added');
    expect(diff[0].typeName).toBe('PSBT_IN_PARTIAL_SIG');
    expect(diff[0].beforeHex).toBeNull();
  });

  it('reports a record that was removed', () => {
    const before = inspectPsbt(psbtV0({ inputRecords: [record(0x03, [], [1, 0, 0, 0])] }));
    const after = inspectPsbt(psbtV0());
    const diff = diffPsbt(before, after);
    expect(diff[0].kind).toBe('removed');
    expect(diff[0].afterHex).toBeNull();
  });

  it('reports a value that changed under the same key', () => {
    // A signer that altered a sighash flag rather than adding a signature is
    // exactly the case a before and after comparison exists to catch.
    const before = inspectPsbt(psbtV0({ inputRecords: [record(0x03, [], [1, 0, 0, 0])] }));
    const after = inspectPsbt(psbtV0({ inputRecords: [record(0x03, [], [3, 0, 0, 0])] }));
    const diff = diffPsbt(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].kind).toBe('changed');
    expect(diff[0].beforeHex).toBe('01000000');
    expect(diff[0].afterHex).toBe('03000000');
  });

  it('distinguishes two records that share a type but not their key data', () => {
    const before = inspectPsbt(psbtV0({
      inputRecords: [record(0x02, [0xaa], [0x01])],
    }));
    const after = inspectPsbt(psbtV0({
      inputRecords: [[
        ...record(0x02, [0xaa], [0x01]),
        ...record(0x02, [0xbb], [0x02]),
      ]],
    }));
    const diff = diffPsbt(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].keyDataHex).toBe('bb');
  });

  it('orders the result the same way whatever order the records arrived in', () => {
    const before = inspectPsbt(psbtV0({ inputs: 2 }));
    const after = inspectPsbt(psbtV0({
      inputs: 2,
      inputRecords: [record(0x03, [], [1, 0, 0, 0]), record(0x03, [], [2, 0, 0, 0])],
    }));
    const diff = diffPsbt(before, after);
    expect(diff.map((d) => d.index)).toEqual([0, 1]);
  });
});

describe('looksLikeSecret', () => {
  it('passes an ordinary PSBT through', () => {
    expect(looksLikeSecret('cHNidP8BAHUCAAAAA')).toBeNull();
  });

  it('passes an empty value through', () => {
    expect(looksLikeSecret('')).toBeNull();
  });

  it('refuses an extended private key', () => {
    const xprv = 'xprv' + 'a'.repeat(60);
    expect(looksLikeSecret(xprv)).toContain('extended private key');
  });

  it('refuses a testnet extended private key too', () => {
    expect(looksLikeSecret('tprv' + 'b'.repeat(60))).toContain('extended private key');
  });

  it('refuses a wallet import format key', () => {
    expect(looksLikeSecret('5' + 'K'.repeat(50))).toContain('wallet import format');
  });

  it('refuses something shaped like a recovery phrase', () => {
    const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    expect(looksLikeSecret(phrase)).toContain('recovery phrase');
  });

  it('says that nothing was sent, because nothing was', () => {
    // The reassurance is part of the answer. Someone who has just pasted a
    // seed needs to know immediately whether it left the machine.
    expect(looksLikeSecret('xprv' + 'a'.repeat(60))).toContain('nothing was sent');
  });

  it('does not refuse an extended public key', () => {
    expect(looksLikeSecret('xpub' + 'a'.repeat(60))).toBeNull();
  });
});
