// New WP01 regression tests. HTTP fixtures prove isolation, not real-network acceptance.
import { describe, expect, it } from 'vitest';
import { Observable, Subject, forkJoin, of, throwError } from 'rxjs';
import { UniverseApiService, UNIVERSE_OUTPOINT_BATCH_LIMIT, UNIVERSE_TRANSACTION_BATCH_LIMIT } from './universe-api.service';
import { UniverseLocalService } from './universe-local.service';
import { InscriptionComponent } from './inscription/inscription.component';
import manifest from '../../../../docs/protocols/PROTOCOL-COVERAGE.json';

describe('NET-01 selected context', () => {
  it('cancels a pending mainnet request and never publishes its late response', () => {
    const changed = new Subject<string>();
    const state = { isBrowser: true, network: '', networkChanged$: changed };
    const requests: { url: string; response: Subject<unknown>; cancelled: boolean }[] = [];
    const api = new UniverseApiService({ get: (url: string) => {
      const row = { url, response: new Subject<unknown>(), cancelled: false };
      requests.push(row);
      return new Observable((subscriber) => {
        const sub = row.response.subscribe(subscriber);
        return (): void => { row.cancelled = true; sub.unsubscribe(); };
      });
    } } as never, state as never);
    const values: unknown[] = [];
    api.getInscription$('42').subscribe((value) => values.push(value));
    state.network = 'signet'; changed.next('signet');
    expect(requests[0].cancelled).toBe(true);
    expect(requests[1].url).toBe('/api/v1/universe/inscriptions/42?chain=bitcoin&network=signet');
    requests[0].response.next({ checkpoint: { chain: 'bitcoin', network: 'mainnet' } });
    requests[1].response.next({ checkpoint: { chain: 'bitcoin', network: 'signet' } });
    expect(values).toEqual([{ checkpoint: { chain: 'bitcoin', network: 'signet' } }]);
  });

  it('rejects a returned checkpoint on a different network', () => {
    const api = new UniverseApiService({ get: () => of({ checkpoint: { chain: 'bitcoin', network: 'mainnet' } }) } as never,
      { isBrowser: true, network: 'signet' } as never);
    let error: Error | undefined;
    api.getInscription$('42').subscribe({ error: (failure) => { error = failure; } });
    expect(error?.message).toBe('authority-network-mismatch');
  });

  it('lets batch consumers finish without waiting for the network event stream', () => {
    const api = new UniverseApiService({ post: () => of({ results: [] }) } as never,
      { isBrowser: true, network: 'signet', networkChanged$: new Subject<string>() } as never);
    let completed = false;
    forkJoin([api.getOutpoints$(['a'.repeat(64) + ':0'])]).subscribe({ complete: () => { completed = true; } });
    expect(completed).toBe(true);
  });

  it.each(['transactions', 'outpoints'] as const)('rejects oversized %s batches without silently losing inputs', (kind) => {
    const calls: unknown[] = [];
    const api = new UniverseApiService({ post: (_url: string, body: unknown) => {
      calls.push(body);
      return of({ results: [] });
    } } as never, { isBrowser: true, network: 'signet' } as never);
    const limit = kind === 'transactions' ? UNIVERSE_TRANSACTION_BATCH_LIMIT : UNIVERSE_OUTPOINT_BATCH_LIMIT;
    const input = Array.from({ length: limit + 1 }, (_, i) => i.toString(16).padStart(64, '0') + (kind === 'outpoints' ? ':0' : ''));
    let error: Error | undefined;
    const request = kind === 'transactions' ? api.getTransactionFlows$(input) : api.getOutpoints$(input);
    request.subscribe({ error: (failure) => { error = failure; } });
    expect(error?.message).toBe(`universe-${kind}-batch-limit-exceeded`);
    expect(calls).toEqual([]);
  });

  it.each(['transactions', 'outpoints'] as const)('sends every input at the %s batch ceiling', (kind) => {
    const calls: unknown[] = [];
    const api = new UniverseApiService({ post: (_url: string, body: unknown) => {
      calls.push(body);
      return of({ results: [] });
    } } as never, { isBrowser: true, network: 'signet' } as never);
    const limit = kind === 'transactions' ? UNIVERSE_TRANSACTION_BATCH_LIMIT : UNIVERSE_OUTPOINT_BATCH_LIMIT;
    const input = Array.from({ length: limit }, (_, i) => i.toString(16).padStart(64, '0') + (kind === 'outpoints' ? ':0' : ''));
    (kind === 'transactions' ? api.getTransactionFlows$(input) : api.getOutpoints$(input)).subscribe();
    expect(calls).toEqual([kind === 'transactions' ? { txids: input } : { outpoints: input }]);
  });

  it.each(['sources', 'inputs', 'outputs', 'actions', 'sourceEvidence', 'utxos'])(
    'rejects a wrong-network checkpoint nested in %s', (key) => {
      const checkpoint = { chain: 'bitcoin', network: 'mainnet' };
      const api = new UniverseApiService({ get: () => of({ [key]: [{ evidence: { checkpoint } }] }) } as never,
        { isBrowser: true, network: 'signet' } as never);
      let error: Error | undefined;
      api.getTransactionFlow$('a'.repeat(64)).subscribe({ error: (failure) => { error = failure; } });
      expect(error?.message).toBe('authority-network-mismatch');
    },
  );

  it('does not replay a previous-network registry while the selected registry is pending', () => {
    const changed = new Subject<string>();
    const state = { isBrowser: true, network: '', networkChanged$: changed };
    const pending = new Subject<unknown>();
    const calls: string[] = [];
    const api = new UniverseApiService({ get: (url: string) => {
      calls.push(url);
      return url.includes('network=signet') ? pending : of({ registryVersion: 'mainnet' });
    } } as never, state as never);
    const initial = api.getProtocols$().subscribe();
    state.network = 'signet'; changed.next('signet');
    const versions: string[] = [];
    const switched = api.getProtocols$().subscribe((value) => versions.push(value.registryVersion));
    expect(versions).toEqual([]);
    pending.next({ registryVersion: 'signet' });
    expect(versions).toEqual(['signet']);
    expect(calls).toHaveLength(2);
    initial.unsubscribe(); switched.unsubscribe();
  });

  it.each(manifest.protocols)('uses the recorded chain for $id feed and source reads', (protocol) => {
    const calls: string[] = [];
    const api = new UniverseApiService({ get: (url: string) => {
      calls.push(url);
      // Only URL scoping is under test here; use the controller's typed failure body.
      const kind = url.match(/\/(activity|objects)\?/)?.[1];
      return kind ? throwError(() => ({ status: 404, error: {
        schemaVersion: `universe-protocol-${kind}-v1`, protocolId: protocol.id,
        state: 'unsupported', degradedReason: 'Fixture response for network parameterization.',
      } })) : of({});
    } } as never, { isBrowser: true, network: 'signet' } as never);
    api.getProtocolActivity$(protocol.id, undefined, 25, protocol.chain).subscribe();
    api.getProtocolObjects$(protocol.id, undefined, 25, protocol.chain).subscribe();
    api.getSources$(protocol.chain).subscribe();
    const network = protocol.chain === 'bitcoin' ? 'signet' : 'mainnet';
    expect(calls).toHaveLength(3);
    expect(calls.every((url) => url.endsWith(`chain=${protocol.chain}&network=${network}`))).toBe(true);
  });
});

describe('NET-02 network links and saved identity', () => {
  it('preserves Signet in outpoint/reveal paths and reloads equal identifiers separately', () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): Map<string, string> => store.set(key, value),
    };
    const api = new UniverseApiService({} as never, { isBrowser: true, network: 'signet' } as never);
    const local = new UniverseLocalService({ isBrowser: true } as never);
    const component = new InscriptionComponent({} as never, api, local, {} as never);
    const txid = 'a'.repeat(64);
    expect(component.outpointRoute(`${txid}:0:0`)).toEqual(['/signet/outpoint', txid, '0']);
    expect(component.networkPath(`/tx/${txid}`)).toBe(`/signet/tx/${txid}`);
    for (const network of ['mainnet', 'signet'] as const) {
      local.recordVisit({ kind: 'inscription', value: `${txid}i0`, path: `/inscription/${txid}i0`, label: 'Sample', network });
    }
    const reloaded = new UniverseLocalService({ isBrowser: true } as never).recentSnapshot();
    expect(reloaded).toHaveLength(2);
    expect(reloaded[0].path).toBe(`/signet/inscription/${txid}i0`);
    expect(reloaded[1].network).toBe('mainnet');
  });

  it('uses the other chain bookmark network even while Bitcoin Signet is selected', () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): Map<string, string> => store.set(key, value),
    };
    const local = new UniverseLocalService({ isBrowser: true, network: 'signet' } as never);
    const value = 'a'.repeat(64);
    local.toggleBookmark({ chain: 'dogecoin', kind: 'transaction', value, path: `/dogecoin/tx/${value}`, label: 'Doge' });
    expect(local.isBookmarked('transaction', value, 'dogecoin')).toBe(true);
    expect(local.isBookmarked('transaction', value, 'bitcoin')).toBe(false);
  });
});
