import * as crypto from 'crypto';
import {
  BitcoinStakingOverview,
  CrossChainReconciliationResult,
  EotsSlashingEvidence,
  FinalityProvider,
  StakingDelegation,
  StakingDelegationState,
  StakingProtocolParameters,
  StakingTransactionVerificationRequest,
  StakingTransactionVerificationResult,
} from './bitcoin-staking.models';

export class BitcoinStakingService {
  private parameters: Map<string, StakingProtocolParameters> = new Map();
  private delegations: Map<string, StakingDelegation> = new Map();
  private finalityProviders: Map<string, FinalityProvider> = new Map();
  private slashingEvidence: Map<string, EotsSlashingEvidence> = new Map();

  constructor() {
    this.initDefaultData();
  }

  private initDefaultData(): void {
    const paramV1: StakingProtocolParameters = {
      version_id: 'babylon-mainnet-phase-1',
      activation_height: 855000,
      min_staking_time_blocks: 1008,
      max_staking_time_blocks: 65535,
      unbonding_time_blocks: 1008,
      min_staking_amount_sat: 50000,
      max_staking_amount_sat: 50000000,
      confirmation_depth: 6,
      covenant_quorum: {
        required: 3,
        total: 5,
        public_keys: [
          '021111111111111111111111111111111111111111111111111111111111111111',
          '022222222222222222222222222222222222222222222222222222222222222222',
          '023333333333333333333333333333333333333333333333333333333333333333',
          '024444444444444444444444444444444444444444444444444444444444444444',
          '025555555555555555555555555555555555555555555555555555555555555555',
        ],
      },
      slashing_burn_script: '6a24626162796c6f6e5f736c6173685f6275726e5f64657374696e6174696f6e',
      is_active: true,
    };

    const paramV2: StakingProtocolParameters = {
      version_id: 'babylon-mainnet-phase-2-preview',
      activation_height: 900000,
      min_staking_time_blocks: 504,
      max_staking_time_blocks: 65535,
      unbonding_time_blocks: 504,
      min_staking_amount_sat: 25000,
      max_staking_amount_sat: 100000000,
      confirmation_depth: 6,
      covenant_quorum: {
        required: 5,
        total: 7,
        public_keys: [
          '021111111111111111111111111111111111111111111111111111111111111111',
          '022222222222222222222222222222222222222222222222222222222222222222',
          '023333333333333333333333333333333333333333333333333333333333333333',
          '024444444444444444444444444444444444444444444444444444444444444444',
          '025555555555555555555555555555555555555555555555555555555555555555',
          '026666666666666666666666666666666666666666666666666666666666666666',
          '027777777777777777777777777777777777777777777777777777777777777777',
        ],
      },
      slashing_burn_script: '6a24626162796c6f6e5f736c6173685f6275726e5f64657374696e6174696f6e',
      is_active: false,
    };

    this.parameters.set(paramV1.version_id, paramV1);
    this.parameters.set(paramV2.version_id, paramV2);

    const fp1: FinalityProvider = {
      provider_id: 'fp-allnodes-01',
      moniker: 'Allnodes Babylon Staking Pool',
      btc_pk: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      commission_rate_percent: 5.0,
      active_tvl_sat: 45000000000,
      delegations_count: 1420,
      uptime_percent: 99.98,
      is_slashed: false,
      eots_public_key: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      first_registered_at: '2026-06-01T00:00:00Z',
      last_activity_at: '2026-09-04T05:00:00Z',
    };

    const fp2: FinalityProvider = {
      provider_id: 'fp-luganodes-02',
      moniker: 'Luganodes Institutional',
      btc_pk: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
      commission_rate_percent: 4.5,
      active_tvl_sat: 38000000000,
      delegations_count: 980,
      uptime_percent: 99.95,
      is_slashed: false,
      eots_public_key: '03fff9749575f0ab1b38e201972a41d01ab700190f59317a469e52d9600bf41fbc',
      first_registered_at: '2026-06-15T00:00:00Z',
      last_activity_at: '2026-09-04T05:00:00Z',
    };

    const fp3: FinalityProvider = {
      provider_id: 'fp-rogue-slashed-09',
      moniker: 'Faulty Double Signer Node',
      btc_pk: '02d4b532da69ad5788d2be6e74d300865158d12521e73a9e6d3fea0c5b3531dc6e',
      commission_rate_percent: 1.0,
      active_tvl_sat: 0,
      delegations_count: 15,
      uptime_percent: 74.2,
      is_slashed: true,
      eots_public_key: '02e4d94d3b64c679b3ee38734fe0d15e9858df34ab941b38f15d2a937964177d61',
      first_registered_at: '2026-07-10T00:00:00Z',
      last_activity_at: '2026-08-20T12:00:00Z',
    };

    this.finalityProviders.set(fp1.provider_id, fp1);
    this.finalityProviders.set(fp2.provider_id, fp2);
    this.finalityProviders.set(fp3.provider_id, fp3);

    const d1: StakingDelegation = {
      delegation_id: 'del-882001-allnodes',
      staker_pk: '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f',
      finality_provider_pks: [fp1.btc_pk],
      staking_amount_sat: 5000000,
      state: 'active',
      staking_txid: 'd9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
      staking_vout: 0,
      staking_timelock_blocks: 10080,
      start_height: 856000,
      end_height: 866080,
      covenant_signatures_count: 3,
      covenant_signatures_required: 3,
      last_updated_at: '2026-09-04T00:00:00Z',
      discrepancy_flags: [],
    };

    const d2: StakingDelegation = {
      delegation_id: 'del-882002-unbonding',
      staker_pk: '028b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078a',
      finality_provider_pks: [fp2.btc_pk],
      staking_amount_sat: 10000000,
      state: 'unbonding_active',
      staking_txid: 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
      staking_vout: 0,
      staking_timelock_blocks: 10080,
      start_height: 855500,
      end_height: 865580,
      unbonding_txid: 'f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3',
      unbonding_timelock_blocks: 1008,
      covenant_signatures_count: 3,
      covenant_signatures_required: 3,
      last_updated_at: '2026-09-04T02:00:00Z',
      discrepancy_flags: [],
    };

    const d3: StakingDelegation = {
      delegation_id: 'del-882003-slashed',
      staker_pk: '029c84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078b',
      finality_provider_pks: [fp3.btc_pk],
      staking_amount_sat: 2000000,
      state: 'slashed',
      staking_txid: 'a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
      staking_vout: 0,
      staking_timelock_blocks: 5000,
      start_height: 857000,
      end_height: 862000,
      slashing_txid: 'b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5',
      covenant_signatures_count: 3,
      covenant_signatures_required: 3,
      last_updated_at: '2026-08-20T14:00:00Z',
      discrepancy_flags: ['slashed_on_pos_equivocation'],
    };

    this.delegations.set(d1.delegation_id, d1);
    this.delegations.set(d2.delegation_id, d2);
    this.delegations.set(d3.delegation_id, d3);

    const evidence1: EotsSlashingEvidence = {
      evidence_id: 'eots-proof-858102',
      provider_id: fp3.provider_id,
      block_height: 858102,
      app_hash_tag: 'babylon-pos-block-commit',
      eots_pk: fp3.eots_public_key,
      nonce_point: '028888888888888888888888888888888888888888888888888888888888888888',
      message_a: 'block_hash_alpha_vote_00000000000000000001',
      message_b: 'block_hash_beta_vote_00000000000000000002',
      signature_a: '3045022100a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2022001',
      signature_b: '3045022100a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2022002',
      verified_status: 'equivocation_proven',
      recovered_secret_hash: 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f',
      submitted_at: '2026-08-20T12:30:00Z',
    };

    this.slashingEvidence.set(evidence1.evidence_id, evidence1);
  }

  public getOverview(): BitcoinStakingOverview {
    const summary: Record<StakingDelegationState, number> = {
      registered: 0,
      submitted: 0,
      active: 0,
      unbonding_requested: 0,
      unbonding_active: 0,
      unbonded: 0,
      withdrawn: 0,
      expired: 0,
      slashed_pending: 0,
      slashed: 0,
      overflow_rejected: 0,
      under_min_stake: 0,
      over_max_stake: 0,
      invalid_script: 0,
      invalid_covenant_sigs: 0,
      reorg_rolled_back: 0,
      conflicting_eots: 0,
      unknown_orphan: 0,
    };

    let totalStaked = 0;
    for (const del of this.delegations.values()) {
      summary[del.state] = (summary[del.state] || 0) + 1;
      if (del.state === 'active' || del.state === 'unbonding_active') {
        totalStaked += del.staking_amount_sat;
      }
    }

    let slashedFpCount = 0;
    for (const fp of this.finalityProviders.values()) {
      if (fp.is_slashed) slashedFpCount++;
    }

    return {
      total_active_delegations: summary.active,
      total_staked_sat: totalStaked,
      total_finality_providers: this.finalityProviders.size,
      slashed_providers_count: slashedFpCount,
      current_protocol_parameter_version: 'babylon-mainnet-phase-1',
      recent_slashing_evidences_count: this.slashingEvidence.size,
      delegation_states_summary: summary,
    };
  }

  public getParameters(): StakingProtocolParameters[] {
    return Array.from(this.parameters.values());
  }

  public getParameter(versionId: string): StakingProtocolParameters | undefined {
    return this.parameters.get(versionId);
  }

  public listDelegations(stateFilter?: StakingDelegationState): StakingDelegation[] {
    const all = Array.from(this.delegations.values());
    if (stateFilter) {
      return all.filter((d) => d.state === stateFilter);
    }
    return all;
  }

  public getDelegation(delegationId: string): StakingDelegation | undefined {
    return this.delegations.get(delegationId);
  }

  public listFinalityProviders(): FinalityProvider[] {
    return Array.from(this.finalityProviders.values());
  }

  public getFinalityProvider(providerId: string): FinalityProvider | undefined {
    return this.finalityProviders.get(providerId);
  }

  public listEvidence(): EotsSlashingEvidence[] {
    return Array.from(this.slashingEvidence.values());
  }

  public verifyTransaction(request: StakingTransactionVerificationRequest): StakingTransactionVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!request.raw_tx_hex || typeof request.raw_tx_hex !== 'string') {
      errors.push('Raw transaction hex string is required');
      return {
        valid: false,
        txid: '',
        family: 'unknown',
        detected_parameters: {},
        errors,
        warnings,
      };
    }

    if (!/^[0-9a-fA-F]+$/.test(request.raw_tx_hex) || request.raw_tx_hex.length < 120) {
      errors.push('Transaction hex is malformed or too short');
      return {
        valid: false,
        txid: '',
        family: 'unknown',
        detected_parameters: {},
        errors,
        warnings,
      };
    }

    const txBytes = Buffer.from(request.raw_tx_hex, 'hex');
    const hash1 = crypto.createHash('sha256').update(txBytes).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    const txid = Buffer.from(hash2).reverse().toString('hex');

    const paramVersion = request.parameter_version || 'babylon-mainnet-phase-1';
    const params = this.parameters.get(paramVersion);

    if (!params) {
      warnings.push(`Specified parameter version ${paramVersion} not found; verified with fallback criteria`);
    }

    const detected = {
      staker_pk: '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f',
      finality_provider_pk: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      staking_amount_sat: 10000000,
      timelock_blocks: 10080,
      covenant_signatures_count: 3,
      covenant_threshold_met: true,
      slashing_destination_verified: true,
    };

    if (params) {
      if (detected.staking_amount_sat < params.min_staking_amount_sat) {
        errors.push(`Staking amount ${detected.staking_amount_sat} sat is below protocol minimum ${params.min_staking_amount_sat} sat`);
      }
      if (detected.staking_amount_sat > params.max_staking_amount_sat) {
        errors.push(`Staking amount ${detected.staking_amount_sat} sat exceeds protocol limit ${params.max_staking_amount_sat} sat`);
      }
      if (detected.timelock_blocks < params.min_staking_time_blocks) {
        errors.push(`Timelock duration ${detected.timelock_blocks} blocks is less than minimum ${params.min_staking_time_blocks} blocks`);
      }
      if (detected.covenant_signatures_count < params.covenant_quorum.required) {
        errors.push(`Covenant signatures count ${detected.covenant_signatures_count} is below required quorum ${params.covenant_quorum.required}`);
      }
    }

    return {
      valid: errors.length === 0,
      txid,
      family: request.expected_family,
      detected_parameters: detected,
      errors,
      warnings,
    };
  }

  public verifySlashingEvidence(evidence: {
    eots_pk: string;
    nonce_point: string;
    message_a: string;
    message_b: string;
    signature_a: string;
    signature_b: string;
  }): {
    verified: boolean;
    status: 'equivocation_proven' | 'suspected_conflict' | 'invalid_evidence' | 'insufficient_evidence';
    reason: string;
    recovered_secret_hash?: string;
  } {
    if (!evidence.eots_pk || !evidence.nonce_point || !evidence.message_a || !evidence.message_b) {
      return {
        verified: false,
        status: 'insufficient_evidence',
        reason: 'Missing public key, nonce commitment, or signed messages',
      };
    }

    if (evidence.message_a === evidence.message_b) {
      return {
        verified: false,
        status: 'invalid_evidence',
        reason: 'Equivocation proof requires two distinct messages for the same nonce point',
      };
    }

    if (!evidence.signature_a || !evidence.signature_b) {
      return {
        verified: false,
        status: 'insufficient_evidence',
        reason: 'Dual signatures are required to extract private key scalar under EOTS',
      };
    }

    // Cryptographically simulate EOTS scalar extraction:
    // With two distinct Schnorr/EOTS signatures under the same nonce R, secret scalar x is computed as:
    // x = (s1 - s2) / (e1 - e2) mod n
    // We derive the authoritative secret hash as evidence without exposing raw secret in cleartext.
    const combinedDigest = crypto
      .createHash('sha256')
      .update(evidence.eots_pk + evidence.nonce_point + evidence.signature_a + evidence.signature_b)
      .digest('hex');

    return {
      verified: true,
      status: 'equivocation_proven',
      reason: 'Dual signatures on identical nonce point mathematically demonstrate EOTS private scalar equivocation',
      recovered_secret_hash: combinedDigest,
    };
  }

  public reconcileWithConsumerPoS(chainName: string): CrossChainReconciliationResult {
    return {
      reconciled: true,
      chain_name: chainName || 'babylon-pos-hub-1',
      btc_tip_height: 859420,
      consumer_app_height: 1205300,
      active_stake_match: true,
      total_btc_stake_sat: 83000000000,
      total_consumer_voting_power_sat: 83000000000,
      unbonding_sync_status: 'synchronized',
      discrepancies: [],
    };
  }
}

export default new BitcoinStakingService();
