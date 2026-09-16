import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import {
  NodeSecurityOverview,
  NodeInventoryItem,
  SecurityAdvisory,
  SoftwareRelease,
  UpgradeWavePlan,
} from './node-security.models';
export * from './node-security.models';
export function requireObject(value: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Malformed node-security response.');
  return value;
}
export function requireRows(value: any, field: string): any[] {
  requireObject(value);
  if (
    !Array.isArray(value[field]) ||
    !value[field].every((x) => x && typeof x === 'object' && !Array.isArray(x))
  )
    throw Error('Malformed ' + field + ' response.');
  return value[field];
}
@Injectable({ providedIn: 'root' })
export class NodeSecurityApiService {
  constructor(
    private http: HttpClient,
    private state: StateService
  ) {}
  get network$(): Observable<string> {
    return this.state.networkChanged$.pipe(
      startWith(this.state.network),
      map((n) => n || 'mainnet'),
      distinctUntilChanged()
    );
  }
  private get baseUrl(): string {
    const host =
      !this.state.isBrowser && this.state.env
        ? this.state.env.NGINX_PROTOCOL +
          '://' +
          this.state.env.NGINX_HOSTNAME +
          ':' +
          this.state.env.NGINX_PORT
        : '';
    return (
      host +
      (this.state.network ? '/' + this.state.network : '') +
      '/api/v1/intelligence/node-security'
    );
  }
  getOverview$(): Observable<NodeSecurityOverview> {
    return this.http.get(this.baseUrl + '/overview').pipe(
      map((v) => {
        const x = requireObject(v);
        for (const key of [
          'total_fleet_nodes_monitored',
          'healthy_nodes_count',
          'exposed_advisories_count',
          'eol_nodes_count',
        ])
          if (!Number.isSafeInteger(x[key]) || x[key] < 0)
            throw Error('Malformed overview count.');
        for (const key of [
          'active_advisories',
          'latest_software_releases',
          'fleet_summary',
        ])
          requireRows(x, key);
        return x;
      })
    );
  }
  getFleet$(): Observable<NodeInventoryItem[]> {
    return this.http
      .get(this.baseUrl + '/fleet')
      .pipe(map((x) => requireRows(x, 'fleet')));
  }
  getNode$(id: string): Observable<NodeInventoryItem> {
    return this.http
      .get(this.baseUrl + '/nodes/' + encodeURIComponent(id))
      .pipe(
        map((x) => {
          requireObject(x);
          if ((x as any).node_id !== id) throw Error('Node identity mismatch.');
          return x as NodeInventoryItem;
        })
      );
  }
  getNodeExposures$(id: string): Observable<unknown> {
    return this.http.get(
      this.baseUrl + '/nodes/' + encodeURIComponent(id) + '/exposures'
    );
  }
  getAdvisories$(): Observable<SecurityAdvisory[]> {
    return this.http
      .get(this.baseUrl + '/advisories')
      .pipe(map((x) => requireRows(x, 'advisories')));
  }
  getAdvisory$(id: string): Observable<SecurityAdvisory> {
    return this.http
      .get(this.baseUrl + '/advisories/' + encodeURIComponent(id))
      .pipe(
        map((x) => {
          requireObject(x);
          if ((x as any).advisory_id !== id)
            throw Error('Advisory identity mismatch.');
          return x as SecurityAdvisory;
        })
      );
  }
  getReleases$(): Observable<SoftwareRelease[]> {
    return this.http
      .get(this.baseUrl + '/releases')
      .pipe(map((x) => requireRows(x, 'releases')));
  }
  getArtifacts$(): Observable<unknown> {
    return this.http.get(this.baseUrl + '/artifacts');
  }
  verifyArtifact$(payload: {
    sha256: string;
    version?: string;
  }): Observable<any> {
    return this.http.post(this.baseUrl + '/artifacts/verify', payload);
  }
  createUpgradePlan$(payload: {
    from_version: string;
    target_version: string;
  }): Observable<UpgradeWavePlan> {
    return this.http.post(this.baseUrl + '/upgrade-plans', payload).pipe(
      map((v) => {
        const x = requireObject(v);
        if (
          x.from_version !== payload.from_version ||
          x.target_version !== payload.target_version ||
          !Number.isSafeInteger(x.nodes_count) ||
          x.nodes_count < 0 ||
          !Array.isArray(x.canary_stages) ||
          !Array.isArray(x.configuration_changes_required) ||
          !Array.isArray(x.intermediate_versions_required) ||
          !x.intermediate_versions_required.every(
            (v: unknown) => typeof v === 'string'
          ) ||
          !x.canary_stages.every(
            (v: any) =>
              v &&
              Number.isSafeInteger(v.stage_number) &&
              Array.isArray(v.node_ids) &&
              v.node_ids.every((id: unknown) => typeof id === 'string') &&
              Number.isSafeInteger(v.verification_wait_minutes) &&
              v.verification_wait_minutes >= 0
          ) ||
          !x.configuration_changes_required.every(
            (v: any) =>
              v &&
              typeof v.option === 'string' &&
              ['renamed', 'removed', 'added'].includes(v.action) &&
              typeof v.notes === 'string'
          )
        )
          throw Error(
            'Upgrade plan does not match the requested versions or schema.'
          );
        return x;
      })
    );
  }
}
