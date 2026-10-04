import { createHash } from 'crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, isAbsolute } from 'path';
import { ConsensusIncident, IncidentObservation, IncidentProfile, IncidentResponse } from './incident-types';
import { incidentFailure, incidentProfileHash, validateIncidentProfile } from './incident-source';

interface State {
  schema: 'universe-incident-ledger-v1'; profile: IncidentProfile; profile_sha256: string;
  started_at_utc: string; last_observed_at_utc: string | null; observation_count: number;
  sources: { observation: IncidentObservation; unchanged_since_utc: string }[];
  incidents: ConsensusIncident[]; gaps: IncidentResponse['coverage']['gaps'];
  integrity_sha256: string;
}
const LIMIT = 8 * 1024 * 1024;
const utc = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function integrity(s: State): string { const { integrity_sha256: ignored, ...payload } = s; void ignored; return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
function validateObservation(value: IncidentObservation, profile: IncidentProfile): void {
  if (!value || !profile.sources.some(s => s.source_id === value.source_id) || !utc(value.observed_at_utc)
    || !Array.isArray(value.headers) || !value.headers.length || value.headers.length > 128) throw incidentFailure('invalid-incident-observation');
  value.headers.forEach((h, i) => {
    if (!Number.isSafeInteger(h.height) || h.height < 0 || typeof h.hash !== 'string' || !/^[0-9a-f]{64}$/.test(h.hash) || typeof h.parent !== 'string' || !/^[0-9a-f]{64}$/.test(h.parent)
      || !Number.isSafeInteger(h.timestamp) || h.timestamp < 0 || i > 0 && (h.height !== value.headers[i - 1].height + 1 || h.parent !== value.headers[i - 1].hash)) throw incidentFailure('invalid-incident-observation');
  });
}

/** Single writer, immutable registration, atomic fsynced checkpoints. No silent retention eviction. */
export class IncidentLedger {
  private state: State;
  private closed = false;
  private readonly lock: string;
  private readonly owner: string;
  public readonly profile: IncidentProfile;
  constructor(private readonly file: string, profile: IncidentProfile, private readonly now: () => number = Date.now) {
    this.profile = validateIncidentProfile(profile);
    if (!isAbsolute(file)) throw incidentFailure('invalid-incident-ledger');
    const directory = dirname(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || typeof process.getuid === 'function' && (dir.uid !== process.getuid() || (dir.mode & 0o077) !== 0)) throw incidentFailure('invalid-incident-ledger');
    this.lock = file + '.lock'; this.owner = JSON.stringify({ pid: process.pid, nonce: createHash('sha256').update(file + now() + Math.random()).digest('hex') });
    const recovery = this.lock + '.recovery';
    try { mkdirSync(recovery, { mode: 0o700 }); } catch { throw incidentFailure('incident-ledger-busy'); }
    try {
    if (existsSync(this.lock)) {
      const old = this.read(this.lock, 1024); let pid: number;
      try { pid = JSON.parse(old.toString()).pid; } catch { throw incidentFailure('incident-ledger-busy'); }
      if (!Number.isSafeInteger(pid!) || pid! < 1) throw incidentFailure('incident-ledger-busy');
      try { process.kill(pid!, 0); throw incidentFailure('incident-ledger-busy'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw incidentFailure('incident-ledger-busy'); }
      // Recovery evidence remains in the same bounded namespace; no live-owner takeover.
      const archive = this.lock + '.dead-' + createHash('sha256').update(old).digest('hex');
      if (!existsSync(archive)) writeFileSync(archive, old, { flag: 'wx', mode: 0o600 });
      unlinkSync(this.lock);
    }
    const fd = openSync(this.lock, 'wx', 0o600);
    try { writeFileSync(fd, this.owner); fsyncSync(fd); } finally { closeSync(fd); }
    } finally { rmdirSync(recovery); }
    try {
      const pending = file + '.pending-' + process.pid;
      // A pending write is not an accepted checkpoint. Preserve its bytes;
      // never replace the last atomic checkpoint with an interrupted suffix.
      if (existsSync(pending)) {
        const bytes = this.read(pending, LIMIT);
        renameSync(pending, pending + '.interrupted-' + createHash('sha256').update(bytes).digest('hex'));
      }
      if (existsSync(file)) {
        this.state = JSON.parse(this.read(file, LIMIT).toString('utf8'));
        this.validateState(this.state);
        this.state.gaps.push({ at_utc: new Date(now()).toISOString(), reason: 'restart' });
      } else this.state = { schema: 'universe-incident-ledger-v1', profile: this.profile, profile_sha256: incidentProfileHash(this.profile),
        started_at_utc: new Date(now()).toISOString(), last_observed_at_utc: null, observation_count: 0, sources: [], incidents: [], gaps: [], integrity_sha256: '' };
      this.persist(this.state);
    } catch (error) { this.close(); throw error; }
  }
  private read(file: string, limit: number): Buffer {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > limit || typeof process.getuid === 'function' && (before.uid !== process.getuid() || (before.mode & 0o077) !== 0)) throw incidentFailure('invalid-incident-ledger');
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = fstatSync(fd);
      const protectedFile = (s: typeof before) => s.isFile() && s.size <= limit && (typeof process.getuid !== 'function' || s.uid === process.getuid() && (s.mode & 0o077) === 0);
      if (opened.ino !== before.ino || opened.dev !== before.dev || !protectedFile(opened)) throw incidentFailure('invalid-incident-ledger');
      const bytes = Buffer.alloc(limit + 1), length = readSync(fd, bytes, 0, bytes.length, 0), after = fstatSync(fd);
      if (length > limit || after.size !== length || after.mtimeMs !== opened.mtimeMs || !protectedFile(after) || after.ino !== opened.ino || after.dev !== opened.dev) throw incidentFailure('invalid-incident-ledger');
      return bytes.subarray(0, length);
    } finally { closeSync(fd); }
  }
  private validateState(s: State): void {
    if (s?.schema !== 'universe-incident-ledger-v1' || s.integrity_sha256 !== integrity(s) || s.profile_sha256 !== incidentProfileHash(this.profile)
      || incidentProfileHash(validateIncidentProfile(s.profile)) !== s.profile_sha256 || !utc(s.started_at_utc)
      || s.last_observed_at_utc !== null && !utc(s.last_observed_at_utc) || !Number.isSafeInteger(s.observation_count) || s.observation_count < 0
      || !Array.isArray(s.sources) || s.sources.length > 4 || new Set(s.sources.map(x => x.observation?.source_id)).size !== s.sources.length
      || !Array.isArray(s.incidents) || s.incidents.length > 256 || !Array.isArray(s.gaps) || s.gaps.length > 256) throw incidentFailure('invalid-incident-ledger');
    s.sources.forEach(x => { validateObservation(x.observation, this.profile); if (!utc(x.unchanged_since_utc)) throw incidentFailure('invalid-incident-ledger'); });
    s.gaps.forEach(x => { if (!utc(x.at_utc) || !['restart', 'source-unavailable', 'ancestor-outside-window'].includes(x.reason)) throw incidentFailure('invalid-incident-ledger'); });
    s.incidents.forEach(x => {
      if (typeof x.incident_id !== 'string' || !/^[0-9a-f]{64}$/.test(x.incident_id) || !['reorg', 'stale_tip', 'node_tip_divergence'].includes(x.incident_type)
        || !['investigating', 'resolved', 'mitigated'].includes(x.status) || !utc(x.detected_at_utc)
        || x.resolved_at_utc !== null && !utc(x.resolved_at_utc) || !Number.isSafeInteger(x.block_height) || x.block_height < 0 || typeof x.block_hash !== 'string' || !/^[0-9a-f]{64}$/.test(x.block_hash)
        || x.displaced_tx_count !== null || x.double_spend_attempts_count !== null || !Array.isArray(x.timeline) || !x.timeline.length || x.timeline.length > 128
        || !Array.isArray(x.source_ids) || x.source_ids.some(id => !this.profile.sources.some(p => p.source_id === id))
        || !x.evidence || !Array.isArray(x.evidence.before) || !Array.isArray(x.evidence.after)
        || [x.title, x.summary, x.technical_postmortem].some(v => typeof v !== 'string' || v.length > 4096)
        || new Set(x.source_ids).size !== x.source_ids.length || !x.source_ids.length
        || x.status !== 'resolved' && (x.resolved_at_utc !== null || x.duration_seconds !== null)
        || x.status === 'resolved' && (x.resolved_at_utc === null || x.duration_seconds === null || Date.parse(x.resolved_at_utc) < Date.parse(x.detected_at_utc))) throw incidentFailure('invalid-incident-ledger');
      [x.evidence.before, x.evidence.after].filter(h => h.length).forEach(headers => validateObservation({ source_id: x.source_ids[0], observed_at_utc: x.detected_at_utc, headers }, this.profile));
      x.timeline.forEach((event, index) => {
        if (!event || !utc(event.observed_at_utc) || !['detected', 'matching-tip-observed'].includes(event.stage) || !Array.isArray(event.source_ids)
          || !event.source_ids.length || event.source_ids.some(id => !x.source_ids.includes(id)) || new Set(event.source_ids).size !== event.source_ids.length
          || index === 0 && (event.stage !== 'detected' || event.observed_at_utc !== x.detected_at_utc)
          || index > 0 && Date.parse(event.observed_at_utc) < Date.parse(x.timeline[index - 1].observed_at_utc)) throw incidentFailure('invalid-incident-ledger');
      });
      const ancestor = x.evidence.common_ancestor;
      if (ancestor !== null && (!x.evidence.before.some(h => JSON.stringify(h) === JSON.stringify(ancestor)) || !x.evidence.after.some(h => JSON.stringify(h) === JSON.stringify(ancestor)))) throw incidentFailure('invalid-incident-ledger');
      if (x.incident_type === 'reorg' && (!ancestor || !x.evidence.before.length || !x.evidence.after.length || x.reorg_depth !== x.evidence.before[x.evidence.before.length - 1].height - ancestor.height || x.reorg_depth < 1)) throw incidentFailure('invalid-incident-ledger');
      if (x.reorg_depth !== null && (!Number.isSafeInteger(x.reorg_depth) || x.reorg_depth < 0) || x.duration_seconds !== null && (!Number.isSafeInteger(x.duration_seconds) || x.duration_seconds < 0)) throw incidentFailure('invalid-incident-ledger');
    });
  }
  private persist(next: State): void {
    if (this.closed) throw incidentFailure('incident-ledger-closed');
    next.integrity_sha256 = integrity(next); this.validateState(next); const bytes = Buffer.from(JSON.stringify(next) + '\n');
    if (bytes.length > LIMIT) throw incidentFailure('incident-ledger-capacity');
    const temporary = this.file + '.pending-' + process.pid;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.file);
    if (process.platform !== 'win32') { const directory = openSync(dirname(this.file), constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); } }
    this.state = next;
  }
  private copy(): State { return JSON.parse(JSON.stringify(this.state)); }
  public gap(reason: 'source-unavailable'): void {
    const next = this.copy();
    if (next.gaps.length >= 256) throw incidentFailure('incident-ledger-capacity');
    next.gaps.push({ at_utc: new Date(this.now()).toISOString(), reason }); this.persist(next);
  }
  public record(observations: IncidentObservation[]): IncidentResponse {
    if (observations.length !== this.profile.sources.length || new Set(observations.map(o => o.source_id)).size !== observations.length) throw incidentFailure('invalid-incident-observation');
    observations.forEach(o => validateObservation(o, this.profile));
    const next = this.copy(), observed = new Date(this.now()).toISOString();
    const add = (type: ConsensusIncident['incident_type'], ids: string[], before: IncidentObservation['headers'], after: IncidentObservation['headers'], ancestor: IncidentObservation['headers'][number] | null) => {
      const tip = after[after.length - 1];
      const key = createHash('sha256').update(JSON.stringify([type, ids, before.map(h => h.hash), after.map(h => h.hash)])).digest('hex');
      if (next.incidents.some(i => i.incident_id === key)) return;
      if (next.incidents.length >= 256) throw incidentFailure('incident-ledger-capacity');
      next.incidents.push({ incident_id: key, incident_type: type, title: type === 'reorg' ? 'Observed canonical chain replacement' : type === 'stale_tip' ? 'Registered node tip unchanged beyond selected threshold' : 'Registered nodes disagree at a shared height',
        block_height: tip.height, block_hash: tip.hash, detected_at_utc: observed, resolved_at_utc: null, duration_seconds: null,
        reorg_depth: type === 'reorg' && ancestor ? before[before.length - 1].height - ancestor.height : null,
        displaced_tx_count: null, double_spend_attempts_count: null, status: 'investigating', source_ids: ids,
        summary: 'Bounded independently pinned node observations. This is not a global consensus or invalid-block verdict.',
        technical_postmortem: 'Transaction effects and protocol resolution have not been measured.',
        evidence: { before, after, common_ancestor: ancestor }, timeline: [{ observed_at_utc: observed, stage: 'detected', source_ids: ids }] });
    };
    for (const observation of observations) {
      const old = next.sources.find(s => s.observation.source_id === observation.source_id), tip = observation.headers[observation.headers.length - 1];
      if (old) {
        const oldTip = old.observation.headers[old.observation.headers.length - 1];
        const same = oldTip.hash === tip.hash;
        if (!same && !observation.headers.some(h => h.hash === oldTip.hash)) {
          const ancestor = [...old.observation.headers].reverse().find(h => observation.headers.some(n => n.height === h.height && n.hash === h.hash));
          if (ancestor) add('reorg', [observation.source_id], old.observation.headers, observation.headers, ancestor);
          else { if (next.gaps.length >= 256) throw incidentFailure('incident-ledger-capacity'); next.gaps.push({ at_utc: observed, reason: 'ancestor-outside-window' }); }
        }
        if (same && this.now() - Date.parse(old.unchanged_since_utc) >= this.profile.stale_after_seconds * 1000
          && !next.incidents.some(i => i.incident_type === 'stale_tip' && i.block_hash === tip.hash && i.source_ids.includes(observation.source_id))) add('stale_tip', [observation.source_id], old.observation.headers, observation.headers, tip);
        old.unchanged_since_utc = same ? old.unchanged_since_utc : observed; old.observation = observation;
      } else next.sources.push({ observation, unchanged_since_utc: observed });
    }
    for (let a = 0; a < observations.length; a++) for (let b = a + 1; b < observations.length; b++) {
      if (this.profile.sources.find(s => s.source_id === observations[a].source_id)!.independence_id === this.profile.sources.find(s => s.source_id === observations[b].source_id)!.independence_id) continue;
      const left = observations[a].headers, right = observations[b].headers;
      const height = Math.min(left[left.length - 1].height, right[right.length - 1].height);
      const l = left.find(h => h.height === height), r = right.find(h => h.height === height);
      if (l && r && l.hash !== r.hash) add('node_tip_divergence', [observations[a].source_id, observations[b].source_id], left, right, null);
    }
    next.last_observed_at_utc = observed; next.observation_count++;
    this.persist(next); return this.view(observed);
  }
  public view(observed = new Date(this.now()).toISOString()): IncidentResponse {
    const s = this.copy();
    return { schema: 'universe-incident-observations-v1', network: s.profile.network, profile: s.profile, profile_sha256: s.profile_sha256,
      observed_at_utc: observed, incidents: s.incidents, count: s.incidents.length,
      sources: s.profile.sources.map(p => { const observation = s.sources.find(x => x.observation.source_id === p.source_id)?.observation;
        return { source_id: p.source_id, status: observation ? 'observed' : 'unavailable', checkpoint: observation ? observation.headers[observation.headers.length - 1] : null, observed_at_utc: observation?.observed_at_utc || null }; }),
      coverage: { started_at_utc: s.started_at_utc, last_observed_at_utc: s.last_observed_at_utc, retained_header_limit: 128, retained_incident_limit: 256,
        observation_count: s.observation_count, gaps: s.gaps, complete_monitoring: false, global_consensus_verified: false,
        invalid_block_validation: 'unavailable', consensus_validation: 'unavailable', displaced_transactions: 'unmeasured', double_spend_attempts: 'unmeasured' } };
  }
  public close(): void {
    if (this.closed) return; this.closed = true;
    if (existsSync(this.lock) && this.read(this.lock, 1024).toString() === this.owner) unlinkSync(this.lock);
  }
}
