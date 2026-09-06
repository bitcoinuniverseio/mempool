import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

/**
 * Reads for this surface.
 *
 * Every call returns what the intelligence API returned, or it errors. There
 * is deliberately no fallback value: the revision this replaces answered a
 * failed request with an invented one, and on this surface that included a
 * verification reporting itself verified. A reader who cannot tell a checked
 * result from an unchecked one has nothing.
 */
@Injectable({
  providedIn: 'root',
})
export class BlockPropagationApiService {
  private readonly baseUrl = '/api/v1/intelligence/block-propagation';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<BlockPropagationOverview> {
    return this.http.get<BlockPropagationOverview>(`${this.baseUrl}/overview`);
  }

  public getLive$(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/live`);
  }

  public getBlock$(hash: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/blocks/${hash}`);
  }

  public getCompactBlocks$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/compact-blocks`);
  }

  public getForkRaces$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/fork-races`);
  }

  public getForkRace$(raceId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/fork-races/${raceId}`);
  }

  public getStaleTips$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/stale-tips`);
  }

  public getFibre$(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/fibre`);
  }
}
