import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-ark-vtxo-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intelligence-page container-xl">
      <header class="page-header mb-4">
        <div class="d-flex align-items-center gap-2 mb-2">
          <a routerLink="/ark/vpack" class="btn btn-sm btn-outline-secondary">← Back to Ark V-PACK</a>
        </div>
        <h1>VTXO Inspector: <span class="font-monospace fs-4">{{ vtxoId }}</span></h1>
        <p class="text-muted">Lifecycle status, round anchor outpoint, and unilateral exit capability.</p>
      </header>

      <div class="card p-4 bg-body-tertiary border">
        <div class="row g-3">
          <div class="col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Status</div>
              <div class="fs-5 fw-bold text-success">Active VTXO</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Denomination</div>
              <div class="fs-5 fw-bold">500,000 sats</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Exit Delay</div>
              <div class="fs-5 fw-bold">512 Blocks</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="p-3 border rounded bg-body">
              <div class="text-muted small">Anchor Outpoint</div>
              <div class="fs-6 font-monospace text-truncate">3b4c5d...:0</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ArkVtxoDetailComponent implements OnInit {
  public vtxoId = 'vtxo-887412-001';

  constructor(private route: ActivatedRoute, private cdr: ChangeDetectorRef) {}

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('vtxoId');
    if (id) {
      this.vtxoId = id;
      this.cdr.markForCheck();
    }
  }
}
