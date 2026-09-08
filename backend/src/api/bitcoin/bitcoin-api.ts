import * as bitcoinjs from 'bitcoinjs-lib';
import { AbstractBitcoinApi, HealthCheckHost } from './bitcoin-api-abstract-factory';
import { IBitcoinApi, SubmitPackageResult, TestMempoolAcceptResult } from './bitcoin-api.interface';
import { IEsploraApi } from './esplora-api.interface';
import blocks from '../blocks';
import mempool from '../mempool';
import { TransactionExtended } from '../../mempool.interfaces';
import transactionUtils from '../transaction-utils';
import { Common } from '../common';
import pLimit from '../../utils/p-limit';
import logger from '../../logger';

const CONFIRMED_TRANSACTION_CACHE_MS = 30_000;
const CONFIRMED_TRANSACTION_CACHE_LIMIT = 512;
const CONFIRMED_TRANSACTION_CACHE_BYTES = 16 * 1024 * 1024;
const CONFIRMED_TRANSACTION_CACHE_ENTRY_BYTES = 512 * 1024;
const RAW_TRANSACTION_QUEUE_WAIT_MS = 10_000;
const RAW_TRANSACTION_RPC_TIMEOUT_MS = 20_000;
const RAW_TRANSACTION_OPERATION_TIMEOUT_MS = 25_000;
const RAW_TRANSACTION_QUEUE_FACTOR = 16;
const RAW_TRANSACTION_PRESSURE_LOG_MS = 10_000;
const RAW_TRANSACTION_PREVOUT_WORKERS = 2;

interface ConfirmedTransactionCacheEntry {
  expiresAt: number;
  epoch: string;
  transaction: IEsploraApi.Transaction;
  bytes: number;
}

interface RawTransactionController {
  requests: Map<string, Promise<IEsploraApi.Transaction>>;
  cache: Map<string, ConfirmedTransactionCacheEntry>;
  cacheBytes: number;
  limit: ReturnType<typeof pLimit>;
  concurrency: number;
  maxPending: number;
  lastPressureLogAt: number;
  rejections: number;
}

const rawTransactionControllers = new WeakMap<object, RawTransactionController>();

function createRawTransactionController(bitcoinClient: any): RawTransactionController {
  const configuredLimit = Number(bitcoinClient?.rpc?.agent?.maxSockets);
  const poolLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 8;
  const reservedSockets = Math.max(1, Math.ceil(poolLimit / 4));
  const concurrency = Math.max(1, poolLimit - reservedSockets);
  const maxPending = concurrency * RAW_TRANSACTION_QUEUE_FACTOR;
  return {
    requests: new Map(),
    cache: new Map(),
    cacheBytes: 0,
    limit: pLimit(concurrency),
    concurrency,
    maxPending,
    lastPressureLogAt: 0,
    rejections: 0,
  };
}

function getRawTransactionController(bitcoinClient: any): RawTransactionController {
  const candidateKey = bitcoinClient?.rpc?.agent || bitcoinClient;
  if ((typeof candidateKey !== 'object' || candidateKey === null) && typeof candidateKey !== 'function') {
    return createRawTransactionController(bitcoinClient);
  }
  const key = candidateKey as object;
  let controller = rawTransactionControllers.get(key);
  if (!controller) {
    controller = createRawTransactionController(bitcoinClient);
    rawTransactionControllers.set(key, controller);
  }
  return controller;
}

export class BitcoinApi implements AbstractBitcoinApi {
  private rawMempoolCache: IBitcoinApi.RawMempool | null = null;
  private readonly rawTransactionController: RawTransactionController;
  protected bitcoindClient: any;

  constructor(bitcoinClient: any) {
    this.bitcoindClient = bitcoinClient;
    this.rawTransactionController = getRawTransactionController(bitcoinClient);
  }

  static convertBlock(block: IBitcoinApi.Block): IEsploraApi.Block {
    return {
      id: block.hash,
      height: block.height,
      version: block.version,
      timestamp: block.time,
      bits: parseInt(block.bits, 16),
      nonce: block.nonce,
      difficulty: block.difficulty,
      merkle_root: block.merkleroot,
      tx_count: block.nTx,
      size: block.size,
      weight: block.weight,
      previousblockhash: block.previousblockhash,
      mediantime: block.mediantime,
      stale: block.confirmations === -1,
    };
  }


  /** @asyncUnsafe Request callers own error handling. */
  async $getRawTransaction(
    txId: string,
    skipConversion = false,
    addPrevout = false,
    lazyPrevouts = false,
    signal?: AbortSignal,
    operationDeadline = Date.now() + RAW_TRANSACTION_OPERATION_TIMEOUT_MS,
  ): Promise<IEsploraApi.Transaction> {
    this.$assertRawTransactionOperation(signal, operationDeadline);
    // If the transaction is in the mempool we already converted and fetched the fee. Only prevouts are missing
    const txInMempool = mempool.getMempool()[txId];
    if (txInMempool && addPrevout) {
      return this.$addPrevouts(txInMempool, signal, operationDeadline);
    }

    const epoch = this.$chainCacheEpoch();
    const cacheKey = `${txId}:${Number(skipConversion)}:${Number(addPrevout)}:${Number(lazyPrevouts)}`;
    const cached = this.rawTransactionController.cache.get(cacheKey);
    if (cached && cached.epoch === epoch && cached.expiresAt > Date.now()) {
      this.rawTransactionController.cache.delete(cacheKey);
      this.rawTransactionController.cache.set(cacheKey, cached);
      return structuredClone(cached.transaction);
    }
    if (cached) {
      this.$deleteConfirmedTransactionCacheEntry(cacheKey);
    }

    const requestKey = `${epoch}:${cacheKey}`;
    const activeRequest = this.rawTransactionController.requests.get(requestKey);
    if (activeRequest) {
      return structuredClone(await this.$awaitRawTransactionOperation(
        activeRequest,
        signal,
        operationDeadline,
      ));
    }

    const request = this.$loadRawTransaction(
      txId,
      skipConversion,
      addPrevout,
      lazyPrevouts,
      signal,
      operationDeadline,
    );
    this.rawTransactionController.requests.set(requestKey, request);
    try {
      const transaction = await request;
      const confirmed = !skipConversion && transaction.status?.confirmed === true;
      if (confirmed && this.$chainCacheEpoch() === epoch) {
        this.$cacheConfirmedTransaction(cacheKey, epoch, transaction);
      }
      return structuredClone(transaction);
    } finally {
      this.rawTransactionController.requests.delete(requestKey);
    }
  }

  private $deleteConfirmedTransactionCacheEntry(cacheKey: string): void {
    const cached = this.rawTransactionController.cache.get(cacheKey);
    if (!cached) {
      return;
    }
    this.rawTransactionController.cache.delete(cacheKey);
    this.rawTransactionController.cacheBytes = Math.max(
      0,
      this.rawTransactionController.cacheBytes - cached.bytes,
    );
  }

  private $cacheConfirmedTransaction(
    cacheKey: string,
    epoch: string,
    transaction: IEsploraApi.Transaction,
  ): void {
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(transaction), 'utf8');
    } catch (_) {
      return;
    }
    if (bytes > CONFIRMED_TRANSACTION_CACHE_ENTRY_BYTES) {
      return;
    }

    const now = Date.now();
    for (const [key, cached] of this.rawTransactionController.cache) {
      if (cached.epoch !== epoch || cached.expiresAt <= now) {
        this.$deleteConfirmedTransactionCacheEntry(key);
      }
    }
    this.$deleteConfirmedTransactionCacheEntry(cacheKey);
    while (
      this.rawTransactionController.cache.size >= CONFIRMED_TRANSACTION_CACHE_LIMIT ||
      this.rawTransactionController.cacheBytes + bytes > CONFIRMED_TRANSACTION_CACHE_BYTES
    ) {
      const oldestKey = this.rawTransactionController.cache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        return;
      }
      this.$deleteConfirmedTransactionCacheEntry(oldestKey);
    }
    this.rawTransactionController.cache.set(cacheKey, {
      expiresAt: now + CONFIRMED_TRANSACTION_CACHE_MS,
      epoch,
      transaction,
      bytes,
    });
    this.rawTransactionController.cacheBytes += bytes;
  }

  private $chainCacheEpoch(): string {
    const recentBlocks = blocks.getBlocks();
    const tip = recentBlocks.length > 0 ? recentBlocks[recentBlocks.length - 1].id : '';
    return `${blocks.getCurrentBlockHeight()}:${tip}`;
  }

  private $rpcQueueError(code: string, message: string): Error {
    const error = new Error(message);
    (error as NodeJS.ErrnoException).code = code;
    if (code !== 'ECANCELED') {
      this.rawTransactionController.rejections += 1;
      const now = Date.now();
      if (now - this.rawTransactionController.lastPressureLogAt >= RAW_TRANSACTION_PRESSURE_LOG_MS) {
        this.rawTransactionController.lastPressureLogAt = now;
        logger.warn(`Bitcoin RPC pressure ${JSON.stringify({
          code,
          active: this.rawTransactionController.limit.activeCount,
          queued: this.rawTransactionController.limit.pendingCount,
          coalesced: this.rawTransactionController.requests.size,
          concurrency: this.rawTransactionController.concurrency,
          rejections: this.rawTransactionController.rejections,
        })}`);
      }
    }
    return error;
  }

  private $assertRawTransactionOperation(signal: AbortSignal | undefined, operationDeadline: number): void {
    if (signal?.aborted) {
      throw this.$rpcQueueError('ECANCELED', 'Bitcoin transaction RPC operation canceled');
    }
    if (Date.now() >= operationDeadline) {
      throw this.$rpcQueueError('ERPCOPERATIONTIMEOUT', 'Bitcoin transaction RPC operation timed out');
    }
  }

  private $awaitRawTransactionOperation<T>(
    operation: Promise<T>,
    signal: AbortSignal | undefined,
    operationDeadline: number,
  ): Promise<T> {
    try {
      this.$assertRawTransactionOperation(signal, operationDeadline);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        callback();
      };
      const abort = () => finish(() => reject(
        this.$rpcQueueError('ECANCELED', 'Bitcoin transaction RPC operation canceled'),
      ));
      const timeout = setTimeout(() => finish(() => reject(
        this.$rpcQueueError('ERPCOPERATIONTIMEOUT', 'Bitcoin transaction RPC operation timed out'),
      )), Math.max(1, operationDeadline - Date.now()));
      signal?.addEventListener('abort', abort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private $runRawTransactionRpc<T>(
    work: () => Promise<T>,
    signal: AbortSignal | undefined,
    operationDeadline: number,
  ): Promise<T> {
    try {
      this.$assertRawTransactionOperation(signal, operationDeadline);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.rawTransactionController.limit.pendingCount >= this.rawTransactionController.maxPending) {
      return Promise.reject(this.$rpcQueueError(
        'EBUSY',
        'Bitcoin transaction RPC queue is full',
      ));
    }

    return new Promise<T>((resolve, reject) => {
      let expired = false;
      const expire = (error: Error) => {
        if (expired) {
          return;
        }
        expired = true;
        clearTimeout(waitTimeout);
        signal?.removeEventListener('abort', abort);
        reject(error);
      };
      const abort = () => expire(
        this.$rpcQueueError('ECANCELED', 'Bitcoin transaction RPC operation canceled'),
      );
      const waitTimeout = setTimeout(() => expire(this.$rpcQueueError(
        'ERPCQUEUETIMEOUT',
        'Bitcoin transaction RPC queue wait timed out',
      )), Math.max(1, Math.min(RAW_TRANSACTION_QUEUE_WAIT_MS, operationDeadline - Date.now())));
      signal?.addEventListener('abort', abort, { once: true });

      this.rawTransactionController.limit(async () => {
        if (expired) {
          return;
        }
        clearTimeout(waitTimeout);
        signal?.removeEventListener('abort', abort);
        this.$assertRawTransactionOperation(signal, operationDeadline);
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        }
      }).catch((error) => {
        clearTimeout(waitTimeout);
        signal?.removeEventListener('abort', abort);
        if (!expired) {
          reject(error);
        }
      });
    });
  }

  private $readRawTransaction(
    txId: string,
    signal: AbortSignal | undefined,
    operationDeadline: number,
  ): Promise<IBitcoinApi.Transaction> {
    const timeout = Math.max(
      1,
      Math.min(RAW_TRANSACTION_RPC_TIMEOUT_MS, operationDeadline - Date.now()),
    );
    if (typeof this.bitcoindClient?.rpc?.call === 'function') {
      return this.bitcoindClient.rpc.call(
        'getrawtransaction',
        [txId, true],
        { timeout, signal },
      );
    }
    return this.$awaitRawTransactionOperation(
      this.bitcoindClient.getRawTransaction(txId, true),
      signal,
      operationDeadline,
    );
  }

  /** @asyncUnsafe The public wrapper coalesces and handles request state. */
  private async $loadRawTransaction(
    txId: string,
    skipConversion: boolean,
    addPrevout: boolean,
    lazyPrevouts: boolean,
    signal: AbortSignal | undefined,
    operationDeadline: number,
  ): Promise<IEsploraApi.Transaction> {
    try {
      const transaction = await this.$runRawTransactionRpc(
        () => this.$readRawTransaction(txId, signal, operationDeadline),
        signal,
        operationDeadline,
      );
      if (skipConversion) {
        transaction.vout.forEach((vout) => {
          vout.value = Math.round(vout.value * 100000000);
        });
        return transaction as unknown as IEsploraApi.Transaction;
      }
      return this.$convertTransaction(
        transaction,
        addPrevout,
        lazyPrevouts,
        false,
        signal,
        operationDeadline,
      );
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('The genesis block coinbase')) {
        return this.$returnCoinbaseTransaction();
      }
      throw e;
    }
  }

  async $getRawTransactions(txids: string[]): Promise<IEsploraApi.Transaction[]> {
    const txs: IEsploraApi.Transaction[] = [];
    for (const txid of txids) {
      try {
        const tx = await this.$getRawTransaction(txid, false, true);
        txs.push(tx);
      } catch (err) {
        // skip failures
      }
    }
    return txs;
  }

  $getMempoolTransactions(txids: string[]): Promise<IEsploraApi.Transaction[]> {
    throw new Error('Method getMempoolTransactions not supported by the Bitcoin RPC API.');
  }

  $getAllMempoolTransactions(lastTxid?: string, max_txs?: number): Promise<IEsploraApi.Transaction[]> {
    throw new Error('Method getAllMempoolTransactions not supported by the Bitcoin RPC API.');

  }

  async $getTransactionHex(txId: string): Promise<string> {
    const txInMempool = mempool.getMempool()[txId];
    if (txInMempool && txInMempool.hex) {
      return txInMempool.hex;
    }

    return this.bitcoindClient.getRawTransaction(txId, true)
      .then((transaction: IBitcoinApi.Transaction) => {
        return transaction.hex;
      });
  }

  $getTransactionMerkleProof(txId: string): Promise<IEsploraApi.MerkleProof> {
    throw new Error('Method getTransactionMerkleProof not supported by the Bitcoin RPC API.');
  }

  $getBlockHeightTip(): Promise<number> {
    return this.bitcoindClient.getBlockCount();
  }

  $getBlockHashTip(): Promise<string> {
    return this.bitcoindClient.getBestBlockHash();
  }

  $getTxIdsForBlock(hash: string, fallbackToCore = false): Promise<string[]> {
    return this.bitcoindClient.getBlock(hash, 1)
      .then((rpcBlock: IBitcoinApi.Block) => rpcBlock.tx);
  }

  /** @asyncUnsafe */
  async $getTxsForBlock(hash: string, fallbackToCore = false): Promise<IEsploraApi.Transaction[]> {
    const verboseBlock: IBitcoinApi.VerboseBlock = await this.bitcoindClient.getBlock(hash, 2);
    const transactions: IEsploraApi.Transaction[] = [];
    for (const tx of verboseBlock.tx) {
      const converted = await this.$convertTransaction(tx, true, false, verboseBlock.confirmations === -1);
      converted.status = {
        confirmed: true,
        block_height: verboseBlock.height,
        block_hash: hash,
        block_time: verboseBlock.time,
      };
      transactions.push(converted);
    }
    return transactions;
  }

  $getRawBlock(hash: string): Promise<Buffer> {
    return this.bitcoindClient.getBlock(hash, 0)
      .then((raw: string) => Buffer.from(raw, 'hex'));
  }

  $getBlockHash(height: number): Promise<string> {
    return this.bitcoindClient.getBlockHash(height);
  }

  $getBlockHeader(hash: string): Promise<string> {
    return this.bitcoindClient.getBlockHeader(hash, false);
  }

  async $getBlock(hash: string): Promise<IEsploraApi.Block> {
    const foundBlock = blocks.getBlocks().find((block) => block.id === hash);
    if (foundBlock) {
      return foundBlock;
    }

    return this.bitcoindClient.getBlock(hash)
      .then((block: IBitcoinApi.Block) => BitcoinApi.convertBlock(block));
  }

  $getAddress(address: string): Promise<IEsploraApi.Address> {
    throw new Error('Method getAddress not supported by the Bitcoin RPC API.');
  }

  $getAddressTransactions(address: string, lastSeenTxId: string): Promise<IEsploraApi.Transaction[]> {
    throw new Error('Method getAddressTransactions not supported by the Bitcoin RPC API.');
  }

  $getAddressUtxos(address: string): Promise<IEsploraApi.UTXO[]> {
    throw new Error('Method getAddressUtxos not supported by the Bitcoin RPC API.');
  }

  $getScriptHash(scripthash: string): Promise<IEsploraApi.ScriptHash> {
    throw new Error('Method getScriptHash not supported by the Bitcoin RPC API.');
  }

  $getScriptHashTransactions(scripthash: string, lastSeenTxId: string): Promise<IEsploraApi.Transaction[]> {
    throw new Error('Method getScriptHashTransactions not supported by the Bitcoin RPC API.');
  }

  $getScriptHashUtxos(scripthash: string): Promise<IEsploraApi.UTXO[]> {
    throw new Error('Method getScriptHashUtxos not supported by the Bitcoin RPC API.');
  }

  $getRawMempool(): Promise<IEsploraApi.Transaction['txid'][]> {
    return this.bitcoindClient.getRawMemPool();
  }

  $getAddressPrefix(prefix: string): string[] {
    const found: { [address: string]: string } = {};
    const mp = mempool.getMempool();
    for (const tx in mp) {
      for (const vout of mp[tx].vout) {
        if (vout.scriptpubkey_address?.indexOf(prefix) === 0) {
          found[vout.scriptpubkey_address] = '';
          if (Object.keys(found).length >= 10) {
            return Object.keys(found);
          }
        }
      }
      for (const vin of mp[tx].vin) {
        if (vin.prevout?.scriptpubkey_address?.indexOf(prefix) === 0) {
          found[vin.prevout?.scriptpubkey_address] = '';
          if (Object.keys(found).length >= 10) {
            return Object.keys(found);
          }
        }
      }
    }
    return Object.keys(found);
  }

  $sendRawTransaction(rawTransaction: string): Promise<string> {
    return this.bitcoindClient.sendRawTransaction(rawTransaction);
  }

  async $testMempoolAccept(rawTransactions: string[], maxfeerate?: number): Promise<TestMempoolAcceptResult[]> {
    if (rawTransactions.length) {
      return this.bitcoindClient.testMempoolAccept(rawTransactions, maxfeerate ?? undefined);
    } else {
      return [];
    }
  }

  $submitPackage(rawTransactions: string[], maxfeerate?: number, maxburnamount?: number): Promise<SubmitPackageResult> {
    return this.bitcoindClient.submitPackage(rawTransactions, maxfeerate ?? undefined, maxburnamount ?? undefined);
  }

  /** @asyncUnsafe */
  async $getOutspend(txId: string, vout: number): Promise<IEsploraApi.Outspend> {
    const txOut = await this.bitcoindClient.getTxOut(txId, vout, false);
    return {
      spent: txOut === null,
      status: {
        confirmed: true,
      }
    };
  }

  /** @asyncUnsafe */
  async $getOutspends(txId: string): Promise<IEsploraApi.Outspend[]> {
    const outSpends: IEsploraApi.Outspend[] = [];
    const tx = await this.$getRawTransaction(txId, true, false);
    for (let i = 0; i < tx.vout.length; i++) {
      if (tx.status && tx.status.block_height === 0) {
        outSpends.push({
          spent: false
        });
      } else {
        const txOut = await this.bitcoindClient.getTxOut(txId, i);
        outSpends.push({
          spent: txOut === null,
        });
      }
    }
    return outSpends;
  }

  /** @asyncUnsafe */
  async $getBatchedOutspends(txId: string[]): Promise<IEsploraApi.Outspend[][]> {
    const outspends: IEsploraApi.Outspend[][] = [];
    for (const tx of txId) {
      const outspend = await this.$getOutspends(tx);
      outspends.push(outspend);
    }
    return outspends;
  }

  async $getBatchedOutspendsInternal(txId: string[]): Promise<IEsploraApi.Outspend[][]> {
    return this.$getBatchedOutspends(txId);
  }

  /** @asyncUnsafe */
  async $getOutSpendsByOutpoint(outpoints: { txid: string, vout: number }[]): Promise<IEsploraApi.Outspend[]> {
    const outspends: IEsploraApi.Outspend[] = [];
    for (const outpoint of outpoints) {
      const outspend = await this.$getOutspend(outpoint.txid, outpoint.vout);
      outspends.push(outspend);
    }
    return outspends;
  }

  /** @asyncUnsafe */
  async $getCoinbaseTx(blockhash: string): Promise<IEsploraApi.Transaction> {
    const txids = await this.$getTxIdsForBlock(blockhash);
    return this.$getRawTransaction(txids[0]);
  }

  async $getAddressTransactionSummary(address: string): Promise<IEsploraApi.AddressTxSummary[]> {
    throw new Error('Method getAddressTransactionSummary not supported by the Bitcoin RPC API.');
  }

  $getEstimatedHashrate(blockHeight: number): Promise<number> {
    // 120 is the default block span in Core
    return this.bitcoindClient.getNetworkHashPs(120, blockHeight);
  }

  /** @asyncUnsafe */
  protected async $convertTransaction(transaction: IBitcoinApi.Transaction, addPrevout: boolean, lazyPrevouts = false, allowMissingPrevouts = false): Promise<IEsploraApi.Transaction> {
    let esploraTransaction: IEsploraApi.Transaction = {
      txid: transaction.txid,
      version: transaction.version,
      locktime: transaction.locktime,
      size: transaction.size,
      weight: transaction.weight,
      fee: 0,
      vin: [],
      vout: [],
      status: { confirmed: false },
    };

    esploraTransaction.vout = transaction.vout.map((vout) => {
      return {
        value: Math.round(vout.value * 100000000),
        scriptpubkey: vout.scriptPubKey.hex,
        scriptpubkey_address: vout.scriptPubKey && vout.scriptPubKey.address ? vout.scriptPubKey.address
          : vout.scriptPubKey.addresses ? vout.scriptPubKey.addresses[0] : '',
        scriptpubkey_asm: vout.scriptPubKey.asm ? transactionUtils.convertScriptSigAsm(vout.scriptPubKey.hex) : '',
        scriptpubkey_type: this.translateScriptPubKeyType(vout.scriptPubKey.type),
      };
    });

    esploraTransaction.vin = transaction.vin.map((vin) => {
      return {
        is_coinbase: !!vin.coinbase,
        prevout: null,
        scriptsig: vin.scriptSig && vin.scriptSig.hex || vin.coinbase || '',
        scriptsig_asm: vin.scriptSig ? transactionUtils.convertScriptSigAsm(vin.scriptSig.hex) : (vin.coinbase ? transactionUtils.convertScriptSigAsm(vin.coinbase) : ''),
        sequence: vin.sequence,
        txid: vin.txid || '',
        vout: vin.vout || 0,
        witness: vin.txinwitness || [],
        inner_redeemscript_asm: '',
        inner_witnessscript_asm: '',
      };
    });

    if (Number(transaction.confirmations) > 0) {
      esploraTransaction.status = {
        confirmed: true,
        block_height: blocks.getCurrentBlockHeight() - transaction.confirmations + 1,
        block_hash: transaction.blockhash,
        block_time: transaction.blocktime,
      };
    }

    if (addPrevout) {
      try {
        esploraTransaction = await this.$calculateFeeFromInputs(esploraTransaction, false, lazyPrevouts);
      } catch (e) {
        if (!allowMissingPrevouts) {
          throw e;
        }
      }
    } else if (!transaction.confirmations) {
      esploraTransaction = await this.$appendMempoolFeeData(esploraTransaction);
    }

    return esploraTransaction;
  }

  private translateScriptPubKeyType(outputType: string): string {
    const map = {
      'pubkey': 'p2pk',
      'pubkeyhash': 'p2pkh',
      'scripthash': 'p2sh',
      'witness_v0_keyhash': 'v0_p2wpkh',
      'witness_v0_scripthash': 'v0_p2wsh',
      'witness_v1_taproot': 'v1_p2tr',
      'nonstandard': 'nonstandard',
      'multisig': 'multisig',
      'anchor': 'anchor',
      'nulldata': 'op_return'
    };

    if (map[outputType]) {
      return map[outputType];
    } else {
      return 'unknown';
    }
  }

  /** @asyncUnsafe */
  private async $appendMempoolFeeData(transaction: IEsploraApi.Transaction): Promise<IEsploraApi.Transaction> {
    if (transaction.fee) {
      return transaction;
    }
    let mempoolEntry: IBitcoinApi.MempoolEntry;
    if (!mempool.isInSync() && !this.rawMempoolCache) {
      this.rawMempoolCache = await this.$getRawMempoolVerbose();
    }
    if (this.rawMempoolCache && this.rawMempoolCache[transaction.txid]) {
      mempoolEntry = this.rawMempoolCache[transaction.txid];
    } else {
      mempoolEntry = await this.$getMempoolEntry(transaction.txid);
    }
    transaction.fee = Math.round(mempoolEntry.fees.base * 100000000);
    return transaction;
  }

  /** @asyncUnsafe */
  protected async $addPrevouts(transaction: TransactionExtended): Promise<TransactionExtended> {
    const missingInputs = transaction.vin.filter((vin) => !vin.prevout);
    const prevouts = await this.$loadPrevouts(missingInputs);
    for (let i = 0; i < missingInputs.length; i++) {
      const vin = missingInputs[i];
      vin.prevout = prevouts[i];
      transactionUtils.addInnerScriptsToVin(vin);
    }
    if (missingInputs.length > 0) {
      // re-calculate transaction flags now that we have full prevout data
      transaction.flags = undefined; // clear existing flags to force full classification
      transaction.flags = Common.getTransactionFlags(transaction, transaction.status?.block_height ?? blocks.getCurrentBlockHeight());
    }
    return transaction;
  }

  /** @asyncUnsafe The caller owns any failed prevout read. */
  private async $loadPrevouts(
    inputs: ReadonlyArray<Pick<IEsploraApi.Vin, 'txid' | 'vout'>>,
  ): Promise<IEsploraApi.Vout[]> {
    const prevouts = new Array<IEsploraApi.Vout>(inputs.length);
    let nextIndex = 0;
    const workerCount = Math.min(this.rawTransactionController.concurrency, inputs.length);
    await Promise.all(Array.from({ length: workerCount },
      /** @asyncUnsafe The outer loader owns every worker rejection. */
      async () => {
        while (nextIndex < inputs.length) {
          const index = nextIndex;
          nextIndex += 1;
          const input = inputs[index];
          const innerTx = await this.$getRawTransaction(input.txid, false, false);
          prevouts[index] = innerTx.vout[input.vout];
        }
      }));
    return prevouts;
  }

  protected $returnCoinbaseTransaction(): Promise<IEsploraApi.Transaction> {
    return this.bitcoindClient.getBlockHash(0).then((hash: string) =>
      this.bitcoindClient.getBlock(hash, 2)
        .then((block: IBitcoinApi.Block) => {
          return this.$convertTransaction(Object.assign(block.tx[0], {
            confirmations: blocks.getCurrentBlockHeight() + 1,
            blocktime: block.time }), false);
        })
    );
  }

  private $getMempoolEntry(txid: string): Promise<IBitcoinApi.MempoolEntry> {
    return this.bitcoindClient.getMempoolEntry(txid);
  }

  private $getRawMempoolVerbose(): Promise<IBitcoinApi.RawMempool> {
    return this.bitcoindClient.getRawMemPool(true);
  }


  /** @asyncUnsafe */
  private async $calculateFeeFromInputs(transaction: IEsploraApi.Transaction, addPrevout: boolean, lazyPrevouts: boolean): Promise<IEsploraApi.Transaction> {
    if (transaction.vin[0].is_coinbase) {
      transaction.fee = 0;
      return transaction;
    }
    const requestedInputs = lazyPrevouts
      ? transaction.vin.slice(0, 13)
      : transaction.vin;
    const prevouts = await this.$loadPrevouts(requestedInputs);
    let totalIn = 0;
    for (let i = 0; i < requestedInputs.length; i++) {
      requestedInputs[i].prevout = prevouts[i];
      transactionUtils.addInnerScriptsToVin(requestedInputs[i]);
      totalIn += prevouts[i].value;
    }
    for (let i = requestedInputs.length; i < transaction.vin.length; i++) {
      transaction.vin[i].lazy = true;
    }
    if (lazyPrevouts && transaction.vin.length > 12) {
      transaction.fee = -1;
    } else {
      const totalOut = transaction.vout.reduce((p, output) => p + output.value, 0);
      transaction.fee = parseFloat((totalIn - totalOut).toFixed(8));
    }
    return transaction;
  }

  public startHealthChecks(): void {};

  public getHealthStatus() {
    return [];
  }
}

export default BitcoinApi;
