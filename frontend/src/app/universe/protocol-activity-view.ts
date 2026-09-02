/**
 * Reads one protocol activity page the way a reader needs it.
 *
 * The authority's records keep each protocol's own field names, so the
 * reader's job is not to normalize the protocols into one shape: it is to
 * find, per record, the few keys every feed row really has (an identity, an
 * event kind, a transaction, a height) without inventing any of them. A
 * record whose keys this build does not know is rendered as itself, never
 * flattened into guessed columns.
 */

import { ExplorerProtocolActivityPage } from './universe.types';

export interface ProtocolActivityRow {
  /** Stable identity for tracking; null when the record carries none. */
  readonly id: string | null;
  /** The event kind exactly as the authority named it. */
  readonly kind: string | null;
  readonly txid: string | null;
  /** Block height as an exact decimal string, as issued. */
  readonly heightAtomic: string | null;
  /** How many keys the record carries that this reading did not name. */
  readonly unnamedFields: number;
  readonly record: Record<string, unknown>;
}

const IDENTITY_KEYS = ['eventId', 'event_id', 'id', 'assetId', 'asset_id'];
const KIND_KEYS = ['kind', 'type', 'eventType', 'event_type', 'action'];
const TXID_KEYS = ['txid', 'transactionId', 'transaction_id', 'anchor_txid', 'anchorTxid'];
const HEIGHT_KEYS = ['heightAtomic', 'height', 'blockHeight', 'block_height', 'blockHeightAtomic'];

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {return value;}
    if (typeof value === 'number' && Number.isSafeInteger(value)) {return String(value);}
  }
  return null;
}

export function readActivityRows(
  records: readonly Record<string, unknown>[],
): ProtocolActivityRow[] {
  return records.map((record) => {
    const named = new Set([...IDENTITY_KEYS, ...KIND_KEYS, ...TXID_KEYS, ...HEIGHT_KEYS]);
    let unnamedFields = 0;
    for (const key of Object.keys(record)) {
      if (!named.has(key)) {unnamedFields += 1;}
    }
    return {
      id: firstString(record, IDENTITY_KEYS),
      kind: firstString(record, KIND_KEYS),
      txid: firstString(record, TXID_KEYS),
      heightAtomic: firstString(record, HEIGHT_KEYS),
      unnamedFields,
      record,
    };
  });
}

/**
 * The one-line summary a protocol page leads with.
 *
 * A page that says zero rows means zero rows: it is only served when the
 * authority itself answered. Every other state says what is missing instead
 * of implying emptiness.
 */
export function activitySummary(
  page: ExplorerProtocolActivityPage,
): string {
  switch (page.state) {
    case 'served': {
      const events = page.events.length;
      const assets = page.assets.length;
      const invalidations = page.invalidations.length;
      const parts: string[] = [];
      if (events > 0) {parts.push(`${events} event${events === 1 ? '' : 's'}`);}
      if (assets > 0) {parts.push(`${assets} asset${assets === 1 ? '' : 's'}`);}
      if (invalidations > 0) {
        parts.push(`${invalidations} invalidation${invalidations === 1 ? '' : 's'}`);
      }
      if (parts.length === 0) {
        return 'The authority answered: no activity in this page of its feed.';
      }
      return `The authority answered: ${parts.join(', ')} in this page of its feed.`;
    }
    case 'unconfigured':
      return 'No authority for this protocol is configured in this deployment, so its activity is not shown.';
    case 'unavailable':
      return page.degradedReason
        ?? 'The authority could not answer, so its activity is not shown.';
    case 'unsupported':
      return 'This protocol has no activity feed this explorer reads yet.';
  }
}
