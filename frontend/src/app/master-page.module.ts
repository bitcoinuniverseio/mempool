import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { MasterPageComponent } from '@components/master-page/master-page.component';
import { SharedModule } from '@app/shared/shared.module';

import { StartComponent } from '@components/start/start.component';
import { PushTransactionComponent } from '@components/push-transaction/push-transaction.component';
import { TestTransactionsComponent } from '@components/test-transactions/test-transactions.component';
import { CalculatorComponent } from '@components/calculator/calculator.component';
import { BlocksList } from '@components/blocks-list/blocks-list.component';
import { RbfList } from '@components/rbf-list/rbf-list.component';
import { StaleList } from '@components/stale-list/stale-list.component';
import { StratumList } from '@components/stratum/stratum-list/stratum-list.component';
import { ServerHealthComponent } from '@components/server-health/server-health.component';
import { ServerStatusComponent } from '@components/server-health/server-status.component';
import { FaucetComponent } from '@components/faucet/faucet.component';
import { SimpleProofWidgetComponent } from '@components/simpleproof-widget/simpleproof-widget.component';
import { SimpleProofCuboWidgetComponent } from '@components/simpleproof-widget/simpleproof-cubo-widget.component';
import { ChainSyncNoticeComponent } from '@app/universe/chain-sync-notice/chain-sync-notice.component';

const browserWindow = window || {};
// @ts-ignore
const browserWindowEnv = browserWindow.__env || {};

const routes: Routes = [
  {
    path: '',
    component: MasterPageComponent,
    children: [
      {
        path: 'mining/blocks',
        redirectTo: 'blocks',
        pathMatch: 'full'
      },
      {
        path: 'tx/push',
        component: PushTransactionComponent,
      },
      {
        path: 'pushtx',
        component: PushTransactionComponent,
      },
      {
        path: 'tx/test',
        component: TestTransactionsComponent,
      },
      {
        path: 'blocks/stale',
        component: StaleList,
      },
      {
        path: 'blocks/:page',
        component: BlocksList,
      },
      {
        path: 'blocks',
        redirectTo: 'blocks/1',
      },
      {
        path: 'rbf',
        component: RbfList,
      },
      ...(browserWindowEnv.STRATUM_ENABLED ? [{
        path: 'stratum',
        component: StartComponent,
        children: [
          {
            path: '',
            component: StratumList,
          }
        ]
      }] : []),
      {
        path: 'terms-of-service',
        loadChildren: () => import('@components/terms-of-service/terms-of-service.module').then(m => m.TermsOfServiceModule),
      },
      {
        path: 'privacy-policy',
        loadChildren: () => import('@components/privacy-policy/privacy-policy.module').then(m => m.PrivacyPolicyModule),
      },
      {
        path: 'tx',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () => import('@components/transaction/transaction.module').then(m => m.TransactionModule),
      },
      {
        path: 'block',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () => import('@components/block/block.module').then(m => m.BlockModule),
      },
      {
        path: 'docs',
        loadChildren: () => import('@app/docs/docs.module').then(m => m.DocsModule),
        data: { preload: true },
      },
      {
        path: 'api',
        loadChildren: () => import('@app/docs/docs.module').then(m => m.DocsModule)
      },
      {
        path: 'lightning',
        loadChildren: () => import('@app/lightning/lightning.module').then(m => m.LightningModule),
        data: { preload: browserWindowEnv && browserWindowEnv.LIGHTNING === true, networks: ['bitcoin'] },
      },
      {
        path: 'protocols',
        loadChildren: () => import('@app/universe/universe.module').then(m => m.UniverseModule),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'dogecoin',
        loadChildren: () => import('@app/universe/multichain-explorer/multichain-explorer.module').then(m => m.MultichainExplorerModule),
        data: { networks: ['bitcoin'], chain: 'dogecoin' },
      },
      {
        path: 'zcash',
        loadChildren: () => import('@app/universe/multichain-explorer/multichain-explorer.module').then(m => m.MultichainExplorerModule),
        data: { networks: ['bitcoin'], chain: 'zcash' },
      },
      {
        path: 'source',
        loadComponent: () => import('@app/universe/source-page/source-page.component').then(m => m.SourcePageComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'outpoint/:txid/:vout',
        loadComponent: () => import('@app/universe/outpoint/outpoint.component').then(m => m.OutpointComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'pulse',
        loadComponent: () => import('@app/universe/pulse/pulse.component').then(m => m.PulseComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'saved',
        loadComponent: () => import('@app/universe/saved/saved.component').then(m => m.SavedComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'inscription/:reference',
        loadComponent: () => import('@app/universe/inscription/inscription.component').then(m => m.InscriptionComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'rune/:reference',
        loadComponent: () => import('@app/universe/rune/rune.component').then(m => m.RuneComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'sat/:reference',
        loadComponent: () => import('@app/universe/sat/sat.component').then(m => m.SatComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'tools/calculator',
        component: CalculatorComponent
      }
    ],
  }
];

if (window['__env']?.OFFICIAL_MEMPOOL_SPACE) {
  routes[0].children.push({
    path: 'monitoring',
    data: { networks: ['bitcoin', 'liquid'] },
    component: ServerHealthComponent
  });
  routes[0].children.push({
    path: 'nodes',
    data: { networks: ['bitcoin', 'liquid'] },
    component: ServerStatusComponent
  });
  if (window['isMempoolSpaceBuild']) {
    routes[0].children.push({
      path: 'faucet',
      canActivate: [(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
        return state.url.startsWith('/testnet4/');
      }],
      component: StartComponent,
      data: { preload: true, networkSpecific: true },
      children: [{
        path: '',
        data: { networks: ['bitcoin'] },
        component: FaucetComponent,
      }]
    });
  }
}

if (window['__env']?.customize?.dashboard?.widgets?.some(w => w.component ==='simpleproof')) {
  routes[0].children.push({
    path: 'sp/verified',
    component: SimpleProofWidgetComponent,
  });
}

if (window['__env']?.customize?.dashboard?.widgets?.some(w => w.component ==='simpleproof_cubo')) {
  routes[0].children.push({
    path: 'sp/cubo',
    component: SimpleProofCuboWidgetComponent,
  });
}

@NgModule({
  imports: [
    RouterModule.forChild(routes)
  ],
  exports: [
    RouterModule
  ]
})
export class MasterPageRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    MasterPageRoutingModule,
    SharedModule,
    ChainSyncNoticeComponent,
  ],
  declarations: [
    MasterPageComponent,
  ],
  exports: [
    MasterPageComponent,
  ]
})
export class MasterPageModule { }
