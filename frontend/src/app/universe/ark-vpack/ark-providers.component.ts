import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { ArkVpackApiService } from './ark-vpack.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-ark-providers',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <div class="alert alert-warning" role="alert" *ngIf="loadError">
        {{ loadError }}
      </div>
      <header class="page-header mb-4">
        <h1>Ark Service Provider (ASP) Observatory</h1>
        <p class="text-muted">Registered Ark service providers with signed manifests, round frequency, and exit policies.</p>
        <nav class="nav nav-pills gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/ark/vpack' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/verify' | relativeUrl">Verify Anchor</a>
          <a class="nav-link" [routerLink]="'/ark/vpack/translate' | relativeUrl">Translate Dialect</a>
          <a class="nav-link" [routerLink]="'/ark/backups' | relativeUrl">Encrypted Backups</a>
          <a class="nav-link" [routerLink]="'/ark/exit' | relativeUrl">Unilateral Exit</a>
          <a class="nav-link" [routerLink]="'/ark/exit/simulate' | relativeUrl">Exit Simulator</a>
          <a class="nav-link active" [routerLink]="'/ark/providers' | relativeUrl">ASP Registry</a>
        </nav>
      </header>

      <div *ngIf="loading" class="text-center py-5 text-muted">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Loading ASP observatory...</div>
      </div>

      <p *ngIf="!loading && !loadError && !providers.length" class="alert alert-info">No independently registered provider observations are available.</p>
      <div *ngIf="!loading && providers" class="row g-4">
        <div class="col-12 col-md-6" *ngFor="let p of providers">
          <div class="card p-3 bg-body-tertiary border h-100">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h5 class="m-0">{{ p.name }}</h5>
              <span class="badge" [class.bg-success]="p.health_status === 'online' && p.observed_at" [class.bg-secondary]="p.health_status !== 'online' || !p.observed_at">{{ (p.observed_at ? p.health_status : 'unobserved') | uppercase }}</span>
            </div>
            <p class="small text-muted font-monospace mb-2">{{ p.provider_id }}</p>
            <div class="row g-2 small mb-3">
              <div class="col-6"><strong>Exit Delay:</strong> {{ p.exit_delay_blocks ?? 'Unknown' }} blocks</div>
              <div class="col-6"><strong>Network:</strong> {{ p.network }}</div>
              <div class="col-12"><strong>V-PACK Version:</strong> {{ p.vpack_version }}</div>
            </div>
            <div class="mt-auto">
              <span class="badge bg-dark">{{ p.signature_verified === true && p.signer_trusted === true ? 'Authenticated provider statement' : 'Manifest not authenticated' }}</span>
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
  private requestSub?: Subscription;

  public loadError: string | null = null;

  constructor(private api: ArkVpackApiService, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    this.sub = this.api.networkChanges$.subscribe(() => {
      this.requestSub?.unsubscribe();
      this.providers = [];
      this.loading = true;
      this.loadError = null;
      this.cdr.markForCheck();
      this.load();
    });
  }

  private load(): void {
    this.requestSub = this.api.getProviders$().subscribe({
      next: (data) => {
        const valid = Array.isArray(data) && data.every(p => p && typeof p.provider_id === 'string' && typeof p.name === 'string' && typeof p.network === 'string');
        this.providers = valid ? data : [];
        if (!valid) { this.loading = false; this.loadError = 'The provider registry returned invalid evidence.'; this.cdr.markForCheck(); return; }
        this.loading = false;
        this.loadError = null;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.providers = [];
        this.loading = false;
        this.loadError = loadFailureMessage(classifyLoadFailure(err));
        this.cdr.markForCheck();
      },
    });
  }

  public ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.requestSub?.unsubscribe();
  }
}
