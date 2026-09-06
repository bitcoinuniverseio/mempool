import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CollaborativeOverview {
  total_collaborative_txs_24h: number;
  total_volume_btc_24h: number;
  active_coordinators_count: number;
  average_anonymity_set: number;
  active_fidelity_bonds_btc: number;
  recent_rounds: any[];
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
export class CollaborativePrivacyApiService {
  private readonly baseUrl = '/api/v1/intelligence/collaborative';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<CollaborativeOverview> {
    return this.http.get<CollaborativeOverview>(`${this.baseUrl}/overview`);
  }

  public getProtocols$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/protocols`);
  }

  public getCoordinators$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/coordinators`);
  }

  public getRounds$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/rounds`);
  }

  public getRound$(roundId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/rounds/${roundId}`);
  }

  public getFidelityBonds$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/fidelity-bonds`);
  }

  public verifyPublicPackage$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/public-packages/verify`, payload);
  }
}
