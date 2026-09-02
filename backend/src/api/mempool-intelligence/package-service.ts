import bitcoinClient from '../bitcoin/bitcoin-client';
import bitcoinApi from '../bitcoin/bitcoin-api-factory';
import mempool from '../mempool';
import { MempoolTransactionExtended } from '../../mempool.interfaces';
import intelligence from './mempool-intelligence';
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

const HEX = /^[0-9a-f]+$/i;

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
  if (btc === undefined || btc === null || !Number.isFinite(btc)) { return null; }
  return Math.round(btc * 100_000_000);
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
    if (item.length % 2 !== 0 || !HEX.test(item)) {
      return { status: 400, message: 'Every entry must be an even number of hexadecimal characters.' };
    }
    total += item.length;
  }
  if (total > MAX_TOTAL_HEX_LENGTH) {
    return { status: 400, message: 'That package is larger than this route will read.' };
  }
  const seen = new Set(raw as string[]);
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
 * amount that matters. One sat per vbyte is the default and the fallback.
 */
export async function $incrementalRelayFeeSatPerVb(): Promise<number> {
  try {
    const info = await bitcoinClient.getMempoolInfo();
    // Stated in bitcoin per kilo virtual byte.
    const perVb = (info?.incrementalrelayfee ?? 0) * 100_000_000 / 1000;
    return perVb > 0 ? perVb : 1;
  } catch (e) {
    return 1;
  }
}

/**
 * Decodes, judges and describes a package.
 */
export async function $simulate(rawTxs: string[]): Promise<PackageSimulation> {
  const decoded = await Promise.all(
    rawTxs.map((hex) => bitcoinClient.decodeRawTransaction(hex)),
  );

  const candidates: CandidateTx[] = decoded.map((tx: any) => ({
    txid: tx.txid,
    vsize: tx.vsize,
    weight: tx.weight,
    inputs: (tx.vin ?? [])
      // A coinbase input has no previous output to point at.
      .filter((vin: any) => typeof vin?.txid === 'string')
      .map((vin: any) => ({ txid: vin.txid, vout: vin.vout })),
    outputValuesSats: (tx.vout ?? []).map((vout: any) => toSats(vout?.value) ?? 0),
  }));

  // A failed test is not a failed request. The node refusing to judge the
  // package is itself the answer, and it is reported as a verdict on every
  // transaction rather than as a five hundred.
  let verdicts: NodeVerdict[];
  try {
    const results = await bitcoinApi.$testMempoolAccept(rawTxs);
    verdicts = results.map((result) => ({
      txid: result.txid,
      allowed: result.allowed === true,
      rejectReason: result['reject-reason'] ?? null,
      vsize: result.vsize ?? null,
      feeSats: toSats(result.fees?.base),
      effectiveFeerate: result.fees?.['effective-feerate'] !== undefined
        ? (toSats(result.fees['effective-feerate']) ?? 0) / 1000
        : null,
      effectiveIncludes: result.fees?.['effective-includes'] ?? [],
    }));
  } catch (e: any) {
    const reason = e?.message ? String(e.message) : 'The node did not judge this package.';
    verdicts = candidates.map((tx) => ({
      txid: tx.txid,
      allowed: false,
      rejectReason: reason,
      vsize: null,
      feeSats: null,
      effectiveFeerate: null,
      effectiveIncludes: [],
    }));
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
