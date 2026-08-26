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

describe('ProtocolDirectoryComponent release status', () => {
  const subject = component(registry([]));

  it('names the statuses the registry actually emits', () => {
    expect(subject.releaseStatusLabel(protocol({ releaseStatus: 'VERIFIED READ ONLY' })))
      .toBe('Live, read only');
    expect(subject.releaseStatusLabel(protocol({ releaseStatus: 'PRODUCTION VERIFIED' })))
      .toBe('Live');
    expect(subject.releaseStatusLabel(protocol({ releaseStatus: 'BLOCKED' })))
      .toBe('Not yet available');
    expect(subject.releaseStatusLabel(protocol({ releaseStatus: 'INTENTIONALLY DISABLED' })))
      .toBe('Disabled');
  });

  it('gives a verified protocol its own chip rather than the neutral one', () => {
    expect(subject.releaseStatusClass(protocol({ releaseStatus: 'VERIFIED READ ONLY' })))
      .toBe('chip-live');
    expect(subject.releaseStatusClass(protocol({ releaseStatus: 'PRODUCTION VERIFIED' })))
      .toBe('chip-production');
    expect(subject.releaseStatusClass(protocol({ releaseStatus: 'BLOCKED' })))
      .toBe('chip-blocked');
  });

  it('falls back readably for a status it has not seen', () => {
    const unseen = protocol({ releaseStatus: 'PENDING_REVIEW' as never });
    expect(subject.releaseStatusLabel(unseen)).toBe('Pending review');
    expect(subject.releaseStatusClass(unseen)).toBe('chip-unknown');
    expect(subject.releaseStatusLabel(protocol({ releaseStatus: '' as never })))
      .toBe('Status unknown');
  });

  it('counts a protocol as live only when it is verified', () => {
    expect(subject.isLive(protocol({ releaseStatus: 'VERIFIED READ ONLY' }))).toBe(true);
    expect(subject.isLive(protocol({ releaseStatus: 'PRODUCTION VERIFIED' }))).toBe(true);
    expect(subject.isLive(protocol({ releaseStatus: 'BLOCKED' }))).toBe(false);
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

  it('counts how many protocols are readable today', async () => {
    const subject = component(
      registry([
        protocol({ id: 'ordinals', releaseStatus: 'VERIFIED READ ONLY' }),
        protocol({ id: 'runes', family: 'RUNES', releaseStatus: 'VERIFIED READ ONLY' }),
        protocol({ id: 'brc20', family: 'OTHER', releaseStatus: 'BLOCKED' }),
      ]),
    );
    const vm = await firstValueFrom(subject.vm$);
    expect(vm.liveCount).toBe(2);
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

describe('ProtocolDirectoryComponent authority status', () => {
  const subject = component(registry([]));

  it('matches a protocol to its authority snapshot', () => {
    const sources = new Map([['index-ordinals', source()]]);
    expect(subject.sourceFor(protocol(), sources)?.authorityId).toBe('index-ordinals');
    expect(subject.sourceFor(protocol({ indexerAuthority: undefined }), sources)).toBeNull();
    expect(subject.sourceFor(protocol({ indexerAuthority: 'index-missing' }), sources)).toBeNull();
    expect(subject.sourceFor(protocol(), null)).toBeNull();
  });

  it('states the checkpoint a ready authority is at', () => {
    expect(subject.sourceLabel(source())).toBe('Authority ready at block 964103');
    expect(subject.sourceLabel(source({ checkpoint: null }))).toBe('Authority ready');
    expect(subject.sourceClass(source())).toBe('chip-live');
  });

  it('distinguishes a missing configuration from a broken authority', () => {
    const unconfigured = source({ ready: false, status: 'unconfigured', checkpoint: null });
    expect(subject.sourceLabel(unconfigured)).toBe('Authority not configured here');
    expect(subject.sourceClass(unconfigured)).toBe('chip-unknown');

    const unreachable = source({ ready: false, status: 'unreachable', checkpoint: null });
    expect(subject.sourceLabel(unreachable)).toBe('Authority unreachable');
    expect(subject.sourceClass(unreachable)).toBe('chip-blocked');

    const stale = source({ ready: false, status: 'stale', checkpoint: null });
    expect(subject.sourceLabel(stale)).toBe('Authority behind the chain tip');
  });
});
