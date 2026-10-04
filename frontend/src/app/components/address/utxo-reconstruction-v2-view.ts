import { checkedReconstructionOutputs, UtxoReconstructionView } from './utxo-reconstruction-view';

type Stats = { funded_txo_count: number; spent_txo_count: number; funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
type Checkpoint = Omit<UtxoReconstructionView['source'], 'mempoolIdentity' | 'sourceId' | 'scriptPubKey'>;
export interface UtxoReconstructionV2View {
  schema: 'universe-address-utxo-reconstruction-v2'; sessionId: string; cursor: number; address: string; network: string;
  status: UtxoReconstructionView['status']; reason?: string; observedAt: string; expiresAt: string;
  confirmedAnchor: Omit<UtxoReconstructionView['source'], 'mempoolIdentity'> & { chainStats: Stats };
  latestObservedTip: Checkpoint;
  mempoolAnchor: { identity: string; observedAt: string; checkpoint: Checkpoint; addressMempoolStats: Stats } | null;
  progress: Omit<UtxoReconstructionView['progress'], 'phase' | 'mempoolTransactionsExpected'> & {
    phase: 'confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete'; pageLimit: 100;
    mempoolEpoch: number; mempoolTransactionsExpected: number | null;
  };
  result?: UtxoReconstructionView['result'];
}
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown) => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const stats = (value: Stats) => value && ['funded_txo_count','spent_txo_count','funded_txo_sum','spent_txo_sum','tx_count'].every(key => count(value[key]))
  && value.funded_txo_sum <= 2100000000000000 && value.spent_txo_sum <= 2100000000000000;
const identity = (view: UtxoReconstructionV2View) => JSON.stringify([view.confirmedAnchor.genesisHash,view.confirmedAnchor.blockHash,
  view.confirmedAnchor.blockHeight,view.confirmedAnchor.network,view.confirmedAnchor.signetChallenge,view.confirmedAnchor.sourceId,
  view.confirmedAnchor.scriptPubKey,view.confirmedAnchor.chainStats,view.confirmedAnchor.verifiedAt]);
const checkpointKey = (value: Checkpoint) => JSON.stringify([value.genesisHash,value.blockHash,value.blockHeight,value.network,value.signetChallenge]);
const checkpoint = (value: Checkpoint, anchor: UtxoReconstructionV2View['confirmedAnchor']) => value && hash(value.blockHash)
  && count(value.blockHeight) && value.blockHeight >= anchor.blockHeight && date(value.verifiedAt)
  && value.genesisHash === anchor.genesisHash && value.network === anchor.network && value.signetChallenge === anchor.signetChallenge;

export function checkedReconstructionV2(value: unknown, address: string, network: string,
  previous?: UtxoReconstructionV2View, action: 'create'|'next'|'cancel' = 'create'): UtxoReconstructionV2View {
  const view = value as UtxoReconstructionV2View;
  if (!['mainnet','testnet','testnet4','signet','regtest'].includes(network) || !view || view.schema !== 'universe-address-utxo-reconstruction-v2'
    || view.address !== address || view.network !== network || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(view.sessionId)
    || !count(view.cursor) || !['PARTIAL','COMPLETE_AT_OBSERVED_TIP','INVALIDATED','CANCELLED','BLOCKED'].includes(view.status)
    || !date(view.observedAt) || !date(view.expiresAt) || Date.parse(view.expiresAt) <= Date.parse(view.observedAt)
    || view.reason != null && (typeof view.reason !== 'string' || view.reason.length > 4096)) throw Error('V2 receipt does not match this address and network.');
  const anchor = view.confirmedAnchor, p = view.progress, m = view.mempoolAnchor;
  if (!anchor || anchor.network !== network || !hash(anchor.genesisHash) || !hash(anchor.blockHash) || !hash(anchor.sourceId)
    || !count(anchor.blockHeight) || !date(anchor.verifiedAt) || !stats(anchor.chainStats)
    || typeof anchor.scriptPubKey !== 'string' || !/^(?:[a-f0-9]{2}){1,10000}$/.test(anchor.scriptPubKey)
    || (network === 'signet' ? typeof anchor.signetChallenge !== 'string' || !/^(?:[a-f0-9]{2}){1,10000}$/.test(anchor.signetChallenge) : anchor.signetChallenge !== null)) throw Error('V2 confirmed anchor is invalid.');
  if (!checkpoint(view.latestObservedTip, anchor) || view.latestObservedTip.blockHeight === anchor.blockHeight && view.latestObservedTip.blockHash !== anchor.blockHash) throw Error('V2 latest shared tip is inconsistent with its immutable confirmed anchor.');
  if (!p || !['confirmed','acquire-mempool','mempool','outspends','complete'].includes(p.phase) || p.pageLimit !== 100 || !count(p.mempoolEpoch)
    || ![p.confirmedTransactionsProcessed,p.confirmedTransactionsExpected,p.mempoolTransactionsProcessed,p.candidateOutputs,p.verifiedOutputs,p.retainedBytes].every(count)
    || p.mempoolTransactionsExpected !== null && !count(p.mempoolTransactionsExpected)
    || p.confirmedTransactionsExpected !== anchor.chainStats.tx_count || p.confirmedTransactionsProcessed > p.confirmedTransactionsExpected
    || p.confirmedTransactionsExpected + (p.mempoolTransactionsExpected ?? 0) > 100000 || (p.mempoolTransactionsExpected ?? 0) > 500
    || p.mempoolTransactionsProcessed > (p.mempoolTransactionsExpected ?? 0) || p.candidateOutputs > 100000
    || ['PARTIAL','COMPLETE_AT_OBSERVED_TIP'].includes(view.status) && p.verifiedOutputs > p.candidateOutputs
    || p.retainedBytes > 32 * 1024 * 1024) throw Error('V2 progress exceeds its bounded contract.');
  const terminal = ['INVALIDATED','CANCELLED','BLOCKED'].includes(view.status);
  if (m !== null && (!m || !hash(m.identity) || !date(m.observedAt) || !stats(m.addressMempoolStats)
    || !checkpoint(m.checkpoint, anchor)
    || p.mempoolTransactionsExpected !== m.addressMempoolStats.tx_count)) throw Error('V2 mempool anchor is invalid.');
  if (!terminal && (['confirmed','acquire-mempool'].includes(p.phase)
    ? m !== null || p.mempoolTransactionsExpected !== null || p.mempoolTransactionsProcessed !== 0 || p.verifiedOutputs !== 0
    : m === null || p.mempoolTransactionsExpected === null)) throw Error('V2 phase and acquired mempool evidence disagree.');
  if (!previous && action === 'create' && (view.status !== 'PARTIAL' || view.cursor !== 0 || p.phase !== 'confirmed' || p.mempoolEpoch !== 0
    || p.confirmedTransactionsProcessed !== 0 || p.candidateOutputs !== 0 || m !== null)) throw Error('A new V2 session must start partial with no asserted mempool closure.');
  if (previous) {
    if (view.sessionId !== previous.sessionId || view.expiresAt !== previous.expiresAt || identity(view) !== identity(previous)) throw Error('V2 immutable confirmed anchor/session changed.');
    if (view.latestObservedTip.blockHeight < previous.latestObservedTip.blockHeight || view.latestObservedTip.blockHeight === previous.latestObservedTip.blockHeight && view.latestObservedTip.blockHash !== previous.latestObservedTip.blockHash) throw Error('V2 latest tip moved backwards or changed at the same height.');
    const reset = view.status === 'PARTIAL' && ['MEMPOOL_CHANGED','FINAL_TIP_CHANGED'].includes(view.reason) && p.mempoolEpoch === previous.progress.mempoolEpoch + 1;
    if (action === 'cancel') {
      if (view.status !== 'CANCELLED' || view.cursor < previous.cursor || view.cursor > previous.cursor + 1) throw Error('V2 cancellation cursor is invalid.');
    } else if (action === 'next' && (terminal ? view.cursor !== previous.cursor : reset
      ? view.cursor < previous.cursor + 1 || view.cursor > previous.cursor + 2 : view.cursor !== previous.cursor + 1)) throw Error('V2 cursor is invalid.');
    if (p.confirmedTransactionsProcessed < previous.progress.confirmedTransactionsProcessed) throw Error('V2 confirmed progress moved backwards.');
    if (reset) {
      if (p.phase !== 'acquire-mempool' || m !== null || p.confirmedTransactionsProcessed !== previous.progress.confirmedTransactionsProcessed
        || p.confirmedTransactionsProcessed !== p.confirmedTransactionsExpected || p.mempoolTransactionsExpected !== null
        || p.mempoolTransactionsProcessed !== 0 || p.candidateOutputs !== 0 || p.verifiedOutputs !== 0 || view.result !== undefined) throw Error('V2 reset did not retain confirmed progress and clear final closure.');
    } else if (!terminal) {
      const phases = ['confirmed','acquire-mempool','mempool','outspends','complete'];
      if (p.mempoolEpoch !== previous.progress.mempoolEpoch || phases.indexOf(p.phase) < phases.indexOf(previous.progress.phase)
        || p.mempoolTransactionsProcessed < previous.progress.mempoolTransactionsProcessed
        || previous.mempoolAnchor && (JSON.stringify(m) !== JSON.stringify(previous.mempoolAnchor))) throw Error('V2 mempool evidence moved without an explicit epoch reset.');
    }
  }
  if (view.status !== 'COMPLETE_AT_OBSERVED_TIP') { if (view.result !== undefined) throw Error('V2 partial or terminal failure cannot publish eligible outputs.'); return view; }
  if (m === null || p.mempoolTransactionsExpected === null) throw Error('V2 complete result has no final mempool anchor.');
  if (checkpointKey(m.checkpoint) !== checkpointKey(view.latestObservedTip)) throw Error('V2 final output closure is not bound to its latest shared tip.');
  checkedReconstructionOutputs(view.result,p,view.latestObservedTip.blockHeight);
  return view;
}
