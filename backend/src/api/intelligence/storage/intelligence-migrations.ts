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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
];
