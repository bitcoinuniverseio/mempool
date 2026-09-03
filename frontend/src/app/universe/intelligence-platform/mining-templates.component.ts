import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-mining-templates',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Mining Template and Inclusion Observatory</h1>
          <span class="badge badge-success">3 Template Sources Active</span>
        </div>
        <p class="subtitle">
          Real-time candidate block templates captured across Bitcoin Core GBT, Stratum V2, and DATUM endpoints with objective divergence analytics.
        </p>
      </header>

      <!-- Sources Status Grid -->
      <section *ngIf="overview" class="row g-3 mb-4">
        <div *ngFor="let source of overview.sources" class="col-md-4">
          <div class="card p-3 bg-dark-subtle">
            <div class="d-flex justify-content-between">
              <span class="badge badge-primary">{{ source.source_type | uppercase }}</span>
              <span class="badge badge-success">{{ source.status | uppercase }}</span>
            </div>
            <h5 class="mt-2 mb-1">{{ source.name }}</h5>
            <div class="small text-muted font-monospace">{{ source.endpoint }}</div>
            <div class="small text-muted mt-2">{{ source.software_version }}</div>
          </div>
        </div>
      </section>

      <!-- Candidate Templates -->
      <section class="card mb-4" *ngIf="overview && overview.latest_templates">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h4 class="mb-0">Candidate Block Templates at Tip</h4>
          <button class="btn btn-sm btn-primary" (click)="compareActiveTemplates()">Diff Selected Templates</button>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Template ID</th>
                <th>Source</th>
                <th>Height</th>
                <th>Transactions</th>
                <th>Weight</th>
                <th>Fees</th>
                <th>Deterministic Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let tmpl of overview.latest_templates">
                <td class="font-monospace fw-bold">{{ tmpl.template_id }}</td>
                <td>{{ tmpl.source_name }}</td>
                <td>{{ tmpl.height }}</td>
                <td>{{ tmpl.tx_count | number }}</td>
                <td>{{ (tmpl.total_weight / 4000000 * 100).toFixed(1) }}%</td>
                <td>{{ (tmpl.total_fees_sats / 100000000).toFixed(4) }} BTC</td>
                <td class="font-monospace small text-muted">{{ tmpl.fingerprint_hash | slice:0:16 }}...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Template Diff View -->
      <section class="card mb-4" *ngIf="activeDiff">
        <div class="card-header">
          <h4 class="mb-0">Template Divergence Analysis</h4>
        </div>
        <div class="card-body">
          <div class="row text-center g-3 mb-3">
            <div class="col-md-4">
              <div class="p-3 rounded bg-dark-subtle">
                <div class="small text-muted">Similarity Score</div>
                <div class="h3 my-1 text-primary">{{ (activeDiff.similarity_score * 100).toFixed(1) }}%</div>
                <div class="small text-muted">Set overlap</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="p-3 rounded bg-dark-subtle">
                <div class="small text-muted">Fee Differential</div>
                <div class="h3 my-1">{{ activeDiff.fee_delta_sats | number }} sats</div>
                <div class="small text-muted">Variance between sources</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="p-3 rounded bg-dark-subtle">
                <div class="small text-muted">Weight Differential</div>
                <div class="h3 my-1">{{ activeDiff.weight_delta | number }} WU</div>
                <div class="small text-muted">Block density variance</div>
              </div>
            </div>
          </div>
          <div class="alert alert-secondary mb-0">
            <strong>Observatory Finding:</strong> {{ activeDiff.explanation }}
          </div>
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
  `],
})
export class MiningTemplatesComponent implements OnInit {
  overview: any = null;
  activeDiff: any = null;

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getTemplateOverview$().subscribe((res) => {
      this.overview = res;
      this.compareActiveTemplates();
      this.cdr.markForCheck();
    });
  }

  compareActiveTemplates(): void {
    if (this.overview && this.overview.latest_templates && this.overview.latest_templates.length >= 2) {
      const tA = this.overview.latest_templates[0].template_id;
      const tB = this.overview.latest_templates[1].template_id;
      this.api.diffTemplates$(tA, tB).subscribe((diff) => {
        this.activeDiff = diff;
        this.cdr.markForCheck();
      });
    }
  }
}
