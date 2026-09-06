import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface VpackOverview {
  total_vpack_versions: number;
  active_providers_count: number;
  supported_implementations: any[];
  recent_verified_anchors: number;
  providers: any[];
  active_versions: string[];
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
export class ArkVpackApiService {
  private readonly baseUrl = '/api/v1/intelligence/ark/vpack';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<VpackOverview> {
    return this.http.get<VpackOverview>(`${this.baseUrl}/overview`);
  }

  public getProviders$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/providers`);
  }
}
