import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ConsensusConformanceApiService, ConformanceOverview } from './consensus-conformance.service';

@Component({
  selector: 'app-consensus-conformance-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Consensus Conformance & Formal Verification Center</h1>
          <p class="text-muted mb-0">Cross-client differential fuzzing, divergence reproduction, and machine-checked Lean/Coq specifications.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/labs/consensus/differential" class="btn btn-primary btn-sm">Differential Matrix</a>
          <a routerLink="/labs/consensus/formal" class="btn btn-outline-primary btn-sm">Formal Proofs</a>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/labs/consensus/conformance">Overview</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/labs/consensus/differential">Differential Fuzzing</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/labs/consensus/cases">Discrepancy Cases</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/labs/consensus/formal">Formal Verification</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/labs/consensus/specifications">BIP Specifications</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/labs/consensus/corpora">Corpora & Fuzz Seeds</a>
        </li>
      </ul>

      <!-- Metrics -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Conformance Test Battery</div>
            <div class="display-6 fw-bold text-info my-1">{{ overview.total_conformance_tests | number }}</div>
            <div class="small text-success">{{ overview.passing_conformance_tests | number }} passing suites</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Divergences Found</div>
            <div class="display-6 fw-bold text-danger my-1">{{ overview.divergent_test_cases }}</div>
            <div class="small text-muted">Active differential bugs</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Verified Formal Theorems</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.formal_theorems_verified }}</div>
            <div class="small text-muted">Lean 4 & Coq proofs</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Fuzz Executions (24h)</div>
            <div class="display-6 fw-bold text-primary my-1">{{ (overview.total_fuzz_executions_24h / 1000000) | number:'1.1-1' }}M</div>
            <div class="small text-muted">Mutational seed iterations</div>
          </div>
        </div>
      </div>

      <!-- Implementations Conformance Table -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Consensus Engine Conformance Ratings</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Engine Implementation</th>
                <th>Language</th>
                <th>Conformance Rate</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let impl of overview.implementations">
                <td class="fw-bold">{{ impl.name }}</td>
                <td><code>{{ impl.language }}</code></td>
                <td>
                  <div class="d-flex align-items-center">
                    <span class="me-2 fw-semibold">{{ impl.conformance_pct }}%</span>
                    <div class="progress flex-grow-1" style="height: 6px;">
                      <div class="progress-bar bg-success" [style.width.%]="impl.conformance_pct"></div>
                    </div>
                  </div>
                </td>
                <td>
                  <span class="badge" [ngClass]="impl.status === 'reference' ? 'bg-primary' : 'bg-secondary'">
                    {{ impl.status | uppercase }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Divergences -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Active Discrepancy Findings</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Description</th>
                <th>BIP Reference</th>
                <th>Severity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of overview.recent_divergences">
                <td class="font-monospace text-info">
                  <a [routerLink]="['/labs/consensus/case', c.case_id]">{{ c.case_id }}</a>
                </td>
                <td>{{ c.title }}</td>
                <td><span class="badge bg-secondary">{{ c.bip_reference }}</span></td>
                <td><span class="badge bg-danger">{{ c.severity | uppercase }}</span></td>
                <td>
                  <a [routerLink]="['/labs/consensus/case', c.case_id]" class="btn btn-sm btn-outline-danger">Inspect & Replay</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceOverviewComponent implements OnInit {
  public overview: ConformanceOverview | null = null;

  constructor(private api: ConsensusConformanceApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
