import { describe, expect, it } from 'vitest';

import { MAXIMUM_BATCH, batchCsv, batchJson, batchRow, splitBatch } from './command-batch';
import { CommandCandidate } from './command-candidates';

describe('splitBatch', () => {
  it('trims lines and drops blanks', () => {
    const { lines, dropped } = splitBatch('  a \n\n b\nc ');
    expect(lines).toEqual(['a', 'b', 'c']);
    expect(dropped).toBe(0);
  });

  it('states how much was cut when the bound is reached', () => {
    const lines = Array.from({ length: MAXIMUM_BATCH + 7 }, (_, i) => `value-${i}`);
    const result = splitBatch(lines.join('\n'));
    expect(result.lines).toHaveLength(MAXIMUM_BATCH);
    expect(result.dropped).toBe(7);
  });
});

describe('batchRow', () => {
  const candidate: CommandCandidate = {
    kind: 'address', chain: 'bitcoin', label: 'x', path: '/address/x', source: 'pattern', exact: true,
  };

  it('keeps candidates when there are any', () => {
    const row = batchRow('x', [candidate]);
    expect(row.candidates).toEqual([candidate]);
    expect(row.note).toBeNull();
  });

  it('says plainly when nothing was recognized', () => {
    const row = batchRow('mystery', []);
    expect(row.candidates).toEqual([]);
    expect(row.note).toBeTruthy();
  });
});

describe('exports', () => {
  const candidate: CommandCandidate = {
    kind: 'address', chain: 'bitcoin', label: 'bc1q', path: '/address/bc1q', source: 'pattern', exact: true,
  };

  it('writes one CSV row per candidate, and one for an unknown value', () => {
    const csv = batchCsv([
      { value: 'v1', candidates: [candidate], note: null },
      { value: 'v2', candidates: [], note: 'Nothing here could identify it.' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('value,kind,chain,path,source,exact');
    expect(lines[1]).toBe('v1,address,bitcoin,/address/bc1q,pattern,true');
    expect(lines[2]).toBe('v2,,,,,false');
  });

  it('escapes a comma in a value', () => {
    const csv = batchCsv([{ value: 'a,b', candidates: [], note: 'x' }]);
    expect(csv).toContain('"a,b"');
  });

  it('carries the rows in JSON under a version', () => {
    const parsed = JSON.parse(batchJson([{ value: 'v1', candidates: [], note: 'x' }]));
    expect(parsed.schemaVersion).toBe('universe-command-batch-v1');
    expect(parsed.rows).toHaveLength(1);
  });
});
