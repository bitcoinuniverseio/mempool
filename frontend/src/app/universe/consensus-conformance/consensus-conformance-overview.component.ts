import { Component } from '@angular/core';
import { ConformanceEvidenceComponent } from './conformance-evidence.component';
@Component({
  selector: 'app-consensus-conformance-overview',
  standalone: true,
  imports: [ConformanceEvidenceComponent],
  template: '<app-conformance-evidence mode="overview" />',
})
export class ConsensusConformanceOverviewComponent {}
