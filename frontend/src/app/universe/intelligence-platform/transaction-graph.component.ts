import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
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
          <h1>Multi-Hop Transaction Graph Workspace</h1>
          <span class="badge badge-secondary">Anti-Heuristic Investigation</span>
        </div>
        <p class="subtitle">
          Interactive provenance and payment flow graph exploration with bounded multi-hop expansion, shortest value paths, and verifiable evidence tags.
        </p>
      </header>

      <!-- Query Controls -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Graph Query Parameters</h4>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSampleTxid()">
            Load Sample Txid
          </button>
        </div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label small text-muted" for="rootEntity">Root Entity (Txid or Address)</label>
              <input
                id="rootEntity"
                type="text"
                class="form-control font-monospace text-break"
                [(ngModel)]="rootEntity"
                placeholder="Enter root txid or address..."
              />
            </div>
            <div class="col-md-2">
              <label class="form-label small text-muted" for="hopsSelect">Max Hops</label>
              <select id="hopsSelect" class="form-select" [(ngModel)]="hops">
                <option [ngValue]="1">1 Hop</option>
                <option [ngValue]="2">2 Hops</option>
                <option [ngValue]="3">3 Hops</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small text-muted" for="directionSelect">Direction</label>
              <select id="directionSelect" class="form-select" [(ngModel)]="direction">
                <option value="both">Both</option>
                <option value="upstream">Upstream (Inputs)</option>
                <option value="downstream">Downstream (Spends)</option>
              </select>
            </div>
            <div class="col-md-2 d-flex align-items-end">
              <button
                type="button"
                class="btn btn-primary w-100"
                [disabled]="loading || !rootEntity.trim()"
                (click)="runQuery()"
              >
                {{ loading ? 'Expanding...' : 'Expand Graph' }}
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
        Enter a transaction ID or address above, or click "Load Sample Txid" to explore multi-hop payment relationships.
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
              <div><span class="text-muted small">Nodes:</span> <strong>{{ activeResult.nodes?.length || 0 }}</strong></div>
              <div><span class="text-muted small">Edges:</span> <strong>{{ activeResult.edges?.length || 0 }}</strong></div>
            </div>
          </div>
          <div class="card-body">
            <!-- Nodes Table -->
            <h5 class="mb-3">Discovered Graph Nodes</h5>
            <div class="table-responsive mb-4">
              <table class="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Entity Identifier</th>
                    <th>Type</th>
                    <th>Depth</th>
                    <th>Value Transferred</th>
                    <th>Confirmation</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let node of activeResult.nodes">
                    <td class="font-monospace text-break">{{ node.id }}</td>
                    <td><span class="badge badge-secondary">{{ node.type }}</span></td>
                    <td>Hop {{ node.depth }}</td>
                    <td>{{ node.value_sats | number }} sats</td>
                    <td><span class="badge badge-success">{{ node.status }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Value Edges Table -->
            <h5 class="mb-3">Value Transfer Edges</h5>
            <div class="table-responsive">
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

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Zero auto-execution on load
  }

  loadSampleTxid(): void {
    this.rootEntity = 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f';
    this.runQuery();
  }

  runQuery(): void {
    if (!this.rootEntity.trim()) return;
    this.loading = true;
    this.queryError = null;
    this.cdr.markForCheck();

    this.sub?.unsubscribe();
    this.sub = this.api.queryGraph$(this.rootEntity.trim(), this.hops, this.direction).subscribe({
      next: (res) => {
        this.activeResult = res;
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

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
