import { describe, expect, it } from 'vitest';
import {
  analyze,
  Finding,
  HEURISTIC_REVISION,
  PrivacyInput,
  PrivacyOutput,
  PrivacyTransaction,
  roundnessOf,
  ruleIds,
} from './privacy-rules';

function input(options: Partial<PrivacyInput> = {}): PrivacyInput {
  return {
    index: 0,
    valueSats: 100_000,
    scriptType: 'v0_p2wpkh',
    address: 'bc1qsender',
    sequence: 0xfffffffd,
    ...options,
  };
}

function out(options: Partial<PrivacyOutput> = {}): PrivacyOutput {
  return {
    index: 0,
    valueSats: 50_000,
    scriptType: 'v0_p2wpkh',
    address: 'bc1qrecipient',
    ...options,
  };
}

function tx(options: Partial<PrivacyTransaction> = {}): PrivacyTransaction {
  return {
    txid: 'a'.repeat(64),
    version: 2,
    locktime: 0,
    inputs: [input()],
    outputs: [out()],
    confirmedHeight: 900_000,
    ...options,
  };
}

function findingIds(t: PrivacyTransaction): string[] {
  return analyze(t).findings.map((f) => f.ruleId);
}

function find(t: PrivacyTransaction, ruleId: string): Finding | undefined {
  return analyze(t).findings.find((f) => f.ruleId === ruleId);
}

describe('the report as a whole', () => {
  it('carries the revision, so a saved finding stays readable', () => {
    expect(analyze(tx()).revision).toBe(HEURISTIC_REVISION);
  });

  it('is deterministic: the same transaction gives the same report', () => {
    const subject = tx({
      inputs: [input({ index: 0 }), input({ index: 1, address: 'bc1qother' })],
      outputs: [out({ index: 0 }), out({ index: 1, scriptType: 'p2pkh', valueSats: 37_123 })],
    });
    expect(JSON.stringify(analyze(subject))).toBe(JSON.stringify(analyze(subject)));
  });

  it('lists every rule that ran, so silence can be told from absence', () => {
    const report = analyze(tx());
    expect(report.rulesRun).toEqual(ruleIds());
    expect(report.rulesRun.length).toBeGreaterThan(10);
  });

  it('records why a rule had nothing to measure', () => {
    // One input, so the common ownership assumption has nothing to join.
    const skipped = analyze(tx()).rulesSkipped.find((s) => s.ruleId === 'common-input-ownership');
    expect(skipped?.reason).toContain('one input');
  });

  it('puts what reveals most first', () => {
    const report = analyze(tx({
      inputs: [input({ index: 0 }), input({ index: 1, address: 'bc1qother' })],
      outputs: [out({ index: 0 }), out({ index: 1, scriptType: 'p2pkh' })],
    }));
    const severities = report.findings.map((f) => f.severity);
    const weight = { reveals: 0, notable: 1, neutral: 2 };
    for (let i = 1; i < severities.length; i++) {
      expect(weight[severities[i]]).toBeGreaterThanOrEqual(weight[severities[i - 1]]);
    }
  });

  it('gives every finding both kinds of wrongness', () => {
    const report = analyze(tx({
      inputs: [input({ index: 0 }), input({ index: 1, address: 'bc1qother' })],
      outputs: [out({ index: 0, valueSats: 100_000 }), out({ index: 1, valueSats: 37_123, scriptType: 'p2pkh' })],
    }));
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.falsePositives.length).toBeGreaterThan(20);
      expect(finding.falseNegatives.length).toBeGreaterThan(20);
      expect(finding.plain.length).toBeGreaterThan(20);
      expect(finding.technical.length).toBeGreaterThan(20);
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it('never names an owner, a risk or a person', () => {
    const report = analyze(tx({
      inputs: [input({ index: 0 }), input({ index: 1, address: 'bc1qother' })],
      outputs: [out({ index: 0 }), out({ index: 1, scriptType: 'p2pkh', valueSats: 12_345 })],
    }));
    const words = /\b(criminal|illicit|laundering|sanction|risk score|suspicious|identity|kyc)\b/i;
    for (const finding of report.findings) {
      expect(`${finding.plain} ${finding.technical} ${finding.title}`).not.toMatch(words);
    }
  });
});

describe('common input ownership', () => {
  it('fires on more than one input and says it is an assumption', () => {
    const finding = find(tx({
      inputs: [input({ index: 0 }), input({ index: 1, address: 'bc1qb' })],
    }), 'common-input-ownership');
    expect(finding?.confidence).toBe('heuristic');
    expect(finding?.falsePositives).toContain('coinjoin');
  });

  it('is silent for a single input', () => {
    expect(findingIds(tx())).not.toContain('common-input-ownership');
  });
});

describe('address reuse', () => {
  it('fires when an output address repeats', () => {
    const finding = find(tx({
      outputs: [out({ index: 0 }), out({ index: 1, address: 'bc1qrecipient' })],
    }), 'address-reuse');
    expect(finding?.confidence).toBe('observed');
    expect(finding?.evidence[0].value).toContain('outputs 0, 1');
  });

  it('fires when an input address is paid again by an output', () => {
    const finding = find(tx({
      inputs: [input({ address: 'bc1qsender' })],
      outputs: [out({ address: 'bc1qsender' })],
    }), 'address-reuse');
    expect(finding?.evidence[0].value).toContain('spent by an input');
  });

  it('is silent when every address is different', () => {
    expect(findingIds(tx({
      outputs: [out({ index: 0, address: 'bc1qa' }), out({ index: 1, address: 'bc1qb' })],
    }))).not.toContain('address-reuse');
  });

  it('ignores outputs with no address, which cannot be compared', () => {
    expect(findingIds(tx({
      outputs: [
        out({ index: 0, address: null }),
        out({ index: 1, address: null }),
      ],
    }))).not.toContain('address-reuse');
  });
});

describe('change by script type', () => {
  it('names the output matching the input type as the likely change', () => {
    const finding = find(tx({
      inputs: [input({ scriptType: 'v0_p2wpkh' })],
      outputs: [
        out({ index: 0, scriptType: 'p2pkh', address: 'bc1qa' }),
        out({ index: 1, scriptType: 'v0_p2wpkh', address: 'bc1qb' }),
      ],
    }), 'change-by-script-type');
    expect(finding?.plain).toContain('Output 1');
    expect(finding?.confidence).toBe('likely');
  });

  it('stays silent when both outputs share the input type', () => {
    const report = analyze(tx({
      outputs: [out({ index: 0, address: 'bc1qa' }), out({ index: 1, address: 'bc1qb' })],
    }));
    expect(report.findings.map((f) => f.ruleId)).not.toContain('change-by-script-type');
    expect(report.rulesSkipped.some((s) => s.ruleId === 'change-by-script-type')).toBe(true);
  });

  it('stays silent when the inputs are of mixed types', () => {
    // No single input type means no type identifies the change.
    const skipped = analyze(tx({
      inputs: [
        input({ index: 0, scriptType: 'v0_p2wpkh' }),
        input({ index: 1, scriptType: 'p2pkh', address: 'bc1qb' }),
      ],
      outputs: [
        out({ index: 0, scriptType: 'p2pkh', address: 'bc1qa' }),
        out({ index: 1, scriptType: 'v0_p2wpkh', address: 'bc1qb' }),
      ],
    })).rulesSkipped.find((s) => s.ruleId === 'change-by-script-type');
    expect(skipped?.reason).toContain('more than one script type');
  });
});

describe('change by round amount', () => {
  it('names the round output as the likely payment', () => {
    const finding = find(tx({
      outputs: [
        out({ index: 0, valueSats: 50_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 37_123, address: 'bc1qb' }),
      ],
    }), 'change-by-round-amount');
    expect(finding?.plain).toContain('Output 0 is a round amount');
    expect(finding?.plain).toContain('output 1');
  });

  it('stays silent when both are round', () => {
    expect(findingIds(tx({
      outputs: [
        out({ index: 0, valueSats: 50_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 10_000, address: 'bc1qb' }),
      ],
    }))).not.toContain('change-by-round-amount');
  });

  it('stays silent when neither is round', () => {
    expect(findingIds(tx({
      outputs: [
        out({ index: 0, valueSats: 51_237, address: 'bc1qa' }),
        out({ index: 1, valueSats: 37_123, address: 'bc1qb' }),
      ],
    }))).not.toContain('change-by-round-amount');
  });
});

describe('roundnessOf', () => {
  it('reports the largest step a value is a multiple of', () => {
    expect(roundnessOf(100_000_000)).toBe(100_000_000);
    expect(roundnessOf(20_000_000)).toBe(10_000_000);
    expect(roundnessOf(50_000)).toBe(10_000);
    expect(roundnessOf(3_000)).toBe(1_000);
  });

  it('is null for an amount arithmetic produced', () => {
    expect(roundnessOf(37_123)).toBeNull();
    expect(roundnessOf(546)).toBeNull();
  });

  it('is null for zero, which is round in a way that means nothing', () => {
    expect(roundnessOf(0)).toBeNull();
  });
});

describe('equal output structure', () => {
  it('fires on three or more outputs of the same size', () => {
    const finding = find(tx({
      outputs: [
        out({ index: 0, valueSats: 100_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 100_000, address: 'bc1qb' }),
        out({ index: 2, valueSats: 100_000, address: 'bc1qc' }),
        out({ index: 3, valueSats: 12_345, address: 'bc1qd' }),
      ],
    }), 'equal-output-structure');
    expect(finding?.evidence[0].value).toContain('3 at 100000');
  });

  it('is silent on two equal outputs, which is an ordinary shape', () => {
    expect(findingIds(tx({
      outputs: [
        out({ index: 0, valueSats: 100_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 100_000, address: 'bc1qb' }),
      ],
    }))).not.toContain('equal-output-structure');
  });
});

describe('unnecessary input', () => {
  it('fires when one input alone covers the larger output', () => {
    const finding = find(tx({
      inputs: [
        input({ index: 0, valueSats: 200_000 }),
        input({ index: 1, valueSats: 50_000, address: 'bc1qb' }),
      ],
      outputs: [
        out({ index: 0, valueSats: 150_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 90_000, address: 'bc1qb' }),
      ],
    }), 'unnecessary-input');
    expect(finding?.plain).toContain('200000 satoshis');
    expect(finding?.falsePositives).toContain('consolidating');
  });

  it('stays silent when no single input covers the larger output', () => {
    const skipped = analyze(tx({
      inputs: [
        input({ index: 0, valueSats: 100_000 }),
        input({ index: 1, valueSats: 100_000, address: 'bc1qb' }),
      ],
      outputs: [
        out({ index: 0, valueSats: 150_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 40_000, address: 'bc1qb' }),
      ],
    })).rulesSkipped.find((s) => s.ruleId === 'unnecessary-input');
    expect(skipped?.reason).toContain('every input was needed');
  });

  it('refuses to compare when an input value is not known', () => {
    const skipped = analyze(tx({
      inputs: [
        input({ index: 0, valueSats: null }),
        input({ index: 1, valueSats: 50_000, address: 'bc1qb' }),
      ],
      outputs: [
        out({ index: 0, valueSats: 40_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 5_000, address: 'bc1qb' }),
      ],
    })).rulesSkipped.find((s) => s.ruleId === 'unnecessary-input');
    expect(skipped?.reason).toContain('not known');
  });
});

describe('shape rules', () => {
  it('reports a consolidation', () => {
    const finding = find(tx({
      inputs: [0, 1, 2, 3].map((i) => input({ index: i, address: `bc1q${i}` })),
      outputs: [out()],
    }), 'consolidation');
    expect(finding?.plain).toContain('4 coins');
  });

  it('reports a fan out', () => {
    const finding = find(tx({
      outputs: [0, 1, 2, 3, 4, 5].map((i) => out({ index: i, address: `bc1q${i}`, valueSats: 1000 + i })),
    }), 'fan-out');
    expect(finding?.plain).toContain('6 outputs');
  });

  it('reports a peel when one output dwarfs the other', () => {
    const finding = find(tx({
      outputs: [
        out({ index: 0, valueSats: 5_000_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 20_000, address: 'bc1qb' }),
      ],
    }), 'peel-chain');
    expect(finding?.evidence[2].value).toBe('250 to 1');
    // One transaction cannot tell a peel from an ordinary spend.
    expect(finding?.confidence).toBe('heuristic');
  });

  it('does not call a ratio under twenty a peel', () => {
    expect(findingIds(tx({
      outputs: [
        out({ index: 0, valueSats: 100_000, address: 'bc1qa' }),
        out({ index: 1, valueSats: 20_000, address: 'bc1qb' }),
      ],
    }))).not.toContain('peel-chain');
  });

  it('reports a single output as having no change to find', () => {
    const finding = find(tx(), 'no-change');
    expect(finding?.severity).toBe('neutral');
  });

  it('does not call a consolidation a no change transaction as well', () => {
    const ids = findingIds(tx({
      inputs: [0, 1, 2].map((i) => input({ index: i, address: `bc1q${i}` })),
      outputs: [out()],
    }));
    expect(ids).toContain('consolidation');
    expect(ids).not.toContain('no-change');
  });
});

describe('fingerprints', () => {
  it('reports mixed input types', () => {
    const finding = find(tx({
      inputs: [
        input({ index: 0, scriptType: 'v0_p2wpkh' }),
        input({ index: 1, scriptType: 'v1_p2tr', address: 'bc1pb' }),
      ],
    }), 'mixed-input-types');
    expect(finding?.evidence[0].value).toContain('v1_p2tr');
  });

  it('reports a zero lock time as a wallet detail', () => {
    const finding = find(tx({ locktime: 0 }), 'locktime-fingerprint');
    expect(finding?.plain).toContain('no lock time');
  });

  it('recognises a lock time set for anti fee sniping', () => {
    const finding = find(tx({ locktime: 899_990, confirmedHeight: 900_000 }), 'locktime-fingerprint');
    expect(finding?.technical).toContain('hundred block window');
  });

  it('does not claim anti fee sniping for a distant lock time', () => {
    const finding = find(tx({ locktime: 500_000, confirmedHeight: 900_000 }), 'locktime-fingerprint');
    expect(finding?.technical).not.toContain('hundred block window');
  });

  it('reports the replacement signal and the exact sequence used', () => {
    const finding = find(tx({ inputs: [input({ sequence: 0xfffffffd })] }), 'replacement-signal');
    expect(finding?.evidence[1].value).toBe('0xfffffffd');
  });

  it('reports the absence of a replacement signal too', () => {
    const finding = find(tx({ inputs: [input({ sequence: 0xffffffff })] }), 'replacement-signal');
    expect(finding?.title).toContain('No input signals');
    expect(finding?.falseNegatives).toContain('replace regardless');
  });

  it('says nothing about version 2, which is the crowd', () => {
    const skipped = analyze(tx({ version: 2 })).rulesSkipped
      .find((s) => s.ruleId === 'version-fingerprint');
    expect(skipped?.reason).toContain('ordinary case');
  });

  it('reports version 3 and what it opts into', () => {
    const finding = find(tx({ version: 3 }), 'version-fingerprint');
    expect(finding?.technical).toContain('stricter topology');
  });

  it('reports version 1, which is no longer the default', () => {
    expect(find(tx({ version: 1 }), 'version-fingerprint')).toBeDefined();
  });
});

describe('dust', () => {
  it('reports an output too small to be worth spending', () => {
    const finding = find(tx({
      outputs: [
        out({ index: 0, valueSats: 330, address: 'bc1qa' }),
        out({ index: 1, valueSats: 90_000, address: 'bc1qb' }),
      ],
    }), 'dust-output');
    expect(finding?.evidence[0].value).toBe('330 sat');
    expect(finding?.falsePositives).toContain('inscription');
  });

  it('ignores a zero value output, which is a different thing', () => {
    expect(findingIds(tx({
      outputs: [
        out({ index: 0, valueSats: 0, address: null }),
        out({ index: 1, valueSats: 90_000, address: 'bc1qb' }),
      ],
    }))).not.toContain('dust-output');
  });

  it('is silent above the threshold', () => {
    expect(findingIds(tx({
      outputs: [out({ valueSats: 546 })],
    }))).not.toContain('dust-output');
  });
});

describe('edge cases', () => {
  it('handles a transaction with no inputs and no outputs', () => {
    const report = analyze(tx({ inputs: [], outputs: [] }));
    expect(report.findings).toBeDefined();
    expect(report.rulesRun).toEqual(ruleIds());
  });

  it('handles an unconfirmed transaction, which has no height', () => {
    const finding = find(tx({ locktime: 899_990, confirmedHeight: null }), 'locktime-fingerprint');
    expect(finding?.technical).not.toContain('hundred block window');
    expect(finding?.evidence.some((e) => e.label === 'Confirmed at')).toBe(false);
  });
});
