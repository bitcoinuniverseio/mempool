import { Component } from '@angular/core';
import { SubmissionEvidenceComponent } from './submission-evidence.component';
@Component({
  selector: 'app-private-submission-ordering',
  standalone: true,
  imports: [SubmissionEvidenceComponent],
  template:
    '<app-submission-evidence view="ordering" title="Transaction Ordering Observations"></app-submission-evidence>',
})
export class PrivateSubmissionOrderingComponent {}
