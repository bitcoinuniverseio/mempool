import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Subscription, combineLatest, merge, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { LoadState, trackedLoadState } from '@app/shared/load-state';

interface RewardSummary {
  totalReward: number;
  feePerTx: number;
  feePerBlock: number;
}

/**
 * Reward numbers for the last 144 blocks.
 *
 * This widget used to concat the first read with a chain-tip driven refresh and
 * render it through one async pipe with an else skeleton. A failing read killed
 * the stream, so the skeleton stayed on screen for the rest of the session with
 * nothing left to clear it.
 */
@Component({
  selector: 'app-reward-stats',
  templateUrl: './reward-stats.component.html',
  styleUrls: ['./reward-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class RewardStatsComponent implements OnInit, OnDestroy {
  state: LoadState<RewardSummary> = { status: 'loading' };

  private retry$ = new BehaviorSubject<number>(0);
  private subscription: Subscription | null = null;

  constructor(
    private apiService: ApiService,
    private stateService: StateService,
    private cd: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    // Chain tips arrive in bursts around a new block. Coalescing them means one
    // refresh per burst rather than one request per websocket frame.
    const tip$ = this.stateService.blocks$.pipe(
      map((blocks) => blocks.reduce((max, block) => Math.max(max, block.height), 0)),
      distinctUntilChanged(),
      debounceTime(1000),
      startWith(0),
    );

    const trigger$ = combineLatest([tip$, this.retry$]).pipe(
      map(([height, attempt]) => `${height}:${attempt}`),
    );

    this.subscription = trackedLoadState(
      trigger$,
      () => this.apiService.getRewardStats$().pipe(
        map((stats): RewardSummary => ({
          totalReward: stats.totalReward,
          // A window with no transactions is a real answer, not a division to
          // let through as NaN.
          feePerTx: stats.totalTx > 0 ? stats.totalFee / stats.totalTx : 0,
          feePerBlock: stats.totalFee / 144,
        })),
      ),
      { isEmpty: () => false },
    ).subscribe((state) => {
      this.state = state;
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  get rewardStats(): RewardSummary | null {
    return this.state.status === 'data' || this.state.status === 'stale' ? this.state.value : null;
  }

  onRetry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  isEllipsisActive(e): boolean {
    return (e.offsetWidth < e.scrollWidth);
  }
}
