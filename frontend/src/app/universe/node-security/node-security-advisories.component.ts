import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { NodeSecurityApiService } from './node-security.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-node-security-advisories',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Bitcoin Security Advisories & Vulnerability Database</h1>
          <p class="text-muted mb-0">Public disclosure archives, severity assessments, affected versions, and patch guidelines.</p>
        </div>
        <a [routerLink]="'/node/security' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Tracked Security Disclosures</h5>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Tracked Security Disclosures, scroll horizontally" i18n-aria-label>
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Advisory ID</th>
                <th>CVE ID</th>
                <th>Vulnerability Title</th>
                <th>Severity</th>
                <th>Affected Releases</th>
                <th>Patched In</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let adv of advisories">
                <td class="font-monospace text-info">{{ adv.advisory_id }}</td>
                <td><span class="badge bg-danger">{{ adv.cve_id }}</span></td>
                <td class="fw-semibold">{{ adv.title }}</td>
                <td><span class="badge bg-secondary">{{ adv.affected_versions.join(', ') }}</span></td>
                <td><span class="badge bg-success">{{ adv.fixed_version }}</span></td>
                <td><span class="badge bg-danger">{{ adv.severity | uppercase }}</span></td>
                <td>
                  <a [routerLink]="['/node/security/advisory' | relativeUrl, adv.advisory_id]" class="btn btn-sm btn-outline-info">View Advisory</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityAdvisoriesComponent implements OnInit {
  public advisories: any[] = [];

  public loadError: string | null = null;

  constructor(private api: NodeSecurityApiService) {}

  public ngOnInit(): void {
    this.api.getAdvisories$().subscribe({
      next: res => {
        this.advisories = res;
        this.loadError = null;
      },
      error: err => {
        this.advisories = [];
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }
}
