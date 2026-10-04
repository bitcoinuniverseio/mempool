import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { preflightHistoryFooter, preflightHistoryPages } from './history-parquet-preflight';

export const HISTORY_PARQUET_MAX_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 500001;
const names = ['schema_version', 'network', 'row_kind', 'state_hash', 'membership_index', 'txid', 'summary_json'];

/** Decode only the bounded, uncompressed snapshot/membership export contract. Runs in a worker. */
export async function readHistoryParquet(file: ArrayBuffer, network: string): Promise<{ format: 'parquet'; state: any; txids: string[] }> {
  const reject = (): never => { throw new Error('Parquet export contains invalid or excessive retained evidence.'); };
  if (!(file instanceof ArrayBuffer) || file.byteLength < 12 || file.byteLength > HISTORY_PARQUET_MAX_BYTES) { reject(); }
  const view = new DataView(file), magic = (at: number) => view.getUint32(at, true) === 0x31524150;
  if (!magic(0) || !magic(file.byteLength - 4)) { reject(); }
  const footerLength = view.getUint32(file.byteLength - 8, true), footerStart = file.byteLength - 8 - footerLength;
  if (footerLength < 1 || footerLength > 2 * 1024 * 1024 || footerStart < 4) { reject(); }
  preflightHistoryFooter(file, footerStart, footerLength);
  const metadata = await parquetMetadataAsync(file, { geoparquet: false });
  if (metadata.num_rows < 1n || metadata.num_rows > BigInt(MAX_ROWS) || metadata.schema.length !== 8 || metadata.schema[0].num_children !== 7 || metadata.schema[0].type !== undefined || metadata.row_groups.length < 1 || metadata.row_groups.length > 51) { reject(); }
  for (let i = 0; i < names.length; i++) {
    const column = metadata.schema[i + 1];
    if (column.name !== names[i] || column.num_children !== undefined || column.type !== (i === 4 ? 'INT32' : 'BYTE_ARRAY') || column.repetition_type !== (i < 4 ? 'REQUIRED' : 'OPTIONAL') || (i !== 4 && column.converted_type !== 'UTF8' && column.logical_type?.type !== 'STRING')) { reject(); }
  }
  let rows = 0n, bytes = 0n;
  for (const group of metadata.row_groups) {
    if (group.num_rows < 1n || group.num_rows > 10000n || group.columns.length !== 7 || group.total_byte_size < 0n || group.total_byte_size > BigInt(HISTORY_PARQUET_MAX_BYTES)) { reject(); }
    rows += group.num_rows;
    for (let i = 0; i < group.columns.length; i++) {
      const chunk = group.columns[i], column = chunk.meta_data;
      if (chunk.file_path != null || chunk.crypto_metadata != null || chunk.encrypted_column_metadata != null || !column || column.codec !== 'UNCOMPRESSED' || column.path_in_schema.length !== 1 || column.path_in_schema[0] !== names[i] || column.type !== metadata.schema[i + 1].type || column.num_values !== group.num_rows || column.total_compressed_size < 0n || column.total_compressed_size !== column.total_uncompressed_size || column.data_page_offset < 4n) { reject(); }
      const start = column.dictionary_page_offset ?? column.data_page_offset;
      if (start < 4n || start + column.total_compressed_size > BigInt(footerStart)) { reject(); }
      bytes += column.total_uncompressed_size;
    }
  }
  if (rows !== metadata.num_rows || bytes > BigInt(HISTORY_PARQUET_MAX_BYTES)) { reject(); }
  preflightHistoryPages(file, metadata, footerStart);
  const decoded = await parquetReadObjects({ file, metadata, rowEnd: Number(metadata.num_rows), geoparquet: false });
  if (decoded.length !== Number(metadata.num_rows)) { reject(); }
  const snapshot = decoded[0];
  if (!snapshot || snapshot.schema_version !== 'universe-history-parquet-v1' || snapshot.network !== network || snapshot.row_kind !== 'snapshot' || snapshot.membership_index !== null || snapshot.txid !== null || typeof snapshot.summary_json !== 'string' || new TextEncoder().encode(snapshot.summary_json).byteLength > 2 * 1024 * 1024) { reject(); }
  const state = JSON.parse(snapshot.summary_json), txids: string[] = [];
  if (!state || state.state_hash !== snapshot.state_hash || !/^[0-9a-f]{64}$/.test(state.state_hash) || !Number.isSafeInteger(state.total_transactions) || state.total_transactions !== decoded.length - 1) { reject(); }
  for (let i = 1; i < decoded.length; i++) {
    const row = decoded[i];
    if (row.schema_version !== snapshot.schema_version || row.network !== network || row.row_kind !== 'membership' || row.state_hash !== snapshot.state_hash || row.membership_index !== i - 1 || row.summary_json !== null || typeof row.txid !== 'string' || !/^[0-9a-f]{64}$/.test(row.txid) || i > 1 && row.txid <= txids[i - 2]) { reject(); }
    txids.push(row.txid);
  }
  return { format: 'parquet', state, txids };
}
