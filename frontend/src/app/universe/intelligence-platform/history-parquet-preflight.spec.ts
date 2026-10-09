import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parquetMetadata } from 'hyparquet';
import { preflightHistoryFooter, preflightHistoryPages } from './history-parquet-preflight';
import { readHistoryParquet } from './history-parquet';

const fixture = (): ArrayBuffer => {
  const buffer = readFileSync(new URL('./fixtures/history-parquet/populated.parquet', import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};
function frame(footer: number[]): ArrayBuffer {
  const bytes = new Uint8Array(footer.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x31524150, true); bytes.set(footer, 4);
  view.setUint32(bytes.length - 8, footer.length, true); view.setUint32(bytes.length - 4, 0x31524150, true);
  return bytes.buffer;
}
function mutateHeader(needle: number[], value: number): ArrayBuffer {
  const file = fixture(), metadata = parquetMetadata(file);
  const column = metadata.row_groups[0].columns[0].meta_data;
  if (!column) {throw new Error('Controlled fixture has no first-column metadata.');}
  const dictionary = needle[0] === 0x4c;
  const start = Number(dictionary ? column.dictionary_page_offset : column.data_page_offset);
  const end = Number(column.data_page_offset) + (dictionary ? 0 : 21);
  const bytes = new Uint8Array(file);
  let match = -1;
  for (let i = start; i <= end - needle.length; i++) {if (needle.every((byte, index) => bytes[i + index] === byte)) {
    if (match >= 0) {throw new Error('Controlled mutation is ambiguous.');}
    match = i;
  }}
  if (match < 0) {throw new Error('Controlled fixture header shape changed.');}
  bytes[match + needle.length - 1] = value;
  return file;
}

describe('pre-allocation structural validation of retained Parquet', () => {
  it.each([
    ['huge declared struct list in five bytes', [0x19, 0xfc, 0xa0, 0x8d, 0x06]],
    ['EOF used as implicit empty struct', [0x19, 0x1c]],
    ['missing outer STOP after an empty struct', [0x19, 0x1c, 0x00]],
    ['unbounded varint groups', [0x15, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00, 0x00]],
    ['uint32 overflow', [0x15, 0xff, 0xff, 0xff, 0xff, 0x10, 0]],
    ['overlong varint', [0x15, 0x82, 0x00, 0x00]],
    ['binary length escaping the footer slice', [0x18, 0x08, 0x00]],
    ['unsupported container', [0x1b, 0x00]],
    ['duplicate field', [0x15, 0x02, 0x05, 0x02, 0x02, 0]],
    ['false STOP with nonzero field delta', [0x10]],
    ['trailing bytes after STOP', [0, 0]],
  ])('rejects %s before invoking the library metadata decoder', async (_name, bytes) => {
    const file = frame(bytes);
    expect(() => preflightHistoryFooter(file, 4, bytes.length)).toThrow('structural evidence');
    await expect(readHistoryParquet(file, 'signet')).rejects.toThrow('structural evidence');
  });
  it('rejects excessive nesting with constant bounded stack depth', () => {
    const footer = [...Array(18).fill(0x1c), ...Array(19).fill(0)];
    expect(() => preflightHistoryFooter(frame(footer), 4, footer.length)).toThrow('structural evidence');
  });
  it('rejects oversized page value count against the unchanged four-row footer before page decoding', async () => {
    const file = mutateHeader([0x5c, 0x15, 0x08], 0x7e); // Actual V2 num_values 4 -> 63, same bytes/offsets.
    const metadata = parquetMetadata(file), footerStart = file.byteLength - 8 - new DataView(file).getUint32(file.byteLength - 8, true);
    expect(metadata.num_rows).toBe(4n);
    expect(() => preflightHistoryPages(file, metadata, footerStart)).toThrow('structural evidence');
    await expect(readHistoryParquet(file, 'signet')).rejects.toThrow('structural evidence');
  });
  it('rejects dictionary cardinality larger than its row group before readPlain allocates', () => {
    const file = mutateHeader([0x4c, 0x15, 0x02], 0x7e);
    const metadata = parquetMetadata(file), footerStart = file.byteLength - 8 - new DataView(file).getUint32(file.byteLength - 8, true);
    expect(() => preflightHistoryPages(file, metadata, footerStart)).toThrow('structural evidence');
  });
  it('rejects excessive RLE run while page and footer counts remain unchanged', () => {
    const file = fixture(), metadata = parquetMetadata(file), view = new DataView(file);
    const column = metadata.row_groups[0].columns[0].meta_data;
    if (!column) {throw new Error('Controlled fixture has no column metadata.');}
    const start = Number(column.data_page_offset);
    // Independently source-bound actual first page is the 21-byte V2 header;
    // its two-byte body is zero bitwidth + one padded group of eight (ULEB 3).
    expect([...new Uint8Array(file, start + 21, 2)]).toEqual([0, 3]);
    view.setUint8(start + 22, 126); // Run count63 in same single byte, no declared page-count mutation.
    const footerStart = file.byteLength - 8 - view.getUint32(file.byteLength - 8, true);
    expect(() => preflightHistoryPages(file, metadata, footerStart)).toThrow('structural evidence');
  });
  it('rejects data-page payload encoding outside the actual writer PLAIN/dictionary contract', () => {
    const file = mutateHeader([0x15, 0x08, 0x15, 0x00, 0x15, 0x08, 0x15, 0x10], 0x0a); // V2 encoding8 -> DELTA_BINARY_PACKED5.
    const metadata = parquetMetadata(file), footerStart = file.byteLength - 8 - new DataView(file).getUint32(file.byteLength - 8, true);
    expect(() => preflightHistoryPages(file, metadata, footerStart)).toThrow('structural evidence');
  });
});
