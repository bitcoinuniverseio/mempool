import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { TxBowtieModule } from '@components/tx-bowtie-graph/tx-bowtie.module';
import { GraphsModule } from '@app/graphs/graphs.module';
import { TrackerComponent } from '@components/tracker/tracker.component';
import { TrackerBarComponent } from '@components/tracker/tracker-bar.component';
import { TransactionModule } from '@components/transaction/transaction.module';

const routes: Routes = [
  {
    path: ':id',
    component: TrackerComponent,
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
/**
 * IMPLEMENTATION-HANDOFF [TX-07] TX-07-FE-TRACKER-MODULE
 * Coverage G14; D11. R-USER/R-ARCH.
 * The app-level TrackerGuard routes some /tx/:id visits to TrackerComponent,
 * not TransactionComponent. The compact tracker currently has no asset summary.
 * 1. Import UniverseSharedModule in TrackerModule (the second NgModule below),
 * without adding protocol-directory routes or duplicating declarations.
 * 2. Expose the same compact transaction-assets presentation in tracker mode,
 * using the existing txId/network/tx.status/replaced state. Use one summary
 * request per identity/revision and preserve the details-mode footer link.
 * 3. Keep waiting-for-transaction distinct from no supported tokens. A missing
 * base tx must not show a successful zero-count or retry forever.
 * Depends TX-06; coordinate tracker template and its state inputs/tests.
 * Tests: new tracker integration test plus browser /tx/:id?mode=status versus
 * mode=details, tracker-to-details/back, unknown tx, pending/confirmed/replaced,
 * and mobile. Both entry variants are required; testing one does not cover both.
 */
export class TrackerRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    TrackerRoutingModule,
    TransactionModule,
    SharedModule,
    GraphsModule,
    TxBowtieModule,
  ],
  declarations: [
    TrackerComponent,
    TrackerBarComponent,
  ]
})
export class TrackerModule { }






