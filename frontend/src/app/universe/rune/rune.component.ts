import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Observable, Subject, Subscription, catchError, combineLatest, defer, distinctUntilChanged, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import { ExplorerNetwork, OrdRuneView } from '@app/universe/universe.types';
import {
  ASSET_LOOKUP_GATEWAY_RESPONSE_MS,
  AssetViewState,
  applyDivisibility,
  assetState$,
  assetStatusMessage,
  assetTone,
  mintProgressPercent,
  utcFromSeconds,
} from '@app/universe/asset-lookup';
import { assetRouteContext$, assetRouteState$ } from '@app/universe/asset-route-context';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * One rune, with its mint terms and current progress stated exactly as the
 * authority reports them.
 *
 * Mint progress is a real ratio out of a real cap. A rune with open terms has
 * no progress and the page says so, rather than showing a bar that means
 * nothing.
 */
@Component({
  selector: 'app-universe-rune',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, BookmarkButtonComponent],
  templateUrl: './rune.component.html',
  styleUrls: ['./rune.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuneComponent implements OnInit, OnDestroy {
  state$: Observable<AssetViewState<OrdRuneView>>;

  readonly shorten = shortenIdentifier;
  readonly statusMessage = assetStatusMessage;
  readonly tone = assetTone;
  readonly utc = utcFromSeconds;
  readonly amount = formatAtomicAmount;

  private visitSubscription?: Subscription;
  private readonly retrySubject = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private local: UniverseLocalService,
    private seo: SeoService,
    @Optional() private router?: Router,
  ) {}

  ngOnInit(): void {
    type Context = { reference: string; network: ExplorerNetwork | null };
    const equal = (previous: Context, current: Context): boolean => previous.reference === current.reference && previous.network === current.network;
    const contexts$ = assetRouteContext$(combineLatest([
      this.route.paramMap.pipe(map(params => (params.get('reference') || '').trim()), distinctUntilChanged()),
      defer(() => this.api.selectedNetwork$()).pipe(catchError(() => of(null))),
    ]).pipe(
      map(([reference, network]): Context => ({ reference, network })), distinctUntilChanged(equal),
    ), this.router);
    this.state$ = this.retrySubject.pipe(
      startWith(undefined),
      switchMap(() => assetRouteState$(contexts$, ({ reference, network }) => {
        this.seo.setTitle(`Rune ${reference}`);
        return assetState$<OrdRuneView>(reference, () => {
          if (network === null) {throw new Error('Unsupported asset context');}
          return this.api.getRune$(reference, network);
        }, { firstResponseTimeoutMs: this.api.assetLookupDeadlineMs ?? ASSET_LOOKUP_GATEWAY_RESPONSE_MS });
      }, ({ reference }): AssetViewState<OrdRuneView> => ({ kind: 'loading', reference }),
      ({ reference }): AssetViewState<OrdRuneView> => ({ kind: 'unavailable', reference }), equal)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.visitSubscription = this.state$.subscribe((state) => {
      if (state.kind !== 'ready' || !state.result?.value) {return;}
      const rune = state.result.value;
      this.local.recordVisit({
        kind: 'rune',
        value: rune.rune,
        path: `/rune/${rune.rune}`,
        label: rune.spacedRune,
      });
    });
  }

  retry(): void {
    this.retrySubject.next();
  }

  ngOnDestroy(): void {
    this.visitSubscription?.unsubscribe();
  }

  /** Supply figures respect the rune's own divisibility, never a float. */
  scaled(atomic: string, rune: OrdRuneView): string {
    return applyDivisibility(atomic, rune.divisibilityAtomic);
  }

  progress(rune: OrdRuneView): number | null {
    return mintProgressPercent(rune.mintsAtomic, rune.terms?.capAtomic);
  }

  mintStateLabel(rune: OrdRuneView): string {
    return rune.mintable
      ? $localize`:@@universe.rune.mintable:Open for minting`
      : $localize`:@@universe.rune.closed:Closed to minting`;
  }

  mintStateTone(rune: OrdRuneView): string {
    return rune.mintable ? 'pending' : 'proven';
  }

  /** Explains why minting is closed only when the terms actually prove it. */
  mintExplanation(rune: OrdRuneView): string {
    if (rune.mintable) {
      return $localize`:@@universe.rune.mintable-detail:The authority reports this rune can still be minted at the block below.`;
    }
    if (!rune.terms) {
      return $localize`:@@universe.rune.no-terms:This rune was etched without mint terms, so it was never open for public minting.`;
    }
    return $localize`:@@universe.rune.closed-detail:The authority reports this rune can no longer be minted at the block below.`;
  }

  hasHeightWindow(rune: OrdRuneView): boolean {
    return !!(rune.terms?.heightStartAtomic || rune.terms?.heightEndAtomic);
  }

  hasOffsetWindow(rune: OrdRuneView): boolean {
    return !!(rune.terms?.offsetStartAtomic || rune.terms?.offsetEndAtomic);
  }
}
