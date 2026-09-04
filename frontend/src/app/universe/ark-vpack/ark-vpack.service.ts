import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface VpackOverview {
  total_vpack_versions: number;
  active_providers_count: number;
  supported_implementations: any[];
  recent_verified_anchors: number;
  providers: any[];
  active_versions: string[];
}

@Injectable({
  providedIn: 'root',
})
export class ArkVpackApiService {
  private readonly baseUrl = '/api/v1/intelligence/ark/vpack';

  private defaultOverview: VpackOverview = {
    total_vpack_versions: 2,
    active_providers_count: 2,
    supported_implementations: [
      {
        implementation_id: 'arkade',
        implementation_name: 'Arkade (Rust libvpack-rs)',
        implementation_revision: '0.4.2',
        supported_vpack_versions: ['v0.1.0-mvv', 'v0.2.0-rc1'],
      },
      {
        implementation_id: 'bark',
        implementation_name: 'Bark (Go Ark ASP Client)',
        implementation_revision: '0.3.1',
        supported_vpack_versions: ['v0.1.0-mvv'],
      },
    ],
    recent_verified_anchors: 148,
    providers: [
      {
        provider_id: 'asp-arkade-ashburn',
        name: 'Arkade Prime ASP',
        network: 'bitcoin',
        vpack_version: 'v0.2.0-rc1',
        health_status: 'online',
        exit_delay_blocks: 512,
      },
      {
        provider_id: 'asp-bark-helsinki',
        name: 'Bark Community ASP',
        network: 'bitcoin',
        vpack_version: 'v0.1.0-mvv',
        health_status: 'online',
        exit_delay_blocks: 288,
      },
    ],
    active_versions: ['v0.1.0-mvv', 'v0.2.0-rc1'],
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<VpackOverview> {
    return this.http.get<VpackOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getProviders$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/providers`).pipe(
      catchError(() => of(this.defaultOverview.providers))
    );
  }
}
