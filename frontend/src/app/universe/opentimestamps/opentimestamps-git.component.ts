import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * Git commit and tag attestations.
 *
 * The revision this replaces shipped two rows of invented attestations, each
 * badged "VERIFIED IN BITCOIN", one of them attributed to a named person, with
 * no request behind them and no proof anywhere. A page that badges a commit as
 * anchored in Bitcoin has to have checked one. This says it has nothing to show
 * until the attestation source exists.
 */
@Component({
  selector: 'app-opentimestamps-git',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Git Commit and Tag Proof of Publication</h1>
          <p class="text-muted mb-0">Verify Git commit hashes and releases anchored into the Bitcoin blockchain through ots-git.</p>
        </div>
        <a [routerLink]="'/tools/timestamp' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="alert alert-warning" role="alert">
        This deployment carries no Git attestation source yet, so there are no anchored commits to show.
        Nothing here is a proof, and nothing here has been checked against Bitcoin.
      </div>
    </div>
  `
})
export class OpenTimestampsGitComponent {}
