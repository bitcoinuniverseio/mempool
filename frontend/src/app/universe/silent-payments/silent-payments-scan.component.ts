import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subject, Subscription, takeUntil } from 'rxjs';
import { scanSilentBundle, verifySilentBundle, SilentPaymentMatch, validateSilentScanInputs } from './silent-payments-scanner';
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
          <span class="badge bg-success">Client-Side Receiver Scan</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Perform client-side BIP352 received-output detection using public block bundles. Your private scan capability is used only in this page. Only a spend public key is needed.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="api.path('/payments/silent')">Overview</a>
          <a class="nav-link active" [routerLink]="api.path('/payments/silent/scan')">In-Browser Scanner</a>
          <a class="nav-link" [routerLink]="api.path('/payments/silent/address')">Address Validator</a>
          <a class="nav-link" [routerLink]="api.path('/payments/silent/psbt')">PSBT Inspector</a>
          <a class="nav-link" [routerLink]="api.path('/payments/silent/coverage')">Indexing Coverage</a>
        </nav>
      </header>

      <p class="small text-muted">Finds received outputs; it does not determine whether they remain unspent. Range limit: 144 indexed blocks.</p>
      <!-- Scan Input Parameters -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Scanner Keys & Block Range</h2>
        <form (ngSubmit)="startScan()" #scanForm="ngForm">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label for="scanKey" class="form-label small text-muted">Private Scan Capability (32-byte hex)</label>
              <input
                id="scanKey"
                type="password"
                class="form-control font-monospace"
                placeholder="Private scan key, never a seed or spend key"
                [(ngModel)]="scanKey" autocomplete="off" spellcheck="false" maxlength="64"
                name="scanKey"
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
                min="0"
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
                min="0"
                required
                [disabled]="isScanning"
              />
            </div>
          </div>

          <div class="mt-3"><label for="maxLabel">Highest wallet label (change label 0 is always checked)</label><input id="maxLabel" class="form-control" type="number" [(ngModel)]="maxLabel" name="maxLabel" min="0" max="100" [disabled]="isScanning"></div>
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4">
            <span class="text-muted small">
              Cryptographic tweak derivation executes entirely in your browser thread or Web Worker.
            </span>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-outline-secondary" (click)="cancelScan()">Cancel and clear scan key</button>
              <button
                type="submit"
                class="btn btn-primary px-4"
                [disabled]="isScanning || !scanKey || !spendPubkey"
              >
                <span *ngIf="isScanning" class="spinner-border spinner-border-sm me-1" role="status"></span>
                {{ isScanning ? 'Scanning Blocks...' : 'Start Scan' }}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div *ngIf="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div><div *ngIf="scanComplete && !detectedOutputs.length" class="alert alert-info">Scan completed with no matching outputs in the selected range.</div>
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
        <div class="table-responsive" tabindex="0">
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
    :host .text-muted, :host .form-control::placeholder {
      color: var(--u-text-muted, #a99cb5) !important;
      opacity: 1;
    }
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
export class SilentPaymentsScanComponent implements OnDestroy {
  private readonly cancelled = new Subject<void>();
  scanKey = '';
  maxLabel = 0;
  spendPubkey = '';
  startHeight: number | null = null;
  endHeight: number | null = null;
  isScanning = false;
  scanComplete = false;
  currentScanHeight = 0;
  scannedBlocksCount = 0;
  candidatesEvaluated = 0;
  scanPercentage = 0;
  errorMessage: string | null = null;
  detectedOutputs: SilentPaymentMatch[] = [];
  private epoch = 0;
  private networkSub: Subscription;
  constructor(public api: SilentPaymentsApiService, private cd: ChangeDetectorRef) {
    this.networkSub = api.networkChanges$.subscribe(() => {
      this.cancelScan(); this.detectedOutputs = []; this.scanComplete = false; this.cd.markForCheck();
    });
  }
  cancelScan(): void { this.epoch++; this.cancelled.next(); this.scanKey = ''; this.isScanning = false; this.detectedOutputs = []; this.scanComplete = false; }
  ngOnDestroy(): void { this.cancelScan(); this.networkSub.unsubscribe(); this.cancelled.complete(); }
  async startScan(): Promise<void> {
    const start = this.startHeight; const end = this.endHeight;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! < 0 || end! < start! || end! - start! >= 144) {
      this.scanKey = ''; this.errorMessage = 'Choose a valid range of at most 144 indexed blocks.'; return;
    }
    const epoch = ++this.epoch; const network = this.api.network;
    this.cancelled.next();
    const scanKey = this.scanKey; const spendKey = this.spendPubkey;
    this.isScanning = true; this.scanComplete = false; this.errorMessage = null;
    this.detectedOutputs = []; this.scannedBlocksCount = 0; this.candidatesEvaluated = 0; this.scanPercentage = 0;
    try {
      validateSilentScanInputs(scanKey, spendKey, this.maxLabel);
      let previousHash: string | undefined;
      for (let height = start!; height <= end!; height++) {
        const manifest = await firstValueFrom(this.api.getBlockManifest$(height).pipe(takeUntil(this.cancelled)));
        if (epoch !== this.epoch) return;
        const raw = await firstValueFrom(this.api.getBlockBundleBytes$(height).pipe(takeUntil(this.cancelled)));
        if (epoch !== this.epoch) return;
        const bundle = await verifySilentBundle(raw, manifest, network, height);
        if (previousHash && bundle.previous_block_hash !== previousHash) throw new Error('Chain changed during scanning. Restart the selected range.');
        const matches = await scanSilentBundle(bundle, scanKey, spendKey, this.maxLabel, () => epoch !== this.epoch);
        if (epoch !== this.epoch) return;
        this.detectedOutputs.push(...matches); this.currentScanHeight = height; this.scannedBlocksCount++;
        this.candidatesEvaluated += bundle.transactions.reduce((n, tx) => n + tx.candidate_outputs.length, 0);
        this.scanPercentage = this.scannedBlocksCount / (end! - start! + 1) * 100;
        previousHash = bundle.block_hash; this.cd.markForCheck();
      }
      // Confirm the final checkpoint still belongs to the source chain before reporting success.
      const finalManifest = await firstValueFrom(this.api.getBlockManifest$(end!).pipe(takeUntil(this.cancelled)));
      if (finalManifest.block_hash !== previousHash) throw new Error('Chain changed during scanning. Restart the selected range.');
      if (epoch === this.epoch) this.scanComplete = true;
    } catch (error: any) {
      if (epoch === this.epoch) { this.detectedOutputs = []; this.errorMessage = error?.error?.error || error?.message || 'Scan source is unavailable.'; }
    } finally {
      if (epoch === this.epoch) { this.scanKey = ''; this.isScanning = false; this.cd.markForCheck(); }
    }
  }
}
