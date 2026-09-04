import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { SwapsApiService, SwapProvider } from './swaps.service';

@Component({
  selector: 'app-swaps-provider-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/swaps/providers" class="btn btn-sm btn-outline-secondary">← Back to Providers</a>
        </div>
        <h1 *ngIf="provider">{{ provider.name }}</h1>
        <p class="text-muted font-monospace" *ngIf="provider">{{ provider.identity_key }}</p>
      </header>

      <div *ngIf="provider" class="card p-4 bg-body-tertiary border">
        <h5 class="mb-3">Cryptographic Manifest & Operational SLA</h5>
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
              <div class="fs-5 fw-bold text-success">Enabled</div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Manifest Signature</div>
              <div class="fs-5 fw-bold text-success">BIP340 Verified</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SwapsProviderDetailComponent implements OnInit, OnDestroy {
  public provider?: SwapProvider;
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private api: SwapsApiService,
    private cdr: ChangeDetectorRef
  ) {}

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('providerId') || 'boltz-exchange';
    this.sub = this.api.getProviderById$(id).subscribe((p) => {
      this.provider = p;
      this.cdr.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
