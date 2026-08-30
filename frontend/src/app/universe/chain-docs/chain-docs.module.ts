import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ChainDocsComponent } from '@app/universe/chain-docs/chain-docs.component';

const routes: Routes = [
  {
    path: '',
    component: ChainDocsComponent,
  },
  {
    path: ':section',
    component: ChainDocsComponent,
  },
];

@NgModule({
  imports: [ChainDocsComponent, RouterModule.forChild(routes)],
})
export class ChainDocsModule {}
