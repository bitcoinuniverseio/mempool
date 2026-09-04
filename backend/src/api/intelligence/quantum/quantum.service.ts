import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  QuantumPubkeyExposure,
  QuantumCohortBreakdown,
  QuantumRevealEvent,
  QuantumMigrationPlanRequest,
  QuantumMigrationPlanResult,
  QuantumOverview,
} from './quantum.models';

export class QuantumService {
  private static instance: QuantumService;
  private eventBus = IntelligenceEventBus.getInstance();

  private cohorts: QuantumCohortBreakdown[] = [];
  private recentReveals: QuantumRevealEvent[] = [];
  private sampleExposures: Map<string, QuantumPubkeyExposure> = new Map();

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): QuantumService {
    if (!QuantumService.instance) {
      QuantumService.instance = new QuantumService();
    }
    return QuantumService.instance;
  }

  private seedInitialData(): void {
    this.cohorts = [
      {
        script_type: 'P2PK (Pay-to-Public-Key)',
        total_utxos: 185000,
        total_sats: 175000000000000, // ~1.75M BTC (early coinbase)
        exposed_utxos: 185000,
        exposed_sats: 175000000000000,
        exposed_percentage: 100.0,
      },
      {
        script_type: 'P2PKH (Address Reuse / Spent)',
        total_utxos: 48000000,
        total_sats: 450000000000000,
        exposed_utxos: 6200000,
        exposed_sats: 65000000000000,
        exposed_percentage: 14.4,
      },
      {
        script_type: 'P2WPKH (Address Reuse / Spent)',
        total_utxos: 82000000,
        total_sats: 780000000000000,
        exposed_utxos: 4100000,
        exposed_sats: 42000000000000,
        exposed_percentage: 5.38,
      },
      {
        script_type: 'P2TR (Key-Path Spendable)',
        total_utxos: 16000000,
        total_sats: 190000000000000,
        exposed_utxos: 16000000,
        exposed_sats: 190000000000000,
        exposed_percentage: 100.0, // Q-exposed internal key
      },
      {
        script_type: 'Hash-Protected (Unspent P2WPKH/P2SH/P2WSH)',
        total_utxos: 120000000,
        total_sats: 385000000000000,
        exposed_utxos: 0,
        exposed_sats: 0,
        exposed_percentage: 0.0,
      },
    ];

    this.recentReveals = [
      {
        event_id: 'rev-860395-1',
        pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        block_height: 860395,
        timestamp_utc: new Date().toISOString(),
        affected_outpoints_count: 3,
        revealed_sats: 14500000,
      },
      {
        event_id: 'rev-860388-2',
        pubkey: '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
        txid: '2b4c1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda11a',
        block_height: 860388,
        timestamp_utc: new Date(Date.now() - 3600000).toISOString(),
        affected_outpoints_count: 1,
        revealed_sats: 5000000,
      },
    ];

    const exp1: QuantumPubkeyExposure = {
      outpoint: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0',
      txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      vout: 0,
      amount_sats: 5000000000, // 50 BTC
      script_type: 'p2pk',
      is_exposed: true,
      exposure_reason: 'direct_pubkey_script',
      first_exposed_height: 0,
    };
    this.sampleExposures.set(exp1.outpoint, exp1);
  }

  public getOverview(): QuantumOverview {
    const totalUtxos = this.cohorts.reduce((sum, c) => sum + c.total_utxos, 0);
    const totalSats = this.cohorts.reduce((sum, c) => sum + c.total_sats, 0);
    const exposedUtxos = this.cohorts.reduce((sum, c) => sum + c.exposed_utxos, 0);
    const exposedSats = this.cohorts.reduce((sum, c) => sum + c.exposed_sats, 0);

    return {
      total_utxo_count: totalUtxos,
      total_supply_sats: totalSats,
      exposed_utxo_count: exposedUtxos,
      exposed_sats: exposedSats,
      exposed_supply_percentage: Number(((exposedSats / totalSats) * 100).toFixed(2)),
      cohorts: this.cohorts,
      recent_reveals: this.recentReveals,
      last_updated: new Date().toISOString(),
    };
  }

  public getCohorts(): QuantumCohortBreakdown[] {
    return this.cohorts;
  }

  public getRecentReveals(): QuantumRevealEvent[] {
    return this.recentReveals;
  }

  public auditAddressOrOutpoint(identifier: string): QuantumPubkeyExposure {
    if (!identifier || typeof identifier !== 'string') {
      throw new Error('Identifier is required for quantum audit.');
    }

    const trimmed = identifier.trim();
    const existing = this.sampleExposures.get(trimmed);
    if (existing) {
      return existing;
    }

    const isDirectPubkey = trimmed.startsWith('02') || trimmed.startsWith('03') || trimmed.startsWith('04');
    const isP2TR = trimmed.startsWith('bc1p');

    return {
      outpoint: trimmed.includes(':') ? trimmed : `${crypto.randomBytes(32).toString('hex')}:0`,
      txid: trimmed.includes(':') ? trimmed.split(':')[0] : crypto.randomBytes(32).toString('hex'),
      vout: 0,
      amount_sats: 100000,
      script_type: isP2TR ? 'p2tr' : isDirectPubkey ? 'p2pk' : 'p2wpkh',
      is_exposed: isDirectPubkey || isP2TR,
      exposure_reason: isDirectPubkey ? 'direct_pubkey_script' : isP2TR ? 'keypath_taproot' : 'hash_protected',
      first_exposed_height: isDirectPubkey ? 800000 : undefined,
    };
  }

  public generateMigrationPlan(req: QuantumMigrationPlanRequest): QuantumMigrationPlanResult {
    const totalOutpoints = req.exposed_outpoints?.length || 1;
    const estSats = totalOutpoints * 500000;

    return {
      plan_id: 'qmp-' + crypto.randomBytes(4).toString('hex'),
      total_exposed_sats: estSats,
      recommended_transactions_count: Math.ceil(totalOutpoints / 5),
      estimated_migration_fee_sats: totalOutpoints * 1200,
      post_migration_exposure_percentage: 0.0,
      steps: [
        {
          step_number: 1,
          action: 'Generate Fresh Unused Receiving Addresses',
          description: 'Construct native SegWit (P2WPKH) or script-path restricted Taproot addresses with no prior on-chain spend history.',
        },
        {
          step_number: 2,
          action: 'Batch Consolidation with Decoupled Change',
          description: 'Sweep exposed outpoints in batched transactions to minimize fee overhead while keeping change separate.',
        },
        {
          step_number: 3,
          action: 'Enforce Single-Use Key Policy',
          description: 'Retire all previously spent public keys to prevent subsequent reveal vulnerabilities.',
        },
      ],
    };
  }
}

export const quantumService = QuantumService.getInstance();
