import { Inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { Observable, of } from 'rxjs';
import { startWith, switchMap, map, catchError } from 'rxjs/operators';
export interface ConformanceOverview {
  total_implementations_evaluated: number;
  total_differential_cases: number;
  divergences_classified_count: number;
  machine_proved_formal_theorems_count: number;
  implementations: any[];
  recent_cases: any[];
  targets: any[];
  availability: string;
  scope: string;
  unsupported_acceptance: string[];
}
export interface ConformanceLoad {
  loading: boolean;
  value: any;
  error: string | null;
}
@Injectable({ providedIn: 'root' })
export class ConsensusConformanceApiService {
  constructor(
    @Inject(HttpClient) private http: HttpClient,
    @Inject(StateService) private state: StateService
  ) {}
  private get base() {
    const network = this.state.network ?? '';
    const prefix = network && network !== (this.state.env.ROOT_NETWORK ?? 'mainnet') ? '/' + network : '';
    return (
      (this.state.isBrowser
        ? ''
        : `${this.state.env.NGINX_PROTOCOL}://${this.state.env.NGINX_HOSTNAME}:${this.state.env.NGINX_PORT}`) +
      prefix +
      '/api/v1/intelligence/consensus-conformance'
    );
  }
  watch$(path: string): Observable<ConformanceLoad> {
    return this.state.networkChanged$.pipe(
      startWith(null),
      switchMap(() =>
        this.http.get(this.base + path).pipe(
          map((value) => ({ loading: false, value, error: null })),
          catchError(() =>
            of({ loading: false, value: null, error: 'Conformance evidence is unavailable for this selected backend.' })
          ),
          startWith({ loading: true, value: null, error: null })
        )
      )
    );
  }
  getOverview$() {
    return this.http.get<ConformanceOverview>(this.base + '/overview');
  }
  getImplementations$() {
    return this.http.get<any>(this.base + '/implementations').pipe(map((v) => v.implementations));
  }
  getCases$() {
    return this.http.get<any>(this.base + '/cases').pipe(map((v) => v.cases));
  }
  getCase$(id: string) {
    return this.http.get<any>(this.base + '/cases/' + encodeURIComponent(id));
  }
  getFormalArtifacts$() {
    return this.http.get<any>(this.base + '/formal-artifacts').pipe(map((v) => v.formal_artifacts));
  }
  startCampaign$(target: string, seed: number, token: string) {
    return this.http.post<any>(
      this.base + '/campaigns',
      { target_id: target, seed },
      { headers: { 'X-Conformance-Execution-Token': token } }
    );
  }
  replayCase$(id: string, token: string) {
    return this.http.post<any>(
      this.base + '/cases/' + encodeURIComponent(id) + '/replay',
      {},
      { headers: { 'X-Conformance-Execution-Token': token } }
    );
  }
}
