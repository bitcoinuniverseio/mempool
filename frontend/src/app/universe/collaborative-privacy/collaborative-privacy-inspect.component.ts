import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CollaborativePrivacyApiService } from './collaborative-privacy.service';

@Component({
  selector: 'app-collaborative-privacy-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Inspect Collaborative Transaction</h1>
          <p class="text-muted mb-0">Compute Boltzman entropy, detect common-input-ownership violations, and identify equal-output denominations.</p>
        </div>
        <a routerLink="/privacy/collaborative" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-5">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Analyze Transaction</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Transaction ID or Hex</label>
              <input type="text" class="form-control bg-black text-light border-secondary font-monospace" placeholder="1a2b3c4d..." [(ngModel)]="txid">
            </div>
            <button class="btn btn-primary w-100" (click)="inspect()" [disabled]="inspecting || !txid">
              {{ inspecting ? 'Calculating Boltzmann Entropy...' : 'Inspect Privacy Metrics' }}
            </button>
          </div>
        </div>

        <div class="col-lg-7">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="analysisResult">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Analysis Complete</h5>
              <span class="badge bg-primary">{{ analysisResult.protocol }}</span>
            </div>

            <div class="row g-3 mb-4">
              <div class="col-md-6">
                <div class="p-3 bg-black rounded border border-secondary">
                  <div class="text-muted small text-uppercase">Entropy Score</div>
                  <div class="display-6 fw-bold text-success my-1">{{ analysisResult.entropy_score }} bits</div>
                  <div class="small text-muted">High cryptographic uncertainty</div>
                </div>
              </div>
              <div class="col-md-6">
                <div class="p-3 bg-black rounded border border-secondary">
                  <div class="text-muted small text-uppercase">Equal Output Clusters</div>
                  <div class="display-6 fw-bold text-info my-1">{{ analysisResult.equal_output_clusters }}</div>
                  <div class="small text-muted">Uniform denomination sets</div>
                </div>
              </div>
            </div>

            <div class="alert alert-success bg-dark border-success mb-0" *ngIf="analysisResult.deanonymization_vulnerabilities.length === 0">
              No deanonymization heuristics or change-linking address reuse detected.
            </div>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!analysisResult">
            <p class="text-muted mb-0">Enter a transaction identifier to calculate entropy and output clustering.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CollaborativePrivacyInspectComponent {
  public txid = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b';
  public inspecting = false;
  public analysisResult: any = null;

  constructor(private api: CollaborativePrivacyApiService) {}

  public inspect(): void {
    if (!this.txid) return;
    this.inspecting = true;
    this.api.verifyPublicPackage$({ txid: this.txid }).subscribe(res => {
      this.analysisResult = res;
      this.inspecting = false;
    });
  }
}
