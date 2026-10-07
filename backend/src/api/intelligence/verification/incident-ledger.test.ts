import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { IncidentLedger } from './incident-ledger';
import { IncidentObservation, IncidentProfile } from './incident-types';
import { validateIncidentProfile } from './incident-source';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const profile = (count = 1): IncidentProfile => ({ schema: 'universe-incident-profile-v1', network: 'signet', stale_after_seconds: 30,
  sources: Array.from({ length: count }, (_, i) => ({ source_id: 'node' + i, independence_id: 'instance' + i, implementation: 'bitcoin-core',
    source_revision: null, binary_sha256: hash(10), configuration_sha256: hash(20 + i), genesis_hash: hash(1), block_one_hash: hash(2), signet_challenge: '51' })) });
const observation = (ids: number[], source_id = 'node0', time = '2026-10-04T01:00:00.000Z'): IncidentObservation => ({ source_id, observed_at_utc: time,
  headers: ids.map((n, height) => ({ height, hash: hash(n), parent: height ? hash(ids[height - 1]) : hash(0), timestamp: 100 + height })) });
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'incident-owned-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

it('does not infer agreement or full monitoring from an empty first observation', () => {
  const ledger = new IncidentLedger(join(directory, 'ledger.json'), profile());
  try { const result = ledger.record([observation([1, 2, 3])]);
    expect(result).toMatchObject({ count: 0, coverage: { global_consensus_verified: false, complete_monitoring: false, invalid_block_validation: 'unavailable' } });
  } finally { ledger.close(); }
});
it('retains a genuine common-ancestor replacement and unknown effects, deduplicates repeated observations', () => {
  const ledger = new IncidentLedger(join(directory, 'ledger.json'), profile());
  try { ledger.record([observation([1, 2, 3, 4])]); const result = ledger.record([observation([1, 2, 5, 6, 7])]);
    expect(result.incidents[0]).toMatchObject({ incident_type: 'reorg', reorg_depth: 2, resolved_at_utc: null, displaced_tx_count: null,
      double_spend_attempts_count: null, status: 'investigating', evidence: { common_ancestor: { height: 1, hash: hash(2) } } });
    expect(ledger.record([observation([1, 2, 5, 6, 7])]).count).toBe(1);
  } finally { ledger.close(); }
});
it('reports a retained-window gap rather than guessing reorg depth when no ancestor is available', () => {
  const ledger = new IncidentLedger(join(directory, 'ledger.json'), profile());
  try { ledger.record([observation([1, 2, 3])]); const result = ledger.record([observation([7, 8, 9])]);
    expect(result.count).toBe(0); expect(result.coverage.gaps[0].reason).toBe('ancestor-outside-window');
  } finally { ledger.close(); }
});
it('requires two separately registered instances for a node disagreement, not an invalid-block verdict', () => {
  const p = profile(2); const ledger = new IncidentLedger(join(directory, 'ledger.json'), p);
  try { const result = ledger.record([observation([1, 2, 3]), observation([1, 2, 4], 'node1')]);
    expect(result.incidents[0]).toMatchObject({ incident_type: 'node_tip_divergence', source_ids: ['node0', 'node1'], reorg_depth: null });
    expect(result.coverage.global_consensus_verified).toBe(false);
  } finally { ledger.close(); }
  p.sources[1].independence_id = p.sources[0].independence_id;
  const other = new IncidentLedger(join(directory, 'other.json'), p);
  try { expect(other.record([observation([1, 2, 3]), observation([1, 2, 4], 'node1')]).count).toBe(0); } finally { other.close(); }
});
it('measures an unchanged-tip threshold without claiming outage or automatic resolution', () => {
  let now = Date.parse('2026-10-04T01:00:00.000Z'); const ledger = new IncidentLedger(join(directory, 'ledger.json'), profile(), () => now);
  try { ledger.record([observation([1, 2])]); now += 30001;
    expect(ledger.record([observation([1, 2])]).incidents[0]).toMatchObject({ incident_type: 'stale_tip', duration_seconds: null, status: 'investigating' });
    now += 1000; expect(ledger.record([observation([1, 2, 3])]).incidents[0].status).toBe('investigating');
  } finally { ledger.close(); }
});
it('refuses another writer, retains persistence on restart, and refuses profile replacement', () => {
  const file = join(directory, 'ledger.json'); const first = new IncidentLedger(file, profile());
  expect(() => new IncidentLedger(file, profile())).toThrow(expect.objectContaining({ code: 'incident-ledger-busy' }));
  first.record([observation([1, 2, 3])]); first.record([observation([1, 2, 4])]); first.close();
  const reopened = new IncidentLedger(file, profile());
  expect(reopened.view()).toMatchObject({ count: 1, coverage: { observation_count: 2, gaps: [{ reason: 'restart' }] } }); reopened.close();
  const replacement = profile(); replacement.sources[0].block_one_hash = hash(99);
  expect(() => new IncidentLedger(file, replacement)).toThrow(expect.objectContaining({ code: 'invalid-incident-ledger' }));
});
it('rejects malformed observations atomically and malformed storage instead of zero incidents', () => {
  const file = join(directory, 'ledger.json'), ledger = new IncidentLedger(file, profile());
  const original = readFileSync(file);
  const malformed = observation([1, 2]); malformed.headers[1].parent = hash(90);
  expect(() => ledger.record([malformed])).toThrow(); expect(readFileSync(file)).toEqual(original); ledger.close();
  writeFileSync(file, '{', { mode: 0o600 }); expect(() => new IncidentLedger(file, profile())).toThrow();
});
it('requires immutable expected chain identities and rejects an unpinned Signet registration', () => {
  const raw: any = profile(); raw.sources[0].signet_challenge = null;
  expect(() => validateIncidentProfile(raw)).toThrow();
  raw.sources[0].signet_challenge = '51'; raw.sources[0].genesis_hash = 'unknown'; expect(() => validateIncidentProfile(raw)).toThrow();
});
it.each(['calendar-rollover', 'timeline', 'header', 'title', 'resolution'])('refuses corrupted persisted %s rather than accepting fabricated evidence on restart', corruption => {
  const file = join(directory, 'ledger.json'), ledger = new IncidentLedger(file, profile());
  ledger.record([observation([1, 2, 3])]); ledger.record([observation([1, 2, 4])]); ledger.close();
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  if (corruption === 'calendar-rollover') stored.started_at_utc = '2026-02-31T01:00:00.000Z';
  if (corruption === 'timeline') stored.incidents[0].timeline = [null];
  if (corruption === 'header') stored.sources[0].observation.headers[2].hash = hash(99);
  if (corruption === 'title') stored.incidents[0].title = { malicious: 'shape' };
  if (corruption === 'resolution') stored.incidents[0].status = 'resolved';
  writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
  const original = readFileSync(file);
  expect(() => new IncidentLedger(file, profile())).toThrow(); expect(readFileSync(file)).toEqual(original);
});

it.each(['singleton-divergence', 'same-branches', 'false-terminal', 'false-stale', 'old-tip-canonical'])('rejects semantically contradictory rehashed persisted %s', mutation => {
  const file = join(directory, 'ledger.json'), p = profile(2), ledger = new IncidentLedger(file, p);
  ledger.record([observation([1, 2, 3]), observation([1, 2, 4], 'node1')]); ledger.close();
  const stored = JSON.parse(readFileSync(file, 'utf8')), record = stored.incidents[0];
  if (mutation === 'singleton-divergence') record.source_ids = ['node0'];
  if (mutation === 'same-branches') record.evidence.before = record.evidence.after;
  if (mutation === 'false-terminal') record.block_hash = hash(99);
  if (mutation === 'false-stale') { record.incident_type = 'stale_tip'; record.source_ids = ['node0']; record.timeline[0].source_ids = ['node0']; record.evidence.common_ancestor = null; }
  if (mutation === 'old-tip-canonical') { record.incident_type = 'reorg'; record.source_ids = ['node0']; record.timeline[0].source_ids = ['node0']; record.evidence.after = observation([1, 2, 3, 5]).headers; record.evidence.common_ancestor = record.evidence.before[1]; record.reorg_depth = 1; record.block_height = 3; record.block_hash = hash(5); }
  if (mutation === 'singleton-divergence') record.timeline[0].source_ids = ['node0'];
  const { integrity_sha256: ignored, ...payload } = stored; void ignored;
  stored.integrity_sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  writeFileSync(file, JSON.stringify(stored), { mode: 0o600 }); const bytes = readFileSync(file);
  expect(() => new IncidentLedger(file, p)).toThrow(); expect(readFileSync(file)).toEqual(bytes);
});
it('labels ancestor-only rollback separately from an observed replacement suffix', () => {
  const ledger = new IncidentLedger(join(directory, 'ledger.json'), profile());
  try { ledger.record([observation([1, 2, 3])]);
    expect(ledger.record([observation([1, 2])]).incidents[0].title).toBe('Observed canonical tip rollback');
  } finally { ledger.close(); }
});