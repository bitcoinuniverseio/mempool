import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule } from '@angular/router';
import { BlockComponent } from '@components/block/block.component';
import { BlockTransactionsComponent } from '@components/block/block-transactions.component';
import { SharedModule } from '@app/shared/shared.module';
import { BlockAssetsComponent } from '@app/universe/block-assets/block-assets.component';
import { AssetInventoryComponent } from '@app/universe/asset-inventory/asset-inventory.component';

const routes: Routes = [
  {
    path: ':id',
    component: BlockComponent,
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
export class BlockRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    BlockRoutingModule,
    SharedModule,
    BlockAssetsComponent,
    AssetInventoryComponent,
  ],
  declarations: [
    BlockComponent,
    BlockTransactionsComponent,
  ]
})
export class BlockModule { }






