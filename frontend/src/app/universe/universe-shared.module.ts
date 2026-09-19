import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ProtocolBadgeComponent } from '@app/universe/protocol-badge/protocol-badge.component';
import { AssetFlowComponent } from '@app/universe/asset-flow/asset-flow.component';
import { TransactionAssetsComponent } from '@app/universe/transaction-assets/transaction-assets.component';

/**
 * Universe presentation pieces that other feature modules embed. Kept separate
 * from UniverseModule so importing them never pulls in the lazy route table.
 */
@NgModule({
  declarations: [
    ProtocolBadgeComponent,
    AssetFlowComponent,
    TransactionAssetsComponent,
  ],
  imports: [
    CommonModule,
    RouterModule,
  ],
  exports: [
    ProtocolBadgeComponent,
    AssetFlowComponent,
    TransactionAssetsComponent,
  ],
})
export class UniverseSharedModule { }
