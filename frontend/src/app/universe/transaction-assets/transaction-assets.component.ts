import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BehaviorSubject, Observable, TimeoutError, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';
import {
  SummaryAsset,
  SummaryCoverageState,
  TransactionAssetSummary,
  exactQuantity,
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
  | 'timeout'
  | 'error';

export interface SummaryViewState {
  kind: SummaryStateKind;
  summary?: TransactionAssetSummary;
  /** Registry definitions by protocol id, for official names and colours. */
  protocols?: Map<string, ExplorerProtocolDefinition>;
}

/** One amount as the view renders it: exact where possible, labelled otherwise. */
export interface DisplayQuantity {
  /** 'exact' carries a decimal value; 'raw' carries smallest-unit digits. */
  kind: 'exact' | 'raw' | 'none';
  value: string;
  /** True when the side the value came from was only partly proven. */
  partial: boolean;
}

export interface DisplayAsset {
  key: string;
  asset: SummaryAsset;
  /** The registry entry, or a placeholder built from the id. */
  protocol: ExplorerProtocolDefinition;
  /** The heading shown for the asset: its name, ticker, or id. */
  title: string;
  /** The id, only when it is not already the title. Empty otherwise. */
  subtitle: string;
  /** Plain-language asset kind, e.g. "Token". Empty when it adds nothing. */
  kindLabel: string;
  /** One or two letters standing in for a missing logo. */
  initials: string;
  logoFailed: boolean;
  inputs: DisplayQuantity;
  outputs: DisplayQuantity;
}

/** Coverage states that leave the inventory inconclusive. */
const INCONCLUSIVE: ReadonlySet<SummaryCoverageState> = new Set<SummaryCoverageState>([
  'partial',
  'candidate-only',
  'unsupported-network',
  'unconfigured',
  'unavailable',
  'not-publicly-observable',
]);

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

@Component({
  selector: 'app-universe-transaction-assets',
  templateUrl: './transaction-assets.component.html',
  styleUrls: ['./transaction-assets.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TransactionAssetsComponent implements OnChanges {
  @Input() txid: string;
  @Input() chain = 'bitcoin';
  /**
   * The base transaction's status revision. A change here (a confirmation, a
   * replacement, a reorg) refreshes the summary. A render or a clock tick does
   * not: the summary must not re-request on every change detection pass.
   */
  @Input() statusRevision: string | number | boolean | null = null;

  state$: Observable<SummaryViewState>;

  private readonly retry$ = new BehaviorSubject<number>(0);
  private readonly logoFailures = new Set<string>();

  constructor(private universeApiService: UniverseApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.txid && !changes.chain && !changes.statusRevision) {
      return;
    }
    if (changes.txid || changes.chain) {
      // A new transaction or chain clears everything the previous one proved,
      // immediately, before the next answer arrives. Stale rows from another
      // transaction are worse than no rows.
      this.logoFailures.clear();
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
        // Registry names and colours are presentation only. If the registry is
        // unavailable the summary still renders, with ids standing in for the
        // official names; metadata never gates a proven amount.
        this.universeApiService.getProtocols$().pipe(
          map((response) => new Map(response.protocols.map((entry) => [entry.id, entry]))),
          catchError(() => of(new Map<string, ExplorerProtocolDefinition>())),
        ),
      ]).pipe(
        map(([summary, protocols]): SummaryViewState => ({ kind: 'summary', summary, protocols })),
        catchError((error: unknown) => of<SummaryViewState>({ kind: this.classify(error) })),
        startWith<SummaryViewState>({ kind: 'loading' }),
      )),
    );
  }

  /** Retry is explicit and bounded: one press, one fresh request. */
  retry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  /**
   * Distinguishes the failure kinds a visitor needs told apart. A timeout, an
   * unconfigured authority and a proven-absent transaction are three different
   * facts, and none of them is an empty asset list.
   */
  private classify(error: unknown): SummaryStateKind {
    if (error instanceof TimeoutError) {return 'timeout';}
    const response = error as HttpErrorResponse;
    if (response && typeof response.status === 'number') {
      if (response.status === 404) {return 'not-found';}
      if (response.status === 503) {return 'unconfigured';}
    }
    return 'error';
  }

  /**
   * The rows to render, keyed by full identity.
   *
   * Two protocols may legitimately use the same asset id and two rulesets may
   * read the same ledger; keying by assetId alone would merge them into one
   * row and silently drop a proven asset.
   */
  rows(state: SummaryViewState): DisplayAsset[] {
    const summary = state.summary;
    if (!summary) {return [];}
    return summary.assets.map((asset) => {
      const key = summaryAssetKey(asset);
      const protocol = this.protocolFor(state, asset.protocolId);
      const title = asset.displayName || asset.ticker || asset.assetId;
      return {
        key,
        asset,
        protocol,
        title,
        subtitle: title === asset.assetId ? '' : asset.assetId,
        kindLabel: KIND_LABELS[asset.assetKind] ?? '',
        initials: this.initialsFor(protocol, title),
        logoFailed: this.logoFailures.has(key),
        inputs: this.quantity(asset, asset.inputs.quantityAtomic, asset.inputs.complete),
        outputs: this.quantity(asset, asset.outputs.quantityAtomic, asset.outputs.complete),
      };
    });
  }

  /** The registry entry, or a placeholder so the badge still names something. */
  private protocolFor(state: SummaryViewState, protocolId: string): ExplorerProtocolDefinition {
    const known = state.protocols?.get(protocolId);
    if (known) {return known;}
    const readable = protocolId.replace(/[_-]+/g, ' ');
    return {
      id: protocolId,
      shortName: readable,
      displayName: readable,
      visualToken: protocolId,
    } as ExplorerProtocolDefinition;
  }

  /**
   * One or two letters standing in for a missing logo.
   *
   * A labelled placeholder in the protocol's own hue reads as a deliberate
   * stand-in. An empty grey square reads as an image that failed to load, and
   * neither may be mistaken for a verified token logo.
   */
  private initialsFor(protocol: ExplorerProtocolDefinition, title: string): string {
    const source = (protocol.shortName || title || '?').trim();
    const words = source.split(/[\s._-]+/).filter(Boolean);
    const letters = words.length > 1
      ? words[0].charAt(0) + words[1].charAt(0)
      : source.slice(0, 2);
    return letters.toUpperCase();
  }

  /**
   * One displayable amount.
   *
   * An exact decimal needs the authority's divisibility. Without it the digits
   * are still true, so they are shown labelled as smallest units rather than
   * as whole tokens, which would understate the amount by up to thirty eight
   * orders of magnitude.
   */
  private quantity(asset: SummaryAsset, quantityAtomic: string | null, complete: boolean): DisplayQuantity {
    if (quantityAtomic === null) {
      return { kind: 'none', value: '', partial: !complete };
    }
    const exact = exactQuantity(quantityAtomic, asset.decimals);
    return exact === null
      ? { kind: 'raw', value: quantityAtomic, partial: !complete }
      : { kind: 'exact', value: exact, partial: !complete };
  }

  /** One deterministic fallback per identity. Never a request loop. */
  onLogoError(key: string): void {
    this.logoFailures.add(key);
  }

  trackRow(_index: number, row: DisplayAsset): string {
    return row.key;
  }

  /** How many sources could not answer. Drives the partial notice. */
  gapCount(summary: TransactionAssetSummary): number {
    return summary.perProtocolCoverage.filter((entry) => INCONCLUSIVE.has(entry.state)).length;
  }

  /** The official names of those sources, for the expandable detail. */
  gapNames(state: SummaryViewState): string[] {
    const summary = state.summary;
    if (!summary) {return [];}
    return summary.perProtocolCoverage
      .filter((entry) => INCONCLUSIVE.has(entry.state))
      .map((entry) => this.protocolFor(state, entry.protocolId).displayName)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * True only when every applicable source proved absence. Any other state
   * means the transaction is not known to be empty, merely not known.
   */
  provenEmpty(summary: TransactionAssetSummary): boolean {
    return summary.counts.totalCount === 0 && summary.assets.length === 0;
  }

  incomplete(summary: TransactionAssetSummary): boolean {
    return summary.counts.totalCount === null;
  }

  /** The evidence chip for the whole summary: proven, partial, or none found. */
  summaryChip(summary: TransactionAssetSummary): { state: string; label: string } {
    if (this.provenEmpty(summary)) {
      return { state: 'state-proven', label: 'None found' };
    }
    return this.incomplete(summary)
      ? { state: 'state-partial', label: 'Partial' }
      : { state: 'state-proven', label: 'Complete' };
  }

  /** The count sentence beside the heading. Plural forms are spelled out. */
  countLabel(summary: TransactionAssetSummary): string {
    if (this.provenEmpty(summary)) {
      return 'No supported assets';
    }
    const found = summary.assets.length;
    const noun = found === 1 ? 'asset' : 'assets';
    return this.incomplete(summary)
      ? `${found} ${noun} found so far`
      : `${found} ${noun}`;
  }
}
