import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-multiparty-policies',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Wallet Policy Interoperability (BIP388)</h1>
          <span class="badge bg-secondary">BitBox02 / Coldcard / Ledger</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Formal language and registration protocol for hardware signers to display and verify arbitrary complex Miniscript and multisig spending conditions.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/tools/multiparty">Overview</a>
          <a class="nav-link" routerLink="/tools/multiparty/musig2">MuSig2 Coordinator</a>
          <a class="nav-link" routerLink="/tools/multiparty/bsms">BSMS Setup (BIP129)</a>
          <a class="nav-link active" routerLink="/tools/multiparty/policies">Wallet Policies (BIP388)</a>
          <a class="nav-link" routerLink="/tools/multiparty/labels">Labels (BIP329)</a>
          <a class="nav-link" routerLink="/tools/multiparty/compatibility">Hardware Matrix</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Wallet Policy Template Structure</h2>
            <p class="small text-muted mb-3">
              BIP388 splits complex descriptors into a policy template string and an indexed key information vector, allowing hardware displays with limited screens to show exact human-readable intent.
            </p>

            <div class="p-3 border rounded bg-body font-monospace small mb-3">
              <div class="text-muted mb-1">// Policy Template:</div>
              wsh(thresh(2,pk(@0/**),pk(@1/**),older(12960)))
            </div>

            <div class="p-3 border rounded bg-body font-monospace small mb-3">
              <div class="text-muted mb-1">// Keys Vector:</div>
              [0]: [73c5da0a/48'/0'/0'/2']xpub6E...<br>
              [1]: [f54c9d21/48'/0'/0'/2']xpub6F...
            </div>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Hardware Policy Registration</h2>
            <div class="alert alert-info py-2 px-3 small mb-3">
              Registration prevents silent change output redirection during PSBT signing.
            </div>
            <ul class="list-group list-group-flush small text-muted">
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Device generates a deterministic 32-byte HMAC or authentication token upon user confirmation.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; During PSBT signing, the token proves the wallet was previously registered without asking the user to re-verify the full descriptor.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Supported natively by Ledger Bitcoin App v2.1+, BitBox02 v9.15+, and Coldcard Edge.
              </li>
            </ul>
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
export class MultipartyPoliciesComponent {}
