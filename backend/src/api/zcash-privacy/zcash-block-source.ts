import axios from 'axios';
import { readFileSync } from 'fs';
import { ZcashPrivacyEvidenceError } from './zcash-privacy.service';

export interface ZcashPublicReader { call(method: string, params: unknown[]): Promise<any>; }
/** Operator-configured source only. Browser requests cannot select an origin or RPC method. */
export const ownedZcashReader: ZcashPublicReader = {
  async call(method, params) {
    const origin = process.env.UNIVERSE_ZCASH_RPC_ORIGIN;
    if (!origin) throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', 'An owned Zcash RPC source is not configured.');
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid source');
      const cookiePath = process.env.UNIVERSE_ZCASH_RPC_COOKIE_FILE;
      const credentials = cookiePath ? readFileSync(cookiePath, 'utf8').trim() : `${process.env.UNIVERSE_ZCASH_RPC_USER || ''}:${process.env.UNIVERSE_ZCASH_RPC_PASSWORD || ''}`;
      const response = await axios.post(url.toString(), {jsonrpc:'1.0',id:'public-block-scan',method,params}, {
        headers: {Authorization: 'Basic ' + Buffer.from(credentials).toString('base64')}, timeout: 5000,
        maxContentLength: 4100000, maxBodyLength: 1000, maxRedirects: 0, proxy: false,
      });
      if (response.data?.error || !Object.prototype.hasOwnProperty.call(response.data || {}, 'result')) throw Error('Invalid RPC response');
      return response.data.result;
    } catch { throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', 'The owned Zcash node could not return public block evidence.'); }
  },
};
let active = 0;
export class ZcashBlockSource {
  constructor(private reader: ZcashPublicReader = ownedZcashReader) {}
  async range(network: string, start: number, end: number, expectedPrevious?: string) {
    if (!['mainnet','testnet'].includes(network) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start >= 10 || end > 0xffffffff || expectedPrevious !== undefined && !/^[0-9a-f]{64}$/.test(expectedPrevious)) throw new ZcashPrivacyEvidenceError('invalid-range', 'Select mainnet/testnet and an interval of 1–10 positive block heights.', 400);
    if (active >= 2) throw new ZcashPrivacyEvidenceError('scanner-source-busy', 'The bounded public block source is busy.');
    active++;
    try {
      const deadline = Date.now() + 15000;
      const read = async (method: string, params: unknown[]) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ZcashPrivacyEvidenceError('source-timeout', 'Public block retrieval exceeded its 15-second budget. Request fewer blocks.');
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([this.reader.call(method, params), new Promise((_, reject) => {timer = setTimeout(() => reject(new ZcashPrivacyEvidenceError('source-timeout', 'Public block retrieval exceeded its 15-second budget. Request fewer blocks.')), remaining);})]); }
        finally { clearTimeout(timer!); }
      };
      const before = await read('getblockchaininfo', []);
      if (before.chain !== (network === 'mainnet' ? 'main' : 'test') || before.initial_block_download_complete !== true || !Number.isSafeInteger(before.blocks) || before.blocks < end || !/^[0-9a-f]{64}$/.test(before.bestblockhash)) throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'Owned source network, sync state or requested interval is unavailable.');
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
      if (after.chain !== before.chain || after.blocks !== before.blocks || after.bestblockhash !== before.bestblockhash || last !== blocks[blocks.length - 1].hash) throw new ZcashPrivacyEvidenceError('source-changed', 'The owned checkpoint changed during retrieval. Retry the interval.', 409);
      return {mode:'owned-blocks', network, start_height:start, end_height:end, previous_hash:previous, blocks, source:{kind:'owned-zcash-rpc',tip_height:before.blocks,tip_hash:before.bestblockhash}, history_complete:false};
    } finally { active--; }
  }
}
export const zcashBlockSource = new ZcashBlockSource();
