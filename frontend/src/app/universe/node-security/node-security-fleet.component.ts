import { Component } from '@angular/core';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-fleet',
  standalone: true,
  imports: [NodeSecurityEvidenceComponent],
  template:
    '<app-node-security-evidence view="fleet" title="Node Fleet Inventory"></app-node-security-evidence>',
})
export class NodeSecurityFleetComponent {}
