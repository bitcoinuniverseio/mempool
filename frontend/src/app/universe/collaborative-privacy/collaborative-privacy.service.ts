import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, startWith, distinctUntilChanged } from 'rxjs';
import { StateService } from '@app/services/state.service';

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
  constructor(private http: HttpClient, private state: StateService) {}
  get network(): string { return this.state.network || this.state.env?.ROOT_NETWORK || 'mainnet'; }
  get networkChanged$() { return this.state.networkChanged$.pipe(startWith(this.network),map(() => this.network),distinctUntilChanged()); }
  private get baseUrl(): string { const root=this.state.env?.ROOT_NETWORK || 'mainnet'; return (this.network===root?'':'/'+this.network)+'/api/v1/intelligence/collaborative'; }
  private rows(kind: string): Observable<any[]> { const network=this.network; return this.http.get<any>(`${this.baseUrl}/${kind}`).pipe(map(res=>{ const key=kind==='fidelity-bonds'?'fidelity_bonds':kind; if(!Array.isArray(res?.[key]) || res[key].length>10000) throw new Error('Malformed source response'); if(kind!=='protocols' && res.network!==network) throw new Error('Source network is not bound'); return res[key]; })); }

  public getOverview$(): Observable<CollaborativeOverview> {
    return this.http.get<CollaborativeOverview>(`${this.baseUrl}/overview`);
  }

  public getProtocols$(): Observable<any[]> {
    return this.rows('protocols');
  }

  public getCoordinators$(): Observable<any[]> {
    return this.rows('coordinators');
  }

  public getRounds$(): Observable<any[]> {
    return this.rows('rounds');
  }

  public getRound$(roundId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/rounds/${encodeURIComponent(roundId)}`);
  }

  public getFidelityBonds$(): Observable<any[]> {
    return this.rows('fidelity-bonds');
  }

  public verifyPublicPackage$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/public-packages/verify`, payload);
  }
}
