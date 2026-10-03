import { ZcashPrivacyEvidenceError } from './zcash-source-error';
import { ownedZcashReader, ZcashPublicReader, zcashSourceReady, ZCASH_GENESIS } from './zcash-owned-reader';
export { ownedZcashReader, ZcashPublicReader } from './zcash-owned-reader';
let active = 0;
export class ZcashBlockSource {
  constructor(private reader: ZcashPublicReader = ownedZcashReader) {}
  async range(network: string, start: number, end: number, expectedPrevious?: string) {
    if (!['mainnet','testnet'].includes(network) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= 10 || end > 0xffffffff || expectedPrevious !== undefined && !/^[0-9a-f]{64}$/.test(expectedPrevious)) throw new ZcashPrivacyEvidenceError('invalid-range', 'Select mainnet/testnet and an interval of 1–10 positive block heights.', 400);
    if (active >= 2) throw new ZcashPrivacyEvidenceError('scanner-source-busy', 'The bounded public block source is busy.');
    active++;
    const controller = new AbortController();
    const operationTimer = setTimeout(() => controller.abort(), 15000);
    try {
      const deadline = Date.now() + 15000;
      const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
        const remaining = deadline - Date.now();
        if (remaining <= 0 || controller.signal.aborted) throw new ZcashPrivacyEvidenceError('source-timeout', 'Public block retrieval exceeded its 15-second budget. Request fewer blocks.');
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([work(), new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new ZcashPrivacyEvidenceError('source-timeout', 'Public block retrieval exceeded its 15-second budget. Request fewer blocks.')), remaining);})]); }
        finally { clearTimeout(timer!); }
      };
      const read = (method: string, params: unknown[]) => bounded(() => this.reader.call(method, params, controller.signal));
      const before = await read('getblockchaininfo', []);
      if (before.chain !== (network === 'mainnet' ? 'main' : 'test') || !Number.isSafeInteger(before.blocks) || before.blocks < end || !/^[0-9a-f]{64}$/.test(before.bestblockhash)
        || !await bounded(() => zcashSourceReady(this.reader, before, controller.signal))) throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'Owned source network, sync state or requested interval is unavailable.');
      if (await read('getblockhash', [0]) !== ZCASH_GENESIS[network]) throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'The owned source genesis does not match the selected Zcash network.');
      const previous = await read('getblockhash', [start - 1]);
      if (!/^[0-9a-f]{64}$/.test(previous)) throw new ZcashPrivacyEvidenceError('invalid-checkpoint', 'The owned node returned an invalid previous block hash.');
      if (expectedPrevious !== undefined && expectedPrevious !== previous) throw new ZcashPrivacyEvidenceError('reorg-detected', 'The prior scan checkpoint is no longer active. Clear the previous result and rescan an earlier interval.', 409);
      const blocks: Array<{height:number;hash:string;hex:string}> = []; let size = 0;
      for (let height = start; height <= end; height++) {
        const hash = await read('getblockhash', [height]);
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new ZcashPrivacyEvidenceError('invalid-block', 'The owned node returned an invalid block hash.');
        const hex = await read('getblock', [hash, 0]);
        if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2}){140,2000000}$/i.test(hex)) throw new ZcashPrivacyEvidenceError('invalid-block', 'The owned node returned malformed or oversized raw block bytes.');
        size += hex.length;
        if (size > 8000000) throw new ZcashPrivacyEvidenceError('interval-too-large', 'This interval exceeds 8 MB of encoded blocks. Request fewer blocks.', 413);
        blocks.push({height,hash,hex});
      }
      const after = await read('getblockchaininfo', []);
      const last = await read('getblockhash', [end]);
      if (after.chain !== before.chain || after.blocks !== before.blocks || after.bestblockhash !== before.bestblockhash || last !== blocks[blocks.length - 1].hash
        || !await bounded(() => zcashSourceReady(this.reader, after, controller.signal))) throw new ZcashPrivacyEvidenceError('source-changed', 'The owned checkpoint changed during retrieval. Retry the interval.', 409);
      return {mode:'owned-blocks', network, start_height:start, end_height:end, previous_hash:previous, blocks, source:{kind:'owned-zcash-rpc',tip_height:before.blocks,tip_hash:before.bestblockhash}, history_complete:false};
    } finally { clearTimeout(operationTimer); controller.abort(); active--; }
  }
}
export const zcashBlockSource = new ZcashBlockSource();
