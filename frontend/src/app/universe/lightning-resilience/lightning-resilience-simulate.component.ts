import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LightningResilienceApiService } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-simulate',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Lightning Jamming Attack & Mitigation Simulator</h1>
          <p class="text-muted mb-0">Evaluate channel survival rates against slow-hold attacks, slot-exhaustion, and onion storms.</p>
        </div>
        <a routerLink="/lightning/resilience" class="btn btn-outline-secondary btn-sm">Back to Resilience Center</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Simulation Parameters</h5>

            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Attack Vector Scenario</label>
              <select class="form-select bg-black text-light border-secondary" [(ngModel)]="scenario">
                <option value="slot_exhaustion_dos">Slot Exhaustion (483 unendorsed dust HTLCs)</option>
                <option value="slow_hold_liquidity_pinning">Slow Hold Liquidity Pinning (Prolonged P95 Latency)</option>
                <option value="onion_message_storm">Onion Messaging Queue Flood (CPU / Memory DoS)</option>
                <option value="sybil_circuit_breaker_probe">Sybil Circuit Breaker Trip Probe</option>
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Attacker Capital / Slots</label>
              <input type="number" class="form-control bg-black text-light border-secondary" [(ngModel)]="attackerSlots" min="10" max="483">
            </div>

            <div class="mb-3">
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="reputationCheck" [(ngModel)]="enableReputation">
                <label class="form-check-label" for="reputationCheck">
                  Enable Upstream Endorsement & Reputation Tracking
                </label>
              </div>
              <div class="form-check mt-2">
                <input class="form-check-input" type="checkbox" id="fastLaneCheck" [(ngModel)]="enableFastLane">
                <label class="form-check-label" for="fastLaneCheck">
                  Reserve 20% Fast-Lane Slots for High-Reputation Routes
                </label>
              </div>
            </div>

            <button class="btn btn-primary w-100" (click)="runSimulation()" [disabled]="simulating">
              {{ simulating ? 'Simulating Dynamic Network...' : 'Run Resilience Simulation' }}
            </button>
          </div>
        </div>

        <div class="col-lg-7">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="simulationResult">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title mb-0">Simulation Results</h5>
              <span class="badge bg-success">COMPLETED</span>
            </div>

            <div class="row g-3 mb-4">
              <div class="col-md-6">
                <div class="p-3 bg-black rounded border border-secondary">
                  <div class="text-muted small text-uppercase">Baseline Route Survival</div>
                  <div class="display-6 fw-bold text-danger my-1">{{ simulationResult.baseline_survival_rate_pct }}%</div>
                  <div class="small text-muted">Survival under unmitigated attack</div>
                </div>
              </div>
              <div class="col-md-6">
                <div class="p-3 bg-black rounded border border-secondary">
                  <div class="text-muted small text-uppercase">Mitigated Route Survival</div>
                  <div class="display-6 fw-bold text-success my-1">{{ simulationResult.protected_survival_rate_pct }}%</div>
                  <div class="small text-muted">Survival with defensive policies enabled</div>
                </div>
              </div>
            </div>

            <h6 class="text-info mb-2">Automated Policy Recommendations:</h6>
            <ul class="list-group list-group-flush bg-transparent">
              <li *ngFor="let rec of simulationResult.recommended_actions" class="list-group-item bg-transparent text-light border-secondary px-0">
                <i class="bi bi-shield-check text-success me-2">✓</i> {{ rec }}
              </li>
            </ul>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!simulationResult">
            <p class="text-muted mb-0">Select attack parameters and click "Run Resilience Simulation" to observe outcome.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceSimulateComponent {
  public scenario = 'slot_exhaustion_dos';
  public attackerSlots = 350;
  public enableReputation = true;
  public enableFastLane = true;
  public simulating = false;
  public simulationResult: any = null;

  constructor(private api: LightningResilienceApiService) {}

  public runSimulation(): void {
    this.simulating = true;
    this.api.simulate$({
      scenario: this.scenario,
      attacker_slots: this.attackerSlots,
      enable_reputation: this.enableReputation,
      enable_fast_lane: this.enableFastLane,
    }).subscribe(res => {
      this.simulationResult = res;
      this.simulating = false;
    });
  }
}
