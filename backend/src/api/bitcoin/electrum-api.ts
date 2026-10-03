import config from '../../config';
import { createHash } from 'crypto';
import {utxoListProblems} from './esplora-contract';
import { verifyAddressSource } from './address-source-checkpoint';
import Client from '@mempool/electrum-client';
import { withElectrumDeadline } from './electrum-deadline';
import { AbstractBitcoinApi } from './bitcoin-api-abstract-factory';
import { IEsploraApi } from './esplora-api.interface';
import { IElectrumApi } from './electrum-api.interface';
import BitcoinApi from './bitcoin-api';
import logger from '../../logger';
import crypto from 'crypto-js';
import loadingIndicators from '../loading-indicators';
import memoryCache from '../memory-cache';
import { readIndexedTip } from './electrum-indexed-tip';
import { fetchElectrumTransactionPage } from './electrum-transaction-page';
import { collectElectrumAddressStats } from './electrum-address-stats';

class BitcoindElectrsApi extends BitcoinApi implements AbstractBitcoinApi {
  private electrumClient: any;

  constructor(bitcoinClient: any) {
    super(bitcoinClient);

    const electrumConfig = { client: 'mempool-v2', version: '1.4' };
    const electrumPersistencePolicy = { retryPeriod: 1000, maxRetry: Number.MAX_SAFE_INTEGER, callback: null };

    const electrumCallbacks = {
      onConnect: (client, versionInfo) => { logger.info(`Connected to Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT} (${JSON.stringify(versionInfo)})`); },
      onClose: (client) => { logger.info(`Disconnected from Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT}`); },
      onError: (err) => { logger.err(`Electrum error: ${JSON.stringify(err)}`); },
      onLog: (str) => { logger.debug(str); },
    };

    this.electrumClient = new Client(
      config.ELECTRUM.PORT,
      config.ELECTRUM.HOST,
      config.ELECTRUM.TLS_ENABLED ? 'tls' : 'tcp',
      null,
      electrumCallbacks
    );

    this.electrumClient.initElectrum(electrumConfig, electrumPersistencePolicy)
      .then(() => { })
      .catch((err) => {
        logger.err(`Error connecting to Electrum Server at ${config.ELECTRUM.HOST}:${config.ELECTRUM.PORT}`);
      });
  }

  /**
   * The height this index has. Null when the server did not say.
   *
   * Electrum reports its tip through the header subscription, which answers
   * with the current header immediately on subscribe. Nothing else in this
   * class needed it, so nothing asked, and the capability report had to call
   * the whole feature degraded for want of one number.
   *
   * @asyncSafe
   */
  /** @asyncUnsafe */
  async $getIndexBlockHash(height: number): Promise<string> {
    const header = await withElectrumDeadline(this.electrumClient.request('blockchain.block.header', [height]), 'blockchain.block.header');
    if (typeof header !== 'string' || !/^[0-9a-f]{160}$/i.test(header)) throw new Error('Invalid indexed block header');
    return createHash('sha256').update(createHash('sha256').update(Buffer.from(header, 'hex')).digest()).digest().reverse().toString('hex');
  }

  async $getIndexedTip(): Promise<number | null> {
    return readIndexedTip((method, params) =>
      withElectrumDeadline(this.electrumClient.request(method, params), method),
    );
  }

  /** @asyncUnsafe */
  async $getAddress(address: string): Promise<IEsploraApi.Address> {
    let scripthash = '';
    const stats = await this.$getExactScriptStatistics(/** @asyncUnsafe */ async signal => {
      const info = await this.bitcoindClient.rpc.call('validateaddress', [address], { signal });
      if (!info?.isvalid || typeof info.scriptPubKey !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(info.scriptPubKey)) throw new Error('Invalid Bitcoin address');
      scripthash = this.encodeScriptHash(info.scriptPubKey); return scripthash;
    }, () => scripthash);
    return { address, ...stats, electrum: true };
  }

  /** @asyncUnsafe */
  async $getAddressTransactions(address: string, lastSeenTxId: string): Promise<IEsploraApi.Transaction[]> {
    await verifyAddressSource(await this.$getIndexedTip(), height => this.$getIndexBlockHash(height));
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin address');
    }

    try {
      loadingIndicators.setProgress('address-' + address, 0);

      const history = await this.$getScriptHashHistory(addressInfo.scriptPubKey);
      history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      if (lastSeenTxId) {
        const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
        if (pos >= 0) {
          startingIndex = pos + 1;
        }
      }
      const endIndex = Math.min(startingIndex + 10, history.length);
      return fetchElectrumTransactionPage(
        history,
        startingIndex,
        endIndex,
        (txid) => this.$getRawTransaction(txid, false, true),
        (progress) => loadingIndicators.setProgress('address-' + address, progress),
      );
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + address, 100);
      throw new Error(typeof e === 'string' ? e : e && e.message || e);
    }
  }

  /** @asyncUnsafe */
  async $getScriptHash(scripthash: string): Promise<IEsploraApi.ScriptHash> {
    const stats = await this.$getExactScriptStatistics(scripthash, () => scripthash);
    return { scripthash, ...stats, electrum: true };
  }

  /** @asyncUnsafe */
  private $getExactScriptStatistics(selected: string | ((signal: AbortSignal) => Promise<string>), hash: () => string) {
    const active = (signal: AbortSignal): void => { if (signal.aborted) throw new Error('Address statistics timeout'); };
    const request = (method: string, params: unknown[], signal: AbortSignal) => {
      active(signal); return withElectrumDeadline(this.electrumClient.request(method, params), method, 15000);
    };
    const core = (method: string, params: unknown[], signal: AbortSignal) => { active(signal); return this.bitcoindClient.rpc.call(method, params, { signal }); };
    return collectElectrumAddressStats(selected, {
      history: signal => request('blockchain.scripthash.get_history', [hash()], signal),
      balance: signal => request('blockchain.scripthash.get_balance', [hash()], signal),
      core,
      checkpoint: /** @asyncUnsafe */ async signal => {
        const height = await readIndexedTip((method, params) => request(method, params, signal)); active(signal);
        return verifyAddressSource(height, /** @asyncUnsafe */ async value => {
          const header = await request('blockchain.block.header', [value], signal); active(signal);
          if (typeof header !== 'string' || !/^[0-9a-f]{160}$/i.test(header)) throw new Error('Invalid indexed block header');
          return createHash('sha256').update(createHash('sha256').update(Buffer.from(header, 'hex')).digest()).digest().reverse().toString('hex');
        }, { rpc: { call: (method: string, params: unknown[]) => core(method, params, signal) } }, 15000);
      },
    });
  }

  /** @asyncUnsafe */
  async $getAddressUtxos(address: string): Promise<IEsploraApi.UTXO[]> {
    await verifyAddressSource(await this.$getIndexedTip(), height => this.$getIndexBlockHash(height));
    const addressInfo = await this.bitcoindClient.validateAddress(address);
    if (!addressInfo || !addressInfo.isvalid) {
      throw new Error('Invalid Bitcoin address');
    }
    const scripthash = this.encodeScriptHash(addressInfo.scriptPubKey);
    return this.$getScriptHashUtxos(scripthash);
  }

  /** @asyncUnsafe */
  async $getScriptHashTransactions(scripthash: string, lastSeenTxId?: string): Promise<IEsploraApi.Transaction[]> {
    await verifyAddressSource(await this.$getIndexedTip(), height => this.$getIndexBlockHash(height));
    try {
      loadingIndicators.setProgress('address-' + scripthash, 0);

      let history = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scripthash);
      if (!history) {
        history = await withElectrumDeadline(this.electrumClient.blockchainScripthash_getHistory(scripthash), 'blockchain.scripthash.get_history');
        memoryCache.set('Scripthash_getHistory', scripthash, history, 2);
      }
      if (!history) {
        throw new Error('failed to get scripthash history');
      }
      history.sort((a, b) => (b.height || 9999999) - (a.height || 9999999));

      let startingIndex = 0;
      if (lastSeenTxId) {
        const pos = history.findIndex((historicalTx) => historicalTx.tx_hash === lastSeenTxId);
        if (pos >= 0) {
          startingIndex = pos + 1;
        }
      }
      const endIndex = Math.min(startingIndex + 10, history.length);
      return fetchElectrumTransactionPage(
        history,
        startingIndex,
        endIndex,
        (txid) => this.$getRawTransaction(txid, false, true),
        (progress) => loadingIndicators.setProgress('address-' + scripthash, progress),
      );
    } catch (e: any) {
      loadingIndicators.setProgress('address-' + scripthash, 100);
      throw new Error(typeof e === 'string' ? e : e && e.message || e);
    }
  }

  /** @asyncUnsafe */
  /** @asyncUnsafe */
  async $getScriptHashUtxos(scripthash: string): Promise<IEsploraApi.UTXO[]> {
    await verifyAddressSource(await this.$getIndexedTip(), height => this.$getIndexBlockHash(height));
    const utxos = await this.$getScriptHashUnspent(scripthash);
    const result: IEsploraApi.UTXO[] = [];
    for(const utxo of utxos) {
      if(utxo.height===0) {
        //Unconfirmed
        result.push({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          status: {
            confirmed: false
          },
          value: utxo.value
        });
      } else {
        //Confirmed
        const blockHash = await this.$getBlockHash(utxo.height);
        const block = await this.$getBlock(blockHash);
        result.push({
          txid: utxo.tx_hash,
          vout: utxo.tx_pos,
          status: {
            confirmed: true,
            block_height: utxo.height,
            block_hash: blockHash,
            block_time: block.timestamp
          },
          value: utxo.value
        });
      }
    }
    if (utxoListProblems(result).length) throw new Error('Electrum returned an invalid UTXO contract');
    return result;
  }

  private $getScriptHashUnspent(scriptHash: string): Promise<IElectrumApi.ScriptHashUtxos[]> {
    return withElectrumDeadline(this.electrumClient.blockchainScripthash_listunspent(scriptHash), 'blockchain.scripthash.listunspent');
  }

  /** @asyncUnsafe */
  async $getTransactionMerkleProof(txId: string): Promise<IEsploraApi.MerkleProof> {
    const tx = await this.$getRawTransaction(txId);
    return withElectrumDeadline(this.electrumClient.blockchainTransaction_getMerkle(txId, tx.status.block_height), 'blockchain.transaction.get_merkle');
  }

  private $getScriptHashBalance(scriptHash: string): Promise<IElectrumApi.ScriptHashBalance> {
    return withElectrumDeadline<IElectrumApi.ScriptHashBalance>(this.electrumClient.blockchainScripthash_getBalance(this.encodeScriptHash(scriptHash)), 'blockchain.scripthash.get_balance').then(balance => {
      if (!Number.isSafeInteger(balance.confirmed) || !Number.isSafeInteger(balance.unconfirmed)) throw new Error('Electrum returned an inexact balance');
      return balance;
    });
  }

  private $getScriptHashHistory(scriptHash: string): Promise<IElectrumApi.ScriptHashHistory[]> {
    const fromCache = memoryCache.get<IElectrumApi.ScriptHashHistory[]>('Scripthash_getHistory', scriptHash);
    if (fromCache) {
      return Promise.resolve(fromCache);
    }
    return withElectrumDeadline(this.electrumClient.blockchainScripthash_getHistory(this.encodeScriptHash(scriptHash)), 'blockchain.scripthash.get_history')
      .then((history) => {
        memoryCache.set('Scripthash_getHistory', scriptHash, history, 2);
        return history;
      });
  }

  private encodeScriptHash(scriptPubKey: string): string {
    const addrScripthash = crypto.enc.Hex.stringify(crypto.SHA256(crypto.enc.Hex.parse(scriptPubKey)));
    return addrScripthash!.match(/.{2}/g)!.reverse().join('');
  }

}

export default BitcoindElectrsApi;
