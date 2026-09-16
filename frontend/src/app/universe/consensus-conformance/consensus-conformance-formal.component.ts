import { Component } from '@angular/core';
import { ConformanceEvidenceComponent } from './conformance-evidence.component';
@Component({
  selector: 'app-consensus-conformance-formal',
  standalone: true,
  imports: [ConformanceEvidenceComponent],
  template: '<app-conformance-evidence mode="formal" />',
})
export class ConsensusConformanceFormalComponent {}
