import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  map,
  of,
  switchMap,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ChainDashboardService } from '@app/universe/chain-dashboard/chain-dashboard.service';
import { ChainTimelineComponent } from '@app/universe/chain-dashboard/chain-timeline.component';
import {
  ChainTimelineReading,
  readChainTimeline,
} from '@app/universe/chain-dashboard/chain-timeline';
import {
  readMeanBasis,
  type MeanBasisReading,
} from '@app/universe/chain-dashboard/mean-basis';
import {
  formatDifficulty,
  formatNetworkRate,
  formatSeconds,
} from '@app/universe/chain-dashboard/chain-dashboard-format';
import { readCandidateBuckets } from '@app/universe/multichain-explorer/candidate-buckets';
import {
  ChainProfile,
  ExactNumber,
  chainProfile,
  formatAtomicAmount,
  formatExactInteger,
  formatTimestamp,
} from '@app/universe/multichain-explorer/multichain-view';
import {
  ChainBlockSummary,
  ExplorerChain,
  MiningPoolsView,
  MiningSummaryView,
} from '@app/universe/universe.types';

interface PoolRowReading {
  readonly poolId: string;
  readonly name: string;
  readonly blocks: ExactNumber | null;
  readonly sharePercent: number;
  readonly evidence: readonly string[];
  readonly unknown: boolean;
}

interface MiningViewModel {
  readonly timeline: ChainTimelineReading | null;
  readonly summary: MiningSummaryView | null;
  readonly difficulty: ExactNumber | null;
  readonly networkRate: ExactNumber | null;
  readonly target: ExactNumber | null;
  readonly observed: ExactNumber | null;
  readonly subsidy: ExactNumber | null;
  readonly meanReward: ExactNumber | null;
  readonly meanFees: ExactNumber | null;
  readonly meanBasis: MeanBasisReading | null;
  readonly pools: MiningPoolsView | null;
  readonly poolRows: readonly PoolRowReading[];
  readonly poolsError: boolean;
  readonly recentBlocks: readonly ChainBlockSummary[];
  readonly viewError: string | null;
}

const POOL_WINDOWS = ['24h', '3d', '1w', '1m'] as const;

const EVIDENCE_LABELS: Record<string, string> = {
  'coinbase-tag': $localize`:@@universe.mining.evidence-tag:coinbase tag`,
  'payout-address': $localize`:@@universe.mining.evidence-address:payout address`,
  'auxpow-parent-tag': $localize`:@@universe.mining.evidence-auxpow:AuxPoW parent tag`,
};

/**
 * The chain mining dashboard: the same information hierarchy as the
 * Bitcoin mining page, over this chain's own node readings. Pool shares
 * come only from the evidence-based attribution dataset; blocks nothing
 * matched stay in the Unknown bucket rather than being guessed away.
 */
@Component({
  selector: 'app-chain-mining',
  standalone: true,
  imports: [CommonModule, RouterModule, ChainTimelineComponent],
  templateUrl: './chain-mining.component.html',
  styleUrls: ['./chain-mining.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainMiningComponent implements OnInit {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly profile: ChainProfile;
  readonly windows = POOL_WINDOWS;
  readonly window$ = new BehaviorSubject<string>('1w');
  vm$: Observable<MiningViewModel>;

  constructor(
    private readonly router: Router,
    private readonly api: UniverseApiService,
    private readonly data: ChainDashboardService,
    private readonly seo: SeoService
  ) {
    this.chain =
      router.url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] === 'dogecoin'
        ? 'dogecoin'
        : 'zcash';
    this.profile = chainProfile(this.chain);
  }

  ngOnInit(): void {
    this.seo.setTitle(
      $localize`:@@universe.mining.title:${this.profile.name}:CHAIN: mining`
    );
    this.seo.setDescription(
      $localize`:@@universe.mining.meta:${this.profile.name}:CHAIN: difficulty, network rate, block rewards, and evidence-based pool attribution, from Bitcoin Universe's own node.`
    );
    const pools$ = this.window$.pipe(
      switchMap((window) =>
        this.api.getChainMiningPools$(this.chain, window).pipe(
          map((pools) => ({ pools, error: false })),
          catchError(() => of({ pools: null as MiningPoolsView | null, error: true }))
        )
      )
    );
    this.vm$ = combineLatest([this.data.dashboard$(this.chain), pools$]).pipe(
      map(([dashboard, pools]) => {
        const view = dashboard.view;
        const buckets = view?.buckets
          ? readCandidateBuckets(view.buckets, this.profile.precision, this.profile.ticker)
          : null;
        const summary = view?.mining ?? null;
        return {
          timeline: readChainTimeline(
            view?.recentBlocks ?? null,
            buckets,
            view?.buckets ?? null,
            this.profile.precision,
            Date.now()
          ),
          summary,
          difficulty: formatDifficulty(summary?.difficultyDecimal ?? null),
          networkRate: summary
            ? formatNetworkRate(summary.networkRateDecimal, summary.hashrateUnit)
            : null,
          target: formatSeconds(summary?.targetBlockSecondsAtomic ?? null),
          observed: formatSeconds(summary?.observedIntervalSecondsDecimal ?? null),
          subsidy: formatAtomicAmount(summary?.subsidyAtomic ?? null, this.profile.precision),
          meanReward: formatAtomicAmount(summary?.meanRewardAtomic ?? null, this.profile.precision),
          meanFees: formatAtomicAmount(summary?.meanFeesAtomic ?? null, this.profile.precision),
          meanBasis: readMeanBasis(summary ?? null),
          pools: pools.pools,
          poolRows: this.poolRows(pools.pools),
          poolsError: pools.error,
          recentBlocks: (view?.recentBlocks?.blocks ?? []).slice(0, 15),
          viewError: dashboard.error,
        };
      })
    );
  }

  setWindow(window: string): void {
    this.window$.next(window);
  }

  private poolRows(view: MiningPoolsView | null): PoolRowReading[] {
    if (!view) {
      return [];
    }
    return view.pools.map((pool) => ({
      poolId: pool.poolId,
      name:
        pool.poolId === 'unknown'
          ? $localize`:@@universe.mining.pool-unknown:Unknown`
          : pool.name,
      blocks: formatExactInteger(pool.blocksAtomic),
      sharePercent: Math.min(100, Math.max(0, Number(pool.shareDecimal) * 100)),
      evidence: pool.evidence.map((kind) => EVIDENCE_LABELS[kind] ?? kind),
      unknown: pool.poolId === 'unknown',
    }));
  }

  blockTime(block: ChainBlockSummary): string {
    return formatTimestamp(block.time)?.display ?? block.time;
  }

  heightFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatExactInteger(block.heightAtomic);
  }

  txCountFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatExactInteger(block.txCountAtomic);
  }

  sizeFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatExactInteger(block.sizeBytesAtomic);
  }

  feesFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatAtomicAmount(block.feesAtomic, this.profile.precision);
  }

  rewardFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatAtomicAmount(block.rewardAtomic, this.profile.precision);
  }

  trackByHash(_index: number, block: ChainBlockSummary): string {
    return block.hash;
  }

  trackByPool(_index: number, row: PoolRowReading): string {
    return row.poolId;
  }
}
