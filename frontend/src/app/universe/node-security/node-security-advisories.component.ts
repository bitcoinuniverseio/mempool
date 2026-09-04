import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-advisories',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Bitcoin Security Advisories & Vulnerability Database</h1>
          <p class="text-muted mb-0">Public disclosure archives, severity assessments, affected versions, and patch guidelines.</p>
        </div>
        <a routerLink="/node/security" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Tracked Security Disclosures</h5>
        </div>
        <div class="table-responsive">
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
                  <a [routerLink]="['/node/security/advisory', adv.advisory_id]" class="btn btn-sm btn-outline-info">View Advisory</a>
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

  constructor(private api: NodeSecurityApiService) {}

  public ngOnInit(): void {
    this.api.getAdvisories$().subscribe(res => {
      this.advisories = res;
    });
  }
}
