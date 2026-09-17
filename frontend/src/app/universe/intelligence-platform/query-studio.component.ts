import { StateService } from '@app/services/state.service';
import { OwnerKeyService } from './owner-key.service';
import { SavedQueryPanelComponent } from './saved-query-panel.component';
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService, QueryExecutionResult, QuerySchemaResult, TableSchemaInfo } from './intelligence-api.service';

/**
 * A typed failure of the schema read or an execution. grammar: 400
 * rejected-by-grammar; engine: 503 unavailable-query-engine (reason
 * unconfigured or invalid-dsn); deadline: 504; other: anything else.
 */
export interface QueryFailure {
  kind: 'grammar' | 'engine' | 'deadline' | 'other';
  stage: string | null;
  reason: string | null;
  position: number | null;
  message: string;
}

export function classifyQueryFailure(err: any, fallback: string): QueryFailure {
  const body = err?.error && typeof err.error === 'object' ? err.error : {};
  const stage = typeof body.stage === 'string' ? body.stage : null;
  const reason = typeof body.reason === 'string' ? body.reason : null;
  const position = typeof body.position === 'number' ? body.position : null;
  const message = typeof body.error === 'string' ? body.error : (err?.message || fallback);
  const status = typeof err?.status === 'number' ? err.status : null;
  const kind: QueryFailure['kind'] =
    stage === 'rejected-by-grammar' ? 'grammar'
      : status === 504 || reason === 'deadline' ? 'deadline'
        : stage === 'unavailable-query-engine' || status === 503 ? 'engine'
          : 'other';
  return { kind, stage, reason, position, message };
}

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
          One bounded SELECT over one allowlisted table of the owned read-only analytics replica. Big numbers are returned as exact strings.
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
              <div *ngIf="schemaLoading" class="small text-muted p-2">Discovering the allowlisted tables...</div>
              <div *ngIf="schemaError" class="alert alert-warning small mb-2" role="alert">
                <div class="fw-bold">{{ failureTitle(schemaError) }}</div>
                <div>{{ schemaError.message }}</div>
                <div class="text-muted" *ngIf="schemaError.stage">Reason code: <code>{{ schemaError.stage }}</code><span *ngIf="schemaError.reason"> ({{ schemaError.reason }})</span></div>
              </div>
              <div *ngIf="schemaInfo" class="small text-muted mb-2 px-2">
                {{ schemaInfo.source }}, {{ schemaInfo.network }}, observed {{ schemaInfo.observed_at }}.
                <span *ngIf="schemaInfo.missing_tables?.length">Allowlisted but not on the replica: {{ schemaInfo.missing_tables.join(', ') }}.</span>
              </div>
              <div *ngIf="schemaInfo && schema.length === 0 && !schemaError" class="small text-muted p-2">The replica carries none of the allowlisted tables.</div>
              <div *ngFor="let table of schema" class="mb-3 p-2 rounded bg-dark-subtle">
                <div class="fw-bold font-monospace text-primary">{{ table.table_name }}</div>
                <div class="small text-muted mb-2">{{ table.description }}</div>
                <ul class="list-unstyled small mb-0 font-monospace">
                  <li *ngFor="let col of table.columns" class="d-flex justify-content-between py-1 border-bottom border-secondary-subtle">
                    <span>{{ col.name }}<span *ngIf="col.is_primary_key" class="text-muted"> (pk)</span></span>
                    <span class="text-muted">{{ col.type }}{{ col.nullable ? '?' : '' }}</span>
                  </li>
                </ul>
                <div class="small text-muted mt-1" *ngIf="table.indexes?.length">indexes: {{ table.indexes.join(', ') }}</div>
              </div>
              <div *ngIf="schemaInfo?.grammar" class="small text-muted p-2 border-top">{{ schemaInfo.grammar }}</div>
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
                <span *ngIf="queryError" class="text-danger small" role="alert">
                  <strong>{{ failureTitle(queryError) }}</strong> {{ queryError.message }}
                  <span *ngIf="queryError.position !== null">(at position {{ queryError.position }})</span>
                  <span *ngIf="queryError.stage" class="text-muted">[{{ queryError.stage }}<ng-container *ngIf="queryError.reason">: {{ queryError.reason }}</ng-container>]</span>
                </span>
                <span *ngIf="!queryError && queryResult" class="text-success small">
                  {{ queryResult.row_count }} rows in {{ queryResult.execution_time_ms }} ms from {{ queryResult.source?.table }} on {{ queryResult.source?.engine }}
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
              <span class="badge badge-secondary">{{ rows.length }} rows loaded</span>
            </div>
            <div class="small text-muted px-3 pt-2" *ngIf="queryResult.truncated">
              This page was cut at {{ queryResult.source?.max_rows }} rows or {{ queryResult.source?.result_bytes_limit }} bytes; more rows exist.
            </div>
            <div class="small text-muted px-3 pt-2" *ngIf="queryResult.precision">{{ queryResult.precision }}</div>
            <div class="table-responsive" tabindex="0">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th *ngFor="let col of queryResult.columns">{{ col }}</th>
                  </tr>
                </thead>
                <tbody *ngIf="rows.length; else emptyRows">
                  <tr *ngFor="let row of rows">
                    <td *ngFor="let col of queryResult.columns" class="font-monospace small text-break">
                      {{ cell(row[col]) }}
                    </td>
                  </tr>
                </tbody>
                <ng-template #emptyRows><tbody><tr><td [attr.colspan]="queryResult.columns?.length || 1" class="text-center text-muted py-4">No rows matched.</td></tr></tbody></ng-template>
              </table>
            </div>
            <div class="card-footer d-flex justify-content-between align-items-center flex-wrap gap-2" *ngIf="queryResult.next_cursor">
              <span class="small text-muted">More rows are available for this statement.</span>
              <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="loading" (click)="loadMore()">
                {{ loading ? 'Loading...' : 'Load next page' }}
              </button>
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
  schema: TableSchemaInfo[] = [];
  schemaInfo: QuerySchemaResult | null = null;
  schemaLoading = false;
  schemaError: QueryFailure | null = null;
  sqlQuery = '';
  loading = false;
  queryError: QueryFailure | null = null;
  /** The latest page; `rows` accumulates every page of the same statement. */
  queryResult: QueryExecutionResult | null = null;
  rows: Array<Record<string, unknown>> = [];

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
  invalidate(): void {this.generation++;this.sub?.unsubscribe();this.queryResult=null;this.rows=[];this.queryError=null;this.loading=false;this.cdr.markForCheck();}
  private reset(): void {this.invalidate();this.loadSchema();}
  private loadSchema(): void {
    this.schemaSub?.unsubscribe();this.schema=[];this.schemaInfo=null;this.schemaError=null;this.schemaLoading=true;const generation=this.generation;
    this.schemaSub=this.api.getQuerySchema$().subscribe({
      next:res=>{if(this.destroyed||generation!==this.generation)return;this.schemaLoading=false;this.schema=Array.isArray(res?.tables)?res.tables:[];this.schemaInfo=res&&Array.isArray(res.tables)?res:null;this.cdr.markForCheck();},
      error:err=>{if(this.destroyed||generation!==this.generation)return;this.schemaLoading=false;this.schema=[];this.schemaInfo=null;this.schemaError=classifyQueryFailure(err,'Schema discovery failed.');this.cdr.markForCheck();}});
  }

  failureTitle(failure: QueryFailure): string {
    switch (failure.kind) {
      case 'grammar': return 'Rejected by the query grammar.';
      case 'engine': return failure.reason === 'unconfigured' ? 'No analytics replica is configured on this deployment.' : 'The analytics engine is unavailable.';
      case 'deadline': return 'The query did not finish inside its deadline.';
      default: return 'The request failed.';
    }
  }

  /** Exact strings stay exact; null is shown as NULL rather than an empty cell. */
  cell(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  useSaved(sql: string): void { this.invalidate(); this.sqlQuery=sql; this.cdr.markForCheck(); }

  loadSampleQuery(): void {
    this.sqlQuery = 'SELECT txid, fee_sats, feerate FROM mempool_transactions LIMIT 10';
    this.invalidate();
  }

  executeQuery(): void {
    this.invalidate();
    if (!this.sqlQuery.trim()) return;
    this.run(undefined);
  }

  loadMore(): void {
    const cursor = this.queryResult?.next_cursor;
    if (!cursor || this.loading) return;
    this.run(cursor);
  }

  private run(cursor: string | undefined): void {
    const query=this.sqlQuery.trim(),generation=this.generation;
    this.loading = true;
    this.queryError = null;
    this.cdr.markForCheck();

    this.sub?.unsubscribe();
    this.sub = this.api.executeDevQuery$(query, 100, cursor).subscribe({
      next: (res) => {
        if(this.destroyed||generation!==this.generation||query!==this.sqlQuery.trim())return;
        this.loading = false;
        if (!res || !Array.isArray(res.rows) || !Array.isArray(res.columns)) {
          this.queryResult = null; this.rows = [];
          this.queryError = { kind: 'other', stage: null, reason: null, position: null, message: 'The engine answered without rows or columns.' };
        } else {
          this.queryResult = res;
          this.rows = cursor ? this.rows.concat(res.rows) : res.rows;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        if(this.destroyed||generation!==this.generation)return;
        if (!cursor) { this.queryResult=null; this.rows=[]; }
        this.queryError = classifyQueryFailure(err, 'Query execution failed');
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
