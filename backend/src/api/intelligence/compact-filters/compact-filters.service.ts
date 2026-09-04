import crypto from 'crypto';
import {
  CompactFilterProvider,
  CompactFilterCheckpoint,
  CompactFilter,
  CompactFilterConflict,
  CompactFilterVerificationRun,
  CompactFilterOverviewResponse,
} from './compact-filters.models';

export class CompactFiltersService {
  private providers: Map<string, CompactFilterProvider> = new Map();
  private checkpoints: Map<string, CompactFilterCheckpoint> = new Map();
  private filters: Map<string, CompactFilter> = new Map();
  private conflicts: Map<string, CompactFilterConflict> = new Map();
  private verificationRuns: Map<string, CompactFilterVerificationRun> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    const provider1: CompactFilterProvider = {
      provider_id: 'filter-peer-us-east',
      endpoint: '159.195.109.76:8333',
      peer_address: '159.195.109.76:8333',
      service_flags: ['NODE_NETWORK', 'NODE_WITNESS', 'NODE_COMPACT_FILTERS'],
      supports_compact_filters: true,
      tip_height: 860500,
      filter_tip_height: 860500,
      response_latency_ms: 32,
      reliability_score: 99.8,
      last_checkpoint_hash: '3f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
      has_conflicting_headers: false,
      software_version: '/Satoshi:28.0.0/',
      last_observed_at: '2026-09-04T05:00:00Z',
    };

    const provider2: CompactFilterProvider = {
      provider_id: 'filter-peer-eu-central',
      endpoint: '152.53.92.251:8333',
      peer_address: '152.53.92.251:8333',
      service_flags: ['NODE_NETWORK', 'NODE_WITNESS', 'NODE_COMPACT_FILTERS'],
      supports_compact_filters: true,
      tip_height: 860500,
      filter_tip_height: 860500,
      response_latency_ms: 45,
      reliability_score: 99.4,
      last_checkpoint_hash: '3f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
      has_conflicting_headers: false,
      software_version: '/Satoshi:28.0.0/',
      last_observed_at: '2026-09-04T05:00:00Z',
    };

    const provider3: CompactFilterProvider = {
      provider_id: 'filter-peer-experimental-sg',
      endpoint: '45.12.88.9:8333',
      peer_address: '45.12.88.9:8333',
      service_flags: ['NODE_NETWORK', 'NODE_WITNESS', 'NODE_COMPACT_FILTERS'],
      supports_compact_filters: true,
      tip_height: 860498,
      filter_tip_height: 860495,
      response_latency_ms: 120,
      reliability_score: 94.2,
      last_checkpoint_hash: '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
      has_conflicting_headers: true,
      software_version: '/btcd:0.24.2/',
      last_observed_at: '2026-09-04T04:55:00Z',
    };

    this.providers.set(provider1.provider_id, provider1);
    this.providers.set(provider2.provider_id, provider2);
    this.providers.set(provider3.provider_id, provider3);

    const cp1: CompactFilterCheckpoint = {
      checkpoint_id: 'cp-860000',
      block_height: 860000,
      block_hash: '000000000000000000018a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
      filter_header: '5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b',
      filter_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      provider_agreement_ratio: 1.0,
      agreeing_providers_count: 3,
      disagreeing_providers_count: 0,
    };
    this.checkpoints.set(cp1.checkpoint_id, cp1);

    const filter1: CompactFilter = {
      block_hash: '000000000000000000018a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
      block_height: 860000,
      filter_type: 'basic_0x00',
      element_count: 3420,
      filter_bytes_hex: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
      filter_hash: cp1.filter_hash,
      filter_header: cp1.filter_header,
      false_positive_rate: 0.0000012,
      includes_spent_prevouts: true,
      includes_outputs: true,
      excludes_op_return: true,
    };
    this.filters.set(filter1.block_hash, filter1);

    const conflict1: CompactFilterConflict = {
      conflict_id: 'conf-860450-divergence',
      block_height: 860450,
      block_hash: '000000000000000000033a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c33',
      reported_filter_hash_a: '99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa',
      provider_a: provider1.provider_id,
      reported_filter_hash_b: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      provider_b: provider3.provider_id,
      canonical_recomputed_hash: '99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa',
      disagreeing_provider: provider3.provider_id,
      detected_at: '2026-09-03T22:15:00Z',
      evidence_retained: true,
    };
    this.conflicts.set(conflict1.conflict_id, conflict1);
  }

  public getOverview(): CompactFilterOverviewResponse {
    const provs = Array.from(this.providers.values());
    const healthyCount = provs.filter((p) => p.reliability_score > 95 && !p.has_conflicting_headers).length;

    return {
      total_providers: provs.length,
      healthy_providers: healthyCount,
      filter_tip_height: 860500,
      total_checkpoints: this.checkpoints.size,
      recent_checkpoints: Array.from(this.checkpoints.values()),
      active_conflicts: Array.from(this.conflicts.values()),
      providers: provs,
    };
  }

  public listProviders(): CompactFilterProvider[] {
    return Array.from(this.providers.values());
  }

  public getProvider(providerId: string): CompactFilterProvider | undefined {
    return this.providers.get(providerId);
  }

  public getProviderHistory(providerId: string): any[] {
    const prov = this.providers.get(providerId);
    if (!prov) return [];
    return [
      {
        height: 860500,
        latency_ms: prov.response_latency_ms,
        passed_integrity_check: !prov.has_conflicting_headers,
        timestamp: prov.last_observed_at,
      },
    ];
  }

  public listCheckpoints(): CompactFilterCheckpoint[] {
    return Array.from(this.checkpoints.values());
  }

  public getBlockFilter(blockHash: string): CompactFilter | undefined {
    return (
      this.filters.get(blockHash) ||
      Array.from(this.filters.values())[0] // Return default if hash not found for demo consistency
    );
  }

  public getRanges(): Array<{ range_start: number; range_end: number; filter_type: string; status: string }> {
    return [
      {
        range_start: 859000,
        range_end: 860000,
        filter_type: 'basic_0x00',
        status: 'verified_complete',
      },
      {
        range_start: 860001,
        range_end: 860500,
        filter_type: 'basic_0x00',
        status: 'verified_complete',
      },
    ];
  }

  public createVerification(params: {
    start_height: number;
    end_height: number;
    providers: string[];
  }): CompactFilterVerificationRun {
    const runId = `vrun-${Date.now()}`;
    const totalBlocks = Math.max(1, params.end_height - params.start_height + 1);
    const hasConflict = params.providers.includes('filter-peer-experimental-sg');

    const manifestHash = crypto
      .createHash('sha256')
      .update(`${params.start_height}:${params.end_height}:${params.providers.join(',')}`)
      .digest('hex');

    const run: CompactFilterVerificationRun = {
      verification_id: runId,
      start_height: params.start_height,
      end_height: params.end_height,
      total_blocks: totalBlocks,
      checked_providers: params.providers,
      all_agree: !hasConflict,
      conflicts_found: hasConflict ? 1 : 0,
      status: hasConflict ? 'discrepancy_detected' : 'completed',
      verified_at: new Date().toISOString(),
      manifest_hash: manifestHash,
    };

    this.verificationRuns.set(runId, run);
    return run;
  }

  public getVerification(verificationId: string): CompactFilterVerificationRun | undefined {
    return this.verificationRuns.get(verificationId);
  }
}

export default new CompactFiltersService();
