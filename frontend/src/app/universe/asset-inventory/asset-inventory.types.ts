/**
 * Consumer side of universe-asset-inventory-v1, the public transaction, block
 * and address asset inventory served by backend-apis under
 * /api/v1/universe/inventory.
 *
 * The decoder is strict on purpose. A response is checked against the scope
 * the page asked for (kind, chain, network, key) before anything renders, so a
 * late answer for another transaction, block, address or network is an error
 * rather than a wrong inventory. Quantities stay unsigned decimal strings from
 * the wire to the screen; nothing here constructs a Number from one.
 *
 * One underlying asset appears once in `assets`. Protocol and subprotocol
 * groups only reference asset keys, so a classification never multiplies a
 * quantity.
 */

export const ASSET_INVENTORY_SCHEMA_VERSION = 'universe-asset-inventory-v1';

/** The ordinal-family protocols the producer always reports coverage for. */
export const ORDINAL_INVENTORY_PROTOCOLS: readonly string[] = [
  'ordinals', 'rare_sats', 'names', 'bitmap', 'brc20', 'tap', 'dmt', 'unat', 'dust20', 'block20',
];

export type InventoryScopeKind = 'transaction' | 'block' | 'address';

export type InventoryAssetKind =
  | 'inscription'
  | 'sat'
  | 'fungible'
  | 'name'
  | 'namespace'
  | 'district'
  | 'parcel'
  | 'colored-sats'
  | 'protocol-event';

export type InventoryCoverageState =
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'unconfigured'
  | 'stale'
  | 'not-indexed';

export const INVENTORY_COVERAGE_STATES: readonly InventoryCoverageState[] = [
  'complete', 'partial', 'unavailable', 'unconfigured', 'stale', 'not-indexed',
];

export interface InventoryCheckpoint {
  readonly sourceId: string;
  readonly heightAtomic: string;
  readonly blockHash: string;
  readonly generation: string | null;
}

export interface InventoryCoverage {
  readonly protocolId: string;
  readonly sourceId: string | null;
  readonly state: InventoryCoverageState;
  readonly reasons: readonly string[];
  readonly checkpoint: InventoryCheckpoint | null;
  readonly ruleset: string | null;
}

export interface InventoryClassification {
  readonly protocolId: string;
  readonly subprotocolId: string | null;
  readonly kind: string;
  readonly label: string | null;
  readonly amountAtomic: string | null;
  readonly decimals: number | null;
  readonly unit: string | null;
  readonly relation: string | null;
  readonly assetKey: string | null;
}

export interface InventoryInscriptionFacts {
  /** Signed: cursed inscriptions carry negative numbers. */
  readonly numberAtomic: string;
  readonly contentType: string | null;
  readonly satAtomic: string | null;
  readonly parents: readonly string[];
  readonly charms: readonly string[];
}

export interface InventorySatFacts {
  readonly satAtomic: string;
  readonly rarity: string;
  readonly heightAtomic: string;
}

export interface InventoryAsset {
  readonly key: string;
  readonly protocolId: string;
  readonly subprotocolId: string | null;
  readonly namespace: string | null;
  readonly nativeId: string;
  /** One of {@link InventoryAssetKind}; an additive kind is kept, not dropped. */
  readonly kind: string;
  readonly ticker: string | null;
  readonly displayName: string | null;
  readonly decimals: number | null;
  readonly unit: string;
  readonly inscription: InventoryInscriptionFacts | null;
  readonly sat: InventorySatFacts | null;
  readonly classifications: readonly InventoryClassification[];
}

export type InventorySide = 'input' | 'output' | 'fee';

export interface InventoryPlacement {
  readonly assetKey: string;
  readonly txid: string;
  readonly side: InventorySide;
  readonly index: number | null;
  readonly outpoint: string | null;
  readonly amountAtomic: string;
  readonly offsetAtomic: string | null;
}

export interface InventoryEvent {
  readonly eventId: string;
  readonly sourceId: string;
  readonly protocolId: string;
  readonly subprotocolId: string | null;
  readonly txid: string | null;
  readonly txIndex: number | null;
  readonly operation: string;
  readonly accepted: boolean;
  readonly reason: string | null;
  readonly assetKey: string;
  readonly amountAtomic: string | null;
  readonly fromAddress: string | null;
  readonly fromOutpoint: string | null;
  readonly toAddress: string | null;
  readonly toOutpoint: string | null;
  readonly inscriptionId: string | null;
  readonly blockEffect: boolean;
}

export interface InventoryBalance {
  readonly assetKey: string;
  readonly overallAtomic: string;
  readonly availableAtomic: string | null;
  readonly reservedAtomic: string | null;
  readonly outpoints: readonly string[];
}

export interface InventoryGroup {
  readonly protocolId: string;
  readonly subprotocolId: string | null;
  readonly assetKeys: readonly string[];
  readonly eventCount: number;
}

export interface InventoryScope {
  readonly kind: InventoryScopeKind;
  readonly chain: string;
  readonly network: string;
  readonly key: string;
  readonly heightAtomic: string | null;
  readonly blockHash: string | null;
  readonly confirmed: boolean | null;
}

export interface InventoryPage {
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly totalItems: number | null;
}

export interface AssetInventory {
  readonly schemaVersion: typeof ASSET_INVENTORY_SCHEMA_VERSION;
  readonly scope: InventoryScope;
  readonly assets: readonly InventoryAsset[];
  readonly groups: readonly InventoryGroup[];
  readonly placements: readonly InventoryPlacement[];
  readonly events: readonly InventoryEvent[];
  readonly balances: readonly InventoryBalance[];
  readonly coverage: readonly InventoryCoverage[];
  readonly checkpoints: readonly InventoryCheckpoint[];
  readonly complete: boolean;
  readonly page: InventoryPage | null;
  readonly generatedAt: string;
}

export interface InventoryRequestScope {
  readonly kind: InventoryScopeKind;
  readonly chain: string;
  readonly network: string;
  readonly key: string;
}

/** A response that does not satisfy the contract or the requested scope. */
export class AssetInventoryContractError extends Error {
  constructor(readonly code: string) {
    super('asset-inventory-' + code);
    this.name = 'AssetInventoryContractError';
  }
}

const UNSIGNED = /^(0|[1-9][0-9]*)$/;
const SIGNED = /^(0|-?[1-9][0-9]*)$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SIDES: readonly InventorySide[] = ['input', 'output', 'fee'];

function fail(code: string): never {
  throw new AssetInventoryContractError(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {fail(code);}
  return value as Record<string, unknown>;
}

function list(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) {fail(code);}
  return value;
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length === 0) {fail(code);}
  return value;
}

function optionalText(value: unknown, code: string): string | null {
  if (value === null || value === undefined) {return null;}
  if (typeof value !== 'string') {fail(code);}
  return value;
}

function atomic(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UNSIGNED.test(value)) {fail(code);}
  return value;
}

function optionalAtomic(value: unknown, code: string): string | null {
  return value === null || value === undefined ? null : atomic(value, code);
}

function hash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) {fail(code);}
  return value;
}

function optionalHash(value: unknown, code: string): string | null {
  return value === null || value === undefined ? null : hash(value, code);
}

function count(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {fail(code);}
  return value;
}

function optionalCount(value: unknown, code: string): number | null {
  return value === null || value === undefined ? null : count(value, code);
}

function decimals(value: unknown, code: string): number | null {
  if (value === null || value === undefined) {return null;}
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 38) {fail(code);}
  return value;
}

function strings(value: unknown, code: string): string[] {
  return list(value, code).map((entry) => text(entry, code));
}

function checkpoint(value: unknown): InventoryCheckpoint {
  const row = record(value, 'checkpoint');
  const generation = row.generation;
  if (generation !== null && generation !== undefined && (typeof generation !== 'string' || !UNSIGNED.test(generation))) {
    fail('checkpoint-generation');
  }
  return {
    sourceId: text(row.sourceId, 'checkpoint-source'),
    heightAtomic: atomic(row.heightAtomic, 'checkpoint-height'),
    blockHash: hash(row.blockHash, 'checkpoint-hash'),
    generation: (generation as string | null | undefined) ?? null,
  };
}

function classification(value: unknown): InventoryClassification {
  const row = record(value, 'classification');
  return {
    protocolId: text(row.protocolId, 'classification-protocol'),
    subprotocolId: optionalText(row.subprotocolId, 'classification-subprotocol'),
    kind: text(row.kind, 'classification-kind'),
    label: optionalText(row.label, 'classification-label'),
    amountAtomic: optionalAtomic(row.amountAtomic, 'classification-amount'),
    decimals: decimals(row.decimals, 'classification-decimals'),
    unit: optionalText(row.unit, 'classification-unit'),
    relation: optionalText(row.relation, 'classification-relation'),
    assetKey: optionalText(row.assetKey, 'classification-asset'),
  };
}

function asset(value: unknown): InventoryAsset {
  const row = record(value, 'asset');
  let inscription: InventoryInscriptionFacts | null = null;
  if (row.inscription !== null && row.inscription !== undefined) {
    const facts = record(row.inscription, 'inscription');
    if (typeof facts.numberAtomic !== 'string' || !SIGNED.test(facts.numberAtomic)) {fail('inscription-number');}
    inscription = {
      numberAtomic: facts.numberAtomic,
      contentType: optionalText(facts.contentType, 'inscription-content-type'),
      satAtomic: optionalAtomic(facts.satAtomic, 'inscription-sat'),
      parents: strings(facts.parents ?? [], 'inscription-parents'),
      charms: strings(facts.charms ?? [], 'inscription-charms'),
    };
  }
  let sat: InventorySatFacts | null = null;
  if (row.sat !== null && row.sat !== undefined) {
    const facts = record(row.sat, 'sat');
    sat = {
      satAtomic: atomic(facts.satAtomic, 'sat-number'),
      rarity: text(facts.rarity, 'sat-rarity'),
      heightAtomic: atomic(facts.heightAtomic, 'sat-height'),
    };
  }
  return {
    key: text(row.key, 'asset-key'),
    protocolId: text(row.protocolId, 'asset-protocol'),
    subprotocolId: optionalText(row.subprotocolId, 'asset-subprotocol'),
    namespace: optionalText(row.namespace, 'asset-namespace'),
    nativeId: text(row.nativeId, 'asset-native-id'),
    kind: text(row.kind, 'asset-kind'),
    ticker: optionalText(row.ticker, 'asset-ticker'),
    displayName: optionalText(row.displayName, 'asset-display-name'),
    decimals: decimals(row.decimals, 'asset-decimals'),
    unit: text(row.unit, 'asset-unit'),
    inscription,
    sat,
    classifications: list(row.classifications, 'asset-classifications').map(classification),
  };
}

function scope(value: unknown, expected: InventoryRequestScope): InventoryScope {
  const row = record(value, 'scope');
  if (row.kind !== expected.kind) {fail('scope-kind');}
  if (row.chain !== expected.chain) {fail('scope-chain');}
  if (row.network !== expected.network) {fail('scope-network');}
  if (row.key !== expected.key) {fail('scope-key');}
  if (row.confirmed !== null && row.confirmed !== undefined && typeof row.confirmed !== 'boolean') {fail('scope-confirmed');}
  const decoded: InventoryScope = {
    kind: expected.kind,
    chain: expected.chain,
    network: expected.network,
    key: expected.key,
    heightAtomic: optionalAtomic(row.heightAtomic, 'scope-height'),
    blockHash: optionalHash(row.blockHash, 'scope-hash'),
    confirmed: (row.confirmed as boolean | null | undefined) ?? null,
  };
  if (expected.kind === 'block' && decoded.blockHash !== expected.key) {fail('scope-block-hash');}
  return decoded;
}

function page(value: unknown, kind: InventoryScopeKind, cursor: string | null): InventoryPage | null {
  if (value === null || value === undefined) {
    if (kind !== 'transaction') {fail('page-missing');}
    return null;
  }
  const row = record(value, 'page');
  const decoded: InventoryPage = {
    cursor: optionalText(row.cursor, 'page-cursor'),
    nextCursor: optionalText(row.nextCursor, 'page-next-cursor'),
    fromIndex: count(row.fromIndex, 'page-from'),
    toIndex: count(row.toIndex, 'page-to'),
    totalItems: optionalCount(row.totalItems, 'page-total'),
  };
  if (decoded.cursor !== cursor) {fail('page-cursor-mismatch');}
  if (decoded.toIndex < decoded.fromIndex) {fail('page-range');}
  if (decoded.totalItems !== null && decoded.toIndex > decoded.totalItems) {fail('page-range');}
  if (decoded.nextCursor !== null && decoded.nextCursor.length === 0) {fail('page-next-cursor');}
  return decoded;
}

/**
 * Decodes one inventory response for the scope the page requested, or throws
 * an {@link AssetInventoryContractError}. `cursor` is the cursor the request
 * carried (null for the first page) and must be echoed back.
 */
export function decodeAssetInventory(
  value: unknown,
  expected: InventoryRequestScope,
  cursor: string | null = null,
): AssetInventory {
  const row = record(value, 'envelope');
  if (row.schemaVersion !== ASSET_INVENTORY_SCHEMA_VERSION) {fail('schema-version');}
  const decodedScope = scope(row.scope, expected);
  const assets = list(row.assets, 'assets').map(asset);
  const keys = new Set<string>();
  for (const entry of assets) {
    if (keys.has(entry.key)) {fail('asset-duplicate');}
    keys.add(entry.key);
  }
  const known = (key: string | null, code: string): void => {
    if (key !== null && !keys.has(key)) {fail(code);}
  };
  for (const entry of assets) {
    for (const facet of entry.classifications) {known(facet.assetKey, 'classification-asset-unknown');}
  }
  const groups = list(row.groups, 'groups').map((value): InventoryGroup => {
    const group = record(value, 'group');
    const assetKeys = strings(group.assetKeys, 'group-assets');
    for (const key of assetKeys) {known(key, 'group-asset-unknown');}
    if (new Set(assetKeys).size !== assetKeys.length) {fail('group-asset-duplicate');}
    return {
      protocolId: text(group.protocolId, 'group-protocol'),
      subprotocolId: optionalText(group.subprotocolId, 'group-subprotocol'),
      assetKeys,
      eventCount: count(group.eventCount, 'group-events'),
    };
  });
  const placements = list(row.placements, 'placements').map((value): InventoryPlacement => {
    const placement = record(value, 'placement');
    const side = placement.side as InventorySide;
    if (!SIDES.includes(side)) {fail('placement-side');}
    const index = placement.index;
    if (index !== null && index !== undefined && (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)) {
      fail('placement-index');
    }
    const decoded: InventoryPlacement = {
      assetKey: text(placement.assetKey, 'placement-asset'),
      txid: hash(placement.txid, 'placement-txid'),
      side,
      index: (index as number | null | undefined) ?? null,
      outpoint: optionalText(placement.outpoint, 'placement-outpoint'),
      amountAtomic: atomic(placement.amountAtomic, 'placement-amount'),
      offsetAtomic: optionalAtomic(placement.offsetAtomic, 'placement-offset'),
    };
    known(decoded.assetKey, 'placement-asset-unknown');
    return decoded;
  });
  const events = list(row.events, 'events').map((value): InventoryEvent => {
    const event = record(value, 'event');
    if (typeof event.accepted !== 'boolean') {fail('event-accepted');}
    if (typeof event.blockEffect !== 'boolean') {fail('event-block-effect');}
    const txIndex = event.txIndex;
    if (txIndex !== null && txIndex !== undefined && (typeof txIndex !== 'number' || !Number.isSafeInteger(txIndex) || txIndex < 0)) {
      fail('event-tx-index');
    }
    const decoded: InventoryEvent = {
      eventId: text(event.eventId, 'event-id'),
      sourceId: text(event.sourceId, 'event-source'),
      protocolId: text(event.protocolId, 'event-protocol'),
      subprotocolId: optionalText(event.subprotocolId, 'event-subprotocol'),
      txid: optionalHash(event.txid, 'event-txid'),
      txIndex: (txIndex as number | null | undefined) ?? null,
      operation: text(event.operation, 'event-operation'),
      accepted: event.accepted,
      reason: optionalText(event.reason, 'event-reason'),
      assetKey: text(event.assetKey, 'event-asset'),
      amountAtomic: optionalAtomic(event.amountAtomic, 'event-amount'),
      fromAddress: optionalText(event.fromAddress, 'event-from'),
      fromOutpoint: optionalText(event.fromOutpoint, 'event-from'),
      toAddress: optionalText(event.toAddress, 'event-to'),
      toOutpoint: optionalText(event.toOutpoint, 'event-to'),
      inscriptionId: optionalText(event.inscriptionId, 'event-inscription'),
      blockEffect: event.blockEffect,
    };
    known(decoded.assetKey, 'event-asset-unknown');
    return decoded;
  });
  const balanceKeys = new Set<string>();
  const balances = list(row.balances, 'balances').map((value): InventoryBalance => {
    const balance = record(value, 'balance');
    const decoded: InventoryBalance = {
      assetKey: text(balance.assetKey, 'balance-asset'),
      overallAtomic: atomic(balance.overallAtomic, 'balance-overall'),
      availableAtomic: optionalAtomic(balance.availableAtomic, 'balance-available'),
      reservedAtomic: optionalAtomic(balance.reservedAtomic, 'balance-reserved'),
      outpoints: strings(balance.outpoints ?? [], 'balance-outpoints'),
    };
    known(decoded.assetKey, 'balance-asset-unknown');
    if (balanceKeys.has(decoded.assetKey)) {fail('balance-duplicate');}
    balanceKeys.add(decoded.assetKey);
    // Reserved is part of overall, never an extra amount on top of it.
    if (decoded.availableAtomic !== null && decoded.reservedAtomic !== null
      && BigInt(decoded.availableAtomic) + BigInt(decoded.reservedAtomic) !== BigInt(decoded.overallAtomic)) {
      fail('balance-split');
    }
    return decoded;
  });
  const coverage = list(row.coverage, 'coverage').map((value): InventoryCoverage => {
    const entry = record(value, 'coverage-entry');
    const state = entry.state as InventoryCoverageState;
    if (!INVENTORY_COVERAGE_STATES.includes(state)) {fail('coverage-state');}
    return {
      protocolId: text(entry.protocolId, 'coverage-protocol'),
      sourceId: optionalText(entry.sourceId, 'coverage-source'),
      state,
      reasons: strings(entry.reasons ?? [], 'coverage-reasons'),
      checkpoint: entry.checkpoint === null || entry.checkpoint === undefined ? null : checkpoint(entry.checkpoint),
      ruleset: optionalText(entry.ruleset, 'coverage-ruleset'),
    };
  });
  if (new Set(coverage.map((entry) => entry.protocolId)).size !== coverage.length) {fail('coverage-duplicate');}
  if (typeof row.complete !== 'boolean') {fail('complete');}
  const decodedPage = page(row.page, expected.kind, cursor);
  // "complete" can only be claimed when every protocol is complete on a last page.
  if (row.complete && (coverage.some((entry) => entry.state !== 'complete')
    || (decodedPage !== null && decodedPage.nextCursor !== null))) {
    fail('complete-claim');
  }
  return {
    schemaVersion: ASSET_INVENTORY_SCHEMA_VERSION,
    scope: decodedScope,
    assets,
    groups,
    placements,
    events,
    balances,
    coverage,
    checkpoints: list(row.checkpoints, 'checkpoints').map(checkpoint),
    complete: row.complete,
    page: decodedPage,
    generatedAt: text(row.generatedAt, 'generated-at'),
  };
}

const COVERAGE_RANK: Readonly<Record<InventoryCoverageState, number>> = {
  complete: 0,
  partial: 1,
  'not-indexed': 2,
  stale: 3,
  unavailable: 4,
  unconfigured: 5,
};

/** The reason a page names when it is partial only because pages remain. */
const MORE_PAGES = 'more-pages';

/**
 * Folds the cursor pages of one block or address inventory into one view.
 *
 * Every page must belong to the first page's scope: the same kind, chain,
 * network, key, height and block hash, and it must continue from the previous
 * page's cursor. Anything else is rejected with `scope-changed`, because
 * mixing two snapshots would show assets no single state of the chain holds.
 * Assets, placements and events are de-duplicated by identity, so a repeated
 * row never adds to a quantity; ledger balances arrive on the first page and
 * a later copy of the same asset's balance is ignored, not summed.
 */
export class InventoryAccumulator {
  private first: AssetInventory | null = null;
  private last: AssetInventory | null = null;
  private readonly assets = new Map<string, InventoryAsset>();
  private readonly groups = new Map<string, { protocolId: string; subprotocolId: string | null; keys: Set<string>; events: number }>();
  private readonly placements = new Map<string, InventoryPlacement>();
  private readonly events = new Map<string, InventoryEvent>();
  private readonly balances = new Map<string, InventoryBalance>();
  private readonly pagesCoverage: (readonly InventoryCoverage[])[] = [];
  private readonly checkpoints = new Map<string, InventoryCheckpoint>();
  private pageCount = 0;

  get pages(): number {
    return this.pageCount;
  }

  /** The cursor for the next page, or null when the walk is finished. */
  get nextCursor(): string | null {
    return this.last?.page?.nextCursor ?? null;
  }

  get finished(): boolean {
    return this.last !== null && this.nextCursor === null;
  }

  add(inventory: AssetInventory): void {
    if (this.first) {
      const a = this.first.scope;
      const b = inventory.scope;
      if (a.kind !== b.kind || a.chain !== b.chain || a.network !== b.network || a.key !== b.key
        || a.blockHash !== b.blockHash || a.heightAtomic !== b.heightAtomic) {
        throw new AssetInventoryContractError('scope-changed');
      }
      if ((inventory.page?.cursor ?? null) !== this.nextCursor || this.nextCursor === null) {
        throw new AssetInventoryContractError('page-out-of-order');
      }
      for (const entry of inventory.checkpoints) {
        const seen = this.checkpoints.get(entry.sourceId);
        if (seen && (seen.blockHash !== entry.blockHash || seen.generation !== entry.generation)) {
          throw new AssetInventoryContractError('scope-changed');
        }
      }
    } else {
      this.first = inventory;
    }
    for (const entry of inventory.assets) {
      const seen = this.assets.get(entry.key);
      if (!seen) {
        this.assets.set(entry.key, entry);
        continue;
      }
      const facets = [...seen.classifications];
      for (const facet of entry.classifications) {
        if (!facets.some((c) => c.protocolId === facet.protocolId && c.subprotocolId === facet.subprotocolId
          && c.assetKey === facet.assetKey)) {
          facets.push(facet);
        }
      }
      this.assets.set(entry.key, { ...seen, classifications: facets });
    }
    for (const group of inventory.groups) {
      const id = group.protocolId + '|' + (group.subprotocolId ?? '');
      let target = this.groups.get(id);
      if (!target) {
        target = { protocolId: group.protocolId, subprotocolId: group.subprotocolId, keys: new Set(), events: 0 };
        this.groups.set(id, target);
      }
      for (const key of group.assetKeys) {target.keys.add(key);}
      target.events += group.eventCount;
    }
    for (const placement of inventory.placements) {
      const id = [placement.assetKey, placement.txid, placement.side, placement.index ?? '', placement.offsetAtomic ?? ''].join('|');
      if (!this.placements.has(id)) {this.placements.set(id, placement);}
    }
    for (const event of inventory.events) {
      const id = event.sourceId + '|' + event.eventId;
      if (!this.events.has(id)) {this.events.set(id, event);}
    }
    for (const balance of inventory.balances) {
      if (!this.balances.has(balance.assetKey)) {this.balances.set(balance.assetKey, balance);}
    }
    for (const entry of inventory.checkpoints) {this.checkpoints.set(entry.sourceId, entry);}
    this.pagesCoverage.push(inventory.coverage);
    this.last = inventory;
    this.pageCount += 1;
  }

  /**
   * Coverage per protocol across the pages read so far: the weakest state any
   * page reported. A page that was partial only because more pages remained
   * stops counting against the protocol once the last page has been read.
   */
  coverage(): InventoryCoverage[] {
    const merged = new Map<string, InventoryCoverage>();
    const finished = this.finished;
    for (const entries of this.pagesCoverage) {
      for (const raw of entries) {
        const reasons = finished ? raw.reasons.filter((reason) => reason !== MORE_PAGES) : [...raw.reasons];
        const state: InventoryCoverageState = finished && raw.state === 'partial' && reasons.length === 0
          ? 'complete'
          : raw.state;
        const entry: InventoryCoverage = { ...raw, state, reasons };
        const seen = merged.get(entry.protocolId);
        if (!seen) {
          merged.set(entry.protocolId, entry);
        } else {
          const worse = COVERAGE_RANK[entry.state] > COVERAGE_RANK[seen.state] ? entry : seen;
          merged.set(entry.protocolId, { ...worse, reasons: [...new Set([...seen.reasons, ...entry.reasons])] });
        }
      }
    }
    if (!finished) {
      // Until the walk ends no protocol can prove absence for the whole scope.
      for (const [protocolId, entry] of merged) {
        if (entry.state === 'complete') {
          merged.set(protocolId, { ...entry, state: 'partial', reasons: [...new Set([...entry.reasons, MORE_PAGES])] });
        }
      }
    }
    return [...merged.values()];
  }

  /** The merged inventory, or null before the first page. */
  result(): AssetInventory | null {
    if (!this.first || !this.last) {return null;}
    const coverage = this.coverage();
    return {
      schemaVersion: ASSET_INVENTORY_SCHEMA_VERSION,
      scope: this.first.scope,
      assets: [...this.assets.values()],
      groups: [...this.groups.values()].map((group) => ({
        protocolId: group.protocolId,
        subprotocolId: group.subprotocolId,
        assetKeys: [...group.keys],
        eventCount: group.events,
      })),
      placements: [...this.placements.values()],
      events: [...this.events.values()],
      balances: [...this.balances.values()],
      coverage,
      checkpoints: [...this.checkpoints.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      complete: this.finished && coverage.every((entry) => entry.state === 'complete'),
      page: this.last.page
        ? {
          cursor: this.first.page?.cursor ?? null,
          nextCursor: this.last.page.nextCursor,
          fromIndex: this.first.page?.fromIndex ?? 0,
          toIndex: this.last.page.toIndex,
          totalItems: this.last.page.totalItems,
        }
        : null,
      generatedAt: this.last.generatedAt,
    };
  }
}
