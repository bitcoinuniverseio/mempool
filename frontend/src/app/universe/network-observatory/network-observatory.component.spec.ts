import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { NetworkObservatoryComponent } from './network-observatory.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));
const ownedNodeDown = () => throwError(() => new HttpErrorResponse({ status: 503, error: { stage: 'owned-node-unavailable', error: 'Owned Core peer/network observation is unavailable, stale or on the wrong network.' } }));

const observer = { observerId: 'backend-1', observers: 1 as const, clockOffsetMs: null, clockUncertaintyMs: null, method: 'mempool poll' };
const window = { observedAtUtc: '2026-09-17T00:00:00.000Z', ageMs: 5, freshnessLimitMs: 60000, retentionMs: 3600000, retainedTransactions: 2, lastPollUtc: '2026-09-17T00:00:00.000Z', lastCompletePollUtc: '2026-09-17T00:00:00.000Z', collection: 'observing' as const };
const node = { id: 'n1', name: 'owned core', region: 'unknown', clientVersion: '/Satoshi:29.0.0/', protocolVersion: 70016, fullRbf: null, minRelayFeeRate: 1, clockOffsetMs: null, connectedPeers: 8, mempoolTxCount: null, status: 'online' as const, network: 'signet', observedAtUtc: '2026-09-17T00:00:00.000Z', policySourceAvailable: true, scope: 'one observer' };
const noTemplates = { network: 'signet', state: 'no-templates-observed' as const, blockHeight: null, generatedAt: null, candidateTemplates: [], consensusMempoolTxCount: null, missingFromLocalCount: null, feeRateSpreadSatVb: null, sources: [{ sourceId: 'core', name: 'Core GBT', status: 'not_collected' as const, lastTemplateAt: null, lastError: null }], observer, retention: { templates: 4, txidsPerTemplate: 100 }, scope: 'one observer' };

function build(api: Partial<UniverseApiService>): NetworkObservatoryComponent {
  const view = new NetworkObservatoryComponent(api as UniverseApiService, { setTitle: vi.fn() } as unknown as SeoService);
  view.ngOnInit();
  return view;
}

function observe(api: Partial<UniverseApiService>): any {
  const view = build(api);
  let observed: any;
  view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
  view.ngOnDestroy();
  return observed;
}

describe('Network observatory on an absent source', () => {
  it('shows the error state with the reason when the fleet read fails', () => {
    const vm = observe({ getObserverNodes$: unavailable, getPropagationObservation$: unavailable, getBlockTemplateComparison$: unavailable });
    expect(vm.kind).toBe('unavailable');
    expect(vm.message).toBeTruthy();
    expect(vm.propagation).toBeUndefined();
  });

  it('does not show a timeline over an empty fleet table when only the node read fails', () => {
    const vm = observe({
      getObserverNodes$: unavailable,
      getPropagationObservation$: () => of({ txid: 'ab'.repeat(32), nodeObservations: [] } as any),
      getBlockTemplateComparison$: () => of({ blockHeight: 1, candidateTemplates: [] } as any),
    });
    expect(vm.kind).toBe('unavailable');
    expect(vm.nodes).toBeUndefined();
  });

  it('renders owned-node-unavailable as an unavailable state with its reason code, and retry re-reads', () => {
    const nodes = vi.fn().mockReturnValueOnce(ownedNodeDown()).mockReturnValue(of({ nodes: [node], total: 1 }));
    const view = build({
      getObserverNodes$: nodes,
      getPropagationObservation$: () => of({ txid: null, network: 'signet', state: 'no-observations', firstSeenTimestamp: null, lastSeenTimestamp: null, nodeObservations: [], medianLatencyMs: null, p95LatencyMs: null, spreadDeltaMs: null, observer, window: { ...window, collection: 'not_started' }, expiresAtUtc: null, scope: 'one observer' } as any),
      getBlockTemplateComparison$: () => of(noTemplates as any),
    });
    const seen: any[] = [];
    view.vm$.subscribe((value) => seen.push(value));
    expect(seen.at(-1).kind).toBe('unavailable');
    expect(seen.at(-1).stage).toBe('owned-node-unavailable');
    expect(seen.at(-1).message).toContain('Owned Core');
    view.retry();
    expect(seen.at(-1).kind).toBe('ready');
    expect(seen.at(-1).propagation.state).toBe('no-observations');
    expect(seen.at(-1).templates.state).toBe('no-templates-observed');
    expect(nodes).toHaveBeenCalledTimes(2);
    view.ngOnDestroy();
  });

  it('cancels an in-flight attempt when retried and stops on destroy', () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    const nodes = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const view = build({ getObserverNodes$: nodes, getPropagationObservation$: () => of({} as any), getBlockTemplateComparison$: () => of({} as any) });
    expect(first.observed).toBe(true);
    view.retry();
    expect(first.observed).toBe(false);
    expect(second.observed).toBe(true);
    view.ngOnDestroy();
    expect(second.observed).toBe(false);
  });

  it('keeps a 404 as an error rather than an unavailable observer', () => {
    const vm = observe({ getObserverNodes$: () => throwError(() => new HttpErrorResponse({ status: 404 })), getPropagationObservation$: () => of({} as any), getBlockTemplateComparison$: () => of({} as any) });
    expect(vm.kind).toBe('error');
  });
});

describe('Network observatory single-observer facts', () => {
  it('passes observed lifecycles through with no latency percentiles and labels unmeasured values', () => {
    const propagation = { txid: 'ab'.repeat(32), network: 'signet', state: 'observed', firstSeenTimestamp: 1, lastSeenTimestamp: 2, nodeObservations: [{ nodeId: 'n1', nodeName: 'owned core', arrivedAt: 1, deltaFromFirstMs: 0, accepted: true, presence: 'present', completePoll: true, previousCompletePollUtc: null }], medianLatencyMs: null, p95LatencyMs: null, spreadDeltaMs: null, observer, window, expiresAtUtc: '2026-09-17T01:00:00.000Z', scope: 'one observer' };
    const view = build({ getObserverNodes$: () => of({ nodes: [node], total: 1 }), getPropagationObservation$: () => of(propagation as any), getBlockTemplateComparison$: () => of(noTemplates as any) });
    let vm: any;
    view.vm$.subscribe((value) => { vm = value; }).unsubscribe();
    expect(vm.kind).toBe('ready');
    expect(vm.nodes[0].region).toBe('unknown');
    expect(vm.propagation.observer.observers).toBe(1);
    expect(vm.propagation.medianLatencyMs).toBeNull();
    expect(view.measured(null, 'ms')).toBe('not measured');
    expect(view.measured(0, 'ms')).toBe('0 ms');
    view.ngOnDestroy();
  });
});
