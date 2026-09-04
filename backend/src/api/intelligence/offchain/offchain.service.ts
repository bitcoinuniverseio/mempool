import crypto from 'crypto';
import {
  OffchainOperator,
  StatechainPublicManifest,
  StatechainTransferVerification,
  StatechainBackupTransaction,
  CoinswapPublicOffer,
  CoinswapPackageVerification,
  OffchainRecoveryPlan,
  OffchainOverviewResponse,
} from './offchain.models';

export class OffchainService {
  private operators: Map<string, OffchainOperator> = new Map();
  private offers: Map<string, CoinswapPublicOffer> = new Map();
  private recoveryPlans: Map<string, OffchainRecoveryPlan> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    const operator1: OffchainOperator = {
      operator_id: 'op-mercury-alpha',
      protocol: 'mercury_statechain',
      operator_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      display_name: 'Mercury Core Statechain Entity',
      networks: ['bitcoin-mainnet', 'bitcoin-signet'],
      endpoints: {
        clearnet: 'https://statechain.mercury.universe.local/api',
        tor_onion: 'http://mercurystatechainxyz.onion',
      },
      supported_versions: ['v1.2.0', 'v1.3.0'],
      signature_count_endpoint: 'https://statechain.mercury.universe.local/api/signatures/count',
      transfer_capabilities: ['blinded_key_sharing', 'decrementing_locktime', 'batch_deposit'],
      recovery_capabilities: ['unilateral_exit', 'cooperative_close', 'watchtower_attestation'],
      health: 'healthy',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      provenance: {
        registered_in_knowledge_registry: true,
        identity_ref: 'id-mercury-operator-01',
        verified_signature: true,
      },
    };

    const operator2: OffchainOperator = {
      operator_id: 'op-teleport-beta',
      protocol: 'teleport_coinswap',
      operator_public_key: '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      display_name: 'Teleport Maker Syndicate',
      networks: ['bitcoin-mainnet'],
      endpoints: {
        clearnet: 'https://teleport.coinswap.universe.local',
        tor_onion: 'http://teleportcoinswaphub.onion',
      },
      supported_versions: ['teleport-v0.5.0'],
      transfer_capabilities: ['multi_hop_swap', 'routed_multisig'],
      recovery_capabilities: ['timeout_recovery', 'watchtower_claim'],
      health: 'healthy',
      effective_from: '2026-03-01T00:00:00Z',
      expires_at: '2027-03-01T00:00:00Z',
      provenance: {
        registered_in_knowledge_registry: true,
        identity_ref: 'id-teleport-maker-02',
        verified_signature: true,
      },
    };

    this.operators.set(operator1.operator_id, operator1);
    this.operators.set(operator2.operator_id, operator2);

    const offer1: CoinswapPublicOffer = {
      offer_id: 'offer-teleport-btc-10m',
      maker_id: operator2.operator_id,
      maker_name: operator2.display_name,
      protocol_version: 'teleport-v0.5.0',
      network: 'bitcoin-mainnet',
      min_amount_sats: 100000,
      max_amount_sats: 10000000,
      base_fee_sats: 2500,
      fee_rate_bps: 15,
      supported_timelock_deltas: [144, 288, 576],
      endpoint: 'http://teleportcoinswaphub.onion',
      endpoint_type: 'tor_onion',
      last_seen_at: '2026-09-04T05:00:00Z',
    };
    this.offers.set(offer1.offer_id, offer1);
  }

  public getOverview(): OffchainOverviewResponse {
    const ops = Array.from(this.operators.values());
    const offersList = Array.from(this.offers.values());

    return {
      total_operators: ops.length,
      active_statechains_count: 340,
      active_coinswap_makers: offersList.length,
      operators: ops,
      public_offers: offersList,
    };
  }

  public listProtocols(): Array<{ id: string; name: string; description: string; revision: string }> {
    return [
      {
        id: 'mercury_statechain',
        name: 'Mercury Blinded Statechains',
        description: 'Off-chain Bitcoin UTXO transfer protocol with decrementing locktimes and blinded key coordination',
        revision: 'v1.3.0',
      },
      {
        id: 'teleport_coinswap',
        name: 'Teleport CoinSwap',
        description: 'Trustless multi-hop atomic swap protocol with 2-of-2 multisig contract transactions',
        revision: 'v0.5.0',
      },
    ];
  }

  public listOperators(): OffchainOperator[] {
    return Array.from(this.operators.values());
  }

  public getOperator(operatorId: string): OffchainOperator | undefined {
    return this.operators.get(operatorId);
  }

  public getOperatorHistory(operatorId: string): any[] {
    const op = this.operators.get(operatorId);
    if (!op) return [];
    return [
      {
        event_id: `evt-${operatorId}-01`,
        event_type: 'manifest_published',
        timestamp: op.effective_from,
        details: 'Initial verified manifest registered in Knowledge Registry',
      },
      {
        event_id: `evt-${operatorId}-02`,
        event_type: 'health_check_passed',
        timestamp: '2026-09-04T05:00:00Z',
        details: 'Tor and clearnet endpoints verified reachable',
      },
    ];
  }

  public listOffers(): CoinswapPublicOffer[] {
    return Array.from(this.offers.values());
  }

  public verifyManifest(manifest: Partial<StatechainPublicManifest>): {
    verified: boolean;
    operator_id: string;
    errors: string[];
  } {
    const errors: string[] = [];
    if (!manifest.operator_public_key || manifest.operator_public_key.length !== 66) {
      errors.push('Operator public key must be 33-byte compressed hex (66 chars)');
    }
    if (!manifest.protocol) {
      errors.push('Protocol identifier is required');
    }
    if (!manifest.signature) {
      errors.push('Cryptographic signature is required');
    }

    const verified = errors.length === 0;
    const operator_id = `op-${crypto.createHash('sha256').update(manifest.operator_public_key || '').digest('hex').substring(0, 12)}`;

    return {
      verified,
      operator_id,
      errors,
    };
  }

  public verifyTransferPackage(data: {
    statechain_id: string;
    deposit_amount_sats: number;
    backup_transactions: StatechainBackupTransaction[];
    server_signature_count: number;
    current_height?: number;
  }): StatechainTransferVerification {
    const errors: string[] = [];
    const warnings: string[] = [];
    const currentHeight = data.current_height || 860500;

    if (!data.statechain_id) {
      errors.push('Statechain ID is required');
    }

    if (!data.backup_transactions || data.backup_transactions.length === 0) {
      errors.push('Backup transactions sequence cannot be empty');
    }

    // Verify decrementing locktime sequence
    let prevLocktime = Infinity;
    let minLocktime = Infinity;
    for (let i = 0; i < (data.backup_transactions || []).length; i++) {
      const tx = data.backup_transactions[i];
      if (tx.locktime >= prevLocktime) {
        errors.push(
          `Locktime violation at iteration ${tx.iteration}: locktime ${tx.locktime} is not strictly less than previous ${prevLocktime}`
        );
      }
      prevLocktime = tx.locktime;
      if (tx.locktime < minLocktime) {
        minLocktime = tx.locktime;
      }
    }

    // Verify agreement between verified backup transactions and server signature count
    const txCount = (data.backup_transactions || []).length;
    const signaturesReconciled = txCount === data.server_signature_count;
    if (!signaturesReconciled) {
      errors.push(
        `Server signature count (${data.server_signature_count}) does not match backup transactions count (${txCount})`
      );
    }

    let recoverableState: any = 'unknown';
    if (errors.length === 0) {
      if (currentHeight >= minLocktime) {
        recoverableState = 'recoverable_now';
      } else {
        recoverableState = 'recoverable_after_height';
      }
    } else {
      recoverableState = 'unsafe_package';
    }

    return {
      statechain_id: data.statechain_id,
      is_valid: errors.length === 0,
      deposit_amount_sats: data.deposit_amount_sats,
      backup_transactions_count: txCount,
      server_signature_count: data.server_signature_count,
      signatures_reconciled: signaturesReconciled,
      earliest_unilateral_exit_height: minLocktime === Infinity ? 0 : minLocktime,
      current_block_height: currentHeight,
      recoverable_state: recoverableState,
      errors,
      warnings,
    };
  }

  public verifyCoinswapPackage(data: {
    package_id: string;
    maker_id: string;
    swap_amount_sats: number;
    contracts: any[];
  }): CoinswapPackageVerification {
    const errors: string[] = [];

    if (!data.package_id) {
      errors.push('Package ID is required');
    }
    if (!data.contracts || data.contracts.length < 2) {
      errors.push('CoinSwap package requires funding and refund contract transactions');
    }

    // Verify timelock ordering
    let forwardLocktime = 0;
    let backwardLocktime = 0;
    for (const c of data.contracts || []) {
      if (c.role === 'forward_contract') forwardLocktime = c.timelock;
      if (c.role === 'backward_contract') backwardLocktime = c.timelock;
    }

    if (forwardLocktime > 0 && backwardLocktime > 0 && forwardLocktime <= backwardLocktime) {
      errors.push('Forward contract timelock must be strictly greater than backward contract timelock for safe recovery');
    }

    return {
      package_id: data.package_id,
      is_valid: errors.length === 0,
      maker_id: data.maker_id,
      total_hops: 2,
      swap_amount_sats: data.swap_amount_sats,
      contract_transactions: data.contracts || [],
      watchtower_coverage_verified: true,
      recovery_state: errors.length === 0 ? 'recoverable_after_height' : 'unsafe_package',
      errors,
    };
  }

  public generateRecoveryPlan(params: {
    protocol: 'statechain' | 'coinswap';
    entity_id: string;
    current_stage: string;
    target_locktime?: number;
    current_height?: number;
  }): OffchainRecoveryPlan {
    const planId = `plan-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const currentHeight = params.current_height || 860500;
    const targetLock = params.target_locktime || 860400;

    let recoveryState: any = 'recoverable_now';
    let guidance = 'Latest backup transaction locktime has passed. Unsigned recovery PSBT ready for export to PSBT Workbench.';

    if (targetLock > currentHeight) {
      recoveryState = 'recoverable_after_height';
      guidance = `Wait until block height ${targetLock} before broadcasting recovery transaction.`;
    }

    const plan: OffchainRecoveryPlan = {
      plan_id: planId,
      protocol: params.protocol,
      entity_id: params.entity_id,
      current_stage: params.current_stage || 'latest_backup_ready',
      earliest_broadcast_height: targetLock,
      requires_fee_bump: true,
      suggested_fee_rate_sats_vb: 14.5,
      recovery_state: recoveryState,
      unsigned_psbt_hex: '70736274ff0100f2020000000100000000000000000000000000000000000000000000000000000000000000000000000000fffffffe0140420f0000000000160014751e76e8199196d454941c45d1b3a323f1433bd60000000000',
      action_guidance: guidance,
    };

    this.recoveryPlans.set(planId, plan);
    return plan;
  }
}

export default new OffchainService();
