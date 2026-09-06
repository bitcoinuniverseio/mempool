import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SwapsApiService } from './swaps.service';
import { publicSwapPackage } from './swaps-package';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-swaps-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Public Swap Package Inspector</h1>
        <p class="text-muted">Check public package fields locally, then request first-party chain evidence. Private backup fields are rejected before transmission.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/swaps' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/swaps/submarine' | relativeUrl">Submarine</a>
          <a class="nav-link" [routerLink]="'/swaps/reverse' | relativeUrl">Reverse</a>
          <a class="nav-link" [routerLink]="'/swaps/chain' | relativeUrl">Chain Swaps</a>
          <a class="nav-link" [routerLink]="'/swaps/providers' | relativeUrl">Providers</a>
          <a class="nav-link active" [routerLink]="'/swaps/inspect' | relativeUrl">Inspector</a>
          <a class="nav-link" [routerLink]="'/swaps/recover' | relativeUrl">Recovery Planner</a>
          <a class="nav-link" [routerLink]="'/swaps/simulate' | relativeUrl">Simulator</a>
        </nav>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Paste public swap JSON</h5>
        <div class="mb-3">
          <label for="inspect-package">Public package JSON</label><textarea id="inspect-package" [(ngModel)]="raw" (ngModelChange)="clear()" maxlength="16384" class="form-control font-monospace" rows="6" placeholder='{"id": "swp-...", "preimageHash": "...", "lockupAddress": "..."}'></textarea>
        </div>
        <div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-primary" type="button" (click)="inspect()">Check fields locally</button><button class="btn btn-primary" type="button" [disabled]="loading || !raw" (click)="verify()">{{ loading ? 'Checking node...' : 'Verify public chain evidence' }}</button></div><p class="mt-3" *ngIf="message" role="status">{{ message }}</p><p class="alert alert-danger mt-3" *ngIf="error" role="alert">{{ error }}</p><section *ngIf="result" aria-live="polite"><h2 class="h5 mt-3">Evidence stages</h2><div *ngFor="let stage of ['lockup', 'claim', 'refund']" class="border rounded p-3 my-2"><strong>{{ stage }}: {{ result[stage].stage }}</strong><p *ngFor="let reason of result[stage].errors" class="small mb-1">{{ reason }}</p></div><p class="small text-muted">Chain evidence does not establish provider identity or Lightning settlement.</p></section>
      </div>
    </div>
  `,
})
export class SwapsInspectComponent implements OnDestroy {
  raw = ''; message = ''; error = ''; loading = false; result: any = null;
  private request?: Subscription;
  private networkSub: Subscription;
  constructor(public api: SwapsApiService, private cdr: ChangeDetectorRef) { this.networkSub = api.network$.subscribe(() => this.clear()); }
  clear(): void { this.request?.unsubscribe(); this.message = ''; this.error = ''; this.loading = false; this.result = null; this.cdr.markForCheck(); }
  inspect(): void { this.clear(); try { const pkg = publicSwapPackage(this.raw, this.api.network); this.message = `Public JSON accepted with ${Object.keys(pkg).length} fields. This checks structure only, not script, signature or chain validity.`; } catch (e) { this.error = e instanceof Error ? e.message : 'Invalid package.'; } }
  verify(): void {
    this.clear(); const network = this.api.network; let pkg: object;
    try { pkg = publicSwapPackage(this.raw, network); } catch (e) { this.error = e instanceof Error ? e.message : 'Invalid package.'; return; }
    this.loading = true;
    this.request = this.api.verify$(pkg, network).subscribe({ next: result => { if (this.api.network === network) { this.result = result; this.loading = false; this.cdr.markForCheck(); } }, error: e => { this.loading = false; this.error = e.error?.error || 'First-party evidence service unavailable.'; this.cdr.markForCheck(); } });
  }
  ngOnDestroy(): void { this.request?.unsubscribe(); this.networkSub.unsubscribe(); }
}
