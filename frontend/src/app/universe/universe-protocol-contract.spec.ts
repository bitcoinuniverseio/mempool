// Local HTTP boundary evidence only; these fixtures do not establish authority acceptance.
import { describe, expect, it } from 'vitest';
import { Observable, Subject, TimeoutError, of, throwError } from 'rxjs';
import { UniverseApiService } from './universe-api.service';
import manifest from '../../../../docs/protocols/PROTOCOL-COVERAGE.json';

type Kind = 'activity' | 'objects';
const observedAt = '2026-09-06T00:00:00.000Z';

function page(kind: Kind, protocolId = kind === 'activity' ? 'mezcal' : 'names'): Record<string, unknown> {
  const common = {
    schemaVersion: `universe-protocol-${kind}-v1`, protocolId, state: 'served',
    authorityId: `index-${protocolId}`, nextCursor: null, checkpoint: null,
    degradedReason: null, observedAt,
  };
  return kind === 'activity' ? {
    ...common, feedPath: `/token-explorer/${protocolId}`,
    source: { id: `index-${protocolId}`, protocol: protocolId, chain: 'bitcoin', network: 'mainnet',
      coverage: 'complete', cursor: null, asOf: observedAt },
    assets: [], events: [], invalidations: [], holderSnapshots: [], hasMore: false,
  } : { ...common, objectsPath: '/v1/marketplace/protocols/names/assets', items: [] };
}

function request(api: UniverseApiService, kind: Kind, protocolId = kind === 'activity' ? 'mezcal' : 'names',
  cursor?: string, limit = 25, chain = 'bitcoin'): Observable<unknown> {
  return kind === 'activity' ? api.getProtocolActivity$(protocolId, cursor, limit, chain)
    : api.getProtocolObjects$(protocolId, cursor, limit, chain);
}

function receive(kind: Kind, response: Observable<unknown>): { values: unknown[]; errors: unknown[]; calls: string[] } {
  const calls: string[] = [];
  const api = new UniverseApiService({ get: (url: string) => { calls.push(url); return response; } } as never,
    { isBrowser: true, network: '' } as never);
  const values: unknown[] = [];
  const errors: unknown[] = [];
  request(api, kind).subscribe({ next: (value) => values.push(value), error: (error) => errors.push(error) });
  return { values, errors, calls };
}

describe.each<Kind>(['activity', 'objects'])('%s document contract', (kind) => {
  const protocolId = kind === 'activity' ? 'mezcal' : 'names';
  const rowField = kind === 'activity' ? 'events' : 'items';
  const routeField = kind === 'activity' ? 'feedPath' : 'objectsPath';

  it.each([
    ['incomplete served', { state: 'served' }],
    ['wrong schema', { ...page(kind), schemaVersion: 'old-schema' }],
    ['wrong protocol', { ...page(kind), protocolId: 'brc20' }],
    ['unknown state', { ...page(kind), state: 'ready' }],
    ['absent authority', { ...page(kind), authorityId: null }],
    ['absent route', { ...page(kind), [routeField]: null }],
    ['invalid rows', { ...page(kind), [rowField]: [null] }],
    ['absent rows', { ...page(kind), [rowField]: undefined }],
    ['invalid cursor', { ...page(kind), nextCursor: 4 }],
    ['oversized cursor', { ...page(kind), nextCursor: 'a'.repeat(513) }],
    ['incomplete checkpoint', { ...page(kind), checkpoint: { heightAtomic: '1' } }],
    ['invalid checkpoint height', { ...page(kind), checkpoint: { heightAtomic: 1, blockHash: 'a'.repeat(64), observedAt } }],
    ['invalid observation', { ...page(kind), observedAt: null }],
    ['malformed observation', { ...page(kind), observedAt: 'yesterday' }],
    ['contradictory served reason', { ...page(kind), degradedReason: 'unavailable' }],
    ['HTML fallback', '<!doctype html><title>Explorer</title>'],
    ['array envelope', []],
  ])('rejects %s without a synthetic unsupported result', (_name, body) => {
    const result = receive(kind, of(body));
    expect(result.values).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ message: `protocol-${kind}-contract-mismatch` });
  });

  it.each(['checkpoint', 'source'])('rejects wrong nested %s context', (key) => {
    const result = receive(kind, of({ ...page(kind), [key]: { chain: 'bitcoin', network: 'signet' } }));
    expect(result.values).toEqual([]);
    expect(result.errors).toEqual([new Error('authority-network-mismatch')]);
  });

  it('rejects wrong context in the authority records', () => {
    const result = receive(kind, of({ ...page(kind), [rowField]: [{ evidence: { chain: 'dogecoin', network: 'mainnet' } }] }));
    expect(result.values).toEqual([]);
    expect(result.errors).toEqual([new Error('authority-network-mismatch')]);
  });

  it.each([404, 502, 0])('preserves an untyped HTTP %s and retries only when requested', (status) => {
    const failure = { status, error: '<html>Wrong upstream</html>' };
    const result = receive(kind, throwError(() => failure));
    expect(result.values).toEqual([]);
    expect(result.errors[0]).toBe(failure);
    expect(result.calls).toHaveLength(1);
  });

  it('preserves timeout failure', () => {
    const failure = new TimeoutError();
    const result = receive(kind, throwError(() => failure));
    expect(result.values).toEqual([]);
    expect(result.errors[0]).toBe(failure);
    expect(result.calls).toHaveLength(1);
  });

  it('accepts the exact owned compact unsupported 404 and preserves its reason', () => {
    const body = { schemaVersion: `universe-protocol-${kind}-v1`, protocolId, state: 'unsupported',
      degradedReason: `This protocol has an authority in the registry but no ${kind} route yet.` };
    const result = receive(kind, throwError(() => ({ status: 404, error: body })));
    expect(result.errors).toEqual([]);
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({ ...body, [rowField]: [], observedAt: null, checkpoint: null });
  });

  it.each([200, 404])('preserves a complete typed unsupported document on HTTP %s', (status) => {
    const body = { ...page(kind), state: 'unsupported', authorityId: null, [routeField]: null,
      degradedReason: 'This protocol has no offered route.', ...(kind === 'activity' ? { source: null } : {}) };
    const result = receive(kind, status === 404 ? throwError(() => ({ status, error: body })) : of(body));
    expect(result.errors).toEqual([]);
    expect(result.values[0]).toBe(body);
  });

  it('does not treat a compact unsupported body on a successful route as a complete page', () => {
    const body = { schemaVersion: `universe-protocol-${kind}-v1`, protocolId, state: 'unsupported', degradedReason: 'No route.' };
    const result = receive(kind, of(body));
    expect(result.values).toEqual([]);
    expect(result.errors).toEqual([new Error(`protocol-${kind}-contract-mismatch`)]);
  });

  it.each([
    { schemaVersion: 'wrong', protocolId, state: 'unsupported', degradedReason: 'No route.' },
    { schemaVersion: `universe-protocol-${kind}-v1`, protocolId: 'wrong', state: 'unsupported', degradedReason: 'No route.' },
    { schemaVersion: `universe-protocol-${kind}-v1`, protocolId, state: 'unsupported' },
    { schemaVersion: `universe-protocol-${kind}-v1`, protocolId, state: 'unsupported', degradedReason: '' },
    { ...page(kind), state: 'unsupported', degradedReason: 'No route.', [rowField]: [null] },
  ])('keeps a malformed typed 404 as a failure', (body) => {
    const failure = { status: 404, error: body };
    const result = receive(kind, throwError(() => failure));
    expect(result.values).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it.each(['unconfigured', 'unavailable'])('preserves the full typed %s page and its reason', (state) => {
    const body = { ...page(kind), state, degradedReason: 'The authority requires configuration or recovery.',
      ...(kind === 'activity' ? { source: null } : {}) };
    const response = state === 'unavailable' ? throwError(() => ({ status: 502, error: body })) : of(body);
    const result = receive(kind, response);
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual([body]);
    expect(result.values[0]).toBe(body);
  });

  it('validates context even on a typed unavailable HTTP response', () => {
    const body = { ...page(kind), state: 'unavailable', degradedReason: 'Authority unavailable.',
      checkpoint: { chain: 'bitcoin', network: 'signet' }, ...(kind === 'activity' ? { source: null } : {}) };
    const result = receive(kind, throwError(() => ({ status: 502, error: body })));
    expect(result.values).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it.each([
    { state: 'unconfigured', degradedReason: null },
    { state: 'unavailable', degradedReason: 'Unavailable.', [rowField]: [{}] },
    { state: 'unsupported', degradedReason: 'No route.' },
  ])('rejects inconsistent dependency state %j', (override) => {
    const result = receive(kind, of({ ...page(kind), ...override, ...(kind === 'activity' ? { source: null } : {}) }));
    expect(result.values).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('preserves an authoritative empty served list without creating evidence', () => {
    const body = page(kind);
    const result = receive(kind, of(body));
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual([body]);
    expect(result.values[0]).toBe(body);
  });

  it('preserves opaque records and valid checkpoint/cursor values', () => {
    const body = { ...page(kind), [rowField]: [{ amountAtomic: '9007199254740993', custom: { untouched: true } }],
      checkpoint: { heightAtomic: '100', blockHash: 'a'.repeat(64), observedAt }, nextCursor: 'next & page',
      ...(kind === 'activity' ? { hasMore: true } : {}) };
    const result = receive(kind, of(body));
    expect(result.errors).toEqual([]);
    expect(result.values[0]).toBe(body);
  });

  it.each([[0, 1], [-2, 1], [2.8, 2], [250, 200]])('bounds limit %s to %s and encodes protocol segments', (limit, expected) => {
    const calls: string[] = [];
    const api = new UniverseApiService({ get: (url: string) => { calls.push(url); return of(page(kind, 'name/segment')); } } as never,
      { isBrowser: true, network: '' } as never);
    request(api, kind, 'name/segment', undefined, limit).subscribe();
    expect(calls).toEqual([`/api/v1/universe/protocols/name%2Fsegment/${kind}?limit=${expected}&chain=bitcoin&network=mainnet`]);
  });

  it('cancels stale network reads and continues after a typed dependency response', () => {
    const changed = new Subject<string>();
    const state = { isBrowser: true, network: '', networkChanged$: changed };
    const pending: Subject<unknown>[] = [];
    const api = new UniverseApiService({ get: () => { const response = new Subject<unknown>(); pending.push(response); return response; } } as never, state as never);
    const values: unknown[] = [];
    const errors: unknown[] = [];
    const subscription = request(api, kind).subscribe({ next: (value) => values.push(value), error: (error) => errors.push(error) });
    state.network = 'signet'; changed.next('signet');
    expect(pending[0].observed).toBe(false);
    pending[0].next(page(kind));
    const unavailable = { ...page(kind), state: 'unavailable', degradedReason: 'Authority unavailable.',
      ...(kind === 'activity' ? { source: null } : {}) };
    pending[1].error({ status: 502, error: unavailable });
    expect(errors).toEqual([]);
    expect(values).toEqual([unavailable]);
    state.network = ''; changed.next('');
    expect(pending).toHaveLength(3);
    pending[2].next(page(kind));
    expect(values).toEqual([unavailable, page(kind)]);
    subscription.unsubscribe();
    expect(pending[2].observed).toBe(false);
  });

  const dependents = manifest.protocols.filter((protocol) => protocol.implementedReadOperations.includes(kind));
  it.each(dependents)('parameterizes $id with its owned chain, cursor and limit', (protocol) => {
    const calls: string[] = [];
    const body = page(kind, protocol.id);
    if (kind === 'activity') { (body.source as Record<string, unknown>).chain = protocol.chain; }
    const api = new UniverseApiService({ get: (url: string) => { calls.push(url); return of(body); } } as never,
      { isBrowser: true, network: '' } as never);
    const values: unknown[] = [];
    request(api, kind, protocol.id, 'cursor &/?+', 500, protocol.chain).subscribe((value) => values.push(value));
    expect(values).toEqual([body]);
    expect(calls).toEqual([`/api/v1/universe/protocols/${protocol.id}/${kind}?limit=200&cursor=cursor%20%26%2F%3F%2B&chain=${protocol.chain}&network=mainnet`]);
  });
});

describe('activity source and pagination fields', () => {
  it.each([
    { source: null }, { source: { id: 'index-mezcal' } }, { source: { ...page('activity').source as object, id: null } },
    { assets: null }, { invalidations: [1] }, { holderSnapshots: {} }, { hasMore: 'yes' }, { hasMore: true, nextCursor: null },
  ])('rejects incomplete authority evidence %j', (override) => {
    const result = receive('activity', of({ ...page('activity'), ...override }));
    expect(result.values).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it.each([
    ['atomicals_nft', 'atomicals'], ['op_return', 'op20'], ['op_names', 'op20'], ['tap_doge', 'doge-tap'],
  ])('preserves the owned source label for %s', (protocolId, sourceProtocol) => {
    const body = page('activity', protocolId);
    (body.source as Record<string, unknown>).protocol = sourceProtocol;
    const api = new UniverseApiService({ get: () => of(body) } as never, { isBrowser: true, network: '' } as never);
    const values: unknown[] = [];
    api.getProtocolActivity$(protocolId).subscribe((value) => values.push(value));
    expect(values).toEqual([body]);
  });
});
