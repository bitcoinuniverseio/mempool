import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConformanceOverview {
  total_conformance_tests: number;
  passing_conformance_tests: number;
  divergent_test_cases: number;
  active_implementations_count: number;
  formal_theorems_verified: number;
  total_fuzz_executions_24h: number;
  implementations: any[];
  recent_divergences: any[];
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
export class ConsensusConformanceApiService {
  private readonly baseUrl = '/api/v1/intelligence/consensus-conformance';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<ConformanceOverview> {
    return this.http.get<ConformanceOverview>(`${this.baseUrl}/overview`);
  }

  public getImplementations$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/implementations`);
  }

  public getCases$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/cases`);
  }

  public getCase$(caseId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/cases/${caseId}`);
  }

  public replayCase$(caseId: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/cases/${caseId}/replay`, {});
  }

  public getFormalArtifacts$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/formal-artifacts`);
  }
}
