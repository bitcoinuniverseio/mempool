import { describe, expect, it, vi } from 'vitest';
import { DestroyRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { AnimaItemsComponent, type AnimaItemsViewModel } from './anima-items.component';
import { AnimaTransitionsComponent, type AnimaTransitionsViewModel } from './anima-transitions.component';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { SeoService } from '@app/services/seo.service';
import { AnimaOrganism, AnimaOrganismsDocument, AnimaStatusDocument, AnimaEventsDocument, AnimaLoggedEvent } from '@app/universe/universe.types';

const seo = { setTitle: () => undefined } as unknown as SeoService;
const destroyRef = { onDestroy: () => () => undefined } as unknown as DestroyRef;

function http(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, url: 'http://explorer.invalid/api/v1/anima/organisms' });
}

function status(state: AnimaStatusDocument['state'] = 'served', degradedReason: string | null = null): AnimaStatusDocument {
  return {
    schemaVersion: 'universe-anima-v1',
    authorityId: 'index-anima',
    state,
    status: {
      network: 'main',
      activationHeight: 964500,
      kindling: { start: 0, end: 0 },
      scanner: { tipHeight: 965975, tipHash: 'a'.repeat(64), nodeHeight: 965975, reorgs: 0, blocksApplied: 1475, syncing: false, lastError: null },
      supply: { created: 0, live: 0, fused: 0, spawned: 0, retired: 0, burned: 0 },
    },
    loggedEventCountAtomic: '0',
    degradedReason,
  };
}

function organism(id: string): AnimaOrganism {
  return { id, status: 'live', origin: 'genesis', createdHeight: 964501 } as unknown as AnimaOrganism;
}

function organisms(items: AnimaOrganism[], total: number, offset = 0): AnimaOrganismsDocument {
  return { schemaVersion: 'universe-anima-v1', authorityId: 'index-anima', state: 'served', total, offset, organisms: items, degradedReason: null } as unknown as AnimaOrganismsDocument;
}

function event(id: string): AnimaLoggedEvent {
  return { eventId: id, kind: 'spawn', txid: 'b'.repeat(64), height: 964501 } as unknown as AnimaLoggedEvent;
}

function events(items: AnimaLoggedEvent[], total: number): AnimaEventsDocument {
  return { schemaVersion: 'universe-anima-v1', authorityId: 'index-anima', state: 'served', total, from: 0, events: items, degradedReason: null };
}

function items(
  status$: Observable<AnimaStatusDocument>,
  pages: Array<Observable<AnimaOrganismsDocument>>,
) {
  const getAnimaOrganisms$ = vi.fn((offset: number) => pages.shift() ?? throwError(() => new Error(`no page for ${offset}`)));
  const api = { getAnimaStatus$: () => status$, getAnimaOrganisms$ } as unknown as UniverseApiService;
  const subject = new AnimaItemsComponent(api, seo, destroyRef);
  return { subject, getAnimaOrganisms$ };
}

async function vm(subject: AnimaItemsComponent): Promise<AnimaItemsViewModel> {
  return firstValueFrom(subject.vm$);
}

describe('ANIMA organisms page', () => {
  it('names an unconfigured authority from the typed 503 instead of blaming the overlay', async () => {
    const { subject } = items(throwError(() => http(503, {
      schemaVersion: 'universe-anima-v1', state: 'unconfigured',
      degradedReason: 'No index-anima authority is configured in this deployment.',
    })), []);
    subject.ngOnInit();
    const view = await vm(subject);
    expect(view.kind).toBe('degraded');
    expect(view.failure).toEqual({ kind: 'unconfigured', reason: 'No index-anima authority is configured in this deployment.' });
    expect(view.degradedReason).toBe('No index-anima authority is configured in this deployment.');
  });

  it('keeps a typed unavailable answer distinct from a transport failure', async () => {
    const unavailable = items(throwError(() => http(502, {
      schemaVersion: 'universe-anima-v1', state: 'unavailable',
      degradedReason: 'The index-anima authority did not answer (transport).',
    })), []);
    unavailable.subject.ngOnInit();
    expect((await vm(unavailable.subject)).failure).toEqual({ kind: 'unavailable', reason: 'The index-anima authority did not answer (transport).' });

    const offline = items(throwError(() => http(0, { type: 'error' })), []);
    offline.subject.ngOnInit();
    const view = await vm(offline.subject);
    expect(view.kind).toBe('error');
    expect(view.failure).toEqual({ kind: 'transport' });
  });

  it('does not read an HTML error page as an ANIMA document', async () => {
    const { subject } = items(throwError(() => http(502, '<html>Bad Gateway</html>')), []);
    subject.ngOnInit();
    const view = await vm(subject);
    expect(view.kind).toBe('error');
    expect(view.failure).toEqual({ kind: 'malformed' });
  });

  it('shows a served authority with no organisms as an empty list, not a failure', async () => {
    const { subject } = items(of(status()), [of(organisms([], 0))]);
    subject.ngOnInit();
    const view = await vm(subject);
    expect(view.kind).toBe('ready');
    expect(view.organisms).toEqual([]);
    expect(view.canLoadMore).toBe(false);
  });

  it('reports a first page that fails after a served status', async () => {
    const { subject } = items(of(status()), [throwError(() => http(0, { type: 'error' }))]);
    subject.ngOnInit();
    const view = await vm(subject);
    expect(view.kind).toBe('error');
    expect(view.failure).toEqual({ kind: 'transport' });
  });

  it('keeps every organism, reports the failed next page, and retries the same continuation without duplicates', async () => {
    const first = [organism('o1'), organism('o2')];
    const retryPage = new Subject<AnimaOrganismsDocument>();
    const { subject, getAnimaOrganisms$ } = items(of(status()), [
      of(organisms(first, 4)),
      throwError(() => http(502, { schemaVersion: 'universe-anima-v1', state: 'unavailable', degradedReason: 'The index-anima authority did not answer (transport).' })),
      retryPage.asObservable(),
    ]);
    subject.ngOnInit();
    expect((await vm(subject)).organisms?.map((o) => o.id)).toEqual(['o1', 'o2']);

    subject.more();
    let view = await vm(subject);
    expect(view.kind).toBe('ready');
    expect(view.organisms?.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(view.loadingMore).toBe(false);
    expect(view.pageFailure).toEqual({ kind: 'unavailable', reason: 'The index-anima authority did not answer (transport).' });
    expect(view.canLoadMore).toBe(true);

    // Retry asks for the same continuation: two organisms already held.
    subject.more();
    expect(getAnimaOrganisms$.mock.calls.map((call) => call[0])).toEqual([0, 2, 2]);
    view = await vm(subject);
    expect(view.loadingMore).toBe(true);
    expect(view.pageFailure).toBeNull();
    // A second click while the retry is in flight does not start another request.
    subject.more();
    expect(getAnimaOrganisms$).toHaveBeenCalledTimes(3);

    // The authority repeats one organism the page already shows; it appears once.
    retryPage.next(organisms([organism('o2'), organism('o3'), organism('o4')], 4));
    retryPage.complete();
    view = await vm(subject);
    expect(view.organisms?.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(view.canLoadMore).toBe(false);
    expect(view.pageFailure).toBeNull();
  });

  it('shows the authority\'s own reason when its status is not served', async () => {
    const { subject } = items(of(status('unavailable', 'The scanner is behind the node.')), []);
    subject.ngOnInit();
    const view = await vm(subject);
    expect(view.kind).toBe('degraded');
    expect(view.degradedReason).toBe('The scanner is behind the node.');
  });
});

describe('ANIMA transitions page', () => {
  function transitions(status$: Observable<AnimaStatusDocument>, pages: Array<Observable<AnimaEventsDocument>>) {
    const getAnimaEvents$ = vi.fn((from: number) => pages.shift() ?? throwError(() => new Error(`no page for ${from}`)));
    const api = { getAnimaStatus$: () => status$, getAnimaEvents$ } as unknown as UniverseApiService;
    return { subject: new AnimaTransitionsComponent(api, seo, destroyRef), getAnimaEvents$ };
  }

  it('preserves the typed unconfigured document', async () => {
    const { subject } = transitions(throwError(() => http(503, {
      schemaVersion: 'universe-anima-v1', state: 'unconfigured',
      degradedReason: 'No index-anima authority is configured in this deployment.',
    })), []);
    subject.ngOnInit();
    const view: AnimaTransitionsViewModel = await firstValueFrom(subject.vm$);
    expect(view.kind).toBe('degraded');
    expect(view.failure?.kind).toBe('unconfigured');
  });

  it('keeps logged transitions across a failed page and dedupes the retried one', async () => {
    const retryPage = new Subject<AnimaEventsDocument>();
    const { subject, getAnimaEvents$ } = transitions(of(status()), [
      of(events([event('e1')], 3)),
      throwError(() => http(0, { type: 'error' })),
      retryPage.asObservable(),
    ]);
    subject.ngOnInit();
    subject.more();
    let view = await firstValueFrom(subject.vm$);
    expect(view.events?.events.map((e) => e.eventId)).toEqual(['e1']);
    expect(view.pageFailure).toEqual({ kind: 'transport' });
    subject.more();
    expect(getAnimaEvents$.mock.calls.map((call) => call[0])).toEqual([0, 1, 1]);
    retryPage.next(events([event('e1'), event('e2'), event('e3')], 3));
    retryPage.complete();
    view = await firstValueFrom(subject.vm$);
    expect(view.events?.events.map((e) => e.eventId)).toEqual(['e1', 'e2', 'e3']);
    expect(view.canLoadMore).toBe(false);
  });
});
