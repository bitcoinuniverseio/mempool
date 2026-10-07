import { Observable, Subject, catchError, defer, distinctUntilChanged, map, merge, of, startWith, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import type { GlobalNetworkOverview, GlobalNetworkNodesReport, GlobalNetworkSensorsReport,
  GlobalNetworkDnsReport, GlobalNetworkSnapshotsReport, GlobalNetworkNodeDetail } from './global-network.service';

const GENESIS: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};
type Row = Record<string, any>;
function record(value: unknown): value is Row { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max = 4096, empty = false): value is string {
  return typeof value === 'string' && (empty || value.length > 0) && value.length <= max;
}
function integer(value: unknown, max = 10000, min = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
function utc(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
function nullable(value: unknown, validate: (x: unknown) => boolean): boolean { return value === null || validate(value); }
function boolean(value: unknown): boolean { return typeof value === 'boolean'; }
function percentage(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100; }
function array(value: unknown, max: number, validate: (x: any) => boolean): value is any[] {
  return Array.isArray(value) && value.length <= max && value.every(validate);
}
function unique(rows: Row[], key: string): boolean { return new Set(rows.map(row => row[key])).size === rows.length; }
function context(value: Row, expected: string): boolean {
  return value.chain_network === expected && GENESIS[expected] === value.genesis_hash && utc(value.observed_at_utc)
    && integer(value.freshness_limit_ms, 30000, 1) && integer(value.age_ms, value.freshness_limit_ms)
    && text(value.scope);
}
function configured(value: Row, expected: string): boolean { return value.configured_network === expected && !!GENESIS[expected] && text(value.scope); }
function peer(value: unknown): value is Row {
  return record(value) && text(value.id, 256) && text(value.epoch_id, 256) && text(value.endpoint_id, 512)
    && text(value.ip_or_onion, 512) && integer(value.port, 65535) && text(value.user_agent, 1024, true)
    && integer(value.start_height, 0xffffffff, -1) && utc(value.observed_at) && text(value.network, 32)
    && nullable(value.services, x => integer(x, Number.MAX_SAFE_INTEGER))
    && nullable(value.services_hex, x => typeof x === 'string' && /^[0-9a-f]{1,16}$/i.test(x))
    && ['relay', 'transport_v2', 'addrv2', 'inbound'].every(key => nullable(value[key], boolean))
    && nullable(value.latency_ms, x => integer(x, Number.MAX_SAFE_INTEGER))
    && (value.asn === undefined || integer(value.asn, 0xffffffff))
    && (value.country_code === undefined || typeof value.country_code === 'string' && /^[A-Z]{2}$/.test(value.country_code));
}
function sensor(value: unknown): value is Row {
  return record(value) && text(value.sensor_id, 256) && text(value.region, 256) && text(value.software_version, 1024, true)
    && ['active', 'degraded', 'offline'].includes(value.status) && utc(value.last_probe_utc)
    && ['v1_supported', 'v2_bip324_supported', 'addrv2_bip155_supported'].every(key => nullable(value[key], boolean))
    && array(value.reachable_networks, 32, x => text(x, 32)) && (value.asn === undefined || integer(value.asn, 0xffffffff));
}
function seed(value: unknown): value is Row {
  return record(value) && text(value.seed_id, 256) && text(value.hostname, 253) && text(value.maintainer, 256)
    && utc(value.last_query_at) && nullable(value.active, boolean) && nullable(value.discovered_addrs_count, x => integer(x, 100000))
    && nullable(value.reachable_ratio, x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)
    && nullable(value.error, x => text(x, 4096));
}
function counts(value: unknown, key: string, total: number, max: number): value is Row[] {
  return array(value, max, x => record(x) && text(x[key], 1024) && integer(x.count, total))
    && (value as Row[]).reduce((sum, row) => sum + row.count, 0) <= total;
}
function snapshot(value: unknown): value is Row {
  return record(value) && text(value.snapshot_id, 256) && !!GENESIS[value.network] && integer(value.block_height, 0xffffffff)
    && utc(value.timestamp_utc) && integer(value.total_nodes) && nullable(value.v2_percentage, percentage) && text(value.scope)
    && counts(value.top_clients, 'client', value.total_nodes, 10) && counts(value.geo_distribution, 'country', value.total_nodes, 10000)
    && array(value.top_asns, 10000, x => record(x) && integer(x.asn, 0xffffffff) && text(x.org, 1024) && integer(x.count, value.total_nodes))
    && value.top_asns.reduce((sum: number, row: Row) => sum + row.count, 0) <= value.total_nodes;
}
function checked<T>(value: unknown, valid: boolean): T {
  if (!valid) { throw Error('Global Network response is malformed, stale, or belongs to another selected context.'); }
  return value as T;
}

export function parseGlobalNodes(value: unknown, expected: string, limit: number, offset: number): GlobalNetworkNodesReport {
  const v = value as Row;
  return checked(value, record(v) && context(v, expected) && integer(v.total) && array(v.nodes, limit, peer)
    && v.nodes.length === Math.min(limit, Math.max(0, v.total - offset)) && unique(v.nodes, 'id')
    && v.nodes.every((row: Row) => row.observed_at === v.observed_at_utc));
}
export function parseGlobalDetail(value: unknown, expected: string, endpoint: string): GlobalNetworkNodeDetail {
  const v = value as Row;
  return checked(value, peer(v) && context(v, expected) && v.endpoint_id === endpoint && v.observed_at === v.observed_at_utc);
}
export function parseGlobalSensors(value: unknown, expected: string): GlobalNetworkSensorsReport {
  const v = value as Row;
  return checked(value, record(v) && context(v, expected) && integer(v.total, 100) && array(v.sensors, 100, sensor)
    && v.total === v.sensors.length && unique(v.sensors, 'sensor_id') && v.sensors.every((row: Row) => row.last_probe_utc === v.observed_at_utc));
}
export function parseGlobalDns(value: unknown, expected: string): GlobalNetworkDnsReport {
  const v = value as Row;
  return checked(value, record(v) && configured(v, expected) && integer(v.total, 100) && array(v.seeds, 100, seed)
    && v.total === v.seeds.length && unique(v.seeds, 'seed_id'));
}
export function parseGlobalSnapshots(value: unknown, expected: string): GlobalNetworkSnapshotsReport {
  const v = value as Row;
  return checked(value, record(v) && configured(v, expected) && integer(v.total, 288) && array(v.snapshots, 288, snapshot)
    && v.total === v.snapshots.length && unique(v.snapshots, 'snapshot_id'));
}
export function parseGlobalOverview(value: unknown, expected: string): GlobalNetworkOverview {
  const v = value as Row, epoch = v?.active_epoch, node = v?.node;
  return checked(value, record(v) && record(epoch) && record(node) && epoch.network === expected && !!GENESIS[expected]
    && text(epoch.epoch_id, 256) && utc(epoch.started_at) && (epoch.completed_at === undefined || utc(epoch.completed_at))
    && ['running', 'completed', 'failed'].includes(epoch.status) && text(epoch.scope)
    && integer(epoch.discovered_nodes) && integer(epoch.reachable_nodes, epoch.discovered_nodes)
    && integer(epoch.v2_nodes, epoch.reachable_nodes) && integer(v.total_reachable_nodes)
    && v.total_reachable_nodes === epoch.reachable_nodes && integer(v.sensors_count, 100)
    && nullable(v.bip324_v2_adoption_percentage, percentage) && nullable(v.addrv2_adoption_percentage, percentage)
    && counts(v.top_user_agents, 'agent', v.total_reachable_nodes, 10) && v.top_user_agents.every((row: Row) => percentage(row.percentage))
    && counts(v.geographic_distribution, 'country', v.total_reachable_nodes, 10000) && nullable(v.geo_source, x => text(x, 1024))
    && counts(v.transport_breakdown, 'transport', v.total_reachable_nodes, 32)
    && v.transport_breakdown.reduce((sum: number, row: Row) => sum + row.count, 0) === v.total_reachable_nodes
    && integer(node.version, 0xffffffff) && text(node.subversion, 1024, true) && integer(node.connections)
    && nullable(node.connections_in, x => integer(x, node.connections)) && nullable(node.connections_out, x => integer(x, node.connections))
    && array(node.reachable_networks, 32, x => text(x, 32)) && utc(v.last_updated));
}

export function selectedGlobalNetwork(state: StateService | null): string { return state?.network || state?.env?.ROOT_NETWORK || 'mainnet'; }
export type GlobalReadState<T> = { kind: 'loading' | 'ready' | 'error'; value: T | null; error: string | null };
/** Actual context changes cancel prior reads; retries are explicit and same-context replayed signals are ignored. */
export function globalRead$<T>(state: StateService | null, retry: Subject<void>, read: () => Observable<T>): Observable<GlobalReadState<T>> {
  const contexts = state?.networkChanged$ ? state.networkChanged$.pipe(startWith(null), map(() => selectedGlobalNetwork(state)), distinctUntilChanged()) : of(selectedGlobalNetwork(state));
  return merge(contexts, retry).pipe(switchMap(() => defer(read).pipe(
    map(value => ({ kind: 'ready' as const, value, error: null })),
    catchError(() => of({ kind: 'error' as const, value: null, error: 'This selected source is unavailable or returned an invalid observation. Retry to request fresh facts.' })),
    startWith({ kind: 'loading' as const, value: null, error: null }),
  )));
}
