import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface NodeSecurityOverview {
  total_fleet_nodes: number;
  secure_nodes_count: number;
  vulnerable_nodes_count: number;
  active_advisories_count: number;
  eol_versions_detected: number;
  guix_verified_artifacts_count: number;
  critical_advisories: any[];
  fleet_summary: any[];
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
export class NodeSecurityApiService {
  private readonly baseUrl = '/api/v1/intelligence/node-security';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<NodeSecurityOverview> {
    return this.http.get<NodeSecurityOverview>(`${this.baseUrl}/overview`);
  }

  public getFleet$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/fleet`);
  }

  public getNode$(nodeId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/nodes/${nodeId}`);
  }

  public getAdvisories$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/advisories`);
  }

  public getAdvisory$(advisoryId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/advisories/${advisoryId}`);
  }

  public getReleases$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/releases`);
  }

  public getArtifacts$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/artifacts`);
  }

  public verifyArtifact$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/artifacts/verify`, payload);
  }

  public createUpgradePlan$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/upgrade-plans`, payload);
  }
}
