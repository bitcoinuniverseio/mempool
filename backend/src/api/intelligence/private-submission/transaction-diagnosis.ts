import { Transaction } from 'bitcoinjs-lib';
import { IBitcoinApi } from '../../bitcoin/bitcoin-api.interface';
import memPool from '../../mempool';
import rbfCache from '../../rbf-cache';
import { MempoolTransactionExtended } from '../../../mempool.interfaces';
import { SubmissionDiagnosisResult, SubmissionMethod } from './private-submission.models';

/**
 * Acceleration diagnosis from the owned mempool: the transaction's own
 * entry (fee, size, ancestors, descendants, CPFP effect, RBF signalling,
 * replacements this backend recorded) and the owned node's policy floor.
 *
 * A transaction this backend's mempool does not hold has no facts to
 * diagnose, and says so; nothing is estimated from the txid.
 */

export class DiagnosisNotFound extends Error {
  constructor(public readonly txid: string) {
    super('This backend\'s mempool holds no entry for that transaction; nothing about its fee, policy or package state is observed.');
  }
}

export interface DiagnosisReaders {
  mempoolEntry: (txid: string) => MempoolTransactionExtended | undefined;
  mempoolInfo: () => Pick<IBitcoinApi.MempoolInfo, 'mempoolminfee' | 'minrelaytxfee' | 'loaded'> | null;
  replaces: (txid: string) => string[] | undefined;
  replacedBy: (txid: string) => string | undefined;
}

export const ownedDiagnosisReaders: DiagnosisReaders = {
  mempoolEntry: txid => memPool.getMempool()[txid],
  mempoolInfo: () => memPool.getMempoolInfo(),
  replaces: txid => rbfCache.getReplaces(txid),
  replacedBy: txid => rbfCache.getReplacedBy(txid),
};

const BTC_PER_KVB_TO_SAT_PER_VB = 100_000;

/** The txid of a raw transaction, or the input itself when it already is one. */
export function txidOf(rawTxOrTxid: string): string {
  if (/^[0-9a-f]{64}$/i.test(rawTxOrTxid)) { return rawTxOrTxid.toLowerCase(); }
  return Transaction.fromHex(rawTxOrTxid).getId();
}

export function diagnoseFromOwnedMempool(rawTxOrTxid: string, readers: DiagnosisReaders = ownedDiagnosisReaders): SubmissionDiagnosisResult {
  const txid = txidOf(rawTxOrTxid);
  const entry = readers.mempoolEntry(txid);
  if (!entry) { throw new DiagnosisNotFound(txid); }
  const info = readers.mempoolInfo();
  const vsize = entry.vsize;
  const feerate = vsize > 0 ? entry.fee / vsize : 0;
  const effective = typeof entry.effectiveFeePerVsize === 'number' && Number.isFinite(entry.effectiveFeePerVsize) ? entry.effectiveFeePerVsize : feerate;
  const ancestors = entry.ancestors ?? [];
  const descendants = entry.descendants ?? [];
  const minFloorSatVb = info && Number.isFinite(info.mempoolminfee) ? info.mempoolminfee * BTC_PER_KVB_TO_SAT_PER_VB : null;
  const rbfSignalling = entry.vin.some(vin => typeof vin.sequence === 'number' && vin.sequence < 0xfffffffe);
  const replaces = readers.replaces(txid) ?? [];
  const replacedBy = readers.replacedBy(txid) ?? null;
  const round = (value: number): number => Math.round(value * 100) / 100;
  const methods: SubmissionMethod[] = ['public_p2p'];
  return {
    txid,
    vsize,
    feerate_sats_vb: round(feerate),
    is_mempool_present: true,
    is_policy_compliant: minFloorSatVb === null ? effective > 0 : effective >= minFloorSatVb,
    rbf_eligible: rbfSignalling,
    cpfp_eligible: descendants.length === 0 && (entry.bestDescendant === null || entry.bestDescendant === undefined),
    has_conflicts: replaces.length > 0 || replacedBy !== null,
    acceleration_recommended: entry.position ? entry.position.block > 0 : false,
    privacy_advisory: 'Diagnosis is from this backend\'s own mempool entry and policy floor; no third party was consulted.',
    available_methods: methods,
    package: {
      effective_feerate_sats_vb: round(effective),
      ancestor_count: ancestors.length,
      descendant_count: descendants.length,
      ancestor_fee_sats: ancestors.reduce((sum, a) => sum + a.fee, 0),
      ancestor_weight: ancestors.reduce((sum, a) => sum + a.weight, 0),
      cpfp_boosted: effective > feerate + 1e-9,
      cpfp_checked: entry.cpfpChecked === true,
      best_descendant_txid: entry.bestDescendant?.txid ?? null,
      projected_block_index: entry.position ? entry.position.block : null,
    },
    policy: {
      source: 'owned Core getmempoolinfo via this backend',
      mempool_min_fee_sats_vb: minFloorSatVb === null ? null : round(minFloorSatVb),
      min_relay_fee_sats_vb: info && Number.isFinite(info.minrelaytxfee) ? round(info.minrelaytxfee * BTC_PER_KVB_TO_SAT_PER_VB) : null,
      mempool_loaded: info?.loaded ?? null,
    },
    replacement: {
      signals_rbf: rbfSignalling,
      replaces_txids: replaces,
      replaced_by_txid: replacedBy,
      is_replacement: entry.replacement === true,
    },
    observed_at_utc: new Date().toISOString(),
    first_seen_utc: typeof entry.firstSeen === 'number' ? new Date(entry.firstSeen * 1000).toISOString() : null,
    scope: 'Facts of one owned mempool entry at read time. Confirmation, propagation and the policy of other nodes are not measured here.',
  };
}
