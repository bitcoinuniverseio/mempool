import axios from 'axios';
import http from 'http';
import { AddressSourceCheckpoint, verifyAddressSource } from './address-source-checkpoint';
import { addressHistoryProblems, addressSummaryProblems } from './esplora-contract';
import { IEsploraApi } from './esplora-api.interface';
import { AddressReadDiagnosticOptions, AddressReadFailure, AddressReadPhase, AddressReadTrace, addressReadFailure } from './address-read-diagnostic';

type CheckpointReader = (height: number, hash: (height: number, signal?: AbortSignal) => Promise<unknown>, signal: AbortSignal) => Promise<AddressSourceCheckpoint>;
type BalanceReader = (signal: AbortSignal) => Promise<{ confirmed: number; unconfirmed: number }>;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const mismatch = (): Error => Object.assign(new Error('Address source disagreement'), { code: 'EADDRESSSOURCE' });

/** Bound lag using the Core observations already made by the existing proof. */
export function verifyAddressHttpSource(height: number, readHash: (height: number, signal?: AbortSignal) => Promise<unknown>,
  core: { rpc: { call: (method: string, params: unknown[], options: { signal?: AbortSignal }) => Promise<unknown> } }, signal: AbortSignal,
  maximumBehind = 2): Promise<AddressSourceCheckpoint> {
  if (!Number.isSafeInteger(maximumBehind) || maximumBehind < 0) {throw new Error('Invalid address HTTP maximum lag');}
  return verifyAddressSource(height, readHash, { rpc: { call: /** @asyncUnsafe */ async (method: string, params: unknown[], options: { signal?: AbortSignal }) => {
    const value = await core.rpc.call(method, params, options);
    const info = value as { blocks?: number } | null;
    if (method === 'getblockchaininfo' && typeof info?.blocks === 'number' && Number.isSafeInteger(info.blocks) && height < info.blocks - maximumBehind) {throw mismatch();}
    return value;
  } } }, 15000, signal);
}

/** Explicit operated native HTTP reader. No fallback, timer, full-history read or UTXO path. */
export class AddressHttpReader {
  private readonly origin: string;
  private readonly connection = axios.create({
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 1, maxTotalSockets: 1 }),
    proxy: false, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024,
    responseType: 'text', transformResponse: [], timeout: 15000,
    headers: { 'Cache-Control': 'no-store' },
  });
  constructor(url: string, private readonly verify: CheckpointReader, private readonly budgetMs = 15000,
    private readonly diagnostic: AddressReadDiagnosticOptions = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('ADDRESS_HTTP_URL requires an explicit operated loopback HTTP origin');
    }
    this.origin = parsed.origin;
  }

  /** @asyncUnsafe Caller owns the bounded operation and handles rejection. */
  private async read(path: string, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) {throw new Error('Address HTTP timeout or cancellation');}
    const response = await this.connection.get<string>(this.origin + path, { signal });
    if (signal.aborted) {throw new Error('Address HTTP timeout or cancellation');}
    if (path.startsWith('/block-height/') && hash(response.data.trim())) {return response.data.trim();}
    return JSON.parse(response.data);
  }

  /** @asyncUnsafe */
  private async checkpoint(signal: AbortSignal): Promise<AddressSourceCheckpoint> {
    const raw = await this.read('/blocks/tip/height', signal);
    if (!Number.isSafeInteger(raw) || (raw as number) < 0) {throw mismatch();}
    return this.verify(raw as number, (height, selectedSignal) => this.read('/block-height/' + height, selectedSignal || signal), signal);
  }

  private async run<T>(read: (signal: AbortSignal, checkpoint: AddressSourceCheckpoint, phase: (value: AddressReadPhase) => void) => Promise<T>, caller?: AbortSignal,
    trace?: AddressReadTrace): Promise<T> {
    const controller = new AbortController();
    let cancellation: AddressReadFailure | null = null;
    const cancel = (): void => { cancellation ??= 'caller-cancelled'; controller.abort(); };
    if (caller?.aborted) {cancel();} else {caller?.addEventListener('abort', cancel, { once: true });}
    const timer = setTimeout(() => { cancellation ??= 'operation-deadline'; controller.abort(); }, this.budgetMs);
    const aborted = new Promise<never>((_, reject) => {
      const fail = (): void => reject(Object.assign(new Error('Address HTTP timeout or cancellation'), { code: 'ETIMEDOUT' }));
      if (controller.signal.aborted) {fail();} else {controller.signal.addEventListener('abort', fail, { once: true });}
    });
    try {
      return await Promise.race([aborted, Promise.resolve().then(async () => {
        if (controller.signal.aborted) {throw new Error('Address HTTP timeout or cancellation');}
        trace?.mark('checkpoint-before');
        const before = await this.checkpoint(controller.signal);
        const value = await read(controller.signal, before, phase => trace?.mark(phase));
        trace?.mark('checkpoint-after');
        const after = await this.checkpoint(controller.signal);
        if (controller.signal.aborted || ['network', 'genesisHash', 'blockHeight', 'blockHash', 'signetChallenge'].some(key => before[key] !== after[key])) {throw mismatch();}
        return value;
      })]);
    } catch (error) {
      trace?.failure(cancellation ?? addressReadFailure(error));
      throw error;
    } finally {
      trace?.close();
      clearTimeout(timer); caller?.removeEventListener('abort', cancel); controller.abort();
    }
  }

  summary(address: string, balance: BalanceReader, signal?: AbortSignal,
    validate?: (signal: AbortSignal) => Promise<void>): Promise<IEsploraApi.Address> {
    const trace = new AddressReadTrace(this.budgetMs, this.diagnostic.report ?? (/** @asyncUnsafe The trace handles reporter rejection. */ async (record): Promise<void> => {
      // Reuse the existing private logger; no eager producer/provider import.
      const { default: logger } = await import('../../logger');
      logger.warn(JSON.stringify(record), 'address-read');
    }), this.diagnostic.now);
    return this.run(/** @asyncUnsafe */ async (active, _checkpoint, phase) => {
      const path = '/address/' + encodeURIComponent(address);
      if (validate) { phase('address-validation'); await validate(active); }
      phase('balance-first');
      let observed = await balance(active);
      phase('http-summary-first');
      const first = await this.read(path, active);
      if (addressSummaryProblems(first, address).length) {throw mismatch();}
      const value = first as IEsploraApi.Address;
      if (value.chain_stats.funded_txo_count < value.chain_stats.spent_txo_count
        || value.chain_stats.funded_txo_sum < value.chain_stats.spent_txo_sum) {throw mismatch();}
      for (let round = 0; round < 2; round++) {
        if (!Number.isSafeInteger(observed?.confirmed) || observed.confirmed < 0 || !Number.isSafeInteger(observed?.unconfirmed)
          || BigInt(value.chain_stats.funded_txo_sum) - BigInt(value.chain_stats.spent_txo_sum) !== BigInt(observed.confirmed)
          || BigInt(value.mempool_stats.funded_txo_sum) - BigInt(value.mempool_stats.spent_txo_sum) !== BigInt(observed.unconfirmed)) {throw mismatch();}
        if (round === 0) {
          phase('http-summary-repeat');
          if (JSON.stringify(await this.read(path, active)) !== JSON.stringify(first)) {throw mismatch();}
          phase('balance-repeat');
          observed = await balance(active);
        }
      }
      return { ...value, electrum: true };
    }, signal, trace);
  }

  history(address: string, cursor: string, signal?: AbortSignal, validate?: (signal: AbortSignal) => Promise<void>): Promise<IEsploraApi.Transaction[]> {
    if (cursor && !hash(cursor)) {return Promise.reject(new Error('Invalid address transaction cursor'));}
    const path = '/address/' + encodeURIComponent(address) + '/txs?max_txs=10' + (cursor ? '&after_txid=' + cursor : '');
    return this.run(/** @asyncUnsafe */ async (active, checkpoint) => {
      if (validate) {await validate(active);}
      const first = await this.read(path, active);
      if (addressHistoryProblems(first, 10).length) {throw mismatch();}
      const rows = first as IEsploraApi.Transaction[];
      if (new Set(rows.map(row => row.txid)).size !== rows.length || rows.some(row => row.txid === cursor
        || row.status.confirmed && (row.status.block_height ?? Infinity) > checkpoint.blockHeight
        || !Number.isSafeInteger(row.fee) || row.fee < 0 || !Number.isSafeInteger(row.weight) || row.weight < 1
        || row.vout.some(output => !Number.isSafeInteger(output.value) || output.value < 0 || output.value > 21000000 * 100000000)
        || row.vin.some(input => input.prevout && (!Number.isSafeInteger(input.prevout.value) || input.prevout.value < 0 || input.prevout.value > 21000000 * 100000000)))) {throw mismatch();}
      for (let index = 1; index < rows.length; index++) {
        const previous = rows[index - 1].status, current = rows[index].status;
        if (previous.confirmed && (!current.confirmed || (current.block_height ?? Infinity) > (previous.block_height ?? -Infinity))) {throw mismatch();}
      }
      if (JSON.stringify(await this.read(path, active)) !== JSON.stringify(first)) {throw mismatch();}
      return rows;
    }, signal);
  }
}
