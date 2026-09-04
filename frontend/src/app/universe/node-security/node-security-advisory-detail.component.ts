import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-advisory-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="advisory">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Security Advisory: <span class="text-danger">{{ advisory.advisory_id }}</span></h1>
          <p class="text-muted mb-0">{{ advisory.title }} ({{ advisory.cve_id }})</p>
        </div>
        <a routerLink="/node/security/advisories" class="btn btn-outline-secondary btn-sm">Back to Advisories</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Severity</div>
            <div class="h3 fw-bold text-danger my-1">{{ advisory.severity | uppercase }}</div>
            <div class="small text-muted">CVSS Risk Level</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Fixed In</div>
            <div class="h3 fw-bold text-success my-1">{{ advisory.fixed_version }}</div>
            <div class="small text-muted">Recommended upgrade target</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Publication Date</div>
            <div class="h3 fw-bold text-light my-1">{{ advisory.published_at }}</div>
            <div class="small text-muted">Public disclosure</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Vulnerability Description</h5>
        </div>
        <div class="card-body">
          <p class="text-light">{{ advisory.description }}</p>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title text-warning mb-0">Recommended Mitigation & Remediation</h5>
        </div>
        <div class="card-body">
          <p class="text-light mb-0">{{ advisory.remediation_steps }}</p>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityAdvisoryDetailComponent implements OnInit {
  public advisory: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: NodeSecurityApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const id = params.get('advisoryId') || 'ADV-2026-001';
      this.api.getAdvisory$(id).subscribe(res => {
        this.advisory = res;
      });
    });
  }
}
