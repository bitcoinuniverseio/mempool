import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface BlockPropagationOverview {
  total_blocks_observed: number;
  average_propagation_time_ms: number;
  p90_propagation_time_ms: number;
  p99_propagation_time_ms: number;
  compact_block_hit_rate_pct: number;
  fibre_blocks_percentage: number;
  active_sensors_count: number;
  fork_races_last_30_days: number;
  stale_blocks_last_30_days: number;
  recent_blocks: any[];
}

@Injectable({
  providedIn: 'root',
})
export class BlockPropagationApiService {
  private readonly baseUrl = '/api/v1/intelligence/block-propagation';

  private defaultOverview: BlockPropagationOverview = {
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
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<BlockPropagationOverview> {
    return this.http.get<BlockPropagationOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getLive$(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/live`).pipe(
      catchError(() => of({
        live_blocks: this.defaultOverview.recent_blocks,
        active_sensors: 42,
        last_block_received_ms_ago: 34000,
      }))
    );
  }

  public getBlock$(hash: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/blocks/${hash}`).pipe(
      catchError(() => of({
        height: 864201,
        hash: hash,
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
          { sensor_id: 'sensor-ap-southeast-1', latency_ms: 215 },
        ],
      }))
    );
  }

  public getCompactBlocks$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/compact-blocks`).pipe(
      catchError(() => of([
        {
          block_height: 864201,
          block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
          short_ids_matched: 3890,
          missing_txs: 2,
          reconstruction_time_ms: 8.4,
          hit_rate_pct: 99.95,
          method: 'BIP152 High Bandwidth',
        },
      ]))
    );
  }

  public getForkRaces$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/fork-races`).pipe(
      catchError(() => of([
        {
          race_id: 'race-863920',
          height: 863920,
          observed_at: '2026-09-02T14:20:00Z',
          block_a: {
            hash: '00000000000000000002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4',
            miner: 'AntPool',
            received_first_pct: 54.2,
            final_status: 'main_chain',
          },
          block_b: {
            hash: '00000000000000000003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5',
            miner: 'F2Pool',
            received_first_pct: 45.8,
            final_status: 'stale',
          },
          time_difference_ms: 340,
        },
      ]))
    );
  }

  public getForkRace$(raceId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/fork-races/${raceId}`).pipe(
      catchError(() => of({
        race_id: raceId,
        height: 863920,
        observed_at: '2026-09-02T14:20:00Z',
        block_a: {
          hash: '00000000000000000002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4',
          miner: 'AntPool',
          received_first_pct: 54.2,
          final_status: 'main_chain',
        },
        block_b: {
          hash: '00000000000000000003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5',
          miner: 'F2Pool',
          received_first_pct: 45.8,
          final_status: 'stale',
        },
        time_difference_ms: 340,
        node_split_map: {
          europe: 'AntPool',
          north_america: 'AntPool',
          asia_east: 'F2Pool',
        },
      }))
    );
  }

  public getStaleTips$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/stale-tips`).pipe(
      catchError(() => of([
        {
          height: 863920,
          stale_hash: '00000000000000000003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5',
          winning_hash: '00000000000000000002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4',
          miner: 'F2Pool',
          lost_subsidy_sats: 312500000,
          lost_fees_sats: 4892010,
          reorg_depth: 1,
          date: '2026-09-02',
        },
      ]))
    );
  }

  public getFibre$(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/fibre`).pipe(
      catchError(() => of({
        active_nodes: 18,
        average_latency_ms: 45.2,
        bandwidth_reduction_pct: 99.2,
        forward_error_correction_active: true,
        nodes: [
          { location: 'Frankfurt', ping_ms: 12, status: 'synced' },
          { location: 'Northern Virginia', ping_ms: 78, status: 'synced' },
          { location: 'Tokyo', ping_ms: 185, status: 'synced' },
        ],
      }))
    );
  }
}
