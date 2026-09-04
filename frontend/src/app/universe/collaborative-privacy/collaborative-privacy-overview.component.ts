import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CollaborativePrivacyApiService, CollaborativeOverview } from './collaborative-privacy.service';

@Component({
  selector: 'app-collaborative-privacy-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Collaborative Transaction & CoinJoin Verification Center</h1>
          <p class="text-muted mb-0">Cross-protocol privacy telemetry, anonymity set calculation, coordinator auditing, and fidelity bond tracking.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/privacy/collaborative/inspect" class="btn btn-primary btn-sm">Inspect Transaction</a>
          <a routerLink="/privacy/collaborative/coordinators" class="btn btn-outline-primary btn-sm">Coordinator Registry</a>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/privacy/collaborative">Overview</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/privacy/collaborative/inspect">Inspect Transaction</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/privacy/collaborative/wabisabi">WabiSabi</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/privacy/collaborative/joinmarket">JoinMarket</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/privacy/collaborative/whirlpool">Whirlpool</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/privacy/collaborative/coordinators">Coordinators</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/privacy/collaborative/fidelity-bonds">Fidelity Bonds</a>
        </li>
      </ul>

      <!-- Metric Cards -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Collaborative Txs (24h)</div>
            <div class="display-6 fw-bold text-info my-1">{{ overview.total_collaborative_txs_24h }}</div>
            <div class="small text-muted">Across all CoinJoin protocols</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Volume (24h)</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.total_volume_btc_24h | number:'1.1-1' }} BTC</div>
            <div class="small text-muted">Total mixed liquidity</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Avg Anonymity Set</div>
            <div class="display-6 fw-bold text-warning my-1">{{ overview.average_anonymity_set }}</div>
            <div class="small text-muted">Plausible equal output sets</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Active Fidelity Bonds</div>
            <div class="display-6 fw-bold text-primary my-1">{{ overview.active_fidelity_bonds_btc | number:'1.0-0' }} BTC</div>
            <div class="small text-muted">Time-locked Sybil resistance</div>
          </div>
        </div>
      </div>

      <!-- Recent Rounds -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary d-flex justify-content-between align-items-center">
          <h5 class="card-title mb-0">Recent CoinJoin & Collaborative Transactions</h5>
          <span class="badge bg-secondary">{{ overview.recent_rounds.length }} Rounds</span>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Round ID</th>
                <th>Protocol</th>
                <th>Coordinator</th>
                <th>Inputs / Outputs</th>
                <th>Anonymity Set</th>
                <th>Total BTC</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let r of overview.recent_rounds">
                <td class="font-monospace text-muted">{{ r.round_id }}</td>
                <td><span class="badge bg-primary">{{ r.protocol }}</span></td>
                <td>{{ r.coordinator }}</td>
                <td>{{ r.inputs_count }} in / {{ r.outputs_count }} out</td>
                <td><span class="badge bg-success">{{ r.anonymity_set }} anonset</span></td>
                <td class="fw-bold">{{ r.total_btc }} BTC</td>
                <td>
                  <a [routerLink]="['/privacy/collaborative/round', r.round_id]" class="btn btn-sm btn-outline-info">Audit Round</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyOverviewComponent implements OnInit {
  public overview: CollaborativeOverview | null = null;

  constructor(private api: CollaborativePrivacyApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
