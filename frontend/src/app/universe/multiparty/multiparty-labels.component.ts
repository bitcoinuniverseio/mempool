import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-multiparty-labels',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Wallet Labels Interoperability (BIP329)</h1>
          <span class="badge bg-secondary">JSON Lines Format</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Portable wallet transaction and UTXO label export/import format preventing metadata lock-in across Bitcoin software.
        </p>

        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/tools/multiparty">Overview</a>
          <a class="nav-link" routerLink="/tools/multiparty/musig2">MuSig2 Coordinator</a>
          <a class="nav-link" routerLink="/tools/multiparty/bsms">BSMS Setup (BIP129)</a>
          <a class="nav-link" routerLink="/tools/multiparty/policies">Wallet Policies (BIP388)</a>
          <a class="nav-link active" routerLink="/tools/multiparty/labels">Labels (BIP329)</a>
          <a class="nav-link" routerLink="/tools/multiparty/compatibility">Hardware Matrix</a>
        </nav>
      </header>

      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">BIP329 Specification Highlights</h2>
            <ul class="list-group list-group-flush small text-muted mb-3">
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Line-delimited JSON objects (JSON Lines) for streaming and diff friendly storage.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Tag types: <code class="bg-body p-1 rounded">tx</code>, <code class="bg-body p-1 rounded">addr</code>, <code class="bg-body p-1 rounded">pubkey</code>, <code class="bg-body p-1 rounded">input</code>, <code class="bg-body p-1 rounded">output</code>, <code class="bg-body p-1 rounded">xpub</code>.
              </li>
              <li class="list-group-item bg-transparent px-0 py-2">
                &bull; Optional AES-GCM encryption with passphrase for private cloud backups.
              </li>
            </ul>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="card p-4 bg-body-tertiary border h-100">
            <h2 class="h5 mb-3">Sample BIP329 Export Stream</h2>
            <pre class="p-3 bg-body border rounded font-monospace small text-break mb-0">
&#123;&quot;type&quot;:&quot;tx&quot;,&quot;ref&quot;:&quot;d9e0f1a2...&quot;,&quot;label&quot;:&quot;Vault funding deposit&quot;&#125;
&#123;&quot;type&quot;:&quot;addr&quot;,&quot;ref&quot;:&quot;bc1q...&quot;,&quot;label&quot;:&quot;Coldcard Primary Receive&quot;&#125;
&#123;&quot;type&quot;:&quot;output&quot;,&quot;ref&quot;:&quot;d9e0f1a2...:0&quot;,&quot;spendable&quot;:true&#125;
            </pre>
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
export class MultipartyLabelsComponent {}
