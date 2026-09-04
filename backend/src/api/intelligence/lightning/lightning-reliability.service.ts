import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  LightningProbeObservation,
  LightningNodeReliability,
  LightningLiquiditySimulationRequest,
  LightningLiquiditySimulationResult,
  LightningChannelLifecycle,
  LightningClosureForensics,
  LightningLspProvider,
  LightningReliabilityOverview,
} from './lightning-reliability.models';

export class LightningReliabilityService {
  private static instance: LightningReliabilityService;
  private eventBus = IntelligenceEventBus.getInstance();

  private nodes: Map<string, LightningNodeReliability> = new Map();
  private channels: Map<string, LightningChannelLifecycle> = new Map();
  private closures: Map<string, LightningClosureForensics> = new Map();
  private lspProviders: Map<string, LightningLspProvider> = new Map();

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): LightningReliabilityService {
    if (!LightningReliabilityService.instance) {
      LightningReliabilityService.instance = new LightningReliabilityService();
    }
    return LightningReliabilityService.instance;
  }

  private seedInitialData(): void {
    const samplePubkey1 = '03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f';
    const samplePubkey2 = '0279c22ed7a068d10dc1a38ae66d2d6461e269226c60258c021b1ddcdfe4b00bc4';
    const samplePubkey3 = '03cde60a6323f7122d5178255766e38114b4722ede08f79d4f0113c41a236d8641';

    const probesSample: LightningProbeObservation[] = [
      {
        probe_id: 'probe-1',
        node_pubkey: samplePubkey1,
        sensor_region: 'Virginia, US',
        handshake_success: true,
        latency_ms: 22,
        lsps_supported: ['LSPS0', 'LSPS1', 'LSPS2'],
        observed_at: new Date().toISOString(),
      },
      {
        probe_id: 'probe-2',
        node_pubkey: samplePubkey1,
        sensor_region: 'Frankfurt, DE',
        handshake_success: true,
        latency_ms: 38,
        lsps_supported: ['LSPS0', 'LSPS1', 'LSPS2'],
        observed_at: new Date().toISOString(),
      },
    ];

    this.nodes.set(samplePubkey1, {
      node_pubkey: samplePubkey1,
      alias: 'ACINQ',
      reachability_score: 99.8,
      gossip_freshness_seconds: 42,
      policy_volatility_score: 0.05,
      uptime_30d_percentage: 99.95,
      supported_lsps: ['LSPS0', 'LSPS1', 'LSPS2'],
      probes: probesSample,
      last_probed_at: new Date().toISOString(),
    });

    this.nodes.set(samplePubkey2, {
      node_pubkey: samplePubkey2,
      alias: 'River Financial',
      reachability_score: 99.5,
      gossip_freshness_seconds: 55,
      policy_volatility_score: 0.08,
      uptime_30d_percentage: 99.8,
      supported_lsps: ['LSPS0', 'LSPS2'],
      probes: [
        {
          probe_id: 'probe-3',
          node_pubkey: samplePubkey2,
          sensor_region: 'Virginia, US',
          handshake_success: true,
          latency_ms: 18,
          lsps_supported: ['LSPS0', 'LSPS2'],
          observed_at: new Date().toISOString(),
        },
      ],
      last_probed_at: new Date().toISOString(),
    });

    this.nodes.set(samplePubkey3, {
      node_pubkey: samplePubkey3,
      alias: 'Breez LSP',
      reachability_score: 98.9,
      gossip_freshness_seconds: 120,
      policy_volatility_score: 0.12,
      uptime_30d_percentage: 99.4,
      supported_lsps: ['LSPS0', 'LSPS1', 'LSPS2', 'LSPS5'],
      probes: [],
      last_probed_at: new Date().toISOString(),
    });

    // Sample channels
    const sampleChannel1: LightningChannelLifecycle = {
      channel_id: '860400x120x0',
      short_channel_id: '860400x120x0',
      funding_txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      funding_vout: 0,
      node1_pubkey: samplePubkey1,
      node1_alias: 'ACINQ',
      node2_pubkey: samplePubkey2,
      node2_alias: 'River Financial',
      capacity_sats: 100000000, // 1 BTC
      opened_height: 860400,
      status: 'active',
    };

    const sampleChannel2: LightningChannelLifecycle = {
      channel_id: '859200x45x1',
      short_channel_id: '859200x45x1',
      funding_txid: '2b4c1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda11a',
      funding_vout: 1,
      node1_pubkey: samplePubkey1,
      node1_alias: 'ACINQ',
      node2_pubkey: samplePubkey3,
      node2_alias: 'Breez LSP',
      capacity_sats: 50000000,
      opened_height: 859200,
      closed_height: 860100,
      status: 'closed',
      closure_txid: '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e',
      closure_type: 'cooperative',
    };

    this.channels.set(sampleChannel1.short_channel_id, sampleChannel1);
    this.channels.set(sampleChannel2.short_channel_id, sampleChannel2);

    // Sample closure forensics
    this.closures.set(sampleChannel2.closure_txid!, {
      closure_txid: sampleChannel2.closure_txid!,
      channel_id: sampleChannel2.channel_id,
      short_channel_id: sampleChannel2.short_channel_id,
      closure_type: 'cooperative',
      closed_at_height: 860100,
      reclaimed_balance_sats: 49995000,
      contested_balance_sats: 0,
      swept_htlcs_count: 0,
      timelock_delay_blocks: 0,
      settlement_status: 'settled',
    });

    // Sample LSP providers
    this.lspProviders.set('lsp-acinq', {
      provider_id: 'lsp-acinq',
      name: 'ACINQ LSP',
      node_pubkey: samplePubkey1,
      endpoint_url: 'https://lsp.acinq.co',
      lsps0_supported: true,
      lsps1_order_supported: true,
      lsps2_jit_supported: true,
      lsps5_metrics_supported: false,
      active_channel_capacity_sats: 45000000000,
      compliance_verified: true,
      specs: { min_channel_sats: 50000, max_channel_sats: 16777215 },
      updated_at: new Date().toISOString(),
    });

    this.lspProviders.set('lsp-breez', {
      provider_id: 'lsp-breez',
      name: 'Breez LSP',
      node_pubkey: samplePubkey3,
      endpoint_url: 'https://lsp.breez.technology',
      lsps0_supported: true,
      lsps1_order_supported: true,
      lsps2_jit_supported: true,
      lsps5_metrics_supported: true,
      active_channel_capacity_sats: 28000000000,
      compliance_verified: true,
      specs: { min_channel_sats: 10000, max_channel_sats: 10000000 },
      updated_at: new Date().toISOString(),
    });
  }

  public getOverview(): LightningReliabilityOverview {
    const nodesList = Array.from(this.nodes.values());
    const totalNodes = nodesList.length;
    const avgUptime = totalNodes > 0
      ? Number((nodesList.reduce((acc, n) => acc + n.uptime_30d_percentage, 0) / totalNodes).toFixed(2))
      : 100.0;

    return {
      total_probed_nodes: 4850,
      fleet_average_uptime_percentage: avgUptime,
      active_lsp_providers_count: this.lspProviders.size,
      recent_closures_24h: {
        cooperative: 42,
        unilateral: 8,
        penalty: 1,
      },
      top_reliable_nodes: nodesList.slice(0, 5).map(n => ({
        pubkey: n.node_pubkey,
        alias: n.alias || n.node_pubkey.slice(0, 16),
        score: n.reachability_score,
        uptime: n.uptime_30d_percentage,
      })),
      last_updated: new Date().toISOString(),
    };
  }

  public getNodeReliability(pubkey: string): LightningNodeReliability | null {
    return this.nodes.get(pubkey) || null;
  }

  public getChannelLifecycle(shortId: string): LightningChannelLifecycle | null {
    return this.channels.get(shortId) || null;
  }

  public getClosureForensics(txid: string): LightningClosureForensics | null {
    return this.closures.get(txid) || null;
  }

  public getLspProviders(): LightningLspProvider[] {
    return Array.from(this.lspProviders.values());
  }

  public simulateLiquidity(req: LightningLiquiditySimulationRequest): LightningLiquiditySimulationResult {
    if (!req.target_pubkey || typeof req.target_pubkey !== 'string') {
      throw new Error('Target pubkey is required for liquidity simulation.');
    }
    if (!req.amount_sats || req.amount_sats <= 0) {
      throw new Error('Amount in satoshis must be greater than zero.');
    }

    const targetNode = this.nodes.get(req.target_pubkey);
    const score = targetNode ? targetNode.reachability_score : 90.0;
    const prob = Math.min(0.99, Math.max(0.4, (score / 100) * (req.amount_sats < 1000000 ? 0.95 : 0.85)));

    return {
      simulation_id: 'sim-' + crypto.randomBytes(4).toString('hex'),
      target_pubkey: req.target_pubkey,
      amount_sats: req.amount_sats,
      estimated_path_probability: Number(prob.toFixed(4)),
      estimated_fee_sats: Math.max(1, Math.round(req.amount_sats * 0.0003)),
      min_hops: 2,
      available_capacity_estimate_sats: req.amount_sats * 3,
      confidence_rating: prob > 0.85 ? 'high' : prob > 0.65 ? 'moderate' : 'low',
    };
  }
}

export const lightningReliabilityService = LightningReliabilityService.getInstance();
