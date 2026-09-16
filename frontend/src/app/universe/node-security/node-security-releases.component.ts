import { Component } from '@angular/core';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-releases',
  standalone: true,
  imports: [NodeSecurityEvidenceComponent],
  template:
    '<app-node-security-evidence view="releases" title="Software Release Lifecycle"></app-node-security-evidence>',
})
export class NodeSecurityReleasesComponent {}
