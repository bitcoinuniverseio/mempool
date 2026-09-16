import { Component, ChangeDetectionStrategy } from '@angular/core';
import { OffchainPackageWorkspaceComponent } from './offchain-package-workspace.component';
@Component({selector:'app-coinswap-inspect',standalone:true,imports:[OffchainPackageWorkspaceComponent],changeDetection:ChangeDetectionStrategy.OnPush,template:'<app-offchain-package-workspace kind="coinswap" />'})
export class CoinswapInspectComponent {}
