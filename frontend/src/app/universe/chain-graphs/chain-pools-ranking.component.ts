import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { buildPoolDonutOptions } from '@app/universe/chain-graphs/chain-chart-options';
import {
  ChainProfile,
  ExactNumber,
  chainProfile,
  formatExactInteger,
} from '@app/universe/multichain-explorer/multichain-view';
import { ExplorerChain, MiningPoolsView } from '@app/universe/universe.types';

interface PoolRankingRow {
  readonly rank: number;
  readonly poolId: string;
  readonly name: string;
  readonly blocks: ExactNumber | null;
  readonly sharePercent: number;
  readonly evidence: readonly string[];
  readonly unknown: boolean;
}

type PoolsStatus = 'loading' | 'error' | 'empty' | 'ready';

interface PoolsVm {
  readonly status: PoolsStatus;
  readonly view: MiningPoolsView | null;
  readonly rows: readonly PoolRankingRow[];
  readonly donut: EChartsCoreOption | null;
  readonly window: string;
}

const POOL_WINDOWS = ['24h', '3d', '1w', '1m'] as const;

const EVIDENCE_LABELS: Record<string, string> = {
  'coinbase-tag': $localize`:@@universe.graphs.evidence-tag:coinbase tag`,
  'payout-address': $localize`:@@universe.graphs.evidence-address:payout address`,
  'auxpow-parent-tag': $localize`:@@universe.graphs.evidence-auxpow:AuxPoW parent tag`,
};

/**
 * The pools ranking page: the same evidence-based attribution the mining
 * page shows, with a donut of shares beside the full ranking table. Blocks
 * nothing matched stay in the Unknown bucket, drawn in a muted colour so a
 * gap in the evidence never wears a pool's colour.
 */
@Component({
  selector: 'app-chain-pools-ranking',
  standalone: true,
  imports: [CommonModule, NgxEchartsDirective],
  templateUrl: './chain-pools-ranking.component.html',
  styleUrls: ['./chain-pools-ranking.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainPoolsRankingComponent implements OnInit {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly profile: ChainProfile;
  readonly isBrowser: boolean;
  readonly windows = POOL_WINDOWS;
  readonly chartInitOptions = { renderer: 'svg' };

  vm$: Observable<PoolsVm>;

  private readonly window$ = new BehaviorSubject<string>('1w');
  private readonly retry$ = new BehaviorSubject<number>(0);
  private readonly animate: boolean;

  constructor(
    router: Router,
    private readonly api: UniverseApiService,
    private readonly seo: SeoService,
    stateService: StateService
  ) {
    this.chain =
      router.url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] === 'dogecoin'
        ? 'dogecoin'
        : 'zcash';
    this.profile = chainProfile(this.chain);
    this.isBrowser = stateService.isBrowser;
    this.animate =
      this.isBrowser &&
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  ngOnInit(): void {
    this.seo.setTitle(
      $localize`:@@universe.graphs.pools-title:${this.profile.name}:CHAIN: mining pools`
    );
    this.vm$ = combineLatest([this.window$, this.retry$]).pipe(
      switchMap(([window]) =>
        this.api.getChainMiningPools$(this.chain, window).pipe(
          map((view) => this.buildVm(view, window)),
          catchError(() =>
            of<PoolsVm>({ status: 'error', view: null, rows: [], donut: null, window })
          ),
          startWith<PoolsVm>({ status: 'loading', view: null, rows: [], donut: null, window })
        )
      )
    );
  }

  setWindow(window: string): void {
    if (window !== this.window$.value) {
      this.window$.next(window);
    }
  }

  retry(): void {
    this.retry$.next(this.retry$.value + 1);
  }

  trackByPool(_index: number, row: PoolRankingRow): string {
    return row.poolId;
  }

  private buildVm(view: MiningPoolsView, window: string): PoolsVm {
    if (!view.pools.length) {
      return { status: 'empty', view, rows: [], donut: null, window };
    }
    const rows = view.pools.map((pool, index) => ({
      rank: index + 1,
      poolId: pool.poolId,
      name:
        pool.poolId === 'unknown'
          ? $localize`:@@universe.graphs.pool-unknown:Unknown`
          : pool.name,
      blocks: formatExactInteger(pool.blocksAtomic),
      sharePercent: Math.min(100, Math.max(0, Number(pool.shareDecimal) * 100)),
      evidence: pool.evidence.map((kind) => EVIDENCE_LABELS[kind] ?? kind),
      unknown: pool.poolId === 'unknown',
    }));
    return {
      status: 'ready',
      view,
      rows,
      donut: buildPoolDonutOptions(
        rows.map((row) => ({
          name: row.name,
          value: row.sharePercent,
          muted: row.unknown,
        })),
        this.animate
      ),
      window,
    };
  }
}
