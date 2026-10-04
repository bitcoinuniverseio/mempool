import type { ReplayStateSummary } from './time-machine.service';
import { isMainThread, parentPort, Worker, workerData } from 'worker_threads';
import { createHash } from 'crypto';

export const HISTORY_PARQUET_SCHEMA = 'universe-history-parquet-v1';
export const HISTORY_PARQUET_LIMITS = Object.freeze({ membership: 500_000, summaryBytes: 2 * 1024 * 1024, outputBytes: 64 * 1024 * 1024, workerMilliseconds: 10_000, workerHeapMiB: 256 });
export type HistoryParquetErrorCode = 'history-parquet-invalid-capture' | 'history-parquet-limit' | 'history-parquet-unavailable';
export class HistoryParquetError extends Error {
  constructor(public readonly code: HistoryParquetErrorCode) { super(code); }
}
export interface HistoryParquetCapture { network: string; state: ReplayStateSummary; txids: string[] }

const FIELDS = ['state_hash', 'target_timestamp_utc', 'target_block_height', 'nearest_checkpoint_id', 'checkpoint_block_hash', 'applied_events_count', 'total_transactions', 'total_vsize', 'total_weight', 'total_fees_sats', 'median_feerate_sats_vb', 'fee_distribution', 'projected_blocks_count', 'coverage_status', 'gap_intervals'];
const INTEGERS = ['target_block_height', 'applied_events_count', 'total_transactions', 'total_vsize', 'total_weight', 'total_fees_sats', 'projected_blocks_count'];
const HASH = /^[0-9a-f]{64}$/;
const fail = (): never => { throw new HistoryParquetError('history-parquet-invalid-capture'); };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, fields: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === fields.length && fields.every(field => Object.prototype.hasOwnProperty.call(value, field));
}
function integer(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function utc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

interface ValidatedCapture { network: string; stateHash: string; summary: string; sorted: string[] }
function validateCapture(capture: HistoryParquetCapture): ValidatedCapture {
  if (!exact(capture, ['network', 'state', 'txids']) || typeof capture.network !== 'string' || !['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'liquid', 'liquidtestnet'].includes(capture.network)) {fail();}
  const { state, txids } = capture;
  if (!exact(state, FIELDS) || !Array.isArray(txids)) {fail();}
  if (txids.length > HISTORY_PARQUET_LIMITS.membership) {throw new HistoryParquetError('history-parquet-limit');}
  if (typeof state.state_hash !== 'string' || typeof state.checkpoint_block_hash !== 'string' || !HASH.test(state.state_hash) || !HASH.test(state.checkpoint_block_hash) || !utc(state.target_timestamp_utc) || typeof state.nearest_checkpoint_id !== 'string' || state.nearest_checkpoint_id.length > 128 || !new RegExp(`^chk-${capture.network}-[0-9]+-${state.checkpoint_block_hash.slice(0, 12)}$`).test(state.nearest_checkpoint_id)) {fail();}
  if (INTEGERS.some(field => !integer(state[field])) || state.total_transactions !== txids.length || !Number.isFinite(state.median_feerate_sats_vb) || state.median_feerate_sats_vb < 0 || !['complete', 'partial', 'gap_detected'].includes(state.coverage_status)) {fail();}
  if (!Array.isArray(state.fee_distribution) || !Array.isArray(state.gap_intervals)) {fail();}
  // Even the shortest serialized elements need separators and content; reject
  // impossible array sizes before iterating or constructing a JSON string.
  if (state.fee_distribution.length + state.gap_intervals.length > HISTORY_PARQUET_LIMITS.summaryBytes / 2) {throw new HistoryParquetError('history-parquet-limit');}
  let nestedBytes = 0;
  for (const bucket of state.fee_distribution) {
    if (!exact(bucket, ['feerate_bucket', 'count', 'total_vsize']) || typeof bucket.feerate_bucket !== 'string' || !bucket.feerate_bucket || !integer(bucket.count) || !integer(bucket.total_vsize)) {fail();}
    if (Buffer.byteLength(bucket.feerate_bucket, 'utf8') > HISTORY_PARQUET_LIMITS.summaryBytes) {throw new HistoryParquetError('history-parquet-limit');}
    nestedBytes += Buffer.byteLength(JSON.stringify(bucket), 'utf8');
    if (nestedBytes > HISTORY_PARQUET_LIMITS.summaryBytes) {throw new HistoryParquetError('history-parquet-limit');}
  }
  for (const gap of state.gap_intervals) {
    if (!exact(gap, ['start_utc', 'end_utc', 'reason']) || !utc(gap.start_utc) || !utc(gap.end_utc) || gap.start_utc > gap.end_utc || typeof gap.reason !== 'string' || !gap.reason) {fail();}
    if (Buffer.byteLength(gap.reason, 'utf8') > HISTORY_PARQUET_LIMITS.summaryBytes) {throw new HistoryParquetError('history-parquet-limit');}
    nestedBytes += Buffer.byteLength(JSON.stringify(gap), 'utf8');
    if (nestedBytes > HISTORY_PARQUET_LIMITS.summaryBytes) {throw new HistoryParquetError('history-parquet-limit');}
  }
  for (const txid of txids) {if (typeof txid !== 'string' || !HASH.test(txid)) {fail();}}
  const sorted = [...txids].sort();
  for (let i = 1; i < sorted.length; i++) {if (sorted[i] === sorted[i - 1]) {fail();}}
  const membershipHash = createHash('sha256').update(state.checkpoint_block_hash + ':').update(sorted.join(',')).digest('hex');
  if (membershipHash !== state.state_hash) {fail();}
  const summary = JSON.stringify(state);
  if (Buffer.byteLength(summary, 'utf8') > HISTORY_PARQUET_LIMITS.summaryBytes) {throw new HistoryParquetError('history-parquet-limit');}
  return { network: capture.network, stateHash: state.state_hash, summary, sorted };
}

async function encodeCapture(capture: ValidatedCapture): Promise<ArrayBuffer> {
  const { sorted, summary } = capture;
  // Native Node 24 require(ESM) is intentional: TypeScript's CommonJS output must
  // load the pinned production package, not rewrite import() through Jest's VM.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node24 native require(ESM), production CommonJS boundary.
    const { ByteWriter, parquetWrite } = require('hyparquet-writer') as typeof import('hyparquet-writer');
    class BoundedWriter extends ByteWriter {
      ensure(size: number): void {
        if (!Number.isSafeInteger(size) || size < 0 || this.index + size > HISTORY_PARQUET_LIMITS.outputBytes) {throw new HistoryParquetError('history-parquet-limit');}
        if (this.index + size > this.buffer.byteLength) {
          const buffer = new ArrayBuffer(Math.min(HISTORY_PARQUET_LIMITS.outputBytes, Math.max(this.buffer.byteLength * 2, this.index + size)));
          new Uint8Array(buffer).set(new Uint8Array(this.buffer));
          this.buffer = buffer;
          this.view = new DataView(buffer);
        }
      }
    }
    const writer = new BoundedWriter();
    const rows = sorted.length + 1;
    await parquetWrite({ writer, codec: 'UNCOMPRESSED', rowGroupSize: 10_000, dictionarySize: 64 * 1024, columnData: [
      { name: 'schema_version', type: 'STRING', data: Array(rows).fill(HISTORY_PARQUET_SCHEMA), nullable: false },
      { name: 'network', type: 'STRING', data: Array(rows).fill(capture.network), nullable: false },
      { name: 'row_kind', type: 'STRING', data: ['snapshot', ...sorted.map(() => 'membership')], nullable: false },
      { name: 'state_hash', type: 'STRING', data: Array(rows).fill(capture.stateHash), nullable: false },
      { name: 'membership_index', type: 'INT32', data: [null, ...sorted.map((_, i) => i)], nullable: true },
      { name: 'txid', type: 'STRING', data: [null, ...sorted], nullable: true },
      { name: 'summary_json', type: 'STRING', data: [summary, ...sorted.map(() => null)], nullable: true },
    ] });
    return writer.getBuffer();
  } catch (error) {
    if (error instanceof HistoryParquetError) {throw error;}
    throw new HistoryParquetError('history-parquet-unavailable');
  }
}

/** Pure bounded serialization of an immutable capture in a disposable CPU worker. */
export async function writeHistoryParquet(capture: HistoryParquetCapture): Promise<Buffer> {
  const validated = validateCapture(capture);
  return new Promise<Buffer>((resolve, reject) => {
    let worker: Worker;
    let finished = false;
    /** @asyncSafe */
    const finish = async (error?: HistoryParquetError, output?: ArrayBuffer): Promise<void> => {
      if (finished) {return;}
      finished = true;
      clearTimeout(timer);
      try {
        if (worker) {await worker.terminate();}
      } catch {
        reject(new HistoryParquetError('history-parquet-unavailable'));
        return;
      }
      if (error || !output) {reject(error || new HistoryParquetError('history-parquet-unavailable'));}
      else {resolve(Buffer.from(output));}
    };
    const timer = setTimeout(() => { void finish(new HistoryParquetError('history-parquet-unavailable')); }, HISTORY_PARQUET_LIMITS.workerMilliseconds);
    try {
      worker = new Worker(__filename, { workerData: { task: HISTORY_PARQUET_SCHEMA, capture: validated }, resourceLimits: { maxOldGenerationSizeMb: HISTORY_PARQUET_LIMITS.workerHeapMiB, stackSizeMb: 4 } });
      worker.once('message', (message: { output?: ArrayBuffer; error?: string }) => {
        if (message.output instanceof ArrayBuffer && message.output.byteLength <= HISTORY_PARQUET_LIMITS.outputBytes) {void finish(undefined, message.output);}
        else {void finish(new HistoryParquetError(message.error === 'history-parquet-limit' ? message.error : 'history-parquet-unavailable'));}
      });
      worker.once('error', () => { void finish(new HistoryParquetError('history-parquet-unavailable')); });
      worker.once('exit', () => { if (!finished) {void finish(new HistoryParquetError('history-parquet-unavailable'));} });
    } catch {
      void finish(new HistoryParquetError('history-parquet-unavailable'));
    }
  });
}

/** @asyncSafe */
async function runWorker(): Promise<void> {
  const port = parentPort;
  if (!port) {return;}
    try {
      const output = await encodeCapture(workerData.capture);
      port.postMessage({ output }, [output]);
    } catch (error) {
      try { port.postMessage({ error: error instanceof HistoryParquetError ? error.code : 'history-parquet-unavailable' }); }
      catch { port.close(); }
    }
}
if (!isMainThread && workerData?.task === HISTORY_PARQUET_SCHEMA && parentPort) {
  void runWorker();
}
