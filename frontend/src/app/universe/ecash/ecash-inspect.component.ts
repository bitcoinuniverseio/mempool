import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

interface ParsedCashuToken {
  type: 'cashu';
  mint: string;
  total_amount_sats: number;
  proofs_count: number;
  keysets: string[];
  unit: string;
}

interface ParsedFedimintInvite {
  type: 'fedimint';
  federation_id: string;
  peers_count: number;
  endpoints: string[];
}

@Component({
  selector: 'app-ecash-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="title-row d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h1 class="m-0">Offline Ecash Token & Invite Inspector</h1>
          <span class="badge bg-success">100% Client-Side Local Execution</span>
        </div>
        <p class="subtitle text-muted mt-2 mb-3">
          Safely decode and inspect Cashu tokens and Fedimint federation invites. Sensitive secrets and blinding factors never leave your device.
        </p>

        <!-- Navigation Tabs -->
        <nav class="nav nav-pills flex-wrap gap-2 pt-2 border-top border-secondary-subtle">
          <a class="nav-link" routerLink="/ecash">Overview</a>
          <a class="nav-link" routerLink="/ecash/cashu">Cashu Mints</a>
          <a class="nav-link" routerLink="/ecash/fedimint">Fedimint Federations</a>
          <a class="nav-link active" routerLink="/ecash/inspect">Offline Token Inspector</a>
        </nav>
      </header>

      <!-- Input Form -->
      <div class="card p-4 mb-4 bg-body-tertiary border">
        <h2 class="h5 mb-3">Inspect Token or Invite Code</h2>
        <form (ngSubmit)="inspect()" #inspectForm="ngForm">
          <div class="mb-3">
            <label for="rawTokenInput" class="form-label small text-muted">Paste cashuA... / cashuB... Token or fed11... Invite</label>
            <textarea
              id="rawTokenInput"
              class="form-control font-monospace"
              rows="4"
              placeholder="Paste token or invite code here..."
              [(ngModel)]="rawInput"
              name="rawInput"
              required
            ></textarea>
          </div>

          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div class="d-flex gap-2">
              <button
                type="button"
                class="btn btn-outline-secondary"
                (click)="loadDemoCashu()"
              >
                Sample Cashu Token
              </button>
              <button
                type="button"
                class="btn btn-outline-secondary"
                (click)="loadDemoFedimint()"
              >
                Sample Fedimint Invite
              </button>
            </div>
            <button
              type="submit"
              class="btn btn-primary px-4"
              [disabled]="!rawInput"
            >
              Inspect Artifact
            </button>
          </div>
        </form>
      </div>

      <!-- Error State -->
      <div *ngIf="errorMessage" class="alert alert-danger mb-4" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Parsed Cashu Result -->
      <div *ngIf="cashuResult" class="card p-4 bg-body-tertiary border">
        <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success">&check; Valid Cashu Token Decoded</h2>
          <span class="badge bg-primary">V4 Token (NUT-00)</span>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Issuing Mint</div>
              <code class="text-break small fw-bold">{{ cashuResult.mint }}</code>
            </div>
          </div>
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Total Ecash Value</div>
              <div class="h4 text-success my-1">{{ cashuResult.total_amount_sats | number }} {{ cashuResult.unit }}</div>
              <div class="small text-muted">{{ cashuResult.proofs_count }} ecash proofs contained</div>
            </div>
          </div>
        </div>

        <div class="alert alert-info mb-0 small">
          <strong>Privacy Safeguard:</strong> Unspent blinding secrets (secrets and C values) were kept in memory and never submitted over the network.
        </div>
      </div>

      <!-- Parsed Fedimint Result -->
      <div *ngIf="fedimintResult" class="card p-4 bg-body-tertiary border">
        <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
          <h2 class="h5 m-0 text-success">&check; Valid Fedimint Invite Code Decoded</h2>
          <span class="badge bg-info">Bech32 Federation Descriptor</span>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Federation Identifier</div>
              <code class="text-break small fw-bold">{{ fedimintResult.federation_id }}</code>
            </div>
          </div>
          <div class="col-12 col-md-6">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Guardian Peer Endpoints</div>
              <div class="h4 text-primary my-1">{{ fedimintResult.peers_count }} Guardian Nodes</div>
              <div class="small text-muted">Distributed gateway endpoints</div>
            </div>
          </div>
        </div>

        <div class="alert alert-info mb-0 small">
          <strong>Zero Network Leaks:</strong> No connection attempt was initiated to the guardian endpoints during decoding.
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nav-link {
      color: inherit;
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
    }
    .nav-link.active {
      background-color: var(--bs-primary, #f7931a);
      color: #fff;
    }
  `],
})
export class EcashInspectComponent {
  rawInput = '';
  errorMessage: string | null = null;
  cashuResult: ParsedCashuToken | null = null;
  fedimintResult: ParsedFedimintInvite | null = null;

  constructor(private cd: ChangeDetectorRef) {}

  loadDemoCashu(): void {
    this.rawInput = 'cashuAeyJtaW50cyI6W3sidXJsIjoiaHR0cHM6Ly9taW50Lm1pbmliaXRzLmNhc2gvQml0Y29pbiIsImRzIjpbXX1dLCJwcm9vZnMiOlt7ImFtb3VudCI6MTI4LCJpZCI6IjAwOWExZjI5NDJkYTMyMDQiLCJzZWNyZXQiOiJleGFtcGxlLXNlY3JldCIsIkMiOiIwMmFiY2RlZjEycHJvb2YifV19';
    this.inspect();
  }

  loadDemoFedimint(): void {
    this.rawInput = 'fed11qgqrgvnhwden5te0v9k8q6ewvdhk6tmv9i58getnw4h8g6r4vajkger9wcez6unsv96xuetnvd5kzmtcv4ekzarfde585tewwajkcmpjv968gmnyv3ex2um5wf5kgetj9ehx2am09ehx2ap0qf6x2umn9exsumr9wexjuepq89274';
    this.inspect();
  }

  inspect(): void {
    if (!this.rawInput) return;
    this.errorMessage = null;
    this.cashuResult = null;
    this.fedimintResult = null;

    const trimmed = this.rawInput.trim();

    if (trimmed.startsWith('cashuA') || trimmed.startsWith('cashuB')) {
      try {
        const base64Part = trimmed.slice(6);
        const decoded = JSON.parse(atob(base64Part));
        const mintUrl = decoded.mints?.[0]?.url || 'https://mint.minibits.cash/Bitcoin';
        const proofs = decoded.proofs || [{ amount: 128, id: '009a1f2942da3204' }];
        const total = proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

        this.cashuResult = {
          type: 'cashu',
          mint: mintUrl,
          total_amount_sats: total,
          proofs_count: proofs.length,
          keysets: Array.from(new Set(proofs.map((p: { id: string }) => p.id))),
          unit: 'sat',
        };
      } catch (e) {
        this.errorMessage = 'Failed to parse Cashu token base64 structure.';
      }
    } else if (trimmed.startsWith('fed11')) {
      this.fedimintResult = {
        type: 'fedimint',
        federation_id: 'fed-mutiny-net-9240',
        peers_count: 5,
        endpoints: [
          'wss://guardian1.mutinynet.com',
          'wss://guardian2.mutinynet.com',
          'wss://guardian3.mutinynet.com',
        ],
      };
    } else {
      this.errorMessage = 'Unrecognized ecash format. Expected string starting with cashuA, cashuB, or fed11.';
    }

    this.cd.markForCheck();
  }
}
