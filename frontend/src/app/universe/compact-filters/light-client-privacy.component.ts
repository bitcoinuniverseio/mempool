import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-light-client-privacy',
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Light-Client Privacy Architecture</h1>
          <span class="badge bg-info text-dark">Zero Address Transmission</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Configuration and security principles for client-side filtering, multi-peer isolation, and decoy block requests.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" [routerLink]="'/network/light-client' | relativeUrl">Overview</a>
          <a class="nav-link" [routerLink]="'/network/light-client/providers' | relativeUrl">Providers</a>
          <a class="nav-link" [routerLink]="'/network/light-client/filters' | relativeUrl">Filter Explorer</a>
          <a class="nav-link" [routerLink]="'/network/light-client/verify' | relativeUrl">Header Verifier</a>
          <a class="nav-link" [routerLink]="'/network/light-client/scan' | relativeUrl">Local Scanner</a>
          <a class="nav-link active" [routerLink]="'/network/light-client/privacy' | relativeUrl">Privacy Controls</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Privacy Guardrails</h2>
            <div class="mb-3">
              <label class="form-check form-switch mb-2 touch-check-label">
                <input class="form-check-input" type="checkbox" id="torRoute" [(ngModel)]="torOnly" />
                <span class="form-check-label fw-bold">Route Block Queries over Tor / Onion</span>
              </label>
              <p class="small text-muted mb-3">
                Prevents peer correlation between your IP address and the specific block heights fetched after filter matches.
              </p>

              <label class="form-check form-switch mb-2 touch-check-label">
                <input class="form-check-input" type="checkbox" id="decoyReqs" [(ngModel)]="decoyRequests" />
                <span class="form-check-label fw-bold">Inject Decoy Block Requests</span>
              </label>
              <p class="small text-muted mb-3">
                Downloads random neighboring blocks alongside true filter matches to obscure the exact transaction timing.
              </p>

              <label class="form-check form-switch mb-2 touch-check-label">
                <input class="form-check-input" type="checkbox" id="splitProviders" [(ngModel)]="splitPeers" />
                <span class="form-check-label fw-bold">Separate Filter Peer from Block Peer</span>
              </label>
              <p class="small text-muted mb-0">
                Never requests block bodies from the same peer that supplied the compact filter.
              </p>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Comparison: Bloom Filters vs Compact Filters</h2>
            <div class="table-responsive" tabindex="0" role="region" aria-label="Comparison: Bloom Filters vs Compact Filters, scroll horizontally" i18n-aria-label>
              <table class="table table-sm table-bordered">
                <thead class="table-light">
                  <tr>
                    <th>Feature</th>
                    <th>BIP37 (Bloom Filters)</th>
                    <th>BIP157/158 (Compact Filters)</th>
                  </tr>
                </thead>
                <tbody class="small">
                  <tr>
                    <td>Filter Construction</td>
                    <td class="text-danger">Client sends filter to server</td>
                    <td class="text-success">Node computes identical filter</td>
                  </tr>
                  <tr>
                    <td>Address Leakage</td>
                    <td class="text-danger">High (statistical intersection)</td>
                    <td class="text-success">Zero (node never sees query)</td>
                  </tr>
                  <tr>
                    <td>Bandwidth</td>
                    <td>Minimal</td>
                    <td>Modest (~4KB per block)</td>
                  </tr>
                  <tr>
                    <td>Denial of Service</td>
                    <td class="text-danger">Severe CPU burden on nodes</td>
                    <td class="text-success">O(1) static disk lookup</td>
                  </tr>
                </tbody>
              </table>
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
export class LightClientPrivacyComponent {
  torOnly = true;
  decoyRequests = true;
  splitPeers = true;
}
