import {
  SubmissionOverview,
  SubmissionCapabilities,
  SubmissionDiagnosisResult,
  PrivateBroadcastRecord,
  AcceleratorProvider,
  AcceleratorReceipt,
  TransactionOrderingEvidence,
} from './private-submission.models';

export class PrivateSubmissionService {
  private capabilities: SubmissionCapabilities = {
    public_p2p_enabled: true,
    privatebroadcast_tor_enabled: true,
    privatebroadcast_i2p_enabled: true,
    core_version: '31.0',
    tor_active: true,
    i2p_active: true,
    queue_limit: 100,
    current_queue_count: 3,
  };

  private acceleratorProviders: AcceleratorProvider[] = [
    {
      provider_id: 'mempool-acc-fast',
      identity_key: '0289be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81799',
      name: 'Mempool Accelerator Network',
      supported_networks: ['bitcoin'],
      submission_modes: ['configured_accelerator'],
      minimum_fee_sats: 5000,
      maximum_tx_vsize: 100000,
      payment_methods: ['lightning', 'onchain_btc'],
      partner_mining_claims: ['Foundry USA', 'MaraPool', 'SBI Crypto'],
      status_endpoint: 'https://mempool.space/api/v1/accelerator/health',
      health_status: 'online',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      provider_signature: '30440220...',
    },
    {
      provider_id: 'ocean-priority-lane',
      identity_key: '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      name: 'Ocean Priority Relay',
      supported_networks: ['bitcoin'],
      submission_modes: ['direct_miner_submission'],
      minimum_fee_sats: 2500,
      maximum_tx_vsize: 200000,
      payment_methods: ['lightning'],
      partner_mining_claims: ['Ocean Mining'],
      status_endpoint: 'https://ocean.xyz/api/v1/priority/health',
      health_status: 'online',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      provider_signature: '30450221...',
    },
  ];

  private privateBroadcasts: Map<string, PrivateBroadcastRecord> = new Map([
    [
      'tok-priv-887412-001',
      {
        submission_token: 'tok-priv-887412-001',
        txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        method: 'privatebroadcast_tor',
        network: 'bitcoin',
        queued_at_utc: '2026-09-04T17:40:00Z',
        status: 'queued',
        retry_count: 0,
        can_abort: true,
      },
    ],
  ]);

  private orderingEvidences: TransactionOrderingEvidence[] = [
    {
      txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      block_hash: '00000000000000000001f3e2b1a09876543210fedcba9876543210fedcba9876',
      block_height: 864210,
      block_position: 14,
      first_sensor_seen_utc: '2026-09-04T17:35:12Z',
      first_template_seen_utc: '2026-09-04T17:35:45Z',
      mined_timestamp_utc: '2026-09-04T17:42:00Z',
      evidence_state: 'publicly_observed_before_inclusion',
      fee_sats_vb: 24.5,
      package_feerate_sats_vb: 24.5,
      dependency_txids: [],
      is_ordering_sensitive: false,
      confidence_rating: 'high',
    },
    {
      txid: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb',
      block_hash: '00000000000000000001f3e2b1a09876543210fedcba9876543210fedcba9876',
      block_height: 864210,
      block_position: 1,
      mined_timestamp_utc: '2026-09-04T17:42:00Z',
      evidence_state: 'included_without_public_observation',
      fee_sats_vb: 8.2,
      package_feerate_sats_vb: 8.2,
      dependency_txids: [],
      is_ordering_sensitive: true,
      protocol_impact_description: 'Transaction included without prior public sensor relay. May indicate out-of-band submission or private miner direct inclusion.',
      confidence_rating: 'medium',
    },
  ];

  public getOverview(): SubmissionOverview {
    return {
      capabilities: this.capabilities,
      active_accelerator_providers: this.acceleratorProviders,
      recent_ordering_findings_count: this.orderingEvidences.filter((e) => e.is_ordering_sensitive).length,
      total_private_broadcasts_24h: 38,
      average_queue_duration_seconds: 4.2,
    };
  }

  public getCapabilities(): SubmissionCapabilities {
    return this.capabilities;
  }

  public diagnoseTransaction(rawTxOrTxid: string): SubmissionDiagnosisResult {
    const txid = rawTxOrTxid.length === 64 ? rawTxOrTxid : '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
    return {
      txid,
      vsize: 215,
      feerate_sats_vb: 14.5,
      is_mempool_present: false,
      is_policy_compliant: true,
      rbf_eligible: true,
      cpfp_eligible: true,
      has_conflicts: false,
      acceleration_recommended: false,
      privacy_advisory: 'Private broadcast via Tor protects client IP identity from public mempool pno-snoop observers.',
      available_methods: ['public_p2p', 'privatebroadcast_tor', 'privatebroadcast_i2p'],
    };
  }

  public submitPrivate(submission: { raw_tx: string; method: string }): PrivateBroadcastRecord {
    const token = `tok-priv-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const record: PrivateBroadcastRecord = {
      submission_token: token,
      txid: '778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566',
      method: (submission.method as any) || 'privatebroadcast_tor',
      network: 'bitcoin',
      queued_at_utc: new Date().toISOString(),
      status: 'queued',
      retry_count: 0,
      can_abort: true,
    };
    this.privateBroadcasts.set(token, record);
    return record;
  }

  public getPrivateSubmission(token: string): PrivateBroadcastRecord | undefined {
    return this.privateBroadcasts.get(token);
  }

  public abortPrivateSubmission(token: string): { success: boolean; status: string } {
    const record = this.privateBroadcasts.get(token);
    if (!record) {
      return { success: false, status: 'not_found' };
    }
    if (!record.can_abort || record.status === 'broadcast_completed') {
      return { success: false, status: 'cannot_abort' };
    }
    record.status = 'aborted';
    record.can_abort = false;
    return { success: true, status: 'aborted' };
  }

  public listAcceleratorProviders(): { providers: AcceleratorProvider[] } {
    return { providers: this.acceleratorProviders };
  }

  public getAcceleratorProvider(providerId: string): AcceleratorProvider | undefined {
    return this.acceleratorProviders.find((p) => p.provider_id === providerId);
  }

  public verifyAcceleratorReceipt(receipt: Partial<AcceleratorReceipt>): { verified: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!receipt.provider_id) errors.push('provider_id is required');
    if (!receipt.receipt_id) errors.push('receipt_id is required');
    if (!receipt.provider_signature) errors.push('provider_signature is required');
    if (!receipt.txid || receipt.txid.length !== 64) errors.push('Valid 32-byte txid is required');

    return {
      verified: errors.length === 0,
      errors,
    };
  }

  public getTransactionOrdering(txid: string): TransactionOrderingEvidence | undefined {
    return this.orderingEvidences.find((e) => e.txid === txid);
  }

  public getBlockOrdering(blockHash: string): { block_hash: string; transactions: TransactionOrderingEvidence[] } {
    const txs = this.orderingEvidences.filter((e) => e.block_hash === blockHash);
    return {
      block_hash: blockHash,
      transactions: txs,
    };
  }

  public listOrderingFindings(): { findings: TransactionOrderingEvidence[] } {
    return { findings: this.orderingEvidences.filter((e) => e.is_ordering_sensitive) };
  }
}

export default new PrivateSubmissionService();
