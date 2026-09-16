import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription, combineLatest, distinctUntilChanged, startWith } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { BumpPlan } from './mempool-intelligence.types';
import {
  MAX_TARGET,
  readTarget,
  Recommendation,
  recommend,
  TARGET_PRESETS,
  warningsFor,
} from './bump-view';
import { formatFeerate, formatSats, formatVsize, shorten } from './cluster-format';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * What it would cost to make an unconfirmed transaction confirm sooner.
 *
 * The page prices both routes and says which is cheaper, or which is closed
 * and why. It stops at the numbers. It cannot build a transaction and cannot
 * sign one, so what it hands over is what a wallet needs to do that itself.
 *
 * The target rate lives in the query string, so a plan can be linked to and
 * a reload does not lose it.
 */
@Component({
  selector: 'app-bump',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule],
  templateUrl: './bump.component.html',
  styleUrls: ['./bump.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BumpComponent implements OnInit, OnDestroy {
  txid = '';
  target: number | null = null;
  /** What is in the box, which may not yet be a rate. */
  targetInput = '';
  plan: BumpPlan | null = null;
  recommendation: Recommendation | null = null;
  warnings: string[] = [];
  error: string | null = null;
  loading = false;

  readonly presets = TARGET_PRESETS;
  readonly maxTarget = MAX_TARGET;

  private routeSubscription: Subscription | null = null;
  private planSubscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private route: ActivatedRoute,
    private router: Router,
    private cd: ChangeDetectorRef,
    private network: StateService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@mempool.bump.title:Fee bump planner`);
    this.routeSubscription = combineLatest([this.route.paramMap,this.route.queryParamMap,this.network.networkChanged$.pipe(startWith(this.network.network),distinctUntilChanged())]).subscribe(([params,query]) => {
      this.clearPlan();
      this.txid = params.get('txid') ?? '';
      this.readQueryTarget(query.get('targetFeerate'));
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.planSubscription?.unsubscribe();
  }

  private readQueryTarget(raw: string | null): void {
    const parsed = readTarget(raw);
    if (parsed === null) {
      // No rate is a real state, not an error: the page asks for one rather
      // than choosing a rate on somebody's behalf.
      this.target = null;
      this.targetInput=raw||'';
      this.plan = null;
      this.recommendation = null;
      this.warnings = [];
      this.error = raw ? $localize`:@@mempool.bump.bad-target:That is not a fee rate this page can plan for.` : null;
      this.cd.markForCheck();
      return;
    }
    this.target = parsed;
    this.targetInput = String(parsed);
    this.load();
  }

  /** Puts the rate in the address, which is what then triggers the load. */
  choose(rate: number): void {
    this.clearPlan();
    if(rate===this.target){this.targetInput=String(rate);this.load();return;}
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { targetFeerate: rate },
      queryParamsHandling: 'merge',
    });
  }

  submitTyped(): void {
    this.clearPlan();
    const parsed = readTarget(this.targetInput);
    if (parsed === null) {
      this.error = $localize`:@@mempool.bump.bad-typed:Enter a fee rate between 1 and ${this.maxTarget} satoshis per virtual byte.`;
      return;
    }
    this.choose(parsed);
  }

  private load(): void {
    this.clearPlan();
    if (!this.txid || this.target === null) { return; }
    if(!/^[0-9a-f]{64}$/i.test(this.txid)){this.error='Enter a complete transaction ID.';return;}
    this.loading = true;
    this.error = null;
    this.planSubscription?.unsubscribe();
    this.planSubscription = this.api.getBumpPlan$(this.txid, this.target).subscribe({
      next: (plan) => {
        if(!plan || plan.txid!==this.txid || plan.targetFeerate!==this.target || typeof plan.alreadyAtTarget!=='boolean' ||
          typeof plan.rbf?.available!=='boolean' || typeof plan.cpfp?.available!=='boolean' || !Array.isArray(plan.rbf.evictedTxids)) {
          this.loading=false;this.error='The node returned incomplete or mismatched fee-bump evidence.';this.cd.markForCheck();return;
        }
        this.plan = plan;
        this.recommendation = recommend(plan);
        this.warnings = warningsFor(plan);
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (error) => {
        this.loading = false;
        this.plan = null;
        this.recommendation = null;
        this.warnings = [];
        this.error = typeof error?.error === 'string' && error.error.length < 400
          ? error.error
          : $localize`:@@mempool.bump.failed:No plan could be built for that transaction.`;
        this.cd.markForCheck();
      },
    });
  }

  clearPlan(): void {this.planSubscription?.unsubscribe();this.planSubscription=null;this.plan=null;this.recommendation=null;this.warnings=[];this.error=null;this.loading=false;this.cd.markForCheck();}

  sats(value: number | null): string {
    return value === null ? $localize`:@@mempool.bump.unknown:unknown` : formatSats(value);
  }

  vsize(value: number | null): string {
    return value === null ? $localize`:@@mempool.bump.unknown2:unknown` : formatVsize(value);
  }

  rate(value: number): string {
    return formatFeerate(value);
  }

  short(value: string): string {
    return shorten(value);
  }

  trackByIndex(index: number): number {
    return index;
  }
}
