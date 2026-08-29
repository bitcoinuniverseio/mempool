import { describe, expect, it } from 'vitest';
import { ChainExplorerPayload } from '@app/universe/universe.types';
import {
  classifyPayload,
  readBlock,
  readOffsetPaging,
  formatUnixTimestamp,
} from '@app/universe/multichain-explorer/multichain-view';

/**
 * The response `/api/v1/zcash/block/<hash>` actually returned from production
 * on 2026-08-29, with the transaction list trimmed to two entries and nothing
 * else changed. Written down rather than paraphrased, because every field
 * spelling here is one this reader has to get right, and a fixture in the
 * Dogecoin spelling is exactly how this page shipped as a field dump.
 */
const ZCASH_BLOCK = {
    "schemaVersion": "zcash-metaprotocols-api-v1",
    "network": "mainnet",
    "checkpoint": {
      "height": "3464717",
      "hash": "00000000001a8027b33ea8f1972569b135eea78be68a381875307549ddf178e2"
    },
    "coverage": {
      "scannedHeight": "3464717",
      "networkHeight": "3464717",
      "blocksBehindNetwork": "0",
      "nodeSynced": true,
      "verificationProgress": 1,
      "chainComplete": true
    },
    "height": "3464717",
    "hash": "00000000001a8027b33ea8f1972569b135eea78be68a381875307549ddf178e2",
    "prev_hash": "00000000006c247a8c511e915a0370a4bdbae53d4cf4b10931b2df553d186277",
    "time": "1788003830",
    "tx_count": "4",
    "transactions": {
      "total": "4",
      "offset": "0",
      "limit": "50",
      "items": [
        "e743ed36e0a10285fbfd4de57844f0f78bc929ad58b1d391fa294a540f9232bd",
        "9ff76d00ba46f460a3d2cc536c5e9e82fdabf1ad0eea45fb32a554bbab1d4d59"
      ],
      "has_more": false
    },
    "inscription_count": "0",
    "inscriptions": [],
    "envelopes": [],
    "events": [],
    "zrune_events": [],
    "chain": "zcash"
  } as unknown as ChainExplorerPayload;

describe('a Zcash block, in the shape Zcash actually sends', () => {
  it('is a block, not a record to be printed field by field', () => {
    // It was 'record' before, so the page rendered `schemaVersion`,
    // `prev_hash` and a unix timestamp in a generic two-column table.
    expect(classifyPayload(ZCASH_BLOCK)).toBe('block');
  });

  it('reads the facts the payload carries, in the words the rest of the product uses', () => {
    const block = readBlock(ZCASH_BLOCK);
    expect(block?.hash).toBe('00000000001a8027b33ea8f1972569b135eea78be68a381875307549ddf178e2');
    expect(block?.height).toEqual({ display: '3,464,717', exact: '3464717' });
    expect(block?.transactionCount).toEqual({ display: '4', exact: '4' });
    expect(block?.previousBlockHash).toBe('00000000006c247a8c511e915a0370a4bdbae53d4cf4b10931b2df553d186277');
    expect(block?.txids).toHaveLength(2);
  });

  it('reads a block time given in seconds, and keeps the seconds', () => {
    const block = readBlock(ZCASH_BLOCK);
    expect(block?.time?.display).toBe('29 Aug 2026, 11:43 UTC');
    expect(block?.time?.exact).toBe('1788003830');
  });

  it('states nothing it was not told', () => {
    // Size, difficulty, the merkle root, the confirmation count and the next
    // block are not in this payload. None of them is invented.
    const block = readBlock(ZCASH_BLOCK);
    expect(block?.sizeBytes).toBeNull();
    expect(block?.difficulty).toBeNull();
    expect(block?.merkleRoot).toBeNull();
    expect(block?.confirmations).toBeNull();
    expect(block?.nextBlockHash).toBeNull();
  });

  it('does not drop a protocol list without saying so', () => {
    const withInscriptions = {
      ...ZCASH_BLOCK,
      inscriptions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      zrune_events: [{ id: 'd' }],
    } as unknown as ChainExplorerPayload;
    expect(readBlock(withInscriptions)?.unlisted).toEqual([
      { label: 'Inscriptions', count: 3 },
      { label: 'Zrune events', count: 1 },
    ]);
    // Empty arrays are a proven none and say nothing.
    expect(readBlock(ZCASH_BLOCK)?.unlisted).toEqual([]);
  });

  it('does not read a transaction as the block it names', () => {
    const transaction = {
      schemaVersion: 'universe-transaction-v1',
      txid: 'a'.repeat(64),
      hash: 'b'.repeat(64),
      height: '3464717',
    } as unknown as ChainExplorerPayload;
    expect(classifyPayload(transaction)).toBe('transaction');
  });
});

describe('readOffsetPaging', () => {
  it('turns an offset and a limit into a page number', () => {
    expect(readOffsetPaging({ total: '120', offset: '50', limit: '50' })).toEqual({
      page: 2, totalPages: 3, previousPage: 1, nextPage: 3,
    });
  });

  it('reports no paging rather than a page number it had to round', () => {
    expect(readOffsetPaging({ total: '120', offset: '30', limit: '50' })).toBeNull();
    expect(readOffsetPaging({ total: '120', offset: '0', limit: '0' })).toBeNull();
    expect(readOffsetPaging(null)).toBeNull();
  });

  it('gives an empty list one page rather than none', () => {
    expect(readOffsetPaging({ total: '0', offset: '0', limit: '50' })?.totalPages).toBe(1);
  });
});

describe('formatUnixTimestamp', () => {
  it('refuses a value that is not a time in seconds', () => {
    // Milliseconds pass every "is it a number" check and land in the year
    // 58000, which renders perfectly well and is wrong.
    expect(formatUnixTimestamp('1788003830000')).toBeNull();
    expect(formatUnixTimestamp('0')).toBeNull();
    expect(formatUnixTimestamp('not a time')).toBeNull();
    expect(formatUnixTimestamp(null)).toBeNull();
  });
});
