import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MultichainExplorerComponent } from '@app/universe/multichain-explorer/multichain-explorer.component';
import { ChainDashboardComponent } from '@app/universe/chain-dashboard/chain-dashboard.component';
import { ChainMiningComponent } from '@app/universe/chain-dashboard/chain-mining.component';

const routes: Routes = [
  {
    path: '',
    component: ChainDashboardComponent,
    data: { page: 'dashboard' },
  },
  {
    path: 'mining',
    component: ChainMiningComponent,
    data: { page: 'mining' },
  },
  {
    path: 'graphs',
    loadChildren: () =>
      import('@app/universe/chain-graphs/chain-graphs.module').then(
        (m) => m.ChainGraphsModule
      ),
  },
  {
    path: 'docs',
    loadChildren: () =>
      import('@app/universe/chain-docs/chain-docs.module').then(
        (m) => m.ChainDocsModule
      ),
  },
  {
    path: 'mempool',
    component: MultichainExplorerComponent,
    data: { page: 'mempool' },
  },
  {
    path: 'block/:reference',
    component: MultichainExplorerComponent,
    data: { page: 'block' },
  },
  {
    path: 'tx/:txid',
    component: MultichainExplorerComponent,
    data: { page: 'transaction' },
  },
  {
    path: 'address/:reference',
    component: MultichainExplorerComponent,
    data: { page: 'address' },
  },
  {
    path: 'outpoint/:txid/:vout',
    component: MultichainExplorerComponent,
    data: { page: 'outpoint' },
  },
  {
    path: 'protocols',
    component: MultichainExplorerComponent,
    data: { page: 'protocols' },
  },
  {
    path: 'protocols/:protocol',
    component: MultichainExplorerComponent,
    data: { page: 'protocol-list' },
  },
  {
    path: 'protocols/:protocol/:reference/holders',
    component: MultichainExplorerComponent,
    data: { page: 'protocol-holders' },
  },
  {
    path: 'protocols/:protocol/:reference/events',
    component: MultichainExplorerComponent,
    data: { page: 'protocol-events' },
  },
  {
    path: 'protocols/:protocol/:reference',
    component: MultichainExplorerComponent,
    data: { page: 'protocol-detail' },
  },
];

@NgModule({
  imports: [
    MultichainExplorerComponent,
    ChainDashboardComponent,
    ChainMiningComponent,
    RouterModule.forChild(routes),
  ],
})
export class MultichainExplorerModule {}
