import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  forkJoin,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { Utxo } from '@interfaces/electrs.interface';
import {
  UniverseApiService,
  UNIVERSE_OUTPOINT_BATCH_LIMIT,
} from '@app/universe/universe-api.service';
import {
  ExplorerOutpointPosition,
  OutpointEnrichment,
} from '@app/universe/universe.types';
import {
  PresentedQuantity,
  initialsFor,
  presentQuantity,
  shortenAssetId,
} from '@app/universe/asset-summary/asset-summary.presentation';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * Outputs resolved per address view. Two batches is enough to cover almost
 * every address a person actually reads, and it keeps one page view to two
 * authority requests rather than an unbounded sweep.
 */
const MAXIMUM_RESOLVED_OUTPUTS = UNIVERSE_OUTPOINT_BATCH_LIMIT * 2;

/**
 * One asset this address holds, keyed by its full identity.
 *
 * The identity is the whole tuple, not the protocol and id alone. Two rulesets
 * over one ledger are two assets and two networks are two assets; merging any
 * of them produces a total no authority would agree with. The unit metadata
 * travels with it for the same reason: a quantity whose divisibility was
 * dropped on the way here can only be rendered as a guess.
 */
export interface ProtocolHolding {
  readonly assetKey: string;
  readonly chain: string;
  readonly network: string;
  readonly protocolId: string;
  readonly assetId: string;
  readonly ruleset: string | null;
  readonly assetKind: string;
  readonly displayName: string;
  readonly ticker: string | null;
  /** The authority's divisibility, or null when unknown or conflicted. */
  readonly decimals: number | null;
  /** Sum across outputs, exact, as an unsigned integer string. Null if unknown. */
  readonly quantityAtomic: string | null;
  /**
   * False when a contributing quantity was missing or malformed.
   *
   * Tracked separately from coverage: the set of outputs checked and the
   * arithmetic over what they held are two different things, and a reader needs
   * to know which one is incomplete.
   */
  readonly quantityKnown: boolean;
  readonly outpoints: readonly string[];
  /** One or two letters standing in for a missing logo. */
  readonly initials: string;
  /** The shortened id for the row; the full one stays in `assetId`. */
  readonly shortAssetId: string;
  /** The quantity as the view renders it. */
  readonly held: PresentedQuantity;
  /** The id of this row's disclosure region, for aria-controls. */
  readonly detailsId: string;
}

export interface AddressAssetsState {
  readonly kind:
    | 'loading'
    | 'ready'
    | 'unavailable'
    | 'skipped'
    | 'source-unavailable';
  readonly reason?: string;
  readonly holdings?: readonly ProtocolHolding[];
  /** Outputs the authority answered for. The denominator for everything shown. */
  readonly resolved?: number;
  /** Outputs this address holds that were not asked about. */
  readonly notResolved?: number;
  /** Every unspent output this address has, answered for or not. */
  readonly total?: number;
  /** True when at least one answered output could not be fully accounted for. */
  readonly partial?: boolean;
  readonly checkpointHeight?: string | null;
  /**
   * True only when every output this address holds was answered for and none of
   * them carried a supported asset.
   *
   * Distinct from having nothing to show: an address with no unspent outputs at
   * all, one still loading, and one whose authority failed are three different
   * facts and only this one may be stated as an answer.
   */
  readonly provenEmpty?: boolean;
}

/**
 * The protocol assets an address currently holds.
 *
 * Built from the address's own unspent outputs, resolved through the asset
 * authority one bounded batch at a time. The panel always states how many
 * outputs it covered, because a portfolio that hides its own coverage is
 * indistinguishable from a wrong one, and it never presents itself as a
 * complete wallet valuation: it is what the outputs it checked carried.
 *
 * The layout is shared with the transaction summary through the asset-summary
 * mixins, and the quantities go through the same presenter, so the two panels
 * cannot drift into rendering the same fact two different ways.
 */
@Component({
  selector: 'app-universe-address-assets',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  templateUrl: './address-assets.component.html',
  styleUrls: ['./address-assets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/**
 * IMPLEMENTATION-HANDOFF [WP06] | F007 | preparation 2026-09-21
 * State: NOT TESTED. PR135 is legitimate unmerged consumer work and backend PR204 is already
 * merged. Public backend-info reports mempool 537235052 and chain status reports overlay
 * fcdc2e2f3bd226bead63cdf0b81fad1ef1ad45bd, not the selected candidates. Passing isolated
 * component tests do not establish real test-network user journeys or deployment.
 * Governing requirements: REQ-EVIDENCE, REQ-UI, REQ-NETWORK;
 * docs/implementation-prep/blockers-20260921/WORK-PACKAGES.json and bundled
 * research/source-register.json.
 * Prerequisites: WP01, WP03, WP04, WP05. 1. Keep holdingKey, summarise and addPosition
 * identity/precision protections while integrating the accepted producer. 2. Verify separate
 * assets with the same symbol, conflicting divisibility, partial source coverage, pagination
 * and direct links on each actual network. 3. Prove exact quantities and holdings after
 * confirmation/indexing, refresh, reconnect and a network switch; do not accept fixture
 * screenshots as that proof. 4. Run address-assets component tests and dependent frontend
 * suite, then collect actual authority/API/UI evidence and keyboard/mobile checks. No invented
 * transaction is required for a read-only holding journey.
 * Acceptance: All distinct transaction/address asset consumer paths and failure/recovery
 * variants pass against real supported-network authorities and the accepted candidate,
 * preserving exact amounts, source identity and truthful state across refresh/reconnect.
 * Rollback: Producer additions are additive in PR204; retain compatibility while switching
 * consumer artifacts. Revert only the failed candidate and preserve accepted source/evidence
 * versions; do not roll back unrelated merged backend work.
 * ANNOTATED is not implemented, verified functionality or release. Preserve existing
 * executable behavior in this preparation.
 */
export class AddressAssetsComponent implements OnChanges {
  @Input() utxos: Utxo[] | null = null;
  @Input() sourceState:
    'idle' | 'loading' | 'complete' | 'limit' | 'unavailable' = 'idle';

  state$: Observable<AddressAssetsState>;
  readonly shorten = shortenAssetId;

  /** Which rows a person has opened, keyed by full asset identity. */
  readonly expanded = new Set<string>();
  /** What the last copy attempt did, keyed by what was copied. */
  readonly copyResults = new Map<string, 'copied' | 'failed'>();

  private readonly retry$ = new BehaviorSubject<number>(0);

  constructor(private api: UniverseApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.utxos && !changes.sourceState) {
      return;
    }
    // A different address or a fresh lookup clears what the previous one proved,
    // including which row was open: a row left open would show another
    // address's outputs in place.
    this.expanded.clear();
    this.copyResults.clear();
    if (this.sourceState === 'limit' || this.sourceState === 'unavailable') {
      this.state$ = of({
        kind: 'source-unavailable',
        reason:
          this.sourceState === 'limit'
            ? 'The index limits unspent-output lookups to 500 and did not supply a complete list. Protocol holdings are unknown.'
            : 'The unspent-output lookup failed. Protocol holdings are unknown.',
      });
      return;
    }
    if (this.sourceState === 'loading') {
      this.state$ = of({ kind: 'loading' });
      return;
    }
    const utxos = this.utxos;
    if (!Array.isArray(utxos)) {
      // No input yet. Not an answer about this address.
      this.state$ = of<AddressAssetsState>({ kind: 'skipped' });
      return;
    }
    if (utxos.length === 0) {
      // An authoritative empty list. The address holds no unspent outputs, so
      // there is nothing for an asset to sit on, and that is a real answer
      // rather than something to hide.
      this.state$ = of<AddressAssetsState>({
        kind: 'ready',
        holdings: [],
        resolved: 0,
        notResolved: 0,
        total: 0,
        partial: false,
        checkpointHeight: null,
        provenEmpty: true,
      });
      return;
    }

    const references = utxos
      .filter(
        (utxo) =>
          utxo && typeof utxo.txid === 'string' && Number.isInteger(utxo.vout)
      )
      .map((utxo) => `${utxo.txid}:${utxo.vout}`);
    const covered = references.slice(0, MAXIMUM_RESOLVED_OUTPUTS);
    const notResolved = references.length - covered.length;

    const batches: string[][] = [];
    for (
      let index = 0;
      index < covered.length;
      index += UNIVERSE_OUTPOINT_BATCH_LIMIT
    ) {
      batches.push(covered.slice(index, index + UNIVERSE_OUTPOINT_BATCH_LIMIT));
    }

    this.state$ = this.retry$.pipe(
      switchMap(() =>
        forkJoin(batches.map((batch) => this.api.getOutpoints$(batch))).pipe(
          map((responses): AddressAssetsState => {
            const results = responses.flatMap(
              (response) => response?.results ?? []
            );
            if (results.some((result) => !covered.includes(result?.outpoint)))
              throw Error('Unrelated output evidence.');
            const summary = summarise(results);
            const unchecked = notResolved + covered.length - summary.resolved;
            return {
              ...summary,
              holdings: summary.holdings?.map((holding) =>
                present(holding)
              ),
              // Outputs this page did not ask about leave the scope partial even
              // when every output it did ask about answered. The rows are true;
              // the set they were drawn from is not the whole set.
              partial: summary.partial || unchecked > 0,
              notResolved: unchecked,
              total: references.length,
              provenEmpty:
                !summary.partial &&
                unchecked === 0 &&
                (summary.holdings?.length ?? 0) === 0,
              kind: 'ready',
            };
          }),
          catchError(() => of<AddressAssetsState>({ kind: 'unavailable' })),
          startWith<AddressAssetsState>({ kind: 'loading' })
        )
      )
    );
  }

  /** Explicit, bounded retry. One press, one fresh read; nothing polls. */
  retry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  trackByHolding(index: number, holding: ProtocolHolding): string {
    return holding.assetKey;
  }

  /**
   * The txid and vout of an outpoint, or null when it is not one.
   *
   * The network prefix is applied in the template through the relativeUrl pipe,
   * which is how every other outpoint link on the site is built. A bare
   * `/outpoint` route resolves against the root network, so on signet it sent a
   * reader to the mainnet outpoint of the same txid.
   */
  outpointParts(outpoint: string): { txid: string; vout: string } | null {
    const separator = outpoint.lastIndexOf(':');
    if (separator !== 64) {
      return null;
    }
    return { txid: outpoint.slice(0, 64), vout: outpoint.slice(65) };
  }

  toggle(holding: ProtocolHolding): void {
    if (this.expanded.has(holding.assetKey)) {this.expanded.delete(holding.assetKey);}
    else {this.expanded.add(holding.assetKey);}
  }

  isExpanded(holding: ProtocolHolding): boolean {
    return this.expanded.has(holding.assetKey);
  }

  /**
   * Copies the exact value and reports what actually happened. A button that
   * says "Copied" when nothing was copied loses the value a person was keeping.
   */
  copy(what: string, value: string): void {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      this.copyResults.set(what, 'failed');
      return;
    }
    clipboard.writeText(value).then(
      () => this.copyResults.set(what, 'copied'),
      () => this.copyResults.set(what, 'failed'),
    );
  }

  copyResult(what: string): 'copied' | 'failed' | null {
    return this.copyResults.get(what) ?? null;
  }
}

/** The identity key. The whole tuple, never the protocol and id alone. */
export function holdingKey(entry: {
  chain: string;
  network: string;
  protocolId: string;
  assetId: string;
  ruleset: string | null;
}): string {
  return JSON.stringify([
    entry.chain,
    entry.network,
    entry.protocolId,
    entry.assetId,
    entry.ruleset,
  ]);
}

interface HoldingAccumulator {
  chain: string;
  network: string;
  protocolId: string;
  assetId: string;
  ruleset: string | null;
  assetKind: string;
  displayName: string;
  ticker: string | null;
  /** Every distinct divisibility any authority stated for this identity. */
  statedDecimals: Set<number>;
  quantity: bigint | null;
  quantityKnown: boolean;
  outpoints: string[];
}

/** Everything the view needs for one holding, derived from the accumulator. */
function present(holding: ProtocolHolding): ProtocolHolding {
  return {
    ...holding,
    initials: initialsFor(holding.ticker ?? '', holding.displayName, holding.protocolId),
    shortAssetId: shortenAssetId(holding.assetId, 8),
    held: presentQuantity(holding.quantityAtomic, holding.decimals, holding.quantityKnown),
    detailsId: 'holding-details-' + hashKey(holding.assetKey),
  };
}

/**
 * Folds per-output positions into per-asset holdings.
 *
 * Quantities are summed with BigInt, never with JavaScript numbers: token
 * supplies routinely exceed the safe integer range and a silently rounded
 * balance would be worse than none.
 */
export function summarise(
  results: readonly OutpointEnrichment[]
): Omit<AddressAssetsState, 'kind' | 'notResolved' | 'total' | 'provenEmpty'> {
  const holdings = new Map<string, HoldingAccumulator>();
  let resolved = 0;
  let partial = false;
  let checkpointHeight: string | null = null;
  let checkpointKey: string | undefined;
  let mixedCheckpoints = false;
  const seen = new Set<string>();

  for (const result of results) {
    if (!result || seen.has(result.outpoint)) {
      partial = true;
      continue;
    }
    seen.add(result.outpoint);
    if (result?.status !== 'ok') {
      partial = true;
      continue;
    }
    resolved += 1;
    if (result.unknownAttachments) {
      partial = true;
    }
    const key = result.checkpoint
      ? JSON.stringify([
          result.checkpoint.chain,
          result.checkpoint.network,
          result.checkpoint.heightAtomic,
          result.checkpoint.blockHash,
          result.checkpoint.reorgEpoch,
        ])
      : 'missing';
    if (checkpointKey !== undefined && checkpointKey !== key) {
      mixedCheckpoints = true;
      partial = true;
    }
    checkpointKey = key;
    if (result.checkpoint?.heightAtomic) {
      checkpointHeight = result.checkpoint.heightAtomic;
    }
    for (const position of result.positions ?? []) {
      if (position.outpoint !== result.outpoint) {
        partial = true;
        continue;
      }
      if (!addPosition(holdings, position, result)) partial = true;
    }
  }

  const list: ProtocolHolding[] = [...holdings.entries()].map(
    ([assetKey, entry]) => ({
      assetKey,
      chain: entry.chain,
      network: entry.network,
      protocolId: entry.protocolId,
      assetId: entry.assetId,
      ruleset: entry.ruleset,
      assetKind: entry.assetKind,
      displayName: entry.displayName,
      ticker: entry.ticker,
      // One stated value is the divisibility. None is unknown and more than one
      // is a conflict, and both render as smallest units rather than as a scale
      // that would be applied to an exact sum.
      decimals: entry.statedDecimals.size === 1 ? [...entry.statedDecimals][0] : null,
      quantityAtomic: entry.quantity === null ? null : entry.quantity.toString(),
      quantityKnown: entry.quantityKnown && entry.quantity !== null,
      outpoints: entry.outpoints,
      // Filled in by present(); declared here so the shape is complete.
      initials: '',
      shortAssetId: '',
      held: presentQuantity(null, null),
      detailsId: '',
    })
  );

  list.sort(
    (a, b) =>
      a.protocolId.localeCompare(b.protocolId) ||
      b.outpoints.length - a.outpoints.length ||
      a.displayName.localeCompare(b.displayName)
  );

  return {
    holdings: list,
    resolved,
    partial,
    checkpointHeight: mixedCheckpoints ? null : checkpointHeight,
  };
}

function addPosition(
  holdings: Map<string, HoldingAccumulator>,
  position: ExplorerOutpointPosition,
  result: OutpointEnrichment
): boolean {
  const asset = position?.asset;
  if (!asset?.protocolId) {
    return false;
  }
  const chain = result.checkpoint?.chain ?? '';
  const network = result.checkpoint?.network ?? '';
  const ruleset = rulesetOf(asset);
  const assetId = asset.assetId ?? '';
  const assetKey = holdingKey({
    chain,
    network,
    protocolId: asset.protocolId,
    assetId,
    ruleset,
  });
  let entry = holdings.get(assetKey);
  if (!entry) {
    entry = {
      chain,
      network,
      protocolId: asset.protocolId,
      assetId,
      ruleset,
      assetKind: typeof asset.assetKind === 'string' ? asset.assetKind : 'unknown',
      displayName:
        asset.displayName || asset.ticker || assetId || asset.protocolId,
      ticker: typeof asset.ticker === 'string' && asset.ticker ? asset.ticker : null,
      statedDecimals: new Set<number>(),
      quantity: 0n,
      quantityKnown: true,
      outpoints: [],
    };
    holdings.set(assetKey, entry);
  }
  if (entry.outpoints.includes(position.outpoint)) {
    // The same output counted twice would double a balance, so the sum is
    // abandoned rather than adjusted.
    entry.quantity = null;
    entry.quantityKnown = false;
    return false;
  }
  entry.outpoints.push(position.outpoint);
  const stated = statedDecimalsOf(asset);
  if (stated !== null) entry.statedDecimals.add(stated);
  if (
    position.quantityAtomic &&
    /^(0|[1-9][0-9]{0,999})$/.test(position.quantityAtomic)
  ) {
    if (entry.quantity !== null)
      entry.quantity += BigInt(position.quantityAtomic);
  } else if (
    position.quantityAtomic === undefined ||
    position.quantityAtomic === null
  ) {
    // An inscription is one item by its protocol's own definition; anything
    // else with no stated quantity has an unknown one, which is not zero.
    if (asset.assetKind === 'inscription') {
      if (entry.quantity !== null) entry.quantity += 1n;
    } else {
      entry.quantity = null;
      entry.quantityKnown = false;
    }
  } else {
    entry.quantity = null;
    entry.quantityKnown = false;
  }
  return true;
}

function rulesetOf(asset: { readonly ruleset?: string }): string | null {
  return typeof asset.ruleset === 'string' && asset.ruleset ? asset.ruleset : null;
}

function statedDecimalsOf(asset: { readonly decimals?: unknown }): number | null {
  const value = asset.decimals;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 38) return null;
  return value;
}

/** A short, stable, DOM-safe id from an identity key. */
function hashKey(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
