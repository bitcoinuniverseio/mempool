import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, LOCALE_ID, NgZone, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { echarts, EChartsOption } from '@app/graphs/echarts';
import { Observable, Subscription } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { exactSummaryBalance, mergeSummaryRows, readObservedSummaryPage$, SUMMARY_PAGE_DEADLINE_MS, SUMMARY_PAGE_LIMIT, validatedSummaryRows } from './address-summary-page';
import { AddressTxSummary, ChainStats } from '@interfaces/electrs.interface';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { AmountShortenerPipe } from '@app/shared/pipes/amount-shortener.pipe';
import { Router } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { StateService } from '@app/services/state.service';
import { PriceService } from '@app/services/price.service';
import { FiatCurrencyPipe } from '@app/shared/pipes/fiat-currency.pipe';
import { chartChrome, chartDataZoomStyle, rampStops } from '@app/shared/chart-theme';

const periodSeconds = {
  '1d': (60 * 60 * 24),
  '3d': (60 * 60 * 24 * 3),
  '1w': (60 * 60 * 24 * 7),
  '1m': (60 * 60 * 24 * 30),
  '6m': (60 * 60 * 24 * 180),
  '1y': (60 * 60 * 24 * 365),
};

@Component({
  selector: 'app-address-graph',
  templateUrl: './address-graph.component.html',
  styleUrls: ['./address-graph.component.scss'],
  styles: [`
    .loadingGraphs {
      position: absolute;
      top: 50%;
      left: calc(50% - 15px);
      z-index: 99;
    }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressGraphComponent implements OnChanges, OnDestroy {
  @Input() address: string;
  @Input() isPubkey: boolean = false;
  @Input() stats: ChainStats;
  @Input() addressSummary$: Observable<AddressTxSummary[]> | null;
  @Input() period: '1d' | '3d' | '1w' | '1m' | '6m' | '1y' | 'all' = 'all';
  @Input() height: number = 200;
  @Input() right: number | string = 10;
  @Input() left: number | string = 70;
  @Input() widget: boolean = false;
  @Input() label: string = '';
  @Input() image: string = '';
  @Input() defaultFiat: boolean = false;
  @Input() showLegend: boolean = true;
  @Input() showYAxis: boolean = true;

  adjustedLeft: number;
  adjustedRight: number;
  data: any[] = [];
  fiatData: any[] = [];
  hoverData: any[] = [];
  conversions: any;
  allowZoom: boolean = false;

  selected = { [$localize`:@@7e69426bd97a606d8ae6026762858e6e7c86a1fd:Balance`]: true, 'Fiat': false };

  subscription: Subscription;
  private networkSubscription: Subscription;
  private priceSubscription: Subscription;
  private rows: AddressTxSummary[] = [];
  private pricedRows: AddressTxSummary[] | null = null;
  private observedStats: ChainStats;
  private destroyed = false;
  checkpoint: string | null = null;
  historyComplete = false;
  historyError: string | null = null;
  fiatError: string | null = null;
  isPricing = false;
  get loadedCount(): number { return this.rows.length; }
  get expectedCount(): number | null { return this.observedStats?.tx_count ?? null; }
  get canLoadEarlier(): boolean { return !this.addressSummary$ && !!this.checkpoint && !this.historyComplete; }

  chartOptions: EChartsOption = {};
  chartInitOptions = {
    renderer: 'svg',
  };

  error: any;
  isLoading = true;
  chartInstance: any = undefined;

  constructor(
    @Inject(LOCALE_ID) public locale: string,
    public stateService: StateService,
    private electrsApiService: ElectrsApiService,
    private router: Router,
    private amountShortenerPipe: AmountShortenerPipe,
    private cd: ChangeDetectorRef,
    private relativeUrlPipe: RelativeUrlPipe,
    private priceService: PriceService,
    private fiatCurrencyPipe: FiatCurrencyPipe,
    private zone: NgZone,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.networkSubscription) {
      let network = this.stateService.network;
      this.networkSubscription = this.stateService.networkChanged$.subscribe(next => {
        if (next !== network) {
          network = next;
          this.subscription?.unsubscribe();
          this.priceSubscription?.unsubscribe();
          this.rows = []; this.pricedRows = null; this.checkpoint = null;
          this.data = []; this.fiatData = []; this.hoverData = []; this.chartOptions = {};
          this.chartInstance?.clear();
          this.observedStats = undefined; this.historyError = null; this.fiatError = null;
          this.historyComplete = false; this.isLoading = false; this.isPricing = false;
          this.error = 'Network changed; reload address history';
          this.cd.markForCheck();
        }
      });
    }
    if (changes.defaultFiat) {this.selected['Fiat'] = !!this.defaultFiat;}
    if (changes.address || changes.isPubkey || changes.addressSummary$ || changes.stats) {this.reloadHistory();}
    else {this.renderHistory();}
  }

  reloadHistory(): void {
    if (this.destroyed) {return;}
    this.subscription?.unsubscribe(); this.priceSubscription?.unsubscribe();
    this.rows = []; this.pricedRows = null; this.checkpoint = null;
          this.data = []; this.fiatData = []; this.hoverData = []; this.chartOptions = {};
          this.observedStats = undefined; this.historyError = null; this.fiatError = null;
    this.observedStats = undefined; this.historyComplete = false;
    this.error = null; this.historyError = null; this.fiatError = null; this.isPricing = false;
    this.isLoading = true;
    if (this.addressSummary$) {
      // Aggregate inputs have no address cursor or snapshot contract: coverage remains unknown.
      this.subscription = this.addressSummary$.subscribe({
        next: rows => {
          try {
            const validated = validatedSummaryRows(rows, Infinity); exactSummaryBalance(validated, this.stats);
            this.rows = validated;
            this.priceSubscription?.unsubscribe(); this.isPricing = false; this.pricedRows = null; this.fiatError = null; this.historyError = null; this.error = null; this.isLoading = false; this.renderHistory();
          } catch (error) { this.failHistory(error); }
        }, error: error => this.failHistory(error),
      });
    } else if (this.address) {this.loadEarlier();}
    else {this.isLoading = false;}
  }

  loadEarlier(): void {
    if (this.destroyed || this.historyComplete || this.addressSummary$) {return;}
    if (this.subscription && !this.subscription.closed) {return;}
    this.isLoading = true; this.historyError = null;
    this.subscription = readObservedSummaryPage$(this.electrsApiService, this.address, this.isPubkey,
      this.rows[this.rows.length - 1]?.txid, this.checkpoint ?? undefined, this.observedStats).subscribe({
      next: page => {
        try {
          const rows = mergeSummaryRows(this.rows, page.rows);
          if (rows.length > page.stats.tx_count) {throw Error('Summary exceeds confirmed address transaction count');}
          exactSummaryBalance(rows, page.stats);
          this.rows = rows; this.observedStats = page.stats; this.checkpoint = page.anchor;
          this.priceSubscription?.unsubscribe(); this.isPricing = false; this.pricedRows = null; this.fiatError = null;
          this.historyComplete = page.rows.length < SUMMARY_PAGE_LIMIT && rows.length === page.stats.tx_count;
          if (page.rows.length < SUMMARY_PAGE_LIMIT && !this.historyComplete) {this.historyError = 'Index returned fewer transactions than its statistics; reload or retry earlier history';}
          this.error = null; this.isLoading = false; this.renderHistory();
        } catch (error) { this.failHistory(error); }
      }, error: error => this.failHistory(error),
    });
  }

  private failHistory(error: unknown): void {
    const detail = error instanceof Error ? error.message : 'Request unavailable';
    this.historyError = `Balance history unavailable: ${detail}`;
    this.error = this.rows.length ? null : this.historyError;
    this.isLoading = false; this.cd.markForCheck();
  }

  private renderHistory(): void {
    if (this.destroyed || (!this.rows.length && !this.checkpoint && !this.addressSummary$)) {return;}
    this.allowZoom = this.rows.length > 100 && !this.widget;
    this.prepareChartOptions(this.pricedRows ?? this.rows);
    this.cd.markForCheck();
    if (this.selected['Fiat'] && !this.stateService.isAnyTestnet() && !this.pricedRows && !this.isPricing) {this.loadFiat();}
  }

  retryFiat(): void { this.fiatError = null; this.loadFiat(); }

  private loadFiat(): void {
    this.priceSubscription?.unsubscribe();
    const rows = this.rows;
    this.isPricing = true; this.fiatError = null;
    this.priceSubscription = this.priceService.getPriceByBulk$(rows.map(row => row.time), 'USD')
      .pipe(timeout({first: SUMMARY_PAGE_DEADLINE_MS})).subscribe({
        next: prices => {
          if (this.destroyed || rows !== this.rows) {return;}
          if (!Array.isArray(prices) || prices.length !== rows.length || prices.some(price => !Number.isFinite(price?.price?.USD) || price.price.USD <= 0)) {
            this.fiatError = 'Historical USD prices unavailable; BTC history remains available';
          } else {this.pricedRows = rows.map((row, index) => ({...row, price: prices[index].price.USD}));}
          this.isPricing = false; this.prepareChartOptions(this.pricedRows ?? rows); this.cd.markForCheck();
        }, error: () => {
          if (this.destroyed || rows !== this.rows) {return;}
          this.isPricing = false; this.fiatError = 'Historical USD prices unavailable; BTC history remains available';
          this.cd.markForCheck();
        },
      });
  }

  prepareChartOptions(summary: AddressTxSummary[]) {
    if (!summary) {
      return;
    }

    const totalExact = exactSummaryBalance(summary, this.observedStats ?? this.stats);
    const total = Number(totalExact);
    let runningTotal = totalExact;
    const processData = summary.map(d => {
        const balance = Number(runningTotal);
        const fiatBalance = typeof d.price === 'number' ? balance * d.price / 100_000_000 : null;
        runningTotal -= BigInt(d.value);
        return {
            time: d.time * 1000,
            balance,
            fiatBalance,
            d
        };
    }).reverse();

    this.data = processData.filter(({ d }) => d.txid !== undefined).map(({ time, balance, d }) => [time, balance, d]);
    this.fiatData = processData.filter(row => row.fiatBalance !== null).map(({ time, fiatBalance, balance, d }) => [time, fiatBalance, d, balance]);

    const now = Date.now();
    if (this.period !== 'all') {
      const start = now - (periodSeconds[this.period] * 1000);
      this.data = this.data.filter(d => d[0] >= start);
      const startFiat = this.data[0]?.[0] ?? start; // Make sure USD data starts at the same time as BTC data
      this.fiatData = this.fiatData.filter(d => d[0] >= startFiat);
    }
    this.data.push(
      {value: [now, total], symbol: 'none', tooltip: { show: false }}
    );

    const maxValue = this.data.reduce((acc, d) => Math.max(acc, Math.abs(d[1] ?? d.value[1])), 0);
    const minValue = this.data.reduce((acc, d) => Math.min(acc, Math.abs(d[1] ?? d.value[1])), maxValue);

    this.adjustedRight = this.selected['Fiat'] ? +this.right + 40 : +this.right;
    this.adjustedLeft = this.selected[$localize`:@@7e69426bd97a606d8ae6026762858e6e7c86a1fd:Balance`] ? +this.left : +this.left - 40;
    const graphicElements = this.graphicElements();

    this.chartOptions = {
      color: [
        new echarts.graphic.LinearGradient(0, 0, 0, 1, rampStops('a')),
        new echarts.graphic.LinearGradient(0, 0, 0, 1, rampStops('b')),
      ],
      animation: false,
      grid: {
        top: 20,
        bottom: this.allowZoom ? 65 : 20,
        right: this.adjustedRight,
        left: this.adjustedLeft,
      },
      graphic: graphicElements.length > 0 ? graphicElements : undefined,
      legend: (this.showLegend && !this.stateService.isAnyTestnet()) ? {
        data: [
          {
            name: $localize`:@@7e69426bd97a606d8ae6026762858e6e7c86a1fd:Balance`,
            inactiveColor: 'var(--grey)',
            textStyle: {
              color: chartChrome().label,
            },
            icon: 'roundRect',
          },
          {
            name: 'Fiat',
            inactiveColor: 'var(--grey)',
            textStyle: {
              color: chartChrome().label,
            },
            icon: 'roundRect',
          }
        ],
        selected: this.selected,
        formatter: function (name) {
          return name === 'Fiat' ? 'USD' : 'BTC';
        }
      } : undefined,
      tooltip: {
        show: !this.isMobile(),
        trigger: 'axis',
        axisPointer: {
          type: 'line'
        },
        backgroundColor: chartChrome().surface,
        borderRadius: 4,
        shadowColor: chartChrome().markBorder,
        textStyle: {
          color: chartChrome().label,
          align: 'left',
        },
        borderColor: chartChrome().markBorder,
        formatter: function (data) {
          const btcData = data.filter(d => d.seriesName !== 'Fiat');
          const fiatData = data.filter(d => d.seriesName === 'Fiat');
          data = btcData.length ? btcData : fiatData;
          if ((!btcData.length || !btcData[0]?.data?.[2]?.txid) && !fiatData.length) {
            return '';
          }
          let tooltip = '<div>';

          const hasTx = data[0].data[2].txid;
          const date = new Date(data[0].data[0]).toLocaleTimeString(this.locale, { year: 'numeric', month: 'short', day: 'numeric' });

          tooltip += `<div>
            <div style="text-align: right;">
            <div><b>${date}</b></div>`;

          if (hasTx) {
            const header = data.length === 1
            ? `${data[0].data[2].txid.slice(0, 6)}...${data[0].data[2].txid.slice(-6)}`
            : `${data.length} transactions`;
            tooltip += `<div><b>${header}</b></div>`;
          }

          const formatBTC = (val, _decimal) => { const atomic = typeof val === 'bigint' ? val : BigInt(val); const absolute = atomic < 0n ? -atomic : atomic; return `${atomic < 0n ? '-' : ''}${absolute / 100_000_000n}.${(absolute % 100_000_000n).toString().padStart(8, '0')}`; };
          const formatFiat = (val) => this.fiatCurrencyPipe.transform(val, null, 'USD');

          const btcVal = btcData.reduce((total, d) => total + BigInt(d.data[2].value), 0n);
          const fiatVal = fiatData.reduce((total, d) => total + d.data[2].value * d.data[2].price / 100_000_000, 0);
          const btcColor = btcVal === 0n ? '' : (btcVal > 0 ? 'var(--green)' : 'var(--red)');
          const fiatColor = fiatVal === 0 ? '' : (fiatVal > 0 ? 'var(--green)' : 'var(--red)');
          const btcSymbol = btcVal > 0 ? '+' : '';
          const fiatSymbol = fiatVal > 0 ? '+' : '';

          if (btcData.length && fiatData.length) {
            tooltip += `<div style="display: flex; justify-content: space-between; color: ${btcColor}">
              <span style="text-align: left; margin-right: 10px;">${btcSymbol} ${formatBTC(btcVal, 4)} BTC</span>
              <span style="text-align: right;">${fiatSymbol} ${formatFiat(fiatVal)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="text-align: left; margin-right: 10px;">${formatBTC(btcData[0].data[1], 4)} BTC</span>
              <span style="text-align: right;">${formatFiat(fiatData[0].data[1])}</span>
            </div>`;
          } else if (btcData.length) {
            tooltip += `<span style="color: ${btcColor}">${btcSymbol} ${formatBTC(btcVal, 8)} BTC</span><br>
              <span>${formatBTC(data[0].data[1], 8)} BTC</span>`;
          } else {
            if (this.selected[$localize`:@@7e69426bd97a606d8ae6026762858e6e7c86a1fd:Balance`]) {
              tooltip += `<div style="display: flex; justify-content: space-between;">
                <span style="text-align: left; margin-right: 10px;">${formatBTC(data[0].data[3], 4)} BTC</span>
                <span style="text-align: right;">${formatFiat(data[0].data[1])}</span>
              </div>`;
            } else {
              tooltip += `${hasTx ? `<span style="color: ${fiatColor}">${fiatSymbol} ${formatFiat(fiatVal)}</span><br>` : ''}
              <span>${formatFiat(data[0].data[1])}</span>`;
            }
          }

          tooltip += `</div></div>`;
          return tooltip;
        }.bind(this)
      },
      xAxis: {
        type: 'time',
        splitNumber: this.isMobile() ? 5 : 10,
        axisLabel: {
          hideOverlap: true,
        }
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLabel: {
            show: this.showYAxis,
            color: chartChrome().label,
            formatter: (val): string => {
              const valSpan = maxValue - (this.period === 'all' ? 0 : minValue);
              if (valSpan > 100_000_000_000) {
                return `${this.amountShortenerPipe.transform(Math.round(val / 100_000_000), 0, undefined, true)} BTC`;
              }
              else if (valSpan > 1_000_000_000) {
                return `${this.amountShortenerPipe.transform(Math.round(val / 100_000_000), 2, undefined, true)} BTC`;
              } else if (valSpan > 100_000_000) {
                return `${(val / 100_000_000).toFixed(1)} BTC`;
              } else if (valSpan > 10_000_000) {
                return `${(val / 100_000_000).toFixed(2)} BTC`;
              } else if (valSpan > 1_000_000) {
                if (maxValue > 100_000_000_000) {
                  return `${this.amountShortenerPipe.transform(Math.round(val / 100_000_000), 3, undefined, true)} BTC`;
                }
                return `${(val / 100_000_000).toFixed(3)} BTC`;
              } else {
                return `${this.amountShortenerPipe.transform(val, 0, undefined, true)} sats`;
              }
            }
          },
          splitLine: {
            show: false,
          },
          min: this.period === 'all' ? 0 : 'dataMin'
        },
        {
          type: 'value',
          axisLabel: {
            show: this.showYAxis,
            color: chartChrome().label,
            formatter: function(val) {
              return `$${this.amountShortenerPipe.transform(val, 3, undefined, true, true)}`;
            }.bind(this)
          },
          splitLine: {
            show: false,
          },
          min: this.period === 'all' ? 0 : 'dataMin'
        },
      ],
      series: [
        {
          name: $localize`:@@7e69426bd97a606d8ae6026762858e6e7c86a1fd:Balance`,
          yAxisIndex: 0,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          data: this.data,
          areaStyle: {
            opacity: 0.5,
          },
          triggerLineEvent: true,
          type: 'line',
          smooth: false,
          step: 'end'
        }, !this.stateService.isAnyTestnet() ?
        {
          name: 'Fiat',
          yAxisIndex: 1,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          data: this.fiatData,
          areaStyle: {
            opacity: 0.5,
          },
          triggerLineEvent: true,
          type: 'line',
          smooth: false,
          step: 'end'
        } : undefined
      ],
      dataZoom: this.allowZoom ? [{
        type: 'inside',
        realtime: true,
        zoomLock: true,
        maxSpan: 100,
        minSpan: 5,
        moveOnMouseMove: false,
      }, {
        showDetail: false,
        show: true,
        type: 'slider',
        ...chartDataZoomStyle(),
        brushSelect: false,
        realtime: true,
        left: this.adjustedLeft,
        right: this.adjustedRight,
        selectedDataBackground: {
          lineStyle: {
            color: chartChrome().markBorder,
            opacity: 0.45,
          },
        },
      }] : undefined
    };
  }

  onChartClick(e) {
    if (this.hoverData?.length && this.hoverData[0]?.[2]?.txid) {
      this.zone.run(() => {
        const url = this.relativeUrlPipe.transform(`/tx/${this.hoverData[0][2].txid}`);
        if (e.event.event.shiftKey || e.event.event.ctrlKey || e.event.event.metaKey) {
          window.open(url);
        } else {
          this.router.navigate([url]);
        }
      });
    }
  }

  onTooltip(e) {
    this.hoverData = (e?.dataByCoordSys?.[0]?.dataByAxis?.[0]?.seriesDataIndices || []).map(indices => this.data[indices.dataIndex]);
  }

  onLegendSelectChanged(e) {
    this.selected = e.selected;
    if (this.selected['Fiat'] && !this.stateService.isAnyTestnet() && !this.pricedRows && !this.isPricing) {this.loadFiat();}
    this.adjustedRight = this.selected['Fiat'] ? +this.right + 40 : +this.right;
    this.adjustedLeft = this.selected[$localize`:@@7e69426bd97a606d8ae6026762858e6e7c86a1fd:Balance`] ? +this.left : +this.left - 40;
    const graphicElements = this.graphicElements();

    this.chartOptions = {
      grid: {
        right: this.adjustedRight,
        left: this.adjustedLeft,
      },
      graphic: graphicElements.length > 0 ? graphicElements : undefined,
      legend: {
        selected: this.selected,
      },
      dataZoom: this.allowZoom ? [{
        left: this.adjustedLeft,
        right: this.adjustedRight,
      }, {
        left: this.adjustedLeft,
        right: this.adjustedRight,
      }] : undefined
    };

    if (this.chartInstance) {
      this.chartInstance.setOption(this.chartOptions);
    }
  }

  onChartInit(ec) {
    this.chartInstance = ec;
    this.chartInstance.on('showTip', this.onTooltip.bind(this));
    this.chartInstance.on('click', 'series', this.onChartClick.bind(this));
    this.chartInstance.on('legendselectchanged', this.onLegendSelectChanged.bind(this));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.priceSubscription?.unsubscribe();
    this.networkSubscription?.unsubscribe();
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  isMobile() {
    return (window.innerWidth <= 767.98);
  }

  graphicElements() {
    const children = [];
    const imgWidth = this.isMobile() ? 60 : 120;
    const imgHeight = this.isMobile() ? 40 : 80;

    if (this.image) {
      children.push({
        type: 'image',
        style: {
          image: this.image,
          width: imgWidth,
          height: imgHeight,
        },
        left: 'center',
        top: 0,
        z: 100,
      });
    }

    if (this.label) {
      children.push({
        type: 'text',
        left: 'center',
        top: this.image ? imgHeight + 10 : 0,
        z: 100,
        style: {
          fill: '#fff',
          text: this.label,
          font: this.isMobile() ? '18px sans-serif' : '24px sans-serif',
          textAlign: 'center'
        }
      });
    }

    if (children.length) {
      return [{
        type: 'group',
        right: this.adjustedRight + (this.isMobile() ? 10 : 22),
        bottom: '36px',
        z: 100,
        silent: true,
        children: children
      }];
    } else {
      return [];
    }
  }
}
