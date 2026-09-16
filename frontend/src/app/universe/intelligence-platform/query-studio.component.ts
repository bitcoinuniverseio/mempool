import { StateService } from '@app/services/state.service';
import { OwnerKeyService } from './owner-key.service';
import { SavedQueryPanelComponent } from './saved-query-panel.component';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-query-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, SavedQueryPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Query Studio</h1>
          <span class="badge badge-secondary">Read-only SQL</span>
        </div>
        <p class="subtitle">
          Run analytical queries when an analytics source is connected.
        </p>
      </header>

      <app-saved-query-panel [sql]="sqlQuery" (load)="useSaved($event)" />
      <div class="row g-4 mb-4">
        <!-- Schema Sidebar -->
        <div class="col-md-4 order-2 order-md-1">
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
        <div class="col-md-8 order-1 order-md-2">
          <div class="card mb-4">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h5 class="mb-0">Query</h5>
              <div class="d-flex gap-2 align-items-center">
                <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSampleQuery()">
                  Example
                </button>
                <span class="small text-muted">SELECT only</span>
              </div>
            </div>
            <div class="card-body">
              <label class="form-label small text-muted" for="sqlQueryInput">SQL query</label>
              <textarea
                id="sqlQueryInput"
                class="form-control font-monospace mb-3"
                rows="5"
                [(ngModel)]="sqlQuery" (ngModelChange)="invalidate()"
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
            Run a SELECT query to see results.
          </div>

          <!-- Query Results -->
          <div *ngIf="queryResult" class="card">
            <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h5 class="mb-0">Results</h5>
              <span class="badge badge-secondary">{{ queryResult.rows?.length || 0 }} rows</span>
            </div>
            <div class="table-responsive" tabindex="0">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th *ngFor="let col of queryResult.columns">{{ col }}</th>
                  </tr>
                </thead>
                <tbody *ngIf="queryResult.rows?.length; else emptyRows">
                  <tr *ngFor="let row of queryResult.rows">
                    <td *ngFor="let col of queryResult.columns" class="font-monospace small text-break">
                      {{ row[col] }}
                    </td>
                  </tr>
                </tbody>
                <ng-template #emptyRows><tbody><tr><td [attr.colspan]="queryResult.columns?.length || 1" class="text-center text-muted py-4">No rows returned.</td></tr></tbody></ng-template>
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
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
  `],
})
export class QueryStudioComponent implements OnInit, OnDestroy {
  schema: any[] = [];
  sqlQuery = '';
  loading = false;
  queryError: string | null = null;
  queryResult: any = null;

  private sub?: Subscription;
  private schemaSub?: Subscription;
  private context = new Subscription();
  private generation=0;
  private destroyed=false;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef,
    private state: StateService,
    private owner: OwnerKeyService
  ) {}

  ngOnInit(): void {
    this.loadSchema();this.context.add(this.state.networkChanged$?.subscribe(()=>this.reset()));this.context.add(this.owner.key$.subscribe(()=>this.reset()));
  }
  invalidate(): void {this.generation++;this.sub?.unsubscribe();this.queryResult=null;this.queryError=null;this.loading=false;this.cdr.markForCheck();}
  private reset(): void {this.invalidate();this.loadSchema();}
  private loadSchema(): void {
    this.schemaSub?.unsubscribe();this.schema=[];const generation=this.generation;
    this.schemaSub=this.api.getQuerySchema$().subscribe({next:res=>{if(this.destroyed||generation!==this.generation)return;this.schema=Array.isArray(res?.tables)?res.tables:[];this.cdr.markForCheck();},error:()=>{if(this.destroyed||generation!==this.generation)return;this.schema=[];this.queryError='Analytics source unavailable.';this.cdr.markForCheck();}});
  }

  useSaved(sql: string): void { this.invalidate(); this.sqlQuery=sql; this.cdr.markForCheck(); }

  loadSampleQuery(): void {
    this.sqlQuery = 'SELECT txid, fee_sats, feerate FROM mempool_transactions LIMIT 10';
    this.sub?.unsubscribe(); this.queryResult=null; this.queryError=null; this.loading=false; this.cdr.markForCheck();
  }

  executeQuery(): void {
    this.invalidate();
    if (!this.sqlQuery.trim()) return;
    const query=this.sqlQuery.trim(),generation=this.generation;
    this.loading = true;
    this.queryError = null;
    this.cdr.markForCheck();

    this.sub?.unsubscribe();
    this.sub = this.api.executeDevQuery$(this.sqlQuery.trim()).subscribe({
      next: (res) => {
        if(this.destroyed||generation!==this.generation||query!==this.sqlQuery.trim())return;
        this.queryResult = res;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if(this.destroyed||generation!==this.generation)return;
        this.queryResult=null;
        this.queryError = err?.error?.error || err?.message || 'Query execution failed';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.destroyed=true;this.generation++;this.schemaSub?.unsubscribe();this.context.unsubscribe();
    this.sub?.unsubscribe();
  }
}
