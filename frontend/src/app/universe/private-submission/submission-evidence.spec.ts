import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { provideRouter, convertToParamMap } from '@angular/router';
import {
  provideZonelessChangeDetection,
  ɵresolveComponentResources,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { StateService } from '@app/services/state.service';
import { PrivateSubmissionApiService } from './private-submission.service';
import { PrivateSubmissionOverviewComponent } from './private-submission-overview.component';
import { SubmissionEvidenceComponent } from './submission-evidence.component';
const state: any = {
  isBrowser: false,
  network: 'signet',
  networkChanged$: new Subject(),
  env: {
    ROOT_NETWORK: 'mainnet',
    BASE_MODULE: 'mempool',
    NGINX_PROTOCOL: 'http',
    NGINX_HOSTNAME: 'localhost',
    NGINX_PORT: 8999,
  },
};
describe('Submission source contract rendering', () => {
  it('uses selected network endpoints and discriminates txid and raw diagnosis fields', () => {
    const http: any = {
        post: vi.fn(() => of(null)),
        get: vi.fn(() => of({ state: 'no-blocks-observed', findings: [], coverage: [], retention: { blocks: 10, retained_blocks: 0 }, network: 'signet', scope: 'one observer' })),
      },
      api = new PrivateSubmissionApiService(http, state);
    api.diagnose$('ab'.repeat(32)).subscribe();
    expect(http.post).toHaveBeenLastCalledWith(
      'http://localhost:8999/signet/api/v1/intelligence/submission/diagnose',
      { txid: 'ab'.repeat(32) }
    );
    api.diagnose$('0200').subscribe();
    expect(http.post.mock.calls[1][1]).toEqual({ raw_tx: '0200' });
    let rows: any;
    api.listOrderingFindings$().subscribe((x) => (rows = x));
    expect(rows.state).toBe('no-blocks-observed');
    expect(rows.findings).toEqual([]);
    let malformed: any;
    http.get.mockReturnValueOnce(of({ findings: [] }));
    api.listOrderingFindings$().subscribe({ error: (e) => (malformed = e) });
    expect(malformed?.message).toContain('Malformed');
  });
  it('renders a 404 for an unobserved transaction or block as not observed, never as an empty success', () => {
    const params = new BehaviorSubject(convertToParamMap({ txid: 'a'.repeat(64) }));
    const api: any = {
      network$: of('signet'),
      getTxOrdering$: () => throwError(() => ({ status: 404, error: { stage: 'transaction-not-observed', error: 'No block retained by this backend contains that transaction.' } })),
    };
    const c = new SubmissionEvidenceComponent(api, { paramMap: params } as any, { markForCheck: vi.fn() } as any);
    c.view = 'tx';
    c.ngOnInit();
    expect(c.vm.data).toBeUndefined();
    expect(c.vm.stage).toBe('transaction-not-observed');
    expect(c.errorKind(c.vm)).toBe('not-observed');
    const down = new SubmissionEvidenceComponent({ network$: of('signet'), getBlockOrdering$: () => throwError(() => ({ status: 503, error: { stage: 'unavailable-sensor', error: 'down' } })) } as any, { paramMap: new BehaviorSubject(convertToParamMap({ blockHash: 'b'.repeat(64) })) } as any, { markForCheck: vi.fn() } as any);
    down.view = 'block';
    down.ngOnInit();
    expect(down.errorKind(down.vm)).toBe('unavailable');
    expect(c.orderingLabel('dependency_required_order')).toContain('dependency');
    expect(c.orderingLabel('made-up')).toBe('Unknown.');
    c.ngOnDestroy();
    down.ngOnDestroy();
  });
  it('renders the findings envelope state and rejects an overview without relay facts', () => {
    const findings = { network: 'signet', state: 'observed', findings: [{ txid: 'c'.repeat(64), evidence_state: 'ordering_changed_between_template_and_block', confidence_rating: 'medium', block_position: 3, fee_sats_vb: 2 }], coverage: [{ block_hash: 'd'.repeat(64), height: 5, template_coverage: 'template-observed', transactions: 10, findings: 1 }], retention: { blocks: 10, retained_blocks: 1 }, scope: 'one observer' };
    const ordering = new SubmissionEvidenceComponent({ network$: of('signet'), listOrderingFindings$: () => of(findings) } as any, { paramMap: new BehaviorSubject(convertToParamMap({})) } as any, { markForCheck: vi.fn() } as any);
    ordering.view = 'ordering';
    ordering.ngOnInit();
    expect(ordering.vm.data.state).toBe('observed');
    expect(ordering.vm.data.findings).toHaveLength(1);
    const overview = new SubmissionEvidenceComponent({ network$: of('signet'), getOverview$: () => of({ total_private_broadcasts_24h: 3 }) } as any, { paramMap: new BehaviorSubject(convertToParamMap({})) } as any, { markForCheck: vi.fn() } as any);
    overview.view = 'overview';
    overview.ngOnInit();
    expect(overview.vm.data).toBeUndefined();
    expect(overview.vm.error).toContain('relay');
    ordering.ngOnDestroy();
    overview.ngOnDestroy();
  });
  it('reports a diagnosis 404 as not in the owned mempool and a 200 as the mempool facts', () => {
    const txid = 'e'.repeat(64);
    const api: any = { network$: of('signet'), getOverview$: () => new Subject(), diagnose$: vi.fn().mockReturnValueOnce(throwError(() => ({ status: 404, error: { stage: 'transaction-not-in-mempool', error: 'Not in mempool.' } }))).mockReturnValueOnce(of({ txid, vsize: 140, feerate_sats_vb: 2, package: { effective_feerate_sats_vb: 2 } })) };
    const c = new SubmissionEvidenceComponent(api, { paramMap: new BehaviorSubject(convertToParamMap({})) } as any, { markForCheck: vi.fn() } as any);
    c.raw = txid;
    c.diagnose();
    expect(c.diagnosis).toBeNull();
    expect(c.diagnosisStage).toBe('transaction-not-in-mempool');
    expect(c.diagnosisError).toContain('not in the owned mempool');
    c.diagnose();
    expect(c.diagnosisError).toBe('');
    expect(c.diagnosis.package.effective_feerate_sats_vb).toBe(2);
    c.ngOnDestroy();
  });
  it('clears old transaction evidence on route changes and resumes after source failure', () => {
    const network$ = new BehaviorSubject('signet'),
      params = new BehaviorSubject(convertToParamMap({ txid: 'a' })),
      requests: Subject<any>[] = [],
      api: any = {
        network$,
        getTxOrdering$: () => {
          const r = new Subject();
          requests.push(r);
          return r;
        },
      };
    const c = new SubmissionEvidenceComponent(
      api,
      { paramMap: params } as any,
      { markForCheck: vi.fn() } as any
    );
    c.view = 'tx';
    c.ngOnInit();
    requests[0].next({ txid: 'a', evidence_state: 'unknown' });
    params.next(convertToParamMap({ txid: 'b' }));
    expect(c.vm.data).toBeUndefined();
    requests[0].next({ txid: 'a' });
    expect(c.vm.data).toBeUndefined();
    requests[1].error({ error: { error: 'Sensor unavailable' } });
    expect(c.vm.error).toContain('Sensor');
    network$.next('testnet');
    expect(requests).toHaveLength(3);
    c.ngOnDestroy();
  });
  it('renders actual overview field names with no hashpower, paid or synthetic metric claim', async () => {
    await ɵresolveComponentResources((url) =>
      Promise.resolve(
        readFileSync(
          resolve('src/app/universe/private-submission', url),
          'utf8'
        )
      )
    );
    const html = await renderApplication(
      (context) =>
        bootstrapApplication(
          PrivateSubmissionOverviewComponent,
          {
            providers: [
              provideZonelessChangeDetection(),
              provideRouter([]),
              { provide: StateService, useValue: state },
              {
                provide: PrivateSubmissionApiService,
                useValue: {
                  network$: of('signet'),
                  getOverview$: () =>
                    of({
                      network: 'signet',
                      relay: { configured: true, reason: null, endpoints: [{ id: 'tor-1', transport: 'tor', submit_host: 'abc.onion', proxy_reachable: null }], rejected_endpoints: [] },
                      queue: { queued: 1, relaying: 0, submitted: 2, confirmed: 3, rejected: 0, cancelled: 0 },
                      worker: { running: true, last_tick_at: '2026-09-17T00:00:00.000Z', last_error: null, last_relay: null },
                    }),
                },
              },
            ],
          },
          context
        ),
      {
        document:
          '<app-private-submission-overview></app-private-submission-overview>',
        url: 'http://localhost/',
        allowedHosts: ['localhost'],
      }
    );
    expect(html).toContain('abc.onion');
    expect(html).toContain('not probed yet');
    expect(html).toContain('submitted');
    expect(html).not.toContain('total_private_broadcasts_24h');
    expect(html).toContain('/signet/mempool/private-broadcast');
    expect(html).toContain('/signet/mempool/receipts');
    expect(html).not.toContain('80%');
    expect(html).not.toContain('verified_receipts_count');
  });
});
