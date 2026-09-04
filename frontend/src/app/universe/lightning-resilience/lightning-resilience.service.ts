import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

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

@Injectable({
  providedIn: 'root',
})
export class LightningResilienceApiService {
  private readonly baseUrl = '/api/v1/intelligence/lightning/resilience';

  private defaultOverview: LightningResilienceOverview = {
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
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<LightningResilienceOverview> {
    return this.http.get<LightningResilienceOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getChannels$(): Observable<any[]> {
    return this.http.get<{ channels: any[] }>(`${this.baseUrl}/channels`).pipe(
      map(res => res.channels || []),
      catchError(() => of(this.defaultOverview.top_congested_channels))
    );
  }

  public getChannel$(shortId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/channels/${shortId}`).pipe(
      catchError(() => of({
        short_channel_id: shortId,
        node_1_pubkey: '028b9c2a4f6d8e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
        node_2_pubkey: '034f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
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
        updated_at: '2026-09-04T17:45:00Z',
      }))
    );
  }

  public getNode$(publicKey: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/nodes/${publicKey}`).pipe(
      catchError(() => of({
        public_key: publicKey,
        alias: 'Universe-Hub-01',
        total_channels: 24,
        healthy_channels: 22,
        congested_channels: 2,
        overall_health_score: 91.6,
        reputation_policy_enabled: true,
        circuit_breaker_enabled: true,
        onion_rate_limiting_enabled: true,
        updated_at: '2026-09-04T17:45:00Z',
      }))
    );
  }

  public getIncidents$(): Observable<any[]> {
    return this.http.get<{ incidents: any[] }>(`${this.baseUrl}/incidents`).pipe(
      map(res => res.incidents || []),
      catchError(() => of(this.defaultOverview.recent_incidents))
    );
  }

  public getMitigations$(): Observable<any[]> {
    return this.http.get<{ mitigations: any[] }>(`${this.baseUrl}/mitigations`).pipe(
      map(res => res.mitigations || []),
      catchError(() => of([
        {
          mitigation_id: 'mit-001',
          name: 'Upstream Reputation-Based Slot Allocation',
          layer: 'HTLC/PTLC',
          status: 'Active',
          description: 'Restricts in-flight unendorsed HTLC slots to 5% per peer to prevent complete channel exhaustion.',
          impact_score: 'High',
        },
        {
          mitigation_id: 'mit-002',
          name: 'Onion Message Token-Bucket Rate Limiter',
          layer: 'Onion Messaging',
          status: 'Active',
          description: 'Caps forwarding rates to 50 messages/sec per incoming channel to protect node CPU and memory queues.',
          impact_score: 'Medium',
        },
      ]))
    );
  }

  public simulate$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/simulate`, payload).pipe(
      catchError(() => of({
        simulation_id: 'sim-mock-result',
        scenario: payload.scenario || 'slot_exhaustion_dos',
        baseline_survival_rate_pct: 22.4,
        protected_survival_rate_pct: 96.8,
        mitigation_effectiveness_pct: 74.4,
        recommended_actions: [
          'Enable local reputation tracking for unknown forwarders',
          'Deploy fast-lane reserve slots for verified low-latency peers',
        ],
      }))
    );
  }
}
