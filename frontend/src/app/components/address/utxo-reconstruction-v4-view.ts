import { sha256 } from '@noble/hashes/sha2.js';
import { checkedReconstructionV3, UtxoReconstructionV3View } from './utxo-reconstruction-v3-view';

export interface UtxoReconstructionV4View extends Omit<UtxoReconstructionV3View, 'schema'> {
  schema: 'universe-address-utxo-reconstruction-v4';
  globalMempoolProof: {
    mode: 'uninitialized' | 'strict-global-fallback' | 'irrelevant-delta-proof';
    fallbackReason: string | null; maximumTransactions: 100; maximumRetainedBytes: 524288;
    retainedBytes: number; transactionCount: number | null; sequenceAtomic: string | null; initialIdentity: string | null;
    transitionCount: number; maximumTransitions: 128; maximumRetainedTransitions: 8;
    transitions: { transition: number; fromIdentity: string; toIdentity: string; addedTxids: string[]; removedTxids: string[];
      proofSha256: string; observedAt: string; verifiedOutputsRetained: number }[];
    verifiedOutputContext: null | { identity: string; checkpoint: UtxoReconstructionV3View['latestObservedTip']; outpointsSha256: string; outputCount: number };
  };
}
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v));
const canonicalCheckpoint = (value: UtxoReconstructionV3View['latestObservedTip']) => value && JSON.stringify(
  Object.keys(value).filter(key => key !== 'verifiedAt').sort().map(key => [key, value[key]]));
const terminal = (v: UtxoReconstructionV4View) => ['INVALIDATED', 'CANCELLED', 'BLOCKED'].includes(v.status);
const resetReasons = ['STRICT_GLOBAL_MEMPOOL_CHANGED', 'VERIFIED_OUTPUT_CONTEXT_UNKNOWN', 'GLOBAL_TRANSACTION_PROOF_UNKNOWN',
  'GLOBAL_TRANSACTION_PROOF_UNAVAILABLE', 'ADDRESS_RELEVANT_GLOBAL_TRANSACTION', 'GLOBAL_PROOF_BYTE_CAPACITY'];
const asV3 = (v: UtxoReconstructionV4View): UtxoReconstructionV3View => ({ ...v, schema: 'universe-address-utxo-reconstruction-v3',
  reason: resetReasons.includes(v.reason) ? 'MEMPOOL_CHANGED' : v.reason });
export function reconstructionOutputDigest(v: UtxoReconstructionV4View): string {
  const values = v.result.items.map(output => ({ txid: output.txid, vout: output.vout, valueAtomic: output.valueAtomic,
    scriptPubKey: v.confirmedAnchor.scriptPubKey }));
  return Array.from(sha256(new TextEncoder().encode(JSON.stringify(values)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The public transition receipt binds producer observations; it does not expose or reclassify raw transactions locally. */
export function checkedReconstructionV4(value: unknown, address: string, network: string,
  previous?: UtxoReconstructionV4View, action: 'create' | 'next' | 'cancel' = 'create'): UtxoReconstructionV4View {
  const v = value as UtxoReconstructionV4View, g = v?.globalMempoolProof;
  if (!v || v.schema !== 'universe-address-utxo-reconstruction-v4' || !g
    || !['uninitialized', 'strict-global-fallback', 'irrelevant-delta-proof'].includes(g.mode)
    || g.maximumTransactions !== 100 || g.maximumRetainedBytes !== 524288 || g.maximumTransitions !== 128 || g.maximumRetainedTransitions !== 8
    || !count(g.retainedBytes) || g.retainedBytes > g.maximumRetainedBytes || g.retainedBytes > v.progress?.retainedBytes
    || !count(g.transitionCount) || g.transitionCount > 128 || !Array.isArray(g.transitions) || g.transitions.length > 8
    || g.transactionCount !== null && !count(g.transactionCount)
    || g.sequenceAtomic !== null && (typeof g.sequenceAtomic !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(g.sequenceAtomic) || BigInt(g.sequenceAtomic) > 18446744073709551615n)
    || g.initialIdentity !== null && !hash(g.initialIdentity)
    || g.fallbackReason !== null && (typeof g.fallbackReason !== 'string' || !g.fallbackReason.length || g.fallbackReason.length > 4096)) throw Error('V4 global proof exceeds its bounded contract.');
  if (g.mode === 'irrelevant-delta-proof' && (g.transactionCount === null || g.transactionCount > 100 || !hash(g.initialIdentity) || g.fallbackReason !== null)
    // The producer retains a fixed metadata reservation even when it holds no raw proofs.
    || g.mode === 'strict-global-fallback' && (!g.fallbackReason || g.retainedBytes !== 512)
    || g.mode === 'uninitialized' && g.retainedBytes !== 0
    || g.mode !== 'irrelevant-delta-proof' && g.transitions.length !== 0) throw Error('V4 global proof mode is inconsistent.');
  if (!terminal(v) && (v.mempoolAnchor === null
    ? g.mode !== 'uninitialized' || g.initialIdentity !== null || g.transactionCount !== null || g.sequenceAtomic !== null || g.verifiedOutputContext !== null
    : g.mode === 'uninitialized' || g.transactionCount === null || !hash(g.initialIdentity))) throw Error('V4 phase has no matching global proof acquisition.');
  for (let i = 0; i < g.transitions.length; i++) {
    const t = g.transitions[i], before = g.transitions[i - 1];
    if (!t || !count(t.transition) || t.transition < 1 || t.transition > g.transitionCount || !hash(t.fromIdentity) || !hash(t.toIdentity)
      || t.fromIdentity === t.toIdentity || !hash(t.proofSha256) || !date(t.observedAt) || !count(t.verifiedOutputsRetained)
      || t.verifiedOutputsRetained > v.progress.verifiedOutputs || !Array.isArray(t.addedTxids) || !Array.isArray(t.removedTxids)
      || t.addedTxids.length + t.removedTxids.length < 1 || t.addedTxids.length + t.removedTxids.length > 100
      || [...t.addedTxids, ...t.removedTxids].some(id => !hash(id))
      || new Set([...t.addedTxids, ...t.removedTxids]).size !== t.addedTxids.length + t.removedTxids.length
      || before && (t.transition !== before.transition + 1 || t.fromIdentity !== before.toIdentity || Date.parse(t.observedAt) < Date.parse(before.observedAt))) throw Error('V4 transition chain is malformed.');
  }
  const last = g.transitions[g.transitions.length - 1];
  if (last && (last.transition !== g.transitionCount || last.toIdentity !== v.mempoolAnchor?.identity)) throw Error('V4 transition does not bind the current mempool identity.');
  let prior = previous && asV3(previous);
  if (previous) {
    const old = previous.globalMempoolProof;
    if (g.transitionCount < old.transitionCount) throw Error('V4 transition count moved backwards.');
    const sameEpoch = v.progress.mempoolEpoch === previous.progress.mempoolEpoch && v.progress.confirmedEpoch === previous.progress.confirmedEpoch;
    if (!terminal(v) && sameEpoch) {
      if (v.progress.verifiedOutputs < previous.progress.verifiedOutputs
        || ['outspends', 'complete'].includes(previous.progress.phase) && v.progress.candidateOutputs !== previous.progress.candidateOutputs) throw Error('V4 output proof progress changed without a reset.');
      if (g.mode !== old.mode && old.mode !== 'uninitialized' || old.initialIdentity && g.initialIdentity !== old.initialIdentity) throw Error('V4 proof acquisition changed without a reset.');
      if (previous.mempoolAnchor && (g.transitionCount > old.transitionCount || v.mempoolAnchor?.identity !== previous.mempoolAnchor.identity)) {
        const bridge = g.transitions.filter(t => t.transition > old.transitionCount);
        if (g.mode !== 'irrelevant-delta-proof' || old.mode !== g.mode || !bridge.length || bridge[0].transition !== old.transitionCount + 1
          || bridge[0].fromIdentity !== previous.mempoolAnchor.identity || bridge.length !== g.transitionCount - old.transitionCount
          || canonicalCheckpoint(v.mempoolAnchor?.checkpoint) !== canonicalCheckpoint(previous.mempoolAnchor.checkpoint)
          || !date(v.mempoolAnchor?.checkpoint?.verifiedAt) || !date(v.observedAt)
          || Date.parse(v.mempoolAnchor.checkpoint.verifiedAt) < Date.parse(previous.mempoolAnchor.checkpoint.verifiedAt)
          || Date.parse(v.mempoolAnchor.checkpoint.verifiedAt) > Date.parse(v.observedAt)
          || JSON.stringify(v.mempoolAnchor?.addressMempoolStats) !== JSON.stringify(previous.mempoolAnchor.addressMempoolStats)
          || v.mempoolAnchor?.observedAt !== last.observedAt) throw Error('V4 changed identity has no bounded irrelevant-transition bridge.');
        for (const known of old.transitions) {
          const retained = g.transitions.find(t => t.transition === known.transition);
          if (retained && JSON.stringify(retained) !== JSON.stringify(known)) throw Error('V4 rewrote a retained transition receipt.');
        }
        // Canonical/source fields stay fixed; only the independently bridged identity and fresh measurement times may advance.
        prior = { ...prior, mempoolAnchor: { ...prior.mempoolAnchor, identity: v.mempoolAnchor.identity, observedAt: v.mempoolAnchor.observedAt,
          checkpoint: { ...prior.mempoolAnchor.checkpoint, verifiedAt: v.mempoolAnchor.checkpoint.verifiedAt } } };
      } else if (g.transitionCount !== old.transitionCount) throw Error('V4 transition advanced without a changed identity.');
    }
  }
  checkedReconstructionV3(asV3(v), address, network, prior, action);
  const context = g.verifiedOutputContext;
  if (context !== null && (!context || !hash(context.identity) || !hash(context.outpointsSha256) || !count(context.outputCount)
    || context.outputCount !== v.progress.verifiedOutputs || context.identity !== v.mempoolAnchor?.identity
    || JSON.stringify(context.checkpoint) !== JSON.stringify(v.mempoolAnchor?.checkpoint))) throw Error('V4 verified outputs have no matching current context.');
  if (!terminal(v) && v.progress.verifiedOutputs > 0 && context === null) throw Error('V4 verified outputs are missing their proof context.');
  if (terminal(v) && context !== null) throw Error('V4 terminal session retained a final output context.');
  if (v.status === 'COMPLETE_AT_OBSERVED_TIP' && (!context || context.outputCount !== v.result.outputCount
    || context.outpointsSha256 !== reconstructionOutputDigest(v))) throw Error('V4 final output digest does not match the eligible output set.');
  return v;
}
