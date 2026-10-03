export interface UtxoReconstructionView {
  schema: 'universe-address-utxo-reconstruction-v1';
  sessionId: string; cursor: number; address: string; network: string;
  status: 'PARTIAL' | 'COMPLETE_AT_OBSERVED_TIP' | 'INVALIDATED' | 'CANCELLED' | 'BLOCKED'; reason?: string;
  source: { genesisHash: string; blockHeight: number; blockHash: string; network: string;
    signetChallenge: string | null; verifiedAt: string; sourceId: string; mempoolIdentity: string; scriptPubKey: string };
  observedAt: string; expiresAt: string;
  progress: { phase: 'confirmed' | 'mempool' | 'outspends' | 'complete'; confirmedTransactionsProcessed: number;
    confirmedTransactionsExpected: number; mempoolTransactionsProcessed: number; mempoolTransactionsExpected: number;
    candidateOutputs: number; verifiedOutputs: number; retainedBytes: number };
  result?: { outputCount: number; balanceAtomic: string; items: { txid: string; vout: number; valueAtomic: string;
    status: { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number } }[] };
}

const hash = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): boolean => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const atomic = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})$/.test(value) || BigInt(value) > 2100000000000000n) {
    throw new Error('Reconstruction contains an invalid exact atomic amount.');
  }
  return BigInt(value);
};
const sourceIdentity = (view: UtxoReconstructionView): string => JSON.stringify([
  view.source.genesisHash, view.source.blockHeight, view.source.blockHash, view.source.network,
  view.source.signetChallenge, view.source.sourceId, view.source.mempoolIdentity, view.source.scriptPubKey,
]);

/** Independently guards the explicit session receipt, never native bare-array completeness. */
export function checkedReconstruction(value: unknown, address: string, network: string,
  previous?: UtxoReconstructionView, action: 'create' | 'next' | 'cancel' = 'create'): UtxoReconstructionView {
  const view = value as UtxoReconstructionView;
  if (!['mainnet', 'signet', 'testnet', 'testnet4', 'regtest'].includes(network) || !view || view.schema !== 'universe-address-utxo-reconstruction-v1' || view.address !== address || view.network !== network ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(view.sessionId) || !count(view.cursor) ||
    !['PARTIAL', 'COMPLETE_AT_OBSERVED_TIP', 'INVALIDATED', 'CANCELLED', 'BLOCKED'].includes(view.status) ||
    !date(view.observedAt) || !date(view.expiresAt) || Date.parse(view.expiresAt) <= Date.parse(view.observedAt) ||
    view.reason != null && (typeof view.reason !== 'string' || view.reason.length > 4096)) {
    throw new Error('Reconstruction receipt does not match this address and selected network.');
  }
  const source = view.source;
  if (!source || source.network !== network || !hash(source.genesisHash) || !hash(source.blockHash) || !count(source.blockHeight) ||
    !hash(source.sourceId) || !hash(source.mempoolIdentity) || !date(source.verifiedAt) ||
    typeof source.scriptPubKey !== 'string' || !/^(?:[0-9a-f]{2}){1,10000}$/.test(source.scriptPubKey) ||
    (network === 'signet' ? typeof source.signetChallenge !== 'string' || source.signetChallenge.length > 20000 || !/^(?:[0-9a-f]{2})+$/.test(source.signetChallenge) : source.signetChallenge !== null)) {
    throw new Error('Reconstruction source checkpoint is incomplete or has the wrong network.');
  }
  if (previous && (view.sessionId !== previous.sessionId || sourceIdentity(view) !== sourceIdentity(previous) ||
    view.expiresAt !== previous.expiresAt || action === 'next' && view.cursor !== previous.cursor + (['INVALIDATED', 'CANCELLED', 'BLOCKED'].includes(view.status) ? 0 : 1) ||
    action === 'cancel' && (view.cursor < previous.cursor || view.cursor > previous.cursor + 1 || view.status !== 'CANCELLED'))) {
    throw new Error('Reconstruction session, cursor or observed source changed. Restart explicitly.');
  }
  if (!previous && action === 'create' && (view.cursor !== 0 || view.status !== 'PARTIAL')) {
    throw new Error('A new reconstruction must begin as an explicit partial session.');
  }
  const progress = view.progress;
  if (!progress || !['confirmed', 'mempool', 'outspends', 'complete'].includes(progress.phase) ||
    !Object.values(progress).filter(v => typeof v !== 'string').every(count) ||
    ![progress.confirmedTransactionsProcessed, progress.confirmedTransactionsExpected, progress.mempoolTransactionsProcessed,
      progress.mempoolTransactionsExpected, progress.candidateOutputs, progress.verifiedOutputs, progress.retainedBytes].every(count) ||
    progress.confirmedTransactionsProcessed > progress.confirmedTransactionsExpected || progress.mempoolTransactionsProcessed > progress.mempoolTransactionsExpected ||
    progress.confirmedTransactionsExpected + progress.mempoolTransactionsExpected > 100000 || progress.mempoolTransactionsExpected > 500 ||
    progress.candidateOutputs > 100000 || ['PARTIAL', 'COMPLETE_AT_OBSERVED_TIP'].includes(view.status) && progress.verifiedOutputs > progress.candidateOutputs || progress.retainedBytes > 32 * 1024 * 1024) {
    throw new Error('Reconstruction progress is outside the bounded source contract.');
  }
  if (previous && (progress.confirmedTransactionsExpected !== previous.progress.confirmedTransactionsExpected ||
    progress.mempoolTransactionsExpected !== previous.progress.mempoolTransactionsExpected ||
    progress.confirmedTransactionsProcessed < previous.progress.confirmedTransactionsProcessed ||
    progress.mempoolTransactionsProcessed < previous.progress.mempoolTransactionsProcessed ||
    ['confirmed', 'mempool', 'outspends', 'complete'].indexOf(progress.phase) < ['confirmed', 'mempool', 'outspends', 'complete'].indexOf(previous.progress.phase))) {
    throw new Error('Reconstruction coverage changed or moved backwards.');
  }
  if (view.status !== 'COMPLETE_AT_OBSERVED_TIP') {
    if (view.result !== undefined) { throw new Error('Partial or invalidated reconstruction cannot publish eligible outputs.'); }
    return view;
  }
  checkedReconstructionOutputs(view.result, progress, source.blockHeight);
  return view;
}

/** Shared exact final-output closure; callers separately validate their schema and anchors. */
export function checkedReconstructionOutputs(result: UtxoReconstructionView['result'],
  progress: Omit<UtxoReconstructionView['progress'], 'phase' | 'mempoolTransactionsExpected'> & { phase: string; mempoolTransactionsExpected: number | null }, blockHeight: number): void {
  if (progress.phase !== 'complete' || progress.confirmedTransactionsProcessed !== progress.confirmedTransactionsExpected ||
    progress.mempoolTransactionsProcessed !== progress.mempoolTransactionsExpected || progress.verifiedOutputs !== progress.candidateOutputs ||
    !result || !count(result.outputCount) || !Array.isArray(result.items) || result.items.length > 100000 ||
    result.outputCount !== result.items.length || result.outputCount !== progress.candidateOutputs) {
    throw new Error('Reconstruction closure is incomplete.');
  }
  const points = new Set<string>(); let total = 0n;
  for (const item of result.items) {
    if (!item || !hash(item.txid) || !count(item.vout) || item.vout > 0xffffffff || !item.status || typeof item.status.confirmed !== 'boolean' ||
      item.status.confirmed && (!count(item.status.block_height) || item.status.block_height > blockHeight ||
        !hash(item.status.block_hash) || !count(item.status.block_time)) || !item.status.confirmed &&
      [item.status.block_height, item.status.block_hash, item.status.block_time].some(value => value != null)) { throw new Error('Reconstruction output identity or status is invalid.'); }
    const point = `${item.txid}:${item.vout}`;
    if (points.has(point)) { throw new Error('Reconstruction repeats an outpoint.'); } points.add(point);
    total += atomic(item.valueAtomic);
  }
  if (total !== atomic(result.balanceAtomic)) { throw new Error('Reconstruction balance does not match its exact output sum.'); }
}

export function atomicBtc(value: string): string {
  const amount = atomic(value); return `${amount / 100000000n}.${(amount % 100000000n).toString().padStart(8, '0')}`;
}
