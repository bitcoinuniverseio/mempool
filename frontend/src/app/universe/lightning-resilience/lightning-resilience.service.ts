import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface LightningResilienceOverview {
  total_channels_monitored: number;
  healthy_channels_count: number;
  congested_channels_count: number;
  active_incidents_count: number;
  average_slot_utilization_pct: number;
  average_held_duration_p95_seconds: number;
  onion_queue: any;
  recent_incidents: any[];
  top_congested_channels: any[];
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
export class LightningResilienceApiService {
  private readonly baseUrl = '/api/v1/intelligence/lightning/resilience';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<LightningResilienceOverview> {
    return this.http.get<LightningResilienceOverview>(`${this.baseUrl}/overview`);
  }

  public getChannels$(): Observable<any[]> {
    return this.http.get<{ channels: any[] }>(`${this.baseUrl}/channels`).pipe(
      map(res => res.channels || [])
    );
  }

  public getChannel$(shortId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/channels/${shortId}`);
  }

  public getNode$(publicKey: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/nodes/${publicKey}`);
  }

  public getIncidents$(): Observable<any[]> {
    return this.http.get<{ incidents: any[] }>(`${this.baseUrl}/incidents`).pipe(
      map(res => res.incidents || [])
    );
  }

  public getMitigations$(): Observable<any[]> {
    return this.http.get<{ mitigations: any[] }>(`${this.baseUrl}/mitigations`).pipe(
      map(res => res.mitigations || [])
    );
  }

  public simulate$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/simulate`, payload);
  }
}
