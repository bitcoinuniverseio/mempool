import { Component, OnInit, ChangeDetectionStrategy, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { StateService } from '@app/services/state.service';
import { Observable, combineLatest, Subscription } from 'rxjs';
import { Recommendedfees } from '@interfaces/websocket.interface';
import { feeLevels } from '@app/app.constants';
import { map, startWith, tap } from 'rxjs/operators';
import { ThemeService } from '@app/services/theme.service';
import { LoadState } from '@app/shared/load-state';

@Component({
  selector: 'app-fees-box',
  templateUrl: './fees-box.component.html',
  styleUrls: ['./fees-box.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class FeesBoxComponent implements OnInit, OnDestroy {
  isLoading$: Observable<boolean>;
  /**
   * Whether the socket that carries these numbers has given up. It is the only
   * source for them and it never errors, so without this the placeholders here
   * would go on claiming an answer was coming for as long as the tab was open.
   */
  liveFeed$: Observable<LoadState<boolean>>;
  recommendedFees$: Observable<Recommendedfees>;
  themeStateSubscription: Subscription;
  gradient = 'linear-gradient(to right, var(--skeleton-bg), var(--skeleton-bg))';
  noPriority = 'var(--skeleton-bg)';
  fees: Recommendedfees;

  constructor(
    private stateService: StateService,
    private themeService: ThemeService,
    private cd: ChangeDetectorRef,
  ) { }

  /**
   * IMPLEMENTATION-HANDOFF [API-05] API-05-FEES-VIEW | F-FE-001 | FAIL.
   * Reproduction: socket=false, loadingIndicators={}, cached recommendedFees,
   * liveFeed.status=error => isLoading=false and the template displays rates.
   * The error message exists only in the template's loadingFees branch.
   * 1. Replace this display gate with StateService.feeEstimate$ from the
   *    versioned WebsocketResponse contract. Preserve numeric sat/vB format,
   *    priority order, color tokens and the established fee scale.
   * 2. Render ready data only with matching network/producer freshness proof;
   *    show dated last-good values explicitly stale, syncing or unavailable
   *    feedback otherwise. A missing indicator must not assert readiness.
   * 3. Use the existing shared reconnect/retry lifecycle, not per-widget HTTP
   *    polling. Preserve cancellation and prevent repeated clicks spawning work.
   * 4. Add PROPOSED NEW fees-box.component.spec.ts: actual RxJS/template tests
   *    for cached init+REST 503, empty indicators, ready->offline, network switch,
   *    malformed metadata and fresh recovery. Run npm test -- that path,
   *    npm run lint and npm run build:universe from frontend.
   * Acceptance: desktop/mobile and all supported themes show truthful fee
   *    state on Signet; controlled failures terminate loading and remain
   *    recoverable. Evidence: frontend-source-reproductions.json F-FE-001 and
   *    root browser evidence. Existing reproduction is not a functional PASS.
   * Dependencies API-01..API-04, producer and client feeEstimate work in API-05.
   * Rollback keeps source-state handling; never restore unqualified old rates.
   */
  ngOnInit(): void {
    this.liveFeed$ = this.stateService.liveFeed$;
    this.isLoading$ = combineLatest(
      this.stateService.isLoadingWebSocket$.pipe(startWith(false)),
      this.stateService.loadingIndicators$.pipe(startWith({ mempool: 0 })),
    ).pipe(map(([socket, indicators]) => {
      return socket || (indicators.mempool != null && indicators.mempool !== 100);
    }));
    this.recommendedFees$ = this.stateService.recommendedFees$
      .pipe(
        tap((fees) => {
          this.fees = fees;
          this.setFeeGradient();
        }
      )
    );
    this.themeStateSubscription = this.themeService.themeState$.subscribe((state) => {
      if (!state.loading) {
        this.setFeeGradient();
      }
    });
  }

  setFeeGradient() {
    if (!this.fees || !this.themeService.mempoolFeeColors) {
      return;
    }
    let feeLevelIndex = feeLevels.slice().reverse().findIndex((feeLvl) => this.fees.minimumFee >= feeLvl);
    feeLevelIndex = feeLevelIndex >= 0 ? feeLevels.length - feeLevelIndex : feeLevelIndex;
    const startColor = '#' + (this.themeService.mempoolFeeColors[feeLevelIndex - 1] || this.themeService.mempoolFeeColors[this.themeService.mempoolFeeColors.length - 1]);

    feeLevelIndex = feeLevels.slice().reverse().findIndex((feeLvl) => this.fees.fastestFee >= feeLvl);
    feeLevelIndex = feeLevelIndex >= 0 ? feeLevels.length - feeLevelIndex : feeLevelIndex;
    const endColor = '#' + (this.themeService.mempoolFeeColors[feeLevelIndex - 1] || this.themeService.mempoolFeeColors[this.themeService.mempoolFeeColors.length - 1]);

    this.gradient = `linear-gradient(to right, ${startColor}, ${endColor})`;
    this.noPriority = startColor;

    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.themeStateSubscription.unsubscribe();
  }
}
