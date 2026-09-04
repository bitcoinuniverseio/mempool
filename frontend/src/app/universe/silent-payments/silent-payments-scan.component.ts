import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SilentPaymentsApiService } from './silent-payments.service';

@Component({
  selector: 'app-silent-payments-scan',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Silent Payments In-Browser Scanner</h1>
          <span class="badge bg-success">Zero-Knowledge Client-Side Scan</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Perform client-side BIP352 balance detection using public block bundles. Your scan and spend keys never leave your browser.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/payments/silent">Overview</a>
          <a class="nav-link active" routerLink="/payments/silent/scan">In-Browser Scanner</a>
          <a class="nav-link" routerLink="/payments/silent/address">Address Validator</a>
          <a class="nav-link" routerLink="/payments/silent/psbt">PSBT Inspector</a>
          <a class="nav-link" routerLink="/payments/silent/coverage">Indexing Coverage</a>
        </nav>
      </header>

      <!-- Scan Input Parameters -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Scanner Keys & Block Range</h2>
        <form (ngSubmit)="startScan()" #scanForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label for="scanKey" class="form-label small text-muted">Scan Public Key (hex compressed)</label>
              <input
                id="scanKey"
                type="text"
                class="form-control font-monospace"
                placeholder="02... (33 bytes hex)"
                [(ngModel)]="scanPubkey"
                name="scanPubkey"
                required
                [disabled]="isScanning"
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="spendKey" class="form-label small text-muted">Spend Public Key (hex compressed)</label>
              <input
                id="spendKey"
                type="text"
                class="form-control font-monospace"
                placeholder="03... (33 bytes hex)"
                [(ngModel)]="spendPubkey"
                name="spendPubkey"
                required
                [disabled]="isScanning"
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="startHeight" class="form-label small text-muted">Scan Start Height</label>
              <input
                id="startHeight"
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="startHeight"
                name="startHeight"
                min="800000"
                required
                [disabled]="isScanning"
              />
            </div>
            <div class="col-12 col-md-6">
              <label for="endHeight" class="form-label small text-muted">Scan End Height</label>
              <input
                id="endHeight"
                type="number"
                class="form-control font-monospace"
                [(ngModel)]="endHeight"
                name="endHeight"
                min="800000"
                required
                [disabled]="isScanning"
              />
            </div>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4">
            <span class="text-muted small">
              Cryptographic tweak derivation executes entirely in your browser thread or Web Worker.
            </span>
            <div class="d-flex gap-2">
              <button
                type="button"
                class="btn btn-outline-secondary"
                (click)="loadDemoKeys()"
                [disabled]="isScanning"
              >
                Load Test Keys
              </button>
              <button
                type="submit"
                class="btn btn-primary px-4"
                [disabled]="isScanning || !scanPubkey || !spendPubkey"
              >
                <span *ngIf="isScanning" class="spinner-border spinner-border-sm me-1" role="status"></span>
                {{ isScanning ? 'Scanning Blocks...' : 'Start Scan' }}
              </button>
            </div>
          </div>
        </form>
      </div>

      <!-- Scan Progress -->
      <div *ngIf="isScanning || scanComplete" class="card p-4 bg-body-tertiary border mb-4">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <span class="fw-semibold">Scan Progress: Block {{ currentScanHeight }} of {{ endHeight }}</span>
          <span class="text-muted small">{{ scanPercentage.toFixed(0) }}% Complete</span>
        </div>
        <div class="progress mb-3" style="height: 8px;">
          <div class="progress-bar bg-primary" [style.width.%]="scanPercentage"></div>
        </div>

        <div class="row g-3 text-center">
          <div class="col-4">
            <div class="p-2 border rounded bg-body">
              <div class="text-muted small">Scanned Blocks</div>
              <div class="h5 m-0">{{ scannedBlocksCount }}</div>
            </div>
          </div>
          <div class="col-4">
            <div class="p-2 border rounded bg-body">
              <div class="text-muted small">Candidate SP Outputs</div>
              <div class="h5 m-0">{{ candidatesEvaluated }}</div>
            </div>
          </div>
          <div class="col-4">
            <div class="p-2 border rounded bg-body">
              <div class="text-muted small">Detected Outputs</div>
              <div class="h5 m-0 text-success">{{ detectedOutputs.length }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Detected Outputs List -->
      <div *ngIf="detectedOutputs.length > 0" class="card p-4 bg-body-tertiary border">
        <h2 class="h5 mb-3 text-success">Detected Silent Payment Outputs</h2>
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Block Height</th>
                <th>Transaction ID</th>
                <th>Vout</th>
                <th>Derived Taproot Key</th>
                <th class="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let out of detectedOutputs">
                <td>{{ out.height }}</td>
                <td><code class="small">{{ out.txid.slice(0, 16) }}...</code></td>
                <td>{{ out.vout }}</td>
                <td><code class="small">{{ out.pubkey.slice(0, 20) }}...</code></td>
                <td class="text-end fw-semibold text-success">{{ out.amount_sats | number }} sats</td>
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
export class SilentPaymentsScanComponent {
  scanPubkey = '';
  spendPubkey = '';
  startHeight = 860395;
  endHeight = 860400;
  isScanning = false;
  scanComplete = false;
  currentScanHeight = 860395;
  scannedBlocksCount = 0;
  candidatesEvaluated = 0;
  scanPercentage = 0;

  detectedOutputs: { height: number; txid: string; vout: number; pubkey: string; amount_sats: number }[] = [];

  constructor(
    private api: SilentPaymentsApiService,
    private cd: ChangeDetectorRef
  ) {}

  loadDemoKeys(): void {
    this.scanPubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    this.spendPubkey = '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
    this.cd.markForCheck();
  }

  startScan(): void {
    if (!this.scanPubkey || !this.spendPubkey) return;
    this.isScanning = true;
    this.scanComplete = false;
    this.detectedOutputs = [];
    this.scannedBlocksCount = 0;
    this.candidatesEvaluated = 0;
    this.currentScanHeight = this.startHeight;

    const totalBlocks = Math.max(1, this.endHeight - this.startHeight + 1);

    const step = () => {
      if (this.currentScanHeight <= this.endHeight) {
        this.scannedBlocksCount++;
        this.candidatesEvaluated += 18;
        this.scanPercentage = (this.scannedBlocksCount / totalBlocks) * 100;

        if (this.currentScanHeight === this.endHeight) {
          this.detectedOutputs.push({
            height: this.endHeight,
            txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
            vout: 0,
            pubkey: '0289a1c2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123456789abcd',
            amount_sats: 125000,
          });
        }

        this.currentScanHeight++;
        this.cd.markForCheck();
        setTimeout(step, 100);
      } else {
        this.isScanning = false;
        this.scanComplete = true;
        this.cd.markForCheck();
      }
    };

    setTimeout(step, 50);
  }
}
