import { createHash } from 'crypto';
import { AddressSourceCheckpoint } from './address-source-checkpoint';
import { IEsploraApi } from './esplora-api.interface';
import { IElectrumApi } from './electrum-api.interface';

export interface ElectrumStatsReader {
  checkpoint(signal: AbortSignal): Promise<AddressSourceCheckpoint>;
  history(signal: AbortSignal): Promise<IElectrumApi.ScriptHashHistory[]>;
  balance(signal: AbortSignal): Promise<IElectrumApi.ScriptHashBalance>;
  core(method: string, params: unknown[], signal: AbortSignal): Promise<any>;
}
const scriptHash = (script: string): string => createHash('sha256').update(Buffer.from(script, 'hex')).digest().reverse().toString('hex');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const zero = (): IEsploraApi.ChainStats => ({ funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 });
const active = (signal: AbortSignal): void => { if (signal.aborted) throw new Error('Address statistics deadline exceeded'); };
const amount = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 21000000 || Number(value.toFixed(8)) !== value) throw new Error('Inexact Core output amount');
  const [whole, fraction] = value.toFixed(8).split('.'); return Number(BigInt(whole) * 100000000n + BigInt(fraction));
};
const exactHistory = (rows: IElectrumApi.ScriptHashHistory[]): string => {
  if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !validHash(row?.tx_hash) || !Number.isSafeInteger(row.height) || row.height < -1) || new Set(rows.map(row => row.tx_hash)).size !== rows.length) throw new Error('Address statistics history unavailable or exceeds bounded capacity');
  return JSON.stringify(rows.map(row => [row.tx_hash, row.height]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
};
const checkpointIdentity = (s: AddressSourceCheckpoint): string => JSON.stringify([s.network, s.genesisHash, s.blockHeight, s.blockHash, s.signetChallenge]);

/** Exact cumulative counts and turnover, never a balance disguised as funding. */
/** @asyncUnsafe */
export async function collectElectrumAddressStats(selectedScriptHash: string | ((signal: AbortSignal) => Promise<string>), reader: ElectrumStatsReader): Promise<{ chain_stats: IEsploraApi.ChainStats; mempool_stats: IEsploraApi.ChainStats }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000), signal = controller.signal;
  const bounded = /** @asyncUnsafe */ async <T>(work: () => Promise<T>): Promise<T> => {
    active(signal);
    let remove = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      const abort = () => reject(new Error('Address statistics deadline exceeded'));
      signal.addEventListener('abort', abort, { once: true });
      remove = () => signal.removeEventListener('abort', abort);
    });
    try { const value = await Promise.race([work(), cancelled]); active(signal); return value; } finally { remove(); }
  };
  const core = (method: string, params: unknown[]) => bounded(() => reader.core(method, params, signal));
  const stats = { chain_stats: zero(), mempool_stats: zero() }, funding = new Map<string, number>(), spending = new Map<string, number>();
  const headers = new Map<number, Promise<string>>(), parents = new Map<string, Promise<any>>();
  let responseBytes = 0, auxiliaryReads = 0;
  try {
    const expectedScriptHash = typeof selectedScriptHash === 'string' ? selectedScriptHash : await bounded(() => selectedScriptHash(signal));
    if (!validHash(expectedScriptHash)) throw new Error('Invalid script hash');
    const checkpoint = await bounded(() => reader.checkpoint(signal));
    const balance = await bounded(() => reader.balance(signal)), history = await bounded(() => reader.history(signal));
    const historyIdentity = exactHistory(history);
    if (!Number.isSafeInteger(balance.confirmed) || !Number.isSafeInteger(balance.unconfirmed)) throw new Error('Electrum returned an inexact balance');
    for (let start = 0; start < history.length; start += 4) {
      active(signal);
      await Promise.all(history.slice(start, start + 4).map(/** @asyncUnsafe */ async entry => {
        const transaction = await core('getrawtransaction', [entry.tx_hash, 2]);
        responseBytes += Buffer.byteLength(JSON.stringify(transaction));
        if (responseBytes > 32 * 1024 * 1024 || transaction?.txid !== entry.tx_hash || !Array.isArray(transaction.vin) || !Array.isArray(transaction.vout) || transaction.vin.length + transaction.vout.length > 100000) throw new Error('Invalid or oversized Core transaction statistics contract');
        const confirmed = entry.height > 0, section = confirmed ? stats.chain_stats : stats.mempool_stats;
        if (confirmed) {
          if (entry.height > checkpoint.blockHeight || !Number.isSafeInteger(transaction.confirmations) || transaction.confirmations < checkpoint.blockHeight - entry.height + 1 || !validHash(transaction.blockhash)) throw new Error('History confirmation does not match the active checkpoint');
          if (!headers.has(entry.height)) headers.set(entry.height, core('getblockhash', [entry.height]));
          if (await headers.get(entry.height) !== transaction.blockhash) throw new Error('History funding block is not active');
        } else if ((transaction.confirmations ?? 0) !== 0 || transaction.blockhash != null) throw new Error('Mempool history contains a confirmed transaction');
        let relevant = false, outputSum = 0n;
        transaction.vout.forEach((output, index) => {
          const value = amount(output.value); outputSum += BigInt(value);
          if (output.n !== index || typeof output.scriptPubKey?.hex !== 'string' || output.scriptPubKey.hex.length > 20000 || !/^(?:[0-9a-f]{2})*$/.test(output.scriptPubKey.hex)) throw new Error('Invalid Core output identity');
          if (scriptHash(output.scriptPubKey.hex) === expectedScriptHash) {
            funding.set(`${entry.tx_hash}:${index}`, value); section.funded_txo_count++; section.funded_txo_sum += value; relevant = true;
          }
        });
        if (outputSum > 2100000000000000n) throw new Error('Core transaction output sum exceeds Bitcoin money range');
        for (const input of transaction.vin) {
          active(signal); if (typeof input.coinbase === 'string') continue;
          if (!validHash(input.txid) || !Number.isSafeInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff) throw new Error('Invalid Core input identity');
          let prevout = input.prevout;
          if (!prevout) {
            const point = `${input.txid}:${input.vout}`;
            if (!parents.has(point)) {
              if (++auxiliaryReads > 10000) throw new Error('Address statistics prevout lookup capacity exceeded');
              parents.set(point, (/** @asyncUnsafe */ async () => {
                const parent = await core('getrawtransaction', [input.txid, 1]);
                responseBytes += Buffer.byteLength(JSON.stringify(parent));
                if (responseBytes > 32 * 1024 * 1024 || parent?.txid !== input.txid || !Array.isArray(parent.vout) || parent.vout[input.vout]?.n !== input.vout) throw new Error('Missing or oversized Core prevout');
                const output = parent.vout[input.vout];
                return { value: output.value, scriptPubKey: { hex: output.scriptPubKey?.hex } };
              })());
            }
            prevout = await parents.get(point);
          }
          const value = amount(prevout?.value), script = prevout?.scriptPubKey?.hex;
          if (typeof script !== 'string' || script.length > 20000 || !/^(?:[0-9a-f]{2})*$/.test(script)) throw new Error('Missing Core prevout script');
          if (scriptHash(script) === expectedScriptHash) {
            const key = `${input.txid}:${input.vout}`;
            if (spending.has(key)) throw new Error('Duplicate spent outpoint in address history');
            spending.set(key, value); section.spent_txo_count++; section.spent_txo_sum += value; relevant = true;
          }
        }
        if (!relevant) throw new Error('Electrum history contains an unrelated transaction');
        section.tx_count++;
      }));
    }
    for (const [key, value] of spending) if (funding.get(key) !== value) throw new Error('Address history omits or contradicts funding prevout');
    for (const section of Object.values(stats)) if (Object.values(section).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Address cumulative statistics exceed exact numeric contract');
    if (stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum !== balance.confirmed || stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum !== balance.unconfirmed) throw new Error('Address statistics do not close against indexed balance');
    const afterHistory = await bounded(() => reader.history(signal)), afterBalance = await bounded(() => reader.balance(signal)), after = await bounded(() => reader.checkpoint(signal));
    if (exactHistory(afterHistory) !== historyIdentity || afterBalance.confirmed !== balance.confirmed || afterBalance.unconfirmed !== balance.unconfirmed || checkpointIdentity(after) !== checkpointIdentity(checkpoint)) throw new Error('Address source changed during statistics acquisition');
    return stats;
  } finally { clearTimeout(timer); controller.abort(); }
}
