import { describe, expect, it } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ProtocolDirectoryComponent } from '@app/universe/protocol-directory/protocol-directory.component';
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

function component(
  protocols: ProtocolsResponse,
  sources: SourcesResponse | Error = { generatedAt: 'now', sources: [] },
): ProtocolDirectoryComponent {
  const api = {
    getProtocols$: () => of(protocols),
    getSources$: () =>
      sources instanceof Error ? throwError(() => sources) : of(sources),
  } as unknown as UniverseApiService;
  const subject = new ProtocolDirectoryComponent(api, seo);
  subject.ngOnInit();
  return subject;
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
    expect(subject.availability(protocol({ releaseStatus: 'BLOCKED' }), sourcesWith(source())))
      .toBe('not-implemented');
    expect(subject.availability(protocol({ releaseStatus: 'INTENTIONALLY DISABLED' }), null))
      .toBe('disabled');
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
    const vm = await firstValueFrom(subject.vm$);
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
    const vm = await firstValueFrom(subject.vm$);
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
    const vm = await firstValueFrom(subject.vm$);
    expect(vm.liveCount).toBe(1);
    expect(vm.totalCount).toBe(3);
  });

  it('renders the registry even when the live source snapshot fails', async () => {
    const subject = component(registry([protocol()]), new Error('sources down'));
    const vm = await firstValueFrom(subject.vm$);
    expect(vm.error).toBe(false);
    expect(vm.groups).toHaveLength(1);
    expect(vm.sourcesByAuthority).toBeNull();
  });

  it('reports an error when the registry itself fails', async () => {
    const api = {
      getProtocols$: () => throwError(() => new Error('registry down')),
      getSources$: () => of({ generatedAt: 'now', sources: [] }),
    } as unknown as UniverseApiService;
    const subject = new ProtocolDirectoryComponent(api, seo);
    subject.ngOnInit();
    const vm = await firstValueFrom(subject.vm$);
    expect(vm.error).toBe(true);
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
