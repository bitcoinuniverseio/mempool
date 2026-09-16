import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, Subscription, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SimplicityApiService, SimplicityTransaction } from './simplicity.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-simplicity-tx', standalone: true,
  imports: [CommonModule, RouterModule, RelativeUrlPipe], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="container-xl py-4">
    <a [routerLink]="'/liquid/simplicity' | relativeUrl">Back to Simplicity overview</a>
    <h1 class="mt-3">Simplicity transaction executions</h1>
    <p>Requires owned program-index evidence. Compilation alone does not establish a transaction execution.</p>
    <p *ngIf="loading" role="status">Reading execution evidence…</p>
    <p *ngIf="error" role="alert" class="alert alert-warning">{{ error }}</p>
    <ng-container *ngIf="transaction">
      <p class="font-monospace text-break">{{ transaction.txid }}</p>
      <p *ngIf="!transaction.has_simplicity">The source reports no Simplicity execution for this transaction.</p>
      <article *ngFor="let execution of transaction.executions" class="card p-3 mb-3">
        <h2 class="h5">Input {{ execution.input_index ?? 'not supplied' }} · {{ execution.execution_id }}</h2>
        <p>{{ execution.success ? 'Source reports execution success' : 'Source reports execution failure' }}</p>
        <a [routerLink]="['/liquid/simplicity/program' | relativeUrl, execution.program_id]">{{ execution.program_id }}</a>
        <dl><dt>CMR</dt><dd class="font-monospace text-break">{{ execution.cmr }}</dd>
          <dt>Cost reported by index</dt><dd>{{ execution.total_cost }} (unit interpretation requires the indexed runtime revision)</dd>
          <dt>Memory cells</dt><dd>{{ execution.total_cells }}</dd>
          <dt>Executed at</dt><dd>{{ execution.executed_at }}</dd>
          <dt>Block, IMR, AMR and pruned branch count</dt><dd>Not supplied by this execution response.</dd></dl>
        <h3 class="h6">Execution steps</h3>
        <div class="table-responsive"><table class="table"><thead><tr><th>Step</th><th>Node</th><th>Expression</th><th>Cost</th><th>Memory delta</th></tr></thead>
          <tbody><tr *ngFor="let step of execution.steps"><td>{{ step.step }}</td><td>{{ step.node_name }}</td><td>{{ step.expression }}</td><td>{{ step.cost }}</td><td>{{ step.memory_delta }}</td></tr></tbody></table></div>
      </article>
    </ng-container>
  </section>`,
})
export class SimplicityTxComponent implements OnInit, OnDestroy {
  loading = true; error: string | null = null; transaction: SimplicityTransaction | null = null;
  private sub?: Subscription;
  constructor(private route: ActivatedRoute, private simplicityApi: SimplicityApiService, private cdr: ChangeDetectorRef, private state: StateService) {}
  ngOnInit(): void {
    this.sub = combineLatest([this.route.paramMap, this.state.networkChanged$.pipe(startWith(this.state.network))]).pipe(switchMap(([params]) => {
      this.transaction = null; this.error = null; this.loading = true; this.cdr.markForCheck();
      const id = params.get('txid');
      if (!id || !/^[a-f0-9]{64}$/i.test(id)) { this.error = 'A valid transaction ID is required.'; return of(null); }
      return this.simplicityApi.getTransactionExecution$(id).pipe(map(value => {
        if (value?.txid !== id || typeof value.has_simplicity !== 'boolean' || !Array.isArray(value.executions)
          || value.has_simplicity !== (value.executions.length > 0)
          || value.executions.some(execution => (execution.txid !== undefined && execution.txid !== id) || typeof execution.success !== 'boolean' || !Array.isArray(execution.steps))) throw Error('Mismatched execution');
        return value;
      }), catchError(() => { this.error = 'Transaction execution index is unavailable or returned mismatched evidence.'; return of(null); }));
    })).subscribe(value => { this.transaction = value; this.loading = false; this.cdr.markForCheck(); });
  }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }
}
