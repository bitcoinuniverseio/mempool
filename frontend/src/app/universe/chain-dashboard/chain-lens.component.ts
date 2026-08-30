import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  ViewChild,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { BlockOverviewGraphComponent } from '@components/block-overview-graph/block-overview-graph.component';
import TxView from '@components/block-overview-graph/tx-view';
import { Color } from '@components/block-overview-graph/sprite-types';
import { hexToColor } from '@components/block-overview-graph/utils';
import { detectWebGL } from '@app/shared/graphs.utils';
import { StateService } from '@app/services/state.service';
import { ThemeService } from '@app/services/theme.service';
import { TransactionStripped } from '@interfaces/node-api.interface';
import {
  LensFilter,
  LensFilterId,
  LensItem,
  applyLensFilter,
  lensFilters,
  readLensItems,
} from '@app/universe/chain-dashboard/chain-lens';
import {
  ChainExplorerPayload,
  ExplorerChain,
} from '@app/universe/universe.types';
import {
  formatAtomicAmount,
  ExactNumber,
} from '@app/universe/multichain-explorer/multichain-view';

/**
 * The Universe Lens for a chain: the same treemap renderer the Bitcoin
 * lens uses, generalized by feeding it chain-read items and chain-native
 * colors instead of Bitcoin websocket state. Rectangles are sized by
 * serialized bytes; color ranks the known fee rates of the current set,
 * and a transaction without a readable fee stays neutral. Without WebGL
 * the same information renders as a table.
 */
@Component({
  selector: 'app-chain-lens',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  templateUrl: './chain-lens.component.html',
  styleUrls: ['./chain-lens.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainLensComponent implements OnChanges {
  @Input() chain: Exclude<ExplorerChain, 'bitcoin'>;
  @Input() payload: ChainExplorerPayload | null = null;
  @Input() unavailable = false;
  /** Decimal places between atomic unit and ticker, for the tooltip. */
  @Input() precision = 8;
  @Input() ticker = '';

  /**
   * The renderer mounts a change-detection cycle after the first data
   * arrives, because the canvas waits for data to exist. A plain query
   * would miss that first cycle and leave the canvas blank until the next
   * poll, so the setter pushes the current set the moment the renderer
   * appears, one tick later so its scene has been created.
   */
  @ViewChild('lensGraph')
  set graphRef(graph: BlockOverviewGraphComponent | undefined) {
    this.graph = graph;
    if (graph) {
      setTimeout(() => this.pushToGraph());
    }
  }
  private graph: BlockOverviewGraphComponent | undefined;

  readonly webGlEnabled: boolean;
  filters: LensFilter[] = [];
  activeFilter: LensFilterId = 'all';
  items: LensItem[] = [];
  shown: LensItem[] = [];
  hovered: LensItem | null = null;
  asTable = false;
  /**
   * The renderer lays rectangles out against this capacity. For a lens over
   * the whole pending set the shown transactions ARE the capacity, so the
   * treemap fills the canvas whatever the set's absolute size; against a
   * fixed block limit a quiet mempool drew rectangles too small to see.
   */
  lensLimit = 1;

  private thresholds: number[] = [];

  constructor(
    private readonly router: Router,
    private readonly theme: ThemeService,
    stateService: StateService
  ) {
    this.webGlEnabled = stateService.isBrowser && detectWebGL();
  }

  ngOnChanges(): void {
    this.filters = lensFilters(this.chain);
    this.items = readLensItems(this.payload);
    this.refresh();
  }

  setFilter(id: LensFilterId): void {
    this.activeFilter = id;
    this.refresh();
  }

  toggleTable(): void {
    this.asTable = !this.asTable;
  }

  /** Rows for the accessible table, largest first, bounded for readability. */
  get tableRows(): LensItem[] {
    return [...this.shown]
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 50);
  }

  feeDisplay(item: LensItem): ExactNumber | null {
    return formatAtomicAmount(item.feeExact, this.precision);
  }

  /** The renderer signals readiness after view init; push the current set. */
  onGraphReady(): void {
    this.pushToGraph();
  }

  onTxClick(event: { tx: TransactionStripped; keyModifier: boolean }): void {
    void this.router.navigate(['/', this.chain, 'tx', event.tx.txid]);
  }

  onTxHover(txid: string): void {
    this.hovered = txid
      ? this.shown.find((item) => item.txid === txid) ?? null
      : null;
  }

  /** Rank the known rates of the shown set onto the theme fee ramp. */
  readonly lensColors = (tx: TxView): Color => {
    const ramp = this.theme.mempoolFeeColors;
    if (!ramp.length) {
      return hexToColor('999999');
    }
    if (tx.feerate === undefined || tx.feerate === null || !this.thresholds.length) {
      return hexToColor('80808c');
    }
    let band = 0;
    while (band < this.thresholds.length && tx.feerate > this.thresholds[band]) {
      band += 1;
    }
    const hex = ramp[Math.min(band, ramp.length - 1)].replace(/^#/, '');
    return hexToColor(hex);
  };

  private refresh(): void {
    this.shown = applyLensFilter(this.items, this.activeFilter);
    // The limit is the whole pending set, whatever the filter shows, so a
    // filtered view keeps its true share of the space. The renderer reads
    // it once at scene creation; the template only creates the scene once
    // items exist, so the first layout already has a real capacity.
    this.lensLimit = Math.max(
      1,
      this.items.reduce((sum, item) => sum + item.sizeBytes, 0)
    );
    const rates = this.shown
      .map((item) => item.rate)
      .filter((rate): rate is number => rate !== null)
      .sort((a, b) => a - b);
    const bands = this.theme.mempoolFeeColors.length;
    this.thresholds = [];
    for (let index = 1; index < bands; index += 1) {
      const at = Math.floor((index / bands) * rates.length);
      if (rates.length) {
        this.thresholds.push(rates[Math.min(at, rates.length - 1)]);
      }
    }
    this.pushToGraph();
  }

  private pushedOnce = false;

  private pushToGraph(): void {
    if (!this.graph) {
      return;
    }
    const stripped: TransactionStripped[] = this.shown.map((item) => ({
      txid: item.txid,
      fee: item.feeExact !== null ? Number(item.feeExact) : 0,
      vsize: item.sizeBytes,
      value: 0,
      rate: item.rate ?? undefined,
    }));
    // The first push lays the set out without an entry transition, which is
    // the renderer's initialization path; later pushes diff against what is
    // on screen so arrivals and confirmations animate.
    if (this.pushedOnce) {
      this.graph.replace(stripped, 'right', true);
    } else {
      this.graph.setup(stripped, true);
      this.pushedOnce = true;
    }
  }
}
