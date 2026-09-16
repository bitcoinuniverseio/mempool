import { Component } from '@angular/core';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-advisory-detail',
  standalone: true,
  imports: [NodeSecurityEvidenceComponent],
  template:
    '<app-node-security-evidence view="advisory" title="Security Advisory"></app-node-security-evidence>',
})
export class NodeSecurityAdvisoryDetailComponent {}
