import { Component } from '@angular/core';
import { ConformanceEvidenceComponent } from './conformance-evidence.component';
@Component({
  selector: 'app-consensus-conformance-specifications',
  standalone: true,
  imports: [ConformanceEvidenceComponent],
  template: '<app-conformance-evidence mode="specifications" />',
})
export class ConsensusConformanceSpecificationsComponent {}
