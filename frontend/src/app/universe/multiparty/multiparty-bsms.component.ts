import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-multiparty-bsms',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">BSMS Multi-Vendor Setup (BIP129)</h1>
          <span class="badge bg-primary">Hardware Coordinator</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Bitcoin Signed Multisig Setup (BIP129) provides cryptographic round-trip verification preventing address substitution attacks between coordinators and hardware signing devices.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/tools/multiparty">Overview</a>
          <a class="nav-link" routerLink="/tools/multiparty/musig2">MuSig2 Coordinator</a>
          <a class="nav-link active" routerLink="/tools/multiparty/bsms">BSMS Setup (BIP129)</a>
          <a class="nav-link" routerLink="/tools/multiparty/policies">Wallet Policies (BIP388)</a>
          <a class="nav-link" routerLink="/tools/multiparty/labels">Labels (BIP329)</a>
          <a class="nav-link" routerLink="/tools/multiparty/compatibility">Hardware Matrix</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">BSMS Workflow Rounds</h2>
            <div class="d-flex flex-column gap-3">
              <div class="p-3 border rounded bg-body">
                <div class="fw-bold">Round 1: Key Record Exchange</div>
                <p class="small text-muted mb-0 mt-1">
                  Each hardware wallet exports a signed key record containing master key fingerprint, derivation path, and extended public key (xpub).
                </p>
              </div>

              <div class="p-3 border rounded bg-body">
                <div class="fw-bold">Round 2: Descriptor Verification & Signature</div>
                <p class="small text-muted mb-0 mt-1">
                  Coordinator aggregates key records into a multisig descriptor template and asks each hardware device to verify and sign the exact descriptor text.
                </p>
              </div>

              <div class="p-3 border rounded bg-body">
                <div class="fw-bold">Round 3: Verified Registration</div>
                <p class="small text-muted mb-0 mt-1">
                  Hardware wallet registers the verified policy in its secure element, guaranteeing future receive addresses and change paths belong to this authentic quorum.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Sample BSMS Descriptor Template</h2>
            <pre class="p-3 bg-body border rounded font-monospace small text-break mb-3">
wsh(sortedmulti(2,
  [73c5da0a/48'/0'/0'/2']xpub6E.../0/*,
  [f54c9d21/48'/0'/0'/2']xpub6F.../0/*
))#a89c7d8e
            </pre>

            <div class="alert alert-info py-2 px-3 small m-0">
              Coordinators implementing BIP129 eliminate the vulnerability where a compromised software wallet tricks a signer into generating addresses for a foreign key.
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
export class MultipartyBsmsComponent {}
