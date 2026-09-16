import bitcoinClient from '../bitcoin/bitcoin-client';
import mempool from '../mempool';
import { MempoolTransactionExtended } from '../../mempool.interfaces';
import intelligence from './mempool-intelligence';
import { descendantsOf } from './package-service';
import { incrementalFeeFrom, MempoolSourceUnavailable } from './source-unavailable';
import {
  planBump,
  signalsReplacement,
  type BumpOutput,
  type BumpPlan,
  type BumpTarget,
  type SpendableType,
} from './bump-planner';

/**
 * Builds a bump plan for a transaction this node's mempool holds.
 *
 * The mempool supplies everything except two node policy values, and those
 * are read rather than assumed: an incremental relay fee that is wrong makes
 * every replacement figure wrong by exactly the amount that matters, and
 * guessing whether the node replaces unsignalled transactions would close a
 * route that is open or open one that is not.
 */

/** Fee rates a caller may ask for, so one request cannot be an overflow. */
export const MAX_TARGET_FEERATE = 10_000;

/**
 * The spend size a script type fixes.
 *
 * Only the four where the type settles the spend are named. A bare script
 * hash, a multisig, a raw pubkey and anything nonstandard do not: the spend
 * depends on a script this node has not been shown, and a plausible size for
 * it would be a number with nothing behind it.
 */
export function spendableTypeOf(scriptPubKeyType: string | undefined): SpendableType {
  switch (scriptPubKeyType) {
    case 'p2pkh': return 'p2pkh';
    case 'v0_p2wpkh': return 'p2wpkh';
    case 'v0_p2wsh': return 'p2wsh';
    case 'v1_p2tr': return 'p2tr';
    default: return 'unknown';
  }
}

/** A whole, in range fee rate from a query string, or null. */
export function readTargetFeerate(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') { return null; }
  if (typeof raw !== 'string') { return null; }
  if (!/^[0-9]{1,6}(\.[0-9]{1,3})?$/.test(raw)) { return null; }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TARGET_FEERATE) { return null; }
  return value;
}

/**
 * Reads the two policy values a bump depends on.
 *
 * Missing policy fields cannot establish the policy of this node.
 * @asyncUnsafe Callers map missing policy evidence to unavailable.
 */
export async function $bumpPolicy(): Promise<{
  incrementalRelayFeeSatPerVb: number;
  fullReplacementEnabled: boolean;
}> {
  try {
    const info: any = await bitcoinClient.getMempoolInfo();
    const perVb = incrementalFeeFrom(info);
    if (typeof info?.fullrbf !== 'boolean') {
      throw new MempoolSourceUnavailable('The node did not report its replacement policy; bump planning is unavailable.');
    }
    return {
      incrementalRelayFeeSatPerVb: perVb,
      fullReplacementEnabled: info?.fullrbf === true,
    };
  } catch (e) {
    if (e instanceof MempoolSourceUnavailable) throw e;
    throw new MempoolSourceUnavailable('The node replacement policy could not be read; bump planning is unavailable.');
  }
}

/**
 * Assembles the target from the mempool.
 *
 * Returns null when the transaction is not unconfirmed here, which is a real
 * answer rather than a failure: a confirmed transaction cannot be bumped, and
 * neither can one this node has never seen.
 */
export function buildTarget(
  txid: string,
  pool: { [txid: string]: MempoolTransactionExtended },
  spendMap: Map<string, MempoolTransactionExtended>,
): BumpTarget | null {
  const tx = pool[txid];
  if (!tx) { return null; }
  const validSats = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2_100_000_000_000_000;
  const size = tx.adjustedVsize ?? tx.weight / 4;
  if (tx.txid !== txid || !validSats(tx.fee) || !Number.isSafeInteger(tx.weight) || tx.weight <= 0
    || !Number.isFinite(size) || size <= 0 || size > Number.MAX_SAFE_INTEGER
    || !Array.isArray(tx.vout) || tx.vout.length === 0 || !tx.vout.every(output => output && validSats(output.value))
    || !Array.isArray(tx.vin) || tx.vin.length === 0 || !tx.vin.every(input => input && Number.isSafeInteger(input.sequence) && input.sequence >= 0 && input.sequence <= 0xffffffff)) {
    throw new MempoolSourceUnavailable('Transaction fee, size, output or replacement evidence is unavailable.');
  }

  const outputs: BumpOutput[] = (tx.vout ?? []).map((vout: any, index: number) => ({
    index,
    valueSats: vout.value,
    type: spendableTypeOf(vout?.scriptpubkey_type),
    spent: spendMap.has(`${txid}:${index}`),
  }));

  // Everything descended from it, itself excluded: the planner adds this
  // transaction's own fee to the eviction total separately, and counting it
  // twice would double the price of every replacement.
  const descendants = descendantsOf(txid, pool, spendMap)
    .filter((entry) => entry.txid !== txid);

  // The ancestor totals come from the same engine the cluster pages use, so
  // the group a bump is priced against is the group those pages show.
  const cluster = intelligence.getPackageFor(pool, txid);
  const view = cluster?.cluster.transactions.find((entry) => entry.txid === txid);

  const vsize = tx.adjustedVsize ?? tx.weight / 4;
  if (!view || !Number.isFinite(view.ancestorVsize) || view.ancestorVsize < vsize
    || !validSats(view.ancestorFeeSats) || view.ancestorFeeSats < tx.fee
    || descendants.some(entry => !validSats(entry.feeSats) || !Number.isFinite(entry.vsize) || entry.vsize <= 0)) {
    throw new MempoolSourceUnavailable('Ancestor or descendant fee evidence is unavailable.');
  }
  return {
    txid,
    vsize,
    weight: tx.weight,
    feeSats: tx.fee,
    signalsReplacement: signalsReplacement(
      tx.vin.map((vin: any) => vin.sequence),
    ),
    outputs,
    ancestorVsize: view.ancestorVsize,
    ancestorFeeSats: view.ancestorFeeSats,
    descendants,
  };
}

export async function $planBumpFor(
  txid: string,
  targetFeerate: number,
): Promise<BumpPlan | null> {
  const target = buildTarget(txid, mempool.getMempool(), mempool.getSpendMap());
  if (!target) { return null; }
  const policy = await $bumpPolicy();
  return planBump(target, policy, targetFeerate);
}
