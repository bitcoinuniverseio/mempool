import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NgxEchartsModule } from 'ngx-echarts';
import { CHART_ROUTE_CHILDREN } from '@app/universe/chain-graphs/chain-chart-config';
import { ChainChartComponent } from '@app/universe/chain-graphs/chain-chart.component';
import { ChainGraphsComponent } from '@app/universe/chain-graphs/chain-graphs.component';
import { ChainPoolsRankingComponent } from '@app/universe/chain-graphs/chain-pools-ranking.component';

/**
 * The routes come from the same table the regression spec checks against the
 * chart registry, so a chart child promised for Dogecoin or Zcash cannot be
 * added to the registry without getting a mounted page here.
 */
const routes: Routes = [
  {
    path: '',
    component: ChainGraphsComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'mempool' },
      ...CHART_ROUTE_CHILDREN.map((child) =>
        child.chart
          ? {
              path: child.path,
              component: ChainChartComponent,
              data: { chart: child.chart },
            }
          : {
              path: child.path,
              component: ChainPoolsRankingComponent,
            }
      ),
      { path: '**', redirectTo: 'mempool' },
    ],
  },
];

@NgModule({
  imports: [
    ChainGraphsComponent,
    ChainChartComponent,
    ChainPoolsRankingComponent,
    RouterModule.forChild(routes),
    NgxEchartsModule.forRoot({
      echarts: () => import('@app/graphs/echarts').then((m) => m.echarts),
    }),
  ],
})
export class ChainGraphsModule {}
