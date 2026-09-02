import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
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
  imports: [CommonModule, FormsModule, RouterModule],
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
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@mempool.bump.title:Fee bump planner`);
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      this.txid = params.get('txid') ?? '';
      this.readQueryTarget();
    });
    this.route.queryParamMap.subscribe(() => this.readQueryTarget());
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.planSubscription?.unsubscribe();
  }

  private readQueryTarget(): void {
    const raw = this.route.snapshot.queryParamMap.get('targetFeerate');
    const parsed = readTarget(raw);
    if (parsed === null) {
      // No rate is a real state, not an error: the page asks for one rather
      // than choosing a rate on somebody's behalf.
      this.target = null;
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
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { targetFeerate: rate },
      queryParamsHandling: 'merge',
    });
  }

  submitTyped(): void {
    const parsed = readTarget(this.targetInput);
    if (parsed === null) {
      this.error = $localize`:@@mempool.bump.bad-typed:Enter a fee rate between 1 and ${this.maxTarget} satoshis per virtual byte.`;
      return;
    }
    this.choose(parsed);
  }

  private load(): void {
    if (!this.txid || this.target === null) { return; }
    this.loading = true;
    this.error = null;
    this.planSubscription?.unsubscribe();
    this.planSubscription = this.api.getBumpPlan$(this.txid, this.target).subscribe({
      next: (plan) => {
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
