import { Component } from '@angular/core';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-overview',
  standalone: true,
  imports: [NodeSecurityEvidenceComponent],
  template:
    '<app-node-security-evidence view="overview" title="Node Software Security, Advisories and Upgrade Readiness"></app-node-security-evidence>',
})
export class NodeSecurityOverviewComponent {}
