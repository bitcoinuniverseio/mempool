import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, NEVER, Observable, Subject, filter, firstValueFrom, of, throwError } from 'rxjs';
import { ProtocolDirectoryComponent, type DirectoryViewModel } from '@app/universe/protocol-directory/protocol-directory.component';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { SeoService } from '@app/services/seo.service';
import {
  ExplorerProtocolDefinition,
  ProtocolsResponse,
  SourceEntry,
  SourcesResponse,
} from '@app/universe/universe.types';

function protocol(overrides: Partial<ExplorerProtocolDefinition> = {}): ExplorerProtocolDefinition {
  return {
    schemaVersion: 'universe-explorer-protocol-v1',
    id: 'ordinals',
    aliases: [],
    displayName: 'Ordinals',
    shortName: 'Ordinals',
    family: 'ORDINALS',
    chain: 'bitcoin',
    networks: ['mainnet'],
    icon: 'protocol-ordinals',
    visualToken: 'protocol-ordinals',
    implementedReadOperations: [],
    authorizedReadOperations: [],
    releaseStatus: 'BLOCKED',
    indexerAuthority: 'index-ordinals',
    coverage: 'unknown',
    ...overrides,
  };
}

function source(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    authorityId: 'index-ordinals',
    protocols: ['ordinals'],
    ready: true,
    status: 'ready',
    checkpoint: { heightAtomic: '964103', blockHash: 'a'.repeat(64), observedAt: 'now' },
    checkedAt: 'now',
    ...overrides,
  };
}

const seo = { setTitle: () => undefined } as unknown as SeoService;

/** An api stub on one network: the registry, the snapshot, and the network they were read from. */
function apiOn(
  network: string,
  getProtocols$: () => Observable<ProtocolsResponse>,
  getSources$: () => Observable<SourcesResponse>,
): UniverseApiService {
  return {
    network,
    selectedNetwork$: () => of(network),
    getProtocols$,
    getSources$,
  } as unknown as UniverseApiService;
}

function component(
  protocols: ProtocolsResponse,
  sources: SourcesResponse | Error = { generatedAt: 'now', sources: [] },
  network = 'mainnet',
): ProtocolDirectoryComponent {
  const api = apiOn(
    network,
    () => of(protocols),
    () => (sources instanceof Error ? throwError(() => sources) : of(sources)),
  );
  const subject = new ProtocolDirectoryComponent(api, seo);
  subject.ngOnInit();
  return subject;
}

/** The first model that is no longer loading: the page, or the error state. */
function settled(subject: ProtocolDirectoryComponent): Promise<DirectoryViewModel> {
  return firstValueFrom(subject.vm$.pipe(filter((vm) => !vm.loading)));
}

function registry(protocols: ExplorerProtocolDefinition[]): ProtocolsResponse {
  return { registryVersion: '1.0.0', primaryStrip: [], protocols };
}

describe('ProtocolDirectoryComponent availability', () => {
  const subject = component(registry([]));
  const readable = protocol({ releaseStatus: 'VERIFIED READ ONLY' });
  const sourcesWith = (entry: SourceEntry) => new Map([['index-ordinals', entry]]);

  /**
   * The Protocols page shipped "Live, read only" beside "Authority
   * unreachable" for the same protocol, with equal weight, and counted it
   * among the protocols readable that day. The registry says what a protocol
   * implements; only the authority says what it can answer for now.
   */
  it('does not call a protocol readable when its authority cannot be reached', () => {
    const unreachable = source({ ready: false, status: 'unreachable', checkpoint: null });
    expect(subject.availability(readable, sourcesWith(unreachable))).toBe('unreachable');
    expect(subject.availabilityLabel('unreachable')).toBe('Unavailable');
    expect(subject.isLive(readable, sourcesWith(unreachable))).toBe(false);
  });

  it('does not call a protocol readable when its authority is still catching up', () => {
    const stale = source({ status: 'stale', lagBlocks: '653560' });
    expect(subject.availability(readable, sourcesWith(stale))).toBe('catching-up');
    expect(subject.availabilityLabel('catching-up')).toBe('Catching up');
    expect(subject.isLive(readable, sourcesWith(stale))).toBe(false);
  });

  it('calls a protocol readable only when its authority is ready with a checkpoint', () => {
    expect(subject.availability(readable, sourcesWith(source()))).toBe('available');
    expect(subject.availabilityLabel('available')).toBe('Readable now');
    expect(subject.isLive(readable, sourcesWith(source()))).toBe(true);
  });

  it('treats a ready authority with no checkpoint as degraded, not as readable', () => {
    const noCheckpoint = source({ checkpoint: null });
    expect(subject.availability(readable, sourcesWith(noCheckpoint))).toBe('degraded');
    expect(subject.isLive(readable, sourcesWith(noCheckpoint))).toBe(false);
  });

  it('separates an authority nobody configured from one that is broken', () => {
    expect(subject.availability(readable, new Map())).toBe('unconfigured');
    expect(subject.availabilityLabel('unconfigured')).toBe('Not served here');
    expect(subject.availabilityClass('unconfigured')).toBe('chip-unknown');
    expect(subject.availabilityClass('unreachable')).toBe('chip-blocked');
  });

  it('lets the registry decide for a protocol that is not implemented at all', () => {
    // No read operation beyond the registry row: nothing exists to be live.
    expect(subject.availability(protocol({ releaseStatus: 'BLOCKED' }), sourcesWith(source())))
      .toBe('not-implemented');
    expect(subject.availability(protocol({ releaseStatus: 'BLOCKED', implementedReadOperations: ['registry'] }), sourcesWith(source())))
      .toBe('not-implemented');
    expect(subject.availability(protocol({ releaseStatus: 'INTENTIONALLY DISABLED' }), null))
      .toBe('disabled');
  });

  it('does not read a blocked release as a missing implementation', () => {
    // Mezcal: release BLOCKED, activity reader declared, authority serving.
    const mezcal = protocol({
      id: 'mezcal', releaseStatus: 'BLOCKED', indexerAuthority: 'index-mezcal',
      implementedReadOperations: ['registry', 'activity'],
      readOperationDescriptors: [
        { id: 'registry', method: 'GET', route: '/api/v1/universe/protocols', authorityPath: null, evidence: 'source-contract', acceptance: 'NOT TESTED' },
        { id: 'activity', method: 'GET', route: '/api/v1/universe/protocols/mezcal/activity', authorityPath: '/token-explorer/mezcal', evidence: 'source-contract', acceptance: 'NOT TESTED' },
      ],
    });
    const mezcalSources = (entry: SourceEntry) => new Map([['index-mezcal', entry]]);
    expect(subject.availability(mezcal, mezcalSources(source({ authorityId: 'index-mezcal', protocols: ['mezcal'] })))).toBe('available');
    expect(subject.availability(mezcal, mezcalSources(source({ authorityId: 'index-mezcal', protocols: ['mezcal'], status: 'stale' })))).toBe('catching-up');
    expect(subject.availability(mezcal, mezcalSources(source({ authorityId: 'index-mezcal', protocols: ['mezcal'], status: 'unreachable', checkpoint: null })))).toBe('unreachable');
    expect(subject.availability(mezcal, new Map())).toBe('unconfigured');
    expect(subject.availability(mezcal, null)).toBe('unknown');
    // The blocked release still shows in the capability qualifier.
    expect(subject.capabilityLabel(mezcal)).toBe('Read only, not verified');
  });

  it('claims nothing when the authority snapshot could not be read', () => {
    expect(subject.availability(readable, null)).toBe('unknown');
    expect(subject.isLive(readable, null)).toBe(false);
  });

  it('keeps the registry capability as a qualifier rather than a headline', () => {
    expect(subject.capabilityLabel(protocol({ releaseStatus: 'VERIFIED READ ONLY' })))
      .toBe('Read only');
    expect(subject.capabilityLabel(protocol({ releaseStatus: 'PRODUCTION VERIFIED' })))
      .toBe('Read and verify');
    expect(subject.capabilityLabel(protocol({ releaseStatus: 'BLOCKED' })))
      .toBe('Not implemented');
    expect(subject.capabilityLabel(protocol({ releaseStatus: 'PENDING_REVIEW' as never })))
      .toBe('Pending review');
  });
});

describe('ProtocolDirectoryComponent coverage', () => {
  const subject = component(registry([]));

  it('reads coverage from a string or from a coverage object', () => {
    expect(subject.coverageLabel(protocol({ coverage: 'complete' }))).toBe('Coverage: Complete');
    expect(subject.coverageLabel(protocol({ coverage: { state: 'partial' } })))
      .toBe('Coverage: Partial');
  });

  it('says coverage is unknown rather than inventing a value', () => {
    expect(subject.coverageLabel(protocol({ coverage: null }))).toBe('Coverage unknown');
    expect(subject.coverageLabel(protocol({ coverage: {} }))).toBe('Coverage unknown');
    expect(subject.coverageKnown(protocol({ coverage: null }))).toBe(false);
    expect(subject.coverageKnown(protocol({ coverage: 'complete' }))).toBe(true);
  });
});

describe('ProtocolDirectoryComponent view model', () => {
  it('groups Bitcoin protocols by family in the intended order', async () => {
    const subject = component(
      registry([
        protocol({ id: 'brc20', family: 'OTHER' }),
        protocol({ id: 'runes', family: 'RUNES' }),
        protocol({ id: 'ordinals', family: 'ORDINALS' }),
        protocol({ id: 'stamps', family: 'STAMPS' }),
      ]),
    );
    const vm = await settled(subject);
    expect(vm.groups.map((group) => group.label)).toEqual([
      'ORDINALS',
      'RUNES',
      'STAMPS',
      'OTHER',
    ]);
  });

  it('keeps other chains out of the list but reports how many there are', async () => {
    const subject = component(
      registry([
        protocol({ id: 'ordinals' }),
        protocol({ id: 'doginals', chain: 'dogecoin' }),
        protocol({ id: 'zerdinals', chain: 'zcash' }),
      ]),
    );
    const vm = await settled(subject);
    expect(vm.totalCount).toBe(1);
    expect(vm.otherChainCount).toBe(2);
  });

  it('counts only the protocols whose authority can actually answer', async () => {
    const subject = component(
      registry([
        protocol({ id: 'ordinals', releaseStatus: 'VERIFIED READ ONLY', indexerAuthority: 'ord' }),
        protocol({ id: 'runes', family: 'RUNES', releaseStatus: 'VERIFIED READ ONLY', indexerAuthority: 'index-runes' }),
        protocol({ id: 'brc20', family: 'OTHER', releaseStatus: 'BLOCKED', indexerAuthority: 'index-brc20' }),
      ]),
      {
        generatedAt: 'now',
        sources: [
          source({ authorityId: 'ord' }),
          // Implemented and configured, but rebuilding its index.
          source({ authorityId: 'index-runes', status: 'stale', lagBlocks: '653560' }),
        ],
      },
    );
    const vm = await settled(subject);
    expect(vm.liveCount).toBe(1);
    expect(vm.totalCount).toBe(3);
  });

  it('renders the registry even when the live source snapshot fails', async () => {
    const readable = protocol({ releaseStatus: 'VERIFIED READ ONLY' });
    const subject = component(registry([readable]), new Error('sources down'));
    const vm = await settled(subject);
    expect(vm.error).toBe(false);
    expect(vm.groups).toHaveLength(1);
    expect(vm.sourcesByAuthority).toBeNull();
    // The registry is intact; what the authority can answer is unknown, not
    // "not served here" and not readable.
    expect(subject.availability(readable, vm.sourcesByAuthority)).toBe('unknown');
    expect(vm.liveCount).toBe(0);
  });

  it('announces loading before every attempt, with the network the request is addressed to', async () => {
    const subject = component(registry([protocol()]), undefined, 'signet');
    const seen: DirectoryViewModel[] = [];
    subject.vm$.subscribe((vm) => seen.push(vm));
    expect(seen[0]).toEqual({ loading: true, error: false, network: 'signet' });
    expect(seen.at(-1)?.loading).toBe(false);
    expect(seen.at(-1)?.network).toBe('signet');
  });

  it('reaches the error state when the registry never answers, rather than waiting', async () => {
    // The visual gate caught this: the loading fixture hangs every request, and
    // the page sat on its skeleton with nothing left to clear it.
    vi.useFakeTimers();
    try {
      const api = apiOn('mainnet', () => NEVER, () => NEVER);
      const subject = new ProtocolDirectoryComponent(api, seo);
      subject.ngOnInit();
      const seen: DirectoryViewModel[] = [];
      const subscription = subject.vm$.subscribe((vm) => seen.push(vm));
      await vi.advanceTimersByTimeAsync(25_000);
      subscription.unsubscribe();
      expect(seen.at(-1)?.error).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an error when the registry itself fails', async () => {
    const api = apiOn(
      'mainnet',
      () => throwError(() => new Error('registry down')),
      () => of({ generatedAt: 'now', sources: [] }),
    );
    const subject = new ProtocolDirectoryComponent(api, seo);
    subject.ngOnInit();
    const vm = await settled(subject);
    expect(vm.error).toBe(true);
  });
});

describe('ProtocolDirectoryComponent retry', () => {
  const sources: SourcesResponse = { generatedAt: 'now', sources: [source()] };

  /**
   * The audit reproduced this with the bare operators: the registry failure
   * reached a catchError downstream of the retry stream, which completed the
   * whole subscription, and the Retry button then emitted to nothing. One
   * failed read left the page in its error state for good.
   */
  it('reads the registry again when Retry is clicked after a failure', async () => {
    const getProtocols$ = vi.fn()
      .mockReturnValueOnce(throwError(() => new Error('controlled registry outage')))
      .mockReturnValueOnce(of(registry([protocol({ releaseStatus: 'VERIFIED READ ONLY' })])));
    const subject = new ProtocolDirectoryComponent(apiOn('mainnet', getProtocols$, () => of(sources)), seo);
    subject.ngOnInit();
    const seen: DirectoryViewModel[] = [];
    let completed = false;
    subject.vm$.subscribe({ next: (vm) => seen.push(vm), complete: () => { completed = true; } });
    expect(seen.at(-1)?.error).toBe(true);
    expect(completed).toBe(false);

    subject.onRetry();

    expect(getProtocols$).toHaveBeenCalledTimes(2);
    const ready = seen.at(-1);
    expect(ready?.loading).toBe(false);
    expect(ready?.error).toBe(false);
    expect(ready?.totalCount).toBe(1);
    expect(ready?.liveCount).toBe(1);
    // Each attempt announced itself before it resolved.
    expect(seen.filter((vm) => vm.loading)).toHaveLength(2);
  });

  it('cancels the attempt in flight when Retry is clicked again', () => {
    const requests: Subject<ProtocolsResponse>[] = [];
    const getProtocols$ = (): Observable<ProtocolsResponse> => {
      const request = new Subject<ProtocolsResponse>();
      requests.push(request);
      return request;
    };
    const subject = new ProtocolDirectoryComponent(apiOn('mainnet', getProtocols$, () => of(sources)), seo);
    subject.ngOnInit();
    const seen: DirectoryViewModel[] = [];
    subject.vm$.subscribe((vm) => seen.push(vm));
    subject.onRetry();
    subject.onRetry();
    expect(requests).toHaveLength(3);
    expect(requests[0].observed).toBe(false);
    expect(requests[1].observed).toBe(false);
    expect(requests[2].observed).toBe(true);

    // A late answer from a cancelled attempt paints nothing.
    requests[0].next(registry([protocol({ id: 'stale-answer' })]));
    expect(seen.at(-1)?.loading).toBe(true);

    requests[2].next(registry([protocol({ id: 'current-answer' })]));
    expect(seen.at(-1)?.groups?.[0].protocols[0].id).toBe('current-answer');
  });

  it('recovers with Retry after the request budget expired', async () => {
    vi.useFakeTimers();
    try {
      const getProtocols$ = vi.fn()
        .mockReturnValueOnce(NEVER)
        .mockReturnValueOnce(of(registry([protocol()])));
      const subject = new ProtocolDirectoryComponent(apiOn('mainnet', getProtocols$, () => of(sources)), seo);
      subject.ngOnInit();
      const seen: DirectoryViewModel[] = [];
      subject.vm$.subscribe((vm) => seen.push(vm));
      await vi.advanceTimersByTimeAsync(25_000);
      expect(seen.at(-1)?.error).toBe(true);

      subject.onRetry();
      await vi.advanceTimersByTimeAsync(0);
      expect(getProtocols$).toHaveBeenCalledTimes(2);
      expect(seen.at(-1)).toMatchObject({ loading: false, error: false, totalCount: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never keeps an error model as registry data once a network switch answers', () => {
    const network = new BehaviorSubject<string>('mainnet');
    const api = {
      network: 'mainnet',
      selectedNetwork$: () => network,
      getProtocols$: () => network.value === 'mainnet'
        ? throwError(() => new Error('mainnet registry outage'))
        : of(registry([protocol({ networks: ['signet'] })])),
      getSources$: () => of(sources),
    } as unknown as UniverseApiService;
    const subject = new ProtocolDirectoryComponent(api, seo);
    subject.ngOnInit();
    const seen: DirectoryViewModel[] = [];
    subject.vm$.subscribe((vm) => seen.push(vm));
    expect(seen.at(-1)).toEqual({ loading: false, error: true, network: 'mainnet' });
    network.next('signet');
    expect(seen.at(-1)).toMatchObject({ loading: false, error: false, network: 'signet', totalCount: 1 });
  });
});

describe('ProtocolDirectoryComponent network copy', () => {
  const subject = component(registry([]));

  it.each([
    ['mainnet', 'Bitcoin mainnet'],
    ['signet', 'Bitcoin Signet'],
    ['testnet', 'Bitcoin Testnet'],
    ['testnet4', 'Bitcoin Testnet4'],
    ['regtest', 'Bitcoin Regtest'],
  ] as const)('names %s as %s, the network the registry was read from', async (network, label) => {
    const vm = await settled(component(registry([]), undefined, network));
    expect(vm.network).toBe(network);
    expect(subject.networkLabel(vm.network)).toBe(label);
  });

  it('carries the network into the error state too, so the copy above it stays true', async () => {
    const api = apiOn('signet', () => throwError(() => new Error('down')), () => of({ generatedAt: 'now', sources: [] }));
    const failed = new ProtocolDirectoryComponent(api, seo);
    failed.ngOnInit();
    const vm = await settled(failed);
    expect(vm).toEqual({ loading: false, error: true, network: 'signet' });
  });
});

describe('ProtocolDirectoryComponent authority evidence', () => {
  const subject = component(registry([]));

  it('matches a protocol to its authority snapshot', () => {
    const sources = new Map([['index-ordinals', source()]]);
    expect(subject.sourceFor(protocol(), sources)?.authorityId).toBe('index-ordinals');
    expect(subject.sourceFor(protocol({ indexerAuthority: undefined }), sources)).toBeNull();
    expect(subject.sourceFor(protocol({ indexerAuthority: 'index-missing' }), sources)).toBeNull();
    expect(subject.sourceFor(protocol(), null)).toBeNull();
  });

  it('shows where the authority reached, so the label is not taken on trust', () => {
    expect(subject.sourceDetail(source())).toContain('Indexed to block 964103');
  });

  it('says how far behind an authority is when it is behind', () => {
    const detail = subject.sourceDetail(source({ status: 'stale', lagBlocks: '653560' }));
    expect(detail).toContain('653560');
  });

  it('does not report a lag of zero as though it were news', () => {
    expect(subject.sourceDetail(source({ lagBlocks: '0' }))).not.toContain('behind');
  });

  it('surfaces a flapping authority through its failure count', () => {
    expect(subject.sourceDetail(source({ consecutiveFailures: 4 }))).toContain('4');
  });

  it('reads the last check time as epoch seconds, or nothing at all', () => {
    expect(subject.checkedAtSeconds(source({ checkedAt: '2026-08-28T10:00:00.000Z' })))
      .toBe(1787911200);
    expect(subject.checkedAtSeconds(source({ checkedAt: 'not a date' }))).toBeNull();
    expect(subject.checkedAtSeconds(null)).toBeNull();
  });
});
