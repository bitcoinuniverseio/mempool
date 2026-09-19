import { ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { BehaviorSubject, Observable, TimeoutError, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';
import {
  PresentedQuantity,
  initialsFor,
  presentQuantity,
  shortenAssetId,
} from '@app/universe/asset-summary/asset-summary.presentation';
import {
  INCONCLUSIVE_COVERAGE,
  SummaryAsset,
  SummaryCheckpoint,
  SummaryCoverageState,
  SummaryEffect,
  SummaryProtocolCoverage,
  TransactionAssetSummary,
  summaryAssetKey,
} from './transaction-assets.types';

/**
 * The automatic asset summary at the top of every transaction page: how many
 * supported assets the transaction touches, which protocol each belongs to,
 * its logo, and the exact amount in and out.
 *
 * It owns its own request. It is not a projection of the detailed flow and it
 * does not wait for one, because the detailed flow reads every outpoint from
 * every authority and was observed taking twenty one seconds.
 *
 * The states it distinguishes are the point of the component, and none of them
 * may collapse into another: loading, a partial answer, a source outage, a
 * malformed payload, a transaction the base authority proves does not exist,
 * and a transaction every applicable source proves carries no supported
 * assets. Only the last of those may say none.
 *
 * The display model is built once per response rather than recomputed by the
 * template. A template that calls a mapping function in a binding runs it on
 * every change detection pass, and two such bindings over one list produce two
 * different object identities for the same row, which defeats trackBy and
 * resets anything the row was holding, including which row a person had open.
 *
 * Wording is plain on purpose. A visitor reading a transaction page is not
 * assumed to know what divisibility, coverage or an atomic unit is, so the
 * view says "smallest units", "Partial" and "Not published" instead, and the
 * precise machine states stay in the payload for the people who need them.
 */

export type SummaryStateKind =
  | 'loading'
  | 'summary'
  | 'not-found'
  | 'unconfigured'
  | 'unavailable'
  | 'timeout'
  | 'error';

export interface SummaryViewState {
  kind: SummaryStateKind;
  summary?: TransactionAssetSummary;
  /** Everything the template renders, computed once when the response arrives. */
  model?: SummaryViewModel;
}

/** One asset row, with its identity, amounts and disclosure content. */
export interface DisplayAsset {
  key: string;
  asset: SummaryAsset;
  /** The registry entry, or a placeholder built from the id. */
  protocol: ExplorerProtocolDefinition;
  /** The heading shown for the asset: its name, ticker, or id. */
  title: string;
  /** The shortened id, only when it is not already the title. Empty otherwise. */
  subtitle: string;
  /** The complete id, for the disclosure and for copying. */
  assetId: string;
  /** Plain-language asset kind, e.g. "Token". Empty when it adds nothing. */
  kindLabel: string;
  /** One or two letters standing in for a missing logo. */
  initials: string;
  logoFailed: boolean;
  inputs: PresentedQuantity;
  outputs: PresentedQuantity;
  effects: DisplayEffect[];
  /** True when anything in the disclosure is worth opening it for. */
  hasDetails: boolean;
  /** The id of the row's disclosure region, for aria-controls. */
  detailsId: string;
}

/** One protocol effect, with the acceptance wording already decided. */
export interface DisplayEffect {
  effect: SummaryEffect;
  /** The plain label: the action, and whether the authority accepted it. */
  label: string;
  accepted: boolean;
  quantity: PresentedQuantity;
  /** The authority that stated it, or an empty string when none did. */
  authorityId: string;
}

/** One protocol's coverage, as the details list renders it. */
export interface CoverageRow {
  protocolId: string;
  name: string;
  state: SummaryCoverageState;
  /** Plain-language state, e.g. "Answered" or "Source not reachable". */
  stateLabel: string;
  /** Plain-language reason, or an empty string when the payload gave none. */
  reasonLabel: string;
  /** True when the gap is temporary, so retrying could change it. */
  retryable: boolean;
  /** True when the gap leaves the inventory inconclusive. */
  inconclusive: boolean;
}

export interface SummaryViewModel {
  rows: DisplayAsset[];
  coverage: CoverageRow[];
  /** The single overall badge: proven, partial, or none found. */
  chip: { state: string; label: string };
  countLabel: string;
  /** The short context line under the heading. */
  contextLabel: string;
  incomplete: boolean;
  provenEmpty: boolean;
  /** Coverage rows that leave the inventory inconclusive. */
  gaps: CoverageRow[];
  /** True when at least one gap could clear on a retry. */
  retryable: boolean;
  checkpoint: SummaryCheckpoint | null;
}

/**
 * Plain words for the authority's asset classification.
 *
 * The authority classifies; this only translates. A kind with no useful plain
 * word maps to an empty string rather than to a guess or to the raw token,
 * because a label a visitor cannot read is worse than no label.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  fungible: 'Token',
  inscription: 'Collectible',
  'non-fungible': 'Collectible',
  name: 'Name',
  sat: 'Rare sat',
  data: 'Data',
  'protocol-event': 'Event',
};

/**
 * Plain words for each coverage state.
 *
 * A permanent limit and a temporary outage read differently on purpose. Saying
 * "Waiting on" for a protocol nobody has a reader for promises an answer that
 * will never arrive, and a visitor who waits for it is being misled.
 */
const COVERAGE_STATE_LABELS: Readonly<Record<SummaryCoverageState, string>> = {
  complete: 'Answered',
  'proven-empty': 'Answered, none held',
  partial: 'Answered in part',
  'candidate-only': 'Unconfirmed only',
  'unsupported-network': 'Not available on this network',
  unconfigured: 'No source set up',
  unavailable: 'Source not reachable',
  'not-publicly-observable': 'Not publicly verifiable',
};

/**
 * Plain words for the machine-readable reasons the backend contract defines.
 *
 * An unknown reason maps to an empty string. Printing a raw token a visitor
 * cannot read is worse than printing nothing, and the payload still carries it
 * for anyone reading the API.
 */
const COVERAGE_REASON_LABELS: Readonly<Record<string, string>> = {
  'no-transaction-reader': 'No source reads this protocol per transaction.',
  'authority-unconfigured': 'This source is not set up on this deployment.',
  'authority-unavailable': 'This source did not answer.',
  'unsupported-network': 'This protocol does not run on this network.',
  'outpoint-inventory-not-retained':
    'The source no longer keeps the records for some of these outputs.',
  'public-proof-not-observable':
    'This protocol keeps its records private, so holdings cannot be verified publicly.',
  'reader-answered': '',
};

/**
 * The states a retry could plausibly change.
 *
 * A missing reader and an unsupported network will not change because somebody
 * pressed a button, so offering a retry for them is a false promise.
 */
const RETRYABLE_STATES: ReadonlySet<SummaryCoverageState> = new Set<SummaryCoverageState>([
  'unavailable',
  'partial',
  'candidate-only',
]);

@Component({
  selector: 'app-universe-transaction-assets',
  templateUrl: './transaction-assets.component.html',
  styleUrls: ['./transaction-assets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TransactionAssetsComponent implements OnChanges, OnDestroy {
  @Input() txid: string;
  @Input() chain = 'bitcoin';
  /**
   * The base transaction's status revision. A change here (a confirmation, a
   * replacement, a reorg) refreshes the summary. A render or a clock tick does
   * not: the summary must not re-request on every change detection pass.
   */
  @Input() statusRevision: string | number | boolean | null = null;

  state$: Observable<SummaryViewState>;

  /** Which rows a person has opened, keyed by full asset identity. */
  readonly expanded = new Set<string>();
  /** What the last copy attempt did, keyed by what was copied. */
  readonly copyResults = new Map<string, 'copied' | 'failed'>();
  /** True while an explicit retry is on cooldown, per the payload's request. */
  retryCooldown = false;

  private readonly retry$ = new BehaviorSubject<number>(0);
  private readonly logoFailures = new Set<string>();
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private universeApiService: UniverseApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.txid && !changes.chain && !changes.statusRevision) {
      return;
    }
    if (changes.txid || changes.chain) {
      // A new transaction or chain clears everything the previous one proved,
      // immediately, before the next answer arrives. Stale rows from another
      // transaction are worse than no rows, and a row left open from the
      // previous transaction would show another transaction's details.
      this.logoFailures.clear();
      this.expanded.clear();
      this.copyResults.clear();
    }
    if (!this.txid) {
      this.state$ = of({ kind: 'loading' as const });
      return;
    }
    const txid = this.txid;
    const chain = this.chain;
    this.state$ = this.retry$.pipe(
      switchMap(() => combineLatest([
        this.universeApiService.getTransactionAssets$(txid, chain),
        // Registry names and colours are presentation only, so the stream is
        // seeded with an empty map. combineLatest emits nothing until every
        // source has emitted once, which without the seed makes an optional
        // name lookup a gate on every proven amount on the page.
        this.universeApiService.getProtocols$().pipe(
          map((response) => new Map(response.protocols.map((entry) => [entry.id, entry]))),
          catchError(() => of(new Map<string, ExplorerProtocolDefinition>())),
          startWith(new Map<string, ExplorerProtocolDefinition>()),
        ),
      ]).pipe(
        map(([summary, protocols]): SummaryViewState => ({
          kind: 'summary',
          summary,
          model: this.buildModel(summary, protocols),
        })),
        catchError((error: unknown) => of<SummaryViewState>({ kind: this.classify(error) })),
        startWith<SummaryViewState>({ kind: 'loading' }),
      )),
    );
  }

  /**
   * Retry is explicit and bounded: one press, one fresh request, and a cooldown
   * the payload asked for. Nothing here polls, and no render triggers a refetch.
   */
  retry(retryAfterSeconds: number | null = null): void {
    if (this.retryCooldown) {return;}
    this.retry$.next(this.retry$.value + 1);
    const seconds = typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds, 60)
      : 0;
    if (seconds === 0) {return;}
    this.retryCooldown = true;
    if (this.cooldownTimer !== null) {clearTimeout(this.cooldownTimer);}
    this.cooldownTimer = setTimeout(() => {
      this.retryCooldown = false;
      this.cooldownTimer = null;
    }, seconds * 1000);
  }

  ngOnDestroy(): void {
    if (this.cooldownTimer !== null) {clearTimeout(this.cooldownTimer);}
  }

  /**
   * Distinguishes the failure kinds a visitor needs told apart.
   *
   * The statuses come from what the API actually returns: the summary route
   * answers 404 only when the base authority proved the transaction absent, and
   * 503 when the deployment has no source configured. A 502 or 504 is an
   * upstream outage, which is a different fact from "not set up", and anything
   * else stays generic rather than being guessed into a specific cause.
   */
  private classify(error: unknown): SummaryStateKind {
    if (error instanceof TimeoutError) {return 'timeout';}
    const response = error as HttpErrorResponse;
    if (response && typeof response.status === 'number') {
      if (response.status === 404) {return 'not-found';}
      if (response.status === 503) {return 'unconfigured';}
      if (response.status === 502 || response.status === 504) {return 'unavailable';}
    }
    return 'error';
  }

  /**
   * Everything the template needs, built once from one response.
   *
   * Keyed by full identity throughout. Two protocols may legitimately use the
   * same asset id and two rulesets may read the same ledger; keying by assetId
   * alone would merge them into one row and silently drop a proven asset.
   */
  private buildModel(
    summary: TransactionAssetSummary,
    protocols: Map<string, ExplorerProtocolDefinition>,
  ): SummaryViewModel {
    const rows = summary.assets.map((asset) => this.buildRow(asset, protocols));
    const coverage = summary.perProtocolCoverage.map((entry) =>
      this.buildCoverage(entry, protocols),
    );
    const gaps = coverage.filter((entry) => entry.inconclusive);
    const provenEmpty = summary.counts.totalCount === 0 && summary.assets.length === 0;
    const incomplete = summary.counts.totalCount === null;
    return {
      rows,
      coverage,
      gaps,
      retryable: gaps.some((entry) => entry.retryable),
      provenEmpty,
      incomplete,
      chip: provenEmpty
        ? { state: 'state-proven', label: 'None found' }
        : incomplete
          ? { state: 'state-partial', label: 'Partial' }
          : { state: 'state-proven', label: 'Complete' },
      countLabel: this.countLabel(summary, provenEmpty, incomplete),
      contextLabel: this.contextLabel(summary, rows),
      checkpoint: summary.checkpoint,
    };
  }

  private buildRow(
    asset: SummaryAsset,
    protocols: Map<string, ExplorerProtocolDefinition>,
  ): DisplayAsset {
    const key = summaryAssetKey(asset);
    const protocol = this.protocolFor(protocols, asset.protocolId);
    const title = asset.displayName || asset.ticker || asset.assetId;
    const inputs = presentQuantity(asset.inputs.quantityAtomic, asset.decimals, asset.inputs.complete);
    const outputs = presentQuantity(asset.outputs.quantityAtomic, asset.decimals, asset.outputs.complete);
    const effects = asset.effects.map((effect) => this.buildEffect(effect, asset));
    return {
      key,
      asset,
      protocol,
      title,
      subtitle: title === asset.assetId ? '' : shortenAssetId(asset.assetId, 8),
      assetId: asset.assetId,
      kindLabel: KIND_LABELS[asset.assetKind] ?? '',
      initials: initialsFor(protocol.shortName, title),
      // The failure is keyed by the artwork, not only by the asset: a replaced
      // logo is a different image and deserves its own attempt rather than
      // inheriting the previous revision's failure forever.
      logoFailed: this.logoFailures.has(this.logoKey(key, asset)),
      inputs,
      outputs,
      effects,
      hasDetails: true,
      detailsId: 'asset-details-' + hashKey(key),
    };
  }

  private buildEffect(effect: SummaryEffect, asset: SummaryAsset): DisplayEffect {
    const action = effect.actionType.replace(/[_-]+/g, ' ');
    return {
      effect,
      accepted: effect.accepted,
      // "Not accepted" covers a rejected record and one no authority has ruled
      // on. Narrowing it to "unconfirmed" would tell a reader that time alone
      // will settle it, which for a rejected transfer is false.
      label: effect.accepted ? action : action + ' (not accepted)',
      quantity: presentQuantity(effect.quantityAtomic, asset.decimals),
      authorityId: effect.evidence?.authorityId ?? '',
    };
  }

  private buildCoverage(
    entry: SummaryProtocolCoverage,
    protocols: Map<string, ExplorerProtocolDefinition>,
  ): CoverageRow {
    const reason = entry.reason ?? '';
    return {
      protocolId: entry.protocolId,
      name: this.protocolFor(protocols, entry.protocolId).displayName,
      state: entry.state,
      stateLabel: COVERAGE_STATE_LABELS[entry.state] ?? entry.state,
      reasonLabel: COVERAGE_REASON_LABELS[reason] ?? '',
      retryable: RETRYABLE_STATES.has(entry.state),
      inconclusive: INCONCLUSIVE_COVERAGE.has(entry.state),
    };
  }

  /** The registry entry, or a placeholder so the badge still names something. */
  private protocolFor(
    protocols: Map<string, ExplorerProtocolDefinition>,
    protocolId: string,
  ): ExplorerProtocolDefinition {
    const known = protocols.get(protocolId);
    if (known) {return known;}
    const readable = protocolId.replace(/[_-]+/g, ' ');
    return {
      id: protocolId,
      shortName: readable,
      displayName: readable,
      visualToken: protocolId,
    } as ExplorerProtocolDefinition;
  }

  /** The count sentence beside the heading. Plural forms are spelled out. */
  private countLabel(
    summary: TransactionAssetSummary,
    provenEmpty: boolean,
    incomplete: boolean,
  ): string {
    if (provenEmpty) {
      return 'No supported assets';
    }
    const found = summary.assets.length;
    const noun = found === 1 ? 'asset' : 'assets';
    return incomplete ? `${found} ${noun} found so far` : `${found} ${noun}`;
  }

  /**
   * The short context line: how many protocols the found assets span.
   *
   * It describes what was found, never a total. A count of protocols on the
   * roster would read as an inventory of the transaction, which it is not.
   */
  private contextLabel(summary: TransactionAssetSummary, rows: DisplayAsset[]): string {
    if (rows.length === 0) {return '';}
    const protocols = new Set(rows.map((row) => row.asset.protocolId)).size;
    return protocols === 1 ? '1 protocol' : `${protocols} protocols`;
  }

  private logoKey(key: string, asset: SummaryAsset): string {
    const revision = asset.logo ? asset.logo.contentHash + '/' + asset.logo.metadataRevision : '';
    return key + ' ' + revision;
  }

  /** One deterministic fallback per artwork revision. Never a request loop. */
  onLogoError(row: DisplayAsset): void {
    this.logoFailures.add(this.logoKey(row.key, row.asset));
    row.logoFailed = true;
  }

  toggle(row: DisplayAsset): void {
    if (this.expanded.has(row.key)) {this.expanded.delete(row.key);}
    else {this.expanded.add(row.key);}
  }

  isExpanded(row: DisplayAsset): boolean {
    return this.expanded.has(row.key);
  }

  /**
   * Copies the exact value and reports what actually happened.
   *
   * Clipboard access can be denied, and a button that shows "Copied" when
   * nothing was copied is worse than one that shows nothing at all: a person
   * pastes and loses the value they were trying to keep.
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

  trackRow(_index: number, row: DisplayAsset): string {
    return row.key;
  }

  trackCoverage(_index: number, row: CoverageRow): string {
    return row.protocolId;
  }

  trackEffect(_index: number, row: DisplayEffect): string {
    return row.effect.eventId;
  }
}

/**
 * A short, stable, DOM-safe id from an identity key.
 *
 * An identity key is a JSON tuple and contains quotes and brackets, which a DOM
 * id and an aria-controls reference cannot carry.
 */
function hashKey(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
