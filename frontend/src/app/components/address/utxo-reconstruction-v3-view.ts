import { checkedReconstructionOutputs, UtxoReconstructionView } from './utxo-reconstruction-view';

type Stats = { funded_txo_count: number; spent_txo_count: number; funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
type Checkpoint = Omit<UtxoReconstructionView['source'], 'mempoolIdentity' | 'sourceId' | 'scriptPubKey'>;
export interface UtxoReconstructionV3View {
  schema: 'universe-address-utxo-reconstruction-v3'; sessionId: string; cursor: number; address: string; network: string;
  status: UtxoReconstructionView['status']; reason?: string; observedAt: string; expiresAt: string;
  confirmedAnchor: Omit<UtxoReconstructionView['source'], 'mempoolIdentity'> & { chainStats: Stats };
  latestObservedTip: Checkpoint;
  confirmedTailAnchor: { checkpoint: Checkpoint; chainStats: Stats } | null;
  mempoolAnchor: { identity: string; observedAt: string; checkpoint: Checkpoint; addressMempoolStats: Stats } | null;
  progress: Omit<UtxoReconstructionView['progress'], 'phase' | 'mempoolTransactionsExpected'> & {
    phase: 'confirmed' | 'reconcile-confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete'; pageLimit: 100;
    confirmedEpoch: number; confirmedTailTransactionsProcessed: number; confirmedTailTransactionsExpected: number | null;
    mempoolEpoch: number; mempoolTransactionsExpected: number | null;
  };
  result?: UtxoReconstructionView['result'];
}
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown) => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const stats = (value: Stats) => value && ['funded_txo_count','spent_txo_count','funded_txo_sum','spent_txo_sum','tx_count'].every(key => count(value[key]))
  && value.funded_txo_sum <= 2100000000000000 && value.spent_txo_sum <= 2100000000000000;
const identity = (view: UtxoReconstructionV3View) => JSON.stringify([view.confirmedAnchor.genesisHash,view.confirmedAnchor.blockHash,
  view.confirmedAnchor.blockHeight,view.confirmedAnchor.network,view.confirmedAnchor.signetChallenge,view.confirmedAnchor.sourceId,
  view.confirmedAnchor.scriptPubKey,view.confirmedAnchor.chainStats,view.confirmedAnchor.verifiedAt]);
const checkpointKey = (value: Checkpoint) => JSON.stringify([value.genesisHash,value.blockHash,value.blockHeight,value.network,value.signetChallenge]);
const checkpoint = (value: Checkpoint, anchor: UtxoReconstructionV3View['confirmedAnchor']) => value && hash(value.blockHash)
  && count(value.blockHeight) && value.blockHeight >= anchor.blockHeight && date(value.verifiedAt)
  && value.genesisHash === anchor.genesisHash && value.network === anchor.network && value.signetChallenge === anchor.signetChallenge;

export function checkedReconstructionV3(value: unknown, address: string, network: string,
  previous?: UtxoReconstructionV3View, action: 'create'|'next'|'cancel' = 'create'): UtxoReconstructionV3View {
  const view = value as UtxoReconstructionV3View;
  if (!['mainnet','testnet','testnet4','signet','regtest'].includes(network) || !view || view.schema !== 'universe-address-utxo-reconstruction-v3'
    || view.address !== address || view.network !== network || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(view.sessionId)
    || !count(view.cursor) || !['PARTIAL','COMPLETE_AT_OBSERVED_TIP','INVALIDATED','CANCELLED','BLOCKED'].includes(view.status)
    || !date(view.observedAt) || !date(view.expiresAt) || Date.parse(view.expiresAt) <= Date.parse(view.observedAt)
    || view.reason != null && (typeof view.reason !== 'string' || view.reason.length > 4096)) throw Error('V3 receipt does not match this address and network.');
  const anchor = view.confirmedAnchor, p = view.progress, m = view.mempoolAnchor, tail = view.confirmedTailAnchor;
  if (!anchor || anchor.network !== network || !hash(anchor.genesisHash) || !hash(anchor.blockHash) || !hash(anchor.sourceId)
    || !count(anchor.blockHeight) || !date(anchor.verifiedAt) || !stats(anchor.chainStats)
    || typeof anchor.scriptPubKey !== 'string' || !/^(?:[a-f0-9]{2}){1,10000}$/.test(anchor.scriptPubKey)
    || (network === 'signet' ? typeof anchor.signetChallenge !== 'string' || !/^(?:[a-f0-9]{2}){1,10000}$/.test(anchor.signetChallenge) : anchor.signetChallenge !== null)) throw Error('V3 confirmed anchor is invalid.');
  if (!checkpoint(view.latestObservedTip, anchor) || view.latestObservedTip.blockHeight === anchor.blockHeight && view.latestObservedTip.blockHash !== anchor.blockHash) throw Error('V3 latest shared tip is inconsistent with its immutable confirmed anchor.');
  if (!p || !['confirmed','reconcile-confirmed','acquire-mempool','mempool','outspends','complete'].includes(p.phase) || p.pageLimit !== 100 || !count(p.mempoolEpoch) || !count(p.confirmedEpoch) || p.confirmedEpoch > 16 || !count(p.confirmedTailTransactionsProcessed)
    || p.confirmedTailTransactionsExpected !== null && !count(p.confirmedTailTransactionsExpected)
    || p.confirmedTailTransactionsProcessed > (p.confirmedTailTransactionsExpected ?? 0)
    || ![p.confirmedTransactionsProcessed,p.confirmedTransactionsExpected,p.mempoolTransactionsProcessed,p.candidateOutputs,p.verifiedOutputs,p.retainedBytes].every(count)
    || p.mempoolTransactionsExpected !== null && !count(p.mempoolTransactionsExpected)
    || p.confirmedTransactionsExpected !== anchor.chainStats.tx_count || p.confirmedTransactionsProcessed > p.confirmedTransactionsExpected
    || p.confirmedTransactionsExpected + (p.confirmedTailTransactionsExpected ?? 0) + (p.mempoolTransactionsExpected ?? 0) > 100000 || (p.mempoolTransactionsExpected ?? 0) > 500
    || p.mempoolTransactionsProcessed > (p.mempoolTransactionsExpected ?? 0) || p.candidateOutputs > 100000
    || ['PARTIAL','COMPLETE_AT_OBSERVED_TIP'].includes(view.status) && p.verifiedOutputs > p.candidateOutputs
    || p.retainedBytes > 32 * 1024 * 1024) throw Error('V3 progress exceeds its bounded contract.');
  const terminal = ['INVALIDATED','CANCELLED','BLOCKED'].includes(view.status);
  if (terminal && p.retainedBytes !== 0) throw Error('V3 terminal session did not release its retained records.');
  if (m !== null && (!m || !hash(m.identity) || !date(m.observedAt) || !stats(m.addressMempoolStats)
    || !checkpoint(m.checkpoint, anchor)
    || p.mempoolTransactionsExpected !== m.addressMempoolStats.tx_count)) throw Error('V3 mempool anchor is invalid.');
  if (!terminal && (['confirmed','reconcile-confirmed','acquire-mempool'].includes(p.phase)
    ? m !== null || p.mempoolTransactionsExpected !== null || p.mempoolTransactionsProcessed !== 0 || p.verifiedOutputs !== 0
    : m === null || p.mempoolTransactionsExpected === null)) throw Error('V3 phase and acquired mempool evidence disagree.');
  if (tail !== null && (!tail || !checkpoint(tail.checkpoint, anchor) || !stats(tail.chainStats)
    || Object.keys(anchor.chainStats).some(key => tail.chainStats[key] < anchor.chainStats[key])
    || tail.chainStats.tx_count - anchor.chainStats.tx_count !== p.confirmedTailTransactionsExpected
    || p.confirmedTailTransactionsProcessed !== p.confirmedTailTransactionsExpected)) throw Error('V3 confirmed tail closure is inconsistent.');
  if (!terminal && (p.phase === 'confirmed'
    ? tail !== null || p.confirmedTailTransactionsProcessed !== 0 || p.confirmedTailTransactionsExpected !== null
    : p.confirmedTransactionsProcessed !== p.confirmedTransactionsExpected
      || (p.phase === 'reconcile-confirmed' ? tail !== null : tail === null))) throw Error('V3 phase has no matching original and tail closure.');
  if (!terminal && tail && checkpointKey(tail.checkpoint) !== checkpointKey(view.latestObservedTip)) throw Error('V3 closed tail is not bound to the latest shared tip.');
  if (!terminal && m && tail && checkpointKey(m.checkpoint) !== checkpointKey(tail.checkpoint)) throw Error('V3 mempool and confirmed tail checkpoints disagree.');
  if (!previous && action === 'create' && (view.status !== 'PARTIAL' || view.cursor !== 0 || p.phase !== 'confirmed' || p.mempoolEpoch !== 0 || p.confirmedEpoch !== 0 || tail !== null || p.confirmedTailTransactionsExpected !== null || p.confirmedTailTransactionsProcessed !== 0
    || p.confirmedTransactionsProcessed !== 0 || p.candidateOutputs !== 0 || m !== null)) throw Error('A new V3 session must start partial with no asserted mempool closure.');
  if (previous) {
    if (view.sessionId !== previous.sessionId || view.expiresAt !== previous.expiresAt || identity(view) !== identity(previous)) throw Error('V3 immutable confirmed anchor/session changed.');
    const tailReset = view.status === 'PARTIAL' && view.reason === 'CONFIRMED_TAIL_CHANGED'
      && p.confirmedEpoch === previous.progress.confirmedEpoch + 1 && p.mempoolEpoch === previous.progress.mempoolEpoch + 1;
    const mempoolReset = view.status === 'PARTIAL' && ['MEMPOOL_CHANGED','FINAL_TIP_CHANGED'].includes(view.reason)
      && p.confirmedEpoch === previous.progress.confirmedEpoch && p.mempoolEpoch === previous.progress.mempoolEpoch + 1;
    const reset = tailReset || mempoolReset;
    if (!terminal && !tailReset && previous.progress.confirmedTailTransactionsExpected !== null && (view.latestObservedTip.blockHeight < previous.latestObservedTip.blockHeight
      || view.latestObservedTip.blockHeight === previous.latestObservedTip.blockHeight && view.latestObservedTip.blockHash !== previous.latestObservedTip.blockHash)) throw Error('V3 changed latest tip requires an explicit confirmed-tail reset.');
    if (action === 'cancel') {
      if (view.status !== 'CANCELLED' || view.cursor < previous.cursor || view.cursor > previous.cursor + 1) throw Error('V3 cancellation cursor is invalid.');
    } else if (action === 'next' && (terminal ? view.cursor !== previous.cursor : reset
      ? view.cursor < previous.cursor + 1 || view.cursor > previous.cursor + 2 : view.cursor !== previous.cursor + 1)) throw Error('V3 cursor is invalid.');
    if (p.confirmedTransactionsProcessed < previous.progress.confirmedTransactionsProcessed) throw Error('V3 confirmed progress moved backwards.');
    if (reset) {
      if (p.phase !== (tailReset ? 'reconcile-confirmed' : 'acquire-mempool') || m !== null || p.confirmedTransactionsProcessed !== previous.progress.confirmedTransactionsProcessed
        || p.confirmedTransactionsProcessed !== p.confirmedTransactionsExpected || p.mempoolTransactionsExpected !== null
        || p.mempoolTransactionsProcessed !== 0 || p.candidateOutputs !== 0 || p.verifiedOutputs !== 0 || view.result !== undefined) throw Error('V3 reset did not retain confirmed progress and clear final closure.');
      if (tailReset ? tail !== null || p.confirmedTailTransactionsProcessed !== 0 || p.confirmedTailTransactionsExpected !== null
        : JSON.stringify(tail) !== JSON.stringify(previous.confirmedTailAnchor) || p.confirmedTailTransactionsProcessed !== previous.progress.confirmedTailTransactionsProcessed
          || p.confirmedTailTransactionsExpected !== previous.progress.confirmedTailTransactionsExpected) throw Error('V3 reset retained or discarded the wrong confirmed tail.');
    } else if (!terminal) {
      const phases = ['confirmed','reconcile-confirmed','acquire-mempool','mempool','outspends','complete'];
      if (p.confirmedEpoch !== previous.progress.confirmedEpoch || p.mempoolEpoch !== previous.progress.mempoolEpoch
        || p.confirmedTailTransactionsProcessed < previous.progress.confirmedTailTransactionsProcessed
        || previous.progress.confirmedTailTransactionsExpected !== null && p.confirmedTailTransactionsExpected !== previous.progress.confirmedTailTransactionsExpected
        || previous.confirmedTailAnchor && JSON.stringify(tail) !== JSON.stringify(previous.confirmedTailAnchor) || phases.indexOf(p.phase) < phases.indexOf(previous.progress.phase)
        || p.mempoolTransactionsProcessed < previous.progress.mempoolTransactionsProcessed
        || previous.mempoolAnchor && (JSON.stringify(m) !== JSON.stringify(previous.mempoolAnchor))) throw Error('V3 mempool evidence moved without an explicit epoch reset.');
    }
  }
  if (view.status !== 'COMPLETE_AT_OBSERVED_TIP') { if (view.result !== undefined) throw Error('V3 partial or terminal failure cannot publish eligible outputs.'); return view; }
  if (tail === null || p.confirmedTailTransactionsExpected === null || p.confirmedTailTransactionsProcessed !== p.confirmedTailTransactionsExpected || m === null || p.mempoolTransactionsExpected === null) throw Error('V3 complete result has no final mempool anchor.');
  if (checkpointKey(m.checkpoint) !== checkpointKey(view.latestObservedTip)) throw Error('V3 final output closure is not bound to its latest shared tip.');
  checkedReconstructionOutputs(view.result,p,view.latestObservedTip.blockHeight);
  const chain = tail.chainStats, mempool = m.addressMempoolStats;
  const outputCount = chain.funded_txo_count - chain.spent_txo_count + mempool.funded_txo_count - mempool.spent_txo_count;
  const balance = BigInt(chain.funded_txo_sum) - BigInt(chain.spent_txo_sum) + BigInt(mempool.funded_txo_sum) - BigInt(mempool.spent_txo_sum);
  if (view.result.outputCount !== outputCount || BigInt(view.result.balanceAtomic) !== balance) throw Error('V3 final outputs do not close the observed confirmed and mempool accounting.');
  return view;
}
