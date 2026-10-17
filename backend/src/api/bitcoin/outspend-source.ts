import { IEsploraApi } from './esplora-api.interface';

/**
 * Who spent an output, read from an owned source.
 *
 * Bitcoin Core's UTXO set only says whether an output is spent. The spender
 * (txid, vin, status) comes from, in order:
 *   1. the owned Esplora-style electrs HTTP API (`GET /tx/:txid/outspends`);
 *   2. Bitcoin Core `gettxspendingprevout` with `-txospenderindex` (Core 31+).
 * Each answer is validated. A source that fails or answers out of contract
 * yields `null`, and the caller keeps the spent-flag-only behaviour.
 *
 * Per output the result is either a full Outspend the source stated, or
 * `null` meaning "not stated": the caller must then ask the UTXO set, so an
 * index that lags behind the node can never turn a spent output into
 * `spent: false`, and no spender is ever made up.
 */

export type OutspendHttpGet = (path: string) => Promise<{ status: number; data: unknown }>;
export type OutspendRpcCall = (method: string, params: unknown[]) => Promise<any>;

export interface SourceOutput {
  /** True when the output script is provably unspendable (OP_RETURN). */
  unspendable: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isHex64 = (value: unknown): value is string => typeof value === 'string' && HEX64.test(value);
const isIndex = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Retry an unreachable HTTP source only after this long. */
export const HTTP_RETRY_AFTER_MS = 60_000;

function validStatus(status: unknown): IEsploraApi.Status | null {
  if (!status || typeof status !== 'object') return null;
  const s = status as Record<string, unknown>;
  if (s.confirmed === false) return { confirmed: false };
  if (s.confirmed !== true || !isIndex(s.block_height) || !isHex64(s.block_hash)) return null;
  if (s.block_time !== undefined && !isIndex(s.block_time)) return null;
  return {
    confirmed: true,
    block_height: s.block_height,
    block_hash: s.block_hash,
    ...(s.block_time !== undefined ? { block_time: s.block_time as number } : {}),
  };
}

/** Esplora outspends answer, or null when it is out of contract. */
export function validateEsploraOutspends(data: unknown, outputs: SourceOutput[]): (IEsploraApi.Outspend | null)[] | null {
  if (!Array.isArray(data) || data.length !== outputs.length) return null;
  const result: (IEsploraApi.Outspend | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (!entry || typeof entry !== 'object' || typeof entry.spent !== 'boolean') return null;
    if (!entry.spent) {
      // An index can lag; only an unspendable output is known unspent from it.
      result.push(outputs[i].unspendable ? { spent: false } : null);
      continue;
    }
    if (!isHex64(entry.txid) || !isIndex(entry.vin)) return null;
    const status = validStatus(entry.status);
    if (!status) return null;
    result.push({ spent: true, txid: entry.txid, vin: entry.vin, status });
  }
  return result;
}

const rpcDomainError = (error: unknown): boolean => Number.isSafeInteger((error as { code?: unknown })?.code);

export class OutspendSource {
  private httpRetryAt = 0;
  /** undefined until the first answer; then fixed for the process lifetime. */
  private coreSpenderIndex: boolean | undefined;

  constructor(
    private readonly rpc: OutspendRpcCall,
    private readonly httpGet: OutspendHttpGet | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** False once no source can answer right now; lets callers skip the transaction read. */
  available(): boolean {
    return (!!this.httpGet && this.now() >= this.httpRetryAt) || this.coreSpenderIndex !== false;
  }

  /** Spenders for every output of `txid`, or null when no source answered. @asyncUnsafe */
  async $outspends(txid: string, outputs: SourceOutput[]): Promise<(IEsploraApi.Outspend | null)[] | null> {
    if (!isHex64(txid) || outputs.length === 0) return null;
    const fromHttp = await this.$fromHttp(txid, outputs);
    if (fromHttp) return fromHttp;
    return this.$fromCore(txid, outputs);
  }

  /** @asyncUnsafe */
  private async $fromHttp(txid: string, outputs: SourceOutput[]): Promise<(IEsploraApi.Outspend | null)[] | null> {
    if (!this.httpGet || this.now() < this.httpRetryAt) return null;
    let response: { status: number; data: unknown };
    try {
      response = await this.httpGet('/tx/' + txid + '/outspends');
    } catch (error) {
      if (!(error as { response?: unknown })?.response) this.httpRetryAt = this.now() + HTTP_RETRY_AFTER_MS;
      return null;
    }
    if (response.status !== 200) return null;
    return validateEsploraOutspends(response.data, outputs);
  }

  /** @asyncUnsafe */
  private async $fromCore(txid: string, outputs: SourceOutput[]): Promise<(IEsploraApi.Outspend | null)[] | null> {
    if (this.coreSpenderIndex === false) return null;
    const outpoints = outputs.map((_, vout) => ({ txid, vout }));
    let rows: unknown;
    try {
      rows = await this.rpc('gettxspendingprevout', [outpoints, { mempool_only: false }]);
    } catch (error) {
      // Method not found, unknown option or index disabled: a Core answer, so
      // remember it. Transport failures say nothing about the node's support.
      if (rpcDomainError(error)) this.coreSpenderIndex = false;
      return null;
    }
    if (!Array.isArray(rows) || rows.length !== outpoints.length) return null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.txid !== txid || row.vout !== i) return null;
      if (row.spendingtxid !== undefined && !isHex64(row.spendingtxid)) return null;
      if (row.blockhash !== undefined && !isHex64(row.blockhash)) return null;
    }
    this.coreSpenderIndex = true;

    const headers = new Map<string, Promise<any>>();
    const result: (IEsploraApi.Outspend | null)[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.spendingtxid === undefined) {
        result.push(outputs[i].unspendable ? { spent: false } : null);
        continue;
      }
      result.push(await this.$coreSpender(txid, i, row.spendingtxid, row.blockhash, headers));
    }
    return result;
  }

  /** The spender Core named, or `{ spent: true }` when its details cannot be proven. @asyncUnsafe */
  private async $coreSpender(txid: string, vout: number, spendingTxid: string, blockhash: string | undefined,
    headers: Map<string, Promise<any>>): Promise<IEsploraApi.Outspend> {
    try {
      const spender = await this.rpc('getrawtransaction', blockhash ? [spendingTxid, true, blockhash] : [spendingTxid, true]);
      if (!spender || spender.txid !== spendingTxid || !Array.isArray(spender.vin)) return { spent: true };
      const vin = spender.vin.findIndex((input: any) => input && input.txid === txid && input.vout === vout);
      if (vin < 0) return { spent: true };
      if (spender.blockhash === undefined) {
        // In the mempool. A spender Core placed in a block must stay confirmed.
        return blockhash ? { spent: true } : { spent: true, txid: spendingTxid, vin, status: { confirmed: false } };
      }
      if (!isHex64(spender.blockhash) || (blockhash && spender.blockhash !== blockhash)
        || spender.in_active_chain === false || !(Number(spender.confirmations) >= 1)) {
        return { spent: true };
      }
      if (!headers.has(spender.blockhash)) headers.set(spender.blockhash, this.rpc('getblockheader', [spender.blockhash, true]));
      const header = await headers.get(spender.blockhash);
      if (!header || header.hash !== spender.blockhash || !isIndex(header.height) || !isIndex(header.time)
        || !(Number(header.confirmations) >= 1)) {
        return { spent: true };
      }
      return {
        spent: true,
        txid: spendingTxid,
        vin,
        status: { confirmed: true, block_height: header.height, block_hash: header.hash, block_time: header.time },
      };
    } catch {
      return { spent: true };
    }
  }
}
