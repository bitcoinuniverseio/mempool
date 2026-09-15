import { Component, ChangeDetectionStrategy } from '@angular/core';
import { OffchainPackageWorkspaceComponent } from './offchain-package-workspace.component';
@Component({selector:'app-statechain-verify',standalone:true,imports:[OffchainPackageWorkspaceComponent],changeDetection:ChangeDetectionStrategy.OnPush,template:'<app-offchain-package-workspace kind="statechain" />'})
export class StatechainVerifyComponent {}
