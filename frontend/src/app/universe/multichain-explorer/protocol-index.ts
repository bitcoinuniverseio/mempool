/**
 * The chain protocols index, read as a designed page.
 *
 * The payload is the registry manifest for one chain beside the operational
 * status of every authority serving it. The generic path dumped both: the
 * registry rows as a seven-column table and each authority as a run of
 * "Confirmed history configured: No" facts, which is a reader's job to
 * reassemble. This reading keeps every one of those facts and gives each
 * its place: what each protocol is and where its page is, then what each
 * authority reports about itself, verdict first and evidence beside it.
 *
 * Nothing is softened on the way through: a BLOCKED release status renders
 * as not yet verified, a configuration failure is shown under the code the
 * authority reported, and a status this build has no words for is shown as
 * itself.
 */

import type { ChainProfile } from './multichain-view';
import {
  ExactNumber,
  formatElapsed,
  formatExactInteger,
  humanizeFieldName,
} from './multichain-view';

export type IndexTone = 'proven' | 'partial' | 'neutral' | 'unavailable';

export interface ProtocolIndexRow {
  readonly id: string;
  readonly displayName: string;
  /** The explorer page for it, or null when this build has none. */
  readonly routeId: string | null;
  readonly releaseLabel: string;
  readonly releaseTone: IndexTone;
  readonly authorityId: string | null;
  readonly coverageLabel: string | null;
}

export interface AuthorityStatusReading {
  /** The payload field this came from, for the skip list. */
  readonly key: string;
  readonly label: string;
  readonly authorityId: string | null;
  readonly stateLabel: string;
  readonly tone: IndexTone;
  /** The failure code the authority reported, exactly. */
  readonly failureCode: string | null;
  readonly lastSuccess: string | null;
  readonly checkpointHeight: ExactNumber | null;
}

export interface ProtocolIndexReading {
  readonly rows: readonly ProtocolIndexRow[];
  readonly authorities: readonly AuthorityStatusReading[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The registry's own vocabulary, translated without being softened.
 * BLOCKED is a policy veto: the integration has not been verified, so the
 * registry refuses to call the protocol readable no matter how healthy the
 * authority looks.
 */
function releaseReading(status: string | null): { label: string; tone: IndexTone } {
  const normalized = (status ?? '').toUpperCase().replace(/[_-]+/g, ' ').trim();
  if (normalized === 'VERIFIED READ ONLY') {
    return {
      label: $localize`:@@universe.protoindex.release-verified:Verified, read only`,
      tone: 'proven',
    };
  }
  if (normalized === 'BLOCKED') {
    return {
      label: $localize`:@@universe.protoindex.release-blocked:Not yet verified`,
      tone: 'unavailable',
    };
  }
  if (normalized === 'INTENTIONALLY DISABLED') {
    return {
      label: $localize`:@@universe.protoindex.release-disabled:Disabled on purpose`,
      tone: 'neutral',
    };
  }
  return { label: status ?? '', tone: 'neutral' };
}

function stateReading(record: Record<string, unknown>): {
  label: string;
  tone: IndexTone;
} {
  if (record.configured === false) {
    return {
      label: $localize`:@@universe.protoindex.state-unconfigured:Not configured`,
      tone: 'unavailable',
    };
  }
  const state = text(record.state);
  switch (state) {
    case 'ready':
      return { label: $localize`:@@universe.protoindex.state-ready:Answering`, tone: 'proven' };
    case 'degraded':
      return { label: $localize`:@@universe.protoindex.state-degraded:Degraded`, tone: 'partial' };
    case 'unavailable':
      return { label: $localize`:@@universe.protoindex.state-unavailable:Not answering`, tone: 'unavailable' };
  }
  if (state !== null) {
    // A state this build has no words for is shown as itself.
    return { label: state, tone: 'neutral' };
  }
  if (record.running === false) {
    return { label: $localize`:@@universe.protoindex.state-idle:Configured, not polling`, tone: 'partial' };
  }
  return { label: $localize`:@@universe.protoindex.state-configured:Configured`, tone: 'neutral' };
}

function checkpointHeightFrom(record: Record<string, unknown>): ExactNumber | null {
  const checkpoint = isRecord(record.checkpoint) ? record.checkpoint : null;
  const snapshot = isRecord(record.snapshot) ? record.snapshot : null;
  const tip =
    (checkpoint && text(checkpoint.heightAtomic)) ??
    (snapshot && isRecord(snapshot.tip) ? text(snapshot.tip.heightAtomic) : null);
  return formatExactInteger(tip);
}

/**
 * The chain protocols index. Returns null for anything that is not a
 * registry manifest page, so everything else keeps the reading it had.
 */
export function readProtocolIndex(
  payload: unknown,
  profile: ChainProfile,
  now: number
): ProtocolIndexReading | null {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return null;
  }
  const items = payload.items.filter(isRecord);
  if (
    !items.length ||
    !items.every(
      (item) => item.schemaVersion === 'universe-explorer-protocol-v1'
    )
  ) {
    return null;
  }

  const rows: ProtocolIndexRow[] = items.map((item) => {
    const id = text(item.id) ?? '';
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [];
    const tab = profile.protocols.find(
      (candidate) =>
        candidate.registryIds.includes(id) ||
        aliases.some((alias) => candidate.registryIds.includes(alias)) ||
        candidate.id === id
    );
    const release = releaseReading(text(item.releaseStatus));
    const coverage = text(item.coverage);
    return {
      id,
      displayName: text(item.displayName) ?? id,
      routeId: tab?.id ?? null,
      releaseLabel: release.label,
      releaseTone: release.tone,
      authorityId: text(item.indexerAuthority),
      coverageLabel:
        coverage === 'unknown'
          ? $localize`:@@universe.protoindex.coverage-unknown:Coverage not established`
          : coverage,
    };
  });

  const authorities: AuthorityStatusReading[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!isRecord(value) || typeof value.configured !== 'boolean') {
      continue;
    }
    const state = stateReading(value);
    authorities.push({
      key,
      label: humanizeFieldName(key),
      authorityId: text(value.authorityId),
      stateLabel: state.label,
      tone: state.tone,
      failureCode:
        text(value.configurationFailure) ?? text(value.lastFailureKind),
      lastSuccess: formatElapsed(text(value.lastSuccessAt), now),
      checkpointHeight: checkpointHeightFrom(value),
    });
  }

  return { rows, authorities };
}
