import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { UniverseRoutingModule } from '@app/universe/universe-routing.module';
import { ProtocolBadgeComponent } from '@app/universe/protocol-badge/protocol-badge.component';
import { ProtocolDirectoryComponent } from '@app/universe/protocol-directory/protocol-directory.component';

@NgModule({
  declarations: [
    ProtocolBadgeComponent,
    ProtocolDirectoryComponent,
  ],
  imports: [
    CommonModule,
    SharedModule,
    UniverseRoutingModule,
  ],
  exports: [
    ProtocolBadgeComponent,
  ],
})
export class UniverseModule { }
