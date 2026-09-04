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
};
