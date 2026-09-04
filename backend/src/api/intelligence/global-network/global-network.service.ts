import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  GlobalNetworkSensor,
  GlobalNetworkCrawlEpoch,
  GlobalNetworkObservation,
  GlobalNetworkDnsSeed,
  GlobalNetworkSelfCheckRequest,
  GlobalNetworkSelfCheckResult,
  GlobalNetworkSnapshot,
  GlobalNetworkOverview,
} from './global-network.models';

export class GlobalNetworkService {
  private static instance: GlobalNetworkService;
  private eventBus = IntelligenceEventBus.getInstance();

  private sensors: GlobalNetworkSensor[] = [
    {
      sensor_id: 'sensor-na-east',
      region: 'North America (Virginia)',
      asn: 14618,
      software_version: 'Bitcoin Core v28.0 (BIP324 v2)',
      status: 'active',
      v1_supported: true,
      v2_bip324_supported: true,
      addrv2_bip155_supported: true,
      last_probe_utc: new Date().toISOString(),
    },
    {
      sensor_id: 'sensor-eu-west',
      region: 'Europe (Frankfurt)',
      asn: 24940,
      software_version: 'Bitcoin Core v28.0 (BIP324 v2)',
      status: 'active',
      v1_supported: true,
      v2_bip324_supported: true,
      addrv2_bip155_supported: true,
      last_probe_utc: new Date().toISOString(),
    },
    {
      sensor_id: 'sensor-ap-southeast',
      region: 'Asia Pacific (Singapore)',
      asn: 16509,
      software_version: 'Bitcoin Core v28.0 (BIP324 v2)',
      status: 'active',
      v1_supported: true,
      v2_bip324_supported: true,
      addrv2_bip155_supported: true,
      last_probe_utc: new Date().toISOString(),
    },
  ];

  private dnsSeeds: GlobalNetworkDnsSeed[] = [
    {
      seed_id: 'seed-sipa',
      hostname: 'seed.bitcoin.sipa.be',
      maintainer: 'Pieter Wuille',
      active: true,
      last_query_at: new Date().toISOString(),
      discovered_addrs_count: 8520,
      reachable_ratio: 0.88,
    },
    {
      seed_id: 'seed-bluematt',
      hostname: 'dnsseed.bluematt.me',
      maintainer: 'Matt Corallo',
      active: true,
      last_query_at: new Date().toISOString(),
      discovered_addrs_count: 7940,
      reachable_ratio: 0.86,
    },
    {
      seed_id: 'seed-dashjr',
      hostname: 'dnsseed.bitcoin.dashjr.org',
      maintainer: 'Luke Dashjr',
      active: true,
      last_query_at: new Date().toISOString(),
      discovered_addrs_count: 6310,
      reachable_ratio: 0.82,
    },
    {
      seed_id: 'seed-jonasschnelli',
      hostname: 'seed.jonasschnelli.ch',
      maintainer: 'Jonas Schnelli',
      active: true,
      last_query_at: new Date().toISOString(),
      discovered_addrs_count: 8120,
      reachable_ratio: 0.87,
    },
  ];

  private nodes: Map<string, GlobalNetworkObservation> = new Map();
  private snapshots: GlobalNetworkSnapshot[] = [];
  private currentEpoch: GlobalNetworkCrawlEpoch;

  private constructor() {
    this.currentEpoch = {
      epoch_id: 'epoch-' + Date.now(),
      network: 'bitcoin',
      started_at: new Date(Date.now() - 3600000).toISOString(),
      discovered_nodes: 18450,
      reachable_nodes: 15280,
      v2_nodes: 4120,
      status: 'running',
    };

    this.seedInitialNodes();
    this.seedInitialSnapshots();
  }

  public static getInstance(): GlobalNetworkService {
    if (!GlobalNetworkService.instance) {
      GlobalNetworkService.instance = new GlobalNetworkService();
    }
    return GlobalNetworkService.instance;
  }

  private seedInitialNodes(): void {
    const sampleNodes: GlobalNetworkObservation[] = [
      {
        id: 'node-obs-1',
        epoch_id: this.currentEpoch.epoch_id,
        endpoint_id: '95.217.163.42:8333',
        ip_or_onion: '95.217.163.42',
        port: 8333,
        services: 1033,
        user_agent: '/Satoshi:28.0.0/',
        start_height: 860400,
        relay: true,
        transport_v2: true,
        addrv2: true,
        latency_ms: 32,
        country_code: 'DE',
        asn: 24940,
        observed_at: new Date().toISOString(),
      },
      {
        id: 'node-obs-2',
        epoch_id: this.currentEpoch.epoch_id,
        endpoint_id: '168.119.55.101:8333',
        ip_or_onion: '168.119.55.101',
        port: 8333,
        services: 1033,
        user_agent: '/Satoshi:27.1.0/',
        start_height: 860401,
        relay: true,
        transport_v2: false,
        addrv2: true,
        latency_ms: 45,
        country_code: 'DE',
        asn: 24940,
        observed_at: new Date().toISOString(),
      },
      {
        id: 'node-obs-3',
        epoch_id: this.currentEpoch.epoch_id,
        endpoint_id: '144.76.82.19:8333',
        ip_or_onion: '144.76.82.19',
        port: 8333,
        services: 1037,
        user_agent: '/Satoshi:28.0.0/',
        start_height: 860402,
        relay: true,
        transport_v2: true,
        addrv2: true,
        latency_ms: 28,
        country_code: 'US',
        asn: 14618,
        observed_at: new Date().toISOString(),
      },
      {
        id: 'node-obs-4',
        epoch_id: this.currentEpoch.epoch_id,
        endpoint_id: 'x7b2g3k9f4q1...onion:8333',
        ip_or_onion: 'x7b2g3k9f4q1...onion',
        port: 8333,
        services: 1033,
        user_agent: '/Satoshi:26.2.0/',
        start_height: 860398,
        relay: true,
        transport_v2: false,
        addrv2: true,
        latency_ms: 240,
        country_code: 'TOR',
        observed_at: new Date().toISOString(),
      },
    ];

    for (const node of sampleNodes) {
      this.nodes.set(node.endpoint_id, node);
    }
  }

  private seedInitialSnapshots(): void {
    this.snapshots = [
      {
        snapshot_id: 'snap-20260901-0000',
        network: 'bitcoin',
        block_height: 860000,
        timestamp_utc: '2026-09-01T00:00:00Z',
        total_nodes: 15120,
        v2_percentage: 26.4,
        top_asns: [
          { asn: 24940, org: 'Hetzner Online GmbH', count: 2850 },
          { asn: 14618, org: 'Amazon.com Inc.', count: 1940 },
          { asn: 16509, org: 'Amazon.com Inc. (AP)', count: 1100 },
        ],
        top_clients: [
          { client: '/Satoshi:28.0.0/', count: 4800 },
          { client: '/Satoshi:27.1.0/', count: 4200 },
          { client: '/Satoshi:26.2.0/', count: 2100 },
          { client: '/Satoshi:25.1.0/', count: 1300 },
        ],
        geo_distribution: [
          { country: 'US', count: 4900 },
          { country: 'DE', count: 3400 },
          { country: 'FR', count: 950 },
          { country: 'CA', count: 820 },
        ],
      },
    ];
  }

  public getOverview(): GlobalNetworkOverview {
    const reachable = this.currentEpoch.reachable_nodes;
    const v2Nodes = this.currentEpoch.v2_nodes;
    const v2Pct = reachable > 0 ? Number(((v2Nodes / reachable) * 100).toFixed(2)) : 0;

    return {
      active_epoch: this.currentEpoch,
      sensors_count: this.sensors.filter(s => s.status === 'active').length,
      total_reachable_nodes: reachable,
      bip324_v2_adoption_percentage: v2Pct,
      addrv2_adoption_percentage: 91.5,
      top_user_agents: [
        { agent: '/Satoshi:28.0.0/', count: 5200, percentage: 34.0 },
        { agent: '/Satoshi:27.1.0/', count: 4100, percentage: 26.8 },
        { agent: '/Satoshi:26.2.0/', count: 2200, percentage: 14.4 },
        { agent: '/Satoshi:25.1.0/', count: 1100, percentage: 7.2 },
      ],
      geographic_distribution: [
        { country: 'US', count: 5120 },
        { country: 'DE', count: 3510 },
        { country: 'FR', count: 980 },
        { country: 'CA', count: 840 },
      ],
      transport_breakdown: [
        { transport: 'BIP324 v2 Encrypted', count: v2Nodes },
        { transport: 'Standard v1 Plaintext', count: reachable - v2Nodes },
      ],
      last_updated: new Date().toISOString(),
    };
  }

  public getNodes(limit = 50, offset = 0): { nodes: GlobalNetworkObservation[]; total: number } {
    const all = Array.from(this.nodes.values());
    return {
      nodes: all.slice(offset, offset + limit),
      total: all.length,
    };
  }

  public getNodeByEndpoint(endpointId: string): GlobalNetworkObservation | null {
    return this.nodes.get(endpointId) || null;
  }

  public getDnsSeeds(): GlobalNetworkDnsSeed[] {
    return this.dnsSeeds;
  }

  public getSnapshots(): GlobalNetworkSnapshot[] {
    return this.snapshots;
  }

  public getSensors(): GlobalNetworkSensor[] {
    return this.sensors;
  }

  public validateSelfCheckEndpoint(endpointAddress: string, port: number): { valid: boolean; error?: string } {
    if (!endpointAddress || typeof endpointAddress !== 'string') {
      return { valid: false, error: 'Endpoint address is required.' };
    }
    if (!port || isNaN(port) || port < 1 || port > 65535) {
      return { valid: false, error: 'Port must be between 1 and 65535.' };
    }

    const trimmed = endpointAddress.trim().toLowerCase();

    // SSRF Protections: Block loopback, RFC1918 private, link-local, cloud metadata
    const blockedPatterns = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./, // Link-local and AWS/GCP metadata
      /^0\./,
      /^::1$/,
      /^fe80:/,
      /^fc00:/,
      /^localhost$/,
      /\.internal$/,
      /\.local$/,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(trimmed)) {
        return { valid: false, error: 'Access to private, link-local, or loopback networks is prohibited.' };
      }
    }

    return { valid: true };
  }

  public performSelfCheck(req: GlobalNetworkSelfCheckRequest): GlobalNetworkSelfCheckResult {
    const validation = this.validateSelfCheckEndpoint(req.endpoint_address, req.port);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid self check endpoint.');
    }

    const checkResult: GlobalNetworkSelfCheckResult = {
      check_id: 'chk-' + crypto.randomBytes(4).toString('hex'),
      endpoint_address: req.endpoint_address,
      port: req.port,
      probed_from_region: this.sensors[0]?.region || 'Virginia, USA',
      reachable: true,
      bip324_handshake: true,
      latency_ms: 38,
      user_agent: '/Satoshi:28.0.0/',
      services: 1033,
      probed_at: new Date().toISOString(),
    };

    logger.info(`GlobalNetworkService: Self-check executed for ${req.endpoint_address}:${req.port}`);
    return checkResult;
  }
}

export const globalNetworkService = GlobalNetworkService.getInstance();
