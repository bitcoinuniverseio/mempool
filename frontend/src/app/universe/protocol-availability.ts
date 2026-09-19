import { ExplorerProtocolDefinition, SourceEntry } from '@app/universe/universe.types';

/** What a protocol can answer for right now, as opposed to what it implements. */
export type ProtocolAvailability =
  | 'available'
  | 'catching-up'
  | 'degraded'
  | 'unreachable'
  | 'unconfigured'
  | 'not-implemented'
  | 'disabled'
  | 'unknown';

/** Authority snapshot keyed by authority id; null when the snapshot could not be read. */
export type SourcesByAuthority = ReadonlyMap<string, SourceEntry> | null;

/** The registry release status, lower-cased with separators collapsed to spaces. */
export function normalizeReleaseStatus(protocol: ExplorerProtocolDefinition): string {
  return (protocol.releaseStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
}

/**
 * Whether the registry declares a reader beyond the registry entry itself.
 * Every protocol has a registry row; only a data read makes it implemented.
 */
export function hasReadOperations(protocol: ExplorerProtocolDefinition): boolean {
  const declared = new Set<string>([
    ...(protocol.implementedReadOperations ?? []),
    ...((protocol.readOperationDescriptors ?? []).map((operation) => operation.id)),
  ]);
  declared.delete('registry');
  return declared.size > 0;
}

/** The authority snapshot entry behind a protocol, or null when there is none. */
export function sourceForProtocol(
  protocol: ExplorerProtocolDefinition,
  sources: SourcesByAuthority,
): SourceEntry | null {
  if (!sources || !protocol.indexerAuthority) {
    return null;
  }
  return sources.get(protocol.indexerAuthority) ?? null;
}

/**
 * What this protocol can answer for right now.
 *
 * The registry says what a protocol is implemented to do; the source snapshot
 * says whether the authority behind it can answer at all. The directory and
 * the detail page share this one rule so the same unreachable authority can
 * never read as "Unavailable" on one page and "Readable" on the other.
 */
/**
 * IMPLEMENTATION-HANDOFF [FE-READINESS-03] | every authority-dependent row.
 * Verified: ready with a checkpoint is readable, stale is catching-up, and
 * unconfigured/unreachable remain unavailable. These are runtime observations.
 * Prerequisites: BE source-health fixes and authority checkpoint reconciliation.
 * 1. Keep this shared state machine independent of functional coverage; repair
 *    the authority/configuration cause rather than converting stale to ready.
 * 2. Validate source identity, selected chain/network, checkpoint and observation
 *    freshness in the owning backend; propagate explicit degraded reasons.
 * 3. Extend protocol-availability.spec.ts for missing/expired checkpoints and
 *    chain/network mismatches after the source contract defines these outcomes.
 * 4. Verify directory and detail agree across outages, catch-up, recovery and
 *    network changes. Record deployed revision and public operational snapshot.
 * Mainnet health observation is not transaction testing or an E2E PASS.
 * Preserve read-only behavior and existing legitimate supported networks.
 */
export function protocolAvailability(
  protocol: ExplorerProtocolDefinition,
  sources: SourcesByAuthority,
): ProtocolAvailability {
  const status = normalizeReleaseStatus(protocol);
  if (status === 'intentionally disabled') return 'disabled';
  // A blocked release says acceptance has not been established. It says
  // nothing about whether a reader exists: Mezcal was labelled "Not
  // implemented" while its authority served a real activity page. Only a
  // protocol that declares no read operation at all is not implemented.
  if (status === 'blocked' && !hasReadOperations(protocol)) return 'not-implemented';
  if (status !== 'blocked' && status !== 'verified read only' && status !== 'production verified') {
    return 'unknown';
  }
  // The registry says this protocol has a reader, so the authority decides.
  if (!sources) return 'unknown';
  const source = sourceForProtocol(protocol, sources);
  if (!source) return 'unconfigured';
  switch (source.status) {
    case 'ready': return source.checkpoint ? 'available' : 'degraded';
    case 'stale': return 'catching-up';
    case 'unreachable': return 'unreachable';
    case 'unconfigured': return 'unconfigured';
    default: return 'degraded';
  }
}

export function availabilityLabel(availability: ProtocolAvailability): string {
  switch (availability) {
    case 'available': return $localize`:@@universe.protocols.availability-available:Readable now`;
    case 'catching-up': return $localize`:@@universe.protocols.availability-catching-up:Catching up`;
    case 'degraded': return $localize`:@@universe.protocols.availability-degraded:Unavailable`;
    case 'unreachable': return $localize`:@@universe.protocols.availability-unreachable:Unavailable`;
    case 'unconfigured': return $localize`:@@universe.protocols.availability-unconfigured:Not served here`;
    case 'not-implemented': return $localize`:@@universe.protocols.availability-not-implemented:Not yet available`;
    case 'disabled': return $localize`:@@universe.protocols.availability-disabled:Disabled`;
    default: return $localize`:@@universe.protocols.availability-unknown:Status unknown`;
  }
}
