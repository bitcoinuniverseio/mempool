import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  BlockspaceSemanticClass,
  BlockspaceCompositionPoint,
  BlockspaceRegimeEvent,
  BlockspaceTxEvidence,
  BlockspaceOverview,
} from './blockspace.models';

export class BlockspaceService {
  private static instance: BlockspaceService;
  private eventBus = IntelligenceEventBus.getInstance();

  private taxonomyClasses: BlockspaceSemanticClass[] = [];
  private timeseries: BlockspaceCompositionPoint[] = [];
  private regimes: BlockspaceRegimeEvent[] = [];

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): BlockspaceService {
    if (!BlockspaceService.instance) {
      BlockspaceService.instance = new BlockspaceService();
    }
    return BlockspaceService.instance;
  }

  private seedInitialData(): void {
    this.taxonomyClasses = [
      {
        class_id: 'class-simple-p2p',
        name: 'Simple Monetary Payments',
        category: 'monetary',
        description: 'Standard 1-in-2-out or 2-in-2-out payments between individual wallets.',
        weight_share_percentage: 32.5,
        fee_share_percentage: 30.2,
        tx_count_24h: 185000,
      },
      {
        class_id: 'class-batched-payout',
        name: 'Batched Multi-Output Payments',
        category: 'monetary',
        description: 'Exchange and pool withdrawal transactions with 10+ payment destinations.',
        weight_share_percentage: 18.2,
        fee_share_percentage: 22.4,
        tx_count_24h: 12400,
      },
      {
        class_id: 'class-consolidation',
        name: 'UTXO Consolidations',
        category: 'infrastructure',
        description: 'Multi-input single-output transactions consolidating dust and wallet balances.',
        weight_share_percentage: 14.8,
        fee_share_percentage: 8.5,
        tx_count_24h: 8200,
      },
      {
        class_id: 'class-lightning-channel',
        name: 'Lightning Channel Operations',
        category: 'layer2',
        description: 'Channel openings, cooperative closures, and commitment sweep transactions.',
        weight_share_percentage: 9.6,
        fee_share_percentage: 12.1,
        tx_count_24h: 6800,
      },
      {
        class_id: 'class-inscriptions',
        name: 'Inscriptions & Taproot Envelopes',
        category: 'arbitrary_data',
        description: 'Taproot script-path witness envelopes containing images, text, or audio data.',
        weight_share_percentage: 19.4,
        fee_share_percentage: 21.8,
        tx_count_24h: 94000,
      },
      {
        class_id: 'class-runes-alkanes',
        name: 'Runes, Alkanes & Token Protocols',
        category: 'arbitrary_data',
        description: 'OP_RETURN protocol messages, runestones, and token issuance/transfer markers.',
        weight_share_percentage: 5.5,
        fee_share_percentage: 5.0,
        tx_count_24h: 24000,
      },
    ];

    const baseHeight = 860400;
    for (let i = 0; i < 6; i++) {
      const h = baseHeight - i;
      this.timeseries.push({
        block_height: h,
        timestamp_utc: new Date(Date.now() - (i * 600000)).toISOString(),
        total_weight: 3992000,
        total_fee_sats: 18500000,
        monetary_weight: 1950000,
        layer2_weight: 380000,
        arbitrary_data_weight: 980000,
        consolidation_weight: 682000,
      });
    }

    this.regimes = [
      {
        regime_id: 'regime-current',
        network: 'bitcoin',
        start_height: 860380,
        regime_type: 'monetary_standard',
        median_feerate: 14.5,
        primary_demand_driver: 'Balanced monetary relay with baseline ordinals minting',
        detected_at: new Date().toISOString(),
      },
      {
        regime_id: 'regime-prev-1',
        network: 'bitcoin',
        start_height: 860200,
        end_height: 860379,
        regime_type: 'data_minting_spike',
        median_feerate: 42.0,
        primary_demand_driver: 'High-volume protocol minting wave',
        detected_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ];
  }

  public getOverview(): BlockspaceOverview {
    return {
      current_regime: this.regimes[0],
      median_feerate_24h: 14.5,
      taxonomy_classes: this.taxonomyClasses,
      composition_timeseries: this.timeseries,
      last_updated: new Date().toISOString(),
    };
  }

  public getTaxonomy(): BlockspaceSemanticClass[] {
    return this.taxonomyClasses;
  }

  public getComposition(limit = 24): BlockspaceCompositionPoint[] {
    return this.timeseries.slice(0, limit);
  }

  public getRegimes(): BlockspaceRegimeEvent[] {
    return this.regimes;
  }

  public getTxSemantics(txid: string): BlockspaceTxEvidence {
    return {
      txid,
      primary_class: 'Simple Monetary Payments',
      secondary_tags: ['SegWit v0', 'RBF Signaling', 'Single Change Output'],
      weight: 564,
      fee_sats: 1420,
      feerate_sats_vb: 10.1,
      evidence_summary: 'Standard 1-in-2-out transaction sending monetary balance with one change outpoint.',
    };
  }
}

export const blockspaceService = BlockspaceService.getInstance();
