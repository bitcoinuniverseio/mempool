import { Component } from '@angular/core';
import { SubmissionEvidenceComponent } from './submission-evidence.component';
@Component({
  selector: 'app-private-submission-ordering-tx',
  standalone: true,
  imports: [SubmissionEvidenceComponent],
  template:
    '<app-submission-evidence view="tx" title="Transaction Ordering Evidence"></app-submission-evidence>',
})
export class PrivateSubmissionOrderingTxComponent {}
