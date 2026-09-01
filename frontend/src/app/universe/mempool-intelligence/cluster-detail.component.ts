import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ChunkView, ClusterTxView, ClusterView } from './mempool-intelligence.types';
import {
  chunkRows,
  DEFAULT_LAYOUT,
  GraphLayout,
  layoutCluster,
} from './cluster-layout';
import {
  describeChunk,
  describeFreshness,
  FreshnessView,
  formatFeerate,
  formatSats,
  formatVsize,
  shorten,
} from './cluster-format';

/**
 * One cluster in full: its dependency graph, its mining groups, and every
 * transaction in the order a miner would take them.
 *
 * The graph and the table below it carry the same facts. The table is not a
 * fallback that loses detail; it is the same information in a form a screen
 * reader and a keyboard can work through, which is why the graph itself is
 * marked as presentational rather than announced twice.
 */
@Component({
  selector: 'app-cluster-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cluster-detail.component.html',
  styleUrls: ['./cluster-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClusterDetailComponent implements OnInit, OnDestroy {
  cluster: ClusterView | null = null;
  freshness: FreshnessView | null = null;
  layout: GraphLayout | null = null;
  groups: { chunk: ChunkView; transactions: ClusterTxView[] }[] = [];
  /** Set when the cluster could not be shown, with the reason. */
  error: string | null = null;
  loading = true;
  /** Reference the reader asked for, kept for the not found message. */
  reference = '';
  /** True when the page was reached from a transaction rather than a cluster. */
  fromTransaction = false;

  readonly nodeRadius = DEFAULT_LAYOUT.nodeRadius;
  private subscription: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.subscription = this.route.paramMap
      .pipe(switchMap((params) => {
        // The same view answers /mempool/clusters/:clusterId and
        // /tx/:txid/package. They are the same object reached two ways, so
        // they share one page rather than diverging into two.
        const txid = params.get('txid');
        this.reference = txid ?? params.get('clusterId') ?? '';
        this.fromTransaction = !!txid;
        this.loading = true;
        this.error = null;
        this.seo.setTitle(txid
          ? $localize`:@@mempool.package.title:Transaction package`
          : $localize`:@@mempool.cluster.title:Mempool cluster`);
        return txid
          ? this.api.getMempoolPackage$(txid)
          : this.api.getMempoolCluster$(this.reference);
      }))
      .subscribe({
        next: (response) => {
          this.cluster = response.cluster;
          this.freshness = describeFreshness(response.freshness);
          this.layout = layoutCluster(response.cluster);
          this.groups = chunkRows(response.cluster);
          this.loading = false;
        },
        error: () => {
          this.cluster = null;
          this.layout = null;
          this.groups = [];
          // A cluster only exists while its members are unconfirmed, so the
          // most common reason for a miss is that it was mined. Saying that
          // is more useful than reporting a missing page.
          this.error = $localize`:@@mempool.cluster.missing:No unconfirmed cluster holds that transaction. It may have been mined, replaced, or dropped since the link was made.`;
          this.loading = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * A description of one node for assistive technology.
   *
   * The graph is presentational, so this text is what carries a node's
   * meaning where the drawing cannot.
   */
  nodeLabel(tx: ClusterTxView): string {
    return $localize`:@@mempool.cluster.node-label:Transaction ${shorten(tx.txid)}, group ${tx.chunkIndex + 1}, ${formatFeerate(tx.effectiveFeerate)} sat/vB effective`;
  }

  trackByTxid(_index: number, tx: ClusterTxView): string {
    return tx.txid;
  }

  trackByChunk(_index: number, group: { chunk: ChunkView }): number {
    return group.chunk.index;
  }

  chunkNote(index: number): string {
    return describeChunk(index, this.cluster?.chunks.length ?? 0);
  }

  feerate = formatFeerate;
  sats = formatSats;
  vsize = formatVsize;
  short = shorten;
}
