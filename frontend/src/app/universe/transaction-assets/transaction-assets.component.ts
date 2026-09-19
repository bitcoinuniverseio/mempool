import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BehaviorSubject, Observable, catchError, map, of, startWith, switchMap } from 'rxjs';
import { TimeoutError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  SummaryAsset,
  SummaryCoverageState,
  TransactionAssetSummary,
  exactQuantity,
  summaryAssetKey,
} from './transaction-assets.types';

/**
 * The automatic, compact asset summary shown at the top of every transaction
 * page: how many distinct supported assets the transaction touches, which
 * protocols they belong to, their verified logo where one exists, and the
 * exact quantity on each side.
 *
 * It owns its own request. It is not a projection of the detailed flow and it
 * does not wait for one, because the detailed flow reads every outpoint from
 * every authority and was observed taking twenty one seconds.
 *
 * The states it distinguishes are the point of the component, and none of them
 * may collapse into another: loading, a partial answer with named gaps, a
 * source outage, a malformed payload, a transaction the base authority proves
 * does not exist, and a transaction every applicable source proves carries no
 * supported assets. Only the last of those may say zero.
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
}

/** One quantity as the template renders it: exact where possible, labelled otherwise. */
export interface DisplayQuantity {
  /** 'exact' carries a decimal value; 'atomic' carries raw digits to label. */
  kind: 'exact' | 'atomic' | 'unavailable';
  value: string;
  /** True when the side or effect the value came from is itself incomplete. */
  partial: boolean;
}

export interface DisplayAsset {
  key: string;
  asset: SummaryAsset;
  /** Set once a logo request fails, so the fallback is used exactly once. */
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
      switchMap(() => this.universeApiService.getTransactionAssets$(txid, chain).pipe(
        map((summary): SummaryViewState => ({ kind: 'summary', summary })),
        catchError((error: unknown) => of<SummaryViewState>({ kind: this.classify(error) })),
        startWith<SummaryViewState>({ kind: 'loading' }),
      )),
    );
  }

  /** Retry is explicit and bounded: one user action, one fresh request. */
  retry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  /**
   * Distinguishes the failure kinds a user needs told apart. A timeout, an
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
  rows(summary: TransactionAssetSummary): DisplayAsset[] {
    return summary.assets.map((asset) => {
      const key = summaryAssetKey(asset);
      return {
        key,
        asset,
        logoFailed: this.logoFailures.has(key),
        inputs: this.quantity(asset, asset.inputs.quantityAtomic, asset.inputs.complete),
        outputs: this.quantity(asset, asset.outputs.quantityAtomic, asset.outputs.complete),
      };
    });
  }

  /**
   * One displayable quantity.
   *
   * An exact decimal needs the authority's divisibility. Without it the digits
   * are still true, so they are shown labelled as atomic units rather than
   * being rendered as whole tokens, which would understate the amount by up to
   * thirty eight orders of magnitude.
   */
  private quantity(asset: SummaryAsset, quantityAtomic: string | null, complete: boolean): DisplayQuantity {
    if (quantityAtomic === null) {
      return { kind: 'unavailable', value: '', partial: !complete };
    }
    const exact = exactQuantity(quantityAtomic, asset.decimals);
    return exact === null
      ? { kind: 'atomic', value: quantityAtomic, partial: !complete }
      : { kind: 'exact', value: exact, partial: !complete };
  }

  /** One deterministic fallback per identity. Never a request loop. */
  onLogoError(key: string): void {
    this.logoFailures.add(key);
  }

  trackRow(_index: number, row: DisplayAsset): string {
    return row.key;
  }

  /** The protocols that left the inventory inconclusive, for the notice. */
  gaps(summary: TransactionAssetSummary): string[] {
    return summary.perProtocolCoverage
      .filter((entry) => INCONCLUSIVE.has(entry.state))
      .map((entry) => entry.protocolId);
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

  protocolIcon(protocolId: string): string {
    return 'protocol-' + protocolId.replace(/_/g, '-');
  }
}
