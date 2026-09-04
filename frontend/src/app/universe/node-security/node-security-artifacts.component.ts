import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-artifacts',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Guix Reproducible Builds & Artifact Attestations</h1>
          <p class="text-muted mb-0">Multi-party cryptographic attestations guaranteeing binary releases are built bit-for-bit identically from source.</p>
        </div>
        <a routerLink="/node/security" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Verified Release Binaries</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Release</th>
                <th>Artifact Filename</th>
                <th>SHA256 Checksum</th>
                <th>Guix Signers</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let art of artifacts">
                <td class="fw-bold">{{ art.release }}</td>
                <td class="font-monospace text-info">{{ art.filename }}</td>
                <td class="font-monospace text-muted small">{{ art.sha256 | slice:0:24 }}...</td>
                <td><span class="badge bg-primary">{{ art.guix_attestations_count }} Signatures</span></td>
                <td><span class="badge bg-success">{{ art.reproducibility_status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityArtifactsComponent implements OnInit {
  public artifacts: any[] = [];

  constructor(private api: NodeSecurityApiService) {}

  public ngOnInit(): void {
    this.api.getArtifacts$().subscribe(res => {
      this.artifacts = res;
    });
  }
}
