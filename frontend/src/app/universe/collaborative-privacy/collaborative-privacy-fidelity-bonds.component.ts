import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CollaborativePrivacyApiService } from './collaborative-privacy.service';

@Component({
  selector: 'app-collaborative-privacy-fidelity-bonds',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">JoinMarket Fidelity Bonds Observatory</h1>
          <p class="text-muted mb-0">Timelocked capital sacrifice proofs providing Sybil resistance in decentralized CoinJoin orderbooks.</p>
        </div>
        <a routerLink="/privacy/collaborative" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Active Timelocked Fidelity Bonds</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Bond Identifier</th>
                <th>Maker Public Key</th>
                <th>Locked Amount</th>
                <th>Lock Expiry Block</th>
                <th>Fidelity Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let b of bonds">
                <td class="font-monospace text-info">{{ b.bond_id }}</td>
                <td class="font-monospace text-muted">{{ b.maker_pubkey }}</td>
                <td class="fw-bold text-success">{{ b.amount_btc | number:'1.2-2' }} BTC</td>
                <td class="fw-semibold">{{ b.lock_expiry_block }}</td>
                <td class="text-warning font-monospace">{{ b.fidelity_score | number }}</td>
                <td><span class="badge bg-success">{{ b.status | uppercase }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyFidelityBondsComponent implements OnInit {
  public bonds: any[] = [];

  constructor(private api: CollaborativePrivacyApiService) {}

  public ngOnInit(): void {
    this.api.getFidelityBonds$().subscribe(res => {
      this.bonds = res;
    });
  }
}
