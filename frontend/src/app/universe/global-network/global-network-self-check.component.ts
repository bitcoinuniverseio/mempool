import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { GlobalNetworkApiService, GlobalNetworkSelfCheckResult } from './global-network.service';

@Component({
  selector: 'app-global-network-self-check',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Node Connectivity Self-Check Wizard</h1>
          <span class="badge bg-primary">SSRF-Defended P2P Probe</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Validate your Bitcoin node's inbound reachability, latency, and BIP324 encrypted transport readiness from distributed sensors.
        </p>

        <!-- Sub-navigation tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/global">Overview</a>
          <a class="nav-link" routerLink="/network/global/nodes">Reachable Nodes</a>
          <a class="nav-link" routerLink="/network/global/snapshots">Snapshots Archive</a>
          <a class="nav-link" routerLink="/network/global/seeds">DNS Seeds</a>
          <a class="nav-link active" routerLink="/network/global/self-check">Node Self-Check</a>
        </nav>
      </header>

      <!-- Probe Submission Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Initiate Live Diagnostic Probe</h2>
        <form (ngSubmit)="runSelfCheck()" #checkForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-8">
              <label for="endpointInput" class="form-label small text-muted">Public IP Address or Domain</label>
              <input
                id="endpointInput"
                type="text"
                class="form-control font-monospace"
                placeholder="e.g. 95.217.163.42"
                [(ngModel)]="endpointAddress"
                name="endpointAddress"
                required
                [disabled]="probing"
              />
            </div>
            <div class="col-12 col-md-4">
              <label for="portInput" class="form-label small text-muted">Bitcoin P2P Port</label>
              <input
                id="portInput"
                type="number"
                class="form-control font-monospace"
                placeholder="8333"
                [(ngModel)]="port"
                name="port"
                min="1"
                max="65535"
                required
                [disabled]="probing"
              />
            </div>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4">
            <span class="text-muted small">
              Private, link-local, loopback, and metadata network queries are blocked by strict SSRF filtering.
            </span>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="probing || !endpointAddress"
            >
              <span *ngIf="probing" class="spinner-border spinner-border-sm me-1" role="status"></span>
              {{ probing ? 'Probing Node...' : 'Run Self-Check' }}
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        <strong>Probe Error:</strong> {{ errorMessage }}
      </div>

      <!-- Diagnostic Results Card -->
      <div *ngIf="result" class="card p-4 bg-body-tertiary border">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success" *ngIf="result.reachable">&check; Node Reachable</h2>
          <h2 class="h5 m-0 text-danger" *ngIf="!result.reachable">&cross; Connection Refused</h2>
          <span class="text-muted small">Check ID: <code>{{ result.check_id }}</code></span>
        </div>

        <div class="row g-3">
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Probed Endpoint</div>
              <div class="fw-bold font-monospace">{{ result.endpoint_address }}:{{ result.port }}</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Sensor Region</div>
              <div class="fw-bold">{{ result.probed_from_region }}</div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">BIP324 v2 Handshake</div>
              <div class="fw-bold" [ngClass]="result.bip324_handshake ? 'text-success' : 'text-warning'">
                {{ result.bip324_handshake ? 'Passed (Encrypted)' : 'Not Advertised (v1 Only)' }}
              </div>
            </div>
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Handshake Latency</div>
              <div class="fw-bold text-primary">{{ result.latency_ms }} ms</div>
            </div>
          </div>
        </div>

        <div class="mt-3 p-3 border rounded bg-body" *ngIf="result.user_agent">
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted small">Reported User Agent</span>
            <code>{{ result.user_agent }}</code>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class GlobalNetworkSelfCheckComponent {
  endpointAddress = '';
  port = 8333;
  probing = false;
  errorMessage: string | null = null;
  result: GlobalNetworkSelfCheckResult | null = null;

  constructor(
    private api: GlobalNetworkApiService,
    private cd: ChangeDetectorRef
  ) {}

  runSelfCheck(): void {
    if (!this.endpointAddress) return;
    this.probing = true;
    this.errorMessage = null;
    this.result = null;

    this.api.performSelfCheck$(this.endpointAddress.trim(), this.port).subscribe({
      next: res => {
        this.result = res;
        this.probing = false;
        this.cd.markForCheck();
      },
      error: err => {
        this.errorMessage = err?.error?.error || err?.message || 'Failed to complete node self check';
        this.probing = false;
        this.cd.markForCheck();
      },
    });
  }
}
