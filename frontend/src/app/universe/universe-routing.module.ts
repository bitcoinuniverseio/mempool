import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ProtocolDirectoryComponent } from '@app/universe/protocol-directory/protocol-directory.component';

const routes: Routes = [
  {
    path: '',
    component: ProtocolDirectoryComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UniverseRoutingModule { }
