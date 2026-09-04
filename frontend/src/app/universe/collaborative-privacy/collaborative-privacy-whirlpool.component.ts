import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-collaborative-privacy-whirlpool',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Whirlpool Fixed-Denomination Cycles</h1>
          <p class="text-muted mb-0">Deterministic fixed-pool CoinJoin protocol with continuous free remixing and mathematical forward secrecy.</p>
        </div>
        <a routerLink="/privacy/collaborative" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-warning">5x5 Cyclical Mixing</h5>
            <p class="text-muted small">
              Each round matches 2 new entrants with 3 remixers who pay zero coordinator fees to mix again.
              The prospective and retrospective anonymity set scales exponentially with each successive mixing cycle.
            </p>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-warning">Fixed Denomination Pools</h5>
            <p class="text-muted small">
              Pools operate strictly at 0.001 BTC, 0.01 BTC, 0.05 BTC, and 0.5 BTC denominations.
              Identical outputs eliminate amount-based clustering entirely.
            </p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyWhirlpoolComponent {}
