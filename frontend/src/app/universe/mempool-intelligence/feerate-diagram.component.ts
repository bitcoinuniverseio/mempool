import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { DiagramResponse } from './mempool-intelligence.types';
import { CurvePoint, DiagramLayout, layoutDiagram, toPath } from './cluster-layout';
import {
  describeFreshness,
  FreshnessView,
  formatFeerate,
  formatSats,
  formatVsize,
} from './cluster-format';

const REFRESH_MS = 15_000;
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 420;
/** How many rows the readable table shows before it stops. */
const TABLE_ROWS = 40;

/**
 * The fee rate diagram: cumulative size against cumulative fee, in the order
 * a miner would actually take the mempool.
 *
 * A second curve shows what ordering by each transaction's own fee rate would
 * claim. That curve is not achievable, because it puts children above their
 * unconfirmed parents, and drawing the two together is the clearest statement
 * of why chunk order is the real one.
 */
@Component({
  selector: 'app-feerate-diagram',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './feerate-diagram.component.html',
  styleUrls: ['./feerate-diagram.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeerateDiagramComponent implements OnInit, OnDestroy {
  response: DiagramResponse | null = null;
  freshness: FreshnessView | null = null;
  layout: DiagramLayout | null = null;
  realPath = '';
  naivePath = '';
  /** The first rows of the readable equivalent of the drawn curve. */
  rows: CurvePoint[] = [];
  rowsTruncated = 0;
  error: string | null = null;
  loading = true;

  readonly width = CANVAS_WIDTH;
  readonly height = CANVAS_HEIGHT;
  private subscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@mempool.diagram.title:Fee rate diagram`);
    this.subscription = timer(0, REFRESH_MS)
      .pipe(switchMap(() => this.api.getMempoolFeerateDiagram$()))
      .subscribe({
        next: (response) => {
          this.response = response;
          this.freshness = describeFreshness(response.freshness);
          const layout = layoutDiagram(
            response.points, response.naivePoints, CANVAS_WIDTH, CANVAS_HEIGHT,
          );
          this.layout = layout;
          this.realPath = toPath(layout.real);
          this.naivePath = toPath(layout.naive);
          // The table is capped, and says so, rather than rendering tens of
          // thousands of rows that no reader and no screen reader can use.
          this.rows = layout.real.slice(0, TABLE_ROWS);
          this.rowsTruncated = Math.max(0, layout.real.length - TABLE_ROWS);
          this.error = null;
          this.loading = false;
        },
        error: () => {
          this.error = $localize`:@@mempool.diagram.error:The fee rate diagram could not be loaded from this node.`;
          this.loading = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  trackByIndex(index: number): number {
    return index;
  }

  feerate = formatFeerate;
  sats = formatSats;
  vsize = formatVsize;
}
