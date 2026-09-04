import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PrivateSubmissionApiService } from './private-submission.service';

@Component({
  selector: 'app-private-submission-broadcast',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Direct Miner Private Broadcast</h1>
          <p class="text-muted mb-0">Direct encrypted injection to participating mining pools, bypassing public gossip relays to protect against MEV front-running.</p>
        </div>
        <a routerLink="/mempool/submission" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="row g-4">
        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-3">
            <h5 class="card-title mb-3">Submit Raw Transaction to Mining Pools</h5>
            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Raw Hex Transaction</label>
              <textarea class="form-control bg-black text-light border-secondary font-monospace" rows="6" placeholder="02000000000101..." [(ngModel)]="rawTxHex"></textarea>
            </div>

            <div class="mb-3">
              <label class="form-label text-muted small text-uppercase">Target Partner Pools</label>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="p1" checked>
                <label class="form-check-label" for="p1">Foundry USA (30.5% global hashrate)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="p2" checked>
                <label class="form-check-label" for="p2">AntPool (24.1% global hashrate)</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="checkbox" id="p3" checked>
                <label class="form-check-label" for="p3">F2Pool (12.3% global hashrate)</label>
              </div>
            </div>

            <button class="btn btn-success w-100" (click)="submitPrivate()" [disabled]="submitting || !rawTxHex">
              {{ submitting ? 'Transmitting to Partner Pools...' : 'Broadcast Directly to Miners' }}
            </button>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card bg-dark border-secondary p-4 h-100" *ngIf="broadcastReceipt">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="card-title text-success mb-0">Private Broadcast Successful</h5>
              <span class="badge bg-success">RELAYED</span>
            </div>
            <p class="text-muted small">Your transaction was directly relayed over encrypted endpoints to participating pools.</p>

            <div class="mb-3">
              <div class="text-muted small text-uppercase">Submission Token</div>
              <code class="p-2 bg-black rounded text-light d-block text-break">{{ broadcastReceipt.submission_token }}</code>
            </div>

            <div class="mb-3">
              <div class="text-muted small text-uppercase">Transaction ID</div>
              <code class="p-2 bg-black rounded text-info d-block text-break">{{ broadcastReceipt.txid }}</code>
            </div>

            <div class="alert alert-info bg-dark border-info small mb-0">
              Target Miners: {{ broadcastReceipt.target_miners.join(', ') }}
            </div>
          </div>

          <div class="card bg-dark border-secondary p-5 text-center h-100 d-flex justify-content-center" *ngIf="!broadcastReceipt">
            <p class="text-muted mb-0">Paste raw transaction hex to initiate direct miner submission.</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PrivateSubmissionBroadcastComponent {
  public rawTxHex = '';
  public submitting = false;
  public broadcastReceipt: any = null;

  constructor(private api: PrivateSubmissionApiService) {}

  public submitPrivate(): void {
    if (!this.rawTxHex) return;
    this.submitting = true;
    this.api.submitPrivate$({ raw_tx: this.rawTxHex }).subscribe(res => {
      this.broadcastReceipt = res;
      this.submitting = false;
    });
  }
}
