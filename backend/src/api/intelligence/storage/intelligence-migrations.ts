export const INTELLIGENCE_SCHEMA_QUERIES: string[] = [
  `CREATE TABLE IF NOT EXISTS intelligence_events (
    event_id VARCHAR(64) NOT NULL PRIMARY KEY,
    schema_version VARCHAR(16) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    network VARCHAR(32) NOT NULL,
    source_id VARCHAR(64) NOT NULL,
    source_sequence BIGINT UNSIGNED NOT NULL,
    observed_at DATETIME(6) NOT NULL,
    ingested_at DATETIME(6) NOT NULL,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    INDEX idx_int_events_net_type (network, event_type),
    INDEX idx_int_events_entity (entity_type, entity_id),
    INDEX idx_int_events_observed (observed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS intelligence_checkpoints (
    checkpoint_id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    block_height INT UNSIGNED NOT NULL,
    block_hash VARCHAR(64) NOT NULL,
    timestamp_utc DATETIME NOT NULL,
    tx_count INT UNSIGNED NOT NULL,
    total_weight BIGINT UNSIGNED NOT NULL,
    total_fee_sats BIGINT UNSIGNED NOT NULL,
    state_hash VARCHAR(64) NOT NULL,
    manifest_checksum VARCHAR(64) NOT NULL,
    INDEX idx_int_chk_net_height (network, block_height),
    INDEX idx_int_chk_hash (block_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS intelligence_node_policy_profile (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    node_version VARCHAR(64) NOT NULL,
    subversion VARCHAR(64) NOT NULL,
    full_rbf TINYINT(1) NOT NULL DEFAULT 1,
    incremental_relay_fee INT UNSIGNED NOT NULL DEFAULT 1000,
    min_relay_tx_fee INT UNSIGNED NOT NULL DEFAULT 1000,
    max_mempool_mb INT UNSIGNED NOT NULL DEFAULT 300,
    limits_json JSON NOT NULL,
    probed_at DATETIME NOT NULL,
    INDEX idx_int_node_prof_net (network)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS intelligence_policy_evaluation (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    input_hash VARCHAR(64) NOT NULL,
    txid VARCHAR(64) NOT NULL,
    wtxid VARCHAR(64) NULL,
    network VARCHAR(32) NOT NULL,
    node_version VARCHAR(64) NOT NULL,
    allowed TINYINT(1) NOT NULL,
    reject_reason VARCHAR(128) NULL,
    consensus_valid TINYINT(1) NOT NULL,
    relay_valid TINYINT(1) NOT NULL,
    package_valid TINYINT(1) NOT NULL,
    fee_sats BIGINT UNSIGNED NOT NULL,
    vsize INT UNSIGNED NOT NULL,
    weight INT UNSIGNED NOT NULL,
    effective_feerate DECIMAL(10, 2) NOT NULL,
    details_json JSON NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_int_pol_eval_txid (txid),
    INDEX idx_int_pol_eval_hash (input_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS intelligence_forecast_model (
    version VARCHAR(32) NOT NULL PRIMARY KEY,
    algorithm VARCHAR(64) NOT NULL,
    training_interval VARCHAR(64) NOT NULL,
    feature_schema JSON NOT NULL,
    brier_score DECIMAL(8, 5) NOT NULL,
    calibration_error DECIMAL(8, 5) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS intelligence_forecast_outcome (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    txid VARCHAR(64) NOT NULL,
    model_version VARCHAR(32) NOT NULL,
    p_next_block DECIMAL(6, 5) NOT NULL,
    p_2_blocks DECIMAL(6, 5) NOT NULL,
    p_3_blocks DECIMAL(6, 5) NOT NULL,
    p_6_blocks DECIMAL(6, 5) NOT NULL,
    p_12_blocks DECIMAL(6, 5) NOT NULL,
    p_24_blocks DECIMAL(6, 5) NOT NULL,
    confidence_low DECIMAL(6, 5) NOT NULL,
    confidence_high DECIMAL(6, 5) NOT NULL,
    verified_block_height INT UNSIGNED NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_int_fc_txid (txid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS relay_sensor (
    sensor_id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    region VARCHAR(64) NOT NULL,
    software VARCHAR(64) NOT NULL,
    version VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    clock_offset_ms INT NOT NULL DEFAULT 0,
    clock_uncertainty_ms INT NOT NULL DEFAULT 1,
    last_heartbeat DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS relay_observation (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    txid VARCHAR(64) NOT NULL,
    sensor_id VARCHAR(64) NOT NULL,
    first_seen_utc DATETIME(6) NOT NULL,
    delta_from_first_ms INT NOT NULL,
    accepted TINYINT(1) NOT NULL,
    transport_type VARCHAR(32) NOT NULL DEFAULT 'legacy',
    bip324 TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_relay_obs_txid (txid),
    INDEX idx_relay_obs_sensor (sensor_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS template_observation (
    template_id VARCHAR(64) NOT NULL PRIMARY KEY,
    source_id VARCHAR(64) NOT NULL,
    height INT UNSIGNED NOT NULL,
    prev_block_hash VARCHAR(64) NOT NULL,
    tx_count INT UNSIGNED NOT NULL,
    total_weight BIGINT UNSIGNED NOT NULL,
    total_fees_sats BIGINT UNSIGNED NOT NULL,
    fingerprint_hash VARCHAR(64) NOT NULL,
    observed_at DATETIME NOT NULL,
    INDEX idx_tmpl_height (height),
    INDEX idx_tmpl_fp (fingerprint_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS utxo_rollup_checkpoint (
    height INT UNSIGNED NOT NULL,
    network VARCHAR(32) NOT NULL,
    block_hash VARCHAR(64) NOT NULL,
    total_utxos BIGINT UNSIGNED NOT NULL,
    total_amount_sats BIGINT UNSIGNED NOT NULL,
    script_cohorts_json JSON NOT NULL,
    age_cohorts_json JSON NOT NULL,
    value_cohorts_json JSON NOT NULL,
    reconciled TINYINT(1) NOT NULL DEFAULT 0,
    reconciled_at DATETIME NOT NULL,
    PRIMARY KEY (network, height),
    INDEX idx_utxo_chk_hash (block_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS graph_saved_cases (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(128) NOT NULL,
    root_entity VARCHAR(128) NOT NULL,
    filters_json JSON NOT NULL,
    layout_json JSON NOT NULL,
    is_shared TINYINT(1) NOT NULL DEFAULT 0,
    share_token VARCHAR(64) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_graph_user (user_id),
    INDEX idx_graph_share (share_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS chain_incident (
    incident_id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    incident_type VARCHAR(64) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    start_height INT UNSIGNED NOT NULL,
    end_height INT UNSIGNED NULL,
    start_time_utc DATETIME NOT NULL,
    resolved_time_utc DATETIME NULL,
    status VARCHAR(32) NOT NULL,
    summary VARCHAR(255) NOT NULL,
    details_json JSON NOT NULL,
    INDEX idx_inc_net_status (network, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS proof_bundle (
    proof_id VARCHAR(64) NOT NULL PRIMARY KEY,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    network VARCHAR(32) NOT NULL,
    block_hash VARCHAR(64) NOT NULL,
    merkle_root VARCHAR(64) NOT NULL,
    attestation_signature VARCHAR(128) NOT NULL,
    manifest_json JSON NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_proof_entity (entity_type, entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS developer_api_keys (
    key_id VARCHAR(64) NOT NULL PRIMARY KEY,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    owner_id VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    scopes_json JSON NOT NULL,
    rate_limit INT UNSIGNED NOT NULL DEFAULT 1000,
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    last_used_at DATETIME NULL,
    revoked TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_dev_key_prefix (key_prefix),
    INDEX idx_dev_key_owner (owner_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS developer_webhooks (
    webhook_id VARCHAR(64) NOT NULL PRIMARY KEY,
    owner_id VARCHAR(64) NOT NULL,
    url VARCHAR(512) NOT NULL,
    secret VARCHAR(64) NOT NULL,
    event_filters_json JSON NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_dev_wh_owner (owner_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS user_watchlists (
    watchlist_id VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    rules_json JSON NOT NULL,
    delivery_channels_json JSON NOT NULL,
    mode VARCHAR(32) NOT NULL DEFAULT 'local',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_wl_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS knowledge_subject (
    subject_id VARCHAR(64) NOT NULL PRIMARY KEY,
    subject_type VARCHAR(32) NOT NULL,
    identifier VARCHAR(128) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uq_know_subj (subject_type, identifier)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS knowledge_claim (
    claim_id VARCHAR(64) NOT NULL PRIMARY KEY,
    subject_id VARCHAR(64) NOT NULL,
    namespace VARCHAR(64) NOT NULL,
    claim_type VARCHAR(64) NOT NULL,
    label_value VARCHAR(255) NOT NULL,
    evidence_hash VARCHAR(64) NOT NULL,
    confidence DECIMAL(5, 4) NOT NULL DEFAULT 1.0,
    status VARCHAR(32) NOT NULL DEFAULT 'verified',
    superseded_by VARCHAR(64) NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_know_claim_subj (subject_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS knowledge_evidence (
    evidence_id VARCHAR(64) NOT NULL PRIMARY KEY,
    claim_id VARCHAR(64) NOT NULL,
    evidence_type VARCHAR(64) NOT NULL,
    evidence_data_json JSON NOT NULL,
    evidence_hash VARCHAR(64) NOT NULL,
    submitter VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_know_ev_claim (claim_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS protocol_registry (
    protocol_id VARCHAR(64) NOT NULL PRIMARY KEY,
    display_name VARCHAR(128) NOT NULL,
    version VARCHAR(32) NOT NULL,
    schema_version VARCHAR(16) NOT NULL,
    capabilities_json JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS global_network_sensor (
    sensor_id VARCHAR(64) NOT NULL PRIMARY KEY,
    region VARCHAR(64) NOT NULL,
    asn INT UNSIGNED NULL,
    software_version VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    v1_supported TINYINT(1) NOT NULL DEFAULT 1,
    v2_bip324_supported TINYINT(1) NOT NULL DEFAULT 1,
    addrv2_bip155_supported TINYINT(1) NOT NULL DEFAULT 1,
    last_probe_utc DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS global_network_crawl_epoch (
    epoch_id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    started_at DATETIME NOT NULL,
    completed_at DATETIME NULL,
    discovered_nodes INT UNSIGNED NOT NULL DEFAULT 0,
    reachable_nodes INT UNSIGNED NOT NULL DEFAULT 0,
    v2_nodes INT UNSIGNED NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    INDEX idx_gne_net_started (network, started_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS global_network_observation (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    epoch_id VARCHAR(64) NOT NULL,
    endpoint_id VARCHAR(128) NOT NULL,
    ip_or_onion VARCHAR(128) NOT NULL,
    port INT UNSIGNED NOT NULL,
    services BIGINT UNSIGNED NOT NULL,
    user_agent VARCHAR(128) NOT NULL,
    start_height INT UNSIGNED NOT NULL,
    relay TINYINT(1) NOT NULL DEFAULT 1,
    transport_v2 TINYINT(1) NOT NULL DEFAULT 0,
    addrv2 TINYINT(1) NOT NULL DEFAULT 0,
    latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
    observed_at DATETIME NOT NULL,
    INDEX idx_gno_epoch (epoch_id),
    INDEX idx_gno_endpoint (endpoint_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS global_network_dns_seed (
    seed_id VARCHAR(64) NOT NULL PRIMARY KEY,
    hostname VARCHAR(255) NOT NULL,
    maintainer VARCHAR(128) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    last_query_at DATETIME NULL,
    discovered_addrs_count INT UNSIGNED NOT NULL DEFAULT 0,
    reachable_ratio DECIMAL(5, 4) NOT NULL DEFAULT 0.0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS global_network_self_check (
    check_id VARCHAR(64) NOT NULL PRIMARY KEY,
    endpoint_address VARCHAR(255) NOT NULL,
    port INT UNSIGNED NOT NULL,
    probed_from_region VARCHAR(64) NOT NULL,
    reachable TINYINT(1) NOT NULL,
    bip324_handshake TINYINT(1) NOT NULL,
    latency_ms INT UNSIGNED NOT NULL,
    user_agent VARCHAR(128) NULL,
    probed_at DATETIME NOT NULL,
    INDEX idx_gnsc_endpoint (endpoint_address)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS global_network_snapshot (
    snapshot_id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    block_height INT UNSIGNED NOT NULL,
    timestamp_utc DATETIME NOT NULL,
    total_nodes INT UNSIGNED NOT NULL,
    v2_percentage DECIMAL(5, 2) NOT NULL,
    top_asns_json JSON NOT NULL,
    top_clients_json JSON NOT NULL,
    geo_distribution_json JSON NOT NULL,
    s3_path VARCHAR(255) NULL,
    INDEX idx_gns_net_time (network, timestamp_utc)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS lightning_reliability_probe (
    probe_id VARCHAR(64) NOT NULL PRIMARY KEY,
    node_pubkey VARCHAR(66) NOT NULL,
    sensor_region VARCHAR(64) NOT NULL,
    handshake_success TINYINT(1) NOT NULL,
    latency_ms INT UNSIGNED NOT NULL,
    features_hex TEXT NULL,
    lsps_supported_json JSON NOT NULL,
    observed_at DATETIME NOT NULL,
    INDEX idx_lrp_pubkey (node_pubkey),
    INDEX idx_lrp_obs (observed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS lightning_channel_lifecycle (
    channel_id VARCHAR(64) NOT NULL PRIMARY KEY,
    short_channel_id VARCHAR(32) NULL,
    funding_txid VARCHAR(64) NOT NULL,
    funding_vout INT UNSIGNED NOT NULL,
    node1_pubkey VARCHAR(66) NOT NULL,
    node2_pubkey VARCHAR(66) NOT NULL,
    capacity_sats BIGINT UNSIGNED NOT NULL,
    opened_height INT UNSIGNED NOT NULL,
    closed_height INT UNSIGNED NULL,
    closure_txid VARCHAR(64) NULL,
    closure_type VARCHAR(32) NULL,
    INDEX idx_lcl_nodes (node1_pubkey, node2_pubkey),
    INDEX idx_lcl_funding (funding_txid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS lightning_lsp_provider (
    provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    node_pubkey VARCHAR(66) NOT NULL,
    endpoint_url VARCHAR(255) NULL,
    lsps0_supported TINYINT(1) NOT NULL DEFAULT 1,
    lsps1_order_supported TINYINT(1) NOT NULL DEFAULT 0,
    lsps2_jit_supported TINYINT(1) NOT NULL DEFAULT 0,
    lsps5_metrics_supported TINYINT(1) NOT NULL DEFAULT 0,
    specs_json JSON NOT NULL,
    updated_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS silent_payment_block_manifest (
    height INT UNSIGNED NOT NULL PRIMARY KEY,
    block_hash VARCHAR(64) NOT NULL,
    num_inputs INT UNSIGNED NOT NULL,
    num_sp_outputs INT UNSIGNED NOT NULL,
    tweaks_hash VARCHAR(64) NOT NULL,
    bundle_s3_url VARCHAR(255) NULL,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS payjoin_directory (
    directory_id VARCHAR(64) NOT NULL PRIMARY KEY,
    url VARCHAR(255) NOT NULL,
    ohttp_key_hash VARCHAR(64) NOT NULL,
    bip77_supported TINYINT(1) NOT NULL DEFAULT 0,
    bip78_supported TINYINT(1) NOT NULL DEFAULT 1,
    latency_ms INT UNSIGNED NOT NULL,
    last_tested_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS cashu_mint (
    mint_id VARCHAR(64) NOT NULL PRIMARY KEY,
    mint_url VARCHAR(255) NOT NULL,
    name VARCHAR(128) NOT NULL,
    nuts_supported_json JSON NOT NULL,
    active_keysets_count INT UNSIGNED NOT NULL DEFAULT 1,
    last_heartbeat DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS fedimint_federation (
    federation_id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    guardians_count INT UNSIGNED NOT NULL,
    threshold INT UNSIGNED NOT NULL,
    invite_code_sample VARCHAR(512) NULL,
    modules_json JSON NOT NULL,
    current_epoch INT UNSIGNED NOT NULL DEFAULT 0,
    last_epoch_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS consensus_proposal (
    proposal_id VARCHAR(64) NOT NULL PRIMARY KEY,
    bip_number INT UNSIGNED NULL,
    title VARCHAR(128) NOT NULL,
    author VARCHAR(128) NOT NULL,
    proposal_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    covenant_type VARCHAR(64) NOT NULL,
    activation_mechanism VARCHAR(64) NOT NULL,
    spec_url VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS quantum_pubkey_exposure (
    outpoint VARCHAR(70) NOT NULL PRIMARY KEY,
    txid VARCHAR(64) NOT NULL,
    vout INT UNSIGNED NOT NULL,
    amount_sats BIGINT UNSIGNED NOT NULL,
    script_type VARCHAR(32) NOT NULL,
    is_exposed TINYINT(1) NOT NULL,
    exposure_reason VARCHAR(64) NOT NULL,
    first_exposed_height INT UNSIGNED NULL,
    INDEX idx_qpe_exposed (is_exposed)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS blockspace_regime_event (
    regime_id VARCHAR(64) NOT NULL PRIMARY KEY,
    network VARCHAR(32) NOT NULL,
    start_height INT UNSIGNED NOT NULL,
    end_height INT UNSIGNED NULL,
    regime_type VARCHAR(64) NOT NULL,
    median_feerate DECIMAL(8, 2) NOT NULL,
    primary_demand_driver VARCHAR(64) NOT NULL,
    detected_at DATETIME NOT NULL,
    INDEX idx_bre_net (network, start_height)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS reserve_proof_package (
    package_id VARCHAR(64) NOT NULL PRIMARY KEY,
    provider_id VARCHAR(64) NOT NULL,
    snapshot_height INT UNSIGNED NOT NULL,
    total_assets_sats BIGINT UNSIGNED NOT NULL,
    total_liabilities_sats BIGINT UNSIGNED NOT NULL,
    solvency_ratio DECIMAL(6, 4) NOT NULL,
    bip127_proofs_count INT UNSIGNED NOT NULL,
    merkle_root VARCHAR(64) NOT NULL,
    published_at DATETIME NOT NULL,
    INDEX idx_rpp_prov (provider_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
];
