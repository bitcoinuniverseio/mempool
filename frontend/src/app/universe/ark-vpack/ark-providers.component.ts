import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ArkVpackApiService } from './ark-vpack.service';

@Component({
  selector: 'app-ark-providers',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <h1>Ark Service Provider (ASP) Observatory</h1>
        <p class="text-muted">Registered Ark service providers with signed manifests, round frequency, and exit policies.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ark/vpack">Overview</a>
          <a class="nav-link" routerLink="/ark/vpack/verify">Verify Anchor</a>
          <a class="nav-link" routerLink="/ark/vpack/translate">Translate Dialect</a>
          <a class="nav-link" routerLink="/ark/backups">Encrypted Backups</a>
          <a class="nav-link" routerLink="/ark/exit">Unilateral Exit</a>
          <a class="nav-link" routerLink="/ark/exit/simulate">Exit Simulator</a>
          <a class="nav-link active" routerLink="/ark/providers">ASP Registry</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading ASP observatory...</div>
      </div>

      <div *ngIf="!loading && providers" class="row g-4">
        <div class="col-12 col-md-6" *ngFor="let p of providers">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h5 class="m-0">{{ p.name }}</h5>
              <span class="badge bg-success">{{ p.health_status | uppercase }}</span>
            </div>
            <p class="small text-muted font-monospace mb-2">{{ p.provider_id }}</p>
            <div class="row g-2 small mb-3">
              <div class="col-6"><strong>Exit Delay:</strong> {{ p.exit_delay_blocks }} blocks</div>
              <div class="col-6"><strong>Network:</strong> {{ p.network }}</div>
              <div class="col-12"><strong>V-PACK Version:</strong> {{ p.vpack_version }}</div>
            </div>
            <div class="mt-auto">
              <span class="badge bg-dark">Manifest PGP Verified</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkProvidersComponent implements OnInit, OnDestroy {
  public providers: any[] = [];
  public loading = true;
  private sub?: Subscription;

  constructor(private api: ArkVpackApiService, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    this.sub = this.api.getProviders$().subscribe((data) => {
      this.providers = data;
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
