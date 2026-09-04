/**
 * Deterministic API Fixtures for the 14 Universe Intelligence Platform Routes.
 *
 * Covers:
 *   1. /tools/policy-lab
 *   2. /tools/workbench
 *   3. /tools/verify-proof
 *   4. /intelligence/relay
 *   5. /intelligence/time-machine
 *   6. /intelligence/mining-templates
 *   7. /intelligence/utxo-set
 *   8. /intelligence/transaction-graph
 *   9. /intelligence/incidents
 *  10. /intelligence/knowledge
 *  11. /developers
 *  12. /developers/query-studio
 *  13. /user/watchlists
 *  14. /explore/protocols
 */

import { sampleIds } from './fixtures.mjs';

export const intelligenceSampleIds = {
  SAMPLE_PACKAGE_ID: 'pkg-887412-001',
  SAMPLE_DEV_USER: 'dev-default',
  SAMPLE_WATCHLIST_USER: 'user-default',
  SAMPLE_TEMPLATE_A: 'template-887412-stratum-v2',
  SAMPLE_TEMPLATE_B: 'template-887412-mempool-projected',
  SAMPLE_SPV_TXID: sampleIds.TXID_A,
  SAMPLE_SPV_BLOCK: sampleIds.BLOCK_HASH,
};

export const intelligenceFixtures = {
  // 1. Policy Lab
  'GET /api/v1/intelligence/policy/profiles': {
    active_profile: 'bitcoin_core_28_relay',
    policy_name: 'Bitcoin Core 28.0 Relay Policy',
    min_relay_tx_fee_sats_vb: 1.0,
    max_standard_tx_weight: 400000,
    permit_bare_multisig: false,
    datacarriersize: 83,
    max_package_vsize: 404000,
    max_package_count: 25,
    truc_v3_enabled: true,
  },
  'POST /api/v1/intelligence/policy/evaluations': {
    package_report: {
      overall_allowed: true,
      package_id: intelligenceSampleIds.SAMPLE_PACKAGE_ID,
      package_feerate_sats_vb: 14.8,
      total_fees_sats: 8420,
      total_vsize: 568,
      members: [
        {
          txid: sampleIds.TXID_A,
          allowed: true,
          vsize: 284,
          fee_sats: 3200,
          effective_feerate: 11.2,
          consensus_valid: true,
          relay_valid: true,
        },
        {
          txid: sampleIds.TXID_B,
          allowed: true,
          vsize: 284,
          fee_sats: 5220,
          effective_feerate: 18.4,
          consensus_valid: true,
          relay_valid: true,
        },
      ],
    },
    explanations: [],
  },

  // 2. Workbench
  'POST /api/v1/intelligence/workbench/script/analyze': {
    is_standard: true,
    script_type: 'witness_v1_taproot',
    asm: 'OP_1 751e76e8199196d454941c45d1b3a323f1433bd6751e76e8199196d454941c45',
    opcodes_count: 2,
    virtual_size_estimate: 43,
    stack_execution: [
      { step: 1, opcode: 'OP_1', stack_after: ['01'] },
      { step: 2, opcode: 'OP_PUSHBYTES_32', stack_after: ['01', '751e...1c45'] },
    ],
  },
  'POST /api/v1/intelligence/workbench/descriptors/parse': {
    valid: true,
    descriptor_type: 'wpkh',
    is_range: true,
    checksum: 'abc12345',
    miniscript_policy: 'pk(key_1)',
    extended_keys: [
      { path: "m/84'/0'/0'", origin: 'd34db33f', depth: 3 },
    ],
  },
  'POST /api/v1/intelligence/workbench/psbt/analyze': {
    inputs_count: 1,
    outputs_count: 2,
    fee_sats: 2150,
    estimated_vsize: 141,
    estimated_feerate: 15.2,
    is_finalized: false,
    inputs: [
      { index: 0, sighash_type: 'SIGHASH_DEFAULT', has_witness_utxo: true },
    ],
  },

  // 3. Verify Proof
  'POST /api/v1/intelligence/verification/spv-proof': {
    valid: true,
    txid: intelligenceSampleIds.SAMPLE_SPV_TXID,
    block_hash: intelligenceSampleIds.SAMPLE_SPV_BLOCK,
    block_height: 887412,
    merkle_root: sampleIds.TXID_A,
    tx_index: 0,
    proof_steps: [
      { direction: 'right', hash: sampleIds.TXID_B },
      { direction: 'left', hash: sampleIds.TXID_C },
    ],
    verified_at_utc: '2026-09-04T01:00:00Z',
  },

  // 4. Relay Observatory
  'GET /api/v1/intelligence/relay/overview': {
    fleet_size: 4,
    median_network_latency_ms: 142,
    bip324_adoption_percent: 68.5,
    active_policy_divergences_count: 2,
    sensor_regions: [
      { region: 'us-east', status: 'healthy', latency_ms: 32, node_version: 'Bitcoin Core 28.0' },
      { region: 'eu-central', status: 'healthy', latency_ms: 88, node_version: 'Bitcoin Core 28.0' },
      { region: 'ap-southeast', status: 'healthy', latency_ms: 194, node_version: 'Bitcoin Core 28.0' },
      { region: 'sa-east', status: 'healthy', latency_ms: 154, node_version: 'Bitcoin Core 28.0' },
    ],
  },
  'GET /api/v1/intelligence/relay/policy-differences': {
    divergences: [
      {
        id: 'div-001',
        topic: 'Full-RBF vs Opt-In RBF',
        impact: 'Standard mempool replacement delta',
        affected_nodes_percent: 12.5,
      },
    ],
  },

  // 5. Time Machine
  'GET /api/v1/intelligence/history/coverage': {
    total_checkpoints: 48,
    oldest_checkpoint_height: 840000,
    newest_checkpoint_height: 887412,
    oldest_timestamp_utc: '2024-04-20T00:00:00Z',
    newest_timestamp_utc: '2026-09-04T00:00:00Z',
    status: 'online',
  },
  'POST /api/v1/intelligence/history/replays': {
    state_hash: 'state_887412_reconstructed_hash',
    target_block_height: 887412,
    timestamp_utc: '2026-09-04T00:00:00Z',
    mempool_size: 4810,
    mempool_vsize: 3410200,
    fee_distribution: [
      { feerate_bucket: '1-2 sat/vB', count: 120, total_vsize: 94000 },
      { feerate_bucket: '2-5 sat/vB', count: 850, total_vsize: 610000 },
      { feerate_bucket: '5-10 sat/vB', count: 1840, total_vsize: 1350000 },
      { feerate_bucket: '10-20 sat/vB', count: 1620, total_vsize: 1120000 },
      { feerate_bucket: '20+ sat/vB', count: 380, total_vsize: 236200 },
    ],
  },

  // 6. Mining Templates
  'GET /api/v1/intelligence/templates/overview': {
    current_height: 887413,
    sources_count: 5,
    templates: [
      {
        template_id: intelligenceSampleIds.SAMPLE_TEMPLATE_A,
        source: 'Stratum v2 SV2 Job Negotiator',
        tx_count: 3120,
        total_fees_btc: 0.284,
        total_weight: 3994000,
        median_feerate: 13.4,
      },
      {
        template_id: intelligenceSampleIds.SAMPLE_TEMPLATE_B,
        source: 'Universe Projected Block',
        tx_count: 3098,
        total_fees_btc: 0.281,
        total_weight: 3992800,
        median_feerate: 13.2,
      },
    ],
  },

  // 7. UTXO Set
  'GET /api/v1/intelligence/utxo/overview': {
    total_utxos: 175420100,
    total_amount_sats: 1978000000000000,
    checkpoint_height: 887400,
    checkpoint_block_hash: sampleIds.BLOCK_HASH,
    reconciliation_status: 'verified',
  },
  'GET /api/v1/intelligence/utxo/cohorts': {
    cohorts: [
      { cohort: '< 1 day', utxo_count: 420000, percentage: 0.24 },
      { cohort: '1d - 1w', utxo_count: 1540000, percentage: 0.88 },
      { cohort: '1w - 1m', utxo_count: 4800000, percentage: 2.74 },
      { cohort: '1m - 1y', utxo_count: 28400000, percentage: 16.19 },
      { cohort: '> 1 year', utxo_count: 140260100, percentage: 79.95 },
    ],
  },
  'GET /api/v1/intelligence/utxo/economic-thresholds': {
    thresholds: [
      { feerate_sat_vb: 1, dust_limit_p2wpkh_sats: 294, dust_limit_p2tr_sats: 330 },
      { feerate_sat_vb: 10, dust_limit_p2wpkh_sats: 2940, dust_limit_p2tr_sats: 3300 },
      { feerate_sat_vb: 50, dust_limit_p2wpkh_sats: 14700, dust_limit_p2tr_sats: 16500 },
    ],
  },

  // 8. Transaction Graph
  'POST /api/v1/intelligence/graph/queries': {
    root_entity: sampleIds.TXID_A,
    nodes: [
      { id: sampleIds.TXID_A, type: 'transaction', label: 'Root Tx' },
      { id: sampleIds.TXID_B, type: 'transaction', label: 'Parent Tx' },
      { id: sampleIds.ADDRESS, type: 'address', label: 'Change Address' },
    ],
    edges: [
      { from: sampleIds.TXID_B, to: sampleIds.TXID_A, value_sats: 1500000 },
      { from: sampleIds.TXID_A, to: sampleIds.ADDRESS, value_sats: 1200000 },
    ],
  },
  'POST /api/v1/intelligence/graph/paths': {
    path_found: true,
    hops_count: 2,
    nodes: [sampleIds.TXID_A, sampleIds.TXID_B],
  },
  'GET /api/v1/intelligence/graph/cases': {
    cases: [
      { case_id: 'case-001', name: 'Treasury Consolidation Audit', entity_count: 4, created_at: '2026-09-01T12:00:00Z' },
    ],
  },

  // 9. Incidents
  'GET /api/v1/intelligence/incidents': {
    incidents: [
      {
        incident_id: 'inc-20260901',
        title: 'Mempool Feerate Spike from Ordinals Inscription Wave',
        severity: 'informational',
        status: 'resolved',
        created_at_utc: '2026-09-01T14:30:00Z',
        resolved_at_utc: '2026-09-01T18:00:00Z',
        summary: 'High transaction submission volume increased the clearing feerate from 12 to 45 sat/vB.',
      },
    ],
  },

  // 10. Knowledge Registry
  'GET /api/v1/intelligence/knowledge/labels': {
    labels: [
      {
        entity: sampleIds.ADDRESS,
        category: 'exchange',
        label: 'Universe Hot Wallet',
        confidence: 0.99,
        verified_by: 'Universe Knowledge Committee',
      },
    ],
  },
  'GET /api/v1/intelligence/knowledge/audit-log': {
    entries: [
      {
        log_id: 'audit-101',
        action: 'label_verified',
        entity: sampleIds.ADDRESS,
        timestamp_utc: '2026-09-02T10:00:00Z',
      },
    ],
  },

  // 11. Developer Platform
  'GET /api/v1/intelligence/developer/keys': {
    user_id: 'dev-default',
    plan: 'Universe Sovereign Developer Tier',
    rate_limit_rpm: 1200,
    keys: [
      {
        key_id: 'key_live_u772a',
        label: 'Production Telemetry Key',
        scopes: ['read:intelligence', 'read:mempool', 'query:sql'],
        created_at: '2026-08-15T00:00:00Z',
        last_used_at: '2026-09-04T01:00:00Z',
      },
    ],
  },
  'POST /api/v1/intelligence/developer/keys': {
    key_id: 'key_new_mock_secret',
    token: 'uni_sec_mock_token_for_display_only',
    label: 'New API Key',
    scopes: ['read:intelligence'],
  },

  // 12. Query Studio
  'GET /api/v1/intelligence/query/schema': {
    tables: [
      {
        name: 'mempool_transactions',
        columns: [
          { name: 'txid', type: 'varchar(64)' },
          { name: 'fee_sats', type: 'bigint' },
          { name: 'vsize', type: 'integer' },
          { name: 'feerate', type: 'double' },
        ],
      },
      {
        name: 'blocks',
        columns: [
          { name: 'height', type: 'integer' },
          { name: 'hash', type: 'varchar(64)' },
          { name: 'total_fees', type: 'bigint' },
        ],
      },
    ],
  },
  'POST /api/v1/intelligence/query/execute': {
    row_count: 2,
    columns: ['txid', 'fee_sats', 'vsize', 'feerate'],
    rows: [
      [sampleIds.TXID_A, 4120, 141, 29.2],
      [sampleIds.TXID_B, 1988, 222, 9.0],
    ],
  },

  // 13. Watchlists
  'GET /api/v1/intelligence/watchlists': {
    watchlists: [
      {
        watchlist_id: 'wl-001',
        name: 'Treasury Multisig Wallets',
        privacy_mode: 'blinded',
        rules_count: 3,
        items: [sampleIds.ADDRESS],
      },
    ],
  },
  'POST /api/v1/intelligence/watchlists': {
    watchlist_id: 'wl-002',
    name: 'New Custom Watchlist',
    privacy_mode: 'blinded',
    rules_count: 0,
    items: [],
  },

  // 14. Protocol Explorer
  'GET /api/v1/intelligence/protocols': {
    protocols: [
      {
        protocol_id: 'runes',
        display_name: 'Runes Protocol',
        family: 'fungible',
        chain: 'bitcoin',
        specification_url: 'https://docs.ordinals.com/runes.html',
        active_indexer: 'ord 0.29.0',
        height_activated: 840000,
      },
      {
        protocol_id: 'ordinals',
        display_name: 'Ordinals Inscriptions',
        family: 'inscriptions',
        chain: 'bitcoin',
        specification_url: 'https://docs.ordinals.com',
        active_indexer: 'ord 0.29.0',
        height_activated: 767430,
      },
    ],
  },
  'POST /api/v1/intelligence/protocols/decode': {
    decoded: [
      {
        protocol_id: 'runes',
        rune_name: 'UNIVERSE•MEMPOOL•TOKEN',
        operation: 'transfer',
        amount: 1000000,
      },
    ],
  },

  // 15. Discreet Log Contract and Oracle Verification Center
  'GET /api/v1/intelligence/dlc/overview': {
    active_oracles_count: 5,
    verified_announcements_count: 142,
    verified_attestations_count: 128,
    detected_conflicts_count: 0,
    pinned_spec_revision: 'dlc-tlv-draft-v0.4',
    recent_events: [
      { event_id: 'evt-btc-usd-20260901', oracle_id: 'kormir-secp256k1-01', event_name: 'BTC/USD Price Reference', maturity_epoch: 1788220800, status: 'attested' },
    ],
  },
  'GET /api/v1/intelligence/dlc/oracles': {
    oracles: [
      { oracle_id: 'kormir-secp256k1-01', display_name: 'Kormir Oracle Alpha', endpoint_type: 'direct', status: 'active', public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', health: 'healthy', announcements_count: 85 },
    ],
  },
  'GET /api/v1/intelligence/dlc/oracles/kormir-secp256k1-01': {
    oracle_id: 'kormir-secp256k1-01',
    display_name: 'Kormir Oracle Alpha',
    endpoint_type: 'direct',
    status: 'active',
    public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    endpoint: 'https://kormir.oracle.example.com',
    protocol_revision: 'dlc-tlv-draft-v0.4',
    registration_source: 'Signed DNSSEC Manifest',
    first_observed_at: '2024-05-01T00:00:00Z',
    last_observed_at: '2026-09-04T05:00:00Z',
    last_success_at: '2026-09-04T05:00:00Z',
    health: 'healthy',
    coverage: '100%',
    announcements_count: 85,
    last_active: '2026-09-04T05:00:00Z',
    reputation: 'verified',
  },
  'GET /api/v1/intelligence/dlc/oracles/oracle-kormir-rates': {
    oracle_id: 'oracle-kormir-rates',
    display_name: 'Kormir Oracle Rates',
    endpoint_type: 'direct',
    status: 'active',
    public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    endpoint: 'https://kormir.oracle.example.com',
    protocol_revision: 'dlc-tlv-draft-v0.4',
    registration_source: 'Signed DNSSEC Manifest',
    first_observed_at: '2024-05-01T00:00:00Z',
    last_observed_at: '2026-09-04T05:00:00Z',
    last_success_at: '2026-09-04T05:00:00Z',
    health: 'healthy',
    coverage: '100%',
    announcements_count: 85,
    last_active: '2026-09-04T05:00:00Z',
    reputation: 'verified',
  },
  'GET /api/v1/intelligence/dlc/events': {
    events: [
      { event_id: 'evt-btc-usd-20260901', oracle_id: 'kormir-secp256k1-01', event_name: 'BTC/USD Price Reference', maturity_epoch: 1788220800, descriptor_type: 'numeric', status: 'attested', outcome: '68500' },
      { event_id: 'event-btc-usd-2026-q4', oracle_id: 'oracle-kormir-rates', event_name: 'BTC/USD 2026 Q4 Settlement', maturity_epoch: 1788220800, descriptor_type: 'numeric', status: 'attested', outcome: '72500' },
    ],
  },
  'GET /api/v1/intelligence/dlc/events/evt-btc-usd-20260901': {
    event_id: 'evt-btc-usd-20260901',
    oracle_id: 'kormir-secp256k1-01',
    event_name: 'BTC/USD Price Reference',
    maturity_epoch: 1788220800,
    descriptor_type: 'numeric',
    status: 'attested',
    outcome: '68500',
    nonces: ['0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'],
    attestation_signatures: ['c0defeed...'],
  },
  'GET /api/v1/intelligence/dlc/events/event-btc-usd-2026-q4': {
    event_id: 'event-btc-usd-2026-q4',
    oracle_id: 'oracle-kormir-rates',
    event_name: 'BTC/USD 2026 Q4 Settlement',
    event_descriptor: 'numeric-digits-18',
    descriptor_type: 'numeric',
    maturity_epoch: 1788220800,
    nonce_count: 18,
    status: 'attested',
    outcome: '72500',
    nonces: ['0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'],
    attestation_signatures: ['c0defeed1234567890abcdef'],
  },
  'POST /api/v1/intelligence/dlc/announcements/verify': {
    valid: true,
    event_id: 'evt-btc-usd-20260901',
    oracle_id: 'kormir-secp256k1-01',
    signature_valid: true,
    findings: [],
  },
  'POST /api/v1/intelligence/dlc/contracts/verify': {
    valid: true,
    contract_id: 'dlc-contract-fixture-01',
    collateral_conserved: true,
    total_collateral_sats: 200000000,
    cet_count: 10,
    findings: [],
  },
  'POST /api/v1/intelligence/dlc/simulations': {
    simulation_id: 'sim-dlc-001',
    status: 'completed',
    result: 'settled_correctly',
    settlement_txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    details: 'Simulated contract executed via outcome 68500 CET',
  },

  // 16. Simplicity Contract Explorer
  'GET /api/v1/intelligence/simplicity/overview': {
    programs_indexed: 42,
    occurrences_count: 156,
    active_toolchain: 'rust-simplicity-0.4.0',
    cmr_registry_count: 38,
    recent_programs: [
      { program_id: 'simplicity-escrow-v1', cmr: 'c0ffee0123456789abcdef0123456789abcdef0123456789abcdef0123456789', name: 'Escrow with Timeout', jet_count: 6, static_cost_weight: 1240 },
    ],
  },
  'GET /api/v1/intelligence/simplicity/programs': {
    programs: [
      { program_id: 'simplicity-escrow-v1', cmr: 'c0ffee0123456789abcdef0123456789abcdef0123456789abcdef0123456789', name: 'Escrow with Timeout', jet_count: 6, static_cost_weight: 1240, occurrence_count: 8 },
    ],
  },
  'GET /api/v1/intelligence/simplicity/programs/simplicity-escrow-v1': {
    program_id: 'simplicity-escrow-v1',
    cmr: 'c0ffee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    imr: '1234ee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    amr: '5678ee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    name: 'Escrow with Timeout',
    jet_count: 6,
    static_cost_weight: 1240,
    occurrence_count: 8,
    dag_nodes_count: 24,
    source_snippet: 'comp (pair iden unit) ...',
  },
  'GET /api/v1/intelligence/simplicity/programs/sim-multisig-v1': {
    program_id: 'sim-multisig-v1',
    cmr: 'c0ffee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    imr: '1234ee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    amr: '5678ee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    program_type: '2-of-3 Multisig with Timeout',
    name: 'Multisig with Timeout',
    jets: ['add_32', 'verify', 'bip_0340_verify'],
    static_cost: 1450,
    memory_bound: 512,
    cell_bound: 1024,
    toolchain_revision: 'rust-simplicity-0.4.0',
    source_text: 'comp (pair (witness ...) iden) ...',
    static_cost_weight: 1450,
    occurrence_count: 14,
    dag_nodes_count: 32,
  },
  'GET /api/v1/intelligence/simplicity/transactions/f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16': {
    txid: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
    simplicity_inputs: [
      { index: 0, program_id: 'simplicity-escrow-v1', execution_success: true, budget_consumed: 1240 },
    ],
  },
  'GET /api/v1/intelligence/simplicity/toolchains': {
    toolchains: [
      { name: 'rust-simplicity', version: '0.4.0', status: 'active', supported_jets: 120 },
    ],
  },
  'POST /api/v1/intelligence/simplicity/programs/decode': {
    valid: true,
    cmr: 'c0ffee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    imr: '1234ee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    amr: '5678ee0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    jets: ['add_32', 'verify'],
    cost: 1240,
  },
  'POST /api/v1/intelligence/simplicity/formal-artifacts/verify': {
    verified: true,
    proof_system: 'coq-simplicity',
    statement: 'Program preserves balance and adheres to timelock',
    findings: [],
  },

  // 17. Statechain and Off-Chain UTXO Recovery Center
  'GET /api/v1/intelligence/offchain/overview': {
    statechain_operators_count: 3,
    coinswap_makers_count: 8,
    tracked_offchain_utxos_count: 240,
    protocols_supported: ['mercury-blinded-statechain', 'teleport-coinswap'],
  },
  'GET /api/v1/intelligence/offchain/operators': {
    operators: [
      { operator_id: 'statechain-mercury-alpha', display_name: 'Mercury Operator Alpha', protocol: 'statechain', endpoint: 'https://statechain.example.com', status: 'online', supported_networks: ['bitcoin-mainnet'] },
      { operator_id: 'sc-mercury-alpha', display_name: 'Mercury Alpha Operator', protocol: 'mercury-blinded-statechain', endpoint: 'https://alpha.mercury.example.com', status: 'online', supported_networks: ['bitcoin-mainnet'] },
    ],
  },
  'GET /api/v1/intelligence/offchain/operators/statechain-mercury-alpha': {
    operator_id: 'statechain-mercury-alpha',
    display_name: 'Mercury Operator Alpha',
    protocol: 'statechain',
    endpoint: 'https://statechain.example.com',
    status: 'online',
    supported_networks: ['bitcoin-mainnet'],
    signature_count: 1420,
    public_key: '03abc123def456',
    policy: { locktime_decrement_step: 144, min_deposit_sats: 100000 },
  },
  'GET /api/v1/intelligence/offchain/operators/sc-mercury-alpha': {
    operator_id: 'sc-mercury-alpha',
    display_name: 'Mercury Alpha Operator',
    protocol: 'mercury-blinded-statechain',
    operator_public_key: '03abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890',
    public_key: '03abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890',
    endpoints: ['https://alpha.mercury.example.com'],
    supported_versions: ['v2.1', 'v2.2'],
    backup_transaction_policy: 'decrement-144-blocks',
    signature_count: 2840,
    status: 'online',
    first_observed_at: '2024-03-01T00:00:00Z',
    supported_networks: ['bitcoin-mainnet'],
    policy: { locktime_decrement_step: 144, min_deposit_sats: 100000 },
  },
  'GET /api/v1/intelligence/offchain/offers': {
    offers: [
      { offer_id: 'coinswap-offer-01', maker_id: 'maker-teleport-01', min_amount_sats: 50000, max_amount_sats: 5000000, base_fee_sats: 500 },
    ],
  },
  'POST /api/v1/intelligence/offchain/manifests/verify': {
    valid: true,
    operator_id: 'statechain-mercury-alpha',
    signature_valid: true,
    findings: [],
  },
  'POST /api/v1/intelligence/offchain/recovery/context': {
    recovery_status: 'recoverable_now',
    current_stage: 'backup_tx_valid',
    earliest_broadcast_height: 840100,
    recommended_psbt: 'cHNidP8BAFICAAAA...',
  },

  // 18. Compact Filter and Light-Client Verification Center
  'GET /api/v1/intelligence/compact-filters/overview': {
    providers_online: 12,
    filter_header_tip_height: 855000,
    checkpoints_indexed: 855,
    supported_filter_types: ['basic_bip158'],
  },
  'GET /api/v1/intelligence/compact-filters/providers': {
    providers: [
      { provider_id: 'provider-cf-peer-01', address: '198.51.100.12:8333', service_bits: 'NODE_COMPACT_FILTERS', status: 'healthy', filter_tip: 855000, latency_ms: 45 },
    ],
  },
  'GET /api/v1/intelligence/compact-filters/providers/provider-cf-peer-01': {
    provider_id: 'provider-cf-peer-01',
    address: '198.51.100.12:8333',
    service_bits: 'NODE_COMPACT_FILTERS',
    status: 'healthy',
    filter_tip: 855000,
    latency_ms: 45,
    successful_probes_rate: 0.998,
    reorg_tolerance: 'compatible',
  },
  'GET /api/v1/intelligence/compact-filters/providers/node-ashburn-01': {
    provider_id: 'node-ashburn-01',
    address: '198.51.100.44:8333',
    service_bits: 'NODE_COMPACT_FILTERS | NODE_NETWORK',
    status: 'healthy',
    filter_tip: 855000,
    latency_ms: 38,
    software_version: 'Satoshi:28.0.0',
    last_successful_observation: '2026-09-04T05:45:00Z',
    agreement_rate: '99.98%',
    successful_probes_rate: 0.9998,
    reorg_tolerance: 'compatible',
  },
  'GET /api/v1/intelligence/compact-filters/checkpoints': {
    checkpoints: [
      { height: 850000, filter_header: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f' },
    ],
  },
  'GET /api/v1/intelligence/compact-filters/blocks/0000000000000000000244cf58e72c83ff1c051ee78d4dd425ec88c3a9f5d131': {
    block_hash: '0000000000000000000244cf58e72c83ff1c051ee78d4dd425ec88c3a9f5d131',
    filter_type: 'basic',
    element_count: 3412,
    filter_hash: '3f4b1a2c5d',
    filter_header: '4e2a9c8b7d',
  },
  'GET /api/v1/intelligence/compact-filters/ranges': {
    ranges: [
      { start_height: 854000, end_height: 855000, status: 'fully_indexed' },
    ],
  },
  'POST /api/v1/intelligence/compact-filters/verifications': {
    verified: true,
    matched_blocks: [],
    false_positives: 0,
    provider_agreement: true,
  },

  // 19. AssumeUTXO and Node Bootstrap Center
  'GET /api/v1/intelligence/bootstrap/overview': {
    known_snapshots_count: 6,
    active_chainstates: 2,
    latest_assumeutxo_base_height: 840000,
    network: 'bitcoin-mainnet',
  },
  'GET /api/v1/intelligence/bootstrap/snapshots': {
    snapshots: [
      { snapshot_id: 'snapshot-mainnet-840000', base_height: 840000, base_block_hash: '0000000000000000000244cf58e72c83ff1c051ee78d4dd425ec88c3a9f5d131', coins_count: 182450000, file_size_bytes: 11450000000, verified: true },
      { snapshot_id: '840000', base_height: 840000, base_block_hash: '0000000000000000000244cf58e72c83ff1c051ee78d4dd425ec88c3a9f5d131', coins_count: 182450000, file_size_bytes: 11450000000, verified: true },
    ],
  },
  'GET /api/v1/intelligence/bootstrap/snapshots/snapshot-mainnet-840000': {
    snapshot_id: 'snapshot-mainnet-840000',
    base_height: 840000,
    base_block_hash: '0000000000000000000244cf58e72c83ff1c051ee78d4dd425ec88c3a9f5d131',
    coins_count: 182450000,
    txoutset_hash: '12345678abcdef',
    file_sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    file_size_bytes: 11450000000,
    assumeutxo_parameter_source: 'Bitcoin Core 28.0 binary consensus table',
    verified: true,
  },
  'GET /api/v1/intelligence/bootstrap/snapshots/840000': {
    snapshot_id: '840000',
    network: 'bitcoin-mainnet',
    producer_software: 'Bitcoin Core 28.0',
    base_height: 840000,
    base_block_hash: '0000000000000000000244cf58e72c83ff1c051ee78d4dd425ec88c3a9f5d131',
    coins_count: 182450000,
    txoutset_hash: '12345678abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
    snapshot_file_sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    file_sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    snapshot_file_size: 11450000000,
    file_size_bytes: 11450000000,
    assumeutxo_parameter_source: 'Bitcoin Core 28.0 binary consensus table',
    verified: true,
  },
  'GET /api/v1/intelligence/bootstrap/chainstates': {
    chainstates: [
      { id: 'ibd', type: 'background_ibd', validated_height: 450000, target_height: 840000, progress: 0.53 },
      { id: 'snapshot', type: 'snapshot_chainstate', validated_height: 855000, target_height: 855000, progress: 1.0 },
    ],
  },
  'POST /api/v1/intelligence/bootstrap/snapshots/verify': {
    valid: true,
    snapshot_id: 'snapshot-mainnet-840000',
    matches_compiled_assumeutxo: true,
    hash_match: true,
    findings: [],
  },
  'POST /api/v1/intelligence/bootstrap/planner/evaluate': {
    recommended_strategy: 'assumeutxo_bootstrap',
    estimated_time_savings_hours: 36.5,
    disk_requirement_gb: 35,
  },

  // 20. MuSig2 and Multiparty Center
  'GET /api/v1/intelligence/multiparty/overview': {
    active_musig2_sessions: 4,
    registered_bsms_policies: 15,
    supported_specs: ['bip327-musig2', 'bip129-bsms', 'bip388-wallet-policies'],
  },
  'GET /api/v1/intelligence/multiparty/musig2/sessions': {
    sessions: [
      { session_id: 'session-musig2-alpha-001', state: 'round2_signing', threshold: 3, participants_count: 3, created_at: '2026-09-04T02:00:00Z' },
      { session_id: 'session-musig2-cold-01', state: 'round2_signing', threshold: 3, participants_count: 3, created_at: '2026-09-04T02:00:00Z' },
    ],
  },
  'GET /api/v1/intelligence/multiparty/musig2/sessions/session-musig2-alpha-001': {
    session_id: 'session-musig2-alpha-001',
    state: 'round2_signing',
    threshold: 3,
    participants_count: 3,
    participants: ['Alice', 'Bob', 'Carol'],
    nonces_collected: 3,
    partial_signatures_collected: 2,
    aggregated_public_key: '03deadbeef1234',
  },
  'GET /api/v1/intelligence/multiparty/musig2/sessions/session-musig2-cold-01': {
    session_id: 'session-musig2-cold-01',
    protocol: 'BIP327-MuSig2',
    threshold: 3,
    participant_count: 3,
    aggregated_pubkey: '03deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    state: 'round2_signing',
    created_at_utc: '2026-09-04T02:00:00Z',
    participants: ['Coordinator-Node', 'Coldcard-Vault', 'Ledger-Backing'],
    nonces_collected: 3,
    partial_signatures_collected: 2,
  },
  'GET /api/v1/intelligence/multiparty/descriptors': {
    descriptors: [
      { descriptor_id: 'desc-wsh-multisig-01', policy: 'wsh(sortedmulti(2,[key1],[key2]))', standard: 'BIP388' },
    ],
  },
  'GET /api/v1/intelligence/multiparty/labels': {
    labels: [
      { label_id: 'lbl-001', path: "m/48'/0'/0'/2'", description: 'Cold storage primary key' },
    ],
  },
  'POST /api/v1/intelligence/multiparty/bsms/verify': {
    valid: true,
    policy_hash: '98765432fedc',
    quorum: '2-of-3',
    findings: [],
  },
  'POST /api/v1/intelligence/multiparty/policies/analyze': {
    standard_compliant: true,
    descriptor_type: 'wsh_sortedmulti',
    spending_conditions_count: 1,
    miniscript_safe: true,
  },

  // 21. Decentralized Mining Observatory
  'GET /api/v1/intelligence/mining-decentralized/overview': {
    protocols_tracked: ['datum', 'p2pool_v2', 'braidpool'],
    observed_shares_24h: 42800,
    template_autonomy_ratio: 0.94,
    independent_block_templates_count: 12,
  },
  'GET /api/v1/intelligence/mining-decentralized/shares': {
    shares: [
      { share_id: 'datum-share-887412-001', protocol: 'datum', miner_id: 'miner-ocean-01', difficulty: 65536, template_diff_count: 0, timestamp: '2026-09-04T05:30:00Z' },
      { share_id: 'share-datum-881290', protocol: 'datum', miner_id: 'miner-ocean-ashburn-01', difficulty: 65536, template_diff_count: 0, timestamp: '2026-09-04T05:30:00Z' },
    ],
  },
  'GET /api/v1/intelligence/mining-decentralized/shares/datum-share-887412-001': {
    share_id: 'datum-share-887412-001',
    protocol: 'datum',
    miner_id: 'miner-ocean-01',
    difficulty: 65536,
    template_diff_count: 0,
    coinbase_payout_address: 'bc1qdatum...',
    timestamp: '2026-09-04T05:30:00Z',
    verified: true,
  },
  'GET /api/v1/intelligence/mining-decentralized/shares/share-datum-881290': {
    share_id: 'share-datum-881290',
    protocol: 'datum',
    miner_id: 'miner-ocean-ashburn-01',
    difficulty: 65536,
    observed_at_utc: '2026-09-04T05:30:00Z',
    status: 'accepted',
    coinbase_payout_address: 'bc1qdatumashburnminer0123456789abcdef',
    template_diff_count: 0,
    verified: true,
  },
  'GET /api/v1/intelligence/mining-decentralized/templates/compare': {
    miner_selected_txs: 2450,
    pool_suggested_txs: 2452,
    tx_divergence_count: 2,
    weight_divergence_pct: 0.04,
  },
  'GET /api/v1/intelligence/mining-decentralized/datum/summary': {
    protocol: 'datum',
    active_hashrate_share: 0.038,
    connected_rigs: 1840,
    autonomous_blocks_count: 5,
  },

  // 22. Payment Connectivity Center
  'GET /api/v1/intelligence/payment-connectivity/overview': {
    active_relays_count: 18,
    inspected_nwc_connections: 54,
    verified_zaps_24h: 3120,
    relay_connectivity_rate: 0.99,
  },
  'GET /api/v1/intelligence/payment-connectivity/relays': {
    relays: [
      { url: 'wss://relay.damus.io', status: 'online', rtt_ms: 32, supported_nips: [1, 47, 57] },
      { url: 'wss://nostr.mom', status: 'online', rtt_ms: 45, supported_nips: [1, 47, 57] },
    ],
  },
  'POST /api/v1/intelligence/payment-connectivity/nwc/inspect': {
    relay: 'wss://relay.damus.io',
    wallet_pubkey: 'npub1wallet...',
    permissions: ['get_balance', 'pay_invoice'],
    secret_masked: true,
    findings: [],
  },
  'POST /api/v1/intelligence/payment-connectivity/lnurl/inspect': {
    endpoint: 'https://service.example.com/.well-known/lnurlp/alice',
    tag: 'payRequest',
    min_sendable_sats: 10,
    max_sendable_sats: 1000000,
    metadata_hash_valid: true,
  },
  'POST /api/v1/intelligence/payment-connectivity/zaps/verify': {
    valid: true,
    recipient_pubkey: 'npub1alice...',
    amount_sats: 2100,
    invoice_description_hash_valid: true,
    findings: [],
  },

  // 23. Bitcoin Staking Observatory
  'GET /api/v1/intelligence/bitcoin-staking/overview': {
    active_staked_sats: 45000000000,
    delegations_count: 320,
    finality_providers_count: 24,
    slashing_evidence_incidents: 0,
    current_parameter_version: 'v0.4.0',
  },
  'GET /api/v1/intelligence/bitcoin-staking/delegations': {
    delegations: [
      { delegation_id: 'del-babylon-840000-01', staker_pk: '02abc123def456', finality_provider_pk: '03123456abcdef', amount_sats: 500000000, state: 'active', staking_txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', lock_blocks: 64000 },
      { delegation_id: 'del-882001-allnodes', staker_pk: '02abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890', finality_provider_pk: '03123456abcdef7890abcdef1234567890abcdef1234567890abcdef1234567890', amount_sats: 500000000, state: 'active', staking_txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', lock_blocks: 64000 },
    ],
  },
  'GET /api/v1/intelligence/bitcoin-staking/delegations/del-babylon-840000-01': {
    delegation_id: 'del-babylon-840000-01',
    staker_pk: '02abc123def456',
    finality_provider_pk: '03123456abcdef',
    amount_sats: 500000000,
    state: 'active',
    staking_txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    lock_blocks: 64000,
    unbonding_txid: null,
    slashed: false,
  },
  'GET /api/v1/intelligence/bitcoin-staking/delegations/del-882001-allnodes': {
    delegation_id: 'del-882001-allnodes',
    staker_pk: '02abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890',
    finality_provider_pk: '03123456abcdef7890abcdef1234567890abcdef1234567890abcdef1234567890',
    amount_sats: 500000000,
    state: 'active',
    staking_txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    staking_timelock_blocks: 64000,
    unbonding_timelock_blocks: 1008,
    created_at_utc: '2026-08-20T12:00:00Z',
    lock_blocks: 64000,
    unbonding_txid: null,
    slashed: false,
  },
  'GET /api/v1/intelligence/bitcoin-staking/providers': {
    providers: [
      { provider_id: 'fp-babylon-01', name: 'Babylon Finality Provider Alpha', public_key: '03123456abcdef', delegated_sats: 12000000000, uptime_pct: 99.98, status: 'active' },
      { provider_id: 'fp-allnodes-01', name: 'Allnodes Babylon Provider', display_name: 'Allnodes Babylon Provider', public_key: '03123456abcdef7890abcdef1234567890abcdef1234567890abcdef1234567890', delegated_sats: 14500000000, uptime_pct: 99.99, status: 'active' },
    ],
  },
  'GET /api/v1/intelligence/bitcoin-staking/providers/fp-babylon-01': {
    provider_id: 'fp-babylon-01',
    name: 'Babylon Finality Provider Alpha',
    public_key: '03123456abcdef',
    delegated_sats: 12000000000,
    uptime_pct: 99.98,
    status: 'active',
    eots_public_keys: ['02beef12345678'],
  },
  'GET /api/v1/intelligence/bitcoin-staking/providers/fp-allnodes-01': {
    provider_id: 'fp-allnodes-01',
    display_name: 'Allnodes Babylon Provider',
    name: 'Allnodes Babylon Provider',
    provider_public_key: '03123456abcdef7890abcdef1234567890abcdef1234567890abcdef1234567890',
    public_key: '03123456abcdef7890abcdef1234567890abcdef1234567890abcdef1234567890',
    status: 'active',
    delegated_stake_sats: 14500000000,
    active_delegations_count: 48,
    uptime_pct: 99.99,
    eots_public_keys: ['02beef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'],
  },
  'GET /api/v1/intelligence/bitcoin-staking/parameters': {
    min_staking_time_blocks: 4032,
    max_staking_time_blocks: 64000,
    min_staking_amount_sats: 1000000,
    max_staking_amount_sats: 10000000000,
    slashing_pk_script: '5120abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  },
  'GET /api/v1/intelligence/bitcoin-staking/evidence': {
    evidence_records: [],
  },
  'POST /api/v1/intelligence/bitcoin-staking/transactions/verify': {
    valid: true,
    delegation_id: 'del-babylon-840000-01',
    covenant_conforms: true,
    findings: [],
  },
  'POST /api/v1/intelligence/bitcoin-staking/reconcile': {
    reconciled: true,
    discrepancy_sats: 0,
    voting_power_aligned: true,
  },

  // 1. Swaps
  'GET /api/v1/intelligence/swaps/overview': {
    total_swaps_24h: 1420,
    active_providers_count: 4,
    submarine_volume_btc_24h: 38.5,
    reverse_volume_btc_24h: 52.1,
    chain_swap_volume_btc_24h: 22.4,
    success_rate_pct: 99.4,
    recent_swaps: [
      {
        swap_id: 'swp-864190-01',
        swap_type: 'submarine',
        protocol_type: 'submarine',
        provider: 'boltz-exchange',
        from_asset: 'BTC-Lightning',
        to_asset: 'BTC-Onchain',
        amount_sats: 1500000,
        status: 'completed',
        created_at: '2026-09-04T16:00:00Z',
      },
    ],
  },
  'GET /api/v1/intelligence/swaps/providers': [
    { provider_id: 'boltz-exchange', name: 'Boltz Exchange', supported_types: ['submarine', 'reverse', 'chain'], reputation_score: 99.2, total_volume_btc: 1845.0, status: 'online' },
    { provider_id: 'loop-lightning-labs', name: 'Lightning Loop', supported_types: ['submarine', 'reverse'], reputation_score: 99.8, total_volume_btc: 4210.0, status: 'online' },
  ],
  'GET /api/v1/intelligence/swaps/providers/boltz-exchange': {
    provider_id: 'boltz-exchange',
    name: 'Boltz Exchange',
    supported_types: ['submarine', 'reverse', 'chain'],
    reputation_score: 99.2,
    total_volume_btc: 1845.0,
    status: 'online',
    fees_pct: 0.15,
  },
  'GET /api/v1/intelligence/swaps/records': [
    { swap_id: 'swp-864190-01', swap_type: 'submarine', provider: 'boltz-exchange', amount_sats: 1500000, status: 'completed' },
  ],
  'POST /api/v1/intelligence/swaps/inspect': {
    swap_id: 'swp-864190-01',
    swap_type: 'submarine',
    hash_lock: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timelock_cltv: 864250,
    refund_public_key: '028b9c2a4f6d8e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
    preimage_revealed: true,
  },
  'POST /api/v1/intelligence/swaps/recover': {
    recovery_tx_hex: '02000000000101...',
    eligible: true,
    estimated_miner_fee_sats: 840,
    recovery_strategy: 'CLTV Expiry Sweep',
  },
  'POST /api/v1/intelligence/swaps/simulate': {
    simulated: true,
    expected_slippage_pct: 0.02,
    net_received_sats: 1497200,
    routing_hops_count: 2,
  },

  // 2. Ark V-PACK
  'GET /api/v1/intelligence/ark/vpack/overview': {
    total_vpacks_verified: 8920,
    active_asp_providers: 3,
    total_vtxos_in_circulation: 45120,
    unilateral_exits_24h: 12,
    backup_retention_healthy_pct: 99.8,
    recent_vpacks: [
      {
        vpack_id: 'vp-864192-01',
        vtxo_id: 'vtxo-864190-001',
        asp_id: 'asp-covenant-ark',
        amount_sats: 250000,
        tree_depth: 4,
        expiry_block: 864300,
        status: 'valid',
      },
    ],
  },
  'GET /api/v1/intelligence/ark/vpack/providers': [
    { asp_id: 'asp-covenant-ark', name: 'Covenant Ark ASP Alpha', pool_pubkey: '028b9c...5b', supported_lifetimes_blocks: 288, active_vtxos_count: 24100, status: 'online' },
  ],
  'GET /api/v1/intelligence/ark/vpack/vtxos/vtxo-864190-001': {
    vtxo_id: 'vtxo-864190-001',
    asp_id: 'asp-covenant-ark',
    amount_sats: 250000,
    round_txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    expiry_height: 864300,
    tree_depth: 4,
    status: 'spendable',
    exit_path_ready: true,
  },
  'POST /api/v1/intelligence/ark/vpack/verify': {
    valid: true,
    vtxo_id: 'vtxo-864190-001',
    asp_signature_valid: true,
    merkle_branch_valid: true,
    amount_sats: 250000,
    expiry_height: 864300,
  },
  'POST /api/v1/intelligence/ark/vpack/translate': {
    translated: true,
    format: 'vpack_v1',
    target_format: 'bip370_psbt',
    converted_psbt_base64: 'cHNidP8BAFICAAAA...',
  },
  'POST /api/v1/intelligence/ark/vpack/exit/simulate': {
    cost_estimate_sats: 3200,
    wait_time_blocks: 144,
    num_transactions_required: 4,
  },

  // 3. Lightning Resilience
  'GET /api/v1/intelligence/lightning/resilience/overview': {
    total_channels_monitored: 84,
    healthy_channels_count: 81,
    congested_channels_count: 3,
    active_incidents_count: 2,
    average_slot_utilization_pct: 14.2,
    average_held_duration_p95_seconds: 12.8,
    onion_queue: {
      total_queue_depth: 142,
      queue_utilization_pct: 28.4,
      processing_rate_msgs_per_sec: 85,
      dropped_msgs_rate_pct: 0.0,
      rate_limit_active: false,
      status: 'normal',
    },
    recent_incidents: [
      {
        incident_id: 'inc-jam-864190-01',
        incident_type: 'sustained_slot_pressure',
        severity: 'high',
        channel_short_id: '864190x304x2',
        observed_at: '2026-09-04T16:15:00Z',
        duration_seconds: 1800,
        metric_name: 'htlc_slot_utilization_pct',
        threshold_value: 75.0,
        observed_value: 81.7,
        description: 'Pattern consistent with prolonged holds across multiple downstream hops.',
        operator_recommendation: 'Operator review recommended. Consider lowering per-peer in-flight slot quota.',
      },
    ],
    top_congested_channels: [
      {
        short_channel_id: '864190x304x2',
        capacity_sats: 5000000,
        htlc_slot_capacity: 483,
        htlc_slots_in_use: 395,
        htlc_slot_utilization_pct: 81.7,
        resilience_band: 'high_congestion',
      },
    ],
  },
  'GET /api/v1/intelligence/lightning/resilience/channels': {
    channels: [
      {
        short_channel_id: '864190x304x2',
        capacity_sats: 5000000,
        htlc_slot_capacity: 483,
        htlc_slots_in_use: 395,
        htlc_slot_utilization_pct: 81.7,
        resilience_band: 'high_congestion',
      },
    ],
  },
  'GET /api/v1/intelligence/lightning/resilience/channels/864190x304x2': {
    short_channel_id: '864190x304x2',
    capacity_sats: 5000000,
    htlc_slot_capacity: 483,
    htlc_slots_in_use: 395,
    htlc_slot_utilization_pct: 81.7,
    pending_htlcs_count: 395,
    held_htlcs_count_over_60s: 310,
    average_held_duration_seconds: 94.2,
    resilience_band: 'high_congestion',
    reputation_rate_limiting_active: true,
    fast_lane_available: true,
    node_1_pubkey: '028b9c2a4f6d8e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
    node_2_pubkey: '034f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
    updated_at: '2026-09-04T17:45:00Z',
  },
  'GET /api/v1/intelligence/lightning/resilience/nodes/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798': {
    public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    alias: 'Universe-Hub-01',
    total_channels: 24,
    healthy_channels: 22,
    congested_channels: 2,
    overall_health_score: 91.6,
    reputation_policy_enabled: true,
    circuit_breaker_enabled: true,
    onion_rate_limiting_enabled: true,
    updated_at: '2026-09-04T17:45:00Z',
  },
  'GET /api/v1/intelligence/lightning/resilience/incidents': {
    incidents: [],
  },
  'GET /api/v1/intelligence/lightning/resilience/mitigations': {
    mitigations: [],
  },
  'POST /api/v1/intelligence/lightning/resilience/simulate': {
    baseline_survival_rate_pct: 22.4,
    protected_survival_rate_pct: 96.8,
    recommended_actions: ['Enable local reputation tracking for unknown forwarders'],
  },

  // 4. Block Propagation
  'GET /api/v1/intelligence/block-propagation/overview': {
    total_blocks_observed: 4320,
    average_propagation_time_ms: 412,
    p90_propagation_time_ms: 1240,
    p99_propagation_time_ms: 3820,
    compact_block_hit_rate_pct: 94.7,
    fibre_blocks_percentage: 98.2,
    active_sensors_count: 42,
    fork_races_last_30_days: 3,
    stale_blocks_last_30_days: 1,
    recent_blocks: [
      {
        height: 864201,
        hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        miner: 'Foundry USA',
        tx_count: 3892,
        size_bytes: 1642890,
        first_seen_sensor: 'sensor-eu-west-1',
        time_to_50_pct_nodes_ms: 280,
        time_to_90_pct_nodes_ms: 640,
        time_to_99_pct_nodes_ms: 1480,
        compact_block_reconstructed: true,
        extra_tx_requested_count: 2,
        fibre_relayed: true,
        stale: false,
      },
    ],
  },
  'GET /api/v1/intelligence/block-propagation/live': {
    live_blocks: [
      {
        height: 864201,
        hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        first_seen_sensor: 'sensor-eu-west-1',
        time_to_50_pct_nodes_ms: 280,
        time_to_90_pct_nodes_ms: 640,
        extra_tx_requested_count: 2,
        fibre_relayed: true,
      },
    ],
    active_sensors: 42,
  },
  'GET /api/v1/intelligence/block-propagation/blocks/00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3': {
    height: 864201,
    hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
    miner: 'Foundry USA',
    tx_count: 3892,
    size_bytes: 1642890,
    first_seen_sensor: 'sensor-eu-west-1',
    time_to_50_pct_nodes_ms: 280,
    time_to_90_pct_nodes_ms: 640,
    time_to_99_pct_nodes_ms: 1480,
    compact_block_reconstructed: true,
    extra_tx_requested_count: 2,
    fibre_relayed: true,
    stale: false,
    sensor_latencies: [
      { sensor_id: 'sensor-eu-west-1', latency_ms: 12 },
      { sensor_id: 'sensor-us-east-1', latency_ms: 84 },
    ],
  },
  'GET /api/v1/intelligence/block-propagation/compact-blocks': [
    { block_height: 864201, block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3', short_ids_matched: 3890, missing_txs: 2, reconstruction_time_ms: 8.4, hit_rate_pct: 99.95, method: 'BIP152 High Bandwidth' },
  ],
  'GET /api/v1/intelligence/block-propagation/fork-races': [
    {
      race_id: 'race-863920',
      height: 863920,
      observed_at: '2026-09-02T14:20:00Z',
      block_a: { hash: '00000000000000000002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4', miner: 'AntPool', received_first_pct: 54.2 },
      block_b: { hash: '00000000000000000003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', miner: 'F2Pool', received_first_pct: 45.8 },
      time_difference_ms: 340,
    },
  ],
  'GET /api/v1/intelligence/block-propagation/fork-races/race-863920': {
    race_id: 'race-863920',
    height: 863920,
    observed_at: '2026-09-02T14:20:00Z',
    block_a: { hash: '00000000000000000002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4', miner: 'AntPool', received_first_pct: 54.2 },
    block_b: { hash: '00000000000000000003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', miner: 'F2Pool', received_first_pct: 45.8 },
    time_difference_ms: 340,
    node_split_map: { europe: 'AntPool', north_america: 'AntPool', asia_east: 'F2Pool' },
  },
  'GET /api/v1/intelligence/block-propagation/stale-tips': [
    { height: 863920, stale_hash: '00000000000000000003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', winning_hash: '00000000000000000002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4', miner: 'F2Pool', lost_subsidy_sats: 312500000, lost_fees_sats: 4892010, reorg_depth: 1, date: '2026-09-02' },
  ],
  'GET /api/v1/intelligence/block-propagation/fibre': {
    active_nodes: 18,
    average_latency_ms: 45.2,
    bandwidth_reduction_pct: 99.2,
    nodes: [
      { location: 'Frankfurt', ping_ms: 12, status: 'synced' },
      { location: 'Tokyo', ping_ms: 185, status: 'synced' },
    ],
  },

  // 5. Private Submission & Ordering
  'GET /api/v1/intelligence/submission/overview': {
    total_private_submissions_24h: 342,
    active_accelerator_providers: 6,
    verified_receipts_count: 1248,
    detected_out_of_band_txs_7d: 58,
    average_acceleration_inclusion_blocks: 1.4,
    recent_anomalies: [
      {
        txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
        block_height: 864195,
        fee_rate_sat_vb: 3.2,
        block_median_fee_rate: 18.5,
        inclusion_type: 'out_of_band_fee',
        miner_pool: 'Foundry USA',
        severity: 'high',
      },
    ],
  },
  'POST /api/v1/intelligence/submission/diagnose': {
    fee_rate_sat_vb: 4.5,
    recommended_fee_rate_sat_vb: 16.0,
    rbf_signaling: true,
    estimated_delay_blocks: 12,
    recommended_strategy: 'CPFP or Out-of-Band Acceleration',
  },
  'POST /api/v1/intelligence/submission/private': {
    submission_token: 'sub-tok-mock-12345',
    txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
    target_miners: ['Foundry USA', 'AntPool', 'F2Pool'],
    status: 'relayed_to_pools',
  },
  'GET /api/v1/intelligence/accelerators/providers': [
    { provider_id: 'mempool-accelerate', name: 'Mempool Accelerator', hashrate_coverage_pct: 65.4, supported_pools: ['Foundry USA', 'AntPool'], minimum_fee_usd: 5.0, status: 'online', success_rate_pct: 99.4 },
  ],
  'GET /api/v1/intelligence/accelerators/providers/mempool-accelerate': {
    provider_id: 'mempool-accelerate',
    name: 'Mempool Accelerator',
    hashrate_coverage_pct: 65.4,
    supported_pools: ['Foundry USA', 'AntPool'],
    minimum_fee_usd: 5.0,
    status: 'online',
    success_rate_pct: 99.4,
    api_endpoint: 'https://mempool.space/api/v1/accelerator',
    verification_format: 'ed25519_signed_receipt',
  },
  'POST /api/v1/intelligence/accelerators/receipts/verify': {
    verified: true,
    provider_id: 'mempool-accelerate',
    receipt_id: 'rcpt-984210',
    txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
    amount_paid_sats: 15000,
    signed_timestamp: '2026-09-04T15:20:00Z',
  },
  'GET /api/v1/intelligence/ordering/transactions/9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678': {
    txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
    block_height: 864195,
    block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
    position_in_block: 4,
    fee_rate_sat_vb: 3.2,
    expected_position_by_feerate: 3410,
    ordering_discrepancy_score: 98.4,
    classification: 'out_of_band_accelerated',
    miner_pool: 'Foundry USA',
  },
  'GET /api/v1/intelligence/ordering/blocks/00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3': {
    block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
    height: 864195,
    miner: 'Foundry USA',
    total_txs: 3892,
    out_of_order_tx_count: 5,
    mev_or_acceleration_revenue_est_sats: 450000,
    anomalous_txs: [
      { txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678', actual_index: 4, fee_rate: 3.2, median_fee_rate: 18.5 },
    ],
  },
  'GET /api/v1/intelligence/ordering/findings': [
    {
      txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
      block_height: 864195,
      fee_rate_sat_vb: 3.2,
      block_median_fee_rate: 18.5,
      inclusion_type: 'out_of_band_fee',
      miner_pool: 'Foundry USA',
      severity: 'high',
    },
  ],

  // 6. OpenTimestamps
  'GET /api/v1/intelligence/timestamps/overview': {
    total_proofs_tracked: 284910,
    bitcoin_confirmed_proofs: 283100,
    pending_calendar_attestations: 1810,
    active_calendar_servers: 4,
    latest_anchored_block_height: 864201,
    recent_anchors: [
      {
        batch_id: 'ots-batch-864201',
        block_height: 864201,
        block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        merkle_root: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        leaf_count: 4892,
        calendar_server: 'https://alice.btc.calendar.opentimestamps.org',
        anchored_at: '2026-09-04T16:00:00Z',
      },
    ],
  },
  'GET /api/v1/intelligence/timestamps/calendars': [
    { calendar_id: 'alice', url: 'https://alice.btc.calendar.opentimestamps.org', status: 'online', pending_commitments: 412, last_btc_block_anchored: 864201, uptime_pct: 99.98 },
  ],
  'GET /api/v1/intelligence/timestamps/anchors': [
    { batch_id: 'ots-batch-864201', block_height: 864201, leaf_count: 4892, merkle_root: 'e3b0...b855', anchored_at: '2026-09-04T16:00:00Z' },
  ],
  'POST /api/v1/intelligence/timestamps/digests/stamp': {
    status: 'stamped_pending_block',
    calendars_contacted: ['https://alice.btc.calendar.opentimestamps.org'],
    ots_proof_base64: 'BAAAAAAAb3Rz...',
    timestamp: '2026-09-04T16:00:00Z',
  },
  'POST /api/v1/intelligence/timestamps/proofs/verify': {
    valid: true,
    bitcoin_block_height: 864201,
    bitcoin_block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
    bitcoin_block_time: '2026-09-04T16:05:12Z',
    proof_operations_count: 14,
    attestation_type: 'BitcoinBlockHeaderAttestation',
  },
  'POST /api/v1/intelligence/timestamps/proofs/upgrade': {
    upgraded: true,
    anchored_height: 864201,
  },

  // 7. Consensus Conformance
  'GET /api/v1/intelligence/consensus-conformance/overview': {
    total_conformance_tests: 18450,
    passing_conformance_tests: 18448,
    divergent_test_cases: 2,
    active_implementations_count: 5,
    formal_theorems_verified: 42,
    total_fuzz_executions_24h: 12500000,
    implementations: [
      { id: 'bitcoin-core', name: 'Bitcoin Core v28.0', language: 'C++', conformance_pct: 100.0, status: 'reference' },
      { id: 'btcd', name: 'btcd v0.24.2', language: 'Go', conformance_pct: 99.98, status: 'active' },
    ],
    recent_divergences: [
      { case_id: 'case-div-tapscript-sigops-01', title: 'Tapscript Annex Signature Operations Counting', bip_reference: 'BIP 342', severity: 'critical', affected_implementations: ['bcoin', 'btcd'] },
    ],
  },
  'GET /api/v1/intelligence/consensus-conformance/implementations': [
    { id: 'bitcoin-core', name: 'Bitcoin Core v28.0', language: 'C++', conformance_pct: 100.0, status: 'reference' },
    { id: 'btcd', name: 'btcd v0.24.2', language: 'Go', conformance_pct: 99.98, status: 'active' },
  ],
  'GET /api/v1/intelligence/consensus-conformance/cases': [
    { case_id: 'case-div-tapscript-sigops-01', title: 'Tapscript Annex Signature Operations Counting', bip_reference: 'BIP 342', severity: 'critical', affected_implementations: ['bcoin', 'btcd'] },
  ],
  'GET /api/v1/intelligence/consensus-conformance/cases/case-div-tapscript-sigops-01': {
    case_id: 'case-div-tapscript-sigops-01',
    title: 'Tapscript Annex Signature Operations Counting',
    bip_reference: 'BIP 342',
    severity: 'critical',
    raw_tx: '020000000001015f8a...',
    affected_implementations: ['bcoin', 'btcd'],
    results: [
      { impl: 'Bitcoin Core v28.0', outcome: 'VALID', exit_code: 0, execution_ms: 1.2 },
      { impl: 'btcd v0.24.2', outcome: 'INVALID_ANNEX_FORMAT', exit_code: 1, execution_ms: 2.1 },
    ],
  },
  'POST /api/v1/intelligence/consensus-conformance/cases/case-div-tapscript-sigops-01/replay': {
    case_id: 'case-div-tapscript-sigops-01',
    replay_status: 'completed',
    reproduced_divergence: true,
  },
  'GET /api/v1/intelligence/consensus-conformance/formal-artifacts': [
    { spec_id: 'spec-taproot-bip341', name: 'Taproot Key Path & Script Path Specification', prover: 'Coq / Rocq', theorems_count: 18, verified: true, mathematical_invariants: 'Key aggregation safety' },
  ],

  // 8. Node Security
  'GET /api/v1/intelligence/node-security/overview': {
    total_fleet_nodes: 128,
    secure_nodes_count: 114,
    vulnerable_nodes_count: 14,
    active_advisories_count: 3,
    eol_versions_detected: 6,
    guix_verified_artifacts_count: 48,
    critical_advisories: [
      { advisory_id: 'ADV-2026-001', title: 'Remote Crash via Malformed Compact Block Announcements', cve_id: 'CVE-2026-30491', severity: 'critical', affected_versions: ['v24.0 - v26.1'], fixed_version: 'v27.0+' },
    ],
    fleet_summary: [
      { node_id: 'node-prod-eu-01', client_name: 'Bitcoin Core', version: 'v28.0', status: 'secure', ip_anonymized: '185.190.xxx.xxx', vulnerabilities_count: 0 },
    ],
  },
  'GET /api/v1/intelligence/node-security/fleet': [
    { node_id: 'node-prod-eu-01', client_name: 'Bitcoin Core', version: 'v28.0', status: 'secure', ip_anonymized: '185.190.xxx.xxx', vulnerabilities_count: 0 },
  ],
  'GET /api/v1/intelligence/node-security/nodes/node-prod-eu-01': {
    node_id: 'node-prod-eu-01',
    client_name: 'Bitcoin Core',
    version: 'v28.0',
    status: 'secure',
    network: 'mainnet',
    uptime_days: 142,
    unpatched_cves: [],
    rpc_auth_type: 'cookie',
    tor_enabled: true,
  },
  'GET /api/v1/intelligence/node-security/advisories': [
    { advisory_id: 'ADV-2026-001', title: 'Remote Crash via Malformed Compact Block Announcements', cve_id: 'CVE-2026-30491', severity: 'critical', affected_versions: ['v24.0 - v26.1'], fixed_version: 'v27.0+' },
  ],
  'GET /api/v1/intelligence/node-security/advisories/ADV-2026-001': {
    advisory_id: 'ADV-2026-001',
    title: 'Remote Crash via Malformed Compact Block Announcements',
    cve_id: 'CVE-2026-30491',
    severity: 'critical',
    affected_versions: ['v24.0 - v26.1'],
    fixed_version: 'v27.0+',
    description: 'Specially crafted compact block filter message causes unhandled memory fault in legacy p2p parser.',
    remediation_steps: 'Upgrade immediately to Bitcoin Core v27.0 or v28.0.',
    published_at: '2026-08-15',
  },
  'GET /api/v1/intelligence/node-security/releases': [
    { version: 'v28.0', release_date: '2026-08-01', support_status: 'current', eol_date: '2028-08-01', guix_reproduced: true },
  ],
  'GET /api/v1/intelligence/node-security/artifacts': [
    { release: 'v28.0', filename: 'bitcoin-28.0-x86_64-linux-gnu.tar.gz', sha256: '9a8b...9a8b', guix_attestations_count: 24, reproducibility_status: '100% Bit-for-Bit Verified' },
  ],
  'POST /api/v1/intelligence/node-security/artifacts/verify': {
    verified: true,
    sha256_match: true,
    guix_attestations_valid: 24,
  },
  'POST /api/v1/intelligence/node-security/upgrade-plans': {
    plan_id: 'plan-upg-001',
    target_version: 'v28.0',
    affected_nodes_count: 14,
    steps: ['Verify cryptographic Guix hashes', 'Restart service with systemd watchdog verification'],
  },

  // 9. Collaborative Privacy
  'GET /api/v1/intelligence/collaborative/overview': {
    total_collaborative_txs_24h: 184,
    total_volume_btc_24h: 412.5,
    active_coordinators_count: 5,
    average_anonymity_set: 48.2,
    active_fidelity_bonds_btc: 850.4,
    recent_rounds: [
      {
        round_id: 'rnd-ws-864198-01',
        protocol: 'WabiSabi',
        coordinator: 'Wasabi Backend Official',
        block_height: 864198,
        inputs_count: 85,
        outputs_count: 92,
        anonymity_set: 64,
        total_btc: 48.2,
      },
    ],
  },
  'GET /api/v1/intelligence/collaborative/protocols': [
    { id: 'wabisabi', name: 'WabiSabi', denomination_type: 'Arbitrary Amounts', coordinator_model: 'Centralized blinded credentials', active_rounds: 3 },
  ],
  'GET /api/v1/intelligence/collaborative/coordinators': [
    { coordinator_id: 'wasabi-main', name: 'Wasabi Coordinator', protocol: 'WabiSabi', fee_rate_pct: 0.3, onion_endpoint: 'wasabi...onion', status: 'online' },
  ],
  'GET /api/v1/intelligence/collaborative/rounds': [
    { round_id: 'rnd-ws-864198-01', protocol: 'WabiSabi', coordinator: 'Wasabi Backend Official', inputs_count: 85, outputs_count: 92, anonymity_set: 64, total_btc: 48.2 },
  ],
  'GET /api/v1/intelligence/collaborative/rounds/rnd-ws-864198-01': {
    round_id: 'rnd-ws-864198-01',
    protocol: 'WabiSabi',
    coordinator: 'Wasabi Backend Official',
    block_height: 864198,
    txid: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    inputs_count: 85,
    outputs_count: 92,
    anonymity_set: 64,
    total_btc: 48.2,
    entropy_bits: 8.92,
    fee_rate_sat_vb: 14.5,
    timestamp: '2026-09-04T16:10:00Z',
  },
  'GET /api/v1/intelligence/collaborative/fidelity-bonds': [
    { bond_id: 'bond-jm-001', maker_pubkey: '023a8b...7f', amount_btc: 25.0, lock_expiry_block: 920000, fidelity_score: 9450000, status: 'locked' },
  ],
  'POST /api/v1/intelligence/collaborative/public-packages/verify': {
    verified: true,
    protocol: 'WabiSabi',
    entropy_score: 9.1,
    equal_output_clusters: 4,
    deanonymization_vulnerabilities: [],
  },
};
