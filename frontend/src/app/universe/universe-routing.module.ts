import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ProtocolDirectoryComponent } from '@app/universe/protocol-directory/protocol-directory.component';
import { ProtocolDetailComponent } from '@app/universe/protocol-detail/protocol-detail.component';

const routes: Routes = [
  {
    path: '',
    component: ProtocolDirectoryComponent,
  },
  {
    path: ':id',
    component: ProtocolDetailComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UniverseRoutingModule { }
