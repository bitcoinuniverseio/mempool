import { Component } from '@angular/core';
import { SubmissionEvidenceComponent } from './submission-evidence.component';
@Component({
  selector: 'app-private-submission-ordering-block',
  standalone: true,
  imports: [SubmissionEvidenceComponent],
  template:
    '<app-submission-evidence view="block" title="Block Ordering Evidence"></app-submission-evidence>',
})
export class PrivateSubmissionOrderingBlockComponent {}
