import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OpenTimestampsApiService } from './opentimestamps.service';

@Component({
  selector: 'app-opentimestamps-stamp',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Create Bitcoin Timestamp Attestation</h1>
          <p class="text-muted mb-0">Hash any document locally in your browser and submit the cryptographic digest to public calendar servers.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Stamp SHA256 Digest</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Document SHA256 Hash</label>
              <input type="text" class="form-control bg-black text-light border-secondary font-monospace" placeholder="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" [(ngModel)]="digest">
            </div>

            <button class="btn btn-primary w-100" (click)="stamp()" [disabled]="stamping || !digest">
              {{ stamping ? 'Submitting to OTS Calendar Servers...' : 'Anchor Digest into Bitcoin' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="stampResult">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Timestamp Created</h5>
              <span class="badge bg-warning text-dark">PENDING BITCOIN BLOCK</span>
            </div>
            <p class="text-muted small">Your document digest was recorded by the following calendars and will be committed in the next Bitcoin block:</p>

            <ul class="list-group list-group-flush mb-3">
              <li *ngFor="let cal of stampResult.calendars_contacted" class="list-group-item bg-black text-light border-secondary small">
                ✓ {{ cal }}
              </li>
            </ul>

            <div class="mb-3">
              <div class="text-muted small text-uppercase">Raw .ots Proof Payload (Base64)</div>
              <textarea class="form-control bg-black text-info font-monospace small" rows="3" readonly>{{ stampResult.ots_proof_base64 }}</textarea>
            </div>

            <div class="small text-muted">Created: {{ stampResult.timestamp | date:'medium' }}</div>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!stampResult">
            <p class="text-muted mb-0">Enter a SHA256 digest to anchor your proof into Bitcoin.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsStampComponent {
  public digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  public stamping = false;
  public stampResult: any = null;

  constructor(private api: OpenTimestampsApiService) {}

  public stamp(): void {
    if (!this.digest) return;
    this.stamping = true;
    this.api.stampDigest$(this.digest).subscribe(res => {
      this.stampResult = res;
      this.stamping = false;
    });
  }
}
