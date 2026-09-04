import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ConsensusConformanceApiService } from './consensus-conformance.service';

@Component({
  selector: 'app-consensus-conformance-cases',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Consensus Discrepancy Cases</h1>
          <p class="text-muted mb-0">Catalog of transactions and blocks that produce diverging outcomes across different node implementations.</p>
        </div>
        <a routerLink="/labs/consensus/conformance" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Catalog of Identified Divergences</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Case Identifier</th>
                <th>Title</th>
                <th>BIP Reference</th>
                <th>Affected Clients</th>
                <th>Severity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of cases">
                <td class="font-monospace text-info">{{ c.case_id }}</td>
                <td class="fw-semibold">{{ c.title }}</td>
                <td><span class="badge bg-secondary">{{ c.bip_reference }}</span></td>
                <td>
                  <span *ngFor="let a of c.affected_implementations" class="badge bg-danger me-1">{{ a }}</span>
                </td>
                <td><span class="badge bg-danger">{{ c.severity | uppercase }}</span></td>
                <td>
                  <a [routerLink]="['/labs/consensus/case', c.case_id]" class="btn btn-sm btn-outline-info">Replay Case</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceCasesComponent implements OnInit {
  public cases: any[] = [];

  constructor(private api: ConsensusConformanceApiService) {}

  public ngOnInit(): void {
    this.api.getCases$().subscribe(res => {
      this.cases = res;
    });
  }
}
