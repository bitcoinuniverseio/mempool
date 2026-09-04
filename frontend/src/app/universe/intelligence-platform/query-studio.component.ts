import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-query-studio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Mempool Query Studio</h1>
          <span class="badge badge-success">Sandboxed Read-Only SQL</span>
        </div>
        <p class="subtitle">
          Execute analytical SQL queries over real-time and historical mempool tables, inspect schema definitions, and export query results.
        </p>
      </header>

      <div class="row g-4 mb-4">
        <!-- Schema Sidebar -->
        <div class="col-md-4">
          <div class="card h-100">
            <div class="card-header">
              <h5 class="mb-0">Table Schema Explorer</h5>
            </div>
            <div class="card-body p-2">
              <div *ngFor="let table of schema" class="mb-3 p-2 rounded bg-dark-subtle">
                <div class="fw-bold font-monospace text-primary">{{ table.table_name }}</div>
                <div class="small text-muted mb-2">{{ table.description }}</div>
                <ul class="list-unstyled small mb-0 font-monospace">
                  <li *ngFor="let col of table.columns" class="d-flex justify-content-between py-1 border-bottom border-secondary-subtle">
                    <span>{{ col.name }}</span>
                    <span class="text-muted">{{ col.type }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- SQL Editor and Execution -->
        <div class="col-md-8">
          <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h5 class="mb-0">SQL Query Editor</h5>
              <div class="d-flex gap-2 align-items-center">
                <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSampleQuery()">
                  Load Sample Query
                </button>
                <span class="small text-muted">SELECT only • 5000ms limit</span>
              </div>
            </div>
            <div class="card-body">
              <label class="form-label small text-muted" for="sqlQueryInput">Analytical SQL Query</label>
              <textarea
                id="sqlQueryInput"
                class="form-control font-monospace mb-3"
                rows="5"
                [(ngModel)]="sqlQuery"
                placeholder="SELECT txid, fee_sats, feerate FROM mempool_transactions LIMIT 20"
              ></textarea>
              <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span *ngIf="queryError" class="text-danger small">{{ queryError }}</span>
                <span *ngIf="!queryError && queryResult" class="text-success small">
                  {{ queryResult.row_count }} rows returned in {{ queryResult.execution_time_ms }} ms
                </span>
                <button
                  type="button"
                  class="btn btn-primary ms-auto"
                  [disabled]="loading || !sqlQuery.trim()"
                  (click)="executeQuery()"
                >
                  {{ loading ? 'Executing...' : 'Run Query' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Empty Initial State -->
          <div *ngIf="!queryResult && !loading && !queryError" class="p-4 rounded bg-dark-subtle text-muted text-center">
            Write an analytical SELECT query or click "Load Sample Query" above to inspect execution results.
          </div>

          <!-- Query Results -->
          <div *ngIf="queryResult" class="card">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h5 class="mb-0">Execution Results</h5>
              <span class="badge badge-secondary">{{ queryResult.rows?.length || 0 }} rows</span>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th *ngFor="let col of queryResult.columns">{{ col }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of queryResult.rows">
                    <td *ngFor="let col of queryResult.columns" class="font-monospace small text-break">
                      {{ row[col] }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
    .badge-success { background-color: var(--success, #198754); color: #fff; }
  `],
})
export class QueryStudioComponent implements OnInit, OnDestroy {
  schema: any[] = [];
  sqlQuery = '';
  loading = false;
  queryError: string | null = null;
  queryResult: any = null;

  private sub?: Subscription;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getQuerySchema$().subscribe((res) => {
      this.schema = res?.tables || [];
      this.cdr.markForCheck();
    });
  }

  loadSampleQuery(): void {
    this.sqlQuery = 'SELECT txid, fee_sats, feerate FROM mempool_transactions LIMIT 10';
    this.executeQuery();
  }

  executeQuery(): void {
    if (!this.sqlQuery.trim()) return;
    this.loading = true;
    this.queryError = null;
    this.cdr.markForCheck();

    this.sub?.unsubscribe();
    this.sub = this.api.executeDevQuery$(this.sqlQuery.trim()).subscribe({
      next: (res) => {
        this.queryResult = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.queryError = err?.error?.error || err?.message || 'Query execution failed';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
