import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-collaborative-privacy-joinmarket',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">JoinMarket Decentralized Protocol</h1>
          <p class="text-muted mb-0">Decentralized market-maker protocol incentivizing CoinJoin liquidity via yield and fidelity bonds.</p>
        </div>
        <a routerLink="/privacy/collaborative" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-success">Maker / Taker Orderbook Model</h5>
            <p class="text-muted small">
              Takers pay a micro-yield fee to multiple makers who provide equal liquidity to form an on-the-fly collaborative transaction.
              No central server coordinates the transaction; coordination occurs over decentralized encrypted messaging channels.
            </p>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-success">Fidelity Bond Sybil Resistance</h5>
            <p class="text-muted small">
              Makers lock capital in timelocked UTXOs (OP_CHECKLOCKTIMEVERIFY).
              Higher sacrifice of liquidity over time yields higher routing priority, pricing out Sybil snooping attackers.
            </p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyJoinmarketComponent {}
