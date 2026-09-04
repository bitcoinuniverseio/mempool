import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CollaborativePrivacyApiService } from './collaborative-privacy.service';

@Component({
  selector: 'app-collaborative-privacy-round-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="round">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Round Audit: <span class="text-info font-monospace">{{ round.round_id }}</span></h1>
          <p class="text-muted mb-0">{{ round.protocol }} coordinated by {{ round.coordinator }}</p>
        </div>
        <a routerLink="/privacy/collaborative" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Anonymity Set</div>
            <div class="display-6 fw-bold text-success my-1">{{ round.anonymity_set }}</div>
            <div class="small text-muted">Equal output combinations</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Entropy</div>
            <div class="display-6 fw-bold text-info my-1">{{ round.entropy_bits }} bits</div>
            <div class="small text-muted">Shannon / Boltzman metric</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Volume Mixed</div>
            <div class="display-6 fw-bold text-light my-1">{{ round.total_btc }} BTC</div>
            <div class="small text-muted">Total round liquidity</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Participants</div>
            <div class="display-6 fw-bold text-primary my-1">{{ round.inputs_count }} / {{ round.outputs_count }}</div>
            <div class="small text-muted">Inputs vs Outputs</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">On-Chain Transaction Details</h5>
        </div>
        <div class="card-body">
          <dl class="row mb-0">
            <dt class="col-sm-3 text-muted">Confirmed Block</dt>
            <dd class="col-sm-9 fw-bold">{{ round.block_height }}</dd>

            <dt class="col-sm-3 text-muted">Transaction ID</dt>
            <dd class="col-sm-9 font-monospace text-break text-info">{{ round.txid }}</dd>

            <dt class="col-sm-3 text-muted">Mining Feerate</dt>
            <dd class="col-sm-9 text-warning font-monospace">{{ round.fee_rate_sat_vb }} sat/vB</dd>

            <dt class="col-sm-3 text-muted">Round Timestamp</dt>
            <dd class="col-sm-9 text-muted font-monospace">{{ round.timestamp }}</dd>
          </dl>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyRoundDetailComponent implements OnInit {
  public round: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: CollaborativePrivacyApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const roundId = params.get('roundId') || 'rnd-ws-864198-01';
      this.api.getRound$(roundId).subscribe(res => {
        this.round = res;
      });
    });
  }
}
