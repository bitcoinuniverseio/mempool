import { createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import { AddressSourceCheckpoint } from './address-source-checkpoint';
import { ReconstructionV3Source } from './utxo-reconstruction-v3.service';
import { EsploraReconstructionSource, GlobalReconstructionSnapshot } from './utxo-reconstruction.source';
import { ReconstructionError } from './utxo-reconstruction.service';

export interface GlobalTransactionProof { txid: string; rawHex: string; rawSha256: string; }
export interface ReconstructionV4Source extends ReconstructionV3Source {
  snapshot(address: string, signal: AbortSignal, anchor?: AddressSourceCheckpoint): Promise<GlobalReconstructionSnapshot>;
  globalTransactions(txids: string[], signal: AbortSignal, consume?: (proof: GlobalTransactionProof) => void): Promise<GlobalTransactionProof[]>;
}
export class EsploraReconstructionV4Source extends EsploraReconstructionSource implements ReconstructionV4Source {
  snapshot(address: string, signal: AbortSignal, anchor?: AddressSourceCheckpoint): Promise<GlobalReconstructionSnapshot> {
    return this.snapshotWithGlobalMempool(address, signal, anchor);
  }
  /** At most four independent payload reads concurrently; no caller origin or fabricated removed transaction. @asyncUnsafe */
  async globalTransactions(txids: string[], signal: AbortSignal, consume?: (proof: GlobalTransactionProof) => void): Promise<GlobalTransactionProof[]> {
    if (!Array.isArray(txids) || txids.length > 100 || new Set(txids).size !== txids.length || txids.some(txid => !/^[0-9a-f]{64}$/.test(txid))) throw new ReconstructionError(422, 'Global transaction proof capacity exceeded');
    const results: GlobalTransactionProof[] = [];
    for (let index = 0; index < txids.length; index += 4) {
      if (signal.aborted) throw new ReconstructionError(499, 'Global native proof acquisition cancelled');
      const ids = txids.slice(index, index + 4);
      const batch = await Promise.allSettled(ids.map(txid => this.readGlobalTransactionHex(txid, signal)));
      const failure = batch.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      const waveHexBytes = batch.reduce((sum, result) => sum + (result.status === 'fulfilled' ? Buffer.byteLength(result.value) : 0), 0);
      if (waveHexBytes > 4 * 1048576) throw new ReconstructionError(422, 'Global native working wave capacity exceeded');
      for (let offset = 0; offset < batch.length; offset++) {
        if (signal.aborted) throw new ReconstructionError(499, 'Global native proof acquisition cancelled');
        const result = batch[offset];
        if (result.status !== 'fulfilled') throw new ReconstructionError(503, 'Global native proof acquisition failed');
        if (Transaction.fromHex(result.value).getId() !== ids[offset]) throw new ReconstructionError(409, 'Global native transaction bytes do not bind the requested identifier');
        const proof = { txid: ids[offset], rawHex: result.value, rawSha256: createHash('sha256').update(Buffer.from(result.value, 'hex')).digest('hex') };
        if (consume) consume(proof); else results.push(proof);
      }
    }
    if (signal.aborted) throw new ReconstructionError(499, 'Global native proof acquisition cancelled');
    return results;
  }
}
