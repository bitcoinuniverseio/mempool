import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SimplicityApiService } from './simplicity.service';

@Component({
  selector: 'app-simplicity-tx',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="mb-2">
          <a routerLink="/liquid/simplicity" class="btn btn-sm btn-outline-secondary">
            &larr; Back to Simplicity Overview
          </a>
        </div>
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2" *ngIf="execution">
          <div>
            <h1 class="m-0">Simplicity Transaction Execution</h1>
            <div class="text-muted small font-monospace mt-1 text-break">TxID: {{ execution.txid }}</div>
          </div>
          <span class="badge" [ngClass]="execution.execution_success ? 'bg-success' : 'bg-danger'">
            {{ execution.execution_success ? 'EXECUTION SUCCESS' : 'EXECUTION FAILED' }}
          </span>
        </div>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading transaction execution trace...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && execution" class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border mb-4">
            <h2 class="h5 mb-3">Execution Summary</h2>
            <dl class="row mb-0">
              <dt class="col-sm-4 text-muted">Program ID</dt>
              <dd class="col-sm-8 font-monospace small">
                <a [routerLink]="['/liquid/simplicity/program', execution.program_id]" class="text-decoration-none">
                  {{ execution.program_id }}
                </a>
              </dd>

              <dt class="col-sm-4 text-muted">Input Index</dt>
              <dd class="col-sm-8 font-monospace small">{{ execution.input_index }}</dd>

              <dt class="col-sm-4 text-muted">Block Height</dt>
              <dd class="col-sm-8 font-monospace small">{{ execution.block_height }}</dd>

              <dt class="col-sm-4 text-muted">Gas / Budget Consumed</dt>
              <dd class="col-sm-8 font-monospace small">{{ execution.actual_budget_consumed }} WU</dd>

              <dt class="col-sm-4 text-muted">Jets Executed</dt>
              <dd class="col-sm-8">
                <span *ngFor="let jet of execution.jets_executed" class="badge bg-secondary me-1">
                  {{ jet }}
                </span>
              </dd>
            </dl>
          </div>

          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Execution Steps</h2>
            <div class="table-responsive">
              <table class="table table-sm table-hover align-middle">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Node</th>
                    <th>Subexpression</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let step of execution.execution_trace">
                    <td class="font-monospace small text-muted">{{ step.step }}</td>
                    <td><span class="badge bg-body border text-body font-monospace">{{ step.opcode }}</span></td>
                    <td class="font-monospace small text-truncate" style="max-width: 250px;">{{ step.expression }}</td>
                    <td class="font-monospace small">{{ step.cost }} WU</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Witness & Commitments</h2>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Commitment Merkle Root (CMR)</div>
              <div class="font-monospace small text-break mt-1">{{ execution.cmr }}</div>
            </div>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Identity Merkle Root (IMR)</div>
              <div class="font-monospace small text-break mt-1">{{ execution.imr }}</div>
            </div>
            <div class="p-3 border rounded bg-body mb-3">
              <div class="text-muted small">Annotated Merkle Root (AMR)</div>
              <div class="font-monospace small text-break mt-1">{{ execution.amr }}</div>
            </div>
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Pruned Branches Count</div>
              <div class="fs-5 fw-bold">{{ execution.pruned_branches_count || 0 }}</div>
              <div class="small text-muted mt-1">Unexecuted disjunctions elided from witness</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SimplicityTxComponent implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  execution: any = null;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private simplicityApi: SimplicityApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const txid = this.route.snapshot.paramMap.get('txid') || 'tx_sample_simplicity_spend';
    this.sub = this.simplicityApi.getTransactionExecution$(txid).subscribe({
      next: (data) => {
        this.execution = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.message || 'Failed to load transaction execution trace';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
