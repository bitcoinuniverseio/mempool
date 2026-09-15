import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, distinctUntilChanged, startWith } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { checkedGraph, checkedPath, normalizedEntity } from './graph-evidence';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-transaction-graph',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Transaction Graph</h1>
        </div>
        <p class="subtitle">
          Expand a transaction or address up to three hops through this node's chain data.
        </p>
      </header>

      <section class="card p-3 mb-4">
        <h2 class="h5">Find a transaction path</h2>
        <p>Search downstream through at most four hops. A missing path in a bounded search does not prove there is no connection.</p>
        <label for="graph-path-from">From transaction ID</label><input id="graph-path-from" class="form-control font-monospace mb-2" [(ngModel)]="pathFrom" (ngModelChange)="pathEdited()" maxlength="64" />
        <label for="graph-path-to">To transaction ID</label><input id="graph-path-to" class="form-control font-monospace mb-2" [(ngModel)]="pathTo" (ngModelChange)="pathEdited()" maxlength="64" />
        <button class="btn btn-primary" (click)="findPath()" [disabled]="pathLoading">Find path</button>
        <p *ngIf="pathError" class="alert alert-warning mt-2" role="alert">{{ pathError }}</p>
        <div *ngIf="pathResult" class="mt-3" role="status">
          <h3 class="h6">{{ pathResult.path_found ? 'Observed transaction path' : 'No path found in this search' }}</h3>
          <p *ngIf="pathResult.search_exhausted">Search budget reached; the reachable set was not exhausted.</p>
          <ol *ngIf="pathResult.path_found"><li *ngFor="let id of pathResult.node_sequence"><code>{{ id }}</code></li></ol>
          <p>Exact funds transferred: Unknown.</p>
          <p>Path value upper bound: {{ pathResult.value_upper_bound_sats === null ? 'Unknown' : (pathResult.value_upper_bound_sats | number) + ' sats' }}.</p>
          <p>{{ pathResult.transfer_scope }}</p>
        </div>
      </section>
      <!-- Query Controls -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Query</h4>
        </div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label small text-muted" for="rootEntity">Txid or address</label>
              <input
                id="rootEntity"
                type="text"
                class="form-control font-monospace text-break"
                [(ngModel)]="rootEntity" (ngModelChange)="edited()" maxlength="120"
                placeholder="txid or address"
              />
            </div>
            <div class="col-md-2">
              <label class="form-label small text-muted" for="hopsSelect">Hops</label>
              <select id="hopsSelect" class="form-control" [(ngModel)]="hops" (ngModelChange)="edited()">
                <option [ngValue]="1">1</option>
                <option [ngValue]="2">2</option>
                <option [ngValue]="3">3</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small text-muted" for="directionSelect">Direction</label>
              <select id="directionSelect" class="form-control" [(ngModel)]="direction" (ngModelChange)="edited()">
                <option value="both">Both</option>
                <option value="upstream">Inputs</option>
                <option value="downstream">Spends</option>
              </select>
            </div>
            <div class="col-md-2 d-flex align-items-end">
              <button
                type="button"
                class="btn btn-primary w-100"
                [disabled]="loading || !rootEntity.trim()"
                (click)="runQuery()"
              >
                {{ loading ? 'Expanding...' : 'Expand' }}
              </button>
            </div>
          </div>

          <div *ngIf="queryError" class="alert alert-danger mt-3 mb-0">
            {{ queryError }}
          </div>
        </div>
      </section>

      <!-- Initial Prompt -->
      <div *ngIf="!activeResult && !loading && !queryError" class="p-4 rounded bg-dark-subtle text-muted text-center mb-4">
        Enter a transaction ID or address to expand its graph.
      </div>

      <!-- Graph View -->
      <section *ngIf="activeResult" class="results-section">
        <div class="card mb-4 border-primary">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="badge badge-primary">GRAPH EXPANDED</span>
              <h5 class="mt-1 mb-0 font-monospace text-break">{{ activeResult.root_entity }}</h5>
            </div>
            <div class="metrics d-flex gap-3">
              <div><span class="text-muted small">Nodes:</span> <strong>{{ activeResult.nodes.length }}</strong></div>
              <div><span class="text-muted small">Edges:</span> <strong>{{ activeResult.edges.length }}</strong></div>
            </div>
          </div>
          <div class="card-body">
            <p>Selected-index observations only. These connections do not identify owners or trace exact funds through mixed transaction inputs.</p>
            <p *ngIf="activeResult.truncated" class="alert alert-warning" role="status">Bounded result: {{ activeResult.truncation_reason }}. Completeness is not established.</p>
            <!-- Nodes Table -->
            <h5 class="mb-3">Discovered Graph Nodes</h5>
            <div class="table-responsive mb-4" tabindex="0">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Entity Identifier</th>
                    <th>Type</th>
                    <th>Depth</th>
                    <th>Transaction output total</th>
                    <th>Confirmation</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let node of activeResult.nodes">
                    <td class="font-monospace text-break">{{ node.id }}</td>
                    <td><span class="badge badge-secondary">{{ node.type }}</span></td>
                    <td>Hop {{ node.depth }}</td>
                    <td>{{ node.value_sats === null ? 'Unknown' : (node.value_sats | number) + ' sats' }}</td>
                    <td><span class="badge badge-secondary">{{ node.status }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Value Edges Table -->
            <h5 class="mb-3">Observed Output Connections</h5>
            <div class="table-responsive" tabindex="0">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Type</th>
                    <th>Satoshis</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let edge of activeResult.edges">
                    <td class="font-monospace small text-break">{{ edge.source_id }}</td>
                    <td class="font-monospace small text-break">{{ edge.target_id }}</td>
                    <td><span class="badge badge-primary">{{ edge.edge_type }}</span></td>
                    <td class="font-monospace">{{ edge.value_sats | number }} sats</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
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
export class TransactionGraphComponent implements OnInit, OnDestroy {
  rootEntity = '';
  hops = 2;
  direction = 'both';
  loading = false;
  queryError: string | null = null;
  activeResult: any = null;

  private sub?: Subscription;
  private networkSubscription?: Subscription;
  private pathSubscription?: Subscription;
  pathFrom = '';
  pathTo = '';
  pathLoading = false;
  pathError: string | null = null;
  pathResult: any = null;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef,
    private network: StateService
  ) {}

  ngOnInit(): void {
    this.networkSubscription = this.network.networkChanged$.pipe(startWith(this.network.network), distinctUntilChanged()).subscribe(() => {this.edited();this.pathEdited();});
  }

  runQuery(): void {
    this.edited();
    if (!this.rootEntity.trim()) return;
    const root = normalizedEntity(this.rootEntity);
    const hops = this.hops, direction = this.direction, network = this.network.network || 'mainnet';
    if (!root || !Number.isInteger(hops) || hops < 1 || hops > 3 || !['upstream','downstream','both'].includes(direction)) {this.queryError = 'Enter a bounded transaction ID or address and supported query options.';return;}
    this.loading = true;
    this.queryError = null;
    this.cdr.markForCheck();

    this.sub?.unsubscribe();
    this.sub = this.api.queryGraph$(root, hops, direction).subscribe({
      next: (res) => {
        try {this.activeResult = checkedGraph(res, root, network, hops, direction);}
        catch {this.queryError = 'The index returned incomplete or mismatched graph evidence.';}
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.queryError = err?.error?.error || err?.message || 'Graph query expansion failed';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  edited(): void {
    this.sub?.unsubscribe();this.sub = undefined;this.loading = false;this.queryError = null;this.activeResult = null;this.cdr.markForCheck();
  }
  pathEdited(): void {
    this.pathSubscription?.unsubscribe();this.pathSubscription = undefined;this.pathLoading = false;this.pathError = null;this.pathResult = null;this.cdr.markForCheck();
  }
  findPath(): void {
    this.pathEdited();
    const from = this.pathFrom.trim().toLowerCase(), to = this.pathTo.trim().toLowerCase(), network = this.network.network || 'mainnet';
    if (!/^[0-9a-f]{64}$/.test(from) || !/^[0-9a-f]{64}$/.test(to)) {this.pathError = 'Enter two complete 32-byte transaction IDs.';return;}
    this.pathLoading = true;
    this.pathSubscription = this.api.findShortestPath$(from, to).subscribe({
      next: result => {
        this.pathLoading = false;
        try {this.pathResult = checkedPath(result, from, to, network);}
        catch {this.pathError = 'The index returned incomplete or mismatched path evidence.';}
        this.cdr.markForCheck();
      },
      error: error => {this.pathLoading = false;this.pathError = error?.error?.error || 'The selected index could not complete the path search.';this.cdr.markForCheck();},
    });
  }
  ngOnDestroy(): void {this.edited();this.pathEdited();this.networkSubscription?.unsubscribe();}
}
