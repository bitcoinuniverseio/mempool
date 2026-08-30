/**
 * The chain lens, read for the treemap.
 *
 * Every rectangle is one real pending transaction, sized by the space it
 * takes: serialized bytes on both chains, because that is the public,
 * chain-native cost of carrying it. Color follows the known fee rate
 * relative to the rest of the pending set; a transaction whose fee cannot
 * be read from the public side, which is normal for a shielded Zcash
 * transaction, keeps a neutral color rather than pretending a rate.
 */

import { ChainExplorerPayload, ExplorerChain } from '@app/universe/universe.types';

export interface LensItem {
  readonly txid: string;
  readonly sizeBytes: number;
  /** Fee in atomic units, for the tooltip. Null when unknown. */
  readonly feeExact: string | null;
  /** Fee rate in the chain's own unit, for the tooltip. */
  readonly rateLabel: string | null;
  /** Numeric ordering key for coloring. Null when the fee is unknown. */
  readonly rate: number | null;
  readonly shielded: boolean;
  readonly protocol: boolean;
  readonly consolidation: boolean;
  /** When our node first saw it, ISO-8601, or null when unreported. */
  readonly firstSeenAt: string | null;
}

export type LensFilterId =
  | 'all'
  | 'protocol'
  | 'consolidation'
  | 'transparent'
  | 'shielded';

export interface LensFilter {
  readonly id: LensFilterId;
  readonly label: string;
}

const TXID = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number | null {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
    ? Number(value)
    : null;
}

export function readLensItems(payload: ChainExplorerPayload | null): LensItem[] {
  if (!isRecord(payload)) {
    return [];
  }
  const list = Array.isArray(payload.transactions)
    ? payload.transactions
    : Array.isArray(payload.items)
      ? payload.items
      : [];
  const items: LensItem[] = [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.txid !== 'string' || !TXID.test(entry.txid)) {
      continue;
    }
    const sizeBytes = integer(entry.sizeBytesAtomic);
    if (sizeBytes === null || sizeBytes <= 0) {
      continue;
    }
    const fee = isRecord(entry.fee) ? entry.fee : {};
    const feeExact =
      typeof fee.amountAtomic === 'string' && /^(0|[1-9][0-9]*)$/.test(fee.amountAtomic)
        ? fee.amountAtomic
        : null;
    const rateDecimal =
      typeof fee.rateDecimal === 'string' &&
      /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(fee.rateDecimal)
        ? fee.rateDecimal
        : null;
    const rateUnit = typeof fee.rateUnit === 'string' ? fee.rateUnit : null;
    const transparent = isRecord(entry.transparent) ? entry.transparent : {};
    const inputs = Array.isArray(transparent.inputs) ? transparent.inputs.length : 0;
    const outputs = Array.isArray(transparent.outputs) ? transparent.outputs.length : 0;
    const protocolActions = isRecord(entry.protocolActions) ? entry.protocolActions : {};
    const candidates = Array.isArray(protocolActions.candidates)
      ? protocolActions.candidates.length
      : 0;
    items.push({
      txid: entry.txid,
      sizeBytes,
      feeExact,
      rateLabel: rateDecimal && rateUnit ? `${rateDecimal} ${rateUnit}` : null,
      rate: rateDecimal !== null ? Number(rateDecimal) : null,
      shielded: isRecord(entry.shielded),
      protocol: candidates > 0,
      consolidation: inputs >= 3 && outputs <= 2 && inputs > outputs,
      firstSeenAt:
        typeof entry.firstSeenAt === 'string' ? entry.firstSeenAt : null,
    });
  }
  return items;
}

export function lensFilters(chain: ExplorerChain): LensFilter[] {
  if (chain === 'zcash') {
    return [
      { id: 'all', label: $localize`:@@universe.lens.filter-all:All` },
      {
        id: 'transparent',
        label: $localize`:@@universe.lens.filter-transparent:Transparent`,
      },
      {
        id: 'shielded',
        label: $localize`:@@universe.lens.filter-shielded:Shielded`,
      },
      {
        id: 'protocol',
        label: $localize`:@@universe.lens.filter-protocol:Protocols`,
      },
    ];
  }
  return [
    { id: 'all', label: $localize`:@@universe.lens.filter-all-doge:All` },
    {
      id: 'consolidation',
      label: $localize`:@@universe.lens.filter-consolidation:Consolidation`,
    },
    {
      id: 'protocol',
      label: $localize`:@@universe.lens.filter-protocol-doge:Protocols`,
    },
  ];
}

export function applyLensFilter(
  items: readonly LensItem[],
  filter: LensFilterId
): LensItem[] {
  switch (filter) {
    case 'protocol':
      return items.filter((item) => item.protocol);
    case 'consolidation':
      return items.filter((item) => item.consolidation);
    case 'transparent':
      return items.filter((item) => !item.shielded);
    case 'shielded':
      return items.filter((item) => item.shielded);
    default:
      return [...items];
  }
}
