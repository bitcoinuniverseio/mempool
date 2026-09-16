import bitcoinClient from '../bitcoin/bitcoin-client';
import bitcoinApi from '../bitcoin/bitcoin-api-factory';
import mempool from '../mempool';
import { MempoolTransactionExtended } from '../../mempool.interfaces';
import intelligence from './mempool-intelligence';
import { incrementalFeeFrom, MempoolSourceUnavailable } from './source-unavailable';
import {
  simulatePackage,
  type CandidateTx,
  type ConflictingTx,
  type MempoolLookup,
  type NodeVerdict,
  type PackageSimulation,
} from './package-simulator';

/**
 * Runs a package through the node and this process's mempool.
 *
 * The node decodes and judges; this file supplies the mempool half of the
 * answer and joins the two. Nothing here reimplements a decoder or a policy
 * rule: a second decoder is a second answer that can disagree with the first,
 * and a policy rule copied out of Bitcoin Core is a rule that stops being
 * true the next time Core changes it.
 */

/** Most transactions a caller may submit at once, matching the relay limit. */
export const MAX_PACKAGE_SIZE = 25;
/** Largest total hex a caller may submit, so one request cannot be a payload. */
export const MAX_TOTAL_HEX_LENGTH = 4_000_000;

const NON_HEX = /[^0-9a-f]/i;

export interface PackageRequestError {
  readonly status: number;
  readonly message: string;
}

/**
 * Turns the fee rate diagram back into the groups it was drawn from.
 *
 * The diagram is cumulative, so each step is one group: the rise in size is
 * the group's size and the point carries the group's rate. Deriving them here
 * rather than building the mempool a second time keeps the queue position in
 * exactly the same terms the diagram page shows.
 */
export function chunksFromDiagram(
  points: readonly { vsize: number; feerate: number | null }[],
): { feerate: number; vsize: number }[] {
  const chunks: { feerate: number; vsize: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const rate = points[i].feerate;
    if (rate === null) { continue; }
    chunks.push({ feerate: rate, vsize: points[i].vsize - points[i - 1].vsize });
  }
  return chunks;
}

/** Satoshis from a Bitcoin Core amount, which is stated in whole bitcoin. */
function toSats(btc: number | undefined | null): number | null {
  if (typeof btc !== 'number' || !Number.isFinite(btc) || btc < 0 || btc > 21_000_000) { return null; }
  const sats = Math.round(btc * 100_000_000);
  return Number.isSafeInteger(sats) && Math.abs(btc * 100_000_000 - sats) <= Math.max(1e-7, sats * Number.EPSILON) ? sats : null;
}

/**
 * Checks the request before any of it reaches the node.
 *
 * A node given twenty megabytes of hex will spend real time deciding it is
 * not a transaction, and that time is taken from every other caller.
 */
export function validateRawTxs(raw: unknown): PackageRequestError | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { status: 400, message: 'Send an array of raw transactions in hexadecimal.' };
  }
  if (raw.length > MAX_PACKAGE_SIZE) {
    return {
      status: 400,
      message: `A package is at most ${MAX_PACKAGE_SIZE} transactions, which is the limit a node will relay as one.`,
    };
  }
  let total = 0;
  for (const item of raw) {
    if (typeof item !== 'string' || !item.length) {
      return { status: 400, message: 'Every entry must be a raw transaction in hexadecimal.' };
    }
    total += item.length;
    if (total > MAX_TOTAL_HEX_LENGTH) {
      return { status: 400, message: 'That package is larger than this route will read.' };
    }
    if (item.length % 2 !== 0 || NON_HEX.test(item)) {
      return { status: 400, message: 'Every entry must be an even number of hexadecimal characters.' };
    }
  }
  const seen = new Set((raw as string[]).map(hex => hex.toLowerCase()));
  if (seen.size !== raw.length) {
    return { status: 400, message: 'The same transaction appears twice in this package.' };
  }
  return null;
}

/**
 * Everything descended from one mempool transaction, itself included.
 *
 * A replacement takes the descendants with it, because they spend outputs
 * that stop existing. Walking the spend map forward is how that set is found
 * without asking the node for a descendant list it would have to build.
 */
export function descendantsOf(
  txid: string,
  pool: { [txid: string]: MempoolTransactionExtended },
  spendMap: Map<string, MempoolTransactionExtended>,
): ConflictingTx[] {
  const found = new Map<string, MempoolTransactionExtended>();
  const stack = [txid];
  while (stack.length) {
    const current = stack.pop() as string;
    if (found.has(current)) { continue; }
    const tx = pool[current];
    if (!tx) { continue; }
    found.set(current, tx);
    for (let vout = 0; vout < (tx.vout?.length ?? 0); vout++) {
      const child = spendMap.get(`${current}:${vout}`);
      if (child && !found.has(child.txid)) { stack.push(child.txid); }
    }
  }
  return [...found.values()].map((tx) => ({
    txid: tx.txid,
    feeSats: tx.fee,
    // The adjusted size is what the mining code charges, so it is the size a
    // replacement has to outbid. The plain vsize would understate it.
    vsize: tx.adjustedVsize ?? tx.weight / 4,
  }));
}

function lookupFor(
  pool: { [txid: string]: MempoolTransactionExtended },
  spendMap: Map<string, MempoolTransactionExtended>,
): MempoolLookup {
  return {
    spender: (txid, vout) => {
      const tx = spendMap.get(`${txid}:${vout}`);
      if (!tx) { return null; }
      return {
        txid: tx.txid,
        feeSats: tx.fee,
        vsize: tx.adjustedVsize ?? tx.weight / 4,
      };
    },
    descendants: (txid) => descendantsOf(txid, pool, spendMap),
    has: (txid) => pool[txid] !== undefined,
    outputValue: (txid, vout) => pool[txid]?.vout?.[vout]?.value ?? null,
  };
}

/**
 * The node's incremental relay fee, in satoshis per virtual byte.
 *
 * Read from the node rather than assumed, because it is a configurable and a
 * replacement calculation built on the wrong one is wrong by exactly the
 * amount that matters. Unavailable policy is not replaced with a default.
 *
 * @asyncUnsafe Callers report unavailable policy explicitly.
 */
export async function $incrementalRelayFeeSatPerVb(): Promise<number> {
  try {
    const info = await bitcoinClient.getMempoolInfo();
    // Stated in bitcoin per kilo virtual byte.
    return incrementalFeeFrom(info);
  } catch (e) {
    if (e instanceof MempoolSourceUnavailable) throw e;
    throw new MempoolSourceUnavailable('The node incremental relay fee could not be read; package planning is unavailable.');
  }
}

/**
 * Decodes, judges and describes a package.
 *
 * @asyncUnsafe A transaction the node cannot decode rejects here, and the
 * route turns that into a four hundred carrying the node's own words. Caught
 * and flattened into a result, that answer would arrive as a five hundred
 * saying nothing, which is the wrong answer to a caller's malformed input.
 */
export async function $simulate(rawTxs: string[]): Promise<PackageSimulation> {
  const decoded = await Promise.all(rawTxs.map(async (hex) => {
    try { return await bitcoinClient.decodeRawTransaction(hex); }
    catch (error: any) {
      if (error?.code === -22) throw error;
      throw new MempoolSourceUnavailable('The node decoder is unavailable; transaction validity is unknown.');
    }
  }));
  const txidShape = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  for (const tx of decoded as any[]) {
    if (!tx || !txidShape(tx.txid) || !Number.isSafeInteger(tx.vsize) || tx.vsize <= 0
      || !Number.isSafeInteger(tx.weight) || tx.weight <= 0 || Math.ceil(tx.weight / 4) !== tx.vsize
      || !Array.isArray(tx.vin) || tx.vin.length === 0
      || !tx.vin.every((vin: any) => vin && (typeof vin.coinbase === 'string' || (txidShape(vin.txid) && Number.isSafeInteger(vin.vout) && vin.vout >= 0 && vin.vout <= 0xffffffff)))
      || !Array.isArray(tx.vout) || tx.vout.length === 0
      || !tx.vout.every((vout: any) => vout && toSats(vout.value) !== null)) {
      throw new MempoolSourceUnavailable('The node decoder returned an incomplete transaction schema; package analysis is unavailable.');
    }
  }

  const candidates: CandidateTx[] = decoded.map((tx: any) => ({
    txid: tx.txid,
    vsize: tx.vsize,
    weight: tx.weight,
    inputs: (tx.vin ?? [])
      // A coinbase input has no previous output to point at.
      .filter((vin: any) => typeof vin?.txid === 'string')
      .map((vin: any) => ({ txid: vin.txid, vout: vin.vout })),
    outputValuesSats: tx.vout.map((vout: any) => toSats(vout.value) as number),
  }));

  // A source failure is not a transaction rejection. Require a distinct,
  // explicit node verdict for each decoded transaction before deriving results.
  let verdicts: NodeVerdict[];
  try {
    const results = await bitcoinApi.$testMempoolAccept(rawTxs);
    const expected = new Set(candidates.map(tx => tx.txid));
    if (!Array.isArray(results) || results.length !== candidates.length || expected.size !== candidates.length
      || new Set(results.map(result => result?.txid)).size !== candidates.length
      || results.some(result => !result || !expected.has(result.txid) || typeof result.allowed !== 'boolean'
        || (result.vsize !== undefined && (!Number.isSafeInteger(result.vsize) || result.vsize <= 0))
        || (result.fees?.base !== undefined && toSats(result.fees.base) === null)
        || (result.fees?.['effective-feerate'] !== undefined && (typeof result.fees['effective-feerate'] !== 'number' || !Number.isFinite(result.fees['effective-feerate']) || result.fees['effective-feerate'] < 0 || result.fees['effective-feerate'] > 21_000_000))
        || (result.fees?.['effective-includes'] !== undefined && (!Array.isArray(result.fees['effective-includes']) || !result.fees['effective-includes'].every(txidShape))))) {
      throw new MempoolSourceUnavailable('The node did not supply a complete transaction-bound acceptance verdict; package acceptance is unknown.');
    }
    verdicts = results.map((result) => ({
      txid: result.txid,
      allowed: result.allowed === true,
      rejectReason: result['reject-reason'] ?? null,
      vsize: result.vsize ?? null,
      feeSats: toSats(result.fees?.base),
      effectiveFeerate: result.fees?.['effective-feerate'] !== undefined
        ? result.fees['effective-feerate'] * 100_000
        : null,
      effectiveIncludes: result.fees?.['effective-includes'] ?? [],
    }));
  } catch (e: any) {
    if (e instanceof MempoolSourceUnavailable) throw e;
    throw new MempoolSourceUnavailable('The node could not judge this package; acceptance is unknown.');
  }

  const pool = mempool.getMempool();
  const incrementalRelayFeeSatPerVb = await $incrementalRelayFeeSatPerVb();
  const diagram = intelligence.getDiagram(pool);

  return simulatePackage({
    candidates,
    verdicts,
    mempool: lookupFor(pool, mempool.getSpendMap()),
    policy: { incrementalRelayFeeSatPerVb },
    mempoolChunks: chunksFromDiagram(diagram.points),
  });
}
