// FE-D06: the directory and the detail page derive availability from one rule.
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, filter, firstValueFrom, of, throwError } from 'rxjs';
import { ProtocolDirectoryComponent } from '@app/universe/protocol-directory/protocol-directory.component';
import { ProtocolDetailComponent } from '@app/universe/protocol-detail/protocol-detail.component';
import { protocolAvailability } from '@app/universe/protocol-availability';
import type { UniverseApiService } from '@app/universe/universe-api.service';
import type { SeoService } from '@app/services/seo.service';
import type {
  ExplorerProtocolDefinition,
  ProtocolsResponse,
  SourceEntry,
  SourcesResponse,
} from '@app/universe/universe.types';

function definition(overrides: Partial<ExplorerProtocolDefinition> = {}): ExplorerProtocolDefinition {
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
    implementedReadOperations: ['registry', 'activity'],
    authorizedReadOperations: [],
    releaseStatus: 'VERIFIED READ ONLY',
    indexerAuthority: 'index-ordinals',
    coverage: 'unknown',
    ...overrides,
  };
}

function sourceEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
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

/** Snapshot variants: null is a snapshot that could not be read at all. */
const unreachable = sourceEntry({ ready: false, status: 'unreachable', checkpoint: null });
const stale = sourceEntry({ status: 'stale', lagBlocks: '653560' });

const variants: [string, ExplorerProtocolDefinition, SourceEntry[] | null, string][] = [
  ['registry-verified reader, authority unreachable', definition(), [unreachable], 'unreachable'],
  ['production-verified reader, authority unreachable', definition({ releaseStatus: 'PRODUCTION VERIFIED' }), [unreachable], 'unreachable'],
  ['blocked reader with a read operation, authority unreachable', definition({ releaseStatus: 'BLOCKED' }), [unreachable], 'unreachable'],
  ['disabled protocol', definition({ releaseStatus: 'INTENTIONALLY DISABLED' }), [unreachable], 'disabled'],
  ['unconfigured authority', definition(), [], 'unconfigured'],
  ['authority reports itself unconfigured', definition(), [sourceEntry({ status: 'unconfigured', checkpoint: null })], 'unconfigured'],
  ['snapshot unreadable', definition(), null, 'unknown'],
  ['release status unknown', definition({ releaseStatus: '' as never }), [sourceEntry()], 'unknown'],
  ['stale authority', definition(), [stale], 'catching-up'],
  ['ready authority', definition(), [sourceEntry()], 'available'],
];

function snapshot(sources: SourceEntry[] | null): () => ReturnType<UniverseApiService['getSources$']> {
  return () => sources === null
    ? throwError(() => new Error('sources down'))
    : of<SourcesResponse>({ generatedAt: 'now', sources });
}

async function directoryAvailability(protocol: ExplorerProtocolDefinition, sources: SourceEntry[] | null): Promise<string> {
  const api = {
    network: 'mainnet',
    selectedNetwork$: () => of('mainnet'),
    getProtocols$: () => of<ProtocolsResponse>({ registryVersion: '1.0.0', primaryStrip: [], protocols: [protocol] }),
    getSources$: snapshot(sources),
  } as unknown as UniverseApiService;
  const directory = new ProtocolDirectoryComponent(api, { setTitle: () => undefined } as unknown as SeoService);
  directory.ngOnInit();
  const vm = await firstValueFrom(directory.vm$.pipe(filter((value) => !value.loading)));
  return directory.availability(protocol, vm.sourcesByAuthority);
}

function detailAvailability(protocol: ExplorerProtocolDefinition, sources: SourceEntry[] | null): string {
  const api = {
    getProtocols$: () => of<ProtocolsResponse>({ registryVersion: '1.0.0', primaryStrip: [], protocols: [protocol] }),
    getSources$: snapshot(sources),
    getProtocolActivity$: () => of({ state: 'unavailable', events: [], assets: [], invalidations: [], hasMore: false }),
    getProtocolObjects$: () => of({ state: 'unavailable', items: [] }),
  };
  const detail = new ProtocolDetailComponent(
    { paramMap: new BehaviorSubject({ get: () => protocol.id }) } as never,
    api as never,
    { start: vi.fn(), stop: vi.fn(), state$: of({ checked: 0, protocolCounts: new Map(), recent: [] }) } as never,
    { preferences$: of({ pinnedProtocols: [] }), recordVisit: vi.fn() } as never,
    { setTitle: vi.fn() } as never,
  );
  detail.ngOnInit();
  let availability = '';
  detail.vm$.subscribe((vm) => { if (vm.kind === 'ready') {availability = vm.availability;} });
  detail.ngOnDestroy();
  return availability;
}

describe('Protocol availability is one rule for the directory and the detail page', () => {
  it.each(variants)('%s', async (_name, protocol, sources, expected) => {
    const map = sources === null ? null : new Map(sources.map((entry) => [entry.authorityId, entry]));
    expect(protocolAvailability(protocol, map)).toBe(expected);
    expect(await directoryAvailability(protocol, sources)).toBe(expected);
    expect(detailAvailability(protocol, sources)).toBe(expected);
  });
});
