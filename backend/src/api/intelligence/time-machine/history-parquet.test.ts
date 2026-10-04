import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import ts from 'typescript';
import { createHash } from 'crypto';
import type { HistoryParquetCapture } from './history-parquet';

// Exercise the actual Node 24 CommonJS production boundary (require(ESM)),
// rather than Jest's incompatible ESM VM loader. Reader is a separate package.
const runner = `
const fs = require('fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const modulePath = process.argv[1];
(async () => {
  try {
    const writer = require(modulePath);
    const buffer = await writer.writeHistoryParquet(input);
    const { parquetReadObjects, parquetMetadata } = require('hyparquet');
    const file = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const rows = await parquetReadObjects({ file });
    const metadata = parquetMetadata(file);
    console.log(JSON.stringify({ rows, bytes: buffer.length, magic: buffer.subarray(0,4).toString(), footer: buffer.subarray(-4).toString(), metadata }, (_,v) => typeof v === 'bigint' ? v.toString() : v));
  } catch (error) { console.log(JSON.stringify({ error: error.code || error.message })); }
})();`;

function capture(count = 2): HistoryParquetCapture {
  const txids = Array.from({ length: count }, (_, i) => (count - i).toString(16).padStart(64, '0'));
  const stateHash = createHash('sha256').update('b'.repeat(64) + ':' + [...txids].sort().join(',')).digest('hex');
  return { network: 'signet', txids, state: {
    state_hash: stateHash, target_timestamp_utc: '2026-10-04T00:00:00.000Z', target_block_height: 102,
    nearest_checkpoint_id: 'chk-signet-102-' + 'b'.repeat(12), checkpoint_block_hash: 'b'.repeat(64), applied_events_count: 0,
    total_transactions: count, total_vsize: 300, total_weight: 1200, total_fees_sats: Number.MAX_SAFE_INTEGER,
    median_feerate_sats_vb: 1.25, fee_distribution: [{ feerate_bucket: '1-5 sat/vB', count, total_vsize: 300 }],
    projected_blocks_count: 0, coverage_status: 'partial',
    gap_intervals: [{ start_utc: '2026-10-03T00:00:00.000Z', end_utc: '2026-10-03T00:00:01.000Z', reason: 'Observation interrupted; no invented coverage.' }],
  } };
}

describe('bounded History Parquet production serialization', () => {
  let directory: string;
  let modulePath: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'history-parquet-test-'));
    modulePath = join(directory, 'history-parquet.cjs');
    const source = readFileSync(join(__dirname, 'history-parquet.ts'), 'utf8');
    writeFileSync(modulePath, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
  });
  afterAll(() => {
    const selected = realpathSync(directory);
    if (dirname(selected) !== realpathSync(tmpdir()) || !basename(selected).startsWith('history-parquet-test-')) { throw new Error('Refuse cleanup outside the owned test directory.'); }
    rmSync(selected, { recursive: true, force: true });
  });
  interface Row { txid: string | null; membership_index: number | null; summary_json: string | null }
  interface Result { error?: string; rows: Array<Row & Record<string, unknown>>; magic: string; footer: string; metadata: { row_groups: Array<{ columns: Array<{ meta_data: { codec: string } }> }> } }
  function run(input: HistoryParquetCapture, selectedModule = modulePath, selectedNodePath = join(process.cwd(), 'node_modules')): Result {
    return JSON.parse(execFileSync(process.execPath, ['-e', runner, selectedModule], {
      input: JSON.stringify(input), timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: selectedNodePath },
    }).toString());
  }
  it('writes genuine PAR1, exact lossless summary and deterministic sorted membership, without changing capture', () => {
    const input = capture();
    const before = JSON.stringify(input);
    const result = run(input);
    expect(result.error).toBeUndefined();
    expect([result.magic, result.footer]).toEqual(['PAR1', 'PAR1']);
    expect(result.rows).toHaveLength(3);
    expect(JSON.parse(String(result.rows[0].summary_json))).toEqual(input.state);
    expect(result.rows[0]).toMatchObject({ schema_version: 'universe-history-parquet-v1', network: 'signet', row_kind: 'snapshot', state_hash: input.state.state_hash, membership_index: null, txid: null });
    expect(result.rows.slice(1).map(row => [row.txid, row.membership_index, row.summary_json])).toEqual([...input.txids].sort().map((id, i) => [id, i, null]));
    expect(result.metadata.row_groups.every(group => group.columns.every(column => column.meta_data.codec === 'UNCOMPRESSED'))).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('represents valid empty membership by one snapshot row with nullable membership fields', () => {
    const input = capture(0);
    Object.assign(input.state, { total_vsize: 0, total_weight: 0, total_fees_sats: 0, median_feerate_sats_vb: 0 });
    input.state.fee_distribution = [];
    const result = run(input);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].txid).toBeNull();
    expect(JSON.parse(String(result.rows[0].summary_json))).toEqual(input.state);
  });
  it.each([
    ['unsafe integer quantity', (value: HistoryParquetCapture): void => { value.state.total_fees_sats = Number.MAX_SAFE_INTEGER + 1; }],
    ['fractional quantity', (value: HistoryParquetCapture): void => { value.state.total_weight = 0.5; }],
    ['negative quantity', (value: HistoryParquetCapture): void => { value.state.total_vsize = -1; }],
    ['null quantity', (value: HistoryParquetCapture): void => { Object.assign(value.state, {total_fees_sats: null}); }],
    ['missing summary field', (value: HistoryParquetCapture): void => { Reflect.deleteProperty(value.state, 'gap_intervals'); }],
    ['unknown summary field', (value: HistoryParquetCapture): void => { Object.assign(value.state, { provider_estimate: 0 }); }],
    ['unknown capture field', (value: HistoryParquetCapture): void => { Object.assign(value, { synthetic: true }); }],
    ['foreign network', (value: HistoryParquetCapture): void => { value.network = 'not-a-network'; }],
    ['duplicate membership', (value: HistoryParquetCapture): void => { value.txids[1] = value.txids[0]; }],
    ['malformed membership', (value: HistoryParquetCapture): void => { value.txids[1] = 'not-a-txid'; }],
    ['uppercase membership', (value: HistoryParquetCapture): void => { value.txids[1] = 'F'.repeat(64); }],
    ['count mismatch', (value: HistoryParquetCapture): void => { value.state.total_transactions = 3; }],
    ['same-count membership substitution', (value: HistoryParquetCapture): void => { value.txids[1] = 'c'.repeat(64); }],
    ['coerced hash array', (value: HistoryParquetCapture): void => { Object.assign(value.state, {state_hash:[value.state.state_hash]}); }],
    ['coerced checkpoint hash array', (value: HistoryParquetCapture): void => { Object.assign(value.state, {checkpoint_block_hash:[value.state.checkpoint_block_hash]}); }],
    ['wrong checkpoint network', (value: HistoryParquetCapture): void => { value.state.nearest_checkpoint_id = 'chk-mainnet-102-' + 'b'.repeat(12); }],
    ['malformed checkpoint', (value: HistoryParquetCapture): void => { value.state.checkpoint_block_hash = 'z'.repeat(64); }],
    ['impossible calendar date', (value: HistoryParquetCapture): void => { value.state.target_timestamp_utc = '2026-02-30T00:00:00.000Z'; }],
    ['reversed gap', (value: HistoryParquetCapture): void => { value.state.gap_intervals[0].end_utc = '2026-10-02T00:00:00.000Z'; }],
    ['invented nested field', (value: HistoryParquetCapture): void => { Object.assign(value.state.fee_distribution[0], {invented:1}); }],
  ])('rejects %s before emitting a binary', (_name, change) => {
    const input = capture();
    change(input);
    expect(run(input)).toEqual({ error: 'history-parquet-invalid-capture' });
  });
  it('rejects membership beyond the disclosed bound before per-row encoding', () => {
    const input = capture(0);
    input.txids = Array(500_001).fill('0'.repeat(64));
    input.state.total_transactions = input.txids.length;
    expect(run(input)).toEqual({ error: 'history-parquet-limit' });
  });
  it('rejects summary bytes beyond the disclosed bound without truncation', () => {
    const input = capture();
    input.state.gap_intervals[0].reason = 'x'.repeat(2 * 1024 * 1024);
    expect(run(input)).toEqual({ error: 'history-parquet-limit' });
  });
  it('preserves explicitly selected configured regtest, without relabeling Signet', () => {
    const input = capture(0);
    input.network = 'regtest'; input.state.nearest_checkpoint_id = 'chk-regtest-102-' + 'b'.repeat(12);
    expect(run(input).rows[0].network).toBe('regtest');
  });
  it('returns unavailable when the pinned production dependency cannot be loaded', () => {
    expect(run(capture(), modulePath, directory)).toEqual({error:'history-parquet-unavailable'});
  });
  it('terminates a stalled encoding worker at the unchanged real ten-second fence', () => {
    const stalled = join(directory, 'stalled-history-parquet.cjs');
    // Explicit failure injection AFTER the exact production module: the worker
    // cannot deliver its encoded result while its event loop is stalled.
    writeFileSync(stalled, readFileSync(modulePath, 'utf8') + '\nif (!require("worker_threads").isMainThread) { while (true) {} }');
    const start = Date.now();
    expect(run(capture(), stalled)).toEqual({error:'history-parquet-unavailable'});
    expect(Date.now() - start).toBeGreaterThanOrEqual(9_900);
    expect(Date.now() - start).toBeLessThan(13_000);
  }, 15_000);
});
