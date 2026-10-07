import type { parquetMetadataAsync } from 'hyparquet';

type Metadata = Awaited<ReturnType<typeof parquetMetadataAsync>>;
type Struct = Record<number, unknown>;
const invalid = (): never => { throw new Error('Parquet structural evidence exceeds its bounded export contract.'); };

/** Compact Thrift structural validation only. No column values are decoded. */
class CompactCursor {
  offset = 0;
  private nodes = 0;
  constructor(private readonly view: DataView, private readonly maximumNodes: number, private readonly maximumDepth: number, private readonly maximumList: number) {}
  private need(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.view.byteLength - this.offset) {invalid();}
  }
  byte(): number { this.need(1); return this.view.getUint8(this.offset++); }
  unsigned(bits: 16 | 32 | 64): bigint {
    let value = 0n;
    const maximumBytes = Math.ceil(bits / 7);
    for (let i = 0; i < maximumBytes; i++) {
      const byte = this.byte();
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) {
        if (value >= 1n << BigInt(bits) || i > 0 && byte === 0) {invalid();}
        return value;
      }
    }
    return invalid();
  }
  private zigzag(bits: 16 | 32 | 64): number | bigint {
    const value = this.unsigned(bits), signed = value >> 1n ^ -(value & 1n);
    return bits === 64 ? signed : Number(signed);
  }
  struct(collect = false, depth = 0): Struct {
    if (depth > this.maximumDepth || ++this.nodes > this.maximumNodes) {invalid();}
    const result: Struct = {}, seen = new Set<number>();
    let field = 0;
    for (;;) {
      const header = this.byte(); // EOF is never an implicit empty STRUCT.
      if (header === 0) {return result;}
      const type = header & 15, delta = header >> 4;
      if (!type) {invalid();}
      field = delta ? field + delta : Number(this.zigzag(16));
      if (field < 1 || field > 32767 || seen.has(field)) {invalid();}
      seen.add(field);
      const value = this.element(type, collect, depth + 1);
      if (collect) {result[field] = value;}
    }
  }
  private element(type: number, collect: boolean, depth: number): unknown {
    if (depth > this.maximumDepth || ++this.nodes > this.maximumNodes) {invalid();}
    switch (type) {
      case 1: return true;
      case 2: return false;
      case 3: return this.byte();
      case 4: return this.zigzag(16);
      case 5: return this.zigzag(32);
      case 6: return this.zigzag(64);
      case 7: this.need(8); this.offset += 8; return undefined;
      case 8: {
        const length = Number(this.unsigned(32)); this.need(length);
        const value = collect ? new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length) : undefined;
        this.offset += length; return value;
      }
      case 9: {
        const header = this.byte(), itemType = header & 15;
        const count = header >> 4 === 15 ? Number(this.unsigned(32)) : header >> 4;
        if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 12].includes(itemType) || count > this.maximumList || count > this.view.byteLength - this.offset || count + this.nodes > this.maximumNodes) {invalid();}
        const values: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const before = this.offset;
          let value: unknown;
          if (itemType === 1 || itemType === 2) {
            if (++this.nodes > this.maximumNodes) {invalid();}
            const boolean = this.byte(); if (boolean !== 1 && boolean !== 2) {invalid();}
            value = boolean === 1;
          } else {value = this.element(itemType, collect, depth + 1);}
          if (this.offset <= before) {invalid();}
          if (collect) {values.push(value);}
        }
        return collect ? values : undefined;
      }
      case 12: return this.struct(collect, depth);
      default: return invalid(); // Same unsupported MAP/SET/UUID scope as pinned reader.
    }
  }
}

export function preflightHistoryFooter(file: ArrayBuffer, start: number, length: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 4 || length < 1 || length > 2 * 1024 * 1024 || start + length > file.byteLength - 8) {invalid();}
  const cursor = new CompactCursor(new DataView(file, start, length), 65536, 16, 4096);
  cursor.struct();
  if (cursor.offset !== length) {invalid();}
}

function number(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {return invalid();}
  return value;
}
function struct(value: unknown): Struct {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {return invalid();}
  return value as Struct;
}

/** Scan bounded RLE/bitpack declarations before the library can extend arrays. */
function hybrid(view: DataView, start: number, end: number, width: number, count: number, maximumValue: number): number {
  if (start < 0 || end < start || end > view.byteLength || width < 0 || width > 14) {invalid();}
  const cursor = new CompactCursor(new DataView(view.buffer, view.byteOffset + start, end - start), 1, 1, 1);
  let seen = 0, ones = 0;
  while (seen < count) {
    const header = Number(cursor.unsigned(32));
    if (!header) {invalid();}
    if (header & 1) {
      const run = (header >>> 1) * 8;
      // At most seven final padding values; never an unbounded masked loop.
      if (run > count - seen + 7 || run < 1) {invalid();}
      const bytes = Math.ceil(run * width / 8), dataStart = cursor.offset;
      for (let i = 0; i < bytes; i++) {cursor.byte();}
      for (let i = 0; i < Math.min(run, count - seen); i++) {
        let value = 0;
        for (let bit = 0; bit < width; bit++) {
          const position = i * width + bit;
          value |= (view.getUint8(start + dataStart + (position >> 3)) >> (position & 7) & 1) << bit;
        }
        if (value > maximumValue) {invalid();}
        if (value === 1) {ones++;}
      }
      seen += Math.min(run, count - seen);
    } else {
      const run = header >>> 1;
      if (run < 1 || run > count - seen) {invalid();}
      let value = 0;
      for (let i = 0; i < Math.ceil(width / 8); i++) {value |= cursor.byte() << (8 * i);}
      if (value > maximumValue) {invalid();}
      if (value === 1) {ones += run;}
      seen += run;
    }
  }
  if (cursor.offset !== end - start) {invalid();}
  return ones;
}

function plain(view: DataView, start: number, end: number, count: number, type: string): void {
  if (type === 'INT32') { if (end - start !== count * 4) {invalid();} return; }
  if (type !== 'BYTE_ARRAY') {invalid();}
  let offset = start;
  for (let i = 0; i < count; i++) {
    if (offset + 4 > end) {invalid();}
    const length = view.getUint32(offset, true); offset += 4;
    if (length > end - offset) {invalid();}
    offset += length;
  }
  if (offset !== end) {invalid();}
}

/** Validate headers and actual producer encodings before any page-value allocation. */
export function preflightHistoryPages(file: ArrayBuffer, metadata: Metadata, footerStart: number): void {
  const view = new DataView(file);
  for (const group of metadata.row_groups) {
    const rows = Number(group.num_rows);
    for (let columnIndex = 0; columnIndex < group.columns.length; columnIndex++) {
      const column = group.columns[columnIndex].meta_data;
      if (!column) {invalid();}
      const start = Number(column.dictionary_page_offset ?? column.data_page_offset), end = start + Number(column.total_compressed_size);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 4 || end > footerStart || end <= start) {invalid();}
      let offset = start, values = 0, dictionaryCount = 0, pages = 0;
      while (offset < end) {
        if (++pages > rows + 1) {invalid();}
        const cursor = new CompactCursor(new DataView(file, offset, Math.min(end - offset, 65536)), 512, 8, 64);
        const header = cursor.struct(true);
        const kind = number(header[1], 3), compressed = number(header[3], end - offset - cursor.offset);
        if (number(header[2], 64 * 1024 * 1024) !== compressed || compressed < 1) {invalid();}
        const body = offset + cursor.offset, bodyEnd = body + compressed;
        if (kind === 2) {
          if (column.dictionary_page_offset === undefined || offset !== start || dictionaryCount || values || header[5] || header[8]) {invalid();}
          const dictionary = struct(header[7]);
          dictionaryCount = number(dictionary[1], rows);
          if (!dictionaryCount || number(dictionary[2], 8) !== 0) {invalid();}
          plain(view, body, bodyEnd, dictionaryCount, column.type);
        } else if (kind === 3 || kind === 0) {
          if (!values && offset !== Number(column.data_page_offset)) {invalid();}
          const page = struct(kind === 3 ? header[8] : header[5]);
          const count = number(page[1], rows - values);
          if (!count || header[7] || (kind === 3 ? header[5] : header[8])) {invalid();}
          let dataStart = body, nonNull = count, encoding: number;
          if (kind === 3) {
            if (number(page[3], rows) !== count || number(page[6], compressed) !== 0 || page[7] !== undefined && typeof page[7] !== 'boolean') {invalid();}
            const nulls = number(page[2], count), definitionBytes = number(page[5], compressed);
            if (columnIndex < 4) { if (nulls || definitionBytes) {invalid();} }
            else { if (hybrid(view, body, body + definitionBytes, 1, count, 1) !== count - nulls) {invalid();} }
            nonNull = count - nulls; dataStart += definitionBytes; encoding = number(page[4], 8);
          } else {
            if (number(page[3], 8) !== 3 || number(page[4], 8) !== 3) {invalid();}
            if (columnIndex >= 4) {
              if (dataStart + 4 > bodyEnd) {invalid();}
              const definitionBytes = view.getUint32(dataStart, true); dataStart += 4;
              if (definitionBytes > bodyEnd - dataStart) {invalid();}
              nonNull = hybrid(view, dataStart, dataStart + definitionBytes, 1, count, 1); dataStart += definitionBytes;
            }
            encoding = number(page[2], 8);
          }
          if (encoding === 0) {plain(view, dataStart, bodyEnd, nonNull, column.type);}
          else if (encoding === 8 && dictionaryCount) {
            if (dataStart >= bodyEnd) {invalid();}
            const width = view.getUint8(dataStart++);
            hybrid(view, dataStart, bodyEnd, width, nonNull, dictionaryCount - 1);
          } else {invalid();} // Actual pinned writer emits only PLAIN and RLE_DICTIONARY.
          values += count;
        } else {invalid();}
        offset = bodyEnd;
      }
      if (offset !== end || values !== rows) {invalid();}
    }
  }
}
