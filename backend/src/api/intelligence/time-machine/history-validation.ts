import { createHash } from 'crypto';
import type { HistoricalMempoolEvent, MempoolCheckpoint } from './time-machine.service';
type Gap = { start_utc: string; end_utc: string; reason: string };
interface Snapshot { schema: string; network: string; startedAt: string; eventSequence: number; evictedSequence: number; evictedThrough: number; observedThrough: number; gaps: Gap[]; events: HistoricalMempoolEvent[]; checkpoints: Array<{ checkpoint: MempoolCheckpoint; transactions: Array<[string, { vsize: number; weight: number; fee: number }]> }> }
const check = (condition: unknown): void => { if (!condition) throw new Error('Invalid observed history snapshot.'); };
const integer = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 0;
const hash = (s: unknown): boolean => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
export const validUtc = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 19) === s.slice(0, 19);
/** Validate every retained event and transaction before publishing restored state. */
export function validateHistorySnapshot(value: unknown, network: string, limits: { checkpoints: number; events: number }): Snapshot {
  const v = value as Snapshot;
  check(v && v.schema === 'observed-history-v1' && v.network === network && validUtc(v.startedAt));
  for (const n of [v.eventSequence, v.evictedSequence, v.evictedThrough, v.observedThrough]) check(integer(n));
  check(Number.isFinite(new Date(v.evictedThrough).getTime()) && Number.isFinite(new Date(v.observedThrough).getTime()));
  check(v.evictedSequence <= v.eventSequence && v.evictedThrough <= v.observedThrough);
  check(Array.isArray(v.events) && v.events.length <= limits.events && Array.isArray(v.checkpoints) && v.checkpoints.length <= limits.checkpoints && Array.isArray(v.gaps) && v.gaps.length <= 1024);
  let sequence = v.evictedSequence, at = v.evictedThrough;
  for (const e of v.events) {
    check(e && e.sequence === ++sequence && hash(e.txid) && typeof e.event_id === 'string' && e.event_id.length <= 128 && validUtc(e.timestamp_utc));
    check(Date.parse(e.timestamp_utc) >= at && Date.parse(e.timestamp_utc) <= v.observedThrough); at = Date.parse(e.timestamp_utc);
    check(['observed', 'accepted', 'removed', 'confirmed', 'replaced', 'conflicted', 'evicted', 'reaccepted_after_reorg'].includes(e.event_type));
    check(integer(e.vsize) && integer(e.fee_sats) && (e.weight === undefined || integer(e.weight)) && Number.isFinite(e.fee_rate) && e.fee_rate >= 0);
    check(e.block_height === undefined || integer(e.block_height)); check(e.replaced_by_txid === undefined || hash(e.replaced_by_txid));
  }
  check(sequence === v.eventSequence);
  for (const gap of v.gaps) check(validUtc(gap.start_utc) && validUtc(gap.end_utc) && Date.parse(gap.start_utc) <= Date.parse(gap.end_utc) && typeof gap.reason === 'string' && gap.reason.length <= 1024);
  let height = -1, timestamp = -1, totalTransactions = 0;
  for (const entry of v.checkpoints) {
    const c = entry.checkpoint;
    check(c && c.network === network && hash(c.block_hash) && hash(c.state_hash) && typeof c.checkpoint_id === 'string' && c.checkpoint_id.length <= 256 && validUtc(c.timestamp_utc));
    for (const n of [c.block_height,c.event_sequence,c.mempool_tx_count,c.mempool_vsize,c.mempool_weight,c.mempool_fees_sats,c.block_tx_count,c.block_weight,c.block_fees_sats]) check(integer(n));
    check(c.block_height > height && Date.parse(c.timestamp_utc) >= timestamp && Date.parse(c.timestamp_utc) <= v.observedThrough && c.event_sequence! <= v.eventSequence);
    height = c.block_height; timestamp = Date.parse(c.timestamp_utc);
    check(Array.isArray(entry.transactions)); totalTransactions += entry.transactions.length; check(totalTransactions <= 2_000_000);
    const ids = new Set<string>(); let size = 0, weight = 0, fees = 0;
    for (const pair of entry.transactions) {
      check(Array.isArray(pair) && pair.length === 2); const [id, tx] = pair;
      check(hash(id) && !ids.has(id) && tx && integer(tx.vsize) && integer(tx.weight) && integer(tx.fee));
      ids.add(id); size += tx.vsize; weight += tx.weight; fees += tx.fee;
    }
    check(ids.size === c.mempool_tx_count && size === c.mempool_vsize && weight === c.mempool_weight && fees === c.mempool_fees_sats);
    check(createHash('sha256').update(`${c.block_hash}:${[...ids].sort().join(',')}`).digest('hex') === c.state_hash);
    const rates = entry.transactions.map(([, tx]) => tx.vsize ? tx.fee / tx.vsize : 0).sort((a,b) => a-b);
    check(c.median_feerate_sats_vb === (rates.length ? Math.round(rates[Math.floor(rates.length / 2)] * 100) / 100 : 0));
    const boundaries = [0,5,10,20,50,Infinity]; const labels = ['1-5 sat/vB','6-10 sat/vB','11-20 sat/vB','21-50 sat/vB','50+ sat/vB'];
    check(Array.isArray(c.fee_distribution) && c.fee_distribution.length === 5);
    c.fee_distribution.forEach((b,i) => { const txs = entry.transactions.filter(([,tx]) => { const rate = tx.vsize ? tx.fee/tx.vsize : 0; return rate >= boundaries[i] && rate < boundaries[i+1]; }); check(b.feerate_bucket === labels[i] && b.count === txs.length && b.total_vsize === txs.reduce((sum,[,tx]) => sum+tx.vsize,0)); });
  }
  return v;
}
