import { Component } from '@angular/core';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-advisories',
  standalone: true,
  imports: [NodeSecurityEvidenceComponent],
  template:
    '<app-node-security-evidence view="advisories" title="Security Advisory Directory"></app-node-security-evidence>',
})
export class NodeSecurityAdvisoriesComponent {}
