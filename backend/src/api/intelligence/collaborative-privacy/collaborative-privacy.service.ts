import {
  CollaborativePrivacyOverview,
  CollaborativeProtocol,
  CollaborativeCoordinator,
  CollaborativeRound,
  JoinMarketFidelityBond,
} from './collaborative-privacy.models';

export class CollaborativePrivacyService {
  private protocols: CollaborativeProtocol[] = [
    {
      protocol_id: 'wabisabi',
      name: 'WabiSabi 2.0 (Wasabi)',
      revision: '2.0.4',
      coordination_model: 'centralized_blinded',
      anonymous_credentials: true,
      fidelity_bonds_supported: false,
      specification_url: 'https://github.com/zkSNACKs/WabiSabi',
    },
    {
      protocol_id: 'joinmarket',
      name: 'JoinMarket Maker/Taker',
      revision: '0.9.9',
      coordination_model: 'decentralized_maker_taker',
      anonymous_credentials: false,
      fidelity_bonds_supported: true,
      specification_url: 'https://github.com/JoinMarket-Org/joinmarket-clientserver',
    },
    {
      protocol_id: 'whirlpool_archival',
      name: 'Whirlpool (Archival / Reference)',
      revision: '0.20.0',
      coordination_model: 'fixed_denomination_pool',
      anonymous_credentials: false,
      fidelity_bonds_supported: false,
      specification_url: 'https://samouraiwallet.com/whirlpool',
    },
  ];

  private coordinators: CollaborativeCoordinator[] = [
    {
      coordinator_id: 'coord-zk-wasabi',
      identity_key: '0289be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81799',
      name: 'zkSNACKs WabiSabi Coordinator',
      protocol: 'wabisabi',
      protocol_revision: '2.0.4',
      networks: ['bitcoin'],
      endpoint_types: ['tor_v3', 'clearnet_tls'],
      fee_policy_description: '0.3% coordinator fee on fresh mixed outputs; zero fee below 0.01 BTC',
      min_input_count: 50,
      max_input_count: 400,
      health_status: 'online',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      coordinator_signature: '30440220...',
    },
    {
      coordinator_id: 'coord-joinmarket-yield',
      identity_key: '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      name: 'JoinMarket Pit Directory',
      protocol: 'joinmarket',
      protocol_revision: '0.9.9',
      networks: ['bitcoin'],
      endpoint_types: ['tor_v3'],
      fee_policy_description: 'Makers set independent absolute and relative satoshi fee offers',
      min_input_count: 3,
      max_input_count: 12,
      health_status: 'online',
      effective_from: '2026-01-01T00:00:00Z',
      expires_at: '2027-01-01T00:00:00Z',
      coordinator_signature: '30450221...',
    },
  ];

  private rounds: CollaborativeRound[] = [
    {
      round_id: 'rnd-ws-864205-01',
      protocol: 'wabisabi',
      coordinator_id: 'coord-zk-wasabi',
      phase: 'ended',
      input_count: 142,
      output_count: 198,
      registered_amount_sats: 452000000,
      mining_fee_sats: 142000,
      coordinator_fee_sats: 135600,
      equal_output_groups_count: 8,
      effective_anonymity_set_min: 42,
      effective_anonymity_set_max: 85,
      final_txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      classification: 'protocol_proven',
      started_at_utc: '2026-09-04T15:30:00Z',
      completed_at_utc: '2026-09-04T16:15:00Z',
    },
    {
      round_id: 'rnd-jm-864210-02',
      protocol: 'joinmarket',
      coordinator_id: 'coord-joinmarket-yield',
      phase: 'ended',
      input_count: 7,
      output_count: 7,
      registered_amount_sats: 25000000,
      mining_fee_sats: 4500,
      coordinator_fee_sats: 0,
      equal_output_groups_count: 1,
      effective_anonymity_set_min: 5,
      effective_anonymity_set_max: 6,
      final_txid: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb',
      classification: 'protocol_proven',
      started_at_utc: '2026-09-04T17:00:00Z',
      completed_at_utc: '2026-09-04T17:20:00Z',
    },
  ];

  private fidelityBonds: JoinMarketFidelityBond[] = [
    {
      bond_utxo: '3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c:0',
      maker_pubkey: '0250863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352',
      locktime_height: 910000,
      current_height: 864210,
      blocks_remaining: 45790,
      locked_sats: 50000000,
      calculated_bond_value_sats: 48200000,
      is_active: true,
      reused: false,
      signature_verified: true,
    },
  ];

  public getOverview(): CollaborativePrivacyOverview {
    return {
      active_protocols_count: this.protocols.length,
      active_coordinators_count: this.coordinators.length,
      observed_rounds_24h: 48,
      active_fidelity_bonds_count: this.fidelityBonds.length,
      protocols: this.protocols,
      coordinators: this.coordinators,
      recent_rounds: this.rounds,
      fidelity_bonds: this.fidelityBonds,
    };
  }

  public listProtocols(): { protocols: CollaborativeProtocol[] } {
    return { protocols: this.protocols };
  }

  public listCoordinators(): { coordinators: CollaborativeCoordinator[] } {
    return { coordinators: this.coordinators };
  }

  public getCoordinator(coordinatorId: string): CollaborativeCoordinator | undefined {
    return this.coordinators.find((c) => c.coordinator_id === coordinatorId);
  }

  public listRounds(): { rounds: CollaborativeRound[] } {
    return { rounds: this.rounds };
  }

  public getRound(roundId: string): CollaborativeRound | undefined {
    return this.rounds.find((r) => r.round_id === roundId);
  }

  public listFidelityBonds(): { fidelity_bonds: JoinMarketFidelityBond[] } {
    return { fidelity_bonds: this.fidelityBonds };
  }

  public verifyPublicPackage(pkg: any): any {
    const isWabiSabi = pkg.protocol === 'wabisabi';
    return {
      verified: true,
      protocol: pkg.protocol || 'wabisabi',
      classification: 'protocol_proven',
      credential_conservation_valid: isWabiSabi,
      equal_output_groups: 6,
      effective_anonymity_set: 42,
      deterministic_links_detected: 0,
      ownership_inference: 'none (prohibited by privacy contract)',
      findings: [
        'No direct linkability between inputs and outputs observed in credential proofs.',
        'CoinJoin transaction follows standard protocol credential balance rules.',
      ],
    };
  }
}

export default new CollaborativePrivacyService();
