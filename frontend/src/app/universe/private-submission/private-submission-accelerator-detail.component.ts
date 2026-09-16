import { Component } from '@angular/core';
import { SubmissionEvidenceComponent } from './submission-evidence.component';
@Component({
  selector: 'app-private-submission-accelerator-detail',
  standalone: true,
  imports: [SubmissionEvidenceComponent],
  template:
    '<app-submission-evidence view="provider" title="Accelerator Provider Record"></app-submission-evidence>',
})
export class PrivateSubmissionAcceleratorDetailComponent {}
