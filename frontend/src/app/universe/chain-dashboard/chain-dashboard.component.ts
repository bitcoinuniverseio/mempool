import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Observable, combineLatest, map } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import {
  ChainDashboardService,
} from '@app/universe/chain-dashboard/chain-dashboard.service';
import {
  ChainTimelineComponent,
} from '@app/universe/chain-dashboard/chain-timeline.component';
import {
  ChainLensComponent,
} from '@app/universe/chain-dashboard/chain-lens.component';
import {
  ChainTimelineReading,
  readChainTimeline,
} from '@app/universe/chain-dashboard/chain-timeline';
import {
  LensItem,
  readLensItems,
} from '@app/universe/chain-dashboard/chain-lens';
import {
  formatDifficulty,
  formatFeePerKb,
  formatNetworkRate,
  formatSeconds,
} from '@app/universe/chain-dashboard/chain-dashboard-format';
import {
  CandidateBucketsReading,
  readCandidateBuckets,
} from '@app/universe/multichain-explorer/candidate-buckets';
import {
  ChainProfile,
  CoverageReading,
  ExactNumber,
  ProtocolReading,
  ReadCapability,
  SourceDetail,
  StatusReading,
  chainProfile,
  formatAtomicAmount,
  formatExactInteger,
  readCapabilities,
  readHistoryCoverage,
  readNotReadyReasons,
  readProtocolCoverage,
  readSourceDetails,
  readStatusRail,
} from '@app/universe/multichain-explorer/multichain-view';
import { ChainReasonReading } from '@app/universe/multichain-explorer/chain-reasons';
import {
  ChainBlockSummary,
  ChainCapabilityEnvelope,
  ChainDashboardView,
  ChainSubsystemHealth,
  ExplorerChain,
  FeeRecommendationsView,
} from '@app/universe/universe.types';

interface FeeLevelReading {
  readonly label: string;
  readonly amount: ExactNumber;
  readonly basis: string;
}

interface DashboardViewModel {
  readonly capability: ChainCapabilityEnvelope | null;
  readonly rail: readonly StatusReading[];
  readonly notReady: readonly ChainReasonReading[] | null;
  readonly reads: readonly ReadCapability[];
  readonly coverage: readonly CoverageReading[];
  readonly protocols: readonly ProtocolReading[];
  readonly sourceDetails: readonly SourceDetail[];
  readonly view: ChainDashboardView | null;
  readonly viewError: string | null;
  readonly timeline: ChainTimelineReading | null;
  readonly buckets: CandidateBucketsReading | null;
  readonly fees: FeeRecommendationsView | null;
  readonly feeLevels: readonly FeeLevelReading[];
  readonly zcashFee: {
    readonly typical: ExactNumber | null;
    readonly marginal: ExactNumber | null;
    readonly paidSharePercent: string | null;
  } | null;
  readonly mining: {
    readonly difficulty: ExactNumber | null;
    readonly networkRate: ExactNumber | null;
    readonly algorithm: string;
    readonly target: ExactNumber | null;
    readonly observed: ExactNumber | null;
    readonly subsidy: ExactNumber | null;
    readonly meanFees: ExactNumber | null;
    readonly mergedMining: boolean;
  } | null;
  readonly mempool: {
    readonly txCount: ExactNumber | null;
    readonly totalSize: ExactNumber | null;
    readonly totalFees: ExactNumber | null;
    readonly arrivalRate: string | null;
  } | null;
  readonly recentBlocks: readonly ChainBlockSummary[];
  readonly recent: readonly LensItem[];
  readonly pendingPayload: Record<string, unknown> | null;
  readonly pendingError: string | null;
  readonly subsystems: readonly ChainSubsystemHealth[];
}

/** Bitcoin's four-level fee vocabulary, reused so the panels read alike. */
const FEE_LEVEL_LABELS: Record<string, string> = {
  none: $localize`:@@universe.dash.fee-none:No Priority`,
  low: $localize`:@@universe.dash.fee-low:Low Priority`,
  medium: $localize`:@@universe.dash.fee-medium:Medium Priority`,
  high: $localize`:@@universe.dash.fee-high:High Priority`,
};

const FEE_BASIS_LABELS: Record<string, string> = {
  'node-estimate': $localize`:@@universe.dash.basis-node:from our node's fee estimator`,
  'mempool-quantile': $localize`:@@universe.dash.basis-mempool:from the current pending set`,
  'recent-blocks': $localize`:@@universe.dash.basis-blocks:from recent confirmed blocks`,
  'relay-floor': $localize`:@@universe.dash.basis-floor:the relay floor`,
  'zip317-conventional': $localize`:@@universe.dash.basis-zip317:the ZIP-317 conventional fee rule`,
};

@Component({
  selector: 'app-chain-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ChainTimelineComponent,
    ChainLensComponent,
  ],
  templateUrl: './chain-dashboard.component.html',
  styleUrls: ['./chain-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainDashboardComponent implements OnInit {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly profile: ChainProfile;
  vm$: Observable<DashboardViewModel>;

  constructor(
    private readonly router: Router,
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
      $localize`:@@universe.dash.title:${this.profile.name}:CHAIN: dashboard`
    );
    this.seo.setDescription(
      $localize`:@@universe.dash.meta:${this.profile.name}:CHAIN: blocks, pending transactions, fees, difficulty, and mining, from Bitcoin Universe's own node and indexers.`
    );
    this.vm$ = combineLatest([
      this.data.dashboard$(this.chain),
      this.data.pending$(this.chain),
      this.data.capability$(this.chain),
    ]).pipe(
      map(([dashboard, pending, capability]) =>
        this.viewModel(capability, dashboard.view, dashboard.error, pending.payload, pending.error)
      )
    );
  }

  private viewModel(
    capability: ChainCapabilityEnvelope | null,
    view: ChainDashboardView | null,
    viewError: string | null,
    pendingPayload: Record<string, unknown> | null,
    pendingError: string | null
  ): DashboardViewModel {
    const now = Date.now();
    const buckets = view?.buckets
      ? readCandidateBuckets(view.buckets, this.profile.precision, this.profile.ticker)
      : null;
    const timeline = readChainTimeline(
      view?.recentBlocks ?? null,
      buckets,
      view?.buckets ?? null,
      this.profile.precision,
      now
    );
    const fees = view?.fees ?? null;
    const feeLevels: FeeLevelReading[] =
      fees && fees.kind === 'fee-per-kilobyte'
        ? fees.levels
            .map((level) => {
              const amount = formatFeePerKb(level.amountDecimal, this.profile.precision);
              return amount
                ? {
                    label: FEE_LEVEL_LABELS[level.id] ?? level.id,
                    amount,
                    basis: FEE_BASIS_LABELS[level.basis] ?? level.basis,
                  }
                : null;
            })
            .filter((level): level is FeeLevelReading => level !== null)
        : [];
    const zcashFee =
      fees && fees.kind === 'zip-317'
        ? {
            typical: formatAtomicAmount(
              fees.typicalConventionalFeeAtomic,
              this.profile.precision
            ),
            marginal: formatExactInteger(fees.marginalFeeAtomic),
            paidSharePercent:
              fees.paidShareDecimal !== null
                ? (Number(fees.paidShareDecimal) * 100).toFixed(0)
                : null,
          }
        : null;
    const mining = view?.mining
      ? {
          difficulty: formatDifficulty(view.mining.difficultyDecimal),
          networkRate: formatNetworkRate(
            view.mining.networkRateDecimal,
            view.mining.hashrateUnit
          ),
          algorithm: view.mining.algorithm,
          target: formatSeconds(view.mining.targetBlockSecondsAtomic),
          observed: formatSeconds(view.mining.observedIntervalSecondsDecimal),
          subsidy: formatAtomicAmount(view.mining.subsidyAtomic, this.profile.precision),
          meanFees: formatAtomicAmount(view.mining.meanFeesAtomic, this.profile.precision),
          mergedMining: view.mining.mergedMining.supported,
        }
      : null;
    const mempool = view?.mempool
      ? {
          txCount: formatExactInteger(view.mempool.txCountAtomic),
          totalSize: formatExactInteger(view.mempool.totalSizeBytesAtomic),
          totalFees: formatAtomicAmount(
            view.mempool.totalFeesAtomic,
            this.profile.precision
          ),
          arrivalRate: view.mempool.arrivalRatePerSecondDecimal,
        }
      : null;
    const items = readLensItems(pendingPayload);
    const recent = [...items]
      .sort((a, b) => (b.firstSeenAt ?? '').localeCompare(a.firstSeenAt ?? ''))
      .slice(0, 8);
    return {
      capability,
      rail: readStatusRail(capability, this.profile, now),
      notReady: readNotReadyReasons(capability),
      reads: readCapabilities(capability),
      coverage: readHistoryCoverage(capability),
      protocols: readProtocolCoverage(capability, this.profile),
      sourceDetails: readSourceDetails(capability),
      view,
      viewError,
      timeline,
      buckets,
      fees,
      feeLevels,
      zcashFee,
      mining,
      mempool,
      recentBlocks: (view?.recentBlocks?.blocks ?? []).slice(0, 8),
      recent,
      pendingPayload,
      pendingError,
      subsystems: view?.subsystems ?? [],
    };
  }

  feesFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatAtomicAmount(block.feesAtomic, this.profile.precision);
  }

  heightFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatExactInteger(block.heightAtomic);
  }

  txCountFormatted(block: ChainBlockSummary): ExactNumber | null {
    return formatExactInteger(block.txCountAtomic);
  }

  feeFormatted(item: LensItem): ExactNumber | null {
    return formatAtomicAmount(item.feeExact, this.profile.precision);
  }

  subsystemLabel(id: string): string {
    const labels: Record<string, string> = {
      'core-node': $localize`:@@universe.dash.sub-core:Core node`,
      'confirmed-history': $localize`:@@universe.dash.sub-confirmed:Confirmed history`,
      'address-history': $localize`:@@universe.dash.sub-address:Address history`,
      mempool: $localize`:@@universe.dash.sub-mempool:Pending set`,
      'mining-analytics': $localize`:@@universe.dash.sub-mining:Mining analytics`,
      'historical-statistics': $localize`:@@universe.dash.sub-history:Historical statistics`,
      'protocol-indexers': $localize`:@@universe.dash.sub-protocols:Protocol indexers`,
    };
    return labels[id] ?? id;
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackByProtocol(_index: number, item: { protocolId: string }): string {
    return item.protocolId;
  }

  trackByHash(_index: number, block: ChainBlockSummary): string {
    return block.hash;
  }

  trackByTxid(_index: number, item: LensItem): string {
    return item.txid;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
