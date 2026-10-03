import axios from 'axios';
import { createHash } from 'crypto';
import config from '../../config';
import bitcoinClient from './bitcoin-client';
import { AddressSourceCheckpoint, verifyAddressSource } from './address-source-checkpoint';
import { IEsploraApi } from './esplora-api.interface';
import { ReconstructionError, ReconstructionOutput, ReconstructionSnapshot, ReconstructionSource } from './utxo-reconstruction.service';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const active = (signal: AbortSignal): void => { if (signal.aborted) throw new ReconstructionError(499, 'Reconstruction cancelled or exceeded its deadline'); };
const txids = (data: unknown): string[] => {
  if (!Array.isArray(data) || data.length > 50000 || data.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) || new Set(data).size !== data.length) {
    throw new ReconstructionError(422, 'Exact mempool identity exceeds capacity or has an invalid contract');
  }
  return [...data].sort();
};
/** Pinned configured origin: reconstruction never silently changes providers. */
export class EsploraReconstructionSource implements ReconstructionSource {
  private origin: string;
  private sourceId: string;
  private socketPath: string | undefined;
  private http = axios.create({ timeout: 10000, maxContentLength: 16 * 1024 * 1024, maxBodyLength: 1024 * 1024 });
  constructor() {
    if (config.MEMPOOL.BACKEND !== 'esplora' || !['mainnet', 'signet', 'testnet', 'testnet4', 'regtest'].includes(config.MEMPOOL.NETWORK)) {
      throw new ReconstructionError(503, 'Bounded reconstruction requires a configured Bitcoin Esplora history source');
    }
    this.socketPath = config.ESPLORA.UNIX_SOCKET_PATH || undefined;
    this.origin = this.socketPath ? 'http://api' : config.ESPLORA.REST_API_URL.replace(/\/$/, '');
    const url = new URL(this.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ReconstructionError(503, 'Invalid configured reconstruction origin');
    this.sourceId = hash(JSON.stringify({ origin: this.origin, socket: this.socketPath || null, network: config.MEMPOOL.NETWORK }));
  }
  /** @asyncUnsafe */
  private async get<T>(path: string, signal: AbortSignal): Promise<T> {
    active(signal); const response = await this.http.get<T>(this.origin + path, { signal, socketPath: this.socketPath }); active(signal); return response.data;
  }
  /** @asyncUnsafe */
  private async rpc(method: string, params: unknown[], signal: AbortSignal): Promise<any> {
    active(signal); const result = await bitcoinClient.rpc.call(method, params, { signal }); active(signal); return result;
  }
  /** @asyncUnsafe */
  async snapshot(address: string, signal: AbortSignal): Promise<ReconstructionSnapshot> {
    active(signal);
    const before = await this.rpc('getblockchaininfo', [], signal);
    if (before.initialblockdownload !== false) throw new ReconstructionError(503, 'Owned Core is not ready for exact reconstruction');
    const rawTip = await this.get<unknown>('/blocks/tip/height', signal);
    if (!/^(?:0|[1-9][0-9]*)$/.test(String(rawTip))) throw new ReconstructionError(503, 'Invalid indexed tip');
    const tip = Number(rawTip);
    if (!Number.isSafeInteger(tip) || tip !== before.blocks) throw new ReconstructionError(409, 'Core and index must share the exact active tip for reconstruction');
    let checkpoint: AddressSourceCheckpoint;
    try {
      checkpoint = await verifyAddressSource(tip, height => this.get('/block-height/' + height, signal),
        { rpc: { call: (method: string, params: unknown[]) => this.rpc(method, params, signal) } }, 15000);
    } catch (error) {
      active(signal);
      // These are the helper's explicit identity failures, not transport/deadline errors.
      if (error instanceof Error && [
        'Owned node network checkpoint is invalid', 'Configured Signet challenge is not attested by the owned node',
        'Signet identity requires a non-genesis checkpoint', 'Address source differs from the owned active chain',
        'Owned checkpoint moved during address source verification',
      ].includes(error.message)) throw new ReconstructionError(409, error.message);
      throw error;
    }
    active(signal);
    const [summary, indexMempool, coreMempool, addressInfo] = await Promise.all([
      this.get<IEsploraApi.Address>('/address/' + encodeURIComponent(address), signal),
      this.get<unknown>('/mempool/txids', signal),
      this.rpc('getrawmempool', [false, true], signal),
      this.rpc('validateaddress', [address], signal),
    ]);
    if (addressInfo?.isvalid !== true || typeof addressInfo.scriptPubKey !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(addressInfo.scriptPubKey)) throw new ReconstructionError(400, 'Address is invalid for the configured Core source');
    if (!coreMempool || !Number.isSafeInteger(coreMempool.mempool_sequence) || coreMempool.mempool_sequence < 0) throw new ReconstructionError(503, 'Core did not provide an exact mempool sequence');
    const indexIds = txids(indexMempool), coreIds = txids(coreMempool.txids);
    if (JSON.stringify(indexIds) !== JSON.stringify(coreIds)) throw new ReconstructionError(409, 'Index and Core mempool identities differ');
    const [after, afterMempool, afterTip] = await Promise.all([
      this.rpc('getblockchaininfo', [], signal), this.rpc('getrawmempool', [false, true], signal), this.get('/blocks/tip/hash', signal),
    ]);
    if (after.initialblockdownload !== false || after.bestblockhash !== before.bestblockhash || after.blocks !== before.blocks ||
        after.signet_challenge !== before.signet_challenge || afterTip !== checkpoint.blockHash ||
        afterMempool.mempool_sequence !== coreMempool.mempool_sequence || JSON.stringify(txids(afterMempool.txids)) !== JSON.stringify(coreIds)) {
      throw new ReconstructionError(409, 'Active chain or exact mempool identity moved during source acquisition');
    }
    return { checkpoint, sourceId: this.sourceId, mempoolIdentity: hash(JSON.stringify({ ids: coreIds, sequence: coreMempool.mempool_sequence })), scriptPubKey: addressInfo.scriptPubKey, summary };
  }
  history(address: string, after: string | undefined, limit: number, signal: AbortSignal): Promise<IEsploraApi.Transaction[]> {
    if (after && !/^[0-9a-f]{64}$/.test(after)) throw new ReconstructionError(400, 'Invalid native history cursor');
    return this.get(`/address/${encodeURIComponent(address)}/txs/chain${after ? '/' + after : ''}?max_txs=${limit}`, signal);
  }
  mempool(address: string, limit: number, signal: AbortSignal): Promise<IEsploraApi.Transaction[]> {
    return this.get(`/address/${encodeURIComponent(address)}/txs/mempool?max_txs=${limit}`, signal);
  }
  /** @asyncUnsafe */
  async verifyOutputs(outputs: ReconstructionOutput[], signal: AbortSignal, checkpoint: AddressSourceCheckpoint): Promise<void> {
    if (outputs.length > 100) throw new ReconstructionError(400, 'Independent output verification batch exceeds 100');
    if (!outputs.length) return;
    active(signal);
    const response = await this.http.post<IEsploraApi.Outspend[]>(this.origin + '/internal/txs/outspends/by-outpoint', outputs.map(output => `${output.txid}:${output.vout}`), { signal, socketPath: this.socketPath });
    active(signal);
    if (!Array.isArray(response.data) || response.data.length !== outputs.length || response.data.some(row => row?.spent !== false || row.txid != null || row.vin != null || row.status != null)) throw new ReconstructionError(409, 'Index outspend readback does not confirm every candidate output is unspent');
    // Four live Core reads at a time: no scan, broadcast or unbounded RPC batch.
    const hashes = new Map<number, Promise<string>>();
    for (let start = 0; start < outputs.length; start += 4) {
      active(signal);
      await Promise.all(outputs.slice(start, start + 4).map(/** @asyncUnsafe */ async output => {
        const live = await this.rpc('gettxout', [output.txid, output.vout, true], signal);
        if (!live || typeof live.value !== 'number' || !Number.isFinite(live.value) || live.value < 0 || live.value > 21000000 ||
            Number(live.value.toFixed(8)) !== live.value ||
            live.value.toFixed(8) !== (output.value / 100000000).toFixed(8) ||
            live.bestblock !== checkpoint.blockHash || live.scriptPubKey?.hex !== output.scriptpubkey || !Number.isSafeInteger(live.confirmations) || live.confirmations < 0 ||
            (live.confirmations > 0) !== output.status.confirmed) throw new ReconstructionError(409, 'Independent Core UTXO readback differs from reconstructed output');
        if (output.status.confirmed) {
          const height = output.status.block_height!;
          if (live.confirmations !== checkpoint.blockHeight - height + 1) throw new ReconstructionError(409, 'Core confirmations differ from reconstructed funding height');
          if (!hashes.has(height)) hashes.set(height, this.rpc('getblockhash', [height], signal));
          if (await hashes.get(height) !== output.status.block_hash) throw new ReconstructionError(409, 'Reconstructed funding block differs from the owned active chain');
        }
      }));
    }
  }
}
