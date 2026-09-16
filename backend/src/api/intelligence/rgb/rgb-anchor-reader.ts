import { Transaction } from 'bitcoinjs-lib';
import { WorkbenchCoreReader, ownedWorkbenchCore } from '../workbench/workbench-core';
export class RgbEvidenceError extends Error { constructor(public status: number, message: string) { super(message); } }
/** Public transaction resolver only: private RGB consignments never reach this API. */
export class RgbAnchorReader {
  constructor(private core: WorkbenchCoreReader = ownedWorkbenchCore) {}
  async read(txids: unknown) {
    if (!Array.isArray(txids) || txids.length < 1 || txids.length > 16 || txids.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) || new Set(txids).size !== txids.length) throw new RgbEvidenceError(400, 'Supply one to sixteen distinct lowercase public transaction IDs.');
    const expected = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' }[this.core.network];
    const before = await this.call('getblockchaininfo', []);
    if (!expected || before.chain !== expected || !Number.isSafeInteger(before.blocks) || !/^[0-9a-f]{64}$/.test(before.bestblockhash)) throw new RgbEvidenceError(503, 'Owned Bitcoin source does not establish this network checkpoint.');
    const witnesses: Record<string, { raw_tx: string; height: number | null; timestamp: number | null }> = {};
    const unresolved: string[] = [];
    for (const id of txids) {
      let tx: any;
      try { tx = await this.core.call('getrawtransaction', [id, true]); }
      catch (e) { if ((e as { code?: number }).code === -5) { unresolved.push(id); continue; } throw new RgbEvidenceError(503, 'Owned source could not resolve a public anchor.'); }
      if (typeof tx?.hex !== 'string' || tx.hex.length > 8_000_000 || !/^(?:[0-9a-f]{2})+$/.test(tx.hex) || tx.txid !== id) throw new RgbEvidenceError(503, 'Owned source returned invalid transaction evidence.');
      try { if (Transaction.fromHex(tx.hex).getId() !== id) throw new Error(); } catch { throw new RgbEvidenceError(503, 'Public transaction bytes do not match the requested ID.'); }
      let height: number | null = null, timestamp: number | null = null;
      if (Number.isSafeInteger(tx.confirmations) && tx.confirmations > 0) {
        if (!/^[0-9a-f]{64}$/.test(tx.blockhash)) throw new RgbEvidenceError(503, 'Mined anchor has no valid block identifier.');
        const header = await this.call('getblockheader', [tx.blockhash, true]);
        if (header.hash !== tx.blockhash || !Number.isSafeInteger(header.height) || header.height < 1 || header.height > before.blocks || !Number.isSafeInteger(header.time) || header.time < 1231006505 || header.confirmations !== before.blocks - header.height + 1) throw new RgbEvidenceError(503, 'Anchor block is not established on the current active chain.');
        if (await this.call('getblockhash', [header.height]) !== tx.blockhash) throw new RgbEvidenceError(503, 'Anchor block is outside the active chain.');
        height = header.height; timestamp = header.time;
      } else if (tx.confirmations !== 0) { unresolved.push(id); continue; }
      witnesses[id] = { raw_tx: tx.hex, height, timestamp };
    }
    const after = await this.call('getblockchaininfo', []);
    if (after.chain !== before.chain || after.bestblockhash !== before.bestblockhash) throw new RgbEvidenceError(503, 'Chain checkpoint changed; retry public evidence lookup.');
    return { witnesses, unresolved, source: { network: this.core.network, block_hash: before.bestblockhash, block_height: before.blocks, observed_at: new Date().toISOString() }, scope: 'Owned active-chain public transaction observations; RGB consignment validation runs locally in the browser.' };
  }
  private async call(method: string, params: unknown[]) { try { return await this.core.call(method, params); } catch { throw new RgbEvidenceError(503, 'Owned Bitcoin source is unavailable.'); } }
}
