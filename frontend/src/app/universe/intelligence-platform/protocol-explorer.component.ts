import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

      <!-- Protocol Decoder -->
      <section class="card mb-4">
        <div class="card-header">
          <h4 class="mb-0">Live Protocol Payload Decoder</h4>
        </div>
        <div class="card-body">
          <div class="mb-3">
            <label class="form-label small text-muted">scriptPubKey or Witness Hex</label>
            <input
              type="text"
              class="form-control font-monospace"
              [(ngModel)]="decodeInput"
              placeholder="Paste OP_RETURN 6a5d... or witness envelope..."
            />
          </div>
          <button class="btn btn-primary" (click)="decodePayload()">Decode Protocol Payload</button>

          <div *ngIf="decodedResults.length > 0" class="mt-3">
            <h6 class="text-uppercase small text-muted">Decoded Operations:</h6>
            <div *ngFor="let dec of decodedResults" class="p-3 rounded bg-dark-subtle mb-2">
              <div class="d-flex justify-content-between align-items-center mb-1">
                <strong>{{ dec.protocol_name }}</strong>
                <span class="badge badge-success">{{ dec.operation_type }}</span>
              </div>
              <pre class="mb-0 font-monospace small bg-black p-2 rounded">{{ dec.parameters | json }}</pre>
            </div>
          </div>
        </div>
      </section>

      <!-- Protocol Adapters Catalog -->
      <section class="card mb-4">
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
                  <a [href]="p.specification_url" target="_blank" rel="noopener" class="small">
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
    .badge-primary { background-color: #0d6efd; color: #fff; }
    .badge-success { background-color: #198754; color: #fff; }
    .badge-secondary { background-color: #6c757d; color: #fff; }
  `],
})
export class ProtocolExplorerComponent implements OnInit {
  protocols: any[] = [];
  decodeInput = '6a5d04140105e80702';
  decodedResults: any[] = [];

  constructor(
    private api: IntelligenceApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.api.getProtocolAdapters$().subscribe((res) => {
      this.protocols = res?.protocols || [];
      this.cdr.markForCheck();
    });
    this.decodePayload();
  }

  decodePayload(): void {
    if (!this.decodeInput.trim()) return;
    this.api.decodeProtocolPayload$(this.decodeInput).subscribe((res) => {
      this.decodedResults = res?.decoded || [];
      this.cdr.markForCheck();
    });
  }
}
