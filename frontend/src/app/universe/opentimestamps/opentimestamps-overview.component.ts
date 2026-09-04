import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { OpenTimestampsApiService, TimestampsOverview } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">OpenTimestamps & Bitcoin Proof-of-Publication Center</h1>
          <p class="text-muted mb-0">Decentralized document anchoring, cryptographic proof verification, calendar health, and Git commit attestation.</p>
        </div>
        <div class="btn-group">
          <a routerLink="/tools/timestamp/stamp" class="btn btn-primary btn-sm">Stamp New Document</a>
          <a routerLink="/tools/timestamp/verify" class="btn btn-outline-primary btn-sm">Verify Proof (.ots)</a>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs mb-4">
        <li class="nav-item">
          <a class="nav-link active" routerLink="/tools/timestamp">Overview</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/tools/timestamp/stamp">Create Timestamp</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/tools/timestamp/verify">Verify Proof</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/tools/timestamp/inspect">Inspect Op Codes</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/tools/timestamp/git">Git Commit Verification</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/intelligence/timestamps/calendars">Calendar Servers</a>
        </li>
        <li class="nav-item">
          <a class="nav-link" routerLink="/intelligence/timestamps/batches">Anchored Batches</a>
        </li>
      </ul>

      <!-- Metric Cards -->
      <div class="row g-3 mb-4" *ngIf="overview">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Tracked Proofs</div>
            <div class="display-6 fw-bold text-info my-1">{{ overview.total_proofs_tracked | number }}</div>
            <div class="small text-muted">Worldwide documents attested</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Bitcoin Confirmed</div>
            <div class="display-6 fw-bold text-success my-1">{{ overview.bitcoin_confirmed_proofs | number }}</div>
            <div class="small text-muted">Secured by proof-of-work</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Pending Calendar Leaves</div>
            <div class="display-6 fw-bold text-warning my-1">{{ overview.pending_calendar_attestations | number }}</div>
            <div class="small text-muted">Awaiting next Bitcoin block anchor</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Latest Anchor Block</div>
            <div class="display-6 fw-bold text-primary my-1">{{ overview.latest_anchored_block_height }}</div>
            <div class="small text-muted">Active Calendars: {{ overview.active_calendar_servers }}</div>
          </div>
        </div>
      </div>

      <!-- Recent Batches -->
      <div class="card bg-dark border-secondary mb-4" *ngIf="overview">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Recent Bitcoin Merkle Tree Anchors</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Block Height</th>
                <th>Leaf Count</th>
                <th>Merkle Root</th>
                <th>Calendar Server</th>
                <th>Anchored At</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let b of overview.recent_anchors">
                <td class="font-monospace text-info">{{ b.batch_id }}</td>
                <td class="fw-bold">{{ b.block_height }}</td>
                <td>{{ b.leaf_count | number }} hashes</td>
                <td class="font-monospace text-muted">{{ b.merkle_root | slice:0:16 }}...</td>
                <td class="small text-muted">{{ b.calendar_server }}</td>
                <td class="small">{{ b.anchored_at | date:'short' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsOverviewComponent implements OnInit {
  public overview: TimestampsOverview | null = null;

  constructor(private api: OpenTimestampsApiService) {}

  public ngOnInit(): void {
    this.api.getOverview$().subscribe(res => {
      this.overview = res;
    });
  }
}
