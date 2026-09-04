import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ConsensusConformanceApiService } from './consensus-conformance.service';

@Component({
  selector: 'app-consensus-conformance-formal',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Formal Specification & Machine-Checked Proofs</h1>
          <p class="text-muted mb-0">Mathematically proven consensus properties in Lean 4 and Coq/Rocq provers.</p>
        </div>
        <a routerLink="/labs/consensus/conformance" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Formally Verified Bitcoin Specifications</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Specification</th>
                <th>Proof Assistant</th>
                <th>Theorems Proven</th>
                <th>Verified Invariant</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of artifacts">
                <td class="fw-bold text-info">{{ s.name }}</td>
                <td><span class="badge bg-secondary">{{ s.prover }}</span></td>
                <td class="font-monospace text-success">{{ s.theorems_count }} proofs</td>
                <td class="small text-muted">{{ s.mathematical_invariants }}</td>
                <td><span class="badge bg-success">MACHINE CHECKED</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceFormalComponent implements OnInit {
  public artifacts: any[] = [];

  constructor(private api: ConsensusConformanceApiService) {}

  public ngOnInit(): void {
    this.api.getFormalArtifacts$().subscribe(res => {
      this.artifacts = res;
    });
  }
}
