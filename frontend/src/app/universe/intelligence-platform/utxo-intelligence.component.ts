import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-utxo-intelligence',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>UTXO Set and Supply Intelligence</h1>
          <span class="badge badge-success">Reconciled at Block {{ overview?.block_height }}</span>
        </div>
        <p class="subtitle">
          Incremental model of the entire Bitcoin unspent transaction output set with exact integer satoshi accounting, script cohorts, and economic dust boundaries.
        </p>
      </header>

      <!-- Overview Cards -->
      <section *ngIf="overview" class="row g-3 mb-4">
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Total UTXOs</div>
            <div class="h3 my-1 text-primary">{{ overview.total_utxos | number }}</div>
            <div class="small text-muted">Active unspent outputs</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Total Circulating Supply</div>
            <div class="h3 my-1 text-success">{{ (overview.total_amount_sats / 100000000).toFixed(4) }} BTC</div>
            <div class="small text-muted">{{ overview.total_amount_sats | number }} sats</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Dormant > 10 Years</div>
            <div class="h3 my-1 text-warning">{{ (overview.dormant_10yr_sats / 100000000).toFixed(2) }} BTC</div>
            <div class="small text-muted">Unmoved since 2016</div>
          </div>
        </div>
        <div class="col-md-3 col-6">
          <div class="card p-3 bg-dark-subtle">
            <div class="text-muted small">Uneconomical at 10 sat/vB</div>
            <div class="h3 my-1 text-danger">{{ (overview.uneconomical_at_10_sat_vb_sats / 100000000).toFixed(2) }} BTC</div>
            <div class="small text-muted">Spend cost exceeds value</div>
          </div>
        </div>
      </section>

      <!-- Script Type Cohorts -->
      <section class="card mb-4" *ngIf="cohorts">
        <div class="card-header">
          <h4 class="mb-0">Supply Distribution by Script Type</h4>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Script Type</th>
                <th>UTXO Count</th>
                <th>Total Satoshis</th>
                <th>Total BTC</th>
                <th>Supply Share</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of cohorts.script_types">
                <td class="fw-bold text-uppercase">{{ s.script_type }}</td>
                <td>{{ s.utxo_count | number }}</td>
                <td class="font-monospace">{{ s.total_sats | number }} sats</td>
                <td>{{ (s.total_sats / 100000000).toFixed(4) }} BTC</td>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    <div class="progress flex-grow-1" style="height: 6px;">
                      <div class="progress-bar bg-primary" [style.width.%]="s.percent_of_supply"></div>
                    </div>
                    <span class="small text-muted">{{ s.percent_of_supply }}%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Economic Thresholds -->
      <section class="card mb-4" *ngIf="thresholds.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Economically Unspendable Outputs Across Feerates</h4>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Prevailing Feerate</th>
                <th>Uneconomical Outputs</th>
                <th>Locked Satoshis</th>
                <th>Locked BTC</th>
                <th>Share of Total UTXOs</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let t of thresholds">
                <td class="fw-bold">{{ t.feerate_sats_vb }} sat/vB</td>
                <td>{{ t.uneconomical_utxo_count | number }}</td>
                <td class="font-monospace">{{ t.uneconomical_sats | number }} sats</td>
                <td>{{ (t.uneconomical_sats / 100000000).toFixed(4) }} BTC</td>
                <td>
                  <span class="badge" [ngClass]="t.percent_of_utxos > 10 ? 'badge-danger' : 'badge-warning'">
                    {{ t.percent_of_utxos }}% of UTXOs
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-warning { background-color: #ffc107; color: #000; }
    .badge-danger { background-color: #dc3545; color: #fff; }
  `],
})
export class UtxoIntelligenceComponent implements OnInit {
  overview: any = null;
  cohorts: any = null;
  thresholds: any[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getUtxoOverview$().subscribe((res) => {
      this.overview = res;
      this.cdr.markForCheck();
    });

    this.api.getUtxoCohorts$().subscribe((res) => {
      this.cohorts = res;
      this.cdr.markForCheck();
    });

    this.api.getUtxoThresholds$().subscribe((res) => {
      this.thresholds = res?.thresholds || [];
      this.cdr.markForCheck();
    });
  }
}
