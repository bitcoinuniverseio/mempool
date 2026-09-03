import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ClusterListResponse, ClusterSummary } from './mempool-intelligence.types';
import { describeFreshness, FreshnessView, formatFeerate, formatSats, formatVsize } from './cluster-format';

/** How often the list reloads while the page is open. */
const REFRESH_MS = 10_000;
const PAGE_SIZE = 50;

/**
 * The clusters in this node mempool.
 *
 * A cluster is the unit a miner actually chooses from, so this list is
 * ordered by the best fee rate each cluster can offer rather than by
 * transaction count or arrival. What the page never does is imply that the
 * order is a queue: a cluster near the top is one a miner would reach first
 * given this mempool, which is a projection and is labelled as one.
 */
@Component({
  selector: 'app-cluster-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cluster-list.component.html',
  styleUrls: ['./cluster-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClusterListComponent implements OnInit, OnDestroy {
  response: ClusterListResponse | null = null;
  freshness: FreshnessView | null = null;
  /** Null until a request has failed, then the reason a reader can act on. */
  error: string | null = null;
  loading = true;
  offset = 0;

  readonly pageSize = PAGE_SIZE;

  /**
   * Packages mode shows only the clusters that actually contain a dependency.
   *
   * It is the same page and the same data, filtered on the server so the
   * total describes what is being shown. A single transaction with no
   * unconfirmed parent is a cluster of one, which is true but is not what a
   * reader looking for packages came for.
   */
  packagesOnly = false;

  private subscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.packagesOnly = this.route.snapshot.data['packagesOnly'] === true;
    this.seo.setTitle(this.packagesOnly
      ? $localize`:@@mempool.packages.title:Mempool packages`
      : $localize`:@@mempool.clusters.title:Mempool clusters`);
    this.load();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private load(): void {
    this.subscription?.unsubscribe();
    this.loading = true;
    this.subscription = timer(0, REFRESH_MS)
      .pipe(switchMap(() => this.api.getMempoolClusters$(
        this.offset, PAGE_SIZE, this.packagesOnly ? 2 : 1,
      )))
      .subscribe({
        next: (response) => {
          this.response = response;
          this.freshness = describeFreshness(response.freshness);
          this.error = null;
          this.loading = false;
        },
        error: () => {
          // The previous answer is kept on screen with its own age showing,
          // because a stale answer that says how stale it is beats an empty
          // page that says nothing.
          this.error = $localize`:@@mempool.clusters.error:The cluster list could not be loaded from this node.`;
          this.loading = false;
        },
      });
  }

  nextPage(): void {
    if (!this.response) { return; }
    if (this.offset + PAGE_SIZE >= this.response.total) { return; }
    this.offset += PAGE_SIZE;
    this.load();
  }

  previousPage(): void {
    if (this.offset === 0) { return; }
    this.offset = Math.max(0, this.offset - PAGE_SIZE);
    this.load();
  }

  get hasNext(): boolean {
    return !!this.response && this.offset + PAGE_SIZE < this.response.total;
  }

  get hasPrevious(): boolean {
    return this.offset > 0;
  }

  get shownFrom(): number {
    return this.response && this.response.clusters.length ? this.offset + 1 : 0;
  }

  get shownTo(): number {
    return this.response ? this.offset + this.response.clusters.length : 0;
  }

  trackById(_index: number, cluster: ClusterSummary): string {
    return cluster.id;
  }

  feerate = formatFeerate;
  sats = formatSats;
  vsize = formatVsize;
}
