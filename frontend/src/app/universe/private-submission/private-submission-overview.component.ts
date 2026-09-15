import { Component } from '@angular/core';
import { SubmissionEvidenceComponent } from './submission-evidence.component';
@Component({
  selector: 'app-private-submission-overview',
  standalone: true,
  imports: [SubmissionEvidenceComponent],
  template:
    '<app-submission-evidence view="overview" title="Private Submission and Acceleration"></app-submission-evidence>',
})
export class PrivateSubmissionOverviewComponent {}
