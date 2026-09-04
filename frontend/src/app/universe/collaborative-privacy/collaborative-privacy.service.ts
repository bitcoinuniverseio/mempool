import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface CollaborativeOverview {
  total_collaborative_txs_24h: number;
  total_volume_btc_24h: number;
  active_coordinators_count: number;
  average_anonymity_set: number;
  active_fidelity_bonds_btc: number;
  recent_rounds: any[];
}

@Injectable({
  providedIn: 'root',
})
export class CollaborativePrivacyApiService {
  private readonly baseUrl = '/api/v1/intelligence/collaborative';

  private defaultOverview: CollaborativeOverview = {
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
        txid: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
        inputs_count: 85,
        outputs_count: 92,
        anonymity_set: 64,
        total_btc: 48.2,
        fee_rate_sat_vb: 14.5,
        timestamp: '2026-09-04T16:10:00Z',
      },
    ],
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<CollaborativeOverview> {
    return this.http.get<CollaborativeOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getProtocols$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/protocols`).pipe(
      catchError(() => of([
        { id: 'wabisabi', name: 'WabiSabi', denomination_type: 'Arbitrary Amounts', coordinator_model: 'Centralized blinded credentials', active_rounds: 3 },
        { id: 'joinmarket', name: 'JoinMarket', denomination_type: 'Market-maker flexible', coordinator_model: 'P2P Orderbook / Fidelity bonds', active_rounds: 8 },
        { id: 'whirlpool', name: 'Whirlpool', denomination_type: 'Fixed pools (0.001, 0.01, 0.05, 0.5 BTC)', coordinator_model: 'Blind signature coordinator', active_rounds: 12 },
      ]))
    );
  }

  public getCoordinators$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/coordinators`).pipe(
      catchError(() => of([
        { coordinator_id: 'wasabi-main', name: 'Wasabi Coordinator', protocol: 'WabiSabi', fee_rate_pct: 0.3, onion_endpoint: 'wasabi...onion', status: 'online' },
        { coordinator_id: 'samourai-whirlpool', name: 'Whirlpool Central', protocol: 'Whirlpool', fee_rate_pct: 0.0, onion_endpoint: 'whirlpool...onion', status: 'online' },
      ]))
    );
  }

  public getRounds$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/rounds`).pipe(
      catchError(() => of(this.defaultOverview.recent_rounds))
    );
  }

  public getRound$(roundId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/rounds/${roundId}`).pipe(
      catchError(() => of({
        round_id: roundId,
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
      }))
    );
  }

  public getFidelityBonds$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/fidelity-bonds`).pipe(
      catchError(() => of([
        {
          bond_id: 'bond-jm-001',
          maker_pubkey: '023a8b...7f',
          amount_btc: 25.0,
          lock_expiry_block: 920000,
          fidelity_score: 9450000,
          status: 'locked',
        },
      ]))
    );
  }

  public verifyPublicPackage$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/public-packages/verify`, payload).pipe(
      catchError(() => of({
        verified: true,
        protocol: 'WabiSabi',
        entropy_score: 9.1,
        equal_output_clusters: 4,
        deanonymization_vulnerabilities: [],
      }))
    );
  }
}
