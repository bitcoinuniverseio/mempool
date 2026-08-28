import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, LOCALE_ID, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { echarts, EChartsOption } from '@app/graphs/echarts';
import { Observable, Subject, Subscription, combineLatest, fromEvent, merge, share } from 'rxjs';
import { startWith, switchMap, tap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { formatNumber } from '@angular/common';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { download, formatterXAxis, formatterXAxisLabel, formatterXAxisTimeCategory } from '@app/shared/graphs.utils';
import { StorageService } from '@app/services/storage.service';
import { MiningService } from '@app/services/mining.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Acceleration } from '@interfaces/node-api.interface';
import { ServicesApiServices } from '@app/services/services-api.service';
import { StateService } from '@app/services/state.service';
import { chartChrome, rampStops } from '@app/shared/chart-theme';

@Component({
  selector: 'app-acceleration-fees-graph',
  templateUrl: './acceleration-fees-graph.component.html',
  styleUrls: ['./acceleration-fees-graph.component.scss'],
  styles: [`
    .loadingGraphs {
      position: absolute;
      top: 50%;
      left: calc(50% - 15px);
      z-index: 99;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AccelerationFeesGraphComponent implements OnInit, OnChanges, OnDestroy {
  @Input() widget: boolean = false;
  @Input() height: number = 300;
  @Input() right: number | string = 70;
  @Input() left: number | string = 55;
  @Input() period: '24h' | '1w' | '1m' | '1y' | 'all' = '1y';
  @Input() accelerations$: Observable<Acceleration[]>;

  miningWindowPreference: string;
  radioGroupForm: UntypedFormGroup;

  chartOptions: EChartsOption = {};
  chartInitOptions = {
    renderer: 'svg',
  };

  aggregatedHistory$: Observable<any>;
  statsSubscription: Subscription;
  aggregatedHistorySubscription: Subscription;
  fragmentSubscription: Subscription;
  isLoading = true;
  formatNumber = formatNumber;
  timespan = '';
  periodSubject$: Subject<'24h' | '1w' | '1m' | '1y' | 'all'> = new Subject();
  chartInstance: any = undefined;
  daysAvailable: number = 0;

  constructor(
    @Inject(LOCALE_ID) public locale: string,
    private seoService: SeoService,
    private servicesApiService: ServicesApiServices,
    private formBuilder: UntypedFormBuilder,
    private storageService: StorageService,
    private miningService: MiningService,
    private route: ActivatedRoute,
    public stateService: StateService,
    private cd: ChangeDetectorRef
  ) {
    this.radioGroupForm = this.formBuilder.group({ dateSpan: '1w' });
    this.radioGroupForm.controls.dateSpan.setValue('1w');
  }

  ngOnInit(): void {
    if (this.widget) {
      this.miningWindowPreference = this.period;
    } else {
      this.seoService.setTitle($localize`:@@bcf34abc2d9ed8f45a2f65dd464c46694e9a181e:Acceleration Fees`);
      this.miningWindowPreference = this.miningService.getDefaultTimespan('1w');
    }
    this.radioGroupForm = this.formBuilder.group({ dateSpan: this.miningWindowPreference });
    this.radioGroupForm.controls.dateSpan.setValue(this.miningWindowPreference);

    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (['1w', '1m', '1y', 'all'].indexOf(fragment) > -1) {
        this.radioGroupForm.controls.dateSpan.setValue(fragment, { emitEvent: false });
      }
    });
    this.aggregatedHistory$ = combineLatest([
      merge(
        this.radioGroupForm.get('dateSpan').valueChanges.pipe(
          startWith(this.radioGroupForm.controls.dateSpan.value),
        ),
        this.periodSubject$
      ).pipe(
        switchMap((timespan) => {
          if (!this.widget) {
            this.storageService.setValue('miningWindowPreference', timespan);
          }
          if (timespan !== this.timespan) {
            this.isLoading = true;
          }
          this.timespan = timespan;
          return this.servicesApiService.getAggregatedAccelerationHistory$({timeframe: this.timespan});
        })
      ),
      fromEvent(window, 'resize').pipe(startWith(null)),
    ]).pipe(
      tap(([response]) => {
        const history: Acceleration[] = response.body;
        this.daysAvailable = (new Date().getTime() / 1000 - response.headers.get('x-oldest-accel')) / (24 * 3600);
        this.isLoading = false;
        this.prepareChartOptions(history);
        this.cd.markForCheck();
      }),
      share(),
    );

    this.aggregatedHistorySubscription = this.aggregatedHistory$.subscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.period) {
      if (this.period === '24h') {
        this.period = '1m';
      }
      this.periodSubject$.next(this.period);
    }
  }

  prepareChartOptions(data) {
    let title: object;
    if (data.length === 0) {
      title = {
        textStyle: {
          color: 'grey',
          fontSize: 15
        },
        text: $localize`No accelerated transaction for this timeframe`,
        left: 'center',
        top: 'center'
      };
    }

    this.chartOptions = {
      title: title,
      color: [
        new echarts.graphic.LinearGradient(0, 0, 0, 0.65, rampStops('scale')),
        '#ab2dce',
      ],
      animation: false,
      grid: {
        height: (this.widget && this.height) ? this.height - 50 : undefined,
        top: this.widget ? 40 : 60,
        bottom: this.widget ? 30 : 80,
        right: this.right,
        left: this.left,
      },
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
        formatter: (ticks) => {
          let tooltip = `<b style="color: white; margin-left: 2px">${formatterXAxis(this.locale, this.timespan, parseInt(ticks[0].axisValue, 10))}</b><br>`;

          for (const tick of ticks) {
            if (tick.seriesName === 'Total bid boost') {
              if (tick.data[1] > 10_000_000) {
                tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(tick.data[1] / 100_000_000, this.locale, '1.0-8')} BTC<br>`;
              } else {
                tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(tick.data[1], this.locale, '1.0-0')} sats<br>`;
              }
            } else if (tick && tick.seriesName === 'Accelerated') {
              tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(tick.data[1], this.locale, '1.0-0')}<br>`;
            }
          }
          tooltip += `<small>` + $localize`Around block: ${ticks[0].data[2]}` + `</small>`;

          return tooltip;
        }
      },
      xAxis: data.length === 0 ? undefined :
      {
        name: this.widget ? undefined : formatterXAxisLabel(this.locale, this.timespan),
        nameLocation: 'middle',
        nameTextStyle: {
          padding: [10, 0, 0, 0],
        },
        type: 'time',
        boundaryGap: [0, 0],
        axisLine: { onZero: true },
        axisLabel: {
          formatter: (val): string => formatterXAxisTimeCategory(this.locale, this.timespan, val),
          align: 'center',
          fontSize: 11,
          lineHeight: 12,
          hideOverlap: true,
          padding: [0, 5],
        },
      },
      legend: {
        data: [
          {
            name: 'Total bid boost',
            inactiveColor: chartChrome().label,
            textStyle: {
              color: chartChrome().label,
            },
            itemStyle: {
              color: chartChrome().series[3],
            },
            icon: 'roundRect',
          },
          {
            name: 'Accelerated',
            inactiveColor: chartChrome().label,
            textStyle: {
              color: chartChrome().label,
            },
            icon: 'roundRect',
          },
        ],
        selected: {
          'Total bid boost': true,
        },
        show: !this.widget,
      },
      yAxis: data.length === 0 ? undefined : [
        {
          type: 'value',
          name: 'Total bid boost',
          position: 'right',
          nameTextStyle: {
            align: 'right',
            padding: [0, -65, 0, 0],
            fontStyle: 'italic',
          },
          axisLabel: {
            color: chartChrome().label,
            formatter: (val) => {
              if (val >= 100_000) {
                return `${(val / 100_000_000).toFixed(3)} BTC`;
              } else {
                return `${val} sats`;
              }
            }
          },
          splitLine: null
        },
        {
          type: 'value',
          name: 'Accelerated',
          position: 'left',
          axisLabel: {
            color: chartChrome().label,
          },
          nameTextStyle: {
            align: 'right',
            padding: [0, -35, 0, 0],
            fontStyle: 'italic',
          },
          splitLine: {
            lineStyle: {
              type: 'dotted',
              color: 'var(--transparent-fg)',
              opacity: 0.25,
            }
          },
        },
      ],
      series: data.length === 0 ? undefined : [
        {
          name: 'Total bid boost',
          data: data.map(h =>  {
            return [h.timestamp * 1000, h.sumBidBoost, h.avgHeight];
          }),
          type: 'line',
          symbol: 'none',
          lineStyle: {
            width: 1,
          },
          smooth: true,
        },
        {
          name: 'Accelerated',
          yAxisIndex: 1,
          data: data.map(h =>  {
            return [h.timestamp * 1000, h.count, h.avgHeight];
          }),
          type: 'bar',
          barWidth: '90%',
        },
      ],
      dataZoom: (this.widget || data.length === 0 )? undefined : [{
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
        brushSelect: false,
        realtime: true,
        left: 20,
        right: 15,
        selectedDataBackground: {
          lineStyle: {
            color: chartChrome().markBorder,
            opacity: 0.45,
          },
          areaStyle: {
            opacity: 0,
          }
        },
      }],
    };
  }

  onChartInit(ec) {
    this.chartInstance = ec;
  }

  isMobile() {
    return (window.innerWidth <= 767.98);
  }

  onSaveChart() {
    // @ts-ignore
    const prevBottom = this.chartOptions.grid.bottom;
    const now = new Date();
    // @ts-ignore
    this.chartOptions.grid.bottom = 40;
    this.chartOptions.backgroundColor = chartChrome().surface;
    this.chartInstance.setOption(this.chartOptions);
    download(this.chartInstance.getDataURL({
      pixelRatio: 2,
      excludeComponents: ['dataZoom'],
    }), `acceleration-fees-${this.timespan}-${Math.round(now.getTime() / 1000)}.svg`);
    // @ts-ignore
    this.chartOptions.grid.bottom = prevBottom;
    this.chartOptions.backgroundColor = 'none';
    this.chartInstance.setOption(this.chartOptions);
  }

  ngOnDestroy(): void {
    this.aggregatedHistorySubscription?.unsubscribe();
    this.fragmentSubscription?.unsubscribe();
    this.statsSubscription?.unsubscribe();
  }
}
