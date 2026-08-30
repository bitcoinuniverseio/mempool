/**
 * Shared evidence vocabulary.
 *
 * Every Universe surface has to say the same thing about the same state, or
 * the product stops being trustworthy. These helpers are the single source of
 * that wording. They are pure so they can be asserted directly in tests.
 */

import {
  ExplorerOutpointPosition,
  OutpointEnrichment,
  OutpointEnrichmentStatus,
} from '@app/universe/universe.types';

/**
 * The five tones the design system defines. `neutral` is the one for a fact
 * that carries no evidence claim at all, which is different from a claim that
 * could not be established: a chain that never answered has not answered "no".
 */
export type EvidenceTone =
  | 'proven'
  | 'partial'
  | 'pending'
  | 'unavailable'
  | 'neutral';

export interface EvidenceView {
  readonly tone: EvidenceTone;
  readonly label: string;
  /** One sentence a non-expert can act on. */
  readonly detail: string;
}

/**
 * What an outpoint enrichment actually proves.
 *
 * The distinction that matters most: `ok` with no positions is a proven
 * negative ("nothing is attached"), while `unavailable` is an absence of
 * knowledge. Collapsing the two into an empty list would be a lie.
 */
export function outpointEvidence(result: OutpointEnrichment): EvidenceView {
  switch (result.status as OutpointEnrichmentStatus) {
    case 'ok':
      if (result.unknownAttachments) {
        return {
          tone: 'partial',
          label: $localize`:@@universe.outpoint.partial:Partly proven`,
          detail: $localize`:@@universe.outpoint.partial-detail:The asset authority answered, but could not account for every attachment on this output.`,
        };
      }
      return {
        tone: 'proven',
        label: $localize`:@@universe.outpoint.proven:Proven`,
        detail: result.positions.length
          ? $localize`:@@universe.outpoint.proven-detail:The asset authority confirmed exactly what this output carries at the block below.`
          : $localize`:@@universe.outpoint.proven-empty-detail:The asset authority confirmed this output carries no supported assets at the block below.`,
      };
    case 'not-indexed':
      return {
        tone: 'partial',
        label: $localize`:@@universe.outpoint.not-indexed:Outside coverage`,
        detail: $localize`:@@universe.outpoint.not-indexed-detail:The asset authority keeps no inventory for this output, so what it carries is not proven here.`,
      };
    case 'stale':
      return {
        tone: 'partial',
        label: $localize`:@@universe.outpoint.stale:Chain moved`,
        detail: $localize`:@@universe.outpoint.stale-detail:A new block arrived while this output was being read. Reload to get a single consistent answer.`,
      };
    case 'unconfigured':
      return {
        tone: 'unavailable',
        label: $localize`:@@universe.outpoint.unconfigured:Not configured`,
        detail: $localize`:@@universe.outpoint.unconfigured-detail:This deployment has no asset authority configured, so protocol assets are not shown.`,
      };
    case 'malformed':
      return {
        tone: 'unavailable',
        label: $localize`:@@universe.outpoint.malformed:Unreadable answer`,
        detail: $localize`:@@universe.outpoint.malformed-detail:The asset authority replied with something this explorer refuses to trust.`,
      };
    default:
      return {
        tone: 'unavailable',
        label: $localize`:@@universe.outpoint.unavailable:Authority unavailable`,
        detail: $localize`:@@universe.outpoint.unavailable-detail:The asset authority could not be reached. Nothing is claimed about this output while that is true.`,
      };
  }
}

/** Groups positions by protocol so one output reads as a short list, not a table. */
export interface ProtocolGroup {
  readonly protocolId: string;
  readonly positions: readonly ExplorerOutpointPosition[];
}

export function groupPositionsByProtocol(
  positions: readonly ExplorerOutpointPosition[],
): ProtocolGroup[] {
  const groups = new Map<string, ExplorerOutpointPosition[]>();
  for (const position of positions ?? []) {
    const id = position.asset?.protocolId || 'unknown';
    if (!groups.has(id)) {groups.set(id, []);}
    groups.get(id).push(position);
  }
  return [...groups.entries()]
    .map(([protocolId, entries]) => ({ protocolId, positions: entries }))
    .sort((a, b) => a.protocolId.localeCompare(b.protocolId));
}

/**
 * Formats an atomic integer amount with a decimal point, without ever using
 * floating point. Asset supplies exceed the safe integer range, so the whole
 * pipeline keeps them as decimal strings and so does this.
 */
export function formatAtomicAmount(atomic: string, decimals = 0): string {
  // Negatives are accepted because one real amount in the contract is signed:
  // a Zcash transaction's value balance, the net movement between the
  // transparent and shielded pools. Rejecting it printed nothing at all.
  if (typeof atomic !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(atomic)) {return '';}
  const negative = atomic.startsWith('-');
  const digits = negative ? atomic.slice(1) : atomic;
  const sign = negative ? '-' : '';
  if (!Number.isInteger(decimals) || decimals <= 0 || decimals > 38) {
    return sign + groupDigits(digits);
  }
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction
    ? `${sign}${groupDigits(whole)}.${fraction}`
    : sign + groupDigits(whole);
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Short, readable form of a 64 character identifier. */
export function shortenIdentifier(value: string, keep = 8): string {
  if (typeof value !== 'string' || value.length <= keep * 2 + 1) {return value ?? '';}
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
