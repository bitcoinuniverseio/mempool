import {
  BlockPropagationOverview,
  BlockPropagationObservation,
  CompactBlockDetail,
  ForkRaceRecord,
  PropagationSensor,
  FibreObservation,
} from './block-propagation.models';

export class BlockPropagationService {
  private sensors: PropagationSensor[] = [
    {
      sensor_id: 'sensor-us-east-ashburn',
      sensor_name: 'Ashburn Primary Sensor',
      region: 'us-east',
      software: 'Bitcoin Core',
      software_version: '28.0',
      clock_offset_ms: 2.1,
      clock_uncertainty_ms: 0.8,
      bip152_mode: 'high_bandwidth',
      bip152_version: 2,
      health_status: 'healthy',
      last_heartbeat: '2026-09-04T17:59:00Z',
    },
    {
      sensor_id: 'sensor-eu-central-frankfurt',
      sensor_name: 'Frankfurt Backbone Sensor',
      region: 'eu-central',
      software: 'Bitcoin Core',
      software_version: '28.0',
      clock_offset_ms: -1.4,
      clock_uncertainty_ms: 0.6,
      bip152_mode: 'high_bandwidth',
      bip152_version: 2,
      health_status: 'healthy',
      last_heartbeat: '2026-09-04T17:59:00Z',
    },
    {
      sensor_id: 'sensor-ap-southeast-singapore',
      sensor_name: 'Singapore Gateway Sensor',
      region: 'ap-southeast',
      software: 'Bitcoin Core',
      software_version: '28.0',
      clock_offset_ms: 4.8,
      clock_uncertainty_ms: 1.2,
      bip152_mode: 'low_bandwidth',
      bip152_version: 2,
      health_status: 'healthy',
      last_heartbeat: '2026-09-04T17:58:30Z',
    },
  ];

  private blocks: BlockPropagationObservation[] = [
    {
      block_hash: '00000000000000000001f3e2b1a09876543210fedcba9876543210fedcba9876',
      height: 864210,
      previous_block_hash: '00000000000000000002e4d3c2b1a09876543210fedcba9876543210fedcba9875',
      timestamp_utc: '2026-09-04T17:42:00Z',
      block_size_bytes: 1542890,
      tx_count: 2842,
      time_to_25_pct_sensors_ms: 85,
      time_to_50_pct_sensors_ms: 145,
      time_to_75_pct_sensors_ms: 220,
      time_to_90_pct_sensors_ms: 380,
      time_to_100_pct_sensors_ms: 540,
      header_first_propagation_ms: 65,
      compact_block_propagation_ms: 145,
      average_reconstruction_duration_ms: 18,
      average_validation_duration_ms: 92,
      average_connection_duration_ms: 12,
      fallback_to_full_block_count: 0,
      short_id_collision_count: 0,
      missing_transaction_ratio: 0.002,
      sensor_observations: [
        {
          sensor_id: 'sensor-us-east-ashburn',
          region: 'us-east',
          relay_mechanism: 'bip152_high_bandwidth',
          stages: {
            header_first_seen_ms: 12,
            cmpctblock_first_seen_ms: 45,
            reconstruction_started_ms: 46,
            reconstruction_complete_ms: 62,
            validation_started_ms: 63,
            validation_complete_ms: 152,
            block_connected_ms: 164,
          },
        },
        {
          sensor_id: 'sensor-eu-central-frankfurt',
          region: 'eu-central',
          relay_mechanism: 'bip152_high_bandwidth',
          stages: {
            header_first_seen_ms: 38,
            cmpctblock_first_seen_ms: 95,
            reconstruction_started_ms: 96,
            reconstruction_complete_ms: 114,
            validation_started_ms: 115,
            validation_complete_ms: 204,
            block_connected_ms: 216,
          },
        },
      ],
    },
    {
      block_hash: '00000000000000000002e4d3c2b1a09876543210fedcba9876543210fedcba9875',
      height: 864209,
      previous_block_hash: '00000000000000000003d5c4b3a291876543210fedcba9876543210fedcba9874',
      timestamp_utc: '2026-09-04T17:28:00Z',
      block_size_bytes: 1621450,
      tx_count: 3120,
      time_to_25_pct_sensors_ms: 92,
      time_to_50_pct_sensors_ms: 160,
      time_to_75_pct_sensors_ms: 245,
      time_to_90_pct_sensors_ms: 410,
      time_to_100_pct_sensors_ms: 590,
      header_first_propagation_ms: 70,
      compact_block_propagation_ms: 160,
      average_reconstruction_duration_ms: 24,
      average_validation_duration_ms: 104,
      average_connection_duration_ms: 15,
      fallback_to_full_block_count: 0,
      short_id_collision_count: 1,
      missing_transaction_ratio: 0.005,
      sensor_observations: [],
    },
  ];

  private compactBlocks: CompactBlockDetail[] = [
    {
      block_hash: '00000000000000000001f3e2b1a09876543210fedcba9876543210fedcba9876',
      height: 864210,
      bip152_version: 2,
      prefilled_tx_count: 1,
      short_id_count: 2841,
      missing_tx_count: 3,
      collision_count: 0,
      reconstruction_success: true,
      merkle_root_verified: true,
      witness_commitment_verified: true,
      full_block_fallback: false,
    },
    {
      block_hash: '00000000000000000002e4d3c2b1a09876543210fedcba9876543210fedcba9875',
      height: 864209,
      bip152_version: 2,
      prefilled_tx_count: 1,
      short_id_count: 3119,
      missing_tx_count: 8,
      collision_count: 1,
      reconstruction_success: true,
      merkle_root_verified: true,
      witness_commitment_verified: true,
      full_block_fallback: false,
    },
  ];

  private forkRaces: ForkRaceRecord[] = [
    {
      race_id: 'race-864195-fork',
      divergence_height: 864195,
      discovered_at_utc: '2026-09-04T15:10:00Z',
      resolved_at_utc: '2026-09-04T15:18:30Z',
      resolution_status: 'resolved_to_most_work',
      winning_tip_hash: '00000000000000000004a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc',
      branches: [
        {
          branch_id: 'branch-a',
          tip_block_hash: '00000000000000000004a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc',
          tip_height: 864196,
          first_observed_sensor_id: 'sensor-us-east-ashburn',
          first_observed_utc: '2026-09-04T15:10:02Z',
          block_count: 2,
          accumulated_work: '1.248e24',
          status: 'resolved_to_most_work',
          mined_by_pool: 'Foundry USA',
          tx_divergence_count: 14,
        },
        {
          branch_id: 'branch-b',
          tip_block_hash: '00000000000000000005b6f2f5cbba9a04b43629b99d42cd980729087784f3dd',
          tip_height: 864195,
          first_observed_sensor_id: 'sensor-eu-central-frankfurt',
          first_observed_utc: '2026-09-04T15:10:04Z',
          block_count: 1,
          accumulated_work: '1.247e24',
          status: 'valid_stale_branch',
          mined_by_pool: 'AntPool',
          tx_divergence_count: 14,
        },
      ],
      staletip_negotiated_via_bip434: true,
      notes: [
        'Competing valid block observed within 2 seconds across sensors.',
        'Branch A accumulated heavier proof of work at height 864196, cleanly resolving the race.',
      ],
    },
  ];

  private fibres: FibreObservation[] = [
    {
      block_hash: '00000000000000000001f3e2b1a09876543210fedcba9876543210fedcba9876',
      height: 864210,
      fibre_delivery_time_ms: 32,
      bip152_delivery_time_ms: 145,
      chunk_count: 120,
      chunk_loss_pct: 0.8,
      fec_recovery_succeeded: true,
      time_saved_ms: 113,
    },
  ];

  public getOverview(): BlockPropagationOverview {
    return {
      latest_block_hash: this.blocks[0].block_hash,
      latest_block_height: this.blocks[0].height,
      average_propagation_time_50_pct_ms: 152,
      average_propagation_time_90_pct_ms: 395,
      reconstruction_success_rate_pct: 100.0,
      active_sensors_count: this.sensors.length,
      recent_fork_races_count: this.forkRaces.length,
      sensors: this.sensors,
      recent_blocks: this.blocks,
      recent_fork_races: this.forkRaces,
    };
  }

  public getLive(): any {
    return {
      connected_sensors: this.sensors.filter((s) => s.health_status === 'healthy').length,
      current_tip_height: this.blocks[0].height,
      current_tip_hash: this.blocks[0].block_hash,
      recent_stages_logged_count: 42,
      status: 'streaming_live',
    };
  }

  public getBlock(blockHash: string): BlockPropagationObservation | undefined {
    return this.blocks.find((b) => b.block_hash === blockHash);
  }

  public listCompactBlocks(): { compact_blocks: CompactBlockDetail[] } {
    return { compact_blocks: this.compactBlocks };
  }

  public listForkRaces(): { fork_races: ForkRaceRecord[] } {
    return { fork_races: this.forkRaces };
  }

  public getForkRace(raceId: string): ForkRaceRecord | undefined {
    return this.forkRaces.find((r) => r.race_id === raceId);
  }

  public listStaleTips(): any {
    return {
      stale_tips: this.forkRaces.flatMap((race) =>
        race.branches
          .filter((b) => b.status === 'valid_stale_branch')
          .map((branch) => ({
            race_id: race.race_id,
            stale_block_hash: branch.tip_block_hash,
            height: branch.tip_height,
            mined_by_pool: branch.mined_by_pool,
            discovered_at: branch.first_observed_utc,
            accumulated_work: branch.accumulated_work,
            bip434_negotiated: race.staletip_negotiated_via_bip434,
          }))
      ),
    };
  }

  public listSensors(): { sensors: PropagationSensor[] } {
    return { sensors: this.sensors };
  }

  public listFibre(): { fibre_observations: FibreObservation[] } {
    return { fibre_observations: this.fibres };
  }
}

export default new BlockPropagationService();
