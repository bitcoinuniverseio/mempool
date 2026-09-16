import { Component } from '@angular/core';
import { ConformanceEvidenceComponent } from './conformance-evidence.component';
@Component({
  selector: 'app-consensus-conformance-case-detail',
  standalone: true,
  imports: [ConformanceEvidenceComponent],
  template: '<app-conformance-evidence mode="case" />',
})
export class ConsensusConformanceCaseDetailComponent {}
