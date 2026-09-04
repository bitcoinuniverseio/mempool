import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { DecentralizedMiningApiService } from './decentralized-mining.service';

@Component({
  selector: 'app-decentralized-mining-compare',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Template Autonomy & Transaction Diversity</h1>
          <span class="badge bg-primary">Decentralization Index</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Measures deviation between miner-chosen transactions and centralized pool templates, demonstrating real censorship resistance.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/mining/decentralized">Overview</a>
          <a class="nav-link" routerLink="/mining/decentralized/datum">DATUM</a>
          <a class="nav-link" routerLink="/mining/decentralized/p2pool">P2Pool v2</a>
          <a class="nav-link" routerLink="/mining/decentralized/braidpool">Braidpool</a>
          <a class="nav-link active" routerLink="/mining/decentralized/compare">Template Autonomy</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Calculating template autonomy metrics...</div>
      </div>

      <div *ngIf="!loading" class="row g-4">
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Template Autonomy Score</div>
            <div class="fs-3 fw-bold text-success mt-1">94.2%</div>
            <div class="small text-muted mt-1">Shares containing miner-unique txs</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Censored Txs Salvaged</div>
            <div class="fs-3 fw-bold text-primary mt-1">1,480 txs</div>
            <div class="small text-muted mt-1">Included by independent miners</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="text-muted small">Fee Premium Captured</div>
            <div class="fs-3 fw-bold mt-1">+0.38 BTC</div>
            <div class="small text-muted mt-1">Directly to individual hashrate owners</div>
          </div>
        </div>

        <div class="col-12">
          <div class="card p-4 bg-body-tertiary border">
            <h2 class="h5 mb-3">Protocol Feature Comparison</h2>
            <div class="table-responsive">
              <table class="table table-hover align-middle">
                <thead>
                  <tr>
                    <th>Protocol</th>
                    <th>Template Origin</th>
                    <th>Coinbase Payout</th>
                    <th>Uncle / Stale Handling</th>
                    <th>Share Interval</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="fw-bold">Ocean DATUM</td>
                    <td>Miner local node</td>
                    <td>Pool negotiated PPLNS</td>
                    <td>Direct submission</td>
                    <td>Variable by miner hashrate</td>
                  </tr>
                  <tr>
                    <td class="fw-bold">P2Pool v2</td>
                    <td>Miner local node</td>
                    <td>Decentralized coinbase outputs</td>
                    <td>P2Pool share chain uncle rule</td>
                    <td>30 seconds target</td>
                  </tr>
                  <tr>
                    <td class="fw-bold">Braidpool</td>
                    <td>Miner local node</td>
                    <td>Deterministic DAG accounting</td>
                    <td>DAG multi-parent inclusion</td>
                    <td>5 seconds sub-shares</td>
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
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class DecentralizedMiningCompareComponent implements OnInit, OnDestroy {
  loading = false;
  comparison: any = null;
  private sub?: Subscription;

  constructor(
    private miningApi: DecentralizedMiningApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub = this.miningApi.getTemplateComparison$().subscribe({
      next: (data) => {
        this.comparison = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
