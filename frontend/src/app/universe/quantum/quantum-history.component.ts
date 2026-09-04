import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { QuantumApiService, QuantumRevealEvent } from './quantum.service';

@Component({
  selector: 'app-quantum-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Public Key Reveal Timeline</h1>
          <span class="badge bg-secondary" *ngIf="events.length > 0">
            {{ events.length }} Recent Reveal Events
          </span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          On-chain provenance log of transactions that revealed previously protected public keys, exposing related address-reuse UTXOs.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/intelligence/quantum">Overview</a>
          <a class="nav-link" routerLink="/intelligence/quantum/exposure">Script Cohorts</a>
          <a class="nav-link active" routerLink="/intelligence/quantum/history">Reveal Timeline</a>
          <a class="nav-link" routerLink="/intelligence/quantum/audit">Local Public Audit</a>
          <a class="nav-link" routerLink="/intelligence/quantum/migration">Migration Planner</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading public key reveal provenance log...</div>
      </div>

      <div *ngIf="error" class="alert alert-danger my-3">
        {{ error }}
      </div>

      <div *ngIf="!loading && events.length > 0" class="card bg-body-tertiary border">
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Block Height</th>
                <th>Revealing Transaction</th>
                <th>Revealed Public Key</th>
                <th>Affected Outpoints</th>
                <th class="text-end">Exposed Sats</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let ev of events">
                <td class="fw-bold">{{ ev.block_height | number }}</td>
                <td><code class="small">{{ ev.txid.slice(0, 16) }}...</code></td>
                <td><code class="small">{{ ev.pubkey.slice(0, 16) }}...{{ ev.pubkey.slice(-8) }}</code></td>
                <td><span class="badge bg-warning text-dark">{{ ev.affected_outpoints_count }} UTXOs exposed</span></td>
                <td class="text-end fw-semibold">{{ (ev.revealed_sats / 100000000).toFixed(4) }} BTC</td>
              </tr>
            </tbody>
          </table>
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
export class QuantumHistoryComponent implements OnInit, OnDestroy {
  events: QuantumRevealEvent[] = [];
  loading = true;
  error: string | null = null;
  private sub = new Subscription();

  constructor(
    private api: QuantumApiService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.sub.add(
      this.api.getHistory$().subscribe({
        next: data => {
          this.events = data;
          this.loading = false;
          this.cd.markForCheck();
        },
        error: err => {
          this.error = err?.message || 'Failed to load reveal events';
          this.loading = false;
          this.cd.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
