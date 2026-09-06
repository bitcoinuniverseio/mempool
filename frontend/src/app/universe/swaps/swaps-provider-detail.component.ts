import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@app/shared/shared.module';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { combineLatest, of, Subscription } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { SwapsApiService, SwapProvider } from './swaps.service';

@Component({
  selector: 'app-swaps-provider-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ['.text-muted { color: var(--u-text-muted) !important; }'],
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a [routerLink]="'/swaps/providers' | relativeUrl" class="btn btn-sm btn-outline-secondary">← Back to Providers</a>
        </div>
        <h1>{{ provider?.name || 'Swap Provider' }}</h1>
        <p class="text-muted font-monospace" *ngIf="provider">{{ provider.identity_key }}</p>
      </header>

      <p *ngIf="loading" role="status">Loading provider...</p>
      <p *ngIf="error" class="alert alert-warning" role="alert">{{ error }}</p><div *ngIf="provider" class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Provider Manifest</h5>
        <div class="row g-3">
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Timeout Safety Policy</div>
              <div class="fs-5 fw-bold">{{ provider.timeout_policy_blocks }} Blocks</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Cooperative Claim Support</div>
              <div class="fs-5 fw-bold">{{ provider.cooperative_claim_support ? 'Declared' : 'Not declared' }}</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Manifest Signature</div>
              <div class="fs-5 fw-bold text-muted">Unverified</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsProviderDetailComponent implements OnInit, OnDestroy {
  public provider?: SwapProvider; public error = '';
  public loading = true;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private api: SwapsApiService,
    private cdr: ChangeDetectorRef
  ) {}

  public ngOnInit(): void {
    this.sub = combineLatest([this.route.paramMap, this.api.network$]).pipe(switchMap(([params, network]) => {
      this.provider = undefined; this.error = ''; this.loading = true;
      this.cdr.markForCheck();
      const id = params.get('providerId');
      if (!id) { this.error = 'A provider identity is required.'; return of(null); }
      return this.api.getProviderById$(id, network).pipe(catchError(err => {
        this.error = err.error?.error || 'Provider evidence unavailable.';
        return of(null);
      }));
    })).subscribe(p => {
      this.provider = p || undefined; this.loading = false;
      this.cdr.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
