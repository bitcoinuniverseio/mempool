export interface GlobalNetworkSensor {
  sensor_id: string;
  region: string;
  asn?: number;
  software_version: string;
  status: 'active' | 'degraded' | 'offline';
  v1_supported: boolean | null;
  v2_bip324_supported: boolean | null;
  addrv2_bip155_supported: boolean | null;
  last_probe_utc: string;
  reachable_networks: string[];
}

export interface GlobalNetworkCrawlEpoch {
  epoch_id: string;
  network: string;
  started_at: string;
  completed_at?: string;
  discovered_nodes: number;
  reachable_nodes: number;
  v2_nodes: number;
  status: 'running' | 'completed' | 'failed';
  /** What the epoch actually covers. */
  scope: string;
}

export interface GlobalNetworkObservation {
  id: string;
  epoch_id: string;
  endpoint_id: string;
  ip_or_onion: string;
  port: number;
  services: number | null;
  services_hex: string | null;
  user_agent: string;
  start_height: number;
  relay: boolean | null;
  transport_v2: boolean | null;
  addrv2: boolean | null;
  latency_ms: number | null;
  country_code?: string;
  asn?: number;
  observed_at: string;
  inbound: boolean | null;
  network: string;
}

export interface GlobalNetworkDnsSeed {
  seed_id: string;
  hostname: string;
  maintainer: string;
  active: boolean | null;
  last_query_at: string;
  discovered_addrs_count: number | null;
  /** Null: discovered addresses are not probed by this deployment. */
  reachable_ratio: number | null;
  error: string | null;
}

export interface GlobalNetworkSelfCheckRequest {
  endpoint_address: string;
  port: number;
}

export interface GlobalNetworkSelfCheckResult {
  check_id: string;
  endpoint_address: string;
  port: number;
  resolved_address: string;
  probed_from_region: string;
  reachable: boolean;
  /** Null: only a TCP connection is attempted, not the Bitcoin handshake. */
  bip324_handshake: boolean | null;
  latency_ms: number | null;
  user_agent?: string;
  services?: number;
  error: string | null;
  probed_at: string;
}

export interface GlobalNetworkSnapshot {
  snapshot_id: string;
  network: string;
  block_height: number;
  timestamp_utc: string;
  total_nodes: number;
  v2_percentage: number | null;
  top_asns: { asn: number; org: string; count: number }[];
  top_clients: { client: string; count: number }[];
  geo_distribution: { country: string; count: number }[];
  scope: string;
}

export interface GlobalNetworkOverview {
  active_epoch: GlobalNetworkCrawlEpoch;
  sensors_count: number;
  total_reachable_nodes: number;
  bip324_v2_adoption_percentage: number | null;
  addrv2_adoption_percentage: number | null;
  top_user_agents: { agent: string; count: number; percentage: number }[];
  geographic_distribution: { country: string; count: number }[];
  /** Null: no geolocation source is configured, so no country is claimed. */
  geo_source: string | null;
  transport_breakdown: { transport: string; count: number }[];
  node: { version: number; subversion: string; connections: number; connections_in: number | null; connections_out: number | null; reachable_networks: string[] };
  last_updated: string;
}
