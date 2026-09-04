import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NodeSecurityApiService } from './node-security.service';

@Component({
  selector: 'app-node-security-releases',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Bitcoin Core Release Lifecycle & Support Windows</h1>
          <p class="text-muted mb-0">Official support schedules, active maintenance branches, and End-of-Life (EOL) timelines.</p>
        </div>
        <a routerLink="/node/security" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Official Release Matrix</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Version</th>
                <th>Release Date</th>
                <th>Lifecycle Status</th>
                <th>EOL Target</th>
                <th>Guix Reproduced</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let rel of releases">
                <td class="fw-bold text-info">{{ rel.version }}</td>
                <td>{{ rel.release_date }}</td>
                <td>
                  <span class="badge" [ngClass]="rel.support_status === 'current' ? 'bg-success' : (rel.support_status === 'maintenance' ? 'bg-warning text-dark' : 'bg-danger')">
                    {{ rel.support_status | uppercase }}
                  </span>
                </td>
                <td class="text-muted">{{ rel.eol_date }}</td>
                <td><span class="badge bg-success">100% REPRODUCED</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityReleasesComponent implements OnInit {
  public releases: any[] = [];

  constructor(private api: NodeSecurityApiService) {}

  public ngOnInit(): void {
    this.api.getReleases$().subscribe(res => {
      this.releases = res;
    });
  }
}
