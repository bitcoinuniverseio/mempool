import { Component } from '@angular/core';
import { NodeSecurityEvidenceComponent } from './node-security-evidence.component';
@Component({
  selector: 'app-node-security-node-detail',
  standalone: true,
  imports: [NodeSecurityEvidenceComponent],
  template:
    '<app-node-security-evidence view="node" title="Node Inventory and Exposure Evidence"></app-node-security-evidence>',
})
export class NodeSecurityNodeDetailComponent {}
