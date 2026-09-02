import bitcoinClient from '../bitcoin/bitcoin-client';
import mempool from '../mempool';
import { MempoolTransactionExtended } from '../../mempool.interfaces';
import intelligence from './mempool-intelligence';
import { descendantsOf } from './package-service';
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
 * `fullrbf` is absent on a node old enough not to have the setting, and its
 * absence is read as off. That is what it meant on those releases, and
 * reading it as on would report a route as open that the node would refuse.
 *
 * @asyncSafe Falls back to the conservative pair rather than rejecting.
 */
export async function $bumpPolicy(): Promise<{
  incrementalRelayFeeSatPerVb: number;
  fullReplacementEnabled: boolean;
}> {
  try {
    const info: any = await bitcoinClient.getMempoolInfo();
    const perVb = (info?.incrementalrelayfee ?? 0) * 100_000_000 / 1000;
    return {
      incrementalRelayFeeSatPerVb: perVb > 0 ? perVb : 1,
      fullReplacementEnabled: info?.fullrbf === true,
    };
  } catch (e) {
    return { incrementalRelayFeeSatPerVb: 1, fullReplacementEnabled: false };
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

  const outputs: BumpOutput[] = (tx.vout ?? []).map((vout: any, index: number) => ({
    index,
    valueSats: vout?.value ?? 0,
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
  return {
    txid,
    vsize,
    weight: tx.weight,
    feeSats: tx.fee,
    signalsReplacement: signalsReplacement(
      (tx.vin ?? []).map((vin: any) => vin?.sequence ?? 0xffffffff),
    ),
    outputs,
    ancestorVsize: view?.ancestorVsize ?? vsize,
    ancestorFeeSats: view?.ancestorFeeSats ?? tx.fee,
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
