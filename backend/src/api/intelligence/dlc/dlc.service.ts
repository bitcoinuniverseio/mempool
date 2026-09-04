import crypto from 'crypto';
import {
  DlcOracle,
  DlcOracleAnnouncement,
  DlcOracleAttestation,
  DlcOracleConflictEvidence,
  DlcContractPackage,
  DlcSimulationResult,
  DlcOverviewResponse,
} from './dlc.models';

export class DlcService {
  private oracles: Map<string, DlcOracle> = new Map();
  private announcements: Map<string, DlcOracleAnnouncement> = new Map();
  private attestations: Map<string, DlcOracleAttestation> = new Map();
  private conflicts: Map<string, DlcOracleConflictEvidence> = new Map();
  private simulations: Map<string, DlcSimulationResult> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    const oracleA: DlcOracle = {
      oracle_id: 'oracle-kormir-alpha',
      oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      display_name: 'Kormir Primary Oracle',
      endpoint: 'https://kormir.universe.local/api/v1',
      endpoint_type: 'rest',
      protocol_revision: 'dlc-tlv-v1.1',
      registration_source: 'universe-signed-registry',
      registration_signature: '3044022068a12781b0a8806292b0c1692df82e66a3458c0c9b0e271ecba32fbe1f6004b502203d7c57eb41961e6191fdf1a31d99fb3bdfadfcbebbca529d27521e25e98f0ea4',
      first_observed_at: '2026-01-15T00:00:00.000Z',
      last_observed_at: '2026-09-04T05:00:00.000Z',
      last_success_at: '2026-09-04T05:00:00.000Z',
      health: 'healthy',
      coverage: {
        total_events: 1420,
        total_attestations: 1395,
        announced_events: 25,
        active_conflicts: 0,
        last_block_height: 860500,
      },
      provenance: {
        registered_in_knowledge_registry: true,
        identity_ref: 'identity-kormir-ops',
        verified_by_universe: true,
      },
    };

    const oracleB: DlcOracle = {
      oracle_id: 'oracle-crypto-data-feed',
      oracle_public_key: '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      display_name: 'Sovereign Numeric Attestor',
      endpoint: 'https://attest.sovereign.local/v1',
      endpoint_type: 'direct_rpc',
      protocol_revision: 'dlc-tlv-v1.1',
      registration_source: 'universe-signed-registry',
      registration_signature: '30450221008d6d67b2d56a0cb3998b67272828b84931a7c36e4f3a743b174780614cf12c5b02202bc923a78921867cb66cbb457e5040f907662c5ebc3b174d32a93fb548c734e5',
      first_observed_at: '2026-02-01T00:00:00.000Z',
      last_observed_at: '2026-09-04T05:15:00.000Z',
      last_success_at: '2026-09-04T05:15:00.000Z',
      health: 'healthy',
      coverage: {
        total_events: 890,
        total_attestations: 875,
        announced_events: 15,
        active_conflicts: 1,
        last_block_height: 860500,
      },
      provenance: {
        registered_in_knowledge_registry: true,
        identity_ref: 'identity-sovereign-attest',
        verified_by_universe: true,
      },
    };

    this.oracles.set(oracleA.oracle_id, oracleA);
    this.oracles.set(oracleB.oracle_id, oracleB);

    const announcement1: DlcOracleAnnouncement = {
      announcement_id: 'ann-enum-hashrate-860500',
      oracle_id: oracleA.oracle_id,
      oracle_public_key: oracleA.oracle_public_key,
      event_id: 'bitcoin-difficulty-period-42',
      event_descriptor: {
        type: 'enumerated',
        outcomes: ['increase_gt_5pct', 'steady_within_5pct', 'decrease_gt_5pct'],
      },
      event_maturity_epoch: 1788500000,
      maturity_formatted: '2026-09-05T12:00:00Z',
      nonce_count: 1,
      nonces: ['02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235'],
      announcement_signature: '72a6b22b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885dfb2e59fa257f8cf28e5784931a7c36e4f3a743b174780614cf12c5',
      original_bytes_hex: 'fd021000010279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      payload_hash: '14f3b610c5980a379e4f0c72da491df2803b9b47e584a0d92e59cf719a4e69b0',
      verified: true,
      observed_at: '2026-09-01T08:00:00.000Z',
    };

    const announcement2: DlcOracleAnnouncement = {
      announcement_id: 'ann-num-height-861000',
      oracle_id: oracleB.oracle_id,
      oracle_public_key: oracleB.oracle_public_key,
      event_id: 'block-fee-median-861000',
      event_descriptor: {
        type: 'numeric',
        base: 2,
        num_digits: 16,
        unit: 'sats_per_vbyte',
        min_value: 1,
        max_value: 65535,
      },
      event_maturity_epoch: 1788580000,
      maturity_formatted: '2026-09-06T10:00:00Z',
      nonce_count: 16,
      nonces: Array.from({ length: 16 }, (_, i) => `02${(i + 10).toString(16).padStart(2, '0')}7174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235`),
      announcement_signature: '88a6b22b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885dfb2e59fa257f8cf28e5784931a7c36e4f3a743b174780614cf12c6',
      original_bytes_hex: 'fd0210000203c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      payload_hash: '22e3b610c5980a379e4f0c72da491df2803b9b47e584a0d92e59cf719a4e69b2',
      verified: true,
      observed_at: '2026-09-02T10:00:00.000Z',
    };

    this.announcements.set(announcement1.announcement_id, announcement1);
    this.announcements.set(announcement2.announcement_id, announcement2);

    const attestation1: DlcOracleAttestation = {
      attestation_id: 'att-hashrate-860500-final',
      announcement_id: announcement1.announcement_id,
      oracle_id: oracleA.oracle_id,
      oracle_public_key: oracleA.oracle_public_key,
      event_id: announcement1.event_id,
      outcomes: ['increase_gt_5pct'],
      signatures: ['d45f3c1b8293e6205847fa2c039d94942e61a494cb30e527a909675231c5fb437293a5e82b3a1a9e3d5483296152a4e21a48c9038202519cf2e4d0b16892e620'],
      attested_at: '2026-09-04T04:30:00.000Z',
      delay_seconds: 420,
      verified: true,
      has_conflict: false,
    };
    this.attestations.set(attestation1.attestation_id, attestation1);

    const conflict1: DlcOracleConflictEvidence = {
      evidence_id: 'ev-conflict-sovereign-01',
      oracle_id: oracleB.oracle_id,
      oracle_public_key: oracleB.oracle_public_key,
      conflict_type: 'equivocation',
      state: 'cryptographically_verified_conflict',
      announcement_id_a: announcement2.announcement_id,
      event_id_a: announcement2.event_id,
      reused_nonce: announcement2.nonces[0],
      attested_outcome_a: '0000000000101000',
      attested_outcome_b: '0000000000010100',
      signature_a: '5f928e45b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885dfb2e59fa257f8cf28e5784931a7c36e4f3a743b174780614cf12c7',
      signature_b: '9a318e45b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885dfb2e59fa257f8cf28e5784931a7c36e4f3a743b174780614cf12c8',
      proof_package_hash: '90a41bc38902ffaa7893261a8b38df49204bca992e5912958309192410a5eb33',
      discovered_at: '2026-09-03T18:40:00.000Z',
      resolution_status: 'confirmed',
    };
    this.conflicts.set(conflict1.evidence_id, conflict1);
  }

  public getOverview(): DlcOverviewResponse {
    const oraclesList = Array.from(this.oracles.values());
    const healthyCount = oraclesList.filter((o) => o.health === 'healthy').length;
    const verifiedConflicts = Array.from(this.conflicts.values()).filter(
      (c) => c.state === 'cryptographically_verified_conflict'
    ).length;

    return {
      total_oracles: oraclesList.length,
      healthy_oracles: healthyCount,
      active_events: this.announcements.size,
      total_attestations: this.attestations.size,
      verified_conflicts: verifiedConflicts,
      recent_events: Array.from(this.announcements.values()),
      recent_attestations: Array.from(this.attestations.values()),
      active_conflicts: Array.from(this.conflicts.values()),
    };
  }

  public listOracles(): DlcOracle[] {
    return Array.from(this.oracles.values());
  }

  public getOracle(oracleId: string): DlcOracle | undefined {
    return this.oracles.get(oracleId);
  }

  public getOracleHistory(oracleId: string): DlcOracleAnnouncement[] {
    return Array.from(this.announcements.values()).filter((a) => a.oracle_id === oracleId);
  }

  public listEvents(): DlcOracleAnnouncement[] {
    return Array.from(this.announcements.values());
  }

  public getEvent(eventId: string): DlcOracleAnnouncement | undefined {
    return (
      this.announcements.get(eventId) ||
      Array.from(this.announcements.values()).find((a) => a.event_id === eventId)
    );
  }

  public getEventAttestations(eventId: string): DlcOracleAttestation[] {
    return Array.from(this.attestations.values()).filter(
      (att) => att.event_id === eventId || att.announcement_id === eventId
    );
  }

  public listConflicts(): DlcOracleConflictEvidence[] {
    return Array.from(this.conflicts.values());
  }

  public verifyAnnouncement(data: {
    oracle_public_key: string;
    event_id: string;
    event_descriptor: any;
    event_maturity_epoch: number;
    nonces: string[];
    announcement_signature: string;
  }): {
    verified: boolean;
    announcement_id: string;
    payload_hash: string;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data.oracle_public_key || data.oracle_public_key.length < 64) {
      errors.push('Invalid oracle public key length');
    }
    if (!data.event_id || data.event_id.trim().length === 0) {
      errors.push('Event ID is required');
    }
    if (!data.nonces || data.nonces.length === 0) {
      errors.push('At least one nonce point is required');
    }

    // Check for duplicate nonces
    const nonceSet = new Set(data.nonces);
    if (nonceSet.size !== (data.nonces ? data.nonces.length : 0)) {
      errors.push('Duplicate nonce points detected in announcement');
    }

    const payloadString = `${data.oracle_public_key}:${data.event_id}:${data.event_maturity_epoch}:${(data.nonces || []).join(',')}`;
    const payload_hash = crypto.createHash('sha256').update(payloadString).digest('hex');
    const announcement_id = `ann-${payload_hash.substring(0, 16)}`;

    const verified = errors.length === 0 && Boolean(data.announcement_signature);

    return {
      verified,
      announcement_id,
      payload_hash,
      errors,
    };
  }

  public verifyAttestation(data: {
    announcement_id: string;
    oracle_public_key: string;
    event_id: string;
    outcomes: string[];
    signatures: string[];
  }): {
    verified: boolean;
    attestation_id: string;
    has_conflict: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const announcement = this.announcements.get(data.announcement_id);

    if (announcement) {
      if (announcement.oracle_public_key !== data.oracle_public_key) {
        errors.push('Attestation public key does not match announcement commitment');
      }
      if (data.outcomes.length !== data.signatures.length) {
        errors.push('Outcome count must match signature count exactly');
      }
      if (announcement.event_descriptor.type === 'enumerated') {
        const allowed = announcement.event_descriptor.outcomes || [];
        for (const out of data.outcomes) {
          if (!allowed.includes(out)) {
            errors.push(`Attested outcome '${out}' is outside announced domain`);
          }
        }
      }
    }

    const attestation_id = `att-${crypto.randomBytes(8).toString('hex')}`;
    const verified = errors.length === 0 && (data.signatures || []).length > 0;

    return {
      verified,
      attestation_id,
      has_conflict: false,
      errors,
    };
  }

  public verifyContractPackage(pkg: Partial<DlcContractPackage>): {
    valid: boolean;
    total_collateral_sats: number;
    cet_count: number;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!pkg.parties || pkg.parties.length !== 2) {
      errors.push('DLC contract package requires exactly two parties');
    }

    let totalCollateral = 0;
    for (const p of pkg.parties || []) {
      if (p.collateral_sats <= 0) {
        errors.push(`Party ${p.role} collateral must be positive`);
      }
      totalCollateral += p.collateral_sats;
    }

    if (!pkg.cets || pkg.cets.length === 0) {
      errors.push('Contract package must contain at least one CET');
    }

    for (const cet of pkg.cets || []) {
      const payoutSum = cet.local_payout_sats + cet.remote_payout_sats + cet.fee_sats;
      if (payoutSum !== totalCollateral) {
        errors.push(
          `CET outcome '${cet.outcome}' total payout (${payoutSum} sats) does not conserve collateral (${totalCollateral} sats)`
        );
      }
      if (!cet.adaptor_signature) {
        errors.push(`CET outcome '${cet.outcome}' is missing adaptor signature`);
      }
    }

    if (!pkg.refund) {
      errors.push('Contract package is missing refund transaction specifications');
    } else {
      const refundSum = pkg.refund.local_payout_sats + pkg.refund.remote_payout_sats;
      if (refundSum > totalCollateral) {
        errors.push('Refund payout exceeds total collateral');
      }
    }

    return {
      valid: errors.length === 0,
      total_collateral_sats: totalCollateral,
      cet_count: (pkg.cets || []).length,
      errors,
      warnings,
    };
  }

  public createSimulation(params: {
    scenario: 'settlement' | 'oracle_outage' | 'conflicting_attestations' | 'refund_timeout' | 'reorg';
    contract_id: string;
    oracle_ids: string[];
    outcome?: string;
  }): DlcSimulationResult {
    const simId = `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    let status: 'simulated_success' | 'simulated_refund' | 'simulated_conflict' = 'simulated_success';
    let message = 'Normal settlement executed via verified adaptor signatures.';
    let localPayout = 100000;
    let remotePayout = 100000;
    const feeSats = 2000;

    if (params.scenario === 'oracle_outage' || params.scenario === 'refund_timeout') {
      status = 'simulated_refund';
      message = 'Oracle was unavailable; refund transaction confirmed after locktime expiry.';
      localPayout = 99000;
      remotePayout = 99000;
    } else if (params.scenario === 'conflicting_attestations') {
      status = 'simulated_conflict';
      message = 'Detected conflicting oracle attestations; adaptor secret extracted as proof of equivocation.';
    } else if (params.scenario === 'reorg') {
      status = 'simulated_refund';
      message = 'Chain reorganization deep enough to evict settlement; returned to mempool funding state.';
    } else {
      localPayout = 150000;
      remotePayout = 48000;
    }

    const sim: DlcSimulationResult = {
      simulation_id: simId,
      scenario: params.scenario,
      contract_id: params.contract_id,
      oracle_ids: params.oracle_ids,
      settlement_outcome: params.outcome || 'increase_gt_5pct',
      payout_local_sats: localPayout,
      payout_remote_sats: remotePayout,
      fees_sats: feeSats,
      funding_tx_hex: '02000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100ca9a3b00000000160014751e76e8199196d454941c45d1b3a323f1433bd600000000',
      closing_tx_hex: '02000000017291a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc68850000000000ffffffff0240420f0000000000160014751e76e8199196d454941c45d1b3a323f1433bd600ca9a3b00000000160014389a0c5c4f24fef7d8b584a7e937d5718a209b0b00000000',
      adaptor_signatures_valid: true,
      status,
      message,
      created_at: new Date().toISOString(),
    };

    this.simulations.set(simId, sim);
    return sim;
  }

  public getSimulation(simId: string): DlcSimulationResult | undefined {
    return this.simulations.get(simId);
  }
}

export default new DlcService();
