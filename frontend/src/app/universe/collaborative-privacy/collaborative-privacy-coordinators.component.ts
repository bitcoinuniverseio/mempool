import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { CollaborativePrivacyApiService } from './collaborative-privacy.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-collaborative-privacy-coordinators',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">CoinJoin Coordinator Registry</h1>
          <p class="text-muted mb-0">Audited coordinator endpoints, fee policies, onion services, and blacklist/whitelisting policies.</p>
        </div>
        <a [routerLink]="'/privacy/collaborative' | relativeUrl" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Active Coordinators</h5>
        </div>
        <div class="table-responsive" tabindex="0" role="region" aria-label="Active Coordinators, scroll horizontally" i18n-aria-label>
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Coordinator ID</th>
                <th>Name</th>
                <th>Protocol</th>
                <th>Fee Rate</th>
                <th>Endpoint</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of coordinators">
                <td class="font-monospace text-info">{{ c.coordinator_id }}</td>
                <td class="fw-bold">{{ c.name }}</td>
                <td><span class="badge bg-secondary">{{ c.protocol }}</span></td>
                <td class="text-warning">{{ c.fee_rate_pct }}%</td>
                <td class="font-monospace text-muted small">{{ c.onion_endpoint }}</td>
                <td><span class="badge bg-success">{{ c.status | uppercase }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyCoordinatorsComponent implements OnInit {
  public coordinators: any[] = [];

  public loadError: string | null = null;

  constructor(private api: CollaborativePrivacyApiService) {}

  public ngOnInit(): void {
    this.api.getCoordinators$().subscribe({
      next: res => {
        this.coordinators = res;
        this.loadError = null;
      },
      error: err => {
        this.coordinators = [];
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
      },
    });
  }
}
