import {
  PresentedQuantity,
  groupIntegerDigits,
  presentQuantity,
  shortenAssetId,
} from '@app/universe/asset-summary/asset-summary.presentation';
import {
  AssetInventory,
  InventoryAsset,
  InventoryBalance,
  InventoryCheckpoint,
  InventoryClassification,
  InventoryCoverage,
  InventoryCoverageState,
  InventoryEvent,
  InventoryPlacement,
  InventoryScopeKind,
  InventorySide,
} from './asset-inventory.types';

/**
 * The display model for one asset inventory, built once per merged response.
 *
 * Sections follow the data: a protocol, then each subprotocol the producer
 * grouped under it. Rows reference the deduplicated asset list, so an
 * inscription classified by Ordinals and by BRC-20 appears in both views but is
 * counted once in the distinct total, and its quantity is computed once from
 * its own placements. Quantities stay strings and are summed with BigInt only
 * within one asset and one side.
 */

/** Fallback display names, used only when the registry has no entry. */
const PROTOCOL_NAMES: Readonly<Record<string, string>> = {
  ordinals: 'Ordinals',
  rare_sats: 'Rare sats',
  names: 'Names',
  bitmap: 'Bitmap',
  brc20: 'BRC-20',
  tap: 'TAP',
  dmt: 'DMT',
  unat: 'UNAT',
  dust20: 'DUST-20',
  block20: 'BLOCK-20',
};

export interface CoverageRow {
  readonly protocolId: string;
  readonly name: string;
  readonly state: InventoryCoverageState;
  readonly stateLabel: string;
  readonly reasons: readonly string[];
  readonly sourceId: string | null;
  readonly checkpoint: InventoryCheckpoint | null;
  /** What the inventory may claim for this protocol, never a bare zero. */
  readonly findingLabel: string;
  readonly retryable: boolean;
}

export interface ClassificationRow {
  readonly id: string;
  readonly protocolId: string;
  readonly protocolName: string;
  readonly subprotocolId: string | null;
  readonly label: string | null;
  readonly relation: string | null;
  readonly amount: PresentedQuantity | null;
  readonly unit: string | null;
}

export interface PlacementRow {
  readonly id: string;
  readonly side: InventorySide;
  readonly sideLabel: string;
  readonly txid: string;
  readonly index: number | null;
  readonly outpoint: string | null;
  readonly amount: PresentedQuantity;
  readonly offsetAtomic: string | null;
}

export interface BalanceRow {
  readonly overall: PresentedQuantity;
  readonly available: PresentedQuantity | null;
  readonly reserved: PresentedQuantity | null;
  readonly outpoints: readonly string[];
}

export interface SideTotals {
  readonly input: PresentedQuantity | null;
  readonly output: PresentedQuantity | null;
  readonly fee: PresentedQuantity | null;
}

export interface AssetRow {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly nativeId: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly unit: string;
  readonly decimals: number | null;
  readonly link: unknown[] | null;
  readonly sat: InventoryAsset['sat'];
  readonly inscription: InventoryAsset['inscription'];
  readonly classifications: readonly ClassificationRow[];
  /** Classifications that place this asset in the section it is shown under. */
  readonly facets: readonly ClassificationRow[];
  readonly placements: readonly PlacementRow[];
  readonly totals: SideTotals | null;
  readonly balance: BalanceRow | null;
}

export interface EventRow {
  readonly id: string;
  readonly operation: string;
  readonly operationLabel: string;
  readonly accepted: boolean;
  /** "Applied" for accepted events, "Observation" for retained rejections. */
  readonly statusLabel: string;
  readonly blockEffect: boolean;
  readonly assetTitle: string;
  readonly amount: PresentedQuantity | null;
  readonly unit: string;
  readonly txid: string | null;
  readonly reason: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly sourceId: string;
}

export interface SubgroupSection {
  readonly id: string;
  readonly subprotocolId: string | null;
  readonly label: string;
  readonly assets: readonly AssetRow[];
  readonly accepted: readonly EventRow[];
  readonly observations: readonly EventRow[];
}

export interface ProtocolSection {
  readonly id: string;
  readonly protocolId: string;
  readonly name: string;
  readonly coverage: CoverageRow | null;
  readonly subgroups: readonly SubgroupSection[];
  /** Distinct assets across this protocol's subgroups. */
  readonly assetCount: number;
  readonly eventCount: number;
}

export interface InventoryViewModel {
  readonly kind: InventoryScopeKind;
  readonly sections: readonly ProtocolSection[];
  /** Distinct underlying assets, each counted once whatever its classifications. */
  readonly distinctAssets: number;
  readonly complete: boolean;
  readonly coverage: readonly CoverageRow[];
  readonly checkpoints: readonly InventoryCheckpoint[];
  readonly retryable: boolean;
  readonly headline: string;
  readonly loadedItems: number | null;
  readonly totalItems: number | null;
}

export function protocolName(protocolId: string, names: ReadonlyMap<string, string>): string {
  return names.get(protocolId) || PROTOCOL_NAMES[protocolId] || protocolId;
}

export function coverageStateLabel(state: InventoryCoverageState): string {
  switch (state) {
    case 'complete': return $localize`:@@universe.inventory.cov.complete:Complete`;
    case 'partial': return $localize`:@@universe.inventory.cov.partial:Partial`;
    case 'unavailable': return $localize`:@@universe.inventory.cov.unavailable:Source unavailable`;
    case 'unconfigured': return $localize`:@@universe.inventory.cov.unconfigured:No source configured`;
    case 'stale': return $localize`:@@universe.inventory.cov.stale:Source behind the chain`;
    case 'not-indexed': return $localize`:@@universe.inventory.cov.not-indexed:Not indexed yet`;
  }
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  'no-reader': 'No source reads this protocol on this deployment.',
  'more-pages': 'More pages remain to be read.',
  'ord-unavailable': 'The Ord source did not answer.',
  'ord-not-indexed': 'Ord has not indexed some outputs yet.',
  'ord-address-unavailable': 'The address output list could not be read.',
  'address-outputs-unavailable': 'The address output list could not be read.',
  'rare-sat-scan-limit': 'More notable sats exist than one scan lists.',
  'sat-index-disabled': 'The sat index is not enabled.',
  'holdings-truncated': 'The ledger returned more holdings than one read covers.',
  'snapshot-changed': 'The source moved while it was being read.',
  'wrong-network': 'The source answered for another network.',
  pending: 'The transaction is unconfirmed, so this can change.',
};

export function coverageReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

const RETRYABLE: ReadonlySet<InventoryCoverageState> = new Set<InventoryCoverageState>([
  'partial', 'unavailable', 'stale', 'not-indexed',
]);

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'inscription': return $localize`:@@universe.inventory.kind.inscription:Inscription`;
    case 'sat': return $localize`:@@universe.inventory.kind.sat:Sat`;
    case 'fungible': return $localize`:@@universe.inventory.kind.fungible:Token`;
    case 'name': return $localize`:@@universe.inventory.kind.name:Name`;
    case 'namespace': return $localize`:@@universe.inventory.kind.namespace:Namespace`;
    case 'district': return $localize`:@@universe.inventory.kind.district:District`;
    case 'parcel': return $localize`:@@universe.inventory.kind.parcel:Parcel`;
    case 'colored-sats': return $localize`:@@universe.inventory.kind.colored-sats:Colored sats`;
    case 'protocol-event': return $localize`:@@universe.inventory.kind.event:Protocol event`;
    default: return kind;
  }
}

export function operationLabel(operation: string): string {
  switch (operation) {
    case 'deploy': return $localize`:@@universe.inventory.op.deploy:Deploy`;
    case 'mint': return $localize`:@@universe.inventory.op.mint:Mint`;
    case 'inscribe-transfer': return $localize`:@@universe.inventory.op.inscribe-transfer:Inscribe transfer`;
    case 'transfer': return $localize`:@@universe.inventory.op.transfer:Transfer`;
    case 'send': return $localize`:@@universe.inventory.op.send:Send`;
    case 'burn': return $localize`:@@universe.inventory.op.burn:Burn`;
    case 'reward': return $localize`:@@universe.inventory.op.reward:Reward`;
    case 'register': return $localize`:@@universe.inventory.op.register:Register`;
    case 'claim': return $localize`:@@universe.inventory.op.claim:Claim`;
    case 'lock': return $localize`:@@universe.inventory.op.lock:Lock`;
    case 'unlock': return $localize`:@@universe.inventory.op.unlock:Unlock`;
    case 'refund': return $localize`:@@universe.inventory.op.refund:Refund`;
    case 'fee': return $localize`:@@universe.inventory.op.fee:Fee`;
    case 'invalid': return $localize`:@@universe.inventory.op.invalid:Invalid operation`;
    default: return operation;
  }
}

export function sideLabel(side: InventorySide): string {
  switch (side) {
    case 'input': return $localize`:@@universe.inventory.side.input:Input`;
    case 'output': return $localize`:@@universe.inventory.side.output:Output`;
    case 'fee': return $localize`:@@universe.inventory.side.fee:Fee`;
  }
}

/** Exact text for a presented quantity with its unit, never rounded. */
export function quantityText(quantity: PresentedQuantity | null, unit: string | null): string {
  if (!quantity || quantity.kind === 'unknown') {return '';}
  const digits = groupIntegerDigits(quantity.exact);
  if (quantity.kind === 'raw') {
    return $localize`:@@universe.inventory.smallest-units:${digits}:quantity: smallest units`;
  }
  return unit ? digits + ' ' + unit : digits;
}

function assetTitle(asset: InventoryAsset): string {
  if (asset.displayName) {return asset.displayName;}
  if (asset.ticker) {return asset.ticker;}
  if (asset.inscription) {
    return $localize`:@@universe.inventory.inscription-title:Inscription ${groupSigned(asset.inscription.numberAtomic)}:number:`;
  }
  if (asset.sat) {
    return $localize`:@@universe.inventory.sat-title:Sat ${groupIntegerDigits(asset.sat.satAtomic)}:number:`;
  }
  return shortenAssetId(asset.nativeId, 10);
}

function groupSigned(value: string): string {
  return value.startsWith('-') ? '-' + groupIntegerDigits(value.slice(1)) : groupIntegerDigits(value);
}

function assetLink(asset: InventoryAsset): unknown[] | null {
  if (asset.kind === 'inscription' && asset.protocolId === 'ordinals') {return ['/inscription', asset.nativeId];}
  if (asset.sat) {return ['/sat', asset.sat.satAtomic];}
  return null;
}

function classificationRow(
  facet: InventoryClassification,
  index: number,
  assets: ReadonlyMap<string, InventoryAsset>,
  names: ReadonlyMap<string, string>,
): ClassificationRow {
  const referenced = facet.assetKey ? assets.get(facet.assetKey) : undefined;
  const decimals = facet.decimals ?? referenced?.decimals ?? null;
  return {
    id: [facet.protocolId, facet.subprotocolId ?? '', facet.assetKey ?? '', index].join('|'),
    protocolId: facet.protocolId,
    protocolName: protocolName(facet.protocolId, names),
    subprotocolId: facet.subprotocolId,
    label: facet.label ?? (referenced ? assetTitle(referenced) : null),
    relation: facet.relation,
    amount: facet.amountAtomic !== null ? presentQuantity(facet.amountAtomic, decimals) : null,
    unit: facet.unit ?? referenced?.unit ?? null,
  };
}

function sum(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {total += BigInt(value);}
  return total.toString();
}

function sideTotals(placements: readonly InventoryPlacement[], decimals: number | null): SideTotals {
  const of = (side: InventorySide): PresentedQuantity | null => {
    const amounts = placements.filter((placement) => placement.side === side).map((placement) => placement.amountAtomic);
    return amounts.length ? presentQuantity(sum(amounts), decimals) : null;
  };
  return { input: of('input'), output: of('output'), fee: of('fee') };
}

function balanceRow(balance: InventoryBalance, decimals: number | null): BalanceRow {
  return {
    overall: presentQuantity(balance.overallAtomic, decimals),
    available: balance.availableAtomic !== null ? presentQuantity(balance.availableAtomic, decimals) : null,
    reserved: balance.reservedAtomic !== null ? presentQuantity(balance.reservedAtomic, decimals) : null,
    outpoints: balance.outpoints,
  };
}

function eventRow(event: InventoryEvent, assets: ReadonlyMap<string, InventoryAsset>): EventRow {
  const asset = assets.get(event.assetKey);
  return {
    id: event.sourceId + '|' + event.eventId,
    operation: event.operation,
    operationLabel: operationLabel(event.operation),
    accepted: event.accepted,
    statusLabel: event.accepted
      ? $localize`:@@universe.inventory.event.applied:Applied`
      : $localize`:@@universe.inventory.event.observation:Observation, not applied`,
    blockEffect: event.blockEffect,
    assetTitle: asset ? assetTitle(asset) : event.assetKey,
    amount: event.amountAtomic !== null ? presentQuantity(event.amountAtomic, asset?.decimals ?? null) : null,
    unit: asset?.unit ?? '',
    txid: event.txid,
    reason: event.reason,
    from: event.fromAddress ?? event.fromOutpoint,
    to: event.toAddress ?? event.toOutpoint,
    sourceId: event.sourceId,
  };
}

function coverageRow(entry: InventoryCoverage, found: number, names: ReadonlyMap<string, string>): CoverageRow {
  let findingLabel: string;
  if (found > 0) {
    findingLabel = entry.state === 'complete'
      ? $localize`:@@universe.inventory.found:${found}:count: found`
      : $localize`:@@universe.inventory.found-at-least:${found}:count: found so far`;
  } else if (entry.state === 'complete') {
    findingLabel = $localize`:@@universe.inventory.none-proven:None, proven by the source`;
  } else {
    findingLabel = $localize`:@@universe.inventory.unknown:Unknown, not proven empty`;
  }
  return {
    protocolId: entry.protocolId,
    name: protocolName(entry.protocolId, names),
    state: entry.state,
    stateLabel: coverageStateLabel(entry.state),
    reasons: entry.reasons.map(coverageReasonLabel),
    sourceId: entry.sourceId,
    checkpoint: entry.checkpoint,
    findingLabel,
    retryable: RETRYABLE.has(entry.state),
  };
}

function domId(value: string): string {
  return 'inv-' + value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function buildInventoryView(
  inventory: AssetInventory,
  names: ReadonlyMap<string, string> = new Map(),
): InventoryViewModel {
  const assets = new Map(inventory.assets.map((asset) => [asset.key, asset]));
  const placementsByAsset = new Map<string, InventoryPlacement[]>();
  for (const placement of inventory.placements) {
    const bucket = placementsByAsset.get(placement.assetKey) ?? [];
    bucket.push(placement);
    placementsByAsset.set(placement.assetKey, bucket);
  }
  const balances = new Map(inventory.balances.map((balance) => [balance.assetKey, balance]));

  const rows = new Map<string, Omit<AssetRow, 'facets'>>();
  const rowFor = (asset: InventoryAsset): Omit<AssetRow, 'facets'> => {
    let row = rows.get(asset.key);
    if (row) {return row;}
    const placements = placementsByAsset.get(asset.key) ?? [];
    const balance = balances.get(asset.key);
    row = {
      key: asset.key,
      title: assetTitle(asset),
      subtitle: asset.displayName || asset.ticker || asset.inscription || asset.sat ? shortenAssetId(asset.nativeId, 8) : '',
      nativeId: asset.nativeId,
      kind: asset.kind,
      kindLabel: kindLabel(asset.kind),
      unit: asset.unit,
      decimals: asset.decimals,
      link: assetLink(asset),
      sat: asset.sat,
      inscription: asset.inscription,
      classifications: asset.classifications.map((facet, index) => classificationRow(facet, index, assets, names)),
      placements: placements.map((placement): PlacementRow => ({
        id: [placement.txid, placement.side, placement.index ?? '', placement.offsetAtomic ?? ''].join('|'),
        side: placement.side,
        sideLabel: sideLabel(placement.side),
        txid: placement.txid,
        index: placement.index,
        outpoint: placement.outpoint,
        amount: presentQuantity(placement.amountAtomic, asset.decimals),
        offsetAtomic: placement.offsetAtomic,
      })),
      totals: inventory.scope.kind === 'transaction' && placements.length ? sideTotals(placements, asset.decimals) : null,
      balance: balance ? balanceRow(balance, asset.decimals) : null,
    };
    rows.set(asset.key, row);
    return row;
  };

  // Protocol order comes from the producer: its coverage roster first, then
  // any further protocol the groups or events name.
  const order: string[] = [];
  const note = (protocolId: string): void => {
    if (!order.includes(protocolId)) {order.push(protocolId);}
  };
  inventory.coverage.forEach((entry) => note(entry.protocolId));
  inventory.groups.forEach((group) => note(group.protocolId));
  inventory.events.forEach((event) => note(event.protocolId));

  const coverageByProtocol = new Map(inventory.coverage.map((entry) => [entry.protocolId, entry]));
  const sections: ProtocolSection[] = [];
  const foundByProtocol = new Map<string, number>();
  for (const protocolId of order) {
    const subIds: (string | null)[] = [];
    const noteSub = (id: string | null): void => {
      if (!subIds.includes(id)) {subIds.push(id);}
    };
    const groups = inventory.groups.filter((group) => group.protocolId === protocolId);
    groups.forEach((group) => noteSub(group.subprotocolId));
    const events = inventory.events.filter((event) => event.protocolId === protocolId);
    events.forEach((event) => noteSub(event.subprotocolId));
    // The protocol level first, then subprotocols in a stable order.
    subIds.sort((a, b) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)));

    const keys = new Set<string>();
    const subgroups: SubgroupSection[] = [];
    for (const subprotocolId of subIds) {
      const assetKeys = new Set<string>();
      for (const group of groups) {
        if (group.subprotocolId === subprotocolId) {group.assetKeys.forEach((key) => assetKeys.add(key));}
      }
      const assetRows: AssetRow[] = [];
      for (const key of assetKeys) {
        const asset = assets.get(key);
        if (!asset) {continue;}
        keys.add(key);
        const base = rowFor(asset);
        assetRows.push({
          ...base,
          facets: base.classifications.filter((facet) => facet.protocolId === protocolId
            && facet.subprotocolId === subprotocolId),
        });
      }
      const subEvents = events.filter((event) => event.subprotocolId === subprotocolId).map((event) => eventRow(event, assets));
      if (!assetRows.length && !subEvents.length) {continue;}
      subgroups.push({
        id: domId(protocolId + '-' + (subprotocolId ?? 'base')),
        subprotocolId,
        label: subprotocolId ?? protocolName(protocolId, names),
        assets: assetRows,
        accepted: subEvents.filter((event) => event.accepted),
        observations: subEvents.filter((event) => !event.accepted),
      });
    }
    foundByProtocol.set(protocolId, keys.size);
    const coverage = coverageByProtocol.get(protocolId);
    if (!subgroups.length) {continue;}
    sections.push({
      id: domId(protocolId),
      protocolId,
      name: protocolName(protocolId, names),
      coverage: coverage ? coverageRow(coverage, keys.size, names) : null,
      subgroups,
      assetCount: keys.size,
      eventCount: events.length,
    });
  }

  const coverage = inventory.coverage.map((entry) => coverageRow(entry, foundByProtocol.get(entry.protocolId) ?? 0, names));
  const distinctAssets = inventory.assets.length;
  let headline: string;
  if (distinctAssets === 0) {
    headline = inventory.complete
      ? $localize`:@@universe.inventory.headline.none:No protocol assets. Every expected protocol proved it.`
      : $localize`:@@universe.inventory.headline.none-unproven:No protocol assets found so far. Some protocols could not prove absence.`;
  } else {
    headline = inventory.complete
      ? $localize`:@@universe.inventory.headline.complete:${distinctAssets}:count: distinct assets, complete`
      : $localize`:@@universe.inventory.headline.partial:${distinctAssets}:count: distinct assets found so far, not complete`;
  }
  return {
    kind: inventory.scope.kind,
    sections,
    distinctAssets,
    complete: inventory.complete,
    coverage,
    checkpoints: inventory.checkpoints,
    retryable: coverage.some((row) => row.retryable),
    headline,
    loadedItems: inventory.page ? inventory.page.toIndex : null,
    totalItems: inventory.page ? inventory.page.totalItems : null,
  };
}
