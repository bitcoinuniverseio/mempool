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
        get: vi.fn(() => of({ findings: [] })),
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
    expect(rows).toEqual([]);
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
                      capabilities: {},
                      active_accelerator_providers: [],
                      recent_ordering_findings_count: 2,
                      total_private_broadcasts_24h: 3,
                      average_queue_duration_seconds: 4,
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
    expect(html).toContain('total_private_broadcasts_24h');
    expect(html).toContain('recent_ordering_findings_count');
    expect(html).toContain('/signet/mempool/private-broadcast');
    expect(html).toContain('/signet/mempool/receipts');
    expect(html).not.toContain('80%');
    expect(html).not.toContain('verified_receipts_count');
  });
});
