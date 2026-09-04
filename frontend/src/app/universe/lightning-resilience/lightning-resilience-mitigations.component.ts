import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LightningResilienceApiService } from './lightning-resilience.service';

@Component({
  selector: 'app-lightning-resilience-mitigations',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Lightning Anti-Jamming & Defense Mitigations</h1>
          <p class="text-muted mb-0">Standardized protocol defenses, fee policies, and reputation-based slot isolation specifications.</p>
        </div>
        <a routerLink="/lightning/resilience" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Active Defense Strategies</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Mitigation ID</th>
                <th>Strategy Name</th>
                <th>Layer</th>
                <th>Status</th>
                <th>Impact Score</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let m of mitigations">
                <td class="font-monospace text-muted">{{ m.mitigation_id }}</td>
                <td class="fw-bold text-info">{{ m.name }}</td>
                <td><span class="badge bg-secondary">{{ m.layer }}</span></td>
                <td><span class="badge bg-success">{{ m.status }}</span></td>
                <td><span class="badge bg-primary">{{ m.impact_score }}</span></td>
                <td class="small text-muted">{{ m.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="row g-4">
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-light">Unconditional Fast Lane & Endorsement</h5>
            <p class="text-muted small">
              Payments endorsed by upstream routing nodes with accumulated economic reputation are placed into a reserved 80% slot bucket.
              Unendorsed or new peer payments compete exclusively within a capped 20% bucket, guaranteeing that jamming attempts cannot starve
              legitimate network transactions.
            </p>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card bg-dark border-secondary p-4 h-100">
            <h5 class="card-title text-light">Upfront & Resolution Fees</h5>
            <p class="text-muted small">
              Nodes assess micro-fees for routing attempts that linger in hold states without timely settlement.
              By shifting the opportunity cost back to the upstream forwarder, holding liquidity hostage becomes economically prohibitive for attackers.
            </p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class LightningResilienceMitigationsComponent implements OnInit {
  public mitigations: any[] = [];

  constructor(private api: LightningResilienceApiService) {}

  public ngOnInit(): void {
    this.api.getMitigations$().subscribe(res => {
      this.mitigations = res;
    });
  }
}
