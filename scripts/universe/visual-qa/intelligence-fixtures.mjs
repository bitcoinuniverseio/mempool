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
};
