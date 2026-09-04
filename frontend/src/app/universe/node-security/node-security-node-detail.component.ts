import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-node-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4" *ngIf="node">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Node Security Profile: <span class="text-info">{{ node.node_id }}</span></h1>
          <p class="text-muted mb-0">{{ node.client_name }} {{ node.version }} running on {{ node.network }}</p>
        </div>
        <a routerLink="/node/security/fleet" class="btn btn-outline-secondary btn-sm">Back to Fleet</a>
      </div>

      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Health Posture</div>
            <div class="h3 fw-bold my-1" [ngClass]="node.status === 'secure' ? 'text-success' : 'text-danger'">
              {{ node.status | uppercase }}
            </div>
            <div class="small text-muted">{{ node.unpatched_cves.length }} Known Exposures</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Uptime</div>
            <div class="h3 fw-bold text-info my-1">{{ node.uptime_days }} Days</div>
            <div class="small text-muted">Continuous operation</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">RPC Auth</div>
            <div class="h3 fw-bold text-light my-1">{{ node.rpc_auth_type | uppercase }}</div>
            <div class="small text-muted">Protected endpoint</div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-dark border-secondary p-3 h-100">
            <div class="text-muted small text-uppercase">Tor Anonymity</div>
            <div class="h3 fw-bold my-1" [ngClass]="node.tor_enabled ? 'text-success' : 'text-muted'">
              {{ node.tor_enabled ? 'ENABLED' : 'DISABLED' }}
            </div>
            <div class="small text-muted">Onion routing proxy</div>
          </div>
        </div>
      </div>

      <div class="card bg-dark border-secondary mb-4" *ngIf="node.unpatched_cves.length > 0">
        <div class="card-header border-secondary">
          <h5 class="card-title text-danger mb-0">Action Required: Unpatched CVEs</h5>
        </div>
        <div class="card-body">
          <div *ngFor="let cve of node.unpatched_cves" class="alert alert-danger bg-dark border-danger mb-2">
            <strong>{{ cve }}:</strong> Node version {{ node.version }} is vulnerable to unauthenticated remote DoS. Upgrade immediately.
          </div>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityNodeDetailComponent implements OnInit {
  public node: any = null;

  constructor(
    private route: ActivatedRoute,
    private api: NodeSecurityApiService
  ) {}

  public ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const nodeId = params.get('nodeId') || 'node-prod-eu-01';
      this.api.getNode$(nodeId).subscribe(res => {
        this.node = res;
      });
    });
  }
}
