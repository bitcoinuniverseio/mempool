import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-fleet',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Node Fleet Security Posture</h1>
          <p class="text-muted mb-0">Telemetry status of enterprise and community Bitcoin node fleet deployments.</p>
        </div>
        <a routerLink="/node/security" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Fleet Node Inventory</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Node ID</th>
                <th>Client</th>
                <th>Version</th>
                <th>Network IP</th>
                <th>Vulnerabilities</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let node of fleet">
                <td class="font-monospace">
                  <a [routerLink]="['/node/security/node', node.node_id]" class="text-info">{{ node.node_id }}</a>
                </td>
                <td>{{ node.client_name }}</td>
                <td class="fw-bold">{{ node.version }}</td>
                <td class="font-monospace text-muted">{{ node.ip_anonymized }}</td>
                <td>
                  <span class="badge" [ngClass]="node.vulnerabilities_count > 0 ? 'bg-danger' : 'bg-success'">
                    {{ node.vulnerabilities_count }} CVEs
                  </span>
                </td>
                <td>
                  <span class="badge" [ngClass]="node.status === 'secure' ? 'bg-success' : 'bg-warning text-dark'">
                    {{ node.status | uppercase }}
                  </span>
                </td>
                <td>
                  <a [routerLink]="['/node/security/node', node.node_id]" class="btn btn-sm btn-outline-primary">Audit Node</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityFleetComponent implements OnInit {
  public fleet: any[] = [];

  constructor(private api: NodeSecurityApiService) {}

  public ngOnInit(): void {
    this.api.getFleet$().subscribe(res => {
      this.fleet = res;
    });
  }
}
