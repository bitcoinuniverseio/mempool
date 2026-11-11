/** Optional additive fields from the shared indexer-health v1 envelope. */
export interface IndexerHealthEntry {
  protocolId?: string; chain?: string; network?: string; role?: string;
  desiredState?: string; availability?: string; freshness?: string;
  observedAt?: string; indexedHeight?: number | null; tipHeight?: number | null;
  lagBlocks?: number | null; lastSuccessfulAt?: string | null; reason?: string | null;
}
export interface IndexerHealthEnvelope { schemaVersion: 1; entries: IndexerHealthEntry[]; }
export type IndexerViewState = 'ready' | 'stale' | 'unavailable' | 'disabled' | 'planned' | 'retired';
export function indexerViewState(entry: IndexerHealthEntry, now = Date.now()): IndexerViewState {
  if (entry.desiredState === 'retired') return 'retired';
  if (entry.desiredState === 'planned') return 'planned';
  if (entry.desiredState === 'disabled' || entry.availability === 'disabled') return 'disabled';
  const observed = Date.parse(entry.observedAt || '');
  if (!Number.isFinite(observed) || now - observed > 60_000 || entry.availability !== 'available') return 'unavailable';
  if (entry.reason === 'index_ahead_of_tip' || (typeof entry.indexedHeight === 'number' && typeof entry.tipHeight === 'number' && entry.indexedHeight > entry.tipHeight)) return 'unavailable';
  if (entry.freshness === 'stale' || (typeof entry.lagBlocks === 'number' && entry.lagBlocks > 2)) return 'stale';
  return entry.freshness === 'fresh' ? 'ready' : 'unavailable';
}
export function scopedIndexerEntries(body: unknown, network: string, chain = 'bitcoin'): IndexerHealthEntry[] {
  const envelope = body as IndexerHealthEnvelope | null;
  if (envelope?.schemaVersion !== 1 || !Array.isArray(envelope.entries)) throw new Error('Invalid health response');
  return envelope.entries.filter(entry => entry && entry.protocolId && (!entry.role || entry.role === 'authority') && (!entry.network || entry.network === network) && (!entry.chain || entry.chain === chain));
}
export const INDEXER_STATE_LABEL: Record<IndexerViewState, string> = {
  ready: 'Available', stale: 'Data may be out of date', unavailable: 'Temporarily unavailable',
  disabled: 'Turned off', planned: 'Not available yet', retired: 'No longer available',
};
