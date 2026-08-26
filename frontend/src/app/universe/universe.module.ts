import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { UniverseRoutingModule } from '@app/universe/universe-routing.module';
import { UniverseSharedModule } from '@app/universe/universe-shared.module';
import { ProtocolDirectoryComponent } from '@app/universe/protocol-directory/protocol-directory.component';

@NgModule({
  declarations: [
    ProtocolDirectoryComponent,
  ],
  imports: [
    CommonModule,
    SharedModule,
    UniverseRoutingModule,
    UniverseSharedModule,
  ],
  exports: [
    UniverseSharedModule,
  ],
})
export class UniverseModule { }
