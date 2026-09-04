import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { IntelligenceApiService } from './intelligence-api.service';

@Component({
  selector: 'app-protocol-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header">
        <div class="title-row">
          <h1>Universal Protocol Intelligence Registry & Adapters</h1>
          <span class="badge badge-primary">Standardized Adapters</span>
        </div>
        <p class="subtitle">
          Catalog of Bitcoin overlays, metaprotocols, token standards, Layer-2 networks, and cryptographic privacy primitives with live payload decoding.
        </p>
      </header>

      <div *ngIf="loadError" class="alert alert-danger mb-4">
        {{ loadError }}
      </div>

      <!-- Protocol Decoder -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h4 class="mb-0">Live Protocol Payload Decoder</h4>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="loadSamplePayload()">
            Load Sample Payload (Runes)
          </button>
        </div>
        <div class="card-body">
          <div class="mb-3">
            <label class="form-label small text-muted" for="decodeInput">scriptPubKey or Witness Hex</label>
            <input
              id="decodeInput"
              type="text"
              class="form-control font-monospace text-break"
              [(ngModel)]="decodeInput"
              placeholder="Paste OP_RETURN 6a5d... or witness envelope..."
            />
          </div>
          <div class="d-flex gap-2 align-items-center">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="decoding || !decodeInput.trim()"
              (click)="decodePayload()"
            >
              {{ decoding ? 'Decoding...' : 'Decode Protocol Payload' }}
            </button>
            <button
              *ngIf="decodeInput"
              type="button"
              class="btn btn-sm btn-outline-secondary"
              (click)="resetDecode()"
            >
              Clear
            </button>
          </div>

          <div *ngIf="decodeError" class="alert alert-danger mt-3 mb-0">
            {{ decodeError }}
          </div>

          <div *ngIf="!decodedResults.length && !decoding && !decodeError" class="mt-3 p-3 rounded bg-dark-subtle text-muted small">
            Enter a raw script or witness hex payload, or click "Load Sample Payload" to test protocol interpretation.
          </div>

          <div *ngIf="decodedResults.length > 0" class="mt-4">
            <h6 class="text-uppercase small text-muted">Decoded Operations:</h6>
            <div *ngFor="let dec of decodedResults" class="p-3 rounded bg-dark-subtle mb-2">
              <div class="d-flex justify-content-between align-items-center mb-1 flex-wrap gap-2">
                <strong>{{ dec.protocol_name }}</strong>
                <span class="badge badge-success">{{ dec.operation_type }}</span>
              </div>
              <pre class="mb-0 font-monospace small bg-black p-2 rounded text-break">{{ dec.parameters | json }}</pre>
            </div>
          </div>
        </div>
      </section>

      <!-- Protocol Adapters Catalog -->
      <section class="card mb-4" *ngIf="protocols.length > 0">
        <div class="card-header">
          <h4 class="mb-0">Registered Protocol Adapters</h4>
        </div>
        <div class="table-responsive">
          <table class="table table-hover mb-0">
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Category</th>
                <th>Introduced At Height</th>
                <th>Specification</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of protocols">
                <td class="fw-bold">{{ p.name }}</td>
                <td><span class="badge badge-secondary text-uppercase">{{ p.category }}</span></td>
                <td>Block {{ p.block_height_introduced | number }}</td>
                <td>
                  <a [href]="p.specification_url" target="_blank" rel="noopener" class="small text-break">
                    {{ p.specification_url }}
                  </a>
                </td>
                <td>
                  <span class="badge" [ngClass]="p.active ? 'badge-success' : 'badge-secondary'">
                    {{ p.active ? 'Active' : 'Inactive' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .intelligence-page { padding-top: 2rem; padding-bottom: 4rem; }
    .page-header { margin-bottom: 2rem; }
    .title-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .badge {
      display: inline-block; padding: 0.35em 0.65em; font-size: 0.75em;
      font-weight: 700; line-height: 1; text-align: center; white-space: nowrap;
      vertical-align: baseline; border-radius: 0.25rem;
    }
    .badge-primary { background-color: var(--primary, #0d6efd); color: #fff; }
    .badge-secondary { background-color: var(--secondary, #6c757d); color: #fff; }
    .badge-success { background-color: var(--success, #198754); color: #fff; }
  `],
})
export class ProtocolExplorerComponent implements OnInit, OnDestroy {
  protocols: any[] = [];
  decodeInput = '';
  decodedResults: any[] = [];
  decoding = false;
  decodeError: string | null = null;
  loading = false;
  loadError: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.subs.push(
      this.api.getProtocolAdapters$().subscribe({
        next: (res) => {
          this.protocols = res?.protocols || [];
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadError = err?.message || 'Failed to fetch protocol adapters';
          this.loading = false;
          this.cdr.markForCheck();
        },
      })
    );
  }

  loadSamplePayload(): void {
    this.decodeInput = '6a5d04140105e80702';
    this.decodePayload();
  }

  resetDecode(): void {
    this.decodeInput = '';
    this.decodedResults = [];
    this.decodeError = null;
    this.cdr.markForCheck();
  }

  decodePayload(): void {
    if (!this.decodeInput.trim()) return;
    this.decoding = true;
    this.decodeError = null;
    this.cdr.markForCheck();

    this.subs.push(
      this.api.decodeProtocolPayload$(this.decodeInput.trim()).subscribe({
        next: (res) => {
          this.decodedResults = res?.decoded || [];
          this.decoding = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.decodeError = err?.error?.error || err?.message || 'Protocol decoding failed';
          this.decoding = false;
          this.cdr.markForCheck();
        },
      })
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }
}
