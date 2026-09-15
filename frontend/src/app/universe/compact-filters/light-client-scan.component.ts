import { OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { CompactFiltersApiService } from './compact-filters.service';
import { scanScript, scanFilterRange } from './local-filter-scan';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-light-client-scan',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
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
          <a class="nav-link" [routerLink]="'/network/light-client' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/network/light-client/providers' | relativeUrl">Providers</a>
          <a class="nav-link" [routerLink]="'/network/light-client/filters' | relativeUrl">Filter Explorer</a>
          <a class="nav-link" [routerLink]="'/network/light-client/verify' | relativeUrl">Header Verifier</a>
          <a class="nav-link active" [routerLink]="'/network/light-client/scan' | relativeUrl">Local Scanner</a>
          <a class="nav-link" [routerLink]="'/network/light-client/privacy' | relativeUrl">Privacy Controls</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-5">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Scan Configuration</h2>
<label for="filter-scan-network">Bitcoin network</label><select id="filter-scan-network" [(ngModel)]="network" (ngModelChange)="edited()"><option value="main">Mainnet</option><option value="test">Testnet</option><option value="testnet4">Testnet4</option><option value="signet">Signet</option><option value="regtest">Regtest</option></select>
<p class="small">Addresses, addr(address), raw(scriptHex); at most32 blocks. Other descriptors remain unsupported. Only public network and height selectors leave this browser.</p>
<label for="filter-offline">Optional offline public filter interval JSON</label><textarea id="filter-offline" [(ngModel)]="offlineRange" (ngModelChange)="edited()" rows="3" class="form-control"></textarea><p>Leave blank to read the owned node. Offline bytes have no established chain provenance or peer agreement.</p><p *ngIf="error" role="alert" class="alert alert-warning">{{ error }}</p>

            <div class="mb-3">
              <label class="form-label small text-muted" for="light-client-scan-descriptor">Public Descriptor or Address</label>
              <textarea
                id="light-client-scan-descriptor"
                class="form-control font-monospace small"
                rows="4"
                [(ngModel)]="descriptor" (ngModelChange)="edited()"
                placeholder="wpkh([fingerprint/84'/0'/0']xpub.../0/*)"
              ></textarea>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label small text-muted" for="light-client-scan-start">Start Height</label>
                <input type="number" class="form-control" id="light-client-scan-start" [(ngModel)]="startHeight" (ngModelChange)="edited()" />
              </div>
              <div class="col-6">
                <label class="form-label small text-muted" for="light-client-scan-end">End Height</label>
                <input type="number" class="form-control" id="light-client-scan-end" [(ngModel)]="endHeight" (ngModelChange)="edited()" />
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
                <span>Fetching public filters and checking them locally...</span>
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

              <div class="table-responsive" *ngIf="scanResults.matches.length > 0" tabindex="0">
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
                Matches are candidates, not confirmed transactions. Full-block confirmation, Tor routing and decoy requests are not implemented.
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
export class LightClientScanComponent implements OnDestroy {
 offlineRange='';descriptor='';startHeight=0;endHeight=15;network='main';scanning=false;progressPercent=0;currentHeight=0;scanResults:any=null;error:string|null=null;
 private request?:Subscription;
 constructor(private cdr:ChangeDetectorRef,private api:CompactFiltersApiService){}
 edited():void{this.request?.unsubscribe();this.scanning=false;this.scanResults=null;this.error=null;this.progressPercent=0;}
 startScan():void{
  this.edited();let script:Uint8Array;
  try{if(!Number.isSafeInteger(this.startHeight)||!Number.isSafeInteger(this.endHeight)||this.startHeight<0||this.endHeight<this.startHeight||this.endHeight-this.startHeight>=32)throw Error('Choose1–32 consecutive nonnegative block heights.');script=scanScript(this.descriptor,this.network);}catch(error){this.error=error instanceof Error?error.message:'Invalid scan input';return;}
  this.scanning=true;this.currentHeight=this.startHeight;
  if(this.offlineRange.trim()){try{if(this.offlineRange.length>4100000)throw Error('Offline interval exceeds4MB.');this.scanResults=scanFilterRange(JSON.parse(this.offlineRange),script,this.startHeight,this.endHeight,this.network);this.currentHeight=this.endHeight;this.progressPercent=100;}catch(error){this.error=error instanceof Error?error.message:'Invalid offline interval';}finally{script.fill(0);this.scanning=false;this.cdr.markForCheck();}return;}
  this.request=this.api.getRanges$(this.startHeight,this.endHeight,this.network).subscribe({next:ranges=>{try{this.scanResults=scanFilterRange(ranges,script,this.startHeight,this.endHeight,this.network);this.currentHeight=this.endHeight;this.progressPercent=100;}catch(error){this.error=error instanceof Error?error.message:'Local filter verification failed';}finally{script.fill(0);this.scanning=false;this.cdr.markForCheck();}},error:error=>{script.fill(0);this.scanning=false;this.error=error?.error?.error||'Owned filters are unavailable.';this.cdr.markForCheck();}});
 }
 cancelScan():void{this.edited();this.cdr.markForCheck();}
 ngOnDestroy():void{this.edited();this.descriptor='';this.offlineRange='';}
}
