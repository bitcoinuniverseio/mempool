import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimplicityApiService, SimplicityProgram } from './simplicity.service';

@Component({
  selector: 'app-simplicity-contracts',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Simplicity Contract Programs</h1>
          <span class="badge bg-secondary" *ngIf="programs.length > 0">
            {{ programs.length }} Programs
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Catalog of observed on-chain Simplicity smart contracts on Liquid, commitment roots, and static resource bounds.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/liquid/simplicity">Overview</a>
          <a class="nav-link active" routerLink="/liquid/simplicity/contracts">Contract Programs</a>
          <a class="nav-link" routerLink="/tools/simplicity">Compiler Workbench</a>
          <a class="nav-link" routerLink="/tools/simplicity/verify">Formal Proof Verifier</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading Simplicity programs...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && programs.length > 0" class="card p-4 bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle">
            <thead>
              <tr>
                <th>Program ID / Name</th>
                <th>CMR (Commitment Root)</th>
                <th>Type</th>
                <th>Static Weight</th>
                <th>Memory Bound</th>
                <th>Formal Proof</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of programs">
                <td>
                  <div class="fw-bold">{{ p.source_name || p.program_id }}</div>
                  <div class="small text-muted font-monospace">{{ p.program_id }}</div>
                </td>
                <td class="font-monospace small text-truncate" style="max-width: 200px;">
                  {{ p.cmr }}
                </td>
                <td><span class="badge bg-secondary">{{ p.program_type }}</span></td>
                <td class="font-monospace small">{{ p.static_cost_weight }} WU</td>
                <td class="font-monospace small">{{ p.memory_bound_bytes }} B</td>
                <td>
                  <span class="badge" [ngClass]="p.is_formally_verified ? 'bg-success' : 'bg-secondary'">
                    {{ p.is_formally_verified ? 'VERIFIED' : 'UNPROVEN' }}
                  </span>
                </td>
                <td>
                  <a [routerLink]="['/liquid/simplicity/program', p.program_id]" class="btn btn-sm btn-outline-primary">
                    Inspect
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class SimplicityContractsComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  programs: SimplicityProgram[] = [];
  private sub?: Subscription;

  constructor(
    private simplicityApi: SimplicityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.simplicityApi.getPrograms$().subscribe({
      next: (data) => {
        this.programs = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load Simplicity programs';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
