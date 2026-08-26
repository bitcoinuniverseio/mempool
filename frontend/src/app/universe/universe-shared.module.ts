import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ProtocolBadgeComponent } from '@app/universe/protocol-badge/protocol-badge.component';
import { AssetFlowComponent } from '@app/universe/asset-flow/asset-flow.component';

/**
 * Universe presentation pieces that other feature modules embed. Kept separate
 * from UniverseModule so importing them never pulls in the lazy route table.
 */
@NgModule({
  declarations: [
    ProtocolBadgeComponent,
    AssetFlowComponent,
  ],
  imports: [
    CommonModule,
    RouterModule,
  ],
  exports: [
    ProtocolBadgeComponent,
    AssetFlowComponent,
  ],
})
export class UniverseSharedModule { }
