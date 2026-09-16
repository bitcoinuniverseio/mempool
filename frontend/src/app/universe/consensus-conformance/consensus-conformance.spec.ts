import { describe, it, expect, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { ActivatedRoute, provideRouter, convertToParamMap } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { ConsensusConformanceApiService } from './consensus-conformance.service';
import { ConformanceEvidenceComponent } from './conformance-evidence.component';
import { ConsensusConformanceOverviewComponent } from './consensus-conformance-overview.component';
const state = () => ({
  isBrowser: false,
  network: 'signet',
  env: {
    ROOT_NETWORK: 'mainnet',
    BASE_MODULE: 'mempool',
    NGINX_PROTOCOL: 'http',
    NGINX_HOSTNAME: 'localhost',
    NGINX_PORT: 8999,
  },
  networkChanged$: new Subject<string>(),
});
const cdr: any = { markForCheck: vi.fn() };
describe('actual conformance evidence UI', () => {
  it('cancels old selected-backend reads and recovers from error on later network changes', () => {
    const s = state(),
      pending: Subject<any>[] = [];
    const http: any = {
      get: vi.fn(() => {
        const p = new Subject<any>();
        pending.push(p);
        return p;
      }),
    };
    const api = new ConsensusConformanceApiService(http, s as any),
      rows: any[] = [];
    const sub = api.watch$('/overview').subscribe((v) => rows.push(v));
    expect(http.get.mock.calls[0][0]).toContain('/signet/api/');
    pending[0].next({ id: 'old' });
    s.network = 'mainnet';
    s.networkChanged$.next('mainnet');
    expect(rows.at(-1).value).toBeNull();
    pending[0].next({ stale: true });
    expect(rows.at(-1).value).toBeNull();
    pending[1].error(Error('offline'));
    s.network = 'signet';
    s.networkChanged$.next('signet');
    pending[2].next({ id: 'new' });
    expect(rows.at(-1).value.id).toBe('new');
    sub.unsubscribe();
  });
  it('sends the token only in the execution header and escapes case IDs', () => {
    const http: any = { post: vi.fn(() => of({})) };
    const api = new ConsensusConformanceApiService(http, state() as any);
    api.replayCase$('case:1/path', 'secret');
    expect(http.post.mock.calls[0][0]).toContain('case%3A1%2Fpath/replay');
    expect(http.post.mock.calls[0][1]).toEqual({});
    expect(http.post.mock.calls[0][2].headers).toEqual({ 'X-Conformance-Execution-Token': 'secret' });
  });
  it('clears replay success on edits, errors, route/backend change and destruction', () => {
    const routes = new Subject<any>(),
      reads = new Subject<any>();
    let response = new Subject<any>();
    const api: any = { watch$: () => reads, replayCase$: vi.fn(() => response) };
    const c = new ConformanceEvidenceComponent({ paramMap: routes } as any, api, cdr);
    c.mode = 'case';
    c.ngOnInit();
    routes.next(convertToParamMap({ caseId: 'one' }));
    reads.next({ loading: false, value: { case_id: 'one' }, error: null });
    c.token = 'operator';
    c.replay();
    c.invalidateResult();
    response.next({ reproduced: true });
    expect(c.result).toBeNull();
    response = new Subject();
    c.replay();
    response.next({ reproduced: false });
    expect(c.result.reproduced).toBe(false);
    response = new Subject();
    c.replay();
    response.error({ status: 403 });
    expect(c.result).toBeNull();
    expect(c.error).toContain('token rejected');
    reads.next({ loading: true, value: null, error: null });
    expect(c.token).toBe('');
    expect(c.value).toBeNull();
    c.ngOnDestroy();
  });
  it('renders real evidence counters and pending acceptance without invented conformance percentages', async () => {
    const s = state();
    const overview = {
      total_implementations_evaluated: 0,
      total_differential_cases: 0,
      divergences_classified_count: 0,
      machine_proved_formal_theorems_count: 0,
      implementations: [],
      targets: [],
      availability: 'not-configured',
      scope: 'Bounded measured evidence',
      unsupported_acceptance: ['Full block validation pending'],
    };
    const html = await renderApplication(
      (context) =>
        bootstrapApplication(
          ConsensusConformanceOverviewComponent,
          {
            providers: [
              provideZonelessChangeDetection(),
              provideRouter([]),
              { provide: StateService, useValue: s },
              {
                provide: ConsensusConformanceApiService,
                useValue: { watch$: () => of({ loading: false, value: overview, error: null }) },
              },
            ],
          },
          context
        ),
      {
        document: '<app-consensus-conformance-overview></app-consensus-conformance-overview>',
        url: 'http://localhost/',
        allowedHosts: ['localhost'],
      }
    );
    expect(html).toContain('Operator execution token');
    expect(html).toContain('Full block validation pending');
    expect(html).toContain('not-configured');
    expect(html).not.toContain('100% MATCH');
    expect(html).not.toContain('Complete in Lean');
  });
});
