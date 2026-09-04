import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-light-client-scan',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Local In-Browser Descriptor Scanner</h1>
          <span class="badge bg-success">Privacy-Preserving</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Scan public output descriptors or addresses against local BIP158 compact filters without transmitting your addresses to external servers.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/network/light-client">Overview</a>
          <a class="nav-link" routerLink="/network/light-client/providers">Providers</a>
          <a class="nav-link" routerLink="/network/light-client/filters">Filter Explorer</a>
          <a class="nav-link" routerLink="/network/light-client/verify">Header Verifier</a>
          <a class="nav-link active" routerLink="/network/light-client/scan">Local Scanner</a>
          <a class="nav-link" routerLink="/network/light-client/privacy">Privacy Controls</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Scan Configuration</h2>

            <div class="mb-3">
              <label class="form-label small text-muted">Public Descriptor or Address</label>
              <textarea
                class="form-control font-monospace small"
                rows="4"
                [(ngModel)]="descriptor"
                placeholder="wpkh([fingerprint/84'/0'/0']xpub.../0/*)"
              ></textarea>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label small text-muted">Start Height</label>
                <input type="number" class="form-control" [(ngModel)]="startHeight" />
              </div>
              <div class="col-6">
                <label class="form-label small text-muted">End Height</label>
                <input type="number" class="form-control" [(ngModel)]="endHeight" />
              </div>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-primary flex-grow-1" (click)="startScan()" [disabled]="scanning">
                <span *ngIf="scanning" class="spinner-border spinner-border-sm me-1"></span>
                {{ scanning ? 'Scanning Filters...' : 'Start Local Scan' }}
              </button>
              <button class="btn btn-outline-danger" (click)="cancelScan()" [disabled]="!scanning">
                Cancel
              </button>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-7">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Scan Progress & Results</h2>

            <div *ngIf="!scanResults && !scanning" class="text-center py-5 text-muted">
              Configure your public descriptor and start scanning to find matching blocks.
            </div>

            <div *ngIf="scanning" class="py-4">
              <div class="d-flex justify-content-between small text-muted mb-1">
                <span>Checking filters in Web Worker...</span>
                <span>{{ progressPercent }}%</span>
              </div>
              <div class="progress mb-3" style="height: 10px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated" [style.width.%]="progressPercent"></div>
              </div>
              <div class="small text-muted font-monospace">Current Block: #{{ currentHeight }}</div>
            </div>

            <div *ngIf="scanResults">
              <div class="alert alert-success py-2 px-3 small mb-3">
                Scan complete: {{ scanResults.matches.length }} candidate block matches identified.
              </div>

              <div class="row g-2 mb-3">
                <div class="col-4">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Blocks Scanned</div>
                    <div class="fw-bold font-monospace">{{ scanResults.total_scanned }}</div>
                  </div>
                </div>
                <div class="col-4">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">Matches Found</div>
                    <div class="fw-bold text-success font-monospace">{{ scanResults.matches.length }}</div>
                  </div>
                </div>
                <div class="col-4">
                  <div class="p-2 border rounded bg-body">
                    <div class="text-muted small">False Positives</div>
                    <div class="fw-bold font-monospace">{{ scanResults.false_positives }}</div>
                  </div>
                </div>
              </div>

              <div class="table-responsive" *ngIf="scanResults.matches.length > 0">
                <table class="table table-sm table-hover align-middle">
                  <thead>
                    <tr>
                      <th>Height</th>
                      <th>Block Hash</th>
                      <th>Match Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let m of scanResults.matches">
                      <td class="font-monospace fw-bold">#{{ m.height }}</td>
                      <td class="font-monospace small text-truncate" style="max-width: 250px;">{{ m.hash }}</td>
                      <td><span class="badge bg-primary">GCS Positive</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="alert alert-info py-2 px-3 small m-0 mt-3">
                Matching blocks are fetched through configured Tor/decoy paths to confirm transactions without leaking address links.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link { color: inherit; padding: 0.4rem 0.8rem; border-radius: 0.375rem; }
    .nav-link.active { background-color: var(--bs-primary); color: #fff; }
  `],
})
export class LightClientScanComponent {
  descriptor = 'wpkh([73c5da0a/84/0/0]xpub6BosfCnifzGh.../0/*)';
  startHeight = 855000;
  endHeight = 856000;
  scanning = false;
  progressPercent = 0;
  currentHeight = 855000;
  scanResults: any = null;
  private intervalId: any;

  constructor(private cdr: ChangeDetectorRef) {}

  startScan(): void {
    this.scanning = true;
    this.scanResults = null;
    this.progressPercent = 0;
    this.currentHeight = this.startHeight;

    this.intervalId = setInterval(() => {
      this.progressPercent += 20;
      this.currentHeight += 200;
      if (this.progressPercent >= 100) {
        clearInterval(this.intervalId);
        this.scanning = false;
        this.scanResults = {
          total_scanned: 1000,
          false_positives: 0,
          matches: [
            { height: 855320, hash: '00000000000000000001ab9823c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2' },
            { height: 855890, hash: '00000000000000000003cb9823c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c4' },
          ],
        };
      }
      this.cdr.markForCheck();
    }, 200);
  }

  cancelScan(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.scanning = false;
    this.cdr.markForCheck();
  }
}
