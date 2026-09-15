import { Component } from '@angular/core';
import { ConformanceEvidenceComponent } from './conformance-evidence.component';
@Component({
  selector: 'app-consensus-conformance-differential',
  standalone: true,
  imports: [ConformanceEvidenceComponent],
  template: '<app-conformance-evidence mode="differential" />',
})
export class ConsensusConformanceDifferentialComponent {}
