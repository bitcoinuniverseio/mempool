import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { BlockPropagationOverview, BlockPropagationObservation, CompactBlockDetail, ForkRaceRecord, FibreObservation, ForkRaceBranch } from './block-propagation.models';
export { BlockPropagationOverview } from './block-propagation.models';

const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
const list = (v: unknown, check: (v: any) => boolean) => Array.isArray(v) && v.length <= 10000 && v.every(check);
const block = (v: any) => !!v && hash(v.block_hash) && number(v.height) && number(v.tx_count)
  && number(v.block_size_bytes) && number(v.time_to_50_pct_sensors_ms) && number(v.time_to_90_pct_sensors_ms)
  && number(v.time_to_100_pct_sensors_ms) && number(v.average_reconstruction_duration_ms)
  && number(v.fallback_to_full_block_count) && number(v.short_id_collision_count)
  && list(v.sensor_observations, s => !!s && typeof s.sensor_id === 'string' && typeof s.region === 'string'
    && ['bip152_high_bandwidth', 'bip152_low_bandwidth', 'legacy_inv', 'fibre'].includes(s.relay_mechanism)
    && !!s.stages && number(s.stages.header_first_seen_ms) && number(s.stages.validation_complete_ms));
const raceStatuses = ['competing_header_observed', 'competing_block_observed', 'valid_stale_branch', 'invalid_branch', 'sensor_disagreement', 'node_lag', 'source_gap', 'resolved_to_most_work', 'unresolved', 'unknown'];
const race = (v: any) => !!v && typeof v.race_id === 'string' && number(v.divergence_height)
  && typeof v.discovered_at_utc === 'string' && raceStatuses.includes(v.resolution_status)
  && (v.winning_tip_hash === undefined || hash(v.winning_tip_hash))
  && list(v.branches, b => !!b && typeof b.branch_id === 'string' && hash(b.tip_block_hash)
    && number(b.tip_height) && typeof b.accumulated_work === 'string' && raceStatuses.includes(b.status)
    && typeof b.first_observed_sensor_id === 'string' && typeof b.first_observed_utc === 'string')
  && list(v.notes, n => typeof n === 'string');
const compact = (v: any) => !!v && hash(v.block_hash) && number(v.height) && [1, 2].includes(v.bip152_version)
  && ['prefilled_tx_count', 'short_id_count', 'missing_tx_count', 'collision_count'].every(k => number(v[k]))
  && ['reconstruction_success', 'merkle_root_verified', 'witness_commitment_verified', 'full_block_fallback'].every(k => typeof v[k] === 'boolean');
const fibre = (v: any) => !!v && hash(v.block_hash) && number(v.height)
  && ['fibre_delivery_time_ms', 'bip152_delivery_time_ms', 'chunk_count', 'chunk_loss_pct'].every(k => number(v[k]))
  && v.chunk_loss_pct <= 100 && typeof v.time_saved_ms === 'number' && Number.isFinite(v.time_saved_ms)
  && typeof v.fec_recovery_succeeded === 'boolean';
function checked<T>(value: unknown, check: (v: any) => boolean): T {
  if (!check(value)) throw Error('Malformed propagation source response');
  return value as T;
}
export function branchVerdict(record: ForkRaceRecord, branch: ForkRaceBranch): string {
  if (record.resolution_status === 'resolved_to_most_work' && record.winning_tip_hash === branch.tip_block_hash
    && !['invalid_branch', 'valid_stale_branch'].includes(branch.status)) return 'Source-reported winning tip';
  return branch.status.replace(/_/g, ' ');
}

@Injectable({ providedIn: 'root' })
export class BlockPropagationApiService {
  private readonly baseUrl = '/api/v1/intelligence/block-propagation';
  constructor(private http: HttpClient, private state: StateService) {}
  get networkChanged$(): Observable<string> { return this.state.networkChanged$; }
  getOverview$(): Observable<BlockPropagationOverview> {
    return this.http.get<unknown>(`${this.baseUrl}/overview`).pipe(map(v => checked<BlockPropagationOverview>(v, x => !!x
      && number(x.active_sensors_count) && number(x.average_propagation_time_50_pct_ms)
      && number(x.average_propagation_time_90_pct_ms) && number(x.reconstruction_success_rate_pct) && x.reconstruction_success_rate_pct <= 100
      && list(x.recent_blocks, block))));
  }
  getBlock$(id: string): Observable<BlockPropagationObservation> {
    if (!hash(id)) throw Error('Invalid block hash');
    return this.http.get<unknown>(`${this.baseUrl}/blocks/${encodeURIComponent(id)}`).pipe(map(v => checked<BlockPropagationObservation>(v, x => block(x) && x.block_hash.toLowerCase() === id.toLowerCase())));
  }
  getCompactBlocks$(): Observable<CompactBlockDetail[]> {
    return this.http.get<any>(`${this.baseUrl}/compact-blocks`).pipe(map(v => checked<CompactBlockDetail[]>(v?.compact_blocks, x => list(x, compact))));
  }
  getForkRaces$(): Observable<ForkRaceRecord[]> {
    return this.http.get<any>(`${this.baseUrl}/fork-races`).pipe(map(v => checked<ForkRaceRecord[]>(v?.fork_races, x => list(x, race))));
  }
  getForkRace$(id: string): Observable<ForkRaceRecord> {
    if (!id || id.length > 200) throw Error('Invalid race identifier');
    return this.http.get<unknown>(`${this.baseUrl}/fork-races/${encodeURIComponent(id)}`).pipe(map(v => checked<ForkRaceRecord>(v, x => race(x) && x.race_id === id)));
  }
  getFibre$(): Observable<FibreObservation[]> {
    return this.http.get<any>(`${this.baseUrl}/fibre`).pipe(map(v => checked<FibreObservation[]>(v?.fibre_observations, x => list(x, fibre))));
  }
  // These operations have no successful source contract yet. Retain their
  // actual unavailable response; an arbitrary 200 must not become telemetry.
  getLive$(): Observable<never> {
    return this.http.get<unknown>(`${this.baseUrl}/live`).pipe(map(() => { throw Error('Live telemetry source contract is unavailable'); }));
  }
  getStaleTips$(): Observable<never> {
    return this.http.get<unknown>(`${this.baseUrl}/stale-tips`).pipe(map(() => { throw Error('Stale-tip source contract is unavailable'); }));
  }
}
