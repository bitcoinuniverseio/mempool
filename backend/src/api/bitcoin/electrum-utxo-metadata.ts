import { IEsploraApi } from './esplora-api.interface';
import { utxoListProblems } from './esplora-contract';

interface IndexedUtxo { tx_hash: string; tx_pos: number; height: number; value: number }
type CoreRead = (method: string, params: unknown[], signal: AbortSignal) => Promise<any>;

/** Fetch only the shared block headers, with bounded work and a total deadline. */
export async function readElectrumUtxoMetadata(rows: IndexedUtxo[], core: CoreRead, budgetMs = 15000): Promise<IEsploraApi.UTXO[]> {
  if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.height) || row.height < 0)) throw new Error('Invalid indexed UTXO height');
  if (utxoListProblems(rows.map(row => ({ txid: row.tx_hash, vout: row.tx_pos, value: row.value, status: { confirmed: false } }))).length) throw new Error('Electrum returned an invalid UTXO contract');
  const controller = new AbortController(), signal = controller.signal;
  const active = () => { if (signal.aborted) throw new Error('UTXO metadata deadline exceeded'); };
  const result: IEsploraApi.UTXO[] = new Array(rows.length);
  const headers = new Map<number, Promise<{ hash: string; time: number }>>();
  let next = 0, timer: ReturnType<typeof setTimeout>;
  const metadata = (height: number) => {
    if (!headers.has(height)) headers.set(height, (async () => {
      try {
        active(); const hash = await core('getblockhash', [height], signal);
        active(); if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid canonical UTXO block hash');
        const header = await core('getblockheader', [hash, true], signal); active();
        if (header?.hash !== hash || header.height !== height || !Number.isSafeInteger(header.time) || header.time < 0) throw new Error('Invalid canonical UTXO block header');
        return { hash, time: header.time };
      } catch (error) {
        controller.abort();
        throw error;
      }
    })());
    return headers.get(height)!;
  };
  const worker = async () => {
    while (next < rows.length) {
      active(); const index = next++, row = rows[index];
      let block: { hash: string; time: number } | null;
      try {
        block = row.height > 0 ? await metadata(row.height) : null;
      } catch (error) {
        controller.abort();
        throw error;
      }
      active();
      result[index] = { txid: row.tx_hash, vout: row.tx_pos, value: row.value, status: block
        ? { confirmed: true, block_height: row.height, block_hash: block.hash, block_time: block.time }
        : { confirmed: false } };
    }
  };
  try {
    await Promise.race([Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('UTXO metadata deadline exceeded')); }, budgetMs);
    })]);
    if (utxoListProblems(result).length) throw new Error('Electrum returned an invalid UTXO contract');
    return result;
  } finally { clearTimeout(timer!); controller.abort(); }
}
