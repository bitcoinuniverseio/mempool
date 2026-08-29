import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MultichainExplorerComponent } from '@app/universe/multichain-explorer/multichain-explorer.component';

const routes: Routes = [
  {
    path: '',
    component: MultichainExplorerComponent,
    data: { page: 'dashboard' },
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
  imports: [MultichainExplorerComponent, RouterModule.forChild(routes)],
})
export class MultichainExplorerModule {}
