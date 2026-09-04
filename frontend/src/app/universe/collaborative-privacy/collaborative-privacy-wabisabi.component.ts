import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-collaborative-privacy-wabisabi',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">WabiSabi Protocol Intelligence</h1>
          <p class="text-muted mb-0">Arbitrary-amount CoinJoin protocol utilizing keyed-verification anonymous credentials (KVAC).</p>
        </div>
        <a routerLink="/privacy/collaborative" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-info">Anonymous Credentials (WSS)</h5>
            <p class="text-muted small">
              Participants deposit arbitrary input values and receive blinded credential tokens representing their balance.
              These tokens are redeemed during the output registration phase without revealing which input provided the balance.
            </p>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-info">Decomposition Optimization</h5>
            <p class="text-muted small">
              Outputs are decomposed into standardized denominations (powers of 2, 3, or standard values) to maximize the combinatorial
              entropy between participants, denying chain-analysis heuristics based on subset sum matching.
            </p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyWabisabiComponent {}
