import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { ConsensusConformanceApiService } from './consensus-conformance.service';

@Component({
  selector: 'app-consensus-conformance-case-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="caseRecord">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Divergence Case: <span class="text-info">{{ caseRecord.case_id }}</span></h1>
          <p class="text-muted mb-0">{{ caseRecord.title }} ({{ caseRecord.bip_reference }})</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-danger btn-sm" (click)="replayCase()" [disabled]="replaying">
            {{ replaying ? 'Replaying in Isolated Sandboxes...' : 'Replay Differential Execution' }}
          </button>
          <a routerLink="/labs/consensus/cases" class="btn btn-outline-secondary btn-sm">Back to Catalog</a>
        </div>
      </div>

      <div class="alert alert-warning bg-dark border-warning mb-4" *ngIf="replayResult">
        <strong>Replay Complete:</strong> Divergence successfully reproduced across {{ caseRecord.results.length }} sandboxed engines.
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Multi-Engine Execution Results</h5>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Multi-Engine Execution Results, scroll horizontally" i18n-aria-label>
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Engine Implementation</th>
                <th>Validation Result</th>
                <th>Exit Code</th>
                <th>Execution Latency</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of caseRecord.results">
                <td class="fw-bold">{{ r.impl }}</td>
                <td>
                  <span class="badge" [ngClass]="r.outcome === 'VALID' ? 'bg-success' : 'bg-danger'">
                    {{ r.outcome }}
                  </span>
                </td>
                <td class="font-monospace">{{ r.exit_code }}</td>
                <td class="text-muted font-monospace">{{ r.execution_ms }} ms</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Test Vector Payload</h5>
        </div>
        <div class="card-body">
          <label class="form-label text-muted small text-uppercase" for="consensus-case-raw-transaction">Raw Transaction Hex</label>
          <textarea class="form-control bg-black text-light font-monospace small" id="consensus-case-raw-transaction" rows="4" readonly>{{ caseRecord.raw_tx }}</textarea>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceCaseDetailComponent implements OnInit {
  public caseRecord: any = null;
  public replaying = false;
  public replayResult: any = null;

  public loadError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: ConsensusConformanceApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const caseId = params.get('caseId');
      if (!caseId) {
        // An earlier revision substituted a fixed id here, so the page
        // reported on that case whatever address opened it.
        this.loadError = $localize`:@@conformance.case.missing:This address does not name a case.`;
        return;
      }
      this.api.getCase$(caseId).subscribe({
        next: res => {
          this.caseRecord = res;
          this.loadError = null;
        },
        error: err => {
          this.caseRecord = null;
          this.loadError = loadFailureMessage(classifyLoadFailure(err));
        },
      });
    });
  }

  public replayCase(): void {
    if (!this.caseRecord) return;
    this.replaying = true;
    this.api.replayCase$(this.caseRecord.case_id).subscribe({
      next: res => {
        this.replayResult = res;
        this.replaying = false;
        this.loadError = null;
      },
      error: err => {
        this.replayResult = null;
        this.replaying = false;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }
}
