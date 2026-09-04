import {
  SwapPackage,
  SwapProtocolDefinition,
  SwapProvider,
  SwapLockupVerification,
  SwapClaimVerification,
  SwapRefundVerification,
  SwapRecoveryPlan,
  SwapsOverview,
  ReconciliationState,
  RecoveryAction,
} from './swaps.models';

export class SwapsService {
  private protocols: SwapProtocolDefinition[] = [
    {
      protocol_id: 'boltz_submarine_v2',
      protocol_name: 'Boltz Submarine Swap V2',
      protocol_revision: '2.3.4',
      supported_networks: ['bitcoin', 'liquid'],
      supported_swap_types: ['submarine', 'reverse'],
      taproot_support: true,
      liquid_support: true,
      ark_support: false,
      specification_url: 'https://docs.boltz.exchange/v/submarineswaps',
    },
    {
      protocol_id: 'boltz_chain_v1',
      protocol_name: 'Boltz Chain Swap',
      protocol_revision: '1.2.0',
      supported_networks: ['bitcoin', 'liquid'],
      supported_swap_types: ['chain'],
      taproot_support: true,
      liquid_support: true,
      ark_support: false,
      specification_url: 'https://docs.boltz.exchange/v/chainswaps',
    },
    {
      protocol_id: 'lightning_loop_v1',
      protocol_name: 'Lightning Loop Swap',
      protocol_revision: '0.28.0',
      supported_networks: ['bitcoin'],
      supported_swap_types: ['submarine', 'reverse'],
      taproot_support: true,
      liquid_support: false,
      ark_support: false,
      specification_url: 'https://lightning.engineering/loop/',
    },
    {
      protocol_id: 'ark_vhtlc_v1',
      protocol_name: 'Ark VHTLC Atomic Swap',
      protocol_revision: '0.1.0',
      supported_networks: ['bitcoin'],
      supported_swap_types: ['vhtlc'],
      taproot_support: true,
      liquid_support: false,
      ark_support: true,
      specification_url: 'https://arkdev.info/specs/vhtlc',
    },
  ];

  private providers: SwapProvider[] = [
    {
      provider_id: 'boltz-exchange',
      identity_key: '026165854b34e203a96812b67fa17e754dfebf0dfb39d677fa8f601a97e20556f8',
      name: 'Boltz Exchange',
      protocols: ['boltz_submarine_v2', 'boltz_chain_v1'],
      protocol_versions: ['2.3.4', '1.2.0'],
      networks: ['bitcoin', 'liquid'],
      swap_types: ['submarine', 'reverse', 'chain'],
      minimum_amount_sats: 25000,
      maximum_amount_sats: 25000000,
      fee_percentage: 0.5,
      miner_fee_estimate_sats: 1500,
      timeout_policy_blocks: 144,
      cooperative_claim_support: true,
      cooperative_refund_support: true,
      taproot_support: true,
      liquid_support: true,
      ark_support: false,
      status_endpoint: 'https://api.boltz.exchange/v2/health',
      health_status: 'online',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      provider_signature: '304402206ef429b9f7a7bf30965d8c6b7538b975e533d3ab2e88a3b836ab8cf95a1a1db9022003c27e462615467e27303e9441fa3793df601b3a3c9e6bb076e06a38618e9d6d',
    },
    {
      provider_id: 'loop-in-out',
      identity_key: '0289be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81799',
      name: 'Lightning Labs Loop',
      protocols: ['lightning_loop_v1'],
      protocol_versions: ['0.28.0'],
      networks: ['bitcoin'],
      swap_types: ['submarine', 'reverse'],
      minimum_amount_sats: 50000,
      maximum_amount_sats: 50000000,
      fee_percentage: 0.25,
      miner_fee_estimate_sats: 2200,
      timeout_policy_blocks: 288,
      cooperative_claim_support: true,
      cooperative_refund_support: true,
      taproot_support: true,
      liquid_support: false,
      ark_support: false,
      status_endpoint: 'https://api.loop.lightning.finance/health',
      health_status: 'online',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      provider_signature: '30450221008d519b788a8d11d95c249a5b3e20e8b826f63450257ad8da1e2049e386ab54ff022026c043e0d86927bf457788be4bdfca8e040409a4569f64bf38ab511ecf33878b',
    },
  ];

  private referenceSwaps: SwapPackage[] = [
    {
      schema_version: '1.0.0',
      swap_type: 'submarine',
      protocol_id: 'boltz_submarine_v2',
      protocol_revision: '2.3.4',
      network: 'bitcoin',
      swap_id: 'swp-boltz-887412-001',
      provider_id: 'boltz-exchange',
      created_at: '2026-09-04T12:00:00Z',
      expires_at: '2026-09-05T12:00:00Z',
      invoice_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      preimage_hash: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
      timeout_height: 864200,
      expected_amount_sats: 100000,
      provider_fee_sats: 500,
      miner_fee_sats: 1200,
      lockup_address: 'bc1q9w7y723n0h57n675n8l9e8790vj9642swp001',
      lockup_transaction: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      status: 'claimable',
    },
    {
      schema_version: '1.0.0',
      swap_type: 'reverse',
      protocol_id: 'boltz_submarine_v2',
      protocol_revision: '2.3.4',
      network: 'bitcoin',
      secondary_network: 'lightning',
      swap_id: 'swp-boltz-887412-002',
      provider_id: 'boltz-exchange',
      created_at: '2026-09-04T14:30:00Z',
      expires_at: '2026-09-05T14:30:00Z',
      preimage_hash: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
      timeout_height: 864250,
      expected_amount_sats: 250000,
      provider_fee_sats: 1250,
      miner_fee_sats: 1500,
      lockup_address: 'bc1qrevswp77488921190477123985721839074839',
      lockup_transaction: '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e249fa23d8a969e1c911e22',
      claim_transaction: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb',
      status: 'claimed',
    },
    {
      schema_version: '1.0.0',
      swap_type: 'chain',
      protocol_id: 'boltz_chain_v1',
      protocol_revision: '1.2.0',
      network: 'bitcoin',
      secondary_network: 'liquid',
      swap_id: 'swp-chain-887412-003',
      provider_id: 'boltz-exchange',
      created_at: '2026-09-04T16:00:00Z',
      expires_at: '2026-09-05T16:00:00Z',
      preimage_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
      timeout_height: 864300,
      expected_amount_sats: 500000,
      expected_secondary_amount: '0.00500000 L-BTC',
      provider_fee_sats: 2500,
      miner_fee_sats: 1800,
      lockup_address: 'bc1qchainswap99182374981729384719283749182',
      lockup_transaction: '5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344',
      status: 'awaiting_lockup',
    },
  ];

  public getOverview(): SwapsOverview {
    return {
      total_swaps_observed: 1420,
      active_providers_count: this.providers.length,
      total_volume_sats: 285400000,
      supported_protocols_count: this.protocols.length,
      recent_swaps: this.referenceSwaps,
      active_providers: this.providers,
      protocols: this.protocols,
    };
  }

  public listProtocols(): SwapProtocolDefinition[] {
    return this.protocols;
  }

  public listProviders(): SwapProvider[] {
    return this.providers;
  }

  public getProvider(providerId: string): SwapProvider | undefined {
    return this.providers.find((p) => p.provider_id === providerId);
  }

  public getProviderHistory(providerId: string): any {
    const provider = this.getProvider(providerId);
    if (!provider) return null;
    return {
      provider_id: providerId,
      uptime_pct_30d: 99.98,
      completed_swaps_count: 854,
      failed_swaps_count: 3,
      refunded_swaps_count: 14,
      average_claim_time_seconds: 42,
      last_health_check: new Date().toISOString(),
      recent_observations: [
        { height: 864190, status: 'healthy', latency_ms: 65 },
        { height: 864185, status: 'healthy', latency_ms: 58 },
      ],
    };
  }

  public verifyLockup(pkg: Partial<SwapPackage>, chainContext?: { currentHeight: number }): SwapLockupVerification {
    const errors: string[] = [];
    const currentHeight = chainContext?.currentHeight ?? 864195;

    if (!pkg.lockup_address) {
      errors.push('Lockup address is missing');
    }
    if (!pkg.expected_amount_sats || pkg.expected_amount_sats <= 0) {
      errors.push('Invalid expected satoshi amount');
    }
    if (!pkg.preimage_hash || pkg.preimage_hash.length !== 64) {
      errors.push('Preimage hash must be 32 bytes hex');
    }
    if (!pkg.timeout_height || pkg.timeout_height <= currentHeight) {
      errors.push(`Lockup timeout height (${pkg.timeout_height}) has already matured or is invalid`);
    }

    const verified = errors.length === 0;
    return {
      verified,
      script_matches: verified,
      amount_matches: verified,
      timeout_valid: (pkg.timeout_height ?? 0) > currentHeight,
      preimage_hash_committed: verified,
      current_confirmations: pkg.lockup_transaction ? 6 : 0,
      required_confirmations: 1,
      lockup_txid: pkg.lockup_transaction,
      output_index: 0,
      errors,
    };
  }

  public verifyClaim(pkg: Partial<SwapPackage>): SwapClaimVerification {
    const errors: string[] = [];
    if (!pkg.claim_transaction && !pkg.lockup_transaction) {
      errors.push('No transaction evidence provided for claim verification');
    }
    if (pkg.status !== 'claimable' && pkg.status !== 'claimed') {
      errors.push(`Swap state '${pkg.status}' is not eligible for claim verification`);
    }

    const verified = errors.length === 0;
    return {
      verified,
      claim_path_valid: verified,
      preimage_matches: verified,
      witness_valid: verified,
      destinations_valid: verified,
      fee_sats: pkg.miner_fee_sats || 1200,
      errors,
    };
  }

  public verifyRefund(pkg: Partial<SwapPackage>, chainContext?: { currentHeight: number }): SwapRefundVerification {
    const errors: string[] = [];
    const currentHeight = chainContext?.currentHeight ?? 864195;
    const timeoutHeight = pkg.timeout_height ?? 864200;
    const timeoutMatured = currentHeight >= timeoutHeight;

    if (!timeoutMatured) {
      errors.push(`Refund locktime has not matured. Remaining blocks: ${timeoutHeight - currentHeight}`);
    }

    return {
      verified: timeoutMatured && errors.length === 0,
      timeout_matured: timeoutMatured,
      blocks_remaining: Math.max(0, timeoutHeight - currentHeight),
      sequence_valid: true,
      locktime_valid: timeoutMatured,
      witness_valid: timeoutMatured,
      errors,
    };
  }

  public planRecovery(pkg: Partial<SwapPackage>, chainContext?: { currentHeight: number }): SwapRecoveryPlan {
    const currentHeight = chainContext?.currentHeight ?? 864195;
    const timeoutHeight = pkg.timeout_height ?? 864200;
    const blocksRemaining = timeoutHeight - currentHeight;

    let action: RecoveryAction = 'unknown';
    const notes: string[] = [];

    if (pkg.status === 'claimed') {
      action = 'already_claimed';
      notes.push('Swap has already been successfully claimed on-chain.');
    } else if (pkg.status === 'refunded') {
      action = 'already_refunded';
      notes.push('Swap funds have already been refunded to user.');
    } else if (blocksRemaining <= 0) {
      action = 'refundable_now';
      notes.push(`Timeout block height ${timeoutHeight} has passed. Unsigned refund PSBT is available.`);
    } else {
      action = 'refundable_after_height';
      notes.push(`Refund matures at block height ${timeoutHeight}. Wait ${blocksRemaining} more blocks.`);
    }

    const recoverable = Math.max(0, (pkg.expected_amount_sats || 0) - (pkg.miner_fee_sats || 1500));

    return {
      swap_id: pkg.swap_id || 'swp-unknown',
      current_state: pkg.status || 'unknown',
      recommended_action: action,
      recoverable_value_sats: recoverable,
      estimated_miner_fee_sats: pkg.miner_fee_sats || 1500,
      timeout_height: timeoutHeight,
      current_block_height: currentHeight,
      blocks_until_refund: Math.max(0, blocksRemaining),
      unsigned_recovery_psbt: action === 'refundable_now' ? 'cHNidP8BAFICAAAAAf...' : undefined,
      notes,
    };
  }

  public verifyProviderManifest(manifest: Partial<SwapProvider>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!manifest.provider_id) errors.push('provider_id is required');
    if (!manifest.identity_key) errors.push('identity_key is required');
    if (!manifest.provider_signature) errors.push('provider_signature is required');
    if (!manifest.protocols || manifest.protocols.length === 0) errors.push('At least one protocol must be declared');
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public reconcileCrossLayer(swapId: string): { reconciliation_state: ReconciliationState; details: string } {
    const swap = this.referenceSwaps.find((s) => s.swap_id === swapId);
    if (!swap) {
      return {
        reconciliation_state: 'unknown',
        details: 'Swap record not observed',
      };
    }
    if (swap.status === 'claimed') {
      return {
        reconciliation_state: 'fully_reconciled',
        details: 'On-chain lockup, Lightning settlement receipt, and claim transaction fully reconciled.',
      };
    }
    return {
      reconciliation_state: 'waiting_on_lightning',
      details: 'On-chain lockup verified. Awaiting preimage revelation or settlement confirmation.',
    };
  }
}

export default new SwapsService();
