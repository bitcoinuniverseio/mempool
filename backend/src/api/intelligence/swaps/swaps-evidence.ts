import { Transaction } from 'bitcoinjs-lib';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import config from '../../../config';
import { SwapContext, SwapSourceContext } from './swaps.models';

export class SwapEvidenceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function swapContext(chain?: unknown, network?: unknown): SwapContext {
  if (chain === undefined && network === undefined) return { chain: 'bitcoin', network: 'mainnet' };
  if (chain !== 'bitcoin' || !['mainnet', 'signet', 'testnet', 'testnet4', 'regtest'].includes(network as string)) {
    throw new SwapEvidenceError('wrong-network', 'Provide chain=bitcoin and a supported explicit network.');
  }
  return { chain: 'bitcoin', network: network as SwapContext['network'] };
}

export interface ChainTransaction { transaction: Transaction; confirmations: number; block_hash?: string; }
export interface LockupEvidence extends ChainTransaction { context: SwapSourceContext; unspent: boolean; }
export interface SwapAuthority {
  lockup(context: SwapContext, txid: string, vout: number): Promise<LockupEvidence>;
  transaction(context: SwapSourceContext, txid: string): Promise<ChainTransaction>;
}

/** On-demand reads through the existing configured node, never a caller-selected endpoint. */
export class BitcoinSwapAuthority implements SwapAuthority {
  private busy = false;

  private async rpc<T>(method: string, ...args: unknown[]): Promise<T> {
    try { return await bitcoinClient[method](...args); }
    catch { throw new SwapEvidenceError('unavailable-source', 'Configured first-party Bitcoin Core RPC could not supply the requested evidence.'); }
  }

  /** @asyncUnsafe Evidence failures propagate to the service's structured-error boundary. */
  private async checkpoint(context: SwapContext): Promise<SwapSourceContext> {
    if (config.MEMPOOL.NETWORK !== context.network) {
      throw new SwapEvidenceError('wrong-network', `The configured node is not assigned to bitcoin/${context.network}.`);
    }
    const info = await this.rpc<any>('getBlockchainInfo');
    const expected = context.network === 'mainnet' ? 'main' : context.network === 'testnet' ? 'test' : context.network;
    if (info.chain !== expected) throw new SwapEvidenceError('wrong-network', 'Bitcoin Core reported a different chain than the requested network.');
    if (info.initialblockdownload || !Number.isSafeInteger(info.blocks) || !/^[0-9a-f]{64}$/.test(info.bestblockhash)) {
      throw new SwapEvidenceError('unavailable-source', 'Bitcoin Core is syncing or returned an invalid checkpoint.');
    }
    return { ...context, source_id: 'configured-bitcoin-core', block_height: info.blocks, block_hash: info.bestblockhash, observed_at: new Date().toISOString() };
  }

  /** @asyncUnsafe Evidence failures propagate to the service's structured-error boundary. */
  private async readTransaction(context: SwapSourceContext, txid: string): Promise<ChainTransaction> {
    const raw = await this.rpc<any>('getRawTransaction', txid, true);
    let transaction: Transaction;
    try {
      if (typeof raw.hex !== 'string' || raw.hex.length > 8_000_000 || !/^(?:[0-9a-f]{2})+$/.test(raw.hex)) throw new Error();
      transaction = Transaction.fromHex(raw.hex);
      if (transaction.getId() !== txid) throw new Error();
    } catch { throw new SwapEvidenceError('invalid', 'Node transaction serialization or transaction identity is invalid.'); }
    let confirmations = 0;
    if (raw.blockhash) {
      const header = await this.rpc<any>('getBlockHeader', raw.blockhash, true);
      if (header.confirmations < 1 || !Number.isSafeInteger(header.height) || header.height > context.block_height ||
          await this.rpc<string>('getBlockHash', header.height) !== raw.blockhash) {
        throw new SwapEvidenceError('reorged', 'Transaction is not in the selected active chain checkpoint.');
      }
      confirmations = context.block_height - header.height + 1;
    }
    return { transaction, confirmations, block_hash: raw.blockhash };
  }

  public async lockup(context: SwapContext, txid: string, vout: number): Promise<LockupEvidence> {
    if (this.busy) throw new SwapEvidenceError('source-busy', 'A swap evidence read is already using the shared node. Retry shortly.');
    this.busy = true;
    try {
      const checkpoint = await this.checkpoint(context);
      const result = await this.readTransaction(checkpoint, txid);
      const output = result.transaction.outs[vout];
      if (!output) throw new SwapEvidenceError('invalid', 'Lockup output index does not exist.');
      const utxo = await this.rpc<any>('getTxOut', txid, vout, true);
      if (utxo !== null && (!utxo || typeof utxo !== 'object' || Array.isArray(utxo))) {
        throw new SwapEvidenceError('invalid', 'Node returned an invalid UTXO result. Unspent status could not be established.');
      }
      if (utxo && (utxo.bestblock !== checkpoint.block_hash || utxo.scriptPubKey?.hex !== output.script.toString('hex'))) {
        throw new SwapEvidenceError('source-changed', 'Outpoint and node checkpoint disagree. Retry against the current chain.');
      }
      if ((await this.checkpoint(context)).block_hash !== checkpoint.block_hash) {
        throw new SwapEvidenceError('source-changed', 'Chain tip changed during verification. Retry against the current chain.');
      }
      return { ...result, context: checkpoint, unspent: utxo !== null };
    } finally { this.busy = false; }
  }

  public async transaction(context: SwapSourceContext, txid: string): Promise<ChainTransaction> {
    if (this.busy) throw new SwapEvidenceError('source-busy', 'A swap evidence read is already using the shared node. Retry shortly.');
    this.busy = true;
    try {
      const result = await this.readTransaction(context, txid);
      if ((await this.checkpoint(context)).block_hash !== context.block_hash) throw new SwapEvidenceError('source-changed', 'Chain tip changed during verification. Retry.');
      return result;
    } finally { this.busy = false; }
  }
}
