import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NodeSecurityApiService, NodeSecurityOverview } from './node-security.service';

@Component({
  selector: 'app-node-security-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Node Software Security, Advisory & Upgrade Readiness Center</h1>
          <p class="text-muted mb-0">Fleet vulnerability monitoring, security advisory tracking, Guix artifact integrity, and configuration audits.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/node/security/fleet" class="btn btn-primary btn-sm">Fleet Status</a>
          <a routerLink="/node/security/upgrade" class="btn btn-outline-primary btn-sm">Upgrade Readiness</a>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/node/security">Overview</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/node/security/fleet">Node Fleet</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/node/security/advisories">Security Advisories</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/node/security/releases">Release Lifecycle</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/node/security/artifacts">Guix Verification</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/node/security/upgrade">Upgrade Planner</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/node/security/configuration">Hardened Config</a>
        </li>
      </ul>

      <!-- Metric Cards -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Monitored Fleet Nodes</div>
            <div class="display-6 fw-bold text-info my-1">{{ overview.total_fleet_nodes }}</div>
            <div class="small text-success">{{ overview.secure_nodes_count }} Healthy / {{ overview.vulnerable_nodes_count }} Need Action</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Active Advisories</div>
            <div class="display-6 fw-bold text-danger my-1">{{ overview.active_advisories_count }}</div>
            <div class="small text-muted">CVE & disclosure alerts</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">End-of-Life Versions</div>
            <div class="display-6 fw-bold text-warning my-1">{{ overview.eol_versions_detected }}</div>
            <div class="small text-muted">Unsupported node instances</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Guix Verified Binaries</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.guix_verified_artifacts_count }}</div>
            <div class="small text-muted">Multi-maintainer attested</div>
          </div>
        </div>
      </div>

      <!-- Critical Advisories -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary d-flex justify-content-between align-items-center">
          <h5 class="card-title mb-0">Active Critical Advisories</h5>
          <span class="badge bg-danger">{{ overview.critical_advisories.length }} High Priority</span>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Advisory ID</th>
                <th>CVE</th>
                <th>Title</th>
                <th>Affected Versions</th>
                <th>Remediation</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let adv of overview.critical_advisories">
                <td class="font-monospace text-info">
                  <a [routerLink]="['/node/security/advisory', adv.advisory_id]">{{ adv.advisory_id }}</a>
                </td>
                <td><span class="badge bg-danger">{{ adv.cve_id }}</span></td>
                <td class="fw-semibold">{{ adv.title }}</td>
                <td><code class="text-warning">{{ adv.affected_versions.join(', ') }}</code></td>
                <td><span class="badge bg-success">{{ adv.fixed_version }}</span></td>
                <td>
                  <a [routerLink]="['/node/security/advisory', adv.advisory_id]" class="btn btn-sm btn-outline-info">Inspect</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityOverviewComponent implements OnInit {
  public overview: NodeSecurityOverview | null = null;

  constructor(private api: NodeSecurityApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
