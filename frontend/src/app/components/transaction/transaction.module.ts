import { NgModule, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule } from '@angular/router';
import { TransactionComponent } from '@components/transaction/transaction.component';
import { TransactionDetailsComponent } from '@components/transaction/transaction-details/transaction-details.component';
import { SharedModule } from '@app/shared/shared.module';
import { TxBowtieModule } from '@components/tx-bowtie-graph/tx-bowtie.module';
import { TransactionExtrasModule } from '@components/transaction/transaction-extras.module';
import { GraphsModule } from '@app/graphs/graphs.module';
import { UniverseSharedModule } from '@app/universe/universe-shared.module';
import { TransactionRawComponent } from '@components/transaction/transaction-raw.component';
import { CpfpInfoComponent } from '@components/transaction/cpfp-info.component';
import { StateService } from '@app/services/state.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

const routes: Routes = [
  {
    path: '',
    // A bare /tx goes home on the selected network, not to the root network.
    redirectTo: () => new RelativeUrlPipe(inject(StateService)).transform('/'),
    pathMatch: 'full',
  },
  {
    path: 'preview',
    component: TransactionRawComponent,
  },
  {
    path: ':id',
    component: TransactionComponent,
    data: {
      ogImage: true
    }
  }
];

@NgModule({
  imports: [
    RouterModule.forChild(routes)
  ],
  exports: [
    RouterModule
  ]
})
export class TransactionRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    TransactionRoutingModule,
    SharedModule,
    GraphsModule,
    UniverseSharedModule,
    TxBowtieModule,
    TransactionExtrasModule,
  ],
  declarations: [
    TransactionComponent,
    TransactionDetailsComponent,
    TransactionRawComponent,
    CpfpInfoComponent,
  ],
  exports: [
    TransactionComponent,
    TransactionDetailsComponent,
    CpfpInfoComponent,
  ]
})
export class TransactionModule { }






